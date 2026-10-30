// ──────────────────────────────────────────────────────────────────────────────
// Bulletin complet, prêt à figer dans lignes_etat_salaire.bulletin (jsonb) :
// calcul (lib/paie.js) + en-tête + congés + cumuls de l'année.
// Module pur. Tests : lib/bulletin.test.mjs
// ──────────────────────────────────────────────────────────────────────────────
import { calculerBulletin } from './paie.js'
import { bornesMois } from './etatSalaire.js'

export const VERSION_BULLETIN = 1

const n = v => Number(v) || 0
const moisDe = iso => String(iso || '').slice(0, 7)

/** Reprise Sage applicable : même année que le mois, arrêtée avant ce mois. */
function repriseApplicable(fiche, mois) {
  const au = fiche?.cumuls_reprise_au
  if (!au || au.slice(0, 4) !== mois.slice(0, 4) || moisDe(au) >= moisDe(mois)) return null
  return au
}

/**
 * Cumuls de l'année : reprise Sage + bulletins validés de l'année (après la
 * reprise, avant ce mois) + ce mois.
 * `precedents` : bulletins figés ({ periode: { debut }, calcul }) du travailleur.
 */
export function cumulsAnnee({ calcul, fiche, mois, precedents = [] }) {
  const reprise = repriseApplicable(fiche, mois)
  const r = reprise ? fiche.cumuls_reprise || {} : {}
  const anterieurs = (precedents || []).filter(b => {
    const m = moisDe(b?.periode?.debut)
    return m.slice(0, 4) === mois.slice(0, 4) && m < moisDe(mois) && (!reprise || m > moisDe(reprise))
  })
  const somme = f => anterieurs.reduce((s, b) => s + n(f(b.calcul)), 0)
  const periode = {
    brut: calcul.salaireBrutCumul,
    net_imposable: calcul.brut,
    charges_salariales: calcul.chargesSalariales,
    charges_patronales: calcul.chargesPatronales,
    heures: calcul.heures,
  }
  return {
    periode,
    annee: {
      brut: n(r.brut) + somme(c => c.salaireBrutCumul) + periode.brut,
      net_imposable: n(r.net_imposable) + somme(c => c.brut) + periode.net_imposable,
      charges_salariales: n(r.charges_salariales) + somme(c => c.chargesSalariales) + periode.charges_salariales,
      charges_patronales: n(r.charges_patronales) + somme(c => c.chargesPatronales) + periode.charges_patronales,
      heures: n(r.heures) + somme(c => c.heures) + periode.heures,
    },
  }
}

/**
 * Congés (jours ouvrables) : acquis = reprise + 2,2 par mois depuis la reprise
 * (ou depuis janvier) ; pris = jours des congés payés saisis ; reste = reprise
 * du reste + acquis depuis − pris depuis.
 */
export function congesBulletin({ fiche, mois, precedents = [], joursPrisCeMois = 0, parMois = 2.2 }) {
  const reprise = repriseApplicable(fiche, mois)
  const debutComptage = reprise ? moisDe(reprise) : `${mois.slice(0, 4)}-00`
  const anterieurs = (precedents || []).filter(b => {
    const m = moisDe(b?.periode?.debut)
    return m > debutComptage && m < moisDe(mois)
  })
  const nbMois = anterieurs.length + 1
  const pris = anterieurs.reduce((s, b) => s + n(b?.conges?.pris_ce_mois), 0) + n(joursPrisCeMois)
  const acquisDepuis = Math.round(nbMois * parMois * 1000) / 1000
  return {
    acquis: Math.round(((reprise ? n(fiche.conges_acquis_reprise) : 0) + acquisDepuis) * 1000) / 1000,
    pris,
    pris_ce_mois: n(joursPrisCeMois),
    reste: Math.round(((reprise ? n(fiche.conges_reste_reprise) : 0) + acquisDepuis - pris) * 1000) / 1000,
  }
}

/**
 * Bulletin figé d'une ligne d'état.
 * @param {object} e
 * @param {object} e.ligne      ligne d'état (absences_non_justifiees, elements_variables, total_avances)
 * @param {object} e.fiche      fiche paie
 * @param {object} e.trav       travailleur (nom, poste, date_embauche, lieu_residence)
 * @param {object} e.resto      restaurant (nom)
 * @param {object} e.employeur  { raison_sociale, adresse, ville, numero_cnps, responsable, telephone }
 * @param {string} e.mois       '2026-11-01'
 * @param {object} e.parametres paramètres de paie (parametresPour)
 * @param {Array}  [e.precedents] bulletins figés de l'année
 */
export function assemblerBulletin({ ligne, fiche, trav, resto, employeur, mois, parametres, precedents = [] }) {
  const { debut, fin } = bornesMois(mois)
  const variables = (ligne.elements_variables || []).filter(v => n(v.montant) > 0)
  const calcul = calculerBulletin({
    fiche,
    dateEmbauche: trav.date_embauche,
    finPeriode: fin,
    absences: ligne.absences_non_justifiees,
    variables,
    avances: ligne.total_avances,
  }, parametres)
  const joursPrisCeMois = variables.filter(v => v.code === 310).reduce((s, v) => s + n(v.jours), 0)
  return {
    version: VERSION_BULLETIN,
    periode: { debut, fin, paiement_le: fin, mode_paiement: fiche.mode_paiement },
    employeur: employeur || {},
    salarie: {
      nom: trav.nom,
      matricule: fiche.matricule,
      coefficient: fiche.coefficient ?? null,
      categorie: fiche.categorie,
      emploi: trav.poste || '',
      numero_cnps: fiche.numero_cnps,
      adresse: trav.lieu_residence || '',
      affectation: resto?.nom || '',
      type_contrat: trav.type_contrat,
      date_embauche: trav.date_embauche,
    },
    calcul,
    conges: congesBulletin({ fiche, mois, precedents, joursPrisCeMois, parMois: parametres?.conges_par_mois ?? 2.2 }),
    cumuls: cumulsAnnee({ calcul, fiche, mois, precedents }),
  }
}
