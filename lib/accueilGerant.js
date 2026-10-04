// ──────────────────────────────────────────────────────────────────────────────
//  ACCUEIL GÉRANT — textes du bandeau du jour (pur, testé)
//  Tests : lib/accueilGerant.test.mjs.
// ──────────────────────────────────────────────────────────────────────────────

const pl = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`

/** État du point d'hier ; les corrections demandées par le manager passent avant tout. */
export function etatPointHier({ point, nbCorrections = 0 }) {
  if (nbCorrections > 0) {
    return { cle: 'corrections', texte: `${pl(nbCorrections, 'correction demandée', 'corrections demandées')} par le manager` }
  }
  if (!point) return { cle: 'absent', texte: "Point d'hier pas encore saisi" }
  if (point.valide && point.verifie) return { cle: 'verifie', texte: "Point d'hier validé et vérifié" }
  if (point.valide) return { cle: 'valide', texte: "Point d'hier validé" }
  return { cle: 'en_attente', texte: "Point d'hier pas encore validé" }
}

export function texteDemandes({ demandes = 0, explications = 0 }) {
  const parts = []
  if (demandes) parts.push(`${pl(demandes, 'demande', 'demandes')} en attente`)
  if (explications) parts.push(`${pl(explications, 'explication', 'explications')} en cours`)
  return parts.length ? parts.join(' · ') : 'Aucune demande en attente'
}
