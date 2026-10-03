// ──────────────────────────────────────────────────────────────────────────────
// Retenue sur litiges (salaires) — supabase_tresorerie_retenues_litiges.sql.
//
// Sur les salaires d'un mois, le RH retient une partie des litiges du
// restaurant : « 30% » (une part du total) ou « 40000 » (un montant). Le reste
// est annulé. Les salaires à payer baissent du montant retenu ; le résultat net
// garde la charge entière et compte le montant retenu en revenu.
// Pur : testé par lib/retenueLitiges.test.mjs.
// ──────────────────────────────────────────────────────────────────────────────

/**
 * « 30% », « 30 % », « 40000 », « 40 000 » → { mode, valeur, retenu, annule }
 * ou { erreur }. Vide → retenue nulle (tout est annulé ? non : rien n'est décidé).
 */
export function lireRegleRetenue(texte, totalLitiges) {
  const total = Math.max(0, Math.round(Number(totalLitiges) || 0))
  const t = String(texte ?? '').replace(/\s/g, '').replace(',', '.')
  if (!t) return { vide: true, retenu: 0, annule: 0 }
  const pct = /^(\d+(?:\.\d+)?)%$/.exec(t)
  if (pct) {
    const p = Number(pct[1])
    if (p > 100) return { erreur: 'Le pourcentage ne peut pas dépasser 100 %.' }
    const retenu = Math.round((total * p) / 100)
    return { mode: 'pct', valeur: p, regle: `${pct[1]}%`, retenu, annule: total - retenu }
  }
  if (/^\d+$/.test(t)) {
    const m = Number(t)
    if (m > total) return { erreur: `On ne peut pas retenir plus que les litiges du mois (${total.toLocaleString('fr-FR')} F).` }
    return { mode: 'montant', valeur: m, regle: String(m), retenu: m, annule: total - m }
  }
  return { erreur: 'Écrivez un pourcentage (ex. 30%) ou un montant (ex. 40000).' }
}

/** Phrase de la fiche : « Litiges 200 000 · retenu 60 000 (30 %) · annulé 140 000 ». */
export function phraseRetenue({ litiges_total: total, retenue_litiges: retenu, retenue_regle: regle }) {
  const f = v => `${Math.round(Number(v) || 0).toLocaleString('fr-FR')} F`
  const r = Number(retenu) || 0
  const tot = Number(total) || 0
  const precision = String(regle || '').endsWith('%') ? ` (${regle.replace('%', ' %')})` : ''
  return `Litiges ${f(tot)} · retenu ${f(r)}${precision} · annulé ${f(Math.max(0, tot - r))}`
}
