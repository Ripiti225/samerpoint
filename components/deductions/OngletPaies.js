// Onglet Paies des déductions gérant : travailleur + montant payé.
import { Text, TouchableOpacity, View } from 'react-native'
import { BoutonSecondaire, Carte, Champ, Vide, useStyleChaleureux } from '../ui/StyleChaleureux'

export default function OngletPaies({ paies, choisirTravailleur, majMontant, supprimer, ajouter }) {
  const { p, styles } = useStyleChaleureux()
  return (
    <>
      {paies.length === 0 ? <Vide texte="Aucune paie saisie aujourd'hui" /> : null}
      {paies.map((ligne, i) => (
        <Carte key={ligne.id || i}>
          <View style={[styles.ligneChamps, { alignItems: 'center' }]}>
            <TouchableOpacity style={[{ flex: 2 }, styles.ligne]} onPress={() => choisirTravailleur(i)}
              accessibilityRole="button" accessibilityLabel={ligne.travailleur_nom || 'Choisir un travailleur'}>
              <Text style={[styles.carteTitre, !ligne.travailleur_nom && { color: p.texteVide, fontWeight: '500' }]} numberOfLines={1}>
                {ligne.travailleur_nom || '👤 Choisir un travailleur…'}
              </Text>
              <Text style={{ color: p.accent, fontSize: 18 }}>›</Text>
            </TouchableOpacity>
            <Champ style={{ flex: 1 }} keyboardType="numeric" placeholder="Montant" value={ligne.montant || ''} onChangeText={v => majMontant(i, v)} />
            <TouchableOpacity onPress={() => supprimer(i)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Supprimer la paie">
              <Text style={styles.supprimer}>✕</Text>
            </TouchableOpacity>
          </View>
        </Carte>
      ))}
      <BoutonSecondaire label="+ Ajouter une paie" onPress={ajouter} />
    </>
  )
}
