// ─────────────────────────────────────────────────────────────────────────
//  CATALOGUE CENTRAL DES TUILES + CONFIG D'ACCÈS PAR RÔLE
//
//  Source unique de vérité pour les menus d'accueil. Au lieu de listes figées
//  dans app/accueil.js, on définit ici TOUTES les tuiles possibles, et la
//  configuration « quel rôle voit quoi » vit en base (table roles_acces),
//  éditable depuis Paramètres → sans reprogrammer ni rebuild.
//
//  ⚠️ Gating d'UI uniquement : cacher une tuile n'empêche pas techniquement
//  l'accès aux données (RLS ouvert / clé anon publique). Confort, pas sécurité.
//
//  Manager & directeur (admin) : accès total, non configurable — ils voient
//  automatiquement TOUTES les tuiles marquées `admin: true` (y compris les
//  futures). Le vérificateur a un écran dédié (/verificateur), pas de menu ici.
// ─────────────────────────────────────────────────────────────────────────

import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from './supabase'

// Les `id` sont des clés stables (utilisés en base). Ne pas les renommer.
export const TUILES = [
  // ── Surface ADMIN (manager & directeur : toujours visibles) ──────────────
  { id: 'tresorerie',                 icon: '🏦',  titre: 'Trésorerie',             sous: 'Banque, loyers, salaires, CNPS',       route: '/tresorerie',                 admin: true },
  { id: 'dashboard-global',           icon: '📊',  titre: 'Dashboard global',       sous: 'Classement & stats',                   route: '/dashboard-global',           admin: true },
  { id: 'restaurants',                icon: '🏪',  titre: 'Tous les restaurants',   sous: 'Vue globale',                          route: '/restaurants',                admin: true },
  { id: 'point-caissier',            icon: '🧾',  titre: 'Point caissier',        sous: 'Shifts clôturés · 3 derniers jours',     route: '/point-caissier',            admin: true },
  { id: 'modifier-point',             icon: '✏️',  titre: 'Modifier un point',      sous: 'Choisir restaurant + date',            route: '/modifier-point',             admin: true },
  { id: 'modifier-inventaire',        icon: '📦',  titre: 'Modifier inventaire',    sous: 'Choisir restaurant + date',            route: '/modifier-inventaire',        admin: true },
  { id: 'gestion-stock',              icon: '📉',  titre: 'Gestion de stock',       sous: 'Sorties par produit · resto & période', route: '/gestion-stock',             admin: true },
  { id: 'equipe',                     icon: '👥',  titre: 'Équipe globale',         sous: 'Tous les travailleurs',                route: '/equipe',                     admin: true },
  { id: 'rh',                         icon: '🧑‍💼', titre: 'Ressources Humaines',    sous: 'Présences & salaires',                 route: '/rh',                         admin: true },
  { id: 'contrats',                   icon: '📝',  titre: 'Contrats',               sous: 'Échéances & renouvellements',          route: '/contrats',                   admin: true },
  // « Charges du mois » retirée le 01/10/2026 : les charges se saisissent dans
  // Trésorerie → À payer (voir lib/chargesMois.js).
  { id: 'documents',                  icon: '📁',  titre: 'Documents',              sous: 'Documents administratifs',             route: '/documents',                  admin: true },
  { id: 'demandes-admin',             icon: '📋',  titre: 'Demandes',               sous: 'Permissions, congés & réclamations',   route: '/demandes-admin',             admin: true },
  { id: 'demandes-explication-admin', icon: '📨',  titre: "Demandes d'explication", sous: 'Suivi & relances travailleurs',        route: '/demandes-explication-admin', admin: true },
  { id: 'credits-fournisseurs',       icon: '💳',  titre: 'Crédits fournisseurs',   sous: 'Crédit, avances & paiements',          route: '/credits-fournisseurs',       admin: true },
  { id: 'litiges',                    icon: '⚖️',  titre: 'Litiges',                sous: 'Écarts, avis & réclamations',          route: '/litiges',                    admin: true },
  { id: 'avis-plateformes',           icon: '⭐',  titre: 'Avis clients',           sous: 'Notes Yango & Glovo',                  route: '/avis-plateformes',           admin: true },
  { id: 'verification',               icon: '🔍',  titre: 'Vérification',           sous: 'Photos & points à vérifier',           route: '/verification',               admin: true },
  { id: 'recap-verifications',        icon: '📦',  titre: 'Vérifications stock',    sous: 'Comptages des vérificateurs',          route: '/recap-verifications',        admin: true },
  { id: 'rapports',                   icon: '📊',  titre: 'Rapports',               sous: 'Synthèse hebdo & rapport mensuel',     route: '/rapports',                   admin: true },
  { id: 'stats-caissiers',            icon: '👤',  titre: 'Stats caissiers',        sous: 'Performance par caissier',             route: '/stats-caissiers',            admin: true },
  { id: 'journal',                    icon: '📋',  titre: 'Journal activité',       sous: 'Historique des actions',               route: '/journal',                    admin: true },
  { id: 'corbeille',                  icon: '🗑️',  titre: 'Corbeille',              sous: 'Restaurer un shift supprimé',          route: '/corbeille',                  admin: true },
  { id: 'contacts',                   icon: '📲',  titre: 'Contacts',               sous: 'SMS & WhatsApp groupés',               route: '/contacts',                   admin: true },
  { id: 'parametres',                 icon: '⚙️',  titre: 'Paramètres',             sous: 'Configuration',                        route: '/parametres',                 admin: true },

  // ── Surface OPÉRATIONS (gérant / caissier — liée au shift) ───────────────
  { id: 'ventes',              icon: '💰', titre: 'Saisir les ventes', sous: 'Séquences + photos',                        route: '/ventes',            verrouSiPointValide: true },
  { id: 'dashboard',           icon: '📊', titre: 'Tableau de bord',   sous: 'Résultats du jour',                         route: '/dashboard' },
  { id: 'livraisons',          icon: '🛵', titre: 'Livraisons',        sous: 'Yango, Glovo…',                             route: '/livraisons' },
  { id: 'gerant-caissier',     icon: '👤', titre: 'Espace Caissier',   sous: 'Point, dépenses, présences, inventaire…',   route: '/gerant-caissier' },
  { id: 'deductions-gerant',   icon: '💸', titre: 'Déductions Gérant', sous: 'Fournisseurs, marché, divers',              route: '/deductions-gerant' },
  { id: 'demandes',            icon: '📋', titre: 'Demandes',          sous: 'Permissions & congés travailleurs',         route: '/demandes' },
  { id: 'demandes-explication', icon: '📨', titre: "Demandes d'explication", sous: 'Demander une explication',            route: '/demandes-explication' },
  { id: 'point-shift',         icon: '⏱️', titre: 'Point / Shift',     sous: 'Faire mon point de shift',                  route: '/point-shift' },
  { id: 'depenses',            icon: '📋', titre: 'Dépenses',          sous: 'Marché, paie…',                             route: '/depenses',          verrouSiPointValide: true },
  { id: 'fournisseurs',        icon: '🧾', titre: 'Fournisseurs',      sous: 'Factures & paiements',                      route: '/fournisseurs',      verrouSiPointValide: true },
  { id: 'inventaire',          icon: '📦', titre: 'Inventaire',        sous: 'Stock par shift',                           route: '/inventaire' },
  { id: 'presences',           icon: '👥', titre: 'Présences',         sous: 'Statuts équipe',                            route: '/presences',         verrouSiPointValide: true },
]

// Rôles dont le menu est configurable depuis Paramètres.
// (manager & directeur = admin non configurable ; verificateur = écran dédié)
export const ROLES_CONFIGURABLES = ['rh', 'gerant', 'caissier']

export const LABELS_ROLES = {
  rh: '🧑‍💼 RH',
  gerant: '🔑 Gérant',
  caissier: '💼 Caissier',
}

// Accès par défaut (reproduisent à l'identique les menus historiques).
// Servent au seed de la base ET de repli si la base est indisponible.
export const ACCES_DEFAUT = {
  rh: [
    'tresorerie', 'rh', 'contrats', 'demandes-admin', 'demandes-explication-admin', 'recap-verifications',
    'equipe', 'contacts', 'documents', 'credits-fournisseurs',
  ],
  gerant: [
    'ventes', 'dashboard', 'documents', 'livraisons', 'point-caissier',
    'deductions-gerant', 'credits-fournisseurs', 'demandes', 'demandes-explication', 'contacts',
  ],
  caissier: [
    'point-shift', 'depenses', 'fournisseurs', 'inventaire', 'presences', 'livraisons',
  ],
}

const CACHE_KEY = 'samtrackly_roles_acces'

export function tuileParId(id) {
  return TUILES.find(t => t.id === id) || null
}

export function tuilesAdmin() {
  return TUILES.filter(t => t.admin)
}

// Renvoie la liste ordonnée des tuiles pour un rôle donné, à partir d'une
// config { rh:[ids], gerant:[ids], caissier:[ids] }. Ignore les id inconnus.
export function tuilesPourRole(role, config = ACCES_DEFAUT) {
  if (role === 'manager' || role === 'directeur') return tuilesAdmin()
  const ids = (config && config[role]) || ACCES_DEFAUT[role] || []
  return ids.map(tuileParId).filter(Boolean)
}

// Charge la config depuis la base, fusionnée sur les défauts, avec cache
// AsyncStorage pour fonctionner hors-ligne. Ne throw jamais.
export async function chargerAccesConfig() {
  const config = { ...ACCES_DEFAUT }
  try {
    const { data, error } = await supabase.from('roles_acces').select('role, tuiles')
    if (error) throw error
    for (const row of data || []) {
      if (ROLES_CONFIGURABLES.includes(row.role) && Array.isArray(row.tuiles)) {
        config[row.role] = row.tuiles
      }
    }
    try { await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(config)) } catch {}
    return config
  } catch {
    try {
      const raw = await AsyncStorage.getItem(CACHE_KEY)
      if (raw) return { ...ACCES_DEFAUT, ...JSON.parse(raw) }
    } catch {}
    return config
  }
}

// Enregistre les accès d'un rôle configurable. `ids` est réordonné selon
// l'ordre du catalogue pour un affichage stable.
export async function enregistrerAccesRole(role, ids) {
  if (!ROLES_CONFIGURABLES.includes(role)) {
    throw new Error(`Rôle non configurable : ${role}`)
  }
  const set = new Set(ids)
  const ordonnes = TUILES.map(t => t.id).filter(id => set.has(id))
  const { error } = await supabase
    .from('roles_acces')
    .upsert({ role, tuiles: ordonnes, updated_at: new Date().toISOString() }, { onConflict: 'role' })
  if (error) throw error
  return ordonnes
}
