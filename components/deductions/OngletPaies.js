// Onglet Paies des déductions gérant : travailleur + montant payé.
import { Text, TouchableOpacity, View } from 'react-native'
import { BoutonSecondaire, Carte, Champ, Etiquette, Vide, useStyleChaleureux } from '../ui/StyleChaleureux'

// presenceDe : (travailleurId) => { etiquette, ton, detail } ; null tant que les présences ne sont pas lues.
export default function OngletPaies({ paies, presenceDe, choisirTravailleur, majMontant, supprimer, ajouter }) {
  const { p, styles } = useStyleChaleureux()
  return (
    <>
      {paies.length === 0 ? <Vide texte="Aucune paie saisie aujourd'hui" /> : null}
      {paies.map((ligne, i) => {
        const presence = ligne.travailleur_id && presenceDe ? presenceDe(ligne.travailleur_id) : null
        return (
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
          {presence ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              <Etiquette ton={presence.ton} texte={presence.etiquette} />
              {presence.detail ? <Text style={styles.choixSous}>{presence.detail}</Text> : null}
            </View>
          ) : null}
        </Carte>
        )
      })}
      <BoutonSecondaire label="+ Ajouter une paie" onPress={ajouter} />
    </>
  )
}
