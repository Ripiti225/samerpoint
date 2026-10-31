// ──────────────────────────────────────────────────────────────────────────────
// Lectures / écritures de la paie (fiches paie, paramètres, employeurs, états
// de salaire, dû Trésorerie). Les calculs sont dans lib/paie.js,
// lib/etatSalaire.js et lib/bulletin.js (modules purs, testés).
// Migration : supabase_paie.sql
// ──────────────────────────────────────────────────────────────────────────────
import { supabase } from './supabase'
import { journaliser } from './journal'
import { creerNotification } from './notificationsInterne'
import { chargerPaiesGerant, chargerPresences } from './equipeDb'
import { dedupPresences, rattacherPaiesGerant } from './equipe'
import { contratEnCours, contratsSignes, finEffective } from './contrats'
import { marquePourResto } from './logos'
import { parametresEmployeur, parametresPour } from './paie'
import { assemblerBulletin } from './bulletin'
import {
  TYPES_BULLETIN, bornesMois, construireEtat, estContractuel, manquesFichePaie, raisonsRefusSoumission, totauxEtat,
} from './etatSalaire'

const NOMS_MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

/** '2026-11-01' → « novembre 2026 ». */
export function libelleMois(mois) {
  const [a, m] = String(mois).split('-').map(Number)
  return `${NOMS_MOIS[m - 1]} ${a}`
}

const ctxJournal = (ctx, restaurantId) => ({ userId: ctx?.userId || null, userNom: ctx?.userNom || null, restaurantId })

function erreur(error, message) {
  if (!error) return
  if (error.code === '42P01' || /does not exist/.test(error.message || '')) {
    throw new Error('La migration supabase_paie.sql n\'est pas encore passée.')
  }
  throw new Error(message)
}

// ── Fiches paie ──────────────────────────────────────────────────────────────

/** { travailleur_id: fiche } pour ces travailleurs. */
export async function chargerFichesPaie(travailleurIds) {
  if (!travailleurIds?.length) return {}
  const { data, error } = await supabase.from('fiches_paie').select('*').in('travailleur_id', travailleurIds)
  erreur(error, 'Impossible de lire les fiches paie.')
  return Object.fromEntries((data || []).map(f => [f.travailleur_id, f]))
}

const CHAMPS_FICHE = [
  'matricule', 'coefficient', 'categorie', 'salaire_categoriel', 'sursalaire', 'prime_transport', 'prime_tenue',
  'numero_cnps', 'parts_fiscales', 'personnes_cmu', 'mode_paiement',
  'cumuls_reprise', 'cumuls_reprise_au', 'conges_acquis_reprise', 'conges_reste_reprise',
]

export async function enregistrerFichePaie(travailleurId, champs, ctx) {
  const ligne = { travailleur_id: travailleurId, modifie_par_nom: ctx?.userNom || null, updated_at: new Date().toISOString() }
  for (const c of CHAMPS_FICHE) if (c in champs) ligne[c] = champs[c] === '' ? null : champs[c]
  const { error } = await supabase.from('fiches_paie').upsert(ligne, { onConflict: 'travailleur_id' })
  erreur(error, 'La fiche paie n\'a pas pu être enregistrée.')
  journaliser('fiche_paie_modifiee', { travailleur_id: travailleurId, champs: Object.keys(champs) }, ctxJournal(ctx, null))
}

/** Montants du contrat signé en cours, pour pré-remplir la fiche paie. */
export function montantsDuContrat(contrats, aujourdhui) {
  const c = contratEnCours(contratsSignes(contrats), aujourdhui)
  const d = c?.donnees || {}
  return {
    categorie: d.categorie ?? null,
    salaire_categoriel: d.salaire_categoriel ?? null,
    prime_tenue: d.prime_tenue ?? null,
    prime_transport: d.indemnite_transport ?? null,
  }
}

/** Nombre de CDD/CDI actifs dont la fiche paie est incomplète (badge de la tuile). */
export async function compterFichesPaieIncompletes() {
  const { data: tous, error } = await supabase.from('travailleurs').select('id, restaurants(nom)')
    .in('type_contrat', TYPES_BULLETIN).neq('statut', 'archive').range(0, 999)
  if (error) return 0
  const travs = (tous || []).filter(t => restoAvecPaie(t.restaurants))
  const fiches = await chargerFichesPaie((travs || []).map(t => t.id)).catch(() => null)
  if (!fiches) return 0
  return (travs || []).filter(t => manquesFichePaie(fiches[t.id]).length > 0).length
}

// ── Paramètres et employeurs ─────────────────────────────────────────────────

/** À la Braise ne fait ni état de salaire ni bulletin (décision du 31/10/2026). */
const MARQUES_SANS_PAIE = ['alabraise']
export const restoAvecPaie = resto => !!resto && !MARQUES_SANS_PAIE.includes(marquePourResto(resto).id)

export async function chargerParametresPaie() {
  const { data, error } = await supabase.from('parametres_paie').select('applicable_du, valeurs').order('applicable_du')
  erreur(error, 'Impossible de lire les paramètres de paie.')
  return data || []
}

export async function chargerEmployeurs() {
  const { data, error } = await supabase.from('employeurs_paie').select('*')
  erreur(error, 'Impossible de lire les employeurs.')
  return Object.fromEntries((data || []).map(e => [e.marque, e]))
}

export async function enregistrerEmployeur(marque, champs, ctx) {
  const { error } = await supabase.from('employeurs_paie')
    .upsert({ marque, ...champs, updated_at: new Date().toISOString() }, { onConflict: 'marque' })
  erreur(error, 'L\'employeur n\'a pas pu être enregistré.')
  journaliser('employeur_paie_modifie', { marque }, ctxJournal(ctx, null))
}

// ── États ────────────────────────────────────────────────────────────────────

/** États d'un mois, tous restaurants : { restaurant_id: etat }. */
export async function chargerEtatsDuMois(mois) {
  const { data, error } = await supabase.from('etats_salaire').select('*').eq('mois', mois)
  erreur(error, 'Impossible de lire les états de salaire.')
  return Object.fromEntries((data || []).map(e => [e.restaurant_id, e]))
}

export async function chargerLignes(etatId) {
  const { data, error } = await supabase.from('lignes_etat_salaire').select('*').eq('etat_id', etatId).order('nom')
  erreur(error, 'Impossible de lire les lignes de l\'état.')
  return data || []
}

/** Bulletins figés de l'année avant `mois`, par travailleur : { id: [bulletin] }. */
async function chargerPrecedents(travailleurIds, mois) {
  if (!travailleurIds.length) return {}
  const { data, error } = await supabase.from('lignes_etat_salaire')
    .select('travailleur_id, bulletin, etats_salaire!inner(mois, statut)')
    .in('travailleur_id', travailleurIds)
    .eq('etats_salaire.statut', 'valide')
    .gte('etats_salaire.mois', `${mois.slice(0, 4)}-01-01`)
    .lt('etats_salaire.mois', mois)
  erreur(error, 'Impossible de lire les bulletins précédents.')
  const out = {}
  for (const l of data || []) if (l.bulletin) (out[l.travailleur_id] = out[l.travailleur_id] || []).push(l.bulletin)
  return out
}

/** Bulletins validés d'un travailleur (onglet de la fiche), du plus récent au plus ancien. */
export async function chargerBulletinsTravailleur(travailleurId) {
  const { data, error } = await supabase.from('lignes_etat_salaire')
    .select('id, bulletin, etats_salaire!inner(mois, statut)')
    .eq('travailleur_id', travailleurId).eq('etats_salaire.statut', 'valide')
  erreur(error, 'Impossible de lire les bulletins.')
  return (data || []).filter(l => l.bulletin)
    .sort((a, b) => String(b.etats_salaire.mois).localeCompare(String(a.etats_salaire.mois)))
}

/** Travailleurs de l'état : non archivés du restaurant + archivés pendant le mois. */
async function travailleursDuMois(restaurantId, mois) {
  const { debut } = bornesMois(mois)
  const { data, error } = await supabase.from('travailleurs').select('*')
    .eq('restaurant_id', restaurantId)
    .or(`statut.neq.archive,archived_at.gte.${debut}`)
    .range(0, 999)
  erreur(error, 'Impossible de lire l\'équipe.')
  return data || []
}

/**
 * Crée ou recalcule le brouillon d'un restaurant. Les saisies de la RH
 * (absences justifiées, éléments variables, avances) sont conservées.
 * `saisies` (facultatif) : { travailleur_id: saisies } à appliquer d'abord.
 */
export async function preparerEtat({ resto, mois, saisies = {} }, ctx) {
  if (!restoAvecPaie(resto)) throw new Error('Pas d\'état de salaire pour ce restaurant.')
  const { debut, fin } = bornesMois(mois)
  const { data: existant, error: e1 } = await supabase.from('etats_salaire').select('*')
    .eq('restaurant_id', resto.id).eq('mois', mois).maybeSingle()
  erreur(e1, 'Impossible de lire l\'état.')
  if (existant && existant.statut !== 'brouillon') {
    throw new Error(existant.statut === 'valide'
      ? 'Cet état est validé : il ne peut plus être modifié.'
      : 'Cet état attend la validation du manager.')
  }

  const plage = { debut, fin }
  const [travailleurs, presencesBrutes, paiesBrutes, anciennes, parametres, employeurs] = await Promise.all([
    travailleursDuMois(resto.id, mois),
    chargerPresences(plage, resto.id),
    chargerPaiesGerant(plage, resto.id),
    existant ? chargerLignes(existant.id) : [],
    chargerParametresPaie(),
    chargerEmployeurs(),
  ])
  const ids = travailleurs.map(t => t.id)
  const { data: contrats } = await supabase.from('contrats_travailleurs').select('*').in('travailleur_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])
  const finsContrat = {}
  for (const id of ids) {
    const c = contratEnCours(contratsSignes((contrats || []).filter(x => x.travailleur_id === id)), debut)
    if (c && finEffective(c)) finsContrat[id] = finEffective(c)
  }

  const anciennesAvecSaisies = anciennes.map(l => (saisies[l.travailleur_id] ? { ...l, ...saisies[l.travailleur_id] } : l))
  for (const [id, s] of Object.entries(saisies)) {
    if (!anciennes.some(l => l.travailleur_id === id)) anciennesAvecSaisies.push({ travailleur_id: id, ...s })
  }

  const lignes = construireEtat({
    travailleurs,
    presences: dedupPresences(presencesBrutes),
    paiesGerant: rattacherPaiesGerant(paiesBrutes, travailleurs),
    mois,
    anciennes: anciennesAvecSaisies,
    finsContrat,
  })

  const contractuels = lignes.filter(l => estContractuel(l.type_contrat)).map(l => l.travailleur_id)
  const [fiches, precedents] = await Promise.all([chargerFichesPaie(contractuels), chargerPrecedents(contractuels, mois)])
  const employeur = employeurs[marquePourResto(resto).id] || {}
  const p = parametresEmployeur(parametresPour(parametres, fin), employeur)
  const travParId = Object.fromEntries(travailleurs.map(t => [t.id, t]))
  for (const l of lignes) {
    const fiche = fiches[l.travailleur_id]
    l.bulletin = estContractuel(l.type_contrat) && manquesFichePaie(fiche).length === 0
      ? assemblerBulletin({ ligne: l, fiche, trav: travParId[l.travailleur_id], resto, employeur, mois, parametres: p, precedents: precedents[l.travailleur_id] || [] })
      : null
  }

  const ligneEtat = {
    restaurant_id: resto.id, mois, statut: 'brouillon', totaux: totauxEtat(lignes),
    prepare_par_nom: ctx?.userNom || null, prepare_le: new Date().toISOString(),
  }
  const { data: etat, error: e2 } = existant
    ? await supabase.from('etats_salaire').update(ligneEtat).eq('id', existant.id).select().single()
    : await supabase.from('etats_salaire').insert(ligneEtat).select().single()
  erreur(e2, 'L\'état n\'a pas pu être enregistré.')

  const { error: e3 } = await supabase.from('lignes_etat_salaire').delete().eq('etat_id', etat.id)
  erreur(e3, 'L\'état n\'a pas pu être recalculé.')
  if (lignes.length) {
    const { error: e4 } = await supabase.from('lignes_etat_salaire').insert(lignes.map(l => ({ ...l, etat_id: etat.id })))
    erreur(e4, 'Les lignes de l\'état n\'ont pas pu être enregistrées.')
  }
  journaliser('etat_salaire_prepare', { mois, lignes: lignes.length, reste_a_payer: ligneEtat.totaux.reste_a_payer }, ctxJournal(ctx, resto.id))
  return { etat, lignes, fiches }
}

export async function soumettreEtat({ etat, lignes, resto }, ctx, aujourdhui) {
  const contractuels = lignes.filter(l => estContractuel(l.type_contrat)).map(l => l.travailleur_id)
  const fiches = await chargerFichesPaie(contractuels)
  const raisons = raisonsRefusSoumission({ lignes, fichesParTrav: fiches, mois: etat.mois, aujourdhui })
  if (raisons.length) throw new Error(raisons.join('\n'))
  const { error } = await supabase.from('etats_salaire').update({
    statut: 'soumis', soumis_par_nom: ctx?.userNom || null, soumis_le: new Date().toISOString(), renvoi_motif: null,
  }).eq('id', etat.id).eq('statut', 'brouillon')
  erreur(error, 'L\'état n\'a pas pu être envoyé.')
  creerNotification({
    type: 'etat_salaire', titre: `💰 État de salaire à valider — ${resto.nom}`,
    message: `${libelleMois(etat.mois)} : ${lignes.length} personnes, reste à payer ${Number(etat.totaux?.reste_a_payer || 0).toLocaleString('fr-FR')} F.`,
    restaurant_id: resto.id, cible_role: ['manager'], created_by: ctx?.userId || null, screen: '/salaires', params: { mois: etat.mois },
  }).catch(() => {})
  journaliser('etat_salaire_soumis', { mois: etat.mois }, ctxJournal(ctx, resto.id))
}

export async function renvoyerEtat({ etat, resto }, motif, ctx) {
  if (!String(motif || '').trim()) throw new Error('Dites à la RH ce qu\'il faut corriger.')
  const { error } = await supabase.from('etats_salaire').update({ statut: 'brouillon', renvoi_motif: motif.trim() })
    .eq('id', etat.id).eq('statut', 'soumis')
  erreur(error, 'L\'état n\'a pas pu être renvoyé.')
  creerNotification({
    type: 'etat_salaire', titre: `↩️ État de salaire renvoyé — ${resto.nom}`, message: `${libelleMois(etat.mois)} : ${motif.trim()}`,
    restaurant_id: resto.id, cible_role: ['rh'], created_by: ctx?.userId || null, screen: '/salaires', params: { mois: etat.mois },
  }).catch(() => {})
  journaliser('etat_salaire_renvoye', { mois: etat.mois, motif }, ctxJournal(ctx, resto.id))
}

async function paiementsDu(duId) {
  const { data } = await supabase.from('tresorerie_paiements').select('id').eq('du_id', duId).limit(1)
  return (data || []).length > 0
}

/**
 * Valide l'état : il se fige, et le reste à payer devient le dû « Salaires »
 * du restaurant pour ce mois (un seul par restaurant et par mois). Un dû déjà
 * payé en partie n'est pas modifié : on le signale.
 * @returns {{ avertissement: string|null }}
 */
export async function validerEtat({ etat, resto }, ctx) {
  const reste = Number(etat.totaux?.reste_a_payer || 0)
  const { data: du } = await supabase.from('tresorerie_dus').select('*')
    .eq('categorie', 'salaire').eq('restaurant_id', resto.id).eq('mois', etat.mois).maybeSingle()
  let duId = du?.id || null
  let creeParEtat = false
  let montantAvant = null
  let avertissement = null
  const note = `État de salaire validé par ${ctx?.userNom || 'le manager'}`
  if (!du) {
    const { data, error } = await supabase.from('tresorerie_dus').insert({
      categorie: 'salaire', restaurant_id: resto.id, mois: etat.mois, montant_du: reste, note,
      cree_par: ctx?.userId || null, cree_par_nom: ctx?.userNom || null,
    }).select('id').single()
    erreur(error, 'Le dû Trésorerie n\'a pas pu être créé.')
    duId = data.id
    creeParEtat = true
  } else if (await paiementsDu(du.id)) {
    avertissement = `Le dû « Salaires ${libelleMois(etat.mois)} » de ${resto.nom} a déjà reçu un paiement : son montant n'a pas été changé (${Number(du.montant_du).toLocaleString('fr-FR')} F au lieu de ${reste.toLocaleString('fr-FR')} F). Corrigez-le dans Trésorerie si besoin.`
  } else {
    montantAvant = du.montant_du
    const { error } = await supabase.from('tresorerie_dus').update({ montant_du: reste, note }).eq('id', du.id)
    erreur(error, 'Le dû Trésorerie n\'a pas pu être mis à jour.')
  }
  const { error } = await supabase.from('etats_salaire').update({
    statut: 'valide', valide_par_nom: ctx?.userNom || null, valide_le: new Date().toISOString(),
    du_id: duId, du_cree_par_etat: creeParEtat, du_montant_avant: montantAvant,
  }).eq('id', etat.id).eq('statut', 'soumis')
  erreur(error, 'L\'état n\'a pas pu être validé.')
  journaliser('etat_salaire_valide', { mois: etat.mois, reste_a_payer: reste, du_id: duId, avertissement }, ctxJournal(ctx, resto.id))
  return { avertissement }
}

/** Rouvre un état validé, seulement si son dû n'a reçu aucun paiement. */
export async function rouvrirEtat({ etat, resto }, ctx) {
  if (etat.du_id && await paiementsDu(etat.du_id)) {
    throw new Error('Les salaires de cet état ont déjà reçu un paiement dans Trésorerie : il ne peut plus être rouvert.')
  }
  if (etat.du_id && etat.du_cree_par_etat) {
    const { error } = await supabase.from('tresorerie_dus').delete().eq('id', etat.du_id)
    erreur(error, 'Le dû Trésorerie n\'a pas pu être retiré.')
  } else if (etat.du_id && etat.du_montant_avant !== null) {
    const { error } = await supabase.from('tresorerie_dus').update({ montant_du: etat.du_montant_avant }).eq('id', etat.du_id)
    erreur(error, 'Le dû Trésorerie n\'a pas pu être remis comme avant.')
  }
  const { error } = await supabase.from('etats_salaire').update({
    statut: 'brouillon', valide_par_nom: null, valide_le: null, du_id: null, du_cree_par_etat: false, du_montant_avant: null,
  }).eq('id', etat.id).eq('statut', 'valide')
  erreur(error, 'L\'état n\'a pas pu être rouvert.')
  journaliser('etat_salaire_rouvert', { mois: etat.mois }, ctxJournal(ctx, resto.id))
}
