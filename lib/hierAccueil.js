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

export function texteHier({ hier, avantHier, semainePrec }, dateHier, [un, plusieurs] = ['avis', 'avis']) {
  const jour = JOURS_COURTS[new Date(`${dateHier}T12:00:00Z`).getUTCDay()]
  const parts = [`Hier : ${hier} ${hier > 1 ? plusieurs : un}`]
  const a = pctEvolution(hier, avantHier)
  const s = pctEvolution(hier, semainePrec)
  if (a !== null && (avantHier || hier)) parts.push(`${fleche(a)} vs avant-hier`)
  if (s !== null && (semainePrec || hier)) parts.push(`${fleche(s)} vs ${jour} dernier`)
  return parts.join(' · ')
}

/** { date: total } d'une valeur numérique de lignes datées. */
export function totalParJour(lignes = [], cle) {
  const out = {}
  for (const l of lignes) out[l.date] = (out[l.date] || 0) + (Number(l[cle]) || 0)
  return out
}
