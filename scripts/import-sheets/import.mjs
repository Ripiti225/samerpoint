// Import de l'historique Google Sheets -> SamerTrackly (1er nov. 2025 -> 10 mai 2026)
// Usage :  node scripts/import-sheets/import.mjs --dry-run   (vérifie les fichiers, n'écrit rien)
//          node scripts/import-sheets/import.mjs             (import réel)
// Clés lues dans scripts/import-sheets/.env.import :
//   SUPABASE_URL=https://wlwotzxnzowbkbfcpnyi.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY=...   (Supabase > Project Settings > API > service_role ; ne jamais commiter)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const LOT = 'import_sheets_2026_10'
const DRY = process.argv.includes('--dry-run')
const ORDRE = ['fournisseurs', 'fournisseurs_restaurants', 'points', 'depenses', 'transactions_fournisseurs',
  'inventaires_shifts', 'inventaire_lignes', 'presences', 'contacts_clients']
const LOT_TAILLE = 500

const data = Object.fromEntries(ORDRE.map(t => [t, JSON.parse(fs.readFileSync(path.join(DIR, 'data', `${t}.json`), 'utf8'))]))
for (const t of ORDRE) console.log(`${t.padEnd(28)} ${String(data[t].length).padStart(7)} lignes`)

// contrôles locaux
const pointIds = new Set(data.points.map(p => p.id))
const shiftIds = new Set(data.inventaires_shifts.map(s => s.id))
const orphelins = [
  ['depenses', data.depenses.filter(r => !pointIds.has(r.point_id)).length],
  ['transactions_fournisseurs', data.transactions_fournisseurs.filter(r => !pointIds.has(r.point_id)).length],
  ['inventaires_shifts', data.inventaires_shifts.filter(r => !pointIds.has(r.point_id)).length],
  ['inventaire_lignes', data.inventaire_lignes.filter(r => !shiftIds.has(r.inventaire_id)).length],
  ['presences', data.presences.filter(r => !pointIds.has(r.point_id)).length],
]
for (const [t, n] of orphelins) if (n) { console.error(`ERREUR : ${n} lignes orphelines dans ${t}`); process.exit(1) }
const ventes = data.points.reduce((s, p) => s + (p.vente_total || 0), 0)
console.log(`Contrôle local OK — ventes totales : ${ventes.toLocaleString('fr-FR')} FCFA`)
if (DRY) { console.log('--dry-run : rien n\'a été écrit.'); process.exit(0) }

const env = Object.fromEntries(fs.readFileSync(path.join(DIR, '.env.import'), 'utf8').split('\n')
  .filter(l => l.includes('=') && !l.startsWith('#')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]))
const { createClient } = await import('@supabase/supabase-js')
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

// sécurité : aucun jour importé ne doit déjà exister (hors lot d'import)
const restos = [...new Set(data.points.map(p => p.restaurant_id))]
const { data: deja, error: e0 } = await sb.from('points').select('restaurant_id,date,source')
  .in('restaurant_id', restos).lte('date', '2026-05-10')
if (e0) { console.error(e0); process.exit(1) }
const cle = new Set(deja.filter(p => p.source !== LOT).map(p => `${p.restaurant_id}|${p.date}`))
const conflits = data.points.filter(p => cle.has(`${p.restaurant_id}|${p.date}`))
if (conflits.length) { console.error(`ARRÊT : ${conflits.length} jours existent déjà dans SamerTrackly`, conflits.slice(0, 5)); process.exit(1) }

for (const t of ORDRE) {
  const rows = data[t]
  for (let i = 0; i < rows.length; i += LOT_TAILLE) {
    const lot = rows.slice(i, i + LOT_TAILLE)
    let essai = 0
    while (true) {
      const { error } = await sb.from(t).upsert(lot, { onConflict: "id", ignoreDuplicates: true, defaultToNull: false })
      if (!error) break
      if (++essai >= 3) { console.error(`\nERREUR ${t} (lignes ${i}-${i + lot.length}) :`, error); process.exit(1) }
      await new Promise(r => setTimeout(r, 2000 * essai))
    }
    process.stdout.write(`\r${t.padEnd(28)} ${Math.min(i + LOT_TAILLE, rows.length)}/${rows.length}`)
  }
  process.stdout.write('\n')
}

// vérification finale
const { count } = await sb.from('points').select('id', { count: 'exact', head: true }).eq('source', LOT)
console.log(`\nTerminé. Points importés en base : ${count} / ${data.points.length}`)
console.log('Dis à Claude « import terminé » pour la vérification complète.')
