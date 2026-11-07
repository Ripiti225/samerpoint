// Jours fériés ivoiriens : choisir l'année, les ajouter (direction, RH),
// corriger une fête, télécharger le fichier pour le calendrier du téléphone.
import { useMemo, useState } from 'react'
import { Alert, Text, TouchableOpacity, View } from 'react-native'

import { aujourdhuiISO } from '../../lib/contrats'
import { libelleJour } from '../../lib/evenements'
import { ajouterJoursFeries } from '../../lib/evenementsDb'
import { enregistrer } from '../../lib/exportRapportMensuel'
import { ANNEES_FERIES, fichierIcs, listeDeLAnnee, nomFichierIcs, texteVersBase64 } from '../../lib/joursFeries'
import { Bouton, Feuille, Libelle, Puces } from '../ui/EcranModerne'

export default function FeuilleJoursFeries({ visible, evenements, peutGerer, ctx, styles, colors, principale, onFermer, onAjoute, onModifier }) {
  const aujourdhui = aujourdhuiISO()
  const premiere = ANNEES_FERIES.find(a => a >= Number(aujourdhui.slice(0, 4)) + 1) || ANNEES_FERIES[0]
  const [annee, setAnnee] = useState(premiere)
  const [occupe, setOccupe] = useState(false)

  const liste = useMemo(() => listeDeLAnnee(annee, evenements), [annee, evenements])
  const dejaAjoutee = liste.some(f => f.evenement)

  async function ajouter() {
    setOccupe(true)
    try {
      const nombre = await ajouterJoursFeries(annee, ctx)
      Alert.alert('Jours fériés', nombre ? `${nombre} jours fériés ajoutés pour ${annee}.` : `Les jours fériés de ${annee} sont déjà ajoutés.`)
      onAjoute()
    } catch {
      Alert.alert('Jours fériés', "Les jours fériés n'ont pas pu être ajoutés. Réessayez.")
    } finally {
      setOccupe(false)
    }
  }

  async function telecharger() {
    try {
      const base64 = texteVersBase64(fichierIcs(liste, new Date().toISOString()))
      await enregistrer(nomFichierIcs(annee), { base64 }, 'text/calendar')
    } catch {
      Alert.alert('Téléchargement', "Le fichier n'a pas pu être téléchargé. Réessayez.")
    }
  }

  return (
    <Feuille visible={visible} titre="🇨🇮 Jours fériés ivoiriens" onFermer={onFermer} styles={styles}>
      <Libelle styles={styles}>Année</Libelle>
      <Puces styles={styles} actif={annee} onChoisir={setAnnee} elements={ANNEES_FERIES.map(a => ({ cle: a, label: String(a) }))} />

      <View style={{ gap: 8, marginBottom: 12 }}>
        {peutGerer ? (
          <Bouton label={occupe ? 'Ajout…' : `➕ Ajouter les jours fériés de ${annee}`} variante="plein" couleur={principale} styles={styles} disabled={occupe} onPress={ajouter} />
        ) : null}
        <Bouton label="📥 Télécharger le calendrier" couleur={principale} styles={styles} onPress={telecharger} />
        <Text style={{ fontSize: 12, color: colors.textMuted }}>
          Ce fichier ne se met pas à jour tout seul. Si une date change, téléchargez-le à nouveau.
        </Text>
      </View>

      {liste.map(f => {
        const contenu = (
          <>
            <Text style={{ fontSize: 14, fontWeight: '700', color: colors.text }}>{f.titre}</Text>
            <Text style={{ fontSize: 13, color: colors.textMuted, marginTop: 2 }}>
              {libelleJour(f.date, aujourdhui)}{f.date.slice(0, 4) !== String(aujourdhui.slice(0, 4)) ? ` ${f.date.slice(0, 4)}` : ''}{f.estimee ? ' · date estimée' : ''}
            </Text>
          </>
        )
        return peutGerer && f.evenement
          ? <TouchableOpacity key={f.cle} style={styles.carte} activeOpacity={0.8} onPress={() => onModifier(f.evenement)}>{contenu}</TouchableOpacity>
          : <View key={f.cle} style={styles.carte}>{contenu}</View>
      })}
      {peutGerer && !dejaAjoutee ? (
        <Text style={{ fontSize: 12, color: colors.textMuted }}>Ajoutez les jours fériés pour pouvoir corriger une date ou recevoir les alertes.</Text>
      ) : null}
    </Feuille>
  )
}
