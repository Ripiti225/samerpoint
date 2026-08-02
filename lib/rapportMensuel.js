// ─────────────────────────────────────────────────────────────────────────
//  RAPPORT MENSUEL — agrégation de toutes les données d'un mois
//
//  Alimente l'onglet « Mensuel » de app/rapports.js et les exports
//  PowerPoint / Excel / PDF de lib/exportRapportMensuel.js.
//
//  ⚠️ PIÈGE À TRONCATURE : Supabase plafonne toute requête à 1000 lignes,
//  SANS erreur. Sur un mois × 7 restaurants on dépasse largement (≈3500
//  présences, ≈2500 dépenses, ≈8000 lignes d'inventaire). Toute lecture
//  passe donc par fetchPagine() / fetchParIds(), jamais par un select nu.
//
//  ⚠️ RATTACHEMENT AU MOIS : `depenses` n'a ni date ni restaurant_id, et
//  `transactions_fournisseurs.date_point` est toujours NULL en base tandis
//  que son `restaurant_id` n'est renseigné qu'en partie. Le seul lien fiable
//  est `point_id` → `points`. On charge donc d'abord les points du mois,
//  puis on rapatrie leurs enfants par lots d'ids.
// ─────────────────────────────────────────────────────────────────────────

import { supabase } from './supabase'
import { COEFFICIENTS, CATEGORIES_DEPENSES } from './constants'

const TAILLE_PAGE = 1000
const MAX_PAGES = 60          // garde-fou : 60 000 lignes par table et par mois
const LOT_IDS = 60            // ids par requête `.in()` — garde les URLs courtes

const MOIS_FR = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre']

// ─── Dates ───────────────────────────────────────────────────────────────

/** '2026-07' → 'Juillet 2026' */
export function libelleMois(mois) {
  const [a, m] = String(mois).split('-')
  return `${MOIS_FR[Number(m) - 1] || m} ${a}`
}

/** '2026-07' → { debut: '2026-07-01', fin: '2026-07-31' } */
export function bornesMois(mois) {
  const [a, m] = String(mois).split('-').map(Number)
  const dernierJour = new Date(Date.UTC(a, m, 0)).getUTCDate()
  const mm = String(m).padStart(2, '0')
  return { debut: `${a}-${mm}-01`, fin: `${a}-${mm}-${dernierJour}`, nbJours: dernierJour }
}

/** Mois précédent : '2026-07' → '2026-06' */
export function moisPrecedent(mois) {
  const [a, m] = String(mois).split('-').map(Number)
  const d = new Date(Date.UTC(a, m - 2, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** Le mois en cours n'est pas clos : on ne le propose jamais à l'export. */
function moisEnCours() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// ─── Lecture paginée ─────────────────────────────────────────────────────

/**
 * Déroule une requête page par page jusqu'à épuisement.
 * `construire` doit RE-créer la requête à chaque appel : un query builder
 * Supabase n'est pas réutilisable après exécution.
 */
async function fetchPagine(construire, colonneTri = 'id') {
  const lignes = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const debut = page * TAILLE_PAGE
    const { data, error } = await construire()
      .order(colonneTri, { ascending: true })
      .range(debut, debut + TAILLE_PAGE - 1)
    if (error) throw error
    const lot = data || []
    lignes.push(...lot)
    if (lot.length < TAILLE_PAGE) break
  }
  return lignes
}

/** Même chose, mais filtré sur une liste d'ids découpée en lots. */
async function fetchParIds(table, colonnes, colonneId, ids, colonneTri = 'id') {
  const uniques = [...new Set((ids || []).filter(Boolean))]
  if (uniques.length === 0) return []
  const lignes = []
  for (let i = 0; i < uniques.length; i += LOT_IDS) {
    const lot = uniques.slice(i, i + LOT_IDS)
    const partiel = await fetchPagine(
      () => supabase.from(table).select(colonnes).in(colonneId, lot),
      colonneTri,
    )
    lignes.push(...partiel)
  }
  return lignes
}

// ─── Utilitaires ─────────────────────────────────────────────────────────

const n = v => {
  const x = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(x) ? x : 0
}
const arrondi = v => Math.round(n(v))

/** Ajoute un montant à une clé d'un dictionnaire de totaux. */
function ajouter(dict, cle, montant) {
  if (!cle) cle = 'Non attribué'
  dict[cle] = n(dict[cle]) + n(montant)
}

// ─── Mois disponibles ────────────────────────────────────────────────────

/**
 * Liste les mois CLOS pour lesquels il existe au moins un point.
 * Le mois en cours est volontairement exclu : un rapport partiel qui
 * circule est pire que pas de rapport.
 */
export async function listerMoisDisponibles() {
  const points = await fetchPagine(
    () => supabase.from('points').select('date'),
    'date',
  )
  const encours = moisEnCours()
  const mois = new Set()
  points.forEach(p => {
    if (!p.date) return
    const m = String(p.date).slice(0, 7)
    if (m < encours) mois.add(m)
  })
  return [...mois].sort((a, b) => b.localeCompare(a))
    .map(m => ({ mois: m, label: libelleMois(m), ...bornesMois(m) }))
}

/**
 * Résumé léger de chaque mois clos, en une seule lecture des points.
 * Sert à peupler la liste de l'écran Rapports sans payer les ~20 s d'une
 * agrégation complète par mois — celle-ci n'est faite qu'à l'export.
 */
export async function listerMoisAvecTotaux() {
  const points = await fetchPagine(
    () => supabase.from('points')
      .select('date, restaurant_id, valide, vente_total, depense_total, benefice_sc'),
    'date',
  )
  const encours = moisEnCours()
  const parMois = {}
  points.forEach(p => {
    if (!p.date) return
    const m = String(p.date).slice(0, 7)
    if (m >= encours) return
    if (!parMois[m]) {
      parMois[m] = { ca: 0, benefice: 0, depenses: 0, nbPoints: 0, nbValides: 0, restos: new Set() }
    }
    const e = parMois[m]
    e.ca += n(p.vente_total)
    e.benefice += n(p.benefice_sc)
    e.depenses += n(p.depense_total)
    e.nbPoints += 1
    if (p.valide) e.nbValides += 1
    if (p.restaurant_id) e.restos.add(p.restaurant_id)
  })
  return Object.keys(parMois).sort((a, b) => b.localeCompare(a)).map(m => ({
    mois: m,
    label: libelleMois(m),
    ...bornesMois(m),
    ca: arrondi(parMois[m].ca),
    benefice: arrondi(parMois[m].benefice),
    depenses: arrondi(parMois[m].depenses),
    nbPoints: parMois[m].nbPoints,
    nbValides: parMois[m].nbValides,
    nbRestaurants: parMois[m].restos.size,
  }))
}

// ─── Chargement brut d'un mois ───────────────────────────────────────────

/**
 * Restaurants + objectif mensuel. La colonne `objectif_mensuel` vient de
 * supabase_rapport_mensuel.sql : tant que la migration n'est pas passée,
 * PostgREST rejette le select. On retombe alors sur les colonnes de base
 * plutôt que de faire échouer tout le rapport.
 */
async function chargerRestaurants() {
  try {
    return await fetchPagine(() => supabase.from('restaurants')
      .select('id, nom, localisation, couleur, objectif_mensuel'), 'nom')
  } catch (e) {
    console.warn('[rapportMensuel] objectif_mensuel absent (migration non passée) :', e.message)
    return await fetchPagine(() => supabase.from('restaurants')
      .select('id, nom, localisation, couleur'), 'nom')
  }
}

async function chargerBrut(mois) {
  const { debut, fin } = bornesMois(mois)

  const [restaurants, points, presences, shifts, charges, invShifts,
    litYango, litGlovo, litAvis, litResp, fournisseursRef, travailleurs, deverrouillages] =
    await Promise.all([
      chargerRestaurants(),

      fetchPagine(() => supabase.from('points').select(
        'id, restaurant_id, date, valide, vente_total, depense_total, benefice_sc, ' +
        'montant_inventaire, ecart_caisse, ajustement_fond, kdo, retour, ' +
        'yango_cse, yango_tab, glovo_cse, glovo_tab, wave, om, djamo, ' +
        'yango_nb_commandes, glovo_nb_commandes, vente_machine, ' +
        'fond_recu, reste_especes, depenses_gerant_caisse_total, ' +
        'contact_litige_calcule, contact_litige_override',
      ).gte('date', debut).lte('date', fin), 'date'),

      fetchPagine(() => supabase.from('presences')
        .select('id, restaurant_id, date, statut, paye, travailleur_id, travailleur_nom')
        .gte('date', debut).lte('date', fin), 'date'),

      fetchPagine(() => supabase.from('points_shifts')
        .select('id, restaurant_id, date, caissier_id, caissier_nom, type_shift, vente_shift, espece, valide')
        .gte('date', debut).lte('date', fin), 'date'),

      fetchPagine(() => supabase.from('charges')
        .select('id, restaurant_id, mois, libelle, montant').eq('mois', mois), 'id'),

      fetchPagine(() => supabase.from('inventaires_shifts')
        .select('id, restaurant_id, point_id, date, type_shift, valide, montant_a_deduire')
        .gte('date', debut).lte('date', fin), 'date'),

      fetchPagine(() => supabase.from('litiges_yango')
        .select('id, restaurant_id, date, type, montant, responsable_nom, numero_commande')
        .gte('date', debut).lte('date', fin), 'date'),

      fetchPagine(() => supabase.from('litiges_glovo')
        .select('id, restaurant_id, date, type, montant, responsable_nom, numero_commande')
        .gte('date', debut).lte('date', fin), 'date'),

      fetchPagine(() => supabase.from('litiges_avis_clients')
        .select('id, restaurant_id, date, type, montant, responsable_nom, canal, statut')
        .gte('date', debut).lte('date', fin), 'date'),

      fetchPagine(() => supabase.from('litiges_responsables')
        .select('id, restaurant_id, date, type, montant, responsable_nom, role')
        .gte('date', debut).lte('date', fin), 'date'),

      fetchPagine(() => supabase.from('fournisseurs')
        .select('id, nom, restaurant_id, credit_actuel'), 'nom'),

      fetchPagine(() => supabase.from('travailleurs').select(
        'id, nom, poste, type_contrat, restaurant_id, actif, statut, ' +
        'created_at, date_embauche, archived_at, archive_motif, salaire_journalier',
      ), 'nom'),

      fetchPagine(() => supabase.from('deverouillages_points')
        .select('id, restaurant_id, point_id, section, statut, deverouille_at')
        .gte('deverouille_at', `${debut}T00:00:00`).lte('deverouille_at', `${fin}T23:59:59`),
      'deverouille_at'),
    ])

  // Enfants rattachés aux points du mois (pas de date propre en base).
  const pointIds = points.map(p => p.id)
  const invIds = invShifts.map(i => i.id)

  const [depenses, transactions, depGerant, invLignes] = await Promise.all([
    fetchParIds('depenses',
      'id, point_id, categorie, libelle, montant, caissier_nom', 'point_id', pointIds),
    fetchParIds('transactions_fournisseurs',
      'id, point_id, fournisseur_id, fournisseur_nom, facture, paye, credit, reste',
      'point_id', pointIds),
    fetchParIds('depenses_gerant_caisse',
      'id, point_id, categorie, description, montant', 'point_id', pointIds),
    fetchParIds('inventaire_lignes',
      'id, inventaire_id, produit_nom, ecart, montant_deduit, montant_deduit_annule, ' +
      'deduction_annulee, explication_statut, quantite_acceptee',
      'inventaire_id', invIds),
  ])

  // `transactions_fournisseurs.fournisseur_nom` est vide sur une grosse part
  // des lignes : sans ce repli par id, ~60 % des achats atterrissent dans un
  // « Fournisseur inconnu » qui rend le classement inexploitable.
  const nomsFournisseurs = {}
  fournisseursRef.forEach(f => { if (f.id) nomsFournisseurs[f.id] = (f.nom || '').trim() })
  transactions.forEach(t => {
    const nom = (t.fournisseur_nom || '').trim() || nomsFournisseurs[t.fournisseur_id] || ''
    t.fournisseur_nom = nom || 'Fournisseur non identifié'
  })

  return {
    restaurants, points, presences, shifts, charges, invShifts, invLignes,
    litYango, litGlovo, litAvis, litResp, travailleurs, deverrouillages,
    depenses, transactions, depGerant, fournisseursRef,
  }
}

// ─── Calculs ─────────────────────────────────────────────────────────────

/** Ventilation des livraisons : les coefficients ne portent que sur le TAB. */
function calculerLivraisons(points) {
  const l = {
    yango: { cse: 0, tab: 0, net: 0, commission: 0, nbCmd: 0 },
    glovo: { cse: 0, tab: 0, net: 0, commission: 0, nbCmd: 0 },
    om: { brut: 0, net: 0, commission: 0 },
    wave: { brut: 0, net: 0, commission: 0 },
    djamo: { brut: 0, net: 0, commission: 0 },
  }
  points.forEach(p => {
    l.yango.cse += n(p.yango_cse); l.yango.tab += n(p.yango_tab)
    l.yango.nbCmd += n(p.yango_nb_commandes)
    l.glovo.cse += n(p.glovo_cse); l.glovo.tab += n(p.glovo_tab)
    l.glovo.nbCmd += n(p.glovo_nb_commandes)
    l.om.brut += n(p.om); l.wave.brut += n(p.wave); l.djamo.brut += n(p.djamo)
  })
  l.yango.net = l.yango.cse + l.yango.tab * COEFFICIENTS.YANGO
  l.yango.commission = l.yango.tab * (1 - COEFFICIENTS.YANGO)
  l.glovo.net = l.glovo.cse + l.glovo.tab * COEFFICIENTS.GLOVO
  l.glovo.commission = l.glovo.tab * (1 - COEFFICIENTS.GLOVO)
  ;['om', 'wave', 'djamo'].forEach(k => {
    const coef = COEFFICIENTS[k.toUpperCase()]
    l[k].net = l[k].brut * coef
    l[k].commission = l[k].brut * (1 - coef)
  })
  l.totalBrut = l.yango.cse + l.yango.tab + l.glovo.cse + l.glovo.tab
    + l.om.brut + l.wave.brut + l.djamo.brut
  l.totalNet = l.yango.net + l.glovo.net + l.om.net + l.wave.net + l.djamo.net
  l.totalCommission = l.totalBrut - l.totalNet
  l.nbCmd = l.yango.nbCmd + l.glovo.nbCmd
  return l
}

/** Litiges consolidés : par type, par responsable, et total. */
function calculerLitiges({ litYango, litGlovo, litAvis, litResp }, filtreResto) {
  const garde = r => !filtreResto || r.restaurant_id === filtreResto
  const sources = [
    ['Yango', litYango.filter(garde)],
    ['Glovo', litGlovo.filter(garde)],
    ['Avis clients', litAvis.filter(garde)],
    ['Écarts responsables', litResp.filter(garde)],
  ]
  const parType = {}
  const parResponsable = {}
  const nbParType = {}
  let total = 0
  sources.forEach(([nom, lignes]) => {
    lignes.forEach(l => {
      const m = n(l.montant)
      ajouter(parType, nom, m)
      nbParType[nom] = n(nbParType[nom]) + 1
      const resp = (l.responsable_nom || '').trim() || 'Non attribué'
      if (!parResponsable[resp]) parResponsable[resp] = { montant: 0, nb: 0 }
      parResponsable[resp].montant += m
      parResponsable[resp].nb += 1
      total += m
    })
  })
  return {
    total: arrondi(total),
    parType: Object.entries(parType)
      .map(([type, montant]) => ({ type, montant: arrondi(montant), nb: nbParType[type] || 0 }))
      .sort((a, b) => b.montant - a.montant),
    parResponsable: Object.entries(parResponsable)
      .map(([nom, v]) => ({ nom, montant: arrondi(v.montant), nb: v.nb }))
      .sort((a, b) => b.montant - a.montant),
  }
}

/** Top produits en écart d'inventaire, en quantité et en valeur. */
function calculerInventaire(invShifts, invLignes, filtreResto) {
  const shiftsGardes = filtreResto
    ? invShifts.filter(s => s.restaurant_id === filtreResto)
    : invShifts
  const idsGardes = new Set(shiftsGardes.map(s => s.id))
  const lignes = invLignes.filter(l => idsGardes.has(l.inventaire_id))

  const parProduit = {}
  let totalDeduit = 0
  let totalAnnule = 0
  lignes.forEach(l => {
    const nom = l.produit_nom || 'Produit inconnu'
    if (!parProduit[nom]) parProduit[nom] = { produit: nom, quantite: 0, montant: 0, nb: 0 }
    // Les écarts positifs (surplus) ne sont pas des pertes : on suit la valeur
    // effectivement déduite, qui est la seule qui coûte de l'argent.
    const deduit = l.deduction_annulee ? 0 : n(l.montant_deduit)
    parProduit[nom].quantite += n(l.ecart)
    parProduit[nom].montant += deduit
    if (deduit !== 0 || n(l.ecart) !== 0) parProduit[nom].nb += 1
    totalDeduit += deduit
    if (l.deduction_annulee) totalAnnule += n(l.montant_deduit_annule)
  })

  const decisions = { validees: 0, refusees: 0, sansDecision: 0 }
  lignes.forEach(l => {
    if (l.explication_statut === 'validee') decisions.validees += 1
    else if (l.explication_statut === 'refusee') decisions.refusees += 1
    else if (n(l.ecart) !== 0) decisions.sansDecision += 1
  })

  return {
    totalDeduit: arrondi(totalDeduit),
    totalAnnule: arrondi(totalAnnule),
    nbShifts: shiftsGardes.length,
    decisions,
    topProduits: Object.values(parProduit)
      .filter(p => p.montant !== 0 || p.quantite !== 0)
      .sort((a, b) => Math.abs(b.montant) - Math.abs(a.montant))
      .slice(0, 10)
      .map(p => ({ ...p, quantite: Math.round(p.quantite * 100) / 100, montant: arrondi(p.montant) })),
  }
}

/** Écarts de caisse cumulés par caissier. */
function calculerEcartsCaissiers(points, shifts, filtreResto) {
  const pts = filtreResto ? points.filter(p => p.restaurant_id === filtreResto) : points
  const shf = filtreResto ? shifts.filter(s => s.restaurant_id === filtreResto) : shifts

  // L'écart de caisse est porté par le point (journée), pas par le shift.
  // On rattache chaque point à ses caissiers du jour pour les nommer.
  const parPoint = {}
  shf.forEach(s => {
    const cle = `${s.restaurant_id}|${s.date}`
    if (!parPoint[cle]) parPoint[cle] = []
    if (s.caissier_nom) parPoint[cle].push(s.caissier_nom)
  })

  // On amorce avec TOUS les caissiers ayant travaillé : sinon un caissier
  // dont aucune journée n'a d'écart n'apparaît pas du tout dans le tableau.
  const parCaissier = {}
  shf.forEach(s => {
    if (!s.caissier_nom) return
    if (!parCaissier[s.caissier_nom]) {
      parCaissier[s.caissier_nom] = { nom: s.caissier_nom, total: 0, nbShifts: 0, nbJoursEcart: 0 }
    }
    parCaissier[s.caissier_nom].nbShifts += 1
  })

  pts.forEach(p => {
    const ecart = n(p.ecart_caisse)
    const noms = [...new Set(parPoint[`${p.restaurant_id}|${p.date}`] || [])]
    if (noms.length === 0) return
    // Journée à plusieurs caissiers : l'écart n'est pas imputable à un seul,
    // on le répartit à parts égales plutôt que de l'attribuer arbitrairement.
    const part = ecart / noms.length
    noms.forEach(nom => {
      if (!parCaissier[nom]) parCaissier[nom] = { nom, total: 0, nbShifts: 0, nbJoursEcart: 0 }
      parCaissier[nom].total += part
      if (ecart !== 0) parCaissier[nom].nbJoursEcart += 1
    })
  })

  return Object.values(parCaissier)
    .map(c => ({ ...c, total: arrondi(c.total) }))
    .sort((a, b) => a.total - b.total)     // les plus gros manquants d'abord
}

/** Effectif, arrivées, départs et masse salariale. */
function calculerRh(travailleurs, presences, mois, filtreResto) {
  const { debut, fin } = bornesMois(mois)
  const trav = filtreResto ? travailleurs.filter(t => t.restaurant_id === filtreResto) : travailleurs
  const pres = filtreResto ? presences.filter(p => p.restaurant_id === filtreResto) : presences

  const dateArrivee = t => (t.date_embauche || t.created_at || '').slice(0, 10)
  const dateDepart = t => (t.archived_at || '').slice(0, 10)

  const arrivees = trav
    .filter(t => { const d = dateArrivee(t); return d >= debut && d <= fin })
    .map(t => ({ nom: t.nom, poste: t.poste || '—', date: dateArrivee(t), restaurant_id: t.restaurant_id }))
    .sort((a, b) => a.date.localeCompare(b.date))

  const departs = trav
    .filter(t => { const d = dateDepart(t); return d && d >= debut && d <= fin })
    .map(t => ({ nom: t.nom, poste: t.poste || '—', date: dateDepart(t),
      motif: t.archive_motif || '—', restaurant_id: t.restaurant_id }))
    .sort((a, b) => a.date.localeCompare(b.date))

  // Effectif à une date : entré avant, pas encore parti.
  const effectifA = borne => trav.filter(t => {
    const arr = dateArrivee(t)
    const dep = dateDepart(t)
    return (!arr || arr <= borne) && (!dep || dep > borne)
  }).length

  const statuts = {}
  let masseSalariale = 0
  pres.forEach(p => {
    const s = p.statut || 'Inconnu'
    statuts[s] = n(statuts[s]) + 1
    masseSalariale += n(p.paye)
  })
  const nbPresences = pres.length
  const nbPresents = pres.filter(p => p.statut && p.statut !== 'Absent').length

  return {
    effectifDebut: effectifA(debut),
    effectifFin: effectifA(fin),
    arrivees,
    departs,
    masseSalariale: arrondi(masseSalariale),
    nbLignesPresence: nbPresences,
    tauxPresence: nbPresences ? Math.round((nbPresents / nbPresences) * 1000) / 10 : null,
    statuts: Object.entries(statuts).map(([statut, nb]) => ({ statut, nb }))
      .sort((a, b) => b.nb - a.nb),
  }
}

/** Jours du mois sans point validé, restaurant par restaurant. */
function calculerJoursManquants(points, restaurants, mois) {
  const { debut, nbJours } = bornesMois(mois)
  const prefixe = debut.slice(0, 7)
  const valides = new Set(points.filter(p => p.valide).map(p => `${p.restaurant_id}|${p.date}`))
  const aujourdhui = new Date().toISOString().slice(0, 10)

  return restaurants.map(r => {
    const dates = []
    for (let j = 1; j <= nbJours; j++) {
      const d = `${prefixe}-${String(j).padStart(2, '0')}`
      if (d > aujourdhui) break
      if (!valides.has(`${r.id}|${d}`)) dates.push(d)
    }
    return { id: r.id, nom: r.nom, dates, nbValides: nbJours - dates.length, nbJours }
  }).filter(r => r.dates.length > 0)
}

/** Bloc de totaux commun au global et à chaque restaurant. */
function calculerBloc(brut, mois, filtreResto) {
  const { points, depenses, transactions, depGerant, charges, shifts } = brut
  const pts = filtreResto ? points.filter(p => p.restaurant_id === filtreResto) : points
  const idsPts = new Set(pts.map(p => p.id))
  const dep = depenses.filter(d => idsPts.has(d.point_id))
  const tx = transactions.filter(t => idsPts.has(t.point_id))
  const depG = depGerant.filter(d => idsPts.has(d.point_id))
  const chg = filtreResto ? charges.filter(c => c.restaurant_id === filtreResto) : charges
  const shf = filtreResto ? shifts.filter(s => s.restaurant_id === filtreResto) : shifts

  const totaux = { ca: 0, depenses: 0, benefice: 0, inventaire: 0, kdo: 0, retour: 0,
    ecartCaisse: 0, ajustementFond: 0, venteMachine: 0, contactLitige: 0 }
  pts.forEach(p => {
    totaux.ca += n(p.vente_total)
    totaux.depenses += n(p.depense_total)
    totaux.benefice += n(p.benefice_sc)
    totaux.inventaire += n(p.montant_inventaire)
    totaux.kdo += n(p.kdo)
    totaux.retour += n(p.retour)
    totaux.ecartCaisse += n(p.ecart_caisse)
    totaux.ajustementFond += n(p.ajustement_fond)
    totaux.venteMachine += n(p.vente_machine)
    totaux.contactLitige += n(p.contact_litige_override ?? p.contact_litige_calcule)
  })

  const parCategorie = {}
  CATEGORIES_DEPENSES.forEach(c => { parCategorie[c] = 0 })
  dep.forEach(d => ajouter(parCategorie, d.categorie || 'Non catégorisé', d.montant))

  const fournisseurs = { facture: 0, paye: 0, credit: 0, nb: tx.length }
  const parFournisseur = {}
  tx.forEach(t => {
    fournisseurs.facture += n(t.facture)
    fournisseurs.paye += n(t.paye)
    fournisseurs.credit += n(t.credit)
    const nom = t.fournisseur_nom || 'Fournisseur inconnu'
    if (!parFournisseur[nom]) parFournisseur[nom] = { nom, facture: 0, paye: 0, credit: 0, nb: 0 }
    parFournisseur[nom].facture += n(t.facture)
    parFournisseur[nom].paye += n(t.paye)
    parFournisseur[nom].credit += n(t.credit)
    parFournisseur[nom].nb += 1
  })

  const totalCharges = chg.reduce((s, c) => s + n(c.montant), 0)
  const depensesGerant = depG.reduce((s, d) => s + n(d.montant), 0)

  return {
    ca: arrondi(totaux.ca),
    depenses: arrondi(totaux.depenses),
    benefice: arrondi(totaux.benefice),
    charges: arrondi(totalCharges),
    beneficeNet: arrondi(totaux.benefice - totalCharges),
    marge: totaux.ca ? Math.round((totaux.benefice / totaux.ca) * 1000) / 10 : null,
    inventaire: arrondi(totaux.inventaire),
    kdo: arrondi(totaux.kdo),
    retour: arrondi(totaux.retour),
    ecartCaisse: arrondi(totaux.ecartCaisse),
    ajustementFond: arrondi(totaux.ajustementFond),
    venteMachine: arrondi(totaux.venteMachine),
    contactLitige: arrondi(totaux.contactLitige),
    depensesGerantCaisse: arrondi(depensesGerant),
    nbPoints: pts.length,
    nbPointsValides: pts.filter(p => p.valide).length,
    nbShifts: shf.length,
    caMoyenJour: pts.length ? arrondi(totaux.ca / pts.length) : 0,
    depensesParCategorie: Object.entries(parCategorie)
      .map(([categorie, montant]) => ({ categorie, montant: arrondi(montant) }))
      .filter(c => c.montant !== 0)
      .sort((a, b) => b.montant - a.montant),
    fournisseurs: {
      facture: arrondi(fournisseurs.facture),
      paye: arrondi(fournisseurs.paye),
      credit: arrondi(fournisseurs.credit),
      nb: fournisseurs.nb,
      top: Object.values(parFournisseur)
        .map(f => ({ ...f, facture: arrondi(f.facture), paye: arrondi(f.paye), credit: arrondi(f.credit) }))
        .sort((a, b) => b.facture - a.facture)
        .slice(0, 10),
    },
    detailCharges: chg.map(c => ({ libelle: c.libelle || '—', montant: arrondi(c.montant) }))
      .sort((a, b) => b.montant - a.montant),
    livraisons: calculerLivraisons(pts),
    litiges: calculerLitiges(brut, filtreResto),
    inventaireDetail: calculerInventaire(brut.invShifts, brut.invLignes, filtreResto),
    ecartsCaissiers: calculerEcartsCaissiers(points, shifts, filtreResto),
    rh: calculerRh(brut.travailleurs, brut.presences, mois, filtreResto),
  }
}

/** CA jour par jour, pour la courbe. */
function calculerSerieJournaliere(points, mois, filtreResto) {
  const { debut, nbJours } = bornesMois(mois)
  const prefixe = debut.slice(0, 7)
  const pts = filtreResto ? points.filter(p => p.restaurant_id === filtreResto) : points
  const parJour = {}
  pts.forEach(p => { parJour[p.date] = n(parJour[p.date]) + n(p.vente_total) })
  const serie = []
  for (let j = 1; j <= nbJours; j++) {
    const d = `${prefixe}-${String(j).padStart(2, '0')}`
    serie.push({ date: d, jour: j, ca: arrondi(parJour[d] || 0) })
  }
  return serie
}

// ─── Point d'entrée ──────────────────────────────────────────────────────

/**
 * Charge et agrège tout un mois.
 * `onProgres(texte)` est optionnel — l'écran s'en sert pour afficher l'étape.
 */
export async function chargerRapportMensuel(mois, onProgres) {
  const dire = t => { if (typeof onProgres === 'function') onProgres(t) }

  dire('Lecture des données du mois…')
  const brut = await chargerBrut(mois)

  dire('Lecture du mois précédent…')
  const precedent = moisPrecedent(mois)
  let blocPrecedent = null
  try {
    const brutPrec = await chargerBrut(precedent)
    if (brutPrec.points.length > 0) {
      blocPrecedent = { mois: precedent, label: libelleMois(precedent), ...calculerBloc(brutPrec, precedent, null) }
    }
  } catch (e) {
    // Le comparatif est un confort : son échec ne doit pas couler le rapport.
    console.warn('[rapportMensuel] mois précédent indisponible :', e.message)
  }

  dire('Consolidation…')
  const global = calculerBloc(brut, mois, null)
  const restosAvecPoints = brut.restaurants.filter(r =>
    brut.points.some(p => p.restaurant_id === r.id))

  const restaurants = restosAvecPoints.map(r => {
    const bloc = calculerBloc(brut, mois, r.id)
    const objectif = n(r.objectif_mensuel) || null
    return {
      id: r.id,
      nom: (r.nom || '').trim(),
      localisation: (r.localisation || '').trim(),
      couleur: r.couleur,
      objectif,
      tauxObjectif: objectif ? Math.round((bloc.ca / objectif) * 1000) / 10 : null,
      serieJournaliere: calculerSerieJournaliere(brut.points, mois, r.id),
      ...bloc,
    }
  }).sort((a, b) => b.ca - a.ca)

  const objectifGlobal = restosAvecPoints.reduce((s, r) => s + n(r.objectif_mensuel), 0) || null

  return {
    mois,
    label: libelleMois(mois),
    ...bornesMois(mois),
    genereLe: new Date().toISOString(),
    global: {
      ...global,
      objectif: objectifGlobal,
      tauxObjectif: objectifGlobal ? Math.round((global.ca / objectifGlobal) * 1000) / 10 : null,
      serieJournaliere: calculerSerieJournaliere(brut.points, mois, null),
      joursManquants: calculerJoursManquants(brut.points, restosAvecPoints, mois),
      nbRestaurants: restosAvecPoints.length,
      nbDeverrouillages: brut.deverrouillages.length,
    },
    precedent: blocPrecedent,
    restaurants,
    lignes: construireLignes(brut, mois),
  }
}

/**
 * Lignes brutes du mois, aplaties et enrichies (nom du restaurant, date).
 * Le PowerPoint reste agrégé ; c'est l'export Excel qui porte ce détail.
 */
function construireLignes(brut, mois) {
  const { points, restaurants, depenses, transactions, presences, shifts,
    charges, invShifts, invLignes, litYango, litGlovo, litAvis, litResp,
    travailleurs, depGerant } = brut

  const nomResto = {}
  restaurants.forEach(r => { nomResto[r.id] = (r.nom || '').trim() })
  const parPoint = {}
  points.forEach(p => { parPoint[p.id] = p })
  const parInvShift = {}
  invShifts.forEach(s => { parInvShift[s.id] = s })

  const ctx = pointId => {
    const p = parPoint[pointId]
    return { restaurant: p ? nomResto[p.restaurant_id] || '—' : '—', date: p ? p.date : '—' }
  }

  const { debut, fin } = bornesMois(mois)
  const dansLeMois = d => d && d >= debut && d <= fin

  return {
    points: points.map(p => ({
      Date: p.date, Restaurant: nomResto[p.restaurant_id] || '—',
      'Vente totale': arrondi(p.vente_total), 'Dépenses': arrondi(p.depense_total),
      'Bénéfice SC': arrondi(p.benefice_sc), 'Inventaire': arrondi(p.montant_inventaire),
      'Écart caisse': arrondi(p.ecart_caisse), 'Ajustement fond': arrondi(p.ajustement_fond),
      'Vente machine': arrondi(p.vente_machine), Kdo: arrondi(p.kdo), Retour: arrondi(p.retour),
      'Yango espèces': arrondi(p.yango_cse), 'Yango tablette': arrondi(p.yango_tab),
      'Glovo espèces': arrondi(p.glovo_cse), 'Glovo tablette': arrondi(p.glovo_tab),
      Wave: arrondi(p.wave), 'Orange Money': arrondi(p.om), Djamo: arrondi(p.djamo),
      'Cmd Yango': arrondi(p.yango_nb_commandes), 'Cmd Glovo': arrondi(p.glovo_nb_commandes),
      Validé: p.valide ? 'Oui' : 'Non',
    })),

    depenses: depenses.map(d => {
      const c = ctx(d.point_id)
      return { Date: c.date, Restaurant: c.restaurant, Catégorie: d.categorie || '—',
        Libellé: d.libelle || '—', Montant: arrondi(d.montant), Caissier: d.caissier_nom || '—' }
    }).sort((a, b) => String(a.Date).localeCompare(String(b.Date))),

    depensesGerant: depGerant.map(d => {
      const c = ctx(d.point_id)
      return { Date: c.date, Restaurant: c.restaurant, Catégorie: d.categorie || '—',
        Description: d.description || '—', Montant: arrondi(d.montant) }
    }).sort((a, b) => String(a.Date).localeCompare(String(b.Date))),

    fournisseurs: transactions.map(t => {
      const c = ctx(t.point_id)
      return { Date: c.date, Restaurant: c.restaurant, Fournisseur: t.fournisseur_nom || '—',
        Facture: arrondi(t.facture), Payé: arrondi(t.paye),
        Crédit: arrondi(t.credit), Reste: arrondi(t.reste) }
    }).sort((a, b) => String(a.Date).localeCompare(String(b.Date))),

    presences: presences.map(p => ({
      Date: p.date, Restaurant: nomResto[p.restaurant_id] || '—',
      Travailleur: p.travailleur_nom || '—', Statut: p.statut || '—', Payé: arrondi(p.paye),
    })).sort((a, b) => String(a.Date).localeCompare(String(b.Date))),

    shifts: shifts.map(s => ({
      Date: s.date, Restaurant: nomResto[s.restaurant_id] || '—',
      Caissier: s.caissier_nom || '—', Type: s.type_shift || '—',
      'Vente shift': arrondi(s.vente_shift), Espèces: arrondi(s.espece),
      Validé: s.valide ? 'Oui' : 'Non',
    })).sort((a, b) => String(a.Date).localeCompare(String(b.Date))),

    inventaire: invLignes.map(l => {
      const s = parInvShift[l.inventaire_id]
      return {
        Date: s ? s.date : '—', Restaurant: s ? nomResto[s.restaurant_id] || '—' : '—',
        Shift: s ? s.type_shift || '—' : '—', Produit: l.produit_nom || '—',
        Écart: n(l.ecart), 'Montant déduit': arrondi(l.deduction_annulee ? 0 : l.montant_deduit),
        Décision: l.explication_statut || 'Sans décision',
        Annulée: l.deduction_annulee ? 'Oui' : 'Non',
      }
    }).filter(l => l.Écart !== 0 || l['Montant déduit'] !== 0)
      .sort((a, b) => String(a.Date).localeCompare(String(b.Date))),

    litiges: [
      ...litYango.map(l => ({ ...l, Source: 'Yango' })),
      ...litGlovo.map(l => ({ ...l, Source: 'Glovo' })),
      ...litAvis.map(l => ({ ...l, Source: 'Avis clients' })),
      ...litResp.map(l => ({ ...l, Source: 'Écarts responsables' })),
    ].map(l => ({
      Date: l.date, Restaurant: nomResto[l.restaurant_id] || '—', Source: l.Source,
      Type: l.type || '—', Montant: arrondi(l.montant),
      Responsable: (l.responsable_nom || '').trim() || 'Non attribué',
      Commande: l.numero_commande || '—',
    })).sort((a, b) => String(a.Date).localeCompare(String(b.Date))),

    charges: charges.map(c => ({
      Mois: c.mois, Restaurant: nomResto[c.restaurant_id] || 'Toutes enseignes',
      Libellé: c.libelle || '—', Montant: arrondi(c.montant),
    })),

    mouvementsRh: [
      ...travailleurs.filter(t => dansLeMois((t.date_embauche || t.created_at || '').slice(0, 10)))
        .map(t => ({ Date: (t.date_embauche || t.created_at || '').slice(0, 10),
          Mouvement: 'Arrivée', Travailleur: t.nom, Poste: t.poste || '—',
          Restaurant: nomResto[t.restaurant_id] || '—', Motif: '—',
          Contrat: t.type_contrat || '—' })),
      ...travailleurs.filter(t => dansLeMois((t.archived_at || '').slice(0, 10)))
        .map(t => ({ Date: (t.archived_at || '').slice(0, 10),
          Mouvement: 'Départ', Travailleur: t.nom, Poste: t.poste || '—',
          Restaurant: nomResto[t.restaurant_id] || '—', Motif: t.archive_motif || '—',
          Contrat: t.type_contrat || '—' })),
    ].sort((a, b) => String(a.Date).localeCompare(String(b.Date))),
  }
}

/** Variation en % entre deux valeurs, ou null si non calculable. */
export function variation(actuel, precedent) {
  if (precedent == null || precedent === 0) return null
  return Math.round(((n(actuel) - n(precedent)) / Math.abs(n(precedent))) * 1000) / 10
}
