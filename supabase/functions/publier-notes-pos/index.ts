// =====================================================================
//  Supabase Edge Function : publier-notes-pos
//
//  Calcule la « Note des caissiers » (sur 20, 30 derniers jours) avec
//  EXACTEMENT le même code que l'écran du back-office
//  (lib/noteCaissierCharge.js → lib/noteCaissier.js), puis l'écrit dans le
//  cloud POS, table `notes_caissiers` : chaque caissier la retrouve en haut
//  de l'accueil de sa caisse, à côté de son nom.
//
//  Une ligne par COMPTE POS (clé restaurant_id + id) — voir lib/notesPOS.js.
//  La caisse la reçoit par la descente de synchronisation (flux NOTES).
//
//  Appelée toutes les heures par pg_cron (supabase_notes_caissiers_pos.sql) :
//  la note dépend de décisions prises dans Vérification, de litiges et de
//  présences saisis à toute heure, pas seulement des shifts.
//
//  Secrets (projet Samtrackly) : POS_URL, POS_CLE_SERVICE — les mêmes que
//  import-contacts-pos. La clé reste côté serveur, jamais dans l'application.
//  Déploiement : npx supabase functions deploy publier-notes-pos --project-ref wlwotzxnzowbkbfcpnyi
// =====================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { chargerEtCalculerNotes } from '../../../lib/noteCaissierCharge.js'
import { lignesNotesPOS } from '../../../lib/notesPOS.js'

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
const pos = createClient(Deno.env.get('POS_URL')!, Deno.env.get('POS_CLE_SERVICE')!, { auth: { persistSession: false } })

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** Ventes par service du POS (bonus « ventes additionnelles »), même forme que lib/statsPOSDb.js. */
async function chargerVentes({ debut, fin }: { debut: string; fin: string }) {
  const { data, error } = await pos.rpc('stats_services', { p_debut: debut, p_fin: fin })
  if (error) return { parService: {}, erreur: error.message }
  const lignes = Array.isArray(data) ? data : []
  return {
    parService: Object.fromEntries(
      lignes.map((x: { s: string; nb: unknown; ca: unknown; u: string | null }) =>
        [x.s, { nb: Number(x.nb) || 0, ca: Number(x.ca) || 0, caissierPos: x.u || null }]),
    ),
  }
}

Deno.serve(async () => {
  try {
    const { notes, notesPrec, periodes, posErreur } = await chargerEtCalculerNotes({ client: admin, chargerVentes })

    const { data: utilisateurs, error: eU } = await admin.from('utilisateurs').select('id, travailleur_id')
    if (eU) throw eU

    // Comptes POS de tous les sites (pages de 1 000 : Supabase tronque sans erreur).
    const utilisateursSite: { id: string; restaurant_id: string; externe_id: string | null; actif: boolean | null }[] = []
    for (let de = 0; ; de += 1000) {
      const { data, error } = await pos.from('utilisateurs_site')
        .select('id, restaurant_id, externe_id, actif').order('id').range(de, de + 999)
      if (error) throw error
      utilisateursSite.push(...(data ?? []))
      if (!data || data.length < 1000) break
    }

    const lignes = lignesNotesPOS({ notes, notesPrec, utilisateurs: utilisateurs ?? [], utilisateursSite, periodes })
    for (let i = 0; i < lignes.length; i += 500) {
      const { error } = await pos.from('notes_caissiers')
        .upsert(lignes.slice(i, i + 500), { onConflict: 'restaurant_id,id' })
      if (error) throw error
    }

    return json({ ok: true, periodes, caissiers: notes.length, lignes: lignes.length, posErreur: posErreur ?? null })
  } catch (e) {
    console.error('publier-notes-pos', e)
    return json({ ok: false, erreur: String((e as Error)?.message ?? e) }, 500)
  }
})
