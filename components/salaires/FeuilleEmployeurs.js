// En-tête des bulletins : l'employeur de chaque marque (manager).
import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, View } from 'react-native'

import { Bouton, Champ, Feuille, Libelle, Puces, useEcranModerne } from '../ui/EcranModerne'
import { chargerEmployeurs, enregistrerEmployeur } from '../../lib/paieDb'

// À la Braise : pas de bulletins (lib/paieDb.js, restoAvecPaie).
const MARQUES = [['samer', 'Chez Samer'], ['alkayan', 'Al Kayan']]
const CHAMPS = [
  ['raison_sociale', 'Raison sociale'], ['adresse', 'Adresse (BP)'], ['ville', 'Ville, commune'],
  ['numero_cnps', 'N° CNPS employeur'], ['numero_contribuable', 'N° compte contribuable'],
  ['responsable', 'Responsable administratif'], ['telephone', 'Téléphone'],
]

// Taux stocké en pour dix mille (300 = 3 %), affiché en pourcentage.
const atPourcent = e => (e.taux_accident_travail ? String(e.taux_accident_travail / 100).replace('.', ',') : '')

export default function FeuilleEmployeurs({ visible, ctx, onFermer }) {
  const { styles, colors, accent } = useEcranModerne('orange')
  const [tous, setTous] = useState(null)
  const [marque, setMarque] = useState('samer')
  const [occupe, setOccupe] = useState(false)

  useEffect(() => {
    if (!visible) return
    setTous(null)
    chargerEmployeurs().then(setTous).catch(e => { Alert.alert('Employeurs', e.message); onFermer() })
  }, [visible])

  const e = tous?.[marque] || {}
  const changer = (c, v) => setTous(t => ({ ...t, [marque]: { ...(t?.[marque] || {}), [c]: v } }))

  async function enregistrer() {
    setOccupe(true)
    try {
      const champs = Object.fromEntries(CHAMPS.map(([c]) => [c, String(e[c] || '').trim() || null]))
      const at = parseFloat(String(e.at_saisi ?? atPourcent(e)).replace(',', '.'))
      champs.taux_accident_travail = at > 0 ? Math.round(at * 100) : null
      await enregistrerEmployeur(marque, champs, ctx)
      Alert.alert('Employeurs', 'Enregistré. Les prochains états préparés utiliseront ces informations.')
    } catch (err) {
      Alert.alert('Employeurs', err.message)
    } finally {
      setOccupe(false)
    }
  }

  return (
    <Feuille visible={visible} styles={styles} onFermer={onFermer} titre="Employeurs" sous="En-tête des bulletins de paie">
      {!tous ? <ActivityIndicator color={accent} /> : (
        <>
          <Puces styles={styles} actif={marque} onChoisir={setMarque} elements={MARQUES.map(([cle, label]) => ({ cle, label }))} />
          {CHAMPS.map(([c, label]) => (
            <View key={c} style={{ marginTop: 6 }}>
              <Libelle styles={styles}>{label}</Libelle>
              <Champ styles={styles} colors={colors} value={e[c] || ''} onChangeText={v => changer(c, v)} />
            </View>
          ))}
          <View style={{ marginTop: 6 }}>
            <Libelle styles={styles}>Accident du travail (%) — vide = 2 %</Libelle>
            <Champ styles={styles} colors={colors} keyboardType="decimal-pad" value={e.at_saisi ?? atPourcent(e)} onChangeText={v => changer('at_saisi', v)} />
          </View>
          <Bouton styles={styles} grand couleur={accent} variante="plein" disabled={occupe} label="Enregistrer" onPress={enregistrer} />
        </>
      )}
    </Feuille>
  )
}
