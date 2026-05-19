// ─── Catégories & produits de l'inventaire ────────────────────────────────────
export const CATEGORIES_INVENTAIRE = [
  {
    nom: 'Pains',
    produits: [
      { id: 'p1', nom: 'Pain chawarma', prix: 2500 },
      { id: 'p2', nom: 'Pain burger', prix: 3500 },
      { id: 'p3', nom: 'Pain fahita', prix: 3000 },
    ]
  },
  {
    nom: 'Poulet',
    produits: [
      { id: 'po1', nom: 'Poulet frais', prix: 0, noAlert: true },
      { id: 'po2', nom: 'Pané', prix: 0 },
      { id: 'po3', nom: 'Rôti', prix: 0 },
      { id: 'po4', nom: 'Braise', prix: 0 },
      { id: 'po5', nom: 'Désossé', prix: 0 },
      { id: 'po6', nom: 'Cuisses de poulet', prix: 0 },
      { id: 'po7', nom: 'Pâte de poulet', prix: 1000, auto: true },
      { id: 'po8', nom: 'Total poulet', prix: 8000, totalPoulet: true },
    ]
  },
  {
    nom: 'Apéritifs',
    produits: [
      { id: 'a1', nom: 'Nems', prix: 2000 },
      { id: 'a2', nom: 'Kébbé', prix: 1000 },
      { id: 'a3', nom: 'Bourak', prix: 2000 },
      { id: 'a4', nom: 'Fatayer viande', prix: 1000 },
      { id: 'a5', nom: 'Fatayer légumes', prix: 1000 },
      { id: 'a6', nom: 'Fatayer maison', prix: 1500 },
      { id: 'a7', nom: 'Fatayer JFromage', prix: 1500 },
      { id: 'a8', nom: 'Mini tacos', prix: 2000 },
      { id: 'a9', nom: 'Francisco', prix: 0 },
      { id: 'a10', nom: 'Brochette poulet', prix: 5000 },
      { id: 'a11', nom: 'Brochette viande', prix: 5000 },
    ]
  },
  {
    nom: 'Plats',
    produits: [
      { id: 'pl1', nom: 'Steak', prix: 6000 },
      { id: 'pl2', nom: 'Escalope plats', prix: 5000 },
      { id: 'pl3', nom: 'Chicken burger', prix: 0 },
      { id: 'pl4', nom: 'Viande burger', prix: 0 },
      { id: 'pl5', nom: 'Crispy 5pcs', prix: 5000 },
    ]
  },
  {
    nom: 'Fromage & Pizzas',
    produits: [
      { id: 'f1', nom: 'Philadelphia', prix: 2500 },
      { id: 'f2', nom: 'Manaïche (100g)', prix: 0, fromage: 100 },
      { id: 'f3', nom: 'Pizza spéciale (130g)', prix: 0, fromage: 130 },
      { id: 'f4', nom: 'Pizza moyenne (160g)', prix: 0, fromage: 160 },
      { id: 'f5', nom: 'Pizza grande (200g)', prix: 0, fromage: 200 },
      { id: 'f6', nom: 'Mini pizza (20g)', prix: 0, fromage: 20 },
      { id: 'f7', nom: 'Fatayer JF 30g', prix: 0, fromage: 30 },
      { id: 'f8', nom: 'Sandwich/Tacos (50g)', prix: 0, fromage: 50 },
      { id: 'f9', nom: 'Mini tacos (30g)', prix: 0, fromage: 30 },
      { id: 'f10', nom: 'Total Fromage (g)', prix: 5, totalFromage: true },
    ]
  },
  {
    nom: 'Boissons',
    produits: [
      { id: 'b1', nom: 'Nespresso', prix: 1000 },
      { id: 'b2', nom: 'Eau G', prix: 1000 },
      { id: 'b3', nom: 'Eau P', prix: 500 },
      { id: 'b4', nom: 'Boisson 1000f', prix: 1000 },
      { id: 'b5', nom: 'Boisson 1500f', prix: 1500 },
      { id: 'b6', nom: 'Pot Fresco', prix: 1000 },
      { id: 'b7', nom: 'Darina', prix: 0, noAlert: true },
      { id: 'b8', nom: 'Thé', prix: 1000 },
    ]
  },
  {
    nom: 'Glaces & Cornets',
    produits: [
      { id: 'g1', nom: 'Glace 2 boules', prix: 0, boules: 2 },
      { id: 'g2', nom: 'Milkshake/Spéciale', prix: 0, boules: 3 },
      { id: 'g3', nom: 'Pot de glace (38 boules)', prix: 6000, totalGlace: true },
      { id: 'g4', nom: 'Cornets', prix: 1000 },
    ]
  },
  {
    nom: 'Frites',
    produits: [
      { id: 'fr1', nom: 'Portions de frites', prix: 0 },
      { id: 'fr2', nom: 'Tacos vendus', prix: 0 },
      { id: 'fr3', nom: 'Sachet de frites', prix: 2500, totalFrites: true },
    ]
  },
  {
    nom: 'Jus',
    produits: [
      { id: 'j1', nom: 'Ananas (ml)', prix: 0 },
      { id: 'j2', nom: 'Orange (ml)', prix: 0 },
    ]
  },
  {
    nom: 'Poissons',
    produits: [
      { id: 'ps1', nom: 'Poissons', prix: 0 },
    ]
  },
]

// ─── Coefficients de commission par canal ─────────────────────────────────────
export const COEFFICIENTS = {
  YANGO: 0.77,
  GLOVO: 0.705,
  OM: 0.99,
  WAVE: 0.99,
  DJAMO: 0.99,
}

// ─── Catégories de dépenses (ordre affiché dans l'UI) ─────────────────────────
export const CATEGORIES_DEPENSES = ['Marché', 'Légumes', 'Fruits', 'Dépenses annexes']

// ─── Dépenses vides par catégorie ─────────────────────────────────────────────
export function depensesVides() {
  return Object.fromEntries(CATEGORIES_DEPENSES.map(cat => [cat, []]))
}
