/*
 * Récap des comptages du vérificateur (table verifications_stock).
 * Réutilisé dans l'onglet « Récap » du vérificateur (app/verificateur.js) et
 * dans l'écran admin app/recap-verifications.js (manager / directeur / RH).
 *
 * Affiche les comptages des 7 derniers jours, regroupés par session (lot_id) :
 * restaurant, date, vérificateur, % d'écart, et détail produit par produit.
 */

import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, Modal, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { useApp } from '../context/AppContext'
import { journaliser } from '../lib/journal'
import { supabase } from '../lib/supabase'
import { corrigerComptage } from '../lib/verificationStock'

// Une faute de frappe au comptage fausse le stock initial de l'inventaire :
// ces rôles peuvent corriger le nombre compté après validation.
const ROLES_CORRECTION = ['manager', 'directeur', 'verificateur']

export default function RecapVerifications({ colors, restaurantId = null }) {
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { roleActif, userId, userNom } = useApp() ?? {}
  const peutCorriger = ROLES_CORRECTION.includes(roleActif)

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [sessions, setSessions] = useState([])
  const [ouverts, setOuverts] = useState({}) // { key: bool }
  const [corr, setCorr] = useState(null)     // ligne en cours de correction
  const [corrVal, setCorrVal] = useState('')
  const [corrSaving, setCorrSaving] = useState(false)

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

  function ouvrirCorrection(ligne) {
    setCorr(ligne)
    setCorrVal(String(ligne.stock_compte ?? ''))
  }

  async function enregistrerCorrection() {
    if (!corr) return
    const val = parseFloat(String(corrVal).replace(',', '.'))
    if (isNaN(val) || val < 0) {
      Alert.alert('Nombre invalide', 'Saisissez le nombre réellement compté.')
      return
    }
    if (val === Number(corr.stock_compte)) { setCorr(null); return }

    setCorrSaving(true)
    const res = await corrigerComptage({ ligne: corr, nouveauCompte: val, userId, userNom })
    setCorrSaving(false)

    if (res.statut === 'erreur') {
      Alert.alert('Erreur', res.message || 'Correction impossible')
      return
    }

    journaliser('correction_comptage_verificateur', {
      produit: corr.produit_nom, ancien: corr.stock_compte, nouveau: val,
      report: res.report,
    }, { restaurantId: corr.restaurant_id, userId }).catch(() => {})

    const suite =
      res.statut === 'migration'
        ? '\n\n⚠️ Le stock initial de l’inventaire n’a pas été mis à jour (mise à jour de la base requise).'
        : res.report === 'ouvert'
          ? '\n\n📦 Le stock initial de l’inventaire en cours a été corrigé.'
          : res.report === 'prochain'
            ? '\n\n📦 Le prochain inventaire partira de ce nombre.'
            : '\n\n⚠️ L’inventaire concerné est déjà validé : son stock initial n’a pas été retouché.'

    setCorr(null)
    await charger()
    Alert.alert('✅ Comptage corrigé', `${corr.produit_nom} : ${Number(corr.stock_compte)} → ${val}.${suite}`)
  }

  function heure(ts) {
    if (!ts) return ''
    try { return new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) } catch { return '' }
  }

  if (loading) return (
    <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
  )

  return (
    <>
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: 12, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} /> }
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
                  {peutCorriger && <Text style={styles.dEditCol} />}
                </View>
                {s.lignes.map((l, i) => {
                  const e = Number(l.ecart || 0)
                  const enEcart = Math.abs(e) > 0.001
                  const corrige = l.corrige_at != null
                  return (
                    <View key={i} style={styles.dRow}>
                      <View style={styles.dProduit}>
                        <Text style={styles.dProduitTxt} numberOfLines={1}>{l.produit_nom}</Text>
                        {corrige && (
                          <Text style={styles.dCorrige} numberOfLines={1}>
                            ✏️ corrigé{l.stock_compte_origine != null ? ` (saisi ${Number(l.stock_compte_origine)})` : ''}
                            {l.corrige_par_nom ? ` · ${l.corrige_par_nom}` : ''}
                          </Text>
                        )}
                      </View>
                      <Text style={[styles.dNum, styles.dMuted]}>{Number(l.stock_reel)}</Text>
                      <Text style={styles.dNum}>{Number(l.stock_compte)}</Text>
                      <Text style={[styles.dNum, enEcart && styles.dEcart]}>{enEcart ? (e > 0 ? '+' : '') + e : '0'}</Text>
                      {peutCorriger && (
                        <TouchableOpacity style={styles.dEditCol} onPress={() => ouvrirCorrection(l)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                          <Text style={styles.dEditTxt}>✏️</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  )
                })}
              </View>
            )}
          </View>
        )
      })}
    </ScrollView>

    {/* Correction du nombre compté (faute de frappe du vérificateur) */}
    <Modal visible={corr != null} transparent animationType="fade" onRequestClose={() => setCorr(null)}>
      <View style={styles.mOverlay}>
        <View style={styles.mBox}>
          <Text style={styles.mTitre}>✏️ Corriger le nombre compté</Text>
          {corr && (
            <>
              <Text style={styles.mProduit}>{corr.produit_nom}</Text>
              <Text style={styles.mInfo}>
                Stock déclaré par le caissier : {Number(corr.stock_reel)}
                {'\n'}Compté par {corr.verificateur_nom || 'le vérificateur'} : {Number(corr.stock_compte)}
              </Text>

              <Text style={styles.mLabel}>Nombre réellement compté</Text>
              <TextInput
                style={styles.mInput}
                keyboardType="numeric"
                value={corrVal}
                onChangeText={t => setCorrVal(t.replace(',', '.').replace(/[^0-9.]/g, ''))}
                placeholder="0"
                placeholderTextColor={colors.textMuted}
                autoFocus
              />
              {(() => {
                const v = parseFloat(corrVal)
                if (isNaN(v)) return null
                const ne = v - Number(corr.stock_reel)
                return (
                  <Text style={styles.mApercu}>
                    Nouvel écart : <Text style={{ fontWeight: '800', color: Math.abs(ne) > 0.001 ? '#A32D2D' : '#3B6D11' }}>
                      {ne > 0 ? '+' : ''}{Math.round(ne * 100) / 100}
                    </Text>
                  </Text>
                )
              })()}
              <Text style={styles.mHint}>
                Seul le nombre compté change. Le stock initial de l’inventaire suit automatiquement, sauf si cet inventaire est déjà validé.
              </Text>

              <View style={styles.mBtnRow}>
                <TouchableOpacity style={[styles.mBtn, styles.mBtnCancel]} onPress={() => setCorr(null)} disabled={corrSaving}>
                  <Text style={styles.mBtnCancelTxt}>Annuler</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.mBtn, styles.mBtnOk, corrSaving && { opacity: 0.5 }]}
                  onPress={enregistrerCorrection}
                  disabled={corrSaving}
                >
                  <Text style={styles.mBtnOkTxt}>{corrSaving ? '…' : 'Enregistrer'}</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
    </>
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
    dProduit: { flex: 1, paddingRight: 6 },
    dProduitTxt: { fontSize: 12, color: colors.text },
    dCorrige: { fontSize: 10, color: '#854F0B', marginTop: 1 },
    dNum: { width: 56, textAlign: 'center', fontSize: 12, color: colors.text },
    dMuted: { color: colors.textMuted },
    dEcart: { color: '#A32D2D', fontWeight: '800' },
    dEditCol: { width: 30, alignItems: 'center' },
    dEditTxt: { fontSize: 14 },

    mOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', paddingHorizontal: 24 },
    mBox: { backgroundColor: colors.surface, borderRadius: 16, padding: 18 },
    mTitre: { fontSize: 16, fontWeight: '800', color: colors.text, textAlign: 'center', marginBottom: 10 },
    mProduit: { fontSize: 15, fontWeight: '700', color: colors.text, textAlign: 'center' },
    mInfo: { fontSize: 12, color: colors.textMuted, textAlign: 'center', marginTop: 6, marginBottom: 12, lineHeight: 18 },
    mLabel: { fontSize: 12, fontWeight: '700', color: colors.text, marginBottom: 6 },
    mInput: {
      borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12,
      paddingVertical: 10, fontSize: 16, color: colors.text, backgroundColor: colors.bg,
    },
    mApercu: { fontSize: 13, color: colors.textMuted, marginTop: 8, textAlign: 'center' },
    mHint: { fontSize: 11, color: colors.textMuted, marginTop: 8, lineHeight: 16 },
    mBtnRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
    mBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
    mBtnCancel: { borderWidth: 1, borderColor: colors.border },
    mBtnCancelTxt: { fontSize: 13, fontWeight: '700', color: colors.text },
    mBtnOk: { backgroundColor: '#EF9F27' },
    mBtnOkTxt: { fontSize: 13, fontWeight: '800', color: '#412402' },
  })
}
