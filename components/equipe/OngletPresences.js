import { ScrollView, Text, View } from 'react-native'
import { STATUTS, dedupPresences, fmt, formatDate } from '../../lib/equipe'
import Avatar from './Avatar'
import { teinte } from './styles'

export function PastilleStatut({ styles, statut }) {
  const c = STATUTS[statut] || '#888888'
  return (
    <View style={[styles.statutPill, { backgroundColor: teinte(c, '24') }]}>
      <Text style={[styles.statutPillTxt, { color: c }]}>{statut}</Text>
    </View>
  )
}

export default function OngletPresences({ styles, presences, tous, restoParId }) {
  const parDate = {}
  dedupPresences(presences).forEach(p => {
    if (!parDate[p.date]) parDate[p.date] = []
    parDate[p.date].push(p)
  })
  const dates = Object.keys(parDate).sort((a, b) => b.localeCompare(a))

  return (
    <ScrollView showsVerticalScrollIndicator={false}>
      {dates.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyIcon}>👥</Text>
          <Text style={styles.emptyTxt}>Aucune présence sur cette période</Text>
        </View>
      ) : dates.map(date => {
        const lignes = parDate[date].sort((a, b) =>
          (tous ? (restoParId[a.restaurant_id]?.nom || '').localeCompare(restoParId[b.restaurant_id]?.nom || '') : 0)
          || (a.travailleur_nom || '').localeCompare(b.travailleur_nom || ''))
        return (
          <View key={date} style={{ marginBottom: 14 }}>
            <Text style={styles.dateTitre}>{formatDate(date)}</Text>
            <View style={styles.carteListe}>
              {lignes.map((p, i) => {
                const resto = restoParId[p.restaurant_id]
                return (
                  <View key={`${p.travailleur_id}|${p.point_id}`} style={[styles.ligne, i === lignes.length - 1 && { borderBottomWidth: 0 }]}>
                    <View style={styles.ligneGauche}>
                      <Avatar nom={p.travailleur_nom} resto={resto} taille={34} />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.nom, { fontSize: 13 }]}>{p.travailleur_nom}</Text>
                        {tous && resto ? <Text style={styles.sousNom}>{resto.nom}</Text> : null}
                        {p.shift_nom ? (
                          <Text style={styles.shift}>⏰ {p.shift_nom} {p.heure_debut ? `(${p.heure_debut} → ${p.heure_fin})` : ''}</Text>
                        ) : null}
                        {p.statut === 'Présent' && p.paye > 0 ? <Text style={styles.paie}>{fmt(p.paye)}</Text> : null}
                      </View>
                    </View>
                    <PastilleStatut styles={styles} statut={p.statut} />
                  </View>
                )
              })}
            </View>
          </View>
        )
      })}
      <View style={{ height: 30 }} />
    </ScrollView>
  )
}
