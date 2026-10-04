// ──────────────────────────────────────────────────────────────────────────────
// À quel caissier attribuer un avis client ? Au caissier qui tenait la caisse
// à l'heure de la commande (règle du propriétaire, 2026-10-03).
//
// - Avec l'heure : le shift du restaurant qui couvre ce moment. Un service de
//   soirée qui finit après minuit est rattaché à sa journée (les shifts de la
//   veille sont donc regardés aussi).
// - Sans l'heure : seulement si un seul caissier a travaillé ce jour-là.
// - Dans le doute (plusieurs caissiers en même temps, aucun shift) : personne.
//   Mieux vaut un avis sans responsable qu'un caissier qui paie pour un autre.
//
// Pur : testé par lib/attributionAvis.test.mjs.
// ──────────────────────────────────────────────────────────────────────────────

const minutes = h => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(h || ''))
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

const jours = (a, b) => Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86_400_000)

/** « 9h », « 09:05 », « 21h30 » → « 09:00 », « 09:05 », « 21:30 » ; null si illisible. */
export function normaliserHeure(texte) {
  const m = /^\s*(\d{1,2})\s*(?:[h:.]\s*(\d{0,2}))?\s*$/i.exec(String(texte || ''))
  if (!m) return null
  const h = Number(m[1]), mn = Number(m[2] || 0)
  if (h > 23 || mn > 59) return null
  return `${String(h).padStart(2, '0')}:${String(mn).padStart(2, '0')}`
}

const cleCaissier = s => (s.caissier_id ? `id:${s.caissier_id}` : `nom:${String(s.caissier_nom || '').trim().toLowerCase()}`)

/**
 * shifts : points_shifts { restaurant_id, date, caissier_id, caissier_nom, heure_debut, heure_fin }
 * Renvoie { caissier_id, caissier_nom, raison, shift } ou { caissier_id: null, raison, candidats }.
 * raison : 'heure' | 'seul_du_jour' | 'plusieurs' | 'aucun' | 'sans_heure_plusieurs'
 */
export function caissierAuMoment(shifts, { restaurantId, date, heure }) {
  const duResto = (shifts || []).filter(s => s.restaurant_id === restaurantId && s.date)
  const h = minutes(normaliserHeure(heure) || heure)

  if (h === null) {
    const duJour = duResto.filter(s => s.date === date)
    const caissiers = [...new Map(duJour.map(s => [cleCaissier(s), s])).values()]
    if (caissiers.length === 1) return { caissier_id: caissiers[0].caissier_id || null, caissier_nom: (caissiers[0].caissier_nom || '').trim(), raison: 'seul_du_jour', shift: caissiers[0] }
    return { caissier_id: null, raison: caissiers.length ? 'sans_heure_plusieurs' : 'aucun', candidats: caissiers }
  }

  // Le moment de la commande, en minutes depuis minuit le jour de l'avis.
  const presents = duResto.filter(s => {
    const decalage = jours(s.date, date) // 0 : même jour ; -1 : shift commencé la veille
    if (decalage !== 0 && decalage !== -1) return false
    const debut = minutes(s.heure_debut)
    if (debut === null) return false
    let fin = minutes(s.heure_fin)
    if (fin === null) fin = debut + 12 * 60
    if (fin <= debut) fin += 24 * 60
    const d = decalage * 1440 + debut, f = decalage * 1440 + fin
    return h >= d && h < f
  })
  const caissiers = [...new Map(presents.map(s => [cleCaissier(s), s])).values()]
  if (caissiers.length === 1) return { caissier_id: caissiers[0].caissier_id || null, caissier_nom: (caissiers[0].caissier_nom || '').trim(), raison: 'heure', shift: caissiers[0] }
  return { caissier_id: null, raison: caissiers.length ? 'plusieurs' : 'aucun', candidats: caissiers }
}

/** Phrase courte pour le formulaire (« Caissier présent à 09:00 : Bazie, shift 06:00 → 15:00 »). */
export function phraseAttribution(r, heure) {
  const hh = s => String(s || '').slice(0, 5) || '?'
  if (r.raison === 'heure') return `Caissier présent à ${normaliserHeure(heure)} : ${r.caissier_nom} (shift ${hh(r.shift.heure_debut)} → ${hh(r.shift.heure_fin)})`
  if (r.raison === 'seul_du_jour') return `Seul caissier ce jour-là : ${r.caissier_nom}`
  if (r.raison === 'plusieurs') return `Plusieurs caissiers à cette heure (${r.candidats.map(c => (c.caissier_nom || '').trim()).join(', ')}) : choisissez`
  if (r.raison === 'sans_heure_plusieurs') return 'Plusieurs caissiers ce jour-là : indiquez l’heure de la commande'
  return 'Aucun shift trouvé à ce moment'
}
