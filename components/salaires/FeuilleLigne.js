// Saisies de la RH sur une ligne d'état : absences justifiées, éléments
// variables du brut (avec proposition calculée), avances. Chaque saisie porte
// un motif. Enregistrer = recalcul de l'état (les saisies sont conservées).
import { useEffect, useState } from 'react'
import { Alert, Text, TouchableOpacity, View } from 'react-native'

import ChampDate from '../ChampDate'
import { Bouton, Champ, Feuille, Libelle, Puces, useEcranModerne } from '../ui/EcranModerne'
import { ELEMENTS_VARIABLES, MOTIFS_ABSENCE, bornesMois } from '../../lib/etatSalaire'
import { PARAMETRES_DEFAUT, propositionConges, propositionFeries, propositionFinCdd, propositionGratification } from '../../lib/paie'

const F = v => `${Math.round(Number(v) || 0).toLocaleString('fr-FR')} F`
const entier = v => Math.max(0, parseInt(String(v).replace(/\D/g, ''), 10) || 0)

/** Proposition pour un élément variable, depuis le bulletin brouillon de la ligne. */
function proposer(cle, ligne, jours) {
  const b = ligne.bulletin
  const categoriel = b?.calcul?.gains?.find(g => g.code === 10)?.base || 0
  const moisDuMois = Number(String(b?.periode?.debut || '').slice(5, 7)) || 12
  const brutAnnee = b?.cumuls?.annee?.net_imposable || 0
  if (cle === 'gratification') return propositionGratification(categoriel, Math.min(12, moisDuMois), PARAMETRES_DEFAUT)
  if (cle === 'feries') return propositionFeries(categoriel, jours, PARAMETRES_DEFAUT)
  if (cle === 'fin_cdd') return propositionFinCdd(brutAnnee, PARAMETRES_DEFAUT)
  if (cle === 'conges') return propositionConges(brutAnnee, moisDuMois, jours, PARAMETRES_DEFAUT)
  return 0
}

export default function FeuilleLigne({ visible, ligne, mois, onFermer, onEnregistrer }) {
  const { styles, colors, accent } = useEcranModerne('orange')
  const [absences, setAbsences] = useState([])
  const [variables, setVariables] = useState([])
  const [avances, setAvances] = useState([])
  const [ajout, setAjout] = useState(null) // { type: 'absence'|'variable'|'avance', ... }

  useEffect(() => {
    if (!visible || !ligne) return
    setAbsences(ligne.absences_justifiees || [])
    setVariables(ligne.elements_variables || [])
    setAvances(ligne.avances || [])
    setAjout(null)
  }, [visible, ligne])

  if (!ligne) return null
  const { debut, fin } = bornesMois(mois)
  const aBulletin = !!ligne.bulletin

  function valider() {
    if (!ajout) return
    if (!String(ajout.motif || '').trim()) { Alert.alert('Motif', 'Le motif est obligatoire.'); return }
    if (ajout.type === 'absence') {
      if (!ajout.date) { Alert.alert('Absence', 'Choisissez la date.'); return }
      setAbsences(a => [...a.filter(x => x.date !== ajout.date), { date: ajout.date, motif: ajout.motif.trim() }])
    }
    if (ajout.type === 'variable') {
      const def = ELEMENTS_VARIABLES.find(e => e.cle === ajout.cle)
      if (!def || !entier(ajout.montant)) { Alert.alert('Élément', 'Choisissez l\'élément et son montant.'); return }
      setVariables(v => [...v.filter(x => x.code !== def.code), { code: def.code, libelle: def.libelle, montant: entier(ajout.montant), jours: entier(ajout.jours) || undefined, motif: ajout.motif.trim() }])
    }
    if (ajout.type === 'avance') {
      if (!entier(ajout.montant)) { Alert.alert('Avance', 'Saisissez le montant.'); return }
      setAvances(a => [...a, { montant: entier(ajout.montant), motif: ajout.motif.trim() }])
    }
    setAjout(null)
  }

  const retirer = (setter, i) => setter(l => l.filter((_, j) => j !== i))
  const ligneListe = (texte, onRetirer, i) => (
    <View key={i} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <Text style={{ flex: 1, color: colors.text }}>{texte}</Text>
      <TouchableOpacity onPress={onRetirer} hitSlop={10} style={{ minWidth: 48, minHeight: 40, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: '#B91C1C', fontWeight: '800' }}>Retirer</Text>
      </TouchableOpacity>
    </View>
  )

  return (
    <Feuille visible={visible} styles={styles} onFermer={onFermer} titre={ligne.nom}
      sous={`${ligne.jours_pointes} jours pointés · ${ligne.absences_non_justifiees} absence(s) non justifiée(s) · reste ${F(ligne.reste_a_payer)}`}>
      <Libelle styles={styles}>Absences justifiées</Libelle>
      {absences.length ? absences.map((a, i) => ligneListe(`${a.date.slice(8, 10)}/${a.date.slice(5, 7)} — ${a.motif}`, () => retirer(setAbsences, i), i))
        : <Text style={{ color: colors.textMuted }}>Aucune.</Text>}

      {aBulletin && (
        <>
          <Libelle styles={styles}>Éléments variables du brut</Libelle>
          {variables.length ? variables.map((v, i) => ligneListe(`${v.libelle}${v.jours ? ` (${v.jours} j)` : ''} — ${F(v.montant)} — ${v.motif}`, () => retirer(setVariables, i), i))
            : <Text style={{ color: colors.textMuted }}>Aucun.</Text>}
        </>
      )}

      <Libelle styles={styles}>Avances sur salaire</Libelle>
      {avances.length ? avances.map((a, i) => ligneListe(`${F(a.montant)} — ${a.motif}`, () => retirer(setAvances, i), i))
        : <Text style={{ color: colors.textMuted }}>Aucune.</Text>}

      {!ajout ? (
        <View style={{ gap: 8, marginTop: 14 }}>
          <Bouton styles={styles} couleur={accent} label="+ Absence justifiée" onPress={() => setAjout({ type: 'absence', motif: MOTIFS_ABSENCE[0] })} />
          {aBulletin && <Bouton styles={styles} couleur={accent} label="+ Élément variable" onPress={() => setAjout({ type: 'variable', cle: 'gratification', montant: '', jours: '', motif: '' })} />}
          <Bouton styles={styles} couleur={accent} label="+ Avance" onPress={() => setAjout({ type: 'avance', montant: '', motif: '' })} />
        </View>
      ) : (
        <View style={{ marginTop: 14, padding: 12, borderRadius: 12, backgroundColor: colors.surfaceAlt, gap: 8 }}>
          {ajout.type === 'absence' && (
            <>
              <ChampDate label="Date de l'absence" valeur={ajout.date} minDate={debut} maxDate={fin} couleur={accent}
                onChange={d => setAjout(a => ({ ...a, date: d }))} />
              <Puces styles={styles} actif={ajout.motif} onChoisir={m => setAjout(a => ({ ...a, motif: m }))}
                elements={MOTIFS_ABSENCE.map(m => ({ cle: m, label: m }))} />
            </>
          )}
          {ajout.type === 'variable' && (
            <>
              <Puces styles={styles} actif={ajout.cle} onChoisir={c => setAjout(a => ({ ...a, cle: c, montant: '' }))}
                elements={ELEMENTS_VARIABLES.map(e => ({ cle: e.cle, label: e.libelle.toLowerCase() }))} />
              {(ajout.cle === 'conges' || ajout.cle === 'feries') && (
                <Champ styles={styles} colors={colors} keyboardType="number-pad" value={ajout.jours} placeholder="Nombre de jours"
                  onChangeText={j => setAjout(a => ({ ...a, jours: j }))} />
              )}
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Champ styles={styles} colors={colors} keyboardType="number-pad" value={String(ajout.montant)} placeholder="Montant (F)"
                    onChangeText={m => setAjout(a => ({ ...a, montant: m }))} />
                </View>
                <Bouton styles={styles} couleur={accent} label="Proposer" onPress={() => setAjout(a => ({ ...a, montant: String(proposer(a.cle, ligne, entier(a.jours))) }))} />
              </View>
              <Champ styles={styles} colors={colors} value={ajout.motif} placeholder="Motif (obligatoire)" onChangeText={m => setAjout(a => ({ ...a, motif: m }))} />
            </>
          )}
          {ajout.type === 'avance' && (
            <>
              <Champ styles={styles} colors={colors} keyboardType="number-pad" value={ajout.montant} placeholder="Montant (F)"
                onChangeText={m => setAjout(a => ({ ...a, montant: m }))} />
              <Champ styles={styles} colors={colors} value={ajout.motif} placeholder="Motif (obligatoire)" onChangeText={m => setAjout(a => ({ ...a, motif: m }))} />
            </>
          )}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Bouton styles={styles} flex couleur={colors.textMuted} variante="contour" label="Annuler" onPress={() => setAjout(null)} />
            <Bouton styles={styles} flex couleur={accent} variante="plein" label="Ajouter" onPress={valider} />
          </View>
        </View>
      )}

      <View style={{ marginTop: 18 }}>
        <Bouton styles={styles} grand couleur={accent} variante="plein" label="Enregistrer et recalculer"
          onPress={() => onEnregistrer({ absences_justifiees: absences, elements_variables: variables, avances })} />
      </View>
    </Feuille>
  )
}
