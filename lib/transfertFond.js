// ──────────────────────────────────────────────────────────────────────────────
// Fond de caisse négatif remis à 0 (en tout ou en partie) : le trou part en
// dette administration (l'administration doit la somme au restaurant) ou chez
// le fournisseur « Report caisse » du restaurant. Logique pure ; les écritures
// sont faites par la fonction SQL transferer_fond_negatif.
// Spéc : docs/superpowers/specs/2026-10-12-fond-negatif-transfert-design.md
// Tests : lib/transfertFond.test.mjs
// ──────────────────────────────────────────────────────────────────────────────
import { derniersPoints, fondLaisse } from './alertes.js'

export { fondLaisse }

export const DESTINATIONS = {
  dette_admin: {
    label: 'Dette administration',
    detail: "L'administration doit cette somme au restaurant (Trésorerie → Dettes).",
  },
  report_caisse: {
    label: 'Report caisse',
    detail: 'Le crédit du fournisseur « Report caisse » du restaurant monte d’autant.',
  },
}

const n = v => Number(v) || 0
const fmtF = v => `${Math.round(n(v)).toLocaleString('fr-FR').replace(/[  ]/g, ' ')} F`

// Tout le négatif, arrondi au franc supérieur (certains fonds ont des centimes).
export function montantMaxTransfert(fond) {
  const f = n(fond)
  return f < 0 ? Math.ceil(-f) : 0
}

export function fondApres(fond, montant) {
  return n(fond) + n(montant)
}

// Message d'erreur en français, ou null si le transfert est possible.
export function validerTransfert({ fond, montant, destination }) {
  if (!DESTINATIONS[destination]) return 'Choisissez où transférer : dette administration ou Report caisse.'
  const max = montantMaxTransfert(fond)
  if (!max) return "Le fond de ce restaurant n'est pas négatif."
  const m = Number(montant)
  if (!Number.isInteger(m) || m <= 0) return 'Saisissez un montant supérieur à 0.'
  if (m > max) return `Le montant dépasse le fond négatif (${fmtF(max)} maximum).`
  return null
}

// Restaurants dont le dernier point validé laisse un fond négatif, du plus
// creusé au moins creusé.
export function fondsNegatifs(points = [], nomResto = id => id) {
  return Object.entries(derniersPoints(points))
    .map(([id, p]) => ({ restaurant_id: id, nom: nomResto(id), fond: fondLaisse(p), date: p.date }))
    .filter(f => f.fond < 0)
    .sort((a, b) => a.fond - b.fond)
}
