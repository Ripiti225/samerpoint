// ──────────────────────────────────────────────────────────────────────────────
// Les déductions du gérant (dépenses, fournisseurs payés, paies) sont
// enregistrées en base par « Déductions gérant » dans `points.draft_gerant`,
// mais l'écran de validation lisait seulement la mémoire du téléphone
// (AppContext). Session de 8 h expirée, autre téléphone, reconnexion : la
// mémoire est vide et le point est validé avec 0 F de déductions — les
// espèces restantes et le fond sont alors trop hauts.
// Constaté : Angré 7E 06/08 (91 700), Maroc 14/08 (253 500), KMS 13/09 (63 500).
//
// Même formule que totalDepensesGerantCaisse() (context/AppContext.js).
// Tests : lib/brouillonGerant.test.mjs
// ──────────────────────────────────────────────────────────────────────────────

const n = v => parseFloat(v) || 0

function lire(draft) {
  if (!draft) return null
  if (typeof draft !== 'string') return draft
  try { return JSON.parse(draft) } catch { return null }
}

/** Total des déductions d'un brouillon gérant enregistré en base. */
export function totalBrouillonGerant(draft) {
  const d = lire(draft)
  if (!d) return 0
  const cats = Object.values(d.depenses || {})
    .reduce((somme, lignes) => somme + (Array.isArray(lignes) ? lignes : []).reduce((s, l) => s + n(l?.montant), 0), 0)
  const fours = Object.values(d.fournisseurs || {}).reduce((somme, f) => somme + n(f?.paye), 0)
  const paies = (Array.isArray(d.paies) ? d.paies : []).reduce((somme, p) => somme + n(p?.montant), 0)
  return Math.round(cats + fours + paies)
}

/**
 * Faut-il recharger le brouillon de la base dans l'écran ? Seulement quand la
 * mémoire du téléphone n'a aucune déduction alors que la base en a : si le
 * gérant a des déductions à l'écran, ce sont les siennes, on n'y touche pas.
 */
export function brouillonAReprendre({ totalContexte, draft, pointValide }) {
  if (pointValide) return false
  return n(totalContexte) === 0 && totalBrouillonGerant(draft) > 0
}
