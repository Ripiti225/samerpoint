// Onglet Analyse de l'écran Contacts : les clients de la période en quatre
// groupes (perdus, une seule commande, fidèles, nouveaux). Toucher une carte
// affiche ses numéros dans la liste en dessous, prêts pour SMS / WhatsApp.
// Calculs : lib/analyseClients.js
import { Text, TouchableOpacity, View } from 'react-native'
import { teinte } from '../ui/EcranModerne'
import { DELAI_PERDU, GROUPES_CLIENTS, part } from '../../lib/analyseClients'
import { libellePeriode } from '../../lib/periodeComparee'

const nb = n => Math.round(Number(n) || 0).toLocaleString('fr-FR')

const COULEURS = { perdus: '#C2462B', uneFois: '#D88A1F', fideles: '#3B8D2F', nouveaux: '#2F6FB3' }

export default function AnalyseClients({ styles, colors, principale, groupes, actif, onChoisir, plage, depuis }) {
  return (
    <View>
      <View style={[styles.carte, { backgroundColor: principale, borderColor: principale }]}>
        <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.85)', fontWeight: '600' }}>👥 Clients de la période</Text>
        <Text style={{ fontSize: 34, fontWeight: '800', color: '#fff', letterSpacing: -0.8, marginTop: 4 }}>{nb(groupes.total)}</Text>
        <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)', marginTop: 2 }}>
          Numéros différents ayant commandé · {libellePeriode(plage.debut, plage.fin)}
        </Text>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
        {GROUPES_CLIENTS.map(g => {
          const c = COULEURS[g.cle]
          const sel = actif === g.cle
          const n = groupes[g.cle].length
          const pct = part(n, groupes.total)
          return (
            <TouchableOpacity key={g.cle} activeOpacity={0.8} onPress={() => onChoisir(g.cle)}
              style={[styles.carte, { flexBasis: '47%', flexGrow: 1, minWidth: 150, marginBottom: 0, padding: 12, borderWidth: sel ? 2 : 1 },
                { borderColor: sel ? c : colors.border, backgroundColor: sel ? teinte(c, '14') : colors.surface }]}>
              <Text style={{ fontSize: 13, fontWeight: '800', color: c }}>{g.icone} {g.titre}</Text>
              <Text style={{ fontSize: 26, fontWeight: '800', color: colors.text, marginTop: 4, letterSpacing: -0.5 }}>{nb(n)}</Text>
              <Text style={[styles.carteSous, { marginTop: 0 }]}>
                {pct !== null ? `${pct} % des clients · ` : ''}{g.sous}
              </Text>
            </TouchableOpacity>
          )
        })}
      </View>

      {actif === 'perdus' && !groupes.perdusPossibles && (
        <View style={[styles.carte, { backgroundColor: teinte(COULEURS.perdus, '12'), borderColor: teinte(COULEURS.perdus, '40'), padding: 12 }]}>
          <Text style={[styles.infoTxt, { color: colors.text, fontSize: 12.5 }]}>
            💡 La période commence il y a moins de {DELAI_PERDU} jours : personne ne peut encore être « perdu ». Choisissez « Mois préc. » ou une période plus ancienne.
          </Text>
        </View>
      )}

      <Text style={[styles.infoTxt, { fontSize: 11, color: colors.textMuted, marginBottom: 12 }]}>
        Un client = un numéro (avec ou sans +225). Le nombre de commandes compte tout l'historique{depuis ? `, depuis le ${depuis}` : ''}, au restaurant choisi. Un client peut être dans plusieurs groupes.
      </Text>
    </View>
  )
}
