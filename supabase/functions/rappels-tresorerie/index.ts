// =====================================================================
//  Supabase Edge Function : rappels-tresorerie
//
//  Appelée par pg_cron à 9 h (« matin ») et 14 h (« apres_midi », relance),
//  heure d'Abidjan (= UTC). Calcule pour chaque compte de la trésorerie ce
//  qu'il faut lui rappeler (lib/rappelsTresorerie.js, même logique que l'app)
//  et lui envoie UN résumé : Android (Expo), iPhone (send-web-push) et
//  notification dans l'app. Un même rappel (date + moment + compte) ne part
//  jamais deux fois (clé dans tresorerie_alertes_envoyees).
//
//  Corps : { "moment": "matin" | "apres_midi", "essai": true?, "date": "AAAA-MM-JJ"? }
//  « essai » calcule et renvoie les messages SANS rien envoyer ni noter ;
//  « date » (essai seulement) simule un autre jour.
//
//  Déploiement : les fichiers lib/ sont envoyés avec la fonction (mêmes
//  chemins relatifs que dans le dépôt) — voir supabase_tresorerie_rappels.sql.
// =====================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { destinatairesRappels, elementsDuJour, messagePour } from '../../../lib/rappelsTresorerie.js'

const URL_SUPABASE = Deno.env.get('SUPABASE_URL')!
const CLE_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const admin = createClient(URL_SUPABASE, CLE_SERVICE, { auth: { persistSession: false } })

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

// Tables des étapes 2 et 4 : vides tant que leurs migrations ne sont pas passées.
const facultatif = (p: Promise<any[]>) => p.catch(() => [])

async function envoyerExpo(tokens: string[], titre: string, corps: string) {
  if (!tokens.length) return 0
  const r = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(tokens.map(to => ({
      to, title: titre, body: corps, sound: 'default', channelId: 'default', data: { screen: 'tresorerie' },
    }))),
  })
  const res = await r.json().catch(() => ({}))
  return (Array.isArray(res?.data) ? res.data : []).filter((x: any) => x?.status === 'ok').length
}

async function envoyerWeb(userId: string, titre: string, corps: string) {
  await fetch(`${URL_SUPABASE}/functions/v1/send-web-push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CLE_SERVICE}` },
    body: JSON.stringify({ type: 'tresorerie', titre, message: corps, cible_user_id: userId, screen: 'tresorerie' }),
  }).catch(() => {})
}

Deno.serve(async (req) => {
  try {
    const corpsRequete = await req.json().catch(() => ({}))
    const moment = corpsRequete.moment === 'apres_midi' ? 'apres_midi' : 'matin'
    const essai = corpsRequete.essai === true
    // Abidjan = UTC. En essai seulement, « date » simule un autre jour.
    const dateEssai = essai && /^\d{4}-\d{2}-\d{2}$/.test(corpsRequete.date || '') ? corpsRequete.date : null
    const aujourdhui = dateEssai || new Date().toISOString().slice(0, 10)

    const [dus, paiements, previsions, receptions, emprunts, restaurants, utilisateurs, droits, tokens] = await Promise.all([
      toutes('tresorerie_dus'),
      // '*' : prevision_id n'existe qu'après supabase_tresorerie_previsions.sql.
      toutes('tresorerie_paiements'),
      facultatif(toutes('tresorerie_previsions')),
      facultatif(toutes('tresorerie_partenaire_lignes', 'id, partenaire, type, created_at', q => q.eq('type', 'recu'))),
      facultatif(toutes('tresorerie_coffre_emprunts')),
      toutes('restaurants', 'id, nom'),
      toutes('utilisateurs', 'id, nom, role, actif', q => q.in('role', ['manager', 'directeur', 'rh']).eq('actif', true)),
      toutes('tresorerie_droits', 'user_id, niveau', undefined, 'user_id'),
      toutes('admin_push_tokens', 'id, user_id, token'),
    ])

    const nomResto = (id: string) => (restaurants.find((r: any) => r.id === id)?.nom || 'Groupe').trim()
    const elements = elementsDuJour({ moment, aujourdhui, dus, paiements, previsions, receptions, emprunts, nomResto })
    const destinataires = destinatairesRappels({ utilisateurs, droits })

    const rapport: any[] = []
    for (const d of destinataires) {
      const msg = messagePour(d.niveau, elements, moment)
      if (!msg) continue
      const ligne: any = { compte: d.nom, niveau: d.niveau, titre: msg.titre, corps: msg.corps }
      if (!essai) {
        // Réserver la clé d'abord : un second appel le même jour ne renvoie rien.
        const cle = `rappel|${aujourdhui}|${moment}|${d.id}`
        const { error } = await admin.from('tresorerie_alertes_envoyees')
          .insert({ cle, type: 'rappel_tresorerie', message: `${msg.titre} — ${msg.corps}` })
        if (error) { ligne.statut = 'déjà envoyé'; rapport.push(ligne); continue }
        const sesTokens = tokens.filter((t: any) => t.user_id === d.id).map((t: any) => t.token)
        ligne.android = await envoyerExpo(sesTokens, msg.titre, msg.corps)
        await envoyerWeb(d.id, msg.titre, msg.corps)
        await admin.from('notifications').insert({
          type: 'tresorerie', titre: msg.titre, message: msg.corps, cible_user_id: d.id,
          cible_role: [], lu_par: [], screen: 'tresorerie',
        })
        ligne.statut = 'envoyé'
      }
      rapport.push(ligne)
    }
    return json({ ok: true, moment, aujourdhui, essai, elements: elements.length, envois: rapport })
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message || e) }, 500)
  }
})
