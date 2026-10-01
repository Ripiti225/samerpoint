// ──────────────────────────────────────────────────────────────────────────────
// Trésorerie — vue d'ensemble : la trésorerie nette réelle et sa formule.
//
// En haut : les alertes en cours (déficit, CNPS > 60 j, fond bas), chargées à
// part pour ne pas retarder l'affichage de la trésorerie.
// Spéc : docs/superpowers/specs/2026-10-01-tresorerie-socle-design.md
// ──────────────────────────────────────────────────────────────────────────────
import { router } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { Alert, SafeAreaView, ScrollView, Text, TouchableOpacity, View } from 'react-native'

import {
  Bouton, ChampMontant, Entete, EtatEcran, Feuille, Ligne, Puces, useStylesTreso, useTresorerie,
} from '../components/tresorerie/commun'
import { objectifDuMois, progression, soldeCoffre } from '../lib/direction'
import { chargerAlertes, chargerPlafonds, enregistrerPlafonds } from '../lib/alertesDb'
import { totalPartenaires } from '../lib/partenaires'
import {
  NIVEAUX, aujourdhuiISO, calculerTresorerieNette, fmt, fournisseursDus, peut, premierDuMois,
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

  useEffect(() => {
    if (!peut(niveau, 'voir_vue') || !donnees) return
    let vivant = true
    chargerAlertes().then(a => { if (vivant) setAlertes(a) }).catch(() => { if (vivant) setAlertes(null) })
    return () => { vivant = false }
  }, [niveau, donnees])

  // Le RH n'a que les salaires et la CNPS : on l'y emmène directement.
  useEffect(() => {
    if (niveau === 'saisie_rh') router.replace('/tresorerie-a-payer?onglet=salaire')
  }, [niveau])

  const partenaires = useMemo(() => {
    const p = donnees?.partenaires
    if (!p) return null
    return totalPartenaires({ reglages: p.reglages, points: p.points, lignes: p.lignes, aujourdhui: aujourdhuiISO() })
  }, [donnees])

  const r = useMemo(() => {
    if (!donnees) return null
    return calculerTresorerieNette({
      comptes: donnees.comptes,
      dus: donnees.dus,
      paiements: donnees.paiements,
      fournisseursDus: fournisseursDus(donnees.fournisseurs),
      partenaires: partenaires?.total || 0,
      moisCourant: premierDuMois(aujourdhuiISO()),
    })
  }, [donnees, partenaires])

  const etat = <EtatEcran {...t} autorise={peut(niveau, 'voir_vue') || niveau === 'saisie_rh'} />
  const bloque = (t.loading && !donnees) || t.erreur || !niveau || !peut(niveau, 'voir_vue')

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

          <View style={styles.carte}>
            <Text style={styles.lbl}>Trésorerie nette réelle</Text>
            <Text style={[styles.grand, { color: r.nette >= 0 ? colors.success : colors.error }]}>
              {r.nette >= 0 ? '+ ' : '− '}{fmt(Math.abs(r.nette))} F
            </Text>
            <View style={styles.sep} />
            <Ligne label="Banque (BACI + SIB)" valeur={r.banque} />
            <Ligne
              label={donnees.partenaires === null ? '+ Partenaires à recevoir (migration à passer)' : '+ Partenaires à recevoir'}
              valeur={r.partenaires} signe="+" couleur={donnees.partenaires === null ? colors.textMuted : colors.success}
            />
            <Ligne label="− Loyers restants" valeur={r.loyers} signe="-" couleur={colors.error} />
            <Ligne label="− Salaires restants" valeur={r.salaires} signe="-" couleur={colors.error} />
            <Ligne label="− CNPS" valeur={r.cnps} signe="-" couleur={colors.error} />
            <Ligne label="− Impôts et autres charges admin" valeur={r.admin} signe="-" couleur={colors.error} />
            {peut(niveau, 'voir_dettes') && (
              <Ligne label="− Carnet de dettes" valeur={r.dettes} signe="-" couleur={colors.error} />
            )}
            <View style={styles.sep} />
            <Text style={[styles.lbl, { marginBottom: 2 }]}>Pour information · payé par les restaurants</Text>
            <Ligne label="Fournisseurs dus" valeur={r.fournisseurs} couleur={colors.textMuted} />
            <Ligne label="ODP et mairie restants" valeur={r.adminRestaurants} couleur={colors.textMuted} />
            <Text style={styles.petit}>Ces montants ne sont pas soustraits de la trésorerie nette.</Text>
          </View>

          {peut(niveau, 'voir_coffre') && donnees.direction && (() => {
            const solde = soldeCoffre(donnees.direction.coffre)
            const objectif = objectifDuMois(donnees.direction.objectifs, premierDuMois(aujourdhuiISO()))
            const pct = progression(solde, objectif)
            return (
              <TouchableOpacity style={styles.carte} onPress={() => router.push('/tresorerie-coffre')}>
                <View style={styles.ligne}>
                  <Text style={styles.lbl}>Coffre de sécurité</Text>
                  <Text style={styles.ligneValeur}>{pct === null ? '—' : `${pct} %`}</Text>
                </View>
                <View style={{ height: 10, backgroundColor: colors.surfaceAlt, borderRadius: 6, overflow: 'hidden', marginVertical: 6 }}>
                  <View style={{ height: '100%', width: `${Math.min(100, pct || 0)}%`, backgroundColor: colors.success }} />
                </View>
                <View style={styles.ligne}>
                  <Text style={styles.petit}>{fmt(solde)} F</Text>
                  <Text style={styles.petit}>{objectif ? `objectif ${fmt(objectif)} F` : 'objectif à fixer'}</Text>
                </View>
              </TouchableOpacity>
            )
          })()}

          <View style={styles.tuiles}>
            <Tuile icone="🏦" titre="Banque" sous={`${fmt(r.banque)} F · BACI · SIB`} route="/tresorerie-banque" />
            <Tuile icone="🛵" titre="Partenaires" sous={`${fmt(r.partenaires)} F à recevoir`} route="/tresorerie-partenaires" />
            <Tuile icone="📋" titre="À payer" sous="Loyers · salaires · CNPS · admin" route="/tresorerie-a-payer" />
            {peut(niveau, 'voir_dettes') && (
              <Tuile icone="📒" titre="Dettes" sous={`${fmt(r.dettes)} F à rembourser`} route="/tresorerie-a-payer?onglet=dette" />
            )}
            {peut(niveau, 'voir_resultats') && (
              <Tuile icone="📊" titre="Résultats" sous="Net par restaurant / mois" route="/tresorerie-resultats" />
            )}
            {peut(niveau, 'voir_coffre') && <Tuile icone="🔒" titre="Coffre" sous="Dépôts · retraits · objectif" route="/tresorerie-coffre" />}
            {peut(niveau, 'voir_direction') && <Tuile icone="💼" titre="Dépenses direction" sous="Fond, réparation, équipement…" route="/tresorerie-direction" />}
            {peut(niveau, 'gerer_droits') && (
              <TouchableOpacity style={styles.tuile} onPress={() => setPlafondsVisible(true)}>
                <Text style={styles.tuileTitre}>🚨 Plafonds de fond</Text>
                <Text style={styles.tuileSous}>Alerte « fond bas » par restaurant</Text>
              </TouchableOpacity>
            )}
            <Tuile icone="💳" titre="Fournisseurs" sous={`${fmt(r.fournisseurs)} F dus`} route="/credits-fournisseurs" />
          </View>
        </ScrollView>
      )}

      {donnees && (
        <FeuillePlafonds visible={plafondsVisible} restaurants={donnees.restaurants}
          onFermer={() => setPlafondsVisible(false)} apres={recharger} />
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
    { valeur: 'saisie_rh', label: 'Salaires / CNPS' },
    { valeur: null, label: 'Par défaut' },
  ]

  return (
    <Feuille visible={visible} titre="Droits de la trésorerie" onFermer={onFermer}>
      <View style={styles.avert}>
        <Text style={styles.avertTxt}>
          Par défaut : managers et directeur en lecture, RH en saisie des salaires et de la CNPS.
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
