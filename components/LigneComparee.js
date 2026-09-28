// Un indicateur comparé : deux valeurs, deux barres, un écart. Pleine largeur.
//
// La disposition n'est pas un choix esthétique. L'usage réel est iOS Safari sur
// téléphone ; deux colonnes côte à côte y donneraient ~160 px par valeur, et un
// montant en FCFA fait 10 à 12 caractères. Une ligne par indicateur, A dessus,
// B dessous.
//
// Deux règles portées ici et nulle part ailleurs :
//   • Les deux barres partagent leur échelle. Deux barres ayant chacune la
//     sienne sont un mensonge visuel : 9 800 000 remplirait la même largeur que
//     12 400 000 et l'œil conclurait l'égalité.
//   • La lettre A ou B est toujours écrite. Trois des couleurs de restaurant
//     passent sous 3:1 sur leur fond ; l'identité ne peut pas reposer sur la
//     couleur seule. Même raison pour la flèche et le signe, qui redisent ce que
//     le vert et le rouge disent.

import { useMemo } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../context/ThemeContext'
import { formaterDelta, formaterEcart, UNITE } from '../lib/comparaisonDashboard'
import { fmtFCFA } from '../lib/dashboardGlobal'

const COULEUR_ECART = { bon: '#3B6D11', mauvais: '#A32D2D' }

/** Un pourcentage s'écrit « 37,2 % » ; un montant passe par fmtFCFA. */
function valeurLisible(v, unite) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  if (unite === UNITE.POURCENT) return `${v.toFixed(1).replace('.', ',')} %`
  return fmtFCFA(v)
}

export default function LigneComparee({
  ecart,
  couleurA = '#EF9F27',
  couleurB = '#534AB7',
  opaciteB = 1,
}) {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  if (!ecart) return null

  const { libelle, libelleA, libelleB, a, b, unite, comparable, message } = ecart

  // L'échelle commune : la plus grande des deux valeurs absolues.
  const echelle = Math.max(Math.abs(a || 0), Math.abs(b || 0), 1)
  const largeur = v => `${Math.min((Math.abs(v || 0) / echelle) * 100, 100)}%`

  const couleurTexteEcart = COULEUR_ECART[ecart.couleur] || colors.textMuted
  const texteEcart = formaterEcart(ecart)
  const texteDelta = formaterDelta(ecart)

  return (
    <View style={styles.carte}>
      <Text style={styles.titre}>{libelle}</Text>

      <View style={styles.terme}>
        <Text style={styles.lettre}>A</Text>
        <Text style={styles.nom} numberOfLines={1}>{libelleA}</Text>
        <Text style={styles.valeur}>{valeurLisible(a, unite)}</Text>
      </View>
      <View style={styles.piste}>
        <View style={[styles.remplissage, { width: largeur(a), backgroundColor: couleurA }]} />
      </View>

      {/* Sans terme B comparable, la ligne s'arrête ici : A seul, et la raison. */}
      {comparable ? (<>
        <View style={styles.terme}>
          <Text style={styles.lettre}>B</Text>
          <Text style={styles.nom} numberOfLines={1}>{libelleB}</Text>
          <Text style={styles.valeur}>{valeurLisible(b, unite)}</Text>
        </View>
        <View style={styles.piste}>
          <View style={[styles.remplissage, { width: largeur(b), backgroundColor: couleurB, opacity: opaciteB }]} />
        </View>

        <View style={styles.pied}>
          {message ? <Text style={styles.mention} numberOfLines={2}>{message}</Text> : <View style={{ flex: 1 }} />}
          <View style={styles.ecartBloc}>
            {!!texteEcart && <Text style={[styles.ecart, { color: couleurTexteEcart }]}>{texteEcart}</Text>}
            {!!texteDelta && <Text style={styles.delta}>{texteDelta}</Text>}
          </View>
        </View>
      </>) : (
        <Text style={styles.nonComparable}>{message}</Text>
      )}
    </View>
  )
}

function makeStyles(colors) { return StyleSheet.create({
  carte: {
    backgroundColor: colors.surface, borderRadius: 14, padding: 14, marginBottom: 12,
    borderWidth: 0.5, borderColor: colors.borderLight,
  },
  titre: { fontSize: 13, fontWeight: '700', color: colors.text, marginBottom: 10 },
  terme: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  lettre: {
    fontSize: 10, fontWeight: '700', color: colors.textMuted, width: 16,
  },
  nom: { fontSize: 12, color: colors.textSecondary, flex: 1, marginRight: 8 },
  valeur: { fontSize: 13, fontWeight: '700', color: colors.text },
  piste: {
    height: 12, backgroundColor: colors.bg, borderRadius: 6, overflow: 'hidden', marginBottom: 10,
  },
  remplissage: { height: '100%', borderRadius: 6 },
  pied: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10 },
  ecartBloc: { alignItems: 'flex-end' },
  ecart: { fontSize: 14, fontWeight: '700' },
  delta: { fontSize: 11, color: colors.textMuted, marginTop: 1 },
  mention: { fontSize: 11, color: colors.textMuted, flex: 1, lineHeight: 16 },
  nonComparable: { fontSize: 11, color: colors.textMuted, lineHeight: 16, marginTop: 2 },
})}
