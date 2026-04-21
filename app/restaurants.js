import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import {
    ActivityIndicator,
    SafeAreaView, ScrollView,
    StyleSheet,
    Text, TouchableOpacity,
    View
} from 'react-native'
import { supabase } from '../lib/supabase'


export default function RestaurantsScreen() {
  const [restos, setRestos] = useState([])
  const [stats, setStats] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    chargerRestaurants()
  }, [])

  async function chargerRestaurants() {
    setLoading(true)
    const { data } = await supabase.from('restaurants').select('*').order('nom')
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
                </View>
              )
            })}

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
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingTxt: { fontSize: 13, color: '#888', marginTop: 12 },
  body: { flex: 1, padding: 14 },
  resumeRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  resumeCard: { flex: 1, backgroundColor: '#fff', borderRadius: 12, padding: 14, alignItems: 'center', borderWidth: 0.5, borderColor: '#eee' },
  resumeNum: { fontSize: 24, fontWeight: '600', color: '#534AB7' },
  resumeLabel: { fontSize: 11, color: '#888', marginTop: 4 },
  sectionTitre: { fontSize: 13, fontWeight: '600', color: '#888', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  restoCard: { backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 12, borderWidth: 0.5, borderColor: '#eee', borderLeftWidth: 4 },
  restoHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
  restoDot: { width: 10, height: 10, borderRadius: 5 },
  restoNom: { fontSize: 15, fontWeight: '600', color: '#1a1a1a', flex: 1 },
  rentaBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  rentaTxt: { fontSize: 12, fontWeight: '600' },
  restoLocalisation: { fontSize: 11, color: '#888', marginBottom: 12, marginLeft: 20 },
  restoStats: { flexDirection: 'row', gap: 0 },
  restoStat: { flex: 1, alignItems: 'center', borderRightWidth: 0.5, borderRightColor: '#f0f0f0' },
  restoStatVal: { fontSize: 12, fontWeight: '600', color: '#1a1a1a' },
  restoStatLabel: { fontSize: 9, color: '#888', marginTop: 2 },
})