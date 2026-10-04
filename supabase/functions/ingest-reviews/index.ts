// Supabase Edge Function : ingest-reviews
//
// Ingestion quotidienne des avis clients Yango (étoiles 1-5) et Glovo
// (pouce 👍/👎), extraits par Cowork + Chrome (voir docs/AVIS_PLATEFORMES.md).
//
// Routage par méthode :
//   GET  → { done_today, finished_at, derniers }   `derniers` donne, par
//          plateforme, le dernier review_date et le dernier ingested_at
//          (période relue par le bouton avis, rappel côté app).
//   POST → { reviews: [...], finalize?: bool }
//          ingère, dédoublonne, crée un litige par NOUVEL avis négatif
//          qui a un commentaire ou un tag (un négatif muet n'en crée pas) ;
//          `commande_le` (heure de la commande, lue par le bouton avis) :
//          enregistrée, complétée sur les avis déjà connus, et utilisée pour
//          dater le litige et lui attribuer le caissier présent.
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
import { caissierAuMoment } from './attributionAvis.js'

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

// Une date-heure ISO valide → ISO UTC normalisé ; sinon null.
const dateHeureIso = (v: unknown) => {
  const s = texte(v)
  if (!s) return null
  const t = Date.parse(s)
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

// Abidjan = UTC : jour et heure de la commande, lus directement.
const jourEtHeure = (iso: string | null) =>
  iso ? { date: new Date(iso).toISOString().slice(0, 10), heure: new Date(iso).toISOString().slice(11, 16) } : null

// Un avis négatif ne crée un litige que s'il dit pourquoi : un commentaire,
// ou au moins un tag Yango (raw.tag) / thème Glovo (raw.theme). Miroir exact
// de aUnMotif (lib/avisPlateformes.js) et de avis_a_un_motif() en SQL.
// deno-lint-ignore no-explicit-any
const aUnMotif = (avis: any) => {
  const plein = (v: unknown) => typeof v === 'string' ? v.trim() !== '' : v != null && v !== ''
  if (plein(avis?.comment)) return true
  const raw = avis?.raw || {}
  return [raw.tag, raw.theme].some((v) => Array.isArray(v) ? v.some(plein) : plein(v))
}

// Dernier avis connu par plateforme : `review_date` sert au bouton avis à
// choisir la période à relire, `ingested_at` au rappel côté app.
async function derniersParPlateforme() {
  const out: Record<string, { review_date: string | null; ingested_at: string | null }> = {}
  for (const p of PLATEFORMES) {
    const [rd, ia] = await Promise.all([
      supabase.from('platform_reviews').select('review_date')
        .eq('platform', p).not('review_date', 'is', null)
        .order('review_date', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('platform_reviews').select('ingested_at')
        .eq('platform', p)
        .order('ingested_at', { ascending: false }).limit(1).maybeSingle(),
    ])
    if (rd.error) throw rd.error
    if (ia.error) throw ia.error
    out[p] = { review_date: rd.data?.review_date ?? null, ingested_at: ia.data?.ingested_at ?? null }
  }
  return out
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
      const [{ data, error }, derniers] = await Promise.all([
        supabase
          .from('ingest_runs')
          .select('run_date, finished_at')
          .eq('run_date', aujourdhui())
          .eq('status', 'ok')
          .maybeSingle(),
        derniersParPlateforme(),
      ])
      if (error) throw error
      return json({ done_today: !!data, finished_at: data?.finished_at ?? null, derniers })
    }

    if (req.method !== 'POST') return json({ error: 'Méthode non supportée' }, 405)

    // ── INGESTION ────────────────────────────────────────────────────
    const body = await req.json().catch(() => null)
    const reviews = body?.reviews
    if (!Array.isArray(reviews)) return json({ error: 'Payload invalide : « reviews » attendu' }, 400)

    // Le restaurant est résolu côté base : le trigger
    // trg_resoudre_restaurant_avis lit review_store_mapping sur le libellé
    // normalisé (espaces compactés, minuscules). Une seule source de vérité —
    // la fonction n'a pas sa propre copie du mapping à tenir à jour.
    const rows: Record<string, unknown>[] = []
    const vus = new Set<string>()
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
      const commande_le = dateHeureIso(r?.commande_le)

      // Dédoublonnage prioritaire sur le n° de commande ; repli sur le contenu
      // quand la plateforme ne l'affiche pas.
      const dedup_hash = external_ref
        ? await sha256(`${platform}|${external_ref}`)
        : await sha256([platform, label ?? '', review_date ?? '', rating_raw ?? '', comment ?? ''].join('|'))

      // Deux fois le même avis dans le même envoi : on n'en garde qu'un
      // (l'INSERT accepterait, mais les compteurs seraient faux).
      if (vus.has(dedup_hash)) continue
      vus.add(dedup_hash)

      // Classification : celle fournie si valide, sinon déduite de la note
      // (Glovo n'a pas de note → la classification est obligatoire côté extraction).
      let classification = texte(r?.classification)
      if (classification !== 'bon' && classification !== 'negatif') {
        const note = rating_raw != null ? (rating_raw / rating_scale) * 5 : 5
        classification = note < SEUIL_NEGATIF ? 'negatif' : 'bon'
      }

      rows.push({
        platform,
        external_store_label: label,
        external_ref,
        rating_raw,
        rating_scale,
        classification,
        comment,
        author: texte(r?.author),
        review_date,
        commande_le,
        dedup_hash,
        raw: r ?? null,
      })
    }

    // Insertion par lots ; ON CONFLICT DO NOTHING sur dedup_hash → seuls les
    // avis réellement nouveaux ressortent, donc seuls eux créent un litige.
    const inseres: { id: string; classification: string; restaurant_id: string | null; comment: string | null; review_date: string | null; platform: string; external_ref: string | null; external_store_label: string | null; raw: Record<string, unknown> | null; dedup_hash: string; commande_le: string | null }[] = []
    for (let i = 0; i < rows.length; i += LOT) {
      const { data, error } = await supabase
        .from('platform_reviews')
        .upsert(rows.slice(i, i + LOT), { onConflict: 'dedup_hash', ignoreDuplicates: true })
        .select('id, classification, restaurant_id, comment, review_date, platform, external_ref, external_store_label, raw, dedup_hash, commande_le')
      if (error) throw error
      inseres.push(...(data ?? []))
    }

    // Avis déjà connus relus avec une heure : on la complète (et celle du
    // litige lié), sans rien toucher d'autre.
    const hashesInseres = new Set(inseres.map((x) => x.dedup_hash))
    const heuresConnues = rows
      .filter((x) => x.commande_le && !hashesInseres.has(x.dedup_hash as string))
      .map((x) => ({ dedup_hash: x.dedup_hash, commande_le: x.commande_le }))
    const completes: string[] = []
    for (let i = 0; i < heuresConnues.length; i += LOT) {
      const { data, error } = await supabase.rpc('completer_heures_avis', { p_heures: heuresConnues.slice(i, i + LOT) })
      if (error) throw error
      completes.push(...((data ?? []) as unknown[]).map((d) => (typeof d === 'string' ? d : (d as { completer_heures_avis: string }).completer_heures_avis)))
    }

    // Boutiques que le mapping n'a pas reconnues, parmi les avis NOUVEAUX :
    // les doublons ont déjà été signalés lors du run qui les a fait entrer.
    const orphelins = inseres.filter((x) => !x.restaurant_id)
    const labels_non_mappes = new Set(
      orphelins.filter((x) => x.external_store_label).map((x) => `${x.platform} · ${x.external_store_label}`),
    )

    // ── Litiges pour les NOUVEAUX avis négatifs ──────────────────────
    // Table réelle : litiges_avis_clients (type 'mauvais' = 1000 FCFA à la
    // charge du restaurant, canal = plateforme). Les avis dont la boutique
    // n'est pas reconnue sont laissés de côté : leur litige est créé au
    // rattachement (fonction SQL rattacher_avis). Un négatif muet (ni
    // commentaire, ni tag, ni thème) reste un avis mais pas un litige.
    // `raw` est l'avis tel qu'envoyé : ses tags sont dans raw.raw.
    const negatifsTous = inseres.filter((x) => x.classification === 'negatif' && x.restaurant_id)
    const negatifs = negatifsTous.filter((x) => aUnMotif({ comment: x.comment, raw: x.raw?.raw }))
    const litiges_ignores_sans_motif = negatifsTous.length - negatifs.length
    let litiges_crees = 0
    for (let i = 0; i < negatifs.length; i += LOT) {
      const lot = negatifs.slice(i, i + LOT).map((x) => ({
        restaurant_id: x.restaurant_id,
        date: jourEtHeure(x.commande_le)?.date ?? x.review_date ?? aujourdhui(),
        heure_commande: jourEtHeure(x.commande_le)?.heure ?? null,
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

    // ── Responsable des litiges dont l'heure est connue ──────────────
    // Caissier présent à l'heure de la commande (lib/attributionAvis.js,
    // copie exacte). Jamais d'écrasement d'un responsable déjà renseigné ;
    // shift pas encore saisi → le bouton « Attribuer » de Litiges rattrapera.
    const avisAvecHeure = [...inseres.filter((x) => x.commande_le).map((x) => x.id), ...completes]
    let litiges_attribues = 0
    const aAttribuer: { id: string; restaurant_id: string; date: string; heure_commande: string }[] = []
    for (let i = 0; i < avisAvecHeure.length; i += 150) {
      const { data, error } = await supabase.from('litiges_avis_clients')
        .select('id, restaurant_id, date, heure_commande')
        .in('review_id', avisAvecHeure.slice(i, i + 150))
        .is('responsable_id', null).is('responsable_nom', null)
        .not('heure_commande', 'is', null)
      if (error) throw error
      aAttribuer.push(...(data ?? []))
    }
    if (aAttribuer.length) {
      const dates = aAttribuer.map((l) => l.date).sort()
      const veille = new Date(Date.parse(`${dates[0]}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
      const { data: shifts, error } = await supabase.from('points_shifts')
        .select('restaurant_id, date, caissier_id, caissier_nom, heure_debut, heure_fin')
        .in('restaurant_id', [...new Set(aAttribuer.map((l) => l.restaurant_id))])
        .gte('date', veille).lte('date', dates[dates.length - 1])
        .range(0, 4999)
      if (error) throw error
      for (const l of aAttribuer) {
        const r = caissierAuMoment(shifts ?? [], { restaurantId: l.restaurant_id, date: l.date, heure: String(l.heure_commande).slice(0, 5) })
        if (!r.caissier_id && !r.caissier_nom) continue
        const { error: e } = await supabase.from('litiges_avis_clients')
          .update({ responsable_id: r.caissier_id || null, responsable_nom: r.caissier_nom || null })
          .eq('id', l.id).is('responsable_id', null).is('responsable_nom', null)
        if (!e) litiges_attribues++
      }
    }

    const resume = {
      received: reviews.length,
      inserted: inseres.length,
      duplicates: Math.max(0, vus.size - inseres.length),
      rejected: rejetes,
      unmapped: orphelins.length,
      litiges_crees,
      litiges_ignores_sans_motif,
      heures_ajoutees: inseres.filter((x) => x.commande_le).length + completes.length,
      litiges_attribues,
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
