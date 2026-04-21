import * as ImagePicker from 'expo-image-picker'
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
import { saveTransactionsFournisseurs } from '../lib/api'
import { supabase } from '../lib/supabase'

export default function FournisseursScreen() {
  const {
    pointId, pointValide, fournisseursJour,
    setFournisseursJour, estBloque, restaurantId
  } = useApp()

  const [fournisseurs, setFournisseurs] = useState([])
  const [creditsVeille, setCreditsVeille] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (restaurantId) chargerFournisseurs()
  }, [restaurantId])

  async function chargerFournisseurs() {
    setLoading(true)

    const { data: fourn } = await supabase
      .from('fournisseurs')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .eq('actif', true)
      .order('nom')
    setFournisseurs(fourn || [])

    // Charger le reste dû du point précédent comme crédit de la veille
    if (pointId) {
      const { data: pointsPrec } = await supabase
        .from('points')
        .select('id')
        .eq('restaurant_id', restaurantId)
        .neq('id', pointId)
        .order('date', { ascending: false })
        .limit(1)

      if (pointsPrec && pointsPrec.length > 0) {
        const { data: transPrec } = await supabase
          .from('transactions_fournisseurs')
          .select('fournisseur_id, reste')
          .eq('point_id', pointsPrec[0].id)

        const credits = {}
        ;(transPrec || []).forEach(t => {
          if (t.reste > 0) credits[t.fournisseur_id] = t.reste
        })
        setCreditsVeille(credits)
      }
    }

    setLoading(false)
  }

  function getTransaction(id) {
    return fournisseursJour[id] || { facture: '', paye: '', hasPhoto: false, photoUri: null }
  }

  function setTransaction(id, champ, valeur) {
    if (estBloque(pointValide)) return
    setFournisseursJour(prev => ({
      ...prev,
      [id]: { ...getTransaction(id), [champ]: valeur }
    }))
  }

  function creditVeille(id) {
    return creditsVeille[id] || 0
  }

  function restedu(id) {
    const t = getTransaction(id)
    return creditVeille(id) + (parseFloat(t.facture) || 0) - (parseFloat(t.paye) || 0)
  }

  function totalCredits() {
    return fournisseurs.reduce((sum, f) => sum + creditVeille(f.id), 0)
  }

  function totalFactures() {
    return fournisseurs.reduce((sum, f) => sum + (parseFloat(getTransaction(f.id).facture) || 0), 0)
  }

  function totalPaye() {
    return fournisseurs.reduce((sum, f) => sum + (parseFloat(getTransaction(f.id).paye) || 0), 0)
  }

  function totalReste() {
    return fournisseurs.reduce((sum, f) => sum + restedu(f.id), 0)
  }

  function fmt(n) { return Math.round(n).toLocaleString('fr-FR') + ' FCFA' }

  async function prendrePhoto(id) {
    const { status } = await ImagePicker.requestCameraPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert('Permission requise', "Autorisez l'accès à la caméra dans les paramètres.")
      return
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.7 })
    if (!result.canceled && result.assets[0]) {
      setTransaction(id, 'hasPhoto', true)
      setTransaction(id, 'photoUri', result.assets[0].uri)
    }
  }

  async function choisirPhoto(id) {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert('Permission requise', "Autorisez l'accès à la galerie dans les paramètres.")
      return
    }
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.7 })
    if (!result.canceled && result.assets[0]) {
      setTransaction(id, 'hasPhoto', true)
      setTransaction(id, 'photoUri', result.assets[0].uri)
    }
  }

  async function enregistrer() {
    if (!pointId) { Alert.alert('Erreur', 'Aucun point actif'); return }

    // Photo obligatoire uniquement si une facture est saisie
    for (const f of fournisseurs) {
      const t = getTransaction(f.id)
      if (parseFloat(t.facture) > 0 && !t.photoUri) {
        Alert.alert(
          'Photo manquante',
          `Ajoutez une photo de la facture pour "${f.nom}" avant d'enregistrer.`
        )
        return
      }
    }

    setSaving(true)
    await saveTransactionsFournisseurs(pointId, fournisseursJour, creditsVeille)
    setSaving(false)
    Alert.alert('Succès', 'Fournisseurs enregistrés !')
    if (router.canGoBack()) router.back()
    else router.replace('/accueil')
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.back}>‹ Retour</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitre}>Fournisseurs</Text>
          <View style={{ width: 60 }} />
        </View>
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#EF9F27" />
          <Text style={styles.loadingTxt}>Chargement des fournisseurs...</Text>
        </View>
      </SafeAreaView>
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
          <Text style={styles.headerTitre}>Fournisseurs</Text>
          <Text style={styles.headerSub}>{fournisseurs.length} fournisseurs</Text>
        </View>
        <View style={styles.totalBadge}>
          <Text style={styles.totalBadgeTxt}>{fmt(totalPaye())}</Text>
        </View>
      </View>

      {pointValide && (
        <View style={styles.valideBanner}>
          <Text style={styles.valideTxt}>🔒 Point validé — lecture seule</Text>
        </View>
      )}

      <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
        {fournisseurs.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyTxt}>Aucun fournisseur actif</Text>
            <Text style={styles.emptySub}>Ajoutez des fournisseurs dans les paramètres</Text>
          </View>
        ) : (
          <>
            {['fournisseur', 'cotisation'].map(type => {
              const liste = fournisseurs.filter(f => f.type === type)
              if (liste.length === 0) return null
              return (
                <View key={type}>
                  <Text style={styles.sectionTitre}>
                    {type === 'cotisation' ? '💳 Cotisations' : '🧾 Fournisseurs'}
                  </Text>
                  {liste.map(f => {
                    const t = getTransaction(f.id)
                    const credit = creditVeille(f.id)
                    const reste = restedu(f.id)
                    const hasActivity = t.facture || t.paye
                    const hasDebt = reste > 0

                    return (
                      <View key={f.id} style={[
                        styles.fournCard,
                        hasDebt && styles.fournCardDue,
                        !hasDebt && (hasActivity || credit > 0) && styles.fournCardOk,
                      ]}>
                        <View style={styles.fournHeader}>
                          <View style={[styles.typeBadge, { backgroundColor: type === 'cotisation' ? '#E6F1FB' : '#FAEEDA' }]}>
                            <Text style={[styles.typeTxt, { color: type === 'cotisation' ? '#185FA5' : '#854F0B' }]}>
                              {type === 'cotisation' ? 'Cotis.' : 'Fourn.'}
                            </Text>
                          </View>
                          <Text style={styles.fournNom}>{f.nom}</Text>
                          {t.hasPhoto && <View style={styles.photoBadge}><Text style={styles.photoTxt}>📷</Text></View>}
                        </View>

                        {/* Crédit reporté de la veille */}
                        {credit > 0 && (
                          <View style={styles.creditBanner}>
                            <Text style={styles.creditLabel}>Crédit reporté (veille)</Text>
                            <Text style={styles.creditVal}>{fmt(credit)}</Text>
                          </View>
                        )}

                        {!estBloque(pointValide) && (
                          <>
                            <View style={styles.inputsRow}>
                              <View style={styles.inputBox}>
                                <Text style={styles.inputLabel}>
                                  Facture {parseFloat(t.facture) > 0 && !t.photoUri ? '⚠️' : ''}
                                </Text>
                                <TextInput
                                  style={styles.input}
                                  value={t.facture}
                                  onChangeText={v => setTransaction(f.id, 'facture', v)}
                                  keyboardType="numeric"
                                  placeholder="0"
                                  placeholderTextColor="#bbb"
                                />
                              </View>
                              <View style={styles.inputBox}>
                                <Text style={styles.inputLabel}>
                                  {credit > 0 && !t.facture ? 'Payer crédit' : 'Payé'}
                                </Text>
                                <TextInput
                                  style={[styles.input, { backgroundColor: '#FAEEDA' }]}
                                  value={t.paye}
                                  onChangeText={v => setTransaction(f.id, 'paye', v)}
                                  keyboardType="numeric"
                                  placeholder="0"
                                  placeholderTextColor="#bbb"
                                />
                              </View>
                              <View style={styles.inputBox}>
                                <Text style={styles.inputLabel}>Reste dû</Text>
                                <Text style={[styles.resteVal, {
                                  color: reste > 0 ? '#A32D2D' : reste < 0 ? '#185FA5' : '#3B6D11'
                                }]}>
                                  {(hasActivity || credit > 0) ? fmt(reste) : '—'}
                                </Text>
                              </View>
                            </View>

                            {/* Photo obligatoire si facture saisie, optionnelle sinon */}
                            {(parseFloat(t.facture) > 0 || t.photoUri) && (
                              <View style={styles.photoRow}>
                                <TouchableOpacity style={[
                                  styles.photoBtn,
                                  parseFloat(t.facture) > 0 && !t.photoUri && styles.photoBtnRequired
                                ]} onPress={() => prendrePhoto(f.id)}>
                                  <Text style={styles.photoBtnTxt}>📷 Photo</Text>
                                </TouchableOpacity>
                                <TouchableOpacity style={[
                                  styles.photoBtn,
                                  parseFloat(t.facture) > 0 && !t.photoUri && styles.photoBtnRequired
                                ]} onPress={() => choisirPhoto(f.id)}>
                                  <Text style={styles.photoBtnTxt}>🖼 Galerie</Text>
                                </TouchableOpacity>
                                {t.photoUri && (
                                  <Image source={{ uri: t.photoUri }} style={styles.photoThumb} />
                                )}
                              </View>
                            )}

                            {/* Boutons photo quand pas encore de facture mais on peut quand même ajouter une photo */}
                            {!parseFloat(t.facture) && !t.photoUri && (
                              <View style={styles.photoRow}>
                                <TouchableOpacity style={styles.photoBtn} onPress={() => prendrePhoto(f.id)}>
                                  <Text style={styles.photoBtnTxt}>📷 Photo</Text>
                                </TouchableOpacity>
                                <TouchableOpacity style={styles.photoBtn} onPress={() => choisirPhoto(f.id)}>
                                  <Text style={styles.photoBtnTxt}>🖼 Galerie</Text>
                                </TouchableOpacity>
                              </View>
                            )}

                            {parseFloat(t.facture) > 0 && !t.photoUri && (
                              <Text style={styles.photoWarning}>⚠️ Photo de la facture obligatoire</Text>
                            )}
                          </>
                        )}

                        {estBloque(pointValide) && (hasActivity || credit > 0) && (
                          <View style={styles.inputsRow}>
                            <View style={styles.inputBox}>
                              <Text style={styles.inputLabel}>Facture</Text>
                              <Text style={styles.readOnly}>{fmt(parseFloat(t.facture) || 0)}</Text>
                            </View>
                            <View style={styles.inputBox}>
                              <Text style={styles.inputLabel}>Payé</Text>
                              <Text style={styles.readOnly}>{fmt(parseFloat(t.paye) || 0)}</Text>
                            </View>
                            <View style={styles.inputBox}>
                              <Text style={styles.inputLabel}>Reste dû</Text>
                              <Text style={[styles.readOnly, { color: reste > 0 ? '#A32D2D' : '#3B6D11' }]}>{fmt(reste)}</Text>
                            </View>
                          </View>
                        )}
                      </View>
                    )
                  })}
                </View>
              )
            })}

            <View style={styles.recapCard}>
              <Text style={styles.recapTitre}>Récapitulatif</Text>
              {totalCredits() > 0 && (
                <View style={styles.recapRow}>
                  <Text style={styles.recapLabel}>Crédits reportés (veille)</Text>
                  <Text style={[styles.recapVal, { color: '#A32D2D' }]}>{fmt(totalCredits())}</Text>
                </View>
              )}
              <View style={styles.recapRow}>
                <Text style={styles.recapLabel}>Total factures du jour</Text>
                <Text style={styles.recapVal}>{fmt(totalFactures())}</Text>
              </View>
              <View style={styles.recapRow}>
                <Text style={styles.recapLabel}>Total payé</Text>
                <Text style={[styles.recapVal, { color: '#EF9F27', fontWeight: '600' }]}>{fmt(totalPaye())}</Text>
              </View>
              <View style={[styles.recapRow, { borderBottomWidth: 0 }]}>
                <Text style={[styles.recapLabel, { fontWeight: '600', color: '#1a1a1a' }]}>Total reste dû</Text>
                <Text style={[styles.recapVal, { color: totalReste() > 0 ? '#A32D2D' : '#3B6D11', fontWeight: '600', fontSize: 15 }]}>
                  {fmt(totalReste())}
                </Text>
              </View>
            </View>
          </>
        )}

        {!estBloque(pointValide) && fournisseurs.length > 0 && (
          <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={enregistrer} disabled={saving}>
            <Text style={styles.saveTxt}>{saving ? 'Enregistrement...' : '✅ Enregistrer les fournisseurs'}</Text>
          </TouchableOpacity>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: { backgroundColor: '#EF9F27', padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: { fontSize: 16, color: '#412402', fontWeight: '500' },
  headerTitre: { fontSize: 16, fontWeight: '600', color: '#412402', textAlign: 'center' },
  headerSub: { fontSize: 11, color: '#854F0B', textAlign: 'center' },
  totalBadge: { backgroundColor: '#BA7517', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  totalBadgeTxt: { fontSize: 11, color: '#FAEEDA', fontWeight: '500' },
  valideBanner: { backgroundColor: '#FAECE7', padding: 10, alignItems: 'center' },
  valideTxt: { fontSize: 12, color: '#993C1D', fontWeight: '500' },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingTxt: { fontSize: 13, color: '#888', marginTop: 12 },
  body: { flex: 1, padding: 14 },
  emptyBox: { alignItems: 'center', paddingVertical: 40 },
  emptyTxt: { fontSize: 14, color: '#888', fontWeight: '500' },
  emptySub: { fontSize: 12, color: '#bbb', marginTop: 6 },
  sectionTitre: { fontSize: 12, fontWeight: '600', color: '#888', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  fournCard: { backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 0.5, borderColor: '#eee' },
  fournCardDue: { borderColor: '#F09595', backgroundColor: '#FCEBEB' },
  fournCardOk: { borderColor: '#C0DD97', backgroundColor: '#F4FAF0' },
  fournHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  typeBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  typeTxt: { fontSize: 10, fontWeight: '500' },
  fournNom: { fontSize: 14, fontWeight: '600', color: '#1a1a1a', flex: 1 },
  photoBadge: { backgroundColor: '#E6F1FB', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  photoTxt: { fontSize: 12 },
  creditBanner: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#FFF3CD', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, marginBottom: 10 },
  creditLabel: { fontSize: 11, color: '#7A4F00', fontWeight: '500' },
  creditVal: { fontSize: 13, fontWeight: '700', color: '#A32D2D' },
  inputsRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  inputBox: { flex: 1, alignItems: 'center' },
  inputLabel: { fontSize: 10, color: '#888', marginBottom: 4 },
  input: { width: '100%', backgroundColor: '#f5f5f5', borderRadius: 8, padding: 8, fontSize: 13, textAlign: 'center', color: '#1a1a1a' },
  resteVal: { fontSize: 13, fontWeight: '600', marginTop: 8 },
  readOnly: { fontSize: 13, fontWeight: '500', color: '#1a1a1a', marginTop: 8 },
  photoRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 4 },
  photoBtn: { backgroundColor: '#f5f5f5', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  photoBtnRequired: { backgroundColor: '#FCEBEB', borderWidth: 1, borderColor: '#F09595' },
  photoBtnTxt: { fontSize: 12, color: '#555' },
  photoThumb: { width: 40, height: 40, borderRadius: 8 },
  photoWarning: { fontSize: 11, color: '#A32D2D', marginTop: 6, textAlign: 'center', fontWeight: '500' },
  recapCard: { backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 14, borderWidth: 0.5, borderColor: '#eee' },
  recapTitre: { fontSize: 13, fontWeight: '600', color: '#1a1a1a', marginBottom: 12 },
  recapRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7, borderBottomWidth: 0.5, borderBottomColor: '#f5f5f5' },
  recapLabel: { fontSize: 13, color: '#888' },
  recapVal: { fontSize: 13, fontWeight: '500', color: '#1a1a1a' },
  saveBtn: { backgroundColor: '#EF9F27', borderRadius: 14, padding: 16, alignItems: 'center', marginBottom: 10 },
  saveTxt: { fontSize: 15, fontWeight: '600', color: '#412402' },
})
