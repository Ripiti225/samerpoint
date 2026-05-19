/**
 * lib/onedrive.js
 * Sauvegarde automatique sur OneDrive via Microsoft Graph API
 *
 * PRÉREQUIS (une seule fois) :
 * 1. Aller sur https://portal.azure.com → App registrations → New registration
 * 2. Nom : Samtrackly, Supported account types : "Accounts in any organizational directory + personal"
 * 3. Redirect URI : type "Public client/native" → samtrackly://onedrive-auth
 * 4. API permissions : Files.ReadWrite, offline_access
 * 5. Copier l'Application (client) ID → remplacer ONEDRIVE_CLIENT_ID ci-dessous
 */

import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Linking from 'expo-linking'
import * as WebBrowser from 'expo-web-browser'
import { Platform } from 'react-native'
import { supabase } from './supabase'

// ── ⚠️ À CONFIGURER par le propriétaire de l'app ──────────────
const ONEDRIVE_CLIENT_ID = 'VOTRE_AZURE_CLIENT_ID_ICI'
// ────────────────────────────────────────────────────────────────

const TENANT = 'common'
const SCOPES = 'Files.ReadWrite offline_access'
const TOKEN_KEY = 'samerpoint_onedrive_tokens'
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'

// ──────────────────────────────────────────────
// PKCE helpers
// ──────────────────────────────────────────────
function generateVerifier() {
  const array = new Uint8Array(32)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(array)
  } else {
    for (let i = 0; i < 32; i++) array[i] = Math.floor(Math.random() * 256)
  }
  return base64urlEncode(array)
}

async function generateChallenge(verifier) {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const encoder = new TextEncoder()
    const data = encoder.encode(verifier)
    const digest = await crypto.subtle.digest('SHA-256', data)
    return base64urlEncode(new Uint8Array(digest))
  }
  // Fallback sans crypto.subtle (très rare)
  return verifier
}

function base64urlEncode(bytes) {
  let str = ''
  for (const b of bytes) str += String.fromCharCode(b)
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

// ──────────────────────────────────────────────
// Token storage
// ──────────────────────────────────────────────
async function sauvegarderTokens(tokens) {
  await AsyncStorage.setItem(TOKEN_KEY, JSON.stringify({
    ...tokens,
    expires_at: Date.now() + (tokens.expires_in || 3600) * 1000,
  }))
}

async function lireTokens() {
  const raw = await AsyncStorage.getItem(TOKEN_KEY)
  return raw ? JSON.parse(raw) : null
}

async function supprimerTokens() {
  await AsyncStorage.removeItem(TOKEN_KEY)
}

async function getAccessToken() {
  const tokens = await lireTokens()
  if (!tokens) return null

  // Valide encore
  if (tokens.expires_at > Date.now() + 60_000) return tokens.access_token

  // Rafraîchir via refresh_token
  if (!tokens.refresh_token) return null
  try {
    const res = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: ONEDRIVE_CLIENT_ID,
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        scope: SCOPES,
      }).toString(),
    })
    const data = await res.json()
    if (data.access_token) {
      await sauvegarderTokens(data)
      return data.access_token
    }
    await supprimerTokens()
    return null
  } catch {
    return null
  }
}

// ──────────────────────────────────────────────
// OAuth2 avec PKCE
// ──────────────────────────────────────────────
export async function connecterOneDrive() {
  const verifier = generateVerifier()
  const challenge = await generateChallenge(verifier)

  // Redirect URI : scheme natif ou web
  const redirectUri = Platform.OS === 'web'
    ? `${window.location.origin}/onedrive-auth`
    : Linking.createURL('onedrive-auth')

  const params = new URLSearchParams({
    client_id: ONEDRIVE_CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: SCOPES,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  })

  const authUrl = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize?${params}`

  const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUri)

  if (result.type !== 'success' || !result.url) {
    return { success: false, error: 'Authentification annulée' }
  }

  // Extraire le code
  const url = new URL(result.url)
  const code = url.searchParams.get('code')
  const error = url.searchParams.get('error_description') || url.searchParams.get('error')
  if (!code) return { success: false, error: error || 'Code manquant' }

  // Échanger contre des tokens
  const tokenRes = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: ONEDRIVE_CLIENT_ID,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }).toString(),
  })

  const tokenData = await tokenRes.json()
  if (!tokenData.access_token) {
    return { success: false, error: tokenData.error_description || 'Erreur token' }
  }

  // Récupérer l'email de l'utilisateur
  let email = ''
  try {
    const meRes = await fetch(`${GRAPH_BASE}/me?$select=mail,displayName`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    })
    const me = await meRes.json()
    email = me.mail || me.userPrincipalName || ''
  } catch {}

  await sauvegarderTokens(tokenData)
  return { success: true, email }
}

export async function deconnecterOneDrive() {
  await supprimerTokens()
}

export async function estatConnecte() {
  const tokens = await lireTokens()
  return !!tokens
}

// ──────────────────────────────────────────────
// Upload Excel vers OneDrive
// ──────────────────────────────────────────────
async function uploadFichier(nomDossier, nomFichier, contenuBuffer) {
  const token = await getAccessToken()
  if (!token) throw new Error('Non connecté à OneDrive')

  // Créer le dossier si inexistant (PUT avec conflictBehavior=replace)
  const dossierPath = encodeURIComponent(`Samtrackly/${nomDossier}`)
  const uploadUrl = `${GRAPH_BASE}/me/drive/root:/${dossierPath}/${encodeURIComponent(nomFichier)}:/content`

  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    },
    body: contenuBuffer,
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error?.message || `Erreur upload ${res.status}`)
  }

  return await res.json()
}

// ──────────────────────────────────────────────
// Génération du fichier Excel du point journalier
// ──────────────────────────────────────────────
async function genererExcelPoint(dateJour, restaurantNom) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Samtrackly'
  wb.created = new Date()

  // Feuille 1 : points du mois
  const ws = wb.addWorksheet('Point journalier')

  const [y, m, d] = dateJour.split('-')
  const debutMois = `${y}-${m}-01`
  const finMois = `${y}-${m}-${new Date(y, m, 0).getDate().toString().padStart(2, '0')}`

  const { data: restaurants } = await supabase.from('restaurants').select('id, nom')

  ws.columns = [
    { header: 'Date', key: 'date', width: 14 },
    { header: 'Restaurant', key: 'restaurant', width: 22 },
    { header: 'Ventes totales', key: 'vente_total', width: 16 },
    { header: 'Bénéfice SC', key: 'benefice_sc', width: 16 },
    { header: 'Dépenses', key: 'depense_total', width: 16 },
    { header: 'Espèces', key: 'reste_especes', width: 16 },
    { header: 'Validé', key: 'valide', width: 10 },
  ]

  // Style header
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF534AB7' } }

  // Charger les points du mois
  const restoIds = (restaurants || []).map(r => r.id)
  if (restoIds.length > 0) {
    const { data: points } = await supabase
      .from('points')
      .select('date, restaurant_id, vente_total, benefice_sc, depense_total, reste_especes, valide')
      .in('restaurant_id', restoIds)
      .gte('date', debutMois)
      .lte('date', finMois)
      .order('date', { ascending: false })

    for (const p of points || []) {
      const resto = (restaurants || []).find(r => r.id === p.restaurant_id)
      ws.addRow({
        date: p.date,
        restaurant: resto?.nom || '',
        vente_total: p.vente_total || 0,
        benefice_sc: p.benefice_sc || 0,
        depense_total: p.depense_total || 0,
        reste_especes: p.reste_especes || 0,
        valide: p.valide ? 'Oui' : 'Non',
      })
    }
  }

  // Alternance de lignes
  ws.eachRow((row, rowNumber) => {
    if (rowNumber > 1 && rowNumber % 2 === 0) {
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4F4FB' } }
    }
  })

  const buffer = await wb.xlsx.writeBuffer()
  return buffer
}

// ──────────────────────────────────────────────
// Export public : sauvegarder sur OneDrive
// ──────────────────────────────────────────────
export async function sauvegarderSurOneDrive(dateJour, restaurantNom) {
  const token = await getAccessToken()
  if (!token) return { success: false, error: 'non_connecte' }

  try {
    const [y, m] = dateJour.split('-')
    const nomDossier = `${y}-${m}`
    const nomFichier = `point_${dateJour}_${(restaurantNom || 'restaurant').replace(/[^a-zA-Z0-9]/g, '_')}.xlsx`

    const buffer = await genererExcelPoint(dateJour, restaurantNom)
    await uploadFichier(nomDossier, nomFichier, buffer)

    return { success: true, nomFichier }
  } catch (err) {
    return { success: false, error: err.message }
  }
}
