import { supabase } from './supabase'
import {
  cacheFournisseurs, cachePoint, cacheRestaurants, cacheTravailleurs, cacheUtilisateurs,
  getCachedFournisseurs, getCachedPoint, getCachedRestaurants, getCachedTravailleurs, getCachedUtilisateurs,
} from './offlineCache'
import { enqueueOperation } from './offlineQueue'
import { isOnlineNow } from './networkStatus'
import { journaliser, ACTIONS } from './journal'

export async function getOrCreatePoint(date, gerantId, restaurantId) {
  if (!isOnlineNow()) {
    const cached = await getCachedPoint(restaurantId, date)
    return cached || null
  }
  const { data: existing } = await supabase
    .from('points')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .eq('date', date)
    .single()

  if (existing) {
    await cachePoint(restaurantId, date, existing)
    return existing
  }

  const { data: created, error } = await supabase
    .from('points')
    .insert({
      restaurant_id: restaurantId,
      date,
      gerant_id: gerantId,
      valide: false,
    })
    .select()
    .single()

  if (error) { console.error('Erreur création point:', error); return null }
  if (created) await cachePoint(restaurantId, date, created)
  return created
}

export async function getDepenses(pointId) {
  const { data } = await supabase
    .from('depenses')
    .select('*')
    .eq('point_id', pointId)
    .order('created_at')
  return data || []
}

export async function saveDepenses(pointId, depensesJour, saisiPar = 'caissier', caissierNom = null) {
  if (!isOnlineNow()) {
    await enqueueOperation('saveDepenses', [pointId, depensesJour, saisiPar, caissierNom])
    return
  }
  // Supprimer uniquement les dépenses du même type
  await supabase
    .from('depenses')
    .delete()
    .eq('point_id', pointId)
    .eq('saisi_par', saisiPar)

  const lignes = []
  Object.entries(depensesJour).forEach(([categorie, items]) => {
    items.forEach(item => {
      if (item.montant && parseFloat(item.montant) > 0) {
        lignes.push({
          point_id: pointId,
          categorie,
          libelle: item.libelle || '',
          montant: parseFloat(item.montant) || 0,
          saisi_par: saisiPar,
          caissier_nom: caissierNom,
        })
      }
    })
  })
  if (lignes.length > 0) {
    await supabase.from('depenses').insert(lignes)
  }
  journaliser(ACTIONS.DEPENSES_SAUVEGARDEES, { nb_lignes: lignes.length, saisi_par: saisiPar }, { pointId }).catch(() => {})
}

export async function getPresences(pointId) {
  const { data } = await supabase
    .from('presences')
    .select('*')
    .eq('point_id', pointId)
  return data || []
}

export async function savePresences(pointId, travailleurs, presencesJour, paiesJour) {
  if (!isOnlineNow()) {
    await enqueueOperation('savePresences', [pointId, travailleurs, presencesJour, paiesJour])
    return
  }
  await supabase.from('presences').delete().eq('point_id', pointId)
  const lignes = travailleurs
    .filter(t => presencesJour[t.id])
    .map(t => ({
      point_id: pointId,
      travailleur_id: t.id,
      travailleur_nom: t.nom,
      statut: presencesJour[t.id] || 'Absent',
      paye: parseFloat(paiesJour[t.id]) || 0,
    }))
  if (lignes.length > 0) {
    await supabase.from('presences').insert(lignes)
  }
  journaliser(ACTIONS.PRESENCES_SAUVEGARDEES, { nb_presences: lignes.length }, { pointId }).catch(() => {})
}

export async function getCommandes(pointId, userId = null) {
  try {
    let q = supabase.from('commandes').select('*').eq('point_id', pointId)
    if (userId) q = q.eq('caissier_id', userId)
    const { data } = await q
    return data || []
  } catch (_) {
    const { data } = await supabase.from('commandes').select('*').eq('point_id', pointId)
    return data || []
  }
}

export async function saveCommandes(pointId, livraisonsJour, userId = null) {
  if (!isOnlineNow()) {
    await enqueueOperation('saveCommandes', [pointId, livraisonsJour, userId])
    return
  }
  // Supprimer uniquement les commandes de ce caissier pour ne pas écraser les autres shifts
  let delQ = supabase.from('commandes').delete().eq('point_id', pointId)
  if (userId) delQ = delQ.eq('caissier_id', userId)
  await delQ
  const lignes = []
  Object.entries(livraisonsJour).forEach(([partenaire, items]) => {
    items.forEach(item => {
      lignes.push({
        point_id: pointId,
        caissier_id: userId || null,
        partenaire,
        numero_commande: item.numero || '',
        contact_client: item.contact || '',
        plat: item.plat || '',
      })
    })
  })
  if (lignes.length > 0) {
    await supabase.from('commandes').insert(lignes)
  }
  journaliser(ACTIONS.LIVRAISONS_SAUVEGARDEES, { nb_commandes: lignes.length }, { pointId }).catch(() => {})
}

export async function getTransactionsFournisseurs(pointId) {
  const { data } = await supabase
    .from('transactions_fournisseurs')
    .select('*')
    .eq('point_id', pointId)
  return data || []
}

export async function saveTransactionsFournisseurs(pointId, fournisseursJour, creditsVeille = {}, saisiPar = 'gerant', restaurantId = null) {
  if (!isOnlineNow()) {
    await enqueueOperation('saveTransactionsFournisseurs', [pointId, fournisseursJour, creditsVeille, saisiPar])
    return
  }

  const fournIds = Object.keys(fournisseursJour).filter(id => {
    const t = fournisseursJour[id]
    return (parseFloat(t.facture) || 0) || (parseFloat(t.paye) || 0)
  })
  if (fournIds.length === 0) return

  // Lire credit_actuel réel depuis la DB (creditsVeille peut être vide pour le caissier)
  const { data: fournData } = await supabase
    .from('fournisseurs').select('id, nom, credit_actuel').in('id', fournIds)
  const creditDb = {}
  const nomDb = {}
  ;(fournData || []).forEach(f => { creditDb[f.id] = f.credit_actuel || 0; nomDb[f.id] = f.nom || null })

  // Supprimer uniquement les entrées du même auteur pour ce point
  await supabase.from('transactions_fournisseurs')
    .delete().eq('point_id', pointId).eq('saisi_par', saisiPar)

  const lignes = fournIds.map(fournisseurId => {
    const t = fournisseursJour[fournisseurId]
    const credit = creditDb[fournisseurId] ?? creditsVeille[fournisseurId] ?? 0
    const facture = parseFloat(t.facture) || 0
    const paye = parseFloat(t.paye) || 0
    return { point_id: pointId, fournisseur_id: fournisseurId, fournisseur_nom: nomDb[fournisseurId] || null, source: saisiPar, restaurant_id: restaurantId || null, facture, paye, reste: credit + facture - paye, photo_url: t.photoUri || null, saisi_par: saisiPar, _credit: credit }
  })

  await supabase.from('transactions_fournisseurs').insert(lignes.map(({ _credit, ...l }) => l))

  // Mettre à jour credit_actuel pour chaque fournisseur
  for (const ligne of lignes) {
    await supabase.from('fournisseurs')
      .update({ credit_actuel: ligne.reste })
      .eq('id', ligne.fournisseur_id)
  }

  // Enregistrer dans historique_credit_fournisseurs
  if (restaurantId && lignes.length > 0) {
    const today = new Date().toISOString().split('T')[0]
    const motifPrefix = `${saisiPar}|${today}|`
    for (const ligne of lignes) {
      await supabase.from('historique_credit_fournisseurs')
        .delete()
        .eq('fournisseur_id', ligne.fournisseur_id)
        .eq('restaurant_id', restaurantId)
        .like('motif', `${motifPrefix}%`)
    }
    const histoLignes = lignes.map(l => ({
      fournisseur_id: l.fournisseur_id,
      restaurant_id: restaurantId,
      point_id: pointId,
      source: saisiPar,
      ancien_credit: l._credit,
      nouveau_credit: l.reste,
      facture: l.facture,
      paye: l.paye,
      photo_url: l.photo_url || null,
      motif: `${motifPrefix}facture ${Math.round(l.facture).toLocaleString('fr-FR')} FCFA, payé ${Math.round(l.paye).toLocaleString('fr-FR')} FCFA`,
    }))
    await supabase.from('historique_credit_fournisseurs').insert(histoLignes)
  }
}

export async function getSequences(pointId) {
  const { data } = await supabase
    .from('sequences')
    .select('*')
    .eq('point_id', pointId)
    .order('numero')
  return data || []
}

export async function saveSequences(pointId, sequences) {
  if (!isOnlineNow()) {
    await enqueueOperation('saveSequences', [pointId, sequences])
    return
  }
  await supabase.from('sequences').delete().eq('point_id', pointId)
  const lignes = sequences
    .filter(s => s.montant && parseFloat(s.montant) > 0)
    .map((s, i) => ({
      point_id: pointId,
      numero: i + 1,
      montant: parseFloat(s.montant) || 0,
      photo_url: s.photo_url || null,
    }))
  if (lignes.length > 0) {
    await supabase.from('sequences').insert(lignes)
  }
}

export async function getDatesValidees(restaurantId) {
  const { data } = await supabase
    .from('points')
    .select('date')
    .eq('restaurant_id', restaurantId)
    .eq('valide', true)
  return (data || []).map(p => p.date)
}

export async function validerPoint(pointId, totaux, contexte = {}) {
  // La validation ne fonctionne qu'en ligne (opération critique)
  if (!isOnlineNow()) return false
  const { error } = await supabase
    .from('points')
    .update({ ...totaux, valide: true })
    .eq('id', pointId)
  if (!error) {
    journaliser(ACTIONS.POINT_VALIDE, { vente_total: totaux.vente_total, benefice_sc: totaux.benefice_sc }, { ...contexte, pointId }).catch(() => {})
  }
  return !error
}

export async function updatePoint(pointId, data) {
  if (!isOnlineNow()) {
    await enqueueOperation('updatePoint', [pointId, data])
    return true
  }
  const { error } = await supabase
    .from('points')
    .update(data)
    .eq('id', pointId)
  return !error
}

export async function getPointsPeriode(restaurantId, dateDebut, dateFin) {
  const { data } = await supabase
    .from('points')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .eq('valide', true)
    .gte('date', dateDebut)
    .lte('date', dateFin)
    .order('date')
  return data || []
}

export async function saveOneTransactionFournisseur(pointId, fournisseurId, transaction, creditVeille = 0, saisiPar = 'gerant', caissierNom = null, restaurantId = null, caissierUserId = null, fournisseurNom = null, source = null) {
  if (!isOnlineNow()) {
    await enqueueOperation('saveOneTransactionFournisseur', [pointId, fournisseurId, transaction, creditVeille, saisiPar, caissierNom, restaurantId, caissierUserId])
    return true
  }
  // Supprimer uniquement cette entrée fournisseur (pas toutes)
  await supabase.from('transactions_fournisseurs')
    .delete()
    .eq('point_id', pointId)
    .eq('fournisseur_id', fournisseurId)
    .eq('saisi_par', saisiPar)

  const facture = parseFloat(transaction.facture) || 0
  const paye = parseFloat(transaction.paye) || 0
  if (!facture && !paye) return true

  const { error } = await supabase.from('transactions_fournisseurs').insert({
    point_id: pointId,
    fournisseur_id: fournisseurId,
    fournisseur_nom: fournisseurNom || null,
    source: source || saisiPar,
    restaurant_id: restaurantId,
    caissier_id: caissierUserId,
    facture,
    paye,
    reste: creditVeille + facture - paye,
    photo_url: transaction.photoUri || null,
    saisi_par: saisiPar,
    caissier_nom: caissierNom,
  })
  if (error) { console.error('Erreur save transaction fournisseur:', error); return false }
  return true
}

export async function getInventaireShifts(pointId) {
  const { data } = await supabase
    .from('inventaires')
    .select('*')
    .eq('point_id', pointId)
    .order('shift_numero')
  return data || []
}

export async function saveInventaireShift(pointId, shift, stocks, categories) {
  if (!isOnlineNow()) {
    await enqueueOperation('saveInventaireShift', [pointId, shift, stocks, categories])
    return true
  }
  await supabase.from('inventaires')
    .delete()
    .eq('point_id', pointId)
    .eq('shift_numero', shift.numero)

  const lignes = []
  categories.forEach(cat => {
    cat.produits.forEach(p => {
      const s = stocks[p.id]
      if (s && (s.initial || s.entrees || s.sorties || s.final)) {
        const initial = parseFloat(s.initial) || 0
        const entrees = parseFloat(s.entrees) || 0
        const sorties = parseFloat(s.sorties) || 0
        const final = parseFloat(s.final) || 0
        lignes.push({
          point_id: pointId,
          produit_id: p.id,
          produit_nom: p.nom,
          stock_initial: initial,
          entrees,
          sorties,
          stock_final: final,
          ecart: final - (initial + entrees - sorties),
          prevision: parseFloat(s.prevision) || 0,
          shift_numero: shift.numero,
          shift_nom: shift.nom,
          heure_debut: shift.heure_debut,
          heure_fin: shift.heure_fin,
        })
      }
    })
  })

  if (lignes.length > 0) {
    const { error } = await supabase.from('inventaires').insert(lignes)
    if (error) { console.error('Erreur save inventaire:', error); return false }
  }
  journaliser(ACTIONS.INVENTAIRE_SAUVEGARDE, { shift: shift.nom, nb_produits: lignes.length }, { pointId }).catch(() => {})
  return true
}
// ─── Fonctions avec cache offline ──────────────────────────────────────────

export async function getRestaurants() {
  if (!isOnlineNow()) {
    const cached = await getCachedRestaurants()
    return cached || []
  }
  const { data, error } = await supabase
    .from('restaurants')
    .select('id, nom, localisation, couleur, photo_url, pin')
    .order('nom')
  if (error) console.error('❌ getRestaurants:', error.code, error.message)
  const result = data || []
  await cacheRestaurants(result)
  return result
}

export async function getUtilisateurs(restaurantId) {
  if (!isOnlineNow()) {
    const cached = await getCachedUtilisateurs(restaurantId)
    return cached || []
  }
  const { data } = await supabase
    .from('utilisateurs')
    .select('id, nom, role, actif, restaurant_id, pin, restaurants(id, nom)')
    .eq('actif', true)
    .or(`restaurant_id.eq.${restaurantId},restaurant_id.is.null`)
    .order('nom')
  const result = data || []
  await cacheUtilisateurs(restaurantId, result)
  return result
}

export async function getUtilisateursGlobaux() {
  const ROLES_GLOBAUX = ['manager', 'rh', 'directeur']
  if (!isOnlineNow()) {
    const cached = await getCachedUtilisateurs('global')
    return cached || []
  }
  const { data } = await supabase
    .from('utilisateurs')
    .select('id, nom, role, actif, restaurant_id, pin')
    .eq('actif', true)
    .in('role', ROLES_GLOBAUX)
    .order('nom')
  const vus = new Set()
  const uniques = (data || []).filter(u => {
    const cle = `${u.nom.trim().toLowerCase()}-${u.role}`
    if (vus.has(cle)) return false
    vus.add(cle)
    return true
  })
  await cacheUtilisateurs('global', uniques)
  return uniques
}

export async function getTravailleurs(restaurantId) {
  if (!isOnlineNow()) {
    const cached = await getCachedTravailleurs(restaurantId)
    return cached || []
  }
  const { data } = await supabase
    .from('travailleurs')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .eq('actif', true)
    .order('nom')
  const result = data || []
  await cacheTravailleurs(restaurantId, result)
  return result
}

export async function getFournisseurs(restaurantId) {
  if (!isOnlineNow()) {
    const cached = await getCachedFournisseurs(restaurantId)
    return cached || []
  }
  const { data } = await supabase
    .from('fournisseurs')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .eq('actif', true)
    .order('nom')
  const result = data || []
  await cacheFournisseurs(restaurantId, result)
  return result
}

// Sauvegarde d'une présence individuelle (depuis presences.js)
// caissierIdParam : userId du caissier — permet plusieurs entrées par employé (multi-shifts)
export async function saveOnePresence(pointId, travailleurId, travailleurNom, statut, paye,
  shiftNom, heureDebut, heureFin, presenceId, utilisateurId, restaurantId, dateJour, caissierIdParam) {
  if (!isOnlineNow()) {
    await enqueueOperation('saveOnePresence', [
      pointId, travailleurId, travailleurNom, statut, paye,
      shiftNom, heureDebut, heureFin, presenceId, utilisateurId, restaurantId, dateJour, caissierIdParam,
    ])
    return { queued: true }
  }

  if (presenceId) {
    const { error } = await supabase.from('presences')
      .update({ statut, paye: parseFloat(paye) || 0, shift_nom: shiftNom || '', heure_debut: heureDebut || '', heure_fin: heureFin || '' })
      .eq('id', presenceId)
    if (error) console.error('❌ Erreur update présence:', error.message, error.details)
    return { id: presenceId }
  }

  const payload = {
    point_id: pointId,
    caissier_id: caissierIdParam || null,
    utilisateur_id: utilisateurId || null,
    travailleur_id: travailleurId,
    travailleur_nom: travailleurNom,
    statut,
    paye: parseFloat(paye) || 0,
    shift_nom: shiftNom || '',
    heure_debut: heureDebut || '',
    heure_fin: heureFin || '',
    restaurant_id: restaurantId,
    date: dateJour || new Date().toISOString().split('T')[0],
  }

  // Tentative 1 — upsert avec contrainte caissier (nécessite UNIQUE sur point_id,caissier_id,travailleur_id)
  if (caissierIdParam) {
    const { data, error } = await supabase.from('presences')
      .upsert(payload, { onConflict: 'point_id,caissier_id,travailleur_id' })
      .select().single()
    if (!error && data) return { id: data.id }
    console.error('❌ Présence upsert (caissier):', error?.message, error?.details)
  }

  // Tentative 2 — upsert legacy sans caissier_id (contrainte point_id,travailleur_id)
  const { data: d2, error: e2 } = await supabase.from('presences')
    .upsert(
      { ...payload, caissier_id: null },
      { onConflict: 'point_id,travailleur_id' }
    )
    .select().single()
  if (!e2 && d2) return { id: d2.id }
  console.error('❌ Présence upsert (legacy):', e2?.message, e2?.details)

  // Tentative 3 — insert simple, aucune contrainte requise
  const { data: d3, error: e3 } = await supabase.from('presences')
    .insert(payload)
    .select().single()
  if (!e3 && d3) return { id: d3.id }
  console.error('❌ Présence insert (fallback final):', e3?.message, e3?.details)

  // Tentative 4 — sans caissier_id (colonne pas encore migrée en DB)
  const { caissier_id: _omit, ...payloadSansCaissier } = payload
  const { data: d4, error: e4 } = await supabase.from('presences')
    .insert(payloadSansCaissier)
    .select().single()
  if (!e4 && d4) return { id: d4.id }
  console.error('❌ Présence insert (sans caissier_id):', e4?.message, e4?.details)

  return null
}

// Sauvegarde d'un shift caissier (depuis point-shift.js)
export async function savePointShiftData(shiftRecord, depensesJour, fournisseursJour, userNom) {
  if (!isOnlineNow()) {
    await enqueueOperation('savePointShiftData', [shiftRecord, depensesJour, fournisseursJour, userNom])
    return { queued: true }
  }

  const { error } = await supabase.from('points_shifts').insert(shiftRecord)
  if (error) throw new Error(error.message)

  await Promise.all([
    saveDepenses(shiftRecord.point_id, depensesJour, 'caissier', userNom),
    saveTransactionsFournisseurs(shiftRecord.point_id, fournisseursJour, {}, 'caissier', shiftRecord.restaurant_id),
  ])
  journaliser(ACTIONS.SHIFT_SAUVEGARDE, { caissier: shiftRecord.caissier_nom, vente: shiftRecord.vente_shift }, { pointId: shiftRecord.point_id, restaurantId: shiftRecord.restaurant_id, userNom }).catch(() => {})
  return { success: true }
}

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://wlwotzxnzowbkbfcpnyi.supabase.co'
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indsd290enhuem93YmtiZmNwbnlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4NjQ1OTEsImV4cCI6MjA5MTQ0MDU5MX0.nioXBAKA05_zRIyTpJmV_d4JY5mCYueOt5cKIlL-NNk'

export async function uploadPhoto(uri, dossier = 'general') {
  try {
    const formData = new FormData()
    let nomFichier, contentType

    // Sur web, l'URI est un blob: ou data: URL — convertir en Blob d'abord
    if (typeof document !== 'undefined') {
      const blob = await (await fetch(uri)).blob()
      // Déduire l'extension depuis le type MIME réel du blob (pas depuis l'URI)
      const mime = blob.type || 'image/jpeg'
      const ext = mime.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg'
      nomFichier = `${dossier}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
      contentType = mime
      formData.append('file', blob, nomFichier)
    } else {
      // React Native : syntaxe objet native
      const ext = uri.split('.').pop()?.split('?')[0]?.toLowerCase() || 'jpg'
      contentType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`
      nomFichier = `${dossier}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
      formData.append('file', { uri, name: nomFichier, type: contentType })
    }

    const response = await fetch(
      `${SUPABASE_URL}/storage/v1/object/photos/${nomFichier}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'apikey': SUPABASE_ANON_KEY,
        },
        body: formData,
      }
    )

    if (!response.ok) {
      const errText = await response.text()
      console.error('❌ Erreur upload:', errText)
      return null
    }

    return `${SUPABASE_URL}/storage/v1/object/public/photos/${nomFichier}`

  } catch (err) {
    console.error('❌ Erreur uploadPhoto:', err)
    return null
  }
}