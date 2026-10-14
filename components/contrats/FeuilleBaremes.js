// ──────────────────────────────────────────────────────────────────────────────
// Barème des postes : les montants proposés d'office à chaque contrat.
// Une ligne par poste et par famille (stage / CDD-CDI). Ajout et correction ici,
// ou d'un « Oui » au moment de générer un contrat aux montants différents.
// ──────────────────────────────────────────────────────────────────────────────
import { useState } from 'react'
import { Alert, Text, TouchableOpacity, View } from 'react-native'

import { Bouton, Champ, Feuille, Libelle, Puces, Vide, useEcranModerne } from '../ui/EcranModerne'
import { montantsDepuisBareme } from '../../lib/baremes'
import { enregistrerBareme, supprimerBareme } from '../../lib/contratsSignesDb'
import { montantFCFA } from '../../lib/modelesContrat'

const VIDE = { poste: '', type: 'CDD', categorie: '', salaire_categoriel: '', prime_tenue: '', indemnite_transport: '', prime_journaliere: '' }

export default function FeuilleBaremes({ visible, baremes, onFermer, onChange }) {
  const { styles, colors, accent, principale } = useEcranModerne('orange')
  const [edition, setEdition] = useState(null)

  function editer(b) {
    const type = b.famille === 'stage' ? 'Stage' : 'CDD'
    const m = montantsDepuisBareme(b, type)
    setEdition({ ...VIDE, ...Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v ?? ''])), poste: b.poste, type })
  }

  async function enregistrer() {
    if (!edition.poste.trim()) { Alert.alert('Poste manquant', 'Indique le poste.'); return }
    try {
      await enregistrerBareme(edition.poste, edition.type, edition)
      setEdition(null)
      onChange?.()
    } catch (e) {
      Alert.alert('Non enregistré', e.message)
    }
  }

  function supprimer(b) {
    Alert.alert('Retirer ce barème ?', `${b.poste} (${b.famille === 'stage' ? 'stage' : 'CDD / CDI'}) ne sera plus proposé d'office.`, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Retirer', style: 'destructive', onPress: async () => { await supprimerBareme(b.id); onChange?.() } },
    ])
  }

  const champ = (cle, libelle) => (
    <View style={{ flex: 1, minWidth: 140 }}>
      <Libelle styles={styles}>{libelle}</Libelle>
      <Champ styles={styles} colors={colors} keyboardType={cle === 'categorie' ? 'default' : 'number-pad'}
        value={String(edition[cle] ?? '')} onChangeText={v => setEdition(e => ({ ...e, [cle]: cle === 'categorie' ? v : v.replace(/\D/g, '') }))} />
    </View>
  )

  return (
    <Feuille visible={visible} styles={styles} onFermer={() => { setEdition(null); onFermer() }} titre="Barème des postes"
      sous="Montants proposés d'office dans les contrats">
      {edition ? (
        <>
          <Libelle styles={styles}>Poste</Libelle>
          <Champ styles={styles} colors={colors} value={edition.poste} onChangeText={v => setEdition(e => ({ ...e, poste: v }))} placeholder="Ex. Caissier" />
          <Puces styles={styles} actif={edition.type} onChoisir={t => setEdition(e => ({ ...e, type: t }))}
            elements={[{ cle: 'CDD', label: 'CDD / CDI' }, { cle: 'Stage', label: 'Stage' }]} />
          {edition.type === 'Stage'
            ? <View style={{ flexDirection: 'row' }}>{champ('prime_journaliere', 'Prime journalière (F / jour)')}</View>
            : (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                {champ('categorie', 'Catégorie')}
                {champ('salaire_categoriel', 'Salaire catégoriel (F)')}
                {champ('prime_tenue', 'Prime de tenue (F)')}
                {champ('indemnite_transport', 'Indemnité de transport (F)')}
              </View>
            )}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
            <Bouton flex styles={styles} couleur={colors.textSecondary} variante="contour" label="Annuler" onPress={() => setEdition(null)} />
            <Bouton flex styles={styles} couleur={principale} variante="plein" label="Enregistrer" onPress={enregistrer} />
          </View>
        </>
      ) : (
        <>
          {(baremes || []).length === 0 && <Vide icone="💰" styles={styles} texte="Aucun barème pour l'instant." sous="Il se remplit aussi tout seul quand tu génères un contrat." />}
          {(baremes || []).map(b => (
            <TouchableOpacity key={b.id} style={styles.carte} onPress={() => editer(b)} onLongPress={() => supprimer(b)}>
              <Text style={styles.carteTitre}>{b.poste} · {b.famille === 'stage' ? 'Stage' : 'CDD / CDI'}</Text>
              <Text style={styles.carteSous}>
                {b.famille === 'stage'
                  ? `${montantFCFA(b.prime_journaliere)} par jour`
                  : `Cat. ${b.categorie || '—'} · ${montantFCFA(b.salaire_categoriel)} · tenue ${montantFCFA(b.prime_tenue)} · transport ${montantFCFA(b.indemnite_transport)}`}
              </Text>
            </TouchableOpacity>
          ))}
          <Text style={[styles.infoTxt, { flex: 0, marginBottom: 10 }]}>Appuie pour modifier, appui long pour retirer.</Text>
          <Bouton styles={styles} couleur={accent} variante="plein" label="+ Ajouter un poste" onPress={() => setEdition({ ...VIDE })} />
        </>
      )}
    </Feuille>
  )
}
