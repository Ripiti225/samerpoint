import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Image,
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
  } = useApp()

  const { prendrePhoto, choisirPhoto } = usePhoto()

  const [etape, setEtape] = useState(1)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
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

  function setPhoto(champ, uri) {
    setVentesJour(prev => ({ ...prev, [champ]: uri }))
  }

  async function gererPhoto(champ, dossier) {
    if (bloque && !isManager) return
    setUploading(true)
    Alert.alert('Photo', 'Choisir la source', [
      {
        text: '📷 Caméra',
        onPress: async () => {
          const url = await prendrePhoto(dossier)
          if (url) setPhoto(champ, url)
          setUploading(false)
        }
      },
      {
        text: '🖼 Galerie',
        onPress: async () => {
          const url = await choisirPhoto(dossier)
          if (url) setPhoto(champ, url)
          setUploading(false)
        }
      },
      { text: 'Annuler', style: 'cancel', onPress: () => setUploading(false) }
    ])
  }

  function fmt(n) { return Math.round(n).toLocaleString('fr-FR') + ' FCFA' }

  function verifierPhotosObligatoires() {
    const manquantes = []
    if (parseFloat(ventesJour.yangoTab) > 0 && !ventesJour.photo_yango_tab) manquantes.push('Yango TAB')
    if (parseFloat(ventesJour.glovoTab) > 0 && !ventesJour.photo_glovo_tab) manquantes.push('Glovo TAB')
    return manquantes
  }

  async function sauvegarderPhotosPoints() {
    if (!pointId) return
    const updates = {}
    const photos = ['photo_yango_tab', 'photo_glovo_tab']
    photos.forEach(p => { if (ventesJour[p]) updates[p] = ventesJour[p] })
    if (Object.keys(updates).length > 0) {
      await supabase.from('points').update(updates).eq('id', pointId)
    }
  }

  async function allerAuRecap() {
    if (!pointId) { Alert.alert('Erreur', 'Aucun point actif'); return }
    if (!isManager) {
      const manquantes = verifierPhotosObligatoires()
      if (manquantes.length > 0) {
        Alert.alert(
          '⚠️ Photos manquantes',
          `Les éléments suivants n'ont pas de photo :\n\n${manquantes.map(m => `• ${m}`).join('\n')}\n\nVeuillez ajouter les photos.`,
          [
            { text: 'Annuler', style: 'cancel' },
            { text: 'Continuer quand même', onPress: () => sauvegarderEtContinuer() }
          ]
        )
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
})
