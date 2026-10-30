// ──────────────────────────────────────────────────────────────────────────────
// État de salaire du mois — logique pure (aucune lecture de l'horloge ni de la base).
//
// Une ligne par CDD/CDI du restaurant, plus les stagiaires (Stage, Journalier,
// sans type) à qui il reste quelque chose à payer.
//   dû          = jours pointés × salaire_journalier
//   déjà versé  = paies des présences + paies du gérant + avances saisies par la RH
//   reste       = max(0, dû − déjà versé)
// Les saisies de la RH (absences justifiées, éléments variables, avances) sont
// gardées d'un recalcul à l'autre (fusionnerSaisies).
// Tests : lib/etatSalaire.test.mjs
// ──────────────────────────────────────────────────────────────────────────────
import { jourIso } from './joursRepos.js'

export const TYPES_BULLETIN = ['CDD', 'CDI']

export const ELEMENTS_VARIABLES = [
  { code: 300, cle: 'gratification', libelle: 'GRATIFICATION' },
  { code: 310, cle: 'conges', libelle: 'CONGES PAYES' },
  { code: 320, cle: 'feries', libelle: 'JOURS FERIES' },
  { code: 330, cle: 'fin_cdd', libelle: 'INDEMNITE DE FIN DE CDD' },
]

export const MOTIFS_ABSENCE = ['Congé', 'Maladie', 'Permission', 'Autre']

const n = v => Number(v) || 0
const somme = (l, f) => (l || []).reduce((s, x) => s + n(f(x)), 0)

export function estContractuel(type) {
  return TYPES_BULLETIN.includes(type)
}

/** '2026-11-01' (ou '2026-11') → { debut, fin, nbJours }. */
export function bornesMois(mois) {
  const [a, m] = String(mois).split('-').map(Number)
  const nbJours = new Date(Date.UTC(a, m, 0)).getUTCDate()
  const mm = String(m).padStart(2, '0')
  return { debut: `${a}-${mm}-01`, fin: `${a}-${mm}-${String(nbJours).padStart(2, '0')}`, nbJours }
}

function datesEntre(debut, fin) {
  const out = []
  for (let t = Date.parse(`${debut}T00:00:00Z`); t <= Date.parse(`${fin}T00:00:00Z`); t += 86400000) {
    out.push(new Date(t).toISOString().slice(0, 10))
  }
  return out
}

/**
 * Jours où le travailleur devait venir : du max(1er du mois, embauche) au
 * min(fin du mois, fin d'activité), sans son jour de repos (1 = lundi … 7 = dimanche).
 */
export function joursAttendus({ dateEmbauche, finActivite, jourRepos }, mois) {
  const { debut, fin } = bornesMois(mois)
  const de = dateEmbauche && dateEmbauche > debut ? dateEmbauche.slice(0, 10) : debut
  const a = finActivite && finActivite.slice(0, 10) < fin ? finActivite.slice(0, 10) : fin
  if (de > a) return []
  return datesEntre(de, a).filter(d => !(jourRepos >= 1 && jourRepos <= 7 && jourIso(d) === jourRepos))
}

/** Dates (AAAA-MM-JJ) où le travailleur est « Présent ». Plusieurs shifts le même jour = un jour. */
export function joursPointes(presences, travailleurId) {
  return new Set((presences || [])
    .filter(p => p.travailleur_id === travailleurId && p.statut === 'Présent' && p.date)
    .map(p => p.date))
}

/** Saisies RH vides. */
export function saisiesVides() {
  return { absences_justifiees: [], elements_variables: [], avances: [] }
}

/** Les saisies RH d'une ligne existante, à garder au recalcul. */
export function fusionnerSaisies(ancienne) {
  const v = saisiesVides()
  if (!ancienne) return v
  return {
    absences_justifiees: Array.isArray(ancienne.absences_justifiees) ? ancienne.absences_justifiees : v.absences_justifiees,
    elements_variables: Array.isArray(ancienne.elements_variables) ? ancienne.elements_variables : v.elements_variables,
    avances: Array.isArray(ancienne.avances) ? ancienne.avances : v.avances,
  }
}

/**
 * Une ligne d'état.
 * @param {object} e
 * @param {object} e.trav  travailleur (id, nom, poste, type_contrat, salaire_journalier, date_embauche, jour_repos, archived_at)
 * @param {Array}  e.presences   présences du restaurant sur le mois (avec `date`, `paye`, `statut`)
 * @param {Array}  e.paiesGerant paies du gérant rattachées (travailleur_id, montant)
 * @param {string} e.mois        '2026-11-01'
 * @param {string} [e.finContrat] fin du contrat en cours (AAAA-MM-JJ)
 * @param {object} [e.saisies]    saisies RH (fusionnerSaisies)
 */
export function ligneEtat({ trav, presences, paiesGerant, mois, finContrat = null, saisies = saisiesVides() }) {
  const finActivite = [trav.archived_at, finContrat].filter(Boolean).map(d => String(d).slice(0, 10)).sort()[0] || null
  const attendus = joursAttendus({ dateEmbauche: trav.date_embauche, finActivite, jourRepos: trav.jour_repos }, mois)
  const pointes = joursPointes(presences, trav.id)
  const justifiees = new Set((saisies.absences_justifiees || []).map(a => a.date))
  const absences = attendus.filter(d => !pointes.has(d) && !justifiees.has(d)).length

  const du = pointes.size * n(trav.salaire_journalier)
  const payePresences = somme((presences || []).filter(p => p.travailleur_id === trav.id && p.statut === 'Présent'), p => p.paye)
  const payeGerant = somme((paiesGerant || []).filter(d => d.travailleur_id === trav.id), d => d.montant)
  const avances = somme(saisies.avances, a => a.montant)
  const dejaVerse = payePresences + payeGerant + avances

  return {
    travailleur_id: trav.id,
    nom: trav.nom,
    poste: trav.poste || '',
    type_contrat: trav.type_contrat || null,
    salaire_journalier: n(trav.salaire_journalier),
    jours_attendus: attendus.length,
    jours_pointes: pointes.size,
    absences_non_justifiees: absences,
    ...saisies,
    du,
    deja_verse: dejaVerse,
    total_avances: avances,
    reste_a_payer: Math.max(0, du - dejaVerse),
    trop_verse: Math.max(0, dejaVerse - du),
  }
}

/**
 * Lignes de l'état d'un restaurant : CDD/CDI toujours, stagiaires seulement
 * s'il leur reste quelque chose. `anciennes` : lignes du brouillon précédent
 * (saisies RH conservées). `finsContrat` : { travailleur_id: 'AAAA-MM-JJ' }.
 */
export function construireEtat({ travailleurs, presences, paiesGerant, mois, anciennes = [], finsContrat = {} }) {
  const parTrav = Object.fromEntries((anciennes || []).map(l => [l.travailleur_id, l]))
  return (travailleurs || [])
    .map(trav => ligneEtat({
      trav, presences, paiesGerant, mois,
      finContrat: finsContrat[trav.id] || null,
      saisies: fusionnerSaisies(parTrav[trav.id]),
    }))
    .filter(l => estContractuel(l.type_contrat) || l.reste_a_payer > 0)
    .sort((a, b) => Number(estContractuel(b.type_contrat)) - Number(estContractuel(a.type_contrat)) || a.nom.localeCompare(b.nom))
}

export function totauxEtat(lignes) {
  return {
    du: somme(lignes, l => l.du),
    deja_verse: somme(lignes, l => l.deja_verse),
    reste_a_payer: somme(lignes, l => l.reste_a_payer),
    brut: somme(lignes, l => l.bulletin?.calcul?.brut),
    net: somme(lignes, l => l.bulletin?.calcul?.net),
    charges_patronales: somme(lignes, l => l.bulletin?.calcul?.chargesPatronales),
  }
}

const CHAMPS_FICHE = [
  ['matricule', 'le matricule'],
  ['categorie', 'la catégorie'],
  ['salaire_categoriel', 'le salaire catégoriel'],
  ['numero_cnps', 'le n° CNPS'],
  ['parts_fiscales', 'le nombre de parts'],
  ['personnes_cmu', 'les personnes CMU'],
  ['mode_paiement', 'le mode de paiement'],
]

/** Ce qui manque à une fiche paie (liste de libellés, vide = complète). */
export function manquesFichePaie(fiche) {
  if (!fiche) return CHAMPS_FICHE.map(([, l]) => l)
  return CHAMPS_FICHE.filter(([c]) => fiche[c] === null || fiche[c] === undefined || String(fiche[c]).trim() === '' || (c === 'salaire_categoriel' && n(fiche[c]) <= 0))
    .map(([, l]) => l)
}

/**
 * Peut-on soumettre l'état au manager ? Le mois doit être terminé et chaque
 * CDD/CDI doit avoir une fiche paie complète.
 * @returns {string[]} raisons du refus (vide = OK), en français courant
 */
export function raisonsRefusSoumission({ lignes, fichesParTrav, mois, aujourdhui }) {
  const raisons = []
  if (aujourdhui <= bornesMois(mois).fin) raisons.push('Le mois n\'est pas encore terminé.')
  for (const l of lignes || []) {
    if (!estContractuel(l.type_contrat)) continue
    const manques = manquesFichePaie(fichesParTrav[l.travailleur_id])
    if (manques.length) raisons.push(`Il manque ${manques.join(', ')} de ${l.nom}.`)
  }
  return raisons
}
