import { router } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
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

function PhotoInput({ label, value, setter, dossier, obligatoire, onGererPhoto, uploading }) {
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
    pointId, restaurantId, roleActif,
    depensesJour, fournisseursJour,
    userId, userNom, resetShift,
    totalDepenses, totalFournisseurs,
  } = useApp()

  const { prendrePhoto, choisirPhoto } = usePhoto()

  const isCaissier = roleActif === 'caissier'
  const isGerant = roleActif === 'gerant'
  const isManager = roleActif === 'manager'

  const _d = lireDraft()
  const [heureDebut, setHeureDebut] = useState(_d?.heureDebut || '')
  const [heureFin, setHeureFin] = useState(_d?.heureFin || '')
  const [dateShift, setDateShift] = useState(() => {
    const now = new Date()
    const heure = now.getHours()
    if (heure >= 0 && heure < 5) {
      const hier = new Date(now)
      hier.setDate(hier.getDate() - 1)
      return hier.toISOString().split('T')[0]
    }
    return now.toISOString().split('T')[0]
  })
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

  const [shiftsGerant, setShiftsGerant] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [vue, setVue] = useState(isCaissier ? 'nouveau' : 'liste')
  const [modalDate, setModalDate] = useState(false)
  const [photoModalVisible, setPhotoModalVisible] = useState(false)
  const [confirmShiftVisible, setConfirmShiftVisible] = useState(false)
  const photoPickerRef = useRef({ setter: null, dossier: '' })

  useEffect(() => {
    if (isGerant || isManager) chargerShiftsGerant()
    else setLoading(false)
    verifierHeure()
  }, [])

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
    setPhotoModalVisible(true)
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
    const { error } = await supabase.from('points_shifts').insert({
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
    })

    if (error) {
      Alert.alert('Erreur', error.message)
      setSaving(false)
      return
    }

    // Supprimer les présences du caissier pour ce point
    // (les dépenses et fournisseurs ont leur propre delete-reinsert)
    await supabase.from('presences').delete().eq('point_id', shiftPointId)

    resetShift()
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

      {(isGerant || isManager) && (
        <View style={styles.onglets}>
          <TouchableOpacity
            style={[styles.onglet, vue === 'liste' && styles.ongletActive]}
            onPress={() => setVue('liste')}
          >
            <Text style={[styles.ongletTxt, vue === 'liste' && styles.ongletTxtActive]}>
              📊 Vue journalière
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.onglet, vue === 'detail' && styles.ongletActive]}
            onPress={() => setVue('detail')}
          >
            <Text style={[styles.ongletTxt, vue === 'detail' && styles.ongletTxtActive]}>
              📋 Détail shifts
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ══════════════════════════════════════════
          CAISSIER — Formulaire
      ══════════════════════════════════════════ */}
      {isCaissier && (
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
              <TextInput
                style={styles.heureInput}
                value={heureDebut}
                onChangeText={setHeureDebut}
                placeholder="08:00"
                placeholderTextColor="#bbb"
                keyboardType="numbers-and-punctuation"
              />
            </View>
            <View style={[styles.heureRow, { borderBottomWidth: 0 }]}>
              <Text style={styles.heureLabel}>Heure de fin</Text>
              <TextInput
                style={styles.heureInput}
                value={heureFin}
                onChangeText={setHeureFin}
                placeholder="16:00"
                placeholderTextColor="#bbb"
                keyboardType="numbers-and-punctuation"
              />
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
      {(isGerant || isManager) && vue === 'liste' && (
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
          GÉRANT — Détail par shift
      ══════════════════════════════════════════ */}
      {(isGerant || isManager) && vue === 'detail' && (
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
            shiftsGerant.map((shift, i) => (
              <View key={shift.id} style={styles.shiftCard}>
                <View style={styles.shiftHeader}>
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
                  <View style={styles.shiftValideBadge}>
                    <Text style={styles.shiftValideTxt}>🔒 Validé</Text>
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
              </View>
            ))
          )}
          <View style={{ height: 40 }} />
        </ScrollView>
      )}

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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: {
    backgroundColor: '#EF9F27', padding: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'
  },
  back: { fontSize: 16, color: '#412402', fontWeight: '500' },
  headerTitre: { fontSize: 16, fontWeight: '600', color: '#412402', textAlign: 'center' },
  headerSub: { fontSize: 11, color: '#854F0B', textAlign: 'center' },
  onglets: {
    flexDirection: 'row', backgroundColor: '#fff',
    borderBottomWidth: 0.5, borderBottomColor: '#eee'
  },
  onglet: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  ongletActive: { borderBottomWidth: 2, borderBottomColor: '#EF9F27' },
  ongletTxt: { fontSize: 13, color: '#888' },
  ongletTxtActive: { color: '#EF9F27', fontWeight: '600' },
  body: { flex: 1, padding: 14 },
  loadingBox: { alignItems: 'center', paddingVertical: 40 },
  emptyBox: { alignItems: 'center', paddingVertical: 40 },
  emptyIcon: { fontSize: 50, marginBottom: 12 },
  emptyTxt: { fontSize: 14, color: '#888', fontWeight: '500' },
  emptySub: { fontSize: 12, color: '#bbb', marginTop: 6, textAlign: 'center', paddingHorizontal: 20 },
  totalJourCard: {
    backgroundColor: '#EF9F27', borderRadius: 14, padding: 16,
    marginBottom: 14, alignItems: 'center'
  },
  totalJourTitre: { fontSize: 13, color: '#FAEEDA', marginBottom: 8 },
  totalJourVal: { fontSize: 26, fontWeight: '700', color: '#412402', marginBottom: 4 },
  totalJourSub: { fontSize: 11, color: '#854F0B' },
  cumulCard: {
    backgroundColor: '#fff', borderRadius: 14, padding: 14,
    marginBottom: 14, borderWidth: 0.5, borderColor: '#eee'
  },
  cumulTitre: { fontSize: 13, fontWeight: '600', color: '#1a1a1a', marginBottom: 12 },
  cumulRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 7, borderBottomWidth: 0.5, borderBottomColor: '#f5f5f5'
  },
  cumulLabel: { fontSize: 13, color: '#888' },
  cumulVal: { fontSize: 13, fontWeight: '500', color: '#1a1a1a' },
  infoGerantCard: {
    backgroundColor: '#E6F1FB', borderRadius: 12, padding: 12,
    marginBottom: 14, borderWidth: 0.5, borderColor: '#B8D4F5'
  },
  infoGerantTxt: { fontSize: 12, color: '#185FA5', lineHeight: 18 },
  sectionTitre: {
    fontSize: 12, fontWeight: '600', color: '#888',
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, marginTop: 6
  },
  sectionSub: { fontSize: 12, color: '#aaa', marginBottom: 10 },
  shiftCard: {
    backgroundColor: '#fff', borderRadius: 14, padding: 14,
    marginBottom: 10, borderWidth: 0.5, borderColor: '#eee'
  },
  shiftHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  shiftNumBox: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#EF9F27', alignItems: 'center', justifyContent: 'center'
  },
  shiftNumTxt: { fontSize: 13, fontWeight: '600', color: '#412402' },
  shiftHeures: { fontSize: 14, fontWeight: '600', color: '#1a1a1a' },
  shiftCaissier: { fontSize: 11, color: '#534AB7', marginTop: 2 },
  shiftDate: { fontSize: 11, color: '#888', marginTop: 2 },
  shiftValideBadge: { backgroundColor: '#EAF3DE', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  shiftValideTxt: { fontSize: 11, color: '#3B6D11', fontWeight: '500' },
  shiftDetails: { borderTopWidth: 0.5, borderTopColor: '#f5f5f5', paddingTop: 10 },
  shiftRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 5, borderBottomWidth: 0.5, borderBottomColor: '#f5f5f5'
  },
  shiftLabel: { fontSize: 13, color: '#888' },
  shiftVal: { fontSize: 13, fontWeight: '500', color: '#1a1a1a' },
  alerteMinuit: {
    backgroundColor: '#FAEEDA', borderRadius: 12, padding: 14,
    marginBottom: 14, borderWidth: 1, borderColor: '#EF9F27'
  },
  alerteMinuitTitre: { fontSize: 14, fontWeight: '600', color: '#854F0B', marginBottom: 6 },
  alerteMinuitTxt: { fontSize: 12, color: '#854F0B', lineHeight: 18 },
  heuresCard: {
    backgroundColor: '#fff', borderRadius: 14, padding: 14,
    marginBottom: 14, borderWidth: 0.5, borderColor: '#eee'
  },
  heureRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: '#f5f5f5'
  },
  heureLabel: { fontSize: 13, color: '#555', fontWeight: '500' },
  heureInput: {
    width: 100, backgroundColor: '#f5f5f5', borderRadius: 8,
    padding: 10, fontSize: 14, color: '#1a1a1a', textAlign: 'center'
  },
  autoCard: {
    backgroundColor: '#EEEDFE', borderRadius: 14, padding: 14,
    marginBottom: 14, borderWidth: 0.5, borderColor: '#CECBF6'
  },
  autoTitre: { fontSize: 13, fontWeight: '600', color: '#534AB7', marginBottom: 10 },
  autoRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 6, borderBottomWidth: 0.5, borderBottomColor: '#CECBF6'
  },
  autoLabel: { fontSize: 13, color: '#534AB7' },
  autoVal: { fontSize: 13, fontWeight: '600', color: '#3C3489' },
  ligneCard: {
    backgroundColor: '#fff', borderRadius: 14, padding: 14,
    marginBottom: 10, borderWidth: 0.5, borderColor: '#eee'
  },
  ligneHeader: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 10
  },
  ligneLabel: { fontSize: 14, fontWeight: '600', color: '#1a1a1a' },
  ligneInput: {
    backgroundColor: '#f5f5f5', borderRadius: 10,
    padding: 12, fontSize: 16, color: '#1a1a1a', marginBottom: 8
  },
  ligneNote: { fontSize: 11, color: '#888', fontStyle: 'italic', marginTop: 4 },
  noPhotoBadge: { backgroundColor: '#EAF3DE', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  noPhotoBadgeTxt: { fontSize: 10, color: '#3B6D11', fontWeight: '500' },
  photoBlock: {
    backgroundColor: '#f9f9f9', borderRadius: 10, padding: 10,
    marginTop: 4, borderWidth: 0.5, borderColor: '#eee'
  },
  photoBlockRequired: { backgroundColor: '#FAECE7', borderColor: '#F09595' },
  photoHeader: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 8
  },
  photoLabel: { fontSize: 12, color: '#555', fontWeight: '500' },
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
  modal: { backgroundColor: '#fff', borderRadius: 20, padding: 24, margin: 20, alignItems: 'center' },
  modalTitre: { fontSize: 18, fontWeight: '600', color: '#854F0B', marginBottom: 12 },
  modalTxt: { fontSize: 13, color: '#555', textAlign: 'center', lineHeight: 20, marginBottom: 12 },
  modalDate: { fontSize: 20, fontWeight: '700', color: '#EF9F27', marginBottom: 10 },
  modalTxtSub: { fontSize: 12, color: '#888', textAlign: 'center', lineHeight: 18, marginBottom: 20 },
  modalBtn: { backgroundColor: '#EF9F27', borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12 },
  modalBtnTxt: { fontSize: 14, fontWeight: '600', color: '#412402' },
  confirmOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  confirmBox: { backgroundColor: '#fff', borderRadius: 18, padding: 24, width: '100%', maxWidth: 380 },
  confirmTitre: { fontSize: 17, fontWeight: '700', color: '#1a1a1a', marginBottom: 12 },
  confirmMsg: { fontSize: 14, color: '#555', lineHeight: 22, marginBottom: 20 },
  confirmBtns: { flexDirection: 'row', gap: 10 },
  confirmCancel: { flex: 1, padding: 14, borderRadius: 12, backgroundColor: '#f5f5f5', alignItems: 'center' },
  confirmCancelTxt: { fontSize: 14, color: '#888' },
  confirmOk: { flex: 1, padding: 14, borderRadius: 12, backgroundColor: '#EF9F27', alignItems: 'center' },
  confirmOkTxt: { fontSize: 14, fontWeight: '600', color: '#fff' },
})