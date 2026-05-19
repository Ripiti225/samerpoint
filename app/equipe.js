import { router } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../context/AppContext'
import { useTheme } from '../context/ThemeContext'
import {
    ActivityIndicator,
    Alert,
    Image,
    Linking,
    Modal,
    Platform,
    SafeAreaView, ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native'
import { supabase } from '../lib/supabase'
import * as Print from 'expo-print'
import * as Sharing from 'expo-sharing'

const STATUT_COLORS = {
  'Présent': { bg: '#EAF3DE', text: '#3B6D11' },
  'Absent': { bg: '#FAECE7', text: '#993C1D' },
  'Repos': { bg: '#E6F1FB', text: '#185FA5' },
  'Congé': { bg: '#EEEDFE', text: '#3C3489' },
  'Malade': { bg: '#FAEEDA', text: '#854F0B' },
  'Permission': { bg: '#F1EFE8', text: '#444441' },
}

const TYPE_DOC_ICONS = {
  'CNI': '🪪',
  'Passeport': '📕',
  'Permis de conduire': '🚗',
  'Contrat': '📄',
  'Autre': '📎',
}

export default function EquipeScreen() {
  const { colors } = useTheme()
  const { roleActif } = useApp()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const [travailleurs, setTravailleurs] = useState([])
  const [loading, setLoading] = useState(true)
  const [recherche, setRecherche] = useState('')
  const [filtreResto, setFiltreResto] = useState('tous')
  const [restaurants, setRestaurants] = useState([])

  // Modal profil
  const [profilVisible, setProfilVisible] = useState(false)
  const [travProfil, setTravProfil] = useState(null)
  const [docsProfil, setDocsProfil] = useState([])
  const [loadingDocs, setLoadingDocs] = useState(false)
  const [zoomVisible, setZoomVisible] = useState(false)
  const [saving, setSaving] = useState(false)

  const peutEditer = roleActif === 'directeur' || roleActif === 'rh' || roleActif === 'manager'

  useEffect(() => {
    chargerEquipe()
  }, [])

  async function chargerEquipe() {
    setLoading(true)
    const { data: restos } = await supabase.from('restaurants').select('*').order('nom')
    setRestaurants(restos || [])

    const { data } = await supabase
      .from('travailleurs')
      .select('*, restaurants(nom, couleur)')
      .order('nom')
    setTravailleurs(data || [])
    setLoading(false)
  }

  async function ouvrirProfil(t) {
    setTravProfil(t)
    setDocsProfil([])
    setProfilVisible(true)
    setLoadingDocs(true)
    const { data } = await supabase
      .from('documents_travailleurs')
      .select('*')
      .eq('travailleur_id', t.id)
      .order('created_at', { ascending: false })
    setDocsProfil(data || [])
    setLoadingDocs(false)
  }

  async function exporterPDF(trav) {
    if (!trav || saving) return
    setSaving(true)
    try {
      const nom = trav.nom || ''
      const poste = trav.poste || ''
      const restaurant = trav.restaurants?.nom || ''
      const tel = trav.contact || '—'
      const salaire = trav.salaire_journalier
        ? `${Number(trav.salaire_journalier).toLocaleString('fr-FR')} F / jour`
        : '—'
      const statut = trav.statut === 'archive' ? 'Archivé' : trav.actif ? 'Actif' : 'Inactif'
      const contrat = trav.type_contrat || '—'
      const initiales = nom.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
      const photoHtml = trav.photo_url
        ? `<img src="${trav.photo_url}" style="width:100px;height:100px;border-radius:50%;border:4px solid #fff;box-shadow:0 2px 10px rgba(0,0,0,0.2);object-fit:cover;" />`
        : `<div style="width:100px;height:100px;border-radius:50%;background:#EF9F27;display:flex;align-items:center;justify-content:center;margin:auto;font-size:32px;font-weight:700;color:#fff;">${initiales}</div>`

      const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;padding:30px;background:#f0f2f5;margin:0;">
        <div style="background:white;border-radius:20px;padding:30px;max-width:400px;margin:auto;box-shadow:0 4px 20px rgba(0,0,0,0.1);">
          <h2 style="text-align:center;color:#185FA5;margin:0 0 5px;letter-spacing:1.5px;text-transform:uppercase;font-size:13px;">${restaurant}</h2>
          <hr style="border:none;border-top:1px solid #eee;margin:12px 0;" />
          <div style="text-align:center;margin:20px 0;">${photoHtml}
            <h1 style="margin:12px 0 4px;font-size:22px;color:#1a1a1a;">${nom}</h1>
            <p style="color:#888;margin:0;font-size:14px;">${poste}</p>
          </div>
          <hr style="border:none;border-top:1px solid #eee;margin:12px 0;" />
          <table style="width:100%;font-size:14px;line-height:2.2;border-collapse:collapse;">
            <tr><td style="color:#888;">📍 Restaurant</td><td style="text-align:right;font-weight:600;color:#1a1a1a;">${restaurant}</td></tr>
            <tr><td style="color:#888;">📞 Téléphone</td><td style="text-align:right;font-weight:600;color:#1a1a1a;">${tel}</td></tr>
            <tr><td style="color:#888;">💰 Salaire</td><td style="text-align:right;font-weight:600;color:#1a1a1a;">${salaire}</td></tr>
            <tr><td style="color:#888;">📋 Contrat</td><td style="text-align:right;font-weight:600;color:#1a1a1a;">${contrat}</td></tr>
            <tr><td style="color:#888;">🟢 Statut</td><td style="text-align:right;font-weight:600;color:#1a1a1a;">${statut}</td></tr>
          </table>
          <hr style="border:none;border-top:1px solid #eee;margin:16px 0;" />
          <p style="text-align:center;color:#bbb;font-size:11px;margin:0;">SAMER — Gestion Restauration</p>
        </div>
      </body></html>`

      if (Platform.OS === 'web') {
        await Print.printAsync({ html })
      } else {
        const { uri } = await Print.printToFileAsync({ html })
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          dialogTitle: `Carte — ${nom}`,
        })
      }
    } catch {
      Alert.alert('Erreur', 'Impossible de générer le PDF')
    } finally {
      setSaving(false)
    }
  }

  const travailleursFiltres = travailleurs.filter(t => {
    const matchRecherche = t.nom.toLowerCase().includes(recherche.toLowerCase()) ||
      (t.poste || '').toLowerCase().includes(recherche.toLowerCase())
    const matchResto = filtreResto === 'tous' || t.restaurant_id === filtreResto
    return matchRecherche && matchResto
  })

  const actifs = travailleursFiltres.filter(t => t.actif)
  const inactifs = travailleursFiltres.filter(t => !t.actif)

  function renderCard(t, inactif = false) {
    return (
      <TouchableOpacity
        key={t.id}
        style={[styles.travCard, inactif && { opacity: 0.5 }]}
        onPress={() => ouvrirProfil(t)}
        activeOpacity={0.75}
      >
        <View style={styles.travLeft}>
          {t.photo_url ? (
            <Image source={{ uri: t.photo_url }} style={styles.avatarPhoto} />
          ) : (
            <View style={[styles.avatar, { backgroundColor: inactif ? '#888' : (t.restaurants?.couleur === 'vert' ? '#2D7D46' : '#EF9F27') }]}>
              <Text style={styles.avatarTxt}>
                {t.nom.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
              </Text>
            </View>
          )}
          <View style={styles.travInfo}>
            <Text style={styles.travNom}>{t.nom}</Text>
            <Text style={styles.travPoste}>{t.poste} — {t.type_contrat}</Text>
            {t.contact && <Text style={styles.travContact}>{t.contact}</Text>}
            <View style={styles.travBadgeRow}>
              <View style={styles.restoBadge}>
                <Text style={styles.restoTxt}>{t.restaurants?.nom || 'Sans restaurant'}</Text>
              </View>
              {t.identifiant && (
                <View style={styles.idBadge}>
                  <Text style={styles.idTxt}>{t.identifiant}</Text>
                </View>
              )}
            </View>
          </View>
        </View>
        <View style={[styles.actifBadge, { backgroundColor: inactif ? '#FAECE7' : '#EAF3DE' }]}>
          <Text style={[styles.actifTxt, { color: inactif ? '#993C1D' : '#3B6D11' }]}>
            {inactif ? 'Inactif' : 'Actif'}
          </Text>
        </View>
      </TouchableOpacity>
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
        <Text style={styles.headerTitre}>Équipe globale</Text>
        <View style={{ width: 60 }} />
      </View>

      <View style={styles.searchBar}>
        <TextInput
          style={styles.searchInput}
          placeholder="🔍 Rechercher un travailleur..."
          value={recherche}
          onChangeText={setRecherche}
          placeholderTextColor="#bbb"
        />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filtreBar}>
        <TouchableOpacity
          style={[styles.filtreBtn, filtreResto === 'tous' && styles.filtreBtnActive]}
          onPress={() => setFiltreResto('tous')}
        >
          <Text style={[styles.filtreTxt, filtreResto === 'tous' && styles.filtreTxtActive]}>Tous</Text>
        </TouchableOpacity>
        {restaurants.map(r => (
          <TouchableOpacity
            key={r.id}
            style={[styles.filtreBtn, filtreResto === r.id && styles.filtreBtnActive]}
            onPress={() => setFiltreResto(r.id)}
          >
            <Text style={[styles.filtreTxt, filtreResto === r.id && styles.filtreTxtActive]}>{r.nom}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#534AB7" />
          <Text style={styles.loadingTxt}>Chargement de l'équipe...</Text>
        </View>
      ) : (
        <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>

          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <Text style={styles.statNum}>{travailleurs.length}</Text>
              <Text style={styles.statLabel}>Total</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={[styles.statNum, { color: '#3B6D11' }]}>{travailleurs.filter(t => t.actif).length}</Text>
              <Text style={styles.statLabel}>Actifs</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={[styles.statNum, { color: '#888' }]}>{travailleurs.filter(t => !t.actif).length}</Text>
              <Text style={styles.statLabel}>Inactifs</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={[styles.statNum, { color: '#EF9F27' }]}>{restaurants.length}</Text>
              <Text style={styles.statLabel}>Restaurants</Text>
            </View>
          </View>

          {actifs.length > 0 && (
            <>
              <Text style={styles.sectionTitre}>Actifs ({actifs.length})</Text>
              {actifs.map(t => renderCard(t, false))}
            </>
          )}

          {inactifs.length > 0 && (
            <>
              <Text style={[styles.sectionTitre, { marginTop: 8 }]}>Inactifs ({inactifs.length})</Text>
              {inactifs.map(t => renderCard(t, true))}
            </>
          )}

          {travailleursFiltres.length === 0 && (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyTxt}>Aucun travailleur trouvé</Text>
              <Text style={styles.emptySub}>Modifiez votre recherche ou le filtre restaurant</Text>
            </View>
          )}

          <View style={{ height: 30 }} />
        </ScrollView>
      )}

      {/* Modal profil — Carte professionnelle */}
      <Modal visible={profilVisible} transparent animationType="slide">
        <View style={styles.profilOverlay}>
          <View style={styles.profilModal}>
            <TouchableOpacity style={styles.profilClose} onPress={() => setProfilVisible(false)}>
              <Text style={styles.profilCloseTxt}>✕</Text>
            </TouchableOpacity>

            <ScrollView showsVerticalScrollIndicator={false}>
              {/* ─── Carte professionnelle ─── */}
              <View style={styles.carteBox}>
                <View style={styles.carteHeader}>
                  <Text style={styles.carteRestaurantNom}>
                    {(travProfil?.restaurants?.nom || 'SAMER').toUpperCase()}
                  </Text>
                </View>

                <View style={styles.carteDivider} />

                <View style={styles.cartePhotoRow}>
                  <TouchableOpacity
                    onPress={() => travProfil?.photo_url && setZoomVisible(true)}
                    activeOpacity={travProfil?.photo_url ? 0.8 : 1}
                  >
                    {travProfil?.photo_url ? (
                      <Image source={{ uri: travProfil.photo_url }} style={styles.cartePhoto} />
                    ) : (
                      <View style={[styles.cartePhotoVide, {
                        backgroundColor: travProfil?.restaurants?.couleur === 'vert' ? '#2D7D46' : '#EF9F27'
                      }]}>
                        <Text style={styles.cartePhotoVideTxt}>
                          {(travProfil?.nom || '').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                        </Text>
                      </View>
                    )}
                  </TouchableOpacity>
                </View>

                <Text style={styles.carteNom}>{travProfil?.nom}</Text>
                <Text style={styles.cartePoste}>{travProfil?.poste}</Text>

                <View style={styles.carteDivider} />

                <View style={styles.carteInfos}>
                  <View style={styles.carteRow}>
                    <Text style={styles.carteRowIcon}>📍</Text>
                    <Text style={styles.carteRowLabel}>Restaurant</Text>
                    <Text style={styles.carteRowVal}>{travProfil?.restaurants?.nom || '—'}</Text>
                  </View>
                  {travProfil?.contact ? (
                    <TouchableOpacity style={styles.carteRow} onPress={() => Linking.openURL(`tel:${travProfil.contact}`)}>
                      <Text style={styles.carteRowIcon}>📞</Text>
                      <Text style={styles.carteRowLabel}>Téléphone</Text>
                      <Text style={[styles.carteRowVal, { color: '#185FA5' }]}>{travProfil.contact}</Text>
                    </TouchableOpacity>
                  ) : null}
                  {travProfil?.salaire_journalier ? (
                    <View style={styles.carteRow}>
                      <Text style={styles.carteRowIcon}>💰</Text>
                      <Text style={styles.carteRowLabel}>Salaire</Text>
                      <Text style={styles.carteRowVal}>{Number(travProfil.salaire_journalier).toLocaleString('fr-FR')} F / jour</Text>
                    </View>
                  ) : null}
                  {travProfil?.type_contrat ? (
                    <View style={styles.carteRow}>
                      <Text style={styles.carteRowIcon}>📋</Text>
                      <Text style={styles.carteRowLabel}>Contrat</Text>
                      <Text style={styles.carteRowVal}>{travProfil.type_contrat}</Text>
                    </View>
                  ) : null}
                  <View style={styles.carteRow}>
                    <Text style={styles.carteRowIcon}>
                      {travProfil?.statut === 'archive' ? '⚫' : travProfil?.actif ? '🟢' : '🔴'}
                    </Text>
                    <Text style={styles.carteRowLabel}>Statut</Text>
                    <Text style={styles.carteRowVal}>
                      {travProfil?.statut === 'archive' ? 'Archivé' : travProfil?.actif ? 'Actif' : 'Inactif'}
                    </Text>
                  </View>
                </View>

                <View style={styles.carteDivider} />

                <TouchableOpacity
                  style={[styles.carteActionBtn, saving && { opacity: 0.6 }]}
                  onPress={() => exporterPDF(travProfil)}
                  disabled={saving}
                >
                  <Text style={styles.carteActionTxt}>
                    {saving ? 'Génération...' : '📄 Exporter en PDF'}
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Section Papiers */}
              <Text style={styles.profilSection}>Papiers</Text>
              {loadingDocs ? (
                <ActivityIndicator size="small" color="#534AB7" style={{ marginVertical: 12 }} />
              ) : docsProfil.length === 0 ? (
                <Text style={styles.profilEmpty}>Aucun document enregistré</Text>
              ) : (
                docsProfil.map(doc => (
                  <TouchableOpacity
                    key={doc.id}
                    style={styles.docCard}
                    onPress={() => doc.fichier_url && Linking.openURL(doc.fichier_url)}
                  >
                    <Text style={styles.docIcon}>
                      {TYPE_DOC_ICONS[doc.type_document] || '📎'}
                    </Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.docType}>{doc.type_document}</Text>
                      <Text style={styles.docMeta}>
                        {doc.description === 'pdf' ? 'PDF' : 'Photo'} · {new Date(doc.created_at).toLocaleDateString('fr-FR')}
                      </Text>
                    </View>
                    <Text style={styles.docOuvrir}>Ouvrir →</Text>
                  </TouchableOpacity>
                ))
              )}

              {peutEditer && (
                <TouchableOpacity
                  style={styles.profilEditBtn}
                  onPress={() => { setProfilVisible(false); router.push('/rh') }}
                >
                  <Text style={styles.profilEditTxt}>✏️ Modifier dans RH</Text>
                </TouchableOpacity>
              )}

              <View style={{ height: 20 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Modal zoom photo plein écran */}
      <Modal visible={zoomVisible} transparent animationType="fade" statusBarTranslucent>
        <View style={styles.zoomOverlay}>
          <TouchableOpacity style={styles.zoomClose} onPress={() => setZoomVisible(false)}>
            <Text style={styles.zoomCloseTxt}>✕</Text>
          </TouchableOpacity>
          {travProfil?.photo_url && (
            <Image
              source={{ uri: travProfil.photo_url }}
              style={styles.zoomImage}
              resizeMode="contain"
            />
          )}
        </View>
      </Modal>
    </SafeAreaView>
  )
}

function makeStyles(colors) { return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { backgroundColor: colors.headerBg, padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: { fontSize: 16, color: colors.primaryText, fontWeight: '500' },
  headerTitre: { fontSize: 16, fontWeight: '600', color: colors.surface },
  searchBar: { backgroundColor: colors.surface, padding: 10, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  searchInput: { backgroundColor: colors.surfaceAlt, borderRadius: 10, padding: 10, fontSize: 14, color: colors.text },
  filtreBar: { backgroundColor: colors.surface, maxHeight: 46, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  filtreBtn: { paddingHorizontal: 14, paddingVertical: 12 },
  filtreBtnActive: { borderBottomWidth: 2, borderBottomColor: colors.primary },
  filtreTxt: { fontSize: 12, color: colors.textMuted },
  filtreTxtActive: { color: colors.primary, fontWeight: '600' },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingTxt: { fontSize: 13, color: colors.textMuted, marginTop: 12 },
  body: { flex: 1, padding: 14 },
  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  statCard: { flex: 1, backgroundColor: colors.surface, borderRadius: 12, padding: 12, alignItems: 'center', borderWidth: 0.5, borderColor: colors.border },
  statNum: { fontSize: 20, fontWeight: '600', color: colors.primary },
  statLabel: { fontSize: 10, color: colors.textMuted, marginTop: 2 },
  sectionTitre: { fontSize: 12, fontWeight: '600', color: colors.textMuted, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  travCard: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, marginBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 0.5, borderColor: colors.border },
  travLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  avatarPhoto: { width: 44, height: 44, borderRadius: 22 },
  avatarTxt: { fontSize: 15, fontWeight: '600', color: '#fff' },
  travInfo: { flex: 1 },
  travNom: { fontSize: 14, fontWeight: '600', color: colors.text },
  travPoste: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  travContact: { fontSize: 11, color: colors.primary, marginTop: 2 },
  travBadgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  restoBadge: { backgroundColor: colors.surfaceAlt, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, alignSelf: 'flex-start' },
  restoTxt: { fontSize: 10, color: colors.textSecondary },
  idBadge: { backgroundColor: colors.primaryLight, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, alignSelf: 'flex-start' },
  idTxt: { fontSize: 10, color: colors.primary, fontWeight: '600' },
  actifBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  actifTxt: { fontSize: 11, fontWeight: '500' },
  emptyBox: { alignItems: 'center', paddingVertical: 40 },
  emptyTxt: { fontSize: 14, color: colors.textMuted, fontWeight: '500' },
  emptySub: { fontSize: 12, color: colors.textPlaceholder, marginTop: 6 },
  // Modal profil
  profilOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  profilModal: { backgroundColor: colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, maxHeight: '90%' },
  profilClose: { alignSelf: 'flex-end', padding: 8, marginBottom: 4 },
  profilCloseTxt: { fontSize: 20, color: colors.textMuted },
  profilSection: { fontSize: 11, fontWeight: '600', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10, marginTop: 4 },
  profilEmpty: { fontSize: 13, color: colors.textPlaceholder, textAlign: 'center', paddingVertical: 12 },
  docCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surfaceAlt, borderRadius: 12, padding: 12, marginBottom: 8 },
  docIcon: { fontSize: 24 },
  docType: { fontSize: 13, fontWeight: '600', color: colors.text },
  docMeta: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  docOuvrir: { fontSize: 12, color: colors.primary, fontWeight: '500' },
  profilEditBtn: { backgroundColor: colors.surfaceAlt, borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 12 },
  profilEditTxt: { fontSize: 14, color: colors.primary, fontWeight: '500' },
  // Carte professionnelle
  carteBox: { borderRadius: 20, marginBottom: 16, overflow: 'hidden', borderWidth: 0.5, borderColor: colors.border, backgroundColor: colors.surface },
  carteHeader: { backgroundColor: '#185FA5', paddingVertical: 14, paddingHorizontal: 16, alignItems: 'center' },
  carteRestaurantNom: { fontSize: 13, fontWeight: '700', color: '#fff', letterSpacing: 1.5, textAlign: 'center' },
  carteDivider: { height: 0.5, backgroundColor: colors.border },
  cartePhotoRow: { alignItems: 'center', paddingVertical: 20 },
  cartePhoto: { width: 100, height: 100, borderRadius: 50, borderWidth: 4, borderColor: '#fff' },
  cartePhotoVide: { width: 100, height: 100, borderRadius: 50, alignItems: 'center', justifyContent: 'center', borderWidth: 4, borderColor: '#fff' },
  cartePhotoVideTxt: { fontSize: 30, fontWeight: '700', color: '#fff' },
  carteNom: { fontSize: 22, fontWeight: '700', color: colors.text, textAlign: 'center', paddingHorizontal: 16, marginBottom: 4 },
  cartePoste: { fontSize: 14, color: colors.textMuted, textAlign: 'center', paddingHorizontal: 16, marginBottom: 16 },
  carteInfos: { padding: 16, gap: 14 },
  carteRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  carteRowIcon: { fontSize: 16, width: 26, textAlign: 'center' },
  carteRowLabel: { flex: 1, fontSize: 13, color: colors.textMuted },
  carteRowVal: { fontSize: 13, fontWeight: '600', color: colors.text, maxWidth: '55%', textAlign: 'right' },
  carteActionBtn: { margin: 16, backgroundColor: '#185FA5', borderRadius: 12, padding: 14, alignItems: 'center' },
  carteActionTxt: { fontSize: 14, fontWeight: '600', color: '#fff' },
  // Zoom photo
  zoomOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center', alignItems: 'center' },
  zoomClose: { position: 'absolute', top: 50, right: 20, zIndex: 999, padding: 10 },
  zoomCloseTxt: { color: '#fff', fontSize: 28, fontWeight: '300' },
  zoomImage: { width: '90%', height: '70%' },
}) }
