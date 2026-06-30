#!/usr/bin/env node
/**
 * Liste les transactions fournisseurs pour une date (ou une plage de dates) donnée (debug en CLI).
 *
 * Usage:
 *   node scripts/transactions-fournisseurs-date.js 2026-06-02
 *   node scripts/transactions-fournisseurs-date.js 2026-06-02 "Nom du restaurant"
 *   node scripts/transactions-fournisseurs-date.js 2026-05-12 2026-05-18 "Al Kayan Yop" "Hamed escalope"
 */

const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://wlwotzxnzowbkbfcpnyi.supabase.co'
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indsd290enhuem93YmtiZmNwbnlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4NjQ1OTEsImV4cCI6MjA5MTQ0MDU5MX0.nioXBAKA05_zRIyTpJmV_d4JY5mCYueOt5cKIlL-NNk'

const supabase = createClient(supabaseUrl, supabaseAnonKey)

const fmt = n => Math.round(n || 0).toLocaleString('fr-FR')

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

async function main() {
  const args = process.argv.slice(2)
  const dateDebut = args[0]
  if (!dateDebut || !DATE_RE.test(dateDebut)) {
    console.error('Usage: node scripts/transactions-fournisseurs-date.js YYYY-MM-DD [YYYY-MM-DD] ["restaurant"] ["fournisseur"]')
    process.exit(1)
  }

  // Si le 2e argument ressemble à une date, c'est la fin de plage ; sinon c'est le filtre restaurant.
  let dateFin = dateDebut
  let restoFilter
  let fournisseurFilter
  if (args[1] && DATE_RE.test(args[1])) {
    dateFin = args[1]
    restoFilter = args[2]
    fournisseurFilter = args[3]
  } else {
    restoFilter = args[1]
    fournisseurFilter = args[2]
  }

  const label = dateDebut === dateFin ? dateDebut : `${dateDebut} → ${dateFin}`

  const { data: points, error: pointsErr } = await supabase
    .from('points')
    .select('id, date, restaurant_id, restaurants(nom)')
    .gte('date', dateDebut)
    .lte('date', dateFin)
  if (pointsErr) { console.error('Erreur points:', pointsErr.message); process.exit(1) }
  if (!points?.length) { console.log(`Aucun point trouvé pour ${label}`); return }

  const filtered = restoFilter
    ? points.filter(p => (p.restaurants?.nom || '').toLowerCase().includes(restoFilter.toLowerCase()))
    : points

  if (!filtered.length) { console.log(`Aucun point pour "${restoFilter}" sur ${label}`); return }

  const pointIds = filtered.map(p => p.id)
  const restoByPoint = {}
  const dateByPoint = {}
  filtered.forEach(p => {
    restoByPoint[p.id] = p.restaurants?.nom || '?'
    dateByPoint[p.id] = p.date
  })

  const { data: trans, error: transErr } = await supabase
    .from('transactions_fournisseurs')
    .select('*, fournisseurs(nom)')
    .in('point_id', pointIds)
    .order('created_at', { ascending: true })
  if (transErr) { console.error('Erreur transactions:', transErr.message); process.exit(1) }

  let result = trans || []
  if (fournisseurFilter) {
    const needle = fournisseurFilter.toLowerCase()
    result = result.filter(t => (t.fournisseurs?.nom || t.fournisseur_nom || '').toLowerCase().includes(needle))
  }

  if (!result.length) { console.log(`Aucune transaction fournisseur trouvée pour ${label}${restoFilter ? ` / ${restoFilter}` : ''}${fournisseurFilter ? ` / ${fournisseurFilter}` : ''}`); return }

  console.log(`\n📅 Transactions fournisseurs — ${label}\n`)
  result
    .slice()
    .sort((a, b) => (dateByPoint[a.point_id] || '').localeCompare(dateByPoint[b.point_id] || '') || (a.created_at || '').localeCompare(b.created_at || ''))
    .forEach(t => {
      console.log(
        `[${dateByPoint[t.point_id]}] [${restoByPoint[t.point_id]}] ${t.fournisseurs?.nom || t.fournisseur_nom || '?'} ` +
        `| source=${t.saisi_par}${t.caissier_nom ? ` (${t.caissier_nom})` : ''} ` +
        `| crédit=${fmt((t.reste || 0) - (t.facture || 0) + (t.paye || 0))} ` +
        `| facture=${fmt(t.facture)} | payé=${fmt(t.paye)} | reste=${fmt(t.reste)} ` +
        `| ${new Date(t.created_at).toLocaleTimeString('fr-FR')}`
      )
    })
  console.log(`\nTotal: ${result.length} transaction(s)\n`)
}

main()
