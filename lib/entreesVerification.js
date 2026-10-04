const nettoyer = v => String(v ?? '').trim() || null

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
  corrections = [],
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

  // Corrections du vérificateur (table corrections_entrees), par réception :
  // même inventaire, même produit, même fournisseur (vide = sans fournisseur).
  const clefReception = (inventaireId, produitId, fournisseurNom) =>
    `${inventaireId}|${produitId}|${fournisseurNom ?? ''}`
  const correctionsParReception = new Map()
  ;[...corrections]
    .sort((a, b) => String(a?.created_at || '').localeCompare(String(b?.created_at || '')))
    .forEach(c => {
      const cle = clefReception(c.inventaire_id, c.produit_id, nettoyer(c.fournisseur_nom))
      if (!correctionsParReception.has(cle)) correctionsParReception.set(cle, [])
      correctionsParReception.get(cle).push(c)
    })

  const fournisseurs = new Map()
  entreesPOS.forEach(entree => {
    const inventaire = inventairesPOS.get(entree.inventaire_id)
    const fournisseurNom = nettoyer(entree.fournisseur_nom)
    const fournisseur = fournisseurNom || 'Sans fournisseur'
    const nomProduit = String(entree.produit_nom || '').trim() || 'Produit inconnu'
    const produitId = entree.produit_id || nomProduit
    const auteur = nomsCaissiers.get(inventaire.caissier_id) || 'Caissier'
    const shift = LIBELLES_SHIFT[inventaire.type_shift] || inventaire.type_shift || ''

    if (!fournisseurs.has(fournisseur)) fournisseurs.set(fournisseur, new Map())
    const produits = fournisseurs.get(fournisseur)
    const cle = clefReception(entree.inventaire_id, produitId, fournisseurNom)
    const produit = produits.get(cle) || {
      nom: nomProduit, quantite: 0, auteur, shift,
      inventaireId: entree.inventaire_id, produitId, fournisseurNom,
      quantiteOrigine: 0, correction: null,
    }
    produit.quantiteOrigine += Number(entree.quantite) || 0
    produits.set(cle, produit)
  })

  fournisseurs.forEach(produits => produits.forEach((produit, cle) => {
    const liste = correctionsParReception.get(cle) || []
    const delta = liste.reduce((s, c) => s + (Number(c.delta) || 0), 0)
    produit.quantite = produit.quantiteOrigine + delta
    if (liste.length > 0) {
      const derniere = liste[liste.length - 1]
      produit.correction = {
        depuis: produit.quantiteOrigine,
        vers: produit.quantite,
        raison: derniere.raison || '',
        par: derniere.par || '',
        nb: liste.length,
      }
    }
  }))

  const groupes = [...fournisseurs.entries()]
    .map(([fournisseur, produits]) => ({
      fournisseur,
      produits: [...produits.values()].sort((a, b) => a.nom.localeCompare(b.nom)),
    }))
    .sort((a, b) => a.fournisseur.localeCompare(b.fournisseur))

  return { source: 'POS', nbEntrees: entreesPOS.length, groupes }
}
