// ──────────────────────────────────────────────────────────────────────────────
// Trésorerie — Résultat net par restaurant et par mois (M. Zreik et managers).
//
// Résultat = encaissé net des points validés (formule de l'écran Charges, sans
// les litiges) − charges du mois − dépenses direction comptées − pubs.
// Le mois en cours est provisoire (gris). Toucher une case montre le calcul.
// ──────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, SafeAreaView, ScrollView, Text, TouchableOpacity, View } from 'react-native'

import { Entete, EtatEcran, Feuille, Ligne, useStylesTreso, useTresorerie } from '../components/tresorerie/commun'
import { derniersMois, resultatsParRestoMois } from '../lib/direction'
import { aujourdhuiISO, fmt, libelleMois, libelleMoisCourt, peut } from '../lib/tresorerie'
import { chargerResultats } from '../lib/tresorerieDb'

const NB_MOIS = 4

export default function TresorerieResultatsScreen() {
  const { styles, colors } = useStylesTreso()
  const t = useTresorerie()
  const { donnees, niveau } = t
  const [brut, setBrut] = useState(null)
  const [chargement, setChargement] = useState(false)
  const [erreur, setErreur] = useState(null)
  const [detail, setDetail] = useState(null) // { restaurant, mois, c }

  const mois = useMemo(() => derniersMois(aujourdhuiISO(), NB_MOIS), [])
  const moisCourant = mois[mois.length - 1]

  const charger = useCallback(async () => {
    setChargement(true); setErreur(null)
    try { setBrut(await chargerResultats(mois)) }
    catch (e) { setErreur(e?.message || 'Chargement impossible.') }
    finally { setChargement(false) }
  }, [mois])

  useEffect(() => { if (peut(niveau, 'voir_resultats')) charger() }, [niveau, charger])

  const r = useMemo(() => (brut ? resultatsParRestoMois({ ...brut, mois }) : null), [brut, mois])
  const restos = donnees?.restaurants || []
  const totaux = mois.map(m => restos.reduce((s, x) => s + (r?.[x.id]?.[m]?.net || 0), 0))

  const bloque = (t.loading && !donnees) || t.erreur || !peut(niveau, 'voir_resultats')
  const largeurNom = 64

  return (
    <SafeAreaView style={styles.container}>
      <Entete titre="Résultat net" sous="Par restaurant · en milliers de F" />
      {bloque ? <EtatEcran {...t} autorise={peut(niveau, 'voir_resultats')} /> : (
        <ScrollView style={styles.body} contentContainerStyle={styles.bodyContenu}>
          {chargement && !r && (
            <View style={styles.centre}><ActivityIndicator color={colors.primary} /><Text style={styles.muted}>Calcul des résultats…</Text></View>
          )}
          {!!erreur && <Text style={styles.erreur}>{erreur}</Text>}
          {r && (
            <View style={styles.carte}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View>
                  <View style={{ flexDirection: 'row' }}>
                    <View style={{ width: largeurNom }} />
                    {mois.map(m => (
                      <Text key={m} style={[styles.lbl, { width: 78, textAlign: 'right' }]}>
                        {libelleMoisCourt(`${m}-01`).slice(0, 4)}.{m === moisCourant ? '*' : ''}
                      </Text>
                    ))}
                  </View>
                  {restos.map(x => (
                    <View key={x.id} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                      <Text style={[styles.itemTitre, { width: largeurNom, fontSize: 12 }]} numberOfLines={1}>{x.nom}</Text>
                      {mois.map(m => {
                        const c = r[x.id]?.[m]
                        const provisoire = m === moisCourant
                        const neg = (c?.net || 0) < 0
                        return (
                          <TouchableOpacity key={m} disabled={!c} onPress={() => setDetail({ restaurant: x, mois: m, c })}
                            style={{
                              width: 74, marginLeft: 4, paddingVertical: 7, paddingHorizontal: 4, borderRadius: 6,
                              backgroundColor: !c || provisoire ? 'transparent' : neg ? colors.errorLight : colors.successLight,
                            }}>
                            <Text style={{
                              textAlign: 'right', fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'],
                              color: !c ? colors.textMuted : provisoire ? colors.textMuted : neg ? colors.errorDark : colors.successDark,
                            }}>
                              {c ? milliers(c.net) : '—'}
                            </Text>
                          </TouchableOpacity>
                        )
                      })}
                    </View>
                  ))}
                  <View style={{ flexDirection: 'row', marginTop: 8, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 6 }}>
                    <Text style={[styles.itemTitre, { width: largeurNom, fontSize: 12 }]}>Groupe</Text>
                    {totaux.map((v, i) => (
                      <Text key={mois[i]} style={{
                        width: 74, marginLeft: 4, textAlign: 'right', fontSize: 12, fontWeight: '800', fontVariant: ['tabular-nums'],
                        color: mois[i] === moisCourant ? colors.textMuted : colors.text,
                      }}>{milliers(v)}</Text>
                    ))}
                  </View>
                </View>
              </ScrollView>
              <Text style={[styles.petit, { marginTop: 10 }]}>* Mois en cours : chiffre provisoire, en gris. Toucher une case pour voir le calcul.</Text>
            </View>
          )}
          <Text style={styles.petit}>
            Points validés seulement. Investissements, retraits perso et rechargements de fond ne comptent pas. Les litiges ne sont pas déduits.
          </Text>
        </ScrollView>
      )}

      {detail && (
        <Feuille visible onFermer={() => setDetail(null)} titre={`${detail.restaurant.nom} · ${libelleMois(`${detail.mois}-01`)}`}>
          <View style={styles.carte}>
            <Ligne label={`Encaissé net (${detail.c.nbPoints} points validés)`} valeur={detail.c.encaisse} />
            <Ligne label="− Charges du mois" valeur={detail.c.charges} signe="-" couleur={colors.error} />
            <Ligne label="− Dépenses direction comptées" valeur={detail.c.direction} signe="-" couleur={colors.error} />
            <Ligne label="− Pubs Yango / Glovo" valeur={detail.c.pubs} signe="-" couleur={colors.error} />
            <View style={styles.sep} />
            <Ligne label="Résultat net" valeur={detail.c.net} fort couleur={detail.c.net >= 0 ? colors.success : colors.error} />
          </View>
          {detail.mois === moisCourant && <Text style={styles.petit}>Mois en cours : le chiffre bougera jusqu'à la fin du mois.</Text>}
        </Feuille>
      )}
    </SafeAreaView>
  )
}

function milliers(v) {
  const k = Math.round(v / 1000)
  return k < 0 ? `− ${fmt(-k)}` : fmt(k)
}
