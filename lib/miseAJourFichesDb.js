// ──────────────────────────────────────────────────────────────────────────────
// Mise à jour des fiches par les gérants : écritures en base.
// Logique : lib/miseAJourFiches.js (pure, testée). Migration :
// supabase_mise_a_jour_fiches.sql. Les fonctions lèvent une Error au message
// français, prêt à afficher.
// ──────────────────────────────────────────────────────────────────────────────
import { champsDemande } from './contratsSignesDb'
import { journaliser } from './journal'
import { TEXTE_DATE_LIMITE, champsAEnvoyer, fusionFiche } from './miseAJourFiches'
import { creerNotification } from './notificationsInterne'
import { estPdf, nomComplet } from './recrutement'
import { supabase } from './supabase'

const ROLES_RH = ['manager', 'directeur', 'rh']
const MIGRATION = 'Mise à jour des fiches pas encore activée (migration supabase_mise_a_jour_fiches.sql à passer).'
const maintenant = () => new Date().toISOString()
const manqueMigration = e => /column .*type|demandes_travailleurs_type|schema cache/i.test(e?.message || '')
const notifier = p => { creerNotification(p).catch(() => {}) }
const tracer = (action, details, ctx, restaurantId) => journaliser(action, details, {
  userId: ctx?.userId || null, userNom: ctx?.userNom || null, restaurantId: restaurantId || null,
}).catch(() => {})

export async function chargerEquipeRestaurant(restaurantId) {
  const { data, error } = await supabase.from('travailleurs').select('*')
    .eq('restaurant_id', restaurantId).neq('statut', 'archive').order('nom').range(0, 999)
  if (error) throw new Error("Impossible de charger l'équipe. Vérifie ta connexion.")
  return data || []
}

export async function chargerTravailleur(id) {
  const { data, error } = await supabase.from('travailleurs')
    .select('*, restaurants(id, nom, couleur, code, marque)').eq('id', id).single()
  if (error) throw new Error('Fiche du travailleur introuvable.')
  return data
}

const PAGE = 1000

/** PostgREST plafonne chaque requête à 1000 lignes : on lit page par page, ordre stable (id). */
async function toutesLesLignes(requete) {
  const lignes = []
  for (let debut = 0; ; debut += PAGE) {
    const { data, error } = await requete(debut, debut + PAGE - 1)
    if (error) throw error
    const page = data || []
    lignes.push(...page)
    if (page.length < PAGE) return lignes
  }
}

/** Tous les travailleurs non archivés et les contrats, pour le suivi par restaurant. */
export async function chargerCampagne() {
  try {
    const [travailleurs, contrats] = await Promise.all([
      toutesLesLignes((a, b) => supabase.from('travailleurs').select('*')
        .neq('statut', 'archive').order('id').range(a, b)),
      toutesLesLignes((a, b) => supabase.from('contrats_travailleurs')
        .select('id, travailleur_id, statut, date_debut, date_fin, cloture_le').order('id').range(a, b)),
    ])
    return { travailleurs, contrats }
  } catch (_) {
    throw new Error('Impossible de charger le suivi. Vérifie ta connexion.')
  }
}

/** Gérant : envoie (ou remplace) la mise à jour en attente de ce travailleur. */
export async function envoyerMiseAJour(trav, form, ctx, demandeEnAttente) {
  const champs = { ...champsDemande(champsAEnvoyer(trav, form)), poste: trav.poste || 'Non renseigné', salaire_journalier: null, doublon_travailleur_id: null }
  const commun = { ...champs, type: 'mise_a_jour', travailleur_id: trav.id, restaurant_id: trav.restaurant_id || null,
    statut: 'envoyee', motif_refus: null, updated_at: maintenant() }
  const maj = id => supabase.from('demandes_travailleurs').update(commun).eq('id', id)
    .in('statut', ['envoyee', 'refusee']).select('id')
  const inserer = () => supabase.from('demandes_travailleurs')
    .insert({ ...commun, cree_par: ctx?.userId || null, cree_par_nom: ctx?.userNom || null })
  let error = null
  let fait = false
  if (demandeEnAttente) {
    const r = await maj(demandeEnAttente.id)
    error = r.error
    fait = !error && !!r.data?.length
  }
  if (!error && !fait) {
    const r = await inserer()
    error = r.error
    if (error?.code === '23505') {
      // Index unique : une mise à jour est déjà en attente pour ce travailleur → on la remplace.
      const { data: lues } = await supabase.from('demandes_travailleurs').select('id')
        .eq('type', 'mise_a_jour').eq('travailleur_id', trav.id).in('statut', ['envoyee', 'refusee']).limit(1)
      const r2 = lues?.[0] ? await maj(lues[0].id) : { error: true }
      if (r2.error || !r2.data?.length) throw new Error('Une mise à jour est déjà en attente pour ce travailleur.')
      error = null
    }
  }
  if (error) throw new Error(manqueMigration(error) ? MIGRATION : "La mise à jour n'est pas partie. Vérifie ta connexion et réessaie.")
  notifier({
    type: 'fiche_trav_a_valider', titre: '📋 Fiche à valider',
    message: `${trav.nom} — mise à jour envoyée par ${ctx?.userNom || 'le gérant'}`,
    restaurant_id: trav.restaurant_id || null, cible_role: ROLES_RH, screen: 'embauches',
  })
  tracer('FICHE_TRAV_ENVOYEE', { travailleur_id: trav.id, travailleur: trav.nom }, ctx, trav.restaurant_id)
}

/**
 * RH : réserve d'abord la demande (statut envoyee → acceptee, une seule fois), puis écrit
 * pièces et fiche. Si une de ces écritures échoue, la demande est rendue (remise en envoyee)
 * pour qu'un nouvel essai réécrive tout ; aucune fiche n'est modifiée par une demande refusée.
 */
export async function accepterMiseAJour(demande, ctx) {
  const { data, error } = await supabase.from('demandes_travailleurs').update({
    statut: 'acceptee', motif_refus: null, traite_par: ctx?.userId || null, traite_par_nom: ctx?.userNom || null,
    traite_le: maintenant(), updated_at: maintenant(),
  }).eq('id', demande.id).eq('statut', 'envoyee').select('id')
  if (error) throw new Error("La validation n'a pas été enregistrée. Réessaie.")
  if (!data?.length) throw new Error('Déjà traitée par quelqu’un d’autre.')

  let trav
  try {
    trav = await chargerTravailleur(demande.travailleur_id)
    const { maj, nouvellesPieces, nouveauxPapiers } = fusionFiche(trav, demande)
    // Pièces avant la fiche : si l'insertion échoue, un nouvel essai réajoute les pièces
    // (fusionFiche les compare à piece_identite_urls, pas encore mis à jour).
    const papiers = [
      ...nouvellesPieces.map(url => ({ type_document: 'CNI', fichier_url: url })),
      ...nouveauxPapiers.map(url => ({ type_document: 'Autre', fichier_url: url })),
    ]
    if (papiers.length) {
      const { error: errPapiers } = await supabase.from('documents_travailleurs').insert(papiers.map(p => ({
        travailleur_id: trav.id, ...p, description: estPdf(p.fichier_url) ? 'pdf' : 'image',
      })))
      if (errPapiers) throw new Error("Les pièces n'ont pas été enregistrées. Réessaie.")
    }
    if (Object.keys(maj).length) {
      const { error: errFiche } = await supabase.from('travailleurs').update(maj).eq('id', trav.id)
      if (errFiche) throw new Error("La fiche n'a pas été mise à jour. Réessaie.")
    }
  } catch (e) {
    // Remise en attente, au mieux : si elle échoue aussi, la demande reste acceptée à tort
    // (signalée dans le rapport, pas de rattrapage automatique ici).
    try {
      await supabase.from('demandes_travailleurs').update({
        statut: 'envoyee', traite_par: null, traite_par_nom: null, traite_le: null, updated_at: maintenant(),
      }).eq('id', demande.id)
    } catch (_) {}
    throw e
  }
  notifier({
    type: 'fiche_trav_validee', titre: '✅ Fiche validée',
    message: `${trav.nom} : la fiche est à jour`, restaurant_id: trav.restaurant_id || null,
    cible_role: ['gerant'], screen: 'recrutement', params: { onglet: 'equipe' },
  })
  tracer('FICHE_TRAV_VALIDEE', { demande_id: demande.id, travailleur_id: trav.id, travailleur: trav.nom || nomComplet(demande) },
    ctx, trav.restaurant_id)
  return chargerTravailleur(trav.id)
}

/** Direction : relance les gérants d'un restaurant. */
export async function relancerGerants({ restaurantId, nombre }) {
  await creerNotification({
    type: 'campagne_fiches', titre: '📋 Fiches de votre équipe',
    message: `Il vous reste ${nombre} fiche${nombre > 1 ? 's' : ''} à compléter avant le ${TEXTE_DATE_LIMITE}.`,
    restaurant_id: restaurantId, cible_role: ['gerant'], screen: 'recrutement', params: { onglet: 'equipe' },
  })
}
