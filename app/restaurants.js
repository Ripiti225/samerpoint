import { router } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { useTheme } from '../context/ThemeContext'
import {
    ActivityIndicator,
    Alert,
    SafeAreaView, ScrollView,
    StyleSheet,
    Text, TextInput, TouchableOpacity,
    View
} from 'react-native'
import { supabase } from '../lib/supabase'
import '../lib/webAlert'   // remplace Alert.alert par les dialogues du navigateur


// ─── Objectif de CA mensuel ────────────────────────────────────────────────
// Saisi ici, lu par le rapport mensuel (onglet Rapports → Mensuel) pour
// afficher le taux d'atteinte par restaurant.

function ObjectifMensuel({ resto, onEnregistre }) {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const [edition, setEdition] = useState(false)
  const [valeur, setValeur] = useState('')
  const [sauvegarde, setSauvegarde] = useState(false)

  const objectif = resto.objectif_mensuel

  function ouvrir() {
    setValeur(objectif == null ? '' : String(Math.round(objectif)))
    setEdition(true)
  }

  async function enregistrer() {
    const brut = valeur.replace(/[\s.]/g, '').trim()
    const montant = brut === '' ? null : Number(brut)
    if (montant !== null && (!Number.isFinite(montant) || montant < 0)) {
      Alert.alert('Montant invalide', 'Saisissez un nombre positif, ou laissez vide pour retirer l\'objectif.')
      return
    }
    setSauvegarde(true)
    const { error } = await supabase.from('restaurants')
      .update({ objectif_mensuel: montant }).eq('id', resto.id)
    setSauvegarde(false)
    if (error) {
      Alert.alert(
        'Enregistrement impossible',
        /objectif_mensuel/.test(error.message)
          ? "La colonne « objectif_mensuel » n'existe pas encore. Passez le script supabase_rapport_mensuel.sql dans Supabase, puis réessayez."
          : error.message,
      )
      return
    }
    setEdition(false)
    onEnregistre?.(resto.id, montant)
  }

  if (!edition) {
    return (
      <TouchableOpacity style={styles.objectifRow} onPress={ouvrir}>
        <Text style={styles.objectifLabel}>🎯 Objectif mensuel</Text>
        <Text style={[styles.objectifVal, objectif == null && styles.objectifVide]}>
          {objectif == null
            ? 'À définir'
            : Math.round(objectif).toLocaleString('fr-FR') + ' FCFA'}
        </Text>
        <Text style={styles.objectifCrayon}>✏️</Text>
      </TouchableOpacity>
    )
  }

  return (
    <View style={styles.objectifEdit}>
      <TextInput
        style={styles.objectifInput}
        value={valeur}
        onChangeText={setValeur}
        keyboardType="numeric"
        placeholder="Ex. 3000000"
        placeholderTextColor={colors.textPlaceholder}
        autoFocus
        editable={!sauvegarde}
      />
      <TouchableOpacity
        style={[styles.objectifBtn, styles.objectifBtnOk]}
        onPress={enregistrer}
        disabled={sauvegarde}
      >
        <Text style={styles.objectifBtnOkTxt}>{sauvegarde ? '…' : 'OK'}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.objectifBtn}
        onPress={() => setEdition(false)}
        disabled={sauvegarde}
      >
        <Text style={styles.objectifBtnTxt}>Annuler</Text>
      </TouchableOpacity>
    </View>
  )
}

export default function RestaurantsScreen() {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const [restos, setRestos] = useState([])
  const [stats, setStats] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    chargerRestaurants()
  }, [])

  async function chargerRestaurants() {
    setLoading(true)
    // `objectif_mensuel` vient de supabase_rapport_mensuel.sql : tant que la
    // migration n'est pas passée, on recharge sans la colonne plutôt que de
    // laisser l'écran vide.
    const COLONNES = 'id, nom, couleur, photo_url, localisation'
    let { data, error } = await supabase.from('restaurants')
      .select(`${COLONNES}, objectif_mensuel`).order('nom')
    if (error) {
      console.warn('[Restaurants] objectif_mensuel absent :', error.message)
      ;({ data } = await supabase.from('restaurants').select(COLONNES).order('nom'))
    }
    setRestos(data || [])

    const statsData = {}
    for (const r of (data || [])) {
      const { data: points } = await supabase
        .from('points').select('vente_total, benefice_sc, valide')
        .eq('restaurant_id', r.id).eq('valide', true)
      const { data: travailleurs } = await supabase
        .from('travailleurs').select('id').eq('restaurant_id', r.id).eq('actif', true)
      statsData[r.id] = {
        nbPoints: (points || []).length,
        totalVentes: (points || []).reduce((s, p) => s + (p.vente_total || 0), 0),
        totalBenefice: (points || []).reduce((s, p) => s + (p.benefice_sc || 0), 0),
        nbTravailleurs: (travailleurs || []).length,
      }
    }
    setStats(statsData)
    setLoading(false)
  }

  // Mise à jour locale après saisie d'un objectif : évite de tout recharger
  // (les stats par restaurant coûtent une requête chacune).
  function majObjectif(id, montant) {
    setRestos(liste => liste.map(r => (r.id === id ? { ...r, objectif_mensuel: montant } : r)))
  }

  function fmt(n) { return Math.round(n).toLocaleString('fr-FR') + ' FCFA' }

  function tauxRenta(ventes, benefice) {
    if (!ventes || ventes === 0) return 0
    return (benefice / ventes * 100)
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
        <Text style={styles.headerTitre}>Tous les restaurants</Text>
        <View style={{ width: 60 }} />
      </View>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#534AB7" />
          <Text style={styles.loadingTxt}>Chargement...</Text>
        </View>
      ) : (
        <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>

          <View style={styles.resumeRow}>
            <View style={styles.resumeCard}>
              <Text style={styles.resumeNum}>{restos.length}</Text>
              <Text style={styles.resumeLabel}>Restaurants</Text>
            </View>
            <View style={styles.resumeCard}>
              <Text style={styles.resumeNum}>
                {restos.filter(r => r.couleur === 'orange' || r.famille === 'Samer').length}
              </Text>
              <Text style={styles.resumeLabel}>Samer</Text>
            </View>
            <View style={styles.resumeCard}>
              <Text style={styles.resumeNum}>
                {restos.filter(r => r.couleur === 'vert' || r.famille === 'Al Kayan').length}
              </Text>
              <Text style={styles.resumeLabel}>Al Kayan</Text>
            </View>
          </View>

          <Text style={styles.sectionTitre}>🟡 Famille Samer</Text>
          {restos
            .filter(r => r.couleur === 'orange' || r.famille === 'Samer')
            .map(r => {
              const s = stats[r.id] || {}
              return (
                <View key={r.id} style={[styles.restoCard, { borderLeftColor: '#EF9F27' }]}>
                  <View style={styles.restoHeader}>
                    <View style={[styles.restoDot, { backgroundColor: '#EF9F27' }]} />
                    <Text style={styles.restoNom}>{r.nom}</Text>
                    <View style={[styles.rentaBadge, { backgroundColor: tauxRenta(s.totalVentes, s.totalBenefice) >= 20 ? '#EAF3DE' : '#FAECE7' }]}>
                      <Text style={[styles.rentaTxt, { color: tauxRenta(s.totalVentes, s.totalBenefice) >= 20 ? '#3B6D11' : '#993C1D' }]}>
                        {tauxRenta(s.totalVentes, s.totalBenefice).toFixed(1)}%
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.restoLocalisation}>{r.localisation || 'Abidjan'}</Text>
                  <View style={styles.restoStats}>
                    <View style={styles.restoStat}>
                      <Text style={styles.restoStatVal}>{fmt(s.totalVentes || 0)}</Text>
                      <Text style={styles.restoStatLabel}>Ventes totales</Text>
                    </View>
                    <View style={styles.restoStat}>
                      <Text style={[styles.restoStatVal, { color: '#3B6D11' }]}>{fmt(s.totalBenefice || 0)}</Text>
                      <Text style={styles.restoStatLabel}>Bénéfice SC</Text>
                    </View>
                    <View style={styles.restoStat}>
                      <Text style={styles.restoStatVal}>{s.nbPoints || 0}</Text>
                      <Text style={styles.restoStatLabel}>Pts validés</Text>
                    </View>
                    <View style={styles.restoStat}>
                      <Text style={styles.restoStatVal}>{s.nbTravailleurs || 0}</Text>
                      <Text style={styles.restoStatLabel}>Travailleurs</Text>
                    </View>
                  </View>
                  <ObjectifMensuel resto={r} onEnregistre={majObjectif} />
                </View>
              )
            })}

          <Text style={[styles.sectionTitre, { marginTop: 8 }]}>🟢 Famille Al Kayan</Text>
          {restos
            .filter(r => r.couleur === 'vert' || r.famille === 'Al Kayan')
            .map(r => {
              const s = stats[r.id] || {}
              return (
                <View key={r.id} style={[styles.restoCard, { borderLeftColor: '#2D7D46' }]}>
                  <View style={styles.restoHeader}>
                    <View style={[styles.restoDot, { backgroundColor: '#2D7D46' }]} />
                    <Text style={styles.restoNom}>{r.nom}</Text>
                    <View style={[styles.rentaBadge, { backgroundColor: tauxRenta(s.totalVentes, s.totalBenefice) >= 20 ? '#EAF3DE' : '#FAECE7' }]}>
                      <Text style={[styles.rentaTxt, { color: tauxRenta(s.totalVentes, s.totalBenefice) >= 20 ? '#3B6D11' : '#993C1D' }]}>
                        {tauxRenta(s.totalVentes, s.totalBenefice).toFixed(1)}%
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.restoLocalisation}>{r.localisation || 'Abidjan'}</Text>
                  <View style={styles.restoStats}>
                    <View style={styles.restoStat}>
                      <Text style={styles.restoStatVal}>{fmt(s.totalVentes || 0)}</Text>
                      <Text style={styles.restoStatLabel}>Ventes totales</Text>
                    </View>
                    <View style={styles.restoStat}>
                      <Text style={[styles.restoStatVal, { color: '#3B6D11' }]}>{fmt(s.totalBenefice || 0)}</Text>
                      <Text style={styles.restoStatLabel}>Bénéfice SC</Text>
                    </View>
                    <View style={styles.restoStat}>
                      <Text style={styles.restoStatVal}>{s.nbPoints || 0}</Text>
                      <Text style={styles.restoStatLabel}>Pts validés</Text>
                    </View>
                    <View style={styles.restoStat}>
                      <Text style={styles.restoStatVal}>{s.nbTravailleurs || 0}</Text>
                      <Text style={styles.restoStatLabel}>Travailleurs</Text>
                    </View>
                  </View>
                  <ObjectifMensuel resto={r} onEnregistre={majObjectif} />
                </View>
              )
            })}

          <View style={{ height: 30 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

function makeStyles(colors) { return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { backgroundColor: colors.headerBg, padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: { fontSize: 16, color: colors.primaryText, fontWeight: '500' },
  headerTitre: { fontSize: 16, fontWeight: '600', color: colors.surface },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingTxt: { fontSize: 13, color: colors.textMuted, marginTop: 12 },
  body: { flex: 1, padding: 14 },
  resumeRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  resumeCard: { flex: 1, backgroundColor: colors.surface, borderRadius: 12, padding: 14, alignItems: 'center', borderWidth: 0.5, borderColor: colors.border },
  resumeNum: { fontSize: 24, fontWeight: '600', color: colors.primary },
  resumeLabel: { fontSize: 11, color: colors.textMuted, marginTop: 4 },
  sectionTitre: { fontSize: 13, fontWeight: '600', color: colors.textMuted, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  restoCard: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, marginBottom: 12, borderWidth: 0.5, borderColor: colors.border, borderLeftWidth: 4 },
  restoHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
  restoDot: { width: 10, height: 10, borderRadius: 5 },
  restoNom: { fontSize: 15, fontWeight: '600', color: colors.text, flex: 1 },
  rentaBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  rentaTxt: { fontSize: 12, fontWeight: '600' },
  restoLocalisation: { fontSize: 11, color: colors.textMuted, marginBottom: 12, marginLeft: 20 },
  restoStats: { flexDirection: 'row', gap: 0 },
  restoStat: { flex: 1, alignItems: 'center', borderRightWidth: 0.5, borderRightColor: colors.borderLight },
  restoStatVal: { fontSize: 12, fontWeight: '600', color: colors.text },
  restoStatLabel: { fontSize: 9, color: colors.textMuted, marginTop: 2 },

  objectifRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.borderLight },
  objectifLabel: { fontSize: 12, color: colors.textMuted, flex: 1 },
  objectifVal: { fontSize: 13, fontWeight: '700', color: colors.text },
  objectifVide: { color: colors.textPlaceholder, fontWeight: '500', fontStyle: 'italic' },
  objectifCrayon: { fontSize: 13 },

  objectifEdit: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.borderLight },
  objectifInput: { flex: 1, backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.inputBorder, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, fontSize: 13, color: colors.text },
  objectifBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: colors.bg },
  objectifBtnTxt: { fontSize: 12, color: colors.textSecondary, fontWeight: '600' },
  objectifBtnOk: { backgroundColor: colors.primary },
  objectifBtnOkTxt: { fontSize: 12, color: '#fff', fontWeight: '700' },
}) }