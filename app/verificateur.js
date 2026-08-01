/*
 * Écran VÉRIFICATEUR — comptage physique du stock.
 *
 * Le vérificateur sélectionne un restaurant. Le système charge le DERNIER stock
 * réel enregistré par le caissier (colonne « Stock réel », pré-remplie). Le
 * vérificateur compte physiquement et saisit « Stock compté ». L'« Écart » se
 * calcule automatiquement (compté − réel).
 *
 * Si ≥ 40 % des produits comptés présentent un écart, une « Demande d'explication »
 * est créée automatiquement dans le module Demandes (visible par le RH) et une
 * notification est envoyée au RH.
 *
 * Le comptage est enregistré dans la table verifications_stock (best-effort) —
 * voir supabase_verifications_stock.sql.
 */

import { router } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import RecapVerifications from '../components/RecapVerifications'
import { useApp } from '../context/AppContext'
import { useTheme } from '../context/ThemeContext'
import { CATEGORIES_INVENTAIRE } from '../lib/constants'
import { journaliser } from '../lib/journal'
import { creerNotification } from '../lib/notificationsInterne'
import { envoyerNotifExplicationNouvelle } from '../lib/notifications'
import { supabase } from '../lib/supabase'
import { appliquerComptage } from '../lib/verificationStock'

const SEUIL_ECART = 0.4 // ≥ 40 % des produits comptés en écart → demande au RH

// Ordre des produits selon le catalogue (IDs stables).
const ORDRE_PRODUIT = {}
CATEGORIES_INVENTAIRE.forEach((cat, ci) => {
  cat.produits.forEach((p, pi) => { ORDRE_PRODUIT[p.id] = ci * 1000 + pi })
})

function aujourdhui() {
  return new Date().toISOString().slice(0, 10)
}

export default function VerificateurScreen() {
  const { userId, userNom, roleActif, deconnecter } = useApp() ?? {}
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const [restaurants, setRestaurants] = useState([])
  const [resto, setResto] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [produits, setProduits] = useState([])      // [{ produit_id, produit_nom, stock_reel }]
  const [comptes, setComptes] = useState({})         // { produit_id: '12' }
  const [refInfo, setRefInfo] = useState(null)       // { date, caissierId, caissierNom }
  const [tab, setTab] = useState('comptage')         // 'comptage' | 'recap'

  useEffect(() => { chargerRestaurants() }, [])

  async function chargerRestaurants() {
    setLoading(true)
    const { data } = await supabase
      .from('restaurants').select('id, nom').order('nom')
    const restos = data || []
    setRestaurants(restos)
    if (restos[0]) {
      setResto(restos[0])
      await chargerStock(restos[0].id)
    }
    setLoading(false)
  }

  // Charge le stock final du DERNIER SHIFT VALIDÉ (valide = true) du restaurant.
  // Ex : à 18h, si le shift 08h-16h est validé mais le 16h-00h ne l'est pas,
  // la référence est le stock final de l'inventaire 08h-16h.
  async function chargerStock(restoId) {
    setLoading(true)
    setComptes({})
    setProduits([])
    setRefInfo(null)

    const { data: shifts } = await supabase
      .from('inventaires_shifts')
      .select('id, date, caissier_id, type_shift, heure_debut, heure_fin, created_at, inventaire_lignes(produit_id, produit_nom, stock_reel)')
      .eq('restaurant_id', restoId)
      .eq('valide', true)
      .order('created_at', { ascending: false })
      .limit(1)

    const shift = (shifts || [])[0]

    const map = {}
    ;(shift?.inventaire_lignes || []).forEach(l => {
      if (l.stock_reel == null) return
      if (!(l.produit_id in map)) {
        map[l.produit_id] = {
          produit_id: l.produit_id,
          produit_nom: l.produit_nom,
          stock_reel: Number(l.stock_reel),
        }
      }
    })

    const liste = Object.values(map).sort(
      (a, b) => (ORDRE_PRODUIT[a.produit_id] ?? 9999) - (ORDRE_PRODUIT[b.produit_id] ?? 9999)
    )
    setProduits(liste)

    // Caissier du shift validé — destinataire de l'explication.
    let caissierNom = null
    if (shift?.caissier_id) {
      const { data: u } = await supabase
        .from('utilisateurs').select('nom').eq('id', shift.caissier_id).maybeSingle()
      caissierNom = u?.nom || null
    }
    setRefInfo({
      date: shift?.date || null,
      caissierId: shift?.caissier_id || null,
      caissierNom,
      heureDebut: shift?.heure_debut || null,
      heureFin: shift?.heure_fin || null,
      typeShift: shift?.type_shift || null,
    })
    setLoading(false)
  }

  async function changerResto(r) {
    setResto(r)
    await chargerStock(r.id)
  }

  function setCompte(produitId, val) {
    const clean = val.replace(',', '.').replace(/[^0-9.]/g, '')
    setComptes(prev => ({ ...prev, [produitId]: clean }))
  }

  function ecartDe(p) {
    const raw = comptes[p.produit_id]
    if (raw == null || raw === '') return null
    const c = parseFloat(raw)
    if (isNaN(c)) return null
    return c - p.stock_reel
  }

  // Récap live
  const recap = useMemo(() => {
    let comptees = 0, avecEcart = 0
    produits.forEach(p => {
      const e = (() => {
        const raw = comptes[p.produit_id]
        if (raw == null || raw === '') return null
        const c = parseFloat(raw)
        return isNaN(c) ? null : c - p.stock_reel
      })()
      if (e != null) { comptees++; if (Math.abs(e) > 0.001) avecEcart++ }
    })
    const pct = comptees > 0 ? Math.round((avecEcart / comptees) * 100) : 0
    return { comptees, avecEcart, pct }
  }, [produits, comptes])

  function seDeconnecter() {
    deconnecter?.()
    router.replace('/login')
  }

  async function valider() {
    if (!resto) return
    if (recap.comptees === 0) {
      Alert.alert('Aucun comptage', 'Saisissez le stock compté d’au moins un produit avant de valider.')
      return
    }
    setSaving(true)
    const date = aujourdhui()

    // Lignes comptées avec écart calculé
    const lignes = produits
      .map(p => {
        const raw = comptes[p.produit_id]
        if (raw == null || raw === '') return null
        const compte = parseFloat(raw)
        if (isNaN(compte)) return null
        return { ...p, stock_compte: compte, ecart: compte - p.stock_reel }
      })
      .filter(Boolean)

    const avecEcart = lignes.filter(l => Math.abs(l.ecart) > 0.001)
    const ratio = lignes.length ? avecEcart.length / lignes.length : 0
    const pct = Math.round(ratio * 100)

    // Enregistrement du comptage (best-effort — n'empêche pas le flux si la table manque)
    const lot = `${userId || 'v'}-${Date.now()}` // regroupe les lignes de ce comptage
    const rows = lignes.map(l => ({
      lot_id: lot,
      restaurant_id: resto.id,
      date,
      verificateur_id: userId || null,
      verificateur_nom: userNom || null,
      produit_id: l.produit_id,
      produit_nom: l.produit_nom,
      stock_reel: l.stock_reel,
      stock_compte: l.stock_compte,
      ecart: l.ecart,
    }))
    try {
      const { error: insErr } = await supabase.from('verifications_stock').insert(rows)
      // Colonne lot_id absente sur une table déjà créée → réessai sans lot_id.
      if (insErr) {
        const rowsSansLot = rows.map(({ lot_id, ...r }) => r)
        await supabase.from('verifications_stock').insert(rowsSansLot)
      }
    } catch (_) { /* table absente : on continue */ }

    // Le stock compté devient le stock initial de l'inventaire (en cours si
    // ouvert, sinon le prochain créé). Sans ça le manque physique retomberait
    // en écart sur le caissier du shift suivant.
    let report = { cible: 'prochain', statut: 'ok' }
    try {
      report = await appliquerComptage({ restaurantId: resto.id, lotId: lot, lignes })
    } catch (_) { report = { cible: 'prochain', statut: 'erreur' } }

    journaliser('verification_stock', {
      restaurant_id: resto.id, comptes: lignes.length, ecarts: avecEcart.length, pct,
      stock_initial_reporte: report.cible, report_statut: report.statut,
    }, { par: userNom || roleActif }).catch(() => {})

    // Notifier manager + directeur de la vérification de stock enregistrée.
    creerNotification({
      type: 'verification_stock',
      titre: '🔍 Vérification de stock',
      message: `${userNom || 'Vérificateur'}${resto.nom ? ` — ${resto.nom}` : ''} : ${lignes.length} produit(s) comptés, ${avecEcart.length} écart(s) (${pct}%)`,
      restaurant_id: resto.id,
      cible_role: ['manager', 'directeur'],
      screen: null,
    }).catch(() => {})

    // Ce que devient le stock compté — à dire clairement au vérificateur.
    const msgReport =
      report.statut === 'migration'
        ? '\n\n⚠️ Le stock compté n’a PAS été repris comme stock initial (mise à jour de la base requise).'
        : report.statut === 'erreur'
          ? '\n\n⚠️ Le stock compté n’a pas pu être repris comme stock initial.'
          : report.cible === 'ouvert'
            ? '\n\n📦 Le stock compté devient le stock initial de l’inventaire en cours.'
            : '\n\n📦 Le stock compté servira de stock initial au prochain inventaire.'

    // Seuil atteint → demande d'explication + notification RH
    if (ratio >= SEUIL_ECART) {
      const creee = await creerDemandeRH(avecEcart, lignes.length, pct, date)
      setSaving(false)
      Alert.alert(
        '⚠️ Écarts importants',
        `${avecEcart.length}/${lignes.length} produits comptés présentent un écart (${pct}%).\n\n` +
        (creee
          ? "📨 Une demande d'explication a été créée et le RH a été notifié."
          : "⚠️ La demande d'explication n'a PAS pu être créée. Prévenez le RH ou le manager.") +
        msgReport
      )
    } else {
      setSaving(false)
      Alert.alert(
        '✅ Comptage enregistré',
        `${avecEcart.length}/${lignes.length} produits en écart (${pct}%). En dessous du seuil de 40 % — aucune demande envoyée.${msgReport}`
      )
    }
    setComptes({})
  }

  // Demande d'explication automatique (seuil d'écarts atteint).
  // Table demandes_explication — celle du workflow accepter → envoyer → relancer,
  // pas l'ancienne table `demandes` (congés/absences), où elle passait inaperçue.
  // @returns true si la demande a bien été créée.
  async function creerDemandeRH(avecEcart, nbComptes, pct, date) {
    const caissierNom = refInfo?.caissierNom || 'Caissier'

    // Le caissier est un utilisateur : on relie au travailleur homonyme s'il existe.
    let travailleurId = null, travailleurPoste = null
    const { data: trav } = await supabase
      .from('travailleurs').select('id, poste').eq('restaurant_id', resto.id).ilike('nom', caissierNom).limit(1)
    if (trav && trav.length) { travailleurId = trav[0].id; travailleurPoste = trav[0].poste || null }

    const liste = avecEcart
      .map(l => `• ${l.produit_nom} : réel ${l.stock_reel}, compté ${l.stock_compte} (écart ${l.ecart > 0 ? '+' : ''}${l.ecart})`)
      .join('\n')
    const description =
      `Comptage du vérificateur (${userNom || 'Vérificateur'}) le ${date} : ` +
      `${avecEcart.length}/${nbComptes} produits comptés présentent un écart (${pct}%).\n\n` +
      `Produits concernés :\n${liste}\n\nMerci de justifier ces écarts.`

    const { error } = await supabase.from('demandes_explication').insert({
      restaurant_id: resto.id,
      travailleur_id: travailleurId,
      travailleur_nom: caissierNom,
      travailleur_poste: travailleurPoste,
      motif: `Écarts de stock au comptage (${pct}%)`,
      description,
      // Créateur non-admin → passe par l'acceptation d'un admin, comme un gérant.
      statut: 'en_attente_acceptation',
      numero: 1,
      cree_par_id: userId || null,
      cree_par_nom: userNom || roleActif || 'Vérificateur',
      cree_par_role: roleActif || 'verificateur',
    })
    if (error) return false

    creerNotification({
      type: 'explication_nouvelle',
      titre: "Demande d'explication",
      message: `📨 ${caissierNom} — ${resto.nom} · écarts de stock ${pct}% · à accepter`,
      restaurant_id: resto.id,
      cible_role: ['rh', 'directeur', 'manager'],
      created_by: userId || null,
      screen: 'demandes-explication-admin',
    }).catch(() => {})
    envoyerNotifExplicationNouvelle(caissierNom, resto.id).catch(() => {})
    return true
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={seDeconnecter}>
          <Text style={styles.back}>⎋ Déconnexion</Text>
        </TouchableOpacity>
        <View>
          <Text style={styles.headerTitre}>Vérification du stock</Text>
          <Text style={styles.headerSub}>Comptage physique</Text>
        </View>
        <View style={{ width: 70 }} />
      </View>

      {/* Onglets */}
      <View style={styles.tabBar}>
        <TouchableOpacity style={[styles.tabBtn, tab === 'comptage' && styles.tabBtnActive]} onPress={() => setTab('comptage')}>
          <Text style={[styles.tabTxt, tab === 'comptage' && styles.tabTxtActive]}>📝 Comptage</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tabBtn, tab === 'recap' && styles.tabBtnActive]} onPress={() => setTab('recap')}>
          <Text style={[styles.tabTxt, tab === 'recap' && styles.tabTxtActive]}>🗒️ Récap du jour</Text>
        </TouchableOpacity>
      </View>

      {tab === 'recap' ? (
        <RecapVerifications colors={colors} />
      ) : (
        <>
      {/* Sélection restaurant */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.restoBar}>
        {restaurants.map(r => (
          <TouchableOpacity
            key={r.id}
            style={[styles.restoBtn, resto?.id === r.id && styles.restoBtnActive]}
            onPress={() => changerResto(r)}
          >
            <Text style={[styles.restoTxt, resto?.id === r.id && styles.restoTxtActive]}>{r.nom}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {refInfo?.date && (
        <Text style={styles.refTxt}>
          Référence : dernier shift validé
          {refInfo.heureDebut && refInfo.heureFin ? ` ${refInfo.heureDebut.slice(0, 5)}–${refInfo.heureFin.slice(0, 5)}` : (refInfo.typeShift ? ` (${refInfo.typeShift})` : '')}
          {' '}du {refInfo.date}
          {refInfo.caissierNom ? ` — caissier ${refInfo.caissierNom}` : ''}
        </Text>
      )}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingTxt}>Chargement du stock…</Text>
        </View>
      ) : produits.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>📦</Text>
          <Text style={styles.emptyTxt}>Aucun stock enregistré</Text>
          <Text style={styles.emptySub}>Ce restaurant n&apos;a pas d&apos;inventaire récent à vérifier.</Text>
        </View>
      ) : (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <View style={styles.tableHead}>
            <Text style={[styles.colProduit, styles.thTxt]}>Produit</Text>
            <Text style={[styles.colNum, styles.thTxt]}>Réel</Text>
            <Text style={[styles.colNum, styles.thTxt]}>Compté</Text>
            <Text style={[styles.colNum, styles.thTxt]}>Écart</Text>
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 140 }} keyboardShouldPersistTaps="handled">
            {produits.map(p => {
              const e = ecartDe(p)
              const enEcart = e != null && Math.abs(e) > 0.001
              return (
                <View key={p.produit_id} style={styles.row}>
                  <Text style={styles.colProduit} numberOfLines={2}>{p.produit_nom}</Text>
                  <Text style={[styles.colNum, styles.reelTxt]}>{p.stock_reel}</Text>
                  <TextInput
                    style={[styles.colNum, styles.input]}
                    value={comptes[p.produit_id] ?? ''}
                    onChangeText={v => setCompte(p.produit_id, v)}
                    placeholder="—"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="numeric"
                  />
                  <Text style={[styles.colNum, styles.ecartTxt, enEcart && styles.ecartActif]}>
                    {e == null ? '—' : (e > 0 ? '+' : '') + e}
                  </Text>
                </View>
              )
            })}
          </ScrollView>

          {/* Barre récap + validation */}
          <View style={styles.footer}>
            <View style={styles.recapBox}>
              <Text style={styles.recapTxt}>
                {recap.comptees} compté(s) · {recap.avecEcart} écart(s)
              </Text>
              <Text style={[styles.recapPct, recap.pct >= 40 && styles.recapPctAlert]}>
                {recap.pct}%{recap.pct >= 40 ? ' ⚠️' : ''}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.validerBtn, saving && { opacity: 0.6 }]}
              onPress={valider}
              disabled={saving}
            >
              {saving
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.validerTxt}>✅ Valider le comptage</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      )}
        </>
      )}
    </SafeAreaView>
  )
}

function makeStyles(colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    header: {
      backgroundColor: colors.headerBg, padding: 16,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    },
    back: { fontSize: 15, color: colors.primaryText, fontWeight: '500' },
    headerTitre: { fontSize: 16, fontWeight: '600', color: colors.surface, textAlign: 'center' },
    headerSub: { fontSize: 11, color: colors.primaryText, textAlign: 'center' },
    tabBar: { flexDirection: 'row', backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
    tabBtn: { flex: 1, paddingVertical: 12, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
    tabBtnActive: { borderBottomColor: colors.primary },
    tabTxt: { fontSize: 13, color: colors.textMuted, fontWeight: '500' },
    tabTxtActive: { color: colors.primary, fontWeight: '700' },
    restoBar: { backgroundColor: colors.surface, maxHeight: 46, borderBottomWidth: 0.5, borderBottomColor: '#eee', flexGrow: 0 },
    restoBtn: { paddingHorizontal: 14, paddingVertical: 12 },
    restoBtnActive: { borderBottomWidth: 2, borderBottomColor: colors.primary },
    restoTxt: { fontSize: 12, color: colors.textMuted },
    restoTxtActive: { color: colors.primary, fontWeight: '600' },
    refTxt: { fontSize: 11, color: colors.textMuted, paddingHorizontal: 14, paddingVertical: 8, fontStyle: 'italic' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
    loadingTxt: { marginTop: 12, color: colors.textMuted },
    emptyIcon: { fontSize: 40, marginBottom: 10 },
    emptyTxt: { fontSize: 16, fontWeight: '600', color: colors.text },
    emptySub: { fontSize: 13, color: colors.textMuted, textAlign: 'center', marginTop: 6 },
    tableHead: {
      flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10,
      backgroundColor: colors.surfaceAlt, borderBottomWidth: 1, borderBottomColor: colors.border,
    },
    thTxt: { fontSize: 11, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase' },
    row: {
      flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8,
      borderBottomWidth: 0.5, borderBottomColor: colors.border, backgroundColor: colors.surface,
    },
    colProduit: { flex: 1, fontSize: 13, color: colors.text, paddingRight: 6 },
    colNum: { width: 64, textAlign: 'center', fontSize: 14 },
    reelTxt: { color: colors.textMuted, fontWeight: '500' },
    input: {
      borderWidth: 1, borderColor: colors.primary, borderRadius: 8, paddingVertical: 6,
      color: colors.text, backgroundColor: colors.bg,
    },
    ecartTxt: { color: colors.textMuted, fontWeight: '600' },
    ecartActif: { color: '#A32D2D', fontWeight: '800' },
    footer: {
      position: 'absolute', left: 0, right: 0, bottom: 0,
      backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border,
      padding: 12, gap: 10,
    },
    recapBox: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    recapTxt: { fontSize: 13, color: colors.text, fontWeight: '500' },
    recapPct: { fontSize: 18, fontWeight: '800', color: colors.textMuted },
    recapPctAlert: { color: '#A32D2D' },
    validerBtn: { backgroundColor: '#3B6D11', borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
    validerTxt: { fontSize: 15, fontWeight: '700', color: '#fff' },
  })
}
