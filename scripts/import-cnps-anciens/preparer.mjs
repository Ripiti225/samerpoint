// Préparation de l'import du 22/10/2026 (anciens travailleurs + arriérés CNPS).
// Usage : node scripts/import-cnps-anciens/preparer.mjs "<depart par restaurant.xlsx>" "<DETTE CNPS.xlsx>"
// Écrit out/controle.csv (à faire valider), out/resume.txt et out/import.sql.
// N'écrit RIEN en base : import.sql se passe ensuite dans Supabase.
//
// Le fichier des départs pèse 144 Mo (mises en forme sur un million de lignes) :
// lecture en flux avec exceljs, ~50 s. NE JAMAIS sortir d'une boucle de
// lignes avant la fin (break) : la feuille suivante est alors perdue (« angre »
// disparaissait lors de l'essai du 22/10). Les textes partagés sont rangés
// APRÈS les feuilles dans le fichier : un 1er passage les récupère, le 2e lit
// les feuilles. Sans les formats, les dates arrivent en numéros de série
// (convertis par dateIso). Le petit fichier CNPS se lit d'un bloc.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ExcelJS from 'exceljs'

import { csvControle, lireCnps, lireDroits, resumeImport, sqlImport } from '../../lib/importDroitsCnps.js'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const [fichierDeparts, fichierCnps] = process.argv.slice(2)
if (!fichierDeparts || !fichierCnps) {
  console.error('Usage : node scripts/import-cnps-anciens/preparer.mjs "<depart par restaurant.xlsx>" "<DETTE CNPS.xlsx>"')
  process.exit(1)
}

const OPTIONS = { styles: 'ignore', hyperlinks: 'ignore' }

const valeurAvec = textes => function valeur(v) {
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (v && typeof v === 'object' && 'sharedString' in v) return textes[v.sharedString] ?? null
  if (v && typeof v === 'object' && 'result' in v) return valeur(v.result)   // formule
  if (v && typeof v === 'object' && 'richText' in v) return v.richText.map(t => t.text).join('')
  return v ?? null
}

const garder = (lignes, cellules) => { if (cellules.some(v => v !== null && v !== '')) lignes.push(cellules) }

async function lireClasseurEnFlux(fichier) {
  const avant = new ExcelJS.stream.xlsx.WorkbookReader(fichier, { ...OPTIONS, sharedStrings: 'cache', worksheets: 'ignore' })
  // eslint-disable-next-line no-unused-vars
  for await (const _ of avant) { /* textes partagés seulement */ }
  const valeur = valeurAvec(avant.sharedStrings || [])
  const feuilles = {}
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(fichier, { ...OPTIONS, sharedStrings: 'cache', worksheets: 'emit' })
  for await (const ws of reader) {
    const lignes = []
    for await (const row of ws) garder(lignes, (row.values || []).slice(1).map(valeur))   // values est 1-indexé
    feuilles[ws.name] = lignes
  }
  return feuilles
}

async function lireClasseurEntier(fichier) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(fichier)
  const valeur = valeurAvec([])
  const feuilles = {}
  wb.eachSheet(ws => {
    const lignes = []
    ws.eachRow({ includeEmpty: false }, row => garder(lignes, (row.values || []).slice(1).map(valeur)))
    feuilles[ws.name] = lignes
  })
  return feuilles
}

// exceljs perd parfois la DERNIÈRE feuille en fin de flux (vu le 22/10 : « angre »
// absente une fois sur deux, sans break) : on relit tant qu'il en manque une.
const attendues = ['Feuil1', 'autres', 'palmeraie', 'AL KAYAN', 'angre', 'koum', 'lavage', 'maroc', 'OASIS']
let departs = {}
let manquantes = attendues
for (let essai = 1; essai <= 3 && manquantes.length; essai++) {
  if (essai > 1) console.error(`Feuilles perdues à la lecture (${manquantes.join(', ')}) : nouvel essai ${essai}/3…`)
  departs = await lireClasseurEnFlux(fichierDeparts)
  manquantes = attendues.filter(f => !departs[f])
}
if (manquantes.length) { console.error(`Feuilles introuvables : ${manquantes.join(', ')}`); process.exit(1) }
const cnpsFeuilles = await lireClasseurEntier(fichierCnps)
if (!cnpsFeuilles.SAMER) { console.error('Feuille SAMER introuvable dans le fichier CNPS'); process.exit(1) }

const droits = lireDroits(departs)
const cnps = lireCnps(cnpsFeuilles.SAMER.slice(1))

fs.mkdirSync(path.join(DIR, 'out'), { recursive: true })
fs.writeFileSync(path.join(DIR, 'out', 'controle.csv'), '﻿' + csvControle(droits))   // BOM : accents justes dans Excel
const resume = resumeImport(droits, cnps)
fs.writeFileSync(path.join(DIR, 'out', 'resume.txt'), resume)
fs.writeFileSync(path.join(DIR, 'out', 'import.sql'), sqlImport(droits, cnps))
console.log(resume)
console.log(`Écrit : ${path.join(DIR, 'out')}/controle.csv, resume.txt, import.sql — rien n'a été écrit en base.`)
