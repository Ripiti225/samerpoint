/*
 * Corbeille — filet de sécurité avant la suppression d'un shift.
 *
 * Supprimer un shift détruit aussi ses présences, ses dépenses et ses factures
 * fournisseurs. Avant le 10/08/2026, rien n'était récupérable : il a fallu
 * cloner une sauvegarde Supabase pour rendre à une caissière un shift de
 * 127 000 supprimé par erreur.
 *
 * Le module fait deux choses, et c'est volontaire :
 *   • il archive la photo intégrale de ce qui va disparaître ;
 *   • il renvoie la liste EXACTE des identifiants à supprimer.
 *
 * Les écrans suppriment donc par identifiant, et non plus par filtre. C'est ce
 * qui empêche qu'une facture appartenant à une autre caissière soit emportée au
 * passage, comme c'est arrivé à Marie-Paule le 09/08.
 *
 * Voir supabase_corbeille.sql.
 */

import { isOnlineNow } from './networkStatus'
import { supabase } from './supabase'
import { estTableCorbeilleManquante } from './erreursCorbeille'

// Durée de conservation d'une suppression. Une seule constante : la passer à 30
// ou 90 jours ne demande rien d'autre.
export const RETENTION_JOURS = 7

export function colonneManquante(error) {
  return estTableCorbeilleManquante(error)
}

/**
 * Tout ce qu'emporte la suppression d'un shift.
 * Les filtres reproduisent exactement ceux des écrans de suppression.
 */
async function collecter(shift) {
  const parCaissier = q => shift.caissier_nom ? q.eq('caissier_nom', shift.caissier_nom) : q

  const [presences, depenses, transactions] = await Promise.all([
    shift.caissier_id
      ? supabase.from('presences').select('*')
          .eq('point_id', shift.point_id).eq('caissier_id', shift.caissier_id)
      : Promise.resolve({ data: [] }),
    parCaissier(supabase.from('depenses').select('*')
      .eq('point_id', shift.point_id).eq('saisi_par', 'caissier')),
    parCaissier(supabase.from('transactions_fournisseurs').select('*')
      .eq('point_id', shift.point_id).eq('saisi_par', 'caissier')),
  ])

  return {
    shift,
    presences: presences.data || [],
    depenses: depenses.data || [],
    transactions_fournisseurs: transactions.data || [],
  }
}

function resumer(shift) {
  const montant = Number(shift.vente_shift || 0).toLocaleString('fr-FR')
  const horaires = shift.heure_debut && shift.heure_fin
    ? ` · ${shift.heure_debut}→${shift.heure_fin}` : ''
  return `${(shift.caissier_nom || 'Sans caissier').trim()}${horaires} · ${montant}`
}

/**
 * Archive un ou plusieurs shifts AVANT leur suppression.
 *
 * Lève une erreur si l'archivage échoue : sans filet, la suppression ne doit
 * pas avoir lieu. Les écrans laissent l'erreur remonter à leur alerte.
 *
 * @param {object[]} shifts  lignes points_shifts complètes
 * @param {object} utilisateur { userId, userNom }
 * @returns {{ shifts: string[], presences: string[], depenses: string[],
 *             transactions_fournisseurs: string[] }} identifiants à supprimer
 */
export async function archiverSuppressionShift(shifts, { userId, userNom } = {}) {
  const liste = (Array.isArray(shifts) ? shifts : [shifts]).filter(Boolean)
  if (liste.length === 0) return { shifts: [], presences: [], depenses: [], transactions_fournisseurs: [] }

  if (!isOnlineNow()) {
    throw new Error('Suppression impossible hors connexion — le filet de sécurité ne peut pas être créé.')
  }

  const lots = await Promise.all(liste.map(collecter))

  const archives = lots.map(lot => ({
    point_id: lot.shift.point_id,
    restaurant_id: lot.shift.restaurant_id || null,
    date_point: lot.shift.date || null,
    type: 'shift',
    resume: resumer(lot.shift),
    contenu: lot,
    supprime_par_id: userId || null,
    supprime_par_nom: userNom || null,
  }))

  const { error } = await supabase.from('suppressions_archive').insert(archives)
  if (error) {
    throw new Error(colonneManquante(error)
      ? 'Corbeille indisponible : la migration supabase_corbeille.sql n’a pas été passée.'
      : `Archivage impossible, suppression annulée — ${error.message}`)
  }

  const ids = cle => lots.flatMap(l => l[cle].map(r => r.id))
  return {
    shifts: liste.map(s => s.id),
    presences: ids('presences'),
    depenses: ids('depenses'),
    transactions_fournisseurs: ids('transactions_fournisseurs'),
  }
}

/** Supprime par identifiant les lignes collectées par l'archivage. */
export async function supprimerLignesArchivees(ids) {
  for (const table of ['presences', 'depenses', 'transactions_fournisseurs']) {
    if (ids[table]?.length > 0) {
      const { error } = await supabase.from(table).delete().in('id', ids[table])
      if (error) throw new Error(error.message)
    }
  }
  if (ids.shifts?.length > 0) {
    const { error } = await supabase.from('points_shifts').delete().in('id', ids.shifts)
    if (error) throw new Error(error.message)
  }
}

/** Suppressions des RETENTION_JOURS derniers jours, la plus récente en premier. */
export async function chargerCorbeille() {
  const depuis = new Date(Date.now() - RETENTION_JOURS * 86400000).toISOString()
  const { data, error } = await supabase
    .from('suppressions_archive')
    .select('*, restaurants(nom)')
    .gte('created_at', depuis)
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) return { lignes: [], migration: colonneManquante(error) }
  return { lignes: data || [], migration: false }
}

/**
 * Réinsère tout le contenu d'une archive et recalcule le total du point.
 * Réinsertion avec les identifiants d'origine : les photos et les liens vers le
 * point, les fournisseurs et les travailleurs restent valides.
 */
export async function restaurerSuppression(archive, { userNom } = {}) {
  const c = archive.contenu || {}
  const lignes = [
    ['points_shifts', c.shift ? [c.shift] : []],
    ['presences', c.presences || []],
    ['depenses', c.depenses || []],
    ['transactions_fournisseurs', c.transactions_fournisseurs || []],
  ]

  for (const [table, rows] of lignes) {
    if (rows.length === 0) continue
    // ignoreDuplicates : une restauration relancée ne doit rien casser.
    const { error } = await supabase.from(table)
      .upsert(rows, { onConflict: 'id', ignoreDuplicates: true })
    if (error) throw new Error(`${table} — ${error.message}`)
  }

  // Total du point : même règle que recalculerVenteTotalePoint() dans
  // app/modifier-point.js — la somme des ventes de ses shifts.
  if (archive.point_id) {
    const { data: sh } = await supabase
      .from('points_shifts').select('vente_shift').eq('point_id', archive.point_id)
    const total = (sh || []).reduce((s, x) => s + (x.vente_shift || 0), 0)
    await supabase.from('points').update({ vente_total: total }).eq('id', archive.point_id)
  }

  await supabase.from('suppressions_archive')
    .update({ restaure_at: new Date().toISOString(), restaure_par_nom: userNom || null })
    .eq('id', archive.id)

  return { nb: lignes.reduce((n, [, r]) => n + r.length, 0) }
}

/** Purge silencieuse des archives expirées, à l'ouverture de l'écran. */
export async function purgerAnciennes() {
  const limite = new Date(Date.now() - RETENTION_JOURS * 86400000).toISOString()
  await supabase.from('suppressions_archive').delete().lt('created_at', limite)
    .then(() => {}, () => {})
}
