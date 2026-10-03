// ──────────────────────────────────────────────────────────────────────────────
// Trésorerie — briques des historiques : choix de la période, bouton qui
// déroule, et listes « loyers payés » / « dettes remboursées ».
// Logique : lib/historique.js
// ──────────────────────────────────────────────────────────────────────────────
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons'
import { useMemo, useState } from 'react'
import { Text, TouchableOpacity, View } from 'react-native'

import { anneesDisponibles, dettesRemboursees, loyersPayes } from '../../lib/historique'
import { LIBELLES_CATEGORIE, aujourdhuiISO, fmt, formatDateFR, libelleMois, libelleMoisCourt } from '../../lib/tresorerie'
import { ItemIcone, Puces, TitreSection, styleCategorie, useStylesTreso } from './commun'
import { titreDu } from './du'

const MOIS_COURTS = ['Janv.', 'Févr.', 'Mars', 'Avr.', 'Mai', 'Juin', 'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.', 'Déc.']

export function periodeParDefaut() {
  return { an: Number(aujourdhuiISO().slice(0, 4)), mois: null }
}

export function libellePeriode(p) {
  return p.mois ? libelleMois(`${p.an}-${String(p.mois).padStart(2, '0')}-01`) : `Année ${p.an}`
}

// Une rangée d'années, puis « Toute l'année » et les 12 mois.
export function ChoixPeriode({ dates = [], valeur, onChange }) {
  const { styles } = useStylesTreso()
  const annees = useMemo(() => anneesDisponibles(dates, Number(aujourdhuiISO().slice(0, 4))), [dates])
  return (
    <View style={{ marginBottom: 6 }}>
      <Puces options={annees.map(a => ({ valeur: a, label: String(a) }))} valeur={valeur.an}
        onChange={an => onChange({ ...valeur, an })} />
      <Puces
        options={[{ valeur: null, label: 'Toute l\'année' }, ...MOIS_COURTS.map((m, i) => ({ valeur: i + 1, label: m }))]}
        valeur={valeur.mois} onChange={mois => onChange({ ...valeur, mois })} />
      <Text style={styles.petit}>{libellePeriode(valeur)}</Text>
    </View>
  )
}

// « Historique » qui se déroule sous la liste du jour.
export function BlocHistorique({ titre, children }) {
  const { styles, colors } = useStylesTreso()
  const [ouvert, setOuvert] = useState(false)
  return (
    <View style={{ marginTop: 12 }}>
      <TouchableOpacity style={styles.histoBouton} onPress={() => setOuvert(o => !o)} accessibilityRole="button" accessibilityState={{ expanded: ouvert }}>
        <MaterialCommunityIcons name="history" size={18} color={colors.primary} />
        <Text style={styles.histoBoutonTxt}>{titre}</Text>
        <MaterialCommunityIcons name={ouvert ? 'chevron-up' : 'chevron-down'} size={20} color={colors.primary} />
      </TouchableOpacity>
      {ouvert && <View style={{ marginTop: 10 }}>{children}</View>}
    </View>
  )
}

// Comptes des versements d'une ligne : « BACI, espèces », « avant la trésorerie ».
function comptesDe(paiements, comptes) {
  const noms = (paiements || []).map(p => (p.source === 'compte' ? comptes.find(c => c.id === p.compte_id)?.nom || '?'
    : p.source === 'avant' ? 'avant la trésorerie' : 'espèces'))
  return [...new Set(noms)].join(', ')
}

export function HistoriqueLoyersPayes({ donnees, nomResto, onOuvrir }) {
  const { styles, colors } = useStylesTreso()
  const [periode, setPeriode] = useState(periodeParDefaut)
  const loyers = useMemo(() => (donnees.dus || []).filter(d => d.categorie === 'loyer'), [donnees])
  const lignes = useMemo(() => loyersPayes(loyers, donnees.paiements, periode), [loyers, donnees, periode])
  const total = lignes.reduce((s, l) => s + Number(l.du.montant_du || 0), 0)
  return (
    <BlocHistorique titre="Historique des loyers payés">
      <ChoixPeriode dates={loyers.map(d => d.mois)} valeur={periode} onChange={setPeriode} />
      <TitreSection icone="check-circle-outline" couleur={colors.success}
        titre={`${lignes.length} loyer${lignes.length > 1 ? 's' : ''} payé${lignes.length > 1 ? 's' : ''}`} droite={`${fmt(total)} F`} />
      {lignes.length === 0 && <Text style={styles.vide}>Aucun loyer payé sur cette période.</Text>}
      {lignes.map(({ du, paiements, soldeLe }) => (
        <ItemIcone key={du.id} onPress={() => onOuvrir(du)} icone={styleCategorie('loyer').icone} couleur={colors.success}
          titre={`${nomResto(du.restaurant_id)} · ${libelleMois(du.mois)}`}
          sous={`payé le ${formatDateFR(soldeLe)} · ${comptesDe(paiements, donnees.comptes)}${paiements.length > 1 ? ` · en ${paiements.length} fois` : ''}`}
          droite={fmt(du.montant_du)} />
      ))}
      <Text style={styles.petit}>Mois du loyer (consommé). Un appui ouvre le détail des versements.</Text>
    </BlocHistorique>
  )
}

// avecCreanciers : false pour les managers en lecture (ils ne voient pas les créanciers).
export function HistoriqueDettesRemboursees({ donnees, nomResto, avecCreanciers, onOuvrir }) {
  const { styles, colors } = useStylesTreso()
  const [periode, setPeriode] = useState(periodeParDefaut)
  const dus = useMemo(() => (donnees.dus || []).filter(d => avecCreanciers || d.categorie !== 'dette'), [donnees, avecCreanciers])
  const lignes = useMemo(() => dettesRemboursees(dus, donnees.paiements, periode), [dus, donnees, periode])
  const total = lignes.reduce((s, l) => s + Number(l.du.montant_du || 0), 0)
  return (
    <BlocHistorique titre="Historique des dettes remboursées">
      <ChoixPeriode dates={(donnees.paiements || []).map(p => p.date)} valeur={periode} onChange={setPeriode} />
      <TitreSection icone="check-circle-outline" couleur={colors.success}
        titre={`${lignes.length} remboursée${lignes.length > 1 ? 's' : ''}`} droite={`${fmt(total)} F`} />
      {lignes.length === 0 && <Text style={styles.vide}>Aucune dette remboursée sur cette période.</Text>}
      {lignes.map(({ du, paiements, soldeLe, retard }) => (
        <ItemIcone key={du.id} onPress={() => onOuvrir(du)}
          icone={styleCategorie(du.categorie).icone} couleur={styleCategorie(du.categorie).couleur}
          titre={`${LIBELLES_CATEGORIE[du.categorie]} · ${titreDu(du, nomResto)}${du.mois ? ` · ${libelleMoisCourt(du.mois)}` : ''}`}
          sous={`remboursée le ${formatDateFR(soldeLe)} · ${comptesDe(paiements, donnees.comptes)}${retard ? ` · ${retard} j après la date limite` : ''}${du.est_pret ? ' · prêt' : ''}`}
          droite={fmt(du.montant_du)} />
      ))}
      <Text style={styles.petit}>Créanciers et prêts soldés, charges payées après leur date limite. Période = date du remboursement.</Text>
    </BlocHistorique>
  )
}
