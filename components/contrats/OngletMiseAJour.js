// Onglet gérant « Mettre à jour mon équipe » (campagne du 29/10/2026) :
// bandeau de date limite, puis ses travailleurs, les plus incomplets d'abord.
import { Text, TouchableOpacity, View } from 'react-native'

import Avatar from '../equipe/Avatar'
import { Info, Vide, teinte } from '../ui/EcranModerne'
import { TEXTE_DATE_LIMITE, dateLimiteDepassee } from '../../lib/miseAJourFiches'

const ETATS = {
  incomplete: { couleur: '#C27C1A', texte: x => `⚠️ ${x.manquants.length} info${x.manquants.length > 1 ? 's' : ''} manquante${x.manquants.length > 1 ? 's' : ''}` },
  envoyee: { couleur: '#2F6FD8', texte: () => '🟡 Envoyée à la RH' },
  refusee: { couleur: '#C2462B', texte: x => `❌ Refusée : ${x.demande?.motif_refus || 'à corriger'}` },
  a_jour: { couleur: '#3B8D2F', texte: () => '✅ À jour' },
}

export default function OngletMiseAJour({ styles, principale, lignes, aujourdhui, onOuvrir }) {
  const aJour = lignes.filter(x => x.etat === 'a_jour').length
  const depasse = dateLimiteDepassee(aujourdhui)
  return (
    <>
      <Info icone={depasse ? '⏰' : '📋'} styles={styles} couleur={depasse ? '#C2462B' : principale}>
        {depasse ? 'Date limite dépassée' : 'Complétez les fiches de votre équipe'} : avant le {TEXTE_DATE_LIMITE}. {aJour} / {lignes.length} à jour.
      </Info>
      <View style={{ height: 8 }} />
      {lignes.length === 0
        ? <Vide icone="👥" styles={styles} texte="Aucun travailleur dans ton équipe." sous={null} />
        : lignes.map(x => {
          const cfg = ETATS[x.etat]
          const touchable = x.etat !== 'envoyee'
          return (
            <TouchableOpacity key={x.trav.id} style={[styles.carte, { borderLeftWidth: 4, borderLeftColor: cfg.couleur }]}
              activeOpacity={touchable ? 0.8 : 1} onPress={touchable ? () => onOuvrir(x) : undefined}>
              <View style={styles.carteTop}>
                <Avatar nom={x.trav.nom} photo={x.trav.photo_url} taille={44} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.carteTitre}>{x.trav.nom}</Text>
                  <Text style={styles.carteSous}>{x.trav.poste || 'Sans poste'}</Text>
                </View>
                {touchable ? <Text style={{ color: principale, fontWeight: '800' }}>{x.etat === 'a_jour' ? 'Voir ›' : 'Compléter ›'}</Text> : null}
              </View>
              <View style={{ alignSelf: 'flex-start', marginTop: 8, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, backgroundColor: teinte(cfg.couleur, '1A') }}>
                <Text style={{ color: cfg.couleur, fontWeight: '700', fontSize: 12 }}>{cfg.texte(x)}</Text>
              </View>
              {x.etat === 'incomplete' && (
                <Text style={[styles.infoTxt, { marginTop: 6, flex: 0 }]}>Manque : {x.manquants.join(', ')}</Text>
              )}
            </TouchableOpacity>
          )
        })}
    </>
  )
}
