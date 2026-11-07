// ──────────────────────────────────────────────────────────────────────────────
// Événements : anniversaires, ancienneté et calendrier du groupe.
// Direction et RH : tout le groupe. Gérant : son restaurant, sans l'âge.
// Logique : lib/evenements.js — Base : lib/evenementsDb.js
// ──────────────────────────────────────────────────────────────────────────────
import { router, useFocusEffect } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, SafeAreaView, ScrollView, Text, View } from 'react-native'

import FeuilleEvenement from '../components/evenements/FeuilleEvenement'
import FeuilleJoursFeries from '../components/evenements/FeuilleJoursFeries'
import FeuilleMessage from '../components/evenements/FeuilleMessage'
import LigneDate from '../components/evenements/LigneDate'
import LigneEvenement from '../components/evenements/LigneEvenement'
import { Bouton, EnTete, Puces, Vide, useEcranModerne } from '../components/ui/EcranModerne'
import { useApp } from '../context/AppContext'
import { aujourdhuiISO } from '../lib/contrats'
import { droitsDates, filtreVisible, filtrerParDroits, lignesDates } from '../lib/calendrierDates'
import { chargerRestaurants } from '../lib/equipeDb'
import { construireFil, construireLignes, dansRestaurant, fusionnerLignes, nbSansNaissance, peutVoirEvenements, voitToutLeGroupe } from '../lib/evenements'
import { chargerDatesCalendrier, chargerDonneesEvenements, chargerDroitsCalendrier } from '../lib/evenementsDb'

const FILTRES = [
  { cle: 'tout', label: 'Tout' },
  { cle: 'anniversaire', label: '🎂 Anniversaires' },
  { cle: 'anciennete', label: '🏅 Ancienneté' },
  { cle: 'calendrier', label: '📅 Calendrier' },
  { cle: 'tresorerie', label: '🏦 Trésorerie' },
  { cle: 'personnel', label: '👥 Personnel' },
  { cle: 'taches', label: '🧭 Tâches' },
]

export default function EvenementsScreen() {
  const { roleActif, restaurantId, userId, userNom } = useApp()
  const { styles, colors, accent, principale } = useEcranModerne('sarcelle')
  const groupe = voitToutLeGroupe(roleActif)
  const autorise = peutVoirEvenements(roleActif)
  const aujourdhui = aujourdhuiISO()

  const [donnees, setDonnees] = useState({ travailleurs: [], evenements: [] })
  const [restaurants, setRestaurants] = useState([])
  const [restoFiltre, setRestoFiltre] = useState('')
  const [filtre, setFiltre] = useState('tout')
  const [loading, setLoading] = useState(true)
  const [erreur, setErreur] = useState(false)
  const [ligneMessage, setLigneMessage] = useState(null)
  const [formulaire, setFormulaire] = useState({ visible: false, evenement: null })
  const [joursFeries, setJoursFeries] = useState(false)
  const [acces, setAcces] = useState({ droits: null, manque: false })
  const [dates, setDates] = useState({ donnees: null, manque: false })
  const [datesEnCours, setDatesEnCours] = useState(true)
  const [essai, setEssai] = useState(0)

  const charger = useCallback(async () => {
    if (!autorise) { setLoading(false); return }
    setErreur(false)
    try {
      setDonnees(await chargerDonneesEvenements({ groupe, restaurantId }))
    } catch {
      setErreur(true)
    } finally {
      setLoading(false)
    }
  }, [autorise, groupe, restaurantId])

  useEffect(() => { charger() }, [charger])
  // Rechargé à chaque retour sur l'écran : un chèque encaissé disparaît du fil.
  // Les droits d'abord (le reste s'affiche dès qu'ils sont connus), puis les dates.
  useFocusEffect(useCallback(() => {
    if (!autorise) return undefined
    let vivant = true
    setDatesEnCours(true)
    chargerDroitsCalendrier({ role: roleActif, userId })
      .then(async lus => {
        if (!vivant) return
        setAcces(lus)
        const r = await chargerDatesCalendrier({ role: roleActif, restaurantId, droits: lus.droits })
        if (vivant) setDates(r)
      })
      .catch(() => {
        // Droits inconnus : on ne montre que ce qu'un gérant sans aucun type verrait, jamais plus.
        if (!vivant) return
        setAcces(a => ({ manque: true, droits: a.droits || droitsDates('gerant', userId, [], { gerant: [] }) }))
        setDates(d => ({ ...d, manque: true }))
      })
      .finally(() => { if (vivant) setDatesEnCours(false) })
    return () => { vivant = false }
  }, [autorise, roleActif, userId, restaurantId, essai]))
  useEffect(() => { if (groupe) chargerRestaurants().then(setRestaurants).catch(() => {}) }, [groupe])

  const visibles = useMemo(() => dansRestaurant(donnees, groupe ? restoFiltre : null), [donnees, groupe, restoFiltre])
  const lignes = useMemo(() => {
    if (!acces.droits) return []
    const base = filtrerParDroits(construireLignes({ ...visibles, aujourdhui }), acces.droits)
    if (!dates.donnees) return base
    const autres = lignesDates(dates.donnees, { aujourdhui, droits: acces.droits, restaurantId: groupe ? restoFiltre : restaurantId, groupe })
    return fusionnerLignes(base, autres)
  }, [visibles, aujourdhui, acces.droits, dates.donnees, groupe, restoFiltre, restaurantId])
  const filtres = useMemo(() => FILTRES.filter(f => filtreVisible(f.cle, acces.droits)), [acces.droits])
  // Un filtre qui n'est plus proposé ne doit pas laisser un fil vide.
  useEffect(() => { if (!filtres.some(f => f.cle === filtre)) setFiltre('tout') }, [filtres, filtre])
  const fil = useMemo(() => construireFil(lignes, aujourdhui, filtre, { plusTard: groupe }), [lignes, aujourdhui, filtre, groupe])
  const sansNaissance = useMemo(() => nbSansNaissance(visibles.travailleurs), [visibles])

  const puccesRestos = useMemo(
    () => [{ cle: '', label: 'Tous les restaurants' }, ...restaurants.map(r => ({ cle: r.id, label: r.nom }))],
    [restaurants],
  )

  if (!autorise) {
    return (
      <SafeAreaView style={styles.container}>
        <EnTete titre="Événements" onRetour={() => router.back()} styles={styles} />
        <Vide icone="🔒" texte="Cet écran n'est pas disponible pour votre compte." styles={styles} />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.container}>
      <EnTete titre="Événements" sous="Anniversaires, ancienneté et calendrier" onRetour={() => router.back()} styles={styles} />
      {groupe ? <Puces ligne styles={styles} actif={restoFiltre} onChoisir={setRestoFiltre} elements={puccesRestos} /> : null}
      <Puces ligne styles={styles} actif={filtre} onChoisir={setFiltre} elements={filtres} />

      {loading || !acces.droits ? (
        <ActivityIndicator color={principale} style={{ marginTop: 40 }} />
      ) : erreur ? (
        <View style={styles.body}>
          <Vide icone="⚠️" texte="Les événements n'ont pas pu être chargés." sous="Vérifiez la connexion et réessayez." styles={styles} />
          <Bouton label="Réessayer" couleur={accent} styles={styles} onPress={() => { setLoading(true); charger() }} />
        </View>
      ) : (
        <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
          <View style={{ marginBottom: 12, gap: 8 }}>
            {acces.droits?.evenements && groupe ? (
              <Bouton label="➕ Ajouter un événement" variante="plein" couleur={principale} styles={styles}
                onPress={() => setFormulaire({ visible: true, evenement: null })} />
            ) : null}
            {acces.droits?.evenements ? (
              <Bouton label="🇨🇮 Jours fériés ivoiriens" couleur={principale} styles={styles} onPress={() => setJoursFeries(true)} />
            ) : null}
            {acces.droits?.proprietaire ? (
              <Bouton label="🔐 Accès au calendrier : qui voit quoi" couleur={principale} styles={styles} onPress={() => router.push('/acces-calendrier')} />
            ) : null}
            {groupe && acces.droits?.anniversaires && sansNaissance > 0 ? (
              <Text style={{ fontSize: 13, color: colors.textMuted }}>
                {sansNaissance} fiche{sansNaissance > 1 ? 's' : ''} sans date de naissance
              </Text>
            ) : null}
            {datesEnCours ? (
              <Text style={{ fontSize: 13, color: colors.textMuted }}>Chargement des dates…</Text>
            ) : acces.manque || dates.manque ? (
              <View style={{ gap: 6 }}>
                <Text style={{ fontSize: 13, color: colors.textMuted }}>Certaines dates n'ont pas pu être chargées.</Text>
                <Bouton label="Réessayer" couleur={accent} styles={styles} onPress={() => { setLoading(true); charger(); setEssai(e => e + 1) }} />
              </View>
            ) : null}
          </View>

          {fil.length === 0 ? (
            <Vide icone="🎉" texte="Rien de prévu pour le moment." styles={styles} />
          ) : fil.map(section => (
            <View key={section.cle}>
              <Text style={[styles.label, { marginTop: 8 }]}>{section.titre}</Text>
              {section.lignes.map(ligne => (ligne.type === 'date' ? (
                <LigneDate key={ligne.cle} ligne={ligne} aujourdhui={aujourdhui} styles={styles} colors={colors} />
              ) : (
                <LigneEvenement key={ligne.cle} ligne={ligne} aujourdhui={aujourdhui} voitAge={!!acces.droits?.age} peutGerer={groupe}
                  styles={styles} colors={colors} accent={accent}
                  onMessage={setLigneMessage}
                  onModifier={evenement => setFormulaire({ visible: true, evenement })} />
              )))}
            </View>
          ))}
          <View style={{ height: 30 }} />
        </ScrollView>
      )}

      <FeuilleMessage ligne={ligneMessage} styles={styles} colors={colors} onFermer={() => setLigneMessage(null)} />
      {groupe ? (
        <FeuilleEvenement visible={formulaire.visible} evenement={formulaire.evenement} restaurants={restaurants}
          ctx={{ userId: userId || null, userNom: userNom || null }} styles={styles} colors={colors} principale={principale}
          onFermer={() => setFormulaire({ visible: false, evenement: null })}
          onEnregistre={() => { setFormulaire({ visible: false, evenement: null }); charger() }} />
      ) : null}
      <FeuilleJoursFeries visible={joursFeries && !formulaire.visible} evenements={donnees.evenements} peutGerer={groupe}
        ctx={{ userId: userId || null, userNom: userNom || null }} styles={styles} colors={colors} principale={principale}
        onFermer={() => setJoursFeries(false)} onAjoute={charger}
        onModifier={evenement => setFormulaire({ visible: true, evenement })} />
    </SafeAreaView>
  )
}
