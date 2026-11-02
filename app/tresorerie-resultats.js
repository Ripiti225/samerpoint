// ──────────────────────────────────────────────────────────────────────────────
// Trésorerie — Résultat net par restaurant et par mois (M. Zreik et managers).
//
// Résultat = encaissé net des points validés (formule de l'écran Charges, sans
// les litiges) − charges du mois − dépenses direction comptées − pubs
// − hausse du crédit fournisseurs dans le mois (+ si la dette baisse).
// Loyer, salaires, CNPS, timbre, ITS, TEE, bail : au mois de leur DATE LIMITE,
// payés ou non (lib/chargesMois.js).
// Un mois à la fois, montants complets en gros : un tableau de 4 mois en
// milliers était illisible sur téléphone. Le mois en cours est provisoire.
// ──────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, SafeAreaView, ScrollView, Text, View } from 'react-native'

import {
  Entete, EtatEcran, Hero, HeroCase, Pastille, Progression, Puces, TitreSection, useStylesTreso, useTresorerie,
} from '../components/tresorerie/commun'
import { depensesGroupeParMois, derniersMois, detailDepensesGroupe, resultatsParRestoMois, retraitsPatron } from '../lib/direction'
import { aujourdhuiISO, fmt, formatDateFR, libelleMois, peut } from '../lib/tresorerie'
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
  // Dépenses du groupe (sans restaurant : dépenses direction, dettes cochées) :
  // dans aucun restaurant, seulement dans le résultat du groupe.
  const groupeParMois = useMemo(() => (brut ? depensesGroupeParMois(brut.depenses, mois, brut.charges) : {}), [brut, mois])
  const depensesGroupe = groupeParMois[moisChoisi] || 0
  const detailGroupe = useMemo(() => (brut ? detailDepensesGroupe(brut.depenses, moisChoisi, brut.charges) : []), [brut, moisChoisi])
  // Retraits du patron : affichés, jamais déduits.
  const retraits = useMemo(() => (brut ? retraitsPatron(brut.depenses, moisChoisi) : { total: 0, lignes: [] }), [brut, moisChoisi])
  const restos = donnees?.restaurants || []
  const lignes = restos
    .map(x => ({ resto: x, c: r?.[x.id]?.[moisChoisi] || null }))
    .sort((a, b) => (b.c?.net ?? -Infinity) - (a.c?.net ?? -Infinity))
  const totalRestos = lignes.reduce((s, l) => s + (l.c?.net || 0), 0)
  const totalGroupe = totalRestos - depensesGroupe
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
              <Hero icone="chart-box" titre={`Restaurants · ${libelleMois(`${moisChoisi}-01`)}`}
                valeur={`${signe(totalRestos)} F`} couleurValeur={!provisoire && totalRestos < 0 ? '#FECACA' : undefined}
                sous={provisoire ? 'Mois en cours : chiffre provisoire, il bougera jusqu\'à la fin du mois.' : 'Somme des résultats nets des restaurants'}>
                <View style={styles.heroCases}>
                  <HeroCase label="En bénéfice" couleur="#A7F3D0" valeur={`${lignes.filter(l => l.c && l.c.net >= 0).length} resto`} />
                  <HeroCase label="En perte" couleur="#FCA5A5" valeur={`${lignes.filter(l => l.c && l.c.net < 0).length} resto`} />
                  <HeroCase label="Sans point" couleur="rgba(255,255,255,0.5)" valeur={`${lignes.filter(l => !l.c).length}`} />
                </View>
              </Hero>

              <View style={styles.carte}>
                <View style={styles.carteEntete}>
                  <Pastille icone="domain" couleur={provisoire ? colors.textSecondary : totalGroupe < 0 ? colors.error : colors.success} taille={42} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.itemTitre, { fontSize: 16 }]} numberOfLines={1}>Résultat du groupe</Text>
                    <Text style={styles.petit}>Restaurants, moins les dépenses du groupe</Text>
                  </View>
                  <Text style={{ fontSize: 19, fontWeight: '800', fontVariant: ['tabular-nums'], color: couleurNet(totalGroupe) }}>
                    {signe(totalGroupe)}
                  </Text>
                </View>
                <Detail point={colors.success} label="Résultat des restaurants" valeur={signe(totalRestos)} />
                {detailGroupe.map(g => (
                  <Detail key={g.cle} point="#7C3AED" label={`${g.label}${g.nb > 1 ? ` (${g.nb})` : ''}`} valeur={`− ${fmt(g.montant)}`} />
                ))}
                {!detailGroupe.length && <Text style={[styles.petit, { marginTop: 6 }]}>Aucune dépense du groupe ce mois-ci.</Text>}
              </View>

              {retraits.lignes.length > 0 && (
                <View style={styles.carte}>
                  <View style={styles.carteEntete}>
                    <Pastille icone="account-arrow-right-outline" couleur="#64748B" taille={42} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[styles.itemTitre, { fontSize: 16 }]} numberOfLines={1}>Retraits du patron</Text>
                      <Text style={styles.petit}>Affichés pour mémoire, non déduits du résultat</Text>
                    </View>
                    <Text style={{ fontSize: 17, fontWeight: '800', fontVariant: ['tabular-nums'], color: colors.textSecondary }}>
                      {fmt(retraits.total)}
                    </Text>
                  </View>
                  {retraits.lignes.map(l => (
                    <Detail key={l.id} point="#64748B" label={`${formatDateFR(l.date)}${l.note ? ` · ${l.note}` : ''}`} valeur={fmt(l.montant)} />
                  ))}
                </View>
              )}

              <TitreSection icone="storefront-outline" titre="Par restaurant" droite="du meilleur au moins bon" />
              {lignes.map(({ resto, c }) => {
                const ton = !c ? colors.textMuted : provisoire ? colors.textSecondary : c.net < 0 ? colors.error : colors.success
                const sorties = c ? c.charges + (c.direction || 0) + (c.pubs || 0) + (c.glovoRemboursements || 0) + (c.glovoTempsAttente || 0) : 0
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
                        {c.glovoRemboursements > 0 && <Detail point="#E11D48" label="Remboursements Glovo" valeur={`− ${fmt(c.glovoRemboursements)}`} />}
                        {c.glovoTempsAttente > 0 && <Detail point="#E11D48" label="Temps d'attente Glovo" valeur={`− ${fmt(c.glovoTempsAttente)}`} />}
                        {c.variationCredit !== 0 && (
                          <Detail point={colors.warning}
                            label={`Crédit fournisseurs ${fmt(c.creditDebut)} → ${fmt(c.creditFin)}${c.creditAjustements ? `, hors corrections (${fmt(c.creditAjustements)})` : ''}`}
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
            Points validés seulement. Loyer et salaires comptent au mois de leur date limite, payés ou non (le loyer de juin, dû début juillet, pèse sur juillet) ; CNPS, timbre, ITS, TEE et bail aussi, jusqu'à leur passage en fournisseurs administratifs. Les cotisations remises au RH (Banque → « Cotisation salaire », « Cotisations autres ») réduisent les charges du restaurant le mois de leur réception. Investissements, retraits perso et rechargements de fond ne comptent pas. Seuls les remboursements et temps d'attente Glovo sont déduits : les autres litiges (écart, tapé ±, inventaire, avis, contacts) sont déjà dans l'encaissé. Crédit fournisseurs : une dette qui monte dans le mois est une marchandise reçue sans être payée, elle est retirée ; une dette qui baisse est ajoutée (cotisations, loyer et anciens CNPS, timbre, bail exclus, déjà dans les charges ; exclus aussi PALMCI, Sécurité, Boss, et les fournisseurs administratifs depuis leur passage, droits des anciens travailleurs compris : leur montant dû n'est pas une charge, seul leur paiement l'est — déjà dans les dépenses du restaurant s'il paie avec la caisse, ou dans les dépenses direction si la direction paie ; avant octobre 2026, un crédit négatif, souvent une facture oubliée, compte pour 0 ; depuis, les corrections « Modifié directement » ne comptent pas). Résultat du groupe : les dépenses sans restaurant ne pèsent sur aucun restaurant, elles ne sont retirées que du résultat du groupe — dépenses direction saisies sur « Groupe » (matériel, réparation, équipement, autre dépense, arriérés CNPS d'avant octobre 2026, anciens d'un site fermé) et paiements des dettes cochées « Compte dans le résultat » (au mois du paiement). Une dette cochée qui a un restaurant pèse sur ce restaurant. Fond, investissements et retraits du patron ne comptent pas ; les retraits sont affichés pour mémoire.
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
