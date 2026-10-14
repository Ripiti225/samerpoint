// ──────────────────────────────────────────────────────────────────────────────
// Contrat signé chez le gérant — la RH vérifie puis marque « Signé ».
//
// Signé à l'appareil : on revoit le contrat avec la signature, et le PDF
// enregistré s'ouvre d'un geste. Signé sur papier : la photo du papier.
// Ce n'est qu'après « Signé » que le contrat compte (jauge, alertes de fin).
// ──────────────────────────────────────────────────────────────────────────────
import { useState } from 'react'
import { ActivityIndicator, Alert, Image, Linking, Text, TouchableOpacity, View } from 'react-native'

import ApercuContrat from './ApercuContrat'
import { Bouton, Feuille, Info, useEcranModerne } from '../ui/EcranModerne'
import { formatFR } from '../../lib/contrats'
import { marquerSigne } from '../../lib/contratsSignesDb'

export default function FeuilleVerification({ visible, contrat, travailleurNom, ctx, onFermer, onValide }) {
  const { styles, colors, accent } = useEcranModerne('orange')
  const [occupe, setOccupe] = useState(false)
  if (!contrat) return null

  async function valider() {
    setOccupe(true)
    try {
      await marquerSigne(contrat, ctx, travailleurNom)
      onValide?.()
    } catch (e) {
      Alert.alert('Validation impossible', e.message)
    } finally {
      setOccupe(false)
    }
  }

  const quand = contrat.signe_le ? formatFR(String(contrat.signe_le).slice(0, 10)) : ''
  return (
    <Feuille visible={visible} styles={styles} onFermer={onFermer} titre={`${contrat.type} · ${travailleurNom || ''}`}
      sous={`Signé le ${quand}${contrat.presente_par_nom ? ` · présenté par ${contrat.presente_par_nom}` : ''}`}>
      {contrat.pdf_signe_url ? (
        <>
          <TouchableOpacity onPress={() => Linking.openURL(contrat.pdf_signe_url)}>
            <Info icone="📄" styles={styles} couleur={accent} gras>Ouvrir le PDF signé</Info>
          </TouchableOpacity>
          <View style={{ height: 8 }} />
          <ApercuContrat donnees={contrat.donnees} signature={contrat.signature_traits} />
        </>
      ) : (
        <>
          <Info icone="📷" styles={styles}>Signé sur papier : vérifie la photo (signature, « Lu et approuvé », toutes les pages).</Info>
          <TouchableOpacity onPress={() => Linking.openURL(contrat.papier_signe_url)}>
            <Image source={{ uri: contrat.papier_signe_url }} resizeMode="contain"
              style={{ width: '100%', height: 420, borderRadius: 12, backgroundColor: colors.surfaceAlt, marginTop: 8 }} />
          </TouchableOpacity>
        </>
      )}
      <View style={{ height: 14 }} />
      {occupe
        ? <ActivityIndicator size="large" color={accent} />
        : <Bouton grand styles={styles} couleur="#3B8D2F" variante="plein" label="✅ Marquer signé" onPress={valider} />}
      <Text style={[styles.infoTxt, { flex: 0, marginTop: 8, textAlign: 'center' }]}>
        Le contrat entre alors dans les contrats du travailleur (jauge, alertes de fin).
      </Text>
    </Feuille>
  )
}
