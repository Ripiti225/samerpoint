function photoConsultable(uri) {
  return typeof uri === 'string' && (
    /^https?:\/\//i.test(uri) || uri.startsWith('pending-photo://')
  )
}

// Contrôle commun à la sauvegarde des déductions et à la validation du point.
// Un paiement de dette seul n'est pas une nouvelle facture à photographier.
export function facturesGerantSansPhoto(fournisseurs) {
  return Object.entries(fournisseurs || {})
    .filter(([, saisie]) => parseFloat(saisie?.montant_facture) > 0 && !photoConsultable(saisie?.photoUri))
    .map(([id]) => id)
}

// Les anciennes saisies gérant ont parfois perdu `transactions_fournisseurs.photo_url`,
// alors que la même photo distante est toujours conservée dans `points.draft_gerant`
// et donc visible dans Vérification. Aligne la vue mensuelle sur cette source de repli
// sans attribuer la photo du gérant à une transaction de caissier du même fournisseur.
export function restaurerPhotosFacturesDepuisPoints(transactions, points) {
  const photosGerant = new Map()

  ;(points || []).forEach(point => {
    const fournisseurs = point?.draft_gerant?.fournisseurs || {}
    Object.entries(fournisseurs).forEach(([fournisseurId, saisie]) => {
      if (photoConsultable(saisie?.photoUri)) {
        photosGerant.set(`${point.id}|${fournisseurId}`, saisie.photoUri)
      }
    })
  })

  return (transactions || []).map(transaction => {
    const estSaisieGerant = transaction.saisi_par === 'gerant' ||
      transaction.saisi_par === 'gerant_caissier' ||
      transaction.source === 'deduction_gerant'
    if (
      !estSaisieGerant ||
      photoConsultable(transaction.photo_url)
    ) return transaction

    const photo = photosGerant.get(`${transaction.point_id}|${transaction.fournisseur_id}`)
    return photo ? { ...transaction, photo_url: photo } : transaction
  })
}

// Prépare les lignes du modal « Voir l'historique ». Les points sont nécessaires
// même lorsque `date_point` est déjà renseignée : ils portent aussi les photos de
// secours que Vérification utilise pour les anciennes saisies gérant.
export function preparerHistoriqueFournisseur(transactions, points) {
  const dateParPoint = new Map((points || []).map(point => [point.id, point.date]))
  const liste = restaurerPhotosFacturesDepuisPoints(transactions, points).map(transaction => ({
    ...transaction,
    date_point: transaction.date_point || dateParPoint.get(transaction.point_id) || null,
  }))

  const jour = transaction => transaction.date_point || String(transaction.created_at || '').slice(0, 10)
  return liste.sort((a, b) => {
    const dateA = jour(a)
    const dateB = jour(b)
    if (dateA !== dateB) return dateA < dateB ? 1 : -1
    return String(a.created_at) < String(b.created_at) ? 1 : -1
  })
}

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
