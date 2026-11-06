// ──────────────────────────────────────────────────────────────────────────────
// Mise à jour des fiches par les gérants et contrat pour tous (29/10/2026).
// Module pur : aucune lecture de la base ni de l'horloge (écritures :
// lib/miseAJourFichesDb.js). Conception :
// docs/superpowers/specs/2026-10-29-mise-a-jour-fiches-contrats-design.md
//
// Une mise à jour = demande_travailleurs de type 'mise_a_jour' rattachée au
// travailleur. À l'acceptation, un champ envoyé vide n'efface JAMAIS une
// valeur connue. `nom` suit le nom de famille et les prénoms quand ils changent
// (nomSuivi) ; les écritures relient d'abord les anciennes paies à la fiche.
// ──────────────────────────────────────────────────────────────────────────────
import { contratEnCours, contratsSignes } from './contrats.js'
import { nomComplet } from './recrutement.js'

export const DATE_LIMITE = '2026-11-12'
export const TEXTE_DATE_LIMITE = 'jeudi 12 novembre'

// Champs que la mise à jour peut écrire sur la fiche.
export const CHAMPS_FUSION = [
  'photo_url', 'civilite', 'nom_famille', 'prenoms', 'date_naissance', 'lieu_naissance', 'nationalite',
  'situation_famille', 'lieu_residence', 'cni_numero', 'nni_numero', 'contact', 'date_embauche',
]

export const LIBELLES = {
  photo_url: 'Photo', civilite: 'Civilité', nom_famille: 'Nom de famille', prenoms: 'Prénoms',
  date_naissance: 'Date de naissance', lieu_naissance: 'Lieu de naissance', nationalite: 'Nationalité',
  situation_famille: 'Situation de famille', lieu_residence: 'Lieu de résidence', cni_numero: 'CNI',
  nni_numero: 'NNI', contact: 'Téléphone', date_embauche: "Date d'embauche",
}

const vide = v => v === null || v === undefined || String(v).trim() === ''
const norm = v => (vide(v) ? '' : String(v).trim())

/**
 * Nouveau nom complet si le nom de famille ou les prénoms changent, que les deux
 * sont remplis et que le résultat diffère ; sinon null. Un champ absent de
 * `nouveau` garde sa valeur de la fiche. Empêche tout renommage en masse.
 */
export function nomSuivi(trav, nouveau) {
  const t = trav || {}
  const n = nouveau || {}
  const famille = 'nom_famille' in n ? norm(n.nom_famille) : norm(t.nom_famille)
  const prenoms = 'prenoms' in n ? norm(n.prenoms) : norm(t.prenoms)
  if (famille === norm(t.nom_famille) && prenoms === norm(t.prenoms)) return null
  if (!famille || !prenoms) return null
  const nom = nomComplet({ nom_famille: famille, prenoms })
  return nom === norm(t.nom) ? null : nom
}

/** Ce qu'exige le contrat (identité, pièce, résidence, téléphone, début) + la photo. */
export function manquantsFiche(f) {
  const x = f || {}
  const manque = []
  for (const cle of ['photo_url', 'civilite', 'nom_famille', 'prenoms', 'date_naissance', 'lieu_naissance', 'nationalite']) {
    if (vide(x[cle])) manque.push(LIBELLES[cle])
  }
  if (vide(x.cni_numero) && vide(x.nni_numero)) manque.push('CNI ou NNI')
  for (const cle of ['lieu_residence', 'contact', 'date_embauche']) if (vide(x[cle])) manque.push(LIBELLES[cle])
  return manque
}

/** « KOUASSI Jean Marc » → nom de famille = premier mot, prénoms = le reste. */
export function proposerNomPrenoms(nom) {
  const mots = String(nom || '').trim().split(/\s+/).filter(Boolean)
  return { nom_famille: mots[0] || '', prenoms: mots.slice(1).join(' ') }
}

/** Valeurs de départ du formulaire de mise à jour (FormulaireDemande). */
export function ficheVersFormulaire(trav) {
  const t = trav || {}
  const prop = vide(t.nom_famille) && vide(t.prenoms) ? proposerNomPrenoms(t.nom) : {}
  const f = {}
  for (const cle of CHAMPS_FUSION) f[cle] = vide(t[cle]) ? '' : t[cle]
  f.photo_url = t.photo_url || null
  return {
    ...f, ...prop, poste: t.poste || '', salaire_journalier: '',
    piece_identite_urls: [...(t.piece_identite_urls || [])], papiers_urls: [],
  }
}

const OBLIGATOIRES = ['photo_url', 'nom_famille', 'prenoms']

/** Ce que le gérant envoie : un champ non obligatoire identique à la fiche part vide (pas de retour arrière). */
export function champsAEnvoyer(trav, form) {
  const t = trav || {}
  const envoi = { ...form }
  for (const cle of CHAMPS_FUSION) {
    if (OBLIGATOIRES.includes(cle)) continue
    if (norm(form?.[cle]) === norm(t[cle])) envoi[cle] = ''
  }
  return envoi
}

/** Formulaire de correction d'une mise à jour refusée : fiche actuelle + champs remplis de la demande. */
export function formulaireCorrection(trav, demande) {
  const f = ficheVersFormulaire(trav)
  for (const cle of CHAMPS_FUSION) if (!vide(demande?.[cle])) f[cle] = demande[cle]
  const pieces = [...(f.piece_identite_urls || [])]
  for (const u of demande?.piece_identite_urls || []) if (u && !pieces.includes(u)) pieces.push(u)
  f.piece_identite_urls = pieces
  f.papiers_urls = [...(demande?.papiers_urls || [])]
  return f
}

/** Champs qui changent : envoyés remplis ET différents de la fiche, plus le nom complet s'il suit. */
export function diffFiche(trav, demande) {
  const t = trav || {}
  const lignes = CHAMPS_FUSION
    .filter(cle => !vide(demande?.[cle]) && norm(demande[cle]) !== norm(t[cle]))
    .map(cle => ({ cle, libelle: LIBELLES[cle], avant: vide(t[cle]) ? null : t[cle], apres: demande[cle] }))
  const identite = {}
  for (const { cle, apres } of lignes) if (cle === 'nom_famille' || cle === 'prenoms') identite[cle] = apres
  const nom = nomSuivi(t, identite)
  if (nom) lignes.push({ cle: 'nom', libelle: 'Nom complet', avant: vide(t.nom) ? null : t.nom, apres: nom })
  return lignes
}

/** Ce que l'acceptation écrit : jamais un vide, pièces sans doublon ; `nom` seulement s'il suit (voir diffFiche). */
export function fusionFiche(trav, demande) {
  const maj = {}
  for (const { cle, apres } of diffFiche(trav, demande)) maj[cle] = typeof apres === 'string' ? apres.trim() : apres
  const connues = trav?.piece_identite_urls || []
  const nouvellesPieces = (demande?.piece_identite_urls || []).filter(u => u && !connues.includes(u))
  if (nouvellesPieces.length) maj.piece_identite_urls = [...connues, ...nouvellesPieces]
  const nouveauxPapiers = (demande?.papiers_urls || []).filter(Boolean)
  return { maj, nouvellesPieces, nouveauxPapiers }
}

// ── Corrections de la RH et complément direct ─────────────────────────────────

export const CHAMPS_CORRIGIBLES = CHAMPS_FUSION.filter(c => c !== 'photo_url')

/** La demande avec les valeurs retenues par la RH : texte nettoyé, champ vide → null. */
export function demandeCorrigee(demande, form) {
  const sortie = { ...demande }
  for (const c of CHAMPS_CORRIGIBLES) sortie[c] = norm(form?.[c]) || null
  return sortie
}

export function champsCorriges(demande) {
  return Object.fromEntries(CHAMPS_CORRIGIBLES.map(c => [c, demande?.[c] ?? null]))
}

/** Ce que la RH a changé par rapport au formulaire ouvert, pour le journal. */
export function correctionsRH(depart, form) {
  return CHAMPS_CORRIGIBLES
    .filter(c => norm(depart?.[c]) !== norm(form?.[c]))
    .map(c => ({ champ: LIBELLES[c], envoye: norm(depart?.[c]) || null, retenu: norm(form?.[c]) || null }))
}

/** La table des demandes exige nom de famille et prénoms. */
export const correctionComplete = form => !vide(form?.nom_famille) && !vide(form?.prenoms)

const LIBELLES_JOURNAL = {
  nom: 'Nom complet', ...LIBELLES, poste: 'Poste', type_contrat: 'Type de contrat', salaire_journalier: 'Salaire journalier',
}

/** Avant → après d'une fiche modifiée, pour le journal. */
export function changementsFiche(avant, apres) {
  return Object.keys(LIBELLES_JOURNAL)
    .filter(c => c in (apres || {}) && norm(avant?.[c]) !== norm(apres[c]))
    .map(c => ({ champ: LIBELLES_JOURNAL[c], avant: norm(avant?.[c]) || null, apres: norm(apres[c]) || null }))
}

/** Journalier (ou Stage) → Stage ; CDI → CDI ; sinon CDD (décision du 29/10/2026). */
export function typeContratPropose(trav) {
  const t = String(trav?.type_contrat || '').trim().toLowerCase()
  if (t === 'journalier' || t === 'stage') return 'Stage'
  if (t === 'cdi') return 'CDI'
  return 'CDD'
}

export const contratDejaTermine = (fin, aujourdhui) => !vide(fin) && fin < aujourdhui

/** travailleur_id → sa mise à jour en attente (envoyée ou refusée), la plus récente. */
export function demandesEnAttenteParTravailleur(demandes) {
  const m = {}
  for (const d of demandes || []) {
    if (d.type !== 'mise_a_jour' || !d.travailleur_id || !['envoyee', 'refusee'].includes(d.statut)) continue
    if (!m[d.travailleur_id] || String(d.created_at) > String(m[d.travailleur_id].created_at)) m[d.travailleur_id] = d
  }
  return m
}

export function etatFiche(trav, demandeEnAttente) {
  if (demandeEnAttente?.statut === 'envoyee') return 'envoyee'
  if (demandeEnAttente?.statut === 'refusee') return 'refusee'
  return manquantsFiche(trav).length ? 'incomplete' : 'a_jour'
}

const ORDRE = { refusee: 0, incomplete: 1, envoyee: 2, a_jour: 3 }
const actif = t => t && t.statut !== 'archive'

/** Équipe d'un gérant : refusées, puis les plus incomplètes, envoyées, à jour. */
export function listeEquipe(travailleurs, demandes) {
  const enAttente = demandesEnAttenteParTravailleur(demandes)
  return (travailleurs || []).filter(actif)
    .map(trav => {
      const demande = enAttente[trav.id] || null
      return { trav, demande, etat: etatFiche(trav, demande), manquants: manquantsFiche(trav) }
    })
    .sort((a, b) => ORDRE[a.etat] - ORDRE[b.etat]
      || b.manquants.length - a.manquants.length
      || String(a.trav.nom || '').localeCompare(String(b.trav.nom || '')))
}

/** Fiches que le gérant doit encore traiter : incomplètes ou refusées. */
export function nbACompleter(travailleurs, demandes) {
  return listeEquipe(travailleurs, demandes).filter(x => x.etat === 'incomplete' || x.etat === 'refusee').length
}

const aCompleter = (travailleurs, demandes, restaurantId) => listeEquipe(travailleurs, demandes)
  .filter(x => x.manquants.length > 0 || x.etat === 'refusee')
  .filter(x => !restaurantId || x.trav.restaurant_id === restaurantId)

/** Fiches incomplètes ou refusées : celles où il manque le plus d'abord, puis par nom. */
export function fichesACompleter(travailleurs, demandes, { restaurantId = null, manque = null } = {}) {
  return aCompleter(travailleurs, demandes, restaurantId)
    .filter(x => !manque || x.manquants.includes(manque))
    .sort((a, b) => b.manquants.length - a.manquants.length
      || String(a.trav.nom || '').localeCompare(String(b.trav.nom || '')))
}

/** Nombre de fiches par donnée manquante, du plus fréquent au moins fréquent. */
export function comptesManquants(travailleurs, demandes, { restaurantId = null } = {}) {
  const compte = {}
  for (const x of aCompleter(travailleurs, demandes, restaurantId)) {
    for (const m of x.manquants) compte[m] = (compte[m] || 0) + 1
  }
  return Object.entries(compte)
    .map(([libelle, nombre]) => ({ libelle, nombre }))
    .sort((a, b) => b.nombre - a.nombre || a.libelle.localeCompare(b.libelle))
}

/** Suivi par restaurant pour la direction. */
export function resumeCampagne({ travailleurs, demandes, contrats, restaurants, aujourdhui }) {
  const parTrav = {}
  for (const c of contrats || []) (parTrav[c.travailleur_id] ||= []).push(c)
  const signe = t => !!contratEnCours(contratsSignes(parTrav[t.id]), aujourdhui)
  const equipe = listeEquipe(travailleurs, demandes)
  const compter = liste => ({
    total: liste.length,
    aJour: liste.filter(x => x.etat === 'a_jour').length,
    enAttente: liste.filter(x => x.etat === 'envoyee').length,
    aCompleter: liste.filter(x => x.etat === 'incomplete' || x.etat === 'refusee').length,
    contratsSignes: liste.filter(x => signe(x.trav)).length,
  })
  const lignes = (restaurants || [])
    .map(r => ({ restaurant_id: r.id, nom: String(r.nom || '').trim(), ...compter(equipe.filter(x => x.trav.restaurant_id === r.id)) }))
    .filter(l => l.total > 0)
  return { lignes, total: compter(equipe) }
}

export const dateLimiteDepassee = aujourdhui => aujourdhui > DATE_LIMITE
