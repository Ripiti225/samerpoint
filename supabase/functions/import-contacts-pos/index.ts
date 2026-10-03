// =====================================================================
//  Supabase Edge Function : import-contacts-pos
//
//  Rapatrie les numéros clients saisis au POS (cloud POS, table `commandes`,
//  colonne `contact_client`) dans la table `contacts_clients` de Samtrackly,
//  pour que l'écran Contacts puisse envoyer SMS et WhatsApp aux clients.
//
//  Appelée par le déclencheur `contacts_pos_apres_shift` à chaque shift validé
//  qui arrive du POS (points_shifts.pos_service_id renseigné) — voir
//  supabase_contacts_clients_pos.sql. Relit le POS depuis 2 jours avant le
//  dernier contact importé : un appel raté est rattrapé par le suivant, et
//  la clé unique pos_commande_id empêche tout doublon.
//
//  Corps : { "depuis": "AAAA-MM-JJ"? }  (« depuis » = reprise d'historique)
//
//  Secrets (projet Samtrackly) : POS_URL, POS_CLE_SERVICE — la clé reste côté
//  serveur, jamais dans l'application.
//  Déploiement : npx supabase functions deploy import-contacts-pos --project-ref wlwotzxnzowbkbfcpnyi
// =====================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { dateDepart, versContactClient } from '../../../lib/contactsClientsPos.js'

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
const pos = createClient(Deno.env.get('POS_URL')!, Deno.env.get('POS_CLE_SERVICE')!, { auth: { persistSession: false } })

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async req => {
  try {
    const corps = await req.json().catch(() => ({}))

    const { data: dernier } = await admin.from('contacts_clients')
      .select('commande_at').order('commande_at', { ascending: false }).limit(1)
    const depuis = dateDepart(dernier?.[0]?.commande_at, corps?.depuis)

    const { data: restos, error: eR } = await pos.from('restaurants').select('restaurant_id, samtrackly_id')
    if (eR) throw eR
    const correspondance = Object.fromEntries((restos ?? []).filter(r => r.samtrackly_id).map(r => [r.restaurant_id, r.samtrackly_id]))

    // Supabase coupe à 1 000 lignes : lecture par pages.
    const commandes: any[] = []
    for (let de = 0; ; de += 1000) {
      const { data, error } = await pos.from('commandes')
        .select('id, restaurant_id, statut, contact_client, partenaire, created_at, service_id')
        .not('contact_client', 'is', null).neq('contact_client', '')
        .gte('created_at', depuis)
        .order('id').range(de, de + 999)
      if (error) throw error
      commandes.push(...(data ?? []))
      if (!data || data.length < 1000) break
    }

    const lignes = commandes.map(c => versContactClient(c, correspondance)).filter(Boolean)
    for (let i = 0; i < lignes.length; i += 500) {
      const { error } = await admin.from('contacts_clients')
        .upsert(lignes.slice(i, i + 500), { onConflict: 'pos_commande_id' })
      if (error) throw error
    }

    return json({ ok: true, depuis, lus: commandes.length, importes: lignes.length })
  } catch (e) {
    console.error('import-contacts-pos', e)
    return json({ ok: false, erreur: String((e as Error)?.message ?? e) }, 500)
  }
})
