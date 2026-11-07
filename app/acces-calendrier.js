// ──────────────────────────────────────────────────────────────────────────────
// Accès au calendrier : qui voit quoi, par rôle. Réservé au propriétaire de la
// Trésorerie. Garde-fous dans lib/accesCalendrier.js.
// ──────────────────────────────────────────────────────────────────────────────
import { router } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Alert, SafeAreaView, ScrollView, Switch, Text, View } from 'react-native'

import { Bouton, EnTete, Libelle, Puces, Vide, useEcranModerne } from '../components/ui/EcranModerne'
import { useApp } from '../context/AppContext'
import { ROLES_CALENDRIER, TYPES_CALENDRIER, basculerType, estVerrouille, typesAutorises } from '../lib/accesCalendrier'
import { chargerAccesCalendrier, chargerDroitsCalendrier, enregistrerAccesCalendrier } from '../lib/evenementsDb'

const FAMILLES = ['Personnel', 'Calendrier', 'Trésorerie']

export default function AccesCalendrierScreen() {
  const { roleActif, userId, userNom } = useApp()
  const { styles, colors, principale, accent } = useEcranModerne('sarcelle')
  // Quatre états : 'chargement', 'erreur' (lecture impossible), 'refuse', 'pret'.
  const [etat, setEtat] = useState('chargement')
  const [config, setConfig] = useState({})
  const [role, setRole] = useState('rh')

  const charger = useCallback(() => {
    let vivant = true
    setEtat('chargement')
    Promise.all([chargerDroitsCalendrier({ role: roleActif, userId }), chargerAccesCalendrier()])
      .then(([{ droits, manque }, c]) => {
        if (!vivant) return
        if (manque || c.erreur) { setEtat('erreur'); return }
        setConfig(c.config)
        setEtat(droits.proprietaire ? 'pret' : 'refuse')
      })
      .catch(() => { if (vivant) setEtat('erreur') })
    return () => { vivant = false }
  }, [roleActif, userId])

  useEffect(() => charger(), [charger])

  const types = typesAutorises(role, { config })

  async function basculer(cle) {
    const avant = config
    const suivants = basculerType(types, cle)
    setConfig({ ...config, [role]: suivants })
    try {
      await enregistrerAccesCalendrier(role, suivants, { userId: userId || null, userNom: userNom || null })
    } catch {
      setConfig(avant)
      Alert.alert('Accès au calendrier', "Le réglage n'a pas pu être enregistré. Réessayez.")
    }
  }

  if (etat === 'chargement') {
    return (
      <SafeAreaView style={styles.container}>
        <EnTete titre="Accès au calendrier" onRetour={() => router.back()} styles={styles} />
        <ActivityIndicator color={principale} style={{ marginTop: 40 }} />
      </SafeAreaView>
    )
  }

  if (etat === 'erreur') {
    return (
      <SafeAreaView style={styles.container}>
        <EnTete titre="Accès au calendrier" onRetour={() => router.back()} styles={styles} />
        <View style={styles.body}>
          <Vide icone="⚠️" texte="Les réglages n'ont pas pu être chargés. Vérifiez la connexion." styles={styles} />
          <Bouton label="Réessayer" couleur={accent} styles={styles} onPress={charger} />
        </View>
      </SafeAreaView>
    )
  }

  if (etat === 'refuse') {
    return (
      <SafeAreaView style={styles.container}>
        <EnTete titre="Accès au calendrier" onRetour={() => router.back()} styles={styles} />
        <Vide icone="🔒" texte="Seul le propriétaire peut modifier ces réglages." styles={styles} />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.container}>
      <EnTete titre="Accès au calendrier" sous="Qui voit quoi, par rôle" onRetour={() => router.back()} styles={styles} />
      <Puces ligne styles={styles} actif={role} onChoisir={setRole} elements={ROLES_CALENDRIER.map(r => ({ cle: r.cle, label: r.label }))} />
      <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
        <Text style={{ fontSize: 13, color: colors.textMuted, marginBottom: 12 }}>
          Le propriétaire voit toujours tout. {role === 'gerant' ? 'Le gérant reste limité à son restaurant, quoi que vous cochiez.' : 'Ouvrir un écran de la Trésorerie reste soumis aux droits de la Trésorerie.'}
        </Text>
        {FAMILLES.map(famille => (
          <View key={famille}>
            <Libelle styles={styles}>{famille}</Libelle>
            {TYPES_CALENDRIER.filter(t => t.famille === famille).map(t => {
              const verrou = estVerrouille(role, t.cle)
              return (
                <View key={t.cle} style={[styles.carte, { flexDirection: 'row', alignItems: 'center', gap: 10 }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: colors.text }}>{t.label}</Text>
                    {verrou ? <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>🔒 Jamais pour le gérant</Text> : null}
                  </View>
                  <Switch value={types.includes(t.cle)} disabled={verrou} onValueChange={() => basculer(t.cle)} />
                </View>
              )
            })}
          </View>
        ))}
        <View style={{ height: 30 }} />
      </ScrollView>
    </SafeAreaView>
  )
}
