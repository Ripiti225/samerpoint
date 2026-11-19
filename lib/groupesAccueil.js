// ──────────────────────────────────────────────────────────────────────────────
// Accueil manager / directeur / RH, et gérant (sa propre configuration) : tuiles favorites en accès direct, puis les
// autres rangées sous des bannières qui se déroulent sur place. Logique pure.
//
// Les `id` sont ceux du catalogue TUILES (lib/menus.js). Une tuile admin
// absente de tous les groupes (ajoutée plus tard) va dans « Autres » : elle ne
// disparaît jamais de l'accueil.
// Tests : lib/groupesAccueil.test.mjs
// ──────────────────────────────────────────────────────────────────────────────
import { statutEmprunt } from './direction.js'
import { CATEGORIES_TRESORERIE, paiementsParDu, resteDu } from './tresorerie.js'

export const FAVORIS_ADMIN = ['tresorerie', 'verification', 'dashboard-global']

// couleur : accent du groupe (icônes, teintes) ; fonce : fond des pastilles
// à texte blanc (contraste ≥ 4,5:1) ;
// icone : nom MaterialCommunityIcons (@expo/vector-icons).
export const GROUPES_ADMIN = [
  { id: 'comptabilite', icone: 'calculator-variant', couleur: '#0E9F6E', fonce: '#047857', titre: 'Comptabilité', tuiles: ['tresorerie', 'credits-fournisseurs', 'salaires', 'rapports', 'cloture-mois'] },
  { id: 'tableaux', icone: 'chart-box', couleur: '#6C63E0', fonce: '#4F46C8', titre: 'Tableaux de bord', tuiles: ['dashboard-global', 'stats-caissiers'] },
  { id: 'controle', icone: 'clipboard-check', couleur: '#E07B00', fonce: '#B45309', titre: 'Contrôle des points', tuiles: ['verification', 'point-caissier', 'modifier-point', 'litiges', 'supervision', 'corbeille'] },
  { id: 'stock', icone: 'package-variant-closed', couleur: '#B7791F', fonce: '#92400E', titre: 'Stock', tuiles: ['gestion-stock', 'modifier-inventaire', 'recap-verifications'] },
  {
    id: 'personnel', icone: 'account-group', couleur: '#2F7FD8', fonce: '#1D5FB0', titre: 'Personnel et documents',
    tuiles: ['equipe', 'contrats', 'embauches', 'demandes-admin', 'demandes-explication-admin', 'documents', 'evenements'],
  },
  { id: 'clients', icone: 'star-face', couleur: '#D53F8C', fonce: '#B0306F', titre: 'Clients', tuiles: ['avis-plateformes', 'contacts'] },
  { id: 'administration', icone: 'shield-account', couleur: '#64748B', fonce: '#475569', titre: 'Administration', tuiles: ['journal', 'parametres'] },
]

// Accueil gérant : son restaurant, ses écrans du jour (liste réglée dans
// Paramètres ; seuls ceux qu'il a s'affichent). Le Tableau de bord ne lui est
// pas accessible.
export const FAVORIS_GERANT = ['ventes', 'deductions-gerant', 'point-caissier']

export const GROUPES_GERANT = [
  { id: 'journee', icone: 'calendar-today', couleur: '#E07B00', fonce: '#B45309', titre: 'Journée',
    tuiles: ['ventes', 'point-caissier', 'gerant-caissier'] },
  { id: 'depenses', icone: 'cash-minus', couleur: '#0E9F6E', fonce: '#047857', titre: 'Dépenses',
    tuiles: ['deductions-gerant', 'credits-fournisseurs', 'depenses', 'fournisseurs'] },
  { id: 'equipe', icone: 'account-group', couleur: '#2F7FD8', fonce: '#1D5FB0', titre: 'Équipe',
    tuiles: ['supervision', 'recrutement', 'demandes', 'demandes-explication', 'presences', 'documents', 'stats-caissiers', 'evenements'] },
  { id: 'clients', icone: 'star-face', couleur: '#D53F8C', fonce: '#B0306F', titre: 'Clients',
    tuiles: ['contacts', 'avis-plateformes'] },
]

// Icône vectorielle de chaque tuile (à la place des emojis du catalogue).
export const ICONES_TUILES = {
  'tresorerie': 'bank',
  'credits-fournisseurs': 'credit-card-clock',
  'dashboard-global': 'view-dashboard',
  'rapports': 'file-chart',
  'cloture-mois': 'lock-check',
  'stats-caissiers': 'account-cash',
  'verification': 'magnify-scan',
  'point-caissier': 'receipt',
  'modifier-point': 'pencil-box',
  'litiges': 'scale-balance',
  'corbeille': 'delete-restore',
  'gestion-stock': 'chart-timeline-variant',
  'modifier-inventaire': 'clipboard-edit',
  'recap-verifications': 'clipboard-list',
  'supervision': 'compass-outline',
  'equipe': 'account-group',
  'contrats': 'file-sign',
  'embauches': 'account-plus',
  'salaires': 'cash-multiple',
  'evenements': 'party-popper',
  'demandes-admin': 'inbox-arrow-down',
  'demandes-explication-admin': 'email-alert',
  'documents': 'folder-account',
  'avis-plateformes': 'star-half-full',
  'contacts': 'cellphone-message',
  'journal': 'history',
  'parametres': 'cog',
  'ventes': 'cash-register',
  'dashboard': 'view-dashboard-outline',
  'livraisons': 'moped',
  'gerant-caissier': 'account-cash-outline',
  'deductions-gerant': 'cash-minus',
  'demandes': 'inbox-arrow-down',
  'recrutement': 'account-plus-outline',
  'demandes-explication': 'email-alert',
  'point-shift': 'timer-outline',
  'depenses': 'receipt-text-minus',
  'fournisseurs': 'truck-delivery',
  'inventaire': 'clipboard-list-outline',
  'presences': 'account-check',
}

const configAccueil = role => (role === 'gerant'
  ? { favoris: FAVORIS_GERANT, groupes: GROUPES_GERANT }
  : { favoris: FAVORIS_ADMIN, groupes: GROUPES_ADMIN })

// Groupe d'une tuile (couleurs de l'accès direct).
export function groupeDeTuile(id, role = 'manager') {
  return configAccueil(role).groupes.find(g => g.tuiles.includes(id)) || { couleur: '#6C63E0', fonce: '#4F46C8' }
}

// « Samer Palmeraie » → « Palmeraie », « Al Kayan KMS » → « KMS », « À la Braise » → « Braise ».
export function nomCourtResto(nom) {
  return String(nom || '').trim().replace(/^(Samer|Al Kayan|Chez Samer)\s+/i, '').replace(/^À la\s+/i, '') || '?'
}

// État des points d'une journée, restaurant par restaurant :
// 'verifie' (validé et vérifié) · 'a_verifier' (validé, pas encore vérifié) · 'en_attente' (pas validé).
export function etatPointsDuJour({ points = [], restaurants = [], date }) {
  const parResto = {}
  for (const p of points || []) if (p.date === date) parResto[p.restaurant_id] = p
  const lignes = [...(restaurants || [])]
    .sort((a, b) => nomCourtResto(a.nom).localeCompare(nomCourtResto(b.nom)))
    .map(r => {
      const p = parResto[r.id]
      const statut = p?.valide ? (p.verifie ? 'verifie' : 'a_verifier') : 'en_attente'
      return { id: r.id, nom: nomCourtResto(r.nom), statut }
    })
  return {
    lignes,
    valides: lignes.filter(l => l.statut !== 'en_attente').length,
    total: lignes.length,
  }
}

// Points validés mais pas encore vérifiés (toutes dates fournies).
export function nbAVerifier(points = []) {
  return (points || []).filter(p => p.valide && !p.verifie).length
}

// tuiles : [{ id, … }] (celles auxquelles le compte a accès) ; role choisit la
// configuration (gérant ou bureau).
// Rend { favoris, groupes: [{ id, icone, couleur, titre, tuiles }], autres }, groupes vides retirés.
export function organiserAccueil(tuiles = [], role = 'manager') {
  const { favoris, groupes } = configAccueil(role)
  const parId = Object.fromEntries((tuiles || []).map(t => [t.id, t]))
  const ranges = new Set(groupes.flatMap(g => g.tuiles))
  return {
    favoris: favoris.map(id => parId[id]).filter(Boolean),
    groupes: groupes
      .map(g => ({ ...g, tuiles: g.tuiles.map(id => parId[id]).filter(Boolean) }))
      .filter(g => g.tuiles.length),
    autres: (tuiles || []).filter(t => !ranges.has(t.id)),
  }
}

export const organiserAccueilAdmin = tuiles => organiserAccueil(tuiles, 'manager')

// ── Messages Trésorerie du bandeau ───────────────────────────────────────────
// Charges à échéance non soldées dont la date limite est aujourd'hui ou demain,
// celles passées en dette récente ce matin (date limite hier), et emprunts au
// coffre à rembourser. Chaque entrée : { n, total }.
export function messagesTresorerie({ dus = [], paiements = [], emprunts = [], receptions = [], aujourdhui, demain, hier }) {
  const parDu = paiementsParDu(paiements)
  const compter = date => (dus || [])
    .filter(d => CATEGORIES_TRESORERIE.includes(d.categorie) && d.echeance === date)
    .map(d => resteDu(d, parDu[d.id]))
    .filter(r => r > 0)
    .reduce((acc, r) => ({ n: acc.n + 1, total: acc.total + r }), { n: 0, total: 0 })
  const coffre = (emprunts || [])
    .filter(e => statutEmprunt(e, receptions, aujourdhui) === 'a_rembourser')
    .reduce((acc, e) => ({ n: acc.n + 1, total: acc.total + (Number(e.montant) || 0) }), { n: 0, total: 0 })
  return { aujourdhui: compter(aujourdhui), demain: compter(demain), detteCeMatin: compter(hier), coffre }
}

// ── Couleur des écrans selon leur groupe ─────────────────────────────────────
// Chaque écran prend la couleur de sa bannière (en-tête, boutons, onglets).
// Activé groupe par groupe, après validation de chacun.
export const GROUPES_THEME_ACTIFS = ['comptabilite', 'controle', 'tableaux']

// « /tresorerie-a-payer?onglet=loyer » → groupe Comptabilité ; null hors groupe actif.
export function groupeDeRoute(chemin, actifs = GROUPES_THEME_ACTIFS) {
  const segment = String(chemin || '').split('?')[0].replace(/^\/+/, '').split('/')[0]
  if (!segment) return null
  const id = segment.startsWith('tresorerie') ? 'tresorerie' : segment
  const g = GROUPES_ADMIN.find(x => x.tuiles.includes(id) || x.id === id)
  return g && actifs.includes(g.id) ? g : null
}

// Couleurs du thème remplacées sur les écrans du groupe.
export function couleursGroupe(groupe, isDark) {
  return {
    headerBg: groupe.fonce,
    headerText: '#FFFFFF',
    primary: isDark ? groupe.couleur : groupe.fonce,
    primaryDark: isDark ? groupe.couleur : groupe.fonce,
    primaryLight: groupe.couleur + (isDark ? '33' : '1F'),
    primaryText: 'rgba(255,255,255,0.85)',
  }
}
