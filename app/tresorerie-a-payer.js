// ──────────────────────────────────────────────────────────────────────────────
// Trésorerie — À payer : loyers, salaires, CNPS, impôts, ITS, TEE, baux, puis
// la dette récente et les dettes.
//
// Tout se paie après coup : la charge du mois M est due au jour limite de M+1.
// Chaque ligne est un « dû » payable en plusieurs fois, classée à payer →
// dette récente (date limite passée) → dette (la suivante de la même série est
// en retard à son tour). Ce classement se calcule (lib/tresorerie.js, classerDu).
// Loyers : au paiement, le mois retenu par le propriétaire se choisit à la main.
// Spéc : docs/superpowers/specs/2026-10-02-nouvelle-tresorerie-design.md
// ──────────────────────────────────────────────────────────────────────────────
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { Alert, SafeAreaView, ScrollView, Switch, Text, TouchableOpacity, View } from 'react-native'

import {
  Bouton, Champ, ChampMontant, Entete, EtatEcran, Feuille, Puces, useStylesTreso, useTresorerie,
} from '../components/tresorerie/commun'
import { Badge, FeuilleDetail, FeuillePaiement, FeuillePrevision, couleursStatut, titreDu } from '../components/tresorerie/du'
import { HistoriqueDettesRemboursees, HistoriqueLoyersPayes } from '../components/tresorerie/historique'
import { FeuilleEcheance, FeuilleMontantsFixes, FeuilleReglageLoyers } from '../components/tresorerie/reglagesCharges'
import { FeuilleSaisieBaux, FeuilleSaisieMois } from '../components/tresorerie/saisieGroupee'
import {
  CATEGORIES_JOUR_COMMUN, CATEGORIES_MONTANT_FIXE, CATEGORIES_SERIE, LIBELLES_CATEGORIE, LIBELLES_ONGLET,
  aujourdhuiISO, categoriesVisibles, classerTous, echeancePostPayee, fmt, formatDateFR, jourCommun,
  joursDeRetard, libelleMois, libelleMoisCourt, moisEntre, paiementsParDu, peut, premierDuMois, resteDu,
  resumeLoyersParRestaurant, totalPaye,
} from '../lib/tresorerie'
import { enregistrerDu } from '../lib/tresorerieDb'

// Saisie groupée d'un mois : tous les restaurants sur un seul écran.
const TITRES_SAISIE = {
  salaire: 'Saisir l\'état de salaires d\'un mois',
  cnps: 'Saisir la CNPS d\'un mois',
  impot: 'Saisir ou corriger un mois',
  its: 'Saisir ou corriger un mois',
  tee: 'Saisir ou corriger un mois',
}

const EN_RETARD = ['dette_recente', 'dette']

export default function TresorerieAPayerScreen() {
  const { styles, colors } = useStylesTreso()
  const params = useLocalSearchParams()
  const t = useTresorerie({ creerLoyers: true })
  const { donnees, niveau, user, recharger } = t

  const onglets = categoriesVisibles(niveau)
  const [onglet, setOnglet] = useState(params.onglet || null)
  const [restantsSeulement, setRestantsSeulement] = useState(true)
  const [detail, setDetail] = useState(null)        // dû ouvert
  const [edition, setEdition] = useState(null)      // dû en création / modification
  const [paiement, setPaiement] = useState(null)    // { du, prevision? } ou { categorie: 'loyer', restaurantId }
  const [prevoir, setPrevoir] = useState(null)      // dû dont on prévoit le paiement
  const [reglage, setReglage] = useState(null)      // 'loyer' | 'echeance' | 'montants' | 'bail' | 'mois'

  useEffect(() => {
    if (onglets.length && !onglets.includes(onglet)) setOnglet(onglets[0])
  }, [onglets.join(','), onglet])

  const aujourdhui = aujourdhuiISO()
  const moisCourant = premierDuMois(aujourdhui)
  const parDu = useMemo(() => paiementsParDu(donnees?.paiements), [donnees])
  const classement = useMemo(
    () => (donnees ? classerTous(donnees.dus, donnees.paiements, aujourdhui) : {}),
    [donnees, aujourdhui],
  )
  const nomResto = id => donnees?.restaurants.find(r => r.id === id)?.nom || 'Groupe'

  const dusOnglet = useMemo(() => {
    if (!donnees || !onglet) return []
    if (EN_RETARD.includes(onglet)) return donnees.dus.filter(d => classement[d.id] === onglet)
    return donnees.dus.filter(d => d.categorie === onglet)
  }, [donnees, onglet, classement])

  // Reste de l'onglet : pour une charge en série, sans le mois en cours ni les
  // mois payés d'avance (ils ne sont pas encore dus).
  const resteOnglet = dusOnglet
    .filter(d => EN_RETARD.includes(onglet) || !d.mois || d.mois < moisCourant || classement[d.id] !== 'a_payer')
    .reduce((s, d) => s + resteDu(d, parDu[d.id]), 0)

  const bloque = (t.loading && !donnees) || t.erreur || !onglets.length

  return (
    <SafeAreaView style={styles.container}>
      <Entete titre="À payer" sous={onglet ? `${LIBELLES_ONGLET[onglet]} · reste ${fmt(resteOnglet)} F` : null} />
      {bloque ? <EtatEcran {...t} autorise={onglets.length > 0} /> : (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.ongletsBarre} contentContainerStyle={styles.onglets}>
            {onglets.map(c => (
              <TouchableOpacity key={c} style={[styles.onglet, onglet === c && styles.ongletActif]} onPress={() => setOnglet(c)}>
                <Text style={[styles.ongletTxt, onglet === c && styles.ongletTxtActif]}>{LIBELLES_ONGLET[c]}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContenu}>
            {onglet === 'loyer' && (
              <ListeLoyers
                dus={dusOnglet} loyers={donnees.loyers} paiements={donnees.paiements} parDu={parDu}
                classement={classement} aujourdhui={aujourdhui} nomResto={nomResto}
                peutPayer={peut(niveau, 'payer')} peutRegler={peut(niveau, 'saisir_charges')}
                onPayer={restaurantId => setPaiement({ categorie: 'loyer', restaurantId })}
                onOuvrir={setDetail}
              />
            )}
            {onglet === 'loyer' && <HistoriqueLoyersPayes donnees={donnees} nomResto={nomResto} onOuvrir={setDetail} />}
            {CATEGORIES_SERIE.includes(onglet) && onglet !== 'loyer' && (
              <ListeDus
                categorie={onglet} dus={dusOnglet} parDu={parDu} classement={classement} aujourdhui={aujourdhui}
                moisCourant={moisCourant} nomResto={nomResto} restantsSeulement={restantsSeulement} onOuvrir={setDetail}
              />
            )}
            {EN_RETARD.includes(onglet) && (
              <ListeDettes
                onglet={onglet} dus={dusOnglet} parDu={parDu} aujourdhui={aujourdhui} nomResto={nomResto} onOuvrir={setDetail}
              />
            )}
            {EN_RETARD.includes(onglet) && (
              <HistoriqueDettesRemboursees donnees={donnees} nomResto={nomResto}
                avecCreanciers={peut(niveau, 'voir_dettes')} onOuvrir={setDetail} />
            )}

            {CATEGORIES_SERIE.includes(onglet) && onglet !== 'loyer' && (
              <View style={[styles.ligne, { marginTop: 4 }]}>
                <Text style={styles.ligneLabel}>Restants seulement</Text>
                <Switch value={restantsSeulement} onValueChange={setRestantsSeulement}
                  trackColor={{ false: colors.border, true: colors.primary }} thumbColor="#fff" />
              </View>
            )}

            {CATEGORIES_JOUR_COMMUN.includes(onglet) && (
              <Text style={[styles.petit, { marginTop: 8 }]}>
                Date limite : le {jourCommun(donnees.echeances, onglet)} du mois suivant, pour tous les restaurants.
              </Text>
            )}

            <View style={{ gap: 8, marginTop: 10 }}>
              {onglet === 'loyer' && peut(niveau, 'saisir_charges') && (
                <Bouton secondaire titre="Régler les loyers des restaurants" onPress={() => setReglage('loyer')} />
              )}
              {CATEGORIES_MONTANT_FIXE.includes(onglet) && peut(niveau, 'saisir_charges') && (
                <Bouton secondaire titre="Régler les montants par restaurant" onPress={() => setReglage('montants')} />
              )}
              {onglet === 'bail' && peut(niveau, 'saisir_charges') && (
                <Bouton titre="Saisir les baux d'une année" onPress={() => setReglage('bail')} />
              )}
              {CATEGORIES_JOUR_COMMUN.includes(onglet) && peut(niveau, 'saisir_charges') && (
                <Bouton secondaire titre="Changer la date limite" onPress={() => setReglage('echeance')} />
              )}
              {TITRES_SAISIE[onglet] && peut(niveau, 'saisir_charges') && (
                <Bouton titre={TITRES_SAISIE[onglet]} onPress={() => setReglage('mois')} />
              )}
              {onglet === 'dette' && peut(niveau, 'saisir_dus') && (
                <Bouton titre="+ Dette" onPress={() => setEdition({ categorie: 'dette' })} />
              )}
            </View>
          </ScrollView>
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
            onModifier={du => { setDetail(null); setEdition(du) }}
            onPrevoir={du => { setDetail(null); setPrevoir(du) }}
            apres={recharger}
          />
          <FeuillePrevision du={prevoir} donnees={donnees} nomResto={nomResto} user={user}
            onFermer={() => setPrevoir(null)} apres={recharger} />
          <FeuilleEdition du={edition} donnees={donnees} user={user} onFermer={() => setEdition(null)} apres={recharger} />
          <FeuillePaiement demande={paiement} donnees={donnees} parDu={parDu} nomResto={nomResto} user={user}
            onFermer={() => setPaiement(null)} apres={recharger} />
          <FeuilleReglageLoyers visible={reglage === 'loyer'} donnees={donnees} user={user}
            onFermer={() => setReglage(null)} apres={recharger} />
          <FeuilleEcheance categorie={reglage === 'echeance' ? onglet : null} donnees={donnees} user={user}
            onFermer={() => setReglage(null)} apres={recharger} />
          <FeuilleMontantsFixes categorie={reglage === 'montants' ? onglet : null} donnees={donnees} user={user}
            onFermer={() => setReglage(null)} apres={recharger} />
          <FeuilleSaisieBaux visible={reglage === 'bail'} donnees={donnees} user={user}
            onFermer={() => setReglage(null)} apres={recharger} />
          <FeuilleSaisieMois categorie={reglage === 'mois' ? onglet : null} donnees={donnees} user={user}
            onFermer={() => setReglage(null)} apres={recharger} />
        </>
      )}
    </SafeAreaView>
  )
}

// Jours de retard + mention, pour une ligne en dette récente ou en dette.
function texteRetard(d, aujourdhui) {
  const j = joursDeRetard(d.echeance, aujourdhui)
  return j ? `${j} j de retard` : ''
}

// ── Loyers : une carte par restaurant ────────────────────────────────────────

// Ce que le restaurant doit (mois consommés terminés), puis chaque mois encore
// ouvert avec son reste et son état. Toucher un mois ouvre son détail.
function ListeLoyers({ dus, loyers, paiements, parDu, classement, aujourdhui, nomResto, peutPayer, peutRegler, onPayer, onOuvrir }) {
  const { styles, colors } = useStylesTreso()
  const cs = couleursStatut(colors)
  const moisCourant = premierDuMois(aujourdhui)
  const resume = resumeLoyersParRestaurant(dus, paiements, moisCourant)
  const ids = [...new Set([...loyers.map(l => l.restaurant_id), ...Object.keys(resume)])]
    .sort((a, b) => nomResto(a).localeCompare(nomResto(b)))

  if (!ids.length) {
    return (
      <Text style={styles.vide}>
        {peutRegler ? 'Aucun loyer réglé. Utilisez « Régler les loyers des restaurants ».' : 'Aucun loyer réglé pour l\'instant.'}
      </Text>
    )
  }

  return (
    <>
      {ids.map(id => {
        const l = loyers.find(x => x.restaurant_id === id)
        const r = resume[id] || { reste: 0, ouverts: [] }
        return (
          <View key={id} style={styles.carte}>
            <View style={styles.ligne}>
              <TouchableOpacity style={{ flex: 1 }} onPress={() => router.push(`/tresorerie-restaurant?id=${id}`)}>
                <Text style={styles.itemTitre}>{nomResto(id)}</Text>
                <Text style={[styles.petit, { color: colors.primary, fontWeight: '700' }]}>Historique du restaurant ›</Text>
              </TouchableOpacity>
              <Text style={[styles.ligneValeur, { color: r.reste ? colors.error : colors.success }]}>
                {r.reste ? `doit ${fmt(r.reste)} F` : 'à jour'}
              </Text>
            </View>
            {l && <Text style={[styles.petit, { marginBottom: 6 }]}>Loyer {fmt(l.montant)} F / mois · à payer avant le {l.jour_echeance} du mois suivant</Text>}
            {r.ouverts.map(d => {
              const p = parDu[d.id] || []
              const st = classement[d.id] || 'a_payer'
              const suffixe = d.mois > moisCourant ? ' (d\'avance)' : d.mois === moisCourant ? ' (en cours)' : ''
              return (
                <TouchableOpacity key={d.id} style={[styles.item, { borderLeftWidth: 4, borderLeftColor: cs[st].trait, paddingLeft: 8 }]}
                  onPress={() => onOuvrir(d)}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemTitre}>{libelleMois(d.mois)}{suffixe}</Text>
                    <Text style={styles.petit}>
                      {totalPaye(p) > 0 ? `payé ${fmt(totalPaye(p))} · ` : ''}
                      <Text style={{ fontWeight: '800', color: colors.text }}>reste {fmt(resteDu(d, p))}</Text>
                      {EN_RETARD.includes(st) ? ` · ${texteRetard(d, aujourdhui)}` : ` · avant le ${formatDateFR(d.echeance)}`}
                    </Text>
                  </View>
                  <Badge c={cs[st]} />
                </TouchableOpacity>
              )
            })}
            {peutPayer && (r.ouverts.length > 0 || l) && (
              <Bouton titre="Payer" style={{ marginTop: 8 }} onPress={() => onPayer(id)} />
            )}
          </View>
        )
      })}
      <Text style={styles.petit}>
        Le loyer d'un mois se paie le mois suivant. Il est payé pour le mois que le propriétaire a retenu, pas pour le mois où l'argent est sorti.
      </Text>
    </>
  )
}

// ── Salaires, CNPS, impôts, ITS, TEE, baux : regroupés par mois consommé ────

function ListeDus({ categorie, dus, parDu, classement, aujourdhui, moisCourant, nomResto, restantsSeulement, onOuvrir }) {
  const { styles, colors } = useStylesTreso()
  const cs = couleursStatut(colors)

  const filtres = dus.filter(d => !restantsSeulement || resteDu(d, parDu[d.id]) > 0)
  if (!filtres.length) {
    return <Text style={styles.vide}>{restantsSeulement ? 'Rien à payer ici.' : 'Aucune ligne.'}</Text>
  }

  const groupes = [...new Set(filtres.map(d => d.mois))].sort().reverse()
    .map(m => ({ cle: m, titre: libelleMois(m), dus: filtres.filter(d => d.mois === m) }))

  return groupes.map(g => {
    const resteGroupe = g.dus.reduce((s, d) => s + resteDu(d, parDu[d.id]), 0)
    const enCours = categorie !== 'bail' && g.cle >= moisCourant
    return (
      <View key={g.cle} style={styles.carte}>
        <View style={styles.ligne}>
          <Text style={styles.lbl}>{LIBELLES_CATEGORIE[categorie]} · {g.titre}{enCours ? ' (en cours)' : ''}</Text>
          <Text style={[styles.ligneValeur, { color: resteGroupe ? colors.error : colors.success }]}>reste {fmt(resteGroupe)}</Text>
        </View>
        {g.dus
          .sort((a, b) => titreDu(a, nomResto).localeCompare(titreDu(b, nomResto)))
          .map(d => {
            const p = parDu[d.id] || []
            const reste = resteDu(d, p)
            const st = classement[d.id] || 'a_payer'
            return (
              <TouchableOpacity key={d.id} style={styles.item} onPress={() => onOuvrir(d)}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemTitre}>{titreDu(d, nomResto)}</Text>
                  <Text style={styles.petit}>
                    dû {fmt(d.montant_du)} · payé {fmt(totalPaye(p))} · <Text style={{ fontWeight: '800', color: colors.text }}>reste {fmt(reste)}</Text>
                    {EN_RETARD.includes(st) ? ` · ${texteRetard(d, aujourdhui)}` : d.echeance && reste ? ` · avant le ${formatDateFR(d.echeance)}` : ''}
                  </Text>
                </View>
                <Badge c={cs[st]} />
              </TouchableOpacity>
            )
          })}
      </View>
    )
  })
}

// ── Dette récente / Dettes : toutes catégories confondues ────────────────────

function ListeDettes({ onglet, dus, parDu, aujourdhui, nomResto, onOuvrir }) {
  const { styles, colors } = useStylesTreso()
  const cs = couleursStatut(colors)
  if (!dus.length) {
    return <Text style={styles.vide}>{onglet === 'dette' ? 'Aucune dette.' : 'Aucune dette récente : tout est payé à temps.'}</Text>
  }
  // Les plus anciennes d'abord ; les créanciers (sans date limite) à la fin.
  const tries = [...dus].sort((a, b) => (a.echeance || '9999').localeCompare(b.echeance || '9999'))
  const total = tries.reduce((s, d) => s + resteDu(d, parDu[d.id]), 0)
  return (
    <View style={styles.carte}>
      <View style={styles.ligne}>
        <Text style={styles.lbl}>{LIBELLES_ONGLET[onglet]} · {tries.length} ligne{tries.length > 1 ? 's' : ''}</Text>
        <Text style={[styles.ligneValeur, { color: colors.error }]}>{fmt(total)} F</Text>
      </View>
      {tries.map(d => {
        const p = parDu[d.id] || []
        return (
          <TouchableOpacity key={d.id} style={styles.item} onPress={() => onOuvrir(d)}>
            <View style={{ flex: 1 }}>
              <Text style={styles.itemTitre}>
                {LIBELLES_CATEGORIE[d.categorie]} · {titreDu(d, nomResto)}{d.mois ? ` · ${libelleMoisCourt(d.mois)}` : ''}
              </Text>
              <Text style={styles.petit}>
                {totalPaye(p) > 0 ? `payé ${fmt(totalPaye(p))} · ` : ''}
                <Text style={{ fontWeight: '800', color: colors.text }}>reste {fmt(resteDu(d, p))}</Text>
                {d.echeance ? ` · ${texteRetard(d, aujourdhui)}` : ''}
                {d.en_dette_depuis ? ` · en dette depuis le ${formatDateFR(d.en_dette_depuis)}` : ''}
              </Text>
            </View>
            <Badge c={cs[onglet]} />
          </TouchableOpacity>
        )
      })}
    </View>
  )
}

// ── Création / modification d'une ligne ──────────────────────────────────────

// Charges en série : restaurant, mois consommé, montant ; la date limite se
// calcule (jour commun ou jour du loyer, dans le mois suivant). Dette : créancier.
function FeuilleEdition({ du, donnees, user, onFermer, apres }) {
  const { styles } = useStylesTreso()
  const [form, setForm] = useState({})
  const [occupe, setOccupe] = useState(false)

  useEffect(() => {
    if (!du) return
    // Post-payé : on saisit d'habitude le mois écoulé (l'état de septembre en octobre).
    const moisPrecedent = moisEntre('2000-01-01', premierDuMois(aujourdhuiISO())).slice(-2)[0]
    setForm({
      restaurant_id: du.restaurant_id || null,
      mois: du.mois || moisPrecedent,
      montant: du.montant_du != null ? String(du.montant_du) : '',
      creancier: du.creancier || '',
      note: du.note || '',
    })
  }, [du])

  if (!du) return null
  const cat = du.categorie
  const serie = CATEGORIES_SERIE.includes(cat)
  const maj = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // Mois proposés : les 12 derniers et le suivant.
  const courant = premierDuMois(aujourdhuiISO())
  const choixMois = moisEntre('2000-01-01', courant).slice(-12)
  const suivant = moisEntre(courant, '2999-12-01').slice(1, 2)
  const optionsMois = [...choixMois, ...suivant].reverse().map(m => ({ valeur: m, label: libelleMois(m) }))

  // Date limite d'une ligne en série. Bail : sa date reste celle de la ligne.
  function echeanceDe(mois, restaurantId) {
    if (cat === 'bail') return du.echeance || null
    if (cat === 'loyer') {
      const l = donnees.loyers.find(x => x.restaurant_id === restaurantId)
      return echeancePostPayee(mois, l?.jour_echeance || 5)
    }
    return echeancePostPayee(mois, jourCommun(donnees.echeances, cat))
  }

  async function enregistrer() {
    const montant = form.montant === '' ? null : parseInt(form.montant, 10)
    if (montant === null || montant <= 0) { Alert.alert('Montant manquant', 'Saisissez le montant dû.'); return }
    if (serie && !form.restaurant_id) { Alert.alert('Restaurant manquant', 'Choisissez le restaurant.'); return }
    if (cat === 'dette' && !(form.creancier || '').trim()) { Alert.alert('Créancier manquant', 'À qui doit-on cet argent ?'); return }
    setOccupe(true)
    try {
      await enregistrerDu({
        id: du.id,
        categorie: cat,
        restaurant_id: form.restaurant_id,
        mois: serie ? form.mois : null,
        libelle: du.libelle || null,
        creancier: cat === 'dette' ? (form.creancier || '').trim() : null,
        montant_du: montant,
        echeance: serie ? echeanceDe(form.mois, form.restaurant_id) : du.echeance || null,
        note: (form.note || '').trim(),
      }, user)
      await apres()
      onFermer()
    } catch (e) {
      Alert.alert('Non enregistré', e?.message || 'Réessayez.')
    } finally {
      setOccupe(false)
    }
  }

  const restos = donnees.restaurants.map(r => ({ valeur: r.id, label: r.nom }))
  const titre = `${du.id ? 'Modifier' : 'Ajouter'} · ${LIBELLES_CATEGORIE[cat]}`
  const echeance = serie && form.mois && form.restaurant_id ? echeanceDe(form.mois, form.restaurant_id) : null

  return (
    <Feuille visible onFermer={onFermer} titre={titre}>
      {cat === 'dette' && (
        <Champ label="Créancier" value={form.creancier ?? ''} onChangeText={v => maj('creancier', v)} placeholder="Ex : Zabad" />
      )}
      {serie && (
        <>
          <Text style={styles.label}>Restaurant</Text>
          <Puces options={restos} valeur={form.restaurant_id} onChange={v => maj('restaurant_id', v)} />
          {cat !== 'bail' && (
            <>
              <Text style={styles.label}>Mois concerné</Text>
              <Puces options={optionsMois} valeur={form.mois} onChange={v => maj('mois', v)} />
            </>
          )}
        </>
      )}
      <ChampMontant label="Montant dû" valeur={form.montant ?? ''} onChange={v => maj('montant', v)} />
      {echeance && <Text style={[styles.petit, { marginBottom: 10 }]}>À payer avant le {formatDateFR(echeance)}.</Text>}
      <Champ label="Note (facultatif)" value={form.note ?? ''} onChangeText={v => maj('note', v)} />
      <Bouton titre="Enregistrer" onPress={enregistrer} occupe={occupe} />
    </Feuille>
  )
}
