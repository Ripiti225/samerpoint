import { supabase } from './supabase'

/**
 * Log une erreur technique en DB sans jamais bloquer l'opération en cours.
 * Visible dans Supabase Table Editor → erreurs_client pour monitoring.
 */
export function logErreur(contexte, erreur, meta = {}) {
  const message = erreur?.message || String(erreur) || 'Erreur inconnue'
  const details = erreur?.details || erreur?.hint || null

  supabase.from('erreurs_client').insert({
    contexte,
    message,
    details,
    meta: Object.keys(meta).length > 0 ? meta : null,
    created_at: new Date().toISOString(),
  }).then(({ error }) => {
    // Si la table n'existe pas encore, on log seulement en console
    if (error) console.error(`[${contexte}]`, message, details || '')
  })
}
