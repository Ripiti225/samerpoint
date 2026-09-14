/**
 * Calcule une décision d'écart d'inventaire avec les mêmes bornes que le RPC.
 * Le calcul reste pur afin que la console et SamerTrackly puissent le tester.
 */
export function calculerDecisionInventaire({ statut, ecart, nombreExplique, quantiteProposee, prix }) {
  if (statut !== 'validee' && statut !== 'refusee') {
    throw new Error('Statut de décision invalide')
  }

  const ecartNombre = Number(ecart)
  const expliqueNombre = Number(nombreExplique)
  const prixNombre = Number(prix)
  if (!Number.isFinite(ecartNombre)) throw new Error('Écart inventaire invalide')
  if (!Number.isFinite(expliqueNombre) || expliqueNombre < 0) {
    throw new Error('Quantité expliquée invalide')
  }
  if (!Number.isFinite(prixNombre) || prixNombre < 0) throw new Error('Prix produit invalide')

  const ecartAbs = Math.abs(ecartNombre)
  const proposeeNombre = quantiteProposee == null ? expliqueNombre : Number(quantiteProposee)
  if (!Number.isFinite(proposeeNombre) || proposeeNombre < 0) {
    throw new Error('Quantité acceptée invalide')
  }
  const quantiteAcceptee = statut === 'validee'
    ? Math.min(ecartAbs, proposeeNombre)
    : 0

  return {
    quantiteAcceptee,
    montantDeduit: Math.round(Math.max(0, ecartAbs - quantiteAcceptee) * prixNombre),
  }
}
