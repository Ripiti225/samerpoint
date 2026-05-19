import { router } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator, Alert,
  Modal,
  SafeAreaView, ScrollView, StyleSheet,
  Text, TouchableOpacity, View
} from 'react-native'
import { useApp } from '../context/AppContext'
import { useTheme } from '../context/ThemeContext'
import { validerPoint } from '../lib/api'
import { envoyerNotifValidation } from '../lib/notifications'
import { creerNotification } from '../lib/notificationsInterne'
import { verifierEtGenererRapportHebdo } from '../lib/rapportHebdo'
import { sauvegarderSurOneDrive, estatConnecte } from '../lib/onedrive'
import { COEFFICIENTS } from '../lib/constants'
import { supabase } from '../lib/supabase'

const STATUT_COLORS = {
  'Présent': { bg: '#EAF3DE', text: '#3B6D11' },
  'Absent': { bg: '#FAECE7', text: '#993C1D' },
  'Repos': { bg: '#E6F1FB', text: '#185FA5' },
  'Congé': { bg: '#EEEDFE', text: '#3C3489' },
  'Malade': { bg: '#FAEEDA', text: '#854F0B' },
  'Permission': { bg: '#F1EFE8', text: '#444441' },
}

function getDateSemainePrecedente(dateStr) {
  const d = new Date(dateStr)
  d.setDate(d.getDate() - 7)
  return d.toISOString().split('T')[0]
}

function getDateMoisPrecedent(dateStr) {
  const d = new Date(dateStr)
  d.setMonth(d.getMonth() - 1)
  return d.toISOString().split('T')[0]
}

function calcVariation(today, ref) {
  if (!ref || ref === 0) return null
  return ((today - ref) / Math.abs(ref)) * 100
}

export default function RecapPointScreen() {
  const {
    pointId, dateJour,
    totalVentes, ventesJour,
    setPointValide, roleActif,
    depensesGerantCaisse, fournisseursGerantCaisse, paiesGerantCaisse,
    totalDepensesGerantCaisse,
    inventaireTermine,
    restaurantId, restaurantNom, userId,
  } = useApp()

  const isGerant = roleActif === 'gerant'
  const isManager = roleActif === 'manager'

  const [loading, setLoading] = useState(true)
  const [validating, setValidating] = useState(false)
  const [confirmVisible, setConfirmVisible] = useState(false)
  const [presences, setPresences] = useState([])
  const [depenses, setDepenses] = useState([])
  const [transactions, setTransactions] = useState([])
  const [fournisseurs, setFournisseurs] = useState([])
  const [shifts, setShifts] = useState([])
  const [cumulShifts, setCumulShifts] = useState(null)
  const [ongletRecap, setOngletRecap] = useState('resume') // 'resume' | 'depenses' | 'presences' | 'fournisseurs' | 'inventaire'
  const [inventairesShifts, setInventairesShifts] = useState([])
  const [comparaison, setComparaison] = useState(null)
  const [loadingComparaison, setLoadingComparaison] = useState(false)

  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])

  useEffect(() => { chargerDonnees() }, [pointId])

  async function chargerDonnees() {
    setLoading(true)
    if (!pointId) { setLoading(false); return }

    const [
      { data: presData },
      { data: depData },
      { data: transData },
      { data: shiftsData },
      { data: invShiftsData },
    ] = await Promise.all([
      supabase.from('presences').select('*').eq('point_id', pointId),
      supabase.from('depenses').select('*').eq('point_id', pointId),
      supabase.from('transactions_fournisseurs').select('*').eq('point_id', pointId),
      supabase.from('points_shifts').select('*').eq('point_id', pointId).order('created_at'),
      supabase.from('inventaires_shifts').select('*, inventaire_lignes(*)').eq('point_id', pointId).order('created_at'),
    ])

    setPresences(presData || [])
    setDepenses(depData || [])
    setTransactions(transData || [])
    setShifts(shiftsData || [])
    setInventairesShifts(invShiftsData || [])

    // Calculer cumul shifts
    if (shiftsData && shiftsData.length > 0) {
      setCumulShifts({
        depenses: shiftsData.reduce((sum, s) => sum + (s.depenses || 0), 0),
        fournisseurs: shiftsData.reduce((sum, s) => sum + (s.fournisseurs || 0), 0),
        kdo: shiftsData.reduce((sum, s) => sum + (s.kdo || 0), 0),
        retour: shiftsData.reduce((sum, s) => sum + (s.retour || 0), 0),
        yangoCse: shiftsData.reduce((sum, s) => sum + (s.yango_cse || 0), 0),
        glovoCse: shiftsData.reduce((sum, s) => sum + (s.glovo_cse || 0), 0),
        wave: shiftsData.reduce((sum, s) => sum + (s.wave || 0), 0),
        djamo: shiftsData.reduce((sum, s) => sum + (s.djamo || 0), 0),
        om: shiftsData.reduce((sum, s) => sum + (s.om || 0), 0),
        espece: shiftsData.reduce((sum, s) => sum + (s.espece || 0), 0),
        venteTotal: shiftsData.reduce((sum, s) => sum + (s.vente_shift || 0), 0),
        nbShifts: shiftsData.length,
      })
    }

    // Charger noms fournisseurs
    if (transData && transData.length > 0) {
      const ids = transData.map(t => t.fournisseur_id)
      const { data } = await supabase.from('fournisseurs').select('id, nom').in('id', ids)
      setFournisseurs(data || [])
    }

    if (restaurantId && dateJour) {
      chargerComparaison()
    }

    setLoading(false)
  }

  async function chargerComparaison() {
    if (!restaurantId || !dateJour) return
    setLoadingComparaison(true)
    const cols = 'vente_total, benefice_sc, depense_total, reste_especes, yango_cse, yango_tab, glovo_cse, glovo_tab'
    const dateSemaine = getDateSemainePrecedente(dateJour)
    const dateMois = getDateMoisPrecedent(dateJour)
    const [{ data: pointSemaine }, { data: pointMois }] = await Promise.all([
      supabase.from('points').select(cols).eq('restaurant_id', restaurantId).eq('valide', true).eq('date', dateSemaine).single(),
      supabase.from('points').select(cols).eq('restaurant_id', restaurantId).eq('valide', true).eq('date', dateMois).single(),
    ])
    setComparaison({ semaine: pointSemaine || null, mois: pointMois || null })
    setLoadingComparaison(false)
  }

  function getNomFournisseur(id) {
    return fournisseurs.find(f => String(f.id) === String(id))?.nom || 'Fournisseur'
  }

  function fmt(n) { return Math.round(n).toLocaleString('fr-FR') + ' FCFA' }

  function formatDate(dateStr) {
    if (!dateStr) return ''
    const [y, m, d] = dateStr.split('-')
    const mois = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
      'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
    return `${parseInt(d)} ${mois[parseInt(m) - 1]} ${y}`
  }

  // ─── Calculs dépenses ──────────────────────────────────────

  // Dépenses depuis la table depenses (caissier + gérant)
  function totalDepensesTable() {
    return depenses.reduce((sum, d) => sum + (d.montant || 0), 0)
  }

  // Paies depuis présences
  function totalPaiePresences() {
    return presences.reduce((sum, p) => sum + (p.paye || 0), 0)
  }

  // Fournisseurs depuis transactions
  function totalFournisseursTransactions() {
    return transactions.reduce((sum, t) => sum + (t.paye || 0), 0)
  }

  // Total dépenses global = shifts + gérant caisse
  function totalDepensesGlobal() {
    const gerantCaisse = totalDepensesGerantCaisse()
    if (cumulShifts) {
      // cumulShifts.depenses vient de totalDepenses() dans AppContext qui inclut DÉJÀ
      // totalDepensesCat() + totalPaie() + totalFournisseurs()
      // → ne PAS ajouter cumulShifts.fournisseurs ni paies (déjà comptés dedans)
      return cumulShifts.depenses + gerantCaisse
    }
    const paies = totalPaiePresences()
    return totalDepensesTable() + totalFournisseursTransactions() + paies + gerantCaisse
  }

  function resteEspecesCalc() {
    const deduc = totalDepensesGerantCaisse()
    if (cumulShifts) return cumulShifts.espece - deduc
    return totalVentes() - totalDepensesGlobal()
      - (parseFloat(ventesJour.yangoCse) || 0)
      - (parseFloat(ventesJour.glovoCse) || 0)
      - (parseFloat(ventesJour.wave) || 0)
      - (parseFloat(ventesJour.om) || 0)
      - (parseFloat(ventesJour.djamo) || 0)
      - (parseFloat(ventesJour.kdo) || 0)
      - (parseFloat(ventesJour.retour) || 0)
      - deduc
  }

  function fcCalc() {
    return resteEspecesCalc() + (parseFloat(ventesJour.fcVeille) || 0) + (parseFloat(ventesJour.fc_recu) || 0)
  }

  function beneficeSCCalc() {
    const yangoTab = parseFloat(ventesJour.yangoTab) || 0
    const glovoTab = parseFloat(ventesJour.glovoTab) || 0
    // OM/Wave/Djamo : caissier les saisit dans les shifts → cumulShifts
    //                 gérant les saisit dans ventesJour → fallback si cumulShifts = 0
    const om = (cumulShifts && cumulShifts.om > 0) ? cumulShifts.om : (parseFloat(ventesJour.om) || 0)
    const wave = (cumulShifts && cumulShifts.wave > 0) ? cumulShifts.wave : (parseFloat(ventesJour.wave) || 0)
    const djamo = (cumulShifts && cumulShifts.djamo > 0) ? cumulShifts.djamo : (parseFloat(ventesJour.djamo) || 0)
    return (yangoTab * COEFFICIENTS.YANGO)
      + (glovoTab * COEFFICIENTS.GLOVO)
      + (om * COEFFICIENTS.OM)
      + (wave * COEFFICIENTS.WAVE)
      + (djamo * COEFFICIENTS.DJAMO)
      + resteEspecesCalc()
  }

  function valider() {
    const invOk = inventaireTermine || inventairesShifts.some(s => s.valide)
    if (!invOk) {
      Alert.alert(
        '🔒 Inventaire requis',
        "L'inventaire du jour doit être complété et verrouillé avant de valider le point.\n\nAccédez au module Inventaire pour terminer la journée."
      )
      return
    }
    const yangoCseCumul = cumulShifts ? cumulShifts.yangoCse : (parseFloat(ventesJour.yangoCse) || 0)
    const glovoCseCumul = cumulShifts ? cumulShifts.glovoCse : (parseFloat(ventesJour.glovoCse) || 0)

    if (yangoCseCumul > 0) {
      if (!(parseFloat(ventesJour.yangoTab) > 0)) {
        Alert.alert('❌ Champ manquant', 'Yango CSE détecté — le montant Yango TAB est obligatoire avant de valider.')
        return
      }
      if (!(parseInt(ventesJour.yangoNbCommandes) > 0)) {
        Alert.alert('❌ Champ manquant', 'Yango CSE détecté — le nombre de commandes Yango est obligatoire avant de valider.')
        return
      }
    }
    if (glovoCseCumul > 0) {
      if (!(parseFloat(ventesJour.glovoTab) > 0)) {
        Alert.alert('❌ Champ manquant', 'Glovo CSE détecté — le montant Glovo TAB est obligatoire avant de valider.')
        return
      }
      if (!(parseInt(ventesJour.glovoNbCommandes) > 0)) {
        Alert.alert('❌ Champ manquant', 'Glovo CSE détecté — le nombre de commandes Glovo est obligatoire avant de valider.')
        return
      }
    }

    setConfirmVisible(true)
  }

  async function confirmerValider() {
    setConfirmVisible(false)
    setValidating(true)

    // Sauvegarder les dépenses caisse gérant (catégories + fournisseurs)
    await supabase.from('depenses_gerant_caisse').delete().eq('point_id', pointId)
    const lignesCat = Object.entries(depensesGerantCaisse).flatMap(([cat, lignes]) =>
      (lignes || [])
        .filter(d => parseFloat(d.montant) > 0)
        .map(d => ({
          point_id: pointId,
          categorie: cat,
          description: d.description || '',
          montant: parseFloat(d.montant) || 0,
          photo_url: d.photoUri || null,
        }))
    )
    const lignesFour = Object.entries(fournisseursGerantCaisse)
      .filter(([, f]) => parseFloat(f?.paye) > 0)
      .map(([, f]) => ({
        point_id: pointId,
        categorie: 'Fournisseur',
        description: f.nom || '',
        facture: f.facture || '',
        montant: parseFloat(f.paye) || 0,
        photo_url: f.photoUri || null,
      }))
    const lignesPaies = (paiesGerantCaisse || [])
      .filter(p => parseFloat(p.montant) > 0 && p.travailleur_id)
      .map(p => ({
        point_id: pointId,
        categorie: 'Paie',
        description: p.travailleur_nom || '',
        travailleur_id: p.travailleur_id,
        montant: parseFloat(p.montant) || 0,
        photo_url: null,
      }))
    const toutesLignes = [...lignesCat, ...lignesFour, ...lignesPaies]
    if (toutesLignes.length > 0) {
      await supabase.from('depenses_gerant_caisse').insert(toutesLignes)
    }

    // Synchroniser dépenses gérant → table depenses (visible dans vérification + modifier-point)
    await supabase.from('depenses').delete().eq('point_id', pointId).eq('saisi_par', 'gerant')
    const depGerantRows = [
      ...Object.entries(depensesGerantCaisse).flatMap(([cat, lignes]) =>
        (lignes || []).filter(d => parseFloat(d.montant) > 0).map(d => ({
          point_id: pointId,
          categorie: cat,
          libelle: d.description || cat,
          montant: parseFloat(d.montant) || 0,
          saisi_par: 'gerant',
          caissier_nom: 'Gérant',
        }))
      ),
      ...(paiesGerantCaisse || []).filter(p => parseFloat(p.montant) > 0 && p.travailleur_id).map(p => ({
        point_id: pointId,
        categorie: 'Paie',
        libelle: p.travailleur_nom || 'Paie gérant',
        montant: parseFloat(p.montant) || 0,
        saisi_par: 'gerant',
        caissier_nom: 'Gérant',
      })),
    ]
    if (depGerantRows.length > 0) {
      await supabase.from('depenses').insert(depGerantRows)
    }

    // Synchroniser fournisseurs gérant → transactions_fournisseurs
    await supabase.from('transactions_fournisseurs').delete().eq('point_id', pointId).eq('saisi_par', 'gerant')
    const fourGerantRows = Object.entries(fournisseursGerantCaisse)
      .filter(([, f]) => parseFloat(f?.paye) > 0 || parseFloat(f?.montant_facture) > 0)
      .map(([fournId, f]) => ({
        point_id: pointId,
        fournisseur_id: fournId,
        facture: parseFloat(f.montant_facture) || 0,
        paye: parseFloat(f.paye) || 0,
        reste: (parseFloat(f.credit_veille) || 0) + (parseFloat(f.montant_facture) || 0) - (parseFloat(f.paye) || 0),
        photo_url: f.photoUri || null,
        saisi_par: 'gerant',
      }))
    if (fourGerantRows.length > 0) {
      await supabase.from('transactions_fournisseurs').insert(fourGerantRows)
    }

    const venteTheo = cumulShifts?.venteTotal || totalVentes()
    const venteMachine = parseFloat(ventesJour.venteMachine) || null
    const ecartCaisse = venteMachine !== null ? venteTheo - venteMachine : null

    // ── 1. Validation avec les colonnes existantes ─────────
    const ok = await validerPoint(pointId, {
      vente_total: venteTheo,
      depense_total: totalDepensesGlobal(),
      kdo: cumulShifts ? cumulShifts.kdo : (parseFloat(ventesJour.kdo) || 0),
      retour: cumulShifts ? cumulShifts.retour : (parseFloat(ventesJour.retour) || 0),
      yango_cse: cumulShifts ? cumulShifts.yangoCse : (parseFloat(ventesJour.yangoCse) || 0),
      yango_tab: parseFloat(ventesJour.yangoTab) || 0,
      yango_nb_commandes: parseInt(ventesJour.yangoNbCommandes) || 0,
      glovo_cse: cumulShifts ? cumulShifts.glovoCse : (parseFloat(ventesJour.glovoCse) || 0),
      glovo_tab: parseFloat(ventesJour.glovoTab) || 0,
      glovo_nb_commandes: parseInt(ventesJour.glovoNbCommandes) || 0,
      wave: cumulShifts ? cumulShifts.wave : (parseFloat(ventesJour.wave) || 0),
      om: cumulShifts ? cumulShifts.om : (parseFloat(ventesJour.om) || 0),
      djamo: cumulShifts ? cumulShifts.djamo : (parseFloat(ventesJour.djamo) || 0),
      fc_veille: parseFloat(ventesJour.fcVeille) || 0,
      reste_especes: resteEspecesCalc(),
      reste_fc: fcCalc(),
      fc_compte: parseFloat(ventesJour.fc_recu) || 0,
      benefice_sc: beneficeSCCalc(),
    })

    // ── 2. Colonnes étendues (ignorées si pas encore créées) ─
    if (ok) {
      try {
        const extended = {}
        if (venteMachine !== null) extended.vente_machine = venteMachine
        if (ecartCaisse !== null) extended.ecart_caisse = ecartCaisse
        if (ventesJour.photoVenteMachine) extended.photo_vente_machine = ventesJour.photoVenteMachine
        const totalDep = totalDepensesGerantCaisse()
        if (totalDep > 0) extended.depenses_gerant_caisse_total = totalDep
        if (Object.keys(extended).length > 0) {
          await supabase.from('points').update(extended).eq('id', pointId)
        }
      } catch (_) { /* colonnes pas encore ajoutées — ignoré */ }
    }
    setValidating(false)
    if (ok) {
      setPointValide(true)
      // Notifier les directeurs en arrière-plan — ne bloque jamais la validation
      envoyerNotifValidation(dateJour).catch(() => {})
      creerNotification({
        type: 'point_valide',
        titre: '✅ Point validé',
        message: `${restaurantNom} — ${dateJour}`,
        restaurant_id: restaurantId,
        cible_role: ['manager', 'directeur'],
      }).catch(() => {})
      // Vérifier si le rapport hebdo peut être généré (arrière-plan)
      verifierEtGenererRapportHebdo(dateJour).catch(() => {})
      // Sauvegarde OneDrive si connecté (arrière-plan)
      estatConnecte().then(ok => {
        if (ok) sauvegarderSurOneDrive(dateJour, restaurantNom).catch(() => {})
      }).catch(() => {})
      router.replace('/accueil')
    } else {
      Alert.alert('Erreur', 'Impossible de valider le point.')
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.back}>‹ Retour</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitre}>Récapitulatif</Text>
          <View style={{ width: 60 }} />
        </View>
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#EF9F27" />
          <Text style={styles.loadingTxt}>Chargement...</Text>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => {
          if (router.canGoBack()) router.back()
          else router.replace('/accueil')
        }}>
          <Text style={styles.back}>‹ Retour</Text>
        </TouchableOpacity>
        <View>
          <Text style={styles.headerTitre}>Récapitulatif du jour</Text>
          <Text style={styles.headerSub}>{formatDate(dateJour)}</Text>
        </View>
        <View style={{ width: 60 }} />
      </View>

      {/* Barre d'onglets */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabBar}>
        {[
          { key: 'resume', label: '📊 Résumé' },
          { key: 'depenses', label: '💸 Dépenses' },
          { key: 'presences', label: '👥 Présences' },
          { key: 'fournisseurs', label: '🧾 Fournisseurs' },
          { key: 'inventaire', label: '📦 Inventaire' },
        ].map(t => (
          <TouchableOpacity
            key={t.key}
            style={[styles.tabBtn, ongletRecap === t.key && styles.tabBtnActive]}
            onPress={() => setOngletRecap(t.key)}
          >
            <Text style={[styles.tabTxt, ongletRecap === t.key && styles.tabTxtActive]}>
              {t.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView style={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

        {/* ══════════════ ONGLET RÉSUMÉ ══════════════ */}
        {ongletRecap === 'resume' && (
          <View>
            {/* KPIs */}
            <View style={styles.kpiGrid}>
              <View style={styles.kpiCard}>
                <Text style={styles.kpiLabel}>Vente shifts</Text>
                <Text style={[styles.kpiValue, { color: '#BA7517' }]}>
                  {fmt(cumulShifts?.venteTotal || totalVentes())}
                </Text>
              </View>
              <View style={styles.kpiCard}>
                <Text style={styles.kpiLabel}>Dépenses totales</Text>
                <Text style={[styles.kpiValue, { color: '#A32D2D' }]}>{fmt(totalDepensesGlobal())}</Text>
              </View>
              <View style={styles.kpiCard}>
                <Text style={styles.kpiLabel}>FC calculé</Text>
                <Text style={[styles.kpiValue, { color: fcCalc() >= 0 ? '#534AB7' : '#A32D2D' }]}>
                  {fmt(fcCalc())}
                </Text>
              </View>
              <View style={styles.kpiCard}>
                <Text style={styles.kpiLabel}>Bénéfice SC</Text>
                <Text style={[styles.kpiValue, { color: '#3B6D11' }]}>{fmt(beneficeSCCalc())}</Text>
              </View>
            </View>

            {/* SHIFTS */}
            {shifts.length > 0 && (
              <>
                <Text style={styles.sectionTitre}>⏱️ Shifts caissiers ({shifts.length})</Text>
                {shifts.map((shift, i) => (
                  <View key={shift.id} style={styles.shiftCard}>
                    <View style={styles.shiftHeader}>
                      <View style={styles.shiftNumBox}>
                        <Text style={styles.shiftNumTxt}>S{i + 1}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.shiftHeures}>⏰ {shift.heure_debut} → {shift.heure_fin}</Text>
                        {shift.caissier_nom && <Text style={styles.shiftCaissier}>👤 {shift.caissier_nom}</Text>}
                      </View>
                      <Text style={styles.shiftVente}>{fmt(shift.vente_shift || 0)}</Text>
                    </View>
                    <View style={styles.shiftDetails}>
                      {[
                        { label: 'Dépenses', val: shift.depenses },
                        { label: 'Fournisseurs', val: shift.fournisseurs },
                        { label: 'KDO', val: shift.kdo },
                        { label: 'Retour', val: shift.retour },
                        { label: 'Yango CSE', val: shift.yango_cse },
                        { label: 'Glovo CSE', val: shift.glovo_cse },
                        { label: 'Wave', val: shift.wave },
                        { label: 'Djamo', val: shift.djamo },
                        { label: 'Orange Money', val: shift.om },
                        { label: 'Espèces', val: shift.espece },
                      ].filter(r => r.val > 0).map((r, j) => (
                        <View key={j} style={styles.row}>
                          <Text style={styles.rowLabel}>{r.label}</Text>
                          <Text style={styles.rowValue}>{fmt(r.val)}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                ))}
                {cumulShifts && (
                  <View style={styles.cumulCard}>
                    <Text style={styles.cumulTitre}>📊 Cumul {cumulShifts.nbShifts} shift(s)</Text>
                    <View style={styles.row}>
                      <Text style={styles.rowLabel}>Total dépenses caissiers</Text>
                      <Text style={styles.rowValue}>{fmt(cumulShifts.depenses + cumulShifts.fournisseurs)}</Text>
                    </View>
                    <View style={[styles.row, { borderBottomWidth: 0 }]}>
                      <Text style={[styles.rowLabel, { fontWeight: '700', color: '#EF9F27' }]}>Total ventes shifts</Text>
                      <Text style={[styles.rowValue, { fontWeight: '700', color: '#EF9F27', fontSize: 15 }]}>
                        {fmt(cumulShifts.venteTotal)}
                      </Text>
                    </View>
                  </View>
                )}
              </>
            )}

            {/* CANAUX TAB */}
            {(parseFloat(ventesJour.yangoTab) > 0 || parseFloat(ventesJour.glovoTab) > 0) && (
              <>
                <Text style={styles.sectionTitre}>📱 Canaux TAB</Text>
                <View style={styles.card}>
                  {parseFloat(ventesJour.yangoTab) > 0 && (
                    <View style={styles.row}>
                      <View style={styles.rowLeft}>
                        <Text style={styles.rowLabel}>Yango TAB</Text>
                        {parseInt(ventesJour.yangoNbCommandes) > 0 && (
                          <Text style={styles.shiftCaissier}>{ventesJour.yangoNbCommandes} commandes</Text>
                        )}
                      </View>
                      <Text style={styles.rowValue}>{fmt(parseFloat(ventesJour.yangoTab) || 0)}</Text>
                    </View>
                  )}
                  {parseFloat(ventesJour.glovoTab) > 0 && (
                    <View style={[styles.row, { borderBottomWidth: 0 }]}>
                      <View style={styles.rowLeft}>
                        <Text style={styles.rowLabel}>Glovo TAB</Text>
                        {parseInt(ventesJour.glovoNbCommandes) > 0 && (
                          <Text style={styles.shiftCaissier}>{ventesJour.glovoNbCommandes} commandes</Text>
                        )}
                      </View>
                      <Text style={styles.rowValue}>{fmt(parseFloat(ventesJour.glovoTab) || 0)}</Text>
                    </View>
                  )}
                </View>
              </>
            )}

            {/* VENTE MACHINE */}
            {ventesJour.venteMachine !== '' && ventesJour.venteMachine !== undefined && cumulShifts && (
              <>
                <Text style={styles.sectionTitre}>🖥️ Vente machine</Text>
                <View style={styles.card}>
                  <View style={styles.row}>
                    <Text style={styles.rowLabel}>Vente théorique (shifts)</Text>
                    <Text style={[styles.rowValue, { color: '#BA7517' }]}>{fmt(cumulShifts.venteTotal)}</Text>
                  </View>
                  <View style={styles.row}>
                    <Text style={styles.rowLabel}>Vente machine</Text>
                    <Text style={styles.rowValue}>{fmt(parseFloat(ventesJour.venteMachine) || 0)}</Text>
                  </View>
                  {ventesJour.photoVenteMachine && (
                    <View style={styles.row}>
                      <Text style={styles.rowLabel}>Photo machine</Text>
                      <Text style={{ fontSize: 12, color: '#3B6D11' }}>✅ Jointe</Text>
                    </View>
                  )}
                  {(() => {
                    const ecart = cumulShifts.venteTotal - (parseFloat(ventesJour.venteMachine) || 0)
                    const parfait = Math.abs(ecart) < 500
                    const surplus = ecart > 0
                    return (
                      <View style={[styles.row, { borderBottomWidth: 0 }]}>
                        <Text style={[styles.rowLabel, { fontWeight: '600' }]}>Écart</Text>
                        <View style={[styles.ecartBadge, { backgroundColor: parfait ? '#EAF3DE' : surplus ? '#E6F1FB' : '#FAECE7' }]}>
                          <Text style={[styles.ecartBadgeTxt, { color: parfait ? '#3B6D11' : surplus ? '#185FA5' : '#A32D2D' }]}>
                            {parfait ? '✅ Parfait' : surplus ? `📈 Surplus +${fmt(ecart)}` : `📉 Manquant ${fmt(ecart)}`}
                          </Text>
                        </View>
                      </View>
                    )
                  })()}
                </View>
              </>
            )}

            {/* BILAN FINAL */}
            <View style={styles.bilanCard}>
              <Text style={styles.bilanTitre}>📊 Bilan final</Text>
              <View style={styles.row}>
                <Text style={styles.bilanLabel}>Vente shifts</Text>
                <Text style={[styles.bilanValue, { color: '#BA7517' }]}>{fmt(cumulShifts?.venteTotal || totalVentes())}</Text>
              </View>
              <View style={styles.row}>
                <Text style={[styles.bilanLabel, { fontWeight: '600' }]}>Total dépenses</Text>
                <Text style={[styles.bilanValue, { color: '#A32D2D', fontWeight: '600' }]}>{fmt(totalDepensesGlobal())}</Text>
              </View>
              {cumulShifts && (
                <View style={styles.row}>
                  <Text style={styles.bilanLabel}>Espèces shifts (brut)</Text>
                  <Text style={[styles.bilanValue, { color: '#BA7517' }]}>{fmt(cumulShifts.espece)}</Text>
                </View>
              )}
              {totalDepensesGerantCaisse() > 0 && (
                <View style={styles.row}>
                  <Text style={styles.bilanLabel}>Déductions gérant</Text>
                  <Text style={[styles.bilanValue, { color: '#A32D2D' }]}>− {fmt(totalDepensesGerantCaisse())}</Text>
                </View>
              )}
              <View style={styles.row}>
                <Text style={[styles.bilanLabel, { fontWeight: '600' }]}>Reste espèces (net)</Text>
                <Text style={[styles.bilanValue, { fontWeight: '600', color: resteEspecesCalc() >= 0 ? '#BA7517' : '#A32D2D' }]}>
                  {fmt(resteEspecesCalc())}
                </Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.bilanLabel}>FC de la veille</Text>
                <Text style={styles.bilanValue}>{fmt(parseFloat(ventesJour.fcVeille) || 0)}</Text>
              </View>
              {parseFloat(ventesJour.fc_recu) !== 0 && ventesJour.fc_recu !== '' && (
                <View style={styles.row}>
                  <Text style={styles.bilanLabel}>FC reçu</Text>
                  <Text style={[styles.bilanValue, { color: (parseFloat(ventesJour.fc_recu) || 0) >= 0 ? '#3B6D11' : '#A32D2D' }]}>
                    {(parseFloat(ventesJour.fc_recu) || 0) >= 0 ? '+' : ''}{fmt(parseFloat(ventesJour.fc_recu) || 0)}
                  </Text>
                </View>
              )}
              <View style={styles.row}>
                <Text style={[styles.bilanLabel, { color: '#534AB7' }]}>FC calculé</Text>
                <Text style={[styles.bilanValue, { color: '#534AB7', fontWeight: '600' }]}>{fmt(fcCalc())}</Text>
              </View>
              <View style={[styles.row, { borderBottomWidth: 0 }]}>
                <Text style={[styles.bilanLabel, { fontWeight: '700', color: '#1a1a1a', fontSize: 15 }]}>Bénéfice SC</Text>
                <Text style={[styles.bilanValue, { color: '#3B6D11', fontWeight: '700', fontSize: 18 }]}>
                  {fmt(beneficeSCCalc())}
                </Text>
              </View>
            </View>

            {/* ─── Comparaison des performances ─── */}
            {(() => {
              const todayVente = cumulShifts?.venteTotal || totalVentes()
              const todayBenef = beneficeSCCalc()
              const todayDep = totalDepensesGlobal()
              const todayEspeces = resteEspecesCalc()
              const todayYango = (cumulShifts ? cumulShifts.yangoCse : (parseFloat(ventesJour.yangoCse) || 0)) + (parseFloat(ventesJour.yangoTab) || 0)
              const todayGlovo = (cumulShifts ? cumulShifts.glovoCse : (parseFloat(ventesJour.glovoCse) || 0)) + (parseFloat(ventesJour.glovoTab) || 0)

              const indicateurs = [
                { label: 'Vente totale', key: 'vente', today: todayVente, getRef: (p) => p?.vente_total, inverse: false },
                { label: 'Bénéfice SC', key: 'benef', today: todayBenef, getRef: (p) => p?.benefice_sc, inverse: false },
                { label: 'Dépenses', key: 'dep', today: todayDep, getRef: (p) => p?.depense_total, inverse: true },
                { label: 'Espèces caisse', key: 'esp', today: todayEspeces, getRef: (p) => p?.reste_especes, inverse: false },
                { label: 'Total Yango', key: 'yango', today: todayYango, getRef: (p) => p ? (p.yango_cse || 0) + (p.yango_tab || 0) : null, inverse: false },
                { label: 'Total Glovo', key: 'glovo', today: todayGlovo, getRef: (p) => p ? (p.glovo_cse || 0) + (p.glovo_tab || 0) : null, inverse: false },
              ]

              const hasSemaine = comparaison?.semaine != null
              const hasMois = comparaison?.mois != null

              return (
                <View style={{ marginBottom: 4 }}>
                  <Text style={styles.sectionTitre}>📊 Comparaison des performances</Text>
                  <View style={styles.comparaisonCard}>
                    {/* Header colonnes */}
                    <View style={styles.comparaisonHeader}>
                      <Text style={[styles.compLabel, { fontSize: 10, color: '#888' }]}> </Text>
                      <View style={styles.compCell}><Text style={styles.comparaisonColTitre}>Sem. passée</Text></View>
                      <View style={styles.compCell}><Text style={styles.comparaisonColTitre}>Mois passé</Text></View>
                    </View>

                    {!hasSemaine && !hasMois ? (
                      <Text style={styles.compNoData}>Pas de données de référence</Text>
                    ) : (
                      indicateurs.map((ind) => {
                        const refSem = hasSemaine ? ind.getRef(comparaison.semaine) : null
                        const refMois = hasMois ? ind.getRef(comparaison.mois) : null
                        const varSem = calcVariation(ind.today, refSem)
                        const varMois = calcVariation(ind.today, refMois)

                        function renderCell(ref, variation) {
                          if (ref == null) return <View style={styles.compCell}><Text style={styles.compNoData}>—</Text></View>
                          const isBetter = ind.inverse ? variation < 0 : variation > 0
                          const isNeutral = variation === null || Math.abs(variation) < 0.1
                          const varStyle = isNeutral ? {} : isBetter ? styles.compBetter : styles.compWorse
                          const arrow = isNeutral ? '' : variation > 0 ? ' ↑' : ' ↓'
                          const dot = isNeutral ? '' : isBetter ? '🟢' : '🔴'
                          return (
                            <View style={styles.compCell}>
                              <Text style={styles.compVal}>{Math.round(ref).toLocaleString('fr-FR')}</Text>
                              {variation !== null && (
                                <Text style={[styles.compVariation, varStyle]}>
                                  {dot}{arrow} {Math.abs(variation).toFixed(1)}%
                                </Text>
                              )}
                            </View>
                          )
                        }

                        return (
                          <View key={ind.key} style={styles.compRow}>
                            <Text style={styles.compLabel}>{ind.label}</Text>
                            {renderCell(refSem, varSem)}
                            {renderCell(refMois, varMois)}
                          </View>
                        )
                      })
                    )}
                  </View>
                </View>
              )
            })()}

            {/* Boutons */}
            <TouchableOpacity style={styles.modifBtn} onPress={() => router.back()}>
              <Text style={styles.modifTxt}>✏️ Retourner modifier</Text>
            </TouchableOpacity>

            {!(inventaireTermine || inventairesShifts.some(s => s.valide)) && (
              <View style={styles.invRequisBanner}>
                <Text style={styles.invRequisTxt}>🔒 Inventaire du jour requis avant validation</Text>
              </View>
            )}

            <TouchableOpacity
              style={[styles.validerBtn, (validating || !(inventaireTermine || inventairesShifts.some(s => s.valide))) && { opacity: 0.5 }]}
              onPress={valider}
              disabled={validating}
            >
              {validating ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.validerTxt}>✅ Valider le point du jour</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* ══════════════ ONGLET DÉPENSES ══════════════ */}
        {ongletRecap === 'depenses' && (
          <View>
            {/* Dépenses des shifts (table depenses) */}
            {depenses.length > 0 && (
              <>
                <Text style={styles.sectionTitre}>📋 Dépenses journée</Text>
                <View style={styles.card}>
                  {depenses.map((d, i) => (
                    <View key={i} style={styles.row}>
                      <View style={styles.rowLeft}>
                        <Text style={styles.rowLabel}>{d.libelle || 'Sans libellé'}</Text>
                        <Text style={{ fontSize: 10, color: '#888', marginTop: 2 }}>
                          {d.categorie}{d.saisi_par === 'gerant' ? ' · 🔑 Gérant' : ''}
                        </Text>
                      </View>
                      <Text style={styles.rowValue}>{fmt(d.montant || 0)}</Text>
                    </View>
                  ))}
                  <View style={[styles.row, styles.rowTotal]}>
                    <Text style={styles.rowTotalLabel}>Sous-total</Text>
                    <Text style={[styles.rowTotalValue, { color: '#A32D2D' }]}>
                      {fmt(depenses.reduce((s, d) => s + (d.montant || 0), 0))}
                    </Text>
                  </View>
                </View>
              </>
            )}

            {/* Dépenses caisse gérant */}
            {totalDepensesGerantCaisse() > 0 && (
              <>
                <Text style={styles.sectionTitre}>💵 Caisse gérant</Text>
                <View style={styles.card}>
                  {Object.entries(fournisseursGerantCaisse)
                    .filter(([, f]) => parseFloat(f?.paye) > 0)
                    .map(([id, f]) => (
                      <View key={id} style={styles.row}>
                        <View style={styles.rowLeft}>
                          <Text style={styles.rowLabel}>🏪 {f.nom || 'Fournisseur'}</Text>
                          <Text style={{ fontSize: 10, color: '#888', marginTop: 2 }}>Fournisseur</Text>
                        </View>
                        <Text style={[styles.rowValue, { color: '#A32D2D' }]}>{fmt(parseFloat(f.paye) || 0)}</Text>
                      </View>
                    ))
                  }
                  {Object.entries(depensesGerantCaisse).flatMap(([cat, lignes]) =>
                    (lignes || []).filter(l => parseFloat(l.montant) > 0).map((l, i) => (
                      <View key={`${cat}-${i}`} style={styles.row}>
                        <View style={styles.rowLeft}>
                          <Text style={styles.rowLabel}>{l.description || cat}</Text>
                          <Text style={{ fontSize: 10, color: '#888', marginTop: 2 }}>{cat}</Text>
                        </View>
                        <Text style={[styles.rowValue, { color: '#A32D2D' }]}>{fmt(parseFloat(l.montant) || 0)}</Text>
                      </View>
                    ))
                  )}
                  <View style={[styles.row, styles.rowTotal]}>
                    <Text style={styles.rowTotalLabel}>Sous-total caisse</Text>
                    <Text style={[styles.rowTotalValue, { color: '#A32D2D' }]}>{fmt(totalDepensesGerantCaisse())}</Text>
                  </View>
                </View>
              </>
            )}

            {/* Paies */}
            {totalPaiePresences() > 0 && (
              <>
                <Text style={styles.sectionTitre}>💰 Salaires & Paies</Text>
                <View style={styles.card}>
                  {(() => {
                    const map = {}
                    presences.filter(p => p.paye > 0).forEach(p => {
                      const k = p.travailleur_id || p.travailleur_nom
                      if (!map[k]) map[k] = { nom: p.travailleur_nom, total: 0 }
                      map[k].total += (p.paye || 0)
                    })
                    return Object.values(map).map((w, i) => (
                      <View key={i} style={styles.row}>
                        <Text style={styles.rowLabel}>{w.nom}</Text>
                        <Text style={styles.rowValue}>{fmt(w.total)}</Text>
                      </View>
                    ))
                  })()}
                  <View style={[styles.row, styles.rowTotal]}>
                    <Text style={styles.rowTotalLabel}>Sous-total paies</Text>
                    <Text style={[styles.rowTotalValue, { color: '#A32D2D' }]}>{fmt(totalPaiePresences())}</Text>
                  </View>
                </View>
              </>
            )}

            {/* Total général */}
            <View style={[styles.bilanCard, { marginTop: 4 }]}>
              <View style={styles.row}>
                <Text style={[styles.bilanLabel, { fontWeight: '700', fontSize: 15 }]}>Total dépenses journée</Text>
                <Text style={[styles.bilanValue, { color: '#A32D2D', fontWeight: '700', fontSize: 17 }]}>
                  {fmt(totalDepensesGlobal())}
                </Text>
              </View>
            </View>

            {depenses.length === 0 && totalDepensesGerantCaisse() === 0 && totalPaiePresences() === 0 && (
              <Text style={styles.emptyTxt}>Aucune dépense enregistrée</Text>
            )}
          </View>
        )}

        {/* ══════════════ ONGLET PRÉSENCES ══════════════ */}
        {ongletRecap === 'presences' && (
          <View>
            <Text style={styles.sectionTitre}>👥 Présences & Paies du jour</Text>
            <View style={styles.card}>
              {presences.length === 0 ? (
                <Text style={styles.emptyTxt}>Aucune présence enregistrée</Text>
              ) : (
                (() => {
                  // Agréger par travailleur pour afficher le total multi-shifts
                  const map = {}
                  presences.forEach(p => {
                    const k = p.travailleur_id || p.travailleur_nom
                    if (!map[k]) map[k] = { nom: p.travailleur_nom, statut: p.statut, totalPaye: 0, shifts: [] }
                    map[k].totalPaye += (p.paye || 0)
                    if (p.shift_nom) map[k].shifts.push(p.shift_nom)
                  })
                  return Object.values(map).map((w, i) => (
                    <View key={i} style={styles.row}>
                      <View style={styles.rowLeft}>
                        <Text style={styles.rowLabel}>{w.nom}</Text>
                        <View style={[styles.statutBadge, { backgroundColor: STATUT_COLORS[w.statut]?.bg || '#f5f5f5' }]}>
                          <Text style={[styles.statutTxt, { color: STATUT_COLORS[w.statut]?.text || '#888' }]}>
                            {w.statut}
                          </Text>
                        </View>
                        {w.shifts.length > 0 && (
                          <Text style={styles.shiftNomTxt}>
                            {w.shifts.length > 1 ? `⚡ ${w.shifts.length} shifts` : `⏰ ${w.shifts[0]}`}
                          </Text>
                        )}
                      </View>
                      <Text style={styles.rowValue}>{w.totalPaye > 0 ? fmt(w.totalPaye) : '—'}</Text>
                    </View>
                  ))
                })()
              )}
              {presences.length > 0 && (
                <View style={[styles.row, styles.rowTotal]}>
                  <Text style={styles.rowTotalLabel}>Total paie</Text>
                  <Text style={[styles.rowTotalValue, { color: '#EF9F27' }]}>{fmt(totalPaiePresences())}</Text>
                </View>
              )}
            </View>
          </View>
        )}

        {/* ══════════════ ONGLET FOURNISSEURS ══════════════ */}
        {ongletRecap === 'fournisseurs' && (
          <View>
            {/* Transactions (caissiers) */}
            {transactions.length > 0 && (
              <>
                <Text style={styles.sectionTitre}>🧾 Fournisseurs du jour</Text>
                <View style={styles.card}>
                  {(() => {
                    const agregat = {}
                    transactions.forEach(t => {
                      if (!agregat[t.fournisseur_id]) agregat[t.fournisseur_id] = { paye: 0, facture: 0, reste: 0 }
                      agregat[t.fournisseur_id].paye += (t.paye || 0)
                      agregat[t.fournisseur_id].facture += (t.facture || 0)
                      agregat[t.fournisseur_id].reste += (t.reste || 0)
                    })
                    return Object.entries(agregat).filter(([, agg]) => agg.paye > 0).map(([id, agg], i) => (
                      <View key={i} style={styles.row}>
                        <View style={styles.rowLeft}>
                          <Text style={styles.rowLabel}>{getNomFournisseur(id)}</Text>
                          {agg.facture > 0 && <Text style={{ fontSize: 10, color: '#888', marginTop: 2 }}>Facture : {fmt(agg.facture)}</Text>}
                          {agg.reste > 0 && <Text style={styles.resteTxt}>Reste : {fmt(agg.reste)}</Text>}
                        </View>
                        <Text style={styles.rowValue}>{fmt(agg.paye)}</Text>
                      </View>
                    ))
                  })()}
                  <View style={[styles.row, styles.rowTotal]}>
                    <Text style={styles.rowTotalLabel}>Total payé</Text>
                    <Text style={[styles.rowTotalValue, { color: '#EF9F27' }]}>{fmt(totalFournisseursTransactions())}</Text>
                  </View>
                </View>
              </>
            )}

            {/* Fournisseurs gérant caisse */}
            {Object.entries(fournisseursGerantCaisse).filter(([, f]) => parseFloat(f?.paye) > 0).length > 0 && (
              <>
                <Text style={styles.sectionTitre}>💵 Fournisseurs caisse gérant</Text>
                <View style={styles.card}>
                  {Object.entries(fournisseursGerantCaisse)
                    .filter(([, f]) => parseFloat(f?.paye) > 0)
                    .map(([id, f]) => (
                      <View key={id} style={styles.row}>
                        <View style={styles.rowLeft}>
                          <Text style={styles.rowLabel}>{f.nom || 'Fournisseur'}</Text>
                          {f.facture ? <Text style={{ fontSize: 10, color: '#888', marginTop: 2 }}>Facture: {f.facture}</Text> : null}
                          {(parseFloat(f?.montant_facture) > 0 || f.photoUri) && (
                            <Text style={{ fontSize: 10, color: f.photoUri ? '#3B6D11' : '#A32D2D', marginTop: 2 }}>
                              {f.photoUri ? '📷 Photo jointe' : '⚠️ Photo manquante'}
                            </Text>
                          )}
                        </View>
                        <Text style={[styles.rowValue, { color: '#A32D2D' }]}>{fmt(parseFloat(f.paye) || 0)}</Text>
                      </View>
                    ))
                  }
                </View>
              </>
            )}

            {transactions.length === 0 && Object.entries(fournisseursGerantCaisse).filter(([, f]) => parseFloat(f?.paye) > 0).length === 0 && (
              <Text style={styles.emptyTxt}>Aucun fournisseur ce jour</Text>
            )}
          </View>
        )}

        {/* ══════════════ ONGLET INVENTAIRE ══════════════ */}
        {ongletRecap === 'inventaire' && (
          <View>
            {inventairesShifts.length === 0 ? (
              <Text style={styles.emptyTxt}>Aucun inventaire shift enregistré</Text>
            ) : (
              inventairesShifts.map((inv, i) => {
                const lignes = inv.inventaire_lignes || []
                const totalDeduit = lignes.reduce((s, l) => s + (l.montant_deduit || 0), 0)
                return (
                  <View key={inv.id} style={styles.shiftCard}>
                    <View style={styles.shiftHeader}>
                      <View style={styles.shiftNumBox}>
                        <Text style={styles.shiftNumTxt}>I{i + 1}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        {inv.caissier_id && (
                          <Text style={styles.shiftHeures}>
                            {inv.heure_debut ? `⏰ ${inv.heure_debut}${inv.heure_fin ? ` → ${inv.heure_fin}` : ''}` : inv.type_shift || 'Shift'}
                          </Text>
                        )}
                        <Text style={styles.shiftCaissier}>
                          {inv.valide ? '✅ Verrouillé' : '⏳ En cours'}
                          {inv.montant_a_deduire > 0 ? ` · Déduction : ${fmt(inv.montant_a_deduire)}` : ''}
                        </Text>
                      </View>
                      {totalDeduit > 0 && (
                        <Text style={[styles.shiftVente, { color: '#A32D2D' }]}>−{fmt(totalDeduit)}</Text>
                      )}
                    </View>
                    {lignes.length > 0 && (
                      <View style={styles.shiftDetails}>
                        {lignes.filter(l => l.ecart !== 0 && l.ecart != null).map((l, j) => (
                          <View key={j} style={styles.row}>
                            <View style={styles.rowLeft}>
                              <Text style={styles.rowLabel}>{l.produit_nom || l.produit_id}</Text>
                              <Text style={{ fontSize: 10, color: '#888', marginTop: 2 }}>
                                Init: {l.stock_initial ?? '—'} · Réel: {l.stock_reel ?? '—'}
                                {l.explication ? ` · ${l.explication}` : ''}
                              </Text>
                            </View>
                            <Text style={[styles.rowValue, { color: (l.ecart || 0) < 0 ? '#A32D2D' : '#3B6D11' }]}>
                              {(l.ecart || 0) > 0 ? '+' : ''}{l.ecart ?? 0}
                              {l.montant_deduit > 0 ? ` (${fmt(l.montant_deduit)})` : ''}
                            </Text>
                          </View>
                        ))}
                        {lignes.every(l => l.ecart === 0 || l.ecart == null) && (
                          <Text style={styles.emptyTxt}>Aucun écart</Text>
                        )}
                      </View>
                    )}
                  </View>
                )
              })
            )}
            {inventairesShifts.length > 0 && (
              <View style={styles.cumulCard}>
                <Text style={styles.cumulTitre}>📦 {inventairesShifts.length} shift(s) d'inventaire</Text>
                <View style={[styles.row, { borderBottomWidth: 0 }]}>
                  <Text style={styles.rowLabel}>Total déductions inventaire</Text>
                  <Text style={[styles.rowValue, { fontWeight: '700', color: '#A32D2D' }]}>
                    {fmt(inventairesShifts.reduce((s, inv) => s + (inv.montant_a_deduire || 0), 0))}
                  </Text>
                </View>
              </View>
            )}
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      <Modal visible={confirmVisible} transparent animationType="fade">
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmBox}>
            <Text style={styles.confirmTitre}>✅ Valider le point</Text>
            <Text style={styles.confirmMsg}>
              Valider le point du {formatDate(dateJour)} ?{'\n\n'}
              Vente shifts : {fmt(cumulShifts?.venteTotal || totalVentes())}{'\n'}
              {ventesJour.venteMachine !== '' && ventesJour.venteMachine !== undefined
                ? `Vente machine : ${fmt(parseFloat(ventesJour.venteMachine) || 0)}\n`
                : ''}
              {totalDepensesGerantCaisse() > 0
                ? `Dép. caisse gérant : − ${fmt(totalDepensesGerantCaisse())}\n`
                : ''}
              Espèces réelles : {fmt(resteEspecesCalc())}{'\n'}
              FC calculé : {fmt(fcCalc())}{'\n'}
              Bénéfice SC : {fmt(beneficeSCCalc())}{'\n\n'}
              ⚠️ Cette action est irréversible.
            </Text>
            <View style={styles.confirmBtns}>
              <TouchableOpacity style={styles.confirmCancel} onPress={() => setConfirmVisible(false)}>
                <Text style={styles.confirmCancelTxt}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmOk} onPress={confirmerValider}>
                <Text style={styles.confirmOkTxt}>Valider</Text>
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
  header: {
    backgroundColor: '#EF9F27', padding: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'
  },
  back: { fontSize: 16, color: '#412402', fontWeight: '500' },
  headerTitre: { fontSize: 16, fontWeight: '600', color: '#412402', textAlign: 'center' },
  headerSub: { fontSize: 11, color: '#854F0B', textAlign: 'center' },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingTxt: { fontSize: 13, color: colors.textMuted, marginTop: 12 },
  body: { flex: 1, padding: 14 },
  tabBar: { backgroundColor: colors.surface, borderBottomWidth: 0.5, borderBottomColor: colors.border, maxHeight: 46 },
  tabBtn: { paddingHorizontal: 16, paddingVertical: 12 },
  tabBtnActive: { borderBottomWidth: 2, borderBottomColor: '#EF9F27' },
  tabTxt: { fontSize: 12, color: colors.textMuted },
  tabTxtActive: { color: '#EF9F27', fontWeight: '600' },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  kpiCard: {
    width: '47%', backgroundColor: colors.surface, borderRadius: 12,
    padding: 12, borderWidth: 0.5, borderColor: colors.border
  },
  kpiLabel: { fontSize: 10, color: colors.textMuted, marginBottom: 4 },
  kpiValue: { fontSize: 14, fontWeight: '600' },
  sectionTitre: {
    fontSize: 12, fontWeight: '600', color: colors.textMuted, marginBottom: 8,
    textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4
  },
  card: {
    backgroundColor: colors.surface, borderRadius: 14, padding: 14,
    marginBottom: 14, borderWidth: 0.5, borderColor: colors.border
  },
  shiftCard: {
    backgroundColor: colors.surface, borderRadius: 14, padding: 14,
    marginBottom: 10, borderWidth: 0.5, borderColor: colors.border
  },
  shiftHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  shiftNumBox: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#EF9F27', alignItems: 'center', justifyContent: 'center'
  },
  shiftNumTxt: { fontSize: 12, fontWeight: '600', color: '#412402' },
  shiftHeures: { fontSize: 13, fontWeight: '600', color: colors.text },
  shiftCaissier: { fontSize: 11, color: colors.primary, marginTop: 2 },
  shiftVente: { fontSize: 14, fontWeight: '700', color: '#EF9F27' },
  shiftDetails: { borderTopWidth: 0.5, borderTopColor: colors.bg, paddingTop: 8 },
  cumulCard: {
    backgroundColor: colors.orangeLight, borderRadius: 14, padding: 14,
    marginBottom: 14, borderWidth: 1, borderColor: '#EF9F27'
  },
  cumulTitre: { fontSize: 13, fontWeight: '600', color: colors.orangeDark, marginBottom: 10 },
  catLabel: {
    fontSize: 11, fontWeight: '600', color: colors.primary,
    marginTop: 8, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.3
  },
  row: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', paddingVertical: 7,
    borderBottomWidth: 0.5, borderBottomColor: colors.bg
  },
  rowLeft: { flex: 1 },
  rowLabel: { fontSize: 13, color: colors.textSecondary },
  rowValue: { fontSize: 13, fontWeight: '500', color: colors.text },
  rowTotal: {
    borderBottomWidth: 0, marginTop: 6, paddingTop: 10,
    borderTopWidth: 1, borderTopColor: colors.border
  },
  rowTotalLabel: { fontSize: 13, fontWeight: '600', color: colors.text },
  rowTotalValue: { fontSize: 15, fontWeight: '600' },
  statutBadge: {
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10,
    alignSelf: 'flex-start', marginTop: 3
  },
  statutTxt: { fontSize: 10, fontWeight: '500' },
  shiftNomTxt: { fontSize: 10, color: colors.primary, marginTop: 2 },
  resteTxt: { fontSize: 10, color: '#A32D2D', marginTop: 2 },
  ecartBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  ecartBadgeTxt: { fontSize: 12, fontWeight: '600' },
  emptyTxt: { fontSize: 13, color: colors.textPlaceholder, textAlign: 'center', paddingVertical: 10 },
  bilanCard: {
    backgroundColor: colors.orangeLight, borderRadius: 14, padding: 14,
    marginBottom: 14, borderWidth: 1, borderColor: '#FAC775'
  },
  bilanTitre: { fontSize: 14, fontWeight: '600', color: colors.orangeDark, marginBottom: 12 },
  bilanLabel: { fontSize: 13, color: colors.orangeDark, flex: 1 },
  bilanValue: { fontSize: 14, fontWeight: '500' },
  modifBtn: {
    backgroundColor: colors.surface, borderRadius: 14, padding: 16,
    alignItems: 'center', marginBottom: 10, borderWidth: 1, borderColor: '#EF9F27'
  },
  modifTxt: { fontSize: 15, fontWeight: '600', color: '#EF9F27' },
  invRequisBanner: { backgroundColor: '#FAECE7', borderRadius: 10, padding: 12, alignItems: 'center', marginBottom: 8, borderWidth: 0.5, borderColor: '#F09595' },
  invRequisTxt: { fontSize: 12, color: '#993C1D', fontWeight: '500' },
  validerBtn: {
    backgroundColor: '#3B6D11', borderRadius: 14,
    padding: 16, alignItems: 'center', marginBottom: 10
  },
  validerTxt: { fontSize: 15, fontWeight: '600', color: '#fff' },
  confirmOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center', justifyContent: 'center', padding: 24
  },
  confirmBox: {
    backgroundColor: colors.surface, borderRadius: 18,
    padding: 24, width: '100%', maxWidth: 380
  },
  confirmTitre: { fontSize: 17, fontWeight: '700', color: colors.text, marginBottom: 12 },
  confirmMsg: { fontSize: 14, color: colors.textSecondary, lineHeight: 22, marginBottom: 20 },
  confirmBtns: { flexDirection: 'row', gap: 10 },
  confirmCancel: {
    flex: 1, padding: 14, borderRadius: 12,
    backgroundColor: colors.bg, alignItems: 'center'
  },
  confirmCancelTxt: { fontSize: 14, color: colors.textMuted },
  confirmOk: {
    flex: 1, padding: 14, borderRadius: 12,
    backgroundColor: '#3B6D11', alignItems: 'center'
  },
  confirmOkTxt: { fontSize: 14, fontWeight: '600', color: '#fff' },
  comparaisonCard: {
    backgroundColor: colors.surface, borderWidth: 0.5, borderColor: colors.border,
    padding: 14, borderRadius: 14, marginBottom: 14,
  },
  comparaisonHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  comparaisonColTitre: { fontSize: 10, color: colors.textMuted, fontWeight: '600', textTransform: 'uppercase' },
  compRow: {
    flexDirection: 'row', paddingVertical: 8,
    borderBottomWidth: 0.5, borderBottomColor: colors.bg,
  },
  compLabel: { fontSize: 12, color: colors.textSecondary, flex: 1 },
  compCell: { width: 100, alignItems: 'flex-end' },
  compVal: { fontSize: 11, fontWeight: '600', color: colors.text },
  compVariation: { fontSize: 10, marginTop: 1 },
  compBetter: { color: '#3B6D11' },
  compWorse: { color: '#A32D2D' },
  compNoData: { fontSize: 11, color: '#aaa', fontStyle: 'italic', textAlign: 'center', padding: 12 },
}) }