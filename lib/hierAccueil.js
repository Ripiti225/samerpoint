// ──────────────────────────────────────────────────────────────────────────────
//  ACCUEIL — le chiffre d'hier et son évolution (pur, testé)
//
//  Lignes « Avis clients » et « Contacts » du bandeau Clients :
//  « Hier : 42 avis · ↑ 14 % vs avant-hier · ↓ 5 % vs sam. dernier ».
//  Le même jour de la semaine d'avant compte : les week-ends ont plus de
//  commandes. Tests : lib/hierAccueil.test.mjs.
// ──────────────────────────────────────────────────────────────────────────────

const JOURS_COURTS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.']

/** Évolution en % arrondie ; null quand il n'y a rien à comparer (base à 0). */
export function pctEvolution(actuel, precedent) {
  if (!precedent) return actuel ? null : 0
  return Math.round(((actuel - precedent) / precedent) * 100)
}

const fleche = p => (p > 0 ? `↑ ${p} %` : p < 0 ? `↓ ${-p} %` : '= stable')

const sens = p => (p > 0 ? 'hausse' : p < 0 ? 'baisse' : 'egal')

/** Chaque comparaison avec son sens (hausse en vert, baisse en rouge à l'affichage). */
export function evolutionsHierDetail({ hier, avantHier, semainePrec }, dateHier) {
  const jour = JOURS_COURTS[new Date(`${dateHier}T12:00:00Z`).getUTCDay()]
  const parts = []
  const a = pctEvolution(hier, avantHier)
  const s = pctEvolution(hier, semainePrec)
  if (a !== null && (avantHier || hier)) parts.push({ texte: `${fleche(a)} vs avant-hier`, sens: sens(a) })
  if (s !== null && (semainePrec || hier)) parts.push({ texte: `${fleche(s)} vs ${jour} dernier`, sens: sens(s) })
  return parts
}

/** « ↑ 8 % vs avant-hier · ↓ 10 % vs sam. dernier » ; '' s'il n'y a rien à comparer. */
export function evolutionsHier(valeurs, dateHier) {
  return evolutionsHierDetail(valeurs, dateHier).map(x => x.texte).join(' · ')
}

export function texteHier(valeurs, dateHier, [un, plusieurs] = ['avis', 'avis']) {
  const evo = evolutionsHier(valeurs, dateHier)
  const debut = `Hier : ${valeurs.hier} ${valeurs.hier > 1 ? plusieurs : un}`
  return evo ? `${debut} · ${evo}` : debut
}

/** { date: total } d'une valeur numérique de lignes datées. */
export function totalParJour(lignes = [], cle) {
  const out = {}
  for (const l of lignes) out[l.date] = (out[l.date] || 0) + (Number(l[cle]) || 0)
  return out
}
