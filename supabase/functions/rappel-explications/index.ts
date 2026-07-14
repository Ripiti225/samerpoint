// Supabase Edge Function : rappel-explications
// Envoie un rappel push pour toute demande d'explication « envoyée » depuis
// plus de 3 jours et sans réponse récupérée, une seule fois par demande.
//
// Déploiement :
//   supabase functions deploy rappel-explications --no-verify-jwt
// Planification quotidienne : voir le bloc pg_cron dans
//   supabase_demandes_explication.sql
//
// Variables d'env fournies automatiquement par Supabase :
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'
const ROLES_ADMIN = ['manager', 'directeur', 'rh']

Deno.serve(async () => {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Demandes envoyées depuis > 3 jours, sans réponse, pas encore rappelées
    const seuil = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
    const { data: demandes, error } = await supabase
      .from('demandes_explication')
      .select('id, travailleur_nom, restaurant_id, cree_par_id, envoyee_par_id, envoyee_at')
      .eq('statut', 'envoyee')
      .is('rappel_envoye_at', null)
      .lt('envoyee_at', seuil)

    if (error) throw error
    if (!demandes || demandes.length === 0) {
      return json({ ok: true, rappels: 0 })
    }

    // Destinataires : tous les admins (manager/directeur/rh) + créateur + envoyeur
    const { data: admins } = await supabase
      .from('utilisateurs').select('id').in('role', ROLES_ADMIN)
    const adminIds = (admins || []).map((u: { id: string }) => u.id)

    const userIds = new Set<string>(adminIds)
    for (const d of demandes) {
      if (d.cree_par_id) userIds.add(d.cree_par_id)
      if (d.envoyee_par_id) userIds.add(d.envoyee_par_id)
    }

    const { data: tokens } = await supabase
      .from('admin_push_tokens')
      .select('token')
      .in('user_id', [...userIds])

    const noms = demandes.map((d) => d.travailleur_nom).filter(Boolean)
    const body = noms.length === 1
      ? `Explication de ${noms[0]} : pas de réponse depuis 3 jours.`
      : `${demandes.length} demandes d'explication sans réponse depuis 3 jours.`

    if (tokens && tokens.length > 0) {
      const messages = tokens.map((t: { token: string }) => ({
        to: t.token,
        title: '⏰ Rappel explication',
        body,
        sound: 'default',
        data: { screen: 'demandes-explication-admin' },
      }))
      for (let i = 0; i < messages.length; i += 100) {
        await fetch(EXPO_PUSH_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify(messages.slice(i, i + 100)),
        }).catch(() => {})
      }
    }

    // Notification interne (une par demande) + marquage rappel
    const nowIso = new Date().toISOString()
    for (const d of demandes) {
      await supabase.from('notifications').insert({
        type: 'explication_rappel',
        titre: '⏰ Rappel explication',
        message: `Pas de réponse depuis 3 jours — ${d.travailleur_nom || 'travailleur'}`,
        restaurant_id: d.restaurant_id,
        cible_role: ROLES_ADMIN,
        lu_par: [],
        screen: 'demandes-explication-admin',
      }).catch(() => {})
    }
    const ids = demandes.map((d) => d.id)
    await supabase.from('demandes_explication')
      .update({ rappel_envoye_at: nowIso }).in('id', ids)

    return json({ ok: true, rappels: demandes.length })
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500)
  }
})

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
