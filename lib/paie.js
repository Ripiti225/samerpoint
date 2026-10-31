// ──────────────────────────────────────────────────────────────────────────────
// Bulletin de paie ivoirien — calcul pur (aucune lecture de l'horloge ni de la
// base). Reproduit au franc près les bulletins Sage de juillet 2026 :
// lib/paie.test.mjs. Conception : docs/superpowers/specs/2026-10-30-etats-salaire-bulletins-design.md
//
// Les taux sont en POUR DIX MILLE (630 = 6,30 %) : calcul entier, sans flottant
// (0,75 % × 75 000 = 562,5 doit donner 563, comme Sage).
// ──────────────────────────────────────────────────────────────────────────────

/** Valeurs légales au 01/11/2026. Copiées dans parametres_paie (applicable_du). */
export const PARAMETRES_DEFAUT = {
  smig: 75000,
  jours_base: 30,
  heures_mois: 173.33,
  cnps_salarie: 630,
  its_tranches: [
    { jusqua: 75000, taux: 0 },
    { jusqua: 240000, taux: 1600 },
    { jusqua: 800000, taux: 2100 },
    { jusqua: 2400000, taux: 2400 },
    { jusqua: 8000000, taux: 2800 },
    { jusqua: null, taux: 3200 },
  ],
  ricf_demi_part: 5500,
  parts_max: 5,
  cmu_par_personne: 500,
  plafond_pf_am_at: 75000,
  patronal: [
    { code: 470, libelle: 'RETRAITE GENERALE', taux: 770, plafonne: false },
    { code: 480, libelle: 'PRESTATION FAMILIALE', taux: 500, plafonne: true },
    { code: 481, libelle: 'ASSURANCE MATERNITE', taux: 75, plafonne: true },
    { code: 490, libelle: 'ACCIDENT DE TRAVAIL', taux: 200, plafonne: true },
    { code: 500, libelle: 'PART PATRONALE CN', taux: 120, plafonne: false },
    { code: 520, libelle: "TAXE D'APPRENTISSAGE", taux: 40, plafonne: false },
    { code: 530, libelle: 'TAXE F.P.C', taux: 60, plafonne: false },
    { code: 531, libelle: 'TFC à régulariser au 31/12', taux: 60, plafonne: false },
  ],
  anciennete_des_ans: 2,
  anciennete_par_an: 100,
  anciennete_max: 2500,
  arrondi: 100,
  conges_par_mois: 2.2,
  gratification: 7500,
  fin_cdd: 300,            // 3 % du brut perçu pendant le contrat (confirmé le 31/10/2026)
}

const taux = (montant, t) => Math.round((montant * t) / 10000)
const ent = v => Math.round(Number(v) || 0)

/** Années et mois complets entre l'embauche et `au` (AAAA-MM-JJ). */
export function anciennete(dateEmbauche, au) {
  const e = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateEmbauche || ''))
  const a = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(au || ''))
  if (!e || !a) return { ans: 0, mois: 0 }
  let mois = (Number(a[1]) - Number(e[1])) * 12 + (Number(a[2]) - Number(e[2]))
  if (Number(a[3]) < Number(e[3])) mois -= 1
  mois = Math.max(0, mois)
  return { ans: Math.floor(mois / 12), mois: mois % 12 }
}

/** Taux d'ancienneté (pour dix mille) : 1 % par année complète dès 2 ans, plafond 25 %. */
export function tauxAnciennete(ans, p = PARAMETRES_DEFAUT) {
  if (ans < p.anciennete_des_ans) return 0
  return Math.min(ans * p.anciennete_par_an, p.anciennete_max)
}

/** Impôt brut ITS (avant RICF) sur le brut imposable mensuel. */
export function impotBrutITS(brut, p = PARAMETRES_DEFAUT) {
  let reste = 0
  let bas = 0
  for (const t of p.its_tranches) {
    const haut = t.jusqua ?? Infinity
    if (brut > bas) reste += (Math.min(brut, haut) - bas) * t.taux
    bas = haut
  }
  return Math.round(reste / 10000)
}

/** Réduction pour charges de famille : 5 500 F par demi-part au-delà d'une part. */
export function ricf(parts, p = PARAMETRES_DEFAUT) {
  const pp = Math.min(Math.max(Number(parts) || 1, 1), p.parts_max)
  return Math.round((pp - 1) * 2) * p.ricf_demi_part
}

/**
 * Calcule un bulletin.
 * @param {object} e
 * @param {object} e.fiche  { salaire_categoriel, sursalaire, prime_transport, prime_tenue, parts_fiscales, personnes_cmu }
 * @param {string} e.dateEmbauche  AAAA-MM-JJ
 * @param {string} e.finPeriode    AAAA-MM-JJ (dernier jour du mois)
 * @param {number} [e.absences]    jours d'absence non justifiée
 * @param {Array}  [e.variables]   [{ code, libelle, montant }] — imposables
 * @param {number} [e.avances]     avances sur salaire du mois
 * @param {object} [p]             paramètres (PARAMETRES_DEFAUT)
 */
export function calculerBulletin({ fiche, dateEmbauche, finPeriode, absences = 0, variables = [], avances = 0 }, p = PARAMETRES_DEFAUT) {
  const joursPayes = Math.max(0, p.jours_base - Math.max(0, ent(absences)))
  const prorata = m => Math.round((ent(m) * joursPayes) / p.jours_base)

  const base = prorata(fiche.salaire_categoriel)
  const sursalaire = prorata(fiche.sursalaire)
  const anc = anciennete(dateEmbauche, finPeriode)
  const tauxAnc = tauxAnciennete(anc.ans, p)
  const primeAnciennete = taux(base, tauxAnc)

  const gains = [
    { code: 10, libelle: 'SALAIRE DE BASE', nombre: joursPayes, base: ent(fiche.salaire_categoriel), gain: base },
  ]
  if (sursalaire) gains.push({ code: 20, libelle: 'SURSALAIRE', nombre: joursPayes, base: ent(fiche.sursalaire), gain: sursalaire })
  if (primeAnciennete) gains.push({ code: 100, libelle: "PRIME D'ANCIENNETE", base, taux: tauxAnc, gain: primeAnciennete })
  for (const v of variables || []) {
    if (ent(v.montant)) gains.push({ code: v.code, libelle: v.libelle, gain: ent(v.montant) })
  }
  const brut = gains.reduce((s, g) => s + g.gain, 0)

  const cmu = p.cmu_par_personne * Math.max(1, ent(fiche.personnes_cmu))
  const cnps = taux(brut, p.cnps_salarie)
  const impotBrut = impotBrutITS(brut, p)
  const reduction = ricf(fiche.parts_fiscales, p)
  const its = Math.max(0, impotBrut - reduction)
  const chargesSalariales = cmu + cnps + its

  const plafonne = Math.min(brut, p.plafond_pf_am_at)
  const patronal = [
    { code: 415, libelle: 'CMU', base: null, taux: null, montant: cmu },
    ...p.patronal.map(l => {
      const b = l.plafonne ? plafonne : brut
      return { code: l.code, libelle: l.libelle, base: b, taux: l.taux, montant: taux(b, l.taux) }
    }),
  ]
  const chargesPatronales = patronal.reduce((s, l) => s + l.montant, 0)

  const transport = prorata(fiche.prime_transport)
  const tenue = ent(fiche.prime_tenue)
  const avance = Math.max(0, ent(avances))
  const avantArrondi = brut - chargesSalariales + transport + tenue - avance
  const net = avantArrondi <= 0 ? 0 : Math.ceil(avantArrondi / p.arrondi) * p.arrondi
  const arrondi = avantArrondi <= 0 ? 0 : net - avantArrondi

  return {
    joursPayes,
    anciennete: anc,
    gains,
    brut,
    retenues: { cmu, cnps, impotBrut, ricf: reduction, its },
    chargesSalariales,
    patronal,
    chargesPatronales,
    transport,
    tenue,
    avance,
    avanceNonCouverte: avantArrondi < 0 ? -avantArrondi : 0,
    arrondi,
    net,
    salaireBrutCumul: brut + transport,
    heures: Math.round(p.heures_mois * joursPayes / p.jours_base),
  }
}

// ── Éléments variables : propositions (la RH peut toujours modifier) ──────────

/** Gratification : 75 % du salaire catégoriel, au prorata des mois de présence dans l'année. */
export function propositionGratification(salaireCategoriel, moisPresence, p = PARAMETRES_DEFAUT) {
  const m = Math.min(12, Math.max(0, ent(moisPresence)))
  return Math.round((taux(ent(salaireCategoriel), p.gratification) * m) / 12)
}

/** Jours fériés payés : nombre × salaire catégoriel / 30. */
export function propositionFeries(salaireCategoriel, nombre, p = PARAMETRES_DEFAUT) {
  return Math.round((ent(salaireCategoriel) * Math.max(0, ent(nombre))) / p.jours_base)
}

/** Indemnité de fin de CDD : taux paramétré × brut total perçu pendant le contrat. */
export function propositionFinCdd(brutContrat, p = PARAMETRES_DEFAUT) {
  return taux(ent(brutContrat), p.fin_cdd)
}

/** Congés payés : brut moyen mensuel des 12 derniers mois / 30 × jours pris. */
export function propositionConges(brutDouzeMois, nbMois, jours, p = PARAMETRES_DEFAUT) {
  const mois = Math.max(1, Math.min(12, ent(nbMois)))
  return Math.round((ent(brutDouzeMois) / mois / p.jours_base) * Math.max(0, Number(jours) || 0))
}

/**
 * Taux propres à l'employeur (employeurs_paie) : l'accident du travail dépend
 * de la société (Chez Samer 2 %, Al Kayan 3 %, d'après les bulletins Sage).
 */
export function parametresEmployeur(p, employeur) {
  const at = employeur?.taux_accident_travail == null ? 0 : Number(employeur.taux_accident_travail)
  if (!(at > 0)) return p
  return { ...p, patronal: p.patronal.map(l => (l.code === 490 ? { ...l, taux: at } : l)) }
}

/** Les paramètres applicables à un mois : la ligne la plus récente dont applicable_du ≤ fin du mois. */
export function parametresPour(lignes, finPeriode) {
  const ok = (lignes || [])
    .filter(l => String(l.applicable_du) <= String(finPeriode))
    .sort((a, b) => String(b.applicable_du).localeCompare(String(a.applicable_du)))
  return ok[0] ? { ...PARAMETRES_DEFAUT, ...ok[0].valeurs } : PARAMETRES_DEFAUT
}
