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

// ── Proposition du vérificateur ───────────────────────────────────────────────
// Écarts de stock au-delà du seuil : le vérificateur ne demande plus d'explication
// directement. Il PROPOSE (une ligne par personne, insérées d'un seul INSERT →
// même created_at) et la direction décide : à qui envoyer, ou rien.

const PHRASE_CONCERNE = /Vous êtes concerné en tant que [^\n]*\.\n\n/

const estProposition = d => d.cree_par_role === 'verificateur' && d.statut === 'en_attente_acceptation'

/**
 * Un élément par comptage du vérificateur en attente de décision ; les autres
 * demandes passent telles quelles. L'élément regroupé se lit comme une demande
 * (statut, motif, description, travailleur_nom) : compteurs et recherche
 * fonctionnent dessus sans changement.
 */
export function regrouperPropositions(demandes) {
  const groupes = new Map()
  const out = []
  for (const d of demandes || []) {
    if (!estProposition(d)) { out.push(d); continue }
    const cle = `${d.restaurant_id}|${d.created_at}`
    let g = groupes.get(cle)
    if (!g) {
      const [motif] = String(d.motif || '').split(' — ')
      g = {
        id: `proposition-${cle}`, proposition: true, statut: d.statut,
        restaurant_id: d.restaurant_id, created_at: d.created_at,
        cree_par_id: d.cree_par_id, cree_par_nom: d.cree_par_nom, cree_par_role: d.cree_par_role,
        motif, description: String(d.description || '').replace(PHRASE_CONCERNE, ''),
        description_source: d.description, lignes: [],
      }
      groupes.set(cle, g)
      out.push(g)
    }
    g.lignes.push({ ...d, role: String(d.motif || '').split(' — ')[1] || null })
    g.travailleur_nom = g.lignes.map(l => l.travailleur_nom).filter(Boolean).join(', ')
  }
  return out
}

/** Le gérant ne voit une demande du vérificateur qu'une fois acceptée par la direction. */
export function visiblePourGerant(d) {
  return d.cree_par_role !== 'verificateur' || !!d.accepte_at
}

/**
 * Décision de la direction sur une proposition.
 * @param p        proposition (regrouperPropositions)
 * @param coches   ids des lignes proposées à envoyer
 * @param ajouts   travailleurs ajoutés [{ id, nom, poste }]
 * @returns { accepter: ids, ecarter: ids, ajouter: travailleurs, nb }
 */
export function decisionProposition(p, coches, ajouts) {
  const sel = new Set(coches || [])
  const accepter = p.lignes.filter(l => l.travailleur_nom && sel.has(l.id)).map(l => l.id)
  const ecarter = p.lignes.filter(l => !accepter.includes(l.id)).map(l => l.id)
  const dejaLa = l => t => (l.travailleur_id && l.travailleur_id === t.id)
    || sansAccents(l.travailleur_nom) === sansAccents(t.nom)
  const ajouter = (ajouts || []).filter(t => !p.lignes.some(l => dejaLa(l)(t)))
  return { accepter, ecarter, ajouter, nb: accepter.length + ajouter.length }
}

/** Description d'une demande de la proposition, pour une personne ajoutée. */
export function descriptionPour(description, precision) {
  return String(description || '').replace(PHRASE_CONCERNE, `Vous êtes concerné (${precision}).\n\n`)
}
