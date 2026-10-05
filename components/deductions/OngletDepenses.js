// Onglet Dépenses des déductions gérant : les 4 catégories, lignes description / montant.
import { Text, TouchableOpacity, View } from 'react-native'
import { CATEGORIES_DEPENSES } from '../../lib/constants'
import { BoutonSecondaire, Carte, Champ, Rubrique, useStyleChaleureux } from '../ui/StyleChaleureux'

const EMOJIS = ['🛒', '🥦', '🍊', '📦']

export default function OngletDepenses({ depenses, ajouter, supprimer, maj, fmt }) {
  const { p, styles } = useStyleChaleureux()
  return (
    <>
      {CATEGORIES_DEPENSES.map((cat, k) => {
        const lignes = depenses[cat] || []
        const total = lignes.reduce((s, l) => s + (parseFloat(l.montant) || 0), 0)
        return (
          <View key={cat} style={{ marginBottom: 6 }}>
            <View style={styles.ligne}>
              <Rubrique>{EMOJIS[k]} {cat}</Rubrique>
              {total > 0 ? <Text style={[styles.petitFort, { color: p.accent }]}>{fmt(total)}</Text> : null}
            </View>
            {lignes.map((ligne, i) => (
              <Carte key={ligne.id || i}>
                <View style={[styles.ligneChamps, { alignItems: 'center' }]}>
                  <Champ style={{ flex: 2 }} value={ligne.description || ''} onChangeText={v => maj(cat, i, 'description', v)} placeholder="Description" />
                  <Champ style={{ flex: 1 }} keyboardType="numeric" value={ligne.montant || ''} onChangeText={v => maj(cat, i, 'montant', v)} placeholder="Montant" />
                  <TouchableOpacity onPress={() => supprimer(cat, i)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Supprimer la ligne">
                    <Text style={styles.supprimer}>✕</Text>
                  </TouchableOpacity>
                </View>
              </Carte>
            ))}
            <BoutonSecondaire label={`+ Ajouter (${cat})`} onPress={() => ajouter(cat)} />
          </View>
        )
      })}
    </>
  )
}
