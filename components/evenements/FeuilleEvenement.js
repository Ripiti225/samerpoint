import { useEffect, useState } from 'react'
import { Alert, Text, View } from 'react-native'

import { erreurEvenement } from '../../lib/evenements'
import { enregistrerEvenement, supprimerEvenement } from '../../lib/evenementsDb'
import ChampDate from '../ChampDate'
import { Bouton, Champ, Feuille, Libelle, Puces } from '../ui/EcranModerne'

const VIDE = { titre: '', date_evenement: '', note: '', restaurant_id: '', chaque_annee: false }

export default function FeuilleEvenement({ visible, evenement, restaurants, ctx, styles, colors, principale, onFermer, onEnregistre }) {
  const [form, setForm] = useState(VIDE)
  const [erreur, setErreur] = useState(null)
  const [occupe, setOccupe] = useState(false)

  useEffect(() => {
    if (!visible) return
    setErreur(null)
    setForm(evenement ? {
      titre: evenement.titre,
      date_evenement: String(evenement.date_evenement).slice(0, 10),
      note: evenement.note || '',
      restaurant_id: evenement.restaurant_id || '',
      chaque_annee: !!evenement.chaque_annee,
    } : VIDE)
  }, [visible, evenement])

  const maj = champ => valeur => setForm(f => ({ ...f, [champ]: valeur }))

  async function enregistrer() {
    const probleme = erreurEvenement(form)
    if (probleme) { setErreur(probleme); return }
    setOccupe(true)
    try {
      await enregistrerEvenement(form, evenement?.id || null, ctx)
      onEnregistre()
    } catch {
      setErreur("L'événement n'a pas pu être enregistré. Réessayez.")
    } finally {
      setOccupe(false)
    }
  }

  function supprimer() {
    Alert.alert('Supprimer cet événement ?', `« ${evenement.titre} » sera retiré du calendrier.`, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer', style: 'destructive',
        onPress: async () => {
          try {
            await supprimerEvenement(evenement, ctx)
            onEnregistre()
          } catch {
            setErreur("L'événement n'a pas pu être supprimé. Réessayez.")
          }
        },
      },
    ])
  }

  const puccesRestaurants = [{ cle: '', label: 'Tout le groupe' }, ...restaurants.map(r => ({ cle: r.id, label: r.nom }))]

  return (
    <Feuille visible={visible} titre={evenement ? "Modifier l'événement" : 'Nouvel événement'} onFermer={onFermer} styles={styles}>
      <Libelle styles={styles}>Titre</Libelle>
      <Champ styles={styles} colors={colors} value={form.titre} onChangeText={maj('titre')} placeholder="Ex : Noël, réunion des gérants" maxLength={120} />

      <ChampDate label="Date" valeur={form.date_evenement} onChange={maj('date_evenement')} couleur={principale} />
      <View style={{ height: 16 }} />

      <Libelle styles={styles}>Fréquence</Libelle>
      <Puces styles={styles} actif={form.chaque_annee} onChoisir={maj('chaque_annee')}
        elements={[{ cle: false, label: 'Une seule fois' }, { cle: true, label: 'Chaque année' }]} />

      <Libelle styles={styles}>Restaurant concerné</Libelle>
      <Puces styles={styles} actif={form.restaurant_id} onChoisir={maj('restaurant_id')} elements={puccesRestaurants} />

      <Libelle styles={styles}>Note (facultative)</Libelle>
      <Champ styles={styles} colors={colors} multiline value={form.note} onChangeText={maj('note')} placeholder="Ce qu'il faut préparer" />

      {erreur ? <Text style={{ fontSize: 13, fontWeight: '700', color: colors.error, marginBottom: 10 }}>{erreur}</Text> : null}

      <View style={{ gap: 8 }}>
        <Bouton label={occupe ? 'Enregistrement…' : 'Enregistrer'} variante="plein" couleur={principale} grand styles={styles} disabled={occupe} onPress={enregistrer} />
        {evenement ? <Bouton label="Supprimer" couleur={colors.error} grand styles={styles} disabled={occupe} onPress={supprimer} /> : null}
      </View>
    </Feuille>
  )
}
