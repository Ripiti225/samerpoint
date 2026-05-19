import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import {
  View, Text, TouchableOpacity, StyleSheet,
  SafeAreaView, ScrollView, ActivityIndicator,
  Modal, Image, Alert, RefreshControl, Dimensions, FlatList,
} from 'react-native'
import { router } from 'expo-router'
import { supabase } from '../lib/supabase'
import { useApp } from '../context/AppContext'
import { genererPdfPoint, genererPdfEcarts } from '../lib/generatePdf'
import { CATEGORIES_INVENTAIRE } from '../lib/constants'
import { useTheme } from '../context/ThemeContext'

const { width: SW } = Dimensions.get('window')

export default function VerificationScreen() {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { userNom, roleActif } = useApp() ?? {}
  const [restaurants, setRestaurants] = useState([])
  const [restoSelectionne, setRestoSelectionne] = useState(null)
  const [points, setPoints] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [pointSelectionne, setPointSelectionne] = useState(null)
  const [modalPoint, setModalPoint] = useState(false)
  const [detailPoint, setDetailPoint] = useState(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [modalPhoto, setModalPhoto] = useState(false)
  const [photoSelectionnee, setPhotoSelectionnee] = useState(null)
  const [validating, setValidating] = useState(false)
  const [generatingPdf, setGeneratingPdf] = useState(false)
  const [onglet, setOnglet] = useState('point')
  const [modalInventaire, setModalInventaire] = useState(false)
  const [detailInventaire, setDetailInventaire] = useState(null)
  const [loadingInventaire, setLoadingInventaire] = useState(false)
  const [generatingEcartsPdf, setGeneratingEcartsPdf] = useState(false)
  // Galerie photos zoom
  const [galeriePhotos, setGaleriePhotos] = useState([])
  const [galerieIndex, setGalerieIndex] = useState(0)
  const [showGalerie, setShowGalerie] = useState(false)
  const galerieRef = useRef(null)
  const [zoomActif, setZoomActif] = useState(false)
  const onViewableItemsChanged = useCallback(({ viewableItems }) => {
    if (viewableItems[0]) setGalerieIndex(viewableItems[0].index)
  }, [])

  useEffect(() => { chargerRestaurants() }, [])

  async function chargerRestaurants() {
    setLoading(true)
    const { data, error } = await supabase.from('restaurants').select('*').order('nom')
    if (error) { setLoading(false); return }
    const restos = data || []
    setRestaurants(restos)
    if (restos.length > 0) {
      setRestoSelectionne(restos[0])
      await chargerPointsResto(restos[0].id)
    }
    setLoading(false)
  }

  async function chargerPointsResto(restoId) {
    if (!restoId) return
    setLoading(true)
    const { data } = await supabase
      .from('points').select('*').eq('restaurant_id', restoId)
      .order('date', { ascending: false }).limit(50)
    setPoints(data || [])
    setLoading(false)
  }

  async function onRefresh() {
    setRefreshing(true)
    if (restoSelectionne) await chargerPointsResto(restoSelectionne.id)
    setRefreshing(false)
  }

  async function changerResto(resto) {
    setRestoSelectionne(resto)
    setPoints([])
    await chargerPointsResto(resto.id)
  }

  async function ouvrirPoint(point) {
    setPointSelectionne(point)
    setLoadingDetail(true)
    setModalPoint(true)
    setDetailPoint(null)

    const [
      { data: sequences },
      { data: depenses },
      { data: fournisseurs },
      { data: shifts },
      { data: presences },
      { data: commandes },
      { data: inventaireRaw },
    ] = await Promise.all([
      supabase.from('sequences').select('*').eq('point_id', point.id).order('numero'),
      supabase.from('depenses').select('*').eq('point_id', point.id),
      supabase.from('transactions_fournisseurs').select('*, fournisseurs(nom)').eq('point_id', point.id),
      supabase.from('points_shifts').select('*').eq('point_id', point.id).order('created_at'),
      supabase.from('presences').select('*').eq('point_id', point.id),
      supabase.from('commandes').select('partenaire, contact_client').eq('point_id', point.id),
      supabase.from('inventaires').select('*, fournisseurs(nom)').eq('point_id', point.id).order('shift_numero'),
    ])

    // Contacts uniques par partenaire
    const contactsParPartenaire = {}
    ;(commandes || []).forEach(c => {
      if (c.contact_client && c.partenaire) {
        contactsParPartenaire[c.partenaire] = (contactsParPartenaire[c.partenaire] || 0) + 1
      }
    })

    // Inventaire groupé par shift
    const invParShift = {}
    ;(inventaireRaw || []).forEach(ligne => {
      const key = ligne.shift_numero
      if (!invParShift[key]) {
        invParShift[key] = { numero: key, nom: ligne.shift_nom, lignes: [] }
      }
      invParShift[key].lignes.push(ligne)
    })

    // Entrées inventaire liées aux fournisseurs (shift 0)
    const invParFournisseur = {}
    ;(inventaireRaw || []).filter(l => l.shift_numero === 0 && l.fournisseur_id).forEach(ligne => {
      if (!invParFournisseur[ligne.fournisseur_id]) invParFournisseur[ligne.fournisseur_id] = []
      invParFournisseur[ligne.fournisseur_id].push(ligne)
    })

    setDetailPoint({
      point,
      sequences: sequences || [],
      depenses: depenses || [],
      fournisseurs: fournisseurs || [],
      shifts: shifts || [],
      presences: presences || [],
      invParFournisseur,
      contactsParPartenaire,
      invShifts: Object.values(invParShift).sort((a, b) => a.numero - b.numero),
    })
    setLoadingDetail(false)
  }

  async function telechargerPdf() {
    if (!detailPoint || !pointSelectionne) return
    setGeneratingPdf(true)
    try {
      const result = await genererPdfPoint(detailPoint, pointSelectionne, restoSelectionne)
      if (result?.success) {
        Alert.alert('✅ PDF téléchargé', `Le point du ${formatDate(pointSelectionne.date)} a été téléchargé.\n\nFichier : ${result.nomFichier}`)
      }
    } catch (err) {
      Alert.alert('Erreur', 'Impossible de générer le PDF : ' + err.message)
    } finally {
      setGeneratingPdf(false)
    }
  }

  async function marquerVerifie(pointId) {
    setValidating(true)
    const { error } = await supabase.from('points').update({
      verifie: true, verifie_par: userNom || roleActif || 'Manager', verifie_at: new Date().toISOString(),
    }).eq('id', pointId)
    if (error) { Alert.alert('Erreur', error.message); setValidating(false); return }
    setValidating(false)
    setModalPoint(false)
    setPoints(prev => prev.map(p => p.id === pointId ? { ...p, verifie: true } : p))
    Alert.alert('✅ Point vérifié !', 'Le point a été marqué comme vérifié avec succès.')
  }

  function fmt(n) { return Math.round(n).toLocaleString('fr-FR') + ' FCFA' }

  function formatDate(dateStr) {
    if (!dateStr) return ''
    const [y, m, d] = dateStr.split('-')
    const mois = ['jan', 'fév', 'mar', 'avr', 'mai', 'juin', 'juil', 'août', 'sep', 'oct', 'nov', 'déc']
    return `${parseInt(d)} ${mois[parseInt(m) - 1]} ${y}`
  }

  function statutPoint(point) {
    if (point.verifie) return { label: '✅ Vérifié', bg: '#EAF3DE', text: '#3B6D11' }
    if (point.valide) return { label: '🔒 Validé', bg: '#E6F1FB', text: '#185FA5' }
    return { label: '⏳ En cours', bg: '#FAEEDA', text: '#854F0B' }
  }

  function photosManquantesPoint(point) {
    const m = []
    if ((point.yango_cse || 0) > 0 && !point.photo_yango_cse) m.push('Yango CSE')
    if ((point.glovo_cse || 0) > 0 && !point.photo_glovo_cse) m.push('Glovo CSE')
    if ((point.wave || 0) > 0 && !point.photo_wave) m.push('Wave')
    if ((point.om || 0) > 0 && !point.photo_om) m.push('Orange Money')
    if ((point.djamo || 0) > 0 && !point.photo_djamo) m.push('Djamo')
    if ((point.yango_tab || 0) > 0 && !point.photo_yango_tab) m.push('Yango TAB')
    if ((point.glovo_tab || 0) > 0 && !point.photo_glovo_tab) m.push('Glovo TAB')
    if ((point.kdo || 0) > 0 && !point.photo_kdo) m.push('KDO')
    if ((point.retour || 0) > 0 && !point.photo_retour) m.push('Retour')
    return m
  }

  async function ouvrirInventaire(point) {
    setPointSelectionne(point)
    setLoadingInventaire(true)
    setModalInventaire(true)
    setDetailInventaire(null)
    const { data } = await supabase.from('inventaires').select('*').eq('point_id', point.id).order('shift_numero')
    const shifts = {}
    ;(data || []).forEach(ligne => {
      const key = ligne.shift_numero
      if (!shifts[key]) {
        shifts[key] = { numero: key, nom: ligne.shift_nom, heure_debut: ligne.heure_debut, heure_fin: ligne.heure_fin, lignes: [] }
      }
      shifts[key].lignes.push(ligne)
    })
    setDetailInventaire(Object.values(shifts).sort((a, b) => a.numero - b.numero))
    setLoadingInventaire(false)
  }

  function voirPhoto(uri, label) {
    if (!uri) return
    setPhotoSelectionnee({ uri, label })
    setModalPhoto(true)
  }

  function getPrixProduit(produitId) {
    for (const cat of CATEGORIES_INVENTAIRE) {
      const prod = cat.produits.find(p => p.id === produitId)
      if (prod) return prod.prix || 0
    }
    return 0
  }

  async function telechargerPdfEcarts(ecartsAvecCalc, totalDeduit) {
    if (!pointSelectionne) return
    setGeneratingEcartsPdf(true)
    try {
      const result = await genererPdfEcarts({
        ecarts: ecartsAvecCalc, totalDeduit,
        point: pointSelectionne, restoNom: restoSelectionne?.nom || 'SAMER',
      })
      if (result?.success) {
        Alert.alert('✅ PDF téléchargé', `Rapport des écarts du ${formatDate(pointSelectionne.date)} téléchargé.\n\nFichier : ${result.nomFichier}`)
      }
    } catch (err) {
      Alert.alert('Erreur', 'Impossible de générer le PDF : ' + err.message)
    } finally {
      setGeneratingEcartsPdf(false)
    }
  }

  // ─── Galerie photos ──────────────────────────────────────────
  function ouvriGalerie(photos, startIndex = 0) {
    if (!photos || photos.length === 0) return
    setGaleriePhotos(photos)
    setGalerieIndex(startIndex)
    setShowGalerie(true)
  }

  function formatAuteur(caissierNom) {
    if (!caissierNom) return null
    const parts = caissierNom.trim().split(' ')
    if (parts.length < 2) return caissierNom
    return parts[0] + ' ' + parts[1][0] + '.'
  }

  function getToutesPhotos() {
    if (!detailPoint) return []
    const photos = []
    detailPoint.sequences.forEach(s => {
      if (s.photo_url) photos.push({ uri: s.photo_url, label: `Séquence ${s.numero}` })
    })
    if (pointSelectionne?.photo_yango_tab) photos.push({ uri: pointSelectionne.photo_yango_tab, label: 'TAB Yango' })
    if (pointSelectionne?.photo_glovo_tab) photos.push({ uri: pointSelectionne.photo_glovo_tab, label: 'TAB Glovo' })
    detailPoint.shifts.forEach((s, i) => {
      if (s.photo_kdo && s.kdo > 0) photos.push({ uri: s.photo_kdo, label: `S${i+1} KDO` })
      if (s.photo_retour && s.retour > 0) photos.push({ uri: s.photo_retour, label: `S${i+1} Retour` })
      if (s.photo_yango_cse && s.yango_cse > 0) photos.push({ uri: s.photo_yango_cse, label: `S${i+1} Yango CSE` })
      if (s.photo_glovo_cse && s.glovo_cse > 0) photos.push({ uri: s.photo_glovo_cse, label: `S${i+1} Glovo CSE` })
      if (s.photo_wave && s.wave > 0) photos.push({ uri: s.photo_wave, label: `S${i+1} Wave` })
      if (s.photo_djamo && s.djamo > 0) photos.push({ uri: s.photo_djamo, label: `S${i+1} Djamo` })
      if (s.photo_om && s.om > 0) photos.push({ uri: s.photo_om, label: `S${i+1} OM` })
    })
    return photos
  }

  // ─── Vignette photo ──────────────────────────────────────────
  function PhotoVignette({ uri, label, montant, onPress }) {
    const aPhoto = !!uri
    return (
      <TouchableOpacity
        style={[styles.photoVignette, !aPhoto && styles.photoVignetteManquante]}
        onPress={() => aPhoto && (onPress ? onPress() : voirPhoto(uri, label))}
        disabled={!aPhoto}
        activeOpacity={aPhoto ? 0.7 : 1}
      >
        {aPhoto ? (
          <Image source={{ uri }} style={styles.photoThumb} resizeMode="cover" />
        ) : (
          <View style={styles.photoAbsente}>
            <Text style={styles.photoAbsenteIcon}>❌</Text>
          </View>
        )}
        <Text style={[styles.photoLabel, !aPhoto && { color: '#993C1D' }]}>
          {aPhoto ? '✅ ' : ''}{label}
        </Text>
        {montant > 0 && <Text style={styles.photoMontant}>{fmt(montant)}</Text>}
        {aPhoto && <Text style={styles.photoTapTxt}>Tap pour voir</Text>}
      </TouchableOpacity>
    )
  }

  // ─── Statut présence badge ────────────────────────────────────
  function statutPresenceBadge(statut) {
    const map = {
      'Présent':    { bg: '#EAF3DE', text: '#3B6D11', icon: '✅' },
      'Absent':     { bg: '#FAECE7', text: '#993C1D', icon: '❌' },
      'Permission': { bg: '#F1EFE8', text: '#444441', icon: '🕐' },
      'Repos':      { bg: '#E6F1FB', text: '#185FA5', icon: '😴' },
      'Congé':      { bg: '#EEEDFE', text: '#3C3489', icon: '🏖️' },
      'Malade':     { bg: '#FAEEDA', text: '#854F0B', icon: '🤒' },
    }
    return map[statut] || { bg: '#f0f0f0', text: '#888', icon: '❓' }
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.replace('/accueil')}>
          <Text style={styles.back}>‹ Retour</Text>
        </TouchableOpacity>
        <View>
          <Text style={styles.headerTitre}>Vérification</Text>
          <Text style={styles.headerSub}>Contrôle des points & photos</Text>
        </View>
        <View style={{ width: 60 }} />
      </View>

      {/* Onglets */}
      <View style={styles.ongletBar}>
        <TouchableOpacity
          style={[styles.ongletBtn, onglet === 'point' && styles.ongletBtnActive]}
          onPress={() => setOnglet('point')}
        >
          <Text style={[styles.ongletTxt, onglet === 'point' && styles.ongletTxtActive]}>📋 Vérification Point</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.ongletBtn, onglet === 'inventaire' && styles.ongletBtnActive]}
          onPress={() => setOnglet('inventaire')}
        >
          <Text style={[styles.ongletTxt, onglet === 'inventaire' && styles.ongletTxtActive]}>📦 Vérification Inventaire</Text>
        </TouchableOpacity>
      </View>

      {/* Sélection restaurant */}
      <ScrollView
        horizontal showsHorizontalScrollIndicator={false}
        style={styles.restoBar} contentContainerStyle={{ paddingHorizontal: 10 }}
      >
        {restaurants.map(r => (
          <TouchableOpacity
            key={r.id}
            style={[styles.restoBtn, restoSelectionne?.id === r.id && styles.restoBtnActive]}
            onPress={() => changerResto(r)}
          >
            <Text style={[styles.restoTxt, restoSelectionne?.id === r.id && styles.restoTxtActive]}>{r.nom}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Stats rapides */}
      {!loading && points.length > 0 && (
        <View style={styles.statsBar}>
          {[
            { val: points.length, label: 'Total', color: '#534AB7' },
            { val: points.filter(p => p.verifie).length, label: 'Vérifiés', color: '#3B6D11' },
            { val: points.filter(p => p.valide && !p.verifie).length, label: 'À vérifier', color: '#185FA5' },
            { val: points.filter(p => !p.valide).length, label: 'En cours', color: '#854F0B' },
          ].map((s, i, arr) => (
            <View key={i} style={{ flex: 1, flexDirection: 'row' }}>
              <View style={styles.statItem}>
                <Text style={[styles.statVal, { color: s.color }]}>{s.val}</Text>
                <Text style={styles.statLabel}>{s.label}</Text>
              </View>
              {i < arr.length - 1 && <View style={styles.statDivider} />}
            </View>
          ))}
        </View>
      )}

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#534AB7" />
          <Text style={styles.loadingTxt}>Chargement des points...</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.body} showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#534AB7" />}
        >
          {points.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyIcon}>🔍</Text>
              <Text style={styles.emptyTxt}>Aucun point pour ce restaurant</Text>
              <Text style={styles.emptySub}>Tirez vers le bas pour rafraîchir</Text>
            </View>
          ) : (
            <>
              {onglet === 'point' && points.filter(p => p.valide && !p.verifie).length > 0 && (
                <View style={styles.prioriteSection}>
                  <Text style={styles.prioriteTitre}>🔔 En attente de vérification</Text>
                  {points.filter(p => p.valide && !p.verifie).map(point => (
                    <TouchableOpacity key={point.id} style={styles.prioriteCard} onPress={() => ouvrirPoint(point)}>
                      <View>
                        <Text style={styles.prioriteDate}>{formatDate(point.date)}</Text>
                        <Text style={styles.prioriteBSC}>BSC : {fmt(point.benefice_sc || 0)}</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={styles.prioriteVentes}>{fmt(point.vente_total || 0)}</Text>
                        <Text style={styles.prioriteVerifier}>Vérifier ›</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <Text style={styles.sectionTitre}>Tous les points</Text>
              {points.map(point => {
                const statut = statutPoint(point)
                const manquantes = photosManquantesPoint(point)
                return (
                  <TouchableOpacity
                    key={point.id}
                    style={[
                      styles.pointCard,
                      point.verifie && styles.pointCardVerifie,
                      point.valide && !point.verifie && styles.pointCardAVerifier,
                      !point.valide && styles.pointCardEnCours,
                    ]}
                    onPress={() => onglet === 'inventaire' ? ouvrirInventaire(point) : ouvrirPoint(point)}
                  >
                    <View style={styles.pointHeader}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.pointDate}>{formatDate(point.date)}</Text>
                        <View style={styles.pointStats}>
                          <Text style={styles.pointStatTxt}>📈 {fmt(point.vente_total || 0)}</Text>
                          <Text style={styles.pointStatTxt}>💳 {fmt(point.depense_total || 0)}</Text>
                          <Text style={[styles.pointStatTxt, { color: '#3B6D11', fontWeight: '600' }]}>
                            BSC: {fmt(point.benefice_sc || 0)}
                          </Text>
                        </View>
                      </View>
                      <View style={{ alignItems: 'flex-end', gap: 6 }}>
                        <View style={[styles.statutBadge, { backgroundColor: statut.bg }]}>
                          <Text style={[styles.statutTxt, { color: statut.text }]}>{statut.label}</Text>
                        </View>
                        {manquantes.length > 0 && (
                          <View style={styles.manquanteBadge}>
                            <Text style={styles.manquanteTxt}>⚠️ {manquantes.length} photo(s)</Text>
                          </View>
                        )}
                      </View>
                    </View>
                    <Text style={styles.voirDetailTxt}>
                      {onglet === 'inventaire' ? "Appuyer pour voir l'inventaire ›" : 'Appuyer pour voir les détails ›'}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </>
          )}
          <View style={{ height: 40 }} />
        </ScrollView>
      )}

      {/* ══════════════════════════════════════════
          MODAL DÉTAIL POINT
      ══════════════════════════════════════════ */}
      <Modal visible={modalPoint} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={{ flex: 1, backgroundColor: '#f5f5f5' }}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setModalPoint(false)}>
              <Text style={styles.modalClose}>✕ Fermer</Text>
            </TouchableOpacity>
            <View style={{ alignItems: 'center' }}>
              <Text style={styles.modalTitre}>{formatDate(pointSelectionne?.date)}</Text>
              <Text style={styles.modalSub}>{restoSelectionne?.nom}</Text>
            </View>
            <View style={{ width: 60 }} />
          </View>

          {loadingDetail ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator size="large" color="#534AB7" />
              <Text style={styles.loadingTxt}>Chargement...</Text>
            </View>
          ) : detailPoint && (
            <ScrollView style={{ padding: 14 }} showsVerticalScrollIndicator={false}>

              {/* Statut */}
              {pointSelectionne?.verifie ? (
                <View style={[styles.verifBanner, { backgroundColor: '#EAF3DE', borderColor: '#3B6D11' }]}>
                  <Text style={[styles.verifBannerTxt, { color: '#3B6D11' }]}>✅ Vérifié par {pointSelectionne.verifie_par}</Text>
                </View>
              ) : pointSelectionne?.valide ? (
                <View style={[styles.verifBanner, { backgroundColor: '#E6F1FB', borderColor: '#185FA5' }]}>
                  <Text style={[styles.verifBannerTxt, { color: '#185FA5' }]}>🔍 Validé — en attente de vérification</Text>
                </View>
              ) : (
                <View style={[styles.verifBanner, { backgroundColor: '#FAEEDA', borderColor: '#EF9F27' }]}>
                  <Text style={[styles.verifBannerTxt, { color: '#854F0B' }]}>⏳ Point en cours — non encore validé</Text>
                </View>
              )}

              {/* ══════════════════════════════════════
                  1. RÉCAPITULATIF FINANCIER
              ══════════════════════════════════════ */}
              {(() => {
                const p = pointSelectionne
                const especeShifts = detailPoint.shifts.reduce((s, sh) => s + (sh.espece || 0), 0)
                const yangoCse = detailPoint.shifts.reduce((s, sh) => s + (sh.yango_cse || 0), 0)
                const glovoCse = detailPoint.shifts.reduce((s, sh) => s + (sh.glovo_cse || 0), 0)
                const yangoTab = p?.yango_tab || 0
                const glovoTab = p?.glovo_tab || 0
                const waveOmDjamo = (p?.wave || 0) + (p?.om || 0) + (p?.djamo || 0)
                const depGerant = p?.depenses_gerant_caisse_total || 0
                const depShifts = (p?.depense_total || 0) - depGerant

                return (
                  <View style={{ marginBottom: 14 }}>
                    <Text style={styles.sectionTitre}>💰 Récapitulatif Financier</Text>
                    <View style={styles.recapCard}>
                      {/* Ventes */}
                      {[
                        { label: 'Yango CSE', val: yangoCse, color: '#EF9F27', show: yangoCse > 0 },
                        { label: 'Yango TAB', val: yangoTab, color: '#EF9F27', show: yangoTab > 0 },
                        { label: 'Glovo CSE', val: glovoCse, color: '#EF9F27', show: glovoCse > 0 },
                        { label: 'Glovo TAB', val: glovoTab, color: '#EF9F27', show: glovoTab > 0 },
                        { label: 'Ventes Wave/OM/Djamo', val: waveOmDjamo, color: '#EF9F27', show: waveOmDjamo > 0 },
                        { label: 'Ventes Espèces', val: especeShifts, color: '#EF9F27', show: especeShifts > 0 },
                      ].filter(r => r.show).map((r, i) => (
                        <View key={i} style={styles.recapRow}>
                          <Text style={styles.recapLabel}>{r.label}</Text>
                          <Text style={[styles.recapVal, { color: r.color }]}>{fmt(r.val)}</Text>
                        </View>
                      ))}
                      <View style={[styles.recapRow, styles.recapRowTotal]}>
                        <Text style={[styles.recapLabel, { fontWeight: '700' }]}>Total Ventes</Text>
                        <Text style={[styles.recapVal, { color: '#EF9F27', fontWeight: '700' }]}>{fmt(p?.vente_total || 0)}</Text>
                      </View>

                      <View style={styles.recapSep} />

                      {/* Dépenses */}
                      {depShifts > 0 && (
                        <View style={styles.recapRow}>
                          <Text style={styles.recapLabel}>Dépenses shifts</Text>
                          <Text style={[styles.recapVal, { color: '#A32D2D' }]}>{fmt(depShifts)}</Text>
                        </View>
                      )}
                      {(() => {
                        const draft = p?.draft_gerant
                        if (!draft && depGerant <= 0) return null
                        const totalFourn = Object.values(draft?.fournisseurs || {}).reduce((s, d) => s + (parseFloat(d?.paye) || 0), 0)
                        const totalMarche = Object.values(draft?.depenses || {}).reduce((s, lignes) =>
                          s + (lignes || []).reduce((ss, l) => ss + (parseFloat(l?.montant) || 0), 0), 0)
                        const totalPaies = (draft?.paies || []).reduce((s, l) => s + (parseFloat(l?.montant) || 0), 0)
                        return (
                          <>
                            {totalFourn > 0 && (
                              <View style={styles.recapRow}>
                                <Text style={styles.recapLabel}>Gérant — Fournisseurs</Text>
                                <Text style={[styles.recapVal, { color: '#A32D2D' }]}>{fmt(totalFourn)}</Text>
                              </View>
                            )}
                            {totalMarche > 0 && (
                              <View style={styles.recapRow}>
                                <Text style={styles.recapLabel}>Gérant — Marché / Dépenses</Text>
                                <Text style={[styles.recapVal, { color: '#A32D2D' }]}>{fmt(totalMarche)}</Text>
                              </View>
                            )}
                            {totalPaies > 0 && (
                              <View style={styles.recapRow}>
                                <Text style={styles.recapLabel}>Gérant — Paies</Text>
                                <Text style={[styles.recapVal, { color: '#A32D2D' }]}>{fmt(totalPaies)}</Text>
                              </View>
                            )}
                            {depGerant > 0 && (totalFourn + totalMarche + totalPaies === 0) && (
                              <View style={styles.recapRow}>
                                <Text style={styles.recapLabel}>Dépenses gérant</Text>
                                <Text style={[styles.recapVal, { color: '#A32D2D' }]}>{fmt(depGerant)}</Text>
                              </View>
                            )}
                          </>
                        )
                      })()}
                      {(p?.fc_compte || 0) > 0 && (
                        <View style={styles.recapRow}>
                          <Text style={styles.recapLabel}>Fond de caisse reçu</Text>
                          <Text style={[styles.recapVal, { color: '#185FA5' }]}>{fmt(p.fc_compte)}</Text>
                        </View>
                      )}
                      <View style={[styles.recapRow, styles.recapRowTotal]}>
                        <Text style={[styles.recapLabel, { fontWeight: '700' }]}>Total Dépenses</Text>
                        <Text style={[styles.recapVal, { color: '#A32D2D', fontWeight: '700' }]}>{fmt(p?.depense_total || 0)}</Text>
                      </View>

                      <View style={styles.recapSep} />

                      {/* Espèces */}
                      <View style={styles.recapRow}>
                        <Text style={styles.recapLabel}>Reste Espèces</Text>
                        <Text style={[styles.recapVal, { color: '#534AB7', fontWeight: '600' }]}>{fmt(p?.reste_especes || 0)}</Text>
                      </View>
                      {(p?.fc_veille || 0) > 0 && (
                        <View style={styles.recapRow}>
                          <Text style={styles.recapLabel}>Fc de la veille</Text>
                          <Text style={[styles.recapVal, { color: '#534AB7' }]}>{fmt(p.fc_veille)}</Text>
                        </View>
                      )}
                      {(p?.fc_compte || 0) > 0 && (
                        <View style={styles.recapRow}>
                          <Text style={styles.recapLabel}>Fc reçu</Text>
                          <Text style={[styles.recapVal, { color: '#534AB7' }]}>{fmt(p.fc_compte)}</Text>
                        </View>
                      )}
                      <View style={[styles.recapRow, styles.recapRowTotal]}>
                        <Text style={[styles.recapLabel, { fontWeight: '700' }]}>Reste + Fc</Text>
                        <Text style={[styles.recapVal, { color: '#534AB7', fontWeight: '700' }]}>{fmt(p?.reste_fc || 0)}</Text>
                      </View>

                      <View style={styles.recapSep} />

                      {/* Bénéfice */}
                      <View style={[styles.recapRow, { borderBottomWidth: 0, paddingVertical: 12 }]}>
                        <Text style={[styles.recapLabel, { fontSize: 14, fontWeight: '700' }]}>Bénéfice SC</Text>
                        <Text style={{ fontSize: 18, fontWeight: '800', color: '#3B6D11' }}>
                          {fmt(p?.benefice_sc || 0)}
                        </Text>
                      </View>
                    </View>
                  </View>
                )
              })()}

              {/* ══════════════════════════════════════
                  2. VENTES PAR CANAL
              ══════════════════════════════════════ */}
              {(() => {
                const p = pointSelectionne
                const yangoCseTotal = detailPoint.shifts.reduce((s, sh) => s + (sh.yango_cse || 0), 0)
                const glovoCseTotal = detailPoint.shifts.reduce((s, sh) => s + (sh.glovo_cse || 0), 0)
                const yangoTab = p?.yango_tab || 0
                const glovoTab = p?.glovo_tab || 0
                const waveTotal = detailPoint.shifts.reduce((s, sh) => s + (sh.wave || 0), 0) || (p?.wave || 0)
                const omTotal = detailPoint.shifts.reduce((s, sh) => s + (sh.om || 0), 0) || (p?.om || 0)
                const djamoTotal = detailPoint.shifts.reduce((s, sh) => s + (sh.djamo || 0), 0) || (p?.djamo || 0)
                const especeShifts = detailPoint.shifts.reduce((s, sh) => s + (sh.espece || 0), 0)
                const yangoContacts = p?.yango_contacts || detailPoint.contactsParPartenaire?.['Yango'] || 0
                const glovoContacts = p?.glovo_contacts || detailPoint.contactsParPartenaire?.['Glovo'] || 0
                const hasYango = yangoCseTotal > 0 || yangoTab > 0
                const hasGlovo = glovoCseTotal > 0 || glovoTab > 0
                const hasAutres = waveTotal > 0 || omTotal > 0 || djamoTotal > 0 || especeShifts > 0
                const toutes = getToutesPhotos()

                const yangoCSEPhotos = detailPoint.shifts
                  .map((s, i) => ({ uri: s.photo_yango_cse, label: `Yango CSE S${i + 1}`, montant: s.yango_cse, show: (s.yango_cse || 0) > 0 }))
                  .filter(x => x.show)
                const glovoCSEPhotos = detailPoint.shifts
                  .map((s, i) => ({ uri: s.photo_glovo_cse, label: `Glovo CSE S${i + 1}`, montant: s.glovo_cse, show: (s.glovo_cse || 0) > 0 }))
                  .filter(x => x.show)

                return (
                  <View style={{ marginBottom: 14 }}>
                    <Text style={styles.sectionTitre}>🛵 Ventes par canal</Text>

                    {/* YANGO */}
                    {hasYango && (
                      <View style={styles.canalCard}>
                        <Text style={styles.canalNom}>🛵 YANGO</Text>

                        {/* Yango CSE */}
                        {yangoCseTotal > 0 && (
                          <>
                            <View style={styles.canalRow}>
                              <Text style={styles.canalLabel}>Yango CSE (shifts)</Text>
                              <Text style={styles.canalVal}>{fmt(yangoCseTotal)}</Text>
                            </View>
                            {yangoCSEPhotos.length > 0 ? yangoCSEPhotos.map((photo, i) => (
                              photo.uri ? (
                                <TouchableOpacity key={i} style={styles.canalPhotoTouchable}
                                  onPress={() => { const idx = toutes.findIndex(x => x.uri === photo.uri); ouvriGalerie(toutes, idx >= 0 ? idx : 0) }}>
                                  <Image source={{ uri: photo.uri }} style={styles.canalPhotoMini} resizeMode="cover" />
                                  <Text style={styles.canalPhotoLabel}>📷 {photo.label} — Tap pour agrandir</Text>
                                </TouchableOpacity>
                              ) : <Text key={i} style={styles.aucunePhoto}>Aucune photo CSE enregistrée</Text>
                            )) : <Text style={styles.aucunePhoto}>Aucune photo CSE enregistrée</Text>}
                          </>
                        )}

                        {/* Yango TAB */}
                        {yangoTab > 0 && (
                          <>
                            <View style={[styles.canalRow, yangoCseTotal > 0 && { marginTop: 8, borderTopWidth: 0.5, borderTopColor: '#eee', paddingTop: 8 }]}>
                              <Text style={styles.canalLabel}>Yango TAB</Text>
                              <Text style={styles.canalVal}>{fmt(yangoTab)}</Text>
                            </View>
                            {p?.photo_yango_tab ? (
                              <TouchableOpacity style={styles.canalPhotoTouchable}
                                onPress={() => { const idx = toutes.findIndex(x => x.uri === p.photo_yango_tab); ouvriGalerie(toutes, idx >= 0 ? idx : 0) }}>
                                <Image source={{ uri: p.photo_yango_tab }} style={styles.canalPhotoMini} resizeMode="cover" />
                                <Text style={styles.canalPhotoLabel}>📷 Photo TAB Yango — Tap pour agrandir</Text>
                              </TouchableOpacity>
                            ) : <Text style={styles.aucunePhoto}>Aucune photo TAB enregistrée</Text>}
                          </>
                        )}

                        {(p?.yango_nb_commandes || 0) > 0 && (
                          <View style={styles.canalRow}>
                            <Text style={styles.canalLabel}>Nombre de commandes</Text>
                            <Text style={styles.canalVal}>{p.yango_nb_commandes} cmd</Text>
                          </View>
                        )}
                        {yangoContacts > 0 && (
                          <View style={styles.canalRow}>
                            <Text style={styles.canalLabel}>Contacts pris</Text>
                            <Text style={styles.canalVal}>{yangoContacts} contacts</Text>
                          </View>
                        )}
                      </View>
                    )}

                    {/* GLOVO */}
                    {hasGlovo && (
                      <View style={[styles.canalCard, { borderLeftColor: '#F0C020' }]}>
                        <Text style={[styles.canalNom, { color: '#B8960C' }]}>🟡 GLOVO</Text>

                        {/* Glovo CSE */}
                        {glovoCseTotal > 0 && (
                          <>
                            <View style={styles.canalRow}>
                              <Text style={styles.canalLabel}>Glovo CSE (shifts)</Text>
                              <Text style={styles.canalVal}>{fmt(glovoCseTotal)}</Text>
                            </View>
                            {glovoCSEPhotos.length > 0 ? glovoCSEPhotos.map((photo, i) => (
                              photo.uri ? (
                                <TouchableOpacity key={i} style={styles.canalPhotoTouchable}
                                  onPress={() => { const idx = toutes.findIndex(x => x.uri === photo.uri); ouvriGalerie(toutes, idx >= 0 ? idx : 0) }}>
                                  <Image source={{ uri: photo.uri }} style={styles.canalPhotoMini} resizeMode="cover" />
                                  <Text style={styles.canalPhotoLabel}>📷 {photo.label} — Tap pour agrandir</Text>
                                </TouchableOpacity>
                              ) : <Text key={i} style={styles.aucunePhoto}>Aucune photo CSE enregistrée</Text>
                            )) : <Text style={styles.aucunePhoto}>Aucune photo CSE enregistrée</Text>}
                          </>
                        )}

                        {/* Glovo TAB */}
                        {glovoTab > 0 && (
                          <>
                            <View style={[styles.canalRow, glovoCseTotal > 0 && { marginTop: 8, borderTopWidth: 0.5, borderTopColor: '#eee', paddingTop: 8 }]}>
                              <Text style={styles.canalLabel}>Glovo TAB</Text>
                              <Text style={styles.canalVal}>{fmt(glovoTab)}</Text>
                            </View>
                            {p?.photo_glovo_tab ? (
                              <TouchableOpacity style={styles.canalPhotoTouchable}
                                onPress={() => { const idx = toutes.findIndex(x => x.uri === p.photo_glovo_tab); ouvriGalerie(toutes, idx >= 0 ? idx : 0) }}>
                                <Image source={{ uri: p.photo_glovo_tab }} style={styles.canalPhotoMini} resizeMode="cover" />
                                <Text style={styles.canalPhotoLabel}>📷 Photo TAB Glovo — Tap pour agrandir</Text>
                              </TouchableOpacity>
                            ) : <Text style={styles.aucunePhoto}>Aucune photo TAB enregistrée</Text>}
                          </>
                        )}

                        {(p?.glovo_nb_commandes || 0) > 0 && (
                          <View style={styles.canalRow}>
                            <Text style={styles.canalLabel}>Nombre de commandes</Text>
                            <Text style={styles.canalVal}>{p.glovo_nb_commandes} cmd</Text>
                          </View>
                        )}
                        {glovoContacts > 0 && (
                          <View style={styles.canalRow}>
                            <Text style={styles.canalLabel}>Contacts pris</Text>
                            <Text style={styles.canalVal}>{glovoContacts} contacts</Text>
                          </View>
                        )}
                      </View>
                    )}

                    {/* Autres canaux */}
                    {hasAutres && (
                      <View style={[styles.canalCard, { borderLeftColor: '#185FA5' }]}>
                        <Text style={styles.canalAutresTitre}>AUTRES CANAUX</Text>
                        {waveTotal > 0 && <View style={styles.canalRow}><Text style={styles.canalLabel}>Wave</Text><Text style={styles.canalVal}>{fmt(waveTotal)}</Text></View>}
                        {omTotal > 0 && <View style={styles.canalRow}><Text style={styles.canalLabel}>Orange Money</Text><Text style={styles.canalVal}>{fmt(omTotal)}</Text></View>}
                        {djamoTotal > 0 && <View style={styles.canalRow}><Text style={styles.canalLabel}>Djamo</Text><Text style={styles.canalVal}>{fmt(djamoTotal)}</Text></View>}
                        {especeShifts > 0 && <View style={styles.canalRow}><Text style={styles.canalLabel}>Espèces</Text><Text style={styles.canalVal}>{fmt(especeShifts)}</Text></View>}
                      </View>
                    )}

                    {!hasYango && !hasGlovo && !hasAutres && (
                      <View style={styles.emptySection}>
                        <Text style={styles.emptySectionTxt}>Aucune donnée enregistrée</Text>
                      </View>
                    )}
                  </View>
                )
              })()}

              {/* ══════════════════════════════════════
                  2.5 VENTE MACHINE
              ══════════════════════════════════════ */}
              {(() => {
                const p = pointSelectionne
                const venteMachine = p?.vente_machine
                const venteTheo = detailPoint.shifts.reduce((s, sh) => s + (sh.vente_shift || 0), 0)
                if (venteMachine == null && !p?.explication_ecart_machine) return null
                const ecart = venteMachine != null ? venteTheo - venteMachine : null
                return (
                  <View style={{ marginBottom: 14 }}>
                    <Text style={styles.sectionTitre}>📊 Vente machine</Text>
                    <View style={styles.recapCard}>
                      <View style={styles.recapRow}>
                        <Text style={styles.recapLabel}>Vente théorique (shifts)</Text>
                        <Text style={styles.recapVal}>{fmt(venteTheo)}</Text>
                      </View>
                      {venteMachine != null && (
                        <View style={styles.recapRow}>
                          <Text style={styles.recapLabel}>Vente machine</Text>
                          <Text style={styles.recapVal}>{fmt(venteMachine)}</Text>
                        </View>
                      )}
                      {ecart != null && (
                        <View style={[styles.recapRow, {
                          backgroundColor: ecart === 0 ? '#EAF3DE' : '#FAEEDA',
                          borderRadius: 8, paddingHorizontal: 10, marginTop: 4
                        }]}>
                          <Text style={[styles.recapLabel, { color: ecart === 0 ? '#3B6D11' : '#854F0B' }]}>
                            {ecart === 0 ? '✅ Aucun écart' : '⚠️ Écart'}
                          </Text>
                          {ecart !== 0 && (
                            <Text style={[styles.recapVal, { color: '#A32D2D', fontWeight: '700' }]}>
                              {ecart >= 0 ? '+' : ''}{fmt(ecart)}
                            </Text>
                          )}
                        </View>
                      )}
                      {p?.explication_ecart_machine ? (
                        <View style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 0.5, borderTopColor: '#ddd' }}>
                          <Text style={[styles.recapLabel, { marginBottom: 6 }]}>📝 Explication :</Text>
                          <Text style={{ fontSize: 13, color: '#444', fontStyle: 'italic', lineHeight: 19 }}>
                            "{p.explication_ecart_machine}"
                          </Text>
                        </View>
                      ) : ecart != null && ecart !== 0 ? (
                        <View style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 0.5, borderTopColor: '#ddd' }}>
                          <Text style={{ fontSize: 12, color: '#A32D2D', fontWeight: '600' }}>
                            ⚠️ Aucune explication fournie
                          </Text>
                        </View>
                      ) : null}
                      {p?.photo_vente_machine ? (
                        <TouchableOpacity
                          style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 0.5, borderTopColor: '#ddd' }}
                          onPress={() => ouvriGalerie([{ uri: p.photo_vente_machine, label: 'Vente machine' }])}
                          activeOpacity={0.85}
                        >
                          <Text style={[styles.recapLabel, { marginBottom: 8 }]}>📷 Photo vente machine :</Text>
                          <Image
                            source={{ uri: p.photo_vente_machine }}
                            style={{ width: '100%', height: 180, borderRadius: 10, resizeMode: 'cover' }}
                          />
                          <Text style={{ fontSize: 11, color: '#888', textAlign: 'center', marginTop: 6 }}>
                            Appuyer pour agrandir
                          </Text>
                        </TouchableOpacity>
                      ) : (
                        <View style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 0.5, borderTopColor: '#ddd' }}>
                          <Text style={{ fontSize: 12, color: '#aaa' }}>📷 Aucune photo de caisse enregistrée</Text>
                        </View>
                      )}
                    </View>
                  </View>
                )
              })()}

              {/* ══════════════════════════════════════
                  3. DÉDUCTIONS GÉRANT
              ══════════════════════════════════════ */}
              {(() => {
                const fourGerant = detailPoint.fournisseurs.filter(f => f.saisi_par === 'gerant')
                const depGerant = detailPoint.depenses.filter(d => d.saisi_par === 'gerant')
                const totalFourGerant = fourGerant.reduce((s, f) => s + (f.paye || 0), 0)
                const totalDepGerant = depGerant.reduce((s, d) => s + (d.montant || 0), 0)
                const totalGerant = totalFourGerant + totalDepGerant
                return (
                  <View style={{ marginBottom: 14 }}>
                    <Text style={styles.sectionTitre}>💳 Déductions Gérant</Text>

                    {/* Fournisseurs gérant */}
                    <Text style={styles.listSubTitre}>💼 Fournisseurs</Text>
                    {fourGerant.length === 0 ? (
                      <View style={styles.emptySection}>
                        <Text style={styles.emptySectionTxt}>Aucune dépense enregistrée</Text>
                      </View>
                    ) : (
                      <View style={[styles.listCard, { marginBottom: 8 }]}>
                        {fourGerant.map((f, i) => (
                          <View key={i} style={[styles.listRow, i === fourGerant.length - 1 && { borderBottomWidth: 0 }]}>
                            <View style={styles.listLeft}>
                              <Text style={styles.listLabel}>{f.fournisseurs?.nom || 'Fournisseur'}</Text>
                              {(f.facture || 0) > 0 && <Text style={styles.listSub}>Facture: {fmt(f.facture)}</Text>}
                              {(f.reste || 0) > 0 && <Text style={[styles.listSub, { color: '#A32D2D' }]}>Reste: {fmt(f.reste)}</Text>}
                            </View>
                            <View style={styles.listRight}>
                              <View style={{ alignItems: 'flex-end' }}>
                                <Text style={[styles.listVal, { color: '#A32D2D' }]}>{fmt(f.paye || 0)}</Text>
                                <Text style={styles.listAuteur}>{f.caissier_nom || 'Gérant'}</Text>
                              </View>
                              {f.photo_url && (
                                <TouchableOpacity onPress={() => voirPhoto(f.photo_url, f.fournisseurs?.nom)}>
                                  <Image source={{ uri: f.photo_url }} style={styles.miniThumb} resizeMode="cover" />
                                </TouchableOpacity>
                              )}
                            </View>
                          </View>
                        ))}
                        <View style={styles.listTotalRow}>
                          <Text style={styles.listTotalLabel}>Sous-total fournisseurs</Text>
                          <Text style={[styles.listTotalVal, { color: '#A32D2D' }]}>{fmt(totalFourGerant)}</Text>
                        </View>
                      </View>
                    )}

                    {/* Dépenses gérant (marché, etc.) */}
                    <Text style={styles.listSubTitre}>🛒 Marché & Autres Dépenses</Text>
                    {depGerant.length === 0 ? (
                      <View style={styles.emptySection}>
                        <Text style={styles.emptySectionTxt}>Aucune dépense enregistrée</Text>
                      </View>
                    ) : (
                      <View style={[styles.listCard, { marginBottom: 8 }]}>
                        {depGerant.map((d, i) => (
                          <View key={i} style={[styles.listRow, i === depGerant.length - 1 && { borderBottomWidth: 0 }]}>
                            <View style={styles.listLeft}>
                              <Text style={styles.listLabel}>{d.libelle || 'Sans nom'}</Text>
                              <Text style={styles.listSub}>{d.categorie}</Text>
                            </View>
                            <View style={{ alignItems: 'flex-end' }}>
                              <Text style={[styles.listVal, { color: '#A32D2D' }]}>{fmt(d.montant || 0)}</Text>
                              <Text style={styles.listAuteur}>{d.caissier_nom || 'Gérant'}</Text>
                            </View>
                          </View>
                        ))}
                        <View style={styles.listTotalRow}>
                          <Text style={styles.listTotalLabel}>Sous-total dépenses</Text>
                          <Text style={[styles.listTotalVal, { color: '#A32D2D' }]}>{fmt(totalDepGerant)}</Text>
                        </View>
                      </View>
                    )}

                    {/* Total général gérant */}
                    {totalGerant > 0 && (
                      <View style={[styles.listCard, { backgroundColor: '#FAECE7', borderColor: '#F09595' }]}>
                        <View style={[styles.listRow, { borderBottomWidth: 0, paddingVertical: 6 }]}>
                          <Text style={[styles.listTotalLabel, { color: '#993C1D', fontSize: 13 }]}>💳 TOTAL DÉDUCTIONS GÉRANT</Text>
                          <Text style={[styles.listTotalVal, { color: '#A32D2D', fontSize: 16 }]}>{fmt(totalGerant)}</Text>
                        </View>
                      </View>
                    )}
                  </View>
                )
              })()}

              {/* ══════════════════════════════════════
                  4. FOURNISSEURS CAISSIERS
              ══════════════════════════════════════ */}
              {(() => {
                const fourCaissier = detailPoint.fournisseurs.filter(f => f.saisi_par !== 'gerant')
                return (
                  <View style={{ marginBottom: 14 }}>
                    <Text style={styles.sectionTitre}>🧾 Fournisseurs caissiers ({fourCaissier.length})</Text>
                    {fourCaissier.length === 0 ? (
                      <View style={styles.emptySection}>
                        <Text style={styles.emptySectionTxt}>Aucune donnée enregistrée</Text>
                      </View>
                    ) : (
                      <View style={styles.listCard}>
                        {fourCaissier.map((f, i) => (
                          <View key={i} style={[styles.listRow, i === fourCaissier.length - 1 && { borderBottomWidth: 0 }]}>
                            <View style={styles.listLeft}>
                              <Text style={styles.listLabel}>{f.fournisseurs?.nom || 'Fournisseur'}</Text>
                              <Text style={styles.listSub}>
                                Facture: {fmt(f.facture || 0)} — Payé: {fmt(f.paye || 0)}
                              </Text>
                              {(f.reste || 0) > 0 && (
                                <Text style={[styles.listSub, { color: '#A32D2D' }]}>Reste: {fmt(f.reste)}</Text>
                              )}
                              {detailPoint.invParFournisseur[f.fournisseur_id]?.length > 0 && (
                                <Text style={[styles.listSub, { color: '#3B6D11', marginTop: 2 }]}>
                                  📦 {detailPoint.invParFournisseur[f.fournisseur_id].map(l => `${l.produit_nom} — ${l.entrees}`).join(' / ')}
                                </Text>
                              )}
                            </View>
                            <View style={styles.listRight}>
                              <View style={{ alignItems: 'flex-end' }}>
                                <Text style={[styles.listVal, { color: (f.reste || 0) > 0 ? '#A32D2D' : '#3B6D11' }]}>
                                  {fmt(f.paye || 0)}
                                </Text>
                                <Text style={styles.listAuteur}>{f.caissier_nom || 'Caissier'}</Text>
                              </View>
                              {f.photo_url && (
                                <TouchableOpacity onPress={() => voirPhoto(f.photo_url, f.fournisseurs?.nom)}>
                                  <Image source={{ uri: f.photo_url }} style={styles.miniThumb} resizeMode="cover" />
                                </TouchableOpacity>
                              )}
                            </View>
                          </View>
                        ))}
                        <View style={styles.listTotalRow}>
                          <Text style={styles.listTotalLabel}>Total payé</Text>
                          <Text style={styles.listTotalVal}>{fmt(fourCaissier.reduce((s, f) => s + (f.paye || 0), 0))}</Text>
                        </View>
                      </View>
                    )}
                  </View>
                )
              })()}

              {/* ══════════════════════════════════════
                  4.5 DÉPENSES CAISSIERS
              ══════════════════════════════════════ */}
              {(() => {
                const depCaissier = detailPoint.depenses.filter(d => d.saisi_par !== 'gerant')
                if (depCaissier.length === 0) return null
                const total = depCaissier.reduce((s, d) => s + (d.montant || 0), 0)
                return (
                  <View style={{ marginBottom: 14 }}>
                    <Text style={styles.sectionTitre}>🧾 Dépenses caissiers ({depCaissier.length})</Text>
                    <View style={styles.listCard}>
                      {depCaissier.map((d, i) => (
                        <View key={i} style={[styles.listRow, i === depCaissier.length - 1 && { borderBottomWidth: 0 }]}>
                          <View style={styles.listLeft}>
                            <Text style={styles.listLabel}>{d.libelle || 'Sans nom'}</Text>
                            <Text style={styles.listSub}>{d.categorie}</Text>
                          </View>
                          <View style={{ alignItems: 'flex-end' }}>
                            <Text style={[styles.listVal, { color: '#A32D2D' }]}>{fmt(d.montant || 0)}</Text>
                            <Text style={styles.listAuteur}>{d.caissier_nom || 'Caissier'}</Text>
                          </View>
                        </View>
                      ))}
                      <View style={styles.listTotalRow}>
                        <Text style={styles.listTotalLabel}>Total dépenses caissiers</Text>
                        <Text style={[styles.listTotalVal, { color: '#A32D2D' }]}>{fmt(total)}</Text>
                      </View>
                    </View>
                  </View>
                )
              })()}

              {/* ══════════════════════════════════════
                  5. PRÉSENCES & PAIES
              ══════════════════════════════════════ */}
              <View style={{ marginBottom: 14 }}>
                <Text style={styles.sectionTitre}>👥 Présences & Paies ({detailPoint.presences.length})</Text>
                {detailPoint.presences.length === 0 ? (
                  <View style={styles.emptySection}>
                    <Text style={styles.emptySectionTxt}>Aucune donnée enregistrée</Text>
                  </View>
                ) : (
                  <View style={styles.listCard}>
                    {detailPoint.presences.map((p, i) => {
                      const badge = statutPresenceBadge(p.statut)
                      return (
                        <View key={i} style={[styles.listRow, i === detailPoint.presences.length - 1 && { borderBottomWidth: 0 }]}>
                          <View style={styles.listLeft}>
                            <Text style={styles.listLabel}>{p.travailleur_nom}</Text>
                            {p.shift_nom && (
                              <Text style={styles.listSub}>⏰ {p.shift_nom}{p.heure_debut ? ` · ${p.heure_debut}→${p.heure_fin}` : ''}</Text>
                            )}
                            <View style={[styles.statutPresenceBadge, { backgroundColor: badge.bg }]}>
                              <Text style={[styles.statutPresenceTxt, { color: badge.text }]}>
                                {badge.icon} {p.statut}
                              </Text>
                            </View>
                          </View>
                          <Text style={styles.listVal}>{p.paye > 0 ? fmt(p.paye) : '—'}</Text>
                        </View>
                      )
                    })}
                    <View style={styles.listTotalRow}>
                      <Text style={styles.listTotalLabel}>Total paie</Text>
                      <Text style={styles.listTotalVal}>{fmt(detailPoint.presences.reduce((s, p) => s + (p.paye || 0), 0))}</Text>
                    </View>
                  </View>
                )}
              </View>

              {/* ══════════════════════════════════════
                  6. INVENTAIRE
              ══════════════════════════════════════ */}
              <View style={{ marginBottom: 14 }}>
                <Text style={styles.sectionTitre}>📦 Inventaire</Text>
                {detailPoint.invShifts.length === 0 ? (
                  <View style={styles.emptySection}>
                    <Text style={styles.emptySectionTxt}>Aucune donnée enregistrée</Text>
                  </View>
                ) : detailPoint.invShifts.map((shift, si) => (
                  <View key={si} style={styles.invShiftCard}>
                    <View style={styles.invShiftHeader}>
                      <View style={styles.invShiftBadge}>
                        <Text style={styles.invShiftBadgeTxt}>{shift.numero === 0 ? '🚚' : `S${shift.numero}`}</Text>
                      </View>
                      <Text style={styles.invShiftNom}>{shift.nom || (shift.numero === 0 ? 'Livraisons fournisseurs' : `Shift ${shift.numero}`)}</Text>
                    </View>
                    {shift.lignes.map((ligne, li) => {
                      const ecart = ligne.stock_final - (ligne.stock_initial + ligne.entrees - ligne.sorties)
                      const hasEcart = shift.numero !== 0 && Math.abs(ecart) > 0.01
                      const source = ligne.fournisseur_id
                        ? `📦 Via fournisseur : ${ligne.fournisseurs?.nom || '—'}`
                        : (ligne.entrees > 0 ? '📥 Entrée directe' : null)
                      return (
                        <View key={li} style={[styles.invLigneRow, hasEcart && styles.invLigneRowAlert]}>
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.invLigneNom, hasEcart && { color: '#A32D2D' }]}>{ligne.produit_nom}</Text>
                            {shift.numero === 0 ? (
                              source && <Text style={styles.invLigneSub}>{source} — Qté: {ligne.entrees}</Text>
                            ) : (
                              <Text style={styles.invLigneSub}>
                                Init: {ligne.stock_initial} | +{ligne.entrees} | -{ligne.sorties} | Final: {ligne.stock_final}
                              </Text>
                            )}
                            {hasEcart && ligne.explication_ecart && (
                              <Text style={[styles.invLigneSub, { color: '#A32D2D' }]}>
                                Explication : {ligne.explication_ecart}
                              </Text>
                            )}
                          </View>
                          {shift.numero !== 0 && (
                            <View style={[styles.invEcartBadge, { backgroundColor: hasEcart ? '#FCEBEB' : '#EAF3DE' }]}>
                              {hasEcart
                                ? <Text style={[styles.invEcartTxt, { color: '#A32D2D' }]}>⚠️ Écart</Text>
                                : <Text style={[styles.invEcartTxt, { color: '#3B6D11' }]}>✅</Text>
                              }
                            </View>
                          )}
                        </View>
                      )
                    })}
                  </View>
                ))}
              </View>

              {/* ══════════════════════════════════════
                  7. SHIFTS CAISSIERS (détail photos)
              ══════════════════════════════════════ */}
              {detailPoint.shifts.length > 0 && (
                <View style={{ marginBottom: 14 }}>
                  <Text style={styles.sectionTitre}>⏱️ Shifts caissiers ({detailPoint.shifts.length})</Text>
                  {detailPoint.shifts.map((shift, i) => {
                    const toutes = getToutesPhotos()
                    const photosShift = [
                      { uri: shift.photo_kdo, label: 'KDO', val: shift.kdo },
                      { uri: shift.photo_retour, label: 'Retour', val: shift.retour },
                      { uri: shift.photo_yango_cse, label: 'Yango CSE', val: shift.yango_cse },
                      { uri: shift.photo_glovo_cse, label: 'Glovo CSE', val: shift.glovo_cse },
                      { uri: shift.photo_wave, label: 'Wave', val: shift.wave },
                      { uri: shift.photo_djamo, label: 'Djamo', val: shift.djamo },
                      { uri: shift.photo_om, label: 'OM', val: shift.om },
                    ].filter(p => (p.val || 0) > 0)
                    return (
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
                        <View style={styles.shiftDonnees}>
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
                          ].filter(r => (r.val || 0) > 0).map((r, j) => (
                            <View key={j} style={styles.shiftRow}>
                              <Text style={styles.shiftLabel}>{r.label}</Text>
                              <Text style={styles.shiftVal}>{fmt(r.val)}</Text>
                            </View>
                          ))}
                        </View>
                        {photosShift.length > 0 && (
                          <>
                            <Text style={styles.photosShiftTitre}>📷 Photos justificatives</Text>
                            <View style={styles.photosGrid}>
                              {photosShift.map((p, j) => {
                                const idx = toutes.findIndex(x => x.uri === p.uri)
                                return (
                                  <PhotoVignette
                                    key={j} uri={p.uri} label={p.label} montant={p.val}
                                    onPress={p.uri ? () => ouvriGalerie(toutes, idx >= 0 ? idx : 0) : undefined}
                                  />
                                )
                              })}
                            </View>
                          </>
                        )}
                      </View>
                    )
                  })}
                </View>
              )}

              {/* ══════════════════════════════════════
                  8. PHOTOS GÉNÉRALES (séquences)
              ══════════════════════════════════════ */}
              <View style={{ marginBottom: 14 }}>
                <Text style={styles.sectionTitre}>📷 Photos générales</Text>
                {detailPoint.sequences.filter(s => s.photo_url).length === 0 ? (
                  <View style={styles.emptySection}>
                    <Text style={styles.emptySectionTxt}>Aucune photo enregistrée</Text>
                  </View>
                ) : (
                  <View style={styles.photosGrid}>
                    {detailPoint.sequences.filter(s => s.photo_url).map((s, i) => {
                      const toutes = getToutesPhotos()
                      const idx = toutes.findIndex(x => x.uri === s.photo_url)
                      return (
                        <PhotoVignette
                          key={i}
                          uri={s.photo_url}
                          label={`Séq. ${s.numero}`}
                          montant={s.montant || 0}
                          onPress={() => ouvriGalerie(toutes, idx >= 0 ? idx : 0)}
                        />
                      )
                    })}
                  </View>
                )}
              </View>

              {/* Bouton vérifier */}
              {!pointSelectionne?.verifie && pointSelectionne?.valide && (
                <TouchableOpacity
                  style={[styles.verifierBtn, validating && { opacity: 0.6 }]}
                  onPress={() => Alert.alert(
                    '✅ Confirmer la vérification',
                    `Vous confirmez avoir vérifié toutes les données et photos du point du ${formatDate(pointSelectionne?.date)} ?\n\nCette action signifie que tout est conforme.`,
                    [
                      { text: 'Annuler', style: 'cancel' },
                      { text: '✅ Confirmer', onPress: () => marquerVerifie(pointSelectionne?.id) }
                    ]
                  )}
                  disabled={validating}
                >
                  {validating
                    ? <ActivityIndicator color="#fff" />
                    : <>
                        <Text style={styles.verifierBtnTxt}>✅ Marquer comme vérifié</Text>
                        <Text style={styles.verifierBtnSub}>Confirmer que toutes les données sont conformes</Text>
                      </>
                  }
                </TouchableOpacity>
              )}

              {/* Bouton PDF */}
              {pointSelectionne?.valide && (
                <TouchableOpacity
                  style={[styles.pdfBtn, generatingPdf && { opacity: 0.6 }]}
                  onPress={telechargerPdf} disabled={generatingPdf}
                >
                  {generatingPdf
                    ? <><ActivityIndicator color="#534AB7" size="small" /><Text style={[styles.pdfBtnTxt, { marginLeft: 8 }]}>Génération en cours...</Text></>
                    : <><Text style={styles.pdfBtnTxt}>📄 Télécharger le point en PDF</Text><Text style={styles.pdfBtnSub}>Toutes les sections et photos incluses</Text></>
                  }
                </TouchableOpacity>
              )}

              <View style={{ height: 40 }} />
            </ScrollView>
          )}

          {/* ── GALERIE + ZOOM (un seul Modal, deux modes) ── */}
          <Modal visible={showGalerie} transparent animationType="fade">
            <View style={styles.galerieOverlay}>
              <SafeAreaView style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 }}>
                <View style={styles.galerieTopBar}>
                  {zoomActif ? (
                    <TouchableOpacity onPress={() => setZoomActif(false)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                      <Text style={{ fontSize: 14, color: '#aaa' }}>‹ Galerie</Text>
                    </TouchableOpacity>
                  ) : (
                    <Text style={styles.galerieCounter}>{galerieIndex + 1} / {galeriePhotos.length}</Text>
                  )}
                  <Text style={styles.galerieLabel} numberOfLines={1}>
                    {galeriePhotos[galerieIndex]?.label || ''}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                    {!zoomActif && (
                      <TouchableOpacity onPress={() => setZoomActif(true)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                        <Text style={{ fontSize: 22, color: '#fff' }}>🔍</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      onPress={() => { setZoomActif(false); setShowGalerie(false) }}
                      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                    >
                      <Text style={styles.galerieClose}>✕</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </SafeAreaView>

              {zoomActif ? (
                /* MODE ZOOM — ScrollView seul, pinch libre */
                <>
                  <ScrollView
                    style={{ flex: 1 }}
                    contentContainerStyle={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}
                    maximumZoomScale={6}
                    minimumZoomScale={1}
                    showsHorizontalScrollIndicator={false}
                    showsVerticalScrollIndicator={false}
                    centerContent
                    bouncesZoom
                  >
                    {galeriePhotos[galerieIndex]?.uri && (
                      <Image
                        source={{ uri: galeriePhotos[galerieIndex].uri }}
                        style={{ width: SW, height: SW * 1.3 }}
                        resizeMode="contain"
                      />
                    )}
                  </ScrollView>
                  <TouchableOpacity style={styles.galerieFermerBtn} onPress={() => setZoomActif(false)}>
                    <Text style={styles.galerieFermerTxt}>‹ Retour galerie</Text>
                  </TouchableOpacity>
                </>
              ) : (
                /* MODE GALERIE — FlatList swipe */
                <>
                  <FlatList
                    ref={galerieRef}
                    data={galeriePhotos}
                    horizontal
                    pagingEnabled
                    showsHorizontalScrollIndicator={false}
                    initialScrollIndex={galerieIndex}
                    getItemLayout={(_, idx) => ({ length: SW, offset: SW * idx, index: idx })}
                    onViewableItemsChanged={onViewableItemsChanged}
                    viewabilityConfig={{ itemVisiblePercentThreshold: 50 }}
                    keyExtractor={(_, idx) => String(idx)}
                    renderItem={({ item }) => (
                      <View style={{ width: SW, flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                        <Image
                          source={{ uri: item.uri }}
                          style={{ width: SW, height: SW * 1.1 }}
                          resizeMode="contain"
                        />
                      </View>
                    )}
                  />
                  <TouchableOpacity style={styles.galerieFermerBtn} onPress={() => setShowGalerie(false)}>
                    <Text style={styles.galerieFermerTxt}>Fermer</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </Modal>

          {/* ── MODAL PHOTO SIMPLE (fournisseurs) ── */}
          <Modal visible={modalPhoto} animationType="fade" transparent>
            <View style={styles.photoModalOverlay}>
              <TouchableOpacity
                style={styles.photoModalClose} onPress={() => setModalPhoto(false)}
                hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
              >
                <Text style={styles.photoModalCloseTxt}>✕</Text>
              </TouchableOpacity>
              <Text style={styles.photoModalLabel}>{photoSelectionnee?.label}</Text>
              <View style={styles.photoModalImgWrapper}>
                {photoSelectionnee?.uri && (
                  <Image source={{ uri: photoSelectionnee.uri }} style={styles.photoModalImg} resizeMode="contain" />
                )}
              </View>
              <TouchableOpacity style={styles.photoModalFermer} onPress={() => setModalPhoto(false)}>
                <Text style={styles.photoModalFermerTxt}>Fermer</Text>
              </TouchableOpacity>
            </View>
          </Modal>

        </SafeAreaView>
      </Modal>

      {/* ══════════════════════════════════════════
          MODAL INVENTAIRE (onglet inventaire)
      ══════════════════════════════════════════ */}
      <Modal visible={modalInventaire} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={{ flex: 1, backgroundColor: '#f5f5f5' }}>
          <View style={[styles.modalHeader, { backgroundColor: '#EF9F27' }]}>
            <TouchableOpacity onPress={() => setModalInventaire(false)}>
              <Text style={[styles.modalClose, { color: '#412402' }]}>✕ Fermer</Text>
            </TouchableOpacity>
            <View style={{ alignItems: 'center' }}>
              <Text style={[styles.modalTitre, { color: '#412402' }]}>{formatDate(pointSelectionne?.date)}</Text>
              <Text style={[styles.modalSub, { color: '#854F0B' }]}>Inventaire — {restoSelectionne?.nom}</Text>
            </View>
            <View style={{ width: 60 }} />
          </View>

          {loadingInventaire ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator size="large" color="#EF9F27" />
              <Text style={styles.loadingTxt}>Chargement de l'inventaire...</Text>
            </View>
          ) : !detailInventaire || detailInventaire.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyIcon}>📦</Text>
              <Text style={styles.emptyTxt}>Aucun inventaire enregistré</Text>
              <Text style={styles.emptySub}>L'inventaire de ce jour n'a pas encore été saisi</Text>
            </View>
          ) : (
            <ScrollView style={{ padding: 14 }} showsVerticalScrollIndicator={false}>
              {detailInventaire.map((shift, si) => (
                <View key={si} style={styles.invShiftCard}>
                  <View style={styles.invShiftHeader}>
                    <View style={styles.invShiftBadge}>
                      <Text style={styles.invShiftBadgeTxt}>{shift.numero === 0 ? '🚚' : `S${shift.numero}`}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.invShiftNom}>{shift.nom}</Text>
                      {shift.numero !== 0 && (
                        <Text style={styles.invShiftHeure}>{shift.heure_debut} → {shift.heure_fin}</Text>
                      )}
                    </View>
                    <Text style={styles.invShiftCount}>{shift.lignes.length} produit(s)</Text>
                  </View>
                  {shift.lignes.map((ligne, li) => {
                    const ecart = ligne.stock_final - (ligne.stock_initial + ligne.entrees - ligne.sorties)
                    const hasEcart = Math.abs(ecart) > 0.01
                    return (
                      <View key={li} style={[styles.invLigneRow, hasEcart && styles.invLigneRowAlert]}>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.invLigneNom, hasEcart && { color: '#A32D2D' }]}>{ligne.produit_nom}</Text>
                          {shift.numero === 0 ? (
                            <Text style={styles.invLigneSub}>Reçu : {ligne.entrees}</Text>
                          ) : (
                            <Text style={styles.invLigneSub}>
                              Init: {ligne.stock_initial} | Sorties: {ligne.sorties} | Final: {ligne.stock_final}
                            </Text>
                          )}
                        </View>
                        {shift.numero !== 0 && (
                          <View style={[styles.invEcartBadge, { backgroundColor: hasEcart ? '#FCEBEB' : '#EAF3DE' }]}>
                            <Text style={[styles.invEcartTxt, { color: hasEcart ? '#A32D2D' : '#3B6D11' }]}>
                              {hasEcart ? (ecart >= 0 ? '+' : '') + ecart.toFixed(1) : '✅'}
                            </Text>
                          </View>
                        )}
                      </View>
                    )
                  })}
                </View>
              ))}

              {/* Analyse des écarts */}
              {(() => {
                const shift1 = detailInventaire.find(s => s.numero === 1)
                if (!shift1) return null
                const lignesAvecEcart = shift1.lignes.filter(l => Math.abs(l.ecart ?? (l.stock_final - (l.stock_initial + l.entrees - l.sorties))) > 0.01)
                if (lignesAvecEcart.length === 0) return null
                const ecartsAvecCalc = lignesAvecEcart.map(l => {
                  const ecartVal = l.ecart ?? (l.stock_final - (l.stock_initial + l.entrees - l.sorties))
                  const prix = getPrixProduit(l.produit_id)
                  const nombreExplique = parseFloat(l.nombre_a_expliquer || 0)
                  const diffInexpliquee = Math.max(0, Math.abs(ecartVal) - nombreExplique)
                  const montantDeduit = diffInexpliquee * prix
                  return { ...l, ecart: ecartVal, prix, nombreExplique, diffInexpliquee, montantDeduit }
                })
                const totalDeduit = ecartsAvecCalc.reduce((s, e) => s + e.montantDeduit, 0)
                return (
                  <View style={styles.ecartSection}>
                    <View style={styles.ecartSectionHeader}>
                      <Text style={styles.ecartSectionTitre}>⚠️ Analyse des écarts</Text>
                      <Text style={styles.ecartSectionSub}>{lignesAvecEcart.length} produit(s)</Text>
                    </View>
                    {ecartsAvecCalc.map((e, i) => (
                      <View key={i} style={styles.ecartCard}>
                        <Text style={styles.ecartNom}>{e.produit_nom}</Text>
                        {[
                          { label: 'Écart réel', val: `${e.ecart > 0 ? '+' : ''}${e.ecart.toFixed(1)}`, color: e.ecart < 0 ? '#A32D2D' : '#EF9F27' },
                          { label: 'Expliqué gérant', val: e.nombreExplique > 0 ? e.nombreExplique.toFixed(1) : '—' },
                          { label: 'Diff. inexpliquée', val: e.diffInexpliquee > 0 ? e.diffInexpliquee.toFixed(1) : '✅ 0', color: e.diffInexpliquee > 0 ? '#A32D2D' : '#3B6D11' },
                          { label: 'Montant à déduire', val: e.montantDeduit > 0 ? fmt(e.montantDeduit) : '—', color: e.montantDeduit > 0 ? '#A32D2D' : '#3B6D11', bold: true },
                        ].map((r, j, arr) => (
                          <View key={j} style={[styles.ecartRow, j === arr.length - 1 && { borderBottomWidth: 0 }]}>
                            <Text style={[styles.ecartLabel, r.bold && { fontWeight: '600' }]}>{r.label}</Text>
                            <Text style={[styles.ecartVal, r.color && { color: r.color }, r.bold && { fontWeight: '700' }]}>{r.val}</Text>
                          </View>
                        ))}
                        {!!e.explication_ecart && (
                          <View style={[styles.ecartRow, { alignItems: 'flex-start', borderBottomWidth: 0 }]}>
                            <Text style={styles.ecartLabel}>Explication</Text>
                            <Text style={[styles.ecartVal, { flex: 1, textAlign: 'right' }]}>{e.explication_ecart}</Text>
                          </View>
                        )}
                      </View>
                    ))}
                    <View style={styles.ecartTotal}>
                      <Text style={styles.ecartTotalLabel}>Total à déduire</Text>
                      <Text style={styles.ecartTotalVal}>{fmt(totalDeduit)}</Text>
                    </View>
                    <TouchableOpacity
                      style={[styles.pdfBtn, generatingEcartsPdf && { opacity: 0.6 }]}
                      onPress={() => telechargerPdfEcarts(ecartsAvecCalc, totalDeduit)}
                      disabled={generatingEcartsPdf}
                    >
                      {generatingEcartsPdf
                        ? <><ActivityIndicator color="#534AB7" size="small" /><Text style={[styles.pdfBtnTxt, { marginLeft: 8 }]}>Génération en cours...</Text></>
                        : <><Text style={styles.pdfBtnTxt}>📄 Exporter les écarts en PDF</Text><Text style={styles.pdfBtnSub}>Rapport détaillé</Text></>
                      }
                    </TouchableOpacity>
                  </View>
                )
              })()}
              <View style={{ height: 40 }} />
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>

    </SafeAreaView>
  )
}

function makeStyles(colors) { return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    backgroundColor: colors.headerBg, padding: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'
  },
  back: { fontSize: 16, color: colors.primaryText, fontWeight: '500' },
  headerTitre: { fontSize: 16, fontWeight: '600', color: colors.surface, textAlign: 'center' },
  headerSub: { fontSize: 11, color: colors.primaryText, textAlign: 'center' },
  restoBar: { backgroundColor: colors.surface, maxHeight: 46, borderBottomWidth: 0.5, borderBottomColor: '#eee' },
  restoBtn: { paddingHorizontal: 14, paddingVertical: 12 },
  restoBtnActive: { borderBottomWidth: 2, borderBottomColor: colors.primary },
  restoTxt: { fontSize: 12, color: colors.textMuted },
  restoTxtActive: { color: colors.primary, fontWeight: '600' },
  statsBar: { flexDirection: 'row', backgroundColor: colors.surface, paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: '#eee' },
  statItem: { flex: 1, alignItems: 'center' },
  statVal: { fontSize: 20, fontWeight: '700' },
  statLabel: { fontSize: 10, color: colors.textMuted, marginTop: 2 },
  statDivider: { width: 0.5, backgroundColor: '#eee', marginVertical: 6 },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  loadingTxt: { fontSize: 13, color: colors.textMuted, marginTop: 12 },
  body: { flex: 1, padding: 14 },
  emptyBox: { alignItems: 'center', paddingVertical: 60 },
  emptyIcon: { fontSize: 50, marginBottom: 12 },
  emptyTxt: { fontSize: 14, color: colors.textMuted, fontWeight: '500' },
  emptySub: { fontSize: 12, color: colors.textPlaceholder, marginTop: 6 },
  prioriteSection: { backgroundColor: '#E6F1FB', borderRadius: 14, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: '#185FA5' },
  prioriteTitre: { fontSize: 13, fontWeight: '600', color: '#185FA5', marginBottom: 10 },
  prioriteCard: {
    backgroundColor: colors.surface, borderRadius: 10, padding: 12,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 8, borderWidth: 0.5, borderColor: '#B8D4F5'
  },
  prioriteDate: { fontSize: 14, fontWeight: '600', color: colors.text },
  prioriteBSC: { fontSize: 11, color: '#3B6D11', marginTop: 2 },
  prioriteVentes: { fontSize: 14, fontWeight: '600', color: '#EF9F27' },
  prioriteVerifier: { fontSize: 11, color: '#185FA5', marginTop: 2 },
  sectionTitre: { fontSize: 12, fontWeight: '600', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10, marginTop: 6 },
  pointCard: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 0.5, borderColor: colors.border },
  pointCardVerifie: { borderColor: '#3B6D11', backgroundColor: '#F4FAF0' },
  pointCardAVerifier: { borderColor: '#185FA5', backgroundColor: '#F0F5FF' },
  pointCardEnCours: { borderColor: colors.border },
  pointHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  pointDate: { fontSize: 16, fontWeight: '600', color: colors.text, marginBottom: 4 },
  pointStats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pointStatTxt: { fontSize: 11, color: colors.textMuted },
  statutBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  statutTxt: { fontSize: 11, fontWeight: '500' },
  manquanteBadge: { backgroundColor: '#FAECE7', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  manquanteTxt: { fontSize: 10, color: '#993C1D', fontWeight: '500' },
  voirDetailTxt: { fontSize: 11, color: colors.primary, marginTop: 4 },
  modalHeader: { backgroundColor: colors.headerBg, padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalClose: { fontSize: 14, color: colors.primaryText, fontWeight: '500' },
  modalTitre: { fontSize: 16, fontWeight: '600', color: colors.surface },
  modalSub: { fontSize: 11, color: colors.primaryText, textAlign: 'center' },
  verifBanner: { borderRadius: 12, padding: 12, marginBottom: 14, borderWidth: 1, alignItems: 'center' },
  verifBannerTxt: { fontSize: 13, fontWeight: '600' },
  // ─── Récapitulatif Financier ───
  recapCard: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, marginBottom: 4, borderWidth: 0.5, borderColor: colors.border },
  recapRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 7, borderBottomWidth: 0.5, borderBottomColor: '#f5f5f5' },
  recapRowTotal: { backgroundColor: '#fafafa', marginHorizontal: -4, paddingHorizontal: 4, borderRadius: 6, borderBottomWidth: 0 },
  recapLabel: { fontSize: 13, color: colors.text },
  recapVal: { fontSize: 13, fontWeight: '500' },
  recapSep: { height: 8 },
  // ─── Canaux ───
  canalCard: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 0.5, borderColor: colors.border, borderLeftWidth: 3, borderLeftColor: '#EF9F27' },
  canalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, paddingBottom: 8, borderBottomWidth: 0.5, borderBottomColor: '#f0f0f0' },
  canalNom: { fontSize: 14, fontWeight: '700', color: colors.text },
  canalMontant: { fontSize: 16, fontWeight: '700', color: '#EF9F27' },
  canalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, borderBottomWidth: 0.5, borderBottomColor: '#f9f9f9' },
  canalLabel: { fontSize: 12, color: colors.textMuted },
  canalVal: { fontSize: 12, fontWeight: '500', color: colors.text },
  canalAutresTitre: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginBottom: 8, letterSpacing: 0.5 },
  canalPhotoTouchable: { flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 10, backgroundColor: '#f9f9f9', padding: 8, borderRadius: 10 },
  canalPhotoMini: { width: 60, height: 60, borderRadius: 8 },
  canalPhotoLabel: { fontSize: 11, color: colors.primary, flex: 1 },
  aucunePhoto: { marginTop: 8, fontSize: 11, color: '#bbb', fontStyle: 'italic' },
  // ─── Listes ───
  listCard: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, marginBottom: 4, borderWidth: 0.5, borderColor: colors.border },
  listRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: '#f5f5f5' },
  listLeft: { flex: 1, flexDirection: 'column', gap: 2, paddingRight: 8 },
  listRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  listLabel: { fontSize: 13, fontWeight: '500', color: colors.text },
  listSub: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  listVal: { fontSize: 13, fontWeight: '600', color: colors.text },
  listAuteur: { fontSize: 10, color: colors.textMuted, marginTop: 2 },
  listSubTitre: { fontSize: 11, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6, marginTop: 4 },
  listTotalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 10, marginTop: 4, borderTopWidth: 1, borderTopColor: colors.border },
  listTotalLabel: { fontSize: 13, fontWeight: '600', color: colors.text },
  listTotalVal: { fontSize: 15, fontWeight: '700', color: '#EF9F27' },
  // ─── Présences ───
  statutPresenceBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, alignSelf: 'flex-start', marginTop: 3 },
  statutPresenceTxt: { fontSize: 10, fontWeight: '500' },
  // ─── Inventaire ───
  invShiftCard: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 0.5, borderColor: colors.border },
  invShiftHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10, paddingBottom: 8, borderBottomWidth: 0.5, borderBottomColor: colors.borderLight },
  invShiftBadge: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.orangeLight, alignItems: 'center', justifyContent: 'center' },
  invShiftBadgeTxt: { fontSize: 13, fontWeight: '600', color: colors.orangeDark },
  invShiftNom: { fontSize: 13, fontWeight: '600', color: colors.text },
  invShiftHeure: { fontSize: 10, color: colors.textMuted, marginTop: 2 },
  invShiftCount: { fontSize: 11, color: colors.textMuted },
  invLigneRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, borderBottomWidth: 0.5, borderBottomColor: '#f9f9f9' },
  invLigneRowAlert: { backgroundColor: '#FFF8F8', borderRadius: 6, paddingHorizontal: 6 },
  invLigneNom: { fontSize: 12, fontWeight: '500', color: colors.text },
  invLigneSub: { fontSize: 10, color: colors.textMuted, marginTop: 2 },
  invEcartBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  invEcartTxt: { fontSize: 11, fontWeight: '600' },
  // ─── Shifts ───
  shiftCard: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 0.5, borderColor: colors.border },
  shiftHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  shiftNumBox: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#EF9F27', alignItems: 'center', justifyContent: 'center' },
  shiftNumTxt: { fontSize: 12, fontWeight: '600', color: '#412402' },
  shiftHeures: { fontSize: 13, fontWeight: '600', color: colors.text },
  shiftCaissier: { fontSize: 11, color: colors.primary, marginTop: 2 },
  shiftVente: { fontSize: 14, fontWeight: '700', color: '#EF9F27' },
  shiftDonnees: { borderTopWidth: 0.5, borderTopColor: '#f5f5f5', paddingTop: 8, marginBottom: 10 },
  shiftRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderBottomWidth: 0.5, borderBottomColor: '#f9f9f9' },
  shiftLabel: { fontSize: 12, color: colors.textMuted },
  shiftVal: { fontSize: 12, fontWeight: '500', color: colors.text },
  // ─── Photos ───
  photosShiftTitre: { fontSize: 11, fontWeight: '600', color: colors.primary, marginBottom: 8 },
  photosGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  photoVignette: { width: '30%', backgroundColor: colors.surface, borderRadius: 10, padding: 6, alignItems: 'center', borderWidth: 0.5, borderColor: colors.border },
  photoVignetteManquante: { backgroundColor: '#FAECE7', borderColor: '#F09595' },
  photoThumb: { width: '100%', height: 70, borderRadius: 8, marginBottom: 4 },
  photoAbsente: { width: '100%', height: 70, borderRadius: 8, backgroundColor: '#f9f9f9', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  photoAbsenteIcon: { fontSize: 24 },
  photoLabel: { fontSize: 9, color: '#3B6D11', textAlign: 'center', fontWeight: '500' },
  photoMontant: { fontSize: 8, color: colors.textMuted, textAlign: 'center', marginTop: 2 },
  photoTapTxt: { fontSize: 8, color: colors.primary, textAlign: 'center', marginTop: 1 },
  miniThumb: { width: 40, height: 40, borderRadius: 6 },
  // ─── Galerie Zoom ───
  galerieOverlay: { flex: 1, backgroundColor: 'black' },
  galerieTopBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  galerieCounter: { fontSize: 13, color: '#aaa', minWidth: 40 },
  galerieLabel: { flex: 1, fontSize: 13, color: '#fff', textAlign: 'center', fontWeight: '500', paddingHorizontal: 8 },
  galerieClose: { fontSize: 28, color: '#fff', fontWeight: '300', minWidth: 40, textAlign: 'right' },
  galerieFermerBtn: { backgroundColor: '#534AB7', marginHorizontal: 40, marginBottom: 20, padding: 14, borderRadius: 14, alignItems: 'center' },
  galerieFermerTxt: { fontSize: 14, fontWeight: '600', color: '#fff' },
  // ─── Modal photo simple ───
  photoModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', flexDirection: 'column', paddingTop: 50, paddingBottom: 30 },
  photoModalClose: { alignSelf: 'flex-end', paddingHorizontal: 20, paddingBottom: 10 },
  photoModalCloseTxt: { fontSize: 28, color: '#fff', fontWeight: '300' },
  photoModalLabel: { fontSize: 15, fontWeight: '600', color: '#fff', textAlign: 'center', paddingHorizontal: 20, marginBottom: 10 },
  photoModalImgWrapper: { flex: 1, width: '100%' },
  photoModalImg: { flex: 1, width: '100%' },
  photoModalFermer: { backgroundColor: colors.primary, marginHorizontal: 40, marginTop: 16, padding: 14, borderRadius: 14, alignItems: 'center' },
  photoModalFermerTxt: { fontSize: 14, fontWeight: '600', color: colors.surface },
  // ─── Sections vides ───
  emptySection: { backgroundColor: '#f9f9f9', borderRadius: 10, padding: 14, alignItems: 'center', marginBottom: 4 },
  emptySectionTxt: { fontSize: 13, color: colors.textMuted },
  // ─── Onglets ───
  ongletBar: { flexDirection: 'row', backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  ongletBtn: { flex: 1, paddingVertical: 12, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  ongletBtnActive: { borderBottomColor: colors.primary },
  ongletTxt: { fontSize: 12, color: colors.textMuted, fontWeight: '500' },
  ongletTxtActive: { color: colors.primary, fontWeight: '700' },
  // ─── Boutons ───
  verifierBtn: { backgroundColor: colors.primary, borderRadius: 14, padding: 16, alignItems: 'center', marginBottom: 10, marginTop: 6 },
  verifierBtnTxt: { fontSize: 15, fontWeight: '600', color: colors.surface },
  verifierBtnSub: { fontSize: 11, color: colors.primaryText, marginTop: 4 },
  pdfBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderRadius: 14, padding: 14, marginBottom: 10, marginTop: 4, borderWidth: 1.5, borderColor: colors.primary, flexWrap: 'wrap', gap: 4 },
  pdfBtnTxt: { fontSize: 14, fontWeight: '600', color: colors.primary },
  pdfBtnSub: { fontSize: 11, color: colors.textMuted, width: '100%', textAlign: 'center', marginTop: 2 },
  // ─── Écarts inventaire ───
  ecartSection: { backgroundColor: '#FFF8F8', borderRadius: 14, padding: 14, marginTop: 8, marginBottom: 4, borderWidth: 1, borderColor: '#F09595' },
  ecartSectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  ecartSectionTitre: { fontSize: 14, fontWeight: '700', color: '#A32D2D' },
  ecartSectionSub: { fontSize: 11, color: '#993C1D' },
  ecartCard: { backgroundColor: colors.surface, borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 0.5, borderColor: '#F09595' },
  ecartNom: { fontSize: 13, fontWeight: '700', color: colors.text, marginBottom: 8 },
  ecartRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 5, borderBottomWidth: 0.5, borderBottomColor: '#f5f5f5' },
  ecartLabel: { fontSize: 12, color: colors.textMuted },
  ecartVal: { fontSize: 12, fontWeight: '500', color: colors.text },
  ecartTotal: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#FCEBEB', borderRadius: 10, padding: 12, marginTop: 4, marginBottom: 10, borderWidth: 1, borderColor: '#F09595' },
  ecartTotalLabel: { fontSize: 14, fontWeight: '700', color: '#A32D2D' },
  ecartTotalVal: { fontSize: 18, fontWeight: '700', color: '#A32D2D' },
}) }
