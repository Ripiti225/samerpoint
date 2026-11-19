// ──────────────────────────────────────────────────────────────────────────────
// Supervision des restaurants : le superviseur passe, note une grille de points
// (propreté, documents, ponctualité, accueil…), laisse des tâches à cocher et
// note les travailleurs qu'il voit.
//
// Note d'une visite (/20) : chaque point est noté de 1 à 5 étoiles, pondéré par
// son poids dans la grille (1 étoile = 0, 5 étoiles = plein).
//
// Note du restaurant (/20, 30 derniers jours) : 60 % visites + 40 % données.
//   Visites ... moyenne des visites terminées (note corrigée par le manager
//               si une contestation a été acceptée).
//   Données ... moyenne des notes de ses caissiers (caisse, numéros clients,
//               inventaire, avis, présence), pondérée par leurs shifts ; et,
//               pour un quart, la part des tâches du superviseur faites à temps.
//   Sans visite récente, seules les données comptent (et inversement).
//
// La note des caissiers (lib/noteCaissier.js) ne prend PAS l'avis du
// superviseur : il ne croise jamais le caissier de nuit (choix du 15/10/2026).
//
// Pur (aucun import React ni Supabase) : testé par lib/supervision.test.mjs.
// Chargement : lib/supervisionDb.js. Tables : supabase_supervision.sql.
// ──────────────────────────────────────────────────────────────────────────────

export const NOTE_MIN = 1
export const NOTE_MAX = 5
export const NOTE_BASSE = 2              // ≤ 2 étoiles : photo obligatoire
export const PART_VISITES = 0.6
export const PART_TACHES = 0.25          // dans la partie « données »
export const JOURS_PERIODE = 30
export const JOURS_SANS_VISITE_ALERTE = 14

export const LIBELLES_ETOILES = { 1: 'Très mauvais', 2: 'Mauvais', 3: 'Moyen', 4: 'Bien', 5: 'Très bien' }

const n = v => Number(v) || 0
const arrondi = (v, pas = 0.5) => Math.round(v / pas) * pas
const jourDe = v => (v ? String(v).slice(0, 10) : null)

function decaler(dateIso, jours) {
  const d = new Date(`${dateIso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + jours)
  return d.toISOString().slice(0, 10)
}

/** Nombre de jours entiers de a à b (dates ISO). */
export function joursEntre(a, b) {
  return Math.round((Date.parse(`${jourDe(b)}T12:00:00Z`) - Date.parse(`${jourDe(a)}T12:00:00Z`)) / 86_400_000)
}

/** « 45 min », « 1 h 20 » ; null si la visite n'est pas terminée. */
export function dureeVisite(debut, fin) {
  if (!debut || !fin) return null
  const min = Math.max(0, Math.round((Date.parse(fin) - Date.parse(debut)) / 60_000))
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`
}

// ── Visite en cours : oubli, brouillon ──────────────────────────────────────

/**
 * Visite commencée un jour d'avant et jamais terminée : abandonnée d'office
 * (choix du 15/10/2026). Abidjan = UTC, donc le jour se lit sur l'heure UTC.
 */
export function visiteOubliee(v, aujourdhui) {
  return !!v && v.statut === 'en_cours' && !!v.debut_at && jourDe(v.debut_at) < aujourdhui
}

/** Le brouillon le plus récent entre celui du téléphone et celui de la base (champ saved_at). */
export function brouillonLePlusRecent(local, distant) {
  if (!local) return distant || null
  if (!distant) return local
  return n(distant.saved_at) > n(local.saved_at) ? distant : local
}

// ── Note d'une visite ───────────────────────────────────────────────────────

/** notes = [{ poids, note (1-5) }] → note /20 au demi-point, ou null. */
export function noteVisite(notes) {
  const valides = (notes || []).filter(x => n(x.note) >= NOTE_MIN && n(x.note) <= NOTE_MAX && n(x.poids) > 0)
  const total = valides.reduce((s, x) => s + n(x.poids), 0)
  if (!total) return null
  const points = valides.reduce((s, x) => s + n(x.poids) * (n(x.note) - NOTE_MIN) / (NOTE_MAX - NOTE_MIN), 0)
  return arrondi((points / total) * 20)
}

/** Note qui compte pour une visite : la note corrigée si le manager a accepté une contestation. */
export function noteRetenueVisite(v) {
  if (!v) return null
  if (v.decision === 'corrigee' && v.note_corrigee !== null && v.note_corrigee !== undefined) return n(v.note_corrigee)
  return v.note === null || v.note === undefined ? null : n(v.note)
}

/**
 * Ce qui manque avant de terminer une visite (messages affichés tels quels).
 *   criteres : grille active [{ id, libelle }]
 *   notes    : { [critere_id]: { note, photo_url, grave, commentaire } }
 *   nouvelles: tâches créées pendant la visite [{ titre, importante, photo_constat_url }]
 *   confirmees: tâches marquées faites pendant la visite [{ titre, importante, photo, signalee_photo_url }]
 *   pannes    : matériel en panne signalé pendant la visite [{ objet, photo_url }]
 *   achats    : suggestions d'achats [{ objet, quantite }]
 */
export function manquesVisite({ criteres = [], notes = {}, nouvelles = [], confirmees = [], pannes = [], achats = [] }) {
  const manques = []
  for (const c of criteres) {
    const x = notes[c.id]
    if (!x || !x.note) { manques.push(`Noter « ${c.libelle} »`); continue }
    if (x.note <= NOTE_BASSE && !x.photo_url) manques.push(`Photo obligatoire : « ${c.libelle} » (note basse)`)
    if (x.grave && !String(x.commentaire || '').trim()) manques.push(`Expliquer le point grave : « ${c.libelle} »`)
  }
  for (const t of nouvelles) {
    if (!String(t.titre || '').trim()) manques.push('Une nouvelle tâche n\'a pas de titre')
    else if (t.importante && !t.photo_constat_url) manques.push(`Photo obligatoire : tâche importante « ${t.titre.trim()} »`)
  }
  for (const t of confirmees) {
    if (t.importante && !t.photo && !t.signalee_photo_url) manques.push(`Photo obligatoire pour confirmer « ${t.titre} »`)
  }
  for (const p of pannes) {
    if (!String(p.objet || '').trim()) manques.push('Un matériel en panne n\'a pas de nom')
    else if (!p.photo_url) manques.push(`Photo obligatoire : panne « ${p.objet.trim()} »`)
  }
  for (const a of achats) {
    if (!String(a.objet || '').trim()) manques.push('Une suggestion d\'achat n\'a pas de nom')
    else if (!(Number(a.quantite) > 0)) manques.push(`Quantité à indiquer : « ${a.objet.trim()} »`)
  }
  return manques
}

// ── Tâches ──────────────────────────────────────────────────────────────────

/** 'faite' | 'a_confirmer' | 'en_retard' | 'a_faire' | 'annulee'. */
export function etatTache(t, aujourdhui) {
  if (t.statut === 'faite') return 'faite'
  if (t.statut === 'annulee') return 'annulee'
  if (t.statut === 'signalee') return 'a_confirmer'
  if (t.echeance && aujourdhui && t.echeance < aujourdhui) return 'en_retard'
  return 'a_faire'
}

export const ETATS_TACHE = {
  a_faire: { label: 'À faire', emoji: '⏳', couleur: '#B45309' },
  en_retard: { label: 'En retard', emoji: '⚠️', couleur: '#C2462B' },
  a_confirmer: { label: 'Faite, à confirmer', emoji: '📸', couleur: '#2F7FD8' },
  faite: { label: 'Faite', emoji: '✅', couleur: '#0E8A6B' },
  annulee: { label: 'Annulée', emoji: '✖️', couleur: '#64748B' },
}

/** Une tâche est-elle encore ouverte (à vérifier à la prochaine visite) ? */
export const tacheOuverte = t => t.statut === 'a_faire' || t.statut === 'signalee'

/**
 * Part des tâches faites à temps parmi celles dont l'échéance tombe dans
 * [debut, aujourdhui]. Faite à temps = signalée par le gérant (puis confirmée)
 * ou confirmée sur place au plus tard le jour de l'échéance.
 */
export function partTachesATemps(taches, debut, aujourdhui) {
  const echues = (taches || []).filter(t => t.statut !== 'annulee' && t.echeance && t.echeance >= debut && t.echeance <= aujourdhui)
  if (!echues.length) return { applicable: false, ratio: null, nbEchues: 0, nbATemps: 0 }
  const aTemps = echues.filter(t => {
    if (t.statut !== 'faite') return false
    const quand = jourDe(t.signalee_at) || jourDe(t.faite_at)
    return !!quand && quand <= t.echeance
  }).length
  return { applicable: true, ratio: aTemps / echues.length, nbEchues: echues.length, nbATemps: aTemps }
}

// ── Matériel en panne et suggestions d'achats ───────────────────────────────

export const ETATS_PANNE = {
  en_panne: { label: 'En panne', emoji: '🔧', couleur: '#C2462B' },
  reparee: { label: 'Réparé', emoji: '✅', couleur: '#0E8A6B' },
  remplacee: { label: 'Remplacé', emoji: '🔁', couleur: '#0E8A6B' },
  annulee: { label: 'Retiré', emoji: '✖️', couleur: '#64748B' },
}
export const ETATS_ACHAT = {
  proposee: { label: 'À examiner', emoji: '💡', couleur: '#B45309' },
  acceptee: { label: 'Accepté, à acheter', emoji: '👍', couleur: '#2F7FD8' },
  achetee: { label: 'Acheté', emoji: '✅', couleur: '#0E8A6B' },
  refusee: { label: 'Refusé', emoji: '✖️', couleur: '#64748B' },
}

export const panneOuverte = p => p.statut === 'en_panne'
export const achatOuvert = a => a.statut === 'proposee' || a.statut === 'acceptee'

/** Jours depuis le signalement d'une panne encore ouverte (null si réglée). */
export function joursEnPanne(p, aujourdhui) {
  return panneOuverte(p) && p.created_at ? joursEntre(p.created_at, aujourdhui) : null
}

/** Total estimé (FCFA) des achats acceptés pas encore faits ; les prix inconnus comptent 0. */
export function totalAchatsAcceptes(achats) {
  return (achats || []).filter(a => a.statut === 'acceptee').reduce((s, a) => s + n(a.prix_estime) * Math.max(1, n(a.quantite)), 0)
}

// ── Note du restaurant ──────────────────────────────────────────────────────

/** Moyenne des notes /20 des caissiers rattachés au restaurant, pondérée par leurs shifts. */
export function moyenneCaissiers(notesCaissiers, restaurantId) {
  const siens = (notesCaissiers || []).filter(c => c.note !== null && c.note !== undefined
    && String(c.restaurantId) === String(restaurantId))
  const poids = siens.reduce((s, c) => s + Math.max(1, n(c.nbShifts)), 0)
  if (!poids) return { note: null, nb: 0 }
  const note = siens.reduce((s, c) => s + n(c.note) * Math.max(1, n(c.nbShifts)), 0) / poids
  return { note: arrondi(note), nb: siens.length }
}

/**
 * Note d'un restaurant sur les 30 derniers jours.
 *   visites       : supervision_visites (toutes, on filtre ici)
 *   notesCaissiers: résultat de calculerNotes (lib/noteCaissier.js) ou []
 *   taches        : supervision_taches du restaurant
 */
export function noteRestaurant({ restaurantId, visites = [], notesCaissiers = [], taches = [], aujourdhui }) {
  const debut = decaler(aujourdhui, -(JOURS_PERIODE - 1))
  const siennes = visites
    .filter(v => String(v.restaurant_id) === String(restaurantId) && v.statut === 'terminee')
    .sort((a, b) => String(b.fin_at || b.debut_at).localeCompare(String(a.fin_at || a.debut_at)))
  const recentes = siennes.filter(v => jourDe(v.fin_at || v.debut_at) >= debut && noteRetenueVisite(v) !== null)
  const noteVisites = recentes.length
    ? arrondi(recentes.reduce((s, v) => s + noteRetenueVisite(v), 0) / recentes.length)
    : null

  const caissiers = moyenneCaissiers(notesCaissiers, restaurantId)
  const tachesTemps = partTachesATemps(taches.filter(t => String(t.restaurant_id) === String(restaurantId)), debut, aujourdhui)
  let noteDonnees = null
  if (caissiers.note !== null && tachesTemps.applicable) {
    noteDonnees = arrondi((1 - PART_TACHES) * caissiers.note + PART_TACHES * tachesTemps.ratio * 20)
  } else if (caissiers.note !== null) {
    noteDonnees = caissiers.note
  } else if (tachesTemps.applicable) {
    noteDonnees = arrondi(tachesTemps.ratio * 20)
  }

  let note = null
  if (noteVisites !== null && noteDonnees !== null) note = arrondi(PART_VISITES * noteVisites + (1 - PART_VISITES) * noteDonnees)
  else note = noteVisites ?? noteDonnees

  const derniere = siennes[0] || null
  const derniereVisite = derniere ? jourDe(derniere.fin_at || derniere.debut_at) : null
  const joursSansVisite = derniereVisite ? joursEntre(derniereVisite, aujourdhui) : null
  return {
    note,
    visites: { note: noteVisites, nb: recentes.length },
    donnees: { note: noteDonnees, caissiers, taches: tachesTemps },
    derniereVisite,
    joursSansVisite,
    sansVisite: joursSansVisite === null || joursSansVisite > JOURS_SANS_VISITE_ALERTE,
  }
}

/** Phrase qui explique d'où vient la note (affichée sous le chiffre). */
export function explicationNote(r) {
  const morceaux = []
  if (r.visites.note !== null) morceaux.push(`visites ${fmtNote(r.visites.note)} (${r.visites.nb})`)
  if (r.donnees.note !== null) morceaux.push(`données ${fmtNote(r.donnees.note)}`)
  if (!morceaux.length) return 'Pas encore de visite ni de données sur 30 jours'
  if (morceaux.length === 2) return `${morceaux[0]} × 60 % + ${morceaux[1]} × 40 %`
  return r.visites.note === null ? `Pas de visite sur 30 jours : ${morceaux[0]} seulement` : `Pas encore de données : ${morceaux[0]} seulement`
}

export const fmtNote = v => (v === null || v === undefined ? '—' : String(v).replace('.', ','))

// ── Travailleurs ────────────────────────────────────────────────────────────

/**
 * Note « terrain » de chaque travailleur vu en visite : moyenne des étoiles,
 * nombre de retards et d'absences constatés, dernier commentaire.
 * lignes : supervision_travailleurs (avec created_at), les plus récentes en dernier ou non.
 */
export function notesTravailleurs(lignes) {
  const par = new Map()
  for (const l of lignes || []) {
    const cle = l.travailleur_id ? `id:${l.travailleur_id}` : `nom:${String(l.travailleur_nom || '').trim().toLowerCase()}`
    if (!par.has(cle)) {
      par.set(cle, { cle, id: l.travailleur_id || null, nom: l.travailleur_nom, poste: l.poste || null,
        restaurantId: l.restaurant_id, notes: [], retards: 0, absences: 0, dernier: null })
    }
    const p = par.get(cle)
    if (l.absent) p.absences += 1
    else if (n(l.note) >= NOTE_MIN) p.notes.push(n(l.note))
    if (l.en_retard) p.retards += 1
    if (!p.dernier || String(l.created_at) > String(p.dernier.created_at)) {
      p.dernier = l
      p.nom = l.travailleur_nom || p.nom
      p.poste = l.poste || p.poste
      p.restaurantId = l.restaurant_id || p.restaurantId
    }
  }
  return [...par.values()].map(p => ({
    cle: p.cle, id: p.id, nom: p.nom, poste: p.poste, restaurantId: p.restaurantId,
    nbVisites: p.notes.length + p.absences,
    moyenne: p.notes.length ? Math.round((p.notes.reduce((s, x) => s + x, 0) / p.notes.length) * 10) / 10 : null,
    retards: p.retards,
    absences: p.absences,
    dernierCommentaire: p.dernier?.commentaire || null,
    derniereDate: jourDe(p.dernier?.created_at),
  })).sort((a, b) => (a.moyenne ?? 99) - (b.moyenne ?? 99) || String(a.nom).localeCompare(String(b.nom)))
}

// ── Qui fait la visite (supabase_supervision_plusieurs.sql) ─────────────────
// Le compte « Superviseur » n'est qu'une porte d'entrée : on y choisit son nom
// parmi les comptes cochés « Peut faire des visites », puis on tape SON code.

/** Le compte porte d'entrée de la supervision (rôle superviseur). */
export const estPorteSupervision = u => u?.role === 'superviseur'

/** Comptes actifs autorisés à faire des visites, par nom, sans la porte. */
export function superviseursPossibles(utilisateurs = []) {
  return (utilisateurs || [])
    .filter(u => u && u.actif !== false && u.peut_superviser === true && !estPorteSupervision(u))
    .sort((a, b) => String(a.nom).trim().localeCompare(String(b.nom).trim(), 'fr'))
}

/** Restaurants que cette personne peut visiter : jamais le sien (gérant). */
export function restaurantsVisitables(restaurants = [], personne) {
  const sien = personne?.restaurant_id || null
  return sien ? restaurants.filter(r => r.id !== sien) : restaurants
}
