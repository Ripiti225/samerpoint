// ──────────────────────────────────────────────────────────────────────────────
// Choix du travailleur à qui attribuer un contrat.
//
// Recherche par nom et filtre par restaurant : avec sept points de vente et une
// centaine de fiches, une simple liste déroulante ne suffit pas.
// ──────────────────────────────────────────────────────────────────────────────
import { useState } from 'react'
import { Text, TextInput, TouchableOpacity, View } from 'react-native'

import Avatar from './equipe/Avatar'
import { Feuille, Puces, useEcranModerne } from './ui/EcranModerne'

const sansAccents = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

export default function SelecteurTravailleur({ visible, travailleurs, restaurants, onFermer, onChoisir }) {
  const { styles, colors, accent } = useEcranModerne('orange')
  const [recherche, setRecherche] = useState('')
  const [filtreResto, setFiltreResto] = useState('tous')

  const q = sansAccents(recherche).trim()
  const liste = (travailleurs || []).filter(t =>
    (!q || sansAccents(t.nom).includes(q)) && (filtreResto === 'tous' || t.restaurant_id === filtreResto))

  return (
    <Feuille visible={visible} titre="Quel travailleur ?" sous="Pour qui enregistrer le contrat" onFermer={onFermer} styles={styles}>
      <TextInput style={[styles.input, { marginBottom: 10 }]} placeholder="🔍 Rechercher un nom…" value={recherche}
        onChangeText={setRecherche} placeholderTextColor={colors.textPlaceholder} />
      <Puces styles={styles} petit actif={filtreResto} onChoisir={setFiltreResto}
        elements={[{ cle: 'tous', label: 'Tous' }, ...(restaurants || []).map(r => ({ cle: r.id, label: r.nom }))]} />

      {liste.length === 0 && (
        <Text style={[styles.infoTxt, { textAlign: 'center', paddingVertical: 30 }]}>Aucun travailleur ne correspond.</Text>
      )}
      {liste.map(t => (
        <TouchableOpacity key={t.id} onPress={() => onChoisir(t)} activeOpacity={0.75}
          style={[styles.carte, { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8, padding: 12 }]}>
          <Avatar nom={t.nom} photo={t.photo_url} resto={t.restaurants} taille={40} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.carteTitre, { fontSize: 14.5 }]}>{t.nom}</Text>
            <Text style={styles.carteSous}>{t.restaurants?.nom || 'Sans restaurant'} · {t.poste || 'Sans poste'}</Text>
          </View>
          <Text style={{ color: accent, fontSize: 20, fontWeight: '700' }}>›</Text>
        </TouchableOpacity>
      ))}
    </Feuille>
  )
}
