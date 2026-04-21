import * as FileSystem from 'expo-file-system'
import { router } from 'expo-router'
import * as Sharing from 'expo-sharing'
import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  SafeAreaView, ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View
} from 'react-native'
import { Calendar } from 'react-native-calendars'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'

const STATUT_COLORS = {
  'Présent': { bg: '#EAF3DE', text: '#3B6D11' },
  'Absent': { bg: '#FAECE7', text: '#993C1D' },
  'Repos': { bg: '#E6F1FB', text: '#185FA5' },
  'Congé': { bg: '#EEEDFE', text: '#3C3489' },
  'Malade': { bg: '#FAEEDA', text: '#854F0B' },
  'Permission': { bg: '#F1EFE8', text: '#444441' },
}

const PERIODES = [
  { label: '7 jours', key: '7days' },
  { label: 'Ce mois', key: 'month' },
  { label: 'Mois préc.', key: 'lastmonth' },
  { label: '📅 Période', key: 'custom' },
]

const ONGLETS = ['Dashboard', 'Travailleurs', 'Présences', 'Salaires']

export default function RHScreen() {
  const [onglet, setOnglet] = useState('Dashboard')
  const [periodeKey, setPeriodeKey] = useState('month')
  const [presences, setPresences] = useState([])
  const [travailleurs, setTravailleurs] = useState([])
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [modalCalendrier, setModalCalendrier] = useState(false)
  const [dateDebut, setDateDebut] = useState('')
  const [dateFin, setDateFin] = useState('')
  const [etapeCalendrier, setEtapeCalendrier] = useState('debut')
  const [restaurants, setRestaurants] = useState([])
  const [restoSelectionne, setRestoSelectionne] = useState(null)

  // Vue détail travailleur
  const [travailleurSelectionne, setTravailleurSelectionne] = useState(null)
  const [modalTravailleur, setModalTravailleur] = useState(false)
  const [periodeTravailleur, setPeriodeTravailleur] = useState('month')
  const [presencesTravailleur, setPresencesTravailleur] = useState([])
  const [loadingTravailleur, setLoadingTravailleur] = useState(false)

  // Modal ajout/modification travailleur
  const [modalFormTravailleur, setModalFormTravailleur] = useState(false)
  const [travailleurEdition, setTravailleurEdition] = useState(null)
  const [formTravailleur, setFormTravailleur] = useState({ nom: '', poste: '', type_contrat: 'CDD' })
  const [savingTravailleur, setSavingTravailleur] = useState(false)

  useEffect(() => { chargerRestaurants() }, [])
  useEffect(() => {
    if (restoSelectionne) chargerDonnees()
  }, [periodeKey, restoSelectionne])
  useEffect(() => {
    if (travailleurSelectionne && modalTravailleur) {
      chargerHistoriqueTravailleur()
    }
  }, [periodeTravailleur, travailleurSelectionne, modalTravailleur])

  async function chargerRestaurants() {
    const { data } = await supabase.from('restaurants').select('*').order('nom')
    setRestaurants(data || [])
    if (data && data.length > 0) setRestoSelectionne(data[0])
  }

  function getDateRange(periode) {
    const today = new Date()
    const fmt = d => d.toISOString().split('T')[0]
    const p = periode || periodeKey
    if (p === '7days') {
      const d = new Date(today); d.setDate(d.getDate() - 6)
      return { debut: fmt(d), fin: fmt(today) }
    }
    if (p === 'month') {
      const d = new Date(today.getFullYear(), today.getMonth(), 1)
      return { debut: fmt(d), fin: fmt(today) }
    }
    if (p === 'lastmonth') {
      const debut = new Date(today.getFullYear(), today.getMonth() - 1, 1)
      const fin = new Date(today.getFullYear(), today.getMonth(), 0)
      return { debut: fmt(debut), fin: fmt(fin) }
    }
    if (p === 'custom') return { debut: dateDebut, fin: dateFin }
    return null
  }

  async function chargerDonnees() {
    setLoading(true)
    const range = getDateRange()
    if (!range || !restoSelectionne) { setLoading(false); return }

    const { data: points } = await supabase
      .from('points').select('id, date')
      .eq('restaurant_id', restoSelectionne.id)
      .gte('date', range.debut)
      .lte('date', range.fin)

    if (!points || points.length === 0) {
      setPresences([]); setLoading(false); return
    }

    const pointIds = points.map(p => p.id)
    const pointDates = {}
    points.forEach(p => { pointDates[p.id] = p.date })

    const { data: presData } = await supabase
      .from('presences').select('*').in('point_id', pointIds)

    setPresences((presData || []).map(p => ({ ...p, date: pointDates[p.point_id] || '' })))

    const { data: travData } = await supabase
      .from('travailleurs').select('*')
      .eq('restaurant_id', restoSelectionne.id)
      .eq('actif', true).order('nom')
    setTravailleurs(travData || [])

    setLoading(false)
  }

  async function chargerHistoriqueTravailleur() {
    if (!travailleurSelectionne || !restoSelectionne) return
    setLoadingTravailleur(true)

    const range = getDateRange(periodeTravailleur)
    if (!range) { setLoadingTravailleur(false); return }

    const { data: points } = await supabase
      .from('points').select('id, date')
      .eq('restaurant_id', restoSelectionne.id)
      .gte('date', range.debut)
      .lte('date', range.fin)

    if (!points || points.length === 0) {
      setPresencesTravailleur([]); setLoadingTravailleur(false); return
    }

    const pointIds = points.map(p => p.id)
    const pointDates = {}
    points.forEach(p => { pointDates[p.id] = p.date })

    const { data: presData } = await supabase
      .from('presences').select('*')
      .in('point_id', pointIds)
      .eq('travailleur_id', travailleurSelectionne.id)

    setPresencesTravailleur(
      (presData || []).map(p => ({ ...p, date: pointDates[p.point_id] || '' }))
        .sort((a, b) => b.date.localeCompare(a.date))
    )
    setLoadingTravailleur(false)
  }

  function ouvrirDetailTravailleur(t) {
    setTravailleurSelectionne(t)
    setPeriodeTravailleur('month')
    setModalTravailleur(true)
  }

  async function sauvegarderTravailleur() {
    if (!formTravailleur.nom) {
      Alert.alert('Erreur', 'Le nom est obligatoire')
      return
    }
    setSavingTravailleur(true)

    if (travailleurEdition) {
      await supabase.from('travailleurs')
        .update({
          nom: formTravailleur.nom,
          poste: formTravailleur.poste,
          type_contrat: formTravailleur.type_contrat,
        })
        .eq('id', travailleurEdition.id)
    } else {
      await supabase.from('travailleurs').insert({
        nom: formTravailleur.nom,
        poste: formTravailleur.poste,
        type_contrat: formTravailleur.type_contrat || 'CDD',
        restaurant_id: restoSelectionne.id,
        actif: true,
      })
    }

    setSavingTravailleur(false)
    setModalFormTravailleur(false)
    setTravailleurEdition(null)
    setFormTravailleur({ nom: '', poste: '', type_contrat: 'CDD' })
    chargerDonnees()
    Alert.alert('Succès', travailleurEdition ? 'Travailleur modifié !' : 'Travailleur ajouté !')
  }

  async function exporterExcel() {
    setExporting(true)
    try {
      const statsT = statsParTravailleur()
      const globales = statsGlobales()

      const resumeData = [
        ['Nom', 'Poste', 'Jours présent', 'Jours absent', 'Repos', 'Congé', 'Malade', 'Permission', 'Total payé (FCFA)'],
        ...statsT.map(t => [
          t.nom, t.poste || '',
          t.present, t.absent, t.repos,
          t.conge, t.malade, t.permission,
          t.totalPaye
        ]),
        [],
        ['TOTAL', '', globales.totalPresences, globales.totalAbsences, '', '', '', '', globales.totalPaye],
      ]

      const detailData = [
        ['Date', 'Travailleur', 'Statut', 'Shift', 'Heure début', 'Heure fin', 'Paie (FCFA)'],
        ...presences
          .sort((a, b) => b.date.localeCompare(a.date))
          .map(p => [p.date, p.travailleur_nom, p.statut, p.shift_nom || '', p.heure_debut || '', p.heure_fin || '', p.paye || 0])
      ]

      const salairesData = [
        ['Nom', 'Poste', 'Jours travaillés', 'Total salaire (FCFA)', '% masse salariale'],
        ...statsT.sort((a, b) => b.totalPaye - a.totalPaye).map(t => [
          t.nom, t.poste || '', t.present, t.totalPaye,
          globales.totalPaye > 0 ? `${(t.totalPaye / globales.totalPaye * 100).toFixed(1)}%` : '0%'
        ]),
        [],
        ['TOTAL', '', globales.totalPresences, globales.totalPaye, '100%'],
      ]

      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumeData), 'Résumé')
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(detailData), 'Présences')
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(salairesData), 'Salaires')

      const wbout = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' })
      const today = new Date().toISOString().split('T')[0]
      const fileName = `RH_${restoSelectionne?.nom}_${today}.xlsx`.replace(/\s+/g, '_')
      const fileUri = FileSystem.documentDirectory + fileName

      await FileSystem.writeAsStringAsync(fileUri, wbout, {
        encoding: FileSystem.EncodingType.Base64
      })

      await Sharing.shareAsync(fileUri, {
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        dialogTitle: 'Exporter le rapport RH',
        UTI: 'com.microsoft.excel.xlsx',
      })
    } catch (error) {
      Alert.alert('Erreur', "Impossible d'exporter : " + error.message)
    }
    setExporting(false)
  }

  function statsParTravailleur() {
    const stats = {}
    travailleurs.forEach(t => {
      stats[t.id] = {
        id: t.id, nom: t.nom, poste: t.poste,
        present: 0, absent: 0, repos: 0,
        conge: 0, malade: 0, permission: 0,
        totalPaye: 0, jours: 0,
      }
    })
    presences.forEach(p => {
      if (!stats[p.travailleur_id]) {
        stats[p.travailleur_id] = {
          id: p.travailleur_id, nom: p.travailleur_nom, poste: '',
          present: 0, absent: 0, repos: 0,
          conge: 0, malade: 0, permission: 0,
          totalPaye: 0, jours: 0,
        }
      }
      const s = stats[p.travailleur_id]
      s.jours++
      if (p.statut === 'Présent') { s.present++; s.totalPaye += (p.paye || 0) }
      else if (p.statut === 'Absent') s.absent++
      else if (p.statut === 'Repos') s.repos++
      else if (p.statut === 'Congé') s.conge++
      else if (p.statut === 'Malade') s.malade++
      else if (p.statut === 'Permission') s.permission++
    })
    return Object.values(stats).filter(s => s.jours > 0)
  }

  function statsGlobales() {
    const s = statsParTravailleur()
    return {
      totalPresences: s.reduce((sum, t) => sum + t.present, 0),
      totalAbsences: s.reduce((sum, t) => sum + t.absent, 0),
      totalPaye: s.reduce((sum, t) => sum + t.totalPaye, 0),
      nbJours: [...new Set(presences.map(p => p.date))].length,
      nbTravailleurs: travailleurs.length,
    }
  }

  function statsTravailleurDetail() {
    const pres = presencesTravailleur
    let present = 0, absent = 0, repos = 0, conge = 0, malade = 0, permission = 0, totalPaye = 0
    pres.forEach(p => {
      if (p.statut === 'Présent') { present++; totalPaye += (p.paye || 0) }
      else if (p.statut === 'Absent') absent++
      else if (p.statut === 'Repos') repos++
      else if (p.statut === 'Congé') conge++
      else if (p.statut === 'Malade') malade++
      else if (p.statut === 'Permission') permission++
    })
    const total = pres.length
    const taux = total > 0 ? (present / total * 100) : 0
    return { present, absent, repos, conge, malade, permission, totalPaye, total, taux }
  }

  function fmt(n) { return Math.round(n).toLocaleString('fr-FR') + ' FCFA' }

  function formatDate(dateStr) {
    if (!dateStr) return ''
    const [y, m, d] = dateStr.split('-')
    const mois = ['jan', 'fév', 'mar', 'avr', 'mai', 'juin', 'juil', 'août', 'sep', 'oct', 'nov', 'déc']
    return `${parseInt(d)} ${mois[parseInt(m) - 1]} ${y}`
  }

  function titrePeriode(periode) {
    const p = periode || periodeKey
    if (p === '7days') return '7 derniers jours'
    if (p === 'month') return 'Ce mois'
    if (p === 'lastmonth') return 'Mois précédent'
    if (p === 'custom' && dateDebut && dateFin)
      return `${formatDate(dateDebut)} → ${formatDate(dateFin)}`
    return 'Période personnalisée'
  }

  const stats = statsParTravailleur()
  const globales = statsGlobales()

  // ─── DASHBOARD ─────────────────────────────────────────────
  function renderDashboard() {
    return (
      <ScrollView showsVerticalScrollIndicator={false}>
        <TouchableOpacity
          style={[styles.exportBtn, exporting && { opacity: 0.6 }]}
          onPress={exporterExcel}
          disabled={exporting}
        >
          {exporting ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.exportTxt}>📊 Exporter en Excel</Text>
          )}
        </TouchableOpacity>

        <View style={styles.kpiGrid}>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiIcon}>👥</Text>
            <Text style={styles.kpiValue}>{globales.nbTravailleurs}</Text>
            <Text style={styles.kpiLabel}>Travailleurs</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiIcon}>📅</Text>
            <Text style={styles.kpiValue}>{globales.nbJours}</Text>
            <Text style={styles.kpiLabel}>Jours</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiIcon}>✅</Text>
            <Text style={[styles.kpiValue, { color: '#3B6D11' }]}>{globales.totalPresences}</Text>
            <Text style={styles.kpiLabel}>Présences</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiIcon}>❌</Text>
            <Text style={[styles.kpiValue, { color: '#A32D2D' }]}>{globales.totalAbsences}</Text>
            <Text style={styles.kpiLabel}>Absences</Text>
          </View>
        </View>

        <View style={styles.salaireCard}>
          <Text style={styles.salaireTitre}>💰 Total salaires versés</Text>
          <Text style={styles.salaireValeur}>{fmt(globales.totalPaye)}</Text>
          <Text style={styles.salaireSub}>{titrePeriode()} — {restoSelectionne?.nom}</Text>
        </View>

        <Text style={styles.sectionTitre}>Taux de présence par travailleur</Text>
        {stats.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyIcon}>📊</Text>
            <Text style={styles.emptyTxt}>Aucune donnée sur cette période</Text>
          </View>
        ) : (
          stats.sort((a, b) => b.present - a.present).map((t, i) => {
            const total = t.present + t.absent + t.repos + t.conge + t.malade + t.permission
            const taux = total > 0 ? (t.present / total * 100) : 0
            return (
              <TouchableOpacity
                key={i}
                style={styles.tauxCard}
                onPress={() => ouvrirDetailTravailleur(
                  travailleurs.find(tr => tr.id === t.id) || { id: t.id, nom: t.nom, poste: t.poste }
                )}
              >
                <View style={styles.tauxHeader}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarTxt}>
                      {t.nom.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.tauxNom}>{t.nom}</Text>
                    <Text style={styles.tauxPoste}>{t.poste || 'Sans poste'}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={[styles.tauxPct, {
                      color: taux >= 80 ? '#3B6D11' : taux >= 50 ? '#854F0B' : '#A32D2D'
                    }]}>
                      {taux.toFixed(0)}%
                    </Text>
                    <Text style={styles.voirDetail}>Voir détail ›</Text>
                  </View>
                </View>
                <View style={styles.tauxBarBg}>
                  <View style={[styles.tauxBarFill, {
                    width: `${taux}%`,
                    backgroundColor: taux >= 80 ? '#3B6D11' : taux >= 50 ? '#EF9F27' : '#A32D2D'
                  }]} />
                </View>
                <View style={styles.tauxStats}>
                  <Text style={[styles.tauxStat, { color: '#3B6D11' }]}>✅ {t.present}j</Text>
                  <Text style={[styles.tauxStat, { color: '#993C1D' }]}>❌ {t.absent}j</Text>
                  {t.repos > 0 && <Text style={[styles.tauxStat, { color: '#185FA5' }]}>😴 {t.repos}j</Text>}
                  {t.conge > 0 && <Text style={[styles.tauxStat, { color: '#3C3489' }]}>🏖 {t.conge}j</Text>}
                  {t.malade > 0 && <Text style={[styles.tauxStat, { color: '#854F0B' }]}>🤒 {t.malade}j</Text>}
                  {t.permission > 0 && <Text style={[styles.tauxStat, { color: '#444441' }]}>📋 {t.permission}j</Text>}
                </View>
              </TouchableOpacity>
            )
          })
        )}
        <View style={{ height: 30 }} />
      </ScrollView>
    )
  }

  // ─── TRAVAILLEURS ───────────────────────────────────────────
  function renderTravailleurs() {
    return (
      <ScrollView showsVerticalScrollIndicator={false}>
        <TouchableOpacity
          style={styles.addTravBtn}
          onPress={() => {
            setFormTravailleur({ nom: '', poste: '', type_contrat: 'CDD' })
            setTravailleurEdition(null)
            setModalFormTravailleur(true)
          }}
        >
          <Text style={styles.addTravTxt}>+ Ajouter un travailleur</Text>
        </TouchableOpacity>

        <Text style={styles.sectionTitre}>{travailleurs.length} travailleur(s) actif(s)</Text>
        {travailleurs.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyIcon}>👥</Text>
            <Text style={styles.emptyTxt}>Aucun travailleur dans ce restaurant</Text>
          </View>
        ) : (
          travailleurs.map((t, i) => {
            const statsTrav = stats.find(s => s.id === t.id)
            const total = statsTrav ? statsTrav.present + statsTrav.absent + statsTrav.repos +
              statsTrav.conge + statsTrav.malade + statsTrav.permission : 0
            const taux = total > 0 ? (statsTrav.present / total * 100) : 0

            return (
              <View key={i} style={styles.travCard}>
                <TouchableOpacity
                  style={styles.travLeft}
                  onPress={() => ouvrirDetailTravailleur(t)}
                >
                  <View style={styles.avatar}>
                    <Text style={styles.avatarTxt}>
                      {t.nom.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.travNom}>{t.nom}</Text>
                    <Text style={styles.travPoste}>{t.poste || 'Sans poste'} — {t.type_contrat}</Text>
                    {statsTrav && (
                      <View style={styles.travMiniStats}>
                        <Text style={[styles.travMiniStat, { color: '#3B6D11' }]}>✅ {statsTrav.present}j</Text>
                        <Text style={[styles.travMiniStat, { color: '#993C1D' }]}>❌ {statsTrav.absent}j</Text>
                        <Text style={[styles.travMiniStat, { color: '#185FA5' }]}>💰 {fmt(statsTrav.totalPaye)}</Text>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
                <View style={{ alignItems: 'flex-end', gap: 6 }}>
                  {statsTrav && (
                    <Text style={[styles.travTaux, {
                      color: taux >= 80 ? '#3B6D11' : taux >= 50 ? '#854F0B' : '#A32D2D'
                    }]}>
                      {taux.toFixed(0)}%
                    </Text>
                  )}
                  <TouchableOpacity
                    style={styles.contratEditBtn}
                    onPress={() => {
                      setFormTravailleur({
                        nom: t.nom,
                        poste: t.poste || '',
                        type_contrat: t.type_contrat || 'CDD',
                      })
                      setTravailleurEdition(t)
                      setModalFormTravailleur(true)
                    }}
                  >
                    <Text style={styles.contratEditTxt}>✏️ Modifier</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )
          })
        )}
        <View style={{ height: 30 }} />
      </ScrollView>
    )
  }

  // ─── PRESENCES ─────────────────────────────────────────────
  function renderPresences() {
    const parDate = {}
    presences.forEach(p => {
      if (!parDate[p.date]) parDate[p.date] = []
      parDate[p.date].push(p)
    })
    const dates = Object.keys(parDate).sort((a, b) => b.localeCompare(a))

    return (
      <ScrollView showsVerticalScrollIndicator={false}>
        {dates.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyIcon}>👥</Text>
            <Text style={styles.emptyTxt}>Aucune présence sur cette période</Text>
          </View>
        ) : (
          dates.map(date => (
            <View key={date} style={styles.dateSection}>
              <Text style={styles.dateTitre}>{formatDate(date)}</Text>
              <View style={styles.presenceCard}>
                {parDate[date]
                  .sort((a, b) => (a.travailleur_nom || '').localeCompare(b.travailleur_nom || ''))
                  .map((p, i) => (
                    <View key={i} style={[
                      styles.presenceRow,
                      i === parDate[date].length - 1 && { borderBottomWidth: 0 }
                    ]}>
                      <View style={styles.presenceLeft}>
                        <View style={styles.avatarSm}>
                          <Text style={styles.avatarSmTxt}>
                            {(p.travailleur_nom || 'T').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                          </Text>
                        </View>
                        <View>
                          <Text style={styles.presenceNom}>{p.travailleur_nom}</Text>
                          {p.shift_nom && (
                            <Text style={styles.presenceShift}>
                              ⏰ {p.shift_nom} {p.heure_debut ? `(${p.heure_debut} → ${p.heure_fin})` : ''}
                            </Text>
                          )}
                          {p.statut === 'Présent' && p.paye > 0 && (
                            <Text style={styles.presencePaie}>{fmt(p.paye)}</Text>
                          )}
                        </View>
                      </View>
                      <View style={[
                        styles.statutPill,
                        { backgroundColor: STATUT_COLORS[p.statut]?.bg || '#f5f5f5' }
                      ]}>
                        <Text style={[
                          styles.statutPillTxt,
                          { color: STATUT_COLORS[p.statut]?.text || '#888' }
                        ]}>
                          {p.statut}
                        </Text>
                      </View>
                    </View>
                  ))}
              </View>
            </View>
          ))
        )}
        <View style={{ height: 30 }} />
      </ScrollView>
    )
  }

  // ─── SALAIRES ──────────────────────────────────────────────
  function renderSalaires() {
    const statsTriees = [...stats].sort((a, b) => b.totalPaye - a.totalPaye)
    const totalGlobal = statsTriees.reduce((sum, t) => sum + t.totalPaye, 0)

    return (
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.salaireCard}>
          <Text style={styles.salaireTitre}>💰 Total masse salariale</Text>
          <Text style={styles.salaireValeur}>{fmt(totalGlobal)}</Text>
          <Text style={styles.salaireSub}>{titrePeriode()}</Text>
        </View>

        {statsTriees.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyIcon}>💰</Text>
            <Text style={styles.emptyTxt}>Aucune donnée sur cette période</Text>
          </View>
        ) : (
          <View style={styles.salaireListCard}>
            {statsTriees.map((t, i) => {
              const pct = totalGlobal > 0 ? (t.totalPaye / totalGlobal * 100) : 0
              return (
                <TouchableOpacity
                  key={i}
                  style={[styles.salaireRow, i === statsTriees.length - 1 && { borderBottomWidth: 0 }]}
                  onPress={() => ouvrirDetailTravailleur(
                    travailleurs.find(tr => tr.id === t.id) || { id: t.id, nom: t.nom, poste: t.poste }
                  )}
                >
                  <View style={styles.salaireLeft}>
                    <View style={styles.avatar}>
                      <Text style={styles.avatarTxt}>
                        {t.nom.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.salaireNom}>{t.nom}</Text>
                      <Text style={styles.salairePoste}>{t.poste || ''} — {t.present}j travaillé(s)</Text>
                      <View style={styles.salaireBarre}>
                        <View style={[styles.salaireBarreFill, { width: `${pct}%` }]} />
                      </View>
                    </View>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={styles.salaireValeurRow}>{fmt(t.totalPaye)}</Text>
                    <Text style={styles.salairePct}>{pct.toFixed(1)}%</Text>
                  </View>
                </TouchableOpacity>
              )
            })}
            <View style={styles.salaireTotalRow}>
              <Text style={styles.salaireTotalLabel}>Total</Text>
              <Text style={styles.salaireTotalVal}>{fmt(totalGlobal)}</Text>
            </View>
          </View>
        )}
        <View style={{ height: 30 }} />
      </ScrollView>
    )
  }

  // ─── MODAL DETAIL TRAVAILLEUR ───────────────────────────────
  function renderModalDetailTravailleur() {
    if (!travailleurSelectionne) return null
    const s = statsTravailleurDetail()

    return (
      <Modal visible={modalTravailleur} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modalTravContainer}>
          <View style={styles.modalTravHeader}>
            <TouchableOpacity onPress={() => setModalTravailleur(false)}>
              <Text style={styles.modalTravClose}>✕ Fermer</Text>
            </TouchableOpacity>
            <View style={styles.modalTravInfo}>
              <View style={styles.avatarLg}>
                <Text style={styles.avatarLgTxt}>
                  {travailleurSelectionne.nom.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                </Text>
              </View>
              <View>
                <Text style={styles.modalTravNom}>{travailleurSelectionne.nom}</Text>
                <Text style={styles.modalTravPoste}>{travailleurSelectionne.poste || 'Sans poste'} — {travailleurSelectionne.type_contrat || ''}</Text>
              </View>
            </View>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.periodeBarModal}>
            {PERIODES.map(p => (
              <TouchableOpacity
                key={p.key}
                style={[styles.periodeBtn, periodeTravailleur === p.key && styles.periodeBtnActive]}
                onPress={() => setPeriodeTravailleur(p.key)}
              >
                <Text style={[styles.periodeTxt, periodeTravailleur === p.key && styles.periodeTxtActive]}>
                  {p.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {loadingTravailleur ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator size="large" color="#185FA5" />
            </View>
          ) : (
            <ScrollView style={{ padding: 16 }} showsVerticalScrollIndicator={false}>
              <View style={styles.travStatsGrid}>
                <View style={[styles.travStatCard, { backgroundColor: '#EAF3DE' }]}>
                  <Text style={styles.travStatVal}>{s.present}</Text>
                  <Text style={[styles.travStatLabel, { color: '#3B6D11' }]}>Présences</Text>
                </View>
                <View style={[styles.travStatCard, { backgroundColor: '#FAECE7' }]}>
                  <Text style={styles.travStatVal}>{s.absent}</Text>
                  <Text style={[styles.travStatLabel, { color: '#993C1D' }]}>Absences</Text>
                </View>
                <View style={[styles.travStatCard, { backgroundColor: '#E6F1FB' }]}>
                  <Text style={styles.travStatVal}>{s.repos + s.conge + s.malade + s.permission}</Text>
                  <Text style={[styles.travStatLabel, { color: '#185FA5' }]}>Autres</Text>
                </View>
                <View style={[styles.travStatCard, { backgroundColor: '#EEEDFE' }]}>
                  <Text style={[styles.travStatVal, { fontSize: 14 }]}>{s.taux.toFixed(0)}%</Text>
                  <Text style={[styles.travStatLabel, { color: '#534AB7' }]}>Taux</Text>
                </View>
              </View>

              <View style={styles.travSalaireCard}>
                <Text style={styles.travSalaireTitre}>💰 Total perçu — {titrePeriode(periodeTravailleur)}</Text>
                <Text style={styles.travSalaireVal}>{fmt(s.totalPaye)}</Text>
                <Text style={styles.travSalaireSub}>
                  Moyenne : {s.present > 0 ? fmt(s.totalPaye / s.present) : '0 FCFA'} / jour
                </Text>
              </View>

              {s.total > 0 && (
                <View style={styles.tauxBarCard}>
                  <View style={styles.tauxBarBg}>
                    <View style={[styles.tauxBarFill, {
                      width: `${s.taux}%`,
                      backgroundColor: s.taux >= 80 ? '#3B6D11' : s.taux >= 50 ? '#EF9F27' : '#A32D2D'
                    }]} />
                  </View>
                  <Text style={styles.tauxBarLabel}>
                    {s.taux.toFixed(0)}% de présence sur {s.total} jour(s)
                  </Text>
                </View>
              )}

              <Text style={styles.sectionTitre}>Historique jour par jour</Text>
              {presencesTravailleur.length === 0 ? (
                <View style={styles.emptyBox}>
                  <Text style={styles.emptyTxt}>Aucune présence sur cette période</Text>
                </View>
              ) : (
                <View style={styles.presenceCard}>
                  {presencesTravailleur.map((p, i) => (
                    <View key={i} style={[
                      styles.presenceRow,
                      i === presencesTravailleur.length - 1 && { borderBottomWidth: 0 }
                    ]}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.presenceDate}>{formatDate(p.date)}</Text>
                        {p.shift_nom && (
                          <Text style={styles.presenceShift}>
                            ⏰ {p.shift_nom} {p.heure_debut ? `(${p.heure_debut} → ${p.heure_fin})` : ''}
                          </Text>
                        )}
                      </View>
                      <View style={[styles.statutPill, { backgroundColor: STATUT_COLORS[p.statut]?.bg || '#f5f5f5' }]}>
                        <Text style={[styles.statutPillTxt, { color: STATUT_COLORS[p.statut]?.text || '#888' }]}>
                          {p.statut}
                        </Text>
                      </View>
                      {p.statut === 'Présent' && p.paye > 0 && (
                        <Text style={styles.presencePaieHistorique}>{fmt(p.paye)}</Text>
                      )}
                    </View>
                  ))}
                </View>
              )}
              <View style={{ height: 40 }} />
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>
    )
  }

  // ─── MODAL FORM TRAVAILLEUR ─────────────────────────────────
  function renderModalFormTravailleur() {
    return (
      <Modal visible={modalFormTravailleur} transparent animationType="slide">
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.modalOverlay}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
              <View style={styles.modal}>
                <Text style={styles.modalTitre}>
                  {travailleurEdition ? 'Modifier travailleur' : 'Nouveau travailleur'}
                </Text>

                <Text style={styles.modalLabel}>Nom complet *</Text>
                <TextInput
                  style={[styles.modalInput, travailleurEdition && { opacity: 0.6 }]}
                  placeholder="Ex: Kouamé Assi"
                  value={formTravailleur.nom}
                  onChangeText={v => setFormTravailleur(p => ({ ...p, nom: v }))}
                  placeholderTextColor="#bbb"
                  editable={!travailleurEdition}
                />

                <Text style={styles.modalLabel}>Poste</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="Ex: Caissier, Cuisine, Service..."
                  value={formTravailleur.poste}
                  onChangeText={v => setFormTravailleur(p => ({ ...p, poste: v }))}
                  placeholderTextColor="#bbb"
                />

                <Text style={styles.modalLabel}>Type de contrat</Text>
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
                  {['CDI', 'CDD', 'Journalier'].map(c => (
                    <TouchableOpacity
                      key={c}
                      style={[
                        styles.contratChoix,
                        formTravailleur.type_contrat === c && styles.contratChoixActive
                      ]}
                      onPress={() => setFormTravailleur(p => ({ ...p, type_contrat: c }))}
                    >
                      <Text style={[
                        styles.contratChoixTxt,
                        formTravailleur.type_contrat === c && styles.contratChoixTxtActive
                      ]}>
                        {c}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <View style={styles.modalBtns}>
                  <TouchableOpacity
                    style={styles.modalCancel}
                    onPress={() => {
                      setModalFormTravailleur(false)
                      setTravailleurEdition(null)
                      setFormTravailleur({ nom: '', poste: '', type_contrat: 'CDD' })
                    }}
                  >
                    <Text style={styles.modalCancelTxt}>Annuler</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalConfirm, savingTravailleur && { opacity: 0.6 }]}
                    onPress={sauvegarderTravailleur}
                    disabled={savingTravailleur}
                  >
                    <Text style={styles.modalConfirmTxt}>
                      {savingTravailleur ? 'Enregistrement...' : 'Enregistrer'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </KeyboardAvoidingView>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    )
  }

  // ─── MODAL CALENDRIER ──────────────────────────────────────
  function renderModalCalendrier() {
    return (
      <Modal visible={modalCalendrier} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitre}>Choisir une période</Text>
              <TouchableOpacity onPress={() => setModalCalendrier(false)}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.etapeRow}>
              <View style={[styles.etapeBadge, etapeCalendrier === 'debut' && styles.etapeBadgeActive]}>
                <Text style={[styles.etapeTxt, etapeCalendrier === 'debut' && styles.etapeTxtActive]}>
                  1. Date début
                </Text>
              </View>
              <View style={styles.etapeLine} />
              <View style={[styles.etapeBadge, etapeCalendrier === 'fin' && styles.etapeBadgeActive]}>
                <Text style={[styles.etapeTxt, etapeCalendrier === 'fin' && styles.etapeTxtActive]}>
                  2. Date fin
                </Text>
              </View>
            </View>
            <View style={styles.selectedDates}>
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Text style={{ fontSize: 10, color: '#888', marginBottom: 4 }}>Début</Text>
                <Text style={{ fontSize: 13, fontWeight: '600', color: dateDebut ? '#1a1a1a' : '#ccc' }}>
                  {dateDebut ? formatDate(dateDebut) : 'Non sélectionné'}
                </Text>
              </View>
              <Text style={{ fontSize: 16, color: '#185FA5', marginHorizontal: 8 }}>→</Text>
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Text style={{ fontSize: 10, color: '#888', marginBottom: 4 }}>Fin</Text>
                <Text style={{ fontSize: 13, fontWeight: '600', color: dateFin ? '#1a1a1a' : '#ccc' }}>
                  {dateFin ? formatDate(dateFin) : 'Non sélectionné'}
                </Text>
              </View>
            </View>
            <Calendar
              onDayPress={day => {
                if (etapeCalendrier === 'debut') {
                  setDateDebut(day.dateString)
                  setEtapeCalendrier('fin')
                } else {
                  if (day.dateString < dateDebut) {
                    setDateDebut(day.dateString)
                  } else {
                    setDateFin(day.dateString)
                  }
                }
              }}
              maxDate={new Date().toISOString().split('T')[0]}
              theme={{
                selectedDayBackgroundColor: '#185FA5',
                todayTextColor: '#185FA5',
                arrowColor: '#185FA5',
                monthTextColor: '#1a1a1a',
                dayTextColor: '#1a1a1a',
                textDisabledColor: '#ccc',
              }}
            />
            <View style={styles.modalBtns}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setModalCalendrier(false)}>
                <Text style={styles.modalCancelTxt}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirm, (!dateDebut || !dateFin) && { opacity: 0.4 }]}
                onPress={() => {
                  if (!dateDebut || !dateFin) return
                  setModalCalendrier(false)
                  setPeriodeKey('custom')
                }}
                disabled={!dateDebut || !dateFin}
              >
                <Text style={styles.modalConfirmTxt}>Voir les résultats</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    )
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitre}>Ressources Humaines</Text>
          <Text style={styles.headerSub}>{restoSelectionne?.nom || 'Tous les restaurants'}</Text>
        </View>
        <TouchableOpacity style={styles.logoutBtn} onPress={() => router.replace('/login')}>
          <Text style={styles.logoutTxt}>⏻ Quitter</Text>
        </TouchableOpacity>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.restoBar}>
        {restaurants.map(r => (
          <TouchableOpacity
            key={r.id}
            style={[styles.restoBtn, restoSelectionne?.id === r.id && styles.restoBtnActive]}
            onPress={() => setRestoSelectionne(r)}
          >
            <Text style={[styles.restoTxt, restoSelectionne?.id === r.id && styles.restoTxtActive]}>
              {r.nom}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.periodeBar}>
        {PERIODES.map(p => (
          <TouchableOpacity
            key={p.key}
            style={[styles.periodeBtn, periodeKey === p.key && styles.periodeBtnActive]}
            onPress={() => {
              if (p.key === 'custom') {
                setDateDebut(''); setDateFin('')
                setEtapeCalendrier('debut')
                setModalCalendrier(true)
              } else {
                setPeriodeKey(p.key)
              }
            }}
          >
            <Text style={[styles.periodeTxt, periodeKey === p.key && styles.periodeTxtActive]}>
              {p.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <View style={styles.periodeBanner}>
        <Text style={styles.periodeBannerTxt}>📅 {titrePeriode()}</Text>
        <Text style={styles.periodeBannerSub}>{presences.length} enregistrement(s)</Text>
      </View>

      <View style={styles.ongletBar}>
        {ONGLETS.map(o => (
          <TouchableOpacity
            key={o}
            style={[styles.ongletBtn, onglet === o && styles.ongletBtnActive]}
            onPress={() => setOnglet(o)}
          >
            <Text style={[styles.ongletTxt, onglet === o && styles.ongletTxtActive]}>{o}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#185FA5" />
          <Text style={styles.loadingTxt}>Chargement des données RH...</Text>
        </View>
      ) : (
        <View style={styles.body}>
          {onglet === 'Dashboard' && renderDashboard()}
          {onglet === 'Travailleurs' && renderTravailleurs()}
          {onglet === 'Présences' && renderPresences()}
          {onglet === 'Salaires' && renderSalaires()}
        </View>
      )}

      {renderModalDetailTravailleur()}
      {renderModalFormTravailleur()}
      {renderModalCalendrier()}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: {
    backgroundColor: '#185FA5', padding: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'
  },
  headerTitre: { fontSize: 16, fontWeight: '600', color: '#fff' },
  headerSub: { fontSize: 11, color: '#B8D4F5', marginTop: 2 },
  logoutBtn: { backgroundColor: '#0F4880', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  logoutTxt: { fontSize: 12, color: '#B8D4F5', fontWeight: '500' },
  restoBar: { backgroundColor: '#fff', maxHeight: 44, borderBottomWidth: 0.5, borderBottomColor: '#eee' },
  restoBtn: { paddingHorizontal: 14, paddingVertical: 12 },
  restoBtnActive: { borderBottomWidth: 2, borderBottomColor: '#185FA5' },
  restoTxt: { fontSize: 12, color: '#888' },
  restoTxtActive: { color: '#185FA5', fontWeight: '600' },
  periodeBar: { backgroundColor: '#fff', maxHeight: 44, borderBottomWidth: 0.5, borderBottomColor: '#eee' },
  periodeBarModal: { backgroundColor: '#fff', maxHeight: 44, borderBottomWidth: 0.5, borderBottomColor: '#eee' },
  periodeBtn: { paddingHorizontal: 16, paddingVertical: 12 },
  periodeBtnActive: { borderBottomWidth: 2, borderBottomColor: '#185FA5' },
  periodeTxt: { fontSize: 13, color: '#888' },
  periodeTxtActive: { color: '#185FA5', fontWeight: '600' },
  periodeBanner: {
    backgroundColor: '#E6F1FB', padding: 8, paddingHorizontal: 16,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderBottomWidth: 0.5, borderBottomColor: '#B8D4F5'
  },
  periodeBannerTxt: { fontSize: 12, color: '#0F4880', fontWeight: '500' },
  periodeBannerSub: { fontSize: 11, color: '#185FA5' },
  ongletBar: { flexDirection: 'row', backgroundColor: '#fff', borderBottomWidth: 0.5, borderBottomColor: '#eee' },
  ongletBtn: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  ongletBtnActive: { borderBottomWidth: 2, borderBottomColor: '#185FA5' },
  ongletTxt: { fontSize: 12, color: '#888' },
  ongletTxtActive: { color: '#185FA5', fontWeight: '600' },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingTxt: { fontSize: 13, color: '#888', marginTop: 12 },
  body: { flex: 1, padding: 14 },
  exportBtn: {
    backgroundColor: '#185FA5', borderRadius: 12, padding: 14,
    alignItems: 'center', marginBottom: 14
  },
  exportTxt: { fontSize: 14, fontWeight: '600', color: '#fff' },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  kpiCard: {
    width: '47%', backgroundColor: '#fff', borderRadius: 12,
    padding: 14, alignItems: 'center', borderWidth: 0.5, borderColor: '#eee'
  },
  kpiIcon: { fontSize: 24, marginBottom: 6 },
  kpiValue: { fontSize: 22, fontWeight: '600', color: '#185FA5' },
  kpiLabel: { fontSize: 11, color: '#888', marginTop: 4 },
  salaireCard: {
    backgroundColor: '#185FA5', borderRadius: 14, padding: 16,
    marginBottom: 14, alignItems: 'center'
  },
  salaireTitre: { fontSize: 13, color: '#B8D4F5', marginBottom: 8 },
  salaireValeur: { fontSize: 24, fontWeight: '600', color: '#fff', marginBottom: 4 },
  salaireSub: { fontSize: 11, color: '#B8D4F5' },
  sectionTitre: {
    fontSize: 12, fontWeight: '600', color: '#888',
    marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5
  },
  tauxCard: {
    backgroundColor: '#fff', borderRadius: 14, padding: 14,
    marginBottom: 10, borderWidth: 0.5, borderColor: '#eee'
  },
  tauxHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  avatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#185FA5', alignItems: 'center', justifyContent: 'center'
  },
  avatarTxt: { fontSize: 13, fontWeight: '600', color: '#fff' },
  avatarSm: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#185FA5', alignItems: 'center', justifyContent: 'center'
  },
  avatarSmTxt: { fontSize: 11, fontWeight: '600', color: '#fff' },
  avatarLg: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#185FA5', alignItems: 'center', justifyContent: 'center', marginRight: 12
  },
  avatarLgTxt: { fontSize: 18, fontWeight: '600', color: '#fff' },
  tauxNom: { fontSize: 14, fontWeight: '600', color: '#1a1a1a' },
  tauxPoste: { fontSize: 11, color: '#888', marginTop: 2 },
  tauxPct: { fontSize: 18, fontWeight: '600' },
  voirDetail: { fontSize: 10, color: '#185FA5', marginTop: 2 },
  tauxBarBg: { height: 8, backgroundColor: '#f5f5f5', borderRadius: 4, overflow: 'hidden', marginBottom: 8 },
  tauxBarFill: { height: '100%', borderRadius: 4 },
  tauxStats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tauxStat: { fontSize: 11, fontWeight: '500' },
  addTravBtn: {
    borderWidth: 1, borderStyle: 'dashed', borderColor: '#185FA5',
    borderRadius: 12, padding: 14, alignItems: 'center', marginBottom: 14
  },
  addTravTxt: { fontSize: 14, color: '#185FA5', fontWeight: '500' },
  travCard: {
    backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 10,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 0.5, borderColor: '#eee'
  },
  travLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  travNom: { fontSize: 14, fontWeight: '600', color: '#1a1a1a' },
  travPoste: { fontSize: 11, color: '#888', marginTop: 2 },
  travMiniStats: { flexDirection: 'row', gap: 8, marginTop: 4 },
  travMiniStat: { fontSize: 10, fontWeight: '500' },
  travTaux: { fontSize: 18, fontWeight: '600' },
  contratEditBtn: {
    backgroundColor: '#E6F1FB', paddingHorizontal: 10,
    paddingVertical: 4, borderRadius: 10
  },
  contratEditTxt: { fontSize: 11, color: '#185FA5', fontWeight: '500' },
  emptyBox: { alignItems: 'center', paddingVertical: 40 },
  emptyIcon: { fontSize: 40, marginBottom: 12 },
  emptyTxt: { fontSize: 13, color: '#888' },
  dateSection: { marginBottom: 14 },
  dateTitre: {
    fontSize: 12, fontWeight: '600', color: '#185FA5',
    marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5
  },
  presenceCard: { backgroundColor: '#fff', borderRadius: 14, padding: 10, borderWidth: 0.5, borderColor: '#eee' },
  presenceRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: '#f5f5f5'
  },
  presenceLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  presenceNom: { fontSize: 13, fontWeight: '500', color: '#1a1a1a' },
  presenceShift: { fontSize: 10, color: '#534AB7', marginTop: 2 },
  presencePaie: { fontSize: 10, color: '#3B6D11', marginTop: 2 },
  presenceDate: { fontSize: 13, color: '#1a1a1a', flex: 1 },
  presencePaieHistorique: { fontSize: 12, fontWeight: '500', color: '#3B6D11', marginLeft: 8 },
  statutPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  statutPillTxt: { fontSize: 11, fontWeight: '500' },
  salaireListCard: { backgroundColor: '#fff', borderRadius: 14, padding: 14, borderWidth: 0.5, borderColor: '#eee' },
  salaireRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: '#f5f5f5', gap: 10
  },
  salaireLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  salaireNom: { fontSize: 13, fontWeight: '600', color: '#1a1a1a' },
  salairePoste: { fontSize: 10, color: '#888', marginTop: 2, marginBottom: 6 },
  salaireBarre: { height: 4, backgroundColor: '#f5f5f5', borderRadius: 2, overflow: 'hidden' },
  salaireBarreFill: { height: '100%', backgroundColor: '#185FA5', borderRadius: 2 },
  salaireValeurRow: { fontSize: 14, fontWeight: '600', color: '#185FA5' },
  salairePct: { fontSize: 10, color: '#888', marginTop: 2 },
  salaireTotalRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingTop: 12, marginTop: 4, borderTopWidth: 1, borderTopColor: '#eee'
  },
  salaireTotalLabel: { fontSize: 14, fontWeight: '600', color: '#1a1a1a' },
  salaireTotalVal: { fontSize: 16, fontWeight: '600', color: '#185FA5' },
  modalTravContainer: { flex: 1, backgroundColor: '#f5f5f5' },
  modalTravHeader: { backgroundColor: '#185FA5', padding: 16 },
  modalTravClose: { fontSize: 14, color: '#B8D4F5', marginBottom: 12 },
  modalTravInfo: { flexDirection: 'row', alignItems: 'center' },
  modalTravNom: { fontSize: 18, fontWeight: '600', color: '#fff' },
  modalTravPoste: { fontSize: 12, color: '#B8D4F5', marginTop: 2 },
  travStatsGrid: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  travStatCard: { flex: 1, borderRadius: 12, padding: 12, alignItems: 'center' },
  travStatVal: { fontSize: 20, fontWeight: '600', color: '#1a1a1a' },
  travStatLabel: { fontSize: 10, marginTop: 4 },
  travSalaireCard: {
    backgroundColor: '#185FA5', borderRadius: 14, padding: 16,
    marginBottom: 14, alignItems: 'center'
  },
  travSalaireTitre: { fontSize: 12, color: '#B8D4F5', marginBottom: 6 },
  travSalaireVal: { fontSize: 22, fontWeight: '600', color: '#fff' },
  travSalaireSub: { fontSize: 11, color: '#B8D4F5', marginTop: 4 },
  tauxBarCard: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 14, borderWidth: 0.5, borderColor: '#eee' },
  tauxBarLabel: { fontSize: 12, color: '#888', marginTop: 8, textAlign: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modal: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitre: { fontSize: 18, fontWeight: '600', color: '#1a1a1a', marginBottom: 16 },
  modalClose: { fontSize: 18, color: '#888' },
  modalLabel: { fontSize: 11, fontWeight: '600', color: '#888', letterSpacing: 0.5, marginBottom: 6, textTransform: 'uppercase' },
  modalInput: { backgroundColor: '#f5f5f5', borderRadius: 12, padding: 14, fontSize: 15, color: '#1a1a1a', marginBottom: 14 },
  contratChoix: {
    flex: 1, padding: 10, borderRadius: 10,
    backgroundColor: '#f5f5f5', alignItems: 'center',
    borderWidth: 0.5, borderColor: '#eee'
  },
  contratChoixActive: { backgroundColor: '#185FA5', borderColor: '#185FA5' },
  contratChoixTxt: { fontSize: 13, color: '#888' },
  contratChoixTxtActive: { color: '#fff', fontWeight: '600' },
  etapeRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  etapeBadge: { flex: 1, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 20, backgroundColor: '#f5f5f5', alignItems: 'center' },
  etapeBadgeActive: { backgroundColor: '#185FA5' },
  etapeTxt: { fontSize: 12, color: '#888', fontWeight: '500' },
  etapeTxtActive: { color: '#fff' },
  etapeLine: { width: 20, height: 1, backgroundColor: '#eee', marginHorizontal: 4 },
  selectedDates: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f5f5f5', borderRadius: 12, padding: 12, marginBottom: 14 },
  modalBtns: { flexDirection: 'row', gap: 10, marginTop: 6 },
  modalCancel: { flex: 1, padding: 14, borderRadius: 12, backgroundColor: '#f5f5f5', alignItems: 'center' },
  modalCancelTxt: { fontSize: 14, color: '#888' },
  modalConfirm: { flex: 2, padding: 14, borderRadius: 12, backgroundColor: '#185FA5', alignItems: 'center' },
  modalConfirmTxt: { fontSize: 14, fontWeight: '600', color: '#fff' },
})