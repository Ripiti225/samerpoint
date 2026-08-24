// Supabase Edge Function : rappel-contrats
//
// Deux passes, tous les jours à 07:00 (Abidjan est à UTC+0) :
//   1. alertes d'échéance à J-15, J-7 et J-3, une seule fois par palier ;
//   2. archivage des travailleurs dont plus aucun contrat ne court.
//
// Déploiement :
//   supabase functions deploy rappel-contrats --no-verify-jwt
// Planification : voir le bloc pg_cron dans supabase_contrats_travailleurs.sql
//
// La logique reproduit lib/contrats.js. Les tests de référence sont dans
// lib/contrats.test.mjs — toute divergence ici est un bug.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'
const ROLES_ADMIN = ['manager', 'directeur', 'rh']
const PALIERS = [15, 7, 3]
const JOUR_MS = 24 * 60 * 60 * 1000

type Contrat = {
  id: string
  travailleur_id: string
  restaurant_id: string | null
  type: string
  date_debut: string
  date_fin: string | null
  cloture_le: string | null
  rappels_envoyes: number[] | null
  desactivation_faite_le: string | null
  travailleurs?: { nom: string; actif: boolean; restaurant_id: string | null } | null
}

const versUTC = (iso: string) => {
  const [a, m, j] = iso.split('-').map(Number)
  return Date.UTC(a, m - 1, j)
}
const finEffective = (c: Contrat) => c.cloture_le || c.date_fin || null
const joursRestants = (c: Contrat, jour: string) => {
  const fin = finEffective(c)
  return fin === null ? null : Math.round((versUTC(fin) - versUTC(jour)) / JOUR_MS)
}
const enCours = (c: Contrat, jour: string) => {
  if (jour < c.date_debut) return false
  const fin = finEffective(c)
  return fin === null || jour <= fin
}
const aVenir = (c: Contrat, jour: string) => jour < c.date_debut

function palierAEnvoyer(c: Contrat, jour: string): number | null {
  if (c.cloture_le || !c.date_fin) return null
  const restants = joursRestants(c, jour)
  if (restants === null || restants < 0) return null
  const envoyes = c.rappels_envoyes || []
  // Ordre croissant, comme lib/contrats.js : on veut le palier applicable le
  // plus SERRÉ non encore envoyé. Parcourir [15,7,3] tel quel enverrait J-15
  // pour un contrat saisi à 5 jours de sa fin — cf. lib/contrats.test.mjs.
  for (const p of [...PALIERS].reverse()) {
    if (restants <= p && !envoyes.includes(p)) return p
  }
  return null
}

const formatFR = (iso: string) => iso.split('-').reverse().join('/')

Deno.serve(async () => {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    const jour = new Date().toISOString().slice(0, 10)

    const { data: contrats, error } = await supabase
      .from('contrats_travailleurs')
      .select('*, travailleurs(nom, actif, restaurant_id)')
    if (error) throw error
    const tous = (contrats || []) as Contrat[]

    // ── Passe 1 : alertes d'échéance ────────────────────────────────────────
    let alertes = 0
    for (const c of tous) {
      if (!c.travailleurs?.actif) continue
      const palier = palierAEnvoyer(c, jour)
      if (palier === null) continue

      const nom = c.travailleurs?.nom || 'un travailleur'
      const resto = c.restaurant_id || c.travailleurs?.restaurant_id || null
      const quand = c.date_fin ? formatFR(c.date_fin) : ''
      const titre = `⏰ Fin de contrat dans ${palier} jours`

      // Deux notifications : les admins peuvent ouvrir l'écran RH, le gérant non.
      // Lui envoyer `screen: 'rh'` le mènerait sur un écran auquel il n'a pas
      // accès — sa notification est volontairement sans navigation.
      await supabase.from('notifications').insert({
        type: 'contrat_echeance',
        titre,
        message: `${c.type} de ${nom} — se termine le ${quand}`,
        restaurant_id: resto,
        cible_role: ROLES_ADMIN,
        lu_par: [],
        screen: 'rh',
      })
      await supabase.from('notifications').insert({
        type: 'contrat_echeance',
        titre,
        message: `${nom} (${c.type}) — contrat terminé le ${quand}`,
        restaurant_id: resto,
        cible_role: ['gerant'],
        lu_par: [],
      })
      await supabase.from('contrats_travailleurs')
        .update({ rappels_envoyes: [...(c.rappels_envoyes || []), palier] })
        .eq('id', c.id)
      alertes++
    }

    // ── Passe 2 : désactivation à l'échéance ────────────────────────────────
    const parTravailleur = new Map<string, Contrat[]>()
    for (const c of tous) {
      const liste = parTravailleur.get(c.travailleur_id) || []
      liste.push(c)
      parTravailleur.set(c.travailleur_id, liste)
    }

    let desactives = 0
    for (const [travailleurId, liste] of parTravailleur) {
      const trav = liste[0].travailleurs
      if (!trav?.actif) continue
      if (liste.some(c => enCours(c, jour))) continue
      if (liste.some(c => aVenir(c, jour))) continue

      const dernier = liste
        .filter(c => finEffective(c))
        .sort((a, b) => (finEffective(a)! < finEffective(b)! ? 1 : -1))[0]
      if (!dernier || dernier.desactivation_faite_le) continue

      await supabase.from('travailleurs').update({
        statut: 'archive',
        actif: false,
        archived_at: new Date().toISOString(),
        archive_motif: 'Fin de contrat',
      }).eq('id', travailleurId)

      await supabase.from('contrats_travailleurs')
        .update({ desactivation_faite_le: jour })
        .eq('id', dernier.id)

      const quand = formatFR(finEffective(dernier)!)
      const resto = dernier.restaurant_id || trav.restaurant_id || null
      await supabase.from('notifications').insert({
        type: 'contrat_desactivation',
        titre: '🔒 Travailleur désactivé',
        message: `${trav.nom} — fin de contrat le ${quand}`,
        restaurant_id: resto,
        cible_role: ROLES_ADMIN,
        lu_par: [],
        screen: 'rh',
      })
      await supabase.from('notifications').insert({
        type: 'contrat_desactivation',
        titre: '🔒 Travailleur désactivé',
        message: `${trav.nom} — son contrat s'est terminé le ${quand}`,
        restaurant_id: resto,
        cible_role: ['gerant'],
        lu_par: [],
      })
      desactives++
    }

    // ── Push hors-app aux admins, si quelque chose s'est passé ──────────────
    if (alertes + desactives > 0) {
      const { data: admins } = await supabase
        .from('utilisateurs').select('id').in('role', ROLES_ADMIN)
      const { data: tokens } = await supabase
        .from('admin_push_tokens').select('token')
        .in('user_id', (admins || []).map((u: { id: string }) => u.id))

      if (tokens && tokens.length > 0) {
        const corps = [
          alertes > 0 ? `${alertes} contrat(s) arrivent à échéance` : '',
          desactives > 0 ? `${desactives} travailleur(s) désactivé(s)` : '',
        ].filter(Boolean).join(' · ')
        const messages = tokens.map((t: { token: string }) => ({
          to: t.token, title: '📋 Contrats', body: corps,
          sound: 'default', data: { screen: 'rh' },
        }))
        for (let i = 0; i < messages.length; i += 100) {
          await fetch(EXPO_PUSH_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify(messages.slice(i, i + 100)),
          }).catch(() => {})
        }
      }
    }

    return json({ ok: true, alertes, desactives })
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500)
  }
})

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json' },
  })
}
