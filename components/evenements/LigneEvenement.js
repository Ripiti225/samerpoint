import { Text, TouchableOpacity, View } from 'react-native'

import { libelleJour, texteAnnees } from '../../lib/evenements'
import Avatar from '../equipe/Avatar'
import { Bouton } from '../ui/EcranModerne'

function libelle(ligne, voitAge) {
  if (ligne.type === 'anniversaire') return `🎂 Anniversaire${voitAge ? ` · ${texteAnnees(ligne.age)}` : ''}`
  if (ligne.type === 'anciennete') return `🏅 ${texteAnnees(ligne.annees)} chez nous`
  return ligne.evenement.chaque_annee ? '📅 Chaque année' : '📅 Événement'
}

export default function LigneEvenement({ ligne, aujourdhui, voitAge, peutGerer, styles, colors, accent, onMessage, onModifier }) {
  const jour = libelleJour(ligne.date, aujourdhui)

  if (ligne.type === 'calendrier') {
    const e = ligne.evenement
    const contenu = (
      <>
        <Text style={{ fontSize: 15, fontWeight: '800', color: colors.text }}>{e.titre}</Text>
        <Text style={{ fontSize: 13, color: colors.textMuted, marginTop: 2 }}>{libelle(ligne)} · {e.restaurants?.nom || 'Tout le groupe'} · {jour}</Text>
        {e.note ? <Text style={{ fontSize: 13, color: colors.text, marginTop: 6 }}>{e.note}</Text> : null}
      </>
    )
    return peutGerer
      ? <TouchableOpacity style={styles.carte} onPress={() => onModifier(e)} activeOpacity={0.8}>{contenu}</TouchableOpacity>
      : <View style={styles.carte}>{contenu}</View>
  }

  const t = ligne.travailleur
  return (
    <View style={styles.carte}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Avatar nom={t.nom} photo={t.photo_url} resto={t.restaurants} taille={44} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 15, fontWeight: '800', color: colors.text }} numberOfLines={1}>{t.nom}</Text>
          <Text style={{ fontSize: 13, color: colors.textMuted, marginTop: 2 }} numberOfLines={1}>
            {t.restaurants?.nom || 'Sans restaurant'} · {jour}
          </Text>
          <Text style={{ fontSize: 13, fontWeight: '700', color: accent, marginTop: 2 }}>{libelle(ligne, voitAge)}</Text>
        </View>
      </View>
      <View style={{ marginTop: 10 }}>
        <Bouton label="💬 Envoyer un message" couleur={accent} styles={styles} onPress={() => onMessage(ligne)} />
      </View>
    </View>
  )
}
