// ──────────────────────────────────────────────────────────────────────────────
// Trésorerie — accueil.
//
// De haut en bas : alertes · trésorerie nette réelle (banque + espèces −
// prévisions) · trésorerie (+ partenaires à recevoir) · prévisions · dépenses
// du mois · dette récente · dette · coffre · tous les raccourcis. Un appui sur
// un bloc le déroule sur place avec ses montants (il n'ouvre pas d'écran) ;
// une ligne de dépense ou de dette ouvre son détail (payer).
// Les alertes sont chargées à part pour ne pas retarder l'affichage.
// Spéc : docs/superpowers/specs/2026-10-02-nouvelle-tresorerie-design.md (étape 3)
// ──────────────────────────────────────────────────────────────────────────────
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons'
import { Redirect, router } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, SafeAreaView, ScrollView, Text, TouchableOpacity, View } from 'react-native'

import {
  BarreRepartition, Bouton, Champ, ChampMontant, Entete, EtatEcran, Feuille, Hero, HeroCase, ItemIcone, Ligne, Pastille,
  Progression, Puces, TitreSection, styleCategorie, useStylesTreso, useTresorerie,
} from '../components/tresorerie/commun'
import FeuilleTransfertFond from '../components/tresorerie/FeuilleTransfertFond'
import { FeuillePayerDroit } from '../components/tresorerie/anciensTravailleurs'
import { Badge, FeuilleDetail, FeuillePaiement, FeuillePrevision, couleursStatut, titreDu } from '../components/tresorerie/du'
import { etatPrevision, totalPrevu, trierPrevisions } from '../lib/previsions'
import { objectifDuMois, progression, resteARembourser, soldeCoffre } from '../lib/direction'
import { chargerAlertes, chargerPlafonds, enregistrerPlafonds } from '../lib/alertesDb'
import { totalPartenaires } from '../lib/partenaires'
import {
  LIBELLES_CATEGORIE, NIVEAUX, aujourdhuiISO, classerTous, depensesDuMois, fmt, formatDateFR,
  joursDeRetard, libelleMoisCourt, paiementsParDu, peut, premierDuMois, resteDu, syntheseTresorerie, totalPaye,
} from '../lib/tresorerie'
import { separerFournisseurs, totalDu } from '../lib/fournisseursAdmin'
import { chargerUtilisateursAdmin, enregistrerDroit, enregistrerDu, retirerDroit } from '../lib/tresorerieDb'
import { chargerFondsNegatifs } from '../lib/transfertFondDb'

export default function TresorerieScreen() {
  const { styles, colors } = useStylesTreso()
  const t = useTresorerie({ creerLoyers: true, avecPartenaires: true, avecDirection: true })
  const { donnees, niveau, droits, user, recharger } = t
  const [droitsVisible, setDroitsVisible] = useState(false)
  const [plafondsVisible, setPlafondsVisible] = useState(false)
  const [alertes, setAlertes] = useState(null)
  const [toutesAlertes, setToutesAlertes] = useState(false)
  const [ouvert, setOuvert] = useState({})           // blocs déroulés
  const [nouvelleDette, setNouvelleDette] = useState(false)
  const [detail, setDetail] = useState(null)       // dû ouvert
  const [paiement, setPaiement] = useState(null)   // { du, prevision? } ou { categorie: 'loyer', restaurantId }
  const [prevoir, setPrevoir] = useState(null)     // dû dont on prévoit le paiement
  const [payerDroit, setPayerDroit] = useState(null) // fiche d'un ancien travailleur à payer (prévision orange)
  const [choix, setChoix] = useState(false)        // choisir la ligne à prévoir
  const [historique, setHistorique] = useState(false)
  const [fondsNeg, setFondsNeg] = useState([])          // fonds de caisse négatifs
  const [transfertResto, setTransfertResto] = useState(null) // restaurant dont on remet le fond à 0

  useEffect(() => {
    if (!peut(niveau, 'voir_vue') || !donnees) return
    let vivant = true
    chargerAlertes().then(a => { if (vivant) setAlertes(a) }).catch(() => { if (vivant) setAlertes(null) })
    return () => { vivant = false }
  }, [niveau, donnees])

  const rechargerFonds = useCallback(() => {
    if (!donnees) return Promise.resolve()
    const noms = id => donnees.restaurants.find(r => r.id === id)?.nom?.trim() || 'Restaurant'
    return chargerFondsNegatifs(noms).then(setFondsNeg).catch(() => setFondsNeg([]))
  }, [donnees])
  useEffect(() => { if (peut(niveau, 'saisir_dus')) rechargerFonds() }, [niveau, rechargerFonds])

  const aujourdhui = aujourdhuiISO()
  const partenaires = useMemo(() => {
    const p = donnees?.partenaires
    if (!p) return null
    return totalPartenaires({ reglages: p.reglages, points: p.points, lignes: p.lignes, aujourdhui })
  }, [donnees, aujourdhui])

  const parDu = useMemo(() => paiementsParDu(donnees?.paiements), [donnees])
  // Prévisions : chaque ligne avec son état ; ouvertes (orange d'abord) et réalisées.
  const prev = useMemo(() => {
    if (!donnees) return { ouvertes: [], realisees: [], total: 0, parDu: {} }
    // Droits des anciens travailleurs : lignes à part, pour les prévisions seulement.
    const dusPrev = [...donnees.dus, ...(donnees.droits?.dus || [])]
    const paiementsPrev = [...donnees.paiements, ...(donnees.droits?.paiements || [])]
    const parDuPrev = paiementsParDu(paiementsPrev)
    const lignes = (donnees.previsions || []).map(p => {
      const du = dusPrev.find(d => d.id === p.du_id)
      return du ? { prevision: p, du, etat: etatPrevision(p, { du, paiementsDu: parDuPrev[du.id] || [], receptions: donnees.receptions, aujourdhui }) } : null
    }).filter(Boolean)
    const ouvertes = trierPrevisions(lignes.filter(l => l.etat.statut !== 'realisee'))
    const parLigne = {}
    for (const l of ouvertes) parLigne[l.du.id] = (parLigne[l.du.id] || 0) + l.etat.reste
    return {
      ouvertes,
      realisees: lignes.filter(l => l.etat.statut === 'realisee').reverse(),
      total: totalPrevu(donnees.previsions, dusPrev, paiementsPrev, donnees.receptions, aujourdhui),
      parDu: parLigne,
    }
  }, [donnees, aujourdhui])
  const s = useMemo(
    () => (donnees ? syntheseTresorerie({ comptes: donnees.comptes, partenaires: partenaires?.total || 0, prevu: prev.total }) : null),
    [donnees, partenaires, prev],
  )
  const classement = useMemo(
    () => (donnees ? classerTous(donnees.dus, donnees.paiements, aujourdhui) : {}),
    [donnees, aujourdhui],
  )
  const depenses = useMemo(
    () => (donnees ? depensesDuMois(donnees.dus, donnees.paiements, aujourdhui) : []),
    [donnees, aujourdhui],
  )

  // Le RH ne saisit que les charges (loyers, salaires, CNPS, timbre…) : on l'y
  // emmène directement. <Redirect> plutôt que router.replace dans un effet : ce
  // dernier plantait quand la page était chargée directement (navigation avant
  // le montage du layout).
  if (niveau === 'saisie_rh') return <Redirect href="/tresorerie-a-payer?onglet=loyer" />

  const etat = <EtatEcran {...t} autorise={peut(niveau, 'voir_vue')} />
  const bloque = (t.loading && !donnees) || t.erreur || !niveau || !peut(niveau, 'voir_vue')
  const nomResto = id => donnees?.restaurants.find(r => r.id === id)?.nom || 'Groupe'
  const reste = d => (d.droit ? Math.max(0, d.fiche.reste) : resteDu(d, parDu[d.id]))
  const enDette = cle => (donnees?.dus || []).filter(d => classement[d.id] === cle)
    .sort((a, b) => (a.echeance || '9999').localeCompare(b.echeance || '9999'))
  const sections = ['dette_recente', ...(peut(niveau, 'voir_dettes') ? ['dette'] : [])]
  const aEspeces = (donnees?.comptes || []).some(c => c.nom === 'Espèces')
  const basculer = cle => setOuvert(o => ({ ...o, [cle]: !o[cle] }))
  const nbOrange = prev.ouvertes.filter(l => l.etat.statut === 'a_payer').length
  const infoPrevu = d => (prev.parDu[d.id] ? `prévu ${fmt(prev.parDu[d.id])}` : '')
  // Lignes qu'on peut prévoir : dépenses du mois, dette récente, dette, autres
  // charges à payer, puis les charges qui viennent plus tard (ex. loyer du mois en cours).
  const groupesAPrevoir = () => {
    const vus = new Set(depenses.map(d => d.id))
    const ouvertes = (donnees?.dus || []).filter(d => reste(d) > 0)
    const plusTard = ouvertes.filter(d => classement[d.id] === 'a_payer' && d.categorie !== 'autre' && !vus.has(d.id))
      .sort((a, b) => (a.echeance || '').localeCompare(b.echeance || ''))
    return [
      { titre: 'Dépenses du mois', lignes: depenses },
      { titre: 'Dette récente', lignes: enDette('dette_recente') },
      ...(peut(niveau, 'voir_dettes') ? [{ titre: 'Dette', lignes: enDette('dette') }] : []),
      { titre: 'Autres charges à payer', lignes: ouvertes.filter(d => d.categorie === 'autre' && classement[d.id] === 'a_payer') },
      { titre: 'Plus tard', lignes: plusTard },
      { titre: 'Anciens travailleurs', lignes: (donnees?.droits?.dus || []).filter(d => reste(d) > 0) },
    ]
  }

  return (
    <SafeAreaView style={styles.container}>
      <Entete
        titre="Trésorerie"
        repli="/accueil"
        sous={niveau ? NIVEAUX[niveau] : null}
        droite={peut(niveau, 'gerer_droits') ? (
          <TouchableOpacity onPress={() => setDroitsVisible(true)} style={styles.retourBtn}
            accessibilityRole="button" accessibilityLabel="Droits de la trésorerie">
            <MaterialCommunityIcons name="account-key-outline" size={21} color="#FFFFFF" />
          </TouchableOpacity>
        ) : null}
      />
      {bloque ? etat : (
        <ScrollView style={styles.body} contentContainerStyle={styles.bodyContenu}>
          {(alertes || []).slice(0, toutesAlertes ? undefined : 3).map(a => {
            const rouge = a.niveau === 'rouge'
            return (
              <View key={a.cle} style={{
                flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, padding: 12, marginBottom: 8,
                backgroundColor: rouge ? colors.errorLight : colors.warningLight,
              }}>
                <MaterialCommunityIcons name={rouge ? 'alert-octagon-outline' : 'alert-outline'} size={22}
                  color={rouge ? colors.errorDark : colors.warningDark} />
                <Text style={{ flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '600', color: rouge ? colors.errorDark : colors.warningDark }}>
                  {a.message}
                </Text>
                {a.type === 'fond' && a.fond < 0 && peut(niveau, 'saisir_dus') && (
                  <TouchableOpacity onPress={() => setTransfertResto(a.restaurant_id)}
                    accessibilityRole="button" accessibilityLabel="Remettre le fond à 0">
                    <Text style={{ fontSize: 12, fontWeight: '800', color: colors.warningDark }}>Remettre à 0</Text>
                  </TouchableOpacity>
                )}
              </View>
            )
          })}
          {(alertes || []).length > 3 && (
            <TouchableOpacity onPress={() => setToutesAlertes(v => !v)} style={{ marginBottom: 8 }}>
              <Text style={[styles.petit, { color: colors.primary, fontWeight: '700' }]}>
                {toutesAlertes ? 'Réduire' : `Voir les ${alertes.length} alertes`}
              </Text>
            </TouchableOpacity>
          )}

          {fondsNeg.length > 0 && peut(niveau, 'saisir_dus') && (
            <View style={{ marginBottom: 12 }}>
              <TitreSection icone="cash-remove" couleur={colors.error} titre="Fonds de caisse négatifs" />
              {fondsNeg.map(f => (
                <ItemIcone key={f.restaurant_id} icone="cash-remove" couleur={colors.error}
                  titre={f.nom} sous={`fond laissé le ${formatDateFR(f.date)} · appuyer pour remettre à 0`}
                  droite={`− ${fmt(-f.fond)} F`} couleurDroite={colors.error}
                  onPress={() => setTransfertResto(f.restaurant_id)} />
              ))}
            </View>
          )}

          {/* Chaque bloc se déroule sur place (montants) ; les écrans s'ouvrent par les raccourcis du bas. */}
          <Hero icone="scale-balance" titre="Trésorerie nette réelle"
            valeur={`${s.nette < 0 ? '− ' : ''}${fmt(Math.abs(s.nette))} F`}
            couleurValeur={s.nette < 0 ? '#FECACA' : undefined}
            sous="Banque + espèces + têtes de fond − prévisions">
            <View style={{ marginTop: 14 }}>
              <BarreRepartition segments={[
                { valeur: s.banque, couleur: '#A7F3D0' },
                { valeur: s.especes, couleur: '#FDE68A' },
                { valeur: s.tetes, couleur: '#BAE6FD' },
              ]} />
            </View>
            <View style={styles.heroCases}>
              <HeroCase label="Banque" valeur={fmt(s.banque)} couleur="#A7F3D0" />
              <HeroCase label="Espèces" valeur={fmt(s.especes)} couleur="#FDE68A" />
              <HeroCase label="Têtes de fond" valeur={fmt(s.tetes)} couleur="#BAE6FD" />
            </View>
            <View style={styles.heroLigneBas}>
              <Text style={styles.heroBasLbl}>Prévisions à sortir</Text>
              <Text style={styles.heroBasVal}>− {fmt(s.prevu)} F</Text>
            </View>
          </Hero>

          <Bloc icone="bank" teinte={colors.primary} titre="Trésorerie" sous="avec les partenaires à recevoir" valeur={s.tresorerie}
            ouvert={ouvert.tresorerie} onBasculer={() => basculer('tresorerie')}>
            <Ligne label="Banque (BACI, SIB)" valeur={s.banque} />
            <Ligne label={aEspeces ? 'Espèces' : 'Espèces (migration à passer)'} valeur={s.especes} />
            <Ligne label="Têtes de fond (OM, Wave, Djamo)" valeur={s.tetes} />
            <Ligne label={donnees.partenaires === null ? 'Partenaires à recevoir (migration à passer)' : 'Partenaires à recevoir'}
              valeur={s.partenaires} />
            <Text style={[styles.petit, { marginTop: 6 }]}>
              Pour information : fournisseurs dus {fmt(totalDu(separerFournisseurs(donnees.fournisseurs).marchandise))} F, administrations {fmt(totalDu(separerFournisseurs(donnees.fournisseurs).administratifs))} F (payés par les restaurants).
            </Text>
          </Bloc>

          <Bloc icone="calendar-clock" teinte="#D97706" titre="Prévisions" nombre={prev.ouvertes.length}
            sous={nbOrange ? `${nbOrange} à payer maintenant` : 'paiements prévus'} alerte={nbOrange > 0} valeur={s.prevu}
            couleur={nbOrange ? colors.warningDark : undefined} ouvert={ouvert.prevision} onBasculer={() => basculer('prevision')}>
            {prev.ouvertes.length === 0 && <Text style={styles.petit}>Aucune prévision.</Text>}
            {prev.ouvertes.map(({ prevision: p, du, etat }) => {
              const orange = etat.statut === 'a_payer'
              return (
                <ItemIcone key={p.id} onPress={() => (du.droit ? router.push('/tresorerie-a-payer?onglet=anciens_travailleurs') : setDetail(du))}
                  icone={styleCategorie(du.categorie).icone} couleur={styleCategorie(du.categorie).couleur}
                  surligne={orange ? colors.warningLight : null}
                  titre={`${LIBELLES_CATEGORIE[du.categorie]} · ${titreDu(du, nomResto)}${du.mois ? ` · ${libelleMoisCourt(du.mois)}` : ''}`}
                  sous={<Text style={[styles.petit, orange && { color: colors.warningDark, fontWeight: '700' }]}>{etat.message}</Text>}
                  droite={`${fmt(etat.reste)} F`}
                  sousDroite={orange && peut(niveau, 'payer') ? (
                    <Bouton titre="Payer" style={styles.btnPetit} onPress={() => (du.droit ? setPayerDroit(du.fiche) : setPaiement({ du, prevision: p }))} />
                  ) : null}
                />
              )
            })}
            {peut(niveau, 'payer') && (
              <Bouton secondaire icone="calendar-plus" titre="Prévoir un paiement" style={{ marginTop: 4 }} onPress={() => setChoix(true)} />
            )}
            {prev.realisees.length > 0 && (
              <TouchableOpacity onPress={() => setHistorique(h => !h)} style={{ marginTop: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <MaterialCommunityIcons name="history" size={15} color={colors.textSecondary} />
                  <Text style={[styles.petit, { fontWeight: '800', color: colors.textSecondary, marginTop: 0 }]}>Prévisions réalisées · {prev.realisees.length}</Text>
                  <MaterialCommunityIcons name={historique ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textSecondary} />
                </View>
              </TouchableOpacity>
            )}
            {historique && prev.realisees.map(({ prevision: p, du, etat }) => (
              <ItemIcone key={p.id} estompe icone="check-circle-outline" couleur={colors.success}
                titre={`${LIBELLES_CATEGORIE[du.categorie]} · ${titreDu(du, nomResto)}${du.mois ? ` · ${libelleMoisCourt(du.mois)}` : ''}`}
                sous={`prévu ${fmt(p.montant)} F · payé ${fmt(etat.realise)} F · ${etat.message.toLowerCase()}`} />
            ))}
          </Bloc>

          <Bloc icone="receipt-text-clock-outline" teinte="#EA580C" titre="Dépenses du mois" nombre={depenses.length}
            sous="à payer d'ici les prochaines dates limites" valeur={depenses.reduce((x, d) => x + reste(d), 0)}
            couleur={colors.warningDark} ouvert={ouvert.depenses} onBasculer={() => basculer('depenses')}>
            {depenses.length === 0 && <Text style={styles.petit}>Rien à payer d'ici les prochaines dates limites.</Text>}
            {depenses.map(d => (
              <LigneDu key={d.id} du={d} reste={reste(d)} paye={totalPaye(parDu[d.id])} nomResto={nomResto}
                info={[`avant le ${formatDateFR(d.echeance)}`, infoPrevu(d)].filter(Boolean).join(' · ')} onPress={() => setDetail(d)} />
            ))}
          </Bloc>

          {sections.map(cle => {
            const lignes = enDette(cle)
            const total = lignes.reduce((x, d) => x + reste(d), 0)
            return (
              <Bloc key={cle} icone={styleCategorie(cle).icone} teinte={styleCategorie(cle).couleur}
                titre={cle === 'dette' ? 'Dette' : 'Dette récente'} nombre={lignes.length}
                sous={cle === 'dette' ? 'créanciers et retards anciens' : 'date limite passée'} alerte={total > 0}
                valeur={total} couleur={total ? colors.error : colors.success} ouvert={ouvert[cle]} onBasculer={() => basculer(cle)}>
                {lignes.length === 0 && <Text style={styles.petit}>Rien ici.</Text>}
                {lignes.map(d => {
                  const j = d.echeance ? joursDeRetard(d.echeance, aujourdhui) : 0
                  return (
                    <LigneDu key={d.id} du={d} reste={reste(d)} paye={totalPaye(parDu[d.id])} nomResto={nomResto}
                      info={[j ? `${j} j de retard` : d.est_pret ? 'prêt' : '', infoPrevu(d)].filter(Boolean).join(' · ')}
                      badge={cle} onPress={() => setDetail(d)} />
                  )
                })}
                {cle === 'dette' && peut(niveau, 'saisir_dus') && (
                  <Bouton secondaire icone="plus" titre="Ajouter une dette" style={{ marginTop: 4 }} onPress={() => setNouvelleDette(true)} />
                )}
              </Bloc>
            )
          })}

          {peut(niveau, 'voir_coffre') && donnees.direction && (() => {
            const solde = soldeCoffre(donnees.direction.coffre)
            const objectif = objectifDuMois(donnees.direction.objectifs, premierDuMois(aujourdhui))
            const pct = progression(solde, objectif)
            const aRendre = resteARembourser(donnees.direction.emprunts)
            return (
              <Bloc icone="safe" teinte="#7C3AED" titre="Coffre" sous={pct === null ? 'épargne · pas d\'objectif' : `épargne · ${pct} % de l'objectif`}
                valeur={solde} ouvert={ouvert.coffre} onBasculer={() => basculer('coffre')}
                pied={<View style={{ marginTop: 12 }}><Progression pct={pct} couleur="#7C3AED" hauteur={8} /></View>}>
                <Ligne label="Objectif du mois" valeur={objectif} />
                <Ligne label="Atteint" valeur={solde} />
                {aRendre > 0 && <Ligne label="À rembourser au coffre" valeur={aRendre} couleur={colors.warningDark} />}
              </Bloc>
            )
          })()}

          <TitreSection icone="apps" titre="Tous les écrans" style={{ marginTop: 18 }} />
          <View style={styles.tuiles}>
            <Tuile icone="bank" couleur="#0E9F6E" titre="Banque et espèces" sous={`${fmt(s.banque + s.especes + s.tetes)} F`} detail="BACI · SIB · espèces · têtes de fond" route="/tresorerie-banque" />
            <Tuile icone="moped" couleur="#E11D48" titre="Partenaires" sous={`${fmt(s.partenaires)} F`} detail="à recevoir" route="/tresorerie-partenaires" />
            <Tuile icone="clipboard-list" couleur="#2563EB" titre="À payer" detail="Loyers · salaires · CNPS · timbre…" route="/tresorerie-a-payer" />
            {peut(niveau, 'voir_dettes') && (
              <Tuile icone="notebook" couleur="#DC2626" titre="Dettes" sous={`${fmt(enDette('dette').reduce((x, d) => x + reste(d), 0))} F`} detail="à rembourser" route="/tresorerie-a-payer?onglet=dette" />
            )}
            {peut(niveau, 'voir_resultats') && (
              <Tuile icone="chart-box" couleur="#6C63E0" titre="Résultats" detail="Net par restaurant et par mois" route="/tresorerie-resultats" />
            )}
            {peut(niveau, 'voir_coffre') && <Tuile icone="safe" couleur="#7C3AED" titre="Coffre" detail="Épargner · emprunter · objectif" route="/tresorerie-coffre" />}
            {peut(niveau, 'voir_direction') && <Tuile icone="briefcase" couleur="#475569" titre="Dépenses direction" detail="Autres charges, réparations…" route="/tresorerie-direction" />}
            {peut(niveau, 'gerer_droits') && (
              <Tuile icone="alarm-light" couleur="#EA580C" titre="Plafonds de fond" detail="Alerte « fond bas » par restaurant" onPress={() => setPlafondsVisible(true)} />
            )}
            <Tuile icone="credit-card-clock" couleur="#D97706" titre="Fournisseurs" sous={`${fmt(totalDu(separerFournisseurs(donnees.fournisseurs).marchandise))} F`} detail="dus par les restaurants" route="/credits-fournisseurs" />
            <Tuile icone="bank-outline" couleur="#7C3AED" titre="Administrations" sous={`${fmt(totalDu(separerFournisseurs(donnees.fournisseurs).administratifs))} F`} detail="Impôts, CNPS, bail… dus" route="/credits-fournisseurs?onglet=administratifs" />
            <Tuile icone="folder-table" couleur="#0891B2" titre="Historique" detail="Restaurants (dû et payé) · partenaires reçus" route="/tresorerie-restaurant" />
          </View>
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
            onModifier={du => { setDetail(null); router.push(`/tresorerie-a-payer?onglet=${du.categorie}`) }}
            onPrevoir={du => { setDetail(null); setPrevoir(du) }}
            apres={recharger}
          />
          <FeuillePrevision du={prevoir} donnees={donnees} nomResto={nomResto} user={user}
            onFermer={() => setPrevoir(null)} apres={recharger} />
          <FeuilleChoixLigne visible={choix} groupes={groupesAPrevoir()} nomResto={nomResto} reste={reste}
            onChoisir={du => { setChoix(false); setPrevoir(du) }} onFermer={() => setChoix(false)} />
          <FeuillePayerDroit fiche={payerDroit} nomResto={nomResto} user={user}
            onFermer={() => setPayerDroit(null)} apres={recharger} />
          <FeuillePaiement demande={paiement} donnees={donnees} parDu={parDu} nomResto={nomResto} user={user}
            onFermer={() => setPaiement(null)} apres={recharger} />
          <FeuilleTransfertFond
            restaurantId={transfertResto} nomResto={nomResto(transfertResto).trim()} user={user}
            peutTransferer={peut(niveau, 'saisir_dus')}
            onFermer={() => setTransfertResto(null)}
            apres={async () => {
              await rechargerFonds()
              chargerAlertes().then(setAlertes).catch(() => {})
              await recharger()
            }}
          />
          <FeuilleNouvelleDette visible={nouvelleDette} donnees={donnees} user={user}
            onFermer={() => setNouvelleDette(false)} apres={recharger} />
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

// Un bloc de l'accueil : pastille, titre, montant ; un appui le déroule sur place.
function Bloc({ icone, teinte, titre, sous, nombre, alerte, valeur, couleur, ouvert, onBasculer, pied, children }) {
  const { styles, colors } = useStylesTreso()
  const t = teinte || colors.primary
  return (
    <View style={[styles.carte, styles.bloc, ouvert && { borderColor: t + '55' }]}>
      <View style={[styles.blocTrait, { backgroundColor: alerte ? colors.warning : t }]} />
      <TouchableOpacity onPress={onBasculer} activeOpacity={0.7} accessibilityRole="button" accessibilityState={{ expanded: !!ouvert }}>
        <View style={styles.blocHaut}>
          <Pastille icone={icone} couleur={t} taille={42} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={styles.blocTitre} numberOfLines={1}>{titre}</Text>
              {nombre ? (
                <View style={[styles.blocNombre, { backgroundColor: t + '1F' }]}>
                  <Text style={[styles.blocNombreTxt, { color: t }]}>{nombre}</Text>
                </View>
              ) : null}
            </View>
            {sous ? <Text style={[styles.petit, alerte && { color: colors.warningDark, fontWeight: '700' }]} numberOfLines={1}>{sous}</Text> : null}
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[styles.blocValeur, couleur && { color: couleur }]}>{fmt(valeur)} F</Text>
            <MaterialCommunityIcons name={ouvert ? 'chevron-up' : 'chevron-down'} size={20} color={colors.textMuted} />
          </View>
        </View>
        {pied}
      </TouchableOpacity>
      {ouvert && <View style={styles.blocContenu}>{children}</View>}
    </View>
  )
}

// Choisir la ligne dont on prévoit le paiement, rangée comme l'accueil.
function FeuilleChoixLigne({ visible, groupes, nomResto, reste, onChoisir, onFermer }) {
  const { styles } = useStylesTreso()
  if (!visible) return null
  return (
    <Feuille visible onFermer={onFermer} titre="Prévoir un paiement : quelle dépense ?">
      {groupes.every(g => !g.lignes.length) && <Text style={styles.vide}>Rien à payer.</Text>}
      {groupes.filter(g => g.lignes.length).map(g => (
        <View key={g.titre} style={{ marginBottom: 10 }}>
          <Text style={[styles.lbl, { marginBottom: 4 }]}>{g.titre}</Text>
          {g.lignes.map(d => (
            <TouchableOpacity key={d.id} style={styles.item} onPress={() => onChoisir(d)}>
              <Text style={[styles.itemTitre, { flex: 1 }]}>
                {LIBELLES_CATEGORIE[d.categorie]} · {titreDu(d, nomResto)}{d.mois ? ` · ${libelleMoisCourt(d.mois)}` : ''}
              </Text>
              <Text style={styles.petit}>{fmt(reste(d))} F</Text>
            </TouchableOpacity>
          ))}
        </View>
      ))}
    </Feuille>
  )
}

// Ajouter une dette envers un créancier (ex. Zabad), directement depuis l'accueil.
function FeuilleNouvelleDette({ visible, donnees, user, onFermer, apres }) {
  const [creancier, setCreancier] = useState('')
  const [montant, setMontant] = useState('')
  const [note, setNote] = useState('')
  const [occupe, setOccupe] = useState(false)

  const connus = useMemo(() => [...new Set((donnees.dus || [])
    .filter(d => d.categorie === 'dette' && d.creancier).map(d => d.creancier.trim()))].sort(), [donnees])

  if (!visible) return null

  function fermer() { setCreancier(''); setMontant(''); setNote(''); onFermer() }

  async function enregistrer() {
    const v = montant === '' ? 0 : parseInt(montant, 10)
    if (!creancier.trim()) { Alert.alert('Créancier manquant', 'À qui doit-on cet argent ?'); return }
    if (!v) { Alert.alert('Montant manquant', 'Saisissez le montant dû.'); return }
    setOccupe(true)
    try {
      await enregistrerDu({ categorie: 'dette', creancier: creancier.trim(), montant_du: v, note: note.trim() }, user)
      await apres()
      fermer()
    } catch (e) {
      Alert.alert('Non enregistrée', e?.message || 'Réessayez.')
    } finally {
      setOccupe(false)
    }
  }

  return (
    <Feuille visible onFermer={fermer} titre="Ajouter une dette">
      <Champ label="Créancier" value={creancier} onChangeText={setCreancier} placeholder="Ex : Zabad" />
      {connus.length > 0 && <Puces options={connus.map(c => ({ valeur: c, label: c }))} valeur={creancier.trim()} onChange={setCreancier} />}
      <ChampMontant label="Montant dû" valeur={montant} onChange={setMontant} />
      <Champ label="Note (facultatif)" value={note} onChangeText={setNote} />
      <Bouton titre="Enregistrer" onPress={enregistrer} occupe={occupe} />
    </Feuille>
  )
}

// Une charge ou une dette : « Loyer · Lavage · sept. », reste, info, état.
function LigneDu({ du, reste, paye, nomResto, info, badge, onPress }) {
  const { colors } = useStylesTreso()
  const cs = couleursStatut(colors)
  const st = styleCategorie(du.categorie)
  return (
    <ItemIcone
      icone={st.icone} couleur={st.couleur} onPress={onPress}
      titre={`${LIBELLES_CATEGORIE[du.categorie]} · ${titreDu(du, nomResto)}${du.mois ? ` · ${libelleMoisCourt(du.mois)}` : ''}`}
      sous={[paye > 0 ? `payé ${fmt(paye)}` : '', info].filter(Boolean).join(' · ') || null}
      droite={`${fmt(reste)} F`}
      sousDroite={badge && cs[badge] ? <Badge c={cs[badge]} /> : null}
    />
  )
}

function Tuile({ icone, couleur, titre, sous, detail, route, onPress }) {
  const { styles, colors } = useStylesTreso()
  return (
    <TouchableOpacity style={styles.tuile} onPress={onPress || (() => router.push(route))}
      accessibilityRole="button" accessibilityLabel={[titre, sous, detail].filter(Boolean).join(', ')}>
      <View style={[styles.tuileBande, { backgroundColor: couleur }]} />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Pastille icone={icone} couleur={couleur} taille={40} />
        <MaterialCommunityIcons name="arrow-top-right" size={18} color={colors.textMuted} />
      </View>
      <Text style={[styles.tuileTitre, { marginTop: 10 }]}>{titre}</Text>
      {sous ? <Text style={[styles.tuileMontant, { color: couleur }]}>{sous}</Text> : null}
      {detail ? <Text style={styles.tuileSous}>{detail}</Text> : null}
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
          Par défaut : managers et directeur en lecture, RH en saisie des charges (loyers, salaires, CNPS, timbre, ITS, TEE, bail).
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
