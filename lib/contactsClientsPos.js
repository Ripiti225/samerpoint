// ──────────────────────────────────────────────────────────────────────────────
// Numéros clients du POS → table `contacts_clients` de Samtrackly.
//
// Depuis la bascule POS, les caissières saisissent le numéro du client dans le
// POS ; il vit dans `commandes.contact_client` du cloud POS. La fonction
// `import-contacts-pos` (supabase/functions) les rapatrie à chaque shift validé
// et les range ici, pour que l'écran Contacts puisse écrire aux clients.
//
// Module PUR, partagé par la fonction (Deno) et testé sous node :
// lib/contactsClientsPos.test.mjs
// ──────────────────────────────────────────────────────────────────────────────

/** Un numéro exploitable : au moins 8 chiffres une fois les espaces retirés. */
export function numeroValide(numero) {
  return String(numero || '').replace(/\D/g, '').length >= 8
}

/**
 * Commande POS → ligne `contacts_clients`, ou null si elle ne doit pas être
 * importée (pas de numéro valable, commande annulée, restaurant non relié).
 * correspondance : { id restaurant POS → id restaurant Samtrackly }
 */
export function versContactClient(cmd, correspondance) {
  if (!cmd || cmd.statut === 'ANNULEE' || !numeroValide(cmd.contact_client)) return null
  const restaurant = correspondance[cmd.restaurant_id]
  if (!restaurant) return null
  return {
    pos_commande_id: cmd.id,
    numero: String(cmd.contact_client).trim(),
    restaurant_id: restaurant,
    date: String(cmd.created_at).slice(0, 10),
    commande_at: cmd.created_at,
    partenaire: cmd.partenaire || null,
    pos_service_id: cmd.service_id || null,
  }
}

/**
 * Date à partir de laquelle relire le POS : 2 jours avant le dernier contact
 * importé (marge pour un shift clôturé en retard), ou la date demandée.
 */
export function dateDepart(dernierImporte, depuis, defaut = '2026-08-01') {
  if (depuis) return depuis
  if (!dernierImporte) return defaut
  const d = new Date(`${String(dernierImporte).slice(0, 10)}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 2)
  return d.toISOString().slice(0, 10)
}
