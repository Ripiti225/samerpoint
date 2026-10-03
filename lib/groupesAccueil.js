// ──────────────────────────────────────────────────────────────────────────────
// Accueil manager / directeur : tuiles favorites en accès direct, puis les
// autres rangées sous des bannières qui se déroulent sur place. Logique pure.
//
// Les `id` sont ceux du catalogue TUILES (lib/menus.js). Une tuile admin
// absente de tous les groupes (ajoutée plus tard) va dans « Autres » : elle ne
// disparaît jamais de l'accueil.
// Tests : lib/groupesAccueil.test.mjs
// ──────────────────────────────────────────────────────────────────────────────

export const FAVORIS_ADMIN = ['tresorerie', 'verification', 'dashboard-global']

export const GROUPES_ADMIN = [
  { id: 'tresorerie', icon: '🏦', titre: 'Trésorerie', tuiles: ['tresorerie', 'credits-fournisseurs'] },
  { id: 'tableaux', icon: '📊', titre: 'Tableaux de bord', tuiles: ['dashboard-global', 'restaurants', 'rapports', 'stats-caissiers'] },
  { id: 'controle', icon: '✅', titre: 'Contrôle des points', tuiles: ['verification', 'point-caissier', 'modifier-point', 'litiges', 'corbeille'] },
  { id: 'stock', icon: '📦', titre: 'Stock', tuiles: ['gestion-stock', 'modifier-inventaire', 'recap-verifications'] },
  {
    id: 'personnel', icon: '👥', titre: 'Personnel et documents',
    tuiles: ['equipe', 'rh', 'contrats', 'demandes-admin', 'demandes-explication-admin', 'documents'],
  },
  { id: 'clients', icon: '⭐', titre: 'Clients', tuiles: ['avis-plateformes', 'contacts'] },
  { id: 'administration', icon: '⚙️', titre: 'Administration', tuiles: ['journal', 'parametres'] },
]

// tuiles : [{ id, … }] (celles auxquelles le compte a accès).
// Rend { favoris, groupes: [{ id, icon, titre, tuiles }], autres }, groupes vides retirés.
export function organiserAccueilAdmin(tuiles = []) {
  const parId = Object.fromEntries((tuiles || []).map(t => [t.id, t]))
  const ranges = new Set(GROUPES_ADMIN.flatMap(g => g.tuiles))
  return {
    favoris: FAVORIS_ADMIN.map(id => parId[id]).filter(Boolean),
    groupes: GROUPES_ADMIN
      .map(g => ({ ...g, tuiles: g.tuiles.map(id => parId[id]).filter(Boolean) }))
      .filter(g => g.tuiles.length),
    autres: (tuiles || []).filter(t => !ranges.has(t.id)),
  }
}
