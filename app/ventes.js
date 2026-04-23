import { router } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
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

export default function VentesScreen() {
  const {
    pointId, pointValide, estBloque,
    ventesJour, setVentesJour,
    resteEspeces, fc, beneficeSC,
    roleActif, restaurantId,
    depensesGerantCaisse, setDepensesGerantCaisse,
    fournisseursGerantCaisse, setFournisseursGerantCaisse,
    totalDepensesGerantCaisse,
  } = useApp()

  const { prendrePhoto, choisirPhoto } = usePhoto()

  const [etape, setEtape] = useState(1)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [photosAlertVisible, setPhotosAlertVisible] = useState(false)
  const [photoModalVisible, setPhotoModalVisible] = useState(false)
  const [chargementShifts, setChargementShifts] = useState(false)
  const [cumulShifts, setCumulShifts] = useState(null)
  const [sectionsOuvertes, setSectionsOuvertes] = useState(new Set())
  const [fournisseursList, setFournisseursList] = useState([])
  const photoPickerRef = useRef({ champOuSetter: '', dossier: '' })

  const isGerant = roleActif === 'gerant'
  const isManager = roleActif === 'manager'
  const bloque = estBloque(pointValide)

  useEffect(() => {
    if ((isGerant || isManager) && pointId) chargerCumulShifts()
  }, [pointId])

  async function chargerCumulShifts() {
    setChargementShifts(true)

    const { data: shifts } = await supabase
      .from('points_shifts')
      .select('*')
      .eq('point_id', pointId)

    if (shifts && shifts.length > 0) {
      const cumul = {
        yangoCse: shifts.reduce((s, sh) => s + (sh.yango_cse || 0), 0),
        glovoCse: shifts.reduce((s, sh) => s + (sh.glovo_cse || 0), 0),
        wave: shifts.reduce((s, sh) => s + (sh.wave || 0), 0),
        djamo: shifts.reduce((s, sh) => s + (sh.djamo || 0), 0),
        om: shifts.reduce((s, sh) => s + (sh.om || 0), 0),
        kdo: shifts.reduce((s, sh) => s + (sh.kdo || 0), 0),
        retour: shifts.reduce((s, sh) => s + (sh.retour || 0), 0),
        depenses: shifts.reduce((s, sh) => s + (sh.depenses || 0), 0),
        fournisseurs: shifts.reduce((s, sh) => s + (sh.fournisseurs || 0), 0),
        espece: shifts.reduce((s, sh) => s + (sh.espece || 0), 0),
        venteTotal: shifts.reduce((s, sh) => s + (sh.vente_shift || 0), 0),
        nbShifts: shifts.length,
      }
      setCumulShifts(cumul)

      // Charger le FC de la veille depuis le dernier point validé
      const { data: pointPrec } = await supabase
        .from('points')
        .select('reste_fc')
        .eq('restaurant_id', restaurantId)
        .eq('valide', true)
        .neq('id', pointId)
        .order('date', { ascending: false })
        .limit(1)
        .single()

      const fcVeille = pointPrec?.reste_fc || 0

      setVentesJour(prev => ({
        ...prev,
        yangoCse: String(cumul.yangoCse || ''),
        glovoCse: String(cumul.glovoCse || ''),
        wave: String(cumul.wave || ''),
        djamo: String(cumul.djamo || ''),
        om: String(cumul.om || ''),
        kdo: String(cumul.kdo || ''),
        retour: String(cumul.retour || ''),
        fcVeille: String(fcVeille || ''),
        espece_shifts: cumul.espece,
      }))
    }

    // Charger la liste des fournisseurs du restaurant
    const { data: fours } = await supabase
      .from('fournisseurs')
      .select('id, nom')
      .eq('restaurant_id', restaurantId)
      .order('nom')
    setFournisseursList(fours || [])

    setChargementShifts(false)
  }

  function toggleSection(key) {
    setSectionsOuvertes(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function ajouterLigneDep(cat) {
    setDepensesGerantCaisse(prev => ({
      ...prev,
      [cat]: [...(prev[cat] || []), { id: Date.now().toString(), description: '', montant: '', photoUri: null }]
    }))
  }

  function supprimerLigneDep(cat, index) {
    setDepensesGerantCaisse(prev => ({
      ...prev,
      [cat]: (prev[cat] || []).filter((_, i) => i !== index)
    }))
  }

  function updateLigneDep(cat, index, champ, valeur) {
    setDepensesGerantCaisse(prev => ({
      ...prev,
      [cat]: (prev[cat] || []).map((l, i) => i === index ? { ...l, [champ]: valeur } : l)
    }))
  }

  function updateFournisseurGerant(fourId, fourNom, champ, valeur) {
    setFournisseursGerantCaisse(prev => ({
      ...prev,
      [fourId]: { ...prev[fourId], nom: fourNom, [champ]: valeur }
    }))
  }

  function setVente(champ, valeur) {
    if (bloque && !isManager) return
    setVentesJour(prev => ({ ...prev, [champ]: valeur }))
  }

  function setPhoto(champ, uri) {
    setVentesJour(prev => ({ ...prev, [champ]: uri }))
  }

  function gererPhoto(champOuSetter, dossier) {
    if (bloque && !isManager) return
    photoPickerRef.current = { champOuSetter, dossier }
    setPhotoModalVisible(true)
  }

  async function selectionnerPhoto(source) {
    setPhotoModalVisible(false)
    const { champOuSetter, dossier } = photoPickerRef.current
    setUploading(true)
    try {
      const url = source === 'camera'
        ? await prendrePhoto(dossier)
        : await choisirPhoto(dossier)
      if (url) {
        if (typeof champOuSetter === 'function') champOuSetter(url)
        else setPhoto(champOuSetter, url)
      }
    } finally {
      setUploading(false)
    }
  }

  function fmt(n) { return Math.round(n).toLocaleString('fr-FR') + ' FCFA' }

  function verifierPhotosObligatoires() {
    const manquantes = []
    if (parseFloat(ventesJour.yangoTab) > 0 && !ventesJour.photo_yango_tab) manquantes.push('Yango TAB')
    if (parseFloat(ventesJour.glovoTab) > 0 && !ventesJour.photo_glovo_tab) manquantes.push('Glovo TAB')
    if ((isGerant || isManager) && parseFloat(ventesJour.venteMachine) > 0 && !ventesJour.photoVenteMachine) {
      manquantes.push('Photo vente machine')
    }
    return manquantes
  }

  async function sauvegarderPhotosPoints() {
    if (!pointId) return
    const updates = {}
    const photos = ['photo_yango_tab', 'photo_glovo_tab']
    photos.forEach(p => { if (ventesJour[p]) updates[p] = ventesJour[p] })
    if (ventesJour.photoVenteMachine) updates.photo_vente_machine = ventesJour.photoVenteMachine
    if (ventesJour.venteMachine !== '') {
      updates.vente_machine = parseFloat(ventesJour.venteMachine) || 0
      const venteTheo = cumulShifts?.venteTotal || 0
      updates.ecart_caisse = venteTheo - (parseFloat(ventesJour.venteMachine) || 0)
    }
    if (Object.keys(updates).length > 0) {
      await supabase.from('points').update(updates).eq('id', pointId)
    }
  }

  async function allerAuRecap() {
    if (!pointId) { Alert.alert('Erreur', 'Aucun point actif'); return }
    if (!isManager) {
      const manquantes = verifierPhotosObligatoires()
      if (manquantes.length > 0) {
        setPhotosAlertVisible(true)
        return
      }
    }
    await sauvegarderEtContinuer()
  }

  async function sauvegarderEtContinuer() {
    setSaving(true)
    await sauvegarderPhotosPoints()
    setSaving(false)
    router.push('/recap-point')
  }

  // ─── Composant Photo ───────────────────────────────────────
  function PhotoBlock({ champ, label, dossier, obligatoireSi = true }) {
    const uri = ventesJour[champ]
    const aPhoto = !!uri
    const estRequis = obligatoireSi && !aPhoto
    return (
      <View style={[styles.photoBlock, estRequis && styles.photoBlockRequired]}>
        <View style={styles.photoBlockHeader}>
          <Text style={styles.photoBlockLabel}>
            📷 {label}
            {obligatoireSi && <Text style={{ color: '#A32D2D' }}> *</Text>}
          </Text>
          {aPhoto ? (
            <View style={styles.photoBadgeOk}><Text style={styles.photoBadgeOkTxt}>✅ OK</Text></View>
          ) : obligatoireSi ? (
            <View style={styles.photoBadgeReq}><Text style={styles.photoBadgeReqTxt}>⚠️ Requis</Text></View>
          ) : null}
        </View>
        {uri && <Image source={{ uri }} style={styles.photoPreview} resizeMode="cover" />}
        {(!bloque || isManager) && (
          <TouchableOpacity style={styles.photoBtn} onPress={() => gererPhoto(champ, dossier)} disabled={uploading}>
            {uploading ? (
              <ActivityIndicator size="small" color="#412402" />
            ) : (
              <Text style={styles.photoBtnTxt}>{aPhoto ? '🔄 Changer la photo' : '📷 Ajouter une photo'}</Text>
            )}
          </TouchableOpacity>
        )}
      </View>
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
          <Text style={styles.headerTitre}>Saisie des ventes</Text>
          <Text style={styles.headerSub}>
            {etape === 1 ? 'Étape 1 — Livraisons TAB' : 'Étape 2 — Résultats'}
          </Text>
        </View>
        <View style={{ width: 60 }} />
      </View>

      {/* Barre progression */}
      <View style={styles.progressBar}>
        {[1, 2].map(i => (
          <TouchableOpacity key={i} style={styles.progressItem} onPress={() => setEtape(i)}>
            <View style={[styles.progressNum, etape >= i && styles.progressNumActive]}>
              <Text style={[styles.progressNumTxt, etape >= i && styles.progressNumTxtActive]}>
                {etape > i ? '✓' : i}
              </Text>
            </View>
            <Text style={[styles.progressLabel, etape === i && styles.progressLabelActive]}>
              {i === 1 ? 'TAB' : 'Résultats'}
            </Text>
            {i < 2 && <View style={[styles.progressLine, etape > i && styles.progressLineActive]} />}
          </TouchableOpacity>
        ))}
      </View>

      {pointValide && !isManager && (
        <View style={styles.valideBanner}>
          <Text style={styles.valideTxt}>🔒 Point validé — lecture seule</Text>
        </View>
      )}

      {(isGerant || isManager) && cumulShifts && (
        <View style={styles.cumulBanner}>
          <Text style={styles.cumulBannerTxt}>
            📊 {cumulShifts.nbShifts} shift(s) validé(s) — Vente : {fmt(cumulShifts.venteTotal)}
          </Text>
        </View>
      )}

      {chargementShifts && (
        <View style={styles.chargementBanner}>
          <ActivityIndicator size="small" color="#EF9F27" />
          <Text style={styles.chargementTxt}>Chargement des shifts et FC veille...</Text>
        </View>
      )}

      {uploading && (
        <View style={styles.uploadBanner}>
          <ActivityIndicator size="small" color="#fff" />
          <Text style={styles.uploadTxt}>Upload de la photo en cours...</Text>
        </View>
      )}

      <ScrollView style={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

        {/* ══════════════════════════════════════════
            ÉTAPE 1 — Livraisons TAB
        ══════════════════════════════════════════ */}
        {etape === 1 && (
          <>
            {(isGerant || isManager) && cumulShifts && (
              <View style={styles.infoShiftsCard}>
                <Text style={styles.infoShiftsTitre}>
                  📊 {cumulShifts.nbShifts} shift(s) déjà intégrés
                </Text>
                <Text style={styles.infoShiftsTxt}>
                  Yango/Glovo CSE, Wave, OM, Djamo, KDO, Retours et espèces sont pré-chargés depuis les shifts caissiers.
                  Seuls les canaux TAB restent à saisir.
                </Text>
              </View>
            )}

            <Text style={styles.sectionTitre}>À saisir manuellement</Text>
            <Text style={styles.sectionSub}>
              Seuls ces canaux ne sont pas dans les shifts
            </Text>

            {/* Yango TAB */}
            <View style={styles.canalCard}>
              <View style={styles.canalHeader}>
                <Text style={styles.canalTitre}>🛵 Yango TAB</Text>
                <Text style={styles.canalCoeff}>×0,77</Text>
              </View>
              <View style={styles.inputRow}>
                <Text style={styles.inputLabel}>Montant (FCFA)</Text>
                <TextInput
                  style={styles.inputField}
                  value={ventesJour.yangoTab || ''}
                  onChangeText={v => setVente('yangoTab', v)}
                  keyboardType="numeric"
                  placeholder="0"
                  placeholderTextColor="#bbb"
                  editable={!bloque || isManager}
                />
              </View>
              <View style={styles.inputRow}>
                <Text style={styles.inputLabel}>Nb commandes</Text>
                <TextInput
                  style={styles.inputField}
                  value={ventesJour.yangoNbCommandes || ''}
                  onChangeText={v => setVente('yangoNbCommandes', v)}
                  keyboardType="numeric"
                  placeholder="0"
                  placeholderTextColor="#bbb"
                  editable={!bloque || isManager}
                />
              </View>
              <PhotoBlock
                champ="photo_yango_tab"
                label="Photo Yango TAB"
                dossier="yango_tab"
                obligatoireSi={parseFloat(ventesJour.yangoTab) > 0}
              />
            </View>

            {/* Glovo TAB */}
            <View style={styles.canalCard}>
              <View style={styles.canalHeader}>
                <Text style={styles.canalTitre}>🛵 Glovo TAB</Text>
                <Text style={styles.canalCoeff}>×0,705</Text>
              </View>
              <View style={styles.inputRow}>
                <Text style={styles.inputLabel}>Montant (FCFA)</Text>
                <TextInput
                  style={styles.inputField}
                  value={ventesJour.glovoTab || ''}
                  onChangeText={v => setVente('glovoTab', v)}
                  keyboardType="numeric"
                  placeholder="0"
                  placeholderTextColor="#bbb"
                  editable={!bloque || isManager}
                />
              </View>
              <View style={styles.inputRow}>
                <Text style={styles.inputLabel}>Nb commandes</Text>
                <TextInput
                  style={styles.inputField}
                  value={ventesJour.glovoNbCommandes || ''}
                  onChangeText={v => setVente('glovoNbCommandes', v)}
                  keyboardType="numeric"
                  placeholder="0"
                  placeholderTextColor="#bbb"
                  editable={!bloque || isManager}
                />
              </View>
              <PhotoBlock
                champ="photo_glovo_tab"
                label="Photo Glovo TAB"
                dossier="glovo_tab"
                obligatoireSi={parseFloat(ventesJour.glovoTab) > 0}
              />
            </View>

            {/* Récap shifts en lecture seule */}
            {(isGerant || isManager) && cumulShifts && (
              <>
                <Text style={styles.sectionTitre}>Récap shifts (auto)</Text>
                <View style={styles.recapShiftsCard}>
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
                    <View key={i} style={styles.recapRow}>
                      <Text style={styles.recapLabel}>{r.label}</Text>
                      <Text style={styles.recapVal}>{fmt(r.val)}</Text>
                    </View>
                  ))}
                  <View style={[styles.recapRow, {
                    borderBottomWidth: 0, marginTop: 6, paddingTop: 6,
                    borderTopWidth: 1, borderTopColor: '#EF9F27'
                  }]}>
                    <Text style={[styles.recapLabel, { fontWeight: '700', color: '#412402' }]}>
                      Vente shifts total
                    </Text>
                    <Text style={[styles.recapVal, { fontWeight: '700', color: '#EF9F27', fontSize: 15 }]}>
                      {fmt(cumulShifts.venteTotal)}
                    </Text>
                  </View>
                </View>
              </>
            )}

            <TouchableOpacity style={styles.nextBtn} onPress={() => setEtape(2)}>
              <Text style={styles.nextTxt}>Voir les résultats ›</Text>
            </TouchableOpacity>
          </>
        )}

        {/* ══════════════════════════════════════════
            ÉTAPE 2 — Résultats
        ══════════════════════════════════════════ */}
        {etape === 2 && (
          <>
            {/* Fond de caisse */}
            <Text style={styles.sectionTitre}>Fond de caisse</Text>
            <View style={styles.fcCard}>
              <View style={styles.fcRow}>
                <View style={styles.fcRowLeft}>
                  <Text style={styles.fcLabel}>FC de la veille</Text>
                  <View style={styles.autoBadge}><Text style={styles.autoBadgeTxt}>Auto</Text></View>
                </View>
                <Text style={styles.fcValAuto}>{fmt(parseFloat(ventesJour.fcVeille) || 0)}</Text>
              </View>

              <View style={styles.fcRow}>
                <View style={styles.fcRowLeft}>
                  <Text style={styles.fcLabel}>Espèces en caisse</Text>
                  <View style={styles.autoBadge}><Text style={styles.autoBadgeTxt}>Shifts</Text></View>
                </View>
                <Text style={styles.fcValAuto}>{fmt(resteEspeces())}</Text>
              </View>

              <View style={styles.fcRow}>
                <View style={styles.fcRowLeft}>
                  <Text style={[styles.fcLabel, { fontWeight: '600', color: '#534AB7' }]}>FC calculé</Text>
                  <View style={[styles.autoBadge, { backgroundColor: '#EEEDFE' }]}>
                    <Text style={[styles.autoBadgeTxt, { color: '#534AB7' }]}>espèces + veille</Text>
                  </View>
                </View>
                <Text style={[styles.fcValAuto, { fontWeight: '700', color: '#534AB7', fontSize: 15 }]}>
                  {fmt(fc())}
                </Text>
              </View>

              <View style={[styles.fcRow, { borderBottomWidth: 0, alignItems: 'flex-start', paddingTop: 14 }]}>
                <View style={styles.fcRowLeft}>
                  <Text style={[styles.fcLabel, { fontWeight: '600', color: '#1a1a1a' }]}>FC saisi</Text>
                  <Text style={{ fontSize: 10, color: '#888', marginTop: 2 }}>
                    Montant réel en caisse (peut être négatif)
                  </Text>
                </View>
                <TextInput
                  style={styles.fcInput}
                  value={ventesJour.fc_actuel || ''}
                  onChangeText={v => setVente('fc_actuel', v)}
                  keyboardType="numbers-and-punctuation"
                  placeholder="Saisir..."
                  placeholderTextColor="#bbb"
                  editable={!bloque || isManager}
                />
              </View>

              {/* Écart FC */}
              {ventesJour.fc_actuel !== '' && ventesJour.fc_actuel !== undefined && (
                (() => {
                  const ecart = (parseFloat(ventesJour.fc_actuel) || 0) - fc()
                  const ok = Math.abs(ecart) < 500
                  return (
                    <View style={[styles.ecartBanner, {
                      backgroundColor: ok ? '#EAF3DE' : '#FAECE7',
                      borderColor: ok ? '#3B6D11' : '#A32D2D',
                    }]}>
                      <Text style={[styles.ecartTxt, { color: ok ? '#3B6D11' : '#A32D2D' }]}>
                        {ok ? '✅' : '⚠️'} Écart FC : {ecart >= 0 ? '+' : ''}{fmt(ecart)}
                      </Text>
                    </View>
                  )
                })()
              )}
            </View>

            {/* Bénéfice SC */}
            <Text style={styles.sectionTitre}>Bénéfice SC</Text>
            <View style={styles.beneficeCard}>
              {[
                { label: 'Yango TAB ×0.77', val: (parseFloat(ventesJour.yangoTab) || 0) * 0.77 },
                { label: 'Glovo TAB ×0.705', val: (parseFloat(ventesJour.glovoTab) || 0) * 0.705 },
                { label: 'Wave ×0.99', val: (parseFloat(ventesJour.wave) || 0) * 0.99 },
                { label: 'Orange Money ×0.99', val: (parseFloat(ventesJour.om) || 0) * 0.99 },
                { label: 'Djamo ×0.99', val: (parseFloat(ventesJour.djamo) || 0) * 0.99 },
                { label: 'Espèces en caisse', val: resteEspeces() },
              ].filter(r => r.val > 0).map((r, i) => (
                <View key={i} style={styles.beneficeRow}>
                  <Text style={styles.beneficeLabel}>{r.label}</Text>
                  <Text style={styles.beneficeVal}>{fmt(r.val)}</Text>
                </View>
              ))}
              <View style={[styles.beneficeRow, {
                borderBottomWidth: 0, marginTop: 8, paddingTop: 8,
                borderTopWidth: 1.5, borderTopColor: '#3B6D11'
              }]}>
                <Text style={[styles.beneficeLabel, { fontWeight: '700', color: '#1a1a1a', fontSize: 14 }]}>
                  Bénéfice SC total
                </Text>
                <Text style={[styles.beneficeVal, { fontWeight: '700', color: '#3B6D11', fontSize: 18 }]}>
                  {fmt(beneficeSC())}
                </Text>
              </View>
            </View>

            {/* ── Dépenses caisse gérant ── */}
            {(isGerant || isManager) && (
              <>
                <Text style={styles.sectionTitre}>Dépenses caisse gérant</Text>
                <Text style={styles.sectionSub}>
                  Prélevées sur les espèces — chaque ligne doit être justifiée par une photo
                </Text>

                {/* Bande Fournisseurs */}
                <TouchableOpacity style={styles.bandHeader} onPress={() => toggleSection('fournisseurs')}>
                  <Text style={styles.bandTitre}>🏪 Fournisseurs</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    {Object.keys(fournisseursGerantCaisse).length > 0 && (
                      <Text style={styles.bandCount}>{Object.keys(fournisseursGerantCaisse).length} saisie(s)</Text>
                    )}
                    <Text style={styles.bandChevron}>{sectionsOuvertes.has('fournisseurs') ? '▲' : '▼'}</Text>
                  </View>
                </TouchableOpacity>

                {sectionsOuvertes.has('fournisseurs') && (
                  <View style={styles.bandContent}>
                    {fournisseursList.length === 0 ? (
                      <Text style={styles.bandVide}>Aucun fournisseur enregistré pour ce restaurant</Text>
                    ) : (
                      fournisseursList.map(four => {
                        const data = fournisseursGerantCaisse[four.id] || {}
                        const fourOpen = sectionsOuvertes.has(`four_${four.id}`)
                        return (
                          <View key={four.id}>
                            <TouchableOpacity style={styles.fourRow} onPress={() => toggleSection(`four_${four.id}`)}>
                              <Text style={styles.fourNom}>{four.nom}</Text>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                {data.paye ? (
                                  <Text style={styles.fourMontant}>{fmt(parseFloat(data.paye) || 0)}</Text>
                                ) : null}
                                {data.photoUri && <Text style={{ fontSize: 12 }}>📷</Text>}
                                <Text style={styles.bandChevron}>{fourOpen ? '▲' : '▼'}</Text>
                              </View>
                            </TouchableOpacity>
                            {fourOpen && (
                              <View style={styles.fourDetails}>
                                <TextInput
                                  style={styles.depInput}
                                  value={data.facture || ''}
                                  onChangeText={v => updateFournisseurGerant(four.id, four.nom, 'facture', v)}
                                  placeholder="N° facture / référence"
                                  placeholderTextColor="#bbb"
                                />
                                <TextInput
                                  style={styles.depInput}
                                  value={data.paye || ''}
                                  onChangeText={v => updateFournisseurGerant(four.id, four.nom, 'paye', v)}
                                  keyboardType="numeric"
                                  placeholder="Montant payé (FCFA)"
                                  placeholderTextColor="#bbb"
                                />
                                <View style={[styles.photoBlock,
                                  parseFloat(data.paye) > 0 && !data.photoUri && styles.photoBlockRequired
                                ]}>
                                  <View style={styles.photoBlockHeader}>
                                    <Text style={styles.photoBlockLabel}>
                                      📷 Justificatif
                                      {parseFloat(data.paye) > 0 && <Text style={{ color: '#A32D2D' }}> *</Text>}
                                    </Text>
                                    {data.photoUri ? (
                                      <View style={styles.photoBadgeOk}><Text style={styles.photoBadgeOkTxt}>✅ OK</Text></View>
                                    ) : parseFloat(data.paye) > 0 ? (
                                      <View style={styles.photoBadgeReq}><Text style={styles.photoBadgeReqTxt}>⚠️ Requis</Text></View>
                                    ) : null}
                                  </View>
                                  {data.photoUri && (
                                    <Image source={{ uri: data.photoUri }} style={styles.photoPreview} resizeMode="cover" />
                                  )}
                                  <TouchableOpacity
                                    style={styles.photoBtn}
                                    onPress={() => gererPhoto(url => updateFournisseurGerant(four.id, four.nom, 'photoUri', url), 'depenses-gerant')}
                                    disabled={uploading}
                                  >
                                    <Text style={styles.photoBtnTxt}>
                                      {data.photoUri ? '🔄 Changer la photo' : '📷 Ajouter une photo'}
                                    </Text>
                                  </TouchableOpacity>
                                </View>
                              </View>
                            )}
                          </View>
                        )
                      })
                    )}
                  </View>
                )}

                {/* Bandes catégories */}
                {[
                  { key: 'Marché', emoji: '🛒' },
                  { key: 'Légumes', emoji: '🥦' },
                  { key: 'Fruits', emoji: '🍊' },
                  { key: 'Dépenses annexes', emoji: '📦' },
                ].map(({ key, emoji }) => {
                  const lignes = depensesGerantCaisse[key] || []
                  const isOpen = sectionsOuvertes.has(key)
                  return (
                    <View key={key}>
                      <TouchableOpacity style={styles.bandHeader} onPress={() => toggleSection(key)}>
                        <Text style={styles.bandTitre}>{emoji} {key}</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          {lignes.length > 0 && (
                            <Text style={styles.bandCount}>{lignes.length} ligne(s)</Text>
                          )}
                          <Text style={styles.bandChevron}>{isOpen ? '▲' : '▼'}</Text>
                        </View>
                      </TouchableOpacity>
                      {isOpen && (
                        <View style={styles.bandContent}>
                          {lignes.map((ligne, i) => (
                            <View key={ligne.id || i} style={styles.ligneDepCard}>
                              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                                <Text style={styles.ligneDepNum}>Ligne {i + 1}</Text>
                                <TouchableOpacity onPress={() => supprimerLigneDep(key, i)}>
                                  <Text style={{ color: '#993C1D', fontSize: 12, fontWeight: '500' }}>✕ Supprimer</Text>
                                </TouchableOpacity>
                              </View>
                              <TextInput
                                style={styles.depInput}
                                value={ligne.description || ''}
                                onChangeText={v => updateLigneDep(key, i, 'description', v)}
                                placeholder="Description"
                                placeholderTextColor="#bbb"
                              />
                              <TextInput
                                style={styles.depInput}
                                value={ligne.montant || ''}
                                onChangeText={v => updateLigneDep(key, i, 'montant', v)}
                                keyboardType="numeric"
                                placeholder="Montant (FCFA)"
                                placeholderTextColor="#bbb"
                              />
                              <View style={[styles.photoBlock,
                                parseFloat(ligne.montant) > 0 && !ligne.photoUri && styles.photoBlockRequired
                              ]}>
                                <View style={styles.photoBlockHeader}>
                                  <Text style={styles.photoBlockLabel}>
                                    📷 Justificatif
                                    {parseFloat(ligne.montant) > 0 && <Text style={{ color: '#A32D2D' }}> *</Text>}
                                  </Text>
                                  {ligne.photoUri ? (
                                    <View style={styles.photoBadgeOk}><Text style={styles.photoBadgeOkTxt}>✅ OK</Text></View>
                                  ) : parseFloat(ligne.montant) > 0 ? (
                                    <View style={styles.photoBadgeReq}><Text style={styles.photoBadgeReqTxt}>⚠️ Requis</Text></View>
                                  ) : null}
                                </View>
                                {ligne.photoUri && (
                                  <Image source={{ uri: ligne.photoUri }} style={styles.photoPreview} resizeMode="cover" />
                                )}
                                <TouchableOpacity
                                  style={styles.photoBtn}
                                  onPress={() => gererPhoto(url => updateLigneDep(key, i, 'photoUri', url), 'depenses-gerant')}
                                  disabled={uploading}
                                >
                                  <Text style={styles.photoBtnTxt}>
                                    {ligne.photoUri ? '🔄 Changer la photo' : '📷 Ajouter une photo'}
                                  </Text>
                                </TouchableOpacity>
                              </View>
                            </View>
                          ))}
                          <TouchableOpacity style={styles.ajouterLigneBtn} onPress={() => ajouterLigneDep(key)}>
                            <Text style={styles.ajouterLigneTxt}>+ Ajouter une ligne</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  )
                })}

                {/* Total dépenses gérant */}
                {totalDepensesGerantCaisse() > 0 && (
                  <View style={styles.totalDepGerantCard}>
                    <Text style={styles.totalDepGerantLabel}>Total dépenses gérant caisse</Text>
                    <Text style={styles.totalDepGerantVal}>− {fmt(totalDepensesGerantCaisse())}</Text>
                  </View>
                )}
              </>
            )}

            {/* Vente machine */}
            {(isGerant || isManager) && (
              <>
                <Text style={styles.sectionTitre}>Vente machine</Text>
                <View style={styles.venteMachineCard}>
                  {/* Vente théorique */}
                  {cumulShifts && (
                    <View style={styles.vmRow}>
                      <View style={styles.vmRowLeft}>
                        <Text style={styles.vmLabel}>Vente théorique</Text>
                        <View style={styles.autoBadge}><Text style={styles.autoBadgeTxt}>Shifts</Text></View>
                      </View>
                      <Text style={styles.vmValAuto}>{fmt(cumulShifts.venteTotal)}</Text>
                    </View>
                  )}

                  {/* Saisie vente machine */}
                  <View style={[styles.vmRow, { alignItems: 'flex-start', paddingTop: 14 }]}>
                    <View style={styles.vmRowLeft}>
                      <Text style={[styles.vmLabel, { fontWeight: '600', color: '#1a1a1a' }]}>
                        Vente machine
                      </Text>
                      <Text style={{ fontSize: 10, color: '#888', marginTop: 2 }}>
                        Montant lu sur la caisse / POS
                      </Text>
                    </View>
                    <TextInput
                      style={styles.vmInput}
                      value={ventesJour.venteMachine || ''}
                      onChangeText={v => setVente('venteMachine', v)}
                      keyboardType="numeric"
                      placeholder="Saisir..."
                      placeholderTextColor="#bbb"
                      editable={!bloque || isManager}
                    />
                  </View>

                  {/* Photo vente machine */}
                  {(!bloque || isManager) && (
                    <View style={[styles.photoBlock,
                      parseFloat(ventesJour.venteMachine) > 0 && !ventesJour.photoVenteMachine && styles.photoBlockRequired
                    ]}>
                      <View style={styles.photoBlockHeader}>
                        <Text style={styles.photoBlockLabel}>
                          📷 Photo vente machine
                          {parseFloat(ventesJour.venteMachine) > 0 && (
                            <Text style={{ color: '#A32D2D' }}> *</Text>
                          )}
                        </Text>
                        {ventesJour.photoVenteMachine ? (
                          <View style={styles.photoBadgeOk}><Text style={styles.photoBadgeOkTxt}>✅ OK</Text></View>
                        ) : parseFloat(ventesJour.venteMachine) > 0 ? (
                          <View style={styles.photoBadgeReq}><Text style={styles.photoBadgeReqTxt}>⚠️ Requis</Text></View>
                        ) : null}
                      </View>
                      {ventesJour.photoVenteMachine && (
                        <Image source={{ uri: ventesJour.photoVenteMachine }} style={styles.photoPreview} resizeMode="cover" />
                      )}
                      <TouchableOpacity
                        style={styles.photoBtn}
                        onPress={() => gererPhoto('photoVenteMachine', 'vente-machine')}
                        disabled={uploading}
                      >
                        {uploading ? (
                          <ActivityIndicator size="small" color="#412402" />
                        ) : (
                          <Text style={styles.photoBtnTxt}>
                            {ventesJour.photoVenteMachine ? '🔄 Changer la photo' : '📷 Ajouter une photo'}
                          </Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  )}

                  {/* Écart */}
                  {ventesJour.venteMachine !== '' && cumulShifts && (() => {
                    const ecart = cumulShifts.venteTotal - (parseFloat(ventesJour.venteMachine) || 0)
                    const parfait = Math.abs(ecart) < 500
                    const surplus = ecart > 0
                    return (
                      <View style={[styles.ecartBanner, {
                        backgroundColor: parfait ? '#EAF3DE' : surplus ? '#E6F1FB' : '#FAECE7',
                        borderColor: parfait ? '#3B6D11' : surplus ? '#185FA5' : '#A32D2D',
                        marginTop: 10,
                      }]}>
                        <Text style={[styles.ecartTxt, {
                          color: parfait ? '#3B6D11' : surplus ? '#185FA5' : '#A32D2D'
                        }]}>
                          {parfait ? '✅ Parfait — ' : surplus ? '📈 Surplus — ' : '📉 Manquant — '}
                          Écart : {ecart >= 0 ? '+' : ''}{fmt(ecart)}
                        </Text>
                      </View>
                    )
                  })()}
                </View>
              </>
            )}

            {/* Statut photos */}
            {!isManager && (() => {
              const manquantes = verifierPhotosObligatoires()
              return (
                <View style={[styles.photosStatutCard, {
                  backgroundColor: manquantes.length === 0 ? '#EAF3DE' : '#FAECE7',
                  borderColor: manquantes.length === 0 ? '#3B6D11' : '#A32D2D',
                }]}>
                  {manquantes.length === 0 ? (
                    <Text style={[styles.photosStatutTxt, { color: '#3B6D11' }]}>
                      ✅ Toutes les photos sont présentes
                    </Text>
                  ) : (
                    <>
                      <Text style={[styles.photosStatutTxt, { color: '#A32D2D', marginBottom: 6 }]}>
                        ⚠️ Photos manquantes ({manquantes.length}) :
                      </Text>
                      {manquantes.map((m, i) => (
                        <Text key={i} style={{ fontSize: 12, color: '#993C1D', marginTop: 2 }}>• {m}</Text>
                      ))}
                    </>
                  )}
                </View>
              )
            })()}

            {(!bloque || isManager) && (
              <TouchableOpacity
                style={[styles.recapBtn, saving && { opacity: 0.6 }]}
                onPress={allerAuRecap}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.recapTxt}>📋 Voir le récapitulatif complet</Text>
                )}
              </TouchableOpacity>
            )}
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Modal choix source photo */}
      <Modal visible={photoModalVisible} transparent animationType="fade">
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmBox}>
            <Text style={styles.confirmTitre}>📷 Ajouter une photo</Text>
            <View style={styles.confirmBtns}>
              <TouchableOpacity style={styles.confirmCancel} onPress={() => setPhotoModalVisible(false)}>
                <Text style={styles.confirmCancelTxt}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmOk} onPress={() => selectionnerPhoto('gallery')}>
                <Text style={styles.confirmOkTxt}>🖼 Galerie</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={photosAlertVisible} transparent animationType="fade">
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmBox}>
            <Text style={styles.confirmTitre}>⚠️ Photos manquantes</Text>
            <Text style={styles.confirmMsg}>
              {verifierPhotosObligatoires().map(m => `• ${m}`).join('\n')}
              {'\n\n'}Veuillez ajouter les photos manquantes.
            </Text>
            <View style={styles.confirmBtns}>
              <TouchableOpacity style={styles.confirmCancel} onPress={() => setPhotosAlertVisible(false)}>
                <Text style={styles.confirmCancelTxt}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmOk} onPress={() => { setPhotosAlertVisible(false); sauvegarderEtContinuer() }}>
                <Text style={styles.confirmOkTxt}>Continuer quand même</Text>
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
  progressBar: {
    flexDirection: 'row', backgroundColor: '#fff', padding: 14,
    borderBottomWidth: 0.5, borderBottomColor: '#eee',
    alignItems: 'center', justifyContent: 'center'
  },
  progressItem: { flexDirection: 'row', alignItems: 'center' },
  progressNum: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: '#f5f5f5',
    alignItems: 'center', justifyContent: 'center', marginRight: 6,
    borderWidth: 0.5, borderColor: '#eee'
  },
  progressNumActive: { backgroundColor: '#EF9F27', borderColor: '#EF9F27' },
  progressNumTxt: { fontSize: 12, fontWeight: '600', color: '#888' },
  progressNumTxtActive: { color: '#412402' },
  progressLine: { width: 40, height: 1.5, backgroundColor: '#eee', marginHorizontal: 6 },
  progressLineActive: { backgroundColor: '#EF9F27' },
  progressLabel: { fontSize: 11, color: '#888', marginRight: 6 },
  progressLabelActive: { color: '#EF9F27', fontWeight: '600' },
  valideBanner: { backgroundColor: '#FAECE7', padding: 10, alignItems: 'center' },
  valideTxt: { fontSize: 12, color: '#993C1D', fontWeight: '500' },
  cumulBanner: {
    backgroundColor: '#EEEDFE', padding: 8, paddingHorizontal: 14,
    borderBottomWidth: 0.5, borderBottomColor: '#CECBF6'
  },
  cumulBannerTxt: { fontSize: 12, color: '#534AB7', fontWeight: '500' },
  chargementBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#f9f9f9', padding: 8, paddingHorizontal: 14
  },
  chargementTxt: { fontSize: 12, color: '#888' },
  uploadBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#534AB7', padding: 8, paddingHorizontal: 14
  },
  uploadTxt: { fontSize: 12, color: '#fff', fontWeight: '500' },
  body: { flex: 1, padding: 16 },
  sectionTitre: {
    fontSize: 12, fontWeight: '600', color: '#888', marginBottom: 6,
    textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 8
  },
  sectionSub: { fontSize: 12, color: '#aaa', marginBottom: 12 },
  infoShiftsCard: {
    backgroundColor: '#EEEDFE', borderRadius: 12, padding: 14,
    marginBottom: 14, borderWidth: 0.5, borderColor: '#CECBF6'
  },
  infoShiftsTitre: { fontSize: 13, fontWeight: '600', color: '#534AB7', marginBottom: 6 },
  infoShiftsTxt: { fontSize: 12, color: '#534AB7', lineHeight: 18 },
  canalCard: {
    backgroundColor: '#fff', borderRadius: 14, padding: 14,
    marginBottom: 12, borderWidth: 0.5, borderColor: '#eee'
  },
  canalHeader: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 10
  },
  canalTitre: { fontSize: 14, fontWeight: '600', color: '#1a1a1a' },
  canalCoeff: {
    fontSize: 12, color: '#888', backgroundColor: '#f5f5f5',
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8
  },
  inputRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', paddingVertical: 8,
    borderBottomWidth: 0.5, borderBottomColor: '#f5f5f5'
  },
  inputLabel: { fontSize: 13, color: '#555', flex: 1 },
  inputField: {
    width: 130, backgroundColor: '#f5f5f5', borderRadius: 8,
    padding: 8, fontSize: 14, color: '#1a1a1a', textAlign: 'right'
  },
  photoBlock: {
    marginTop: 10, backgroundColor: '#f9f9f9',
    borderRadius: 10, padding: 10, borderWidth: 0.5, borderColor: '#eee'
  },
  photoBlockRequired: { backgroundColor: '#FAECE7', borderColor: '#F09595' },
  photoBlockHeader: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 8
  },
  photoBlockLabel: { fontSize: 12, color: '#555', fontWeight: '500' },
  photoBadgeOk: { backgroundColor: '#EAF3DE', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  photoBadgeOkTxt: { fontSize: 10, color: '#3B6D11', fontWeight: '500' },
  photoBadgeReq: { backgroundColor: '#FAECE7', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  photoBadgeReqTxt: { fontSize: 10, color: '#993C1D', fontWeight: '500' },
  photoPreview: { width: '100%', height: 140, borderRadius: 10, marginBottom: 8 },
  photoBtn: { backgroundColor: '#EF9F27', borderRadius: 10, padding: 10, alignItems: 'center' },
  photoBtnTxt: { fontSize: 13, color: '#412402', fontWeight: '500' },
  recapShiftsCard: {
    backgroundColor: '#FAEEDA', borderRadius: 14, padding: 14,
    marginBottom: 14, borderWidth: 0.5, borderColor: '#EF9F27'
  },
  recapRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 6, borderBottomWidth: 0.5, borderBottomColor: '#F5D9A0'
  },
  recapLabel: { fontSize: 13, color: '#854F0B' },
  recapVal: { fontSize: 13, fontWeight: '500', color: '#412402' },
  nextBtn: {
    backgroundColor: '#EF9F27', borderRadius: 14,
    padding: 16, alignItems: 'center', marginBottom: 10, marginTop: 4
  },
  nextTxt: { fontSize: 15, fontWeight: '600', color: '#412402' },
  // ── Vente machine ──
  venteMachineCard: {
    backgroundColor: '#fff', borderRadius: 14, padding: 14,
    marginBottom: 14, borderWidth: 0.5, borderColor: '#eee'
  },
  vmRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', paddingVertical: 10,
    borderBottomWidth: 0.5, borderBottomColor: '#f5f5f5'
  },
  vmRowLeft: { flex: 1 },
  vmLabel: { fontSize: 13, color: '#555' },
  vmValAuto: { fontSize: 14, fontWeight: '600', color: '#1a1a1a' },
  vmInput: {
    width: 140, backgroundColor: '#f5f5f5', borderRadius: 10,
    padding: 10, fontSize: 15, color: '#1a1a1a', textAlign: 'right',
    borderWidth: 1, borderColor: '#EF9F27'
  },
  // ── FC ──
  fcCard: {
    backgroundColor: '#fff', borderRadius: 14, padding: 14,
    marginBottom: 14, borderWidth: 0.5, borderColor: '#eee'
  },
  fcRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', paddingVertical: 10,
    borderBottomWidth: 0.5, borderBottomColor: '#f5f5f5'
  },
  fcRowLeft: { flex: 1 },
  fcLabel: { fontSize: 13, color: '#555' },
  fcValAuto: { fontSize: 14, fontWeight: '600', color: '#1a1a1a' },
  fcInput: {
    width: 140, backgroundColor: '#f5f5f5', borderRadius: 10,
    padding: 10, fontSize: 15, color: '#1a1a1a', textAlign: 'right',
    borderWidth: 1, borderColor: '#534AB7'
  },
  autoBadge: {
    backgroundColor: '#EAF3DE', paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 8, alignSelf: 'flex-start', marginTop: 3
  },
  autoBadgeTxt: { fontSize: 9, color: '#3B6D11', fontWeight: '600' },
  ecartBanner: {
    borderRadius: 10, padding: 10, marginTop: 10,
    borderWidth: 1
  },
  ecartTxt: { fontSize: 13, fontWeight: '600' },
  // ── Bénéfice SC ──
  beneficeCard: {
    backgroundColor: '#fff', borderRadius: 14, padding: 14,
    marginBottom: 14, borderWidth: 0.5, borderColor: '#eee'
  },
  beneficeRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 6, borderBottomWidth: 0.5, borderBottomColor: '#f5f5f5'
  },
  beneficeLabel: { fontSize: 13, color: '#555' },
  beneficeVal: { fontSize: 13, fontWeight: '500', color: '#1a1a1a' },
  photosStatutCard: { borderRadius: 12, padding: 14, marginBottom: 14, borderWidth: 1.5 },
  photosStatutTxt: { fontSize: 13, fontWeight: '600' },
  recapBtn: {
    backgroundColor: '#3B6D11', borderRadius: 14,
    padding: 16, alignItems: 'center', marginBottom: 10
  },
  recapTxt: { fontSize: 15, fontWeight: '600', color: '#fff' },
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
    backgroundColor: '#EF9F27', alignItems: 'center'
  },
  confirmOkTxt: { fontSize: 14, fontWeight: '600', color: '#412402' },
  // ── Dépenses gérant caisse ──
  bandHeader: {
    backgroundColor: '#fff', borderRadius: 12, padding: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 2, borderWidth: 0.5, borderColor: '#eee'
  },
  bandTitre: { fontSize: 14, fontWeight: '600', color: '#1a1a1a' },
  bandChevron: { fontSize: 12, color: '#888' },
  bandCount: {
    fontSize: 11, color: '#EF9F27', fontWeight: '600',
    backgroundColor: '#FAEEDA', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10
  },
  bandContent: {
    backgroundColor: '#fafafa', borderRadius: 12, padding: 12,
    marginBottom: 6, borderWidth: 0.5, borderColor: '#eee', borderTopWidth: 0, borderTopLeftRadius: 0, borderTopRightRadius: 0
  },
  bandVide: { fontSize: 12, color: '#bbb', textAlign: 'center', paddingVertical: 12 },
  fourRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: '#eee'
  },
  fourNom: { fontSize: 13, color: '#1a1a1a', fontWeight: '500', flex: 1 },
  fourMontant: { fontSize: 13, color: '#A32D2D', fontWeight: '600' },
  fourDetails: { paddingTop: 10, paddingBottom: 6 },
  depInput: {
    backgroundColor: '#f5f5f5', borderRadius: 10, padding: 11,
    fontSize: 14, color: '#1a1a1a', marginBottom: 8
  },
  ligneDepCard: {
    backgroundColor: '#fff', borderRadius: 10, padding: 12,
    marginBottom: 8, borderWidth: 0.5, borderColor: '#eee'
  },
  ligneDepNum: { fontSize: 12, fontWeight: '600', color: '#888' },
  ajouterLigneBtn: {
    backgroundColor: '#EF9F27', borderRadius: 10, padding: 12,
    alignItems: 'center', marginTop: 6
  },
  ajouterLigneTxt: { fontSize: 13, fontWeight: '600', color: '#412402' },
  totalDepGerantCard: {
    backgroundColor: '#FAECE7', borderRadius: 12, padding: 14,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 8, borderWidth: 1, borderColor: '#F09595'
  },
  totalDepGerantLabel: { fontSize: 13, color: '#993C1D', fontWeight: '500' },
  totalDepGerantVal: { fontSize: 16, fontWeight: '700', color: '#A32D2D' },
})
