import { router } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
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
import { COEFFICIENTS } from '../lib/constants'
import { supabase } from '../lib/supabase'
import { usePhoto } from '../lib/usePhoto'

export default function VentesScreen() {
  const {
    pointId, pointValide, estBloque,
    ventesJour, setVentesJour,
    resteEspeces, fc, beneficeSC,
    roleActif, restaurantId,
  } = useApp()

  const { prendrePhoto, choisirPhoto } = usePhoto()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const [etape, setEtape] = useState(1)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [photosAlertVisible, setPhotosAlertVisible] = useState(false)
  const [chargementShifts, setChargementShifts] = useState(false)
  const [cumulShifts, setCumulShifts] = useState(null)
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

    setChargementShifts(false)
  }

  function setVente(champ, valeur) {
    if (bloque && !isManager) return
    setVentesJour(prev => ({ ...prev, [champ]: valeur }))
  }

  function gererPhoto(setter, dossier) {
    if (bloque && !isManager) return

    async function executer(source) {
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

    if (Platform.OS === 'web') {
      executer('gallery')
    } else {
      Alert.alert(
        'Ajouter une photo',
        'Choisissez la source',
        [
          { text: 'Annuler', style: 'cancel' },
          { text: '📷 Caméra', onPress: () => executer('camera') },
          { text: '🖼 Galerie', onPress: () => executer('gallery') },
        ]
      )
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
    if (ventesJour.explicacionEcartMachine) {
      updates.explication_ecart_machine = ventesJour.explicacionEcartMachine
    }
    if (Object.keys(updates).length > 0) {
      await supabase.from('points').update(updates).eq('id', pointId)
    }
  }

  async function allerAuRecap() {
    if (!pointId) { Alert.alert('Erreur', 'Aucun point actif'); return }
    if (!isManager) {
      // Vérifier explication écart machine obligatoire
      if (cumulShifts && ventesJour.venteMachine !== '') {
        const ecart = Math.abs(cumulShifts.venteTotal - (parseFloat(ventesJour.venteMachine) || 0))
        if (ecart > 0 && (ventesJour.explicacionEcartMachine || '').trim().length < 10) {
          Alert.alert(
            'Explication requise',
            'Un écart a été détecté entre la vente théorique et la vente machine.\n\nVeuillez saisir une explication d\'au moins 10 caractères avant de continuer.'
          )
          return
        }
      }
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
  function PhotoBlock({ uri, setter, label, dossier, obligatoireSi = true }) {
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
          <TouchableOpacity style={styles.photoBtn} onPress={() => gererPhoto(setter, dossier)} disabled={uploading}>
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

      {(isGerant || isManager) && (
        <View style={styles.cumulBanner}>
          <Text style={styles.cumulBannerTxt}>
            {cumulShifts
              ? `📊 ${cumulShifts.nbShifts} shift(s) validé(s) — Vente : ${fmt(cumulShifts.venteTotal)}`
              : '📊 Aucun shift chargé'}
          </Text>
          <TouchableOpacity
            onPress={chargerCumulShifts}
            disabled={chargementShifts}
            style={styles.cumulRefreshBtn}
          >
            <Text style={styles.cumulRefreshTxt}>{chargementShifts ? '...' : '🔄'}</Text>
          </TouchableOpacity>
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
                uri={ventesJour.photo_yango_tab}
                setter={url => setVentesJour(prev => ({ ...prev, photo_yango_tab: url }))}
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
                uri={ventesJour.photo_glovo_tab}
                setter={url => setVentesJour(prev => ({ ...prev, photo_glovo_tab: url }))}
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

              {/* FC reçu — ajustement administratif */}
              <View style={[styles.fcRow, { alignItems: 'flex-start', paddingTop: 14 }]}>
                <View style={styles.fcRowLeft}>
                  <Text style={[styles.fcLabel, { fontWeight: '600', color: colors.text }]}>FC reçu</Text>
                  <Text style={{ fontSize: 10, color: colors.textMuted, marginTop: 2 }}>
                    Ajustement admin (+ complément / − déduction)
                  </Text>
                </View>
                <TextInput
                  style={styles.fcInput}
                  value={ventesJour.fc_recu || ''}
                  onChangeText={v => setVente('fc_recu', v)}
                  keyboardType="numbers-and-punctuation"
                  placeholder="0"
                  placeholderTextColor="#bbb"
                  editable={!bloque || isManager}
                />
              </View>

              <View style={styles.fcRow}>
                <View style={styles.fcRowLeft}>
                  <Text style={styles.fcLabel}>Espèces en caisse</Text>
                  <View style={styles.autoBadge}><Text style={styles.autoBadgeTxt}>Shifts</Text></View>
                </View>
                <Text style={styles.fcValAuto}>{fmt(resteEspeces())}</Text>
              </View>

              <View style={[styles.fcRow, { borderBottomWidth: 0 }]}>
                <View style={styles.fcRowLeft}>
                  <Text style={[styles.fcLabel, { fontWeight: '600', color: colors.primary }]}>FC calculé</Text>
                  <View style={[styles.autoBadge, { backgroundColor: colors.primaryLight }]}>
                    <Text style={[styles.autoBadgeTxt, { color: colors.primary }]}>veille + reçu + espèces</Text>
                  </View>
                </View>
                <Text style={[styles.fcValAuto, { fontWeight: '700', color: colors.primary, fontSize: 15 }]}>
                  {fmt(fc())}
                </Text>
              </View>
            </View>

            {/* Bénéfice SC */}
            <Text style={styles.sectionTitre}>Bénéfice SC</Text>
            <View style={styles.beneficeCard}>
              {[
                { label: `Yango TAB ×${COEFFICIENTS.YANGO}`, val: (parseFloat(ventesJour.yangoTab) || 0) * COEFFICIENTS.YANGO },
                { label: `Glovo TAB ×${COEFFICIENTS.GLOVO}`, val: (parseFloat(ventesJour.glovoTab) || 0) * COEFFICIENTS.GLOVO },
                { label: `Wave ×${COEFFICIENTS.WAVE}`, val: (parseFloat(ventesJour.wave) || 0) * COEFFICIENTS.WAVE },
                { label: `Orange Money ×${COEFFICIENTS.OM}`, val: (parseFloat(ventesJour.om) || 0) * COEFFICIENTS.OM },
                { label: `Djamo ×${COEFFICIENTS.DJAMO}`, val: (parseFloat(ventesJour.djamo) || 0) * COEFFICIENTS.DJAMO },
              ].filter(r => r.val > 0).map((r, i) => (
                <View key={i} style={styles.beneficeRow}>
                  <Text style={styles.beneficeLabel}>{r.label}</Text>
                  <Text style={styles.beneficeVal}>{fmt(r.val)}</Text>
                </View>
              ))}
              {/* Reste espèces — toujours affiché même si négatif */}
              <View style={styles.beneficeRow}>
                <Text style={styles.beneficeLabel}>Reste espèces</Text>
                <Text style={[styles.beneficeVal, resteEspeces() < 0 && { color: '#A32D2D' }]}>
                  {resteEspeces() >= 0 ? fmt(resteEspeces()) : `− ${fmt(Math.abs(resteEspeces()))}`}
                </Text>
              </View>
              <View style={[styles.beneficeRow, {
                borderBottomWidth: 0, marginTop: 8, paddingTop: 8,
                borderTopWidth: 1.5, borderTopColor: '#3B6D11'
              }]}>
                <Text style={[styles.beneficeLabel, { fontWeight: '700', color: colors.text, fontSize: 14 }]}>
                  Bénéfice SC total
                </Text>
                <Text style={[styles.beneficeVal, { fontWeight: '700', color: '#3B6D11', fontSize: 18 }]}>
                  {fmt(beneficeSC())}
                </Text>
              </View>
            </View>

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
                      <Text style={[styles.vmLabel, { fontWeight: '600', color: colors.text }]}>
                        Vente machine
                      </Text>
                      <Text style={{ fontSize: 10, color: colors.textMuted, marginTop: 2 }}>
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
                        onPress={() => gererPhoto(url => setVentesJour(prev => ({ ...prev, photoVenteMachine: url })), 'vente-machine')}
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
                    const parfait = Math.abs(ecart) === 0
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
                          {parfait ? '✅ Aucun écart — ' : surplus ? '📈 Surplus — ' : '📉 Manquant — '}
                          Écart : {ecart >= 0 ? '+' : ''}{fmt(ecart)}
                        </Text>
                      </View>
                    )
                  })()}

                  {/* Explication écart obligatoire */}
                  {ventesJour.venteMachine !== '' && cumulShifts && Math.abs(cumulShifts.venteTotal - (parseFloat(ventesJour.venteMachine) || 0)) > 0 && (!bloque || isManager) && (
                    <View style={styles.explicacionCard}>
                      <Text style={styles.explicacionLabel}>📝 Explication obligatoire</Text>
                      <Text style={styles.explicacionSub}>
                        Justifiez l'écart avant de continuer (min. 10 caractères)
                      </Text>
                      <TextInput
                        style={styles.explicacionInput}
                        value={ventesJour.explicacionEcartMachine || ''}
                        onChangeText={v => setVente('explicacionEcartMachine', v)}
                        placeholder="Ex : Erreur de saisie caissier, remboursement client..."
                        placeholderTextColor="#bbb"
                        multiline
                        numberOfLines={3}
                        editable={!bloque || isManager}
                      />
                      {(() => {
                        const len = (ventesJour.explicacionEcartMachine || '').trim().length
                        return len > 0 ? (
                          <Text style={{ fontSize: 11, marginTop: 4, color: len >= 10 ? '#3B6D11' : '#993C1D' }}>
                            {len}/10 caractères minimum {len >= 10 ? '✅' : ''}
                          </Text>
                        ) : null
                      })()}
                    </View>
                  )}
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

function makeStyles(colors) { return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    backgroundColor: '#EF9F27', padding: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'
  },
  back: { fontSize: 16, color: '#412402', fontWeight: '500' },
  headerTitre: { fontSize: 16, fontWeight: '600', color: '#412402', textAlign: 'center' },
  headerSub: { fontSize: 11, color: '#854F0B', textAlign: 'center' },
  progressBar: {
    flexDirection: 'row', backgroundColor: colors.surface, padding: 14,
    borderBottomWidth: 0.5, borderBottomColor: colors.border,
    alignItems: 'center', justifyContent: 'center'
  },
  progressItem: { flexDirection: 'row', alignItems: 'center' },
  progressNum: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: colors.bg,
    alignItems: 'center', justifyContent: 'center', marginRight: 6,
    borderWidth: 0.5, borderColor: colors.border
  },
  progressNumActive: { backgroundColor: '#EF9F27', borderColor: '#EF9F27' },
  progressNumTxt: { fontSize: 12, fontWeight: '600', color: colors.textMuted },
  progressNumTxtActive: { color: '#412402' },
  progressLine: { width: 40, height: 1.5, backgroundColor: colors.border, marginHorizontal: 6 },
  progressLineActive: { backgroundColor: '#EF9F27' },
  progressLabel: { fontSize: 11, color: colors.textMuted, marginRight: 6 },
  progressLabelActive: { color: '#EF9F27', fontWeight: '600' },
  valideBanner: { backgroundColor: '#FAECE7', padding: 10, alignItems: 'center' },
  valideTxt: { fontSize: 12, color: '#993C1D', fontWeight: '500' },
  cumulBanner: {
    backgroundColor: colors.primaryLight, padding: 8, paddingHorizontal: 14,
    borderBottomWidth: 0.5, borderBottomColor: colors.primaryText,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  cumulBannerTxt: { fontSize: 12, color: colors.primary, fontWeight: '500', flex: 1 },
  cumulRefreshBtn: { paddingHorizontal: 8, paddingVertical: 4 },
  cumulRefreshTxt: { fontSize: 16 },
  chargementBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.surfaceAlt, padding: 8, paddingHorizontal: 14
  },
  chargementTxt: { fontSize: 12, color: colors.textMuted },
  uploadBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.primary, padding: 8, paddingHorizontal: 14
  },
  uploadTxt: { fontSize: 12, color: colors.surface, fontWeight: '500' },
  body: { flex: 1, padding: 16 },
  sectionTitre: {
    fontSize: 12, fontWeight: '600', color: colors.textMuted, marginBottom: 6,
    textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 8
  },
  sectionSub: { fontSize: 12, color: colors.textPlaceholder, marginBottom: 12 },
  infoShiftsCard: {
    backgroundColor: colors.primaryLight, borderRadius: 12, padding: 14,
    marginBottom: 14, borderWidth: 0.5, borderColor: colors.primaryText
  },
  infoShiftsTitre: { fontSize: 13, fontWeight: '600', color: colors.primary, marginBottom: 6 },
  infoShiftsTxt: { fontSize: 12, color: colors.primary, lineHeight: 18 },
  canalCard: {
    backgroundColor: colors.surface, borderRadius: 14, padding: 14,
    marginBottom: 12, borderWidth: 0.5, borderColor: colors.border
  },
  canalHeader: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 10
  },
  canalTitre: { fontSize: 14, fontWeight: '600', color: colors.text },
  canalCoeff: {
    fontSize: 12, color: colors.textMuted, backgroundColor: colors.bg,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8
  },
  inputRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', paddingVertical: 8,
    borderBottomWidth: 0.5, borderBottomColor: colors.bg
  },
  inputLabel: { fontSize: 13, color: colors.textSecondary, flex: 1 },
  inputField: {
    width: 130, backgroundColor: colors.bg, borderRadius: 8,
    padding: 8, fontSize: 14, color: colors.text, textAlign: 'right'
  },
  photoBlock: {
    marginTop: 10, backgroundColor: colors.surfaceAlt,
    borderRadius: 10, padding: 10, borderWidth: 0.5, borderColor: colors.border
  },
  photoBlockRequired: { backgroundColor: '#FAECE7', borderColor: '#F09595' },
  photoBlockHeader: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 8
  },
  photoBlockLabel: { fontSize: 12, color: colors.textSecondary, fontWeight: '500' },
  photoBadgeOk: { backgroundColor: '#EAF3DE', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  photoBadgeOkTxt: { fontSize: 10, color: '#3B6D11', fontWeight: '500' },
  photoBadgeReq: { backgroundColor: '#FAECE7', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  photoBadgeReqTxt: { fontSize: 10, color: '#993C1D', fontWeight: '500' },
  photoPreview: { width: '100%', height: 140, borderRadius: 10, marginBottom: 8 },
  photoBtn: { backgroundColor: '#EF9F27', borderRadius: 10, padding: 10, alignItems: 'center' },
  photoBtnTxt: { fontSize: 13, color: '#412402', fontWeight: '500' },
  recapShiftsCard: {
    backgroundColor: colors.orangeLight, borderRadius: 14, padding: 14,
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
    backgroundColor: colors.surface, borderRadius: 14, padding: 14,
    marginBottom: 14, borderWidth: 0.5, borderColor: colors.border
  },
  vmRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', paddingVertical: 10,
    borderBottomWidth: 0.5, borderBottomColor: colors.bg
  },
  vmRowLeft: { flex: 1 },
  vmLabel: { fontSize: 13, color: colors.textSecondary },
  vmValAuto: { fontSize: 14, fontWeight: '600', color: colors.text },
  vmInput: {
    width: 140, backgroundColor: colors.bg, borderRadius: 10,
    padding: 10, fontSize: 15, color: colors.text, textAlign: 'right',
    borderWidth: 1, borderColor: '#EF9F27'
  },
  // ── FC ──
  fcCard: {
    backgroundColor: colors.surface, borderRadius: 14, padding: 14,
    marginBottom: 14, borderWidth: 0.5, borderColor: colors.border
  },
  fcRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', paddingVertical: 10,
    borderBottomWidth: 0.5, borderBottomColor: colors.bg
  },
  fcRowLeft: { flex: 1 },
  fcLabel: { fontSize: 13, color: colors.textSecondary },
  fcValAuto: { fontSize: 14, fontWeight: '600', color: colors.text },
  fcInput: {
    width: 140, backgroundColor: colors.bg, borderRadius: 10,
    padding: 10, fontSize: 15, color: colors.text, textAlign: 'right',
    borderWidth: 1, borderColor: colors.primary
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
  explicacionCard: {
    backgroundColor: '#FAEEDA', borderRadius: 12, padding: 14,
    marginTop: 10, borderWidth: 1, borderColor: '#EF9F27'
  },
  explicacionLabel: { fontSize: 13, fontWeight: '700', color: '#854F0B', marginBottom: 4 },
  explicacionSub: { fontSize: 11, color: '#A06010', marginBottom: 8 },
  explicacionInput: {
    backgroundColor: '#fff', borderRadius: 10, padding: 10,
    fontSize: 13, color: '#333', minHeight: 70, textAlignVertical: 'top',
    borderWidth: 1, borderColor: '#EF9F27'
  },
  // ── Bénéfice SC ──
  beneficeCard: {
    backgroundColor: colors.surface, borderRadius: 14, padding: 14,
    marginBottom: 14, borderWidth: 0.5, borderColor: colors.border
  },
  beneficeRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 6, borderBottomWidth: 0.5, borderBottomColor: colors.bg
  },
  beneficeLabel: { fontSize: 13, color: colors.textSecondary },
  beneficeVal: { fontSize: 13, fontWeight: '500', color: colors.text },
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
    backgroundColor: '#EF9F27', alignItems: 'center'
  },
  confirmOkTxt: { fontSize: 14, fontWeight: '600', color: '#412402' },
}) }
