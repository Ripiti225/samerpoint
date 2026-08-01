/*
 * Comptage du vérificateur → stock initial de l'inventaire.
 *
 * Le vérificateur compte physiquement (app/verificateur.js). Le nombre compté
 * devient le stock initial de l'inventaire, au lieu du stock déclaré par le
 * caissier. Sans ça, le manque physique constaté réapparaît en écart au shift
 * suivant, à la charge d'un caissier qui n'y est pour rien.
 *
 * Deux cas, tous les deux couverts :
 *   • Un inventaire est déjà ouvert (non validé) → on pose un override sur le
 *     shift (colonne stock_initial_verif), que app/inventaire.js réapplique à
 *     chaque chargement.
 *   • Aucun inventaire ouvert → rien à écrire : chargerStockInitial() lit le
 *     dernier comptage et le préfère au stock_reel du dernier shift validé.
 *
 * L'override est porté par le shift et non par les lignes, parce que
 * app/inventaire.js supprime/réinsère toutes les lignes à chaque sauvegarde :
 * un UPDATE direct de inventaire_lignes.stock_initial serait écrasé.
 *
 * Voir supabase_verification_stock_initial.sql.
 */

import { supabase } from './supabase'

// Colonnes ajoutées par la migration. Tant qu'elle n'est pas passée, on ne
// bloque rien : le comptage reste enregistré, seul le report est ignoré.
function colonneManquante(error) {
  return /stock_initial_verif|verif_lot_id|verif_applique_at|inventaire_id|stock_compte_origine|corrige_/i.test(error?.message || '')
}

/**
 * Dernier inventaire non validé d'un restaurant (celui que le caissier remplit).
 * @returns {{ shift: object|null, migration: boolean }} migration = colonne
 *   stock_initial_verif absente, donc report impossible (à ne pas confondre
 *   avec « aucun inventaire ouvert »).
 */
export async function inventaireOuvert(restaurantId) {
  if (!restaurantId) return { shift: null, migration: false }
  const { data, error } = await supabase
    .from('inventaires_shifts')
    .select('id, date, type_shift, valide, stock_initial_verif, verif_lot_id')
    .eq('restaurant_id', restaurantId)
    .or('valide.is.null,valide.eq.false')
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) return { shift: null, migration: colonneManquante(error) }
  return { shift: (data || [])[0] || null, migration: false }
}

/**
 * Pose/complète l'override de stock initial sur un shift.
 * @param {object} shift  ligne inventaires_shifts (avec stock_initial_verif)
 * @param {object} valeurs { produit_id: nombre }
 * @returns {'ok'|'migration'|'erreur'}
 */
async function poserOverride(shift, valeurs, lotId) {
  const fusion = { ...(shift.stock_initial_verif || {}), ...valeurs }
  const { error } = await supabase
    .from('inventaires_shifts')
    .update({
      stock_initial_verif: fusion,
      verif_lot_id: lotId || shift.verif_lot_id || null,
      verif_applique_at: new Date().toISOString(),
    })
    .eq('id', shift.id)
  if (!error) return 'ok'
  return colonneManquante(error) ? 'migration' : 'erreur'
}

/**
 * Applique un comptage validé au stock initial.
 * @returns {{ cible: 'ouvert'|'prochain', inventaireId: string|null, statut: 'ok'|'migration'|'erreur' }}
 *   cible 'ouvert'   → reporté sur l'inventaire en cours
 *   cible 'prochain' → aucun inventaire ouvert, servira au prochain créé
 */
export async function appliquerComptage({ restaurantId, lotId, lignes }) {
  const valeurs = {}
  lignes.forEach(l => { valeurs[l.produit_id] = l.stock_compte })

  const { shift, migration } = await inventaireOuvert(restaurantId)
  if (migration) return { cible: 'ouvert', inventaireId: null, statut: 'migration' }
  if (!shift) return { cible: 'prochain', inventaireId: null, statut: 'ok' }

  const statut = await poserOverride(shift, valeurs, lotId)

  // Rattacher les lignes du comptage au shift servi (sert à la correction).
  if (statut === 'ok' && lotId) {
    await supabase.from('verifications_stock')
      .update({ inventaire_id: shift.id }).eq('lot_id', lotId)
      .then(() => {}, () => {})
  }
  return { cible: 'ouvert', inventaireId: shift.id, statut }
}

/**
 * Dernier comptage d'un restaurant postérieur à une date donnée, sous forme
 * { produit_id: stock_compte }. Utilisé par app/inventaire.js pour démarrer un
 * nouvel inventaire sur le stock physiquement compté.
 * @param {string} depuisISO  created_at du shift de référence (exclu)
 */
export async function dernierComptage(restaurantId, depuisISO = null) {
  if (!restaurantId) return null
  let q = supabase
    .from('verifications_stock')
    .select('lot_id, produit_id, stock_compte, created_at, date')
    .eq('restaurant_id', restaurantId)
    .order('created_at', { ascending: false })
    .limit(300)
  if (depuisISO) q = q.gt('created_at', depuisISO)

  const { data, error } = await q
  if (error || !data || data.length === 0) return null

  // Trié du plus récent au plus ancien : le premier comptage rencontré pour un
  // produit gagne. Deux comptages successifs se complètent donc au lieu que le
  // dernier efface les produits que lui seul n'a pas comptés.
  const valeurs = {}
  data.forEach(r => {
    if (r.stock_compte == null) return
    if (!(r.produit_id in valeurs)) valeurs[r.produit_id] = Number(r.stock_compte)
  })
  return Object.keys(valeurs).length > 0
    ? { lotId: data[0].lot_id, date: data[0].date, valeurs }
    : null
}

/**
 * Corrige le nombre compté d'une ligne déjà validée, et reporte la correction
 * sur l'inventaire si celui-ci n'a pas encore été validé.
 * @returns {{ statut: 'ok'|'migration'|'erreur', report: 'ouvert'|'prochain'|'fige', message?: string }}
 *   report 'ouvert'   → l'inventaire en cours a été mis à jour
 *   report 'prochain' → servira au prochain inventaire créé
 *   report 'fige'     → l'inventaire concerné est déjà validé, rien n'est retouché
 */
export async function corrigerComptage({ ligne, nouveauCompte, userId, userNom }) {
  const ancien = Number(ligne.stock_compte) || 0
  const reel = Number(ligne.stock_reel) || 0

  const maj = {
    stock_compte: nouveauCompte,
    ecart: nouveauCompte - reel,
    stock_compte_origine: ligne.stock_compte_origine ?? ancien,
    corrige_par_id: userId || null,
    corrige_par_nom: userNom || null,
    corrige_at: new Date().toISOString(),
  }

  let { error } = await supabase.from('verifications_stock').update(maj).eq('id', ligne.id)
  if (error && colonneManquante(error)) {
    // Migration pas encore passée : on corrige au moins le chiffre et l'écart.
    const { error: e2 } = await supabase.from('verifications_stock')
      .update({ stock_compte: nouveauCompte, ecart: nouveauCompte - reel }).eq('id', ligne.id)
    if (e2) return { statut: 'erreur', report: 'fige', message: e2.message }
    return { statut: 'migration', report: 'fige' }
  }
  if (error) return { statut: 'erreur', report: 'fige', message: error.message }

  // Report sur l'inventaire qui a reçu ce comptage.
  if (ligne.inventaire_id) {
    const { data: shift } = await supabase
      .from('inventaires_shifts')
      .select('id, valide, stock_initial_verif, verif_lot_id')
      .eq('id', ligne.inventaire_id).maybeSingle()
    if (!shift) return { statut: 'ok', report: 'prochain' }
    if (shift.valide) return { statut: 'ok', report: 'fige' }
    const st = await poserOverride(shift, { [ligne.produit_id]: nouveauCompte }, shift.verif_lot_id)
    return { statut: st === 'ok' ? 'ok' : st, report: st === 'ok' ? 'ouvert' : 'fige' }
  }

  // Comptage pas encore consommé : un inventaire ouvert entre-temps ?
  const { shift } = await inventaireOuvert(ligne.restaurant_id)
  if (shift && (shift.stock_initial_verif || {})[ligne.produit_id] != null) {
    const st = await poserOverride(shift, { [ligne.produit_id]: nouveauCompte }, shift.verif_lot_id)
    return { statut: st === 'ok' ? 'ok' : st, report: st === 'ok' ? 'ouvert' : 'fige' }
  }
  return { statut: 'ok', report: 'prochain' }
}
