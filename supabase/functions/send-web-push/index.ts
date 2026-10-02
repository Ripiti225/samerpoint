// =====================================================================
//  Supabase Edge Function : send-web-push
//
//  Reçoit UNE notification (le même objet que `creerNotification` insère
//  dans la table `notifications`), résout les appareils destinataires
//  d'après la topologie « 1 tel par resto », et envoie le Web Push.
//
//  CIBLAGE (miroir du filtre in-app de lib/notificationsInterne.js) :
//    1. cible_user_id présent      → l'appareil de cet utilisateur (user_id)
//    2. cible_role non vide        → rôles GLOBAUX par user_id (tel perso)
//                                  + rôles RESTO par restaurant_id (tel resto)
//    3. aucune cible               → broadcast (tous les abonnements)
//
//  La clé privée VAPID reste ici (secret serveur), jamais côté client.
//
//  Secrets requis (Dashboard → Edge Functions → Secrets, ou CLI) :
//    VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (ex: mailto:toi@ex.com)
//    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (fournis automatiquement)
//
//  Déploiement :  supabase functions deploy send-web-push
//  (ou copier-coller ce fichier dans le Dashboard → Edge Functions.)
// =====================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const GLOBAL_ROLES = ['manager', 'directeur', 'rh']
const RESTO_ROLES = ['gerant', 'caissier']

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  })

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
)

webpush.setVapidDetails(
  Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@samer.app',
  Deno.env.get('VAPID_PUBLIC_KEY')!,
  Deno.env.get('VAPID_PRIVATE_KEY')!,
)

type Sub = { endpoint: string; p256dh: string; auth: string }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const n = await req.json().catch(() => ({}))
    const titre: string = (n.titre ?? '').toString()
    const message: string = (n.message ?? '').toString()
    if (!titre && !message) return json({ ok: false, error: 'notif vide' }, 400)

    const cibleUserId: string | null = n.cible_user_id ?? null
    const restaurantId: string | null = n.restaurant_id ?? null
    const cibleRole: string[] = Array.isArray(n.cible_role) ? n.cible_role : []

    // ── Résolution des abonnements destinataires ──────────────────────
    const parEndpoint = new Map<string, Sub>()
    const add = (rows: Sub[] | null) => {
      for (const r of rows ?? []) if (r?.endpoint) parEndpoint.set(r.endpoint, r)
    }
    const SELECT = 'endpoint, p256dh, auth'

    if (cibleUserId) {
      // (1) notif nominative → l'appareil de cet utilisateur (par user_id)…
      const { data } = await admin
        .from('web_push_subscriptions').select(SELECT).eq('user_id', cibleUserId)
      add(data)
      // …et, si c'est un rôle RESTO (gérant/caissier), aussi le tel du resto :
      // sur un tel partagé, la ligne peut porter le user_id de l'AUTRE compte
      // connecté ; le restaurant_id, lui, reste stable. On évite ainsi qu'un
      // gérant rate sa notif pendant que le caissier est connecté.
      const { data: cible } = await admin
        .from('utilisateurs').select('role, restaurant_id').eq('id', cibleUserId).maybeSingle()
      if (cible && RESTO_ROLES.includes(cible.role) && cible.restaurant_id) {
        const { data: parResto } = await admin
          .from('web_push_subscriptions').select(SELECT).eq('restaurant_id', cible.restaurant_id)
        add(parResto)
      }
    } else if (cibleRole.length > 0) {
      // (2a) rôles globaux → résoudre les user_ids puis leurs appareils perso.
      const rolesGlobaux = cibleRole.filter((r) => GLOBAL_ROLES.includes(r))
      if (rolesGlobaux.length > 0) {
        // Comptes actifs seulement : un compte désactivé ne reçoit plus rien.
        const { data: users } = await admin
          .from('utilisateurs').select('id').in('role', rolesGlobaux).eq('actif', true)
        const ids = (users ?? []).map((u: { id: string }) => u.id)
        if (ids.length > 0) {
          const { data } = await admin
            .from('web_push_subscriptions').select(SELECT).in('user_id', ids)
          add(data)
        }
      }
      // (2b) rôles resto → le tel du resto (peu importe le compte connecté).
      const rolesResto = cibleRole.filter((r) => RESTO_ROLES.includes(r))
      if (rolesResto.length > 0 && restaurantId) {
        const { data } = await admin
          .from('web_push_subscriptions').select(SELECT).eq('restaurant_id', restaurantId)
        add(data)
      }
    } else {
      // (3) aucune cible → broadcast (tous les appareils).
      const { data } = await admin.from('web_push_subscriptions').select(SELECT)
      add(data)
    }

    const subs = [...parEndpoint.values()]
    if (subs.length === 0) return json({ ok: true, envoyes: 0, cibles: 0 })

    // ── Payload reçu par sw.js ────────────────────────────────────────
    const payload = JSON.stringify({
      title: titre || 'SamerPoint',
      body: message,
      tag: n.type || undefined,
      data: {
        screen: n.screen ?? null,
        params: n.params ?? null,
        restaurant_id: restaurantId,
      },
    })

    // ── Envoi + purge des abonnements périmés (404/410) ───────────────
    let envoyes = 0
    const perimes: string[] = []
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            payload,
          )
          envoyes++
        } catch (err) {
          const code = (err as { statusCode?: number })?.statusCode
          if (code === 404 || code === 410) perimes.push(s.endpoint)
        }
      }),
    )

    if (perimes.length > 0) {
      await admin.from('web_push_subscriptions').delete().in('endpoint', perimes)
    }

    return json({ ok: true, envoyes, cibles: subs.length, purges: perimes.length })
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500)
  }
})
