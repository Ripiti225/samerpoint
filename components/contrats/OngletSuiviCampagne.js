// Suivi de la campagne « fiches + contrats » par restaurant (direction / RH).
import { Text, View } from 'react-native'

import { Bouton, Info } from '../ui/EcranModerne'
import { TEXTE_DATE_LIMITE } from '../../lib/miseAJourFiches'

function Barre({ part, couleur }) {
  return (
    <View style={{ height: 8, borderRadius: 4, backgroundColor: '#E5E5EA', overflow: 'hidden', marginTop: 6 }}>
      <View style={{ width: `${Math.round(part * 100)}%`, height: 8, backgroundColor: couleur }} />
    </View>
  )
}

export default function OngletSuiviCampagne({ styles, accent, resume, onRelancer, onPrevenirTous }) {
  const t = resume.total
  return (
    <>
      <View style={styles.carte}>
        <Text style={styles.carteTitre}>Tout le groupe — date limite le {TEXTE_DATE_LIMITE}</Text>
        <Text style={styles.carteSous}>Fiches à jour {t.aJour}/{t.total} · en attente RH {t.enAttente} · contrats signés {t.contratsSignes}/{t.total}</Text>
        <Barre part={t.total ? t.aJour / t.total : 0} couleur="#3B8D2F" />
        <View style={{ marginTop: 10 }}>
          <Bouton styles={styles} couleur={accent} variante="plein" label="📣 Prévenir tous les gérants" onPress={onPrevenirTous} />
        </View>
      </View>
      <Info icone="ℹ️" styles={styles}>Envoyez la notification de lancement une fois la version publiée (web et application).</Info>
      {resume.lignes.map(l => (
        <View key={l.restaurant_id} style={styles.carte}>
          <Text style={styles.carteTitre}>{l.nom}</Text>
          <Text style={styles.carteSous}>Fiches à jour {l.aJour}/{l.total} · en attente RH {l.enAttente} · contrats signés {l.contratsSignes}/{l.total}</Text>
          <Barre part={l.total ? l.aJour / l.total : 0} couleur="#3B8D2F" />
          <Barre part={l.total ? l.contratsSignes / l.total : 0} couleur="#2F6FD8" />
          {l.aCompleter > 0 && (
            <View style={{ marginTop: 10 }}>
              <Bouton styles={styles} couleur={accent} label={`🔔 Relancer le gérant (${l.aCompleter} à compléter)`} onPress={() => onRelancer(l)} />
            </View>
          )}
        </View>
      ))}
    </>
  )
}
