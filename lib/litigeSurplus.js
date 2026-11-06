// ──────────────────────────────────────────────────────────────────────────────
// Litige manuel sur un surplus de stock (Vérification → Stock).
// Module pur. Écriture : fixerLitigeSurplus (lib/api.js, supabase_litige_surplus.sql).
// Conception : docs/superpowers/specs/2026-11-06-litige-surplus-verification-design.md
//
// Le montant est toujours saisi à la main : les comptages contiennent des
// erreurs de frappe, surplus × prix n'est qu'une suggestion.
// ──────────────────────────────────────────────────────────────────────────────

export const SEUIL_ALERTE_LITIGE = 50000

export const estSurplus = ligne => (Number(ligne?.ecart) || 0) > 0.01

export const suggestionLitige = ({ ecart, prix } = {}) => Math.round(Math.abs(Number(ecart) || 0) * (Number(prix) || 0))

/** Montant saisi en francs entiers ; null si vide ou illisible (jamais 0 par défaut). */
export function lireMontantLitige(texte) {
  const t = String(texte ?? '').replace(/\s/g, '')
  return /^\d+$/.test(t) ? parseInt(t, 10) : null
}

/** 'litige' | 'decider' | 'modifier' selon l'état de la ligne ; null = aucune action sur ce surplus. */
export function actionSurplus(ligne) {
  if (!estSurplus(ligne) || !ligne.id || ligne.deduction_annulee) return null
  if (!ligne.explication_statut) return 'litige'
  return ligne.explication_statut === 'en_attente' ? 'decider' : 'modifier'
}

/** Texte de la notification envoyée au gérant. */
export function messageLitige({ produit, montant, caissier, date }) {
  const jour = date ? ` (point du ${String(date).split('-').reverse().join('/')})` : ''
  if (!montant) return `${produit}${jour} : le litige sur ce surplus est retiré.`
  const qui = caissier || 'le caissier du shift'
  return `Surplus sur ${produit}${jour} : litige de ${Number(montant).toLocaleString('fr-FR')} F imputé à ${qui}. Rentrez vos produits à leur arrivée.`
}
