// ──────────────────────────────────────────────────────────────────────────────
// Équipe globale : lectures et écritures Supabase.
// `restoId === null` = tous les restaurants.
//
// Supabase tronque en silence à 1000 lignes : un mois de présences pour les 7
// restaurants en dépasse 2 800. Toute lecture de présences / paies passe donc
// par toutesLesPages() (range + order stable).
// ──────────────────────────────────────────────────────────────────────────────
import { aujourdhuiISO } from './contrats'
import { analyserEquipe, fenetreAnalyse } from './joursRepos'
import { creerNotification } from './notificationsInterne'
import { envoyerNotifNouveauTravailleur } from './notifications'
import { rattacherPaiesGerant } from './equipe'
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

/** Jours d'ouverture (un point par restaurant et par jour) de la période. */
export async function chargerPoints(plage, restoId) {
  return toutesLesPages(() => {
    let q = supabase.from('points').select('id, date, restaurant_id')
      .gte('date', plage.debut).lte('date', plage.fin).order('id')
    if (restoId) q = q.eq('restaurant_id', restoId)
    return q
  })
}

/** Paies versées par le gérant de caisse (dépenses « Paie » saisies par le gérant). */
export async function chargerPaiesGerant(plage, restoId) {
  const lignes = await toutesLesPages(() => {
    // `*` : inclut travailleur_id quand la colonne existe (supabase_paies_gerant_travailleur.sql).
    let q = supabase.from('depenses').select('*, points!inner(date, restaurant_id)')
      .eq('categorie', 'Paie').eq('saisi_par', 'gerant')
      .gte('points.date', plage.debut).lte('points.date', plage.fin)
      .order('id')
    if (restoId) q = q.eq('points.restaurant_id', restoId)
    return q
  })
  return aplatirPoint(lignes)
}

/**
 * Salaires payés par le gérant à UN travailleur (fiche). Les anciennes lignes
 * ne portent que le nom : on les cherche aussi par nom, puis on ne garde que
 * celles qui se rattachent vraiment à cette fiche (rattacherPaiesGerant).
 */
export async function chargerPaiesGerantTravailleur(trav, plage) {
  const base = () => supabase.from('depenses').select('*, points!inner(date, restaurant_id)')
    .eq('categorie', 'Paie').eq('saisi_par', 'gerant')
    .gte('points.date', plage.debut).lte('points.date', plage.fin)
  const motCle = String(trav.nom || '').trim().split(/\s+/).sort((a, b) => b.length - a.length)[0] || ''
  const [parFiche, parNom] = await Promise.all([
    // Échoue tant que la colonne n'existe pas : on continue avec la recherche par nom.
    base().eq('travailleur_id', trav.id).then(r => (r.error ? [] : r.data || []), () => []),
    motCle
      ? base().ilike('libelle', `%${motCle.replace(/[%_\\]/g, c => `\\${c}`)}%`).then(r => r.data || [], () => [])
      : [],
  ])
  const uniques = Object.values(Object.fromEntries([...parFiche, ...parNom].map(d => [d.id, d])))
  return rattacherPaiesGerant(aplatirPoint(uniques), [trav])
    .filter(d => d.travailleur_id === trav.id)
    .sort((a, b) => b.date.localeCompare(a.date))
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

// Choix du formulaire : 'auto' (laisser l'analyse décider), 1…7 (jour fixé à
// la main) ou 'aucun' (pas de jour fixe, fixé à la main). Un choix manuel
// n'est jamais écrasé par l'analyse ; revenir à 'auto' le lui rend.
function champsJourRepos(choix, edition) {
  if (choix === 'aucun') return { jour_repos: null, jour_repos_source: 'manuel' }
  if (typeof choix === 'number') return { jour_repos: choix, jour_repos_source: 'manuel' }
  if (edition?.jour_repos_source === 'manuel') return { jour_repos: null, jour_repos_source: null }
  return {}
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
    ...champsJourRepos(form.jour_repos_choix, travailleurEdition),
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

export async function archiverTravailleur(trav, motif, badgeRendu = null) {
  const archive = { statut: 'archive', actif: false, archived_at: new Date().toISOString(), archive_motif: motif }
  // Badge rapporté ou non (cartes à QR, 29/10/2026). Sans la migration
  // supabase_cartes_travailleurs.sql la colonne manque : on archive sans.
  const badge = typeof badgeRendu === 'boolean'
    ? { badge_rendu: badgeRendu, badge_rendu_le: badgeRendu ? aujourdhuiISO() : null }
    : {}
  const { error: erreurBadge } = await supabase.from('travailleurs').update({ ...archive, ...badge }).eq('id', trav.id)
  if (erreurBadge && Object.keys(badge).length) await supabase.from('travailleurs').update(archive).eq('id', trav.id)
  // Un contrat encore en circuit (à signer, refusé, à vérifier) n'a plus
  // d'objet : annulé d'abord, pour que la clôture ci-dessous ne le touche pas
  // (sa date de début peut être future, et la base refuserait toute la mise à
  // jour, contrat signé compris).
  await supabase.from('contrats_travailleurs')
    .update({ statut: 'annule', annule_le: new Date().toISOString(), annule_motif: `Travailleur archivé : ${motif}` })
    .eq('travailleur_id', trav.id)
    .in('statut', ['a_signer', 'refuse', 'signe_a_verifier'])
  // Archiver, c'est rompre le contrat. Sans cette clôture, le cron continuerait
  // d'envoyer des alertes d'échéance pour quelqu'un qui est parti.
  const cloturer = () => supabase.from('contrats_travailleurs')
    .update({ cloture_le: aujourdhuiISO(), cloture_motif: motif })
    .eq('travailleur_id', trav.id)
    .is('cloture_le', null)
    .or(`date_fin.is.null,date_fin.gte.${aujourdhuiISO()}`)
  // Avant la migration des contrats signés, la colonne `statut` n'existe pas.
  const { error } = await cloturer().eq('statut', 'signe')
  if (error) await cloturer()
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

// Les présences restent : elles portent les salaires payés dans les shifts
// passés (le nom y est recopié). Les effacer ferait baisser la vente d'un
// ancien shift dès qu'on le modifie (modifier-point recalcule depuis les
// paies), et les salaires des rapports mensuels déjà clos.
export async function supprimerTravailleur(trav) {
  await supabase.from('demandes').delete().eq('travailleur_id', trav.id)
  await supabase.from('documents_travailleurs').delete().eq('travailleur_id', trav.id)
  await supabase.from('contrats_travailleurs').delete().eq('travailleur_id', trav.id)
  await supabase.from('travailleurs').delete().eq('id', trav.id)
  notifier({
    type: 'travailleur_supprime', titre: '🗑️ Travailleur supprimé',
    message: `${trav.nom} supprimé définitivement`, restaurant_id: trav.restaurant_id || null,
  })
}

/**
 * Analyse les 12 dernières semaines de tous les travailleurs actifs et fixe
 * le jour de repos de ceux dont le jour ressort nettement (lib/joursRepos.js).
 * Ne touche ni aux choix manuels ni à ceux sans jour net.
 * → { nouveaux, changes, confirmes, manuels, sansJour, pasAssez }
 */
export async function lancerAnalyseJoursRepos() {
  const fenetre = fenetreAnalyse()
  const [travailleurs, points, lignes] = await Promise.all([
    toutesLesPages(() => supabase.from('travailleurs')
      .select('id, restaurant_id, jour_repos, jour_repos_source')
      .eq('actif', true).neq('statut', 'archive').order('id')),
    chargerPoints(fenetre, null),
    toutesLesPages(() => supabase.from('presences')
      .select('id, travailleur_id, statut, points!inner(date, restaurant_id)')
      .gte('points.date', fenetre.debut).lte('points.date', fenetre.fin)
      .order('id')),
  ])
  const resultats = analyserEquipe({ travailleurs, points, presences: aplatirPoint(lignes) })

  const maintenant = new Date().toISOString()
  const aEcrire = resultats.filter(r => ['nouveau', 'change', 'confirme'].includes(r.action))
  for (let i = 0; i < aEcrire.length; i += 10) {
    await Promise.all(aEcrire.slice(i, i + 10).map(async r => {
      const { error } = await supabase.from('travailleurs').update({
        jour_repos: r.resultat.jour, jour_repos_source: 'auto', jour_repos_analyse_le: maintenant,
      }).eq('id', r.id)
        // Garde-fou si un choix manuel a été fait pendant l'analyse. (`neq` seul
        // exclurait aussi les lignes où la source est NULL.)
        .or('jour_repos_source.is.null,jour_repos_source.neq.manuel')
      if (error) throw error
    }))
  }

  const compte = action => resultats.filter(r => r.action === action).length
  return {
    nouveaux: compte('nouveau'),
    changes: compte('change'),
    confirmes: compte('confirme'),
    manuels: compte('manuel'),
    sansJour: resultats.filter(r => r.action === 'aucune' && r.resultat.raison !== 'pas_assez' && r.resultat.raison !== 'jamais_pointe').length,
    pasAssez: resultats.filter(r => r.action === 'aucune' && (r.resultat.raison === 'pas_assez' || r.resultat.raison === 'jamais_pointe')).length,
  }
}
