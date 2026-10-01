// ──────────────────────────────────────────────────────────────────────────────
// Trésorerie — À payer : loyers, salaires, CNPS, charges admin, dettes.
//
// Chaque ligne est un « dû » payable en plusieurs fois : « dû · payé · reste ».
// Loyers : un par restaurant et par mois, créés tout seuls depuis le réglage du
// loyer. Au paiement, le mois retenu par le propriétaire se choisit TOUJOURS à
// la main (rien n'est présélectionné) : un versement du 02/09 peut couvrir août.
// Spéc : docs/superpowers/specs/2026-10-01-tresorerie-socle-design.md
// ──────────────────────────────────────────────────────────────────────────────
import { useLocalSearchParams } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { Alert, Image, SafeAreaView, ScrollView, Switch, Text, TouchableOpacity, View } from 'react-native'

import {
  Bouton, Champ, ChampMontant, Entete, EtatEcran, Feuille, Ligne, Puces, useStylesTreso, useTresorerie,
} from '../components/tresorerie/commun'
import { usePhoto } from '../lib/usePhoto'
import {
  CATEGORIES_MENSUELLES, LIBELLES_ADMIN, LIBELLES_CATEGORIE, aujourdhuiISO, categoriesVisibles,
  echeanceCnpsParDefaut, echeanceDansMois, fmt, formatDateFR, joursDeRetard, libelleMois, libelleMoisCourt,
  moisEntre, paiementsParDu, peut, premierDuMois, repartirPaiement, resteDu, statutLoyer, totalPaye,
} from '../lib/tresorerie'
import {
  annulerPaiement, chargerDusLoyer, enregistrerDu, enregistrerLoyer, payer, supprimerDu,
} from '../lib/tresorerieDb'

const MOIS_LOYERS_VISIBLES = 3

export default function TresorerieAPayerScreen() {
  const { styles, colors } = useStylesTreso()
  const params = useLocalSearchParams()
  const t = useTresorerie({ creerLoyers: true })
  const { donnees, niveau, user, recharger } = t

  const onglets = categoriesVisibles(niveau)
  const [onglet, setOnglet] = useState(params.onglet || null)
  const [restantsSeulement, setRestantsSeulement] = useState(true)
  const [detail, setDetail] = useState(null)       // dû ouvert
  const [edition, setEdition] = useState(null)     // dû en création / modification
  const [paiement, setPaiement] = useState(null)   // { du } ou { restaurantId } (loyer)
  const [reglageLoyers, setReglageLoyers] = useState(false)

  useEffect(() => {
    if (onglets.length && !onglets.includes(onglet)) setOnglet(onglets[0])
  }, [onglets.join(','), onglet])

  const aujourdhui = aujourdhuiISO()
  const moisCourant = premierDuMois(aujourdhui)
  const parDu = useMemo(() => paiementsParDu(donnees?.paiements), [donnees])
  const nomResto = id => donnees?.restaurants.find(r => r.id === id)?.nom || 'Groupe'

  const dusOnglet = useMemo(() => {
    if (!donnees || !onglet) return []
    return donnees.dus.filter(d => d.categorie === onglet)
  }, [donnees, onglet])

  const resteOnglet = dusOnglet
    .filter(d => !d.mois || d.mois <= moisCourant)
    .reduce((s, d) => s + resteDu(d, parDu[d.id]), 0)

  const bloque = (t.loading && !donnees) || t.erreur || !onglets.length

  return (
    <SafeAreaView style={styles.container}>
      <Entete titre="À payer" sous={onglet ? `${LIBELLES_CATEGORIE[onglet]} · reste ${fmt(resteOnglet)} F` : null} />
      {bloque ? <EtatEcran {...t} autorise={onglets.length > 0} /> : (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={styles.onglets}>
            {onglets.map(c => (
              <TouchableOpacity key={c} style={[styles.onglet, onglet === c && styles.ongletActif]} onPress={() => setOnglet(c)}>
                <Text style={[styles.ongletTxt, onglet === c && styles.ongletTxtActif]}>{LIBELLES_CATEGORIE[c]}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContenu}>
            {onglet === 'loyer' ? (
              <ListeLoyers
                dus={dusOnglet} parDu={parDu} aujourdhui={aujourdhui} nomResto={nomResto}
                peutPayer={peut(niveau, 'payer')}
                onPayer={restaurantId => setPaiement({ categorie: 'loyer', restaurantId })}
                onOuvrir={setDetail}
              />
            ) : (
              <ListeDus
                categorie={onglet} dus={dusOnglet} parDu={parDu} aujourdhui={aujourdhui} moisCourant={moisCourant}
                nomResto={nomResto} restantsSeulement={restantsSeulement} onOuvrir={setDetail}
              />
            )}

            {onglet !== 'loyer' && (
              <View style={[styles.ligne, { marginTop: 4 }]}>
                <Text style={styles.ligneLabel}>Restants seulement</Text>
                <Switch value={restantsSeulement} onValueChange={setRestantsSeulement}
                  trackColor={{ false: colors.border, true: colors.primary }} thumbColor="#fff" />
              </View>
            )}

            <View style={{ gap: 8, marginTop: 10 }}>
              {onglet === 'loyer' && peut(niveau, 'saisir_dus') && (
                <Bouton secondaire titre="Régler les loyers des restaurants" onPress={() => setReglageLoyers(true)} />
              )}
              {onglet !== 'loyer' && peutSaisirCategorie(niveau, onglet) && (
                <Bouton titre={TITRES_AJOUT[onglet]} onPress={() => setEdition({ categorie: onglet })} />
              )}
            </View>
          </ScrollView>
        </>
      )}

      {donnees && (
        <>
          <FeuilleDetail
            du={detail} paiements={detail ? parDu[detail.id] || [] : []} donnees={donnees} niveau={niveau}
            aujourdhui={aujourdhui} nomResto={nomResto} user={user}
            onFermer={() => setDetail(null)}
            onPayer={du => { setDetail(null); setPaiement(du.categorie === 'loyer' ? { categorie: 'loyer', restaurantId: du.restaurant_id } : { du }) }}
            onModifier={du => { setDetail(null); setEdition(du) }}
            apres={recharger}
          />
          <FeuilleEdition du={edition} donnees={donnees} user={user} onFermer={() => setEdition(null)} apres={recharger} />
          <FeuillePaiement demande={paiement} donnees={donnees} parDu={parDu} nomResto={nomResto} user={user}
            onFermer={() => setPaiement(null)} apres={recharger} />
          <FeuilleReglageLoyers visible={reglageLoyers} donnees={donnees} user={user}
            onFermer={() => setReglageLoyers(false)} apres={recharger} />
        </>
      )}
    </SafeAreaView>
  )
}

const TITRES_AJOUT = {
  salaire: '+ État de salaires',
  cnps: '+ Déclaration CNPS',
  admin: '+ Charge admin (ODP, mairie, impôts…)',
  dette: '+ Dette',
}

function peutSaisirCategorie(niveau, categorie) {
  if (categorie === 'salaire' || categorie === 'cnps') return peut(niveau, 'saisir_salaires')
  return peut(niveau, 'saisir_dus')
}

// ── Listes ───────────────────────────────────────────────────────────────────

function couleursStatut(colors) {
  return {
    paye: { trait: colors.success, fond: colors.successLight, texte: colors.successDark, label: 'payé' },
    a_payer: { trait: colors.warning, fond: colors.warningLight, texte: colors.warningDark, label: 'à payer' },
    en_retard: { trait: colors.error, fond: colors.errorLight, texte: colors.errorDark, label: 'en retard' },
  }
}

function Badge({ c }) {
  const { styles } = useStylesTreso()
  return (
    <View style={[styles.badge, { backgroundColor: c.fond }]}>
      <Text style={[styles.badgeTxt, { color: c.texte }]}>{c.label}</Text>
    </View>
  )
}

function ListeLoyers({ dus, parDu, aujourdhui, nomResto, peutPayer, onPayer, onOuvrir }) {
  const { styles, colors } = useStylesTreso()
  const cs = couleursStatut(colors)
  const moisCourant = premierDuMois(aujourdhui)

  // Les 3 derniers mois en entier (pour voir le vert), plus les impayés plus anciens.
  const mois = [...new Set(dus.map(d => d.mois))].sort().reverse()
  const recents = new Set(mois.filter(m => m <= moisCourant).slice(0, MOIS_LOYERS_VISIBLES))
  const visibles = mois.filter(m => recents.has(m) || dus.some(d => d.mois === m && resteDu(d, parDu[d.id]) > 0))

  if (!dus.length) {
    return <Text style={styles.vide}>Aucun loyer réglé. Utilisez « Régler les loyers des restaurants ».</Text>
  }

  return (
    <>
      <View style={[styles.rangee, { flexWrap: 'wrap', marginBottom: 10 }]}>
        {Object.values(cs).map(c => (
          <View key={c.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: c.trait }} />
            <Text style={styles.petit}>{c.label}</Text>
          </View>
        ))}
      </View>
      {visibles.map(m => (
        <View key={m} style={{ marginBottom: 6 }}>
          <Text style={[styles.lbl, { marginVertical: 6 }]}>{libelleMois(m)}</Text>
          {dus.filter(d => d.mois === m)
            .sort((a, b) => nomResto(a.restaurant_id).localeCompare(nomResto(b.restaurant_id)))
            .map(d => {
              const p = parDu[d.id] || []
              const st = statutLoyer(d, p, aujourdhui)
              const c = cs[st]
              const reste = resteDu(d, p)
              const retard = st === 'en_retard' ? joursDeRetard(d.echeance, aujourdhui) : 0
              const dernier = p[p.length - 1]
              return (
                <TouchableOpacity key={d.id} onPress={() => onOuvrir(d)}
                  style={[styles.carte, { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 11, marginBottom: 6, borderLeftWidth: 5, borderLeftColor: c.trait }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemTitre}>{nomResto(d.restaurant_id)} · {fmt(d.montant_du)}</Text>
                    <Text style={styles.petit}>
                      {st === 'paye'
                        ? `payé le ${formatDateFR(dernier?.date)}`
                        : `${totalPaye(p) > 0 ? `payé ${fmt(totalPaye(p))} · ` : ''}reste ${fmt(reste)} · échéance ${formatDateFR(d.echeance)}${retard ? ` · ${retard} j de retard` : ''}`}
                    </Text>
                  </View>
                  {st !== 'paye' && peutPayer
                    ? <Bouton titre="Payer" style={styles.btnPetit} onPress={() => onPayer(d.restaurant_id)} />
                    : <Badge c={c} />}
                </TouchableOpacity>
              )
            })}
        </View>
      ))}
      <Text style={styles.petit}>Un loyer est payé pour le mois que le propriétaire a retenu, pas pour le mois où l'argent est sorti.</Text>
    </>
  )
}

function ListeDus({ categorie, dus, parDu, aujourdhui, moisCourant, nomResto, restantsSeulement, onOuvrir }) {
  const { styles, colors } = useStylesTreso()
  const cs = couleursStatut(colors)

  const filtres = dus.filter(d => !restantsSeulement || resteDu(d, parDu[d.id]) > 0)
  if (!filtres.length) {
    return <Text style={styles.vide}>{restantsSeulement ? 'Rien à payer ici.' : 'Aucune ligne.'}</Text>
  }

  const mensuel = CATEGORIES_MENSUELLES.includes(categorie)
  const groupes = mensuel
    ? [...new Set(filtres.map(d => d.mois))].sort().reverse().map(m => ({ cle: m, titre: libelleMois(m), dus: filtres.filter(d => d.mois === m) }))
    : [{ cle: 'tous', titre: null, dus: filtres }]

  return groupes.map(g => {
    const resteGroupe = g.dus.reduce((s, d) => s + resteDu(d, parDu[d.id]), 0)
    return (
      <View key={g.cle} style={styles.carte}>
        {g.titre && (
          <View style={styles.ligne}>
            <Text style={styles.lbl}>{LIBELLES_CATEGORIE[categorie]} · {g.titre}{g.cle > moisCourant ? ' (à venir)' : ''}</Text>
            <Text style={[styles.ligneValeur, { color: resteGroupe ? colors.error : colors.success }]}>reste {fmt(resteGroupe)}</Text>
          </View>
        )}
        {g.dus
          .sort((a, b) => titreDu(a, nomResto).localeCompare(titreDu(b, nomResto)))
          .map(d => {
            const p = parDu[d.id] || []
            const reste = resteDu(d, p)
            const retard = reste > 0 ? joursDeRetard(d.echeance, aujourdhui) : 0
            const c = reste === 0 ? cs.paye : retard > 0 ? cs.en_retard : cs.a_payer
            const badge = categorie === 'cnps' && retard > 60 ? { ...cs.en_retard, label: '> 60 j' } : c
            return (
              <TouchableOpacity key={d.id} style={styles.item} onPress={() => onOuvrir(d)}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemTitre}>{titreDu(d, nomResto)}</Text>
                  <Text style={styles.petit}>
                    dû {fmt(d.montant_du)} · payé {fmt(totalPaye(p))} · <Text style={{ fontWeight: '800', color: colors.text }}>reste {fmt(reste)}</Text>
                    {retard ? ` · ${retard} j de retard` : d.echeance && reste ? ` · échéance ${formatDateFR(d.echeance)}` : ''}
                  </Text>
                </View>
                <Badge c={badge} />
              </TouchableOpacity>
            )
          })}
      </View>
    )
  })
}

function titreDu(d, nomResto) {
  if (d.categorie === 'dette') return d.creancier || 'Créancier'
  if (d.categorie === 'admin') return `${d.libelle || 'Charge admin'}${d.restaurant_id ? ` · ${nomResto(d.restaurant_id)}` : ''}`
  return nomResto(d.restaurant_id)
}

// ── Détail d'un dû ───────────────────────────────────────────────────────────

function FeuilleDetail({ du, paiements, donnees, niveau, aujourdhui, nomResto, user, onFermer, onPayer, onModifier, apres }) {
  const { styles, colors } = useStylesTreso()
  if (!du) return null
  const reste = resteDu(du, paiements)
  const nomCompte = id => donnees.comptes.find(c => c.id === id)?.nom || '?'
  const peutModifier = du.categorie === 'loyer' ? peut(niveau, 'saisir_dus') : peutSaisirCategorie(niveau, du.categorie)

  // Les lignes d'un même versement (plusieurs mois de loyer) s'annulent ensemble.
  function annuler(p) {
    const lignes = donnees.paiements.filter(x => x.groupe === p.groupe)
    const total = lignes.reduce((s, x) => s + Number(x.montant || 0), 0)
    Alert.alert(
      'Annuler ce paiement ?',
      `${fmt(total)} F du ${formatDateFR(p.date)}${lignes.length > 1 ? ` (versement réparti sur ${lignes.length} mois, tout sera annulé)` : ''}. La sortie de banque liée est retirée aussi.`,
      [
        { text: 'Garder', style: 'cancel' },
        {
          text: 'Annuler le paiement', style: 'destructive', onPress: async () => {
            try { await annulerPaiement(p.groupe, { du_id: du.id, montant: total }, user); await apres(); onFermer() }
            catch (e) { Alert.alert('Annulation impossible', e?.message || 'Réessayez.') }
          },
        },
      ],
    )
  }

  function supprimer() {
    Alert.alert(
      'Supprimer cette ligne ?',
      paiements.length ? 'Ses paiements et les sorties de banque liées seront supprimés aussi.' : 'Elle disparaîtra de la trésorerie.',
      [
        { text: 'Garder', style: 'cancel' },
        {
          text: 'Supprimer', style: 'destructive', onPress: async () => {
            try { await supprimerDu(du, user); await apres(); onFermer() }
            catch (e) { Alert.alert('Suppression impossible', e?.message || 'Réessayez.') }
          },
        },
      ],
    )
  }

  return (
    <Feuille visible onFermer={onFermer}
      titre={`${LIBELLES_CATEGORIE[du.categorie]} · ${titreDu(du, nomResto)}${du.mois ? ` · ${libelleMoisCourt(du.mois)}` : ''}`}>
      <View style={styles.carte}>
        <Ligne label="Dû" valeur={du.montant_du} />
        <Ligne label="Déjà payé" valeur={totalPaye(paiements)} />
        <View style={styles.sep} />
        <Ligne label="Reste" valeur={reste} fort couleur={reste ? colors.error : colors.success} />
        {!!du.echeance && <Text style={styles.petit}>Échéance : {formatDateFR(du.echeance)}{reste && joursDeRetard(du.echeance, aujourdhui) ? ` · ${joursDeRetard(du.echeance, aujourdhui)} j de retard` : ''}</Text>}
        {!!du.note && <Text style={[styles.petit, { marginTop: 6 }]}>{du.note}</Text>}
        {!!du.cree_par_nom && <Text style={styles.petit}>Saisi par {du.cree_par_nom}</Text>}
      </View>

      <Text style={[styles.lbl, { marginBottom: 6 }]}>Paiements</Text>
      <View style={styles.carte}>
        {paiements.length === 0 && <Text style={styles.vide}>Aucun paiement.</Text>}
        {paiements.map(p => (
          <View key={p.id} style={styles.item}>
            <View style={{ flex: 1 }}>
              <Text style={styles.itemTitre}>{fmt(p.montant)} F</Text>
              <Text style={styles.petit}>
                {formatDateFR(p.date)} · {p.source === 'compte' ? nomCompte(p.compte_id) : 'Espèces'}
                {p.photo_url ? ' · 📷' : ''}{p.cree_par_nom ? ` · ${p.cree_par_nom}` : ''}
              </Text>
            </View>
            {peut(niveau, 'payer') && (
              <TouchableOpacity onPress={() => annuler(p)}><Text style={{ color: colors.error, fontSize: 13 }}>Annuler</Text></TouchableOpacity>
            )}
          </View>
        ))}
      </View>

      <View style={{ gap: 8 }}>
        {reste > 0 && peut(niveau, 'payer') && <Bouton titre="Payer" onPress={() => onPayer(du)} />}
        {peutModifier && <Bouton secondaire titre="Modifier" onPress={() => onModifier(du)} />}
        {peutModifier && <Bouton danger titre="Supprimer" onPress={supprimer} />}
      </View>
    </Feuille>
  )
}

// ── Création / modification d'un dû ──────────────────────────────────────────

function FeuilleEdition({ du, donnees, user, onFermer, apres }) {
  const { styles } = useStylesTreso()
  const [form, setForm] = useState({})
  const [occupe, setOccupe] = useState(false)

  useEffect(() => {
    if (!du) return
    const typeAdmin = du.categorie === 'admin'
      ? (LIBELLES_ADMIN.includes(du.libelle) ? du.libelle : du.libelle ? 'Autre' : 'ODP')
      : null
    setForm({
      restaurant_id: du.restaurant_id || null,
      mois: du.mois || premierDuMois(aujourdhuiISO()),
      montant: du.montant_du != null ? String(du.montant_du) : '',
      echeance: du.echeance || '',
      creancier: du.creancier || '',
      typeAdmin,
      precision: typeAdmin === 'Autre' ? du.libelle || '' : '',
      note: du.note || '',
    })
  }, [du])

  if (!du) return null
  const cat = du.categorie
  const mensuel = CATEGORIES_MENSUELLES.includes(cat)
  const maj = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // Mois proposés : les 12 derniers et le suivant.
  const courant = premierDuMois(aujourdhuiISO())
  const debut = moisEntre('2000-01-01', courant).slice(-12)[0]
  const choixMois = moisEntre(debut, courant)
  const suivant = moisEntre(courant, '2999-12-01').slice(1, 2)
  const optionsMois = [...choixMois, ...suivant].reverse().map(m => ({ valeur: m, label: libelleMois(m) }))

  async function enregistrer() {
    const montant = form.montant === '' ? null : parseInt(form.montant, 10)
    if (montant === null || montant <= 0) { Alert.alert('Montant manquant', 'Saisissez le montant dû.'); return }
    if (mensuel && !form.restaurant_id) { Alert.alert('Restaurant manquant', 'Choisissez le restaurant.'); return }
    if (cat === 'dette' && !form.creancier.trim()) { Alert.alert('Créancier manquant', 'À qui doit-on cet argent ?'); return }
    if (cat === 'admin' && form.typeAdmin === 'Autre' && !form.precision.trim()) { Alert.alert('Précision manquante', 'Précisez la charge.'); return }
    if (form.echeance && !/^\d{4}-\d{2}-\d{2}$/.test(form.echeance)) {
      Alert.alert('Échéance invalide', 'Écrivez la date au format AAAA-MM-JJ, par exemple 2026-10-15.'); return
    }
    setOccupe(true)
    try {
      await enregistrerDu({
        id: du.id,
        categorie: cat,
        restaurant_id: form.restaurant_id,
        mois: mensuel ? form.mois : null,
        libelle: cat === 'admin' ? (form.typeAdmin === 'Autre' ? form.precision.trim() : form.typeAdmin) : null,
        creancier: cat === 'dette' ? form.creancier.trim() : null,
        montant_du: montant,
        echeance: form.echeance || (cat === 'cnps' ? echeanceCnpsParDefaut(form.mois) : null),
        note: form.note.trim(),
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

  return (
    <Feuille visible onFermer={onFermer} titre={titre}>
      {cat === 'dette' && (
        <Champ label="Créancier" value={form.creancier} onChangeText={v => maj('creancier', v)} placeholder="Ex : Zabad" />
      )}
      {cat === 'admin' && (
        <>
          <Text style={styles.label}>Type</Text>
          <Puces options={LIBELLES_ADMIN.map(l => ({ valeur: l, label: l }))} valeur={form.typeAdmin} onChange={v => maj('typeAdmin', v)} />
          {form.typeAdmin === 'Autre' && (
            <Champ label="Précision" value={form.precision} onChangeText={v => maj('precision', v)} placeholder="Ex : taxe enseigne" />
          )}
        </>
      )}
      {(mensuel || cat === 'admin') && cat !== 'loyer' && (
        <>
          <Text style={styles.label}>Restaurant{cat === 'admin' ? ' (facultatif)' : ''}</Text>
          <Puces
            options={cat === 'admin' ? [{ valeur: null, label: 'Groupe' }, ...restos] : restos}
            valeur={form.restaurant_id} onChange={v => maj('restaurant_id', v)}
          />
        </>
      )}
      {mensuel && cat !== 'loyer' && (
        <>
          <Text style={styles.label}>Mois</Text>
          <Puces options={optionsMois} valeur={form.mois} onChange={v => maj('mois', v)} />
        </>
      )}
      <ChampMontant label="Montant dû" valeur={form.montant} onChange={v => maj('montant', v)} />
      {cat !== 'dette' && (
        <Champ
          label={cat === 'cnps' ? 'Échéance (vide = le 15 du mois suivant)' : 'Échéance (facultatif, AAAA-MM-JJ)'}
          value={form.echeance} onChangeText={v => maj('echeance', v)} autoCapitalize="none"
          placeholder={cat === 'cnps' && form.mois ? echeanceCnpsParDefaut(form.mois) : 'AAAA-MM-JJ'}
        />
      )}
      <Champ label="Note (facultatif)" value={form.note} onChangeText={v => maj('note', v)} />
      <Bouton titre="Enregistrer" onPress={enregistrer} occupe={occupe} />
    </Feuille>
  )
}

// ── Paiement ─────────────────────────────────────────────────────────────────

function FeuillePaiement({ demande, donnees, parDu, nomResto, user, onFermer, apres }) {
  const { styles, colors } = useStylesTreso()
  const { choisirPhoto } = usePhoto()
  const [montant, setMontant] = useState('')
  const [moisChoisis, setMoisChoisis] = useState([])
  const [source, setSource] = useState(null)
  const [date, setDate] = useState(aujourdhuiISO())
  const [photo, setPhoto] = useState(null)
  const [occupe, setOccupe] = useState(false)
  const [photoEnCours, setPhotoEnCours] = useState(false)

  const estLoyer = demande?.categorie === 'loyer'
  const restaurantId = estLoyer ? demande.restaurantId : demande?.du?.restaurant_id
  const loyer = estLoyer ? donnees.loyers.find(l => l.restaurant_id === restaurantId) : null

  // Mois de loyer proposés : tous ceux qui ont un reste, plus les deux suivants
  // (paiement d'avance). Rien n'est coché d'office.
  const optionsMois = useMemo(() => {
    if (!estLoyer) return []
    const dus = donnees.dus.filter(d => d.categorie === 'loyer' && d.restaurant_id === restaurantId)
    const ouverts = dus.filter(d => resteDu(d, parDu[d.id]) > 0).map(d => d.mois)
    const courant = premierDuMois(aujourdhuiISO())
    const avance = moisEntre(courant, '2999-12-01').slice(1, 3).filter(m => !dus.some(d => d.mois === m))
    return [...new Set([...ouverts, ...avance])].sort()
  }, [estLoyer, donnees, restaurantId, parDu])

  useEffect(() => {
    if (!demande) return
    setMoisChoisis([])
    setSource(null)
    setDate(aujourdhuiISO())
    setPhoto(null)
    setMontant(demande.du ? String(resteDu(demande.du, parDu[demande.du.id])) : '')
  }, [demande])

  // Montant proposé pour un loyer = somme des restes des mois cochés.
  useEffect(() => {
    if (!estLoyer) return
    const total = moisChoisis.reduce((s, m) => {
      const d = donnees.dus.find(x => x.categorie === 'loyer' && x.restaurant_id === restaurantId && x.mois === m)
      return s + (d ? resteDu(d, parDu[d.id]) : Number(loyer?.montant || 0))
    }, 0)
    setMontant(total ? String(total) : '')
  }, [moisChoisis.join(',')])

  if (!demande) return null

  function basculerMois(m) {
    setMoisChoisis(l => (l.includes(m) ? l.filter(x => x !== m) : [...l, m]))
  }

  async function ajouterPhoto() {
    setPhotoEnCours(true)
    const url = await choisirPhoto('photos')
    if (url) setPhoto(url)
    setPhotoEnCours(false)
  }

  async function enregistrer() {
    const valeur = montant === '' ? 0 : parseInt(montant, 10)
    if (estLoyer && !moisChoisis.length) {
      Alert.alert('Mois manquant', 'Choisissez le mois retenu par le propriétaire.'); return
    }
    if (!valeur || valeur <= 0) { Alert.alert('Montant manquant', 'Saisissez le montant versé.'); return }
    if (!source) { Alert.alert('Source manquante', 'Choisissez d\'où part l\'argent : BACI, SIB ou espèces.'); return }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      Alert.alert('Date invalide', 'Écrivez la date au format AAAA-MM-JJ, par exemple 2026-10-01.'); return
    }
    setOccupe(true)
    try {
      let dusCibles
      if (estLoyer) {
        // Les mois payés d'avance n'existent pas encore : on les crée d'abord.
        for (const m of moisChoisis) {
          const existe = donnees.dus.some(d => d.categorie === 'loyer' && d.restaurant_id === restaurantId && d.mois === m)
          if (!existe) {
            await enregistrerDu({
              categorie: 'loyer', restaurant_id: restaurantId, mois: m,
              montant_du: Number(loyer?.montant || 0),
              echeance: echeanceDansMois(m, loyer?.jour_echeance || 5),
            }, user)
          }
        }
        dusCibles = await chargerDusLoyer(restaurantId, moisChoisis)
      } else {
        dusCibles = [demande.du]
      }
      const parts = repartirPaiement(valeur, dusCibles, donnees.paiements)
      const compte = source === 'especes' ? null : source
      const libelle = estLoyer
        ? `Loyer ${nomResto(restaurantId)} · ${[...moisChoisis].sort().map(libelleMoisCourt).join(', ')}`
        : `${LIBELLES_CATEGORIE[demande.du.categorie]} · ${titreDu(demande.du, nomResto)}${demande.du.mois ? ` · ${libelleMoisCourt(demande.du.mois)}` : ''}`
      await payer({ parts, source: compte ? 'compte' : 'especes', compteId: compte, date, libelle, photoUrl: photo }, user)
      await apres()
      onFermer()
    } catch (e) {
      Alert.alert('Paiement non enregistré', e?.message || 'Réessayez.')
    } finally {
      setOccupe(false)
    }
  }

  const sources = [
    ...donnees.comptes.map(c => ({ valeur: c.id, label: c.nom })),
    { valeur: 'especes', label: 'Espèces' },
  ]
  const titre = estLoyer
    ? `Payer le loyer ${nomResto(restaurantId)}`
    : `Payer · ${titreDu(demande.du, nomResto)}`

  return (
    <Feuille visible onFermer={onFermer} titre={titre}>
      {estLoyer && (
        <>
          {loyer && <Text style={[styles.petit, { marginBottom: 10 }]}>Loyer mensuel : {fmt(loyer.montant)} F</Text>}
          <Text style={styles.label}>Mois retenu par le propriétaire</Text>
          <View style={styles.puces}>
            {optionsMois.map(m => {
              const actif = moisChoisis.includes(m)
              return (
                <TouchableOpacity key={m} style={[styles.puce, actif && styles.puceActive]} onPress={() => basculerMois(m)}>
                  <Text style={[styles.puceTxt, actif && styles.puceTxtActive]}>{libelleMois(m)}</Text>
                </TouchableOpacity>
              )
            })}
          </View>
          {moisChoisis.length > 1 && (
            <View style={styles.avert}>
              <Text style={styles.avertTxt}>Le montant est réparti du mois le plus ancien au plus récent, chacun jusqu'à son reste.</Text>
            </View>
          )}
        </>
      )}
      <ChampMontant label="Montant versé" valeur={montant} onChange={setMontant} />
      <Text style={styles.label}>Payé depuis</Text>
      <Puces options={sources} valeur={source} onChange={setSource} />
      <Champ label="Date du versement (AAAA-MM-JJ)" value={date} onChangeText={setDate} autoCapitalize="none" />
      <Text style={styles.label}>Reçu (photo, facultatif)</Text>
      {photo ? <Image source={{ uri: photo }} style={{ width: '100%', height: 150, borderRadius: 10, marginBottom: 10 }} resizeMode="cover" /> : null}
      <Bouton secondaire titre={photo ? 'Changer la photo' : '📷 Ajouter une photo'} onPress={ajouterPhoto} occupe={photoEnCours} style={{ marginBottom: 14 }} />
      <Bouton titre="Enregistrer le paiement" onPress={enregistrer} occupe={occupe} />
      <Text style={[styles.petit, { marginTop: 10, color: colors.textMuted }]}>
        Payé depuis BACI ou SIB : la sortie apparaît dans la banque. En espèces : rien ne bouge en banque.
      </Text>
    </Feuille>
  )
}

// ── Réglage des loyers ───────────────────────────────────────────────────────

function FeuilleReglageLoyers({ visible, donnees, user, onFermer, apres }) {
  const { styles, colors } = useStylesTreso()
  const [restaurantId, setRestaurantId] = useState(null)
  const [montant, setMontant] = useState('')
  const [jour, setJour] = useState('5')
  const [moisDepart, setMoisDepart] = useState(premierDuMois(aujourdhuiISO()))
  const [actif, setActif] = useState(true)
  const [occupe, setOccupe] = useState(false)

  useEffect(() => {
    if (!restaurantId) return
    const l = donnees.loyers.find(x => x.restaurant_id === restaurantId)
    setMontant(l ? String(l.montant) : '')
    setJour(l ? String(l.jour_echeance) : '5')
    setMoisDepart(l ? l.mois_depart : premierDuMois(aujourdhuiISO()))
    setActif(l ? l.actif : true)
  }, [restaurantId])

  if (!visible) return null

  const courant = premierDuMois(aujourdhuiISO())
  const optionsDepart = moisEntre('2000-01-01', courant).slice(-12).reverse().map(m => ({ valeur: m, label: libelleMois(m) }))

  async function enregistrer() {
    const v = montant === '' ? 0 : parseInt(montant, 10)
    const j = parseInt(jour, 10)
    if (!restaurantId) { Alert.alert('Restaurant manquant', 'Choisissez le restaurant.'); return }
    if (!v) { Alert.alert('Montant manquant', 'Saisissez le loyer mensuel.'); return }
    if (!(j >= 1 && j <= 31)) { Alert.alert('Jour invalide', 'Le jour d\'échéance va de 1 à 31.'); return }
    setOccupe(true)
    try {
      await enregistrerLoyer({ restaurantId, montant: v, jourEcheance: j, moisDepart, actif }, user)
      await apres()
      setRestaurantId(null)
    } catch (e) {
      Alert.alert('Non enregistré', e?.message || 'Réessayez.')
    } finally {
      setOccupe(false)
    }
  }

  return (
    <Feuille visible onFermer={onFermer} titre="Loyers des restaurants">
      {donnees.restaurants.map(r => {
        const l = donnees.loyers.find(x => x.restaurant_id === r.id)
        return (
          <TouchableOpacity key={r.id} style={[styles.item, restaurantId === r.id && { backgroundColor: colors.primaryLight }]}
            onPress={() => setRestaurantId(r.id)}>
            <Text style={[styles.itemTitre, { flex: 1 }]}>{r.nom}</Text>
            <Text style={styles.petit}>
              {l ? `${fmt(l.montant)} F · le ${l.jour_echeance}${l.actif ? '' : ' · arrêté'}` : 'non réglé'}
            </Text>
          </TouchableOpacity>
        )
      })}

      {restaurantId && (
        <View style={[styles.carte, { marginTop: 12 }]}>
          <Text style={[styles.itemTitre, { marginBottom: 10 }]}>{donnees.restaurants.find(r => r.id === restaurantId)?.nom}</Text>
          <ChampMontant label="Loyer mensuel" valeur={montant} onChange={setMontant} />
          <Champ label="Jour d'échéance dans le mois (1 à 31)" value={jour} onChangeText={t => setJour(t.replace(/[^\d]/g, ''))} keyboardType="number-pad" />
          <Text style={styles.label}>Premier mois à suivre</Text>
          <Puces options={optionsDepart} valeur={moisDepart} onChange={setMoisDepart} />
          <View style={[styles.ligne, { marginBottom: 10 }]}>
            <Text style={styles.ligneLabel}>Loyer en cours</Text>
            <Switch value={actif} onValueChange={setActif} />
          </View>
          <Text style={[styles.petit, { marginBottom: 10 }]}>
            Un changement de montant vaut pour les mois à créer. Les mois déjà créés se corrigent un par un (Modifier).
          </Text>
          <Bouton titre="Enregistrer le loyer" onPress={enregistrer} occupe={occupe} />
        </View>
      )}
    </Feuille>
  )
}
