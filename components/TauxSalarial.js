// Jauge « Taux salarial » des tableaux de bord (manager / direction).
// Le calcul est dans lib/tauxSalarial.js ; ici, seulement l'affichage.
import { StyleSheet, Text, View } from 'react-native'
import { SEUIL_TAUX_SALARIAL, libelleMoisSalaires, noteTauxSalarial } from '../lib/tauxSalarial'

const fmt = n => `${Math.round(Number(n) || 0).toLocaleString('fr-FR')} F`

export default function TauxSalarial({ taux, colors, dernier }) {
  if (!taux) return null
  const rouge = taux.pct > SEUIL_TAUX_SALARIAL
  const couleur = rouge ? colors.error : colors.success
  const note = noteTauxSalarial(taux)
  const lignes = [
    ['Payé par les caissiers', taux.caissiers],
    ['Payé par le gérant', taux.gerant],
    [taux.etatHorsPeriode
      ? 'État de salaires du RH'
      : `État de salaires du RH (${taux.moisComplets.map(libelleMoisSalaires).join(', ')})`,
    taux.etatHorsPeriode ? null : taux.etat],
  ]
  return (
    <View style={[s.row, { borderBottomColor: colors.borderLight }, dernier && { borderBottomWidth: 0 }]}>
      <View style={s.head}>
        <Text style={[s.label, { color: colors.text }]}>Taux salarial</Text>
        <Text style={[s.value, { color: rouge ? colors.error : colors.successDark }]}>
          {taux.pct.toFixed(1)} % · {fmt(taux.total)}
        </Text>
      </View>
      <View style={[s.barBg, { backgroundColor: colors.surfaceAlt }]}>
        <View style={[s.barFill, { width: `${Math.min(taux.pct, 100)}%`, backgroundColor: couleur }]} />
        <View style={[s.seuilTrait, { left: `${SEUIL_TAUX_SALARIAL}%`, backgroundColor: colors.textMuted }]} />
      </View>
      <Text style={[s.seuil, { color: colors.textMuted }]}>Alerte au-delà de {SEUIL_TAUX_SALARIAL} % des ventes</Text>
      <View style={s.detail}>
        {lignes.map(([libelle, montant]) => (
          <View key={libelle} style={s.ligne}>
            <Text style={[s.ligneLib, { color: colors.textSecondary }]} numberOfLines={2}>{libelle}</Text>
            <Text style={[s.ligneVal, { color: montant == null ? colors.textMuted : colors.text }]}>
              {montant == null ? 'non compté' : fmt(montant)}
            </Text>
          </View>
        ))}
      </View>
      {note ? <Text style={[s.note, { color: colors.warningDark }]}>{note}</Text> : null}
    </View>
  )
}

const s = StyleSheet.create({
  row: { paddingVertical: 12, borderBottomWidth: 1 },
  head: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8, gap: 8 },
  label: { fontSize: 14, fontWeight: '700' },
  value: { fontSize: 13, fontWeight: '800' },
  barBg: { height: 10, borderRadius: 5, overflow: 'hidden' },
  barFill: { height: 10, borderRadius: 5 },
  seuilTrait: { position: 'absolute', top: 0, bottom: 0, width: 2 },
  seuil: { fontSize: 11, marginTop: 5 },
  detail: { marginTop: 8, gap: 4 },
  ligne: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  ligneLib: { fontSize: 12, flex: 1 },
  ligneVal: { fontSize: 12, fontWeight: '700' },
  note: { fontSize: 11, marginTop: 8, lineHeight: 15 },
})
