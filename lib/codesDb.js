// Codes personnels vérifiés par le serveur (supabase_codes_securises.sql).
// Chaque fonction rend { statut, … } : 'ok' | 'faux' | 'bloque' | 'inconnu' |
// 'invalide' (avec message) | 'refuse' | 'hors_ligne' | 'erreur' (avec message).
import { supabase } from './supabase'

async function appeler(fonction, params) {
  try {
    const { data, error } = await supabase.rpc(fonction, params)
    if (error) {
      if (/connexion_utilisateur|changer_mon_code|codes_utilisateurs|enregistrer_utilisateur/.test(error.message || '') && /(does not exist|schema cache|Could not find)/i.test(error.message || '')) {
        return { statut: 'erreur', message: 'Les codes sécurisés ont besoin de supabase_codes_securises.sql : il faut passer ce fichier dans Supabase.' }
      }
      return { statut: 'erreur', message: 'Le serveur ne répond pas. Réessayez.' }
    }
    return data || { statut: 'erreur', message: 'Réponse vide du serveur.' }
  } catch {
    return { statut: 'hors_ligne' }
  }
}

export const connexionUtilisateur = (userId, code) =>
  appeler('connexion_utilisateur', { p_user: userId, p_pin: code })

export const changerMonCode = (userId, ancien, nouveau) =>
  appeler('changer_mon_code', { p_user: userId, p_ancien: ancien, p_nouveau: nouveau })

/** { statut: 'ok', codes: { [userId]: code } } après le code du manager. */
export const codesUtilisateurs = (adminId, adminCode) =>
  appeler('codes_utilisateurs', { p_admin: adminId, p_admin_pin: adminCode })

/** Créer (id null) ou modifier un compte ; code vide = inchangé. */
export const enregistrerUtilisateur = (adminId, adminCode, { id = null, nom, role, restaurantId = null, code = '' }) =>
  appeler('enregistrer_utilisateur', {
    p_admin: adminId, p_admin_pin: adminCode, p_id: id, p_nom: nom, p_role: role, p_restaurant: restaurantId, p_pin: code || null,
  })

/** Message à afficher pour une réponse qui n'est pas « ok ». */
export function messageReponse(r) {
  if (!r) return 'Réessayez.'
  if (r.statut === 'faux') return r.essais_restants ? `Code incorrect. Encore ${r.essais_restants} essai${r.essais_restants > 1 ? 's' : ''} avant blocage.` : 'Code incorrect.'
  if (r.statut === 'bloque') return 'Trop d\'erreurs : ce compte est bloqué un moment.'
  if (r.statut === 'refuse') return 'Seul un manager peut faire cela.'
  if (r.statut === 'inconnu') return 'Ce compte n\'existe plus ou est désactivé.'
  if (r.statut === 'hors_ligne') return 'Pas de connexion internet.'
  return r.message || 'Réessayez.'
}
