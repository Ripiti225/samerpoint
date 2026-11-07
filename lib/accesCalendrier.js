// ──────────────────────────────────────────────────────────────────────────────
// Qui voit quoi dans le calendrier. Réglable dans l'écran Accès au calendrier
// (table calendrier_acces), réservé au propriétaire de la Trésorerie.
// Garde-fous NON réglables : le propriétaire voit tout ; le gérant n'a jamais ce
// qui n'est rattaché à aucun restaurant (voir aussi lignesDates pour sa portée).
// Tests : lib/accesCalendrier.test.mjs
// ──────────────────────────────────────────────────────────────────────────────

export const TYPES_CALENDRIER = [
  { cle: 'anniversaires', label: '🎂 Anniversaires', famille: 'Personnel' },
  { cle: 'age', label: "🔢 Âge dans les anniversaires", famille: 'Personnel' },
  { cle: 'anciennete', label: '🏅 Ancienneté', famille: 'Personnel' },
  { cle: 'conges', label: '🌴 Congés et permissions', famille: 'Personnel' },
  { cle: 'contrats', label: '📝 Fins de contrat', famille: 'Personnel' },
  { cle: 'evenements', label: '📅 Événements et jours fériés', famille: 'Calendrier' },
  { cle: 'taches', label: '🧭 Tâches de supervision', famille: 'Calendrier' },
  { cle: 'cheques', label: '🧾 Chèques à encaisser', famille: 'Trésorerie' },
  { cle: 'echeances', label: '🏠 Échéances À payer', famille: 'Trésorerie' },
  { cle: 'previsions', label: '🗓️ Prévisions de paiement', famille: 'Trésorerie' },
  { cle: 'charges', label: '🏛️ Charges administratives', famille: 'Trésorerie' },
  { cle: 'echeances_retard', label: '⚠️ Échéances en retard', famille: 'Trésorerie' },
  { cle: 'coffre', label: '🔐 Remboursements du coffre', famille: 'Trésorerie' },
]

export const ROLES_CALENDRIER = [
  { cle: 'manager', label: 'Manager' },
  { cle: 'directeur', label: 'Directeur' },
  { cle: 'rh', label: 'RH' },
  { cle: 'gerant', label: 'Gérant' },
]

export const INTERDITS_GERANT = ['cheques', 'coffre', 'echeances_retard', 'contrats']

const COMMUN = ['anniversaires', 'anciennete', 'evenements', 'conges', 'taches']
const DIRECTION = [...COMMUN, 'age', 'contrats', 'cheques', 'echeances', 'previsions', 'charges']

export const ACCES_CALENDRIER_DEFAUT = {
  manager: DIRECTION,
  directeur: DIRECTION,
  rh: [...COMMUN, 'age', 'contrats', 'echeances', 'previsions', 'charges'],
  gerant: COMMUN,
}

const CONNUS = TYPES_CALENDRIER.map(t => t.cle)

export const estVerrouille = (role, cle) => role === 'gerant' && INTERDITS_GERANT.includes(cle)

export function typesAutorises(role, { proprietaire = false, config = {} } = {}) {
  if (!ROLES_CALENDRIER.some(r => r.cle === role)) return []
  if (proprietaire) return CONNUS.filter(k => !estVerrouille(role, k))
  const types = Array.isArray(config[role]) ? config[role] : ACCES_CALENDRIER_DEFAUT[role]
  return types.filter(k => CONNUS.includes(k) && !estVerrouille(role, k))
}

export const basculerType = (types, cle) => (types.includes(cle) ? types.filter(k => k !== cle) : [...types, cle])
