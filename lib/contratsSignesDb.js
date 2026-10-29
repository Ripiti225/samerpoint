// ──────────────────────────────────────────────────────────────────────────────
// Recrutement + contrats signés : toutes les écritures en base du circuit.
//
//   gérant  envoyerDemande → (refusée) corrigerEtRenvoyer
//   RH      accepterDemande | refuserDemande → genererContrat
//   RH      ajouterTravailleurDirect (même fiche, sans passer par une demande)
//   gérant  signerContrat | deposerPapierSigne | refuserSignature
//   RH      marquerSigne | corrigerContratRefuse | annulerContrat
//
// Chaque étape prévient l'autre partie (notifications) et laisse une trace
// dans le journal. Ni l'un ni l'autre ne bloque jamais l'action.
//
// Les fonctions lèvent une Error au message français, prêt à afficher.
// La logique (manquants, doublons, textes, PDF) vit dans des modules purs
// testés : lib/recrutement.js, lib/baremes.js, lib/modelesContrat.js,
// lib/pdfContrat.js.
// ──────────────────────────────────────────────────────────────────────────────
import { File, Paths } from 'expo-file-system'
import { Platform } from 'react-native'

import { uploadFichier } from './api'
import { clePoste, familleDe } from './baremes'
import { aujourdhuiISO } from './contrats'
import { enregistrer } from './exportRapportMensuel'
import { journaliser } from './journal'
import { marquePourResto } from './logos'
import { champsManquantsContrat, donneesDepuisFiche } from './modelesContrat'
import { envoyerNotifNouveauTravailleur } from './notifications'
import { creerNotification } from './notificationsInterne'
import { genererPdfContrat } from './pdfContrat'
import { estPdf, nomComplet } from './recrutement'
import { supabase } from './supabase'

const ROLES_RH = ['manager', 'directeur', 'rh']
const MIME_PDF = 'application/pdf'

const maintenant = () => new Date().toISOString()
const texte = v => (v === null || v === undefined ? null : String(v).trim() || null)

function notifier(params) {
  creerNotification(params).catch(() => {})
}

function tracer(action, details, ctx, restaurantId) {
  journaliser(action, details, {
    userId: ctx?.userId || null, userNom: ctx?.userNom || null, restaurantId: restaurantId || null,
  }).catch(() => {})
}

/** Marque du modèle de contrat pour un restaurant : 'samer', 'alkayan' ou 'alabraise'. */
export function marqueDuResto(resto) {
  return marquePourResto(resto)?.id || 'samer'
}

// ── Demandes de nouveau travailleur ─────────────────────────────────────────

export async function chargerDemandes({ restaurantId = null } = {}) {
  let q = supabase.from('demandes_travailleurs').select('*').order('created_at', { ascending: false }).range(0, 4999)
  if (restaurantId) q = q.eq('restaurant_id', restaurantId)
  const { data, error } = await q
  if (error) throw new Error('Impossible de charger les demandes. Vérifie ta connexion.')
  return data || []
}

/** Fiches connues (actives et archivées), pour repérer un ancien employé. */
export async function chargerTousTravailleurs() {
  const { data } = await supabase.from('travailleurs')
    .select('id, nom, contact, cni_numero, nni_numero, statut, actif, restaurant_id, restaurants(nom)')
    .range(0, 4999)
  return data || []
}

export function champsDemande(form) {
  return {
    civilite: texte(form.civilite),
    nom_famille: texte(form.nom_famille),
    prenoms: texte(form.prenoms),
    date_naissance: form.date_naissance || null,
    lieu_naissance: texte(form.lieu_naissance),
    nationalite: texte(form.nationalite),
    situation_famille: texte(form.situation_famille),
    lieu_residence: texte(form.lieu_residence),
    cni_numero: texte(form.cni_numero),
    nni_numero: texte(form.nni_numero),
    contact: texte(form.contact),
    poste: texte(form.poste),
    salaire_journalier: parseInt(form.salaire_journalier, 10) || null,
    date_embauche: form.date_embauche || null,
    photo_url: form.photo_url,
    piece_identite_urls: form.piece_identite_urls || [],
    papiers_urls: form.papiers_urls || [],
    doublon_travailleur_id: form.doublon_travailleur_id || null,
  }
}

export async function envoyerDemande(form, ctx, restaurant) {
  const { data, error } = await supabase.from('demandes_travailleurs').insert({
    ...champsDemande(form),
    restaurant_id: restaurant?.id || null,
    statut: 'envoyee',
    cree_par: ctx?.userId || null,
    cree_par_nom: ctx?.userNom || null,
  }).select().single()
  if (error) throw new Error("La demande n'est pas partie. Vérifie ta connexion et réessaie.")

  const nom = nomComplet(form)
  notifier({
    type: 'demande_trav_nouvelle', titre: '🧑‍🍳 Nouveau travailleur à valider',
    message: `${nom} — ${form.poste} · ${restaurant?.nom || ''}`,
    restaurant_id: restaurant?.id || null, cible_role: ROLES_RH, screen: 'embauches',
  })
  tracer('DEMANDE_TRAV_ENVOYEE', { demande_id: data.id, travailleur: nom, poste: form.poste }, ctx, restaurant?.id)
  return data
}

export async function corrigerEtRenvoyer(demande, form, ctx) {
  const { error } = await supabase.from('demandes_travailleurs').update({
    ...champsDemande(form), statut: 'envoyee', motif_refus: null, updated_at: maintenant(),
  }).eq('id', demande.id).eq('statut', 'refusee')
  if (error) throw new Error("La demande n'a pas pu être renvoyée. Vérifie ta connexion et réessaie.")

  const nom = nomComplet(form)
  notifier({
    type: 'demande_trav_nouvelle', titre: '🔁 Demande corrigée',
    message: `${nom} — ${form.poste} : la demande a été corrigée et renvoyée`,
    restaurant_id: demande.restaurant_id, cible_role: ROLES_RH, screen: 'embauches',
  })
  tracer('DEMANDE_TRAV_RENVOYEE', { demande_id: demande.id, travailleur: nom }, ctx, demande.restaurant_id)
}

function identiteDepuisDemande(d) {
  return {
    civilite: d.civilite, nom_famille: d.nom_famille, prenoms: d.prenoms, date_naissance: d.date_naissance,
    lieu_naissance: d.lieu_naissance, nationalite: d.nationalite, situation_famille: d.situation_famille,
    lieu_residence: d.lieu_residence, cni_numero: d.cni_numero, nni_numero: d.nni_numero,
    piece_identite_urls: d.piece_identite_urls || [],
  }
}

// Crée la fiche (ou réactive l'ancienne si `reutiliserId`), active tout de
// suite, et range la CNI et les papiers dans ses documents. → son id.
// `source` : une demande, ou le formulaire passé par champsDemande().
async function creerFiche(source, { salaire_journalier, reutiliserId = null, restaurantId }) {
  const fiche = {
    ...identiteDepuisDemande(source),
    nom: nomComplet(source),
    poste: source.poste,
    contact: source.contact,
    photo_url: source.photo_url,
    salaire_journalier: parseInt(salaire_journalier, 10) || null,
    date_embauche: source.date_embauche,
    restaurant_id: restaurantId,
    actif: true,
    statut: 'actif',
  }

  let travailleurId = reutiliserId
  if (reutiliserId) {
    const { error } = await supabase.from('travailleurs')
      .update({ ...fiche, archived_at: null, archive_motif: null }).eq('id', reutiliserId)
    if (error) throw new Error("L'ancienne fiche n'a pas pu être réactivée. Réessaie.")
  } else {
    const { data, error } = await supabase.from('travailleurs').insert(fiche).select('id').single()
    if (error) throw new Error("La fiche du travailleur n'a pas pu être créée. Réessaie.")
    travailleurId = data.id
  }

  const papiers = [
    ...(source.piece_identite_urls || []).map(url => ({ type_document: 'CNI', fichier_url: url })),
    ...(source.papiers_urls || []).map(url => ({ type_document: 'Autre', fichier_url: url })),
  ]
  if (papiers.length) {
    await supabase.from('documents_travailleurs').insert(papiers.map(p => ({
      travailleur_id: travailleurId, ...p, description: estPdf(p.fichier_url) ? 'pdf' : 'image',
    }))).then(() => {}, () => {})
  }
  return travailleurId
}

async function ficheComplete(travailleurId) {
  const { data } = await supabase.from('travailleurs')
    .select('*, restaurants(id, nom, couleur, code, marque)').eq('id', travailleurId).single()
  return data
}

/**
 * Accepte : crée la fiche (ou réactive l'ancienne si `reutiliserId`), active
 * tout de suite. → la fiche travailleur, avec son restaurant.
 */
export async function accepterDemande(demande, { salaire_journalier, reutiliserId = null }, ctx) {
  const travailleurId = await creerFiche(demande, { salaire_journalier, reutiliserId, restaurantId: demande.restaurant_id })
  const fiche = { nom: nomComplet(demande), poste: demande.poste }

  await supabase.from('demandes_travailleurs').update({
    statut: 'acceptee', travailleur_id: travailleurId, motif_refus: null,
    traite_par: ctx?.userId || null, traite_par_nom: ctx?.userNom || null, traite_le: maintenant(), updated_at: maintenant(),
  }).eq('id', demande.id)

  notifier({
    type: 'demande_trav_acceptee', titre: '✅ Nouveau travailleur accepté',
    message: `${fiche.nom} (${fiche.poste}) fait maintenant partie de l'équipe`,
    restaurant_id: demande.restaurant_id, cible_role: ['gerant'], screen: 'recrutement',
  })
  tracer('DEMANDE_TRAV_ACCEPTEE', {
    demande_id: demande.id, travailleur_id: travailleurId, travailleur: fiche.nom, reactivation: !!reutiliserId,
  }, ctx, demande.restaurant_id)

  return ficheComplete(travailleurId)
}

/**
 * RH / manager : ajoute un travailleur directement, avec la même fiche
 * complète que la demande d'un gérant (identité, CNI, papiers), sans circuit
 * de validation. → la fiche travailleur, avec son restaurant.
 */
export async function ajouterTravailleurDirect(form, ctx, restaurant, { reutiliserId = null } = {}) {
  if (!restaurant?.id) throw new Error('Choisis le restaurant du travailleur.')
  const source = champsDemande(form)
  const travailleurId = await creerFiche(source, {
    salaire_journalier: form.salaire_journalier, reutiliserId, restaurantId: restaurant.id,
  })
  const nom = nomComplet(source)
  notifier({
    type: 'nouveau_travailleur', titre: reutiliserId ? '♻️ Ancien travailleur réactivé' : '👤 Nouveau travailleur',
    message: `${nom} (${source.poste}) ajouté à ${restaurant.nom || ''}`,
    restaurant_id: restaurant.id, cible_role: ['manager', 'directeur', 'rh', 'gerant'],
  })
  envoyerNotifNouveauTravailleur(nom, restaurant.nom || '', restaurant.id).catch(() => {})
  tracer('TRAVAILLEUR_AJOUTE', {
    travailleur_id: travailleurId, travailleur: nom, poste: source.poste, reactivation: !!reutiliserId,
  }, ctx, restaurant.id)
  return ficheComplete(travailleurId)
}

export async function refuserDemande(demande, motif, ctx) {
  const m = texte(motif)
  if (!m) throw new Error('Écris la raison du refus : le gérant en a besoin pour corriger.')
  const historique = [...(demande.historique_refus || []), { motif: m, par: ctx?.userNom || null, le: maintenant() }]
  const { error } = await supabase.from('demandes_travailleurs').update({
    statut: 'refusee', motif_refus: m, historique_refus: historique,
    traite_par: ctx?.userId || null, traite_par_nom: ctx?.userNom || null, traite_le: maintenant(), updated_at: maintenant(),
  }).eq('id', demande.id)
  if (error) throw new Error("Le refus n'a pas été enregistré. Réessaie.")

  const nom = nomComplet(demande)
  notifier({
    type: 'demande_trav_refusee', titre: '❌ Demande refusée — à corriger',
    message: `${nom} : ${m}`, restaurant_id: demande.restaurant_id, cible_role: ['gerant'], screen: 'recrutement',
  })
  tracer('DEMANDE_TRAV_REFUSEE', { demande_id: demande.id, travailleur: nom, motif: m }, ctx, demande.restaurant_id)
}

// ── Barème et fiche ─────────────────────────────────────────────────────────

export async function chargerBaremes() {
  const { data } = await supabase.from('baremes_postes').select('*').order('poste').range(0, 999)
  return data || []
}

export async function enregistrerBareme(poste, type, montants) {
  const famille = familleDe(type)
  const ligne = famille === 'stage'
    ? { prime_journaliere: parseInt(montants.prime_journaliere, 10) || null }
    : {
      categorie: texte(montants.categorie),
      salaire_categoriel: parseInt(montants.salaire_categoriel, 10) || null,
      prime_tenue: Number.isFinite(parseInt(montants.prime_tenue, 10)) ? parseInt(montants.prime_tenue, 10) : null,
      indemnite_transport: parseInt(montants.indemnite_transport, 10) || null,
    }
  const { error } = await supabase.from('baremes_postes').upsert({
    cle_poste: clePoste(poste), poste: String(poste).trim(), famille, ...ligne, updated_at: maintenant(),
  }, { onConflict: 'cle_poste,famille' })
  if (error) throw new Error("Le barème n'a pas été enregistré.")
}

export async function supprimerBareme(id) {
  await supabase.from('baremes_postes').delete().eq('id', id)
}

/** Complète l'identité sur la fiche (champs du contrat qui manquaient). */
export async function completerFiche(travailleurId, champs) {
  const { error } = await supabase.from('travailleurs').update(champs).eq('id', travailleurId)
  if (error) throw new Error("La fiche n'a pas été mise à jour. Réessaie.")
}

// ── Contrats ────────────────────────────────────────────────────────────────

function messageErreurContrat(error) {
  const txt = String(error?.message || '')
  if (txt.includes('contrat_un_seul_en_attente')) {
    return 'Ce travailleur a déjà un contrat en cours de signature. Annule-le d’abord dans sa fiche.'
  }
  if (txt.includes('contrats_sans_chevauchement')) {
    return 'Ce travailleur a déjà un contrat signé sur ces dates. Vérifie la date de début.'
  }
  if (txt.includes('contrat_cdi_sans_fin')) return "Un CDI n'a pas de date de fin, un Stage ou un CDD doit en avoir une."
  return "Le contrat n'a pas pu être enregistré. Vérifie ta connexion et réessaie."
}

/**
 * Fige les données et envoie au gérant. choix : { type, duree_mois,
 * date_debut, date_fin, montants }. → la ligne du contrat.
 */
export async function genererContrat({ travailleur, resto, choix, demandeId = null }, ctx) {
  const marque = marqueDuResto(resto || travailleur?.restaurants)
  const donnees = donneesDepuisFiche(travailleur, marque, choix)
  const manquants = champsManquantsContrat(choix.type, donnees)
  if (manquants.length) throw new Error(`Il manque : ${manquants.join(', ')}.`)

  const { data, error } = await supabase.from('contrats_travailleurs').insert({
    travailleur_id: travailleur.id,
    restaurant_id: travailleur.restaurant_id || null,
    type: choix.type,
    date_debut: donnees.date_debut,
    date_fin: donnees.date_fin,
    duree_mois: donnees.duree_mois,
    statut: 'a_signer',
    modele: choix.type,
    donnees,
    envoye_le: maintenant(),
    demande_id: demandeId,
    cree_par: ctx?.userId || null,
  }).select().single()
  if (error) throw new Error(messageErreurContrat(error))

  notifier({
    type: 'contrat_a_signer', titre: '✍️ Contrat à faire signer',
    message: `${choix.type} de ${travailleur.nom} — à faire signer au travailleur`,
    restaurant_id: travailleur.restaurant_id || null, cible_role: ['gerant'], screen: 'recrutement', params: { onglet: 'signer' },
  })
  tracer('CONTRAT_GENERE', {
    contrat_id: data.id, travailleur: travailleur.nom, type: choix.type, date_debut: donnees.date_debut, date_fin: donnees.date_fin,
  }, ctx, travailleur.restaurant_id)
  return data
}

/** Contrat refusé par le travailleur : nouveau gel, renvoyé au gérant. */
export async function corrigerContratRefuse(contrat, { travailleur, resto, choix }, ctx) {
  const marque = marqueDuResto(resto || travailleur?.restaurants)
  const donnees = donneesDepuisFiche(travailleur, marque, choix)
  const manquants = champsManquantsContrat(choix.type, donnees)
  if (manquants.length) throw new Error(`Il manque : ${manquants.join(', ')}.`)

  const { error } = await supabase.from('contrats_travailleurs').update({
    type: choix.type, modele: choix.type, date_debut: donnees.date_debut, date_fin: donnees.date_fin,
    duree_mois: donnees.duree_mois, donnees, statut: 'a_signer', motif_refus: null, signature_traits: null,
    pdf_signe_url: null, papier_signe_url: null, signe_le: null, envoye_le: maintenant(),
  }).eq('id', contrat.id).eq('statut', 'refuse')
  if (error) throw new Error(messageErreurContrat(error))

  notifier({
    type: 'contrat_a_signer', titre: '✍️ Contrat corrigé à faire signer',
    message: `${choix.type} de ${travailleur.nom} — corrigé après refus, à faire signer`,
    restaurant_id: travailleur.restaurant_id || null, cible_role: ['gerant'], screen: 'recrutement', params: { onglet: 'signer' },
  })
  tracer('CONTRAT_CORRIGE_APRES_REFUS', { contrat_id: contrat.id, travailleur: travailleur.nom }, ctx, travailleur.restaurant_id)
}

export async function annulerContrat(contrat, motif, ctx, travailleurNom) {
  const m = texte(motif)
  if (!m) throw new Error("Écris pourquoi ce contrat est annulé.")
  const { error } = await supabase.from('contrats_travailleurs').update({
    statut: 'annule', annule_le: maintenant(), annule_motif: m,
  }).eq('id', contrat.id).neq('statut', 'signe')
  if (error) throw new Error("L'annulation n'a pas été enregistrée. Réessaie.")
  if (contrat.statut === 'a_signer') {
    notifier({
      type: 'contrat_annule', titre: '🚫 Contrat annulé',
      message: `Le ${contrat.type} de ${travailleurNom || 'ce travailleur'} n'est plus à faire signer (${m})`,
      restaurant_id: contrat.restaurant_id, cible_role: ['gerant'],
    })
  }
  tracer('CONTRAT_ANNULE', { contrat_id: contrat.id, travailleur: travailleurNom, motif: m }, ctx, contrat.restaurant_id)
}

function base64VersOctets(base64) {
  const binaire = atob(base64)
  const octets = new Uint8Array(binaire.length)
  for (let i = 0; i < binaire.length; i++) octets[i] = binaire.charCodeAt(i)
  return octets
}

/** Envoie un fichier fabriqué dans l'app (PDF) au bucket `photos`. → URL publique. */
export async function televerserBase64(base64, mime, dossier, nomFichier) {
  let url = null
  if (Platform.OS === 'web') {
    const uri = URL.createObjectURL(new Blob([base64VersOctets(base64)], { type: mime }))
    try { url = await uploadFichier(uri, dossier) } finally { URL.revokeObjectURL(uri) }
  } else {
    const fichier = new File(Paths.cache, nomFichier)
    if (fichier.exists) fichier.delete()
    fichier.create()
    fichier.write(base64VersOctets(base64))
    url = await uploadFichier(fichier.uri, dossier)
  }
  if (!url) throw new Error("Le PDF n'a pas pu être envoyé. Vérifie ta connexion et réessaie.")
  return url
}

/** Téléchargement (web) ou feuille de partage WhatsApp / impression (mobile). */
export async function telechargerPdf({ base64, nomFichier }) {
  return enregistrer(nomFichier, { base64 }, MIME_PDF)
}

/** PDF non signé, pour le plan B papier. */
export async function telechargerPdfNonSigne(contrat) {
  const pdf = await genererPdfContrat({ donnees: { ...contrat.donnees, date_signature: null } })
  return telechargerPdf(pdf)
}

/**
 * Le travailleur a signé à l'appareil. signature : { traits, ratio }.
 * → { base64, nomFichier } du PDF signé, pour le télécharger aussitôt.
 */
export async function signerContrat(contrat, signature, ctx, travailleurNom) {
  if (!signature?.traits?.length) throw new Error('La signature est vide. Le travailleur doit signer dans le cadre.')
  const donnees = { ...contrat.donnees, date_signature: aujourdhuiISO() }
  const pdf = await genererPdfContrat({ donnees, signature })
  const url = await televerserBase64(pdf.base64, MIME_PDF, 'contrats', pdf.nomFichier)

  const { data, error } = await supabase.from('contrats_travailleurs').update({
    statut: 'signe_a_verifier', donnees, signature_traits: signature, pdf_signe_url: url, signe_le: maintenant(),
    presente_par: ctx?.userId || null, presente_par_nom: ctx?.userNom || null,
  }).eq('id', contrat.id).eq('statut', 'a_signer').select('id')
  if (error) throw new Error("La signature n'a pas été enregistrée. Vérifie ta connexion et réessaie.")
  if (!data?.length) throw new Error("Ce contrat n'est plus à signer (déjà signé ou annulé).")

  notifier({
    type: 'contrat_signe_a_verifier', titre: '🖊️ Contrat signé — à vérifier',
    message: `${contrat.type} de ${travailleurNom || ''} signé sur l'appareil du gérant`,
    restaurant_id: contrat.restaurant_id, cible_role: ROLES_RH, screen: 'contrats',
  })
  tracer('CONTRAT_SIGNE_APPAREIL', { contrat_id: contrat.id, travailleur: travailleurNom }, ctx, contrat.restaurant_id)
  return pdf
}

/** Plan B : photo du papier signé à la main. */
export async function deposerPapierSigne(contrat, photoUrl, ctx, travailleurNom) {
  if (!photoUrl) throw new Error('Prends en photo le contrat signé.')
  const { data, error } = await supabase.from('contrats_travailleurs').update({
    statut: 'signe_a_verifier', papier_signe_url: photoUrl, signe_le: maintenant(),
    donnees: { ...contrat.donnees, date_signature: aujourdhuiISO() },
    presente_par: ctx?.userId || null, presente_par_nom: ctx?.userNom || null,
  }).eq('id', contrat.id).eq('statut', 'a_signer').select('id')
  if (error) throw new Error("La photo n'a pas été enregistrée. Réessaie.")
  if (!data?.length) throw new Error("Ce contrat n'est plus à signer (déjà signé ou annulé).")

  notifier({
    type: 'contrat_signe_a_verifier', titre: '📄 Contrat signé sur papier — à vérifier',
    message: `${contrat.type} de ${travailleurNom || ''} : photo du papier signé`,
    restaurant_id: contrat.restaurant_id, cible_role: ROLES_RH, screen: 'contrats',
  })
  tracer('CONTRAT_SIGNE_PAPIER', { contrat_id: contrat.id, travailleur: travailleurNom }, ctx, contrat.restaurant_id)
}

export async function refuserSignature(contrat, motif, ctx, travailleurNom) {
  const m = texte(motif)
  if (!m) throw new Error('Écris la raison du refus du travailleur.')
  const historique = [...(contrat.historique_refus || []), { motif: m, par: ctx?.userNom || null, le: maintenant() }]
  const { error } = await supabase.from('contrats_travailleurs').update({
    statut: 'refuse', motif_refus: m, historique_refus: historique,
  }).eq('id', contrat.id).eq('statut', 'a_signer')
  if (error) throw new Error("Le refus n'a pas été enregistré. Réessaie.")

  notifier({
    type: 'contrat_refuse', titre: '⛔ Contrat refusé par le travailleur',
    message: `${contrat.type} de ${travailleurNom || ''} : ${m}`,
    restaurant_id: contrat.restaurant_id, cible_role: ROLES_RH, screen: 'contrats',
  })
  tracer('CONTRAT_REFUSE_TRAVAILLEUR', { contrat_id: contrat.id, travailleur: travailleurNom, motif: m }, ctx, contrat.restaurant_id)
}

/** La RH a vérifié : le contrat entre dans les contrats du travailleur. */
export async function marquerSigne(contrat, ctx, travailleurNom) {
  const preuve = contrat.pdf_signe_url || contrat.papier_signe_url
  if (!preuve) throw new Error("Ce contrat n'a ni PDF signé ni photo du papier.")
  const estPdf = !!contrat.pdf_signe_url
  const { data, error } = await supabase.from('contrats_travailleurs').update({
    statut: 'signe', photo_url: preuve, photo_type: estPdf ? 'pdf' : 'photo',
    valide_par: ctx?.userId || null, valide_par_nom: ctx?.userNom || null, valide_le: maintenant(),
  }).eq('id', contrat.id).eq('statut', 'signe_a_verifier').select('id')
  if (error) throw new Error(messageErreurContrat(error))
  if (!data?.length) throw new Error("Ce contrat n'est plus à vérifier.")

  await supabase.from('documents_travailleurs').insert({
    travailleur_id: contrat.travailleur_id, type_document: 'Contrat', fichier_url: preuve, description: estPdf ? 'pdf' : 'image',
  }).then(() => {}, () => {})
  await supabase.from('travailleurs').update({ type_contrat: contrat.type }).eq('id', contrat.travailleur_id)

  notifier({
    type: 'contrat_valide', titre: '📝 Contrat validé',
    message: `${contrat.type} de ${travailleurNom || ''} validé par la RH`,
    restaurant_id: contrat.restaurant_id, cible_role: ['gerant'],
  })
  tracer('CONTRAT_VALIDE', { contrat_id: contrat.id, travailleur: travailleurNom, type: contrat.type }, ctx, contrat.restaurant_id)
}
