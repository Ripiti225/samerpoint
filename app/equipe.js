import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import {
    ActivityIndicator,
    Image,
    SafeAreaView, ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native'
import { supabase } from '../lib/supabase'

const STATUT_COLORS = {
  'Présent': { bg: '#EAF3DE', text: '#3B6D11' },
  'Absent': { bg: '#FAECE7', text: '#993C1D' },
  'Repos': { bg: '#E6F1FB', text: '#185FA5' },
  'Congé': { bg: '#EEEDFE', text: '#3C3489' },
  'Malade': { bg: '#FAEEDA', text: '#854F0B' },
  'Permission': { bg: '#F1EFE8', text: '#444441' },
}

export default function EquipeScreen() {
  const [travailleurs, setTravailleurs] = useState([])
  const [loading, setLoading] = useState(true)
  const [recherche, setRecherche] = useState('')
  const [filtreResto, setFiltreResto] = useState('tous')
  const [restaurants, setRestaurants] = useState([])

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

  const travailleursFiltres = travailleurs.filter(t => {
    const matchRecherche = t.nom.toLowerCase().includes(recherche.toLowerCase()) ||
      (t.poste || '').toLowerCase().includes(recherche.toLowerCase())
    const matchResto = filtreResto === 'tous' || t.restaurant_id === filtreResto
    return matchRecherche && matchResto
  })

  const actifs = travailleursFiltres.filter(t => t.actif)
  const inactifs = travailleursFiltres.filter(t => !t.actif)

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
              {actifs.map(t => (
                <View key={t.id} style={styles.travCard}>
                  <View style={styles.travLeft}>
                    {t.photo_url ? (
                      <Image source={{ uri: t.photo_url }} style={styles.avatarPhoto} />
                    ) : (
                      <View style={[styles.avatar, { backgroundColor: t.restaurants?.couleur === 'vert' ? '#2D7D46' : '#EF9F27' }]}>
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
                  <View style={[styles.actifBadge, { backgroundColor: '#EAF3DE' }]}>
                    <Text style={[styles.actifTxt, { color: '#3B6D11' }]}>Actif</Text>
                  </View>
                </View>
              ))}
            </>
          )}

          {inactifs.length > 0 && (
            <>
              <Text style={[styles.sectionTitre, { marginTop: 8 }]}>Inactifs ({inactifs.length})</Text>
              {inactifs.map(t => (
                <View key={t.id} style={[styles.travCard, { opacity: 0.5 }]}>
                  <View style={styles.travLeft}>
                    {t.photo_url ? (
                      <Image source={{ uri: t.photo_url }} style={styles.avatarPhoto} />
                    ) : (
                      <View style={[styles.avatar, { backgroundColor: '#888' }]}>
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
                  <View style={[styles.actifBadge, { backgroundColor: '#FAECE7' }]}>
                    <Text style={[styles.actifTxt, { color: '#993C1D' }]}>Inactif</Text>
                  </View>
                </View>
              ))}
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
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: { backgroundColor: '#534AB7', padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: { fontSize: 16, color: '#CECBF6', fontWeight: '500' },
  headerTitre: { fontSize: 16, fontWeight: '600', color: '#fff' },
  searchBar: { backgroundColor: '#fff', padding: 10, borderBottomWidth: 0.5, borderBottomColor: '#eee' },
  searchInput: { backgroundColor: '#f5f5f5', borderRadius: 10, padding: 10, fontSize: 14, color: '#1a1a1a' },
  filtreBar: { backgroundColor: '#fff', maxHeight: 46, borderBottomWidth: 0.5, borderBottomColor: '#eee' },
  filtreBtn: { paddingHorizontal: 14, paddingVertical: 12 },
  filtreBtnActive: { borderBottomWidth: 2, borderBottomColor: '#534AB7' },
  filtreTxt: { fontSize: 12, color: '#888' },
  filtreTxtActive: { color: '#534AB7', fontWeight: '600' },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingTxt: { fontSize: 13, color: '#888', marginTop: 12 },
  body: { flex: 1, padding: 14 },
  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  statCard: { flex: 1, backgroundColor: '#fff', borderRadius: 12, padding: 12, alignItems: 'center', borderWidth: 0.5, borderColor: '#eee' },
  statNum: { fontSize: 20, fontWeight: '600', color: '#534AB7' },
  statLabel: { fontSize: 10, color: '#888', marginTop: 2 },
  sectionTitre: { fontSize: 12, fontWeight: '600', color: '#888', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  travCard: { backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 0.5, borderColor: '#eee' },
  travLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  avatarPhoto: { width: 44, height: 44, borderRadius: 22 },
  avatarTxt: { fontSize: 15, fontWeight: '600', color: '#fff' },
  travInfo: { flex: 1 },
  travNom: { fontSize: 14, fontWeight: '600', color: '#1a1a1a' },
  travPoste: { fontSize: 12, color: '#888', marginTop: 2 },
  travContact: { fontSize: 11, color: '#534AB7', marginTop: 2 },
  travBadgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  restoBadge: { backgroundColor: '#f5f5f5', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, alignSelf: 'flex-start' },
  restoTxt: { fontSize: 10, color: '#555' },
  idBadge: { backgroundColor: '#EEEDFE', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, alignSelf: 'flex-start' },
  idTxt: { fontSize: 10, color: '#534AB7', fontWeight: '600' },
  actifBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  actifTxt: { fontSize: 11, fontWeight: '500' },
  emptyBox: { alignItems: 'center', paddingVertical: 40 },
  emptyTxt: { fontSize: 14, color: '#888', fontWeight: '500' },
  emptySub: { fontSize: 12, color: '#bbb', marginTop: 6 },
})