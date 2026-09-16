const LIBELLES_SHIFT = {
  matin: 'Shift Matin',
  soir: 'Shift Soir',
  nuit: 'Shift Nuit',
  double: 'Shift Double',
}

/**
 * Prépare la source unique des entrées affichées dans le récapitulatif d'un
 * point. Dès qu'une réception venue du POS existe, l'ancien format ne doit
 * plus apparaître à côté : il ne sert que de repli pour les journées passées.
 */
export function preparerEntreesVerification({
  inventaires = [],
  entrees = [],
  shifts = [],
  historiqueDisponible = false,
} = {}) {
  const inventairesPOS = new Map(
    inventaires
      .filter(inv => inv?.pos_service_id)
      .map(inv => [inv.id, inv]),
  )
  const nomsCaissiers = new Map(
    shifts
      .filter(shift => shift?.caissier_id && shift?.caissier_nom)
      .map(shift => [shift.caissier_id, shift.caissier_nom]),
  )
  const entreesPOS = entrees.filter(entree => inventairesPOS.has(entree?.inventaire_id))

  if (entreesPOS.length === 0) {
    return {
      source: historiqueDisponible ? 'HISTORIQUE' : 'VIDE',
      nbEntrees: 0,
      groupes: [],
    }
  }

  const fournisseurs = new Map()
  entreesPOS.forEach(entree => {
    const inventaire = inventairesPOS.get(entree.inventaire_id)
    const fournisseur = String(entree.fournisseur_nom || '').trim() || 'Sans fournisseur'
    const nomProduit = String(entree.produit_nom || '').trim() || 'Produit inconnu'
    const auteur = nomsCaissiers.get(inventaire.caissier_id) || 'Caissier'
    const shift = LIBELLES_SHIFT[inventaire.type_shift] || inventaire.type_shift || ''

    if (!fournisseurs.has(fournisseur)) fournisseurs.set(fournisseur, new Map())
    const produits = fournisseurs.get(fournisseur)
    const cle = `${nomProduit}|${auteur}|${shift}`
    const produit = produits.get(cle) || { nom: nomProduit, quantite: 0, auteur, shift }
    produit.quantite += Number(entree.quantite) || 0
    produits.set(cle, produit)
  })

  const groupes = [...fournisseurs.entries()]
    .map(([fournisseur, produits]) => ({
      fournisseur,
      produits: [...produits.values()].sort((a, b) => a.nom.localeCompare(b.nom)),
    }))
    .sort((a, b) => a.fournisseur.localeCompare(b.fournisseur))

  return { source: 'POS', nbEntrees: entreesPOS.length, groupes }
}
