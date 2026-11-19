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

  // ── Étape 2 : Banque et Trésorerie ─────────────────────────────────────────
  baci:                  { compte: '5211', intitule: 'Banque BACI' },
  sib:                   { compte: '5212', intitule: 'Banque SIB' },
  especesDirection:      { compte: '5712', intitule: 'Caisse direction (espèces)' },
  coffre:                { compte: '5713', intitule: 'Coffre' },
  tdfOm:                 { compte: '5514', intitule: 'Tête de fond Orange Money' },
  tdfWave:               { compte: '5515', intitule: 'Tête de fond Wave' },
  tdfDjamo:              { compte: '5516', intitule: 'Tête de fond Djamo' },
  cotisSalaire:          { compte: '5717', intitule: 'Caisse cotisations salaire' },
  cotisAutres:           { compte: '5718', intitule: 'Caisse cotisations autres' },
  virementsInternes:     { compte: '585',  intitule: 'Virements de fonds internes' },
  locations:             { compte: '622',  intitule: 'Locations (loyers)' },
  droitsEnregistrement:  { compte: '646',  intitule: "Droits d'enregistrement et timbre (bail, timbre)" },
  impotsTaxes:           { compte: '641',  intitule: 'Impôts et taxes directs (TEE)' },
  salairesDus:           { compte: '422',  intitule: 'Personnel, rémunérations dues' },
  cnps:                  { compte: '431',  intitule: 'Sécurité sociale (CNPS)' },
  itsRetenu:             { compte: '447',  intitule: 'État, impôts retenus à la source (ITS)' },
  entretien:             { compte: '624',  intitule: 'Entretien, réparations' },
  petitMateriel:         { compte: '6056', intitule: 'Achats de petit matériel' },
  materielOutillage:     { compte: '2441', intitule: 'Matériel et outillage (équipement)' },
  autresImmobilisations: { compte: '2448', intitule: 'Autres matériels et mobiliers (investissement)' },
  associe:               { compte: '4621', intitule: 'Associé, compte courant (retraits du patron)' },
  chargesDiverses:       { compte: '6588', intitule: 'Autres charges diverses' },
  commissionsPlateformes: { compte: '632', intitule: 'Commissions des plateformes (estimées)' },
  fraisMobileMoney:      { compte: '631',  intitule: 'Frais sur mobile money (estimés)' },
  publicite:             { compte: '627',  intitule: 'Publicité (Glovo)' },
  attente:               { compte: '471',  intitule: "Compte d'attente (à reclasser par le cabinet)" },
}
