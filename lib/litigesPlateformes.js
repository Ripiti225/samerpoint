// ──────────────────────────────────────────────────────────────────────────────
// Litiges Yango / Glovo automatiques — calcul pur.
// docs/superpowers/specs/2026-10-09-litiges-plateformes-auto-design.md
//
// On compare, plat par plat et jour par jour (minuit → minuit, Abidjan = UTC),
// les ventes partenaires tapées dans le POS aux commandes vendues sur le
// portail. Plat en trop dans le POS → tapé + (repère la vente sur place
// déclarée Yango/Glovo) ; plat en moins → tapé −.
// Utilisé par l'Edge Function ingest-commandes-plateformes.
// Pur : testé par lib/litigesPlateformes.test.mjs.
// ──────────────────────────────────────────────────────────────────────────────
import { caissierAuMoment } from './attributionAvis.js'

export const SEUIL_LITIGE = 1000

export function normaliserNom(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/** « 101791205516 » → « 5516 » : ce que le caissier tape dans le POS. */
export function quatreChiffres(ref) {
  const chiffres = String(ref ?? '').replace(/\D/g, '')
  return chiffres.length >= 4 ? chiffres.slice(-4) : null
}

/** Livrée, ou Yango annulée mais payée au restaurant. */
export function compteCommeVendue(c) {
  if (c.statut === 'livree') return true
  return c.statut === 'annulee' && c.plateforme === 'yango' && (Number(c.montant_paye) || 0) > 0
}

export const jourDe = iso => new Date(iso).toISOString().slice(0, 10)
export const heureDe = iso => new Date(iso).toISOString().slice(11, 16)

const mots = s => new Set(normaliserNom(s).split(' ').filter(Boolean))

/** Nom POS le plus proche (mots communs / mots en tout ≥ 0,5), sinon null. */
export function proposerCorrespondance(nomPlateforme, nomsPos) {
  const a = mots(nomPlateforme)
  let meilleur = null, score = 0
  for (const nom of nomsPos || []) {
    const b = mots(nom)
    const communs = [...a].filter(m => b.has(m)).length
    const s = communs / (new Set([...a, ...b]).size || 1)
    if (s > score) { score = s; meilleur = nom }
  }
  return score >= 0.5 ? meilleur : null
}
