// ──────────────────────────────────────────────────────────────────────────────
// Équipe globale : lectures et écritures Supabase.
// `restoId === null` = tous les restaurants.
//
// Supabase tronque en silence à 1000 lignes : un mois de présences pour les 7
// restaurants en dépasse 2 800. Toute lecture de présences / paies passe donc
// par toutesLesPages() (range + order stable).
// ──────────────────────────────────────────────────────────────────────────────
import { aujourdhuiISO } from './contrats'
import { creerNotification } from './notificationsInterne'
import { envoyerNotifNouveauTravailleur } from './notifications'
import { supabase } from './supabase'

const PAGE = 1000
const ECRAN = 'equipe'

async function toutesLesPages(construire) {
  let tout = []
  for (let de = 0; ; de += PAGE) {
    const { data, error } = await construire().range(de, de + PAGE - 1)
    if (error) throw error
    tout = tout.concat(data || [])
    if (!data || data.length < PAGE) return tout
  }
}

// La date et le restaurant d'une présence viennent de son point (presences.restaurant_id
// n'est pas rempli sur les anciennes lignes).
function aplatirPoint(lignes) {
  return lignes.map(({ points, ...p }) => ({ ...p, date: points?.date || '', restaurant_id: points?.restaurant_id || p.restaurant_id || null }))
}

export async function chargerRestaurants() {
  const { data } = await supabase.from('restaurants').select('id, nom, couleur, photo_url, localisation').order('nom')
  return data || []
}

/** Travailleurs non archivés (actifs et inactifs). */
export async function chargerTravailleurs(restoId) {
  let q = supabase.from('travailleurs').select('*, restaurants(nom, couleur)').neq('statut', 'archive').order('nom')
  if (restoId) q = q.eq('restaurant_id', restoId)
  const { data } = await q
  return data || []
}

export async function chargerArchives(restoId) {
  let q = supabase.from('travailleurs').select('*, restaurants(nom, couleur)').eq('statut', 'archive').order('archived_at', { ascending: false })
  if (restoId) q = q.eq('restaurant_id', restoId)
  const { data } = await q
  return data || []
}

/** Présences de la période (chaque ligne porte `date` et `restaurant_id`). */
export async function chargerPresences(plage, restoId) {
  const lignes = await toutesLesPages(() => {
    let q = supabase.from('presences').select('*, points!inner(date, restaurant_id)')
      .gte('points.date', plage.debut).lte('points.date', plage.fin)
      .order('id')
    if (restoId) q = q.eq('points.restaurant_id', restoId)
    return q
  })
  return aplatirPoint(lignes)
}

/** Paies versées par le gérant de caisse (dépenses « Paie » saisies par le gérant). */
export async function chargerPaiesGerant(plage, restoId) {
  const lignes = await toutesLesPages(() => {
    let q = supabase.from('depenses').select('id, libelle, montant, point_id, points!inner(date, restaurant_id)')
      .eq('categorie', 'Paie').eq('saisi_par', 'gerant')
      .gte('points.date', plage.debut).lte('points.date', plage.fin)
      .order('id')
    if (restoId) q = q.eq('points.restaurant_id', restoId)
    return q
  })
  return aplatirPoint(lignes)
}

/** Historique d'un travailleur, tous restaurants confondus (suit ses transferts). */
export async function chargerHistoriqueTravailleur(travailleurId, plage) {
  const lignes = await toutesLesPages(() => supabase.from('presences')
    .select('*, points!inner(date, restaurant_id)')
    .eq('travailleur_id', travailleurId)
    .gte('points.date', plage.debut).lte('points.date', plage.fin)
    .order('id'))
  return aplatirPoint(lignes).sort((a, b) => b.date.localeCompare(a.date))
}

export async function chargerDocuments(travailleurId) {
  const { data } = await supabase.from('documents_travailleurs').select('*')
    .eq('travailleur_id', travailleurId).order('created_at', { ascending: false })
  return data || []
}

// ── Écritures ────────────────────────────────────────────────────────────────
// Les notifications ne doivent jamais bloquer l'action : .catch(() => {}).

function notifier(n) {
  creerNotification({ cible_role: ['manager', 'directeur'], screen: ECRAN, ...n }).catch(() => {})
}

/**
 * Crée (travailleurEdition null) ou modifie un travailleur, puis rattache les
 * papiers ajoutés dans le formulaire. `resto` = restaurant d'accueil (création).
 */
export async function enregistrerTravailleur({ form, travailleurEdition, resto, papiers }) {
  const champs = {
    poste: form.poste,
    type_contrat: form.type_contrat,
    contact: form.contact || null,
    photo_url: form.photo_url || null,
    salaire_journalier: parseInt(form.salaire_journalier) || null,
    date_embauche: form.date_embauche || null,
  }

  let travId = travailleurEdition?.id
  if (travailleurEdition) {
    const { error } = await supabase.from('travailleurs').update({ nom: form.nom, ...champs }).eq('id', travId)
    if (error) throw error
    notifier({
      type: 'travailleur_modifie', titre: '✏️ Travailleur modifié',
      message: `${form.nom} — ${resto?.nom || ''}`, restaurant_id: resto?.id || null,
    })
  } else {
    const { data, error } = await supabase.from('travailleurs').insert({
      nom: form.nom, ...champs, restaurant_id: resto.id, actif: true, statut: 'actif',
    }).select()
    if (error) throw error
    travId = data?.[0]?.id
    notifier({
      type: 'nouveau_travailleur', titre: '👤 Nouveau travailleur',
      message: `${form.nom} ajouté à ${resto.nom}`, restaurant_id: resto.id,
      cible_role: ['manager', 'directeur', 'rh'],
    })
    envoyerNotifNouveauTravailleur(form.nom, resto.nom, resto.id).catch(() => {})
  }

  if (papiers.length > 0 && travId) {
    await supabase.from('documents_travailleurs').insert(papiers.map(p => ({
      travailleur_id: travId, type_document: p.type_document, fichier_url: p.fichier_url, description: p.fichier_type,
    })))
    notifier({
      type: 'nouveau_document', titre: '📄 Document(s) travailleur',
      message: `${papiers.length} document(s) ajouté(s) — ${form.nom}`, restaurant_id: resto?.id || null,
    })
  }
}

export async function archiverTravailleur(trav, motif) {
  await supabase.from('travailleurs').update({
    statut: 'archive', actif: false, archived_at: new Date().toISOString(), archive_motif: motif,
  }).eq('id', trav.id)
  // Archiver, c'est rompre le contrat. Sans cette clôture, le cron continuerait
  // d'envoyer des alertes d'échéance pour quelqu'un qui est parti.
  await supabase.from('contrats_travailleurs')
    .update({ cloture_le: aujourdhuiISO(), cloture_motif: motif })
    .eq('travailleur_id', trav.id)
    .is('cloture_le', null)
    .or(`date_fin.is.null,date_fin.gte.${aujourdhuiISO()}`)
  notifier({
    type: 'travailleur_archive', titre: '📦 Travailleur archivé',
    message: `${trav.nom} archivé (${motif})`, restaurant_id: trav.restaurant_id || null,
  })
}

export async function transfererTravailleur(trav, resto) {
  await supabase.from('travailleurs').update({ restaurant_id: resto.id }).eq('id', trav.id)
  notifier({
    type: 'travailleur_transfere', titre: '🔀 Travailleur transféré',
    message: `${trav.nom} transféré vers ${resto.nom}`, restaurant_id: resto.id,
  })
}

export async function reactiverTravailleur(trav) {
  await supabase.from('travailleurs').update({
    statut: 'actif', actif: true, archived_at: null, archive_motif: null,
  }).eq('id', trav.id)
  notifier({
    type: 'travailleur_reactive', titre: '♻️ Travailleur réactivé',
    message: `${trav.nom} réactivé`, restaurant_id: trav.restaurant_id || null,
  })
}

export async function supprimerTravailleur(trav) {
  await supabase.from('presences').delete().eq('travailleur_id', trav.id)
  await supabase.from('demandes').delete().eq('travailleur_id', trav.id)
  await supabase.from('documents_travailleurs').delete().eq('travailleur_id', trav.id)
  await supabase.from('contrats_travailleurs').delete().eq('travailleur_id', trav.id)
  await supabase.from('travailleurs').delete().eq('id', trav.id)
  notifier({
    type: 'travailleur_supprime', titre: '🗑️ Travailleur supprimé',
    message: `${trav.nom} supprimé définitivement`, restaurant_id: trav.restaurant_id || null,
  })
}
