// ──────────────────────────────────────────────────────────────────────────────
// Trésorerie — Résultat net par restaurant et par mois (M. Zreik et managers).
//
// Résultat = encaissé net des points validés (formule de l'écran Charges, sans
// les litiges) − charges du mois − dépenses direction comptées − pubs.
// Un mois à la fois, montants complets en gros : un tableau de 4 mois en
// milliers était illisible sur téléphone. Le mois en cours est provisoire.
// ──────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, SafeAreaView, ScrollView, Text, View } from 'react-native'

import { Entete, EtatEcran, Puces, useStylesTreso, useTresorerie } from '../components/tresorerie/commun'
import { derniersMois, resultatsParRestoMois } from '../lib/direction'
import { aujourdhuiISO, fmt, libelleMois, peut } from '../lib/tresorerie'
import { chargerResultats } from '../lib/tresorerieDb'

const NB_MOIS = 4

export default function TresorerieResultatsScreen() {
  const { styles, colors } = useStylesTreso()
  const t = useTresorerie()
  const { donnees, niveau } = t
  const [brut, setBrut] = useState(null)
  const [chargement, setChargement] = useState(false)
  const [erreur, setErreur] = useState(null)

  const mois = useMemo(() => derniersMois(aujourdhuiISO(), NB_MOIS), [])
  const moisCourant = mois[mois.length - 1]
  // Par défaut le dernier mois terminé : le mois en cours n'est que provisoire.
  const [moisChoisi, setMoisChoisi] = useState(mois[mois.length - 2])

  const charger = useCallback(async () => {
    setChargement(true); setErreur(null)
    try { setBrut(await chargerResultats(mois)) }
    catch (e) { setErreur(e?.message || 'Chargement impossible.') }
    finally { setChargement(false) }
  }, [mois])

  useEffect(() => { if (peut(niveau, 'voir_resultats')) charger() }, [niveau, charger])

  const r = useMemo(() => (brut ? resultatsParRestoMois({ ...brut, mois }) : null), [brut, mois])
  const restos = donnees?.restaurants || []
  const lignes = restos
    .map(x => ({ resto: x, c: r?.[x.id]?.[moisChoisi] || null }))
    .sort((a, b) => (b.c?.net ?? -Infinity) - (a.c?.net ?? -Infinity))
  const total = lignes.reduce((s, l) => s + (l.c?.net || 0), 0)
  const provisoire = moisChoisi === moisCourant
  const signe = v => (v < 0 ? `− ${fmt(-v)}` : `+ ${fmt(v)}`)
  const couleurNet = v => (provisoire ? colors.textSecondary : v < 0 ? colors.error : colors.success)

  const bloque = (t.loading && !donnees) || t.erreur || !peut(niveau, 'voir_resultats')

  return (
    <SafeAreaView style={styles.container}>
      <Entete titre="Résultat net" sous="Par restaurant" />
      {bloque ? <EtatEcran {...t} autorise={peut(niveau, 'voir_resultats')} /> : (
        <ScrollView style={styles.body} contentContainerStyle={styles.bodyContenu}>
          <Puces
            options={mois.slice().reverse().map(m => ({
              valeur: m, label: `${libelleMois(`${m}-01`)}${m === moisCourant ? ' (en cours)' : ''}`,
            }))}
            valeur={moisChoisi} onChange={setMoisChoisi}
          />

          {chargement && !r && (
            <View style={styles.centre}><ActivityIndicator color={colors.primary} /><Text style={styles.muted}>Calcul des résultats…</Text></View>
          )}
          {!!erreur && <Text style={styles.erreur}>{erreur}</Text>}

          {r && (
            <>
              <View style={styles.carte}>
                <Text style={styles.lbl}>Groupe · {libelleMois(`${moisChoisi}-01`)}</Text>
                <Text style={[styles.grand, { color: couleurNet(total) }]}>{signe(total)} F</Text>
                {provisoire && <Text style={styles.petit}>Mois en cours : chiffre provisoire, il bougera jusqu'à la fin du mois.</Text>}
              </View>

              {lignes.map(({ resto, c }) => (
                <View key={resto.id} style={[styles.carte, {
                  borderLeftWidth: 5,
                  borderLeftColor: !c ? colors.border : provisoire ? colors.textMuted : c.net < 0 ? colors.error : colors.success,
                }]}>
                  <View style={styles.ligne}>
                    <Text style={[styles.itemTitre, { fontSize: 16 }]}>{resto.nom}</Text>
                    <Text style={{ fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'], color: c ? couleurNet(c.net) : colors.textMuted }}>
                      {c ? `${signe(c.net)} F` : '—'}
                    </Text>
                  </View>
                  {c ? (
                    <View style={{ marginTop: 6, gap: 2 }}>
                      <Detail label={`Encaissé net (${c.nbPoints} points validés)`} valeur={fmt(c.encaisse)} />
                      <Detail label="Charges du mois" valeur={`− ${fmt(c.charges)}`} />
                      {c.direction > 0 && <Detail label="Dépenses direction" valeur={`− ${fmt(c.direction)}`} />}
                      {c.pubs > 0 && <Detail label="Pubs Yango / Glovo" valeur={`− ${fmt(c.pubs)}`} />}
                    </View>
                  ) : (
                    <Text style={styles.petit}>Aucun point validé ce mois-ci.</Text>
                  )}
                </View>
              ))}
            </>
          )}
          <Text style={styles.petit}>
            Points validés seulement. Investissements, retraits perso et rechargements de fond ne comptent pas. Les litiges ne sont pas déduits.
          </Text>
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

function Detail({ label, valeur }) {
  const { styles } = useStylesTreso()
  return (
    <View style={styles.ligne}>
      <Text style={[styles.ligneLabel, { fontSize: 13 }]}>{label}</Text>
      <Text style={[styles.ligneValeur, { fontSize: 13 }]}>{valeur}</Text>
    </View>
  )
}
