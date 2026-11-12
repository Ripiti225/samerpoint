// Fiches incomplètes ou refusées : ce qu'il manque à chacun, un toucher pour le saisir.
// Filtre par état : pas encore envoyée par le gérant, envoyée (à valider), refusée.
import { Text, TouchableOpacity, View } from 'react-native'

import Avatar from '../equipe/Avatar'
import { Puces, Vide } from '../ui/EcranModerne'

const VIDES = {
  incomplete: 'Aucune fiche en attente du gérant : tout a été envoyé.',
  envoyee: 'Aucune fiche envoyée en attente de validation.',
  refusee: 'Aucune fiche refusée.',
}

export default function OngletACompleter({ styles, lignes, comptes, filtre, onFiltre, etats, filtreEtat, onFiltreEtat, restoNom, onOuvrir }) {
  const n = k => (etats?.[k] ? ` (${etats[k]})` : '')
  return (
    <>
      <Puces ligne styles={styles} actif={filtreEtat} onChoisir={onFiltreEtat} elements={[
        { cle: null, label: 'Toutes' },
        { cle: 'incomplete', label: `⏳ Pas envoyée${n('incomplete')}` },
        { cle: 'envoyee', label: `📋 Envoyée, à valider${n('envoyee')}` },
        { cle: 'refusee', label: `❌ Refusée${n('refusee')}` },
      ]} />
      {comptes.length > 0 && (
        <Puces ligne petit styles={styles} actif={filtre} onChoisir={onFiltre} elements={[
          { cle: null, label: 'Toutes' },
          ...comptes.map(c => ({ cle: c.libelle, label: `${c.libelle} (${c.nombre})` })),
        ]} />
      )}
      {lignes.length === 0
        ? <Vide icone="✅" styles={styles} texte={VIDES[filtreEtat] || 'Toutes ces fiches sont complètes.'} sous={null} />
        : lignes.map(({ trav, demande, manquants }) => (
          <TouchableOpacity key={trav.id} style={styles.carte} activeOpacity={0.8} onPress={() => onOuvrir(trav, demande)}>
            <View style={styles.carteTop}>
              <Avatar nom={trav.nom} photo={trav.photo_url} taille={44} />
              <View style={{ flex: 1 }}>
                <Text style={styles.carteTitre}>{trav.nom}</Text>
                <Text style={styles.carteSous}>{restoNom(trav.restaurant_id) || 'Sans restaurant'}{trav.poste ? ` · ${trav.poste}` : ''}</Text>
              </View>
            </View>
            {manquants.length > 0 && (
              <Text style={[styles.infoTxt, { flex: 0, marginTop: 6, color: '#C27C1A', fontWeight: '700' }]}>Manque : {manquants.join(', ')}</Text>
            )}
            {demande?.statut === 'envoyee' && (
              <Text style={[styles.infoTxt, { flex: 0, marginTop: 4 }]}>📋 Fiche envoyée par le gérant, à valider</Text>
            )}
            {demande?.statut === 'refusee' && (
              <Text style={[styles.infoTxt, { flex: 0, marginTop: 4, color: '#C2462B' }]}>❌ Refusée{demande.motif_refus ? ` : ${demande.motif_refus}` : ''}</Text>
            )}
          </TouchableOpacity>
        ))}
    </>
  )
}
