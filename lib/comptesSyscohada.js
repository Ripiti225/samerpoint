// ──────────────────────────────────────────────────────────────────────────────
// Plan de comptes SYSCOHADA révisé utilisé par l'export comptable.
//
// PROPOSITION À FAIRE VALIDER PAR LE CABINET COMPTABLE (19/11/2026) : c'est la
// seule source des numéros de comptes ; changer un numéro ici suffit, l'onglet
// « Plan de comptes » de l'export suit.
// ──────────────────────────────────────────────────────────────────────────────

export const COMPTES = {
  ventesCaisse:    { compte: '7021', intitule: 'Ventes restaurant (sur place, à emporter)' },
  ventesLivraison: { compte: '7022', intitule: 'Ventes livraison plateformes' },
  caisse:          { compte: '571',  intitule: 'Caisse' },
  om:              { compte: '5511', intitule: 'Monnaie électronique Orange Money' },
  wave:            { compte: '5512', intitule: 'Monnaie électronique Wave' },
  djamo:           { compte: '5513', intitule: 'Monnaie électronique Djamo' },
  yango:           { compte: '4111', intitule: 'Client plateforme Yango' },
  glovo:           { compte: '4112', intitule: 'Client plateforme Glovo' },
  samerDelly:      { compte: '4113', intitule: 'Client plateforme Samer Delly' },
  fournisseurs:    { compte: '401',  intitule: 'Fournisseurs' },
  achats:          { compte: '6021', intitule: 'Achats de matières premières (alimentaire)' },
  autresAchats:    { compte: '605',  intitule: 'Autres achats (non alimentaire, dépenses annexes)' },
  personnel:       { compte: '661',  intitule: 'Rémunérations du personnel' },
  cadeaux:         { compte: '6278', intitule: 'Cadeaux à la clientèle (KDO)' },
  remises:         { compte: '709',  intitule: 'Rabais et remises accordés (points fidélité, retours)' },
  ecartManque:     { compte: '658',  intitule: 'Charges diverses (manque de caisse)' },
  ecartSurplus:    { compte: '758',  intitule: 'Produits divers (surplus de caisse)' },
}
