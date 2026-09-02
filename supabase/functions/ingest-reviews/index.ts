// Supabase Edge Function : ingest-reviews
//
// Ingestion quotidienne des avis clients Yango (étoiles 1-5) et Glovo
// (pouce 👍/👎), extraits par Cowork + Chrome (voir docs/AVIS_PLATEFORMES.md).
//
// Routage par méthode :
//   GET  → { done_today: bool }   le créneau de retry appelle ça d'abord et
//                                 s'arrête si l'extraction du jour a réussi.
//   POST → { reviews: [...], finalize?: bool }
//          ingère, dédoublonne, crée un litige par NOUVEL avis négatif ;
//          si finalize, écrit la ligne ingest_runs du jour.
//
// Authentification : en-tête `x-ingest-secret` (secret INGEST_SECRET).
// Seule cette fonction écrit dans platform_reviews : elle utilise la clé
// service_role, aucune politique d'écriture n'existe pour la clé anon.
//
// Déploiement :
//   supabase secrets set INGEST_SECRET="<64 caractères aléatoires>"
//   supabase functions deploy ingest-reviews --no-verify-jwt
//
// Variables d'env fournies automatiquement par Supabase :
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Variable optionnelle : LITIGE_MONTANT_MAUVAIS (défaut 1000 FCFA)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-ingest-secret',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

const PLATEFORMES = ['yango', 'glovo']
const LOT = 500                       // taille des lots d'insertion
const SEUIL_NEGATIF = 3               // note < 3/5 → avis négatif

// Montant du litige créé pour un avis négatif. Doit rester aligné sur
// TYPES_AVIS.mauvais dans app/litiges.js (1000 FCFA à la charge du resto).
const MONTANT_MAUVAIS = Number(Deno.env.get('LITIGE_MONTANT_MAUVAIS') ?? 1000)

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

async function sha256(s: string) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')
}

// Date du jour à Abidjan (UTC+0 toute l'année) — identique à toISOString.
const aujourdhui = () => new Date().toISOString().slice(0, 10)

const texte = (v: unknown) => {
  const s = typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim()
  return s === '' ? null : s
}

const nombre = (v: unknown) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// Une date valide AAAA-MM-JJ, sinon null (la colonne accepte NULL).
const dateIso = (v: unknown) => {
  const s = texte(v)
  if (!s) return null
  return /^\d{4}-\d{2}-\d{2}$/.test(s.slice(0, 10)) ? s.slice(0, 10) : null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const secret = Deno.env.get('INGEST_SECRET')
  if (!secret || req.headers.get('x-ingest-secret') !== secret) {
    return json({ error: 'Secret d’ingestion invalide' }, 401)
  }

  try {
    // ── STATUT : l'extraction du jour a-t-elle déjà réussi ? ──────────
    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('ingest_runs')
        .select('run_date, finished_at')
        .eq('run_date', aujourdhui())
        .eq('status', 'ok')
        .maybeSingle()
      if (error) throw error
      return json({ done_today: !!data, finished_at: data?.finished_at ?? null })
    }

    if (req.method !== 'POST') return json({ error: 'Méthode non supportée' }, 405)

    // ── INGESTION ────────────────────────────────────────────────────
    const body = await req.json().catch(() => null)
    const reviews = body?.reviews
    if (!Array.isArray(reviews)) return json({ error: 'Payload invalide : « reviews » attendu' }, 400)

    // Correspondances boutique plateforme → restaurant
    const { data: mappings, error: errMap } = await supabase
      .from('review_store_mapping')
      .select('platform, external_store_label, restaurant_id')
    if (errMap) throw errMap
    const cle = (p: string, l: string) => `${p}::${l}`
    const map = new Map((mappings ?? []).map((m) => [cle(m.platform, m.external_store_label), m.restaurant_id]))

    const rows: Record<string, unknown>[] = []
    const vus = new Set<string>()
    const labels_non_mappes = new Set<string>()
    let unmapped = 0
    let rejetes = 0

    for (const r of reviews) {
      const platform = texte(r?.platform)?.toLowerCase() ?? ''
      if (!PLATEFORMES.includes(platform)) { rejetes++; continue }

      const label = texte(r?.external_store_label)
      const external_ref = texte(r?.external_ref)
      const rating_raw = nombre(r?.rating_raw)
      const rating_scale = nombre(r?.rating_scale) || 5
      const comment = texte(r?.comment)
      const review_date = dateIso(r?.review_date)

      // Dédoublonnage prioritaire sur le n° de commande ; repli sur le contenu
      // quand la plateforme ne l'affiche pas.
      const dedup_hash = external_ref
        ? await sha256(`${platform}|${external_ref}`)
        : await sha256([platform, label ?? '', review_date ?? '', rating_raw ?? '', comment ?? ''].join('|'))

      // Deux fois le même avis dans le même envoi : on n'en garde qu'un
      // (l'INSERT accepterait, mais les compteurs seraient faux).
      if (vus.has(dedup_hash)) continue
      vus.add(dedup_hash)

      const restaurant_id = map.get(cle(platform, label ?? '')) ?? null
      if (!restaurant_id) {
        unmapped++
        if (label) labels_non_mappes.add(`${platform} · ${label}`)
      }

      // Classification : celle fournie si valide, sinon déduite de la note
      // (Glovo n'a pas de note → la classification est obligatoire côté extraction).
      let classification = texte(r?.classification)
      if (classification !== 'bon' && classification !== 'negatif') {
        const note = rating_raw != null ? (rating_raw / rating_scale) * 5 : 5
        classification = note < SEUIL_NEGATIF ? 'negatif' : 'bon'
      }

      rows.push({
        platform,
        restaurant_id,
        external_store_label: label,
        external_ref,
        rating_raw,
        rating_scale,
        classification,
        comment,
        author: texte(r?.author),
        review_date,
        dedup_hash,
        raw: r ?? null,
      })
    }

    // Insertion par lots ; ON CONFLICT DO NOTHING sur dedup_hash → seuls les
    // avis réellement nouveaux ressortent, donc seuls eux créent un litige.
    const inseres: { id: string; classification: string; restaurant_id: string | null; comment: string | null; review_date: string | null; platform: string; external_ref: string | null }[] = []
    for (let i = 0; i < rows.length; i += LOT) {
      const { data, error } = await supabase
        .from('platform_reviews')
        .upsert(rows.slice(i, i + LOT), { onConflict: 'dedup_hash', ignoreDuplicates: true })
        .select('id, classification, restaurant_id, comment, review_date, platform, external_ref')
      if (error) throw error
      inseres.push(...(data ?? []))
    }

    // ── Litiges pour les NOUVEAUX avis négatifs ──────────────────────
    // Table réelle : litiges_avis_clients (type 'mauvais' = 1000 FCFA à la
    // charge du restaurant, canal = plateforme). Les avis non rattachés à un
    // restaurant sont laissés de côté : leur litige est créé au rattachement
    // (fonction SQL rattacher_avis).
    const negatifs = inseres.filter((x) => x.classification === 'negatif' && x.restaurant_id)
    let litiges_crees = 0
    for (let i = 0; i < negatifs.length; i += LOT) {
      const lot = negatifs.slice(i, i + LOT).map((x) => ({
        restaurant_id: x.restaurant_id,
        date: x.review_date ?? aujourdhui(),
        numero_commande: x.external_ref,
        notes: x.comment || 'Avis négatif sans commentaire',
        type: 'mauvais',
        montant: MONTANT_MAUVAIS,
        canal: x.platform,
        source: 'avis_plateforme',
        review_id: x.id,
        created_by: 'Avis plateforme',
      }))
      const { data, error } = await supabase
        .from('litiges_avis_clients')
        .upsert(lot, { onConflict: 'review_id', ignoreDuplicates: true })
        .select('id')
      if (error) throw error
      litiges_crees += data?.length ?? 0
    }

    const resume = {
      received: reviews.length,
      inserted: inseres.length,
      duplicates: Math.max(0, vus.size - inseres.length),
      rejected: rejetes,
      unmapped,
      litiges_crees,
      labels_a_rattacher: [...labels_non_mappes],
    }

    // Marque la journée comme réussie : les créneaux suivants passeront leur tour.
    if (body?.finalize) {
      const { error } = await supabase.from('ingest_runs').upsert({
        run_date: aujourdhui(),
        status: 'ok',
        received: resume.received,
        inserted: resume.inserted,
        duplicates: resume.duplicates,
        unmapped: resume.unmapped,
        litiges_crees: resume.litiges_crees,
        finished_at: new Date().toISOString(),
      }, { onConflict: 'run_date' })
      if (error) throw error
    }

    return json(resume)
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500)
  }
})

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  })
}
