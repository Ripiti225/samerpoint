// ──────────────────────────────────────────────────────────────────────────────
// Note des caissiers dans l'application : branche le client Supabase de l'app
// et la lecture des ventes du POS sur le calcul commun (lib/noteCaissierCharge.js).
// ──────────────────────────────────────────────────────────────────────────────
import { supabase } from './supabase'
import { chargerEtCalculerNotes, periodesNote } from './noteCaissierCharge'
import { chargerVentesParService } from './statsPOSDb'

export { periodesNote }

/**
 * Charge tout et calcule les notes des deux périodes.
 * restaurantId : limite aux shifts de ce restaurant (gérant), ou null (tous).
 * Renvoie { notes, notesPrec, restaurants, periodes, posErreur }.
 */
export function chargerNotesCaissiers(options = {}) {
  return chargerEtCalculerNotes({ ...options, client: supabase, chargerVentes: chargerVentesParService })
}
