// ──────────────────────────────────────────────────────────────────────────────
// Mise à jour des fiches par les gérants : écritures en base.
// Logique : lib/miseAJourFiches.js (pure, testée). Migration :
// supabase_mise_a_jour_fiches.sql. Les fonctions lèvent une Error au message
// français, prêt à afficher.
// ──────────────────────────────────────────────────────────────────────────────
import { champsDemande } from './contratsSignesDb'
import { journaliser } from './journal'
import { TEXTE_DATE_LIMITE, fusionFiche } from './miseAJourFiches'
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

/** Tous les travailleurs non archivés et les contrats, pour le suivi par restaurant. */
export async function chargerCampagne() {
  const [t, c] = await Promise.all([
    supabase.from('travailleurs').select('*').neq('statut', 'archive').range(0, 4999),
    supabase.from('contrats_travailleurs').select('travailleur_id, statut, date_debut, date_fin, cloture_le').range(0, 9999),
  ])
  if (t.error) throw new Error('Impossible de charger le suivi. Vérifie ta connexion.')
  return { travailleurs: t.data || [], contrats: c.data || [] }
}

/** Gérant : envoie (ou remplace) la mise à jour en attente de ce travailleur. */
export async function envoyerMiseAJour(trav, form, ctx, demandeEnAttente) {
  const champs = { ...champsDemande(form), poste: trav.poste || 'Non renseigné', salaire_journalier: null, doublon_travailleur_id: null }
  const commun = { ...champs, type: 'mise_a_jour', travailleur_id: trav.id, restaurant_id: trav.restaurant_id || null,
    statut: 'envoyee', motif_refus: null, updated_at: maintenant() }
  const { error } = demandeEnAttente
    ? await supabase.from('demandes_travailleurs').update(commun).eq('id', demandeEnAttente.id)
    : await supabase.from('demandes_travailleurs').insert({ ...commun, cree_par: ctx?.userId || null, cree_par_nom: ctx?.userNom || null })
  if (error) throw new Error(manqueMigration(error) ? MIGRATION : "La mise à jour n'est pas partie. Vérifie ta connexion et réessaie.")
  notifier({
    type: 'fiche_trav_a_valider', titre: '📋 Fiche à valider',
    message: `${trav.nom} — mise à jour envoyée par ${ctx?.userNom || 'le gérant'}`,
    restaurant_id: trav.restaurant_id || null, cible_role: ROLES_RH, screen: 'embauches',
  })
  tracer('FICHE_TRAV_ENVOYEE', { travailleur_id: trav.id, travailleur: trav.nom }, ctx, trav.restaurant_id)
}

/** RH : fusionne dans la fiche (sans rien effacer), puis marque la demande acceptée. */
export async function accepterMiseAJour(demande, ctx) {
  const trav = await chargerTravailleur(demande.travailleur_id)
  const { maj, nouvellesPieces, nouveauxPapiers } = fusionFiche(trav, demande)
  if (Object.keys(maj).length) {
    const { error } = await supabase.from('travailleurs').update(maj).eq('id', trav.id)
    if (error) throw new Error("La fiche n'a pas été mise à jour. Réessaie.")
  }
  const papiers = [
    ...nouvellesPieces.map(url => ({ type_document: 'CNI', fichier_url: url })),
    ...nouveauxPapiers.map(url => ({ type_document: 'Autre', fichier_url: url })),
  ]
  if (papiers.length) {
    await supabase.from('documents_travailleurs').insert(papiers.map(p => ({
      travailleur_id: trav.id, ...p, description: estPdf(p.fichier_url) ? 'pdf' : 'image',
    }))).then(() => {}, () => {})
  }
  // Après la fiche : une double validation réécrit les mêmes valeurs, sans dégât.
  const { data, error } = await supabase.from('demandes_travailleurs').update({
    statut: 'acceptee', motif_refus: null, traite_par: ctx?.userId || null, traite_par_nom: ctx?.userNom || null,
    traite_le: maintenant(), updated_at: maintenant(),
  }).eq('id', demande.id).eq('statut', 'envoyee').select('id')
  if (error) throw new Error("La validation n'a pas été enregistrée. Réessaie.")
  if (!data?.length) throw new Error('Déjà traitée par quelqu’un d’autre.')
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
