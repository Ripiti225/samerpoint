/*
 * Brouillons fournisseurs — réconciliation manuelle des déductions gérant
 * restées en brouillon (draft_gerant) et jamais enregistrées comme transaction.
 *
 * Pour chaque entrée le manager décide :
 *   • Réinjecter → crée la transaction + credit_actuel += (facture − payé)
 *   • Ignorer    → retire l'entrée du brouillon (déjà prise en compte ailleurs)
 *
 * Aides à la décision : drapeau « facture déjà enregistrée » (doublon probable)
 * et aperçu du solde avant → après réinjection.
 */
import { router } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator, Alert, Image, Modal, SafeAreaView,
  ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native'
import { useApp } from '../context/AppContext'
import { useTheme } from '../context/ThemeContext'
import { journaliser } from '../lib/journal'
import { supabase } from '../lib/supabase'

function fmt(n) { return Math.round(n || 0).toLocaleString('fr-FR') + ' FCFA' }
function fmtDate(d) {
  if (!d) return ''
  const [, mm, dd] = d.split('T')[0].split('-')
  const mois = ['jan', 'fév', 'mar', 'avr', 'mai', 'juin', 'jul', 'aoû', 'sep', 'oct', 'nov', 'déc']
  return `${parseInt(dd)} ${mois[parseInt(mm) - 1]}`
}
function moisLabel(key) {
  const [y, m] = key.split('-').map(Number)
  const noms = ['janv', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc']
  return `${noms[m - 1]} ${y}`
}
function derniersMois(n) {
  const arr = []; const d = new Date()
  for (let i = 0; i < n; i++) { arr.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); d.setMonth(d.getMonth() - 1) }
  return arr
}

export default function BrouillonsFournisseursScreen() {
  const { roleActif, userId } = useApp()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const peutModifier = roleActif === 'manager' || roleActif === 'directeur'

  const [restaurants, setRestaurants] = useState([])
  const [restoFilter, setRestoFilter] = useState(null)
  const [moisSel, setMoisSel] = useState(null)
  const [showRestoPicker, setShowRestoPicker] = useState(false)
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const [modalPhotoUri, setModalPhotoUri] = useState(null)

  useEffect(() => {
    if (!peutModifier) router.replace('/accueil')
  }, [peutModifier])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { charger() }, [restoFilter, moisSel])

  async function charger() {
    setLoading(true)
    try {
      const { data: restos } = await supabase.from('restaurants').select('id, nom').order('nom')
      setRestaurants(restos || [])
      const restoNom = Object.fromEntries((restos || []).map(r => [r.id, r.nom]))

      // Points avec brouillon (filtrés)
      let pQ = supabase.from('points').select('id, date, restaurant_id, draft_gerant').not('draft_gerant', 'is', null)
      if (restoFilter) pQ = pQ.eq('restaurant_id', restoFilter)
      if (moisSel) {
        const [y, m] = moisSel.split('-').map(Number)
        const finExcl = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
        pQ = pQ.gte('date', `${moisSel}-01`).lt('date', finExcl)
      }
      const { data: points } = await pQ
      const pts = points || []
      const pointIds = pts.map(p => p.id)

      // Transactions sur ces points : détecter déjà-réinjecté (gerant_caissier) + doublons de facture
      let gcKey = new Set(), factByPF = {}
      if (pointIds.length > 0) {
        const chunks = []
        for (let i = 0; i < pointIds.length; i += 200) chunks.push(pointIds.slice(i, i + 200))
        for (const c of chunks) {
          const { data: txs } = await supabase.from('transactions_fournisseurs')
            .select('point_id, fournisseur_id, facture, saisi_par').in('point_id', c)
          ;(txs || []).forEach(t => {
            if (t.saisi_par === 'gerant_caissier') gcKey.add(`${t.point_id}|${t.fournisseur_id}`)
            const k = `${t.point_id}|${t.fournisseur_id}`
            ;(factByPF[k] ||= new Set()).add(parseFloat(t.facture) || 0)
          })
        }
      }

      // Construire les entrées brouillon en attente
      const raw = []
      for (const p of pts) {
        const f = p.draft_gerant?.fournisseurs
        if (!f) continue
        for (const [fid, d] of Object.entries(f)) {
          const facture = parseFloat(d?.montant_facture) || 0
          const paye = parseFloat(d?.paye) || 0
          if (facture === 0 && paye === 0) continue
          const k = `${p.id}|${fid}`
          if (gcKey.has(k)) continue // déjà réinjecté
          raw.push({
            key: k, point_id: p.id, date: p.date, restaurant_id: p.restaurant_id,
            restaurant_nom: restoNom[p.restaurant_id] || '', fournisseur_id: fid,
            nom: d?.nom || 'Fournisseur', facture, paye,
            credit_veille: parseFloat(d?.credit_veille) || 0, photoUri: d?.photoUri || null,
            doublon: facture > 0 && !!factByPF[k]?.has(facture),
          })
        }
      }

      // Soldes actuels des fournisseurs concernés
      const fids = [...new Set(raw.map(e => e.fournisseur_id))]
      const soldes = {}
      if (fids.length > 0) {
        for (let i = 0; i < fids.length; i += 200) {
          const { data: fs } = await supabase.from('fournisseurs')
            .select('id, credit_actuel').in('id', fids.slice(i, i + 200))
          ;(fs || []).forEach(f => { soldes[f.id] = f.credit_actuel || 0 })
        }
      }
      raw.forEach(e => { e.creditActuel = soldes[e.fournisseur_id] || 0 })
      raw.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
      setEntries(raw)
    } catch (err) {
      Alert.alert('Erreur', err?.message || 'Chargement impossible')
    }
    setLoading(false)
  }

  // Retirer une entrée du draft_gerant du point
  async function retirerDuBrouillon(entry) {
    const { data: p } = await supabase.from('points').select('draft_gerant').eq('id', entry.point_id).maybeSingle()
    const draft = p?.draft_gerant || {}
    if (draft.fournisseurs) delete draft.fournisseurs[entry.fournisseur_id]
    const { error } = await supabase.from('points').update({ draft_gerant: draft }).eq('id', entry.point_id)
    if (error) throw error
  }

  async function reinjecter(entry) {
    setBusyId(entry.key)
    try {
      // Solde frais (éviter d'écraser une modif entre-temps)
      const { data: f } = await supabase.from('fournisseurs').select('credit_actuel').eq('id', entry.fournisseur_id).maybeSingle()
      const current = f?.credit_actuel || 0
      const nouveau = current + (entry.facture - entry.paye)

      const { error: txErr } = await supabase.from('transactions_fournisseurs').insert({
        point_id: entry.point_id,
        fournisseur_id: entry.fournisseur_id,
        fournisseur_nom: entry.nom,
        source: 'deduction_gerant',
        restaurant_id: entry.restaurant_id,
        facture: entry.facture,
        paye: entry.paye,
        reste: nouveau,
        saisi_par: 'gerant_caissier',
        caissier_nom: 'Réinjecté (manager)',
        photo_url: entry.photoUri || null,
      })
      if (txErr) throw txErr

      const { error: updErr } = await supabase.from('fournisseurs').update({ credit_actuel: nouveau }).eq('id', entry.fournisseur_id)
      if (updErr) throw updErr

      await retirerDuBrouillon(entry)
      journaliser('reinjection_brouillon_fournisseur', {
        fournisseur: entry.nom, date: entry.date, facture: entry.facture, paye: entry.paye,
        ancien: current, nouveau,
      }, { restaurantId: entry.restaurant_id, userId }).catch(() => {})

      setEntries(prev => prev.filter(e => e.key !== entry.key))
    } catch (err) {
      Alert.alert('Erreur', err?.message || 'Réinjection impossible')
    }
    setBusyId(null)
  }

  function confirmerIgnorer(entry) {
    Alert.alert(
      'Ignorer cette entrée ?',
      `${entry.nom} — facture ${fmt(entry.facture)}, payé ${fmt(entry.paye)} du ${fmtDate(entry.date)}.\n\nElle sera retirée du brouillon sans modifier le solde. À faire si elle est déjà prise en compte dans les crédits fournisseurs.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: '🗑 Ignorer', style: 'destructive', onPress: async () => {
            setBusyId(entry.key)
            try {
              await retirerDuBrouillon(entry)
              journaliser('ignore_brouillon_fournisseur', {
                fournisseur: entry.nom, date: entry.date, facture: entry.facture, paye: entry.paye,
              }, { restaurantId: entry.restaurant_id, userId }).catch(() => {})
              setEntries(prev => prev.filter(e => e.key !== entry.key))
            } catch (err) {
              Alert.alert('Erreur', err?.message || 'Impossible de retirer')
            }
            setBusyId(null)
          },
        },
      ]
    )
  }

  const totalFacture = entries.reduce((s, e) => s + e.facture, 0)
  const totalPaye = entries.reduce((s, e) => s + e.paye, 0)
  const nbDoublons = entries.filter(e => e.doublon).length

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.canGoBack() ? router.back() : router.replace('/accueil')}>
          <Text style={styles.back}>‹ Retour</Text>
        </TouchableOpacity>
        <View style={{ alignItems: 'center' }}>
          <Text style={styles.headerTitre}>🗂 Brouillons fournisseurs</Text>
          <Text style={styles.headerSub}>Déductions en attente de décision</Text>
        </View>
        <View style={{ width: 70 }} />
      </View>

      {/* Résumé */}
      <View style={styles.kpiRow}>
        <View style={styles.kpiBox}>
          <Text style={styles.kpiLabel}>En attente</Text>
          <Text style={styles.kpiVal}>{entries.length}</Text>
        </View>
        <View style={[styles.kpiBox, { borderLeftWidth: 0.5, borderLeftColor: colors.border }]}>
          <Text style={styles.kpiLabel}>Factures</Text>
          <Text style={[styles.kpiVal, { color: '#A32D2D' }]}>{fmt(totalFacture)}</Text>
        </View>
        <View style={[styles.kpiBox, { borderLeftWidth: 0.5, borderLeftColor: colors.border }]}>
          <Text style={styles.kpiLabel}>Payé</Text>
          <Text style={[styles.kpiVal, { color: '#3B6D11' }]}>{fmt(totalPaye)}</Text>
        </View>
        <View style={[styles.kpiBox, { borderLeftWidth: 0.5, borderLeftColor: colors.border }]}>
          <Text style={styles.kpiLabel}>⚠️ Doublons</Text>
          <Text style={[styles.kpiVal, { color: '#B8860B' }]}>{nbDoublons}</Text>
        </View>
      </View>

      {/* Filtre restaurant */}
      <TouchableOpacity style={styles.restoSelector} onPress={() => setShowRestoPicker(true)}>
        <Text style={{ fontSize: 16 }}>🏪</Text>
        <Text style={styles.restoSelectorTxt} numberOfLines={1}>
          {restoFilter ? (restaurants.find(r => r.id === restoFilter)?.nom || 'Restaurant') : 'Tous les restaurants'}
        </Text>
        <Text style={{ fontSize: 12, color: colors.textMuted }}>▾</Text>
      </TouchableOpacity>

      {/* Filtre mois */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.moisBar} contentContainerStyle={{ paddingHorizontal: 12, gap: 8, alignItems: 'center' }}>
        <TouchableOpacity style={[styles.moisChip, !moisSel && styles.moisChipActive]} onPress={() => setMoisSel(null)}>
          <Text style={[styles.moisChipTxt, !moisSel && styles.moisChipTxtActive]}>Tous les mois</Text>
        </TouchableOpacity>
        {derniersMois(6).map(mk => (
          <TouchableOpacity key={mk} style={[styles.moisChip, moisSel === mk && styles.moisChipActive]} onPress={() => setMoisSel(mk)}>
            <Text style={[styles.moisChipTxt, moisSel === mk && styles.moisChipTxtActive]}>{moisLabel(mk)}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {loading ? (
        <View style={styles.loadingBox}><ActivityIndicator size="large" color="#EF9F27" /></View>
      ) : (
        <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
          {entries.length === 0 ? (
            <View style={styles.emptySection}>
              <Text style={styles.emptySectionTxt}>✅ Aucun brouillon en attente</Text>
              <Text style={[styles.emptySectionTxt, { fontSize: 11, marginTop: 4 }]}>
                Tout est traité pour ce filtre.
              </Text>
            </View>
          ) : entries.map(e => {
            const apres = e.creditActuel + (e.facture - e.paye)
            return (
              <View key={e.key} style={[styles.card, e.doublon && styles.cardDoublon]}>
                <View style={styles.cardTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardNom} numberOfLines={1}>{e.nom}</Text>
                    <Text style={styles.cardMeta}>{fmtDate(e.date)} · {e.restaurant_nom}</Text>
                  </View>
                  {e.doublon && (
                    <View style={styles.doublonBadge}>
                      <Text style={styles.doublonBadgeTxt}>⚠️ Déjà enregistrée ?</Text>
                    </View>
                  )}
                </View>

                <View style={styles.chiffres}>
                  <View style={styles.chiffre}>
                    <Text style={styles.chiffreLabel}>📦 Facture</Text>
                    <Text style={[styles.chiffreVal, { color: colors.text }]}>{e.facture ? fmt(e.facture) : '—'}</Text>
                  </View>
                  <View style={styles.chiffre}>
                    <Text style={styles.chiffreLabel}>💳 Payé</Text>
                    <Text style={[styles.chiffreVal, { color: '#3B6D11' }]}>{e.paye ? fmt(e.paye) : '—'}</Text>
                  </View>
                </View>

                <Text style={styles.apercu}>
                  Solde : {fmt(e.creditActuel)} → <Text style={{ fontWeight: '800', color: apres >= 0 ? '#A32D2D' : '#3B6D11' }}>{fmt(apres)}</Text> si réinjecté
                </Text>

                {e.photoUri && (
                  <TouchableOpacity style={styles.photoRow} onPress={() => setModalPhotoUri(e.photoUri)}>
                    <Image source={{ uri: e.photoUri }} style={styles.photoThumb} resizeMode="cover" />
                    <Text style={styles.photoTxt}>📷 Voir la facture</Text>
                  </TouchableOpacity>
                )}

                <View style={styles.actions}>
                  <TouchableOpacity
                    style={[styles.btnIgnorer, busyId === e.key && { opacity: 0.5 }]}
                    disabled={busyId === e.key}
                    onPress={() => confirmerIgnorer(e)}
                  >
                    <Text style={styles.btnIgnorerTxt}>🗑 Ignorer</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.btnReinjecter, busyId === e.key && { opacity: 0.5 }]}
                    disabled={busyId === e.key}
                    onPress={() => reinjecter(e)}
                  >
                    <Text style={styles.btnReinjecterTxt}>{busyId === e.key ? '…' : '↩️ Réinjecter'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )
          })}
          <View style={{ height: 40 }} />
        </ScrollView>
      )}

      {/* Picker restaurant */}
      <Modal visible={showRestoPicker} transparent animationType="fade">
        <TouchableOpacity style={styles.pickerOverlay} activeOpacity={1} onPress={() => setShowRestoPicker(false)}>
          <TouchableOpacity activeOpacity={1} style={styles.pickerBox} onPress={() => {}}>
            <Text style={styles.pickerTitre}>Filtrer par restaurant</Text>
            <TouchableOpacity style={styles.pickerRow} onPress={() => { setRestoFilter(null); setShowRestoPicker(false) }}>
              <Text style={styles.pickerRowTxt}>🏪 Tous les restaurants</Text>
            </TouchableOpacity>
            {restaurants.map(r => (
              <TouchableOpacity key={r.id} style={styles.pickerRow} onPress={() => { setRestoFilter(r.id); setShowRestoPicker(false) }}>
                <Text style={styles.pickerRowTxt} numberOfLines={1}>{r.nom}</Text>
              </TouchableOpacity>
            ))}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Photo plein écran */}
      <Modal visible={!!modalPhotoUri} transparent animationType="fade">
        <TouchableOpacity style={styles.photoOverlay} activeOpacity={1} onPress={() => setModalPhotoUri(null)}>
          <Image source={{ uri: modalPhotoUri }} style={styles.photoFull} resizeMode="contain" />
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  )
}

const makeStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12, backgroundColor: colors.surface, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  back: { fontSize: 15, color: '#EF9F27', fontWeight: '600', width: 70 },
  headerTitre: { fontSize: 15, fontWeight: '800', color: colors.text },
  headerSub: { fontSize: 10, color: colors.textMuted, marginTop: 1 },
  kpiRow: { flexDirection: 'row', backgroundColor: colors.surface, padding: 14, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  kpiBox: { flex: 1, alignItems: 'center' },
  kpiLabel: { fontSize: 10, color: colors.textMuted, marginBottom: 2 },
  kpiVal: { fontSize: 14, fontWeight: '800', color: colors.text },
  restoSelector: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surface, paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  restoSelectorTxt: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.text },
  moisBar: { flexGrow: 0, backgroundColor: colors.surface, borderBottomWidth: 0.5, borderBottomColor: colors.border, paddingVertical: 8 },
  moisChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 0.5, borderColor: colors.border, backgroundColor: colors.bg },
  moisChipActive: { backgroundColor: '#EF9F27', borderColor: '#EF9F27' },
  moisChipTxt: { fontSize: 12, fontWeight: '600', color: colors.textMuted },
  moisChipTxtActive: { color: '#412402', fontWeight: '800' },
  body: { flex: 1, paddingHorizontal: 12, paddingTop: 12 },
  loadingBox: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptySection: { padding: 30, alignItems: 'center' },
  emptySectionTxt: { fontSize: 13, color: colors.textMuted, textAlign: 'center' },
  card: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 0.5, borderColor: colors.border },
  cardDoublon: { borderColor: '#E0B84C', borderWidth: 1, backgroundColor: colors.bg },
  cardTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  cardNom: { fontSize: 15, fontWeight: '700', color: colors.text },
  cardMeta: { fontSize: 11, color: colors.textMuted, marginTop: 1 },
  doublonBadge: { backgroundColor: '#FBF0D3', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  doublonBadgeTxt: { fontSize: 10, fontWeight: '700', color: '#8A6300' },
  chiffres: { flexDirection: 'row', gap: 24, marginBottom: 8 },
  chiffre: {},
  chiffreLabel: { fontSize: 10, color: colors.textMuted },
  chiffreVal: { fontSize: 15, fontWeight: '700' },
  apercu: { fontSize: 12, color: colors.textMuted, marginBottom: 8 },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  photoThumb: { width: 34, height: 34, borderRadius: 6, backgroundColor: colors.border },
  photoTxt: { fontSize: 12, color: '#EF9F27', fontWeight: '600' },
  actions: { flexDirection: 'row', gap: 10 },
  btnIgnorer: { flex: 1, paddingVertical: 11, borderRadius: 10, borderWidth: 1, borderColor: '#E57373', backgroundColor: '#FFF5F5', alignItems: 'center' },
  btnIgnorerTxt: { fontSize: 13, fontWeight: '700', color: '#C62828' },
  btnReinjecter: { flex: 1, paddingVertical: 11, borderRadius: 10, backgroundColor: '#EF9F27', alignItems: 'center' },
  btnReinjecterTxt: { fontSize: 13, fontWeight: '800', color: '#412402' },
  pickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', paddingHorizontal: 30 },
  pickerBox: { backgroundColor: colors.surface, borderRadius: 16, padding: 16, maxHeight: '70%' },
  pickerTitre: { fontSize: 15, fontWeight: '800', color: colors.text, marginBottom: 10, textAlign: 'center' },
  pickerRow: { paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  pickerRowTxt: { fontSize: 14, color: colors.text },
  photoOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', alignItems: 'center' },
  photoFull: { width: '100%', height: '80%' },
})
