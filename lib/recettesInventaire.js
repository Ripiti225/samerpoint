// ──────────────────────────────────────────────────────────────────────────────
// Recettes d'inventaire : quels plats du POS consomment chaque produit, et
// combien (Vérification → Stock, « quels plats ont fait sortir ce produit »).
//
// Les vraies recettes vivent dans les caisses (inventaire_consommations du POS
// local) et ne montent pas dans le cloud. Celles-ci ont été RETROUVÉES le
// 15/11/2026 en comparant, sur 136 shifts, les plats vendus aux sorties
// calculées par le POS (exact sur ~95 % des shifts ; les écarts restants sont
// des KDO, des annulations ou des shifts à cheval). Validées par l'utilisateur.
//
// Clé = produit_id de inventaire_lignes ; valeur = { nom exact du plat au POS :
// quantité consommée par plat }. Un plat absent n'entre pas dans le calcul :
// l'écran affiche alors l'écart avec la sortie du POS, sans rien inventer.
// ──────────────────────────────────────────────────────────────────────────────

const UN = 1
const DEMI = 0.5

const PIZZAS = [
  '4 Saisons', 'Bolognaise', 'Calabraise', 'Calsonne', 'Canadienne', 'Crevette', 'Margherita', 'Merguez',
  'Mexicaine', 'Miami', 'Picasso', 'Reine', 'Royale', 'Royale Crémeuse', 'Thona', 'Végéta',
]
const GRAMMES_PIZZA_M = 160
const GRAMMES_PIZZA_G = 200

const fromagePizzas = () => Object.fromEntries(PIZZAS.flatMap(p => [
  [`Pizza ${p} (M)`, GRAMMES_PIZZA_M],
  [`Pizza ${p} (G)`, GRAMMES_PIZZA_G],
]))

const tous = (plats, q = UN) => Object.fromEntries(plats.map(p => [p, q]))

export const RECETTES = {
  // ── Pains ──
  p1: { // Pain chawarma
    ...tous(['Chawarma Poulet', 'Chawarma Viande', 'Chawarma Mélange', 'Chawarma Spécial', 'Chawarma Végétarien', 'Chawarma Crevette']),
    'Assiette Chawarma': 2,
  },
  p2: tous(['Burger', 'Burger spécial', 'Chicken Burger', 'Assiette Hamburger', 'Assiette Chicken']), // Pain burger
  p3: tous(['Francisco', 'Philadelphia', 'Escalope', 'Crispy']), // Pain fahita

  // ── Fromage (grammes) ──
  f10: {
    ...fromagePizzas(),
    'Pizza spéciale': 130,
    ...tous(['Manaich Fromage', 'Manaich Cocktail', 'Manaich Jambon Fromage', 'Manaich Viande', 'Manaich Fromage Crémière', 'Manaich Légumes'], 100),
    ...tous(['Tacos Poulet', 'Tacos Viande', 'Tacos Mixte', 'Tacos Maison', 'Tacos burger', 'Burger', 'Chicken Burger', 'Francisco', 'Escalope', 'Philadelphia', 'Crispy'], 50),
    ...tous(['Fatayer Jambon Fromage', 'Mini Tacos'], 30),
  },
  f1: tous(['Philadelphia']),

  // ── Viandes et poulet ──
  pl1: tous(['Steak Frites', 'Steak Spaghetti', 'Steak Crème Fraîche', 'Steak Petits Pois']),
  pl2: tous(['Assiette Escalope', 'Escalope Crème Fraîche']),
  pl3: tous(['Chicken Burger', 'Assiette Chicken']),
  pl4: tous(['Burger', 'Burger spécial', 'Assiette Hamburger']), // Viande burger
  pl5: { '5 Pièces Crispy + Frites': UN, '10 Pièces Crispy + Frites': 2 },
  po7: tous(['Pate de poulet']),
  po8: { // Total poulet
    ...tous(['Poulet Rôti + Frites', 'Poulet Braisé + Frites', 'Poulet Pané + Frites', 'Poulet Sauté à la Crème']),
    'Poulet Sauté aux Légumes': 2,
    ...tous(['Demi Poulet Rôti + Frites', 'Demi Poulet Braisé + Frites', 'Demi Poulet Pané + Frites', 'Demi Poulet Sauté aux Légumes', 'Demi Poulet Sauté à la Crème'], DEMI),
    'Poulet spécial Glovo': 0.25,
  },

  // ── Apéritifs ──
  a1: tous(['Nems (10 pièces)']),
  a2: tous(['Kebbé']),
  a3: tous(['Bourak']),
  a4: tous(['Fatayer Viande']),
  a5: tous(['Fatayer Légumes']),
  a6: tous(['Fatayer Maison']),
  a7: tous(['Fatayer Jambon Fromage']),
  a8: tous(['Mini Tacos']),
  a9: tous(['Francisco']),
  a10: tous(['Brochette Frites']),

  // ── Boissons et glaces ──
  b1: tous(['Nespresso']),
  b2: tous(['Eau Céleste (Grande)']),
  b3: tous(['Eau Céleste (Petite)']),
  b4: tous(['Boisson', "Cody's Énergie"]), // Boisson 1000f
  b5: tous(["Cody's Malta"]), // Boisson 1500f
  b6: tous(['Fresco']), // Pot Fresco
  b8: tous(['Thé', 'Thé Infusion']),
  g4: tous(['Glace (2 Boules)', 'Glace Spéciale']), // Cornets

  // ── Al Kayan ──
  'ALA-BOIS-1000': tous(['Boisson 1 000']),
  'ALA-BOIS-1500': tous(['Boisson 1 500']),
  'ALA-POUL-HYBRIDE': { 'Kedjenou de poulet hybride — demi': DEMI },
  'POS_faeabd8f-8129-4463-9fbb-9a6019e4c1fe': tous(['Eau grande bouteille']), // EAU G
  'POS_32e3cf7e-c39a-4719-89da-873a91f2837e': { 'Lapin braisé': UN, 'Demi lapin braisé': DEMI }, // LAPIN
  'POS_6ee86356-b5bf-42f6-910e-46f1a8a5fb72': tous(['Soupe de machoiron']), // MACHOIRON
}

/** Unité d'affichage d'un produit (« g » pour le fromage, rien sinon). */
export const UNITES = { f10: 'g' }

export const recettePour = produitId => RECETTES[produitId] || null
