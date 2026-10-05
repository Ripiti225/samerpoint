// ──────────────────────────────────────────────────────────────────────────────
// Les écarts ESPÈCES du tiroir mesurés par le POS, ventilés par caissière.
//
// Sur un site basculé, `points.ecart_caisse` (calculé par Samtrackly comme
// « vente des shifts − vente machine ») vaut structurellement 0 : les deux
// nombres deviennent deux vues du même système. Ce n'est pas un bug, mais ça
// veut dire que l'écran Ventes ne doit plus lire celui-là.
//
// Ce montant vient de `services_caisse.ecart` et il est stocké dans
// `points_shifts.ecart_pos`. Il ne doit jamais être présenté comme l'écart
// global de réconciliation, dont la source distincte est `rapport_z.diff`
// (`points_shifts.ecart_reconciliation`).
//
// Tests : lib/ecartPOS.test.mjs (`npm test`).
// ──────────────────────────────────────────────────────────────────────────────

/** Libellé de repli : on ne fait jamais disparaître un montant faute de nom. */
const CAISSIER_INCONNU = 'Caissier non identifié'

/**
 * Ventile les écarts mesurés d'une journée.
 *
 * Un écart mesuré à **zéro** est une mesure (le tiroir tombait juste), pas une
 * absence de mesure — d'où le test sur `null`/`undefined` et non sur la valeur.
 * Confondre les deux, c'est soit inventer un écart, soit en cacher un.
 *
 * @param {{caissier_nom: string|null, ecart_pos: number|null, explication_ecart?: string|null}[]} shifts
 * @returns {{lignes: {nom: string, ecart: number, explication?: string}[], total: number,
 *            mesures: number, sansMesure: number}}
 */
export function ecartsParCaissier(shifts) {
  const lignes = []
  let total = 0
  let sansMesure = 0

  for (const s of shifts || []) {
    const brut = s?.ecart_pos
    if (brut === null || brut === undefined || brut === '') {
      sansMesure++
      continue
    }
    const ecart = Number(brut)
    if (!Number.isFinite(ecart)) {
      sansMesure++
      continue
    }
    const ligne = { nom: (s.caissier_nom || '').trim() || CAISSIER_INCONNU, ecart }
    const explication = String(s?.explication_ecart ?? '').trim()
    if (explication) ligne.explication = explication
    lignes.push(ligne)
    total += ecart
  }

  return { lignes, total, mesures: lignes.length, sansMesure }
}

/** Marqueur de provenance, pour que l'écran dise QUI a désigné le responsable. */
export const SOURCE_MESURE_POS = 'POS'

/** Provenance des décisions prises dans Vérification sur un shift POS précis. */
export const SOURCE_DECISION_POS = 'verification_pos'

/**
 * Colonnes de `points_shifts` nécessaires pour déduire les responsables.
 * (La colonne du nom est bien `caissier_nom`.)
 */
export const CHAMPS_SHIFT_ECART =
  'id, point_id, restaurant_id, date, caissier_id, caissier_nom, pos_service_id, ecart_pos, explication_ecart'

/** Les mêmes sans les colonnes du POS, si supabase_pos_bascule.sql n'est pas passée. */
export const CHAMPS_SHIFT_ECART_LEGACY =
  'id, point_id, restaurant_id, date, caissier_id, caissier_nom'

/**
 * Déduit les responsables d'un écart à partir des shifts POS.
 *
 * Un shift = une caissière, et `ecart_pos` est l'écart que SA caisse a mesuré
 * au comptage à l'aveugle. La responsabilité est donc déjà nominative : la
 * redemander au gérant dans Samtrackly revenait à lui faire retaper le même
 * écart sous un autre nom (cf. lib/sourcePoint.js, écran Ventes).
 *
 * Les lignes sortent au format de la table `litiges_responsables`, pour que
 * l'écran Litiges les affiche sans savoir d'où elles viennent. Elles ne sont
 * jamais écrites en base : elles sont recalculées à chaque lecture, donc elles
 * suivent automatiquement une resynchronisation du POS.
 *
 * Convention de signe (supabase_pos_bascule.sql) : `ecart_pos` NÉGATIF = il
 * manque de l'argent. Le `montant` sort toujours positif, comme les lignes
 * imputées à la main, et c'est `type` qui porte le sens.
 *
 * Un écart mesuré à zéro n'est pas un litige : personne n'est responsable de
 * rien. Un shift sans mesure non plus — il n'est pas silencieusement compté
 * pour 0 (cf. `ecartsParCaissier`).
 *
 * @param {object[]} shifts  shifts bruts, colonnes CHAMPS_SHIFT_ECART
 */
export function decisionEcartShiftPOS(shift, regularisations) {
  const ecart = Number(shift?.ecart_pos)
  const montantBrut = Number.isFinite(ecart) ? Math.abs(ecart) : 0
  const correspond = (r) => {
    if (r?.source !== SOURCE_DECISION_POS) return false
    if (r.point_id && shift?.point_id && String(r.point_id) !== String(shift.point_id)) return false
    if (r.shift_id != null) return String(r.shift_id) === String(shift?.id)
    return Boolean(r.pos_service_id && shift?.pos_service_id
      && String(r.pos_service_id) === String(shift.pos_service_id))
  }
  const liees = (regularisations || []).filter(correspond)
  const neutralise = liees
    .filter(r => r?.decision !== 'refusee')
    .reduce((total, r) => total + Math.max(0, Number(r?.montant) || 0), 0)
  const restant = Math.max(0, Math.round(montantBrut - neutralise))
  const derniere = liees[liees.length - 1] || null

  return {
    statut: derniere?.decision || null,
    restant,
    solde: montantBrut > 0 && restant === 0,
    regularisations: liees,
  }
}

/**
 * Écart d'une journée sur un site POS, pour Litiges : la somme de ce qui
 * reste dû sur chaque shift (manquants seulement), après les décisions prises
 * shift par shift dans Vérification — exactement ce que montre la liste des
 * responsables. Un surplus n'est pas un litige et n'efface pas le manquant
 * d'un autre shift.
 *
 * null si un shift de la journée n'a pas de mesure POS (site sans POS, ou
 * mesure incomplète) : l'appelant garde alors le calcul machine − shifts.
 */
export function ecartJourPOS(shifts, regularisations = []) {
  const liste = shifts || []
  const mesure = s => s?.ecart_pos !== null && s?.ecart_pos !== undefined && s?.ecart_pos !== ''
    && Number.isFinite(Number(s.ecart_pos))
  if (liste.length === 0 || !liste.every(mesure)) return null
  return liste
    .filter(s => Number(s.ecart_pos) < 0)
    .reduce((total, s) => total + decisionEcartShiftPOS(s, regularisations).restant, 0)
}

export function responsablesEcartPOS(shifts, regularisations = []) {
  const lignes = []
  for (const s of shifts || []) {
    const brut = s?.ecart_pos
    if (brut === null || brut === undefined || brut === '') continue
    const ecart = Number(brut)
    if (!Number.isFinite(ecart) || ecart === 0) continue
    const decision = decisionEcartShiftPOS(s, regularisations)
    if (decision.restant === 0) continue
    const explication = String(s?.explication_ecart ?? '').trim()
    lignes.push({
      id: `pos:${s.id}`,
      point_id: s.point_id || null,
      restaurant_id: s.restaurant_id || null,
      date: s.date || null,
      responsable_id: s.caissier_id || null,
      responsable_nom: (s.caissier_nom || '').trim() || CAISSIER_INCONNU,
      role: 'caissier',
      montant: decision.restant,
      type: ecart < 0 ? 'manquant' : 'surplus',
      explication: explication || null,
      source: SOURCE_MESURE_POS,
    })
  }
  return lignes
}

/**
 * Fusionne l'imputation manuelle du gérant et la mesure du POS.
 *
 * Règle unique : **sur une journée déjà imputée à la main, la main gagne.**
 * Sans ça, les journées d'avant la bascule — où le gérant ÉTAIT obligé de
 * désigner un responsable pour valider son point — verraient le même écart
 * compté deux fois, une fois par le gérant et une fois par le POS. Doubler un
 * manquant, c'est le facturer deux fois à quelqu'un.
 *
 * L'appariement se fait sur le point, et à défaut sur restaurant + date : les
 * plus vieilles lignes de `litiges_responsables` n'ont pas de `point_id`.
 */
export function fusionnerResponsablesEcart(manuels, mesuresPOS) {
  const dejaImpute = new Set()
  for (const r of manuels || []) {
    if (r?.point_id) dejaImpute.add(`p:${r.point_id}`)
    if (r?.date) dejaImpute.add(`d:${r.restaurant_id || ''}|${r.date}`)
  }
  const retenues = (mesuresPOS || []).filter(r =>
    !dejaImpute.has(`p:${r.point_id}`) &&
    !dejaImpute.has(`d:${r.restaurant_id || ''}|${r.date}`)
  )
  return [...(manuels || []), ...retenues]
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
}
