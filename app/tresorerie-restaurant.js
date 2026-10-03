// ──────────────────────────────────────────────────────────────────────────────
// Trésorerie — historique d'un restaurant : tout ce qu'il a dû et payé, mois par
// mois (loyer, salaires, CNPS, impôts, ITS, TEE, bail, autres charges), avec le
// choix du mois ou de l'année. Un appui sur une ligne ouvre son détail.
// Ouvert depuis la carte loyer d'un restaurant (À payer) ou depuis l'accueil.
// Logique : lib/historique.js (historiqueRestaurant)
// ──────────────────────────────────────────────────────────────────────────────
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { SafeAreaView, ScrollView, Text, View } from 'react-native'

import {
  Entete, EtatEcran, Hero, HeroCase, ItemIcone, Puces, TitreSection, styleCategorie, useStylesTreso, useTresorerie,
} from '../components/tresorerie/commun'
import { Badge, FeuilleDetail, FeuillePaiement, FeuillePrevision, couleursStatut, titreDu } from '../components/tresorerie/du'
import { ChoixPeriode, libellePeriode, periodeParDefaut } from '../components/tresorerie/historique'
import { historiqueRestaurant } from '../lib/historique'
import {
  CATEGORIES_SERIE, LIBELLES_CATEGORIE, aujourdhuiISO, categoriesVisibles, classerTous, fmt, formatDateFR,
  libelleMois, paiementsParDu, peut,
} from '../lib/tresorerie'

export default function TresorerieRestaurantScreen() {
  const { styles, colors } = useStylesTreso()
  const params = useLocalSearchParams()
  const t = useTresorerie()
  const { donnees, niveau, user, recharger } = t
  const [restaurantId, setRestaurantId] = useState(params.id || null)
  const [periode, setPeriode] = useState(periodeParDefaut)
  const [detail, setDetail] = useState(null)
  const [paiement, setPaiement] = useState(null)
  const [prevoir, setPrevoir] = useState(null)

  useEffect(() => {
    if (!restaurantId && donnees?.restaurants?.length) setRestaurantId(donnees.restaurants[0].id)
  }, [donnees, restaurantId])

  const aujourdhui = aujourdhuiISO()
  // Ce que ce compte a le droit de voir : les charges en série (RH compris), et
  // les autres charges pour qui voit les dépenses direction.
  const categories = useMemo(() => [
    ...CATEGORIES_SERIE.filter(c => categoriesVisibles(niveau).includes(c)),
    ...(peut(niveau, 'voir_direction') ? ['autre'] : []),
  ], [niveau])
  const parDu = useMemo(() => paiementsParDu(donnees?.paiements), [donnees])
  const classement = useMemo(() => (donnees ? classerTous(donnees.dus, donnees.paiements, aujourdhui) : {}), [donnees, aujourdhui])
  const mois = useMemo(
    () => (donnees && restaurantId ? historiqueRestaurant(donnees.dus, donnees.paiements, restaurantId, { periode, categories }) : []),
    [donnees, restaurantId, periode, categories],
  )
  const dates = useMemo(
    () => (donnees?.dus || []).filter(d => d.restaurant_id === restaurantId).map(d => d.mois || d.created_at),
    [donnees, restaurantId],
  )
  const total = mois.reduce((s, m) => ({ du: s.du + m.du, paye: s.paye + m.paye, reste: s.reste + m.reste }), { du: 0, paye: 0, reste: 0 })

  const nomResto = id => donnees?.restaurants.find(r => r.id === id)?.nom || 'Groupe'
  const cs = couleursStatut(colors)
  const autorise = peut(niveau, 'voir_a_payer')
  const bloque = (t.loading && !donnees) || t.erreur || !autorise

  return (
    <SafeAreaView style={styles.container}>
      <Entete titre="Historique" sous={restaurantId ? nomResto(restaurantId) : null} repli="/tresorerie-a-payer" />
      {bloque ? <EtatEcran {...t} autorise={autorise} /> : (
        <ScrollView style={styles.body} contentContainerStyle={styles.bodyContenu}>
          <Text style={styles.label}>Restaurant</Text>
          <Puces options={donnees.restaurants.map(r => ({ valeur: r.id, label: r.nom }))} valeur={restaurantId} onChange={setRestaurantId} />
          <Text style={styles.label}>Période</Text>
          <ChoixPeriode dates={dates} valeur={periode} onChange={setPeriode} />

          <Hero icone="storefront-outline" titre={`${nomResto(restaurantId)} · ${libellePeriode(periode)}`}
            valeur={total.reste ? `reste ${fmt(total.reste)} F` : 'Tout est payé'}>
            <View style={styles.heroCases}>
              <HeroCase label="Dû" valeur={fmt(total.du)} couleur="rgba(255,255,255,0.6)" />
              <HeroCase label="Payé" valeur={fmt(total.paye)} couleur="#A7F3D0" />
              <HeroCase label="Reste" valeur={fmt(total.reste)} couleur="#FCA5A5" />
            </View>
          </Hero>

          {mois.length === 0 && <Text style={styles.vide}>Rien sur cette période.</Text>}
          {mois.map(m => (
            <View key={m.mois}>
              <TitreSection icone="calendar-month-outline" titre={libelleMois(m.mois)}
                droite={<View style={[styles.etatPilule, { backgroundColor: m.reste ? colors.errorLight : colors.successLight }]}>
                  <Text style={[styles.etatPiluleTxt, { color: m.reste ? colors.errorDark : colors.successDark }]}>
                    {m.reste ? `reste ${fmt(m.reste)}` : 'tout payé'}
                  </Text>
                </View>} />
              {m.lignes.map(({ du, paye, reste }) => {
                const st = classement[du.id] || 'a_payer'
                const sc = styleCategorie(du.categorie)
                return (
                  <ItemIcone key={du.id} onPress={() => setDetail(du)} icone={sc.icone} couleur={sc.couleur}
                    titre={`${LIBELLES_CATEGORIE[du.categorie]}${du.categorie === 'autre' ? ` · ${titreDu(du, nomResto)}` : ''}`}
                    sous={`dû ${fmt(du.montant_du)} · payé ${fmt(paye)}${du.echeance ? ` · date limite ${formatDateFR(du.echeance)}` : ''}`}
                    droite={reste ? `${fmt(reste)} F` : 'payé'} couleurDroite={reste ? colors.error : colors.successDark}
                    sousDroite={cs[st] ? <Badge c={cs[st]} /> : null} />
                )
              })}
            </View>
          ))}
          <Text style={styles.petit}>
            Chaque charge est rangée au mois qu'elle concerne (le loyer de septembre en septembre, même payé en octobre).
            Un appui sur une ligne montre ses versements.
          </Text>
        </ScrollView>
      )}

      {donnees && (
        <>
          <FeuilleDetail
            du={detail} paiements={detail ? parDu[detail.id] || [] : []} classement={detail ? classement[detail.id] : null}
            donnees={donnees} niveau={niveau} aujourdhui={aujourdhui} nomResto={nomResto} user={user}
            onFermer={() => setDetail(null)}
            onPayer={(du, prevision) => {
              setDetail(null)
              setPaiement(du.categorie === 'loyer' && !prevision ? { categorie: 'loyer', restaurantId: du.restaurant_id } : { du, prevision })
            }}
            onModifier={du => {
              setDetail(null)
              router.push(du.categorie === 'autre' ? '/tresorerie-direction' : `/tresorerie-a-payer?onglet=${du.categorie}`)
            }}
            onPrevoir={du => { setDetail(null); setPrevoir(du) }}
            apres={recharger}
          />
          <FeuillePaiement demande={paiement} donnees={donnees} parDu={parDu} nomResto={nomResto} user={user}
            onFermer={() => setPaiement(null)} apres={recharger} />
          <FeuillePrevision du={prevoir} donnees={donnees} nomResto={nomResto} user={user}
            onFermer={() => setPrevoir(null)} apres={recharger} />
        </>
      )}
    </SafeAreaView>
  )
}
