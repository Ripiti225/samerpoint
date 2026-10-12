// ──────────────────────────────────────────────────────────────────────────────
// Trésorerie — historique d'un restaurant : tout ce qu'il a dû et payé, mois par
// mois (loyer, salaires, CNPS, timbre, ITS, TEE, bail, autres charges), et tout
// ce qui a circulé avec lui (fonds donnés, dépenses direction, espèces reprises,
// partenaires reçus, pubs, cotisations), avec le choix du mois ou de l'année.
// Un appui sur une charge ouvre son détail.
// Onglet « Partenaires » : les périodes Yango, Glovo, Wave, OM, Djamo entièrement
// reçues (elles quittent l'écran Partenaires) ; un appui rouvre leur détail.
// Ouvert depuis la carte loyer d'un restaurant (À payer), depuis l'accueil, ou
// depuis l'écran Partenaires (?onglet=partenaires&partenaire=).
// Logique : lib/historique.js (historiqueRestaurant, mouvementsRestaurant),
// lib/partenaires.js (historiquePartenaires)
// ──────────────────────────────────────────────────────────────────────────────
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { SafeAreaView, ScrollView, Text, TouchableOpacity, View } from 'react-native'

import {
  Entete, EtatEcran, Hero, HeroCase, ItemIcone, Puces, STYLE_PARTENAIRE, TitreSection, styleCategorie, styleDepense,
  useStylesTreso, useTresorerie,
} from '../components/tresorerie/commun'
import { Badge, FeuilleDetail, FeuillePaiement, FeuillePrevision, couleursStatut, titreDu } from '../components/tresorerie/du'
import { ChoixPeriode, libellePeriode, periodeParDefaut } from '../components/tresorerie/historique'
import { categorieDirection } from '../lib/direction'
import { historiqueRestaurant, mouvementsRestaurant } from '../lib/historique'
import {
  INFOS_PARTENAIRE, PARTENAIRES, historiquePartenaires, libellePeriode as libellePeriodePartenaire, vuesPartenaires,
} from '../lib/partenaires'
import {
  CATEGORIES_TRESORERIE, LIBELLES_CATEGORIE, aujourdhuiISO, categoriesVisibles, classerTous, fmt, formatDateFR,
  libelleMois, paiementsParDu, peut,
} from '../lib/tresorerie'
import { useFocusRecherche } from '../lib/useFocusRecherche'

export default function TresorerieRestaurantScreen() {
  const { styles, colors } = useStylesTreso()
  const params = useLocalSearchParams()
  const t = useTresorerie({ avecDirection: true, avecPartenairesParResto: true, avecPartenaires: true })
  const { donnees, niveau, user, recharger } = t
  const [onglet, setOnglet] = useState(params.onglet === 'partenaires' ? 'partenaires' : 'restaurant')
  const [restaurantId, setRestaurantId] = useState(params.id || null)
  // Recherche globale : mois du mouvement cherché, et ligne encadrée.
  const [periode, setPeriode] = useState(() => (Number(params.an) > 0
    ? { an: Number(params.an), mois: Number(params.mois) || null }
    : periodeParDefaut()))
  const focus = useFocusRecherche(params.focus)
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
    ...CATEGORIES_TRESORERIE.filter(c => categoriesVisibles(niveau).includes(c)),
    ...(peut(niveau, 'voir_direction') ? ['autre'] : []),
  ], [niveau])
  const parDu = useMemo(() => paiementsParDu(donnees?.paiements), [donnees])
  const classement = useMemo(() => (donnees ? classerTous(donnees.dus, donnees.paiements, aujourdhui) : {}), [donnees, aujourdhui])
  const mois = useMemo(
    () => (donnees && restaurantId ? historiqueRestaurant(donnees.dus, donnees.paiements, restaurantId, { periode, categories }) : []),
    [donnees, restaurantId, periode, categories],
  )
  // Mouvements : chacun ne voit que ce que ses droits lui montrent déjà ailleurs.
  const sources = useMemo(() => ({
    depenses: peut(niveau, 'voir_direction') ? donnees?.direction?.depenses : [],
    mouvements: peut(niveau, 'voir_banque') ? donnees?.mouvements : [],
    partenaires: donnees?.partenairesParResto,
    cotisations: donnees?.cotisations,
  }), [donnees, niveau])
  const mouvements = useMemo(
    () => (restaurantId ? mouvementsRestaurant(sources, restaurantId, { periode }) : []),
    [sources, restaurantId, periode],
  )
  // Mois des charges et des mouvements réunis, le plus récent d'abord.
  const moisAffiches = useMemo(() => {
    const parMois = {}
    for (const m of mois) (parMois[m.mois] ||= {}).charges = m
    for (const m of mouvements) (parMois[m.mois] ||= {}).mouvements = m
    return Object.entries(parMois).sort((a, b) => b[0].localeCompare(a[0]))
  }, [mois, mouvements])
  const dates = useMemo(() => [
    ...(donnees?.dus || []).filter(d => d.restaurant_id === restaurantId).map(d => d.mois || d.created_at),
    ...(restaurantId ? mouvementsRestaurant(sources, restaurantId) : []).map(m => m.mois),
  ], [donnees, sources, restaurantId])
  const total = mois.reduce((s, m) => ({ du: s.du + m.du, paye: s.paye + m.paye, reste: s.reste + m.reste }), { du: 0, paye: 0, reste: 0 })
  const totalMvts = mouvements.reduce((s, m) => ({ sorties: s.sorties + m.sorties, entrees: s.entrees + m.entrees }), { sorties: 0, entrees: 0 })

  const nomResto = id => donnees?.restaurants.find(r => r.id === id)?.nom || 'Groupe'
  const nomCompte = id => donnees?.comptes.find(c => c.id === id)?.nom || '?'
  const cs = couleursStatut(colors)
  const autorise = peut(niveau, 'voir_a_payer')
  const bloque = (t.loading && !donnees) || t.erreur || !autorise
  const onglets = ONGLETS.filter(o => o.cle !== 'partenaires' || peut(niveau, 'voir_partenaires'))
  const ongletActif = onglets.some(o => o.cle === onglet) ? onglet : 'restaurant'

  return (
    <SafeAreaView style={styles.container}>
      <Entete titre="Historique" sous={ongletActif === 'partenaires' ? 'Partenaires reçus' : restaurantId ? nomResto(restaurantId) : null}
        repli="/tresorerie-a-payer" />
      {bloque ? <EtatEcran {...t} autorise={autorise} /> : (
        <>
          {onglets.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.ongletsBarre} contentContainerStyle={styles.onglets}>
              {onglets.map(o => {
                const actif = ongletActif === o.cle
                return (
                  <TouchableOpacity key={o.cle} style={[styles.onglet, actif && styles.ongletActif]} onPress={() => setOnglet(o.cle)}>
                    <MaterialCommunityIcons name={o.icone} size={16} color={actif ? '#FFFFFF' : o.couleur} />
                    <Text style={[styles.ongletTxt, actif && styles.ongletTxtActif]}>{o.label}</Text>
                  </TouchableOpacity>
                )
              })}
            </ScrollView>
          )}
          {ongletActif === 'partenaires' ? (
            <OngletPartenaires donnees={donnees} nomCompte={nomCompte} partenaireInitial={params.partenaire} />
          ) : (
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
                {mouvements.length > 0 && (
                  <View style={styles.heroCases}>
                    <HeroCase label="Donné / dépensé" valeur={fmt(totalMvts.sorties)} couleur="#FDE68A" />
                    <HeroCase label="Reçu" valeur={fmt(totalMvts.entrees)} couleur="#A7F3D0" />
                  </View>
                )}
              </Hero>

              {moisAffiches.length === 0 && <Text style={styles.vide}>Rien sur cette période.</Text>}
              {moisAffiches.map(([cle, { charges: m, mouvements: mv }]) => (
                <View key={cle}>
                  <TitreSection icone="calendar-month-outline" titre={libelleMois(cle)}
                    droite={m ? <View style={[styles.etatPilule, { backgroundColor: m.reste ? colors.errorLight : colors.successLight }]}>
                      <Text style={[styles.etatPiluleTxt, { color: m.reste ? colors.errorDark : colors.successDark }]}>
                        {m.reste ? `reste ${fmt(m.reste)}` : 'tout payé'}
                      </Text>
                    </View> : null} />
                  {m?.lignes.map(({ du, paye, reste }) => {
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
                  {mv && (
                    <Text style={[styles.label, { marginTop: m ? 8 : 0 }]}>
                      Mouvements{mv.sorties ? ` · donné ${fmt(mv.sorties)}` : ''}{mv.entrees ? ` · reçu ${fmt(mv.entrees)}` : ''}
                    </Text>
                  )}
                  {mv?.lignes.map(l => {
                    const d = decrireMouvement(l, { donnees, nomCompte })
                    return (
                      <ItemIcone key={l.id} focus={focus} focusId={l.id} icone={d.icone} couleur={d.couleur} titre={d.titre} sous={d.sous}
                        droite={`${fmt(l.montant)} F`}
                        couleurDroite={l.sens === 'entree' ? colors.successDark : l.sens === 'retenue' ? colors.error : colors.warningDark}
                        sousDroite={<Text style={styles.petit}>{d.sens}</Text>} />
                    )
                  })}
                </View>
              ))}
              <Text style={styles.petit}>
                Chaque charge est rangée au mois qu'elle concerne (le loyer de septembre en septembre, même payé en octobre).
                Un appui sur une charge montre ses versements. Les mouvements (fonds, dépenses, espèces, partenaires,
                pubs, cotisations) sont rangés au mois de leur date.
              </Text>
            </ScrollView>
          )}
        </>
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

const ONGLETS = [
  { cle: 'restaurant', label: 'Restaurants', icone: 'storefront-outline', couleur: '#0891B2' },
  { cle: 'partenaires', label: 'Partenaires', icone: 'moped', couleur: '#E11D48' },
]

// ── Onglet Partenaires : périodes entièrement reçues ────────────────────────

function OngletPartenaires({ donnees, nomCompte, partenaireInitial }) {
  const { styles, colors } = useStylesTreso()
  const [partenaire, setPartenaire] = useState(PARTENAIRES.includes(partenaireInitial) ? partenaireInitial : null)
  const [periode, setPeriode] = useState(periodeParDefaut)
  const aujourdhui = aujourdhuiISO()
  const p = donnees.partenaires

  const vues = useMemo(() => (p ? vuesPartenaires(p, aujourdhui) : {}), [p, aujourdhui])
  const toutes = useMemo(() => (p ? historiquePartenaires(vues, p.lignes, { partenaire }) : []), [vues, p, partenaire])
  const lignes = useMemo(() => (p ? historiquePartenaires(vues, p.lignes, { partenaire, periode }) : []), [vues, p, partenaire, periode])
  // Rangées au mois du début de la période, la plus récente d'abord.
  const parMois = useMemo(() => {
    const out = {}
    for (const l of lignes) (out[l.situation.periode.debut.slice(0, 7)] ||= []).push(l)
    return Object.entries(out)
  }, [lignes])

  if (p === null) {
    return (
      <View style={styles.centre}>
        <Text style={styles.erreur}>
          Les partenaires ne sont pas encore installés dans la base : il faut passer le fichier
          supabase_tresorerie_partenaires.sql dans Supabase.
        </Text>
      </View>
    )
  }

  const total = lignes.reduce((s, l) => s + l.recu, 0)
  const totalDe = part => lignes.filter(l => l.partenaire === part).reduce((s, l) => s + l.recu, 0)

  return (
    <ScrollView style={styles.body} contentContainerStyle={styles.bodyContenu}>
      <Text style={styles.label}>Partenaire</Text>
      <Puces options={[{ valeur: null, label: 'Tous' }, ...PARTENAIRES.map(x => ({ valeur: x, label: INFOS_PARTENAIRE[x].nom }))]}
        valeur={partenaire} onChange={setPartenaire} />
      <Text style={styles.label}>Période</Text>
      <ChoixPeriode dates={toutes.map(l => l.situation.periode.debut)} valeur={periode} onChange={setPeriode} />

      <Hero icone="moped" titre={`${partenaire ? INFOS_PARTENAIRE[partenaire].nom : 'Partenaires'} · ${libellePeriode(periode)}`}
        valeur={`${fmt(total)} F`} sous={`${lignes.length} période${lignes.length > 1 ? 's' : ''} entièrement reçue${lignes.length > 1 ? 's' : ''}`}>
        {!partenaire && (
          <View style={styles.heroCases}>
            {PARTENAIRES.map(x => (
              <HeroCase key={x} label={INFOS_PARTENAIRE[x].nom} valeur={fmt(totalDe(x))} couleur={STYLE_PARTENAIRE[x]?.couleur} />
            ))}
          </View>
        )}
      </Hero>

      {parMois.length === 0 && <Text style={styles.vide}>Aucune période entièrement reçue sur cette période.</Text>}
      {parMois.map(([mois, ls]) => (
        <View key={mois}>
          <TitreSection icone="calendar-month-outline" titre={libelleMois(`${mois}-01`)} droite={`${fmt(ls.reduce((s, l) => s + l.recu, 0))} F`} />
          {ls.map(l => {
            const sp = STYLE_PARTENAIRE[l.partenaire] || styleCategorie('autre')
            const comptes = l.comptes.map(nomCompte).join(', ')
            return (
              <ItemIcone key={`${l.partenaire}-${l.situation.periode.debut}`} icone={sp.icone} couleur={sp.couleur}
                onPress={() => router.push(`/tresorerie-partenaires?partenaire=${l.partenaire}&periode=${l.situation.periode.debut}`)}
                titre={`${INFOS_PARTENAIRE[l.partenaire].nom} · ${libellePeriodePartenaire(l.situation.periode)}`}
                sous={`${l.recuLe ? `reçu le ${formatDateFR(l.recuLe)}` : 'reçu'}${comptes ? ` · ${comptes}` : ''} · attendu ${fmt(l.situation.attendu)}`}
                droite={`${fmt(l.recu)} F`} couleurDroite={colors.successDark}
                sousDroite={l.ecart
                  ? <Text style={[styles.petit, { color: l.ecart > 0 ? colors.successDark : colors.error }]}>
                    écart {l.ecart > 0 ? '+' : '−'} {fmt(Math.abs(l.ecart))}
                  </Text>
                  : <Text style={styles.petit}>sans écart</Text>} />
            )
          })}
        </View>
      ))}
      <Text style={styles.petit}>
        Une période passe ici quand tout ce qu'elle devait est reçu. Elle est rangée au mois où elle commence.
        Un appui rouvre son détail (réceptions, export, pub) ; une réception annulée la renvoie dans « Partenaires à recevoir ».
      </Text>
    </ScrollView>
  )
}

// Icône, titre et détail d'un mouvement (lib/historique.js · mouvementsRestaurant).
function decrireMouvement(l, { donnees, nomCompte }) {
  const x = l.ligne
  const note = x.note ? ` · ${x.note}` : ''
  if (l.type === 'especes') {
    return { icone: 'cash-plus', couleur: '#0E9F6E', titre: 'Espèces reprises du restaurant', sens: 'reçu',
      sous: `${formatDateFR(l.date)} · ${nomCompte(x.compte_id)}${x.point_id ? ' · déduit du FC reçu d\'un point' : ''}` }
  }
  if (l.type === 'partenaire' || l.type === 'pub') {
    const sp = STYLE_PARTENAIRE[x.partenaire] || styleCategorie('autre')
    const nom = INFOS_PARTENAIRE[x.partenaire]?.nom || x.partenaire
    return l.type === 'pub'
      ? { icone: sp.icone, couleur: sp.couleur, titre: `Pub ${nom}`, sens: 'retenu',
        sous: `retenue par ${nom} · période du ${formatDateFR(x.periode_debut)}${note}` }
      : { icone: sp.icone, couleur: sp.couleur, titre: `${nom} reçu`, sens: 'reçu',
        sous: `${formatDateFR(l.date)} · ${nomCompte(x.compte_id)} · période du ${formatDateFR(x.periode_debut)}${note}` }
  }
  if (l.type === 'cotisation') {
    const du = (donnees?.dus || []).find(d => d.id === x.du_id)
    return { icone: 'piggy-bank-outline', couleur: '#0D9488', sens: 'reçu',
      titre: `Cotisation remise${du ? ` · ${LIBELLES_CATEGORIE[du.categorie] || du.categorie}` : ''}`,
      sous: `${formatDateFR(l.date)}${du?.mois ? ` · ${libelleMois(du.mois)}` : ''}${note}` }
  }
  // Dépense direction (fond, fond en nature, réparation, matériel…).
  const sd = styleDepense(l.type)
  const source = x.source === 'compte' ? nomCompte(x.compte_id) : x.source === 'coffre' ? 'coffre' : 'espèces'
  const retire = l.type === 'fond' && l.montant < 0
  const titre = (x.origine_id ? 'Correction · ' : '')
    + (retire ? 'Fond retiré (était en nature)' : l.type === 'fond' ? 'Fond donné' : l.type === 'fond_nature' ? 'Fond en nature donné'
      : categorieDirection(l.type)?.label || 'Dépense direction')
  const etat = retire
    ? (x.point_id ? ' · retiré du FC reçu d\'un point validé' : ' · sera retiré du FC reçu du prochain point')
    : l.type === 'fond' ? (x.point_id ? ' · compté dans le FC reçu d\'un point validé' : ' · ira dans le FC reçu du prochain point') : ''
  return { icone: sd.icone, couleur: sd.couleur, titre, sens: l.type.startsWith('fond') ? 'donné' : 'dépensé',
    sous: `${formatDateFR(l.date)} · ${source}${note}${etat}` }
}
