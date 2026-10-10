// ──────────────────────────────────────────────────────────────────────────────
// Trésorerie — Résultat net par restaurant et par mois (M. Zreik et managers).
//
// Résultat = encaissé net des points validés (formule de l'écran Charges, sans
// les litiges) − charges du mois − dépenses direction comptées − pubs
// − hausse du crédit fournisseurs dans le mois (+ si la dette baisse).
// Loyer, salaires, CNPS, impôts, ITS, TEE, bail : au mois de leur DATE LIMITE,
// payés ou non (lib/chargesMois.js).
// Un mois à la fois, montants complets en gros : un tableau de 4 mois en
// milliers était illisible sur téléphone. Le mois en cours est provisoire.
// ──────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, SafeAreaView, ScrollView, Text, View } from 'react-native'

import {
  Entete, EtatEcran, Hero, HeroCase, Pastille, Progression, Puces, TitreSection, useStylesTreso, useTresorerie,
} from '../components/tresorerie/commun'
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
              <Hero icone="chart-box" titre={`Groupe · ${libelleMois(`${moisChoisi}-01`)}`}
                valeur={`${signe(total)} F`} couleurValeur={!provisoire && total < 0 ? '#FECACA' : undefined}
                sous={provisoire ? 'Mois en cours : chiffre provisoire, il bougera jusqu\'à la fin du mois.' : 'Somme des résultats nets des restaurants'}>
                <View style={styles.heroCases}>
                  <HeroCase label="En bénéfice" couleur="#A7F3D0" valeur={`${lignes.filter(l => l.c && l.c.net >= 0).length} resto`} />
                  <HeroCase label="En perte" couleur="#FCA5A5" valeur={`${lignes.filter(l => l.c && l.c.net < 0).length} resto`} />
                  <HeroCase label="Sans point" couleur="rgba(255,255,255,0.5)" valeur={`${lignes.filter(l => !l.c).length}`} />
                </View>
              </Hero>

              <TitreSection icone="storefront-outline" titre="Par restaurant" droite="du meilleur au moins bon" />
              {lignes.map(({ resto, c }) => {
                const ton = !c ? colors.textMuted : provisoire ? colors.textSecondary : c.net < 0 ? colors.error : colors.success
                const sorties = c ? c.charges + (c.direction || 0) + (c.pubs || 0) : 0
                const part = c && c.encaisse > 0 ? Math.round((sorties / c.encaisse) * 100) : null
                return (
                  <View key={resto.id} style={styles.carte}>
                    <View style={styles.carteEntete}>
                      <Pastille icone={c && c.net < 0 ? 'trending-down' : 'trending-up'} couleur={ton} taille={42} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={[styles.itemTitre, { fontSize: 16 }]} numberOfLines={1}>{resto.nom}</Text>
                        <Text style={styles.petit}>{c ? `${c.nbPoints} points validés` : 'Aucun point validé ce mois-ci'}</Text>
                      </View>
                      <Text style={{ fontSize: 19, fontWeight: '800', fontVariant: ['tabular-nums'], color: c ? couleurNet(c.net) : colors.textMuted }}>
                        {c ? `${signe(c.net)}` : '—'}
                      </Text>
                    </View>
                    {c && (
                      <>
                        <Detail point={colors.success} label="Encaissé net" valeur={fmt(c.encaisse)} />
                        {c.litigesRetenus > 0 && <Detail point={colors.success} label="Litiges retenus sur salaires" valeur={`+ ${fmt(c.litigesRetenus)}`} />}
                        <Detail point={colors.error} label="Charges du mois" valeur={`− ${fmt(c.charges)}`} />
                        {c.direction > 0 && <Detail point="#7C3AED" label="Dépenses direction" valeur={`− ${fmt(c.direction)}`} />}
                        {c.pubs > 0 && <Detail point="#E11D48" label="Pubs Yango / Glovo" valeur={`− ${fmt(c.pubs)}`} />}
                        {c.variationCredit !== 0 && (
                          <Detail point={colors.warning}
                            label={`Crédit fournisseurs ${fmt(c.creditDebut)} → ${fmt(c.creditFin)}`}
                            valeur={c.variationCredit > 0 ? `− ${fmt(c.variationCredit)}` : `+ ${fmt(-c.variationCredit)}`} />
                        )}
                        {part !== null && (
                          <View style={{ marginTop: 10 }}>
                            <Progression pct={part} couleur={part > 100 ? colors.error : colors.warning} hauteur={8} />
                            <Text style={[styles.petit, { marginTop: 5 }]}>Les sorties prennent {part} % de l'encaissé</Text>
                          </View>
                        )}
                      </>
                    )}
                  </View>
                )
              })}
            </>
          )}
          <Text style={styles.petit}>
            Points validés seulement. Loyer, salaires, CNPS, impôts, ITS, TEE et bail comptent au mois de leur date limite, payés ou non (le loyer de juin, dû début juillet, pèse sur juillet). Investissements, retraits perso et rechargements de fond ne comptent pas. Les litiges ne sont pas déduits. Crédit fournisseurs : une dette qui monte dans le mois est une marchandise reçue sans être payée, elle est retirée ; une dette qui baisse est ajoutée (cotisations, CNPS, impôts, loyer et bail exclus, déjà dans les charges).
          </Text>
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

function Detail({ label, valeur, point }) {
  const { styles } = useStylesTreso()
  return (
    <View style={styles.ligne}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: point }} />
        <Text style={[styles.ligneLabel, { fontSize: 13 }]}>{label}</Text>
      </View>
      <Text style={[styles.ligneValeur, { fontSize: 13 }]}>{valeur}</Text>
    </View>
  )
}
