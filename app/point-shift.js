import { router } from 'expo-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
    ActivityIndicator,
    Alert,
    Image,
    Modal,
    Platform,
    SafeAreaView, ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native'
import { useApp } from '../context/AppContext'
import { useTheme } from '../context/ThemeContext'
import { savePointShiftData } from '../lib/api'
import { creerNotification } from '../lib/notificationsInterne'
import { supabase } from '../lib/supabase'
import { usePhoto } from '../lib/usePhoto'

const DRAFT_KEY = 'samerpoint_shift_draft'

function lireDraft() {
  if (Platform.OS !== 'web') return null
  try {
    const s = localStorage.getItem(DRAFT_KEY)
    return s ? JSON.parse(s) : null
  } catch { return null }
}

function effacerDraft() {
  if (Platform.OS !== 'web') return
  try { localStorage.removeItem(DRAFT_KEY) } catch {}
}

// ─── Composants stables hors du composant principal ───────────────────────────
// Définis ici pour éviter le re-montage à chaque re-render (perte de focus clavier)

const HEURES = Array.from({ length: 24 }, (_, i) => i)
const MINUTES = Array.from({ length: 60 }, (_, i) => i)
const ITEM_H = 48

function ColonnePicker({ items, value, onChange }) {
  const scrollRef = useRef(null)

  useEffect(() => {
    const t = setTimeout(() => {
      scrollRef.current?.scrollTo({ y: value * ITEM_H, animated: false })
    }, 80)
    return () => clearTimeout(t)
  }, []) // scroll initial uniquement — utiliser key= pour forcer le remontage

  return (
    <View style={{ height: ITEM_H * 3, overflow: 'hidden' }}>
      <View
        pointerEvents="none"
        style={{
          position: 'absolute', top: ITEM_H, left: 0, right: 0, height: ITEM_H,
          borderTopWidth: 1.5, borderBottomWidth: 1.5, borderColor: '#EF9F27',
          backgroundColor: '#FFF8ED', zIndex: 1,
        }}
      />
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_H}
        decelerationRate="fast"
        onMomentumScrollEnd={(e) => {
          const idx = Math.round(e.nativeEvent.contentOffset.y / ITEM_H)
          onChange(Math.max(0, Math.min(items.length - 1, idx)))
        }}
      >
        <View style={{ height: ITEM_H }} />
        {items.map((item, i) => (
          <View key={i} style={{ height: ITEM_H, justifyContent: 'center', alignItems: 'center' }}>
            <Text style={{ fontSize: 26, color: '#1a1a1a', fontWeight: '500' }}>
              {String(item).padStart(2, '0')}
            </Text>
          </View>
        ))}
        <View style={{ height: ITEM_H }} />
      </ScrollView>
    </View>
  )
}

function PhotoInput({ label, value, setter, dossier, obligatoire, onGererPhoto, uploading }) {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  return (
    <View style={[styles.photoBlock, obligatoire && !value && styles.photoBlockRequired]}>
      <View style={styles.photoHeader}>
        <Text style={styles.photoLabel}>
          📷 {label}
          {obligatoire && <Text style={{ color: '#A32D2D' }}> *</Text>}
        </Text>
        {value ? (
          <View style={styles.photoBadgeOk}>
            <Text style={styles.photoBadgeOkTxt}>✅ OK</Text>
          </View>
        ) : obligatoire ? (
          <View style={styles.photoBadgeReq}>
            <Text style={styles.photoBadgeReqTxt}>⚠️ Requis</Text>
          </View>
        ) : null}
      </View>
      {value && (
        <Image source={{ uri: value }} style={styles.photoPreview} resizeMode="cover" />
      )}
      <TouchableOpacity
        style={styles.photoBtn}
        onPress={() => onGererPhoto(setter, dossier)}
        disabled={uploading}
      >
        {uploading ? (
          <ActivityIndicator size="small" color="#EF9F27" />
        ) : (
          <Text style={styles.photoBtnTxt}>
            {value ? '🔄 Changer la photo' : '📷 Ajouter une photo'}
          </Text>
        )}
      </TouchableOpacity>
    </View>
  )
}

function LigneSaisie({ label, value, setter, photoValue, photoSetter, dossier, onGererPhoto, uploading }) {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const montant = parseFloat(value) || 0
  return (
    <View style={styles.ligneCard}>
      <View style={styles.ligneHeader}>
        <Text style={styles.ligneLabel}>{label}</Text>
      </View>
      <TextInput
        style={styles.ligneInput}
        value={value}
        onChangeText={setter}
        keyboardType="numeric"
        placeholder="0 FCFA"
        placeholderTextColor="#bbb"
      />
      {montant > 0 && (
        <PhotoInput
          label={`Justificatif ${label}`}
          value={photoValue}
          setter={photoSetter}
          dossier={dossier}
          obligatoire={montant > 0}
          onGererPhoto={onGererPhoto}
          uploading={uploading}
        />
      )}
    </View>
  )
}

function LigneSaisieSimple({ label, value, setter, note }) {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  return (
    <View style={styles.ligneCard}>
      <View style={styles.ligneHeader}>
        <Text style={styles.ligneLabel}>{label}</Text>
        <View style={styles.noPhotoBadge}>
          <Text style={styles.noPhotoBadgeTxt}>Sans photo</Text>
        </View>
      </View>
      <TextInput
        style={styles.ligneInput}
        value={value}
        onChangeText={setter}
        keyboardType="numeric"
        placeholder="0 FCFA"
        placeholderTextColor="#bbb"
      />
      {note && <Text style={styles.ligneNote}>{note}</Text>}
    </View>
  )
}

export default function PointShiftScreen() {
  const {
    pointId, setPointId, restaurantId, roleActif,
    dateJour,
    depensesJour, fournisseursJour,
    userId, userNom, resetJour,
    totalDepenses, totalFournisseurs,
  } = useApp()

  const { prendrePhoto, choisirPhoto } = usePhoto()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const isCaissier = roleActif === 'caissier'
  const isGerant = roleActif === 'gerant'
  const isManager = roleActif === 'manager'
  const isDirecteur = roleActif === 'directeur'
  const peutSupprimer = isManager || isDirecteur

  const _d = lireDraft()
  const [heureDebut, setHeureDebut] = useState(_d?.heureDebut || '')
  const [heureFin, setHeureFin] = useState(_d?.heureFin || '')
  const [dateShift, setDateShift] = useState(dateJour || new Date().toISOString().split('T')[0])
  const [kdo, setKdo] = useState(_d?.kdo || '')
  const [retour, setRetour] = useState(_d?.retour || '')
  const [yangoCse, setYangoCse] = useState(_d?.yangoCse || '')
  const [glovoCse, setGlovoCse] = useState(_d?.glovoCse || '')
  const [wave, setWave] = useState(_d?.wave || '')
  const [djamo, setDjamo] = useState(_d?.djamo || '')
  const [om, setOm] = useState(_d?.om || '')
  const [espece, setEspece] = useState(_d?.espece || '')

  const [photoKdo, setPhotoKdo] = useState(_d?.photoKdo || null)
  const [photoRetour, setPhotoRetour] = useState(_d?.photoRetour || null)
  const [photoYangoCse, setPhotoYangoCse] = useState(_d?.photoYangoCse || null)
  const [photoGlovoCse, setPhotoGlovoCse] = useState(_d?.photoGlovoCse || null)
  const [photoWave, setPhotoWave] = useState(_d?.photoWave || null)
  const [photoDjamo, setPhotoDjamo] = useState(_d?.photoDjamo || null)
  const [photoOm, setPhotoOm] = useState(_d?.photoOm || null)

  const [inventaireCaissierOk, setInventaireCaissierOk] = useState(false)
  const [shiftsGerant, setShiftsGerant] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [vue, setVue] = useState(isCaissier ? 'nouveau' : 'liste')
  const [modalDate, setModalDate] = useState(false)
  const [photoModalVisible, setPhotoModalVisible] = useState(false)
  const [confirmShiftVisible, setConfirmShiftVisible] = useState(false)
  const [timePickerVisible, setTimePickerVisible] = useState(false)
  const [timePickerChamp, setTimePickerChamp] = useState('debut')
  const [timePickerH, setTimePickerH] = useState(8)
  const [timePickerM, setTimePickerM] = useState(0)
  const photoPickerRef = useRef({ setter: null, dossier: '' })
  const [modeSelection, setModeSelection] = useState(false)
  const [shiftsSelectionnes, setShiftsSelectionnes] = useState(new Set())
  const [suppressionEnCours, setSuppressionEnCours] = useState(false)
  const [confirmSupprShift, setConfirmSupprShift] = useState(null)
  const [confirmSupprMultiple, setConfirmSupprMultiple] = useState(false)
  const [shiftDetail, setShiftDetail] = useState(null)
  const [shiftDetailData, setShiftDetailData] = useState({ depenses: [], fournisseurs: [], presences: [], inventaire: null, loading: false })
  const [photoPleinEcranUrl, setPhotoPleinEcranUrl] = useState(null)

  useEffect(() => {
    if (isGerant || isManager || isDirecteur) chargerShiftsGerant()
    else setLoading(false)
    verifierHeure()
    if (isCaissier && pointId && userId) chargerStatutInventaire()
  }, [])

  async function chargerStatutInventaire() {
    const { data } = await supabase
      .from('inventaires_shifts')
      .select('id')
      .eq('point_id', pointId)
      .eq('caissier_id', userId)
      .eq('valide', true)
      .limit(1)
    setInventaireCaissierOk(!!(data && data.length > 0))
  }

  // Sauvegarder le brouillon dans localStorage (résout écran blanc après photo sur iOS)
  useEffect(() => {
    if (Platform.OS !== 'web') return
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        heureDebut, heureFin,
        kdo, retour, yangoCse, glovoCse, wave, djamo, om, espece,
        photoKdo, photoRetour, photoYangoCse, photoGlovoCse, photoWave, photoDjamo, photoOm,
      }))
    } catch {}
  }, [heureDebut, heureFin, kdo, retour, yangoCse, glovoCse, wave, djamo, om, espece,
      photoKdo, photoRetour, photoYangoCse, photoGlovoCse, photoWave, photoDjamo, photoOm])

  function verifierHeure() {
    const now = new Date()
    if (now.getHours() >= 0 && now.getHours() < 5) setModalDate(true)
  }

  function ouvrirTimePicker(champ) {
    const val = champ === 'debut' ? heureDebut : heureFin
    const [h, m] = val ? val.split(':').map(Number) : [champ === 'debut' ? 8 : 16, 0]
    setTimePickerH(h)
    setTimePickerM(m)
    setTimePickerChamp(champ)
    setTimePickerVisible(true)
  }

  function confirmerTimePicker() {
    const str = `${String(timePickerH).padStart(2, '0')}:${String(timePickerM).padStart(2, '0')}`
    if (timePickerChamp === 'debut') setHeureDebut(str)
    else setHeureFin(str)
    setTimePickerVisible(false)
  }

  async function chargerDetailShift(shift) {
    setShiftDetail(shift)
    setShiftDetailData({ depenses: [], fournisseurs: [], presences: [], inventaire: null, loading: true })

    const [depRes, txRes, presRes, invRes] = await Promise.all([
      supabase.from('depenses')
        .select('*')
        .eq('point_id', shift.point_id)
        .eq('saisi_par', 'caissier')
        .order('created_at'),
      supabase.from('transactions_fournisseurs')
        .select('*, fournisseurs(nom)')
        .eq('point_id', shift.point_id)
        .eq('saisi_par', 'caissier'),
      shift.caissier_id
        ? supabase.from('presences')
            .select('*, travailleurs(nom, poste)')
            .eq('point_id', shift.point_id)
            .eq('caissier_id', shift.caissier_id)
        : Promise.resolve({ data: [] }),
      shift.caissier_id
        ? supabase.from('inventaires_shifts')
            .select(`
              id, caissier_id, type_shift, montant_a_deduire, valide,
              inventaire_lignes(
                produit_id, produit_nom, stock_initial, entrees, sorties,
                stock_reel, ecart, nombre_explique, explication, montant_deduit
              )
            `)
            .eq('point_id', shift.point_id)
            .eq('caissier_id', shift.caissier_id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ])

    setShiftDetailData({
      depenses: depRes.data || [],
      fournisseurs: txRes.data || [],
      presences: presRes.data || [],
      inventaire: invRes.data || null,
      loading: false,
    })
  }

  async function chargerShiftsGerant() {
    setLoading(true)
    if (!restaurantId) { setLoading(false); return }

    const today = new Date().toISOString().split('T')[0]
    const hier = new Date()
    hier.setDate(hier.getDate() - 1)
    const hierStr = hier.toISOString().split('T')[0]

    const { data } = await supabase
      .from('points_shifts')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .in('date', [today, hierStr])
      .order('created_at', { ascending: false })

    setShiftsGerant(data || [])
    setLoading(false)
  }

  async function supprimerShift(shift) {
    setSuppressionEnCours(true)
    try {
      const { data: point } = await supabase
        .from('points')
        .select('valide')
        .eq('id', shift.point_id)
        .maybeSingle()

      if (point?.valide) {
        Alert.alert('Suppression impossible', 'Ce shift appartient à un point déjà validé et ne peut pas être supprimé.')
        setConfirmSupprShift(null)
        return
      }

      if (shift.caissier_id) {
        await supabase.from('presences').delete()
          .eq('point_id', shift.point_id).eq('caissier_id', shift.caissier_id)
      }
      await supabase.from('depenses').delete()
        .eq('point_id', shift.point_id).eq('saisi_par', 'caissier')
      await supabase.from('transactions_fournisseurs').delete()
        .eq('point_id', shift.point_id).eq('saisi_par', 'caissier')
      await supabase.from('points_shifts').delete().eq('id', shift.id)

      setConfirmSupprShift(null)
      await chargerShiftsGerant()
    } catch (err) {
      Alert.alert('Erreur', err.message)
    } finally {
      setSuppressionEnCours(false)
    }
  }

  async function supprimerShiftsMultiples() {
    if (shiftsSelectionnes.size === 0) return
    setSuppressionEnCours(true)
    setConfirmSupprMultiple(false)

    const selectedShifts = shiftsGerant.filter(s => shiftsSelectionnes.has(s.id))
    const pointIds = [...new Set(selectedShifts.map(s => s.point_id))]
    const shiftIds = selectedShifts.map(s => s.id)

    try {
      const { data: points } = await supabase
        .from('points').select('id, valide').in('id', pointIds)
      const pointsValides = points?.filter(p => p.valide).map(p => p.id) || []
      if (pointsValides.length > 0) {
        const nb = selectedShifts.filter(s => pointsValides.includes(s.point_id)).length
        Alert.alert(
          'Suppression impossible',
          `${nb} shift(s) appartiennent à des points déjà validés et ne peuvent pas être supprimés.`
        )
        setSuppressionEnCours(false)
        return
      }

      for (const shift of selectedShifts) {
        if (shift.caissier_id) {
          await supabase.from('presences').delete()
            .eq('point_id', shift.point_id).eq('caissier_id', shift.caissier_id)
        }
      }
      await supabase.from('depenses').delete()
        .in('point_id', pointIds).eq('saisi_par', 'caissier')
      await supabase.from('transactions_fournisseurs').delete()
        .in('point_id', pointIds).eq('saisi_par', 'caissier')
      await supabase.from('points_shifts').delete().in('id', shiftIds)

      setModeSelection(false)
      setShiftsSelectionnes(new Set())
      await chargerShiftsGerant()
    } catch (err) {
      Alert.alert('Erreur', err.message)
    } finally {
      setSuppressionEnCours(false)
    }
  }

  function toggleSelection(shiftId) {
    setShiftsSelectionnes(prev => {
      const next = new Set(prev)
      if (next.has(shiftId)) next.delete(shiftId)
      else next.add(shiftId)
      return next
    })
  }

  function toutSelectionner() {
    setShiftsSelectionnes(new Set(shiftsGerant.map(s => s.id)))
  }

  function quitterModeSelection() {
    setModeSelection(false)
    setShiftsSelectionnes(new Set())
  }

  function venteShift() {
    return totalDepenses() +
      (parseFloat(kdo) || 0) +
      (parseFloat(retour) || 0) +
      (parseFloat(yangoCse) || 0) +
      (parseFloat(glovoCse) || 0) +
      (parseFloat(wave) || 0) +
      (parseFloat(djamo) || 0) +
      (parseFloat(om) || 0) +
      (parseFloat(espece) || 0)
  }

  function verifierPhotosManquantes() {
    const manquantes = []
    if (parseFloat(kdo) > 0 && !photoKdo) manquantes.push('KDO')
    if (parseFloat(retour) > 0 && !photoRetour) manquantes.push('Retour')
    if (parseFloat(yangoCse) > 0 && !photoYangoCse) manquantes.push('Yango CSE')
    if (parseFloat(glovoCse) > 0 && !photoGlovoCse) manquantes.push('Glovo CSE')
    if (parseFloat(wave) > 0 && !photoWave) manquantes.push('Wave')
    if (parseFloat(djamo) > 0 && !photoDjamo) manquantes.push('Djamo')
    if (parseFloat(om) > 0 && !photoOm) manquantes.push('Orange Money')
    return manquantes
  }

  function gererPhoto(setter, dossier) {
    photoPickerRef.current = { setter, dossier }
    if (Platform.OS === 'web') {
      selectionnerPhoto('gallery')
    } else {
      Alert.alert(
        'Ajouter une photo',
        'Choisissez la source',
        [
          { text: 'Annuler', style: 'cancel' },
          { text: '📷 Caméra', onPress: () => selectionnerPhoto('camera') },
          { text: '🖼 Galerie', onPress: () => selectionnerPhoto('gallery') },
        ]
      )
    }
  }

  async function selectionnerPhoto(source) {
    setPhotoModalVisible(false)
    const { setter, dossier } = photoPickerRef.current
    if (!setter) return
    setUploading(true)
    try {
      const url = source === 'camera'
        ? await prendrePhoto(dossier)
        : await choisirPhoto(dossier)
      if (url) setter(url)
    } finally {
      setUploading(false)
    }
  }

  function validerShift() {
    if (!heureDebut || !heureFin) {
      Alert.alert('Erreur', 'Veuillez indiquer les heures de début et de fin du shift')
      return
    }
    if (isCaissier && !inventaireCaissierOk) {
      Alert.alert(
        '🔒 Inventaire requis',
        'Veuillez compléter et verrouiller votre inventaire avant de valider le shift.',
        [
          { text: 'Retour', style: 'cancel' },
          { text: 'Vérifier', onPress: () => chargerStatutInventaire() },
        ]
      )
      return
    }
    const manquantes = verifierPhotosManquantes()
    if (manquantes.length > 0) {
      Alert.alert(
        '⚠️ Photos manquantes',
        `Les éléments suivants n\'ont pas de photo :\n\n${manquantes.map(m => `• ${m}`).join('\n')}\n\nAjoutez les photos justificatives.`
      )
      return
    }
    setConfirmShiftVisible(true)
  }

  async function sauvegarderShift() {
    setSaving(true)

    let shiftPointId = pointId
    if (dateShift !== new Date().toISOString().split('T')[0]) {
      const { data: pointHier } = await supabase
        .from('points')
        .select('id')
        .eq('restaurant_id', restaurantId)
        .eq('date', dateShift)
        .single()
      if (pointHier) shiftPointId = pointHier.id
    }

    const vente = venteShift()
    const shiftRecord = {
      point_id: shiftPointId,
      restaurant_id: restaurantId,
      date: dateShift,
      caissier_id: userId || null,
      caissier_nom: userNom || null,
      heure_debut: heureDebut,
      heure_fin: heureFin,
      depenses: totalDepenses(),
      fournisseurs: totalFournisseurs(),
      kdo: parseFloat(kdo) || 0,
      retour: parseFloat(retour) || 0,
      yango_cse: parseFloat(yangoCse) || 0,
      glovo_cse: parseFloat(glovoCse) || 0,
      wave: parseFloat(wave) || 0,
      djamo: parseFloat(djamo) || 0,
      om: parseFloat(om) || 0,
      espece: parseFloat(espece) || 0,
      vente_shift: vente,
      photo_kdo: photoKdo,
      photo_retour: photoRetour,
      photo_yango_cse: photoYangoCse,
      photo_glovo_cse: photoGlovoCse,
      photo_wave: photoWave,
      photo_djamo: photoDjamo,
      photo_om: photoOm,
      valide: true,
      valide_at: new Date().toISOString(),
    }

    try {
      await savePointShiftData(shiftRecord, depensesJour, fournisseursJour, userNom)
      creerNotification({
        type: 'shift_valide',
        titre: '⏱️ Shift validé',
        message: `${userNom || 'Caissier'} — ${dateShift}`,
        restaurant_id: restaurantId,
        cible_role: ['manager', 'directeur', 'gerant'],
        created_by: userId,
        screen: 'verification',
        params: { restaurant_id: restaurantId, point_id: shiftPointId },
      }).catch(() => {})
    } catch (err) {
      Alert.alert('Erreur', err.message)
      setSaving(false)
      return
    }

    resetJour()
    effacerDraft()

    setHeureDebut(''); setHeureFin('')
    setKdo(''); setRetour('')
    setYangoCse(''); setGlovoCse('')
    setWave(''); setDjamo(''); setOm(''); setEspece('')
    setPhotoKdo(null); setPhotoRetour(null)
    setPhotoYangoCse(null); setPhotoGlovoCse(null)
    setPhotoWave(null); setPhotoDjamo(null); setPhotoOm(null)

    setSaving(false)
    router.replace('/accueil')
  }

  function fmt(n) { return Math.round(n).toLocaleString('fr-FR') + ' FCFA' }

  function formatDate(dateStr) {
    if (!dateStr) return ''
    const [y, m, d] = dateStr.split('-')
    const mois = ['jan', 'fév', 'mar', 'avr', 'mai', 'juin', 'juil', 'août', 'sep', 'oct', 'nov', 'déc']
    return `${parseInt(d)} ${mois[parseInt(m) - 1]} ${y}`
  }

  function cumulShifts() {
    return {
      depenses: shiftsGerant.reduce((sum, s) => sum + (s.depenses || 0), 0),
      fournisseurs: shiftsGerant.reduce((sum, s) => sum + (s.fournisseurs || 0), 0),
      kdo: shiftsGerant.reduce((sum, s) => sum + (s.kdo || 0), 0),
      retour: shiftsGerant.reduce((sum, s) => sum + (s.retour || 0), 0),
      yango_cse: shiftsGerant.reduce((sum, s) => sum + (s.yango_cse || 0), 0),
      glovo_cse: shiftsGerant.reduce((sum, s) => sum + (s.glovo_cse || 0), 0),
      wave: shiftsGerant.reduce((sum, s) => sum + (s.wave || 0), 0),
      djamo: shiftsGerant.reduce((sum, s) => sum + (s.djamo || 0), 0),
      om: shiftsGerant.reduce((sum, s) => sum + (s.om || 0), 0),
      espece: shiftsGerant.reduce((sum, s) => sum + (s.espece || 0), 0),
      vente_total: shiftsGerant.reduce((sum, s) => sum + (s.vente_shift || 0), 0),
    }
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
          <Text style={styles.headerTitre}>Point / Shift</Text>
          <Text style={styles.headerSub}>
            {isCaissier ? 'Faire mon point' : 'Vue journalière'}
          </Text>
        </View>
        <View style={{ width: 60 }} />
      </View>

      {(isGerant || isManager || isDirecteur) && (
        <View style={styles.onglets}>
          <TouchableOpacity
            style={[styles.onglet, vue === 'monshift' && styles.ongletActive]}
            onPress={() => setVue('monshift')}
          >
            <Text style={[styles.ongletTxt, vue === 'monshift' && styles.ongletTxtActive]}>
              📝 Mon shift
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.onglet, vue === 'liste' && styles.ongletActive]}
            onPress={() => setVue('liste')}
          >
            <Text style={[styles.ongletTxt, vue === 'liste' && styles.ongletTxtActive]}>
              📊 Journalier
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.onglet, vue === 'detail' && styles.ongletActive]}
            onPress={() => setVue('detail')}
          >
            <Text style={[styles.ongletTxt, vue === 'detail' && styles.ongletTxtActive]}>
              📋 Détail
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ══════════════════════════════════════════
          CAISSIER / GÉRANT — Formulaire shift
      ══════════════════════════════════════════ */}
      {(isCaissier || ((isGerant || isManager || isDirecteur) && vue === 'monshift')) && (
        <ScrollView style={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

          {new Date().getHours() >= 0 && new Date().getHours() < 5 && (
            <View style={styles.alerteMinuit}>
              <Text style={styles.alerteMinuitTitre}>⚠️ Il est après minuit</Text>
              <Text style={styles.alerteMinuitTxt}>
                Ce shift sera assigné au {formatDate(dateShift)} (hier).
              </Text>
            </View>
          )}

          <Text style={styles.sectionTitre}>Horaires du shift *</Text>
          <View style={styles.heuresCard}>
            <View style={styles.heureRow}>
              <Text style={styles.heureLabel}>Heure de début</Text>
              <TouchableOpacity style={styles.heureBtn} onPress={() => ouvrirTimePicker('debut')}>
                <Text style={[styles.heureBtnTxt, !heureDebut && styles.heureBtnPlaceholder]}>
                  {heureDebut || '-- : --'}
                </Text>
              </TouchableOpacity>
            </View>
            <View style={[styles.heureRow, { borderBottomWidth: 0 }]}>
              <Text style={styles.heureLabel}>Heure de fin</Text>
              <TouchableOpacity style={styles.heureBtn} onPress={() => ouvrirTimePicker('fin')}>
                <Text style={[styles.heureBtnTxt, !heureFin && styles.heureBtnPlaceholder]}>
                  {heureFin || '-- : --'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <Text style={styles.sectionTitre}>Données automatiques</Text>
          <View style={styles.autoCard}>
            <Text style={styles.autoTitre}>📊 Chargées depuis vos saisies</Text>
            <View style={styles.autoRow}>
              <Text style={styles.autoLabel}>Dépenses + Salaires</Text>
              <Text style={styles.autoVal}>{fmt(totalDepenses())}</Text>
            </View>
            <View style={[styles.autoRow, { borderBottomWidth: 0 }]}>
              <Text style={styles.autoLabel}>Fournisseurs</Text>
              <Text style={styles.autoVal}>{fmt(totalFournisseurs())}</Text>
            </View>
          </View>

          <Text style={styles.sectionTitre}>Données à saisir & justifier</Text>
          <Text style={styles.sectionSub}>
            Chaque montant doit être accompagné d'une photo justificative
          </Text>

          <LigneSaisie label="🎁 KDO offerts" value={kdo} setter={setKdo}
            photoValue={photoKdo} photoSetter={setPhotoKdo} dossier="kdo"
            onGererPhoto={gererPhoto} uploading={uploading} />
          <LigneSaisie label="↩️ Retours" value={retour} setter={setRetour}
            photoValue={photoRetour} photoSetter={setPhotoRetour} dossier="retour"
            onGererPhoto={gererPhoto} uploading={uploading} />
          <LigneSaisie label="🛵 Yango CSE" value={yangoCse} setter={setYangoCse}
            photoValue={photoYangoCse} photoSetter={setPhotoYangoCse} dossier="yango"
            onGererPhoto={gererPhoto} uploading={uploading} />
          <LigneSaisie label="🛵 Glovo CSE" value={glovoCse} setter={setGlovoCse}
            photoValue={photoGlovoCse} photoSetter={setPhotoGlovoCse} dossier="glovo"
            onGererPhoto={gererPhoto} uploading={uploading} />
          <LigneSaisie label="💳 Wave" value={wave} setter={setWave}
            photoValue={photoWave} photoSetter={setPhotoWave} dossier="wave"
            onGererPhoto={gererPhoto} uploading={uploading} />
          <LigneSaisie label="💳 Djamo" value={djamo} setter={setDjamo}
            photoValue={photoDjamo} photoSetter={setPhotoDjamo} dossier="djamo"
            onGererPhoto={gererPhoto} uploading={uploading} />
          <LigneSaisie label="💳 Orange Money" value={om} setter={setOm}
            photoValue={photoOm} photoSetter={setPhotoOm} dossier="om"
            onGererPhoto={gererPhoto} uploading={uploading} />

          <Text style={styles.sectionTitre}>Espèces en caisse</Text>
          <LigneSaisieSimple
            label="💵 Espèces en caisse"
            value={espece}
            setter={setEspece}
            note="ℹ️ Somme d'argent liquide en caisse — aucune photo requise"
          />

          {/* Total vente shift */}
          <View style={styles.venteShiftCard}>
            <Text style={styles.venteShiftTitre}>💰 Vente shift</Text>
            <Text style={styles.venteShiftSub}>Calculé automatiquement</Text>
            <Text style={styles.venteShiftVal}>{fmt(venteShift())}</Text>
            <View style={styles.calcDetail}>
              <Text style={styles.calcDetailTitre}>Détail :</Text>
              {[
                { label: 'Dépenses + Salaires', val: totalDepenses() },
                { label: 'KDO', val: parseFloat(kdo) || 0 },
                { label: 'Retour', val: parseFloat(retour) || 0 },
                { label: 'Yango CSE', val: parseFloat(yangoCse) || 0 },
                { label: 'Glovo CSE', val: parseFloat(glovoCse) || 0 },
                { label: 'Wave', val: parseFloat(wave) || 0 },
                { label: 'Djamo', val: parseFloat(djamo) || 0 },
                { label: 'Orange Money', val: parseFloat(om) || 0 },
                { label: 'Espèces', val: parseFloat(espece) || 0 },
              ].filter(r => r.val > 0).map((r, i) => (
                <View key={i} style={styles.calcDetailRow}>
                  <Text style={styles.calcDetailLabel}>{r.label}</Text>
                  <Text style={styles.calcDetailVal}>{fmt(r.val)}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* Statut photos */}
          {(() => {
            const manquantes = verifierPhotosManquantes()
            return (
              <View style={[styles.photosStatut, {
                backgroundColor: manquantes.length === 0 ? '#EAF3DE' : '#FAECE7',
                borderColor: manquantes.length === 0 ? '#3B6D11' : '#A32D2D',
              }]}>
                {manquantes.length === 0 ? (
                  <Text style={[styles.photosStatutTxt, { color: '#3B6D11' }]}>
                    ✅ Toutes les photos sont présentes — prêt à valider
                  </Text>
                ) : (
                  <>
                    <Text style={[styles.photosStatutTxt, { color: '#A32D2D' }]}>
                      ⚠️ Photos manquantes ({manquantes.length}) :
                    </Text>
                    {manquantes.map((m, i) => (
                      <Text key={i} style={{ fontSize: 12, color: '#993C1D', marginTop: 3 }}>
                        • {m}
                      </Text>
                    ))}
                  </>
                )}
              </View>
            )
          })()}

          <TouchableOpacity
            style={[styles.validerBtn, saving && { opacity: 0.6 }]}
            onPress={validerShift}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Text style={styles.validerTxt}>🔒 Valider mon shift</Text>
                <Text style={styles.validerSub}>Irréversible — données remises à zéro ensuite</Text>
              </>
            )}
          </TouchableOpacity>

          <View style={{ height: 40 }} />
        </ScrollView>
      )}

      {/* ══════════════════════════════════════════
          GÉRANT — Vue journalière cumul
      ══════════════════════════════════════════ */}
      {(isGerant || isManager || isDirecteur) && vue === 'liste' && (
        <ScrollView style={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {loading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator size="large" color="#EF9F27" />
            </View>
          ) : shiftsGerant.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyIcon}>📊</Text>
              <Text style={styles.emptyTxt}>Aucun shift validé aujourd'hui</Text>
              <Text style={styles.emptySub}>
                Les données s'afficheront ici quand les caissiers valideront leurs shifts
              </Text>
            </View>
          ) : (
            <>
              <View style={styles.totalJourCard}>
                <Text style={styles.totalJourTitre}>💰 Vente totale du jour</Text>
                <Text style={styles.totalJourVal}>{fmt(cumulShifts().vente_total)}</Text>
                <Text style={styles.totalJourSub}>
                  {shiftsGerant.length} shift(s) validé(s)
                </Text>
              </View>

              <Text style={styles.sectionTitre}>Cumul journalier</Text>
              <View style={styles.cumulCard}>
                <Text style={styles.cumulTitre}>
                  📊 Total de {shiftsGerant.length} shift(s)
                </Text>
                {[
                  { label: 'Dépenses + Salaires', key: 'depenses' },
                  { label: 'Fournisseurs', key: 'fournisseurs' },
                  { label: 'KDO', key: 'kdo' },
                  { label: 'Retour', key: 'retour' },
                  { label: 'Yango CSE', key: 'yango_cse' },
                  { label: 'Glovo CSE', key: 'glovo_cse' },
                  { label: 'Wave', key: 'wave' },
                  { label: 'Djamo', key: 'djamo' },
                  { label: 'Orange Money', key: 'om' },
                  { label: 'Espèces', key: 'espece' },
                ].map((item, i) => {
                  const val = cumulShifts()[item.key] || 0
                  if (val === 0) return null
                  return (
                    <View key={i} style={styles.cumulRow}>
                      <Text style={styles.cumulLabel}>{item.label}</Text>
                      <Text style={styles.cumulVal}>{fmt(val)}</Text>
                    </View>
                  )
                })}
                <View style={[styles.cumulRow, {
                  borderBottomWidth: 0, marginTop: 10, paddingTop: 10,
                  borderTopWidth: 1.5, borderTopColor: '#EF9F27'
                }]}>
                  <Text style={[styles.cumulLabel, { fontWeight: '700', color: '#1a1a1a', fontSize: 15 }]}>
                    Vente totale
                  </Text>
                  <Text style={[styles.cumulVal, { fontWeight: '700', color: '#EF9F27', fontSize: 18 }]}>
                    {fmt(cumulShifts().vente_total)}
                  </Text>
                </View>
              </View>

              <View style={styles.infoGerantCard}>
                <Text style={styles.infoGerantTxt}>
                  ℹ️ Ces données sont pré-remplies dans "Saisir les ventes" pour le point journalier complet.
                </Text>
              </View>

            </>
          )}
          <View style={{ height: 40 }} />
        </ScrollView>
      )}

      {/* ══════════════════════════════════════════
          GÉRANT / MANAGER / DIRECTEUR — Détail par shift
      ══════════════════════════════════════════ */}
      {(isGerant || isManager || isDirecteur) && vue === 'detail' && (
        <View style={{ flex: 1 }}>
          {/* Barre de sélection multiple — Manager et Directeur uniquement */}
          {peutSupprimer && !loading && shiftsGerant.length > 0 && (
            <View style={styles.selectionBar}>
              {modeSelection ? (
                <>
                  <TouchableOpacity style={styles.selBtnTout} onPress={toutSelectionner}>
                    <Text style={styles.selBtnToutTxt}>Tout sélectionner</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.selBtnAnnuler} onPress={quitterModeSelection}>
                    <Text style={styles.selBtnAnnulerTxt}>Annuler</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <TouchableOpacity style={styles.selBtnActiver} onPress={() => setModeSelection(true)}>
                  <Text style={styles.selBtnActiverTxt}>☑️ Sélectionner</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          <ScrollView style={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {loading ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator size="large" color="#EF9F27" />
              </View>
            ) : shiftsGerant.length === 0 ? (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyIcon}>📋</Text>
                <Text style={styles.emptyTxt}>Aucun shift pour aujourd'hui</Text>
              </View>
            ) : (
              shiftsGerant.map((shift, i) => {
                const selectionne = shiftsSelectionnes.has(shift.id)
                return (
                  <TouchableOpacity
                    key={shift.id}
                    style={[styles.shiftCard, modeSelection && selectionne && styles.shiftCardSelected]}
                    onPress={modeSelection ? () => toggleSelection(shift.id) : () => chargerDetailShift(shift)}
                    activeOpacity={0.8}
                  >
                    <View style={styles.shiftHeader}>
                      {modeSelection && (
                        <View style={[styles.checkbox, selectionne && styles.checkboxSelected]}>
                          {selectionne && <Text style={styles.checkboxCheck}>✓</Text>}
                        </View>
                      )}
                      <View style={styles.shiftNumBox}>
                        <Text style={styles.shiftNumTxt}>S{i + 1}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.shiftHeures}>
                          ⏰ {shift.heure_debut} → {shift.heure_fin}
                        </Text>
                        {shift.caissier_nom && (
                          <Text style={styles.shiftCaissier}>👤 {shift.caissier_nom}</Text>
                        )}
                        <Text style={styles.shiftDate}>{formatDate(shift.date)}</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end', gap: 6 }}>
                        <View style={styles.shiftValideBadge}>
                          <Text style={styles.shiftValideTxt}>🔒 Validé</Text>
                        </View>
                        {peutSupprimer && !modeSelection && (
                          <TouchableOpacity
                            style={styles.supprimerBtn}
                            onPress={() => setConfirmSupprShift(shift)}
                          >
                            <Text style={styles.supprimerBtnTxt}>🗑️ Supprimer</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                    <View style={styles.shiftDetails}>
                      {[
                        { label: 'Dépenses + Salaires', val: shift.depenses },
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
                        <View key={j} style={styles.shiftRow}>
                          <Text style={styles.shiftLabel}>{r.label}</Text>
                          <Text style={styles.shiftVal}>{fmt(r.val)}</Text>
                        </View>
                      ))}
                      <View style={[styles.shiftRow, { borderBottomWidth: 0, marginTop: 8 }]}>
                        <Text style={[styles.shiftLabel, { fontWeight: '700', color: '#1a1a1a', fontSize: 14 }]}>
                          Vente shift
                        </Text>
                        <Text style={[styles.shiftVal, { fontWeight: '700', color: '#EF9F27', fontSize: 16 }]}>
                          {fmt(shift.vente_shift)}
                        </Text>
                      </View>
                    </View>
                    {!modeSelection && (
                      <View style={styles.voirDetailBarre}>
                        <Text style={styles.voirDetailTxt}>Voir le détail complet ›</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                )
              })
            )}
            <View style={{ height: modeSelection && shiftsSelectionnes.size > 0 ? 100 : 40 }} />
          </ScrollView>

          {/* Barre de suppression en bas — mode sélection actif */}
          {peutSupprimer && modeSelection && shiftsSelectionnes.size > 0 && (
            <View style={styles.barreSuppressionBas}>
              <TouchableOpacity
                style={[styles.btnSupprimerSel, suppressionEnCours && { opacity: 0.6 }]}
                onPress={() => setConfirmSupprMultiple(true)}
                disabled={suppressionEnCours}
              >
                {suppressionEnCours ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.btnSupprimerSelTxt}>
                    🗑️ Supprimer la sélection ({shiftsSelectionnes.size})
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}

      {/* Modal sélecteur d'heure */}
      <Modal visible={timePickerVisible} transparent animationType="slide">
        <View style={styles.confirmOverlay}>
          <View style={styles.timePickerBox}>
            <Text style={styles.timePickerTitre}>
              {timePickerChamp === 'debut' ? '⏱️ Heure de début' : '⏱️ Heure de fin'}
            </Text>
            <View style={styles.timePickerCols}>
              <View style={styles.timePickerColWrap}>
                <Text style={styles.timePickerColLabel}>Heure</Text>
                <ColonnePicker
                  key={`h-${timePickerVisible}-${timePickerChamp}`}
                  items={HEURES}
                  value={timePickerH}
                  onChange={setTimePickerH}
                />
              </View>
              <Text style={styles.timePickerSep}>:</Text>
              <View style={styles.timePickerColWrap}>
                <Text style={styles.timePickerColLabel}>Minute</Text>
                <ColonnePicker
                  key={`m-${timePickerVisible}-${timePickerChamp}`}
                  items={MINUTES}
                  value={timePickerM}
                  onChange={setTimePickerM}
                />
              </View>
            </View>
            <View style={styles.confirmBtns}>
              <TouchableOpacity style={styles.confirmCancel} onPress={() => setTimePickerVisible(false)}>
                <Text style={styles.confirmCancelTxt}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmOk} onPress={confirmerTimePicker}>
                <Text style={styles.confirmOkTxt}>✓ Confirmer</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal choix source photo */}
      <Modal visible={photoModalVisible} transparent animationType="fade">
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmBox}>
            <Text style={styles.confirmTitre}>📷 Ajouter une photo</Text>
            <View style={styles.confirmBtns}>
              <TouchableOpacity style={styles.confirmCancel} onPress={() => { setPhotoModalVisible(false); setUploading(false) }}>
                <Text style={styles.confirmCancelTxt}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmOk} onPress={() => selectionnerPhoto('gallery')}>
                <Text style={styles.confirmOkTxt}>🖼 Galerie</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal confirmation shift */}
      <Modal visible={confirmShiftVisible} transparent animationType="fade">
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmBox}>
            <Text style={styles.confirmTitre}>Confirmer le point shift</Text>
            <Text style={styles.confirmMsg}>
              Vente shift : {fmt(venteShift())}{'\n\n'}
              Une fois validé :{'\n'}
              • Ce shift ne pourra plus être modifié{'\n'}
              • Vos données seront remises à zéro pour le prochain caissier
            </Text>
            <View style={styles.confirmBtns}>
              <TouchableOpacity style={styles.confirmCancel} onPress={() => setConfirmShiftVisible(false)}>
                <Text style={styles.confirmCancelTxt}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.confirmOk, { backgroundColor: '#3B6D11' }]} onPress={() => { setConfirmShiftVisible(false); sauvegarderShift() }}>
                <Text style={styles.confirmOkTxt}>✅ Valider</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal confirmation suppression shift individuel */}
      <Modal visible={!!confirmSupprShift} transparent animationType="fade">
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmBox}>
            <Text style={styles.confirmTitre}>Supprimer ce shift ?</Text>
            <Text style={styles.confirmMsg}>
              {confirmSupprShift?.caissier_nom ? `👤 ${confirmSupprShift.caissier_nom}\n` : ''}
              {confirmSupprShift ? `⏰ ${confirmSupprShift.heure_debut} → ${confirmSupprShift.heure_fin}\n\n` : ''}
              Êtes-vous sûr de vouloir supprimer ce shift ? Cette action est irréversible.
            </Text>
            <View style={styles.confirmBtns}>
              <TouchableOpacity
                style={styles.confirmCancel}
                onPress={() => setConfirmSupprShift(null)}
                disabled={suppressionEnCours}
              >
                <Text style={styles.confirmCancelTxt}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmOk, { backgroundColor: '#A32D2D' }, suppressionEnCours && { opacity: 0.6 }]}
                onPress={() => supprimerShift(confirmSupprShift)}
                disabled={suppressionEnCours}
              >
                {suppressionEnCours ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.confirmOkTxt}>🗑️ Confirmer la suppression</Text>
                )}
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
              Vous allez supprimer {shiftsSelectionnes.size} shift(s) et toutes leurs données liées (présences, dépenses, fournisseurs).{'\n\n'}Cette action est irréversible.
            </Text>
            <View style={styles.confirmBtns}>
              <TouchableOpacity
                style={styles.confirmCancel}
                onPress={() => setConfirmSupprMultiple(false)}
              >
                <Text style={styles.confirmCancelTxt}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmOk, { backgroundColor: '#A32D2D' }]}
                onPress={supprimerShiftsMultiples}
              >
                <Text style={styles.confirmOkTxt}>🗑️ Supprimer tout</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal détail shift complet — lecture seule */}
      <Modal visible={!!shiftDetail} transparent animationType="slide">
        <View style={styles.detailOverlay}>
          <View style={styles.detailModal}>
            {/* En-tête */}
            <View style={styles.detailHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.detailCaissier}>
                  👤 {shiftDetail?.caissier_nom || 'Caissier'}
                </Text>
                <Text style={styles.detailHeures}>
                  ⏰ {shiftDetail?.heure_debut} → {shiftDetail?.heure_fin}
                  {'  '}
                  <Text style={styles.detailDateInline}>{formatDate(shiftDetail?.date || '')}</Text>
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 6 }}>
                <View style={styles.shiftValideBadge}>
                  <Text style={styles.shiftValideTxt}>🔒 Validé</Text>
                </View>
                <TouchableOpacity onPress={() => setShiftDetail(null)}>
                  <Text style={styles.detailClose}>✕ Fermer</Text>
                </TouchableOpacity>
              </View>
            </View>

            {shiftDetailData.loading ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator size="large" color="#EF9F27" />
                <Text style={{ color: '#888', marginTop: 10 }}>Chargement...</Text>
              </View>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>

                {/* Financier */}
                <Text style={styles.detailSection}>💰 Données financières</Text>
                <View style={styles.detailCard}>
                  {[
                    { label: 'Vente shift total', val: shiftDetail?.vente_shift, bold: true, color: '#EF9F27' },
                    { label: 'Espèces en caisse', val: shiftDetail?.espece },
                    { label: 'Wave', val: shiftDetail?.wave },
                    { label: 'Orange Money', val: shiftDetail?.om },
                    { label: 'Djamo', val: shiftDetail?.djamo },
                    { label: 'Yango CSE', val: shiftDetail?.yango_cse },
                    { label: 'Glovo CSE', val: shiftDetail?.glovo_cse },
                    { label: 'KDO offerts', val: shiftDetail?.kdo },
                    { label: 'Retours', val: shiftDetail?.retour },
                    { label: 'Dépenses + Salaires', val: shiftDetail?.depenses },
                    { label: 'Fournisseurs', val: shiftDetail?.fournisseurs },
                  ].filter(r => r.val > 0).map((r, i, arr) => (
                    <View key={i} style={[styles.detailRow, i === arr.length - 1 && { borderBottomWidth: 0 }]}>
                      <Text style={[styles.detailLabel, r.bold && { fontWeight: '700', color: '#1a1a1a' }]}>{r.label}</Text>
                      <Text style={[styles.detailVal, r.color && { color: r.color, fontWeight: '700' }]}>{fmt(r.val)}</Text>
                    </View>
                  ))}
                </View>

                {/* Photos du shift */}
                {[
                  { label: 'KDO', url: shiftDetail?.photo_kdo },
                  { label: 'Retour', url: shiftDetail?.photo_retour },
                  { label: 'Yango CSE', url: shiftDetail?.photo_yango_cse },
                  { label: 'Glovo CSE', url: shiftDetail?.photo_glovo_cse },
                  { label: 'Wave', url: shiftDetail?.photo_wave },
                  { label: 'Djamo', url: shiftDetail?.photo_djamo },
                  { label: 'Orange Money', url: shiftDetail?.photo_om },
                ].filter(p => p.url).length > 0 && (
                  <>
                    <Text style={styles.detailSection}>📷 Photos justificatives</Text>
                    <View style={styles.detailCard}>
                      <View style={styles.photosGrid}>
                        {[
                          { label: 'KDO', url: shiftDetail?.photo_kdo },
                          { label: 'Retour', url: shiftDetail?.photo_retour },
                          { label: 'Yango CSE', url: shiftDetail?.photo_yango_cse },
                          { label: 'Glovo CSE', url: shiftDetail?.photo_glovo_cse },
                          { label: 'Wave', url: shiftDetail?.photo_wave },
                          { label: 'Djamo', url: shiftDetail?.photo_djamo },
                          { label: 'Orange Money', url: shiftDetail?.photo_om },
                        ].filter(p => p.url).map((p, i) => (
                          <TouchableOpacity key={i} style={styles.photoThumb} onPress={() => setPhotoPleinEcranUrl(p.url)}>
                            <Image source={{ uri: p.url }} style={styles.photoThumbImg} resizeMode="cover" />
                            <Text style={styles.photoThumbLabel}>{p.label}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                  </>
                )}

                {/* Dépenses */}
                <Text style={styles.detailSection}>🧾 Dépenses ({shiftDetailData.depenses.length})</Text>
                {shiftDetailData.depenses.length === 0 ? (
                  <View style={[styles.detailCard, { alignItems: 'center', paddingVertical: 16 }]}>
                    <Text style={{ color: '#aaa', fontSize: 13 }}>Aucune dépense enregistrée</Text>
                  </View>
                ) : (
                  <View style={styles.detailCard}>
                    {shiftDetailData.depenses.map((d, i) => (
                      <View key={d.id || i} style={[styles.detailRow, i === shiftDetailData.depenses.length - 1 && { borderBottomWidth: 0 }]}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.detailLabel}>{d.libelle || d.categorie || 'Dépense'}</Text>
                          {d.categorie && d.libelle && (
                            <Text style={{ fontSize: 10, color: '#aaa', marginTop: 2 }}>{d.categorie}</Text>
                          )}
                        </View>
                        <View style={{ alignItems: 'flex-end', gap: 4 }}>
                          <Text style={[styles.detailVal, { color: '#A32D2D' }]}>{fmt(d.montant || 0)}</Text>
                          {d.photo_url && (
                            <TouchableOpacity onPress={() => setPhotoPleinEcranUrl(d.photo_url)}>
                              <Text style={{ fontSize: 18 }}>📷</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      </View>
                    ))}
                    <View style={[styles.detailRow, { borderBottomWidth: 0, marginTop: 8, borderTopWidth: 1, borderTopColor: '#eee', paddingTop: 10 }]}>
                      <Text style={[styles.detailLabel, { fontWeight: '700', color: '#1a1a1a' }]}>Total dépenses</Text>
                      <Text style={[styles.detailVal, { color: '#A32D2D', fontWeight: '700' }]}>
                        {fmt(shiftDetailData.depenses.reduce((s, d) => s + (d.montant || 0), 0))}
                      </Text>
                    </View>
                  </View>
                )}

                {/* Fournisseurs */}
                <Text style={styles.detailSection}>🏭 Fournisseurs ({shiftDetailData.fournisseurs.length})</Text>
                {shiftDetailData.fournisseurs.length === 0 ? (
                  <View style={[styles.detailCard, { alignItems: 'center', paddingVertical: 16 }]}>
                    <Text style={{ color: '#aaa', fontSize: 13 }}>Aucun fournisseur enregistré</Text>
                  </View>
                ) : (
                  <View style={styles.detailCard}>
                    {shiftDetailData.fournisseurs.map((tx, i) => (
                      <View key={tx.id || i} style={[styles.detailRow, { alignItems: 'flex-start', borderBottomWidth: i === shiftDetailData.fournisseurs.length - 1 ? 0 : 0.5 }]}>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.detailLabel, { fontWeight: '600' }]}>
                            {tx.fournisseurs?.nom || 'Fournisseur'}
                          </Text>
                          <Text style={{ fontSize: 11, color: '#888', marginTop: 3 }}>
                            Facture : {fmt(tx.facture || 0)} — Payé : {fmt(tx.paye || 0)}
                          </Text>
                          <Text style={{ fontSize: 11, color: tx.reste > 0 ? '#A32D2D' : '#3B6D11', marginTop: 2 }}>
                            Reste dû : {fmt(tx.reste || 0)}
                          </Text>
                        </View>
                        {tx.photo_url && (
                          <TouchableOpacity onPress={() => setPhotoPleinEcranUrl(tx.photo_url)} style={{ marginLeft: 8 }}>
                            <Text style={{ fontSize: 22 }}>📷</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    ))}
                  </View>
                )}

                {/* Présences */}
                <Text style={styles.detailSection}>👥 Présences & Paies ({shiftDetailData.presences.length})</Text>
                {shiftDetailData.presences.length === 0 ? (
                  <View style={[styles.detailCard, { alignItems: 'center', paddingVertical: 16 }]}>
                    <Text style={{ color: '#aaa', fontSize: 13 }}>Aucune présence enregistrée</Text>
                  </View>
                ) : (
                  <View style={styles.detailCard}>
                    {shiftDetailData.presences.map((p, i) => (
                      <View key={p.id || i} style={[styles.detailRow, i === shiftDetailData.presences.length - 1 && { borderBottomWidth: 0 }]}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.detailLabel}>{p.travailleurs?.nom || 'Travailleur'}</Text>
                          {p.travailleurs?.poste && (
                            <Text style={{ fontSize: 10, color: '#aaa', marginTop: 2 }}>{p.travailleurs.poste}</Text>
                          )}
                        </View>
                        <View style={{ alignItems: 'flex-end', gap: 4 }}>
                          <View style={[styles.shiftValideBadge, {
                            backgroundColor: p.statut === 'present' ? '#EAF3DE' : '#FAECE7'
                          }]}>
                            <Text style={{
                              fontSize: 11, fontWeight: '500',
                              color: p.statut === 'present' ? '#3B6D11' : '#A32D2D'
                            }}>
                              {p.statut === 'present' ? '✅ Présent' : '❌ Absent'}
                            </Text>
                          </View>
                          {p.montant_paie > 0 && (
                            <Text style={[styles.detailVal, { fontSize: 12 }]}>{fmt(p.montant_paie)}</Text>
                          )}
                        </View>
                      </View>
                    ))}
                    {shiftDetailData.presences.some(p => p.montant_paie > 0) && (
                      <View style={[styles.detailRow, { borderBottomWidth: 0, marginTop: 8, borderTopWidth: 1, borderTopColor: '#eee', paddingTop: 10 }]}>
                        <Text style={[styles.detailLabel, { fontWeight: '700', color: '#1a1a1a' }]}>Total paies</Text>
                        <Text style={[styles.detailVal, { fontWeight: '700' }]}>
                          {fmt(shiftDetailData.presences.reduce((s, p) => s + (p.montant_paie || 0), 0))}
                        </Text>
                      </View>
                    )}
                  </View>
                )}

                {/* Inventaire */}
                <Text style={styles.detailSection}>
                  📦 Inventaire {shiftDetailData.inventaire?.valide ? '🔒' : '🔄'}
                </Text>
                {!shiftDetailData.inventaire ? (
                  <View style={[styles.detailCard, { alignItems: 'center', paddingVertical: 16 }]}>
                    <Text style={{ color: '#aaa', fontSize: 13 }}>Aucun inventaire enregistré</Text>
                  </View>
                ) : (
                  <View style={styles.detailCard}>
                    {/* Statut + montant */}
                    <View style={[styles.detailRow, { borderBottomWidth: 1, borderBottomColor: '#eee', paddingBottom: 10, marginBottom: 4 }]}>
                      <View style={[styles.shiftValideBadge, {
                        backgroundColor: shiftDetailData.inventaire.valide ? '#EAF3DE' : '#FAEEDA',
                      }]}>
                        <Text style={{
                          fontSize: 11, fontWeight: '600',
                          color: shiftDetailData.inventaire.valide ? '#3B6D11' : '#854F0B'
                        }}>
                          {shiftDetailData.inventaire.valide ? '🔒 Inventaire verrouillé' : '🔄 En cours'}
                        </Text>
                      </View>
                      {(shiftDetailData.inventaire.montant_a_deduire || 0) > 0 && (
                        <Text style={[styles.detailVal, { color: '#A32D2D', fontWeight: '700' }]}>
                          −{fmt(shiftDetailData.inventaire.montant_a_deduire)}
                        </Text>
                      )}
                    </View>

                    {/* En-tête colonnes */}
                    {(shiftDetailData.inventaire.inventaire_lignes || []).length > 0 && (
                      <View style={styles.invHeaderRow}>
                        <Text style={[styles.invCell, { flex: 2, fontWeight: '700' }]}>Produit</Text>
                        <Text style={[styles.invCellC, { fontWeight: '700' }]}>Init</Text>
                        <Text style={[styles.invCellC, { fontWeight: '700' }]}>Entr.</Text>
                        <Text style={[styles.invCellC, { fontWeight: '700' }]}>Sort.</Text>
                        <Text style={[styles.invCellC, { fontWeight: '700' }]}>Réel</Text>
                        <Text style={[styles.invCellC, { fontWeight: '700' }]}>Écart</Text>
                      </View>
                    )}

                    {(shiftDetailData.inventaire.inventaire_lignes || []).map((l, i, arr) => {
                      const ecart = l.ecart ?? ((l.stock_reel ?? 0) - (l.stock_initial ?? 0))
                      const ecartNeg = ecart < 0
                      return (
                        <View key={l.produit_id || i} style={[
                          styles.invLigneRow,
                          i === arr.length - 1 && { borderBottomWidth: 0 }
                        ]}>
                          <Text style={[styles.invCell, { flex: 2 }]} numberOfLines={1}>
                            {l.produit_nom || l.produit_id}
                          </Text>
                          <Text style={styles.invCellC}>{l.stock_initial ?? '—'}</Text>
                          <Text style={[styles.invCellC, { color: (l.entrees || 0) > 0 ? '#3B6D11' : '#888' }]}>
                            {l.entrees > 0 ? `+${l.entrees}` : (l.entrees ?? '—')}
                          </Text>
                          <Text style={[styles.invCellC, { color: (l.sorties || 0) > 0 ? '#A32D2D' : '#888' }]}>
                            {l.sorties > 0 ? `-${l.sorties}` : (l.sorties ?? '—')}
                          </Text>
                          <Text style={styles.invCellC}>{l.stock_reel ?? '—'}</Text>
                          <Text style={[styles.invCellC, { color: ecartNeg ? '#A32D2D' : ecart > 0 ? '#3B6D11' : '#888', fontWeight: ecart !== 0 ? '600' : '400' }]}>
                            {ecart > 0 ? '+' : ''}{ecart}
                          </Text>
                        </View>
                      )
                    })}

                    {/* Total déduit */}
                    {(shiftDetailData.inventaire.inventaire_lignes || []).some(l => l.montant_deduit > 0) && (
                      <View style={[styles.detailRow, { borderBottomWidth: 0, marginTop: 10, borderTopWidth: 1, borderTopColor: '#eee', paddingTop: 10 }]}>
                        <Text style={[styles.detailLabel, { fontWeight: '700', color: '#1a1a1a' }]}>Total déduit</Text>
                        <Text style={[styles.detailVal, { color: '#A32D2D', fontWeight: '700' }]}>
                          {fmt((shiftDetailData.inventaire.inventaire_lignes || []).reduce((s, l) => s + (l.montant_deduit || 0), 0))}
                        </Text>
                      </View>
                    )}
                  </View>
                )}

                <View style={{ height: 40 }} />
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* Modal photo plein écran */}
      <Modal visible={!!photoPleinEcranUrl} transparent animationType="fade">
        <View style={styles.photoPleinEcranOverlay}>
          <TouchableOpacity
            style={styles.photoPleinEcranClose}
            onPress={() => setPhotoPleinEcranUrl(null)}
          >
            <Text style={styles.photoPleinEcranCloseTxt}>✕</Text>
          </TouchableOpacity>
          {photoPleinEcranUrl && (
            <Image
              source={{ uri: photoPleinEcranUrl }}
              style={styles.photoPleinEcranImg}
              resizeMode="contain"
            />
          )}
        </View>
      </Modal>

      {/* Modal alerte minuit */}
      <Modal visible={modalDate} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitre}>⚠️ Il est après minuit</Text>
            <Text style={styles.modalTxt}>
              Il est {new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}.{'\n'}
              Votre shift sera automatiquement assigné au :
            </Text>
            <Text style={styles.modalDate}>{formatDate(dateShift)}</Text>
            <Text style={styles.modalTxtSub}>
              Vos données seront correctement comptabilisées dans le bon jour.
            </Text>
            <TouchableOpacity style={styles.modalBtn} onPress={() => setModalDate(false)}>
              <Text style={styles.modalBtnTxt}>J'ai compris ✓</Text>
            </TouchableOpacity>
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
  onglets: {
    flexDirection: 'row', backgroundColor: colors.surface,
    borderBottomWidth: 0.5, borderBottomColor: colors.border
  },
  onglet: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  ongletActive: { borderBottomWidth: 2, borderBottomColor: '#EF9F27' },
  ongletTxt: { fontSize: 13, color: colors.textMuted },
  ongletTxtActive: { color: '#EF9F27', fontWeight: '600' },
  body: { flex: 1, padding: 14 },
  loadingBox: { alignItems: 'center', paddingVertical: 40 },
  emptyBox: { alignItems: 'center', paddingVertical: 40 },
  emptyIcon: { fontSize: 50, marginBottom: 12 },
  emptyTxt: { fontSize: 14, color: colors.textMuted, fontWeight: '500' },
  emptySub: { fontSize: 12, color: colors.textPlaceholder, marginTop: 6, textAlign: 'center', paddingHorizontal: 20 },
  totalJourCard: {
    backgroundColor: '#EF9F27', borderRadius: 14, padding: 16,
    marginBottom: 14, alignItems: 'center'
  },
  totalJourTitre: { fontSize: 13, color: '#FAEEDA', marginBottom: 8 },
  totalJourVal: { fontSize: 26, fontWeight: '700', color: '#412402', marginBottom: 4 },
  totalJourSub: { fontSize: 11, color: '#854F0B' },
  cumulCard: {
    backgroundColor: colors.surface, borderRadius: 14, padding: 14,
    marginBottom: 14, borderWidth: 0.5, borderColor: colors.border
  },
  cumulTitre: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: 12 },
  cumulRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 7, borderBottomWidth: 0.5, borderBottomColor: colors.bg
  },
  cumulLabel: { fontSize: 13, color: colors.textMuted },
  cumulVal: { fontSize: 13, fontWeight: '500', color: colors.text },
  infoGerantCard: {
    backgroundColor: '#E6F1FB', borderRadius: 12, padding: 12,
    marginBottom: 14, borderWidth: 0.5, borderColor: '#B8D4F5'
  },
  infoGerantTxt: { fontSize: 12, color: '#185FA5', lineHeight: 18 },
  sectionTitre: {
    fontSize: 12, fontWeight: '600', color: colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, marginTop: 6
  },
  sectionSub: { fontSize: 12, color: colors.textPlaceholder, marginBottom: 10 },
  shiftCard: {
    backgroundColor: colors.surface, borderRadius: 14, padding: 14,
    marginBottom: 10, borderWidth: 0.5, borderColor: colors.border
  },
  shiftHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  shiftNumBox: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#EF9F27', alignItems: 'center', justifyContent: 'center'
  },
  shiftNumTxt: { fontSize: 13, fontWeight: '600', color: '#412402' },
  shiftHeures: { fontSize: 14, fontWeight: '600', color: colors.text },
  shiftCaissier: { fontSize: 11, color: colors.primary, marginTop: 2 },
  shiftDate: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  shiftValideBadge: { backgroundColor: '#EAF3DE', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  shiftValideTxt: { fontSize: 11, color: '#3B6D11', fontWeight: '500' },
  shiftDetails: { borderTopWidth: 0.5, borderTopColor: colors.bg, paddingTop: 10 },
  shiftRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 5, borderBottomWidth: 0.5, borderBottomColor: colors.bg
  },
  shiftLabel: { fontSize: 13, color: colors.textMuted },
  shiftVal: { fontSize: 13, fontWeight: '500', color: colors.text },
  alerteMinuit: {
    backgroundColor: colors.orangeLight, borderRadius: 12, padding: 14,
    marginBottom: 14, borderWidth: 1, borderColor: '#EF9F27'
  },
  alerteMinuitTitre: { fontSize: 14, fontWeight: '600', color: '#854F0B', marginBottom: 6 },
  alerteMinuitTxt: { fontSize: 12, color: '#854F0B', lineHeight: 18 },
  heuresCard: {
    backgroundColor: colors.surface, borderRadius: 14, padding: 14,
    marginBottom: 14, borderWidth: 0.5, borderColor: colors.border
  },
  heureRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: colors.bg
  },
  heureLabel: { fontSize: 13, color: colors.textSecondary, fontWeight: '500' },
  heureBtn: {
    backgroundColor: '#EF9F27', borderRadius: 10,
    paddingHorizontal: 20, paddingVertical: 10, minWidth: 90, alignItems: 'center'
  },
  heureBtnTxt: { fontSize: 18, fontWeight: '700', color: '#412402', letterSpacing: 1 },
  heureBtnPlaceholder: { color: '#FAEEDA' },
  timePickerBox: {
    backgroundColor: colors.surface, borderRadius: 20, padding: 24, width: '100%', maxWidth: 360
  },
  timePickerTitre: { fontSize: 17, fontWeight: '700', color: colors.text, marginBottom: 20, textAlign: 'center' },
  timePickerCols: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 24, gap: 8 },
  timePickerColWrap: { alignItems: 'center', flex: 1 },
  timePickerColLabel: { fontSize: 11, color: colors.textMuted, fontWeight: '600', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  timePickerSep: { fontSize: 32, fontWeight: '700', color: '#EF9F27', marginTop: 20 },
  autoCard: {
    backgroundColor: colors.primaryLight, borderRadius: 14, padding: 14,
    marginBottom: 14, borderWidth: 0.5, borderColor: colors.primaryText
  },
  autoTitre: { fontSize: 13, fontWeight: '600', color: colors.primary, marginBottom: 10 },
  autoRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 6, borderBottomWidth: 0.5, borderBottomColor: colors.primaryText
  },
  autoLabel: { fontSize: 13, color: colors.primary },
  autoVal: { fontSize: 13, fontWeight: '600', color: colors.primaryDark },
  ligneCard: {
    backgroundColor: colors.surface, borderRadius: 14, padding: 14,
    marginBottom: 10, borderWidth: 0.5, borderColor: colors.border
  },
  ligneHeader: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 10
  },
  ligneLabel: { fontSize: 14, fontWeight: '600', color: colors.text },
  ligneInput: {
    backgroundColor: colors.inputBg, borderRadius: 10,
    padding: 12, fontSize: 16, color: colors.text, marginBottom: 8
  },
  ligneNote: { fontSize: 11, color: colors.textMuted, fontStyle: 'italic', marginTop: 4 },
  noPhotoBadge: { backgroundColor: '#EAF3DE', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  noPhotoBadgeTxt: { fontSize: 10, color: '#3B6D11', fontWeight: '500' },
  photoBlock: {
    backgroundColor: colors.surfaceAlt, borderRadius: 10, padding: 10,
    marginTop: 4, borderWidth: 0.5, borderColor: colors.border
  },
  photoBlockRequired: { backgroundColor: '#FAECE7', borderColor: '#F09595' },
  photoHeader: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 8
  },
  photoLabel: { fontSize: 12, color: colors.textSecondary, fontWeight: '500' },
  photoBadgeOk: { backgroundColor: '#EAF3DE', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  photoBadgeOkTxt: { fontSize: 10, color: '#3B6D11', fontWeight: '500' },
  photoBadgeReq: { backgroundColor: '#FAECE7', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  photoBadgeReqTxt: { fontSize: 10, color: '#993C1D', fontWeight: '500' },
  photoPreview: { width: '100%', height: 120, borderRadius: 8, marginBottom: 8 },
  photoBtn: {
    backgroundColor: '#EF9F27', borderRadius: 10,
    padding: 10, alignItems: 'center'
  },
  photoBtnTxt: { fontSize: 13, color: '#412402', fontWeight: '500' },
  venteShiftCard: {
    backgroundColor: '#EF9F27', borderRadius: 14, padding: 16,
    marginBottom: 14, alignItems: 'center'
  },
  venteShiftTitre: { fontSize: 14, fontWeight: '600', color: '#412402', marginBottom: 2 },
  venteShiftSub: { fontSize: 11, color: '#854F0B', marginBottom: 10 },
  venteShiftVal: { fontSize: 30, fontWeight: '700', color: '#412402', marginBottom: 12 },
  calcDetail: {
    backgroundColor: 'rgba(0,0,0,0.08)', borderRadius: 10, padding: 10, width: '100%'
  },
  calcDetailTitre: { fontSize: 11, color: '#412402', fontWeight: '600', marginBottom: 6 },
  calcDetailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  calcDetailLabel: { fontSize: 11, color: '#412402' },
  calcDetailVal: { fontSize: 11, fontWeight: '500', color: '#412402' },
  photosStatut: { borderRadius: 12, padding: 14, marginBottom: 14, borderWidth: 1.5 },
  photosStatutTxt: { fontSize: 13, fontWeight: '600' },
  validerBtn: {
    backgroundColor: '#3B6D11', borderRadius: 14, padding: 16,
    alignItems: 'center', marginBottom: 10
  },
  validerTxt: { fontSize: 15, fontWeight: '600', color: '#fff' },
  validerSub: { fontSize: 11, color: '#C0DD97', marginTop: 4 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
  modal: { backgroundColor: colors.surface, borderRadius: 20, padding: 24, margin: 20, alignItems: 'center' },
  modalTitre: { fontSize: 18, fontWeight: '600', color: '#854F0B', marginBottom: 12 },
  modalTxt: { fontSize: 13, color: colors.textSecondary, textAlign: 'center', lineHeight: 20, marginBottom: 12 },
  modalDate: { fontSize: 20, fontWeight: '700', color: '#EF9F27', marginBottom: 10 },
  modalTxtSub: { fontSize: 12, color: colors.textMuted, textAlign: 'center', lineHeight: 18, marginBottom: 20 },
  modalBtn: { backgroundColor: '#EF9F27', borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12 },
  modalBtnTxt: { fontSize: 14, fontWeight: '600', color: '#412402' },
  confirmOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  confirmBox: { backgroundColor: colors.surface, borderRadius: 18, padding: 24, width: '100%', maxWidth: 380 },
  confirmTitre: { fontSize: 17, fontWeight: '700', color: colors.text, marginBottom: 12 },
  confirmMsg: { fontSize: 14, color: colors.textSecondary, lineHeight: 22, marginBottom: 20 },
  confirmBtns: { flexDirection: 'row', gap: 10 },
  confirmCancel: { flex: 1, padding: 14, borderRadius: 12, backgroundColor: colors.inputBg, alignItems: 'center' },
  confirmCancelTxt: { fontSize: 14, color: colors.textMuted },
  confirmOk: { flex: 1, padding: 14, borderRadius: 12, backgroundColor: '#EF9F27', alignItems: 'center' },
  confirmOkTxt: { fontSize: 14, fontWeight: '600', color: '#fff' },
  selectionBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8,
    paddingHorizontal: 14, paddingVertical: 8,
    backgroundColor: colors.surface, borderBottomWidth: 0.5, borderBottomColor: colors.border,
  },
  selBtnActiver: { backgroundColor: colors.inputBg, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  selBtnActiverTxt: { fontSize: 13, color: colors.text, fontWeight: '500' },
  selBtnTout: { backgroundColor: '#E6F1FB', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  selBtnToutTxt: { fontSize: 13, color: '#185FA5', fontWeight: '500' },
  selBtnAnnuler: { backgroundColor: colors.inputBg, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  selBtnAnnulerTxt: { fontSize: 13, color: colors.textMuted },
  shiftCardSelected: { borderColor: '#EF9F27', borderWidth: 2, backgroundColor: '#FFF8ED' },
  checkbox: {
    width: 24, height: 24, borderRadius: 6, borderWidth: 2,
    borderColor: colors.border, backgroundColor: colors.inputBg,
    alignItems: 'center', justifyContent: 'center', marginRight: 4,
  },
  checkboxSelected: { backgroundColor: '#EF9F27', borderColor: '#EF9F27' },
  checkboxCheck: { fontSize: 14, fontWeight: '700', color: '#fff' },
  supprimerBtn: {
    backgroundColor: '#FAECE7', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 5, borderWidth: 0.5, borderColor: '#F09595',
  },
  supprimerBtnTxt: { fontSize: 11, color: '#A32D2D', fontWeight: '500' },
  barreSuppressionBas: {
    padding: 12, paddingBottom: 20,
    backgroundColor: colors.surface, borderTopWidth: 0.5, borderTopColor: colors.border,
  },
  btnSupprimerSel: {
    backgroundColor: '#A32D2D', borderRadius: 14,
    padding: 16, alignItems: 'center',
  },
  btnSupprimerSelTxt: { fontSize: 15, fontWeight: '600', color: '#fff' },
voirDetailBarre: {
    borderTopWidth: 0.5, borderTopColor: colors.border,
    paddingTop: 10, alignItems: 'center', marginTop: 8,
  },
  voirDetailTxt: { fontSize: 12, color: colors.primary, fontWeight: '500' },
  detailOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end',
  },
  detailModal: {
    backgroundColor: colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    maxHeight: '92%', flex: 0, minHeight: '60%',
  },
  detailHeader: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    padding: 20, paddingBottom: 14,
    backgroundColor: '#EF9F27', borderTopLeftRadius: 24, borderTopRightRadius: 24,
  },
  detailCaissier: { fontSize: 16, fontWeight: '700', color: '#412402', marginBottom: 4 },
  detailHeures: { fontSize: 13, color: '#854F0B', fontWeight: '500' },
  detailDateInline: { fontSize: 12, color: '#854F0B', fontWeight: '400' },
  detailClose: { fontSize: 12, color: '#412402', fontWeight: '600', paddingTop: 2 },
  detailSection: {
    fontSize: 11, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase',
    letterSpacing: 0.5, marginTop: 16, marginBottom: 6, paddingHorizontal: 16,
  },
  detailCard: {
    backgroundColor: colors.surface, marginHorizontal: 12, borderRadius: 14, padding: 14,
    borderWidth: 0.5, borderColor: colors.border,
  },
  detailRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: colors.bg,
  },
  detailLabel: { fontSize: 13, color: colors.textMuted, flex: 1 },
  detailVal: { fontSize: 13, fontWeight: '500', color: colors.text },
  photosGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  photoThumb: { width: 90, alignItems: 'center' },
  photoThumbImg: { width: 90, height: 70, borderRadius: 8, marginBottom: 4 },
  photoThumbLabel: { fontSize: 10, color: colors.textMuted, textAlign: 'center' },
  photoPleinEcranOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.96)',
    justifyContent: 'center', alignItems: 'center',
  },
  photoPleinEcranClose: {
    position: 'absolute', top: 55, right: 20, zIndex: 10,
    backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 20,
    width: 40, height: 40, alignItems: 'center', justifyContent: 'center',
  },
  photoPleinEcranCloseTxt: { fontSize: 20, color: '#fff', fontWeight: '700' },
  photoPleinEcranImg: { width: '100%', height: '80%' },
  invHeaderRow: {
    flexDirection: 'row', paddingVertical: 6,
    borderBottomWidth: 1, borderBottomColor: '#ddd', marginBottom: 4,
  },
  invLigneRow: {
    flexDirection: 'row', paddingVertical: 7,
    borderBottomWidth: 0.5, borderBottomColor: colors.bg, alignItems: 'center',
  },
  invCell: { fontSize: 12, color: colors.text, paddingRight: 4 },
  invCellC: { width: 44, fontSize: 12, color: colors.text, textAlign: 'center' },
}) }