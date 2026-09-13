// Regroupe les mouvements d'un mois sans perdre le détail des factures.
// La vue mensuelle a besoin de ce détail pour afficher les justificatifs.
export function agregerMouvementsMensuels(transactions, nomsParFournisseur = {}) {
  const agg = {}
  let totalFacture = 0
  let totalPaye = 0

  ;(transactions || []).forEach(t => {
    const facture = parseFloat(t.facture) || 0
    const paye = parseFloat(t.paye) || 0
    totalFacture += facture
    totalPaye += paye

    const groupe = (agg[t.fournisseur_id] ||= {
      id: t.fournisseur_id,
      nom: t.fournisseur_nom || nomsParFournisseur[t.fournisseur_id] || 'Fournisseur',
      facture: 0,
      paye: 0,
      factures: [],
    })
    groupe.facture += facture
    groupe.paye += paye

    if (facture !== 0) {
      groupe.factures.push({
        id: t.id,
        montant: facture,
        photo_url: t.photo_url || null,
        date: t.date_point || String(t.created_at || '').slice(0, 10),
      })
    }
  })

  const parFourn = Object.values(agg)
    .map(g => ({
      ...g,
      nom: g.nom || nomsParFournisseur[g.id] || 'Fournisseur',
      factures: g.factures.sort((a, b) => String(b.date).localeCompare(String(a.date))),
    }))
    .filter(g => g.facture !== 0 || g.paye !== 0)
    .sort((a, b) => (b.facture + b.paye) - (a.facture + a.paye))

  return { totalFacture, totalPaye, parFourn }
}
