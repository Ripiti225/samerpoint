// ──────────────────────────────────────────────────────────────────────────────
// Demandes (permissions, congés, aides…) et demandes d'explication — logique
// pure partagée par les 4 écrans (gérant et direction/RH).
// Statuts, regroupements pour les compteurs, recherche, retard de réponse.
// Tests : lib/demandes.test.mjs
// ──────────────────────────────────────────────────────────────────────────────

export const VIOLET = '#534AB7'

// Demandes (table `demandes`)
export const STATUTS_DEMANDE = {
  en_attente: { label: 'En attente', emoji: '🟡', couleur: '#B7791F' },
  validee: { label: 'Validée', emoji: '✅', couleur: '#3B8D2F' },
  declinee: { label: 'Déclinée', emoji: '❌', couleur: '#C2462B' },
  annulee: { label: 'Annulée', emoji: '🚫', couleur: '#7A7A86' },
}

// Compteurs / filtres de l'écran Demandes (cle = statut, null = toutes).
export const FILTRES_DEMANDE = [
  { cle: null, label: 'Toutes' },
  { cle: 'en_attente', label: 'En attente' },
  { cle: 'validee', label: 'Validées' },
  { cle: 'declinee', label: 'Déclinées' },
  { cle: 'annulee', label: 'Annulées' },
]

// Demandes d'explication (table `demandes_explication`)
export const STATUTS_EXPLICATION = {
  en_attente_acceptation: { label: "En attente d'acceptation", emoji: '🟡', couleur: '#B7791F' },
  acceptee: { label: 'Acceptée — à envoyer', emoji: '📤', couleur: '#2F6FD8' },
  envoyee: { label: 'Envoyée — attente réponse', emoji: '📨', couleur: VIOLET },
  reponse_recuperee: { label: 'Réponse récupérée', emoji: '✅', couleur: '#3B8D2F' },
  relancee: { label: 'Relancée (2ᵉ demande)', emoji: '🔁', couleur: '#C27C1A' },
  refusee: { label: 'Refusée', emoji: '❌', couleur: '#C2462B' },
  annulee: { label: 'Annulée', emoji: '🚫', couleur: '#7A7A86' },
}

// Étapes du suivi, pour les compteurs et le filtre (une étape = plusieurs statuts).
export const ETAPES_EXPLICATION = [
  { cle: null, label: 'Toutes', statuts: null },
  { cle: 'a_accepter', label: 'À accepter', statuts: ['en_attente_acceptation'] },
  { cle: 'a_envoyer', label: 'À envoyer', statuts: ['acceptee'] },
  { cle: 'attente', label: 'Attente réponse', statuts: ['envoyee'] },
  { cle: 'terminees', label: 'Terminées', statuts: ['reponse_recuperee', 'relancee', 'refusee', 'annulee'] },
]

// Couleur de chaque étape dans les compteurs.
export const COULEURS_ETAPES = {
  a_accepter: STATUTS_EXPLICATION.en_attente_acceptation.couleur,
  a_envoyer: STATUTS_EXPLICATION.acceptee.couleur,
  attente: STATUTS_EXPLICATION.envoyee.couleur,
  terminees: STATUTS_EXPLICATION.reponse_recuperee.couleur,
}

const TROIS_JOURS = 3 * 24 * 60 * 60 * 1000

/** Envoyée depuis plus de 3 jours sans réponse. */
export function enRetard(d, maintenant = Date.now()) {
  return d.statut === 'envoyee' && !!d.envoyee_at && maintenant - new Date(d.envoyee_at).getTime() > TROIS_JOURS
}

/** Seuil (ISO) à passer à Supabase : envoyées avant cette date = en retard. */
export function seuilRetard(maintenant = Date.now()) {
  return new Date(maintenant - TROIS_JOURS).toISOString()
}

/**
 * Demandes dont le jour de réponse (J+3 après l'envoi) est passé sans
 * réponse, la plus ancienne d'abord, avec le nombre de jours depuis l'envoi.
 * Sert au panneau de notifications de l'accueil (manager et RH).
 */
export function explicationsSansReponse(demandes, maintenant = Date.now()) {
  return (demandes || [])
    .filter(d => enRetard(d, maintenant))
    .map(d => ({ ...d, joursDepuisEnvoi: Math.floor((maintenant - new Date(d.envoyee_at).getTime()) / 86400000) }))
    .sort((a, b) => new Date(a.envoyee_at) - new Date(b.envoyee_at))
}

export function fmtDate(d) {
  if (!d) return ''
  const [y, m, j] = String(d).split('T')[0].split('-')
  const mois = ['jan', 'fév', 'mar', 'avr', 'mai', 'juin', 'juil', 'août', 'sep', 'oct', 'nov', 'déc']
  return `${parseInt(j)} ${mois[parseInt(m) - 1]} ${y}`
}

export function fmtMontant(n) {
  return `${Math.round(Number(n) || 0).toLocaleString('fr-FR')} FCFA`
}

const sansAccents = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Recherche sur le travailleur, le type, le motif et la description (accents ignorés). */
export function correspond(d, recherche) {
  const q = sansAccents(recherche).trim()
  if (!q) return true
  return [d.travailleur_nom, d.type, d.motif, d.description, d.cree_par_nom].some(c => sansAccents(c).includes(q))
}

/** Nombre de demandes par filtre (clé null = toutes). */
export function compterDemandes(demandes) {
  const out = { null: demandes.length }
  for (const f of FILTRES_DEMANDE) if (f.cle) out[f.cle] = demandes.filter(d => d.statut === f.cle).length
  return out
}

/** Nombre par étape + nombre en retard (parmi « Attente réponse »). */
export function compterExplications(demandes, maintenant = Date.now()) {
  const out = { null: demandes.length, retard: demandes.filter(d => enRetard(d, maintenant)).length }
  for (const e of ETAPES_EXPLICATION) if (e.cle) out[e.cle] = demandes.filter(d => e.statuts.includes(d.statut)).length
  return out
}

export function filtrerDemandes(demandes, { statut = null, recherche = '' } = {}) {
  return demandes.filter(d => (!statut || d.statut === statut) && correspond(d, recherche))
}

export function filtrerExplications(demandes, { etape = null, recherche = '' } = {}) {
  const statuts = ETAPES_EXPLICATION.find(e => e.cle === etape)?.statuts
  return demandes.filter(d => (!statuts || statuts.includes(d.statut)) && correspond(d, recherche))
}
