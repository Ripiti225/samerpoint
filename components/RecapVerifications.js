/*
 * Récap des comptages du vérificateur (table verifications_stock).
 * Réutilisé dans l'onglet « Récap » du vérificateur (app/verificateur.js) et
 * dans l'écran admin app/recap-verifications.js (manager / directeur / RH).
 *
 * Affiche les comptages des 7 derniers jours, regroupés par session (lot_id) :
 * restaurant, date, vérificateur, % d'écart, et détail produit par produit.
 */

import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { supabase } from '../lib/supabase'

export default function RecapVerifications({ colors, restaurantId = null }) {
  const styles = useMemo(() => makeStyles(colors), [colors])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [sessions, setSessions] = useState([])
  const [ouverts, setOuverts] = useState({}) // { key: bool }

  useEffect(() => { charger() }, [restaurantId])

  async function charger() {
    setLoading(true)
    const depuis = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10)
    let q = supabase.from('verifications_stock').select('*').gte('date', depuis).order('created_at', { ascending: false })
    if (restaurantId) q = q.eq('restaurant_id', restaurantId)
    const { data, error } = await q
    if (error) { setSessions([]); setLoading(false); return } // table absente / pas de données

    const restoIds = [...new Set((data || []).map(r => r.restaurant_id).filter(Boolean))]
    const restoMap = {}
    if (restoIds.length) {
      const { data: rs } = await supabase.from('restaurants').select('id, nom').in('id', restoIds)
      ;(rs || []).forEach(r => { restoMap[r.id] = r.nom })
    }

    const groups = {}
    ;(data || []).forEach(row => {
      const key = row.lot_id || `${row.restaurant_id}|${row.date}|${row.verificateur_id}`
      if (!groups[key]) {
        groups[key] = {
          key, restaurant_id: row.restaurant_id, restaurantNom: restoMap[row.restaurant_id] || '—',
          date: row.date, verificateurNom: row.verificateur_nom, created_at: row.created_at, lignes: [],
        }
      }
      groups[key].lignes.push(row)
    })

    const list = Object.values(groups).map(g => {
      const ecarts = g.lignes.filter(l => Math.abs(Number(l.ecart || 0)) > 0.001)
      return { ...g, nbComptes: g.lignes.length, nbEcarts: ecarts.length, pct: g.lignes.length ? Math.round(ecarts.length / g.lignes.length * 100) : 0 }
    }).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))

    setSessions(list)
    setLoading(false)
  }

  async function onRefresh() { setRefreshing(true); await charger(); setRefreshing(false) }
  function toggle(key) { setOuverts(p => ({ ...p, [key]: !p[key] })) }

  function heure(ts) {
    if (!ts) return ''
    try { return new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) } catch { return '' }
  }

  if (loading) return (
    <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
  )

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: 12, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      {sessions.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>🗒️</Text>
          <Text style={styles.emptyTxt}>Aucune vérification</Text>
          <Text style={styles.emptySub}>Aucun comptage enregistré sur les 7 derniers jours.</Text>
        </View>
      ) : sessions.map(s => {
        const ouvert = !!ouverts[s.key]
        const alerte = s.pct >= 40
        return (
          <View key={s.key} style={styles.card}>
            <TouchableOpacity style={styles.cardHead} onPress={() => toggle(s.key)} activeOpacity={0.7}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardResto}>{s.restaurantNom}</Text>
                <Text style={styles.cardMeta}>
                  {s.date}{heure(s.created_at) ? ` · ${heure(s.created_at)}` : ''}
                  {s.verificateurNom ? ` · ${s.verificateurNom}` : ''}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[styles.cardPct, alerte && styles.cardPctAlert]}>{s.pct}%{alerte ? ' ⚠️' : ''}</Text>
                <Text style={styles.cardSub}>{s.nbEcarts}/{s.nbComptes} écart(s)</Text>
              </View>
              <Text style={styles.chevron}>{ouvert ? '▾' : '▸'}</Text>
            </TouchableOpacity>

            {ouvert && (
              <View style={styles.detail}>
                <View style={styles.detailHead}>
                  <Text style={[styles.dProduit, styles.dHeadTxt]}>Produit</Text>
                  <Text style={[styles.dNum, styles.dHeadTxt]}>Réel</Text>
                  <Text style={[styles.dNum, styles.dHeadTxt]}>Compté</Text>
                  <Text style={[styles.dNum, styles.dHeadTxt]}>Écart</Text>
                </View>
                {s.lignes.map((l, i) => {
                  const e = Number(l.ecart || 0)
                  const enEcart = Math.abs(e) > 0.001
                  return (
                    <View key={i} style={styles.dRow}>
                      <Text style={styles.dProduit} numberOfLines={1}>{l.produit_nom}</Text>
                      <Text style={[styles.dNum, styles.dMuted]}>{Number(l.stock_reel)}</Text>
                      <Text style={styles.dNum}>{Number(l.stock_compte)}</Text>
                      <Text style={[styles.dNum, enEcart && styles.dEcart]}>{enEcart ? (e > 0 ? '+' : '') + e : '0'}</Text>
                    </View>
                  )
                })}
              </View>
            )}
          </View>
        )
      })}
    </ScrollView>
  )
}

function makeStyles(colors) {
  return StyleSheet.create({
    center: { alignItems: 'center', justifyContent: 'center', padding: 40, gap: 6 },
    emptyIcon: { fontSize: 38 },
    emptyTxt: { fontSize: 16, fontWeight: '600', color: colors.text },
    emptySub: { fontSize: 13, color: colors.textMuted, textAlign: 'center' },
    card: { backgroundColor: colors.surface, borderRadius: 14, marginBottom: 10, borderWidth: 0.5, borderColor: colors.border, overflow: 'hidden' },
    cardHead: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 10 },
    cardResto: { fontSize: 15, fontWeight: '700', color: colors.text },
    cardMeta: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
    cardPct: { fontSize: 17, fontWeight: '800', color: '#3B6D11' },
    cardPctAlert: { color: '#A32D2D' },
    cardSub: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
    chevron: { fontSize: 16, color: colors.textMuted, width: 16, textAlign: 'center' },
    detail: { borderTopWidth: 0.5, borderTopColor: colors.border, paddingHorizontal: 12, paddingBottom: 10 },
    detailHead: { flexDirection: 'row', paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: colors.border },
    dHeadTxt: { fontSize: 10, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase' },
    dRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 0.5, borderBottomColor: colors.border },
    dProduit: { flex: 1, fontSize: 12, color: colors.text, paddingRight: 6 },
    dNum: { width: 56, textAlign: 'center', fontSize: 12, color: colors.text },
    dMuted: { color: colors.textMuted },
    dEcart: { color: '#A32D2D', fontWeight: '800' },
  })
}
