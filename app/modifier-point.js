import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState, useMemo, useRef } from 'react'
import {
    ActivityIndicator,
    Alert,
    Modal,
    SafeAreaView, ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native'
import { CalendrierFr } from '../components/ChampDate'
import { supabase } from '../lib/supabase'
import { journaliser } from '../lib/journal'
import { archiverSuppressionShift, supprimerLignesArchivees } from '../lib/corbeille'
import { majPointsDeplacement } from '../lib/deplacementShift'
import { majPointsApresShifts, majReportFond } from '../lib/recalculPointValide'
import { useApp } from '../context/AppContext'
import { useTheme } from '../context/ThemeContext'
import { useFocusRecherche } from '../lib/useFocusRecherche'
import { estJourneeImportee } from '../lib/importSheets'

const ONGLETS = ['Résumé', 'Shifts', 'Ventes', 'Dépenses', 'Fournisseurs', 'Présences', 'Dép. Gérant']
const CATS_DEPENSES = ['Marché', 'Légumes', 'Fruits', 'Dépenses annexes']

// Champs du formulaire « Ventes » lus depuis la ligne `points`. Relu après
// chaque correction d'un point validé : un formulaire resté sur les anciens
// chiffres réécrirait l'ancien fond au prochain « Enregistrer ».
function formDepuisPoint(p) {
  const champs = ['vente_total', 'depense_total', 'kdo', 'points_fidelite', 'retour', 'yango_cse', 'yango_tab', 'glovo_cse',
    'glovo_tab', 'wave', 'om', 'djamo', 'fc_veille', 'fond_recu']
  return Object.fromEntries(champs.map(c => [c, String(p?.[c] || '')]))
}

export default function ModifierPointScreen() {
  const { userId, userNom } = useApp()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const [etape, setEtape] = useState(1)
  const [restaurants, setRestaurants] = useState([])
  const [selectedResto, setSelectedResto] = useState(null)
  const [selectedDate, setSelectedDate] = useState('')
  const [point, setPoint] = useState(null)
  const [loading, setLoading] = useState(false)
  const [datesAvec, setDatesAvec] = useState({})
  const [ongletActif, setOngletActif] = useState('Résumé')
  const [form, setForm] = useState({})
  const [depenses, setDepenses] = useState([])
  const [presences, setPresences] = useState([])
  const [transactions, setTransactions] = useState([])
  const [transactionsRaw, setTransactionsRaw] = useState([])
  const [shifts, setShifts] = useState([])
  // Fournisseurs du restaurant pour ajout
  const [fournisseursList, setFournisseursList] = useState([])
  const [showAddFour, setShowAddFour] = useState(false)
  const [newFourId, setNewFourId] = useState(null)
  const [newFourFact, setNewFourFact] = useState('')
  const [newFourPaye, setNewFourPaye] = useState('')
  // Nouvelle dépense
  const [showAddDep, setShowAddDep] = useState(false)
  const [newDepCat, setNewDepCat] = useState('Marché')
  const [newDepLib, setNewDepLib] = useState('')
  const [newDepMontant, setNewDepMontant] = useState('')
  // Suppression shifts
  const [modeSelShifts, setModeSelShifts] = useState(false)
  const [shiftsSelectionnes, setShiftsSelectionnes] = useState(new Set())
  const [suppressionEnCours, setSuppressionEnCours] = useState(false)
  const [confirmSupprShift, setConfirmSupprShift] = useState(null)
  const [confirmSupprMultiple, setConfirmSupprMultiple] = useState(false)
  // Édition inline des shifts
  const [shiftEdits, setShiftEdits] = useState({})
  // Suppression dépenses / transactions
  const [confirmSupprDep, setConfirmSupprDep] = useState(null)
  const [confirmSupprTrans, setConfirmSupprTrans] = useState(null)
  const [confirmSauvegarder, setConfirmSauvegarder] = useState(null) // { naviguer: bool }
  // Toast recalcul
  const [recalcMsg, setRecalcMsg] = useState(null)
  const recalcTimerRef = useRef(null)
  // Ajout 1 — détails dep/fourn par shift (edit inline)
  const [shiftDetails, setShiftDetails] = useState({})
  // Ajout 2 — onglet Dép. Gérant
  const [depGerant, setDepGerant] = useState([])
  const [fournGerant, setFournGerant] = useState([])
  // Paiements tels que lus en base : la correction du point se fait sur l'écart.
  const [fournGerantCharge, setFournGerantCharge] = useState([])
  const [loadingGerant, setLoadingGerant] = useState(false)
  const [subGerant, setSubGerant] = useState('A')
  // Déplacement de shift
  const [showMoveShift, setShowMoveShift] = useState(null)
  const [moveDateCible, setMoveDateCible] = useState('')
  const [deplacement, setDeplacement] = useState(false)

  // Ouvert depuis la recherche globale : restaurant + date + onglet + ligne.
  const params = useLocalSearchParams()
  const focus = useFocusRecherche(params.focus)
  const depuisRecherche = useRef(false)

  useEffect(() => { chargerRestaurants() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function chargerRestaurants() {
    const { data } = await supabase.from('restaurants').select('id, nom, couleur, photo_url, localisation').order('nom')
    setRestaurants(data || [])
    const resto = (data || []).find(r => r.id === params.restaurant_id)
    if (resto && typeof params.date === 'string') {
      depuisRecherche.current = true
      setSelectedResto(resto)
      setSelectedDate(params.date)
      chargerDatesAvec(resto.id)
      if (ONGLETS.includes(params.onglet)) setOngletActif(params.onglet)
      await chargerPoint(resto.id, params.date)
    }
  }

  // L'onglet Dép. Gérant charge ses données au toucher : on le fait ici quand
  // il est ouvert directement par la recherche.
  useEffect(() => {
    if (!depuisRecherche.current || !point || ongletActif !== 'Dép. Gérant') return
    depuisRecherche.current = false
    const gs = shifts.find(sh => sh.caissier_id === point?.gerant_id)
    if (gs && !shiftDetails[gs.id]) chargerDetailShift(gs)
    chargerDepGerant()
  }, [point, ongletActif]) // eslint-disable-line react-hooks/exhaustive-deps

  async function chargerDatesAvec(restoId) {
    const { data } = await supabase
      .from('points').select('date, valide')
      .eq('restaurant_id', restoId)
    const marked = {}
    ;(data || []).forEach(p => {
      marked[p.date] = {
        marked: true,
        dotColor: p.valide ? '#3B6D11' : '#EF9F27',
      }
    })
    setDatesAvec(marked)
  }

  async function chargerPoint(restoId, date) {
    setLoading(true)
    const { data: pointData } = await supabase
      .from('points').select('*')
      .eq('restaurant_id', restoId)
      .eq('date', date)
      .single()

    if (!pointData) {
      Alert.alert('Aucun point', 'Aucun point trouvé pour cette date.')
      setLoading(false)
      return
    }

    setPoint(pointData)
    setForm(formDepuisPoint(pointData))

    // Charger dépenses
    const { data: dep } = await supabase
      .from('depenses').select('*').eq('point_id', pointData.id)
    setDepenses(dep || [])

    // Charger shifts
    const { data: sh } = await supabase
      .from('points_shifts').select('*').eq('point_id', pointData.id).order('created_at')
    setShifts(sh || [])

    // Charger présences
    const { data: pres } = await supabase
      .from('presences').select('*').eq('point_id', pointData.id)
    setPresences(pres || [])

    // Charger transactions fournisseurs — dédupliquer par fournisseur_id
    // (gérant et caissier peuvent avoir chacun sauvegardé le même fournisseur)
    const { data: trans } = await supabase
      .from('transactions_fournisseurs').select('*, fournisseurs(nom)').eq('point_id', pointData.id)
    const priorite = { gerant: 3, caissier: 2 }
    const transDedup = Object.values(
      (trans || []).reduce((acc, t) => {
        const id = t.fournisseur_id
        const existing = acc[id]
        if (!existing || (priorite[t.saisi_par] || 1) >= (priorite[existing.saisi_par] || 1)) {
          acc[id] = t
        }
        return acc
      }, {})
    )
    setTransactionsRaw(trans || [])
    setTransactions(transDedup)

    // Charger liste fournisseurs du restaurant
    const { data: fourn } = await supabase
      .from('fournisseurs').select('id, nom').eq('restaurant_id', restoId).eq('actif', true).order('nom')
    setFournisseursList(fourn || [])
    setNewFourId(null)

    setEtape(3)
    setLoading(false)
  }

  function afficherToast(msg) {
    if (recalcTimerRef.current) clearTimeout(recalcTimerRef.current)
    setRecalcMsg(msg)
    recalcTimerRef.current = setTimeout(() => setRecalcMsg(null), 4500)
  }

  function calculerVenteShift(s, paies = 0) {
    return (parseFloat(s.espece) || 0)
      + (parseFloat(s.wave) || 0)
      + (parseFloat(s.om) || 0)
      + (parseFloat(s.djamo) || 0)
      + (parseFloat(s.yango_cse) || 0)
      + (parseFloat(s.glovo_cse) || 0)
      + (parseFloat(s.kdo) || 0)
      // Achats payés en points au POS : dans la vente, comme le KDO.
      + (parseFloat(s.points_fidelite) || 0)
      + (parseFloat(s.retour) || 0)
      + (parseFloat(s.depenses) || 0)
      + (parseFloat(s.fournisseurs) || 0)
      + paies
  }

  function paiesShift(shift) {
    return presences
      .filter(p => shift.caissier_id ? p.caissier_id === shift.caissier_id : p.caissier_nom === shift.caissier_nom)
      .reduce((sum, p) => sum + (p.paye || 0), 0)
  }

  async function recalculerVenteTotalePoint(pointId) {
    const { data: allShifts } = await supabase
      .from('points_shifts').select('vente_shift').eq('point_id', pointId)
    const total = (allShifts || []).reduce((sum, s) => sum + (s.vente_shift || 0), 0)
    await supabase.from('points').update({ vente_total: total }).eq('id', pointId)
    return total
  }

  async function rechargerShiftsEtTotal(pointId) {
    const { data: sh } = await supabase
      .from('points_shifts').select('*').eq('point_id', pointId).order('created_at')
    setShifts(sh || [])
    const total = (sh || []).reduce((sum, s) => sum + (s.vente_shift || 0), 0)
    await supabase.from('points').update({ vente_total: total }).eq('id', pointId)
    setForm(p => ({ ...p, vente_total: String(total) }))
    return { total, shifts: sh || [] }
  }

  // ── Point déjà validé : les espèces, le bénéfice et le fond suivent ─────
  // (lib/recalculPointValide.js). Sans ça, seule la vente bougeait.
  async function pointsDepuis(date) {
    const { data, error } = await supabase.from('points')
      .select('id, date, valide, depense_total, kdo, points_fidelite, retour, yango_cse, glovo_cse, wave, om, djamo, fc_veille, reste_especes, reste_fc, benefice_sc')
      .eq('restaurant_id', selectedResto.id)
      .gte('date', date)
    if (error) throw error
    return data || []
  }

  async function ecrireMajs(majs) {
    for (const { id, maj } of majs) {
      const { error } = await supabase.from('points').update(maj).eq('id', id)
      if (error) throw error
    }
  }

  // changements : [{ avant, apres }] — lignes points_shifts complètes,
  // avant = null pour un shift ajouté, apres = null pour un shift supprimé.
  async function corrigerPointValideApresShifts(changements) {
    if (!point?.valide) return
    const points = await pointsDepuis(point.date)
    await ecrireMajs(majPointsApresShifts({ pointId: point.id, changements, points }))
  }

  async function reporterFondPointValide(delta) {
    if (!point?.valide || !delta) return
    const points = await pointsDepuis(point.date)
    await ecrireMajs(majReportFond({ pointId: point.id, delta, points }))
  }

  // Relit le point après correction, pour que le formulaire n'écrase pas les
  // nouveaux chiffres avec les anciens.
  async function rafraichirPoint() {
    const { data } = await supabase.from('points').select('*').eq('id', point.id).single()
    if (!data) return
    setPoint(data)
    setForm(formDepuisPoint(data))
  }

  async function chargerDetailShift(shift) {
    if (!shift.caissier_nom) {
      setShiftDetails(prev => ({ ...prev, [shift.id]: { depenses: [], fournisseurs: [], loading: false } }))
      return
    }
    setShiftDetails(prev => ({ ...prev, [shift.id]: { depenses: [], fournisseurs: [], loading: true } }))
    const [{ data: deps }, { data: fourns }] = await Promise.all([
      supabase.from('depenses').select('*').eq('point_id', point.id).eq('caissier_nom', shift.caissier_nom).eq('saisi_par', 'caissier'),
      supabase.from('transactions_fournisseurs').select('*, fournisseurs(nom)').eq('point_id', point.id).eq('saisi_par', 'caissier').eq('caissier_nom', shift.caissier_nom),
    ])
    setShiftDetails(prev => ({ ...prev, [shift.id]: { depenses: deps || [], fournisseurs: fourns || [], loading: false } }))
  }

  async function chargerDepGerant() {
    if (!point) return
    setLoadingGerant(true)
    try {
      const { data: pt } = await supabase.from('points').select('draft_gerant').eq('id', point.id).single()
      const draft = pt?.draft_gerant || {}
      const draftDeps = draft.depenses || {}
      const flat = []
      Object.entries(draftDeps).forEach(([cat, items]) => {
        if (Array.isArray(items)) items.forEach(item => flat.push({ categorie: cat, libelle: item.libelle || '', montant: item.montant || 0 }))
      })
      setDepGerant(flat)
      const { data: fourns } = await supabase.from('transactions_fournisseurs')
        .select('*, fournisseurs(nom)').eq('point_id', point.id).eq('saisi_par', 'gerant_caissier')
      setFournGerant(fourns || [])
      setFournGerantCharge(fourns || [])
    } catch (_) {}
    setLoadingGerant(false)
  }

  async function sauverDepFournGerantShift(gerantShift) {
    const details = shiftDetails[gerantShift.id]
    if (!details) return
    setLoading(true)
    try {
      for (const d of details.depenses) {
        await supabase.from('depenses').update({ montant: d.montant, libelle: d.libelle }).eq('id', d.id)
      }
      const newDepDenorm = details.depenses.reduce((s, d) => s + (d.montant || 0), 0)
      for (const t of details.fournisseurs) {
        await supabase.from('transactions_fournisseurs').update({
          facture: t.facture, paye: t.paye, reste: (t.facture || 0) - (t.paye || 0),
        }).eq('id', t.id)
      }
      const newFournDenorm = details.fournisseurs.reduce((s, t) => s + (t.paye || 0), 0)
      const updatedShift = { ...gerantShift, depenses: newDepDenorm, fournisseurs: newFournDenorm }
      const nouvelleVente = calculerVenteShift(updatedShift)
      await supabase.from('points_shifts').update({
        depenses: newDepDenorm, fournisseurs: newFournDenorm, vente_shift: nouvelleVente,
      }).eq('id', gerantShift.id)
      await corrigerPointValideApresShifts([{ avant: gerantShift, apres: { ...updatedShift, vente_shift: nouvelleVente } }])
      const { total } = await rechargerShiftsEtTotal(point.id)
      await rafraichirPoint()
      setDepenses(prev => prev.map(d => {
        const ed = details.depenses.find(dd => dd.id === d.id)
        return ed ? { ...d, montant: ed.montant, libelle: ed.libelle } : d
      }))
      setTransactions(prev => prev.map(t => {
        const ed = details.fournisseurs.find(tt => tt.id === t.id)
        return ed ? { ...t, facture: ed.facture, paye: ed.paye, reste: (ed.facture || 0) - (ed.paye || 0) } : t
      }))
      afficherToast(`✅ Gérant — Shift : ${fmt(nouvelleVente)} / Point total : ${fmt(total)}`)
    } catch (err) { Alert.alert('Erreur', err.message) }
    finally { setLoading(false) }
  }

  async function sauverDeductionsGerant() {
    if (!point) return
    setLoading(true)
    try {
      for (const t of fournGerant) {
        await supabase.from('transactions_fournisseurs').update({
          facture: t.facture, paye: t.paye, reste: (t.facture || 0) - (t.paye || 0),
        }).eq('id', t.id)
      }
      // Par différence : le point validé compte déjà les déductions d'avant
      // (dans depense_total ET dans reste_especes). L'ancien calcul les
      // retirait une seconde fois des espèces (Maroc 14/10 : −1 050 → −158 450).
      const payeAvant = fournGerantCharge.reduce((s, t) => s + (t.paye || 0), 0)
      const payeApres = fournGerant.reduce((s, t) => s + (t.paye || 0), 0)
      const delta = payeApres - payeAvant
      if (point.valide && delta !== 0) {
        const { data: pt, error: errPt } = await supabase.from('points')
          .select('depense_total, reste_especes, reste_fc, benefice_sc, depenses_gerant_caisse_total')
          .eq('id', point.id).single()
        if (errPt) throw errPt
        const { error: errMaj } = await supabase.from('points').update({
          depenses_gerant_caisse_total: (pt.depenses_gerant_caisse_total || 0) + delta,
          depense_total: (pt.depense_total || 0) + delta,
          reste_especes: (pt.reste_especes || 0) - delta,
          reste_fc: (pt.reste_fc || 0) - delta,
          benefice_sc: (pt.benefice_sc || 0) - delta,
        }).eq('id', point.id)
        if (errMaj) throw errMaj
        await reporterFondPointValide(-delta)
      }
      setFournGerantCharge(fournGerant)
      await rafraichirPoint()
      afficherToast(delta === 0 ? '✅ Déductions gérant enregistrées' : `✅ Déductions gérant — ${delta > 0 ? '+' : ''}${fmt(delta)} déduits du fond`)
    } catch (err) { Alert.alert('Erreur', err.message) }
    finally { setLoading(false) }
  }

  async function supprimerShift(shift) {
    setSuppressionEnCours(true)
    try {
      const venteAvant = point ? (parseFloat(form.vente_total) || 0) : 0

      // Archiver d'abord : sans filet, on ne supprime pas. L'archivage renvoie
      // les identifiants exacts à effacer — c'est ce qui empêche d'emporter au
      // passage la facture d'une autre caissière du même point.
      const { data: avant } = await supabase.from('points_shifts').select('*').eq('id', shift.id).maybeSingle()
      const ids = await archiverSuppressionShift(shift, { userId, userNom })
      await supprimerLignesArchivees(ids)
      setConfirmSupprShift(null)
      if (avant) await corrigerPointValideApresShifts([{ avant, apres: null }])
      const { total } = await rechargerShiftsEtTotal(point.id)
      await rafraichirPoint()
      journaliser('suppression_shift', {
        caissier: shift.caissier_nom, vente_avant: venteAvant, vente_apres: total,
        point_valide: !!point?.valide,
      }, { pointId: point.id, userId, userNom }).catch(() => {})
      afficherToast(`✅ Shift supprimé — Point total recalculé : ${fmt(total)}`)
    } catch (err) {
      Alert.alert('Erreur', err.message)
    } finally {
      setSuppressionEnCours(false)
    }
  }

  async function supprimerShiftsMultiples() {
    setSuppressionEnCours(true)
    setConfirmSupprMultiple(false)
    const selectedShifts = shifts.filter(s => shiftsSelectionnes.has(s.id))
    try {
      // Une archive par shift, pour pouvoir en restaurer un seul plus tard.
      const { data: avants } = await supabase.from('points_shifts').select('*').in('id', selectedShifts.map(s => s.id))
      const ids = await archiverSuppressionShift(selectedShifts, { userId, userNom })
      await supprimerLignesArchivees(ids)
      setModeSelShifts(false)
      setShiftsSelectionnes(new Set())
      await corrigerPointValideApresShifts((avants || []).map(avant => ({ avant, apres: null })))
      const { total } = await rechargerShiftsEtTotal(point.id)
      await rafraichirPoint()
      afficherToast(`✅ Shifts supprimés — Point total recalculé : ${fmt(total)}`)
    } catch (err) {
      Alert.alert('Erreur', err.message)
    } finally {
      setSuppressionEnCours(false)
    }
  }

  async function deplacerShift(shift, dateCible) {
    setDeplacement(true)
    try {
      // Chercher le point cible
      const { data: pointCible, error: errCible } = await supabase
        .from('points').select('*')
        .eq('restaurant_id', selectedResto.id)
        .eq('date', dateCible)
        .single()

      if (errCible || !pointCible) {
        Alert.alert('Erreur', `Aucun point trouvé pour le ${dateCible} dans ce restaurant. Créez d'abord le point pour cette date.`)
        return
      }

      if (pointCible.id === shift.point_id) {
        Alert.alert('Erreur', 'Le shift est déjà sur ce point.')
        return
      }

      // 1. Déplacer le record points_shifts
      const { error: errShift } = await supabase.from('points_shifts')
        .update({ point_id: pointCible.id, date: dateCible })
        .eq('id', shift.id)
      if (errShift) throw errShift

      // 2. Déplacer les dépenses caissier
      if (shift.caissier_nom) {
        await supabase.from('depenses')
          .update({ point_id: pointCible.id })
          .eq('point_id', shift.point_id)
          .eq('saisi_par', 'caissier')
          .eq('caissier_nom', shift.caissier_nom)
      }

      // 3. Déplacer les transactions fournisseurs caissier
      if (shift.caissier_id) {
        await supabase.from('transactions_fournisseurs')
          .update({ point_id: pointCible.id })
          .eq('point_id', shift.point_id)
          .eq('saisi_par', 'caissier')
          .eq('caissier_id', shift.caissier_id)
      } else if (shift.caissier_nom) {
        await supabase.from('transactions_fournisseurs')
          .update({ point_id: pointCible.id })
          .eq('point_id', shift.point_id)
          .eq('saisi_par', 'caissier')
          .eq('caissier_nom', shift.caissier_nom)
      }

      // 4. Déplacer les présences
      if (shift.caissier_id) {
        await supabase.from('presences')
          .update({ point_id: pointCible.id, date: dateCible })
          .eq('point_id', shift.point_id)
          .eq('caissier_id', shift.caissier_id)
      }

      // 5. Déplacer inventaires_shifts
      if (shift.caissier_id) {
        await supabase.from('inventaires_shifts')
          .update({ point_id: pointCible.id })
          .eq('point_id', shift.point_id)
          .eq('caissier_id', shift.caissier_id)
      }

      // 6. Points validés : le shift emporte encaissements, dépenses + salaires
      //    et espèces, et le fond des jours entre les deux suit (lib/deplacementShift).
      const [debut, fin] = [selectedDate, dateCible].sort()
      const { data: pointsPeriode, error: errPeriode } = await supabase
        .from('points')
        .select('id, date, valide, vente_total, depense_total, kdo, points_fidelite, retour, yango_cse, glovo_cse, wave, om, djamo, fc_veille, reste_especes, reste_fc, benefice_sc')
        .eq('restaurant_id', selectedResto.id)
        .gte('date', debut)
        .lte('date', fin)
      if (errPeriode) throw errPeriode
      const majs = majPointsDeplacement({
        shift, sourceId: shift.point_id, cibleId: pointCible.id, points: pointsPeriode,
      })
      for (const { id, maj } of majs) {
        const { error: errMaj } = await supabase.from('points').update(maj).eq('id', id)
        if (errMaj) throw errMaj
      }

      // 7. Points non validés : seule la vente est stockée d'avance, la
      //    validation recalculera le reste depuis les shifts.
      for (const p of [{ id: shift.point_id, valide: !!point?.valide }, pointCible]) {
        if (p.valide) continue
        const { data: shiftsPoint } = await supabase
          .from('points_shifts').select('vente_shift').eq('point_id', p.id)
        const total = (shiftsPoint || []).reduce((s, r) => s + (r.vente_shift || 0), 0)
        await supabase.from('points').update({ vente_total: total }).eq('id', p.id)
      }

      journaliser('deplacement_shift', {
        caissier: shift.caissier_nom,
        date_source: selectedDate, date_cible: dateCible,
        vente_shift: shift.vente_shift,
        point_source_valide: !!point?.valide, point_cible_valide: !!pointCible?.valide,
      }, { pointId: shift.point_id }).catch(() => {})

      setShowMoveShift(null)
      setMoveDateCible('')
      await chargerPoint(selectedResto.id, selectedDate)
      afficherToast(`✅ Shift déplacé vers le ${dateCible} — Total point mis à jour`)
    } catch (err) {
      Alert.alert('Erreur', err.message || String(err))
    } finally {
      setDeplacement(false)
    }
  }

  function toggleSelShift(id) {
    setShiftsSelectionnes(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function initShiftEdit(shift) {
    setShiftEdits(prev => ({
      ...prev,
      [shift.id]: {
        heure_debut: shift.heure_debut || '',
        heure_fin: shift.heure_fin || '',
        espece: String(shift.espece || ''),
        wave: String(shift.wave || ''),
        om: String(shift.om || ''),
        djamo: String(shift.djamo || ''),
        yango_cse: String(shift.yango_cse || ''),
        glovo_cse: String(shift.glovo_cse || ''),
        kdo: String(shift.kdo || ''),
        points_fidelite: String(shift.points_fidelite || ''),
        retour: String(shift.retour || ''),
        editing: true,
      }
    }))
    if (!shiftDetails[shift.id]) chargerDetailShift(shift)
  }

  async function sauverShift(shift) {
    const edits = shiftEdits[shift.id]
    if (!edits) return
    setLoading(true)
    try {
      const details = shiftDetails[shift.id]
      const detailsLoaded = details && !details.loading

      const newDepDenorm = detailsLoaded
        ? details.depenses.reduce((s, d) => s + (d.montant || 0), 0)
        : 0
      const newFournDenorm = detailsLoaded
        ? details.fournisseurs.reduce((s, t) => s + (t.paye || 0), 0)
        : 0

      if (detailsLoaded && details.depenses.length > 0) {
        for (const d of details.depenses) {
          await supabase.from('depenses').update({ montant: d.montant, libelle: d.libelle }).eq('id', d.id)
        }
        setDepenses(prev => prev.map(d => {
          const ed = details.depenses.find(dd => dd.id === d.id)
          return ed ? { ...d, montant: ed.montant, libelle: ed.libelle } : d
        }))
      }

      if (detailsLoaded && details.fournisseurs.length > 0) {
        for (const t of details.fournisseurs) {
          await supabase.from('transactions_fournisseurs').update({
            facture: t.facture, paye: t.paye, reste: (t.facture || 0) - (t.paye || 0),
          }).eq('id', t.id)
        }
        const updater = t => {
          const ed = details.fournisseurs.find(tt => tt.id === t.id)
          return ed ? { ...t, facture: ed.facture, paye: ed.paye, reste: (ed.facture || 0) - (ed.paye || 0) } : t
        }
        setTransactions(prev => prev.map(updater))
        setTransactionsRaw(prev => prev.map(updater))
      }

      const updated = {
        heure_debut: edits.heure_debut || shift.heure_debut,
        heure_fin: edits.heure_fin || shift.heure_fin,
        espece: parseFloat(edits.espece) || 0,
        wave: parseFloat(edits.wave) || 0,
        om: parseFloat(edits.om) || 0,
        djamo: parseFloat(edits.djamo) || 0,
        yango_cse: parseFloat(edits.yango_cse) || 0,
        glovo_cse: parseFloat(edits.glovo_cse) || 0,
        kdo: parseFloat(edits.kdo) || 0,
        points_fidelite: parseFloat(edits.points_fidelite) || 0,
        retour: parseFloat(edits.retour) || 0,
        depenses: newDepDenorm,
        fournisseurs: newFournDenorm,
      }

      const nouvelleVente = calculerVenteShift(updated, paiesShift(shift))
      updated.vente_shift = nouvelleVente

      const { data: avant } = await supabase.from('points_shifts').select('*').eq('id', shift.id).maybeSingle()
      const { error } = await supabase.from('points_shifts').update(updated).eq('id', shift.id)
      if (error) { Alert.alert('Erreur', error.message); return }
      if (avant) await corrigerPointValideApresShifts([{ avant, apres: { ...avant, ...updated } }])

      const { total } = await rechargerShiftsEtTotal(point.id)
      await rafraichirPoint()

      journaliser('modification_shift', {
        caissier: shift.caissier_nom,
        vente_shift_avant: shift.vente_shift, vente_shift_apres: nouvelleVente,
        vente_point_avant: parseFloat(form.vente_total) || 0, vente_point_apres: total,
      }, { pointId: point.id }).catch(() => {})

      setShiftEdits(prev => ({ ...prev, [shift.id]: { ...prev[shift.id], editing: false } }))
      afficherToast(`✅ Vente recalculée — Shift : ${fmt(nouvelleVente)} / Point total : ${fmt(total)}`)
    } catch (err) {
      Alert.alert('Erreur', err.message)
    } finally {
      setLoading(false)
    }
  }

  async function supprimerDepense(dep) {
    setLoading(true)
    const { error } = await supabase.from('depenses').delete().eq('id', dep.id)
    if (error) { setLoading(false); Alert.alert('Erreur', error.message); return }

    const nouvelles = depenses.filter(d => d.id !== dep.id)
    setDepenses(nouvelles)
    setConfirmSupprDep(null)

    const totalDep = nouvelles.reduce((s, d) => s + (d.montant || 0), 0)
    const totalTx = transactions.reduce((s, t) => s + (t.paye || 0), 0)
    await supabase.from('points').update({ depense_total: totalDep + totalTx }).eq('id', point.id)
    setForm(p => ({ ...p, depense_total: String(totalDep + totalTx) }))

    // Cascade vers le shift si dépense caissier
    if (dep.saisi_par === 'caissier' && dep.caissier_nom) {
      const matchShift = shifts.find(s => s.caissier_nom === dep.caissier_nom)
      if (matchShift) {
        const { data: restantes } = await supabase.from('depenses')
          .select('montant').eq('point_id', point.id).eq('caissier_nom', dep.caissier_nom)
        const newDepTotal = (restantes || []).reduce((s, d) => s + (d.montant || 0), 0)
        const nouvelleVente = Math.max(0, (matchShift.vente_shift || 0) - (dep.montant || 0))
        await supabase.from('points_shifts')
          .update({ depenses: newDepTotal, vente_shift: nouvelleVente }).eq('id', matchShift.id)
      }
    }

    const { total } = await rechargerShiftsEtTotal(point.id)
    setLoading(false)
    afficherToast(`✅ Dépense supprimée — Point total recalculé : ${fmt(total)}`)
  }

  async function supprimerTransaction(trans) {
    setLoading(true)
    const { error } = await supabase.from('transactions_fournisseurs').delete().eq('id', trans.id)
    if (error) { setLoading(false); Alert.alert('Erreur', error.message); return }

    const restantes = transactions.filter(t => t.id !== trans.id)
    setTransactions(restantes)
    setConfirmSupprTrans(null)

    const totalDep = depenses.reduce((s, d) => s + (d.montant || 0), 0)
    const totalTx = restantes.reduce((s, t) => s + (t.paye || 0), 0)
    await supabase.from('points').update({ depense_total: totalDep + totalTx }).eq('id', point.id)
    setForm(p => ({ ...p, depense_total: String(totalDep + totalTx) }))

    // Cascade vers le shift caissier
    if (trans.saisi_par === 'caissier') {
      const caissierShifts = shifts.filter(s => s.caissier_nom)
      const matchShift = caissierShifts.length === 1 ? caissierShifts[0]
        : caissierShifts.find(s => s.caissier_nom === trans.caissier_nom)
      if (matchShift) {
        const { data: restTx } = await supabase.from('transactions_fournisseurs')
          .select('paye').eq('point_id', point.id).eq('saisi_par', 'caissier')
        const newFournTotal = (restTx || []).reduce((s, t) => s + (t.paye || 0), 0)
        const nouvelleVente = Math.max(0, (matchShift.vente_shift || 0) - (trans.paye || 0))
        await supabase.from('points_shifts')
          .update({ fournisseurs: newFournTotal, vente_shift: nouvelleVente }).eq('id', matchShift.id)
      }
    }

    const { total } = await rechargerShiftsEtTotal(point.id)
    setLoading(false)
    afficherToast(`✅ Fournisseur supprimé — Point total recalculé : ${fmt(total)}`)
  }

  function renderShifts() {
    const pointValide = point?.valide
    return (
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {pointValide && (
          <View style={styles.warningBanner}>
            <Text style={styles.warningTxt}>🔒 Point validé — ✏️ Modification et suppression autorisées</Text>
          </View>
        )}

        {shifts.length > 0 && (
          <View style={styles.selectionBar}>
            {modeSelShifts ? (
              <>
                <TouchableOpacity style={styles.selBtnTout}
                  onPress={() => setShiftsSelectionnes(new Set(shifts.map(s => s.id)))}>
                  <Text style={styles.selBtnToutTxt}>Tout sélectionner</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.selBtnAnnuler}
                  onPress={() => { setModeSelShifts(false); setShiftsSelectionnes(new Set()) }}>
                  <Text style={styles.selBtnAnnulerTxt}>Annuler</Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity style={styles.selBtnActiver} onPress={() => setModeSelShifts(true)}>
                <Text style={styles.selBtnActiverTxt}>☑️ Sélectionner</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {shifts.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: 40 }}>
            <Text style={{ fontSize: 13, color: colors.textMuted }}>Aucun shift enregistré</Text>
          </View>
        ) : (
          shifts.map((s, i) => {
            const sel = shiftsSelectionnes.has(s.id)
            const edit = shiftEdits[s.id] || {}
            const isEditing = !!edit.editing
            return (
              <View key={s.id} style={[styles.shiftCard, modeSelShifts && sel && styles.shiftCardSelected, isEditing && styles.shiftCardEditing]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  {modeSelShifts && (
                    <TouchableOpacity onPress={() => toggleSelShift(s.id)}>
                      <View style={[styles.checkbox, sel && styles.checkboxSelected]}>
                        {sel && <Text style={styles.checkboxCheck}>✓</Text>}
                      </View>
                    </TouchableOpacity>
                  )}
                  <View style={styles.shiftNumBox}>
                    <Text style={styles.shiftNumTxt}>S{i + 1}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text }}>
                      ⏰ {s.heure_debut} → {s.heure_fin}
                    </Text>
                    {s.caissier_nom && (
                      <Text style={{ fontSize: 11, color: colors.primary, marginTop: 2 }}>👤 {s.caissier_nom}</Text>
                    )}
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 6 }}>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: '#EF9F27' }}>{fmt(s.vente_shift || 0)}</Text>
                    {s.espece > 0 && (
                      <Text style={{ fontSize: 11, color: colors.textMuted }}>💵 {fmt(s.espece)}</Text>
                    )}
                    {!modeSelShifts && (
                      <View style={{ flexDirection: 'row', gap: 6 }}>
                        <TouchableOpacity style={styles.editBtn} onPress={() => isEditing
                          ? setShiftEdits(prev => ({ ...prev, [s.id]: { ...prev[s.id], editing: false } }))
                          : initShiftEdit(s)
                        }>
                          <Text style={styles.editBtnTxt}>{isEditing ? '✕' : '✏️'}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.moveBtn} onPress={() => { setShowMoveShift(s); setMoveDateCible('') }}>
                          <Text style={styles.moveBtnTxt}>📅</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.supprimerBtn} onPress={() => setConfirmSupprShift(s)}>
                          <Text style={styles.supprimerBtnTxt}>🗑️</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                </View>

                {(() => {
                  const shiftFourn = transactionsRaw.filter(t =>
                    t.saisi_par === 'caissier' &&
                    (t.caissier_nom === s.caissier_nom || t.caissier_nom == null) &&
                    (t.paye || 0) > 0
                  )
                  const shiftPres = s.caissier_id
                    ? presences.filter(p => p.caissier_id === s.caissier_id)
                    : []
                  if (shiftFourn.length === 0 && shiftPres.length === 0) return null
                  return (
                    <View style={styles.shiftSubSection}>
                      {shiftFourn.length > 0 && (
                        <>
                          <Text style={styles.shiftSubTitre}>Fournisseurs</Text>
                          {shiftFourn.map((t, ti) => (
                            <View key={t.id || ti} style={styles.shiftSubRow}>
                              <Text style={styles.shiftSubLabel}>{t.fournisseurs?.nom || 'Fournisseur'}</Text>
                              <Text style={styles.shiftSubVal}>{fmt(t.paye)}</Text>
                            </View>
                          ))}
                        </>
                      )}
                      {shiftPres.length > 0 && (
                        <>
                          <Text style={styles.shiftSubTitre}>Présences</Text>
                          {shiftPres.map((p, pi) => (
                            <View key={p.id || pi} style={styles.shiftSubRow}>
                              <Text style={styles.shiftSubLabel}>
                                {p.travailleur_nom}{' — '}
                                <Text style={{ color: p.statut === 'present' ? '#3B6D11' : '#A32D2D' }}>{p.statut}</Text>
                              </Text>
                              {(p.paye || 0) > 0 && <Text style={styles.shiftSubVal}>{fmt(p.paye)}</Text>}
                            </View>
                          ))}
                        </>
                      )}
                    </View>
                  )
                })()}

                {isEditing && (() => {
                  const detLoaded = shiftDetails[s.id] && !shiftDetails[s.id].loading
                  const venteCalculee = calculerVenteShift({
                    espece: parseFloat(edit.espece) || 0,
                    wave: parseFloat(edit.wave) || 0,
                    om: parseFloat(edit.om) || 0,
                    djamo: parseFloat(edit.djamo) || 0,
                    yango_cse: parseFloat(edit.yango_cse) || 0,
                    glovo_cse: parseFloat(edit.glovo_cse) || 0,
                    kdo: parseFloat(edit.kdo) || 0,
                    points_fidelite: parseFloat(edit.points_fidelite) || 0,
                    retour: parseFloat(edit.retour) || 0,
                    depenses: detLoaded ? shiftDetails[s.id].depenses.reduce((sum, d) => sum + (d.montant || 0), 0) : 0,
                    fournisseurs: detLoaded ? shiftDetails[s.id].fournisseurs.reduce((sum, t) => sum + (t.paye || 0), 0) : 0,
                  }, paiesShift(s))
                  const setField = (field, v) => setShiftEdits(prev => ({ ...prev, [s.id]: { ...prev[s.id], [field]: v } }))
                  return (
                    <View style={styles.shiftEditPanel}>
                      {[
                        ['Heure début', 'heure_debut', false, '08:00'],
                        ['Heure fin', 'heure_fin', false, '16:00'],
                        ['Espèces', 'espece', true, '0'],
                        ['Wave', 'wave', true, '0'],
                        ['Orange Money', 'om', true, '0'],
                        ['Djamo', 'djamo', true, '0'],
                        ['Yango CSE', 'yango_cse', true, '0'],
                        ['Glovo CSE', 'glovo_cse', true, '0'],
                        ['KDO', 'kdo', true, '0'],
                        ['Payé en points', 'points_fidelite', true, '0'],
                        ['Retour', 'retour', true, '0'],
                      ].map(([label, field, numeric, placeholder]) => (
                        <View key={field} style={styles.inputLigne}>
                          <Text style={styles.inputLabel}>{label}</Text>
                          <TextInput
                            style={styles.inputField}
                            value={edit[field] || ''}
                            onChangeText={v => setField(field, v)}
                            keyboardType={numeric ? 'numeric' : 'default'}
                            placeholder={placeholder}
                            placeholderTextColor="#bbb"
                          />
                        </View>
                      ))}
                      <View style={[styles.shiftVenteCalc]}>
                        <Text style={styles.shiftVenteCalcLabel}>Vente shift calculée</Text>
                        <Text style={styles.shiftVenteCalcVal}>{fmt(venteCalculee)}</Text>
                      </View>

                      {/* Dépenses du shift */}
                      {shiftDetails[s.id]?.loading && (
                        <View style={{ alignItems: 'center', paddingVertical: 12 }}>
                          <ActivityIndicator size="small" color={colors.primary} />
                        </View>
                      )}
                      {!shiftDetails[s.id]?.loading && shiftDetails[s.id]?.depenses?.length > 0 && (
                        <>
                          <Text style={[styles.sectionTitre, { marginTop: 12 }]}>Dépenses du shift</Text>
                          {shiftDetails[s.id].depenses.map((d, di) => (
                            <View key={d.id || di} style={styles.depLigneBlock}>
                              <Text style={{ fontSize: 10, color: '#534AB7', marginBottom: 2 }}>{d.categorie}</Text>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                <View style={{ flex: 1 }}>
                                  <TextInput
                                    style={styles.libellInput}
                                    value={d.libelle || ''}
                                    onChangeText={v => setShiftDetails(prev => ({
                                      ...prev,
                                      [s.id]: { ...prev[s.id], depenses: prev[s.id].depenses.map((dd, idx) => idx === di ? { ...dd, libelle: v } : dd) },
                                    }))}
                                    placeholder="Description" placeholderTextColor="#bbb"
                                  />
                                </View>
                                <TextInput
                                  style={[styles.inputField, { width: 90 }]}
                                  value={String(d.montant || '')}
                                  onChangeText={v => setShiftDetails(prev => ({
                                    ...prev,
                                    [s.id]: { ...prev[s.id], depenses: prev[s.id].depenses.map((dd, idx) => idx === di ? { ...dd, montant: parseFloat(v) || 0 } : dd) },
                                  }))}
                                  keyboardType="numeric" placeholder="0" placeholderTextColor="#bbb"
                                />
                              </View>
                            </View>
                          ))}
                        </>
                      )}
                      {!shiftDetails[s.id]?.loading && shiftDetails[s.id]?.fournisseurs?.length > 0 && (
                        <>
                          <Text style={[styles.sectionTitre, { marginTop: 12 }]}>Fournisseurs du shift</Text>
                          {shiftDetails[s.id].fournisseurs.map((t, ti) => (
                            <View key={t.id || ti} style={styles.depLigneBlock}>
                              <Text style={{ fontSize: 11, fontWeight: '600', color: colors.text, marginBottom: 4 }}>
                                {t.fournisseurs?.nom || `Fournisseur ${ti + 1}`}
                              </Text>
                              <View style={{ flexDirection: 'row', gap: 8 }}>
                                <View style={{ flex: 1 }}>
                                  <Text style={{ fontSize: 10, color: colors.textMuted, marginBottom: 2 }}>Facture</Text>
                                  <TextInput
                                    style={[styles.inputField, { width: '100%', textAlign: 'left' }]}
                                    value={String(t.facture || '')}
                                    onChangeText={v => setShiftDetails(prev => ({
                                      ...prev,
                                      [s.id]: { ...prev[s.id], fournisseurs: prev[s.id].fournisseurs.map((tt, idx) => idx === ti ? { ...tt, facture: parseFloat(v) || 0 } : tt) },
                                    }))}
                                    keyboardType="numeric" placeholder="0" placeholderTextColor="#bbb"
                                  />
                                </View>
                                <View style={{ flex: 1 }}>
                                  <Text style={{ fontSize: 10, color: colors.textMuted, marginBottom: 2 }}>Payé</Text>
                                  <TextInput
                                    style={[styles.inputField, { width: '100%', textAlign: 'left' }]}
                                    value={String(t.paye || '')}
                                    onChangeText={v => setShiftDetails(prev => ({
                                      ...prev,
                                      [s.id]: { ...prev[s.id], fournisseurs: prev[s.id].fournisseurs.map((tt, idx) => idx === ti ? { ...tt, paye: parseFloat(v) || 0 } : tt) },
                                    }))}
                                    keyboardType="numeric" placeholder="0" placeholderTextColor="#bbb"
                                  />
                                </View>
                              </View>
                            </View>
                          ))}
                        </>
                      )}

                      <TouchableOpacity style={[styles.saveBtn, { marginTop: 10, marginBottom: 0 }]} onPress={() => sauverShift(s)}>
                        <Text style={styles.saveTxt}>💾 Sauvegarder & recalculer</Text>
                      </TouchableOpacity>
                    </View>
                  )
                })()}
              </View>
            )
          })
        )}

        {modeSelShifts && shiftsSelectionnes.size > 0 && (
          <TouchableOpacity
            style={[styles.btnSupprimerSel, suppressionEnCours && { opacity: 0.6 }, { marginTop: 8 }]}
            onPress={() => setConfirmSupprMultiple(true)}
            disabled={suppressionEnCours}
          >
            {suppressionEnCours
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={styles.btnSupprimerSelTxt}>🗑️ Supprimer la sélection ({shiftsSelectionnes.size})</Text>
            }
          </TouchableOpacity>
        )}
        <View style={{ height: 40 }} />
      </ScrollView>
    )
  }

  function val(v) { return parseFloat(v) || 0 }

  function resteFormule(f) {
    return val(f?.vente_total) - val(f?.depense_total)
      - val(f?.kdo) - val(f?.points_fidelite) - val(f?.retour)
      - val(f?.yango_cse) - val(f?.glovo_cse)
      - val(f?.wave) - val(f?.om) - val(f?.djamo)
  }

  // Par différence avec le reste enregistré : sur quelques points (dépenses
  // corrigées après coup, ex. 05/10), la formule ne retombe pas sur le reste
  // validé. On garde cet écart, pour qu'« Enregistrer » sans rien changer ne
  // déplace jamais le fond.
  function resteEspeces() {
    const ecartEnregistre = point ? val(point.reste_especes) - resteFormule(point) : 0
    return resteFormule(form) + ecartEnregistre
  }

  function fc() {
    // Par différence avec le fond enregistré : il contient aussi le FC reçu de
    // la journée (`fc_compte`, absent de ce formulaire) et, sur de vieux
    // points, des écarts saisis à la main. Recalculé en entier, il perdait
    // tout cela à chaque « Enregistrer » ; ici il ne bouge que de ce que le
    // manager a changé.
    if (!point) return resteEspeces() + val(form.fc_veille) + val(form.fond_recu)
    return val(point.reste_fc)
      + (resteEspeces() - val(point.reste_especes))
      + (val(form.fc_veille) - val(point.fc_veille))
      + (val(form.fond_recu) - val(point.fond_recu))
  }

  function beneficeSC() {
    return (val(form.yango_tab) * 0.77)
      + (val(form.glovo_tab) * 0.705)
      + (val(form.om) * 0.99)
      + (val(form.wave) * 0.99)
      + (val(form.djamo) * 0.99)
      + resteEspeces()
  }

  function fmt(n) { return Math.round(n).toLocaleString('fr-FR') + ' FCFA' }

  function formatDate(dateStr) {
    if (!dateStr) return ''
    const [y, m, d] = dateStr.split('-')
    const mois = ['jan', 'fév', 'mar', 'avr', 'mai', 'juin', 'juil', 'août', 'sep', 'oct', 'nov', 'déc']
    return `${parseInt(d)} ${mois[parseInt(m) - 1]} ${y}`
  }

  function sauvegarder({ naviguer = true } = {}) {
    if (estJourneeImportee(point)) {
      Alert.alert('Lecture seule', 'Cette journée vient des anciens sheets (avant le 11 mai 2026) : elle ne peut pas être modifiée.')
      return
    }
    setConfirmSauvegarder({ naviguer })
  }

  async function confirmerSauvegarder() {
    if (!confirmSauvegarder) return
    const { naviguer } = confirmSauvegarder
    setConfirmSauvegarder(null)
    setLoading(true)
    // Fond laissé avant / après : l'écart part sur les jours validés suivants.
    const { data: avantMaj } = await supabase.from('points').select('reste_fc').eq('id', point.id).single()
    const { error } = await supabase.from('points').update({
      vente_total: val(form.vente_total),
      depense_total: val(form.depense_total),
      kdo: val(form.kdo),
      points_fidelite: val(form.points_fidelite),
      retour: val(form.retour),
      yango_cse: val(form.yango_cse),
      yango_tab: val(form.yango_tab),
      glovo_cse: val(form.glovo_cse),
      glovo_tab: val(form.glovo_tab),
      wave: val(form.wave),
      om: val(form.om),
      djamo: val(form.djamo),
      fc_veille: val(form.fc_veille),
      fond_recu: val(form.fond_recu),
      reste_especes: resteEspeces(),
      reste_fc: fc(),
      benefice_sc: beneficeSC(),
      // NE PAS écrire ajustement_fond ici : reste_fc est 100% dérivé des ventes, et
      // ajustement_fond porte les corrections d'écart (régularisations) déposées sur ce
      // jour. Le laisser intact garantit qu'une ré-édition des ventes n'efface jamais une
      // régularisation de fond. Le fond reporté = reste_fc + ajustement_fond.
    }).eq('id', point.id)
    if (!error && avantMaj) {
      try { await reporterFondPointValide(fc() - (parseFloat(avantMaj.reste_fc) || 0)) }
      catch (e) { Alert.alert('Erreur', `Ventes enregistrées, mais le fond des jours suivants n'a pas été reporté : ${e.message}`) }
    }
    setLoading(false)
    if (error) {
      Alert.alert('Erreur', error.message)
    } else {
      afficherToast('✅ Ventes enregistrées avec succès !')
      if (naviguer) {
        if (router.canGoBack()) router.back()
        else router.replace('/accueil')
      }
    }
  }

  function InputLigne({ label, champ }) {
    return (
      <View style={styles.inputLigne}>
        <Text style={styles.inputLabel}>{label}</Text>
        <TextInput
          style={styles.inputField}
          value={form[champ] || ''}
          onChangeText={v => setForm(p => ({ ...p, [champ]: v }))}
          keyboardType="numeric"
          placeholderTextColor="#bbb"
          placeholder="0"
        />
      </View>
    )
  }

  function renderResume() {
    return (
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.infoBar}>
          <Text style={styles.infoBarTxt}>{selectedResto?.nom} — {formatDate(selectedDate)}</Text>
          <View style={[styles.valideBadge, { backgroundColor: point?.valide ? '#EAF3DE' : '#FAEEDA' }]}>
            <Text style={[styles.valideTxt, { color: point?.valide ? '#3B6D11' : '#854F0B' }]}>
              {point?.valide ? '✅ Validé' : '⏳ En cours'}
            </Text>
          </View>
        </View>

        <View style={styles.kpiGrid}>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Ventes</Text>
            <Text style={[styles.kpiValue, { color: '#BA7517' }]}>{fmt(val(form.vente_total))}</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Dépenses</Text>
            <Text style={[styles.kpiValue, { color: '#A32D2D' }]}>{fmt(val(form.depense_total))}</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Bénéfice SC</Text>
            <Text style={[styles.kpiValue, { color: '#3B6D11' }]}>{fmt(beneficeSC())}</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Reste + FC</Text>
            <Text style={[styles.kpiValue, { color: fc() >= 0 ? '#BA7517' : '#A32D2D' }]}>{fmt(fc())}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitre}>Canaux de vente</Text>
        <View style={styles.card}>
          {[
            ['Yango CSE', form.yango_cse], ['Yango TAB', form.yango_tab],
            ['Glovo CSE', form.glovo_cse], ['Glovo TAB', form.glovo_tab],
            ['Wave', form.wave], ['Orange Money', form.om], ['Djamo', form.djamo],
          ].map(([label, v], i) => (
            <View key={i} style={styles.resumeRow}>
              <Text style={styles.resumeLabel}>{label}</Text>
              <Text style={styles.resumeValue}>{fmt(parseFloat(v) || 0)}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.sectionTitre}>Shifts ({shifts.length})</Text>
        <View style={styles.card}>
          {shifts.length === 0 ? (
            <Text style={styles.emptyTxt}>Aucun shift enregistré</Text>
          ) : shifts.map((s, i) => (
            <View key={i} style={styles.resumeRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.resumeLabel}>S{i + 1} — {s.heure_debut} → {s.heure_fin}</Text>
                {s.caissier_nom && <Text style={[styles.resumeLabel, { color: '#534AB7', fontSize: 11 }]}>{s.caissier_nom}</Text>}
              </View>
              <Text style={styles.resumeValue}>{fmt(s.vente_shift || 0)}</Text>
            </View>
          ))}
          {shifts.length > 0 && (
            <View style={[styles.resumeRow, { borderBottomWidth: 0, paddingTop: 8 }]}>
              <Text style={[styles.resumeLabel, { fontWeight: '600', color: '#1a1a1a' }]}>Total shifts</Text>
              <Text style={[styles.resumeValue, { color: '#BA7517', fontWeight: '600' }]}>
                {fmt(shifts.reduce((s, sh) => s + (sh.vente_shift || 0), 0))}
              </Text>
            </View>
          )}
        </View>

        <Text style={styles.sectionTitre}>Dépenses ({depenses.length} lignes)</Text>
        <View style={styles.card}>
          {depenses.length === 0 ? (
            <Text style={styles.emptyTxt}>Aucune dépense enregistrée</Text>
          ) : (
            Object.entries(
              depenses.reduce((acc, d) => {
                if (!acc[d.categorie]) acc[d.categorie] = 0
                acc[d.categorie] += d.montant
                return acc
              }, {})
            ).map(([cat, total], i) => (
              <View key={i} style={styles.resumeRow}>
                <Text style={styles.resumeLabel}>{cat}</Text>
                <Text style={styles.resumeValue}>{fmt(total)}</Text>
              </View>
            ))
          )}
        </View>

        <Text style={styles.sectionTitre}>Fournisseurs ({transactions.length})</Text>
        <View style={styles.card}>
          {transactions.length === 0 ? (
            <Text style={styles.emptyTxt}>Aucune transaction fournisseur</Text>
          ) : transactions.map((t, i) => (
            <View key={i} style={styles.resumeRow}>
              <Text style={styles.resumeLabel}>Fournisseur</Text>
              <Text style={styles.resumeValue}>Payé: {fmt(t.paye)} | Reste: {fmt(t.reste)}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.sectionTitre}>Présences ({presences.length})</Text>
        <View style={styles.card}>
          {presences.length === 0 ? (
            <Text style={styles.emptyTxt}>Aucune présence enregistrée</Text>
          ) : presences.map((p, i) => (
            <View key={i} style={styles.resumeRow}>
              <Text style={styles.resumeLabel}>{p.travailleur_nom}</Text>
              <Text style={styles.resumeValue}>{p.statut} — {fmt(p.paye)}</Text>
            </View>
          ))}
        </View>

        <TouchableOpacity style={styles.saveBtn} onPress={sauvegarder}>
          <Text style={styles.saveTxt}>💾 Enregistrer les modifications</Text>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
    )
  }

  function renderVentes() {
    const totalShifts = shifts.reduce((s, sh) => s + (sh.vente_shift || 0), 0)
    return (
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

        <Text style={styles.sectionTitre}>Total ventes</Text>
        <View style={styles.card}>
          <InputLigne label="Vente totale" champ="vente_total" />
        </View>

        <Text style={styles.sectionTitre}>Ventes shifts (référence)</Text>
        <View style={styles.card}>
          {shifts.length === 0 ? (
            <Text style={styles.emptyTxt}>Aucun shift</Text>
          ) : shifts.map((s, i) => (
            <View key={i} style={styles.resumeRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.resumeLabel}>S{i + 1} — {s.heure_debut} → {s.heure_fin}</Text>
                {s.caissier_nom && <Text style={[styles.resumeLabel, { fontSize: 11, color: '#534AB7' }]}>{s.caissier_nom}</Text>}
              </View>
              <Text style={styles.resumeValue}>{fmt(s.vente_shift || 0)}</Text>
            </View>
          ))}
          {shifts.length > 0 && (
            <View style={[styles.resumeRow, { borderBottomWidth: 0, paddingTop: 8 }]}>
              <Text style={[styles.resumeLabel, { fontWeight: '600', color: '#BA7517' }]}>Total shifts</Text>
              <Text style={[styles.resumeValue, { color: '#BA7517', fontWeight: '700' }]}>{fmt(totalShifts)}</Text>
            </View>
          )}
        </View>

        <Text style={styles.sectionTitre}>Canaux de vente</Text>
        <View style={styles.card}>
          <InputLigne label="Yango CSE" champ="yango_cse" />
          <InputLigne label="Yango TAB (×0,77)" champ="yango_tab" />
          <InputLigne label="Glovo CSE" champ="glovo_cse" />
          <InputLigne label="Glovo TAB (×0,705)" champ="glovo_tab" />
          <InputLigne label="Wave" champ="wave" />
          <InputLigne label="Orange Money" champ="om" />
          <InputLigne label="Djamo" champ="djamo" />
        </View>

        <Text style={styles.sectionTitre}>Déductions</Text>
        <View style={styles.card}>
          <InputLigne label="KDO" champ="kdo" />
          <InputLigne label="Payé en points" champ="points_fidelite" />
          <InputLigne label="Retour" champ="retour" />
        </View>

        <Text style={styles.sectionTitre}>Fond de caisse</Text>
        <View style={styles.card}>
          <InputLigne label="FC de la veille" champ="fc_veille" />
          <InputLigne label="Fond reçu" champ="fond_recu" />
        </View>

        <View style={styles.recapCard}>
          <Text style={styles.recapTitre}>Résultats calculés</Text>
          <View style={styles.resumeRow}>
            <Text style={styles.recapLabel}>Reste espèces</Text>
            <Text style={[styles.recapValue, { color: resteEspeces() >= 0 ? '#BA7517' : '#A32D2D' }]}>{fmt(resteEspeces())}</Text>
          </View>
          <View style={styles.resumeRow}>
            <Text style={styles.recapLabel}>Reste + FC</Text>
            <Text style={[styles.recapValue, { color: fc() >= 0 ? '#BA7517' : '#A32D2D' }]}>{fmt(fc())}</Text>
          </View>
          <View style={[styles.resumeRow, { borderBottomWidth: 0 }]}>
            <Text style={[styles.recapLabel, { fontWeight: '600', color: '#1a1a1a' }]}>Bénéfice SC</Text>
            <Text style={[styles.recapValue, { color: '#3B6D11', fontWeight: '600', fontSize: 15 }]}>{fmt(beneficeSC())}</Text>
          </View>
        </View>

        <TouchableOpacity style={styles.saveBtn} onPress={() => sauvegarder({ naviguer: false })}>
          <Text style={styles.saveTxt}>💾 Enregistrer les ventes</Text>
        </TouchableOpacity>
        <View style={{ height: 40 }} />
      </ScrollView>
    )
  }

  function renderDepenses() {
    const categories = {}
    depenses.forEach(d => {
      if (!categories[d.categorie]) categories[d.categorie] = []
      categories[d.categorie].push(d)
    })

    return (
      <ScrollView showsVerticalScrollIndicator={false}>
        {Object.entries(categories).map(([cat, lignes]) => (
          <View key={cat}>
            <Text style={styles.sectionTitre}>{cat}</Text>
            <View style={styles.card}>
              {lignes.map((d, i) => (
                <View key={d.id} {...focus.props(d.id)} style={[styles.depLigneBlock, focus.style(d.id)]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <TextInput
                        style={styles.libellInput}
                        value={d.libelle || ''}
                        onChangeText={v => {
                          const nd = [...depenses]
                          const idx = nd.findIndex(x => x.id === d.id)
                          if (idx >= 0) nd[idx] = { ...nd[idx], libelle: v }
                          setDepenses(nd)
                        }}
                        placeholder="Description"
                        placeholderTextColor="#bbb"
                      />
                    </View>
                    <TextInput
                      style={styles.inputField}
                      value={String(d.montant || '')}
                      onChangeText={v => {
                        const nd = [...depenses]
                        const idx = nd.findIndex(x => x.id === d.id)
                        if (idx >= 0) nd[idx] = { ...nd[idx], montant: parseFloat(v) || 0 }
                        setDepenses(nd)
                      }}
                      keyboardType="numeric"
                      placeholder="0"
                      placeholderTextColor="#bbb"
                    />
                    <TouchableOpacity style={styles.supprimerBtnRond} onPress={() => setConfirmSupprDep(d)}>
                      <Text style={styles.supprimerBtnTxt}>🗑️</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
              <View style={styles.catTotal}>
                <Text style={styles.catTotalLabel}>Total {cat}</Text>
                <Text style={styles.catTotalValue}>{fmt(lignes.reduce((s, d) => s + (d.montant || 0), 0))}</Text>
              </View>
            </View>
          </View>
        ))}

        {depenses.length === 0 && !showAddDep && (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyTxt}>Aucune dépense enregistrée pour ce point</Text>
          </View>
        )}

        {/* Formulaire nouvelle dépense */}
        {showAddDep ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitre}>Nouvelle dépense</Text>
            <Text style={styles.inputLabel}>Catégorie</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginBottom: 10 }}>
              {CATS_DEPENSES.map(c => (
                <TouchableOpacity key={c}
                  style={[styles.fourChip, newDepCat === c && styles.fourChipActive]}
                  onPress={() => setNewDepCat(c)}>
                  <Text style={[styles.fourChipTxt, newDepCat === c && styles.fourChipTxtActive]}>{c}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <View style={styles.inputLigne}>
              <Text style={styles.inputLabel}>Description</Text>
              <TextInput style={[styles.inputField, { width: 180 }]} value={newDepLib}
                onChangeText={setNewDepLib} placeholder="Ex: Tomates" placeholderTextColor="#bbb" />
            </View>
            <View style={styles.inputLigne}>
              <Text style={styles.inputLabel}>Montant</Text>
              <TextInput style={styles.inputField} value={newDepMontant} onChangeText={setNewDepMontant}
                keyboardType="numeric" placeholder="0" placeholderTextColor="#bbb" />
            </View>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
              <TouchableOpacity style={[styles.saveBtn, { flex: 1, backgroundColor: '#f5f5f5', marginTop: 0 }]}
                onPress={() => setShowAddDep(false)}>
                <Text style={[styles.saveTxt, { color: '#888' }]}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveBtn, { flex: 2, backgroundColor: '#EF9F27', marginTop: 0 }]}
                onPress={async () => {
                  const montant = parseFloat(newDepMontant) || 0
                  if (!montant) { Alert.alert('Erreur', 'Saisissez un montant'); return }
                  setLoading(true)
                  const { data, error } = await supabase.from('depenses').insert({
                    point_id: point.id,
                    categorie: newDepCat,
                    libelle: newDepLib || newDepCat,
                    montant,
                    saisi_par: 'gerant',
                  }).select().single()
                  if (error) { setLoading(false); Alert.alert('Erreur', error.message); return }
                  const nouvellesDep = [...depenses, data]
                  setDepenses(nouvellesDep)
                  const nouveauTotal = nouvellesDep.reduce((s, d) => s + (d.montant || 0), 0)
                  await supabase.from('points').update({ depense_total: nouveauTotal }).eq('id', point.id)
                  setForm(p => ({ ...p, depense_total: String(nouveauTotal) }))
                  setLoading(false)
                  setNewDepLib(''); setNewDepMontant(''); setShowAddDep(false)
                  Alert.alert('Succès', 'Dépense ajoutée !')
                }}
              >
                <Text style={[styles.saveTxt, { color: '#412402' }]}>✅ Ajouter</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <TouchableOpacity style={[styles.saveBtn, { backgroundColor: '#f5f5f5', borderWidth: 1, borderColor: '#534AB7' }]}
            onPress={() => setShowAddDep(true)}>
            <Text style={[styles.saveTxt, { color: '#534AB7' }]}>+ Ajouter une dépense</Text>
          </TouchableOpacity>
        )}

        <View style={styles.recapCard}>
          <View style={[styles.resumeRow, { borderBottomWidth: 0 }]}>
            <Text style={[styles.recapLabel, { fontWeight: '600', color: '#1a1a1a' }]}>Total dépenses</Text>
            <Text style={[styles.recapValue, { color: '#A32D2D', fontWeight: '600', fontSize: 15 }]}>
              {fmt(depenses.reduce((s, d) => s + (d.montant || 0), 0))}
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={styles.saveBtn}
          onPress={async () => {
            setLoading(true)
            let errMsg = null
            for (const d of depenses) {
              if (!d.id) continue
              const { data: r, error } = await supabase
                .from('depenses')
                .update({ montant: d.montant, libelle: d.libelle })
                .eq('id', d.id)
                .select('id')
              if (error) { errMsg = error.message; break }
              if (!r?.length) { errMsg = `Modification refusée pour "${d.libelle || 'dépense'}" (droits insuffisants).`; break }
            }
            if (errMsg) { setLoading(false); Alert.alert('Erreur', errMsg); return }
            const totalDep = depenses.reduce((s, d) => s + (d.montant || 0), 0)
            const { error: errTotal } = await supabase
              .from('points').update({ depense_total: totalDep }).eq('id', point.id)
            if (errTotal) { setLoading(false); Alert.alert('Erreur', errTotal.message); return }
            setForm(p => ({ ...p, depense_total: String(totalDep) }))
            setLoading(false)
            Alert.alert('✅ Sauvegardé', 'Dépenses enregistrées dans la base de données !')
          }}
        >
          <Text style={styles.saveTxt}>💾 Enregistrer les dépenses</Text>
        </TouchableOpacity>
        <View style={{ height: 40 }} />
      </ScrollView>
    )
  }

  function renderFournisseurs() {
    const existingIds = transactions.map(t => t.fournisseur_id)
    const disponibles = fournisseursList.filter(f => !existingIds.includes(f.id))

    async function sauverFournisseurs() {
      setLoading(true)
      let errMsg = null
      for (const t of transactions) {
        const { data: r, error } = await supabase
          .from('transactions_fournisseurs')
          .update({
            facture: t.facture,
            paye: t.paye,
            reste: (t.facture || 0) - (t.paye || 0),
          })
          .eq('id', t.id)
          .select('id')
        if (error) { errMsg = error.message; break }
        if (!r?.length) { errMsg = `Modification refusée pour "${t.fournisseurs?.nom || 'fournisseur'}" (droits insuffisants).`; break }
      }
      setLoading(false)
      if (errMsg) { Alert.alert('Erreur', errMsg); return }
      Alert.alert('✅ Sauvegardé', 'Fournisseurs enregistrés dans la base de données !')
    }

    async function ajouterFournisseur() {
      if (!newFourId) { Alert.alert('Erreur', 'Sélectionnez un fournisseur'); return }
      const facture = parseFloat(newFourFact) || 0
      const paye = parseFloat(newFourPaye) || 0
      if (!facture && !paye) { Alert.alert('Erreur', 'Saisissez au moins un montant'); return }
      setLoading(true)
      const { data, error } = await supabase.from('transactions_fournisseurs').insert({
        point_id: point.id,
        fournisseur_id: newFourId,
        facture,
        paye,
        reste: facture - paye,
      }).select('*, fournisseurs(nom)').single()
      setLoading(false)
      if (error) { Alert.alert('Erreur', error.message); return }
      setTransactions(prev => [...prev, data])
      setNewFourId(null); setNewFourFact(''); setNewFourPaye('')
      setShowAddFour(false)
      Alert.alert('Succès', 'Fournisseur ajouté !')
    }

    return (
      <ScrollView showsVerticalScrollIndicator={false}>
        {transactions.length === 0 && !showAddFour && (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyTxt}>Aucune transaction fournisseur</Text>
          </View>
        )}

        {transactions.map((t, i) => (
          <View key={t.id} style={styles.fournCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <Text style={styles.fournNom}>{t.fournisseurs?.nom || `Fournisseur ${i + 1}`}</Text>
              <TouchableOpacity style={styles.supprimerBtn} onPress={() => setConfirmSupprTrans(t)}>
                <Text style={styles.supprimerBtnTxt}>🗑️ Supprimer</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.inputLigne}>
              <Text style={styles.inputLabel}>Facture</Text>
              <TextInput
                style={styles.inputField}
                value={String(t.facture || '')}
                onChangeText={v => {
                  const n = [...transactions]; n[i] = { ...n[i], facture: parseFloat(v) || 0 }; setTransactions(n)
                }}
                keyboardType="numeric" placeholder="0" placeholderTextColor="#bbb"
              />
            </View>
            <View style={styles.inputLigne}>
              <Text style={styles.inputLabel}>Payé</Text>
              <TextInput
                style={styles.inputField}
                value={String(t.paye || '')}
                onChangeText={v => {
                  const n = [...transactions]; n[i] = { ...n[i], paye: parseFloat(v) || 0, reste: (n[i].facture || 0) - (parseFloat(v) || 0) }; setTransactions(n)
                }}
                keyboardType="numeric" placeholder="0" placeholderTextColor="#bbb"
              />
            </View>
            <View style={[styles.resumeRow, { borderBottomWidth: 0, marginTop: 8 }]}>
              <Text style={styles.resumeLabel}>Reste dû</Text>
              <Text style={[styles.resumeValue, { color: ((t.facture || 0) - (t.paye || 0)) > 0 ? '#A32D2D' : '#3B6D11', fontWeight: '600' }]}>
                {fmt((t.facture || 0) - (t.paye || 0))}
              </Text>
            </View>
          </View>
        ))}

        {/* Formulaire ajout fournisseur */}
        {showAddFour ? (
          <View style={styles.fournCard}>
            <Text style={styles.fournNom}>Nouveau fournisseur</Text>
            <Text style={styles.inputLabel}>Sélectionner</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginBottom: 10 }}>
              {disponibles.map(f => (
                <TouchableOpacity
                  key={f.id}
                  style={[styles.fourChip, newFourId === f.id && styles.fourChipActive]}
                  onPress={() => setNewFourId(f.id)}
                >
                  <Text style={[styles.fourChipTxt, newFourId === f.id && styles.fourChipTxtActive]}>
                    {f.nom}
                  </Text>
                </TouchableOpacity>
              ))}
              {disponibles.length === 0 && (
                <Text style={[styles.emptyTxt, { margin: 8 }]}>Tous les fournisseurs sont déjà ajoutés</Text>
              )}
            </ScrollView>
            <View style={styles.inputLigne}>
              <Text style={styles.inputLabel}>Facture</Text>
              <TextInput style={styles.inputField} value={newFourFact} onChangeText={setNewFourFact}
                keyboardType="numeric" placeholder="0" placeholderTextColor="#bbb" />
            </View>
            <View style={styles.inputLigne}>
              <Text style={styles.inputLabel}>Payé</Text>
              <TextInput style={styles.inputField} value={newFourPaye} onChangeText={setNewFourPaye}
                keyboardType="numeric" placeholder="0" placeholderTextColor="#bbb" />
            </View>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
              <TouchableOpacity style={[styles.saveBtn, { flex: 1, backgroundColor: '#f5f5f5', marginTop: 0 }]}
                onPress={() => setShowAddFour(false)}>
                <Text style={[styles.saveTxt, { color: '#888' }]}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.saveBtn, { flex: 2, backgroundColor: '#EF9F27', marginTop: 0 }]}
                onPress={ajouterFournisseur}>
                <Text style={[styles.saveTxt, { color: '#412402' }]}>✅ Ajouter</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : disponibles.length > 0 && (
          <TouchableOpacity style={[styles.saveBtn, { backgroundColor: '#f5f5f5', borderWidth: 1, borderColor: '#EF9F27' }]}
            onPress={() => setShowAddFour(true)}>
            <Text style={[styles.saveTxt, { color: '#EF9F27' }]}>+ Ajouter un fournisseur</Text>
          </TouchableOpacity>
        )}

        {transactions.length > 0 && (
          <TouchableOpacity style={styles.saveBtn} onPress={sauverFournisseurs}>
            <Text style={styles.saveTxt}>💾 Enregistrer les fournisseurs</Text>
          </TouchableOpacity>
        )}
        <View style={{ height: 40 }} />
      </ScrollView>
    )
  }

  function renderPresences() {
    return (
      <ScrollView showsVerticalScrollIndicator={false}>
        {presences.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyTxt}>Aucune présence enregistrée</Text>
          </View>
        ) : presences.map((p, i) => (
          <View key={i} {...focus.props(p.id)} style={[styles.presenceCard, focus.style(p.id)]}>
            <View style={styles.presenceHeader}>
              <View style={styles.avatar}>
                <Text style={styles.avatarTxt}>
                  {(p.travailleur_nom || 'T').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.presenceNom}>{p.travailleur_nom}</Text>
                <Text style={styles.presenceStatut}>{p.statut}</Text>
              </View>
            </View>
            <View style={styles.inputLigne}>
              <Text style={styles.inputLabel}>Paie</Text>
              <TextInput
                style={styles.inputField}
                value={String(p.paye || '')}
                onChangeText={v => {
                  const newPres = [...presences]
                  newPres[i] = { ...newPres[i], paye: parseFloat(v) || 0 }
                  setPresences(newPres)
                }}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor="#bbb"
              />
            </View>
          </View>
        ))}

        <View style={styles.recapCard}>
          <View style={[styles.resumeRow, { borderBottomWidth: 0 }]}>
            <Text style={[styles.recapLabel, { fontWeight: '600' }]}>Total paie</Text>
            <Text style={[styles.recapValue, { color: '#EF9F27', fontWeight: '600', fontSize: 15 }]}>
              {fmt(presences.reduce((s, p) => s + (p.paye || 0), 0))}
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={styles.saveBtn}
          onPress={async () => {
            setLoading(true)
            let errMsg = null
            for (const p of presences) {
              if (!p.id) continue
              const { data: r, error } = await supabase
                .from('presences')
                .update({ paye: p.paye })
                .eq('id', p.id)
                .select('id')
              if (error) { errMsg = error.message; break }
              if (!r?.length) { errMsg = `Modification refusée pour "${p.travailleur_nom || 'employé'}" (droits insuffisants).`; break }
            }
            setLoading(false)
            if (errMsg) { Alert.alert('Erreur', errMsg); return }
            Alert.alert('✅ Sauvegardé', 'Présences enregistrées dans la base de données !')
          }}
        >
          <Text style={styles.saveTxt}>💾 Enregistrer les présences</Text>
        </TouchableOpacity>
        <View style={{ height: 40 }} />
      </ScrollView>
    )
  }

  function renderDepGerant() {
    const gerantShift = shifts.find(s => s.caissier_id === point?.gerant_id)

    function renderSubGerantA() {
      if (!gerantShift) {
        return (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyTxt}>Aucun shift gérant identifié{'\n'}(gerant_id non renseigné sur ce point)</Text>
          </View>
        )
      }
      const details = shiftDetails[gerantShift.id]
      if (!details) {
        return (
          <View style={{ alignItems: 'center', paddingVertical: 30 }}>
            <TouchableOpacity style={styles.saveBtn} onPress={() => chargerDetailShift(gerantShift)}>
              <Text style={styles.saveTxt}>Charger les détails du gérant</Text>
            </TouchableOpacity>
          </View>
        )
      }
      if (details.loading) return <ActivityIndicator color={colors.primary} style={{ margin: 30 }} />
      const { depenses: gDeps, fournisseurs: gFourns } = details
      const totalDep = gDeps.reduce((s, d) => s + (d.montant || 0), 0)
      const totalFourn = gFourns.reduce((s, t) => s + (t.paye || 0), 0)
      return (
        <>
          <Text style={styles.sectionTitre}>Shift du gérant — {gerantShift.heure_debut} → {gerantShift.heure_fin}</Text>
          <View style={styles.card}>
            <View style={styles.resumeRow}>
              <Text style={styles.resumeLabel}>Vente shift actuelle</Text>
              <Text style={[styles.resumeValue, { color: '#EF9F27' }]}>{fmt(gerantShift.vente_shift || 0)}</Text>
            </View>
          </View>

          <Text style={styles.sectionTitre}>Dépenses ({gDeps.length})</Text>
          <View style={styles.card}>
            {gDeps.length === 0 ? (
              <Text style={styles.emptyTxt}>Aucune dépense pour ce shift</Text>
            ) : gDeps.map((d, di) => (
              <View key={d.id || di} style={styles.depLigneBlock}>
                <Text style={{ fontSize: 10, color: '#534AB7', marginBottom: 2 }}>{d.categorie}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View style={{ flex: 1 }}>
                    <TextInput
                      style={styles.libellInput}
                      value={d.libelle || ''}
                      onChangeText={v => setShiftDetails(prev => ({
                        ...prev,
                        [gerantShift.id]: { ...prev[gerantShift.id], depenses: prev[gerantShift.id].depenses.map((dd, idx) => idx === di ? { ...dd, libelle: v } : dd) },
                      }))}
                      placeholder="Description" placeholderTextColor="#bbb"
                    />
                  </View>
                  <TextInput
                    style={[styles.inputField, { width: 90 }]}
                    value={String(d.montant || '')}
                    onChangeText={v => setShiftDetails(prev => ({
                      ...prev,
                      [gerantShift.id]: { ...prev[gerantShift.id], depenses: prev[gerantShift.id].depenses.map((dd, idx) => idx === di ? { ...dd, montant: parseFloat(v) || 0 } : dd) },
                    }))}
                    keyboardType="numeric" placeholder="0" placeholderTextColor="#bbb"
                  />
                </View>
              </View>
            ))}
            {gDeps.length > 0 && (
              <View style={styles.catTotal}>
                <Text style={styles.catTotalLabel}>Total dépenses</Text>
                <Text style={styles.catTotalValue}>{fmt(totalDep)}</Text>
              </View>
            )}
          </View>

          <Text style={styles.sectionTitre}>Fournisseurs ({gFourns.length})</Text>
          <View style={styles.card}>
            {gFourns.length === 0 ? (
              <Text style={styles.emptyTxt}>Aucun fournisseur pour ce shift</Text>
            ) : gFourns.map((t, ti) => (
              <View key={t.id || ti} style={styles.depLigneBlock}>
                <Text style={{ fontSize: 11, fontWeight: '600', color: colors.text, marginBottom: 4 }}>
                  {t.fournisseurs?.nom || `Fournisseur ${ti + 1}`}
                </Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 10, color: colors.textMuted, marginBottom: 2 }}>Facture</Text>
                    <TextInput
                      style={[styles.inputField, { width: '100%', textAlign: 'left' }]}
                      value={String(t.facture || '')}
                      onChangeText={v => setShiftDetails(prev => ({
                        ...prev,
                        [gerantShift.id]: { ...prev[gerantShift.id], fournisseurs: prev[gerantShift.id].fournisseurs.map((tt, idx) => idx === ti ? { ...tt, facture: parseFloat(v) || 0 } : tt) },
                      }))}
                      keyboardType="numeric" placeholder="0" placeholderTextColor="#bbb"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 10, color: colors.textMuted, marginBottom: 2 }}>Payé</Text>
                    <TextInput
                      style={[styles.inputField, { width: '100%', textAlign: 'left' }]}
                      value={String(t.paye || '')}
                      onChangeText={v => setShiftDetails(prev => ({
                        ...prev,
                        [gerantShift.id]: { ...prev[gerantShift.id], fournisseurs: prev[gerantShift.id].fournisseurs.map((tt, idx) => idx === ti ? { ...tt, paye: parseFloat(v) || 0 } : tt) },
                      }))}
                      keyboardType="numeric" placeholder="0" placeholderTextColor="#bbb"
                    />
                  </View>
                </View>
              </View>
            ))}
            {gFourns.length > 0 && (
              <View style={styles.catTotal}>
                <Text style={styles.catTotalLabel}>Total fournisseurs</Text>
                <Text style={styles.catTotalValue}>{fmt(totalFourn)}</Text>
              </View>
            )}
          </View>

          <TouchableOpacity style={styles.saveBtn} onPress={() => sauverDepFournGerantShift(gerantShift)}>
            <Text style={styles.saveTxt}>💾 Enregistrer & recalculer vente</Text>
          </TouchableOpacity>
        </>
      )
    }

    function renderSubGerantB() {
      if (loadingGerant) return <ActivityIndicator color={colors.primary} style={{ margin: 30 }} />
      const totalDraftDep = depGerant.reduce((s, d) => s + (d.montant || 0), 0)
      const totalFournG = fournGerant.reduce((s, t) => s + (t.paye || 0), 0)
      const totalGerant = totalDraftDep + totalFournG
      return (
        <>
          <Text style={styles.sectionTitre}>Dépenses gérant (depuis validation)</Text>
          <View style={styles.card}>
            {depGerant.length === 0 ? (
              <Text style={styles.emptyTxt}>Aucune dépense gérant enregistrée</Text>
            ) : Object.entries(
                depGerant.reduce((acc, d) => { acc[d.categorie] = (acc[d.categorie] || 0) + d.montant; return acc }, {})
              ).map(([cat, tot], i) => (
              <View key={i} style={styles.resumeRow}>
                <Text style={styles.resumeLabel}>{cat}</Text>
                <Text style={styles.resumeValue}>{fmt(tot)}</Text>
              </View>
            ))}
            {depGerant.length > 0 && (
              <View style={styles.catTotal}>
                <Text style={styles.catTotalLabel}>Sous-total</Text>
                <Text style={styles.catTotalValue}>{fmt(totalDraftDep)}</Text>
              </View>
            )}
          </View>

          <Text style={styles.sectionTitre}>Fournisseurs gérant ({fournGerant.length})</Text>
          <View style={styles.card}>
            {fournGerant.length === 0 ? (
              <Text style={styles.emptyTxt}>Aucun fournisseur gérant</Text>
            ) : fournGerant.map((t, i) => (
              <View key={t.id || i} style={styles.depLigneBlock}>
                <Text style={{ fontSize: 11, fontWeight: '600', color: colors.text, marginBottom: 4 }}>
                  {t.fournisseurs?.nom || `Fournisseur ${i + 1}`}
                </Text>
                <View style={styles.inputLigne}>
                  <Text style={styles.inputLabel}>Facture</Text>
                  <TextInput
                    style={styles.inputField}
                    value={String(t.facture || '')}
                    onChangeText={v => setFournGerant(prev => prev.map((tt, idx) => idx === i ? { ...tt, facture: parseFloat(v) || 0 } : tt))}
                    keyboardType="numeric" placeholder="0" placeholderTextColor="#bbb"
                  />
                </View>
                <View style={styles.inputLigne}>
                  <Text style={styles.inputLabel}>Payé</Text>
                  <TextInput
                    style={styles.inputField}
                    value={String(t.paye || '')}
                    onChangeText={v => setFournGerant(prev => prev.map((tt, idx) => idx === i ? { ...tt, paye: parseFloat(v) || 0 } : tt))}
                    keyboardType="numeric" placeholder="0" placeholderTextColor="#bbb"
                  />
                </View>
              </View>
            ))}
          </View>

          <View style={styles.recapCard}>
            <Text style={styles.recapTitre}>Total déductions gérant</Text>
            <View style={styles.resumeRow}>
              <Text style={styles.recapLabel}>Dépenses gérant</Text>
              <Text style={styles.recapValue}>{fmt(totalDraftDep)}</Text>
            </View>
            <View style={styles.resumeRow}>
              <Text style={styles.recapLabel}>Fournisseurs gérant</Text>
              <Text style={styles.recapValue}>{fmt(totalFournG)}</Text>
            </View>
            <View style={[styles.resumeRow, { borderBottomWidth: 0 }]}>
              <Text style={[styles.recapLabel, { fontWeight: '600' }]}>Total</Text>
              <Text style={[styles.recapValue, { color: '#EF9F27', fontWeight: '600' }]}>{fmt(totalGerant)}</Text>
            </View>
          </View>

          <TouchableOpacity style={[styles.saveBtn, { backgroundColor: '#534AB7' }]} onPress={sauverDeductionsGerant}>
            <Text style={styles.saveTxt}>💾 Enregistrer (impact espèces uniquement)</Text>
          </TouchableOpacity>
        </>
      )
    }

    return (
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={styles.subTabRow}>
          <TouchableOpacity
            style={[styles.subTabBtn, subGerant === 'A' && styles.subTabBtnActive]}
            onPress={() => {
              setSubGerant('A')
              if (gerantShift && !shiftDetails[gerantShift.id]) chargerDetailShift(gerantShift)
            }}
          >
            <Text style={[styles.subTabTxt, subGerant === 'A' && styles.subTabTxtActive]}>Gérant caissier</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.subTabBtn, subGerant === 'B' && styles.subTabBtnActive]}
            onPress={() => { setSubGerant('B'); chargerDepGerant() }}
          >
            <Text style={[styles.subTabTxt, subGerant === 'B' && styles.subTabTxtActive]}>Déductions gérant</Text>
          </TouchableOpacity>
        </View>
        {subGerant === 'A' && renderSubGerantA()}
        {subGerant === 'B' && renderSubGerantB()}
        <View style={{ height: 40 }} />
      </ScrollView>
    )
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => {
          if (etape > 1) setEtape(etape - 1)
          else if (router.canGoBack()) router.back()
          else router.replace('/accueil')
        }}>
          <Text style={styles.back}>‹ Retour</Text>
        </TouchableOpacity>
        <View>
          <Text style={styles.headerTitre}>Modifier un point</Text>
          <Text style={styles.headerSub}>
            {etape === 1 ? 'Choisir le restaurant' : etape === 2 ? 'Choisir la date' : formatDate(selectedDate)}
          </Text>
        </View>
        <View style={{ width: 60 }} />
      </View>

      <View style={styles.stepBar}>
        {['Restaurant', 'Date', 'Données'].map((s, i) => (
          <View key={i} style={styles.stepItem}>
            <View style={[styles.stepNum, etape > i + 1 && styles.stepDone, etape === i + 1 && styles.stepActive]}>
              <Text style={styles.stepNumTxt}>{etape > i + 1 ? '✓' : i + 1}</Text>
            </View>
            <Text style={[styles.stepLabel, etape === i + 1 && styles.stepLabelActive]}>{s}</Text>
            {i < 2 && <View style={styles.stepLine} />}
          </View>
        ))}
      </View>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#534AB7" />
        </View>
      ) : (
        <>
          {/* ETAPE 1 */}
          {etape === 1 && (
            <ScrollView style={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={styles.sectionTitre}>Choisissez un restaurant</Text>
              {restaurants.map(r => (
                <TouchableOpacity
                  key={r.id}
                  style={styles.restoCard}
                  onPress={() => {
                    setSelectedResto(r)
                    chargerDatesAvec(r.id)
                    setEtape(2)
                  }}
                >
                  <View style={[styles.restoDot, { backgroundColor: r.couleur === 'vert' ? '#2D7D46' : '#EF9F27' }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.restoNom}>{r.nom}</Text>
                    <Text style={styles.restoSub}>{r.localisation || 'Abidjan'}</Text>
                  </View>
                  <Text style={styles.restoArrow}>›</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          {/* ETAPE 2 */}
          {etape === 2 && (
            <ScrollView style={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={styles.sectionTitre}>{selectedResto?.nom}</Text>
              <View style={styles.legendeRow}>
                <View style={styles.legendeItem}>
                  <View style={[styles.legendeDot, { backgroundColor: '#3B6D11' }]} />
                  <Text style={styles.legendeTxt}>Point validé</Text>
                </View>
                <View style={styles.legendeItem}>
                  <View style={[styles.legendeDot, { backgroundColor: '#EF9F27' }]} />
                  <Text style={styles.legendeTxt}>Point en cours</Text>
                </View>
              </View>
              <View style={[styles.calendar, { overflow: 'hidden' }]}>
                <CalendrierFr valeur={selectedDate || ''} marques={datesAvec} maxDate={new Date().toISOString().split('T')[0]} couleur="#534AB7"
                  onChoisir={iso => { setSelectedDate(iso); chargerPoint(selectedResto.id, iso) }} />
              </View>
            </ScrollView>
          )}

          {/* ETAPE 3 — Onglets */}
          {etape === 3 && point && (
            <>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[styles.ongletBar, { flexGrow: 0 }]}>
                {ONGLETS.map(o => (
                  <TouchableOpacity
                    key={o}
                    style={[styles.ongletBtn, ongletActif === o && styles.ongletBtnActive]}
                    onPress={() => {
                      setOngletActif(o)
                      if (o === 'Dép. Gérant') {
                        const gs = shifts.find(s => s.caissier_id === point?.gerant_id)
                        if (gs && !shiftDetails[gs.id]) chargerDetailShift(gs)
                        if (depGerant.length === 0 && fournGerant.length === 0) chargerDepGerant()
                      }
                    }}
                  >
                    <Text style={[styles.ongletTxt, ongletActif === o && styles.ongletTxtActive]}>{o}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {estJourneeImportee(point) && (
                <View style={styles.bandeauImport}>
                  <Text style={styles.bandeauImportTxt}>
                    🔒 Journée importée des anciens sheets : consultation seulement, aucune modification possible.
                  </Text>
                </View>
              )}

              <View style={styles.body}>
                {ongletActif === 'Résumé' && renderResume()}
                {ongletActif === 'Shifts' && renderShifts()}
                {ongletActif === 'Ventes' && renderVentes()}
                {ongletActif === 'Dépenses' && renderDepenses()}
                {ongletActif === 'Fournisseurs' && renderFournisseurs()}
                {ongletActif === 'Présences' && renderPresences()}
                {ongletActif === 'Dép. Gérant' && renderDepGerant()}
              </View>
            </>
          )}
        </>
      )}

      {/* Toast recalcul automatique */}
      {recalcMsg && (
        <View style={styles.recalcToast}>
          <Text style={styles.recalcToastTxt}>{recalcMsg}</Text>
        </View>
      )}

      {/* Modal confirmation suppression individuelle */}
      <Modal visible={!!confirmSupprShift} transparent animationType="fade">
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmBox}>
            <Text style={styles.confirmTitre}>Supprimer ce shift ?</Text>
            <Text style={styles.confirmMsg}>
              {confirmSupprShift?.caissier_nom ? `👤 ${confirmSupprShift.caissier_nom}\n` : ''}
              {confirmSupprShift ? `⏰ ${confirmSupprShift.heure_debut} → ${confirmSupprShift.heure_fin}\n\n` : ''}
              Cette action est irréversible.
            </Text>
            <View style={styles.confirmBtns}>
              <TouchableOpacity style={styles.confirmCancel} onPress={() => setConfirmSupprShift(null)} disabled={suppressionEnCours}>
                <Text style={styles.confirmCancelTxt}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmOk, suppressionEnCours && { opacity: 0.6 }]}
                onPress={() => supprimerShift(confirmSupprShift)}
                disabled={suppressionEnCours}
              >
                {suppressionEnCours
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.confirmOkTxt}>🗑️ Confirmer</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal confirmation suppression multiple */}
      <Modal visible={confirmSupprMultiple} transparent animationType="fade">
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmBox}>
            <Text style={styles.confirmTitre}>Supprimer {shiftsSelectionnes.size} shift(s) ?</Text>
            <Text style={styles.confirmMsg}>
              Toutes les données liées (présences, dépenses, fournisseurs) seront supprimées.{'\n\n'}Cette action est irréversible.
            </Text>
            <View style={styles.confirmBtns}>
              <TouchableOpacity style={styles.confirmCancel} onPress={() => setConfirmSupprMultiple(false)}>
                <Text style={styles.confirmCancelTxt}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmOk} onPress={supprimerShiftsMultiples}>
                <Text style={styles.confirmOkTxt}>🗑️ Supprimer tout</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal suppression dépense */}
      <Modal visible={!!confirmSupprDep} transparent animationType="fade">
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmBox}>
            <Text style={styles.confirmTitre}>Supprimer cette dépense ?</Text>
            <Text style={styles.confirmMsg}>
              {confirmSupprDep?.libelle || 'Sans libellé'} — {confirmSupprDep ? fmt(confirmSupprDep.montant || 0) : ''}{'\n\n'}Cette action est irréversible.
            </Text>
            <View style={styles.confirmBtns}>
              <TouchableOpacity style={styles.confirmCancel} onPress={() => setConfirmSupprDep(null)}>
                <Text style={styles.confirmCancelTxt}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.confirmOk, loading && { opacity: 0.6 }]}
                onPress={() => supprimerDepense(confirmSupprDep)} disabled={loading}>
                {loading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.confirmOkTxt}>🗑️ Confirmer</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal suppression transaction fournisseur */}
      <Modal visible={!!confirmSupprTrans} transparent animationType="fade">
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmBox}>
            <Text style={styles.confirmTitre}>Supprimer ce fournisseur ?</Text>
            <Text style={styles.confirmMsg}>
              {confirmSupprTrans?.fournisseurs?.nom || 'Fournisseur'}{'\n'}Facture : {confirmSupprTrans ? fmt(confirmSupprTrans.facture || 0) : ''} — Payé : {confirmSupprTrans ? fmt(confirmSupprTrans.paye || 0) : ''}{'\n\n'}Cette action est irréversible.
            </Text>
            <View style={styles.confirmBtns}>
              <TouchableOpacity style={styles.confirmCancel} onPress={() => setConfirmSupprTrans(null)}>
                <Text style={styles.confirmCancelTxt}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.confirmOk, loading && { opacity: 0.6 }]}
                onPress={() => supprimerTransaction(confirmSupprTrans)} disabled={loading}>
                {loading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.confirmOkTxt}>🗑️ Confirmer</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal déplacement de shift */}
      <Modal visible={!!showMoveShift} transparent animationType="slide">
        <View style={styles.confirmOverlay}>
          <View style={[styles.confirmBox, { maxHeight: '80%' }]}>
            <Text style={styles.confirmTitre}>📅 Déplacer ce shift</Text>
            <Text style={[styles.confirmMsg, { marginBottom: 8 }]}>
              {showMoveShift?.caissier_nom ? `👤 ${showMoveShift.caissier_nom}\n` : ''}
              {showMoveShift ? `⏰ ${showMoveShift.heure_debut} → ${showMoveShift.heure_fin}` : ''}
              {'\n\n'}Choisissez la date cible :
              {point?.valide ? '\n\n⚠️ Le point source est validé — la modification sera quand même effectuée.' : ''}
            </Text>
            <View style={{ borderRadius: 12, marginBottom: 16, overflow: 'hidden' }}>
              <CalendrierFr valeur={moveDateCible || ''} initial={selectedDate || undefined} couleur="#534AB7"
                marques={selectedDate ? { [selectedDate]: { marked: true, dotColor: '#EF9F27' } } : {}}
                maxDate={new Date().toISOString().split('T')[0]}
                onChoisir={iso => setMoveDateCible(iso)} />
            </View>
            {moveDateCible ? (
              <Text style={{ fontSize: 13, color: '#534AB7', fontWeight: '600', textAlign: 'center', marginBottom: 12 }}>
                Date sélectionnée : {moveDateCible}
              </Text>
            ) : null}
            <View style={styles.confirmBtns}>
              <TouchableOpacity style={styles.confirmCancel} onPress={() => { setShowMoveShift(null); setMoveDateCible('') }} disabled={deplacement}>
                <Text style={styles.confirmCancelTxt}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmOk, { backgroundColor: moveDateCible ? '#534AB7' : '#ccc' }, deplacement && { opacity: 0.6 }]}
                onPress={() => moveDateCible && deplacerShift(showMoveShift, moveDateCible)}
                disabled={!moveDateCible || deplacement}
              >
                {deplacement
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.confirmOkTxt}>📅 Déplacer</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal confirmation sauvegarde ventes */}
      <Modal visible={!!confirmSauvegarder} transparent animationType="fade">
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmBox}>
            <Text style={styles.confirmTitre}>Confirmer la modification</Text>
            <Text style={styles.confirmMsg}>
              Ventes : {fmt(val(form.vente_total))}{'\n'}
              Dépenses : {fmt(val(form.depense_total))}{'\n'}
              Bénéfice SC : {fmt(beneficeSC())}{'\n\n'}
              Modifier ce point ?
            </Text>
            <View style={styles.confirmBtns}>
              <TouchableOpacity style={styles.confirmCancel} onPress={() => setConfirmSauvegarder(null)}>
                <Text style={styles.confirmCancelTxt}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmOk, { backgroundColor: '#534AB7' }]}
                onPress={confirmerSauvegarder}
              >
                <Text style={styles.confirmOkTxt}>💾 Confirmer</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

function makeStyles(colors) { return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { backgroundColor: colors.headerBg, padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: { fontSize: 16, color: colors.primaryText, fontWeight: '500' },
  headerTitre: { fontSize: 16, fontWeight: '600', color: colors.surface, textAlign: 'center' },
  headerSub: { fontSize: 11, color: colors.primaryText, textAlign: 'center' },
  stepBar: { flexDirection: 'row', backgroundColor: colors.surface, padding: 14, borderBottomWidth: 0.5, borderBottomColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  stepItem: { flexDirection: 'row', alignItems: 'center' },
  stepNum: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', marginRight: 6, borderWidth: 0.5, borderColor: colors.border },
  stepDone: { backgroundColor: colors.primary },
  stepActive: { backgroundColor: colors.primary },
  stepNumTxt: { fontSize: 11, fontWeight: '600', color: colors.surface },
  stepLine: { width: 30, height: 1, backgroundColor: colors.border, marginHorizontal: 6 },
  stepLabel: { fontSize: 11, color: colors.textMuted, marginRight: 6 },
  stepLabelActive: { color: colors.primary, fontWeight: '600' },
  ongletBar: { backgroundColor: colors.surface, maxHeight: 46, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  ongletBtn: { paddingHorizontal: 16, paddingVertical: 12 },
  ongletBtnActive: { borderBottomWidth: 2, borderBottomColor: colors.primary },
  ongletTxt: { fontSize: 13, color: colors.textMuted },
  ongletTxtActive: { color: colors.primary, fontWeight: '600' },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, padding: 14 },
  sectionTitre: { fontSize: 12, fontWeight: '600', color: colors.textMuted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 8 },
  restoCard: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 0.5, borderColor: colors.border },
  restoDot: { width: 12, height: 12, borderRadius: 6 },
  restoNom: { fontSize: 14, fontWeight: '600', color: colors.text },
  restoSub: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  restoArrow: { fontSize: 18, color: '#ccc' },
  legendeRow: { flexDirection: 'row', gap: 16, marginBottom: 12 },
  legendeItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendeDot: { width: 10, height: 10, borderRadius: 5 },
  legendeTxt: { fontSize: 11, color: colors.textMuted },
  calendar: { borderRadius: 14, borderWidth: 0.5, borderColor: colors.border, marginBottom: 14 },
  infoBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 12, padding: 12, marginBottom: 14, borderWidth: 0.5, borderColor: colors.border },
  infoBarTxt: { fontSize: 13, fontWeight: '600', color: colors.text },
  valideBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  valideTxt: { fontSize: 11, fontWeight: '500' },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  kpiCard: { flexBasis: '45%', flexGrow: 1, minWidth: 140, backgroundColor: colors.surface, borderRadius: 12, padding: 12, borderWidth: 0.5, borderColor: colors.border },
  kpiLabel: { fontSize: 10, color: colors.textMuted, marginBottom: 4 },
  kpiValue: { fontSize: 14, fontWeight: '600' },
  card: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, marginBottom: 14, borderWidth: 0.5, borderColor: colors.border },
  resumeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 0.5, borderBottomColor: '#f5f5f5' },
  resumeLabel: { fontSize: 13, color: colors.textMuted, flex: 1 },
  resumeValue: { fontSize: 13, fontWeight: '500', color: colors.text },
  inputLigne: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: '#f5f5f5' },
  inputLabel: { fontSize: 13, color: colors.textSecondary, flex: 1 },
  inputField: { width: 130, backgroundColor: colors.bg, borderRadius: 8, padding: 8, fontSize: 14, color: colors.text, textAlign: 'right' },
  catTotal: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 10, marginTop: 4 },
  catTotalLabel: { fontSize: 13, fontWeight: '600', color: colors.text },
  catTotalValue: { fontSize: 14, fontWeight: '600', color: '#EF9F27' },
  recapCard: { backgroundColor: colors.orangeLight, borderRadius: 14, padding: 14, marginBottom: 14 },
  recapTitre: { fontSize: 13, fontWeight: '600', color: colors.orangeDark, marginBottom: 10 },
  recapLabel: { fontSize: 13, color: colors.orangeDark, flex: 1 },
  recapValue: { fontSize: 13, fontWeight: '500' },
  fournCard: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 0.5, borderColor: colors.border },
  fournNom: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: 8 },
  presenceCard: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 0.5, borderColor: colors.border },
  presenceHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#EF9F27', alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontSize: 13, fontWeight: '600', color: '#fff' },
  presenceNom: { fontSize: 14, fontWeight: '600', color: colors.text },
  presenceStatut: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  emptyBox: { alignItems: 'center', paddingVertical: 30 },
  emptyTxt: { fontSize: 13, color: colors.textMuted, textAlign: 'center' },
  saveBtn: { backgroundColor: colors.primary, borderRadius: 14, padding: 16, alignItems: 'center', marginBottom: 10, marginTop: 8 },
  saveTxt: { fontSize: 15, fontWeight: '600', color: colors.surface },
  fourChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: colors.bg, marginRight: 8, borderWidth: 1, borderColor: colors.border },
  fourChipActive: { backgroundColor: '#EF9F27', borderColor: '#BA7517' },
  fourChipTxt: { fontSize: 13, color: colors.textMuted },
  fourChipTxtActive: { color: '#412402', fontWeight: '600' },
  warningBanner: { backgroundColor: '#FAECE7', borderRadius: 12, padding: 12, marginBottom: 12, borderWidth: 0.5, borderColor: '#F09595' },
  warningTxt: { fontSize: 13, color: '#A32D2D', textAlign: 'center' },
  selectionBar: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginBottom: 10 },
  selBtnActiver: { backgroundColor: colors.inputBg, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  selBtnActiverTxt: { fontSize: 13, color: colors.text, fontWeight: '500' },
  selBtnTout: { backgroundColor: '#E6F1FB', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  selBtnToutTxt: { fontSize: 13, color: '#185FA5', fontWeight: '500' },
  selBtnAnnuler: { backgroundColor: colors.inputBg, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  selBtnAnnulerTxt: { fontSize: 13, color: colors.textMuted },
  shiftCard: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 0.5, borderColor: colors.border },
  shiftCardSelected: { borderColor: '#EF9F27', borderWidth: 2, backgroundColor: '#FFF8ED' },
  shiftNumBox: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#EF9F27', alignItems: 'center', justifyContent: 'center' },
  shiftNumTxt: { fontSize: 12, fontWeight: '600', color: '#412402' },
  checkbox: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: colors.border, backgroundColor: colors.inputBg, alignItems: 'center', justifyContent: 'center' },
  checkboxSelected: { backgroundColor: '#EF9F27', borderColor: '#EF9F27' },
  checkboxCheck: { fontSize: 14, fontWeight: '700', color: '#fff' },
  supprimerBtn: { backgroundColor: '#FAECE7', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 0.5, borderColor: '#F09595' },
  supprimerBtnRond: { backgroundColor: '#FAECE7', borderRadius: 8, padding: 6, borderWidth: 0.5, borderColor: '#F09595' },
  supprimerBtnTxt: { fontSize: 11, color: '#A32D2D', fontWeight: '500' },
  btnSupprimerSel: { backgroundColor: '#A32D2D', borderRadius: 14, padding: 16, alignItems: 'center' },
  btnSupprimerSelTxt: { fontSize: 15, fontWeight: '600', color: '#fff' },
  editBtn: { backgroundColor: '#E6F1FB', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 0.5, borderColor: '#B8D4F5' },
  editBtnTxt: { fontSize: 11, color: '#185FA5', fontWeight: '500' },
  moveBtn: { backgroundColor: '#EEF0FF', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 0.5, borderColor: '#C5C8F5' },
  moveBtnTxt: { fontSize: 11, color: '#534AB7', fontWeight: '500' },
  shiftCardEditing: { borderColor: '#185FA5', borderWidth: 1.5, backgroundColor: '#F5F8FF' },
  shiftEditPanel: { marginTop: 12, paddingTop: 12, borderTopWidth: 0.5, borderTopColor: '#eee' },
  shiftVenteCalc: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, backgroundColor: '#FFF8ED', borderRadius: 10, padding: 10 },
  shiftVenteCalcLabel: { fontSize: 13, fontWeight: '600', color: '#854F0B' },
  shiftVenteCalcVal: { fontSize: 15, fontWeight: '700', color: '#EF9F27' },
  shiftSubSection: { marginTop: 10, paddingTop: 10, borderTopWidth: 0.5, borderTopColor: '#eee' },
  shiftSubTitre: { fontSize: 10, fontWeight: '600', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4, marginTop: 6 },
  shiftSubRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 3 },
  shiftSubLabel: { flex: 1, fontSize: 12, color: colors.textSecondary },
  shiftSubVal: { fontSize: 12, fontWeight: '500', color: colors.text },
  recalcToast: {
    position: 'absolute', bottom: 80, left: 16, right: 16,
    backgroundColor: '#1C3A1A', borderRadius: 14, padding: 14,
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 8, elevation: 8,
  },
  recalcToastTxt: { fontSize: 13, color: '#A8E6A3', fontWeight: '500', textAlign: 'center' },
  bandeauImport: {
    marginHorizontal: 16, marginTop: 10, padding: 12, borderRadius: 12,
    backgroundColor: colors.warningLight || '#FDF3E0', borderWidth: 1, borderColor: '#EFC97F',
  },
  bandeauImportTxt: { fontSize: 13, color: '#8A6220', fontWeight: '600', textAlign: 'center' },
  depLigneBlock: { paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: '#f5f5f5' },
  libellInput: { backgroundColor: colors.bg, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, fontSize: 13, color: colors.text },
  subTabRow: { flexDirection: 'row', backgroundColor: colors.bg, borderRadius: 10, padding: 3, marginBottom: 14, gap: 3 },
  subTabBtn: { flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: 'center' },
  subTabBtnActive: { backgroundColor: colors.surface, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  subTabTxt: { fontSize: 13, color: colors.textMuted },
  subTabTxtActive: { color: colors.primary, fontWeight: '600' },
  confirmOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  confirmBox: { backgroundColor: colors.surface, borderRadius: 18, padding: 24, width: '100%', maxWidth: 380 },
  confirmTitre: { fontSize: 17, fontWeight: '700', color: colors.text, marginBottom: 12 },
  confirmMsg: { fontSize: 14, color: colors.textSecondary, lineHeight: 22, marginBottom: 20 },
  confirmBtns: { flexDirection: 'row', gap: 10 },
  confirmCancel: { flex: 1, padding: 14, borderRadius: 12, backgroundColor: colors.inputBg, alignItems: 'center' },
  confirmCancelTxt: { fontSize: 14, color: colors.textMuted },
  confirmOk: { flex: 1, padding: 14, borderRadius: 12, backgroundColor: '#A32D2D', alignItems: 'center' },
  confirmOkTxt: { fontSize: 14, fontWeight: '600', color: '#fff' },
}) }
