import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system'
import * as ImagePicker from 'expo-image-picker'
import { router } from 'expo-router'
import * as Sharing from 'expo-sharing'
import { useEffect, useRef, useState, useMemo } from 'react'
import {
  ActivityIndicator,
  Alert,
  Image,
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
import FormulaireTravailleur from '../components/FormulaireTravailleur'
import { useApp } from '../context/AppContext'
import { useTheme } from '../context/ThemeContext'
import { creerNotification } from '../lib/notificationsInterne'
import { supabase } from '../lib/supabase'
import { usePhoto } from '../lib/usePhoto'

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

const ONGLETS = ['Dashboard', 'Travailleurs', 'Présences', 'Salaires', 'Congés', 'Archivés']
const MOTIFS_ARCHIVE = ['Démission', 'Renvoi', 'Fin de contrat', 'Autre']

export default function RHScreen() {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { roleActif, isManager } = useApp() ?? {}
  const { choisirPhoto } = usePhoto()
  const peutSupprimer = isManager || roleActif === 'directeur'
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
  const [formTravailleur, setFormTravailleur] = useState({
    nom: '', poste: '', type_contrat: 'CDD',
    contact: '', salaire_journalier: '', date_embauche: '', photo_url: null,
  })
  const [savingTravailleur, setSavingTravailleur] = useState(false)
  const [papiersDraft, setPapiersDraft] = useState([])
  const [uploadingPapier, setUploadingPapier] = useState(false)
  const [uploadingPhotoProfil, setUploadingPhotoProfil] = useState(false)

  // Archive / suppression travailleur
  const [archivesTravail, setArchivesTravail] = useState([])
  const [loadingArchives, setLoadingArchives] = useState(false)
  const [modalArchiveAction, setModalArchiveAction] = useState(false)
  const [travailleurAction, setTravailleurAction] = useState(null)
  const [motifArchive, setMotifArchive] = useState('Démission')
  const [motifArchiveCustom, setMotifArchiveCustom] = useState('')
  const [savingArchive, setSavingArchive] = useState(false)

  // Congés & Permissions
  const [conges, setConges] = useState([])
  const [loadingConges, setLoadingConges] = useState(false)
  const [modalConge, setModalConge] = useState(false)
  const [editingConge, setEditingConge] = useState(null)
  const [formConge, setFormConge] = useState({ type: 'conge', travailleur_id: '', travailleur_nom: '', date_debut: '', date_fin: '', motif: '' })
  const [savingConge, setSavingConge] = useState(false)
  // null = calendrier caché, 'debut'/'fin' = calendrier inline affiché pour ce champ
  const [dateCongeChamp, setDateCongeChamp] = useState(null)

  useEffect(() => { chargerRestaurants() }, [])
  useEffect(() => {
    if (restoSelectionne) chargerDonnees()
  }, [periodeKey, restoSelectionne])
  useEffect(() => {
    if (travailleurSelectionne && modalTravailleur) {
      chargerHistoriqueTravailleur()
    }
  }, [periodeTravailleur, travailleurSelectionne, modalTravailleur])

  useEffect(() => {
    if (!restoSelectionne) return
    if (onglet === 'Congés') chargerConges()
    if (onglet === 'Archivés') chargerArchives()
  }, [restoSelectionne, onglet])

  // Fermer le modal congé au démontage pour éviter le crash iOS (modal visible + composant démonté)
  const isMountedRef = useRef(true)
  useEffect(() => {
    return () => {
      isMountedRef.current = false
      setModalConge(false)
    }
  }, [])

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
      .neq('statut', 'archive')
      .order('nom')
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
    if (!formTravailleur.nom || !formTravailleur.poste) {
      Alert.alert('Erreur', 'Le nom et le poste sont obligatoires')
      return
    }
    setSavingTravailleur(true)

    const champsCommunsUpdate = {
      poste: formTravailleur.poste,
      type_contrat: formTravailleur.type_contrat,
      contact: formTravailleur.contact || null,
      photo_url: formTravailleur.photo_url || null,
      salaire_journalier: parseInt(formTravailleur.salaire_journalier) || null,
      date_embauche: formTravailleur.date_embauche || null,
    }

    let travId = travailleurEdition?.id
    if (travailleurEdition) {
      await supabase.from('travailleurs')
        .update({ nom: formTravailleur.nom, ...champsCommunsUpdate })
        .eq('id', travailleurEdition.id)
    } else {
      const { data: ins } = await supabase.from('travailleurs').insert({
        nom: formTravailleur.nom,
        ...champsCommunsUpdate,
        restaurant_id: restoSelectionne.id,
        actif: true,
        statut: 'actif',
      }).select()
      travId = ins?.[0]?.id
      creerNotification({
        type: 'nouveau_travailleur',
        titre: '👤 Nouveau travailleur',
        message: `${formTravailleur.nom} ajouté à ${restoSelectionne.nom}`,
        restaurant_id: restoSelectionne.id,
        cible_role: ['manager', 'directeur'],
        screen: 'rh',
      }).catch(() => {})
    }

    if (papiersDraft.length > 0 && travId) {
      await supabase.from('documents_travailleurs').insert(
        papiersDraft.map(p => ({
          travailleur_id: travId,
          type_document: p.type_document,
          fichier_url: p.fichier_url,
          description: p.fichier_type,
        }))
      )
    }
    setPapiersDraft([])
    setSavingTravailleur(false)
    setModalFormTravailleur(false)
    setTravailleurEdition(null)
    setFormTravailleur({ nom: '', poste: '', type_contrat: 'CDD', contact: '', salaire_journalier: '', date_embauche: '', photo_url: null })
    chargerDonnees()
    Alert.alert('Succès', travailleurEdition ? 'Travailleur modifié !' : 'Travailleur ajouté !')
  }

  async function choisirPhotoProfil() {
    setUploadingPhotoProfil(true)
    const url = await choisirPhoto('photos')
    if (url) setFormTravailleur(p => ({ ...p, photo_url: url }))
    setUploadingPhotoProfil(false)
  }

  async function chargerArchives() {
    if (!restoSelectionne) return
    setLoadingArchives(true)
    const { data } = await supabase
      .from('travailleurs').select('*')
      .eq('restaurant_id', restoSelectionne.id)
      .eq('statut', 'archive')
      .order('archived_at', { ascending: false })
    setArchivesTravail(data || [])
    setLoadingArchives(false)
  }

  async function archiverTravailleur() {
    if (!travailleurAction) return
    const motifFinal = motifArchive === 'Autre' ? (motifArchiveCustom.trim() || 'Autre') : motifArchive
    setSavingArchive(true)
    await supabase.from('travailleurs').update({
      statut: 'archive',
      actif: false,
      archived_at: new Date().toISOString(),
      archive_motif: motifFinal,
    }).eq('id', travailleurAction.id)
    setSavingArchive(false)
    setModalArchiveAction(false)
    setTravailleurAction(null)
    setMotifArchive('Démission')
    setMotifArchiveCustom('')
    chargerDonnees()
    Alert.alert('Archivé', `${travailleurAction.nom} a été archivé.`)
  }

  async function reactiverTravailleur(trav) {
    await supabase.from('travailleurs').update({
      statut: 'actif',
      actif: true,
      archived_at: null,
      archive_motif: null,
    }).eq('id', trav.id)
    chargerArchives()
    Alert.alert('Réactivé', `${trav.nom} a été réactivé.`)
  }

  function supprimerTravailleur(trav) {
    Alert.alert(
      '⚠️ Suppression définitive',
      `Supprimer définitivement ${trav.nom} ? Toutes ses présences et documents seront effacés. Cette action est irréversible.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer définitivement',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Dernière confirmation',
              `Confirmer la suppression de ${trav.nom} ?`,
              [
                { text: 'Annuler', style: 'cancel' },
                {
                  text: 'Oui, supprimer',
                  style: 'destructive',
                  onPress: async () => {
                    await supabase.from('presences').delete().eq('travailleur_id', trav.id)
                    await supabase.from('permissions_conges').delete().eq('travailleur_id', trav.id)
                    await supabase.from('documents_travailleurs').delete().eq('travailleur_id', trav.id)
                    await supabase.from('travailleurs').delete().eq('id', trav.id)
                    chargerArchives()
                    Alert.alert('Supprimé', `${trav.nom} a été supprimé définitivement.`)
                  },
                },
              ]
            )
          },
        },
      ]
    )
  }

  function choisirFichierPapier(typeDoc) {
    Alert.alert(typeDoc, 'Type de fichier', [
      { text: 'Photo (JPG/PNG)', onPress: () => choisirPhotoPapier(typeDoc) },
      { text: 'Document PDF', onPress: () => choisirPDFPapier(typeDoc) },
      { text: 'Annuler', style: 'cancel' },
    ])
  }

  async function choisirPhotoPapier(typeDoc) {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
    })
    if (result.canceled) return
    await uploaderFichierPapier(result.assets[0].uri, typeDoc, 'image')
  }

  async function choisirPDFPapier(typeDoc) {
    const result = await DocumentPicker.getDocumentAsync({ type: 'application/pdf' })
    if (result.canceled) return
    await uploaderFichierPapier(result.assets[0].uri, typeDoc, 'pdf')
  }

  async function uploaderFichierPapier(uri, typeDoc, fichierType) {
    setUploadingPapier(true)
    try {
      const ext = fichierType === 'pdf' ? 'pdf' : 'jpg'
      const filename = `papier_${Date.now()}.${ext}`
      const contentType = fichierType === 'pdf' ? 'application/pdf' : 'image/jpeg'

      let blob
      if (Platform.OS === 'web') {
        const resp = await fetch(uri)
        blob = await resp.blob()
      } else {
        const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 })
        const byteChars = atob(b64)
        const byteArr = new Uint8Array(byteChars.length)
        for (let i = 0; i < byteChars.length; i++) byteArr[i] = byteChars.charCodeAt(i)
        blob = new Blob([byteArr], { type: contentType })
      }

      const { error } = await supabase.storage
        .from('documents-travailleurs')
        .upload(filename, blob, { contentType, upsert: true })
      if (error) throw error

      const { data: urlData } = supabase.storage.from('documents-travailleurs').getPublicUrl(filename)
      setPapiersDraft(prev => [...prev, { type_document: typeDoc, fichier_url: urlData.publicUrl, fichier_type: fichierType }])
    } catch {
      Alert.alert('Erreur', "Impossible d'uploader le fichier")
    }
    setUploadingPapier(false)
  }

  async function chargerConges() {
    if (!restoSelectionne) return
    setLoadingConges(true)
    const { data } = await supabase
      .from('permissions_conges')
      .select('*')
      .eq('restaurant_id', restoSelectionne.id)
      .order('date_debut', { ascending: false })
    if (!isMountedRef.current) return
    setConges(data || [])
    setLoadingConges(false)
  }

  async function sauvegarderConge() {
    if (!formConge.travailleur_id || !formConge.date_debut || !formConge.date_fin) {
      Alert.alert('Erreur', 'Travailleur et dates obligatoires')
      return
    }
    setSavingConge(true)
    if (editingConge) {
      await supabase.from('permissions_conges').update({
        type: formConge.type,
        date_debut: formConge.date_debut,
        date_fin: formConge.date_fin,
        motif: formConge.motif || null,
      }).eq('id', editingConge.id)
    } else {
      await supabase.from('permissions_conges').insert({
        restaurant_id: restoSelectionne.id,
        travailleur_id: formConge.travailleur_id,
        travailleur_nom: formConge.travailleur_nom,
        type: formConge.type,
        date_debut: formConge.date_debut,
        date_fin: formConge.date_fin,
        motif: formConge.motif || null,
        created_by: 'rh',
      })
    }
    setSavingConge(false)
    setModalConge(false)
    setEditingConge(null)
    setFormConge({ type: 'conge', travailleur_id: '', travailleur_nom: '', date_debut: '', date_fin: '', motif: '' })
    chargerConges()
    Alert.alert('Succès', editingConge ? 'Modifié !' : 'Congé / permission enregistré !')
  }

  async function supprimerConge(conge) {
    Alert.alert('Confirmer', 'Supprimer cette entrée ?', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: async () => {
        await supabase.from('permissions_conges').delete().eq('id', conge.id)
        chargerConges()
      }}
    ])
  }

  function getStatutConge(conge) {
    const today = new Date().toISOString().split('T')[0]
    if (conge.date_fin < today) return { label: 'Terminé', bg: '#F1EFE8', text: '#666' }
    if (conge.date_debut > today) return { label: 'À venir', bg: '#E6F1FB', text: '#185FA5' }
    return { label: 'En cours', bg: '#EAF3DE', text: '#3B6D11' }
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
                        contact: t.contact || '',
                        salaire_journalier: t.salaire_journalier?.toString() || '',
                        date_embauche: t.date_embauche || '',
                        photo_url: t.photo_url || null,
                      })
                      setTravailleurEdition(t)
                      setModalFormTravailleur(true)
                    }}
                  >
                    <Text style={styles.contratEditTxt}>✏️ Modifier</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.archiveMenuBtn}
                    onPress={() => {
                      setTravailleurAction(t)
                      setMotifArchive('Démission')
                      setMotifArchiveCustom('')
                      setModalArchiveAction(true)
                    }}
                  >
                    <Text style={styles.archiveMenuTxt}>⋯</Text>
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

  // ─── CONGÉS & PERMISSIONS ──────────────────────────────────
  function renderConges() {
    return (
      <ScrollView showsVerticalScrollIndicator={false}>
        <TouchableOpacity
          style={styles.addTravBtn}
          onPress={() => {
            setFormConge({ type: 'conge', travailleur_id: '', travailleur_nom: '', date_debut: '', date_fin: '', motif: '' })
            setEditingConge(null)
            setModalConge(true)
          }}
        >
          <Text style={styles.addTravTxt}>+ Ajouter congé / permission</Text>
        </TouchableOpacity>

        {loadingConges ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="small" color="#185FA5" />
          </View>
        ) : conges.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyIcon}>🏖️</Text>
            <Text style={styles.emptyTxt}>Aucun congé ou permission enregistré</Text>
          </View>
        ) : (
          conges.map((c) => {
            const statut = getStatutConge(c)
            return (
              <View key={c.id} style={styles.congeCard}>
                <View style={styles.congeTop}>
                  <View style={[styles.congeTypeBadge, { backgroundColor: c.type === 'conge' ? '#EEEDFE' : '#FAEEDA' }]}>
                    <Text style={[styles.congeTypeTxt, { color: c.type === 'conge' ? '#3C3489' : '#854F0B' }]}>
                      {c.type === 'conge' ? '🏖️ Congé' : '📋 Permission'}
                    </Text>
                  </View>
                  <View style={[styles.congeStatutBadge, { backgroundColor: statut.bg }]}>
                    <Text style={[styles.congeStatutTxt, { color: statut.text }]}>{statut.label}</Text>
                  </View>
                </View>
                <Text style={styles.congeNom}>{c.travailleur_nom}</Text>
                <Text style={styles.congeDates}>{formatDate(c.date_debut)} → {formatDate(c.date_fin)}</Text>
                {c.motif ? <Text style={styles.congeMotif}>"{c.motif}"</Text> : null}
                <View style={styles.congeActions}>
                  <TouchableOpacity
                    style={styles.congeEditBtn}
                    onPress={() => {
                      setFormConge({
                        type: c.type,
                        travailleur_id: c.travailleur_id,
                        travailleur_nom: c.travailleur_nom,
                        date_debut: c.date_debut,
                        date_fin: c.date_fin,
                        motif: c.motif || '',
                      })
                      setEditingConge(c)
                      setModalConge(true)
                    }}
                  >
                    <Text style={styles.congeEditTxt}>✏️ Modifier</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.congeDeleteBtn}
                    onPress={() => supprimerConge(c)}
                  >
                    <Text style={styles.congeDeleteTxt}>🗑 Supprimer</Text>
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

  // ─── ARCHIVÉS ──────────────────────────────────────────────
  function renderArchives() {
    if (loadingArchives) return (
      <View style={styles.loadingBox}>
        <ActivityIndicator size="large" color="#185FA5" />
      </View>
    )
    return (
      <ScrollView showsVerticalScrollIndicator={false}>
        {archivesTravail.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyIcon}>📦</Text>
            <Text style={styles.emptyTxt}>Aucun travailleur archivé</Text>
          </View>
        ) : (
          archivesTravail.map(t => (
            <View key={t.id} style={styles.archiveCard}>
              <View style={styles.archiveLeft}>
                {t.photo_url ? (
                  <Image source={{ uri: t.photo_url }} style={[styles.avatar, { borderRadius: 20 }]} />
                ) : (
                  <View style={[styles.avatar, { backgroundColor: '#aaa' }]}>
                    <Text style={styles.avatarTxt}>
                      {t.nom.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                    </Text>
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.archiveNom}>{t.nom}</Text>
                  <Text style={styles.archivePoste}>{t.poste || 'Sans poste'}</Text>
                  {t.archive_motif && (
                    <View style={styles.archiveMotifBadge}>
                      <Text style={styles.archiveMotifTxt}>{t.archive_motif}</Text>
                    </View>
                  )}
                  {t.archived_at && (
                    <Text style={styles.archiveDate}>
                      Archivé le {formatDate(t.archived_at.split('T')[0])}
                    </Text>
                  )}
                </View>
              </View>
              <View style={{ gap: 6 }}>
                <TouchableOpacity
                  style={styles.reactiverBtn}
                  onPress={() => reactiverTravailleur(t)}
                >
                  <Text style={styles.reactiverTxt}>↩ Réactiver</Text>
                </TouchableOpacity>
                {peutSupprimer && (
                  <TouchableOpacity
                    style={styles.supprimerBtn}
                    onPress={() => supprimerTravailleur(t)}
                  >
                    <Text style={styles.supprimerTxt}>🗑 Supprimer</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          ))
        )}
        <View style={{ height: 30 }} />
      </ScrollView>
    )
  }

  // ─── MODAL ARCHIVE ACTION ───────────────────────────────────
  function renderModalArchiveAction() {
    if (!travailleurAction) return null
    return (
      <Modal visible={modalArchiveAction} transparent animationType="slide">
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.modalOverlay}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
              <ScrollView style={styles.modal} showsVerticalScrollIndicator={false}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitre}>Archiver {travailleurAction?.nom}</Text>
                  <TouchableOpacity onPress={() => { setModalArchiveAction(false); setTravailleurAction(null) }}>
                    <Text style={styles.modalClose}>✕</Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.modalLabel}>Motif d'archivage</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
                  {MOTIFS_ARCHIVE.map(m => (
                    <TouchableOpacity
                      key={m}
                      style={[styles.motifBtn, motifArchive === m && styles.motifBtnActive]}
                      onPress={() => setMotifArchive(m)}
                    >
                      <Text style={[styles.motifTxt, motifArchive === m && styles.motifTxtActive]}>{m}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {motifArchive === 'Autre' && (
                  <>
                    <Text style={styles.modalLabel}>Préciser le motif</Text>
                    <TextInput
                      style={styles.modalInput}
                      placeholder="Ex: Fin de mission, Mutation..."
                      value={motifArchiveCustom}
                      onChangeText={setMotifArchiveCustom}
                      placeholderTextColor="#bbb"
                    />
                  </>
                )}

                <View style={[styles.modalBtns, { flexDirection: 'column', gap: 8 }]}>
                  <TouchableOpacity
                    style={[styles.modalConfirm, savingArchive && { opacity: 0.6 }]}
                    onPress={archiverTravailleur}
                    disabled={savingArchive}
                  >
                    <Text style={styles.modalConfirmTxt}>
                      {savingArchive ? 'Archivage...' : '📦 Archiver ce travailleur'}
                    </Text>
                  </TouchableOpacity>
                  {peutSupprimer && (
                    <TouchableOpacity
                      style={styles.supprimerModalBtn}
                      onPress={() => {
                        setModalArchiveAction(false)
                        setTimeout(() => supprimerTravailleur(travailleurAction), 300)
                      }}
                    >
                      <Text style={styles.supprimerModalTxt}>🗑 Supprimer définitivement</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={styles.modalCancel}
                    onPress={() => { setModalArchiveAction(false); setTravailleurAction(null) }}
                  >
                    <Text style={styles.modalCancelTxt}>Annuler</Text>
                  </TouchableOpacity>
                </View>
                <View style={{ height: 30 }} />
              </ScrollView>
            </KeyboardAvoidingView>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    )
  }

  function renderModalConge() {
    return (
      <Modal visible={modalConge} transparent animationType="slide">
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.modalOverlay}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
              <ScrollView style={styles.modal} showsVerticalScrollIndicator={false}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitre}>
                    {editingConge ? 'Modifier' : 'Nouveau congé / permission'}
                  </Text>
                  <TouchableOpacity onPress={() => { setModalConge(false); setEditingConge(null) }}>
                    <Text style={styles.modalClose}>✕</Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.modalLabel}>Type</Text>
                <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
                  {[{ key: 'conge', label: '🏖️ Congé' }, { key: 'permission', label: '📋 Permission' }].map(t => (
                    <TouchableOpacity
                      key={t.key}
                      style={[styles.contratChoix, formConge.type === t.key && styles.contratChoixActive]}
                      onPress={() => setFormConge(p => ({ ...p, type: t.key }))}
                    >
                      <Text style={[styles.contratChoixTxt, formConge.type === t.key && styles.contratChoixTxtActive]}>
                        {t.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.modalLabel}>Travailleur</Text>
                {!editingConge ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
                    {travailleurs.map(t => (
                      <TouchableOpacity
                        key={t.id}
                        style={[styles.travChoixBtn, formConge.travailleur_id === t.id && styles.travChoixBtnActive]}
                        onPress={() => setFormConge(p => ({ ...p, travailleur_id: t.id, travailleur_nom: t.nom }))}
                      >
                        <Text style={[styles.travChoixTxt, formConge.travailleur_id === t.id && styles.travChoixTxtActive]}>
                          {t.nom}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                ) : (
                  <View style={[styles.modalInput, { marginBottom: 14, paddingVertical: 14 }]}>
                    <Text style={{ color: colors.text }}>{formConge.travailleur_nom}</Text>
                  </View>
                )}

                <Text style={styles.modalLabel}>Dates</Text>
                <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10, alignItems: 'center' }}>
                  <TouchableOpacity
                    style={[styles.contratChoix, { flex: 1 }, dateCongeChamp === 'debut' && styles.contratChoixActive]}
                    onPress={() => setDateCongeChamp(dateCongeChamp === 'debut' ? null : 'debut')}
                  >
                    <Text style={[styles.contratChoixTxt, formConge.date_debut && { color: colors.text, fontWeight: '600' }, dateCongeChamp === 'debut' && { color: '#fff' }]}>
                      {formConge.date_debut ? formatDate(formConge.date_debut) : '📅 Début'}
                    </Text>
                  </TouchableOpacity>
                  <Text style={{ color: colors.textMuted }}>→</Text>
                  <TouchableOpacity
                    style={[styles.contratChoix, { flex: 1 }, dateCongeChamp === 'fin' && styles.contratChoixActive]}
                    onPress={() => setDateCongeChamp(dateCongeChamp === 'fin' ? null : 'fin')}
                  >
                    <Text style={[styles.contratChoixTxt, formConge.date_fin && { color: colors.text, fontWeight: '600' }, dateCongeChamp === 'fin' && { color: '#fff' }]}>
                      {formConge.date_fin ? formatDate(formConge.date_fin) : '📅 Fin'}
                    </Text>
                  </TouchableOpacity>
                </View>
                {dateCongeChamp !== null && (
                  <View style={{ marginBottom: 14 }}>
                    <Text style={styles.calInlineTitre}>
                      {dateCongeChamp === 'debut' ? '📅 Sélectionner la date de début' : '📅 Sélectionner la date de fin'}
                    </Text>
                    <Calendar
                      onDayPress={day => {
                        setFormConge(p => ({
                          ...p,
                          [dateCongeChamp === 'debut' ? 'date_debut' : 'date_fin']: day.dateString,
                        }))
                        setDateCongeChamp(null)
                      }}
                      markedDates={{
                        ...(formConge.date_debut ? { [formConge.date_debut]: { selected: true, selectedColor: '#185FA5' } } : {}),
                        ...(formConge.date_fin ? { [formConge.date_fin]: { selected: true, selectedColor: '#3B6D11' } } : {}),
                      }}
                      theme={{
                        selectedDayBackgroundColor: dateCongeChamp === 'debut' ? '#185FA5' : '#3B6D11',
                        todayTextColor: '#185FA5',
                        arrowColor: '#185FA5',
                        monthTextColor: colors.text,
                        dayTextColor: colors.text,
                        textDisabledColor: '#ccc',
                      }}
                    />
                  </View>
                )}

                <Text style={styles.modalLabel}>Motif (optionnel)</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="Ex: Voyage famille, Maladie..."
                  value={formConge.motif}
                  onChangeText={v => setFormConge(p => ({ ...p, motif: v }))}
                  placeholderTextColor="#bbb"
                />

                <View style={styles.modalBtns}>
                  <TouchableOpacity
                    style={styles.modalCancel}
                    onPress={() => { setModalConge(false); setEditingConge(null) }}
                  >
                    <Text style={styles.modalCancelTxt}>Annuler</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalConfirm, savingConge && { opacity: 0.6 }]}
                    onPress={sauvegarderConge}
                    disabled={savingConge}
                  >
                    <Text style={styles.modalConfirmTxt}>
                      {savingConge ? 'Enregistrement...' : 'Enregistrer'}
                    </Text>
                  </TouchableOpacity>
                </View>
                <View style={{ height: 30 }} />
              </ScrollView>
            </KeyboardAvoidingView>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
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
    const canSave = formTravailleur.nom.trim() && formTravailleur.poste.trim()
    return (
      <Modal visible={modalFormTravailleur} transparent animationType="slide">
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.modalOverlay}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
              <ScrollView style={styles.modal} showsVerticalScrollIndicator={false}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitre}>
                    {travailleurEdition ? 'Modifier travailleur' : 'Nouveau travailleur'}
                  </Text>
                  <TouchableOpacity onPress={() => {
                    setModalFormTravailleur(false)
                    setTravailleurEdition(null)
                    setFormTravailleur({ nom: '', poste: '', type_contrat: 'CDD', contact: '', salaire_journalier: '', date_embauche: '', photo_url: null })
                    setPapiersDraft([])
                  }}>
                    <Text style={styles.modalClose}>✕</Text>
                  </TouchableOpacity>
                </View>

                {/* Photo de profil */}
                <View style={styles.photoProfilBox}>
                  {formTravailleur.photo_url ? (
                    <Image source={{ uri: formTravailleur.photo_url }} style={styles.photoProfilPreview} />
                  ) : (
                    <View style={styles.photoProfilVide}>
                      <Text style={{ fontSize: 30 }}>👤</Text>
                    </View>
                  )}
                  <TouchableOpacity
                    style={styles.photoProfilBtn}
                    onPress={choisirPhotoProfil}
                    disabled={uploadingPhotoProfil}
                  >
                    <Text style={styles.photoProfilBtnTxt}>
                      {uploadingPhotoProfil ? '⏳ Upload...' : formTravailleur.photo_url ? '🔄 Changer la photo' : '📷 Ajouter une photo'}
                    </Text>
                  </TouchableOpacity>
                </View>

                <FormulaireTravailleur
                  form={formTravailleur}
                  setForm={setFormTravailleur}
                  colors={colors}
                  nomEditable={!travailleurEdition}
                />

                <Text style={styles.modalLabel}>Papiers</Text>
                <View style={{ marginBottom: 14 }}>
                  {['CNI', 'Passeport', 'Permis de conduire', 'Contrat', 'Autre'].map(type => {
                    const existant = papiersDraft.find(p => p.type_document === type)
                    return (
                      <View key={type} style={styles.papierRow}>
                        <Text style={styles.papierType}>{type}</Text>
                        {existant ? (
                          <View style={styles.papierDone}>
                            <Text style={styles.papierDoneTxt}>✓ {existant.fichier_type === 'pdf' ? 'PDF' : 'Photo'}</Text>
                            <TouchableOpacity onPress={() => setPapiersDraft(prev => prev.filter(p => p.type_document !== type))}>
                              <Text style={styles.papierRemove}>✕</Text>
                            </TouchableOpacity>
                          </View>
                        ) : (
                          <TouchableOpacity
                            style={[styles.papierBtn, uploadingPapier && { opacity: 0.5 }]}
                            onPress={() => choisirFichierPapier(type)}
                            disabled={uploadingPapier}
                          >
                            <Text style={styles.papierBtnTxt}>{uploadingPapier ? '…' : '+ Ajouter'}</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    )
                  })}
                </View>

                <View style={styles.modalBtns}>
                  <TouchableOpacity
                    style={styles.modalCancel}
                    onPress={() => {
                      setModalFormTravailleur(false)
                      setTravailleurEdition(null)
                      setFormTravailleur({ nom: '', poste: '', type_contrat: 'CDD', contact: '', salaire_journalier: '', date_embauche: '', photo_url: null })
                      setPapiersDraft([])
                    }}
                  >
                    <Text style={styles.modalCancelTxt}>Annuler</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalConfirm, (!canSave || savingTravailleur) && { opacity: 0.5 }]}
                    onPress={sauvegarderTravailleur}
                    disabled={!canSave || savingTravailleur}
                  >
                    <Text style={styles.modalConfirmTxt}>
                      {savingTravailleur ? 'Enregistrement...' : 'Enregistrer'}
                    </Text>
                  </TouchableOpacity>
                </View>
                <View style={{ height: 30 }} />
              </ScrollView>
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
        <TouchableOpacity onPress={() => {
          if (router.canGoBack()) router.back()
          else router.replace('/accueil')
        }}>
          <Text style={styles.back}>‹ Retour</Text>
        </TouchableOpacity>
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

      {onglet !== 'Congés' && onglet !== 'Archivés' && (
        <View style={styles.periodeBanner}>
          <Text style={styles.periodeBannerTxt}>📅 {titrePeriode()}</Text>
          <Text style={styles.periodeBannerSub}>{presences.length} enregistrement(s)</Text>
        </View>
      )}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.ongletBar}>
        {ONGLETS.map(o => (
          <TouchableOpacity
            key={o}
            style={[styles.ongletBtn, onglet === o && styles.ongletBtnActive]}
            onPress={() => setOnglet(o)}
          >
            <Text style={[styles.ongletTxt, onglet === o && styles.ongletTxtActive]}>{o}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

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
          {onglet === 'Congés' && renderConges()}
          {onglet === 'Archivés' && renderArchives()}
        </View>
      )}

      {renderModalDetailTravailleur()}
      {renderModalFormTravailleur()}
      {renderModalCalendrier()}
      {renderModalConge()}
      {renderModalArchiveAction()}
    </SafeAreaView>
  )
}

function makeStyles(colors) { return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    backgroundColor: '#185FA5', padding: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'
  },
  back: { fontSize: 16, color: '#B8D4F5', fontWeight: '500' },
  headerTitre: { fontSize: 16, fontWeight: '600', color: '#fff', textAlign: 'center' },
  headerSub: { fontSize: 11, color: '#B8D4F5', marginTop: 2 },
  logoutBtn: { backgroundColor: '#0F4880', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  logoutTxt: { fontSize: 12, color: '#B8D4F5', fontWeight: '500' },
  restoBar: { backgroundColor: colors.surface, maxHeight: 44, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  restoBtn: { paddingHorizontal: 14, paddingVertical: 12 },
  restoBtnActive: { borderBottomWidth: 2, borderBottomColor: '#185FA5' },
  restoTxt: { fontSize: 12, color: colors.textMuted },
  restoTxtActive: { color: '#185FA5', fontWeight: '600' },
  periodeBar: { backgroundColor: colors.surface, maxHeight: 44, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  periodeBarModal: { backgroundColor: colors.surface, maxHeight: 44, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  periodeBtn: { paddingHorizontal: 16, paddingVertical: 12 },
  periodeBtnActive: { borderBottomWidth: 2, borderBottomColor: '#185FA5' },
  periodeTxt: { fontSize: 13, color: colors.textMuted },
  periodeTxtActive: { color: '#185FA5', fontWeight: '600' },
  periodeBanner: {
    backgroundColor: '#E6F1FB', padding: 8, paddingHorizontal: 16,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderBottomWidth: 0.5, borderBottomColor: '#B8D4F5'
  },
  periodeBannerTxt: { fontSize: 12, color: '#0F4880', fontWeight: '500' },
  periodeBannerSub: { fontSize: 11, color: '#185FA5' },
  ongletBar: { backgroundColor: colors.surface, maxHeight: 44, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  ongletBtn: { paddingHorizontal: 16, paddingVertical: 12, alignItems: 'center' },
  ongletBtnActive: { borderBottomWidth: 2, borderBottomColor: '#185FA5' },
  ongletTxt: { fontSize: 12, color: colors.textMuted },
  ongletTxtActive: { color: '#185FA5', fontWeight: '600' },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingTxt: { fontSize: 13, color: colors.textMuted, marginTop: 12 },
  body: { flex: 1, padding: 14 },
  exportBtn: {
    backgroundColor: '#185FA5', borderRadius: 12, padding: 14,
    alignItems: 'center', marginBottom: 14
  },
  exportTxt: { fontSize: 14, fontWeight: '600', color: '#fff' },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  kpiCard: {
    width: '47%', backgroundColor: colors.surface, borderRadius: 12,
    padding: 14, alignItems: 'center', borderWidth: 0.5, borderColor: colors.border
  },
  kpiIcon: { fontSize: 24, marginBottom: 6 },
  kpiValue: { fontSize: 22, fontWeight: '600', color: '#185FA5' },
  kpiLabel: { fontSize: 11, color: colors.textMuted, marginTop: 4 },
  salaireCard: {
    backgroundColor: '#185FA5', borderRadius: 14, padding: 16,
    marginBottom: 14, alignItems: 'center'
  },
  salaireTitre: { fontSize: 13, color: '#B8D4F5', marginBottom: 8 },
  salaireValeur: { fontSize: 24, fontWeight: '600', color: '#fff', marginBottom: 4 },
  salaireSub: { fontSize: 11, color: '#B8D4F5' },
  sectionTitre: {
    fontSize: 12, fontWeight: '600', color: colors.textMuted,
    marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5
  },
  tauxCard: {
    backgroundColor: colors.surface, borderRadius: 14, padding: 14,
    marginBottom: 10, borderWidth: 0.5, borderColor: colors.border
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
  tauxNom: { fontSize: 14, fontWeight: '600', color: colors.text },
  tauxPoste: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  tauxPct: { fontSize: 18, fontWeight: '600' },
  voirDetail: { fontSize: 10, color: '#185FA5', marginTop: 2 },
  tauxBarBg: { height: 8, backgroundColor: colors.bg, borderRadius: 4, overflow: 'hidden', marginBottom: 8 },
  tauxBarFill: { height: '100%', borderRadius: 4 },
  tauxStats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tauxStat: { fontSize: 11, fontWeight: '500' },
  addTravBtn: {
    borderWidth: 1, borderStyle: 'dashed', borderColor: '#185FA5',
    borderRadius: 12, padding: 14, alignItems: 'center', marginBottom: 14
  },
  addTravTxt: { fontSize: 14, color: '#185FA5', fontWeight: '500' },
  travCard: {
    backgroundColor: colors.surface, borderRadius: 14, padding: 14, marginBottom: 10,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 0.5, borderColor: colors.border
  },
  travLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  travNom: { fontSize: 14, fontWeight: '600', color: colors.text },
  travPoste: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
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
  emptyTxt: { fontSize: 13, color: colors.textMuted },
  dateSection: { marginBottom: 14 },
  dateTitre: {
    fontSize: 12, fontWeight: '600', color: '#185FA5',
    marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5
  },
  presenceCard: { backgroundColor: colors.surface, borderRadius: 14, padding: 10, borderWidth: 0.5, borderColor: colors.border },
  presenceRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: '#f5f5f5'
  },
  presenceLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  presenceNom: { fontSize: 13, fontWeight: '500', color: colors.text },
  presenceShift: { fontSize: 10, color: '#534AB7', marginTop: 2 },
  presencePaie: { fontSize: 10, color: '#3B6D11', marginTop: 2 },
  presenceDate: { fontSize: 13, color: colors.text, flex: 1 },
  presencePaieHistorique: { fontSize: 12, fontWeight: '500', color: '#3B6D11', marginLeft: 8 },
  statutPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  statutPillTxt: { fontSize: 11, fontWeight: '500' },
  salaireListCard: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, borderWidth: 0.5, borderColor: colors.border },
  salaireRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: '#f5f5f5', gap: 10
  },
  salaireLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  salaireNom: { fontSize: 13, fontWeight: '600', color: colors.text },
  salairePoste: { fontSize: 10, color: colors.textMuted, marginTop: 2, marginBottom: 6 },
  salaireBarre: { height: 4, backgroundColor: colors.bg, borderRadius: 2, overflow: 'hidden' },
  salaireBarreFill: { height: '100%', backgroundColor: '#185FA5', borderRadius: 2 },
  salaireValeurRow: { fontSize: 14, fontWeight: '600', color: '#185FA5' },
  salairePct: { fontSize: 10, color: colors.textMuted, marginTop: 2 },
  salaireTotalRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingTop: 12, marginTop: 4, borderTopWidth: 1, borderTopColor: colors.border
  },
  salaireTotalLabel: { fontSize: 14, fontWeight: '600', color: colors.text },
  salaireTotalVal: { fontSize: 16, fontWeight: '600', color: '#185FA5' },
  modalTravContainer: { flex: 1, backgroundColor: colors.bg },
  modalTravHeader: { backgroundColor: '#185FA5', padding: 16 },
  modalTravClose: { fontSize: 14, color: '#B8D4F5', marginBottom: 12 },
  modalTravInfo: { flexDirection: 'row', alignItems: 'center' },
  modalTravNom: { fontSize: 18, fontWeight: '600', color: '#fff' },
  modalTravPoste: { fontSize: 12, color: '#B8D4F5', marginTop: 2 },
  travStatsGrid: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  travStatCard: { flex: 1, borderRadius: 12, padding: 12, alignItems: 'center' },
  travStatVal: { fontSize: 20, fontWeight: '600', color: colors.text },
  travStatLabel: { fontSize: 10, marginTop: 4 },
  travSalaireCard: {
    backgroundColor: '#185FA5', borderRadius: 14, padding: 16,
    marginBottom: 14, alignItems: 'center'
  },
  travSalaireTitre: { fontSize: 12, color: '#B8D4F5', marginBottom: 6 },
  travSalaireVal: { fontSize: 22, fontWeight: '600', color: '#fff' },
  travSalaireSub: { fontSize: 11, color: '#B8D4F5', marginTop: 4 },
  tauxBarCard: { backgroundColor: colors.surface, borderRadius: 12, padding: 14, marginBottom: 14, borderWidth: 0.5, borderColor: colors.border },
  tauxBarLabel: { fontSize: 12, color: colors.textMuted, marginTop: 8, textAlign: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modal: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitre: { fontSize: 18, fontWeight: '600', color: colors.text, marginBottom: 16 },
  modalClose: { fontSize: 18, color: colors.textMuted },
  modalLabel: { fontSize: 11, fontWeight: '600', color: colors.textMuted, letterSpacing: 0.5, marginBottom: 6, textTransform: 'uppercase' },
  modalInput: { backgroundColor: colors.bg, borderRadius: 12, padding: 14, fontSize: 15, color: colors.text, marginBottom: 14 },
  contratChoix: {
    flex: 1, padding: 10, borderRadius: 10,
    backgroundColor: colors.bg, alignItems: 'center',
    borderWidth: 0.5, borderColor: colors.border
  },
  contratChoixActive: { backgroundColor: '#185FA5', borderColor: '#185FA5' },
  contratChoixTxt: { fontSize: 13, color: colors.textMuted },
  contratChoixTxtActive: { color: '#fff', fontWeight: '600' },
  etapeRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  etapeBadge: { flex: 1, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 20, backgroundColor: colors.bg, alignItems: 'center' },
  etapeBadgeActive: { backgroundColor: '#185FA5' },
  etapeTxt: { fontSize: 12, color: colors.textMuted, fontWeight: '500' },
  etapeTxtActive: { color: '#fff' },
  etapeLine: { width: 20, height: 1, backgroundColor: colors.border, marginHorizontal: 4 },
  selectedDates: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bg, borderRadius: 12, padding: 12, marginBottom: 14 },
  modalBtns: { flexDirection: 'row', gap: 10, marginTop: 6 },
  modalCancel: { flex: 1, padding: 14, borderRadius: 12, backgroundColor: colors.bg, alignItems: 'center' },
  modalCancelTxt: { fontSize: 14, color: colors.textMuted },
  modalConfirm: { flex: 2, padding: 14, borderRadius: 12, backgroundColor: '#185FA5', alignItems: 'center' },
  modalConfirmTxt: { fontSize: 14, fontWeight: '600', color: '#fff' },
  congeCard: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 0.5, borderColor: colors.border },
  congeTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  congeTypeBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  congeTypeTxt: { fontSize: 12, fontWeight: '600' },
  congeStatutBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  congeStatutTxt: { fontSize: 11, fontWeight: '500' },
  congeNom: { fontSize: 15, fontWeight: '600', color: colors.text, marginBottom: 4 },
  congeDates: { fontSize: 13, color: '#185FA5', marginBottom: 4 },
  congeMotif: { fontSize: 12, color: colors.textMuted, fontStyle: 'italic', marginBottom: 8 },
  congeActions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  congeEditBtn: { flex: 1, backgroundColor: '#E6F1FB', paddingVertical: 8, borderRadius: 10, alignItems: 'center' },
  congeEditTxt: { fontSize: 12, color: '#185FA5', fontWeight: '500' },
  congeDeleteBtn: { flex: 1, backgroundColor: '#FAECE7', paddingVertical: 8, borderRadius: 10, alignItems: 'center' },
  congeDeleteTxt: { fontSize: 12, color: '#993C1D', fontWeight: '500' },
  travChoixBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, backgroundColor: colors.bg, borderWidth: 0.5, borderColor: colors.border, marginRight: 8 },
  travChoixBtnActive: { backgroundColor: '#185FA5', borderColor: '#185FA5' },
  travChoixTxt: { fontSize: 13, color: colors.textMuted },
  travChoixTxtActive: { color: '#fff', fontWeight: '600' },
  calInlineTitre: { fontSize: 11, fontWeight: '600', color: '#185FA5', marginBottom: 8, letterSpacing: 0.5 },
  papierRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  papierType: { fontSize: 13, color: colors.text, flex: 1 },
  papierDone: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#EAF3DE', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
  papierDoneTxt: { fontSize: 12, color: '#3B6D11', fontWeight: '500' },
  papierRemove: { fontSize: 14, color: '#993C1D', fontWeight: '700' },
  papierBtn: { backgroundColor: colors.primaryLight, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 },
  papierBtnTxt: { fontSize: 12, color: '#185FA5', fontWeight: '500' },
  archiveMenuBtn: {
    backgroundColor: colors.bg, borderRadius: 10, paddingHorizontal: 8,
    paddingVertical: 4, borderWidth: 0.5, borderColor: colors.border,
  },
  archiveMenuTxt: { fontSize: 16, color: colors.textMuted, fontWeight: '600' },
  archiveCard: {
    backgroundColor: colors.surface, borderRadius: 14, padding: 14, marginBottom: 10,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 0.5, borderColor: colors.border,
  },
  archiveLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  archiveNom: { fontSize: 14, fontWeight: '600', color: colors.textMuted },
  archivePoste: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  archiveMotifBadge: { backgroundColor: '#FAECE7', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start', marginTop: 4 },
  archiveMotifTxt: { fontSize: 11, color: '#993C1D', fontWeight: '500' },
  archiveDate: { fontSize: 10, color: colors.textMuted, marginTop: 2 },
  reactiverBtn: { backgroundColor: '#EAF3DE', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, alignItems: 'center' },
  reactiverTxt: { fontSize: 12, color: '#3B6D11', fontWeight: '500' },
  supprimerBtn: { backgroundColor: '#FAECE7', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, alignItems: 'center' },
  supprimerTxt: { fontSize: 12, color: '#993C1D', fontWeight: '500' },
  motifBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: colors.bg, borderWidth: 0.5, borderColor: colors.border },
  motifBtnActive: { backgroundColor: '#185FA5', borderColor: '#185FA5' },
  motifTxt: { fontSize: 13, color: colors.textMuted },
  motifTxtActive: { color: '#fff', fontWeight: '600' },
  supprimerModalBtn: { padding: 14, borderRadius: 12, backgroundColor: '#FAECE7', alignItems: 'center' },
  supprimerModalTxt: { fontSize: 14, fontWeight: '600', color: '#993C1D' },
  photoProfilBox: { alignItems: 'center', marginBottom: 16 },
  photoProfilPreview: { width: 70, height: 70, borderRadius: 35, marginBottom: 8 },
  photoProfilVide: { width: 70, height: 70, borderRadius: 35, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', marginBottom: 8, borderWidth: 0.5, borderColor: colors.border },
  photoProfilBtn: { backgroundColor: colors.bg, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 6, borderWidth: 0.5, borderColor: colors.border },
  photoProfilBtnTxt: { fontSize: 13, color: '#185FA5', fontWeight: '500' },
}) }