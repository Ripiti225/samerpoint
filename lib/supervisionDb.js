// ──────────────────────────────────────────────────────────────────────────────
// Lectures et écritures de la supervision (calculs : lib/supervision.js,
// tables : supabase_supervision.sql).
//
// Les notifications et le journal ne bloquent jamais : une visite enregistrée
// reste enregistrée même si l'alerte ne part pas.
// ──────────────────────────────────────────────────────────────────────────────
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Platform } from 'react-native'
import { journaliser } from './journal'
import { envoyerNotifExplicationNouvelle } from './notifications'
import { creerNotification } from './notificationsInterne'
import { chargerNotesCaissiers } from './noteCaissierDb'
import { supabase } from './supabase'
import {
  brouillonLePlusRecent, JOURS_PERIODE, noteRestaurant, noteVisite, panneOuverte, tacheOuverte, visiteOubliee,
} from './supervision'

const PAGE = 1000
const ROLES_ADMIN = ['manager', 'directeur']

async function toutes(construire) {
  const lignes = []
  for (let debut = 0; ; debut += PAGE) {
    const { data, error } = await construire().range(debut, debut + PAGE - 1)
    if (error) throw error
    lignes.push(...(data || []))
    if (!data || data.length < PAGE) break
  }
  return lignes
}

const isoJour = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const ilYa = jours => { const d = new Date(); d.setDate(d.getDate() - jours); return isoJour(d) }
const silencieux = p => Promise.resolve(p).catch(() => {})

// ── Position du téléphone (preuve de la visite) ─────────────────────────────

/**
 * { lat, lng, precision } ou { erreur }. Jamais d'exception : une position
 * refusée n'empêche pas la visite, elle est notée comme refusée.
 * Web seulement (l'app installée n'a pas le module de localisation, qui
 * demanderait un nouveau build).
 */
export function positionActuelle() {
  return new Promise(resolve => {
    if (Platform.OS !== 'web' || typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve({ erreur: 'indisponible' })
      return
    }
    let fini = false
    const finir = v => { if (!fini) { fini = true; resolve(v) } }
    setTimeout(() => finir({ erreur: 'delai' }), 12000)
    navigator.geolocation.getCurrentPosition(
      p => finir({ lat: p.coords.latitude, lng: p.coords.longitude, precision: Math.round(p.coords.accuracy || 0) }),
      e => finir({ erreur: e?.code === 1 ? 'refusee' : 'indisponible' }),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    )
  })
}

/** « Position relevée (± 20 m) », « Position refusée »… */
export function textePosition(p) {
  if (!p) return 'Position non relevée'
  if (p.lat !== undefined) return `Position relevée (± ${p.precision || '?'} m)`
  if (p.erreur === 'refusee') return 'Position refusée sur le téléphone'
  return 'Position indisponible'
}

export const lienCarte = p => (p && p.lat !== undefined ? `https://maps.google.com/?q=${p.lat},${p.lng}` : null)

// ── Grille ──────────────────────────────────────────────────────────────────

export async function chargerCriteres({ tous = false } = {}) {
  let q = supabase.from('supervision_criteres').select('*').order('ordre').order('created_at')
  if (!tous) q = q.eq('actif', true)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

export async function enregistrerCritere({ id, libelle, aide, poids, ordre, actif = true }) {
  const ligne = { libelle: libelle.trim(), aide: aide?.trim() || null, poids: Number(poids) || 1, ordre: Number(ordre) || 0, actif }
  const { error } = id
    ? await supabase.from('supervision_criteres').update(ligne).eq('id', id)
    : await supabase.from('supervision_criteres').insert(ligne)
  if (error) throw error
}

// ── Lectures ────────────────────────────────────────────────────────────────

export async function chargerRestaurants() {
  const { data, error } = await supabase.from('restaurants').select('id, nom, couleur').order('nom')
  if (error) throw error
  return data || []
}

export async function chargerTravailleursResto(restaurantId) {
  const { data, error } = await supabase.from('travailleurs').select('id, nom, poste, actif, statut')
    .eq('restaurant_id', restaurantId).neq('statut', 'archive').order('nom')
  if (error) throw error
  return (data || []).filter(t => t.actif !== false)
}

export async function chargerVisites({ restaurantId = null, depuis = null, statut = 'terminee' } = {}) {
  return toutes(() => {
    let q = supabase.from('supervision_visites').select('*')
    if (restaurantId) q = q.eq('restaurant_id', restaurantId)
    if (statut) q = q.eq('statut', statut)
    if (depuis) q = q.gte('debut_at', `${depuis}T00:00:00Z`)
    return q.order('debut_at', { ascending: false }).order('id')
  })
}

/**
 * La visite en cours de ce superviseur (une seule à la fois).
 * Une visite commencée un jour d'avant et jamais terminée est abandonnée
 * d'office : renvoyée dans `abandonnee` pour prévenir le superviseur.
 * Renvoie { visite, abandonnee }.
 */
export async function visiteEnCours(superviseurId) {
  const { data, error } = await supabase.from('supervision_visites').select('*')
    .eq('superviseur_id', superviseurId).eq('statut', 'en_cours').order('debut_at', { ascending: false })
  if (error) throw error
  const aujourdhui = new Date().toISOString().slice(0, 10)  // Abidjan = UTC
  let abandonnee = null
  for (const v of data || []) {
    if (!visiteOubliee(v, aujourdhui)) continue
    const { error: e } = await supabase.from('supervision_visites')
      .update({ statut: 'annulee', fin_at: new Date().toISOString() }).eq('id', v.id)
    if (e) continue
    await effacerBrouillon(v.id)
    silencieux(journaliser('supervision_visite_abandon_auto', { debut: v.debut_at }, { restaurantId: v.restaurant_id, userId: superviseurId }))
    abandonnee = abandonnee || v
  }
  const visite = (data || []).find(v => !visiteOubliee(v, aujourdhui)) || null
  return { visite, abandonnee }
}

export async function chargerDetailVisite(visiteId) {
  const [v, notes, trav, taches] = await Promise.all([
    supabase.from('supervision_visites').select('*').eq('id', visiteId).maybeSingle(),
    supabase.from('supervision_notes').select('*').eq('visite_id', visiteId).order('created_at'),
    supabase.from('supervision_travailleurs').select('*').eq('visite_id', visiteId).order('travailleur_nom'),
    supabase.from('supervision_taches').select('*').or(`visite_id.eq.${visiteId},faite_visite_id.eq.${visiteId}`).order('created_at'),
  ])
  if (v.error) throw v.error
  return { visite: v.data, notes: notes.data || [], travailleurs: trav.data || [], taches: taches.data || [] }
}

export async function chargerTaches({ restaurantId = null, ouvertesSeulement = false } = {}) {
  return toutes(() => {
    let q = supabase.from('supervision_taches').select('*')
    if (restaurantId) q = q.eq('restaurant_id', restaurantId)
    if (ouvertesSeulement) q = q.in('statut', ['a_faire', 'signalee'])
    return q.order('created_at', { ascending: false }).order('id')
  })
}

export async function chargerLignesTravailleurs({ depuis = ilYa(90), restaurantId = null } = {}) {
  return toutes(() => {
    let q = supabase.from('supervision_travailleurs').select('*').gte('created_at', `${depuis}T00:00:00Z`)
    if (restaurantId) q = q.eq('restaurant_id', restaurantId)
    return q.order('created_at').order('id')
  })
}

// Matériel en panne et suggestions d'achats. Tables absentes avant la
// migration : on renvoie une liste vide plutôt que de casser la fiche.
async function chargerTableResto(table, restaurantId) {
  try {
    return await toutes(() => {
      let q = supabase.from(table).select('*')
      if (restaurantId) q = q.eq('restaurant_id', restaurantId)
      return q.order('created_at', { ascending: false }).order('id')
    })
  } catch { return [] }
}
export const chargerPannes = ({ restaurantId = null } = {}) => chargerTableResto('supervision_pannes', restaurantId)
export const chargerAchats = ({ restaurantId = null } = {}) => chargerTableResto('supervision_achats', restaurantId)

/**
 * Note de chaque restaurant (ou d'un seul) : visites, tâches et notes des
 * caissiers des 30 derniers jours. Si la note des caissiers ne se charge pas
 * (POS injoignable…), la note se calcule sans elle et `donneesErreur` le dit.
 */
export async function chargerSynthese({ restaurantId = null } = {}) {
  const aujourdhui = isoJour()
  const depuis = ilYa(JOURS_PERIODE + 60) // pour retrouver la dernière visite d'un resto peu visité
  const [restaurants, visites, taches, caissiers, pannes, achats] = await Promise.all([
    chargerRestaurants(),
    chargerVisites({ restaurantId, depuis }),
    chargerTaches({ restaurantId }),
    chargerNotesCaissiers({ restaurantId }).then(r => ({ notes: r.notes }), e => ({ notes: [], erreur: e })),
    chargerPannes({ restaurantId }),
    chargerAchats({ restaurantId }),
  ])
  const liste = restaurants.filter(r => !restaurantId || r.id === restaurantId).map(r => {
    const siennes = taches.filter(t => t.restaurant_id === r.id)
    return {
      restaurant: r,
      ...noteRestaurant({ restaurantId: r.id, visites, notesCaissiers: caissiers.notes, taches: siennes, aujourdhui }),
      tachesOuvertes: siennes.filter(tacheOuverte).length,
      aConfirmer: siennes.filter(t => t.statut === 'signalee').length,
      contestations: visites.filter(v => v.restaurant_id === r.id && v.conteste && !v.decision).length,
      pannesOuvertes: pannes.filter(p => p.restaurant_id === r.id && panneOuverte(p)).length,
      achatsAExaminer: achats.filter(a => a.restaurant_id === r.id && a.statut === 'proposee').length,
    }
  })
  return { liste, visites, taches, pannes, achats, aujourdhui, donneesErreur: caissiers.erreur || null }
}

// ── Visite : commencer, brouillon, terminer ─────────────────────────────────

export async function commencerVisite({ restaurant, userId, userNom }) {
  const position = await positionActuelle()
  const { data, error } = await supabase.from('supervision_visites').insert({
    restaurant_id: restaurant.id, superviseur_id: userId || null, superviseur_nom: userNom || 'Superviseur',
    position_debut: position, statut: 'en_cours',
  }).select().single()
  if (error) throw error
  silencieux(journaliser('supervision_visite_debut', { restaurant: restaurant.nom }, { restaurantId: restaurant.id, userId, userNom }))
  return data
}

export async function annulerVisite(visite) {
  const { error } = await supabase.from('supervision_visites').update({ statut: 'annulee', fin_at: new Date().toISOString() }).eq('id', visite.id)
  if (error) throw error
  await effacerBrouillon(visite.id)
}

// Brouillon : gardé sur le téléphone à chaque changement ET recopié dans la
// base (colonne supervision_visites.brouillon) pour le retrouver après une
// déconnexion ou sur un autre téléphone. Le plus récent des deux gagne.
const cleBrouillon = id => `samtrackly_visite_brouillon_${id}`
export async function lireBrouillon(visite) {
  let local = null
  try { const raw = await AsyncStorage.getItem(cleBrouillon(visite.id)); local = raw ? JSON.parse(raw) : null } catch {}
  let distant = visite.brouillon || null
  if (!distant) {
    const { data, error } = await supabase.from('supervision_visites').select('brouillon').eq('id', visite.id).maybeSingle()
    if (!error) distant = data?.brouillon || null   // colonne absente avant la migration : ignoré
  }
  return brouillonLePlusRecent(local, distant)
}
export async function ecrireBrouillon(visiteId, brouillon) {
  try { await AsyncStorage.setItem(cleBrouillon(visiteId), JSON.stringify(brouillon)) } catch {}
}
/** Recopie dans la base ; renvoie false si l'envoi échoue (réseau, colonne absente). */
export async function envoyerBrouillon(visiteId, brouillon) {
  try {
    const { error } = await supabase.from('supervision_visites').update({ brouillon }).eq('id', visiteId)
    return !error
  } catch { return false }
}
export async function effacerBrouillon(visiteId) {
  try { await AsyncStorage.removeItem(cleBrouillon(visiteId)) } catch {}
  await silencieux(supabase.from('supervision_visites').update({ brouillon: null }).eq('id', visiteId))
}

/**
 * Enregistre la visite d'un coup, à la fin.
 *   notes       { [critere_id]: { note, commentaire, photo_url, grave } }
 *   travailleurs { [travailleur_id]: { note, en_retard, absent, commentaire } } (seuls ceux renseignés)
 *   verifs      { [tache_id]: { resultat: 'faite' | 'pas_faite', photo, motif } }
 *   nouvelles   [{ titre, details, importante, echeance, responsable_nom, responsable_travailleur_id, photo_constat_url }]
 *   pannesOuvertes / pannesVerifs { [panne_id]: { resultat: 'reparee' | 'remplacee', commentaire } }
 *   pannesNouvelles [{ objet, description, urgente, photo_url }]
 *   achatsNouveaux  [{ objet, raison, quantite, prix_estime, urgente, photo_url }]
 * Renvoie la note /20.
 */
export async function terminerVisite({
  visite, restaurant, criteres, notes, travailleursResto, travailleurs, tachesOuvertes, verifs, nouvelles, remarques, userId, userNom,
  pannesOuvertes = [], pannesVerifs = {}, pannesNouvelles = [], achatsNouveaux = [],
}) {
  const position = await positionActuelle()
  const maintenant = new Date().toISOString()

  const lignesNotes = criteres.map(c => {
    const x = notes[c.id]
    return {
      visite_id: visite.id, critere_id: c.id, critere_libelle: c.libelle, poids: c.poids,
      note: x.note, commentaire: x.commentaire?.trim() || null, photo_url: x.photo_url || null, grave: !!x.grave,
    }
  })
  const note = noteVisite(lignesNotes)
  const graves = lignesNotes.filter(l => l.grave)

  // Supprimer d'abord ce qu'une tentative précédente aurait laissé (réseau coupé à mi-chemin).
  await supabase.from('supervision_notes').delete().eq('visite_id', visite.id)
  await supabase.from('supervision_travailleurs').delete().eq('visite_id', visite.id)

  const r1 = await supabase.from('supervision_notes').insert(lignesNotes)
  if (r1.error) throw r1.error

  const lignesTrav = travailleursResto
    .filter(t => travailleurs[t.id] && (travailleurs[t.id].note || travailleurs[t.id].absent || travailleurs[t.id].en_retard))
    .map(t => {
      const x = travailleurs[t.id]
      return {
        visite_id: visite.id, restaurant_id: restaurant.id, travailleur_id: t.id, travailleur_nom: t.nom, poste: t.poste || null,
        note: x.absent ? null : x.note || null, absent: !!x.absent, en_retard: !x.absent && !!x.en_retard, commentaire: x.commentaire?.trim() || null,
      }
    })
  if (lignesTrav.length) {
    const r2 = await supabase.from('supervision_travailleurs').insert(lignesTrav)
    if (r2.error) throw r2.error
  }

  // Tâches vérifiées
  for (const t of tachesOuvertes) {
    const v = verifs[t.id]
    if (!v?.resultat) continue
    const maj = v.resultat === 'faite'
      ? { statut: 'faite', faite_visite_id: visite.id, faite_at: maintenant, faite_par_nom: userNom, faite_photo_url: v.photo || null, derniere_verif_at: maintenant }
      : { statut: 'a_faire', nb_non_faite: (t.nb_non_faite || 0) + 1, derniere_verif_at: maintenant, derniere_verif_refus: v.motif?.trim() || 'Pas faite au passage du superviseur' }
    const { error } = await supabase.from('supervision_taches').update({ ...maj, updated_at: maintenant }).eq('id', t.id)
    if (error) throw error
  }

  // Nouvelles tâches (une seule fois : l'id de visite les rattache, on évite les doublons d'un nouvel essai)
  const nouvellesValides = nouvelles.filter(t => String(t.titre || '').trim())
  if (nouvellesValides.length) {
    const { data: deja } = await supabase.from('supervision_taches').select('titre').eq('visite_id', visite.id)
    const titresDeja = new Set((deja || []).map(x => x.titre))
    const aCreer = nouvellesValides.filter(t => !titresDeja.has(t.titre.trim())).map(t => ({
      restaurant_id: restaurant.id, visite_id: visite.id, titre: t.titre.trim(), details: t.details?.trim() || null,
      importante: !!t.importante, echeance: t.echeance || null, responsable_nom: t.responsable_nom || null,
      responsable_travailleur_id: t.responsable_travailleur_id || null, photo_constat_url: t.photo_constat_url || null,
      cree_par_id: userId || null, cree_par_nom: userNom || null,
    }))
    if (aCreer.length) {
      const r3 = await supabase.from('supervision_taches').insert(aCreer)
      if (r3.error) throw r3.error
    }
  }

  // Matériel : pannes constatées réglées, nouvelles pannes, suggestions d'achats.
  for (const p of pannesOuvertes) {
    const v = pannesVerifs[p.id]
    if (!v?.resultat) continue
    const { error } = await supabase.from('supervision_pannes').update({
      statut: v.resultat, repare_at: maintenant, repare_par_nom: userNom || null,
      repare_commentaire: v.commentaire?.trim() || 'Constaté au passage du superviseur', updated_at: maintenant,
    }).eq('id', p.id)
    if (error) throw error
  }
  const pannesValides = pannesNouvelles.filter(p => String(p.objet || '').trim())
  const achatsValides = achatsNouveaux.filter(a => String(a.objet || '').trim())
  if (pannesValides.length) {
    const { data: deja } = await supabase.from('supervision_pannes').select('objet').eq('visite_id', visite.id)
    const objetsDeja = new Set((deja || []).map(x => x.objet))
    const aCreer = pannesValides.filter(p => !objetsDeja.has(p.objet.trim())).map(p => ({
      restaurant_id: restaurant.id, visite_id: visite.id, objet: p.objet.trim(), description: p.description?.trim() || null,
      urgente: !!p.urgente, photo_url: p.photo_url || null, signale_par_nom: userNom || null,
    }))
    if (aCreer.length) {
      const r5 = await supabase.from('supervision_pannes').insert(aCreer)
      if (r5.error) throw r5.error
    }
  }
  if (achatsValides.length) {
    const { data: deja } = await supabase.from('supervision_achats').select('objet').eq('visite_id', visite.id)
    const objetsDeja = new Set((deja || []).map(x => x.objet))
    const aCreer = achatsValides.filter(a => !objetsDeja.has(a.objet.trim())).map(a => ({
      restaurant_id: restaurant.id, visite_id: visite.id, objet: a.objet.trim(), raison: a.raison?.trim() || null,
      quantite: Math.max(1, Number(a.quantite) || 1), prix_estime: Number(String(a.prix_estime || '').replace(/\D/g, '')) || null,
      urgente: !!a.urgente, photo_url: a.photo_url || null, propose_par_nom: userNom || null,
    }))
    if (aCreer.length) {
      const r6 = await supabase.from('supervision_achats').insert(aCreer)
      if (r6.error) throw r6.error
    }
  }

  const r4 = await supabase.from('supervision_visites').update({
    statut: 'terminee', fin_at: maintenant, position_fin: position, note, points_graves: graves.length,
    remarques: remarques?.trim() || null,
  }).eq('id', visite.id)
  if (r4.error) throw r4.error
  await effacerBrouillon(visite.id)

  // Alertes (jamais bloquantes)
  const nbTaches = nouvellesValides.length
  silencieux(creerNotification({
    type: 'supervision_visite',
    titre: 'Visite du superviseur',
    message: `🧭 ${userNom || 'Le superviseur'} est passé : note ${String(note ?? '—').replace('.', ',')}/20`
      + (nbTaches ? ` · ${nbTaches} tâche${nbTaches > 1 ? 's' : ''} à faire` : '') + '. Ouvrez pour lire.',
    restaurant_id: restaurant.id, cible_role: ['gerant'], created_by: userId || null, screen: 'supervision',
  }))
  if (graves.length) {
    silencieux(creerNotification({
      type: 'supervision_grave',
      titre: '⚠️ Point grave constaté',
      message: `${restaurant.nom} · ${graves.map(g => `${g.critere_libelle} : ${g.commentaire}`).join(' · ')}`,
      restaurant_id: restaurant.id, cible_role: [...ROLES_ADMIN], created_by: userId || null, screen: 'supervision',
    }))
  }
  if (pannesValides.length || achatsValides.length) {
    const urgentes = pannesValides.filter(p => p.urgente).length + achatsValides.filter(a => a.urgente).length
    silencieux(creerNotification({
      type: 'supervision_materiel',
      titre: urgentes ? '🔧 Matériel : urgent' : '🔧 Matériel et achats',
      message: `${restaurant.nom} · `
        + [pannesValides.length ? `${pannesValides.length} en panne (${pannesValides.map(p => p.objet.trim()).join(', ')})` : null,
          achatsValides.length ? `${achatsValides.length} suggestion${achatsValides.length > 1 ? 's' : ''} d'achat à examiner` : null]
          .filter(Boolean).join(' · '),
      restaurant_id: restaurant.id, cible_role: [...ROLES_ADMIN], created_by: userId || null, screen: 'supervision',
    }))
  }
  silencieux(journaliser('supervision_visite_fin', { restaurant: restaurant.nom, note, graves: graves.length, taches: nbTaches,
    pannes: pannesValides.length, achats: achatsValides.length },
    { restaurantId: restaurant.id, userId, userNom }))
  return note
}

// ── Gérant : lu, tâche faite, réponse ───────────────────────────────────────

export async function marquerVisiteLue(visite, nom) {
  if (visite.lu_gerant_at) return
  await silencieux(supabase.from('supervision_visites').update({ lu_gerant_at: new Date().toISOString(), lu_gerant_nom: nom || null }).eq('id', visite.id))
}

export async function signalerTacheFaite({ tache, photoUrl, commentaire, nom, userId }) {
  if (!photoUrl) throw new Error('La photo est obligatoire pour signaler une tâche faite.')
  const maintenant = new Date().toISOString()
  const { error } = await supabase.from('supervision_taches').update({
    statut: 'signalee', signalee_par_nom: nom || null, signalee_at: maintenant, signalee_photo_url: photoUrl,
    signalee_commentaire: commentaire?.trim() || null, updated_at: maintenant,
  }).eq('id', tache.id)
  if (error) throw error
  silencieux(journaliser('supervision_tache_signalee', { titre: tache.titre }, { restaurantId: tache.restaurant_id, userId, userNom: nom }))
}

export async function repondreVisite({ visite, texte, conteste, nom, restaurantNom, userId }) {
  const { error } = await supabase.from('supervision_visites').update({
    reponse_gerant: texte.trim(), reponse_gerant_nom: nom || null, reponse_gerant_at: new Date().toISOString(), conteste: !!conteste,
  }).eq('id', visite.id)
  if (error) throw error
  silencieux(creerNotification({
    type: conteste ? 'supervision_contestation' : 'supervision_reponse',
    titre: conteste ? 'Note du superviseur contestée' : 'Réponse du gérant',
    message: `${restaurantNom || 'Un restaurant'} · ${nom || 'Le gérant'}${conteste ? ' conteste la note' : ' a répondu'} : « ${texte.trim().slice(0, 120)} »`,
    restaurant_id: visite.restaurant_id, cible_role: [...ROLES_ADMIN], created_by: userId || null, screen: 'supervision',
  }))
}

// ── Manager : décision sur une contestation ─────────────────────────────────

export async function deciderContestation({ visite, decision, noteCorrigee, motif, nom, userId }) {
  const { error } = await supabase.from('supervision_visites').update({
    decision, note_corrigee: decision === 'corrigee' ? Number(noteCorrigee) : null,
    decision_motif: motif?.trim() || null, decision_par_nom: nom || null, decision_at: new Date().toISOString(),
  }).eq('id', visite.id)
  if (error) throw error
  silencieux(creerNotification({
    type: 'supervision_decision',
    titre: 'Contestation examinée',
    message: decision === 'corrigee'
      ? `Votre note a été corrigée à ${String(noteCorrigee).replace('.', ',')}/20${motif ? ` : ${motif}` : ''}`
      : `La note est maintenue${motif ? ` : ${motif}` : ''}`,
    restaurant_id: visite.restaurant_id, cible_role: ['gerant'], created_by: userId || null, screen: 'supervision',
  }))
}

// ── Demande d'explication pour une tâche non faite ──────────────────────────

/**
 * Crée une demande d'explication pour le responsable de la tâche (ou le
 * gérant du restaurant si personne n'est désigné). Comme pour le
 * vérificateur, elle passe par l'acceptation d'un admin.
 */
export async function demanderExplicationTache({ tache, restaurant, userId, userNom }) {
  let travailleurId = tache.responsable_travailleur_id || null
  let nom = tache.responsable_nom || null
  let poste = null
  if (!nom) {
    const { data: g } = await supabase.from('utilisateurs').select('nom')
      .eq('restaurant_id', restaurant.id).eq('role', 'gerant').eq('actif', true).limit(1)
    nom = g?.[0]?.nom || 'Gérant'
  }
  if (!travailleurId) {
    const { data: t } = await supabase.from('travailleurs').select('id, poste').eq('restaurant_id', restaurant.id).ilike('nom', nom).limit(1)
    if (t?.length) { travailleurId = t[0].id; poste = t[0].poste || null }
  }
  const echeance = tache.echeance ? ` pour le ${tache.echeance.split('-').reverse().join('/')}` : ''
  const description = `Tâche laissée par le superviseur (${tache.cree_par_nom || 'superviseur'}) le `
    + `${String(tache.created_at).slice(0, 10).split('-').reverse().join('/')}${echeance} : « ${tache.titre} ».`
    + (tache.details ? `\n${tache.details}` : '')
    + `\n\nConstatée non faite ${tache.nb_non_faite || 1} fois`
    + (tache.derniere_verif_refus ? ` (dernière remarque : ${tache.derniere_verif_refus})` : '')
    + '.\n\nMerci d\'expliquer pourquoi elle n\'a pas été faite.'
  const { data, error } = await supabase.from('demandes_explication').insert({
    restaurant_id: restaurant.id, travailleur_id: travailleurId, travailleur_nom: nom, travailleur_poste: poste,
    motif: `Tâche du superviseur non faite : ${tache.titre}`, description,
    statut: 'en_attente_acceptation', numero: 1,
    cree_par_id: userId || null, cree_par_nom: userNom || 'Superviseur', cree_par_role: 'superviseur',
  }).select('id').single()
  if (error) throw error
  await supabase.from('supervision_taches').update({ demande_explication_id: data.id, updated_at: new Date().toISOString() }).eq('id', tache.id)
  silencieux(envoyerNotifExplicationNouvelle(nom, restaurant.id))
  silencieux(creerNotification({
    type: 'explication_nouvelle',
    titre: "Demande d'explication",
    message: `📨 ${restaurant.nom} · ${nom} · tâche du superviseur non faite : « ${tache.titre} » · à accepter`,
    restaurant_id: restaurant.id, cible_role: ['rh', 'directeur', 'manager'], created_by: userId || null,
    screen: 'demandes-explication-admin',
  }))
  return data.id
}

export async function annulerTache({ tache, nom, userId }) {
  const { error } = await supabase.from('supervision_taches').update({ statut: 'annulee', updated_at: new Date().toISOString() }).eq('id', tache.id)
  if (error) throw error
  silencieux(journaliser('supervision_tache_annulee', { titre: tache.titre }, { restaurantId: tache.restaurant_id, userId, userNom: nom }))
}

// ── Matériel : réparé / remplacé, décision et achat ─────────────────────────

/** statut : 'reparee' | 'remplacee' | 'annulee'. Le gérant met une photo (obligatoire côté écran). */
export async function reglerPanne({ panne, statut, commentaire, photoUrl, nom, userId }) {
  const maintenant = new Date().toISOString()
  const { error } = await supabase.from('supervision_pannes').update({
    statut, repare_at: maintenant, repare_par_nom: nom || null, repare_commentaire: commentaire?.trim() || null,
    repare_photo_url: photoUrl || null, updated_at: maintenant,
  }).eq('id', panne.id)
  if (error) throw error
  silencieux(journaliser('supervision_panne_' + statut, { objet: panne.objet }, { restaurantId: panne.restaurant_id, userId, userNom: nom }))
}

/** decision : 'acceptee' | 'refusee' (manager, directeur). Le gérant est prévenu. */
export async function deciderAchat({ achat, decision, motif, nom, userId }) {
  const { error } = await supabase.from('supervision_achats').update({
    statut: decision, decision_par_nom: nom || null, decision_at: new Date().toISOString(),
    decision_motif: motif?.trim() || null, updated_at: new Date().toISOString(),
  }).eq('id', achat.id)
  if (error) throw error
  silencieux(creerNotification({
    type: 'supervision_achat',
    titre: decision === 'acceptee' ? '👍 Achat accepté' : 'Achat refusé',
    message: `« ${achat.objet} »${decision === 'acceptee' ? ' sera acheté' : ' : refusé'}${motif?.trim() ? ` · ${motif.trim()}` : ''}`,
    restaurant_id: achat.restaurant_id, cible_role: ['gerant'], created_by: userId || null, screen: 'supervision',
  }))
}

export async function marquerAchatAchete({ achat, nom, userId }) {
  const { error } = await supabase.from('supervision_achats').update({
    statut: 'achetee', achete_at: new Date().toISOString(), achete_par_nom: nom || null, updated_at: new Date().toISOString(),
  }).eq('id', achat.id)
  if (error) throw error
  silencieux(journaliser('supervision_achat_achete', { objet: achat.objet }, { restaurantId: achat.restaurant_id, userId, userNom: nom }))
}
