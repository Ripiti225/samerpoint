import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import {
  ActivityIndicator, Alert,
  Modal,
  SafeAreaView, ScrollView, StyleSheet,
  Text, TouchableOpacity, View
} from 'react-native'
import { useApp } from '../context/AppContext'
import { validerPoint } from '../lib/api'
import { supabase } from '../lib/supabase'

const STATUT_COLORS = {
  'Présent': { bg: '#EAF3DE', text: '#3B6D11' },
  'Absent': { bg: '#FAECE7', text: '#993C1D' },
  'Repos': { bg: '#E6F1FB', text: '#185FA5' },
  'Congé': { bg: '#EEEDFE', text: '#3C3489' },
  'Malade': { bg: '#FAEEDA', text: '#854F0B' },
  'Permission': { bg: '#F1EFE8', text: '#444441' },
}

export default function RecapPointScreen() {
  const {
    pointId, dateJour,
    totalVentes, ventesJour,
    setPointValide, roleActif,
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

  useEffect(() => { chargerDonnees() }, [])

  async function chargerDonnees() {
    setLoading(true)
    if (!pointId) { setLoading(false); return }

    const [
      { data: presData },
      { data: depData },
      { data: transData },
      { data: shiftsData },
    ] = await Promise.all([
      supabase.from('presences').select('*').eq('point_id', pointId),
      supabase.from('depenses').select('*').eq('point_id', pointId),
      supabase.from('transactions_fournisseurs').select('*').eq('point_id', pointId),
      supabase.from('points_shifts').select('*').eq('point_id', pointId).order('created_at'),
    ])

    setPresences(presData || [])
    setDepenses(depData || [])
    setTransactions(transData || [])
    setShifts(shiftsData || [])

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

    setLoading(false)
  }

  function getNomFournisseur(id) {
    return fournisseurs.find(f => f.id === id)?.nom || 'Fournisseur'
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

  // Total dépenses global = shifts (si gérant) ou table (si pas shifts)
  function totalDepensesGlobal() {
    if (cumulShifts) {
      // Gérant — cumul shifts + dépenses gérant + paies + fournisseurs gérant
      const depGerant = depenses.filter(d => d.saisi_par === 'gerant')
        .reduce((sum, d) => sum + (d.montant || 0), 0)
      return cumulShifts.depenses + cumulShifts.fournisseurs + depGerant + totalPaiePresences()
    }
    return totalDepensesTable() + totalPaiePresences() + totalFournisseursTransactions()
  }

  function resteEspecesCalc() {
    // Gérant/manager : espèces viennent directement du cumul shifts
    if (cumulShifts) return cumulShifts.espece
    return totalVentes() - totalDepensesGlobal()
      - (parseFloat(ventesJour.yangoCse) || 0)
      - (parseFloat(ventesJour.glovoCse) || 0)
      - (parseFloat(ventesJour.wave) || 0)
      - (parseFloat(ventesJour.om) || 0)
      - (parseFloat(ventesJour.djamo) || 0)
      - (parseFloat(ventesJour.kdo) || 0)
      - (parseFloat(ventesJour.retour) || 0)
  }

  function fcCalc() {
    // FC calculé = espèces en caisse + FC de la veille (auto)
    return resteEspecesCalc() + (parseFloat(ventesJour.fcVeille) || 0)
  }

  function beneficeSCCalc() {
    const yangoTab = parseFloat(ventesJour.yangoTab) || 0
    const glovoTab = parseFloat(ventesJour.glovoTab) || 0
    if (cumulShifts) {
      return (yangoTab * 0.77)
        + (glovoTab * 0.705)
        + (cumulShifts.om * 0.99)
        + (cumulShifts.wave * 0.99)
        + (cumulShifts.djamo * 0.99)
        + cumulShifts.espece
    }
    return (yangoTab * 0.77)
      + (glovoTab * 0.705)
      + ((parseFloat(ventesJour.om) || 0) * 0.99)
      + ((parseFloat(ventesJour.wave) || 0) * 0.99)
      + ((parseFloat(ventesJour.djamo) || 0) * 0.99)
      + resteEspecesCalc()
  }

  function valider() {
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
    const ok = await validerPoint(pointId, {
      vente_total: cumulShifts?.venteTotal || totalVentes(),
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
      fc_compte: parseFloat(ventesJour.fc_actuel) || 0,
      benefice_sc: beneficeSCCalc(),
    })
    setValidating(false)
    if (ok) {
      setPointValide(true)
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

  const depensesParCat = depenses.reduce((acc, d) => {
    if (!acc[d.categorie]) acc[d.categorie] = []
    acc[d.categorie].push(d)
    return acc
  }, {})

  const depensesCaissier = depenses.filter(d => d.saisi_par === 'caissier' || !d.saisi_par)
  const depensesGerant = depenses.filter(d => d.saisi_par === 'gerant')

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

      <ScrollView style={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

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

        {/* SHIFTS CAISSIERS */}
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
                    {shift.caissier_nom && (
                      <Text style={styles.shiftCaissier}>👤 {shift.caissier_nom}</Text>
                    )}
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

            {/* Cumul shifts */}
            {cumulShifts && (
              <View style={styles.cumulCard}>
                <Text style={styles.cumulTitre}>📊 Cumul {cumulShifts.nbShifts} shift(s)</Text>
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>Total dépenses caissiers</Text>
                  <Text style={styles.rowValue}>
                    {fmt(cumulShifts.depenses + cumulShifts.fournisseurs)}
                  </Text>
                </View>
                <View style={[styles.row, { borderBottomWidth: 0 }]}>
                  <Text style={[styles.rowLabel, { fontWeight: '700', color: '#EF9F27' }]}>
                    Total ventes shifts
                  </Text>
                  <Text style={[styles.rowValue, { fontWeight: '700', color: '#EF9F27', fontSize: 15 }]}>
                    {fmt(cumulShifts.venteTotal)}
                  </Text>
                </View>
              </View>
            )}
          </>
        )}

        {/* VENTE SHIFTS */}
        {cumulShifts && (
          <>
            <Text style={styles.sectionTitre}>💰 Vente shifts</Text>
            <View style={styles.card}>
              {[
                { label: 'Dépenses + Fournisseurs', val: cumulShifts.depenses + cumulShifts.fournisseurs },
                { label: 'Yango CSE', val: cumulShifts.yangoCse },
                { label: 'Glovo CSE', val: cumulShifts.glovoCse },
                { label: 'Wave', val: cumulShifts.wave },
                { label: 'Orange Money', val: cumulShifts.om },
                { label: 'Djamo', val: cumulShifts.djamo },
                { label: 'KDO', val: cumulShifts.kdo },
                { label: 'Retours', val: cumulShifts.retour },
                { label: 'Espèces en caisse', val: cumulShifts.espece },
              ].filter(r => r.val > 0).map((r, i) => (
                <View key={i} style={styles.row}>
                  <Text style={styles.rowLabel}>{r.label}</Text>
                  <Text style={styles.rowValue}>{fmt(r.val)}</Text>
                </View>
              ))}
              <View style={[styles.row, styles.rowTotal]}>
                <Text style={styles.rowTotalLabel}>Vente shifts total</Text>
                <Text style={[styles.rowTotalValue, { color: '#BA7517' }]}>
                  {fmt(cumulShifts.venteTotal)}
                </Text>
              </View>
            </View>
          </>
        )}

        {/* CANAUX TAB (saisis manuellement) */}
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

        {/* DÉPENSES GÉRANT */}
        {depensesGerant.length > 0 && (
          <>
            <Text style={styles.sectionTitre}>📋 Dépenses supplémentaires gérant</Text>
            <View style={styles.card}>
              {depensesGerant.map((d, i) => (
                <View key={i} style={styles.row}>
                  <Text style={styles.rowLabel}>{d.libelle || 'Sans nom'}</Text>
                  <Text style={styles.rowValue}>{fmt(d.montant)}</Text>
                </View>
              ))}
              <View style={[styles.row, styles.rowTotal]}>
                <Text style={styles.rowTotalLabel}>Total gérant</Text>
                <Text style={[styles.rowTotalValue, { color: '#A32D2D' }]}>
                  {fmt(depensesGerant.reduce((sum, d) => sum + (d.montant || 0), 0))}
                </Text>
              </View>
            </View>
          </>
        )}

        {/* PRESENCES */}
        <Text style={styles.sectionTitre}>👥 Présences & Paies</Text>
        <View style={styles.card}>
          {presences.length === 0 ? (
            <Text style={styles.emptyTxt}>Aucune présence enregistrée</Text>
          ) : (
            presences.map((p, i) => (
              <View key={i} style={styles.row}>
                <View style={styles.rowLeft}>
                  <Text style={styles.rowLabel}>{p.travailleur_nom}</Text>
                  <View style={[styles.statutBadge, {
                    backgroundColor: STATUT_COLORS[p.statut]?.bg || '#f5f5f5'
                  }]}>
                    <Text style={[styles.statutTxt, {
                      color: STATUT_COLORS[p.statut]?.text || '#888'
                    }]}>
                      {p.statut}
                    </Text>
                  </View>
                  {p.shift_nom && (
                    <Text style={styles.shiftNomTxt}>
                      ⏰ {p.shift_nom} {p.heure_debut ? `(${p.heure_debut} → ${p.heure_fin})` : ''}
                    </Text>
                  )}
                </View>
                <Text style={styles.rowValue}>{p.paye > 0 ? fmt(p.paye) : '—'}</Text>
              </View>
            ))
          )}
          <View style={[styles.row, styles.rowTotal]}>
            <Text style={styles.rowTotalLabel}>Total paie</Text>
            <Text style={[styles.rowTotalValue, { color: '#EF9F27' }]}>{fmt(totalPaiePresences())}</Text>
          </View>
        </View>

        {/* FOURNISSEURS */}
        {transactions.length > 0 && (
          <>
            <Text style={styles.sectionTitre}>🧾 Fournisseurs</Text>
            <View style={styles.card}>
              {transactions.map((t, i) => (
                <View key={i} style={styles.row}>
                  <View style={styles.rowLeft}>
                    <Text style={styles.rowLabel}>{getNomFournisseur(t.fournisseur_id)}</Text>
                    {t.reste > 0 && (
                      <Text style={styles.resteTxt}>Reste: {fmt(t.reste)}</Text>
                    )}
                  </View>
                  <Text style={styles.rowValue}>{fmt(t.paye)}</Text>
                </View>
              ))}
              <View style={[styles.row, styles.rowTotal]}>
                <Text style={styles.rowTotalLabel}>Total payé</Text>
                <Text style={[styles.rowTotalValue, { color: '#EF9F27' }]}>
                  {fmt(totalFournisseursTransactions())}
                </Text>
              </View>
            </View>
          </>
        )}

        {/* BILAN FINAL */}
        <View style={styles.bilanCard}>
          <Text style={styles.bilanTitre}>📊 Bilan final</Text>
          <View style={styles.row}>
            <Text style={styles.bilanLabel}>Vente shifts</Text>
            <Text style={[styles.bilanValue, { color: '#BA7517' }]}>
              {fmt(cumulShifts?.venteTotal || totalVentes())}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.bilanLabel}>Total dépenses</Text>
            <Text style={[styles.bilanValue, { color: '#A32D2D' }]}>{fmt(totalDepensesGlobal())}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.bilanLabel}>Espèces en caisse</Text>
            <Text style={[styles.bilanValue, { color: resteEspecesCalc() >= 0 ? '#BA7517' : '#A32D2D' }]}>
              {fmt(resteEspecesCalc())}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.bilanLabel}>FC de la veille</Text>
            <Text style={styles.bilanValue}>{fmt(parseFloat(ventesJour.fcVeille) || 0)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={[styles.bilanLabel, { color: '#534AB7' }]}>FC calculé</Text>
            <Text style={[styles.bilanValue, { color: '#534AB7', fontWeight: '600' }]}>
              {fmt(fcCalc())}
            </Text>
          </View>
          {ventesJour.fc_actuel !== '' && ventesJour.fc_actuel !== undefined && (
            <>
              <View style={styles.row}>
                <Text style={styles.bilanLabel}>FC saisi</Text>
                <Text style={styles.bilanValue}>{fmt(parseFloat(ventesJour.fc_actuel) || 0)}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.bilanLabel}>Écart FC</Text>
                {(() => {
                  const ecart = (parseFloat(ventesJour.fc_actuel) || 0) - fcCalc()
                  return (
                    <Text style={[styles.bilanValue, { color: Math.abs(ecart) < 500 ? '#3B6D11' : '#A32D2D', fontWeight: '600' }]}>
                      {ecart >= 0 ? '+' : ''}{fmt(ecart)}
                    </Text>
                  )
                })()}
              </View>
            </>
          )}
          <View style={[styles.row, { borderBottomWidth: 0 }]}>
            <Text style={[styles.bilanLabel, { fontWeight: '700', color: '#1a1a1a', fontSize: 15 }]}>
              Bénéfice SC
            </Text>
            <Text style={[styles.bilanValue, { color: '#3B6D11', fontWeight: '700', fontSize: 18 }]}>
              {fmt(beneficeSCCalc())}
            </Text>
          </View>
        </View>

        {/* Boutons */}
        <TouchableOpacity style={styles.modifBtn} onPress={() => router.back()}>
          <Text style={styles.modifTxt}>✏️ Retourner modifier</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.validerBtn, validating && { opacity: 0.6 }]}
          onPress={valider}
          disabled={validating}
        >
          {validating ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.validerTxt}>✅ Valider le point du jour</Text>
          )}
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>

      <Modal visible={confirmVisible} transparent animationType="fade">
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmBox}>
            <Text style={styles.confirmTitre}>✅ Valider le point</Text>
            <Text style={styles.confirmMsg}>
              Valider le point du {formatDate(dateJour)} ?{'\n\n'}
              Vente shifts : {fmt(cumulShifts?.venteTotal || totalVentes())}{'\n'}
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: {
    backgroundColor: '#EF9F27', padding: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'
  },
  back: { fontSize: 16, color: '#412402', fontWeight: '500' },
  headerTitre: { fontSize: 16, fontWeight: '600', color: '#412402', textAlign: 'center' },
  headerSub: { fontSize: 11, color: '#854F0B', textAlign: 'center' },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingTxt: { fontSize: 13, color: '#888', marginTop: 12 },
  body: { flex: 1, padding: 14 },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  kpiCard: {
    width: '47%', backgroundColor: '#fff', borderRadius: 12,
    padding: 12, borderWidth: 0.5, borderColor: '#eee'
  },
  kpiLabel: { fontSize: 10, color: '#888', marginBottom: 4 },
  kpiValue: { fontSize: 14, fontWeight: '600' },
  sectionTitre: {
    fontSize: 12, fontWeight: '600', color: '#888', marginBottom: 8,
    textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4
  },
  card: {
    backgroundColor: '#fff', borderRadius: 14, padding: 14,
    marginBottom: 14, borderWidth: 0.5, borderColor: '#eee'
  },
  shiftCard: {
    backgroundColor: '#fff', borderRadius: 14, padding: 14,
    marginBottom: 10, borderWidth: 0.5, borderColor: '#eee'
  },
  shiftHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  shiftNumBox: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#EF9F27', alignItems: 'center', justifyContent: 'center'
  },
  shiftNumTxt: { fontSize: 12, fontWeight: '600', color: '#412402' },
  shiftHeures: { fontSize: 13, fontWeight: '600', color: '#1a1a1a' },
  shiftCaissier: { fontSize: 11, color: '#534AB7', marginTop: 2 },
  shiftVente: { fontSize: 14, fontWeight: '700', color: '#EF9F27' },
  shiftDetails: { borderTopWidth: 0.5, borderTopColor: '#f5f5f5', paddingTop: 8 },
  cumulCard: {
    backgroundColor: '#FAEEDA', borderRadius: 14, padding: 14,
    marginBottom: 14, borderWidth: 1, borderColor: '#EF9F27'
  },
  cumulTitre: { fontSize: 13, fontWeight: '600', color: '#854F0B', marginBottom: 10 },
  catLabel: {
    fontSize: 11, fontWeight: '600', color: '#534AB7',
    marginTop: 8, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.3
  },
  row: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', paddingVertical: 7,
    borderBottomWidth: 0.5, borderBottomColor: '#f5f5f5'
  },
  rowLeft: { flex: 1 },
  rowLabel: { fontSize: 13, color: '#555' },
  rowValue: { fontSize: 13, fontWeight: '500', color: '#1a1a1a' },
  rowTotal: {
    borderBottomWidth: 0, marginTop: 6, paddingTop: 10,
    borderTopWidth: 1, borderTopColor: '#eee'
  },
  rowTotalLabel: { fontSize: 13, fontWeight: '600', color: '#1a1a1a' },
  rowTotalValue: { fontSize: 15, fontWeight: '600' },
  statutBadge: {
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10,
    alignSelf: 'flex-start', marginTop: 3
  },
  statutTxt: { fontSize: 10, fontWeight: '500' },
  shiftNomTxt: { fontSize: 10, color: '#534AB7', marginTop: 2 },
  resteTxt: { fontSize: 10, color: '#A32D2D', marginTop: 2 },
  emptyTxt: { fontSize: 13, color: '#bbb', textAlign: 'center', paddingVertical: 10 },
  bilanCard: {
    backgroundColor: '#FAEEDA', borderRadius: 14, padding: 14,
    marginBottom: 14, borderWidth: 1, borderColor: '#FAC775'
  },
  bilanTitre: { fontSize: 14, fontWeight: '600', color: '#854F0B', marginBottom: 12 },
  bilanLabel: { fontSize: 13, color: '#854F0B', flex: 1 },
  bilanValue: { fontSize: 14, fontWeight: '500' },
  modifBtn: {
    backgroundColor: '#fff', borderRadius: 14, padding: 16,
    alignItems: 'center', marginBottom: 10, borderWidth: 1, borderColor: '#EF9F27'
  },
  modifTxt: { fontSize: 15, fontWeight: '600', color: '#EF9F27' },
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
    backgroundColor: '#fff', borderRadius: 18,
    padding: 24, width: '100%', maxWidth: 380
  },
  confirmTitre: { fontSize: 17, fontWeight: '700', color: '#1a1a1a', marginBottom: 12 },
  confirmMsg: { fontSize: 14, color: '#555', lineHeight: 22, marginBottom: 20 },
  confirmBtns: { flexDirection: 'row', gap: 10 },
  confirmCancel: {
    flex: 1, padding: 14, borderRadius: 12,
    backgroundColor: '#f5f5f5', alignItems: 'center'
  },
  confirmCancelTxt: { fontSize: 14, color: '#888' },
  confirmOk: {
    flex: 1, padding: 14, borderRadius: 12,
    backgroundColor: '#3B6D11', alignItems: 'center'
  },
  confirmOkTxt: { fontSize: 14, fontWeight: '600', color: '#fff' },
})