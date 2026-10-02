// ──────────────────────────────────────────────────────────────────────────────
// Trésorerie — accueil.
//
// De haut en bas : alertes · trésorerie nette réelle (banque + espèces −
// prévisions) · trésorerie (+ partenaires à recevoir) · prévisions · dépenses
// du mois · dette récente · dette · coffre · raccourcis. Les blocs mènent à
// leur écran ; une ligne de dépense ou de dette ouvre son détail (payer).
// Les alertes sont chargées à part pour ne pas retarder l'affichage.
// Spéc : docs/superpowers/specs/2026-10-02-nouvelle-tresorerie-design.md (étape 3)
// ──────────────────────────────────────────────────────────────────────────────
import { Redirect, router } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { Alert, SafeAreaView, ScrollView, Text, TouchableOpacity, View } from 'react-native'

import {
  Bouton, ChampMontant, Entete, EtatEcran, Feuille, Puces, useStylesTreso, useTresorerie,
} from '../components/tresorerie/commun'
import { Badge, FeuilleDetail, FeuillePaiement, couleursStatut, titreDu } from '../components/tresorerie/du'
import { objectifDuMois, progression, resteARembourser, soldeCoffre } from '../lib/direction'
import { chargerAlertes, chargerPlafonds, enregistrerPlafonds } from '../lib/alertesDb'
import { totalPartenaires } from '../lib/partenaires'
import {
  LIBELLES_CATEGORIE, NIVEAUX, aujourdhuiISO, classerTous, depensesDuMois, fmt, formatDateFR, fournisseursDus,
  joursDeRetard, libelleMoisCourt, paiementsParDu, peut, premierDuMois, resteDu, syntheseTresorerie, totalPaye,
} from '../lib/tresorerie'
import { chargerUtilisateursAdmin, enregistrerDroit, retirerDroit } from '../lib/tresorerieDb'

export default function TresorerieScreen() {
  const { styles, colors } = useStylesTreso()
  const t = useTresorerie({ creerLoyers: true, avecPartenaires: true, avecDirection: true })
  const { donnees, niveau, droits, user, recharger } = t
  const [droitsVisible, setDroitsVisible] = useState(false)
  const [plafondsVisible, setPlafondsVisible] = useState(false)
  const [alertes, setAlertes] = useState(null)
  const [toutesAlertes, setToutesAlertes] = useState(false)
  const [ouvert, setOuvert] = useState({ dette_recente: false, dette: false })
  const [detail, setDetail] = useState(null)       // dû ouvert
  const [paiement, setPaiement] = useState(null)   // { du } ou { categorie: 'loyer', restaurantId }

  useEffect(() => {
    if (!peut(niveau, 'voir_vue') || !donnees) return
    let vivant = true
    chargerAlertes().then(a => { if (vivant) setAlertes(a) }).catch(() => { if (vivant) setAlertes(null) })
    return () => { vivant = false }
  }, [niveau, donnees])

  const aujourdhui = aujourdhuiISO()
  const partenaires = useMemo(() => {
    const p = donnees?.partenaires
    if (!p) return null
    return totalPartenaires({ reglages: p.reglages, points: p.points, lignes: p.lignes, aujourdhui })
  }, [donnees, aujourdhui])

  // Prévisions : étape 4 (0 en attendant).
  const s = useMemo(
    () => (donnees ? syntheseTresorerie({ comptes: donnees.comptes, partenaires: partenaires?.total || 0, prevu: 0 }) : null),
    [donnees, partenaires],
  )
  const parDu = useMemo(() => paiementsParDu(donnees?.paiements), [donnees])
  const classement = useMemo(
    () => (donnees ? classerTous(donnees.dus, donnees.paiements, aujourdhui) : {}),
    [donnees, aujourdhui],
  )
  const depenses = useMemo(
    () => (donnees ? depensesDuMois(donnees.dus, donnees.paiements, aujourdhui) : []),
    [donnees, aujourdhui],
  )

  // Le RH ne saisit que les charges (loyers, salaires, CNPS, impôts…) : on l'y
  // emmène directement. <Redirect> plutôt que router.replace dans un effet : ce
  // dernier plantait quand la page était chargée directement (navigation avant
  // le montage du layout).
  if (niveau === 'saisie_rh') return <Redirect href="/tresorerie-a-payer?onglet=loyer" />

  const etat = <EtatEcran {...t} autorise={peut(niveau, 'voir_vue')} />
  const bloque = (t.loading && !donnees) || t.erreur || !niveau || !peut(niveau, 'voir_vue')
  const nomResto = id => donnees?.restaurants.find(r => r.id === id)?.nom || 'Groupe'
  const reste = d => resteDu(d, parDu[d.id])
  const enDette = cle => (donnees?.dus || []).filter(d => classement[d.id] === cle)
    .sort((a, b) => (a.echeance || '9999').localeCompare(b.echeance || '9999'))
  const sections = ['dette_recente', ...(peut(niveau, 'voir_dettes') ? ['dette'] : [])]
  const aEspeces = (donnees?.comptes || []).some(c => c.nom === 'Espèces')

  return (
    <SafeAreaView style={styles.container}>
      <Entete
        titre="Trésorerie"
        repli="/accueil"
        sous={niveau ? NIVEAUX[niveau] : null}
        droite={peut(niveau, 'gerer_droits') ? (
          <TouchableOpacity onPress={() => setDroitsVisible(true)}>
            <Text style={styles.back}>Droits</Text>
          </TouchableOpacity>
        ) : null}
      />
      {bloque ? etat : (
        <ScrollView style={styles.body} contentContainerStyle={styles.bodyContenu}>
          {(alertes || []).slice(0, toutesAlertes ? undefined : 3).map(a => (
            <View key={a.cle} style={{
              borderRadius: 12, padding: 10, marginBottom: 8, borderWidth: 1,
              backgroundColor: a.niveau === 'rouge' ? colors.errorLight : colors.warningLight,
              borderColor: a.niveau === 'rouge' ? colors.error : colors.warning,
            }}>
              <Text style={{ fontSize: 13, lineHeight: 18, color: a.niveau === 'rouge' ? colors.errorDark : colors.warningDark }}>
                {a.niveau === 'rouge' ? '🔴' : '🟠'} {a.message}
              </Text>
            </View>
          ))}
          {(alertes || []).length > 3 && (
            <TouchableOpacity onPress={() => setToutesAlertes(v => !v)} style={{ marginBottom: 8 }}>
              <Text style={[styles.petit, { color: colors.primary, fontWeight: '700' }]}>
                {toutesAlertes ? 'Réduire' : `Voir les ${alertes.length} alertes`}
              </Text>
            </TouchableOpacity>
          )}

          {/* 1 · Trésorerie nette réelle */}
          <TouchableOpacity style={styles.carte} onPress={() => router.push('/tresorerie-banque')}>
            <Text style={styles.lbl}>Trésorerie nette réelle</Text>
            <Text style={[styles.grand, { color: s.nette >= 0 ? colors.success : colors.error }]}>
              {s.nette >= 0 ? '' : '− '}{fmt(Math.abs(s.nette))} F
            </Text>
            <Text style={styles.petit}>Banque et espèces {fmt(s.banque + s.especes)} − prévisions {fmt(s.prevu)}</Text>
          </TouchableOpacity>

          {/* 2 · Trésorerie */}
          <View style={styles.carte}>
            <Text style={[styles.lbl, { marginBottom: 4 }]}>Trésorerie</Text>
            <LigneLien label="Banque (BACI, SIB)" valeur={s.banque} onPress={() => router.push('/tresorerie-banque')} />
            <LigneLien label={aEspeces ? 'Espèces' : 'Espèces (migration à passer)'} valeur={s.especes} onPress={() => router.push('/tresorerie-banque')} />
            <LigneLien
              label={donnees.partenaires === null ? 'Partenaires à recevoir (migration à passer)' : 'Partenaires à recevoir'}
              valeur={s.partenaires} onPress={() => router.push('/tresorerie-partenaires')}
            />
            <View style={styles.sep} />
            <View style={styles.ligne}>
              <Text style={[styles.ligneLabel, { fontWeight: '800' }]}>Total</Text>
              <Text style={[styles.ligneValeur, { fontWeight: '800' }]}>{fmt(s.tresorerie)} F</Text>
            </View>
            <TouchableOpacity onPress={() => router.push('/credits-fournisseurs')} style={{ marginTop: 6 }}>
              <Text style={styles.petit}>Pour information : fournisseurs dus {fmt(fournisseursDus(donnees.fournisseurs))} F (payés par les restaurants) ›</Text>
            </TouchableOpacity>
          </View>

          {/* 3 · Prévisions (étape 4) */}
          <View style={styles.carte}>
            <View style={styles.ligne}>
              <Text style={styles.lbl}>Prévisions</Text>
              <Text style={styles.ligneValeur}>{fmt(s.prevu)} F</Text>
            </View>
            <Text style={styles.petit}>Aucune prévision pour l'instant.</Text>
          </View>

          {/* 4 · Dépenses du mois */}
          <View style={styles.carte}>
            <TouchableOpacity style={styles.ligne} onPress={() => router.push('/tresorerie-a-payer')}>
              <Text style={styles.lbl}>Dépenses du mois ›</Text>
              <Text style={[styles.ligneValeur, { color: colors.warningDark }]}>{fmt(depenses.reduce((x, d) => x + reste(d), 0))} F</Text>
            </TouchableOpacity>
            {depenses.length === 0 && <Text style={styles.petit}>Rien à payer d'ici les prochaines dates limites.</Text>}
            {depenses.map(d => (
              <LigneDu key={d.id} du={d} reste={reste(d)} paye={totalPaye(parDu[d.id])} nomResto={nomResto}
                info={`avant le ${formatDateFR(d.echeance)}`} onPress={() => setDetail(d)} />
            ))}
          </View>

          {/* 5 · Dette récente, 6 · Dette */}
          {sections.map(cle => {
            const lignes = enDette(cle)
            const total = lignes.reduce((x, d) => x + reste(d), 0)
            return (
              <View key={cle} style={styles.carte}>
                <TouchableOpacity style={styles.ligne} onPress={() => setOuvert(o => ({ ...o, [cle]: !o[cle] }))}>
                  <Text style={styles.lbl}>{cle === 'dette' ? 'Dette' : 'Dette récente'} · {lignes.length} {ouvert[cle] ? '▴' : '▾'}</Text>
                  <Text style={[styles.ligneValeur, { color: total ? colors.error : colors.success }]}>{fmt(total)} F</Text>
                </TouchableOpacity>
                {ouvert[cle] && lignes.length === 0 && <Text style={styles.petit}>Rien ici.</Text>}
                {ouvert[cle] && lignes.map(d => {
                  const j = d.echeance ? joursDeRetard(d.echeance, aujourdhui) : 0
                  return (
                    <LigneDu key={d.id} du={d} reste={reste(d)} paye={totalPaye(parDu[d.id])} nomResto={nomResto}
                      info={j ? `${j} j de retard` : d.est_pret ? 'prêt' : ''} badge={cle} onPress={() => setDetail(d)} />
                  )
                })}
              </View>
            )
          })}

          {/* Coffre */}
          {peut(niveau, 'voir_coffre') && donnees.direction && (() => {
            const solde = soldeCoffre(donnees.direction.coffre)
            const objectif = objectifDuMois(donnees.direction.objectifs, premierDuMois(aujourdhui))
            const pct = progression(solde, objectif)
            const aRendre = resteARembourser(donnees.direction.emprunts)
            return (
              <TouchableOpacity style={styles.carte} onPress={() => router.push('/tresorerie-coffre')}>
                <View style={styles.ligne}>
                  <Text style={styles.lbl}>Coffre (épargne)</Text>
                  <Text style={styles.ligneValeur}>{pct === null ? '—' : `${pct} %`}</Text>
                </View>
                <View style={{ height: 10, backgroundColor: colors.surfaceAlt, borderRadius: 6, overflow: 'hidden', marginVertical: 6 }}>
                  <View style={{ height: '100%', width: `${Math.min(100, pct || 0)}%`, backgroundColor: colors.success }} />
                </View>
                <View style={styles.ligne}>
                  <Text style={styles.petit}>{fmt(solde)} F</Text>
                  <Text style={styles.petit}>{objectif ? `objectif ${fmt(objectif)} F` : 'objectif à fixer'}</Text>
                </View>
                {aRendre > 0 && <Text style={[styles.petit, { color: colors.warningDark, fontWeight: '700' }]}>À rembourser au coffre : {fmt(aRendre)} F</Text>}
              </TouchableOpacity>
            )
          })()}

          <View style={styles.tuiles}>
            <Tuile icone="📋" titre="À payer" sous="Loyers · salaires · CNPS · impôts · dettes" route="/tresorerie-a-payer" />
            {peut(niveau, 'voir_resultats') && (
              <Tuile icone="📊" titre="Résultats" sous="Net par restaurant / mois" route="/tresorerie-resultats" />
            )}
            {peut(niveau, 'voir_direction') && <Tuile icone="💼" titre="Dépenses direction" sous="Autres charges, réparations…" route="/tresorerie-direction" />}
            {peut(niveau, 'gerer_droits') && (
              <TouchableOpacity style={styles.tuile} onPress={() => setPlafondsVisible(true)}>
                <Text style={styles.tuileTitre}>🚨 Plafonds de fond</Text>
                <Text style={styles.tuileSous}>Alerte « fond bas » par restaurant</Text>
              </TouchableOpacity>
            )}
          </View>
        </ScrollView>
      )}

      {donnees && (
        <>
          <FeuilleDetail
            du={detail} paiements={detail ? parDu[detail.id] || [] : []} classement={detail ? classement[detail.id] : null}
            donnees={donnees} niveau={niveau} aujourdhui={aujourdhui} nomResto={nomResto} user={user}
            onFermer={() => setDetail(null)}
            onPayer={du => { setDetail(null); setPaiement(du.categorie === 'loyer' ? { categorie: 'loyer', restaurantId: du.restaurant_id } : { du }) }}
            onModifier={du => { setDetail(null); router.push(`/tresorerie-a-payer?onglet=${du.categorie}`) }}
            apres={recharger}
          />
          <FeuillePaiement demande={paiement} donnees={donnees} parDu={parDu} nomResto={nomResto} user={user}
            onFermer={() => setPaiement(null)} apres={recharger} />
          <FeuillePlafonds visible={plafondsVisible} restaurants={donnees.restaurants}
            onFermer={() => setPlafondsVisible(false)} apres={recharger} />
        </>
      )}
      <FeuilleDroits
        visible={droitsVisible}
        onFermer={() => setDroitsVisible(false)}
        droits={droits}
        user={user}
        apres={recharger}
      />
    </SafeAreaView>
  )
}

// Une ligne de la trésorerie qui mène à son écran.
function LigneLien({ label, valeur, onPress }) {
  const { styles } = useStylesTreso()
  return (
    <TouchableOpacity style={styles.ligne} onPress={onPress}>
      <Text style={styles.ligneLabel}>{label} ›</Text>
      <Text style={styles.ligneValeur}>{fmt(valeur)} F</Text>
    </TouchableOpacity>
  )
}

// Une charge ou une dette : « Loyer · Lavage · sept. », reste, info, état.
function LigneDu({ du, reste, paye, nomResto, info, badge, onPress }) {
  const { styles, colors } = useStylesTreso()
  const cs = couleursStatut(colors)
  return (
    <TouchableOpacity style={styles.item} onPress={onPress}>
      <View style={{ flex: 1 }}>
        <Text style={styles.itemTitre}>
          {LIBELLES_CATEGORIE[du.categorie]} · {titreDu(du, nomResto)}{du.mois ? ` · ${libelleMoisCourt(du.mois)}` : ''}
        </Text>
        <Text style={styles.petit}>
          {paye > 0 ? `payé ${fmt(paye)} · ` : ''}
          <Text style={{ fontWeight: '800', color: colors.text }}>reste {fmt(reste)}</Text>
          {info ? ` · ${info}` : ''}
        </Text>
      </View>
      {badge && cs[badge] && <Badge c={cs[badge]} />}
    </TouchableOpacity>
  )
}

function Tuile({ icone, titre, sous, route }) {
  const { styles } = useStylesTreso()
  return (
    <TouchableOpacity style={styles.tuile} onPress={() => router.push(route)}>
      <Text style={styles.tuileTitre}>{icone} {titre}</Text>
      <Text style={styles.tuileSous}>{sous}</Text>
    </TouchableOpacity>
  )
}

// Le propriétaire désigne qui voit quoi. Sans aucune ligne « propriétaire »,
// tous les managers ont tout : il suffit que M. Zreik se désigne lui-même.
function FeuilleDroits({ visible, onFermer, droits, user, apres }) {
  const { styles } = useStylesTreso()
  const [utilisateurs, setUtilisateurs] = useState([])
  const [occupe, setOccupe] = useState(false)

  useEffect(() => {
    if (!visible) return
    chargerUtilisateursAdmin().then(setUtilisateurs).catch(() => setUtilisateurs([]))
  }, [visible])

  const niveauDe = id => droits.find(d => d.user_id === id)?.niveau || null

  async function changer(u, niveau) {
    const actuel = niveauDe(u.id)
    const proprios = droits.filter(d => d.niveau === 'proprietaire')
    if (actuel === 'proprietaire' && niveau !== 'proprietaire' && proprios.length === 1 && u.id === user.userId) {
      Alert.alert('Impossible', 'Vous êtes le seul propriétaire. Désignez-en un autre avant de retirer le vôtre.')
      return
    }
    setOccupe(true)
    try {
      if (niveau === null) await retirerDroit({ user_id: u.id, user_nom: u.nom }, user)
      else await enregistrerDroit({ userIdCible: u.id, userNomCible: u.nom, niveau }, user)
      await apres()
    } catch (e) {
      Alert.alert('Droits non enregistrés', e?.message || 'Réessayez.')
    } finally {
      setOccupe(false)
    }
  }

  const options = [
    { valeur: 'proprietaire', label: 'Propriétaire' },
    { valeur: 'lecture', label: 'Lecture' },
    { valeur: 'saisie_rh', label: 'RH (charges)' },
    { valeur: null, label: 'Par défaut' },
  ]

  return (
    <Feuille visible={visible} titre="Droits de la trésorerie" onFermer={onFermer}>
      <View style={styles.avert}>
        <Text style={styles.avertTxt}>
          Par défaut : managers et directeur en lecture, RH en saisie des charges (loyers, salaires, CNPS, impôts, ITS, TEE, bail).
          Tant qu'aucun propriétaire n'est désigné, tous les managers ont tout.
          Ces droits règlent l'affichage dans l'app, pas l'accès à la base.
        </Text>
      </View>
      {utilisateurs.length === 0 && <Text style={styles.vide}>Aucun manager, directeur ou RH trouvé.</Text>}
      {utilisateurs.map(u => (
        <View key={u.id} style={[styles.carte, occupe && { opacity: 0.6 }]}>
          <Text style={styles.itemTitre}>{u.nom}</Text>
          <Text style={[styles.petit, { marginBottom: 8 }]}>{u.role}</Text>
          <Puces options={options} valeur={niveauDe(u.id)} onChange={v => !occupe && changer(u, v)} />
        </View>
      ))}
      <Bouton titre="Fermer" secondaire onPress={onFermer} />
    </Feuille>
  )
}

// Plafond de fond par restaurant : sous ce montant (FC de la veille du dernier
// point), M. Zreik reçoit l'alerte « fond bas » avec la somme à rajouter.
function FeuillePlafonds({ visible, restaurants, onFermer, apres }) {
  const { styles } = useStylesTreso()
  const [valeurs, setValeurs] = useState({})
  const [occupe, setOccupe] = useState(false)
  const [erreur, setErreur] = useState(null)

  useEffect(() => {
    if (!visible) return
    setErreur(null)
    chargerPlafonds()
      .then(l => setValeurs(Object.fromEntries(l.map(x => [x.restaurant_id, String(x.plafond)]))))
      .catch(() => setErreur("Les plafonds ne sont pas encore installés : il faut passer le fichier supabase_tresorerie_alertes.sql dans Supabase."))
  }, [visible])

  if (!visible) return null

  async function enregistrer() {
    const plafonds = {}
    // Un champ vidé enregistre 0 : plus d'alerte pour ce restaurant.
    for (const [id, v] of Object.entries(valeurs)) plafonds[id] = v === '' ? 0 : parseInt(v, 10) || 0
    setOccupe(true)
    try {
      await enregistrerPlafonds(plafonds)
      await apres()
      onFermer()
    } catch (e) {
      Alert.alert('Non enregistré', e?.message || 'Réessayez.')
    } finally {
      setOccupe(false)
    }
  }

  return (
    <Feuille visible onFermer={onFermer} titre="Plafonds de fond de caisse">
      {erreur ? <Text style={styles.erreur}>{erreur}</Text> : (
        <>
          <Text style={[styles.petit, { marginBottom: 12 }]}>
            Si le « FC de la veille » du dernier point passe sous ce montant, M. Zreik est prévenu avec la somme à rajouter. Vide = pas d'alerte.
          </Text>
          {restaurants.map(r => (
            <ChampMontant key={r.id} label={r.nom} valeur={valeurs[r.id] || ''}
              onChange={v => setValeurs(x => ({ ...x, [r.id]: v }))} placeholder="Pas d'alerte" />
          ))}
          <Bouton titre="Enregistrer" onPress={enregistrer} occupe={occupe} />
        </>
      )}
    </Feuille>
  )
}
