import { useState, useEffect } from 'react'
import {
  View, Text, TouchableOpacity, StyleSheet,
  SafeAreaView, ScrollView, ActivityIndicator,
  Modal, Image, Alert, RefreshControl
} from 'react-native'
import { router } from 'expo-router'
import { supabase } from '../lib/supabase'

export default function VerificationScreen() {
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

  useEffect(() => { chargerRestaurants() }, [])

  async function chargerRestaurants() {
    setLoading(true)
    const { data, error } = await supabase
      .from('restaurants')
      .select('*')
      .order('nom')

    if (error) {
      console.error('Erreur chargement restaurants:', error)
      setLoading(false)
      return
    }

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

    const { data, error } = await supabase
      .from('points')
      .select('*')
      .eq('restaurant_id', restoId)
      .order('date', { ascending: false })
      .limit(50)

    if (error) {
      console.error('Erreur chargement points:', error)
    }

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
    ] = await Promise.all([
      supabase.from('sequences').select('*').eq('point_id', point.id).order('numero'),
      supabase.from('depenses').select('*').eq('point_id', point.id),
      supabase.from('transactions_fournisseurs').select('*, fournisseurs(nom)').eq('point_id', point.id),
      supabase.from('points_shifts').select('*').eq('point_id', point.id).order('created_at'),
      supabase.from('presences').select('*').eq('point_id', point.id),
    ])

    setDetailPoint({
      point,
      sequences: sequences || [],
      depenses: depenses || [],
      fournisseurs: fournisseurs || [],
      shifts: shifts || [],
      presences: presences || [],
    })
    setLoadingDetail(false)
  }

  async function marquerVerifie(pointId) {
    setValidating(true)
    const { error } = await supabase
      .from('points')
      .update({
        verifie: true,
        verifie_par: 'Manager',
        verifie_at: new Date().toISOString(),
      })
      .eq('id', pointId)

    if (error) {
      Alert.alert('Erreur', error.message)
      setValidating(false)
      return
    }

    setValidating(false)
    setModalPoint(false)

    // Mettre à jour localement
    setPoints(prev => prev.map(p =>
      p.id === pointId ? { ...p, verifie: true } : p
    ))

    Alert.alert('✅ Point vérifié !', 'Le point a été marqué comme vérifié avec succès.')
  }

  function fmt(n) { return Math.round(n).toLocaleString('fr-FR') + ' FCFA' }

  function formatDate(dateStr) {
    if (!dateStr) return ''
    const [y, m, d] = dateStr.split('-')
    const mois = ['jan', 'fév', 'mar', 'avr', 'mai', 'juin',
      'juil', 'août', 'sep', 'oct', 'nov', 'déc']
    return `${parseInt(d)} ${mois[parseInt(m) - 1]} ${y}`
  }

  function statutPoint(point) {
    if (point.verifie) return { label: '✅ Vérifié', bg: '#EAF3DE', text: '#3B6D11' }
    if (point.valide) return { label: '🔒 Validé', bg: '#E6F1FB', text: '#185FA5' }
    return { label: '⏳ En cours', bg: '#FAEEDA', text: '#854F0B' }
  }

  function photosManquantesPoint(point) {
    const manquantes = []
    if ((point.yango_cse || 0) > 0 && !point.photo_yango_cse) manquantes.push('Yango CSE')
    if ((point.glovo_cse || 0) > 0 && !point.photo_glovo_cse) manquantes.push('Glovo CSE')
    if ((point.wave || 0) > 0 && !point.photo_wave) manquantes.push('Wave')
    if ((point.om || 0) > 0 && !point.photo_om) manquantes.push('Orange Money')
    if ((point.djamo || 0) > 0 && !point.photo_djamo) manquantes.push('Djamo')
    if ((point.yango_tab || 0) > 0 && !point.photo_yango_tab) manquantes.push('Yango TAB')
    if ((point.glovo_tab || 0) > 0 && !point.photo_glovo_tab) manquantes.push('Glovo TAB')
    if ((point.kdo || 0) > 0 && !point.photo_kdo) manquantes.push('KDO')
    if ((point.retour || 0) > 0 && !point.photo_retour) manquantes.push('Retour')
    return manquantes
  }

  function voirPhoto(uri, label) {
    if (!uri) return
    setPhotoSelectionnee({ uri, label })
    setModalPhoto(true)
  }

  // ─── Composant vignette photo ──────────────────────────────
  function PhotoVignette({ uri, label, montant }) {
    const aPhoto = !!uri
    return (
      <TouchableOpacity
        style={[styles.photoVignette, !aPhoto && styles.photoVignetteManquante]}
        onPress={() => aPhoto && voirPhoto(uri, label)}
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
        {montant > 0 && (
          <Text style={styles.photoMontant}>{fmt(montant)}</Text>
        )}
        {aPhoto && (
          <Text style={styles.photoTapTxt}>Tap pour voir</Text>
        )}
      </TouchableOpacity>
    )
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

      {/* Sélection restaurant */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.restoBar}
        contentContainerStyle={{ paddingHorizontal: 10 }}
      >
        {restaurants.map(r => (
          <TouchableOpacity
            key={r.id}
            style={[styles.restoBtn, restoSelectionne?.id === r.id && styles.restoBtnActive]}
            onPress={() => changerResto(r)}
          >
            <Text style={[styles.restoTxt, restoSelectionne?.id === r.id && styles.restoTxtActive]}>
              {r.nom}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Stats rapides */}
      {!loading && points.length > 0 && (
        <View style={styles.statsBar}>
          <View style={styles.statItem}>
            <Text style={[styles.statVal, { color: '#534AB7' }]}>{points.length}</Text>
            <Text style={styles.statLabel}>Total</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={[styles.statVal, { color: '#3B6D11' }]}>
              {points.filter(p => p.verifie).length}
            </Text>
            <Text style={styles.statLabel}>Vérifiés</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={[styles.statVal, { color: '#185FA5' }]}>
              {points.filter(p => p.valide && !p.verifie).length}
            </Text>
            <Text style={styles.statLabel}>À vérifier</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={[styles.statVal, { color: '#854F0B' }]}>
              {points.filter(p => !p.valide).length}
            </Text>
            <Text style={styles.statLabel}>En cours</Text>
          </View>
        </View>
      )}

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#534AB7" />
          <Text style={styles.loadingTxt}>Chargement des points...</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.body}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#534AB7" />
          }
        >
          {points.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyIcon}>🔍</Text>
              <Text style={styles.emptyTxt}>Aucun point pour ce restaurant</Text>
              <Text style={styles.emptySub}>Tirez vers le bas pour rafraîchir</Text>
            </View>
          ) : (
            <>
              {/* Points à vérifier en priorité */}
              {points.filter(p => p.valide && !p.verifie).length > 0 && (
                <View style={styles.prioriteSection}>
                  <Text style={styles.prioriteTitre}>🔔 En attente de vérification</Text>
                  {points.filter(p => p.valide && !p.verifie).map((point, i) => (
                    <TouchableOpacity
                      key={point.id}
                      style={styles.prioriteCard}
                      onPress={() => ouvrirPoint(point)}
                    >
                      <View style={styles.prioriteLeft}>
                        <Text style={styles.prioriteDate}>{formatDate(point.date)}</Text>
                        <Text style={styles.prioriteBSC}>
                          BSC : {fmt(point.benefice_sc || 0)}
                        </Text>
                      </View>
                      <View style={styles.prioriteRight}>
                        <Text style={styles.prioriteVentes}>
                          {fmt(point.vente_total || 0)}
                        </Text>
                        <Text style={styles.prioriteVerifier}>Vérifier ›</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {/* Tous les points */}
              <Text style={styles.sectionTitre}>Tous les points</Text>
              {points.map((point, i) => {
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
                    onPress={() => ouvrirPoint(point)}
                  >
                    <View style={styles.pointHeader}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.pointDate}>{formatDate(point.date)}</Text>
                        <View style={styles.pointStats}>
                          <Text style={styles.pointStatTxt}>
                            📈 {fmt(point.vente_total || 0)}
                          </Text>
                          <Text style={styles.pointStatTxt}>
                            💳 {fmt(point.depense_total || 0)}
                          </Text>
                          <Text style={[styles.pointStatTxt, { color: '#3B6D11', fontWeight: '600' }]}>
                            BSC: {fmt(point.benefice_sc || 0)}
                          </Text>
                        </View>
                      </View>
                      <View style={{ alignItems: 'flex-end', gap: 6 }}>
                        <View style={[styles.statutBadge, { backgroundColor: statut.bg }]}>
                          <Text style={[styles.statutTxt, { color: statut.text }]}>
                            {statut.label}
                          </Text>
                        </View>
                        {manquantes.length > 0 && (
                          <View style={styles.manquanteBadge}>
                            <Text style={styles.manquanteTxt}>
                              ⚠️ {manquantes.length} photo(s)
                            </Text>
                          </View>
                        )}
                      </View>
                    </View>
                    <Text style={styles.voirDetailTxt}>
                      Appuyer pour voir les détails et photos ›
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

              {/* Statut vérification */}
              {pointSelectionne?.verifie ? (
                <View style={[styles.verifBanner, { backgroundColor: '#EAF3DE', borderColor: '#3B6D11' }]}>
                  <Text style={[styles.verifBannerTxt, { color: '#3B6D11' }]}>
                    ✅ Vérifié par {pointSelectionne.verifie_par}
                  </Text>
                </View>
              ) : pointSelectionne?.valide ? (
                <View style={[styles.verifBanner, { backgroundColor: '#E6F1FB', borderColor: '#185FA5' }]}>
                  <Text style={[styles.verifBannerTxt, { color: '#185FA5' }]}>
                    🔍 Validé — en attente de vérification
                  </Text>
                </View>
              ) : (
                <View style={[styles.verifBanner, { backgroundColor: '#FAEEDA', borderColor: '#EF9F27' }]}>
                  <Text style={[styles.verifBannerTxt, { color: '#854F0B' }]}>
                    ⏳ Point en cours — non encore validé
                  </Text>
                </View>
              )}

              {/* ── SHIFTS & PHOTOS SHIFTS ── */}
              {detailPoint.shifts.length > 0 && (
                <>
                  <Text style={styles.sectionTitre}>
                    ⏱️ Shifts caissiers ({detailPoint.shifts.length})
                  </Text>
                  {detailPoint.shifts.map((shift, i) => (
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
                        ].filter(r => r.val > 0).map((r, j) => (
                          <View key={j} style={styles.shiftRow}>
                            <Text style={styles.shiftLabel}>{r.label}</Text>
                            <Text style={styles.shiftVal}>{fmt(r.val)}</Text>
                          </View>
                        ))}
                      </View>

                      {/* Photos du shift */}
                      {[
                        { uri: shift.photo_kdo, label: 'KDO', val: shift.kdo },
                        { uri: shift.photo_retour, label: 'Retour', val: shift.retour },
                        { uri: shift.photo_yango_cse, label: 'Yango CSE', val: shift.yango_cse },
                        { uri: shift.photo_glovo_cse, label: 'Glovo CSE', val: shift.glovo_cse },
                        { uri: shift.photo_wave, label: 'Wave', val: shift.wave },
                        { uri: shift.photo_djamo, label: 'Djamo', val: shift.djamo },
                        { uri: shift.photo_om, label: 'OM', val: shift.om },
                      ].filter(p => p.val > 0).length > 0 && (
                        <>
                          <Text style={styles.photosShiftTitre}>📷 Photos justificatives</Text>
                          <View style={styles.photosGrid}>
                            {[
                              { uri: shift.photo_kdo, label: 'KDO', val: shift.kdo },
                              { uri: shift.photo_retour, label: 'Retour', val: shift.retour },
                              { uri: shift.photo_yango_cse, label: 'Yango CSE', val: shift.yango_cse },
                              { uri: shift.photo_glovo_cse, label: 'Glovo CSE', val: shift.glovo_cse },
                              { uri: shift.photo_wave, label: 'Wave', val: shift.wave },
                              { uri: shift.photo_djamo, label: 'Djamo', val: shift.djamo },
                              { uri: shift.photo_om, label: 'OM', val: shift.om },
                            ].filter(p => p.val > 0).map((p, j) => (
                              <PhotoVignette key={j} uri={p.uri} label={p.label} montant={p.val} />
                            ))}
                          </View>
                        </>
                      )}
                    </View>
                  ))}
                </>
              )}

              {/* ── KPIs calculés depuis les shifts ── */}
              {(() => {
                const venteShifts = detailPoint.shifts.reduce((s, sh) => s + (sh.vente_shift || 0), 0)
                const depenses = detailPoint.depenses.reduce((s, d) => s + (d.montant || 0), 0)
                const bsc = pointSelectionne?.benefice_sc || 0
                return (
                  <View style={styles.kpiGrid}>
                    <View style={[styles.kpiCard, { borderColor: '#EF9F27' }]}>
                      <Text style={styles.kpiLabel}>Ventes shifts</Text>
                      <Text style={[styles.kpiVal, { color: '#EF9F27' }]} adjustsFontSizeToFit numberOfLines={2}>
                        {fmt(venteShifts)}
                      </Text>
                    </View>
                    <View style={[styles.kpiCard, { borderColor: '#A32D2D' }]}>
                      <Text style={styles.kpiLabel}>Dépenses</Text>
                      <Text style={[styles.kpiVal, { color: '#A32D2D' }]} adjustsFontSizeToFit numberOfLines={2}>
                        {fmt(depenses)}
                      </Text>
                    </View>
                    <View style={[styles.kpiCard, { borderColor: '#3B6D11' }]}>
                      <Text style={styles.kpiLabel}>BSC</Text>
                      <Text style={[styles.kpiVal, { color: '#3B6D11', fontWeight: '700' }]} adjustsFontSizeToFit numberOfLines={2}>
                        {fmt(bsc)}
                      </Text>
                    </View>
                  </View>
                )
              })()}

              {/* ── DÉPENSES ── */}
              {detailPoint.depenses.length > 0 && (
                <>
                  <Text style={styles.sectionTitre}>📋 Dépenses</Text>
                  <View style={styles.listCard}>
                    {detailPoint.depenses.map((d, i) => (
                      <View key={i} style={[
                        styles.listRow,
                        i === detailPoint.depenses.length - 1 && { borderBottomWidth: 0 }
                      ]}>
                        <View style={styles.listLeft}>
                          <Text style={styles.listLabel}>{d.libelle || 'Sans nom'}</Text>
                          <Text style={styles.listSub}>
                            {d.categorie} — {d.saisi_par === 'gerant' ? '🔑 Gérant' : '💼 Caissier'}
                            {d.caissier_nom ? ` · ${d.caissier_nom}` : ''}
                          </Text>
                        </View>
                        <Text style={styles.listVal}>{fmt(d.montant || 0)}</Text>
                      </View>
                    ))}
                    <View style={styles.listTotalRow}>
                      <Text style={styles.listTotalLabel}>Total dépenses</Text>
                      <Text style={styles.listTotalVal}>
                        {fmt(detailPoint.depenses.reduce((s, d) => s + (d.montant || 0), 0))}
                      </Text>
                    </View>
                  </View>
                </>
              )}

              {/* ── PRÉSENCES ── */}
              {detailPoint.presences.length > 0 && (
                <>
                  <Text style={styles.sectionTitre}>👥 Présences & Paies</Text>
                  <View style={styles.listCard}>
                    {detailPoint.presences.map((p, i) => (
                      <View key={i} style={[
                        styles.listRow,
                        i === detailPoint.presences.length - 1 && { borderBottomWidth: 0 }
                      ]}>
                        <View style={styles.listLeft}>
                          <Text style={styles.listLabel}>{p.travailleur_nom}</Text>
                          <View style={[styles.statutPresenceBadge, {
                            backgroundColor: p.statut === 'Présent' ? '#EAF3DE' : '#FAECE7'
                          }]}>
                            <Text style={[styles.statutPresenceTxt, {
                              color: p.statut === 'Présent' ? '#3B6D11' : '#993C1D'
                            }]}>
                              {p.statut}
                            </Text>
                          </View>
                        </View>
                        <Text style={styles.listVal}>
                          {p.paye > 0 ? fmt(p.paye) : '—'}
                        </Text>
                      </View>
                    ))}
                    <View style={styles.listTotalRow}>
                      <Text style={styles.listTotalLabel}>Total paie</Text>
                      <Text style={styles.listTotalVal}>
                        {fmt(detailPoint.presences.reduce((s, p) => s + (p.paye || 0), 0))}
                      </Text>
                    </View>
                  </View>
                </>
              )}

              {/* ── FOURNISSEURS ── */}
              {detailPoint.fournisseurs.length > 0 && (
                <>
                  <Text style={styles.sectionTitre}>🧾 Fournisseurs</Text>
                  <View style={styles.listCard}>
                    {detailPoint.fournisseurs.map((f, i) => (
                      <View key={i} style={[
                        styles.listRow,
                        i === detailPoint.fournisseurs.length - 1 && { borderBottomWidth: 0 }
                      ]}>
                        <View style={styles.listLeft}>
                          <Text style={styles.listLabel}>
                            {f.fournisseurs?.nom || 'Fournisseur'}
                          </Text>
                          <Text style={styles.listSub}>
                            Facture: {fmt(f.facture || 0)} — Payé: {fmt(f.paye || 0)}
                          </Text>
                          {(f.reste || 0) > 0 && (
                            <Text style={[styles.listSub, { color: '#A32D2D' }]}>
                              Reste: {fmt(f.reste || 0)}
                            </Text>
                          )}
                        </View>
                        <View style={styles.listRight}>
                          <Text style={[styles.listVal, {
                            color: (f.reste || 0) > 0 ? '#A32D2D' : '#3B6D11'
                          }]}>
                            {fmt(f.paye || 0)}
                          </Text>
                          {f.photo_url && (
                            <TouchableOpacity onPress={() => voirPhoto(f.photo_url, f.fournisseurs?.nom)}>
                              <Image source={{ uri: f.photo_url }} style={styles.miniThumb} resizeMode="cover" />
                            </TouchableOpacity>
                          )}
                        </View>
                      </View>
                    ))}
                  </View>
                </>
              )}

              {/* Bouton vérifier */}
              {!pointSelectionne?.verifie && pointSelectionne?.valide && (
                <TouchableOpacity
                  style={[styles.verifierBtn, validating && { opacity: 0.6 }]}
                  onPress={() => {
                    Alert.alert(
                      '✅ Confirmer la vérification',
                      `Vous confirmez avoir vérifié toutes les données et photos du point du ${formatDate(pointSelectionne?.date)} ?\n\nCette action signifie que tout est conforme.`,
                      [
                        { text: 'Annuler', style: 'cancel' },
                        { text: '✅ Confirmer', onPress: () => marquerVerifie(pointSelectionne?.id) }
                      ]
                    )
                  }}
                  disabled={validating}
                >
                  {validating ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <>
                      <Text style={styles.verifierBtnTxt}>✅ Marquer comme vérifié</Text>
                      <Text style={styles.verifierBtnSub}>Confirmer que toutes les données sont conformes</Text>
                    </>
                  )}
                </TouchableOpacity>
              )}

              <View style={{ height: 40 }} />
            </ScrollView>
          )}

          {/* ── MODAL PHOTO — à l'intérieur du modal point pour iOS ── */}
          <Modal visible={modalPhoto} animationType="fade" transparent>
            <View style={styles.photoModalOverlay}>
              <TouchableOpacity
                style={styles.photoModalClose}
                onPress={() => setModalPhoto(false)}
                hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
              >
                <Text style={styles.photoModalCloseTxt}>✕</Text>
              </TouchableOpacity>
              <Text style={styles.photoModalLabel}>{photoSelectionnee?.label}</Text>
              <View style={styles.photoModalImgWrapper}>
                {photoSelectionnee?.uri && (
                  <Image
                    source={{ uri: photoSelectionnee.uri }}
                    style={styles.photoModalImg}
                    resizeMode="contain"
                  />
                )}
              </View>
              <TouchableOpacity
                style={styles.photoModalFermer}
                onPress={() => setModalPhoto(false)}
              >
                <Text style={styles.photoModalFermerTxt}>Fermer</Text>
              </TouchableOpacity>
            </View>
          </Modal>

        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: {
    backgroundColor: '#534AB7', padding: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'
  },
  back: { fontSize: 16, color: '#CECBF6', fontWeight: '500' },
  headerTitre: { fontSize: 16, fontWeight: '600', color: '#fff', textAlign: 'center' },
  headerSub: { fontSize: 11, color: '#CECBF6', textAlign: 'center' },
  restoBar: {
    backgroundColor: '#fff', maxHeight: 46,
    borderBottomWidth: 0.5, borderBottomColor: '#eee'
  },
  restoBtn: { paddingHorizontal: 14, paddingVertical: 12 },
  restoBtnActive: { borderBottomWidth: 2, borderBottomColor: '#534AB7' },
  restoTxt: { fontSize: 12, color: '#888' },
  restoTxtActive: { color: '#534AB7', fontWeight: '600' },
  statsBar: {
    flexDirection: 'row', backgroundColor: '#fff',
    paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: '#eee'
  },
  statItem: { flex: 1, alignItems: 'center' },
  statVal: { fontSize: 20, fontWeight: '700' },
  statLabel: { fontSize: 10, color: '#888', marginTop: 2 },
  statDivider: { width: 0.5, backgroundColor: '#eee', marginVertical: 6 },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  loadingTxt: { fontSize: 13, color: '#888', marginTop: 12 },
  body: { flex: 1, padding: 14 },
  emptyBox: { alignItems: 'center', paddingVertical: 60 },
  emptyIcon: { fontSize: 50, marginBottom: 12 },
  emptyTxt: { fontSize: 14, color: '#888', fontWeight: '500' },
  emptySub: { fontSize: 12, color: '#bbb', marginTop: 6 },
  prioriteSection: {
    backgroundColor: '#E6F1FB', borderRadius: 14, padding: 14,
    marginBottom: 16, borderWidth: 1, borderColor: '#185FA5'
  },
  prioriteTitre: { fontSize: 13, fontWeight: '600', color: '#185FA5', marginBottom: 10 },
  prioriteCard: {
    backgroundColor: '#fff', borderRadius: 10, padding: 12,
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 8, borderWidth: 0.5, borderColor: '#B8D4F5'
  },
  prioriteLeft: {},
  prioriteDate: { fontSize: 14, fontWeight: '600', color: '#1a1a1a' },
  prioriteBSC: { fontSize: 11, color: '#3B6D11', marginTop: 2 },
  prioriteRight: { alignItems: 'flex-end' },
  prioriteVentes: { fontSize: 14, fontWeight: '600', color: '#EF9F27' },
  prioriteVerifier: { fontSize: 11, color: '#185FA5', marginTop: 2 },
  sectionTitre: {
    fontSize: 12, fontWeight: '600', color: '#888',
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10, marginTop: 6
  },
  pointCard: {
    backgroundColor: '#fff', borderRadius: 14, padding: 14,
    marginBottom: 10, borderWidth: 0.5, borderColor: '#eee'
  },
  pointCardVerifie: { borderColor: '#3B6D11', backgroundColor: '#F4FAF0' },
  pointCardAVerifier: { borderColor: '#185FA5', backgroundColor: '#F0F5FF' },
  pointCardEnCours: { borderColor: '#eee' },
  pointHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  pointDate: { fontSize: 16, fontWeight: '600', color: '#1a1a1a', marginBottom: 4 },
  pointStats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pointStatTxt: { fontSize: 11, color: '#888' },
  statutBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  statutTxt: { fontSize: 11, fontWeight: '500' },
  manquanteBadge: {
    backgroundColor: '#FAECE7', paddingHorizontal: 8,
    paddingVertical: 3, borderRadius: 20
  },
  manquanteTxt: { fontSize: 10, color: '#993C1D', fontWeight: '500' },
  voirDetailTxt: { fontSize: 11, color: '#534AB7', marginTop: 4 },
  modalHeader: {
    backgroundColor: '#534AB7', padding: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'
  },
  modalClose: { fontSize: 14, color: '#CECBF6', fontWeight: '500' },
  modalTitre: { fontSize: 16, fontWeight: '600', color: '#fff' },
  modalSub: { fontSize: 11, color: '#CECBF6', textAlign: 'center' },
  verifBanner: {
    borderRadius: 12, padding: 12, marginBottom: 14,
    borderWidth: 1, alignItems: 'center'
  },
  verifBannerTxt: { fontSize: 13, fontWeight: '600' },
  kpiGrid: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  kpiCard: {
    flex: 1, backgroundColor: '#fff', borderRadius: 12,
    padding: 12, alignItems: 'center', borderWidth: 1
  },
  kpiLabel: { fontSize: 10, color: '#888', marginBottom: 4 },
  kpiVal: { fontSize: 14, fontWeight: '600', color: '#1a1a1a', textAlign: 'center' },
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
  shiftDonnees: { borderTopWidth: 0.5, borderTopColor: '#f5f5f5', paddingTop: 8, marginBottom: 10 },
  shiftRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 4, borderBottomWidth: 0.5, borderBottomColor: '#f9f9f9'
  },
  shiftLabel: { fontSize: 12, color: '#888' },
  shiftVal: { fontSize: 12, fontWeight: '500', color: '#1a1a1a' },
  photosShiftTitre: { fontSize: 11, fontWeight: '600', color: '#534AB7', marginBottom: 8 },
  photosGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  photoVignette: {
    width: '30%', backgroundColor: '#fff', borderRadius: 10,
    padding: 6, alignItems: 'center', borderWidth: 0.5, borderColor: '#eee'
  },
  photoVignetteManquante: { backgroundColor: '#FAECE7', borderColor: '#F09595' },
  photoThumb: { width: '100%', height: 70, borderRadius: 8, marginBottom: 4 },
  photoAbsente: {
    width: '100%', height: 70, borderRadius: 8,
    backgroundColor: '#f9f9f9', alignItems: 'center', justifyContent: 'center', marginBottom: 4
  },
  photoAbsenteIcon: { fontSize: 24 },
  photoLabel: { fontSize: 9, color: '#3B6D11', textAlign: 'center', fontWeight: '500' },
  photoMontant: { fontSize: 8, color: '#888', textAlign: 'center', marginTop: 2 },
  photoTapTxt: { fontSize: 8, color: '#534AB7', textAlign: 'center', marginTop: 1 },
  listCard: {
    backgroundColor: '#fff', borderRadius: 14, padding: 14,
    marginBottom: 14, borderWidth: 0.5, borderColor: '#eee'
  },
  listRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: '#f5f5f5'
  },
  listLeft: { flex: 1, flexDirection: 'column', gap: 2 },
  listRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  listLabel: { fontSize: 13, fontWeight: '500', color: '#1a1a1a' },
  listSub: { fontSize: 11, color: '#888', marginTop: 2 },
  listVal: { fontSize: 13, fontWeight: '600', color: '#1a1a1a' },
  listTotalRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingTop: 10, marginTop: 4, borderTopWidth: 1, borderTopColor: '#eee'
  },
  listTotalLabel: { fontSize: 13, fontWeight: '600', color: '#1a1a1a' },
  listTotalVal: { fontSize: 15, fontWeight: '700', color: '#EF9F27' },
  seqBadge: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: '#FAEEDA', alignItems: 'center', justifyContent: 'center'
  },
  seqBadgeTxt: { fontSize: 11, fontWeight: '600', color: '#854F0B' },
  miniThumb: { width: 40, height: 40, borderRadius: 6 },
  miniThumbAbsent: {
    width: 40, height: 40, borderRadius: 6,
    backgroundColor: '#FAECE7', alignItems: 'center', justifyContent: 'center'
  },
  statutPresenceBadge: {
    paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: 10, alignSelf: 'flex-start', marginTop: 3
  },
  statutPresenceTxt: { fontSize: 10, fontWeight: '500' },
  emptySection: {
    backgroundColor: '#f9f9f9', borderRadius: 10,
    padding: 14, alignItems: 'center', marginBottom: 14
  },
  emptySectionTxt: { fontSize: 13, color: '#888' },
  verifierBtn: {
    backgroundColor: '#534AB7', borderRadius: 14, padding: 16,
    alignItems: 'center', marginBottom: 10, marginTop: 6
  },
  verifierBtnTxt: { fontSize: 15, fontWeight: '600', color: '#fff' },
  verifierBtnSub: { fontSize: 11, color: '#CECBF6', marginTop: 4 },
  photoModalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.95)',
    flexDirection: 'column', paddingTop: 50, paddingBottom: 30,
  },
  photoModalClose: {
    alignSelf: 'flex-end', paddingHorizontal: 20, paddingBottom: 10,
  },
  photoModalCloseTxt: { fontSize: 28, color: '#fff', fontWeight: '300' },
  photoModalLabel: {
    fontSize: 15, fontWeight: '600', color: '#fff',
    textAlign: 'center', paddingHorizontal: 20, marginBottom: 10,
  },
  photoModalImgWrapper: {
    flex: 1, width: '100%',
  },
  photoModalImg: { flex: 1, width: '100%' },
  photoModalFermer: {
    backgroundColor: '#534AB7', marginHorizontal: 40, marginTop: 16,
    padding: 14, borderRadius: 14, alignItems: 'center'
  },
  photoModalFermerTxt: { fontSize: 14, fontWeight: '600', color: '#fff' },
})