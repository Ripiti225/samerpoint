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
  ActivityIndicator, Alert, Modal, SafeAreaView,
  ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native'
import PhotoJustificatif from '../components/PhotoJustificatif'
import { useApp } from '../context/AppContext'
import { useTheme } from '../context/ThemeContext'
import { journaliser } from '../lib/journal'
import { supabase } from '../lib/supabase'

// Plafond de lignes d'une réponse PostgREST. Au-delà, Supabase tronque en
// silence — cf. le commentaire de `charger()`.
const PAGE_SUPABASE = 1000

// `caissier_nom` posé par une réinjection. Sert à reconnaître nos propres
// lignes : la contrainte unique de la base interdit d'en écrire deux pour le
// même point et le même fournisseur.
const CAISSIER_REINJECTION = 'Réinjecté (manager)'

// Signature d'une entrée : deux montants. Sert à savoir si le brouillon décrit
// EXACTEMENT une transaction déjà enregistrée, ou une version différente.
function cleMontants(facture, paye) {
  return `${parseFloat(facture) || 0}|${parseFloat(paye) || 0}`
}

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
  const [jourSel, setJourSel] = useState(null)        // 'YYYY-MM-DD' — null = tout le mois
  const [fournFilter, setFournFilter] = useState(null)
  const [showRestoPicker, setShowRestoPicker] = useState(false)
  const [showFournPicker, setShowFournPicker] = useState(false)
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const [modalPhotoUri, setModalPhotoUri] = useState(null)
  const [modeSel, setModeSel] = useState(false)          // sélection multiple pour ignorer en lot
  const [selection, setSelection] = useState(() => new Set())
  const [busyLot, setBusyLot] = useState(false)

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
      //
      // ⚠ PAGINER EST OBLIGATOIRE ICI. PostgREST plafonne toute réponse à 1000
      // lignes, sans erreur ni avertissement, et un lot de 200 points porte
      // environ 1950 transactions : la moitié restait invisible. `gcKey` était
      // donc incomplet, des entrées DÉJÀ réinjectées réapparaissaient dans la
      // liste, et les réinjecter butait sur la contrainte
      // `unique_facture_fournisseur_point` (erreur brute à l'écran). Le drapeau
      // « doublon » était faussé de la même façon. Même piège que
      // lib/litigeContacts.js.
      //
      // ⚠ COMPARER LES MONTANTS, PAS SEULEMENT LE COUPLE. Écarter une entrée au
      // seul motif qu'une transaction existe pour ce fournisseur ce jour-là
      // masquait des corrections réelles : au 07/09, 7 entrées avaient des
      // montants DIFFÉRENTS de la ligne enregistrée (Al Kayan Yop, Alassane du
      // 29/07 : le brouillon porte un paiement de 30 000 que la base ignore).
      // On n'écarte donc que ce qui est déjà enregistré À L'IDENTIQUE.
      let montantsGC = new Map(), dejaReinjecte = new Set(), factByPF = {}
      if (pointIds.length > 0) {
        const chunks = []
        for (let i = 0; i < pointIds.length; i += 200) chunks.push(pointIds.slice(i, i + 200))
        for (const c of chunks) {
          for (let debut = 0; ; debut += PAGE_SUPABASE) {
            const { data: txs, error } = await supabase.from('transactions_fournisseurs')
              .select('point_id, fournisseur_id, facture, paye, saisi_par, caissier_nom').in('point_id', c)
              .order('id', { ascending: true })   // ordre stable : sans ça la pagination saute des lignes
              .range(debut, debut + PAGE_SUPABASE - 1)
            if (error || !txs?.length) break
            txs.forEach(t => {
              const k = `${t.point_id}|${t.fournisseur_id}`
              if (t.saisi_par === 'gerant_caissier') {
                if (!montantsGC.has(k)) montantsGC.set(k, new Set())
                montantsGC.get(k).add(cleMontants(t.facture, t.paye))
                // Une réinjection porte toujours le même `caissier_nom`. La
                // contrainte unique de la base interdit donc d'en refaire une
                // seconde sur ce couple, quels que soient les montants : on
                // écarte l'entrée plutôt que de proposer un bouton qui échoue.
                if (t.caissier_nom === CAISSIER_REINJECTION) dejaReinjecte.add(k)
              }
              ;(factByPF[k] ||= new Set()).add(parseFloat(t.facture) || 0)
            })
            if (txs.length < PAGE_SUPABASE) break   // dernière page
          }
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
          // Déjà enregistré À L'IDENTIQUE, ou déjà réinjecté une fois (la base
          // refuserait la seconde). Des montants différents, eux, restent
          // visibles : c'est une correction encore à faire.
          if (montantsGC.get(k)?.has(cleMontants(facture, paye))) continue
          if (dejaReinjecte.has(k)) continue
          raw.push({
            key: k, point_id: p.id, date: p.date, jour: String(p.date).split('T')[0],
            restaurant_id: p.restaurant_id,
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
      // Le fournisseur filtré n'a plus rien en attente ici → on relâche le filtre
      setFournFilter(f => (f && !raw.some(e => e.fournisseur_id === f) ? null : f))
    } catch (err) {
      Alert.alert('Erreur', err?.message || 'Chargement impossible')
    }
    setLoading(false)
  }

  // Regrouper des entrées par point (un seul read/update par point)
  function grouperParPoint(lot) {
    const m = new Map()
    lot.forEach(e => { (m.get(e.point_id) || m.set(e.point_id, []).get(e.point_id)).push(e) })
    return m
  }

  // Retirer une ou plusieurs entrées du même point du draft_gerant
  async function retirerDuBrouillon(lot) {
    const entrees = [].concat(lot)
    const pointId = entrees[0].point_id
    const { data: p } = await supabase.from('points').select('draft_gerant').eq('id', pointId).maybeSingle()
    const draft = p?.draft_gerant || {}
    if (draft.fournisseurs) entrees.forEach(e => { delete draft.fournisseurs[e.fournisseur_id] })
    const { error } = await supabase.from('points').update({ draft_gerant: draft }).eq('id', pointId)
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
        caissier_nom: CAISSIER_REINJECTION,
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
      // La base refuse une seconde transaction pour le même fournisseur sur la
      // même journée : cette facture est donc DÉJÀ enregistrée. Le solde n'a pas
      // été touché, rien n'est à reprendre — on le dit en français et on retire
      // l'entrée de la liste, comme le fait `charger()` pour les réinjectées.
      if (/unique_facture_fournisseur_point|duplicate key value/i.test(err?.message || '')) {
        Alert.alert(
          'Facture déjà enregistrée',
          `${entry.nom} — facture ${fmt(entry.facture)} du ${fmtDate(entry.date)} est déjà enregistrée sur cette journée.\n\n` +
          'Rien n\'a été modifié : le solde du fournisseur reste inchangé. L\'entrée est retirée de la liste.',
        )
        await retirerDuBrouillon(entry).catch(() => {})
        setEntries(prev => prev.filter(e => e.key !== entry.key))
      } else {
        Alert.alert('Erreur', err?.message || 'Réinjection impossible')
      }
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

  function basculerSelection(key) {
    setSelection(prev => {
      const s = new Set(prev)
      if (s.has(key)) s.delete(key); else s.add(key)
      return s
    })
  }

  function quitterSelection() {
    setModeSel(false)
    setSelection(new Set())
  }

  // Ignorer en lot : retire les entrées cochées des brouillons, sans toucher aux soldes
  function confirmerIgnorerLot(lot) {
    const totalFact = lot.reduce((s, e) => s + e.facture, 0)
    Alert.alert(
      `Ignorer ${lot.length} entrée${lot.length > 1 ? 's' : ''} ?`,
      `Total facturé ${fmt(totalFact)}.\n\nElles seront retirées des brouillons sans modifier les soldes fournisseurs. À faire uniquement si elles sont déjà prises en compte dans les crédits fournisseurs.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: `🗑 Ignorer (${lot.length})`, style: 'destructive', onPress: async () => {
            setBusyLot(true)
            const faits = []
            let echecs = 0
            for (const [, entrees] of grouperParPoint(lot)) {
              try {
                await retirerDuBrouillon(entrees)
                faits.push(...entrees)
              } catch { echecs++ }
            }
            faits.forEach(e => {
              journaliser('ignore_brouillon_fournisseur', {
                fournisseur: e.nom, date: e.date, facture: e.facture, paye: e.paye, lot: faits.length,
              }, { restaurantId: e.restaurant_id, userId }).catch(() => {})
            })
            const retirees = new Set(faits.map(e => e.key))
            setEntries(prev => prev.filter(e => !retirees.has(e.key)))
            setBusyLot(false)
            quitterSelection()
            if (echecs > 0) {
              Alert.alert('Partiellement effectué', `${faits.length} entrée(s) retirée(s), ${echecs} journée(s) en erreur. Réessayez pour le reste.`)
            }
          },
        },
      ]
    )
  }

  // Fournisseurs présents dans les brouillons chargés (avec le nombre d'entrées)
  const fournisseursDispo = useMemo(() => {
    const m = new Map()
    entries.forEach(e => {
      const cur = m.get(e.fournisseur_id)
      if (cur) cur.n++
      else m.set(e.fournisseur_id, { id: e.fournisseur_id, nom: e.nom, n: 1 })
    })
    return [...m.values()].sort((a, b) => a.nom.localeCompare(b.nom, 'fr'))
  }, [entries])

  const apresFourn = useMemo(
    () => (fournFilter ? entries.filter(e => e.fournisseur_id === fournFilter) : entries),
    [entries, fournFilter]
  )

  // Jours du mois ayant au moins un brouillon (barre affichée quand un mois est choisi)
  const joursDispo = useMemo(() => {
    const m = new Map()
    apresFourn.forEach(e => m.set(e.jour, (m.get(e.jour) || 0) + 1))
    return [...m.entries()].map(([jour, n]) => ({ jour, n })).sort((a, b) => (a.jour < b.jour ? 1 : -1))
  }, [apresFourn])

  // Le jour choisi n'existe plus dans la sélection courante → retour à « Tout le mois »
  useEffect(() => {
    if (!loading && jourSel && !joursDispo.some(j => j.jour === jourSel)) setJourSel(null)
  }, [loading, jourSel, joursDispo])

  const visibles = useMemo(
    () => (jourSel ? apresFourn.filter(e => e.jour === jourSel) : apresFourn),
    [apresFourn, jourSel]
  )

  // La sélection ne porte que sur ce qui est affiché (changement de filtre → on élague)
  useEffect(() => {
    setSelection(prev => {
      if (prev.size === 0) return prev
      const visiblesKeys = new Set(visibles.map(e => e.key))
      const s = new Set([...prev].filter(k => visiblesKeys.has(k)))
      return s.size === prev.size ? prev : s
    })
  }, [visibles])

  const lotSel = useMemo(() => visibles.filter(e => selection.has(e.key)), [visibles, selection])
  const toutSel = visibles.length > 0 && lotSel.length === visibles.length

  const totalFacture = visibles.reduce((s, e) => s + e.facture, 0)
  const totalPaye = visibles.reduce((s, e) => s + e.paye, 0)
  const nbDoublons = visibles.filter(e => e.doublon).length

  const nomFournFiltre = fournisseursDispo.find(f => f.id === fournFilter)?.nom

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
        {modeSel ? (
          <TouchableOpacity style={{ width: 70, alignItems: 'flex-end' }} onPress={quitterSelection} disabled={busyLot}>
            <Text style={styles.headerAction}>Annuler</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={{ width: 70, alignItems: 'flex-end' }}
            disabled={visibles.length === 0}
            onPress={() => setModeSel(true)}
          >
            <Text style={[styles.headerAction, visibles.length === 0 && { opacity: 0.4 }]}>☑️ Choisir</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Résumé */}
      <View style={styles.kpiRow}>
        <View style={styles.kpiBox}>
          <Text style={styles.kpiLabel}>En attente</Text>
          <Text style={styles.kpiVal}>{visibles.length}</Text>
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

      {/* Filtres restaurant + fournisseur */}
      <View style={styles.selectorRow}>
        <TouchableOpacity style={styles.selector} onPress={() => setShowRestoPicker(true)}>
          <Text style={{ fontSize: 16 }}>🏪</Text>
          <Text style={styles.selectorTxt} numberOfLines={1}>
            {restoFilter ? (restaurants.find(r => r.id === restoFilter)?.nom || 'Restaurant') : 'Tous les restaurants'}
          </Text>
          <Text style={{ fontSize: 12, color: colors.textMuted }}>▾</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.selector, styles.selectorSep, fournisseursDispo.length === 0 && { opacity: 0.4 }]}
          disabled={fournisseursDispo.length === 0}
          onPress={() => setShowFournPicker(true)}
        >
          <Text style={{ fontSize: 16 }}>🚚</Text>
          <Text style={styles.selectorTxt} numberOfLines={1}>
            {nomFournFiltre || 'Tous les fournisseurs'}
          </Text>
          <Text style={{ fontSize: 12, color: colors.textMuted }}>▾</Text>
        </TouchableOpacity>
      </View>

      {/* Filtre mois */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.moisBar} contentContainerStyle={{ paddingHorizontal: 12, gap: 8, alignItems: 'center' }}>
        <TouchableOpacity style={[styles.moisChip, !moisSel && styles.moisChipActive]} onPress={() => { setMoisSel(null); setJourSel(null) }}>
          <Text style={[styles.moisChipTxt, !moisSel && styles.moisChipTxtActive]}>Tous les mois</Text>
        </TouchableOpacity>
        {derniersMois(6).map(mk => (
          <TouchableOpacity key={mk} style={[styles.moisChip, moisSel === mk && styles.moisChipActive]} onPress={() => { setMoisSel(mk); setJourSel(null) }}>
            <Text style={[styles.moisChipTxt, moisSel === mk && styles.moisChipTxtActive]}>{moisLabel(mk)}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Jours du mois choisi — « Tout le mois » par défaut */}
      {moisSel && !loading && joursDispo.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.jourBar} contentContainerStyle={{ paddingHorizontal: 12, gap: 6, alignItems: 'center' }}>
          <TouchableOpacity style={[styles.jourChip, !jourSel && styles.jourChipActive]} onPress={() => setJourSel(null)}>
            <Text style={[styles.jourChipTxt, !jourSel && styles.jourChipTxtActive]}>📅 Tout le mois</Text>
          </TouchableOpacity>
          {joursDispo.map(j => (
            <TouchableOpacity key={j.jour} style={[styles.jourChip, jourSel === j.jour && styles.jourChipActive]} onPress={() => setJourSel(j.jour)}>
              <Text style={[styles.jourChipTxt, jourSel === j.jour && styles.jourChipTxtActive]}>{fmtDate(j.jour)} ({j.n})</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {loading ? (
        <View style={styles.loadingBox}><ActivityIndicator size="large" color="#EF9F27" /></View>
      ) : (
        <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
          {visibles.length === 0 ? (
            <View style={styles.emptySection}>
              <Text style={styles.emptySectionTxt}>✅ Aucun brouillon en attente</Text>
              <Text style={[styles.emptySectionTxt, { fontSize: 11, marginTop: 4 }]}>
                Tout est traité pour ce filtre.
              </Text>
            </View>
          ) : visibles.map(e => {
            const apres = e.creditActuel + (e.facture - e.paye)
            const coche = selection.has(e.key)
            return (
              <TouchableOpacity
                key={e.key}
                activeOpacity={modeSel ? 0.7 : 1}
                disabled={!modeSel || busyLot}
                onPress={() => basculerSelection(e.key)}
                style={[styles.card, e.doublon && styles.cardDoublon, modeSel && coche && styles.cardCoche]}
              >
                <View style={styles.cardTop}>
                  {modeSel && (
                    <View style={[styles.checkbox, coche && styles.checkboxOn]}>
                      {coche && <Text style={styles.checkboxTxt}>✓</Text>}
                    </View>
                  )}
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
                    <PhotoJustificatif uri={e.photoUri} style={styles.photoThumb} compact />
                    <Text style={styles.photoTxt}>📷 Voir la facture</Text>
                  </TouchableOpacity>
                )}

                {!modeSel && (
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
                )}
              </TouchableOpacity>
            )
          })}
          <View style={{ height: modeSel ? 100 : 40 }} />
        </ScrollView>
      )}

      {/* Barre d'action de la sélection multiple */}
      {modeSel && (
        <View style={styles.selBar}>
          <TouchableOpacity
            style={styles.selBtnTout}
            disabled={busyLot || visibles.length === 0}
            onPress={() => setSelection(toutSel ? new Set() : new Set(visibles.map(e => e.key)))}
          >
            <Text style={styles.selBtnToutTxt}>{toutSel ? 'Tout décocher' : `Tout cocher (${visibles.length})`}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.selBtnIgnorer, (lotSel.length === 0 || busyLot) && { opacity: 0.4 }]}
            disabled={lotSel.length === 0 || busyLot}
            onPress={() => confirmerIgnorerLot(lotSel)}
          >
            <Text style={styles.selBtnIgnorerTxt}>{busyLot ? '…' : `🗑 Ignorer (${lotSel.length})`}</Text>
          </TouchableOpacity>
        </View>
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

      {/* Picker fournisseur */}
      <Modal visible={showFournPicker} transparent animationType="fade">
        <TouchableOpacity style={styles.pickerOverlay} activeOpacity={1} onPress={() => setShowFournPicker(false)}>
          <TouchableOpacity activeOpacity={1} style={styles.pickerBox} onPress={() => {}}>
            <Text style={styles.pickerTitre}>Filtrer par fournisseur</Text>
            <ScrollView>
              <TouchableOpacity style={styles.pickerRow} onPress={() => { setFournFilter(null); setShowFournPicker(false) }}>
                <Text style={styles.pickerRowTxt}>🚚 Tous les fournisseurs</Text>
              </TouchableOpacity>
              {fournisseursDispo.map(f => (
                <TouchableOpacity key={f.id} style={styles.pickerRow} onPress={() => { setFournFilter(f.id); setShowFournPicker(false) }}>
                  <Text style={styles.pickerRowTxt} numberOfLines={1}>{f.nom} ({f.n})</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Photo plein écran */}
      <Modal visible={!!modalPhotoUri} transparent animationType="fade">
        <TouchableOpacity style={styles.photoOverlay} activeOpacity={1} onPress={() => setModalPhotoUri(null)}>
          <PhotoJustificatif uri={modalPhotoUri} style={styles.photoFull} resizeMode="contain" />
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
  headerAction: { fontSize: 13, color: '#EF9F27', fontWeight: '700' },
  kpiRow: { flexDirection: 'row', backgroundColor: colors.surface, padding: 14, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  kpiBox: { flex: 1, alignItems: 'center' },
  kpiLabel: { fontSize: 10, color: colors.textMuted, marginBottom: 2 },
  kpiVal: { fontSize: 14, fontWeight: '800', color: colors.text },
  selectorRow: { flexDirection: 'row', backgroundColor: colors.surface, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  selector: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 11 },
  selectorSep: { borderLeftWidth: 0.5, borderLeftColor: colors.border },
  selectorTxt: { flex: 1, fontSize: 12, fontWeight: '600', color: colors.text },
  jourBar: { flexGrow: 0, backgroundColor: colors.bg, borderBottomWidth: 0.5, borderBottomColor: colors.border, paddingVertical: 7 },
  jourChip: { paddingHorizontal: 11, paddingVertical: 5, borderRadius: 16, borderWidth: 0.5, borderColor: colors.border, backgroundColor: colors.surface },
  jourChipActive: { backgroundColor: colors.text, borderColor: colors.text },
  jourChipTxt: { fontSize: 11, fontWeight: '600', color: colors.textMuted },
  jourChipTxtActive: { color: colors.surface, fontWeight: '800' },
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
  cardCoche: { borderColor: '#EF9F27', borderWidth: 1.5 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: colors.border, marginRight: 10, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: '#EF9F27', borderColor: '#EF9F27' },
  checkboxTxt: { fontSize: 13, fontWeight: '900', color: '#412402' },
  selBar: { flexDirection: 'row', gap: 10, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 18, backgroundColor: colors.surface, borderTopWidth: 0.5, borderTopColor: colors.border },
  selBtnTout: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  selBtnToutTxt: { fontSize: 13, fontWeight: '700', color: colors.text },
  selBtnIgnorer: { flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: '#C62828', alignItems: 'center', justifyContent: 'center' },
  selBtnIgnorerTxt: { fontSize: 13, fontWeight: '800', color: '#FFF' },
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
