// =====================================================================
//  Supabase Edge Function : alertes-stock
//
//  Appelée par pg_cron chaque jour à 9 h (Abidjan = UTC). Pour chaque fête
//  à J-7 ou J-2 avec une alerte de stock, envoie un message au gérant
//  (son restaurant), à la direction et à la RH (le groupe) : Android (Expo),
//  iPhone (send-web-push) et notification dans l'app. Une même alerte ne part
//  jamais deux fois (clé dans alertes_stock_envoyees).
//
//  Corps : { "essai": true?, "date": "AAAA-MM-JJ"? }
//  « essai » calcule et renvoie les messages SANS rien envoyer ni noter ;
//  « date » (essai seulement) simule un autre jour.
//
//  Déploiement : les fichiers lib/ partent avec la fonction.
//    npx supabase functions deploy alertes-stock --project-ref wlwotzxnzowbkbfcpnyi
// =====================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { DELAIS_ALERTE, datesUtiles, elementsAlerte, itemsPour, regrouper, ventesParRestaurant } from '../../../lib/alertesStock.js'

const URL_SUPABASE = Deno.env.get('SUPABASE_URL')!
const CLE_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const admin = createClient(URL_SUPABASE, CLE_SERVICE, { auth: { persistSession: false } })
const ECRAN = 'evenements'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

// Supabase coupe à 1 000 lignes : on lit par pages.
async function toutes(table: string, colonnes = '*', filtre?: (q: any) => any, ordre = 'id') {
  const lignes: any[] = []
  for (let debut = 0; ; debut += 1000) {
    let q = admin.from(table).select(colonnes).order(ordre).range(debut, debut + 999)
    if (filtre) q = filtre(q)
    const { data, error } = await q
    if (error) throw error
    lignes.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return lignes
}

async function envoyerExpo(tokens: string[], titre: string, corps: string) {
  if (!tokens.length) return 0
  const r = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(tokens.map(to => ({
      to, title: titre, body: corps, sound: 'default', channelId: 'default', data: { screen: ECRAN },
    }))),
  })
  const res = await r.json().catch(() => ({}))
  return (Array.isArray(res?.data) ? res.data : []).filter((x: any) => x?.status === 'ok').length
}

async function envoyerWeb(userId: string, titre: string, corps: string) {
  await fetch(`${URL_SUPABASE}/functions/v1/send-web-push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CLE_SERVICE}` },
    body: JSON.stringify({ type: 'alerte_stock', titre, message: corps, cible_user_id: userId, screen: ECRAN }),
  }).catch(() => {})
}

Deno.serve(async (req) => {
  try {
    const corpsRequete = await req.json().catch(() => ({}))
    const essai = corpsRequete.essai === true
    const dateEssai = essai && /^\d{4}-\d{2}-\d{2}$/.test(corpsRequete.date || '') ? corpsRequete.date : null
    const aujourdhui = dateEssai || new Date().toISOString().slice(0, 10)

    const evenements = await toutes('evenements_groupe')
    const elements = elementsAlerte(evenements, aujourdhui, DELAIS_ALERTE)
    if (!elements.length) return json({ ok: true, aujourdhui, essai, elements: 0, envois: [] })

    const dates = datesUtiles(elements, evenements)
    const [points, utilisateurs, tokens] = await Promise.all([
      dates.length
        ? toutes('points', 'id, restaurant_id, date, vente_machine, vente_total', q => q.in('date', dates))
        : Promise.resolve([]),
      toutes('utilisateurs', 'id, nom, role, actif, restaurant_id', q => q.in('role', ['manager', 'directeur', 'rh', 'gerant']).eq('actif', true)),
      toutes('admin_push_tokens', 'id, user_id, token'),
    ])
    const contexte = { elements, evenements, ventes: ventesParRestaurant(points) }

    // Le téléphone web d'un restaurant est partagé entre ses gérants.
    const restaurantsDejaServis = new Set<string>()
    const rapport: any[] = []
    for (const u of utilisateurs) {
      const items = itemsPour(u, contexte)
      if (!items.length) continue

      if (essai) {
        const msg = regrouper(items)
        rapport.push({ compte: u.nom, role: u.role, titre: msg?.titre, corps: msg?.corps })
        continue
      }

      // Réserver chaque clé d'abord : un second appel n'envoie rien de plus.
      const gardes: any[] = []
      for (const item of items) {
        const { error } = await admin.from('alertes_stock_envoyees').insert({ cle: item.cle, message: `${item.titre} — ${item.corps}` })
        if (!error) gardes.push(item)
      }
      const msg = regrouper(gardes)
      if (!msg) { rapport.push({ compte: u.nom, statut: 'déjà envoyé' }); continue }

      const sesTokens = tokens.filter((t: any) => t.user_id === u.id).map((t: any) => t.token)
      const android = await envoyerExpo(sesTokens, msg.titre, msg.corps)
      const partage = u.role === 'gerant' ? u.restaurant_id : null
      if (!partage || !restaurantsDejaServis.has(partage)) {
        if (partage) restaurantsDejaServis.add(partage)
        await envoyerWeb(u.id, msg.titre, msg.corps)
      }
      await admin.from('notifications').insert({
        type: 'alerte_stock', titre: msg.titre, message: msg.corps, cible_user_id: u.id,
        cible_role: [], lu_par: [], screen: ECRAN,
      })
      rapport.push({ compte: u.nom, role: u.role, titre: msg.titre, android, statut: 'envoyé' })
    }
    return json({ ok: true, aujourdhui, essai, elements: elements.length, envois: rapport })
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message || e) }, 500)
  }
})
