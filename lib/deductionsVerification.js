// ─────────────────────────────────────────────────────────────────────────
//  VÉRIFICATION DE STOCK → MONTANTS À DÉDUIRE
//
//  Le vérificateur compte physiquement. Chaque écart constaté devient un
//  montant à déduire, partagé entre les caissiers responsables, puis tranché
//  par l'administration.
//
//  Règles (validées avec l'utilisateur) :
//   • Montant = |écart| × prix. Le surplus compte comme un manquant : trouver
//     plus que déclaré peut signaler des produits entrés en douce.
//   • Deux caissiers : celui EN POSTE à l'heure du comptage, et celui du
//     SHIFT PRÉCÉDENT, qui a déclaré ce stock et aurait dû voir le problème.
//     Comptage à 11h → shift 08h-16h (en poste) + shift 00h-08h (précédent).
//   • Partage à PARTS ÉGALES entre tous les caissiers retenus.
//   • L'explication est saisie par le vérificateur, pas par le caissier.
//
//  Voir supabase_deductions_verification.sql.
// ─────────────────────────────────────────────────────────────────────────

import { supabase } from './supabase'
import { CATEGORIES_INVENTAIRE } from './constants'

// ── Prix ─────────────────────────────────────────────────────────────────

const PRIX = {}
CATEGORIES_INVENTAIRE.forEach(cat => {
  (cat.produits || []).forEach(p => { PRIX[p.id] = p.prix || 0 })
})

export const prixProduit = id => PRIX[id] || 0

// ── Horaires ─────────────────────────────────────────────────────────────

/** « 08:30 » → 510 minutes. null si illisible. */
function enMinutes(heure) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(heure || '').trim())
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

/**
 * Un shift couvre-t-il l'instant T ? Gère le passage de minuit
 * (22:00 → 06:00 couvre 23:00 comme 02:00).
 */
function couvre(shift, minutes) {
  const debut = enMinutes(shift.heure_debut)
  const fin = enMinutes(shift.heure_fin)
  if (debut == null || fin == null) return false
  // Une fin à 00:00 signifie « minuit », donc fin de journée.
  const finReelle = fin === 0 ? 24 * 60 : fin
  if (finReelle > debut) return minutes >= debut && minutes < finReelle
  return minutes >= debut || minutes < finReelle   // shift à cheval sur minuit
}

/**
 * Caissiers responsables d'un écart constaté à `heureComptage`.
 *
 * On retient le(s) shift(s) EN POSTE à cette heure, plus le(s) shift(s)
 * immédiatement PRÉCÉDENT(s). Deux caissiers peuvent partager le même
 * créneau : ils sont alors tous retenus, et le partage se fait entre tous.
 *
 * @param {Array} shifts  lignes points_shifts de la journée (heure_debut, heure_fin, caissier_id, caissier_nom)
 * @param {string} heureComptage  « HH:MM »
 */
export function caissiersResponsables(shifts, heureComptage) {
  const minutes = enMinutes(heureComptage)
  if (minutes == null) return []

  const valides = (shifts || []).filter(s => enMinutes(s.heure_debut) != null && s.caissier_id)
  if (valides.length === 0) return []

  // Ordre chronologique des créneaux distincts. Un shift marqué `_veille`
  // (dernier créneau de la journée précédente) se place avant ceux du jour :
  // sans lui, un comptage à 07h30 n'imputerait personne au shift précédent,
  // alors que le stock a bien été déclaré par le caissier du soir de la veille.
  const cleDe = s => `${s._veille ? 'V' : 'J'}|${s.heure_debut}|${s.heure_fin}`
  const creneaux = [...new Set(valides.map(cleDe))]
    .map(cle => {
      const [jour, heure_debut, heure_fin] = cle.split('|')
      const veille = jour === 'V'
      return {
        cle, heure_debut, heure_fin, veille,
        debut: enMinutes(heure_debut) - (veille ? 24 * 60 : 0),
      }
    })
    .sort((a, b) => a.debut - b.debut)

  const indexEnPoste = creneaux.findIndex(c => !c.veille && couvre(c, minutes))
  const retenus = []

  if (indexEnPoste >= 0) {
    retenus.push({ creneau: creneaux[indexEnPoste], role: 'en_poste' })
    if (indexEnPoste > 0) {
      retenus.push({ creneau: creneaux[indexEnPoste - 1], role: 'shift_precedent' })
    }
  } else {
    // Comptage hors de tout créneau (avant ouverture, ou horaires incomplets) :
    // on impute au dernier shift terminé, qui a déclaré ce stock.
    const dernier = [...creneaux].reverse().find(c => c.debut <= minutes) || creneaux[creneaux.length - 1]
    if (dernier) retenus.push({ creneau: dernier, role: 'shift_precedent' })
  }

  // Un créneau peut être tenu par plusieurs caissiers : tous sont concernés.
  const personnes = []
  retenus.forEach(({ creneau, role }) => {
    valides
      .filter(s => cleDe(s) === creneau.cle)
      .forEach(s => {
        if (personnes.some(p => p.caissier_id === s.caissier_id)) return
        personnes.push({
          caissier_id: s.caissier_id,
          caissier_nom: s.caissier_nom || 'Caissier',
          shift_libelle: `${s.heure_debut}–${s.heure_fin}${creneau.veille ? ' (veille)' : ''}`,
          role_dans_ecart: role,
        })
      })
  })
  return personnes
}

// ── Calcul ───────────────────────────────────────────────────────────────

/**
 * Valeur totale des écarts d'un comptage, et résumé lisible des produits.
 * Le surplus compte comme un manquant : on prend la valeur absolue.
 */
export function chiffrerComptage(ecarts) {
  let montant = 0
  const morceaux = []
  ;(ecarts || []).forEach(e => {
    const ecart = Number(e.ecart) || 0
    if (Math.abs(ecart) < 0.001) return
    const v = Math.abs(ecart) * prixProduit(e.produit_id)
    if (v <= 0) return
    montant += v
    morceaux.push(`${e.produit_nom} ${ecart > 0 ? '+' : ''}${ecart}`)
  })
  return {
    montant_ecart: Math.round(montant),
    montant_plafond: Math.min(Math.round(montant), PLAFOND_COMPTAGE),
    nb_produits: morceaux.length,
    produits_resume: morceaux.join(', '),
  }
}

/**
 * PROPOSITION de répartition — l'administration la modifie ensuite librement.
 * L'enveloppe (plafonnée) est partagée à parts égales entre les caissiers
 * identifiés, sans perte à l'arrondi.
 */
export function proposerRepartition(ecarts, personnes) {
  const constat = chiffrerComptage(ecarts)
  if (constat.montant_plafond <= 0) return { constat, parts: [] }
  if (!personnes || personnes.length === 0) return { constat, parts: [] }

  const base = Math.floor(constat.montant_plafond / personnes.length)
  const reliquat = constat.montant_plafond - base * personnes.length
  const parts = personnes.map((p, i) => {
    const montant = base + (i < reliquat ? 1 : 0)
    return {
      ...constat,
      beneficiaire_type: 'caissier',
      caissier_id: p.caissier_id,
      caissier_nom: p.caissier_nom,
      shift_libelle: p.shift_libelle,
      role_dans_ecart: p.role_dans_ecart,
      montant,
      montant_propose: montant,
    }
  })
  return { constat, parts }
}

/** La répartition saisie est-elle complète ? */
export function repartitionValide(parts, montantPlafond) {
  const somme = (parts || []).reduce((s, p) => s + (Number(p.montant) || 0), 0)
  return {
    somme,
    reste: Math.round(montantPlafond - somme),
    ok: Math.abs(montantPlafond - somme) < 1,
  }
}

/**
 * Ancienne répartition par produit — conservée pour l'aperçu chiffré affiché
 * au vérificateur pendant la saisie.
 * Renvoie une ligne PAR (produit × caissier).
 */
export function calculerDeductions(ecarts, personnes) {
  if (!personnes || personnes.length === 0) return []
  const lignes = []

  ;(ecarts || []).forEach(e => {
    const ecart = Number(e.ecart) || 0
    if (Math.abs(ecart) < 0.001) return
    const prix = prixProduit(e.produit_id)
    // Le surplus est traité comme un manquant : on prend la valeur absolue.
    const montantTotal = Math.abs(ecart) * prix
    if (montantTotal <= 0) return

    // Répartition sans perte : chacun reçoit la part entière basse, et le
    // reliquat de l'arrondi va aux premiers. Sans ça, 5 000 F partagés en
    // trois donneraient 3 × 1 667 = 5 001 F déduits pour 5 000 F manquants.
    const total = Math.round(montantTotal)
    const base = Math.floor(total / personnes.length)
    const reliquat = total - base * personnes.length

    personnes.forEach((p, i) => {
      lignes.push({
        produit_id: e.produit_id,
        produit_nom: e.produit_nom,
        stock_declare: Number(e.stock_reel) || 0,
        stock_compte: Number(e.stock_compte) || 0,
        ecart,
        prix_unitaire: prix,
        montant_total: total,
        montant: base + (i < reliquat ? 1 : 0),
        explication: (e.explication || '').trim() || null,
        ...p,
      })
    })
  })
  return lignes
}

// ── Plafond ──────────────────────────────────────────────────────────────

/**
 * Montant maximum réellement déduit POUR UN COMPTAGE, tous produits et tous
 * caissiers confondus. Les montants réels restent affichés tels quels : le
 * plafond ne masque pas l'écart constaté, il limite ce qui est retenu.
 */
export const PLAFOND_COMPTAGE = 50000

/** Regroupe par comptage. À défaut de lot, la journée du restaurant fait foi. */
const cleLot = d => d.lot_id || `${d.restaurant_id}|${d.date}`

/**
 * Ajoute `montant_retenu` à chaque ligne : la part réellement déduite une fois
 * le plafond appliqué. La réduction est proportionnelle, pour que chacun
 * garde son poids relatif, et le reliquat d'arrondi est réparti afin que la
 * somme retombe exactement sur le plafond.
 *
 * Une part validée (écart justifié) sort du calcul : elle ne consomme pas le
 * plafond et n'est pas retenue.
 */
export function appliquerPlafond(deductions, plafond = PLAFOND_COMPTAGE) {
  const lignes = (deductions || []).map(d => ({ ...d }))
  const lots = {}
  lignes.forEach(d => {
    if (d.statut === 'validee') { d.montant_retenu = 0; return }
    ;(lots[cleLot(d)] = lots[cleLot(d)] || []).push(d)
  })

  Object.values(lots).forEach(groupe => {
    const reel = groupe.reduce((s, d) => s + (Number(d.montant) || 0), 0)
    if (reel <= plafond) {
      groupe.forEach(d => { d.montant_retenu = Math.round(Number(d.montant) || 0); d.plafonne = false })
      return
    }
    const facteur = plafond / reel
    let cumul = 0
    groupe.forEach((d, i) => {
      d.plafonne = true
      d.montant_reel_comptage = Math.round(reel)
      if (i === groupe.length - 1) {
        d.montant_retenu = plafond - cumul        // le dernier absorbe l'arrondi
      } else {
        d.montant_retenu = Math.round((Number(d.montant) || 0) * facteur)
        cumul += d.montant_retenu
      }
    })
  })
  return lignes
}

/**
 * Total réellement dû, plafond appliqué. Une part validée (écart justifié)
 * ne se déduit pas.
 */
export function totalADeduire(deductions, plafond = PLAFOND_COMPTAGE) {
  return appliquerPlafond(deductions, plafond)
    .reduce((s, d) => s + (Number(d.montant_retenu) || 0), 0)
}

/** Total des écarts constatés, AVANT plafond — pour l'afficher à côté. */
export function totalReel(deductions) {
  return (deductions || [])
    .filter(d => d.statut !== 'validee')
    .reduce((s, d) => s + (Number(d.montant) || 0), 0)
}

// ── Base de données ──────────────────────────────────────────────────────

/** La colonne/table n'existe pas encore : la migration n'est pas passée. */
function migrationAbsente(error) {
  return /deductions_verification/i.test(error?.message || '')
}

/**
 * Enregistre les parts calculées.
 * @returns {'ok'|'migration'|'vide'|'erreur'}
 */
export async function enregistrerDeductions(lignes, contexte) {
  if (!lignes || lignes.length === 0) return 'vide'
  const rows = lignes.map(l => ({
    restaurant_id: contexte.restaurantId,
    date: contexte.date,
    lot_id: contexte.lotId || null,
    point_id: contexte.pointId || null,
    verificateur_id: contexte.verificateurId || null,
    verificateur_nom: contexte.verificateurNom || null,
    statut: 'en_attente',
    ...l,
  }))
  const { error } = await supabase.from('deductions_verification').insert(rows)
  if (!error) return 'ok'
  if (migrationAbsente(error)) {
    console.warn('[deductionsVerification] migration non passée :', error.message)
    return 'migration'
  }
  console.error('[deductionsVerification] insert', error)
  return 'erreur'
}

/** Déductions d'une journée, pour l'écran Vérification. */
export async function chargerDeductions(restaurantId, date) {
  if (!restaurantId || !date) return { lignes: [], migration: false }
  const { data, error } = await supabase
    .from('deductions_verification')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .eq('date', date)
    .order('created_at', { ascending: true })
  if (error) return { lignes: [], migration: migrationAbsente(error) }
  return { lignes: data || [], migration: false }
}

/**
 * Décision de l'administration sur une part.
 * `validee` = écart justifié, rien à déduire. `refusee` = déduction due.
 */
export async function deciderDeduction(id, statut, par) {
  const { error } = await supabase
    .from('deductions_verification')
    .update({
      statut,
      decide_par_id: par?.userId || null,
      decide_par_nom: par?.userNom || null,
      decide_at: new Date().toISOString(),
    })
    .eq('id', id)
  return !error
}
