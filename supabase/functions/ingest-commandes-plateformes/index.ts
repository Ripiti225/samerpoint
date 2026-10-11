// =====================================================================
//  Supabase Edge Function : ingest-commandes-plateformes
//
//  Reçoit les commandes Glovo/Yango lues par le bouton avis (relais
//  envoi-avis.html), les range dans commandes_plateformes, relit le POS cloud
//  et crée les litiges tapé −, tapé +, remboursement et temps d'attente dans
//  litiges_yango / litiges_glovo (calcul pur : lib/litigesPlateformes.js).
//  Conception : docs/superpowers/specs/2026-10-09-litiges-plateformes-auto-design.md
//
//  GET  (secret)            → { derniers: { glovo: { jour }|null, yango: … } }
//  POST { commandes } (secret) → range + calcule les journées complètes reçues
//  POST { recalculer: true }   → recalcule les journées « à relier » (sans
//                                secret : ne fait que relire ce qui est déjà là)
//  POST { recalculer: true, tout: true } → idem, journées déjà calculées comprises
//                                (après un changement de règle de calcul)
//
//  Secrets (projet Samtrackly) : INGEST_SECRET (comme ingest-reviews),
//  POS_URL, POS_CLE_SERVICE (comme import-contacts-pos).
//  Déploiement :
//    npx supabase functions deploy ingest-commandes-plateformes --no-verify-jwt --project-ref wlwotzxnzowbkbfcpnyi
// =====================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  comparerJourneesCroisees, retenuesJournee, planEcriture, normaliserNom, jourDe, RETENUES_FOURNIES,
} from '../../../lib/litigesPlateformes.js'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-ingest-secret, authorization, apikey',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
const pos = createClient(Deno.env.get('POS_URL')!, Deno.env.get('POS_CLE_SERVICE')!, { auth: { persistSession: false } })

type Plateforme = 'glovo' | 'yango'
const PLATEFORMES: Plateforme[] = ['glovo', 'yango']
const TABLE: Record<Plateforme, string> = { glovo: 'litiges_glovo', yango: 'litiges_yango' }
const JOUR_MS = 86400000
const aujourdhui = () => new Date().toISOString().slice(0, 10)
const decaler = (jour: string, n: number) => new Date(Date.parse(jour + 'T00:00:00Z') + n * JOUR_MS).toISOString().slice(0, 10)

// Supabase coupe à 1 000 lignes : lecture par pages (toujours avec un .order()).
async function toutes(fabrique: () => any) {
  const lignes: any[] = []
  for (let de = 0; ; de += 1000) {
    const { data, error } = await fabrique().range(de, de + 999)
    if (error) throw error
    lignes.push(...(data ?? []))
    if (!data || data.length < 1000) return lignes
  }
}

// commande_items n'a pas de clé étrangère sur le cloud POS : lecture à part.
async function plats(ids: string[]) {
  const lignes: any[] = []
  for (let i = 0; i < ids.length; i += 200) {
    lignes.push(...await toutes(() => pos.from('commande_items')
      .select('id, commande_id, nom_snapshot, quantite, prix_unitaire, annule_par')
      .in('commande_id', ids.slice(i, i + 200)).order('id')))
  }
  return lignes.filter(l => !l.annule_par)
}

const secretOk = (req: Request) => req.headers.get('x-ingest-secret') === Deno.env.get('INGEST_SECRET')

// ── Ingestion ──────────────────────────────────────────────────────────
async function ranger(commandes: any[]) {
  const { data: mapping, error } = await admin.from('review_store_mapping').select('platform, label_norm, restaurant_id')
  if (error) throw error
  const resto = new Map((mapping ?? []).map(m => [`${m.platform}|${m.label_norm}`, m.restaurant_id]))
  const normLabel = (s: string) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
  const lignes = commandes
    .filter(c => PLATEFORMES.includes(c?.plateforme) && c?.numero && c?.commande_le && !Number.isNaN(Date.parse(c.commande_le)))
    .map(c => ({
      plateforme: c.plateforme,
      numero: String(c.numero),
      boutique: c.boutique ?? null,
      restaurant_id: resto.get(`${c.plateforme}|${normLabel(c.boutique)}`) ?? null,
      commande_le: c.commande_le,
      jour: jourDe(c.commande_le),
      statut: ['livree', 'annulee'].includes(c.statut) ? c.statut : 'autre',
      montant_paye: c.montant_paye == null ? null : Math.round(Number(c.montant_paye) || 0),
      rembourse: Math.round(Number(c.rembourse) || 0),
      penalite_attente: Math.round(Number(c.penalite_attente) || 0),
      lignes: Array.isArray(c.lignes) ? c.lignes : [],
      recu_le: new Date().toISOString(),
    }))
  for (let i = 0; i < lignes.length; i += 500) {
    const { error: e } = await admin.from('commandes_plateformes').upsert(lignes.slice(i, i + 500), { onConflict: 'plateforme,numero' })
    if (e) throw e
  }
  // Seules les journées terminées sont calculées (aujourd'hui est incomplet).
  const journees = new Set(lignes.filter(l => l.restaurant_id && l.jour < aujourdhui()).map(l => `${l.restaurant_id}|${l.plateforme}|${l.jour}`))
  return { inserees: lignes.length, a_rattacher: lignes.filter(l => !l.restaurant_id).length, journees: [...journees].sort() }
}

// ── Lecture POS ────────────────────────────────────────────────────────
// Caches valables le temps d'un appel.
const cachePosId = new Map<string, string | null>()
const cachePrix = new Map<string, Record<string, number>>()

async function posIdDe(restaurantId: string) {
  if (!cachePosId.has(restaurantId)) {
    const { data } = await pos.from('restaurants').select('restaurant_id').eq('samtrackly_id', restaurantId).limit(1)
    cachePosId.set(restaurantId, data?.[0]?.restaurant_id ?? null)
  }
  return cachePosId.get(restaurantId)
}

// Dernier prix POS de chaque plat sur ce canal, sur les 30 jours avant le
// jour le plus récent à calculer (une seule lecture par restaurant × canal).
async function prixReference(posId: string, plateforme: Plateforme, jusqua: string) {
  const cle = `${posId}|${plateforme}`
  if (!cachePrix.has(cle)) {
    const cmds = await toutes(() => pos.from('commandes').select('id, created_at')
      .eq('restaurant_id', posId).eq('partenaire', plateforme.toUpperCase()).eq('statut', 'PAYEE')
      .gte('created_at', `${decaler(jusqua, -30)}T00:00:00Z`).lt('created_at', `${decaler(jusqua, 1)}T00:00:00Z`).order('id'))
    const quand = new Map(cmds.map(c => [c.id, c.created_at]))
    const prix: Record<string, number> = {}
    const lignes = (await plats(cmds.map(c => c.id)))
      .sort((a, b) => String(quand.get(a.commande_id)).localeCompare(String(quand.get(b.commande_id))))
    for (const l of lignes) if (l.prix_unitaire > 0) prix[normaliserNom(l.nom_snapshot)] = l.prix_unitaire
    cachePrix.set(cle, prix)
  }
  return cachePrix.get(cle)!
}

async function lirePos(restaurantId: string, plateforme: Plateforme, jour: string, dernierJour: string) {
  const vide = { posPresent: false, commandesPos: [] as any[], prixReference: {} as Record<string, number> }
  const posId = await posIdDe(restaurantId)
  if (!posId) return vide

  const debut = `${jour}T00:00:00Z`, fin = `${decaler(jour, 1)}T00:00:00Z`
  // Le POS a-t-il tourné ce jour-là ? Sinon pas de comparaison (faux tapé −).
  const { count } = await pos.from('commandes').select('id', { count: 'exact', head: true })
    .eq('restaurant_id', posId).gte('created_at', debut).lt('created_at', fin)
  if (!count) return vide

  const cmds = await toutes(() => pos.from('commandes')
    .select('id, numero_ticket, ref_partenaire, created_at, service_id')
    .eq('restaurant_id', posId).eq('partenaire', plateforme.toUpperCase()).eq('statut', 'PAYEE')
    .gte('created_at', debut).lt('created_at', fin).order('id'))
  const items = await plats(cmds.map(c => c.id))

  // Caissier : shift Samtrackly lié au service POS de la commande.
  const services = [...new Set(cmds.map(c => c.service_id).filter(Boolean))]
  const { data: shifts } = services.length
    ? await admin.from('points_shifts').select('pos_service_id, caissier_id, caissier_nom').in('pos_service_id', services)
    : { data: [] as any[] }
  const parService = new Map((shifts ?? []).map(s => [s.pos_service_id, s]))

  const commandesPos = cmds.map(c => ({
    id: c.id, numero_ticket: c.numero_ticket, ref_partenaire: c.ref_partenaire, created_at: c.created_at,
    caissier_id: parService.get(c.service_id)?.caissier_id ?? null,
    caissier_nom: parService.get(c.service_id)?.caissier_nom ?? null,
    items: items.filter(i => i.commande_id === c.id)
      .map(i => ({ nom: i.nom_snapshot, quantite: i.quantite, prix_unitaire: i.prix_unitaire })),
  }))

  // Noms POS vus, pour l'écran Correspondances (sans toucher à « ignorer »).
  const vus = [...new Map(items.map(i => [normaliserNom(i.nom_snapshot), i.nom_snapshot])).entries()]
    .filter(([nom_norm]) => nom_norm)
    .map(([nom_norm, nom]) => ({ nom_norm, nom, vu_le: new Date().toISOString() }))
  if (vus.length) await admin.from('plats_pos_vus').upsert(vus, { onConflict: 'nom_norm' })

  return { posPresent: true, commandesPos, prixReference: await prixReference(posId, plateforme, dernierJour) }
}

// ── Calcul et écriture d'une journée ───────────────────────────────────
// Yango et Glovo d'un même restaurant le même jour sont comparés ensemble : une
// commande Glovo tapée en Yango dans le POS (même numéro) est une erreur de
// saisie, pas un tapé + Yango et un tapé − Glovo.
async function lireJournee(restaurantId: string, plateforme: Plateforme, jour: string, dernierJour: string) {
  const [cmdsPf, corr, ignores, shifts, existants] = await Promise.all([
    toutes(() => admin.from('commandes_plateformes').select('*')
      .eq('restaurant_id', restaurantId).eq('plateforme', plateforme).eq('jour', jour).order('numero')),
    toutes(() => admin.from('correspondances_plats').select('nom_norm, nom_pos, ignorer').eq('plateforme', plateforme).order('nom_norm')),
    toutes(() => admin.from('plats_pos_vus').select('nom_norm').eq('ignorer', true).order('nom_norm')),
    toutes(() => admin.from('points_shifts').select('restaurant_id, date, caissier_id, caissier_nom, heure_debut, heure_fin')
      .eq('restaurant_id', restaurantId).in('date', [decaler(jour, -1), jour]).order('id')),
    toutes(() => admin.from(TABLE[plateforme]).select('id, type, origine, cle_auto, montant, responsable_id, responsable_nom, notes, numero_commande')
      .eq('restaurant_id', restaurantId).eq('date', jour).order('id')),
  ])
  const lecture = await lirePos(restaurantId, plateforme, jour, dernierJour)
  return {
    cmdsPf, shifts, existants,
    entree: {
      plateforme, restaurantId, jour, posPresent: lecture.posPresent,
      commandesPlateforme: cmdsPf, commandesPos: lecture.commandesPos,
      correspondances: new Map(corr.map(c => [c.nom_norm, c])),
      posIgnores: new Set(ignores.map(i => i.nom_norm)),
      prixReference: lecture.prixReference, shifts,
    },
  }
}

async function ecrireJournee(restaurantId: string, plateforme: Plateforme, jour: string, lu: any, resultat: any) {
  const { cmdsPf, shifts, existants } = lu
  const retenues = retenuesJournee({ plateforme, restaurantId, jour, commandesPlateforme: cmdsPf, shifts })
  const calcules = [...resultat.litiges, ...retenues]
  const typesCouverts = [...(resultat.statut === 'calculee' ? ['tape_moins', 'tape_plus'] : []), ...RETENUES_FOURNIES[plateforme]]

  const cles = calcules.map(l => l.cle_auto)
  const { data: annules } = cles.length
    ? await admin.from('litiges_auto_annules').select('cle_auto').in('cle_auto', cles)
    : { data: [] as any[] }
  const plan = planEcriture({ calcules, existants, annules: new Set((annules ?? []).map(a => a.cle_auto)), typesCouverts })

  const enLigne = (l: any) => ({
    restaurant_id: restaurantId, date: jour, type: l.type, montant: l.montant,
    responsable_id: l.responsable_id, responsable_nom: l.responsable_nom,
    numero_commande: l.numero_commande, notes: l.notes, detail: l.detail,
    origine: 'auto', cle_auto: l.cle_auto, created_by: 'Automatique',
  })
  if (plan.aSupprimer.length) {
    const { error } = await admin.from(TABLE[plateforme]).delete().in('id', plan.aSupprimer)
    if (error) throw error
  }
  for (const l of plan.aMettreAJour) {
    const { error } = await admin.from(TABLE[plateforme]).update({ ...enLigne(l), modified_at: new Date().toISOString() }).eq('id', l.id)
    if (error) throw error
  }
  if (plan.aInserer.length) {
    const { error } = await admin.from(TABLE[plateforme]).insert(plan.aInserer.map(enLigne))
    if (error) throw error
  }
  const { error } = await admin.from('journees_litiges_plateformes').upsert({
    restaurant_id: restaurantId, plateforme, jour, statut: resultat.statut,
    noms_inconnus: resultat.nomsInconnus, erreurs_saisie: resultat.erreursSaisie ?? [], calcule_le: new Date().toISOString(),
  }, { onConflict: 'restaurant_id,plateforme,jour' })
  if (error) throw error

  return { statut: resultat.statut, litiges: plan.aInserer.length + plan.aMettreAJour.length }
}

// Un restaurant, un jour : les plateformes demandées, plus l'autre si elle a des
// commandes ce jour-là (pour le croisement).
async function traiterRestoJour(restaurantId: string, jour: string, demandees: Set<Plateforme>, dernierJour: string) {
  const plateformes: Plateforme[] = []
  for (const p of PLATEFORMES) {
    if (demandees.has(p)) { plateformes.push(p); continue }
    const { count } = await admin.from('commandes_plateformes').select('numero', { count: 'exact', head: true })
      .eq('restaurant_id', restaurantId).eq('plateforme', p).eq('jour', jour)
    if (count) plateformes.push(p)
  }
  const lus: Record<string, any> = {}
  for (const p of plateformes) lus[p] = await lireJournee(restaurantId, p, jour, dernierJour)
  const resultats = comparerJourneesCroisees(Object.fromEntries(plateformes.map(p => [p, lus[p].entree])))
  const sorties = []
  for (const p of plateformes) sorties.push(await ecrireJournee(restaurantId, p, jour, lus[p], resultats[p]))
  return sorties
}

async function traiterJournees(cles: string[]) {
  let litiges = 0, a_relier = 0, journees = 0
  const dernierJour = cles.map(c => c.split('|')[2]).sort().pop() ?? aujourdhui()
  const parRestoJour = new Map<string, Set<Plateforme>>()
  for (const cle of cles) {
    const [restaurantId, plateforme, jour] = cle.split('|')
    const k = `${restaurantId}|${jour}`
    if (!parRestoJour.has(k)) parRestoJour.set(k, new Set())
    parRestoJour.get(k)!.add(plateforme as Plateforme)
  }
  for (const [k, demandees] of parRestoJour) {
    const [restaurantId, jour] = k.split('|')
    for (const r of await traiterRestoJour(restaurantId, jour, demandees, dernierJour)) {
      journees++
      litiges += r.litiges
      if (r.statut === 'a_relier') a_relier++
    }
  }
  return { journees, litiges, a_relier }
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    if (req.method === 'GET') {
      if (!secretOk(req)) return json({ erreur: 'secret' }, 401)
      const derniers: Record<string, { jour: string } | null> = {}
      for (const p of PLATEFORMES) {
        const { data } = await admin.from('commandes_plateformes').select('jour').eq('plateforme', p).order('jour', { ascending: false }).limit(1)
        derniers[p] = data?.[0] ? { jour: data[0].jour } : null
      }
      return json({ derniers })
    }
    const corps = await req.json().catch(() => ({}))
    if (corps?.recalculer) {
      const statuts = corps.tout ? ['a_relier', 'calculee'] : ['a_relier']
      const a = await toutes(() => admin.from('journees_litiges_plateformes').select('restaurant_id, plateforme, jour')
        .in('statut', statuts).order('jour').order('restaurant_id').order('plateforme'))
      return json({ ok: true, ...(await traiterJournees(a.map(j => `${j.restaurant_id}|${j.plateforme}|${j.jour}`))) })
    }
    if (!secretOk(req)) return json({ erreur: 'secret' }, 401)
    const commandes = Array.isArray(corps?.commandes) ? corps.commandes : []
    const rangees = await ranger(commandes)
    const r = await traiterJournees(rangees.journees)
    return json({ ok: true, recues: commandes.length, inserees: rangees.inserees, a_rattacher: rangees.a_rattacher, ...r })
  } catch (e) {
    console.error('ingest-commandes-plateformes', e)
    return json({ ok: false, erreur: String((e as Error)?.message ?? e) }, 500)
  }
})
