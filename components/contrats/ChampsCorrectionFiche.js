// Champs que la RH peut corriger ou compléter sur une fiche envoyée par un gérant.
import { Text, View } from 'react-native'

import ChampDate from '../ChampDate'
import { Champ, Libelle, Puces } from '../ui/EcranModerne'
import { aujourdhuiISO } from '../../lib/contrats'
import { correctionComplete } from '../../lib/miseAJourFiches'
import { CIVILITES, SITUATIONS_FAMILLE } from '../../lib/recrutement'

export default function ChampsCorrectionFiche({ form, setForm, styles, colors }) {
  const maj = (cle, v) => setForm(p => ({ ...p, [cle]: v }))
  const texte = (cle, label, props = {}) => (
    <View key={cle}>
      <Libelle styles={styles}>{label}</Libelle>
      <Champ styles={styles} colors={colors} value={form[cle] || ''} onChangeText={v => maj(cle, v)} {...props} />
    </View>
  )
  const puces = (cle, label, elements) => (
    <View key={cle}>
      <Libelle styles={styles}>{label}</Libelle>
      {/* Toucher le choix actif l'efface. */}
      <Puces petit styles={styles} actif={form[cle] || null} onChoisir={v => maj(cle, form[cle] === v ? '' : v)}
        elements={elements.map(e => ({ cle: e, label: e }))} />
    </View>
  )
  return (
    <View style={{ marginTop: 8 }}>
      {puces('civilite', 'Civilité', CIVILITES)}
      {texte('nom_famille', 'Nom de famille *', { autoCapitalize: 'characters', placeholder: 'Ex. GBADIE' })}
      {texte('prenoms', 'Prénoms *', { placeholder: 'Ex. Gogre Tanguy' })}
      {!correctionComplete(form) && (
        <Text style={{ color: '#C2462B', fontWeight: '700', marginBottom: 8 }}>Le nom de famille et les prénoms sont obligatoires.</Text>
      )}
      <View style={{ marginBottom: 12 }}>
        <ChampDate label="Date de naissance" valeur={form.date_naissance || ''} onChange={v => maj('date_naissance', v)}
          maxDate={aujourdhuiISO()} naissance effacable />
      </View>
      {texte('lieu_naissance', 'Lieu de naissance', { placeholder: 'Ex. Yopougon' })}
      {texte('nationalite', 'Nationalité', { placeholder: 'Ex. Ivoirienne' })}
      {puces('situation_famille', 'Situation de famille', SITUATIONS_FAMILLE)}
      {texte('cni_numero', "N° de carte d'identité (CNI)", { autoCapitalize: 'characters', placeholder: 'Ex. CI007879705' })}
      {texte('nni_numero', 'NNI', { keyboardType: 'number-pad', placeholder: 'Ex. 11919240401' })}
      {texte('lieu_residence', 'Lieu de résidence', { placeholder: 'Ex. Yopougon' })}
      {texte('contact', 'Téléphone', { keyboardType: 'phone-pad', placeholder: 'Ex. 07 00 00 00 00' })}
      <View style={{ marginBottom: 12 }}>
        <ChampDate label="Date d'embauche" valeur={form.date_embauche || ''} onChange={v => maj('date_embauche', v)} effacable />
      </View>
    </View>
  )
}
