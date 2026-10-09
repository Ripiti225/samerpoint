// ──────────────────────────────────────────────────────────────────────────────
// Litiges Yango / Glovo automatiques — calcul pur.
// docs/superpowers/specs/2026-10-09-litiges-plateformes-auto-design.md
//
// On compare, plat par plat et jour par jour (minuit → minuit, Abidjan = UTC),
// les ventes partenaires tapées dans le POS aux commandes vendues sur le
// portail. Plat en trop dans le POS → tapé + (repère la vente sur place
// déclarée Yango/Glovo) ; plat en moins → tapé −.
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

/** « 101791205516 » → « 5516 » : ce que le caissier tape dans le POS. */
export function quatreChiffres(ref) {
  const chiffres = String(ref ?? '').replace(/\D/g, '')
  return chiffres.length >= 4 ? chiffres.slice(-4) : null
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

// Prix POS du canal : moyenne des lignes POS du jour, sinon prix de référence
// (dernier prix POS connu), sinon prix plateforme.
function prixPlat(cle, unitesPos, prixReference, unitesPf) {
  const prixPos = unitesPos.map(u => Number(u.prix) || 0).filter(p => p > 0)
  if (prixPos.length) return Math.round(prixPos.reduce((s, p) => s + p, 0) / prixPos.length)
  const ref = Number(prixReference?.[cle]) || 0
  if (ref > 0) return Math.round(ref)
  const prixPf = unitesPf.map(u => Number(u.prix) || 0).filter(p => p > 0)
  return prixPf.length ? Math.round(prixPf[0]) : 0
}

/** Compare une journée restaurant × plateforme. Voir l'interface dans le plan. */
export function comparerJournee(e) {
  const seuil = e.seuil ?? SEUIL_LITIGE
  if (!e.posPresent) return { statut: 'pos_manquant', nomsInconnus: [], litiges: [] }

  const vendues = (e.commandesPlateforme || []).filter(compteCommeVendue)
  const inconnus = new Set()
  const cotePf = new Map()
  for (const c of vendues) {
    for (const l of c.lignes || []) {
      const corr = e.correspondances?.get(normaliserNom(l.nom))
      if (!corr) { inconnus.add(l.nom); continue }
      if (corr.ignorer || !corr.nom_pos) continue
      empiler(cotePf, normaliserNom(corr.nom_pos), l.quantite, { commande: c, libelle: corr.nom_pos, prix: l.prix_unitaire })
    }
  }
  if (inconnus.size) return { statut: 'a_relier', nomsInconnus: [...inconnus].sort(), litiges: [] }

  const cotePos = new Map()
  for (const c of e.commandesPos || []) {
    for (const it of c.items || []) {
      const cle = normaliserNom(it.nom)
      if (e.posIgnores?.has(cle)) continue
      empiler(cotePos, cle, it.quantite, { commande: c, libelle: it.nom, prix: it.prix_unitaire })
    }
  }

  const refsPf = new Set(vendues.map(c => quatreChiffres(c.numero)).filter(Boolean))
  const refsPos = new Set((e.commandesPos || []).map(c => quatreChiffres(c.ref_partenaire)).filter(Boolean))
  const temps = iso => Date.parse(iso) || 0

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

  for (const cle of new Set([...cotePf.keys(), ...cotePos.keys()])) {
    const uPf = cotePf.get(cle) || [], uPos = cotePos.get(cle) || []
    const ecart = uPos.length - uPf.length
    if (ecart === 0) continue
    const prix = prixPlat(cle, uPos, e.prixReference, uPf)
    if (ecart > 0) {
      // Les plus suspectes d'abord : n° absent chez la plateforme, puis les plus tardives.
      const suspect = u => (refsPf.has(quatreChiffres(u.commande.ref_partenaire)) ? 1 : 0)
      const tri = [...uPos].sort((a, b) => suspect(a) - suspect(b) || temps(b.commande.created_at) - temps(a.commande.created_at))
      for (const u of tri.slice(0, ecart)) {
        ajouter('tape_plus', { id: u.commande.caissier_id, nom: u.commande.caissier_nom }, prix, {
          plat: u.libelle, commande: u.commande.ref_partenaire || `ticket ${u.commande.numero_ticket}`, heure: heureDe(u.commande.created_at),
        })
      }
    } else {
      // Les plus probablement oubliées d'abord : n° absent du POS, puis les plus anciennes.
      const oubliee = u => (refsPos.has(quatreChiffres(u.commande.numero)) ? 1 : 0)
      const tri = [...uPf].sort((a, b) => oubliee(a) - oubliee(b) || temps(a.commande.commande_le) - temps(b.commande.commande_le))
      for (const u of tri.slice(0, -ecart)) {
        const heure = heureDe(u.commande.commande_le)
        const r = caissierAuMoment(e.shifts, { restaurantId: e.restaurantId, date: e.jour, heure })
        ajouter('tape_moins', { id: r.caissier_id, nom: r.caissier_nom }, prix, { plat: u.libelle, commande: u.commande.numero, heure })
      }
    }
  }

  const parType = {}
  for (const g of groupes.values()) parType[g.type] = (parType[g.type] || 0) + g.montant
  const litiges = [...groupes.values()]
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
  return { statut: 'calculee', nomsInconnus: [], litiges }
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
 */
export function planEcriture({ calcules, existants, annules, typesCouverts }) {
  const couverts = new Set(typesCouverts)
  const voulus = (calcules || []).filter(l => !annules?.has(l.cle_auto))
  const parCle = new Map((existants || []).filter(x => x.origine === 'auto' && x.cle_auto).map(x => [x.cle_auto, x]))
  const aInserer = [], aMettreAJour = []
  for (const l of voulus) {
    const x = parCle.get(l.cle_auto)
    if (!x) { aInserer.push(l); continue }
    if (CHAMPS_COMPARES.some(k => (x[k] ?? null) !== (l[k] ?? null))) aMettreAJour.push({ ...l, id: x.id })
  }
  const clesVoulues = new Set(voulus.map(l => l.cle_auto))
  const aSupprimer = (existants || [])
    .filter(x => couverts.has(x.type))
    .filter(x => (x.origine === 'auto' ? !clesVoulues.has(x.cle_auto) : true))
    .map(x => x.id)
  return { aInserer, aMettreAJour, aSupprimer }
}
