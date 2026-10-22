// ──────────────────────────────────────────────────────────────────────────────
// Litiges Yango / Glovo automatiques — calcul pur.
// docs/superpowers/specs/2026-10-09-litiges-plateformes-auto-design.md
//
// On compare, plat par plat et jour par jour (minuit → minuit, Abidjan = UTC),
// les ventes partenaires tapées dans le POS aux commandes vendues sur le
// portail. Plat en trop dans le POS → tapé + (repère la vente sur place
// déclarée Yango/Glovo) ; plat en moins → tapé −.
// La taille ne compte pas (« Pizza Bolognaise (M) » = « (G) ») : les portails
// ne la donnent jamais, un nom portail ne peut donc pas être relié à la bonne.
// Erreur de saisie : un plat en moins et un plat en trop sur LA MÊME commande
// (numéro, faute de frappe admise) = le caissier a tapé le mauvais plat
// (Tacos viande au lieu de Tacos poulet). Aucun litige, même à un autre prix :
// elle est seulement signalée (erreursSaisie). Décidé le 11/10/2026.
// Idem entre plateformes : une commande Glovo tapée en Yango (comparerJourneesCroisees).
// Utilisé par l'Edge Function ingest-commandes-plateformes.
// Pur : testé par lib/litigesPlateformes.test.mjs.
// ──────────────────────────────────────────────────────────────────────────────
import { caissierAuMoment } from './attributionAvis.js'

export const SEUIL_LITIGE = 1000

export function normaliserNom(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

// Taille entre parenthèses à la fin d'un nom POS : (M), (G), (Grande)…
const TAILLE = /\s*\((?:p|m|g|s|l|xl|petite?|moyenne?|grande?|small|medium|large)\)\s*$/i

/** « Pizza Bolognaise (G) » → « Pizza Bolognaise ». */
export function sansTaille(nom) {
  return String(nom ?? '').replace(TAILLE, '').trim()
}

/** Clé de comparaison d'un plat : nom normalisé, sans la taille. */
export function cleComparaison(nom) {
  return normaliserNom(sansTaille(nom))
}

/** « 101791205516 » → « 5516 » : ce que le caissier tape dans le POS. */
export function quatreChiffres(ref) {
  const chiffres = String(ref ?? '').replace(/\D/g, '')
  return chiffres.length >= 4 ? chiffres.slice(-4) : null
}

function distanceAuPlusUn(a, b) {
  if (a === b) return true
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1)
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1)
}

/**
 * La référence tapée dans le POS désigne-t-elle cette commande portail ?
 * Les 4 derniers chiffres (ce que tape le caissier), le numéro entier, ou l'un
 * des deux avec un chiffre en trop, en moins ou faux (« 1017969879414 » pour
 * « 101796987941 »). Moins de 4 chiffres tapés : non.
 */
export function memeCommande(numeroPlateforme, refPos) {
  const p = String(numeroPlateforme ?? '').replace(/\D/g, '')
  const r = String(refPos ?? '').replace(/\D/g, '')
  if (r.length < 4 || p.length < 4) return false
  if (p.endsWith(r) || r.includes(p)) return true
  return [r.length - 1, r.length, r.length + 1].some(n => n >= 4 && n <= p.length && distanceAuPlusUn(r, p.slice(-n)))
}

/**
 * Les commandes d'une plateforme pour ce jour ont-elles toutes été relues
 * après minuit ? Sinon il manque peut-être celles du soir : la journée n'est
 * pas recalculée avec (un clic Glovo recalculait Yango avec une lecture
 * Yango de la veille à 17h55 → faux tapé + à Yop le 19/10/2026).
 */
export function donneesCompletes(commandes, jour) {
  const fin = Date.parse(jour + 'T00:00:00Z') + 86400000
  return (commandes || []).length > 0 && commandes.every(c => (Date.parse(c.recu_le) || 0) >= fin)
}

/** Livrée, ou Yango annulée mais payée au restaurant. */
export function compteCommeVendue(c) {
  if (c.statut === 'livree') return true
  return c.statut === 'annulee' && c.plateforme === 'yango' && (Number(c.montant_paye) || 0) > 0
}

export const jourDe = iso => new Date(iso).toISOString().slice(0, 10)
export const heureDe = iso => new Date(iso).toISOString().slice(11, 16)

const mots = s => new Set(normaliserNom(s).split(' ').filter(Boolean))

/** Nom POS le plus proche (mots communs / mots en tout ≥ 0,5), sinon null. */
export function proposerCorrespondance(nomPlateforme, nomsPos) {
  const a = mots(nomPlateforme)
  let meilleur = null, score = 0
  for (const nom of nomsPos || []) {
    const b = mots(nom)
    const communs = [...a].filter(m => b.has(m)).length
    const s = communs / (new Set([...a, ...b]).size || 1)
    if (s > score) { score = s; meilleur = nom }
  }
  return score >= 0.5 ? meilleur : null
}

// Une entrée par unité vendue : 2 chawarmas → 2 entrées.
function empiler(m, cle, quantite, unite) {
  const q = Math.max(0, Math.round(Number(quantite) || 0))
  if (!m.has(cle)) m.set(cle, [])
  for (let i = 0; i < q; i++) m.get(cle).push(unite)
}

function cleResponsable(r) {
  if (r.id) return `id:${r.id}`
  const nom = String(r.nom || '').trim().toLowerCase()
  return nom ? `nom:${nom}` : 'personne'
}

// Prix POS du canal : moyenne des lignes POS du jour (toutes tailles), sinon prix
// de référence (dernier prix POS connu du plat relié, taille comprise), sinon prix plateforme.
function prixPlat(unitesPos, prixReference, unitesPf) {
  const prixPos = unitesPos.map(u => Number(u.prix) || 0).filter(p => p > 0)
  if (prixPos.length) return Math.round(prixPos.reduce((s, p) => s + p, 0) / prixPos.length)
  const ref = unitesPf.map(u => Number(prixReference?.[u.cleRef]) || 0).find(p => p > 0) || 0
  if (ref > 0) return Math.round(ref)
  const prixPf = unitesPf.map(u => Number(u.prix) || 0).filter(p => p > 0)
  return prixPf.length ? Math.round(prixPf[0]) : 0
}

// Écarts d'une journée restaurant × plateforme : unités en trop (POS) et en
// moins (portail), plat par plat, les plus suspectes d'abord.
function ecartsJournee(e) {
  if (!e.posPresent) return { statut: 'pos_manquant', nomsInconnus: [] }

  const vendues = (e.commandesPlateforme || []).filter(compteCommeVendue)
  const inconnus = new Set()
  const cotePf = new Map()
  for (const c of vendues) {
    for (const l of c.lignes || []) {
      const corr = e.correspondances?.get(normaliserNom(l.nom))
      if (!corr) { inconnus.add(l.nom); continue }
      if (corr.ignorer || !corr.nom_pos) continue
      empiler(cotePf, cleComparaison(corr.nom_pos), l.quantite, {
        commande: c, libelle: sansTaille(corr.nom_pos), prix: l.prix_unitaire, cleRef: normaliserNom(corr.nom_pos),
      })
    }
  }
  if (inconnus.size) return { statut: 'a_relier', nomsInconnus: [...inconnus].sort() }

  const cotePos = new Map()
  for (const c of e.commandesPos || []) {
    for (const it of c.items || []) {
      if (e.posIgnores?.has(normaliserNom(it.nom))) continue
      empiler(cotePos, cleComparaison(it.nom), it.quantite, { commande: c, libelle: it.nom, prix: it.prix_unitaire })
    }
  }

  const refsPf = new Set(vendues.map(c => quatreChiffres(c.numero)).filter(Boolean))
  const refsPos = new Set((e.commandesPos || []).map(c => quatreChiffres(c.ref_partenaire)).filter(Boolean))
  const temps = iso => Date.parse(iso) || 0
  const chiffres = s => String(s ?? '').replace(/\D/g, '')

  const enTrop = [], enMoins = []
  for (const cle of new Set([...cotePf.keys(), ...cotePos.keys()])) {
    const uPf = cotePf.get(cle) || [], uPos = cotePos.get(cle) || []
    const ecart = uPos.length - uPf.length
    if (ecart === 0) continue
    const prix = prixPlat(uPos, e.prixReference, uPf)
    // Ce plat, sur cette commande précise : plus d'un côté que de l'autre ?
    // Sans ça, le plat en moins tombait sur une commande bien tapée et l'erreur
    // de saisie de la vraie commande n'était plus reconnue (Palmeraie, 19/10/2026).
    if (ecart > 0) {
      const enExces = u => {
        const ref = chiffres(u.commande.ref_partenaire)
        if (ref.length < 4) return true
        const nPos = uPos.filter(x => chiffres(x.commande.ref_partenaire) === ref).length
        return nPos > uPf.filter(x => memeCommande(x.commande.numero, ref)).length
      }
      // Les plus suspectes d'abord : en excès sur leur commande, n° absent chez la plateforme, puis les plus tardives.
      const suspect = u => (enExces(u) ? 0 : 2) + (refsPf.has(quatreChiffres(u.commande.ref_partenaire)) ? 1 : 0)
      const tri = [...uPos].sort((a, b) => suspect(a) - suspect(b) || temps(b.commande.created_at) - temps(a.commande.created_at))
      for (const u of tri.slice(0, ecart)) enTrop.push({ u, prix, cle })
    } else {
      const manque = u => uPf.filter(x => x.commande.numero === u.commande.numero).length
        > uPos.filter(x => memeCommande(u.commande.numero, x.commande.ref_partenaire)).length
      // Les plus probablement oubliées d'abord : manquantes sur leur commande, n° absent du POS, puis les plus anciennes.
      const oubliee = u => (manque(u) ? 0 : 2) + (refsPos.has(quatreChiffres(u.commande.numero)) ? 1 : 0)
      const tri = [...uPf].sort((a, b) => oubliee(a) - oubliee(b) || temps(a.commande.commande_le) - temps(b.commande.commande_le))
      for (const u of tri.slice(0, -ecart)) enMoins.push({ u, prix, cle })
    }
  }
  return { statut: 'calculee', nomsInconnus: [], enTrop, enMoins, apparies: new Set(), erreursSaisie: [] }
}

// Rapproche les plats en moins de `moins` des plats en trop de `trop` tapés sur
// la même commande (même plat d'abord, puis n'importe lequel) : erreurs de saisie.
// canal : plateforme sur laquelle le caissier l'a tapée, si ce n'est pas la bonne.
function apparier(moins, trop, canal = null) {
  for (const memePlat of [true, false]) {
    for (const m of moins.enMoins) {
      if (moins.apparies.has(m)) continue
      const t = trop.enTrop.find(x => !trop.apparies.has(x) && (!memePlat || x.cle === m.cle)
        && memeCommande(m.u.commande.numero, x.u.commande.ref_partenaire))
      if (!t) continue
      trop.apparies.add(t)
      moins.apparies.add(m)
      moins.erreursSaisie.push({
        commande: m.u.commande.numero, heure: heureDe(m.u.commande.commande_le),
        vendu: m.u.libelle, prix_vendu: m.prix, tape: t.u.libelle, prix_tape: Number(t.u.prix) || t.prix,
        caissier_id: t.u.commande.caissier_id || null, caissier_nom: t.u.commande.caissier_nom || null,
        ...(canal ? { tape_en: canal } : {}),
      })
    }
  }
}

// Litiges de ce qui reste après les rapprochements.
function litigesDesEcarts(e, ec) {
  const seuil = e.seuil ?? SEUIL_LITIGE
  const groupes = new Map()
  const ajouter = (type, resp, prix, ligne) => {
    const cle = `${e.plateforme}|${e.restaurantId}|${e.jour}|${type}|${cleResponsable(resp)}`
    if (!groupes.has(cle)) {
      groupes.set(cle, { type, montant: 0, responsable_id: resp.id || null, responsable_nom: resp.nom || null, cle_auto: cle, lignes: [] })
    }
    const g = groupes.get(cle)
    g.montant += prix
    g.lignes.push({ ...ligne, prix })
  }

  for (const t of ec.enTrop) {
    if (ec.apparies.has(t)) continue
    const { u, prix } = t
    ajouter('tape_plus', { id: u.commande.caissier_id, nom: u.commande.caissier_nom }, prix, {
      plat: u.libelle, commande: u.commande.ref_partenaire || `ticket ${u.commande.numero_ticket}`, heure: heureDe(u.commande.created_at),
    })
  }
  for (const m of ec.enMoins) {
    if (ec.apparies.has(m)) continue
    const { u, prix } = m
    const heure = heureDe(u.commande.commande_le)
    const r = caissierAuMoment(e.shifts, { restaurantId: e.restaurantId, date: e.jour, heure })
    ajouter('tape_moins', { id: r.caissier_id, nom: r.caissier_nom }, prix, { plat: u.libelle, commande: u.commande.numero, heure })
  }

  const parType = {}
  for (const g of groupes.values()) parType[g.type] = (parType[g.type] || 0) + g.montant
  return [...groupes.values()]
    .filter(g => parType[g.type] >= seuil)
    .map(g => ({
      type: g.type,
      montant: Math.round(g.montant),
      responsable_id: g.responsable_id,
      responsable_nom: g.responsable_nom,
      cle_auto: g.cle_auto,
      numero_commande: [...new Set(g.lignes.map(l => l.commande))].join(', ') || null,
      notes: resumePlats(g.lignes),
      detail: { lignes: g.lignes },
    }))
}

const resultat = (e, ec) => (ec.statut !== 'calculee'
  ? { statut: ec.statut, nomsInconnus: ec.nomsInconnus, litiges: [], erreursSaisie: [] }
  : { statut: 'calculee', nomsInconnus: [], litiges: litigesDesEcarts(e, ec), erreursSaisie: ec.erreursSaisie })

/** Compare une journée restaurant × plateforme. Voir l'interface dans le plan. */
export function comparerJournee(e) {
  const ec = ecartsJournee(e)
  if (ec.statut === 'calculee') apparier(ec, ec)
  return resultat(e, ec)
}

/**
 * Compare les journées Yango et Glovo d'un même restaurant le même jour, ensemble :
 * une commande Glovo tapée en Yango dans le POS (ou l'inverse) donne un plat en
 * trop d'un côté et en moins de l'autre, sur le même numéro de commande. C'est
 * une erreur de saisie, pas deux litiges (décidé le 11/10/2026) ; elle est notée
 * sur la plateforme où la commande a vraiment été passée (tape_en = l'autre).
 * entrees : { [plateforme]: entrée de comparerJournee } (une seule possible).
 * → { [plateforme]: résultat de comparerJournee }
 */
export function comparerJourneesCroisees(entrees) {
  const ecarts = Object.fromEntries(Object.entries(entrees).map(([p, e]) => [p, ecartsJournee(e)]))
  const calculees = Object.keys(ecarts).filter(p => ecarts[p].statut === 'calculee')
  for (const p of calculees) apparier(ecarts[p], ecarts[p])
  for (const vendue of calculees) {
    for (const tapee of calculees) if (tapee !== vendue) apparier(ecarts[vendue], ecarts[tapee], tapee)
  }
  return Object.fromEntries(Object.keys(entrees).map(p => [p, resultat(entrees[p], ecarts[p])]))
}

/** « 2 × Chawarma poulet, 1 × Coca » */
function resumePlats(lignes) {
  const n = new Map()
  for (const l of lignes) n.set(l.plat, (n.get(l.plat) || 0) + 1)
  return [...n].map(([plat, q]) => `${q} × ${plat}`).join(', ')
}

// Retenues que chaque portail donne (repérage du 09/10, tâche 0). Un type
// absent ici n'est jamais calculé, donc jamais remplacé : la saisie manuelle
// reste la seule source pour lui.
export const RETENUES_FOURNIES = {
  glovo: ['remboursement', 'temps_attente'],
  yango: [], // Litiges → Yango n'a que tapé + / tapé − (repérage du 09/10)
}

const CHAMP_RETENUE = { remboursement: 'rembourse', temps_attente: 'penalite_attente' }

/** Un litige par commande et par retenue, au caissier présent à l'heure de la commande. */
export function retenuesJournee({ plateforme, restaurantId, jour, commandesPlateforme, shifts }) {
  const litiges = []
  for (const type of RETENUES_FOURNIES[plateforme] || []) {
    for (const c of commandesPlateforme || []) {
      const montant = Math.round(Number(c[CHAMP_RETENUE[type]]) || 0)
      if (montant <= 0) continue
      const heure = heureDe(c.commande_le)
      const r = caissierAuMoment(shifts, { restaurantId, date: jour, heure })
      litiges.push({
        type, montant,
        responsable_id: r.caissier_id || null,
        responsable_nom: r.caissier_nom || null,
        cle_auto: `${plateforme}|${restaurantId}|${jour}|${type}|${c.numero}`,
        numero_commande: c.numero,
        notes: type === 'remboursement' ? `Remboursé par ${plateforme === 'glovo' ? 'Glovo' : 'Yango'} (commande de ${heure})` : `Pénalité d'attente (commande de ${heure})`,
        detail: { lignes: [{ commande: c.numero, heure, prix: montant }] },
      })
    }
  }
  return litiges
}

const CHAMPS_COMPARES = ['montant', 'responsable_id', 'responsable_nom', 'notes', 'numero_commande']

/**
 * Ce qu'il faut écrire pour un restaurant × plateforme × jour.
 * existants : toutes les lignes litiges_<plateforme> de ce restaurant ce jour-là.
 * typesCouverts : types que l'auto a calculés ce jour-là (il remplace la main).
 * typesAuto : types que l'auto peut produire ; une ligne auto de ces types qui
 * n'est plus calculée part, même si la journée est redevenue « à relier »
 * (sinon un tapé ± calculé sur des données incomplètes restait, Yop 19/10/2026).
 * Un responsable choisi à la main (detail.responsable_manuel, posé par l'écran
 * Litiges : cuisinier, gérant…) est gardé tel quel au recalcul.
 */
export function planEcriture({ calcules, existants, annules, typesCouverts, typesAuto = typesCouverts }) {
  const couverts = new Set(typesCouverts)
  const auto = new Set([...typesAuto, ...typesCouverts])
  const voulus = (calcules || []).filter(l => !annules?.has(l.cle_auto))
  const parCle = new Map((existants || []).filter(x => x.origine === 'auto' && x.cle_auto).map(x => [x.cle_auto, x]))
  const aInserer = [], aMettreAJour = []
  for (const calcule of voulus) {
    const x = parCle.get(calcule.cle_auto)
    if (!x) { aInserer.push(calcule); continue }
    const l = x.detail?.responsable_manuel
      ? { ...calcule, responsable_id: x.responsable_id ?? null, responsable_nom: x.responsable_nom ?? null, detail: { ...calcule.detail, responsable_manuel: true } }
      : calcule
    if (CHAMPS_COMPARES.some(k => (x[k] ?? null) !== (l[k] ?? null))) aMettreAJour.push({ ...l, id: x.id })
  }
  const clesVoulues = new Set(voulus.map(l => l.cle_auto))
  const aSupprimer = (existants || [])
    .filter(x => (x.origine === 'auto' ? auto.has(x.type) && !clesVoulues.has(x.cle_auto) : couverts.has(x.type)))
    .map(x => x.id)
  return { aInserer, aMettreAJour, aSupprimer }
}
