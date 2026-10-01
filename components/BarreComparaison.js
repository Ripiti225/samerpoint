// La barre « Comparer » : le mode, puis les deux termes A et B.
//
// Elle remplace la barre du filtre restaurant quand la comparaison est active,
// et rend l'écran à son état d'origine en se fermant.
//
// Les deux modes sont stricts : jamais deux variables à la fois. Si Angré en
// octobre bat Riviera en novembre, on ne sait pas si c'est le restaurant ou le
// mois — la comparaison n'aurait rien appris.
//
//   • 2 restaurants → A et B sont deux restaurants, la période est commune.
//   • 2 périodes    → le restaurant est celui du filtre (« Tous » compris), et
//                     B n'est pas choisi mais déduit : les mêmes jours, juste
//                     avant A (lib/periodeComparee.js).

import { useMemo } from 'react'
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useTheme } from '../context/ThemeContext'
import { courtNom, couleurResto } from '../lib/dashboardGlobal'

export const MODE_RESTOS = 'restos'
export const MODE_PERIODES = 'periodes'

export default function BarreComparaison({
  actif,
  mode,
  restaurants = [],
  termeA,
  termeB,
  bandeau,
  nomRestoPeriodes = 'Tous les restaurants',
  onOuvrir,
  onFermer,
  onMode,
  onChoisirA,
  onChoisirB,
}) {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])

  // Comparer deux restaurants demande deux restaurants chargés. Le mode
  // « 2 périodes », lui, reste possible : un restaurant contre lui-même.
  const deuxRestosPossible = restaurants.length >= 2

  if (!actif) {
    return (
      <TouchableOpacity style={styles.boutonOuvrir} onPress={onOuvrir}>
        <Text style={styles.boutonOuvrirTxt}>⚖ Comparer</Text>
      </TouchableOpacity>
    )
  }

  return (
    <View style={styles.panneau}>
      <View style={styles.entete}>
        <TouchableOpacity style={styles.fermer} onPress={onFermer}>
          <Text style={styles.fermerTxt}>⚖ Comparer ✕</Text>
        </TouchableOpacity>
        <View style={styles.modes}>
          <TouchableOpacity
            style={[styles.modeBtn, mode === MODE_RESTOS && styles.modeBtnActif, !deuxRestosPossible && styles.modeBtnInactif]}
            onPress={() => deuxRestosPossible && onMode(MODE_RESTOS)}
            disabled={!deuxRestosPossible}
          >
            <Text style={[styles.modeTxt, mode === MODE_RESTOS && styles.modeTxtActif]}>2 restos</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modeBtn, mode === MODE_PERIODES && styles.modeBtnActif]}
            onPress={() => onMode(MODE_PERIODES)}
          >
            <Text style={[styles.modeTxt, mode === MODE_PERIODES && styles.modeTxtActif]}>2 périodes</Text>
          </TouchableOpacity>
        </View>
      </View>

      {!deuxRestosPossible && (
        <Text style={styles.raison}>
          Un seul restaurant chargé : comparer deux restaurants demande d’en avoir deux.
        </Text>
      )}

      {mode === MODE_RESTOS ? (
        <>
          <SelecteurTerme
            lettre="A" valeur={termeA} restaurants={restaurants}
            onChoisir={onChoisirA} styles={styles}
          />
          <SelecteurTerme
            lettre="B" valeur={termeB} restaurants={restaurants}
            onChoisir={onChoisirB} styles={styles}
          />
        </>
      ) : (
        <View style={styles.periodes}>
          <Text style={styles.periodesResto}>{nomRestoPeriodes}</Text>
          <View style={styles.periodeLigne}>
            <Text style={styles.periodeLettre}>A</Text>
            <Text style={styles.periodeTitre}>{bandeau?.a?.titre || '—'}</Text>
            <Text style={styles.periodeDates}>{bandeau?.a?.dates || ''}</Text>
          </View>
          <View style={styles.periodeLigne}>
            <Text style={styles.periodeLettre}>B</Text>
            <Text style={styles.periodeTitre}>{bandeau?.b?.titre || '—'}</Text>
            <Text style={styles.periodeDates}>{bandeau?.b?.dates || ''}</Text>
          </View>
          <Text style={styles.periodesNote}>
            {bandeau
              ? `Les deux termes couvrent ${bandeau.a.nbJours} jour(s) : l’écart en pourcentage est comparable.`
              : 'Choisissez une période pour déduire la précédente.'}
          </Text>
        </View>
      )}
    </View>
  )
}

/** Une ligne de choix : la lettre, puis les restaurants en pastilles. */
function SelecteurTerme({ lettre, valeur, restaurants, onChoisir, styles }) {
  return (
    <View style={styles.termeLigne}>
      <Text style={styles.termeLettre}>{lettre}</Text>
      <ScrollView horizontal style={{ flexGrow: 0 }} showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: 'center' }}>
        {restaurants.map(r => {
          const choisi = valeur === r.id
          return (
            <TouchableOpacity
              key={r.id}
              style={[styles.pastille, choisi && styles.pastilleChoisie, choisi && { borderColor: couleurResto(r.couleur) }]}
              onPress={() => onChoisir(r.id)}
            >
              <View style={[styles.point, { backgroundColor: couleurResto(r.couleur) }]} />
              <Text style={[styles.pastilleTxt, choisi && styles.pastilleTxtChoisie]}>{courtNom(r.nom)}</Text>
            </TouchableOpacity>
          )
        })}
      </ScrollView>
    </View>
  )
}

function makeStyles(colors) { return StyleSheet.create({
  boutonOuvrir: {
    alignSelf: 'flex-start', marginHorizontal: 14, marginVertical: 6,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderLight,
    minHeight: 34, justifyContent: 'center',
  },
  boutonOuvrirTxt: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },

  panneau: {
    backgroundColor: colors.primaryLight, paddingHorizontal: 14, paddingVertical: 10,
    borderBottomWidth: 0.5, borderBottomColor: colors.borderLight,
  },
  entete: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  fermer: { paddingVertical: 6, paddingRight: 10, minHeight: 34, justifyContent: 'center' },
  fermerTxt: { fontSize: 13, fontWeight: '700', color: colors.primaryDark },
  modes: { flexDirection: 'row', gap: 6 },
  modeBtn: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 14, minHeight: 34, justifyContent: 'center',
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderLight,
  },
  modeBtnActif: { backgroundColor: '#534AB7', borderColor: '#534AB7' },
  modeBtnInactif: { opacity: 0.4 },
  modeTxt: { fontSize: 11, fontWeight: '600', color: colors.textMuted },
  modeTxtActif: { color: '#fff' },
  raison: { fontSize: 11, color: colors.primaryDark, marginBottom: 8, lineHeight: 16 },

  termeLigne: { flexDirection: 'row', alignItems: 'center', marginBottom: 6, minHeight: 34 },
  termeLettre: { fontSize: 12, fontWeight: '700', color: colors.primaryDark, width: 18 },
  pastille: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 7,
    borderRadius: 14, marginRight: 6, minHeight: 32,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderLight,
  },
  pastilleChoisie: { borderWidth: 2 },
  point: { width: 7, height: 7, borderRadius: 4, marginRight: 5 },
  pastilleTxt: { fontSize: 11, fontWeight: '500', color: colors.textMuted },
  pastilleTxtChoisie: { fontWeight: '700', color: colors.text },

  periodes: { backgroundColor: colors.surface, borderRadius: 12, padding: 10 },
  periodesResto: { fontSize: 12, fontWeight: '700', color: colors.text, marginBottom: 8 },
  periodeLigne: { flexDirection: 'row', alignItems: 'center', marginBottom: 5 },
  periodeLettre: { fontSize: 11, fontWeight: '700', color: colors.textMuted, width: 18 },
  periodeTitre: { fontSize: 12, color: colors.textSecondary, flex: 1, marginRight: 8 },
  periodeDates: { fontSize: 11, fontWeight: '600', color: colors.text },
  periodesNote: { fontSize: 10, color: colors.textMuted, marginTop: 4, lineHeight: 14 },
})}
