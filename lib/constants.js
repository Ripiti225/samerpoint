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
