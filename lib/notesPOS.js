// ──────────────────────────────────────────────────────────────────────────────
// Note des caissiers → lignes pour le POS (table cloud `notes_caissiers`).
//
// Chaque caissier voit SA note sur la caisse, à côté de son nom. Un caissier
// SamerTrackly peut avoir un compte sur plusieurs sites (un compte POS par
// restaurant) : on écrit une ligne par compte POS, clé (restaurant_id, id) —
// la même image disque part sur les 7 sites, un même uuid peut donc exister
// dans deux restaurants.
//
// Rapprochement d'un caissier et de ses comptes POS, par deux chemins :
//   1. sa fiche employé : utilisateurs.travailleur_id = utilisateurs_site.externe_id ;
//   2. les services qu'il a tenus au POS (note.idsPos, depuis stats_services).
//
// Pur : testé par lib/notesPOS.test.mjs. Appelé par publier-notes-pos.
// ──────────────────────────────────────────────────────────────────────────────
import { MIN_SHIFTS, appreciation } from './noteCaissier.js'

/** Ce que la caisse affiche d'un critère : pas les listes d'incidents nominatives. */
function compacter(c) {
  if (!c) return null
  return {
    cle: c.cle,
    points: c.points,
    max: c.max,
    applicable: !!c.applicable,
    resume: c.resume ?? null,
    conseil: c.conseil ?? null,
  }
}

/**
 * notes, notesPrec : sorties de calculerNotes (période et période précédente).
 * utilisateurs : comptes SamerTrackly { id, travailleur_id }.
 * utilisateursSite : comptes POS du cloud { id, restaurant_id, externe_id, actif }.
 */
export function lignesNotesPOS({ notes = [], notesPrec = [], utilisateurs = [], utilisateursSite = [], periodes = {}, maintenant = new Date() }) {
  const travailleurDe = new Map(utilisateurs.map(u => [String(u.id), u.travailleur_id ? String(u.travailleur_id) : null]))
  const precedente = new Map(notesPrec.map(n => [n.cle, n.note]))
  const parCompte = new Map()

  for (const n of notes) {
    const travailleur = n.id ? travailleurDe.get(String(n.id)) : null
    const idsPos = new Set((n.idsPos || []).map(String))
    const comptes = utilisateursSite.filter(u =>
      u.actif !== false
      && ((travailleur && u.externe_id && String(u.externe_id) === travailleur) || idsPos.has(String(u.id))))

    for (const u of comptes) {
      const cle = `${u.restaurant_id}:${u.id}`
      // Deux fiches peuvent viser le même compte (nom POS non relié) : on garde
      // celle qui repose sur le plus de shifts.
      const deja = parCompte.get(cle)
      if (deja && deja.nb_shifts >= n.nbShifts) continue
      parCompte.set(cle, {
        id: u.id,
        restaurant_id: u.restaurant_id,
        note: n.note,
        note_precedente: precedente.get(n.cle) ?? null,
        appreciation: appreciation(n.note).mot,
        nb_shifts: n.nbShifts,
        min_shifts: MIN_SHIFTS,
        criteres: (n.criteres || []).map(compacter),
        bonus: compacter(n.bonus),
        periode_debut: periodes.debut ?? null,
        periode_fin: periodes.fin ?? null,
        calcule_le: maintenant.toISOString(),
      })
    }
  }
  return [...parCompte.values()]
}
