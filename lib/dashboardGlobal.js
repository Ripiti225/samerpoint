// ──────────────────────────────────────────────────────────────────────────────
// Les agrégats du Dashboard Global, sortis de l'écran.
//
// `vueGlobale` ne connaît pas l'existence de la comparaison : elle reçoit des
// points et des coûts, elle rend des totaux. C'est précisément ce qui permet
// aux deux termes A et B d'être calculés par le même code — un agrégat
// dupliqué dans le rendu finirait par divorcer de l'autre.
//
// Deux distinctions que ce module refuse de perdre :
//
//   • « aucun point saisi » n'est pas « zéro de vente ». Un restaurant dont
//     personne n'a validé le point n'a pas fait 0 F ; on ne sait pas. D'où
//     `nbJours` porté sur chaque restaurant et sur le total.
//   • un taux sur des ventes nulles vaut 0, jamais NaN ni Infinity.
//
// Tests : lib/dashboardGlobal.test.mjs
// ──────────────────────────────────────────────────────────────────────────────
import { FOURNISSEURS_LABOR, FOURNISSEURS_NON_FOOD } from './constants.js'
import { venteRetenue, venteTheorique } from './venteMachine.js'
import { tauxSalarial, tauxSalarialTotal } from './tauxSalarial.js'

/** Les catégories de dépenses qui pèsent sur le coût matières. */
export const CATEGORIES_FOOD = ['Marché', 'Légumes', 'Fruits']

/** Les canaux du mix, dans l'ordre d'affichage, avec leur colonne dans `points`. */
export const CANAUX = [
  { cle: 'yango_cse', nom: 'Yango' },
  { cle: 'glovo_cse', nom: 'Glovo' },
  { cle: 'wave', nom: 'Wave' },
  { cle: 'om', nom: 'OM' },
  { cle: 'djamo', nom: 'Djamo' },
]

function nombre(v) {
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

/** Rentabilité en pourcentage. Ventes nulles → 0 : on ne divise pas par zéro. */
export function tauxRenta(ventes, benefice) {
  if (!ventes) return 0
  return (benefice / ventes) * 100
}

/** Part d'un montant dans le CA, en pourcentage. CA nul → 0. */
export function part(montant, ca) {
  if (!ca) return 0
  return (montant / ca) * 100
}

export function couleurResto(c) {
  return { vert: '#2D7D46', bleu: '#185FA5', rouge: '#A32D2D', violet: '#534AB7' }[c] || '#EF9F27'
}

export function familleResto(nom) {
  return (nom || '').toLowerCase().includes('al kayan') ? 'Al Kayan' : 'Samer'
}

export function courtNom(nom) {
  if (!nom) return ''
  if (nom.length <= 9) return nom
  return nom.substring(0, 8) + '…'
}

/** « 12 400 000 FCFA » — la seule écriture d'un montant dans tout l'écran. */
export function fmtFCFA(n) {
  return Math.round(nombre(n)).toLocaleString('fr-FR').replace(/ /g, ' ') + ' FCFA'
}

/** Coût matières d'un restaurant : dépenses food + fournisseurs hors non-food. */
export function foodCostMontant({ depenses = [], fournisseurs = [] } = {}) {
  const depFood = depenses
    .filter(d => CATEGORIES_FOOD.includes(d?.categorie))
    .reduce((s, d) => s + nombre(d.montant), 0)
  const fournFood = fournisseurs
    .filter(t => !FOURNISSEURS_NON_FOOD.has(t?.nom))
    .reduce((s, t) => s + nombre(t.paye), 0)
  return depFood + fournFood
}

/** Coût salaire : présences payées + fournisseurs de main-d'œuvre + paies gérant. */
export function laborCostMontant({ presences = [], fournisseurs = [], paiesGerant = 0 } = {}) {
  const pres = presences.reduce((s, p) => s + nombre(p?.paye), 0)
  const fournLabor = fournisseurs
    .filter(t => FOURNISSEURS_LABOR.has(t?.nom))
    .reduce((s, t) => s + nombre(t.paye), 0)
  return pres + fournLabor + nombre(paiesGerant)
}

/**
 * Fond de caisse reçu par un point. Deux colonnes selon le chemin de saisie :
 * `fond_recu` (Modifier le point) prime, `fc_compte` (validation gérant) sinon —
 * la même règle que l'écran Vérification.
 */
export function fondRecuPoint(p) {
  return nombre(p?.fond_recu) || nombre(p?.fc_compte)
}

/** Les jours où un restaurant a reçu du fond, du plus récent au plus ancien. */
export function detailFondRecu(points = []) {
  return (points || [])
    .map(p => ({ date: p?.date, montant: fondRecuPoint(p) }))
    .filter(j => j.date && j.montant !== 0)
    .sort((x, y) => (x.date < y.date ? 1 : -1))
}

/** Charges fixes d'un restaurant, telles que la table `charges` les donne. */
export function chargesFixesMontant(charges = [], restaurantId) {
  return charges
    .filter(c => c?.restaurant_id === restaurantId)
    .reduce((s, c) => s + nombre(c.montant), 0)
}

/**
 * Une vue complète, pour un ensemble de restaurants et une période.
 *
 * @param {object} args
 * @param {Record<string, object[]>} args.points  lignes `points` par restaurant
 * @param {object[]} args.restaurants             [{ id, nom, couleur }] — les restaurants VUS
 * @param {object} [args.couts]                   { depenses, presences, fournisseurs, paiesGerant, charges, periode }
 *                                                periode { debut, fin } : sans elle, pas de taux salarial
 * @returns {object} vue — voir les clés en fin de fonction
 */
export function vueGlobale({ points = {}, restaurants = [], couts = {} } = {}) {
  const {
    depenses = {}, presences = {}, fournisseurs = {},
    paiesGerant = {}, charges = [], periode = null,
  } = couts

  // Tolère une liste d'identifiants nus autant qu'une liste d'objets.
  const liste = (restaurants || []).map(r => (typeof r === 'string' ? { id: r, nom: r } : r)).filter(Boolean)

  const lignes = liste.map(r => {
    const pts = points[r.id] || []
    // Vente = vente machine ; la théorique n'est que le comparatif (lib/venteMachine.js).
    const ventes = pts.reduce((s, p) => s + venteRetenue(p), 0)
    const ventesTheo = pts.reduce((s, p) => s + venteTheorique(p), 0)
    const depensesTotal = pts.reduce((s, p) => s + nombre(p.depense_total), 0)
    const benefice = pts.reduce((s, p) => s + nombre(p.benefice_sc), 0)
    const livraisonMt = pts.reduce((s, p) => s + nombre(p.yango_cse) + nombre(p.glovo_cse), 0)
    const fondRecu = pts.reduce((s, p) => s + fondRecuPoint(p), 0)
    const joursFondRecu = pts.filter(p => fondRecuPoint(p) !== 0).length

    const foodMt = foodCostMontant({
      depenses: depenses[r.id], fournisseurs: fournisseurs[r.id],
    })
    const laborMt = laborCostMontant({
      presences: presences[r.id], fournisseurs: fournisseurs[r.id], paiesGerant: paiesGerant[r.id],
    })
    const chargesFixesMt = chargesFixesMontant(charges, r.id)
    const salaire = periode?.debut && periode?.fin ? tauxSalarial({
      presences: presences[r.id], paiesGerant: paiesGerant[r.id], charges,
      restaurantId: r.id, debut: periode.debut, fin: periode.fin, ventes,
    }) : null

    return {
      id: r.id,
      nom: r.nom,
      court: courtNom(r.nom),
      couleur: couleurResto(r.couleur),
      famille: familleResto(r.nom),
      nbJours: pts.length,
      ventes,
      ventesTheo,
      depenses: depensesTotal,
      benefice,
      renta: tauxRenta(ventes, benefice),
      foodMt,
      laborMt,
      chargesFixesMt,
      foodPct: part(foodMt, ventes),
      laborPct: part(laborMt, ventes),
      primeMt: foodMt + laborMt,
      primePct: part(foodMt, ventes) + part(laborMt, ventes),
      chargesFixesPct: part(chargesFixesMt, ventes),
      salaire,
      salaireMt: salaire?.total || 0,
      salairePct: salaire?.pct || 0,
      livraisonMt,
      surPlaceMt: Math.max(ventes - livraisonMt, 0),
      pctLivraison: part(livraisonMt, ventes),
      fondRecu,
      joursFondRecu,
    }
  })

  const somme = champ => lignes.reduce((s, l) => s + l[champ], 0)
  const ventes = somme('ventes')
  const foodMt = somme('foodMt')
  const laborMt = somme('laborMt')
  const chargesFixesMt = somme('chargesFixesMt')
  const livraisonMt = somme('livraisonMt')
  const benefice = somme('benefice')
  const salaire = periode?.debut && periode?.fin ? tauxSalarialTotal(lignes.map(l => l.salaire), ventes) : null

  const total = {
    ventes,
    ventesTheo: somme('ventesTheo'),
    depenses: somme('depenses'),
    benefice,
    renta: tauxRenta(ventes, benefice),
    nbJours: somme('nbJours'),
    nbRestosAvecPoints: lignes.filter(l => l.nbJours > 0).length,
    foodMt,
    laborMt,
    primeMt: foodMt + laborMt,
    chargesFixesMt,
    foodPct: part(foodMt, ventes),
    laborPct: part(laborMt, ventes),
    primePct: part(foodMt, ventes) + part(laborMt, ventes),
    chargesFixesPct: part(chargesFixesMt, ventes),
    salaire,
    salaireMt: salaire?.total || 0,
    salairePct: salaire?.pct || 0,
    livraisonMt,
    surPlaceMt: Math.max(ventes - livraisonMt, 0),
    pctLivraison: part(livraisonMt, ventes),
    aDesCharges: charges.length > 0,
    fondRecu: somme('fondRecu'),
    joursFondRecu: somme('joursFondRecu'),
  }

  // Somme par date sur les restaurants vus : la série des courbes d'évolution.
  const parDate = {}
  lignes.forEach(l => {
    (points[l.id] || []).forEach(p => {
      if (!p?.date) return
      const g = (parDate[p.date] ||= { date: p.date, vente: 0, vente_theorique: 0, depense_total: 0, benefice_sc: 0 })
      g.vente += venteRetenue(p)
      g.vente_theorique += venteTheorique(p)
      g.depense_total += nombre(p.depense_total)
      g.benefice_sc += nombre(p.benefice_sc)
    })
  })
  const serieJours = Object.values(parDate).sort((a, b) => (a.date < b.date ? -1 : 1))

  const tousLesPoints = lignes.flatMap(l => points[l.id] || [])
  const mixCanaux = CANAUX
    .map(c => ({ canal: c.nom, cle: c.cle, montant: tousLesPoints.reduce((s, p) => s + nombre(p[c.cle]), 0) }))
    .filter(c => c.montant > 0)

  return {
    lignes,
    total,
    serieJours,
    mixCanaux,
    classement: [...lignes].sort((a, b) => b.benefice - a.benefice),
    classementCouts: [...lignes].sort((a, b) => b.primePct - a.primePct),
  }
}
