/*
 * Écran SUPERVISEUR — visites des restaurants.
 *
 * Accueil : la visite en cours (à reprendre), puis les restaurants avec leur
 * dernière visite, les tâches ouvertes et celles que le gérant dit faites.
 * Un restaurant ouvre sa fiche (note, tâches, visites) et « Commencer la
 * visite » (heure et position d'arrivée relevées). Une seule visite à la fois.
 *
 * Calculs : lib/supervision.js · données : lib/supervisionDb.js
 */
import { router } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, RefreshControl, SafeAreaView, ScrollView, Text, TouchableOpacity, View } from 'react-native'
import FicheRestaurant from '../components/supervision/FicheRestaurant'
import VisiteEnCours from '../components/supervision/VisiteEnCours'
import { SARCELLE, TONS, dateCourte, dateHeure } from '../components/supervision/Elements'
import { Bouton, useEcranModerne, Vide } from '../components/ui/EcranModerne'
import { useApp } from '../context/AppContext'
import { JOURS_SANS_VISITE_ALERTE, joursEntre, tacheOuverte } from '../lib/supervision'
import { chargerRestaurants, chargerTaches, chargerVisites, commencerVisite, visiteEnCours } from '../lib/supervisionDb'

const isoJour = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const ilYa = j => { const d = new Date(); d.setDate(d.getDate() - j); return isoJour(d) }

export default function SuperviseurScreen() {
  const { userId, userNom, deconnecter } = useApp() ?? {}
  const { styles, colors } = useEcranModerne('sarcelle')
  const [restaurants, setRestaurants] = useState([])
  const [visites, setVisites] = useState([])
  const [taches, setTaches] = useState([])
  const [enCours, setEnCours] = useState(null)
  const [charge, setCharge] = useState(false)
  const [erreur, setErreur] = useState(false)
  const [rafraichir, setRafraichir] = useState(false)
  const [resto, setResto] = useState(null)           // fiche ouverte
  const [demarrage, setDemarrage] = useState(false)

  const charger = useCallback(async () => {
    try {
      setErreur(false)
      const [r, v, t, ec] = await Promise.all([
        chargerRestaurants(), chargerVisites({ depuis: ilYa(120) }), chargerTaches({ ouvertesSeulement: true }),
        userId ? visiteEnCours(userId) : null,
      ])
      setRestaurants(r); setVisites(v); setTaches(t); setEnCours(ec)
    } catch { setErreur(true) } finally { setCharge(true) }
  }, [userId])
  useEffect(() => { charger() }, [charger])

  // Contexte perdu (rechargement de page) → retour à la connexion
  useEffect(() => {
    if (userId) return
    const t = setTimeout(() => router.replace('/login'), 800)
    return () => clearTimeout(t)
  }, [userId])

  const aujourdhui = isoJour()
  const lignes = useMemo(() => restaurants.map(r => {
    const derniere = visites.find(v => v.restaurant_id === r.id)
    const jours = derniere ? joursEntre(derniere.fin_at || derniere.debut_at, aujourdhui) : null
    const siennes = taches.filter(t => t.restaurant_id === r.id && tacheOuverte(t))
    return {
      r, derniere, jours,
      aVisiter: jours === null || jours > JOURS_SANS_VISITE_ALERTE,
      ouvertes: siennes.length,
      aConfirmer: siennes.filter(t => t.statut === 'signalee').length,
      enRetard: siennes.filter(t => t.statut === 'a_faire' && t.echeance && t.echeance < aujourdhui).length,
    }
  }).sort((a, b) => (b.jours ?? 9999) - (a.jours ?? 9999)), [restaurants, visites, taches, aujourdhui])

  async function commencer(r) {
    if (enCours) { Alert.alert('Visite en cours', `Terminez d'abord la visite de ${restaurants.find(x => x.id === enCours.restaurant_id)?.nom || 'l\'autre restaurant'}.`); return }
    setDemarrage(true)
    try {
      const v = await commencerVisite({ restaurant: r, userId, userNom })
      setEnCours(v); setResto(null)
    } catch { Alert.alert('Pas de réseau', 'La visite n\'a pas pu commencer. Vérifiez la connexion et réessayez.') }
    finally { setDemarrage(false) }
  }

  const restoEnCours = enCours ? restaurants.find(r => r.id === enCours.restaurant_id) : null

  // ── Visite en cours ──
  if (enCours && restoEnCours) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <View style={{ width: 60 }} />
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitre}>Visite · {restoEnCours.nom}</Text>
            <Text style={styles.headerSub}>Commencée le {dateHeure(enCours.debut_at)}</Text>
          </View>
          <View style={{ width: 60 }} />
        </View>
        <VisiteEnCours visite={enCours} restaurant={restoEnCours} userId={userId} userNom={userNom}
          onFinie={() => { setEnCours(null); charger() }} styles={styles} colors={colors} />
      </SafeAreaView>
    )
  }

  // ── Fiche d'un restaurant ──
  if (resto) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => { setResto(null); charger() }} hitSlop={10}><Text style={styles.back}>‹ Retour</Text></TouchableOpacity>
          <View style={{ flex: 1, paddingHorizontal: 8 }}><Text style={styles.headerTitre}>{resto.nom}</Text></View>
          <View style={{ width: 60 }} />
        </View>
        {demarrage ? <ActivityIndicator color={SARCELLE} style={{ marginTop: 10 }} /> : null}
        <FicheRestaurant restaurant={resto} role="superviseur" userId={userId} userNom={userNom}
          onCommencer={demarrage ? null : () => commencer(resto)} styles={styles} colors={colors} />
      </SafeAreaView>
    )
  }

  // ── Accueil ──
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={{ width: 60 }} />
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitre}>Supervision</Text>
          <Text style={styles.headerSub}>{userNom || 'Superviseur'}</Text>
        </View>
        <TouchableOpacity onPress={() => { deconnecter?.(); router.replace('/login') }} hitSlop={10} style={{ width: 60, alignItems: 'flex-end' }}>
          <Text style={[styles.back, { width: 'auto', fontSize: 13 }]}>Quitter</Text>
        </TouchableOpacity>
      </View>
      <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={rafraichir} onRefresh={async () => { setRafraichir(true); await charger(); setRafraichir(false) }} />}>
        {!charge ? <ActivityIndicator color={SARCELLE} style={{ marginTop: 40 }} /> : null}
        {charge && erreur ? (
          <>
            <Vide icone="📡" texte="Lecture impossible" sous="Vérifiez le réseau." styles={styles} />
            <Bouton label="Réessayer" onPress={charger} couleur={SARCELLE} styles={styles} />
          </>
        ) : null}
        {enCours && !restoEnCours && charge ? (
          <Text style={[styles.carteSous, { color: TONS.orange }]}>Une visite en cours porte sur un restaurant introuvable.</Text>
        ) : null}
        {charge && !erreur ? (
          <>
            <Text style={styles.resultat}>Restaurants · les moins visités d'abord</Text>
            {lignes.map(({ r, derniere, jours, aVisiter, ouvertes, aConfirmer, enRetard }) => (
              <TouchableOpacity key={r.id} onPress={() => setResto(r)} activeOpacity={0.8} style={[styles.carte, aVisiter && styles.carteAlerte]}>
                <View style={styles.carteTop}>
                  <View style={[styles.bulle, { backgroundColor: (aVisiter ? TONS.orange : SARCELLE) + '1C' }]}>
                    <Text style={styles.bulleTxt}>{aVisiter ? '📍' : '🧭'}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.carteTitre}>{r.nom}</Text>
                    <Text style={[styles.carteSous, aVisiter && { color: TONS.orange, fontWeight: '700' }]}>
                      {jours === null ? 'Jamais visité' : jours === 0 ? "Visité aujourd'hui" : `Dernière visite le ${dateCourte(derniere.debut_at)} (il y a ${jours} j)`}
                    </Text>
                    <Text style={styles.carteSous}>
                      {ouvertes ? `${ouvertes} tâche${ouvertes > 1 ? 's' : ''} ouverte${ouvertes > 1 ? 's' : ''}` : 'Aucune tâche ouverte'}
                      {aConfirmer ? ` · 📸 ${aConfirmer} à confirmer` : ''}
                      {enRetard ? ` · ⚠️ ${enRetard} en retard` : ''}
                    </Text>
                  </View>
                  <Text style={{ fontSize: 20, color: colors.textMuted }}>›</Text>
                </View>
              </TouchableOpacity>
            ))}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}
