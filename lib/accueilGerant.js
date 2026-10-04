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

/**
 * Caissiers d'hier, dans l'ordre des shifts : vente du shift, écart avec le
 * POS (`ecart_pos`) et l'explication écrite par le caissier. Un écart non nul
 * sans explication est signalé.
 */
export function lignesCaissiersHier(shifts = []) {
  const hh = h => (h ? String(h).slice(0, 5) : '…')
  return [...(shifts || [])]
    .sort((a, b) => String(a.heure_debut || '').localeCompare(String(b.heure_debut || '')))
    .map(s => {
      const ecart = Number(s.ecart_pos) || 0
      const explication = String(s.explication_ecart || '').trim()
      return {
        cle: s.id,
        nom: String(s.caissier_nom || 'Caissier').trim(),
        horaire: `${hh(s.heure_debut)} → ${hh(s.heure_fin)}`,
        vente: Number(s.vente_shift) || 0,
        ecart,
        sensEcart: ecart === 0 ? 'nul' : ecart < 0 ? 'negatif' : 'positif',
        explication,
        sansExplication: ecart !== 0 && !explication,
      }
    })
}
