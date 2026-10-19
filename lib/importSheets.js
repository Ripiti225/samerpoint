// ──────────────────────────────────────────────────────────────────────────────
// Historique Google Sheets importé le 19/10/2026 (1er nov. 2025 → 10 mai 2026,
// scripts/import-sheets). Archives : consultables, jamais modifiées.
//   • journées en lecture seule (garde-fou en base :
//     supabase_import_sheets_lecture_seule.sql) — modifier une journée validée
//     reporte l'écart de fond sur toutes les suivantes, vraies journées comprises ;
//   • lignes fournisseurs = affichage seul, 0 au compteur (lib/creditsFournisseurs.js).
// ──────────────────────────────────────────────────────────────────────────────
export const SOURCE_IMPORT_SHEETS = 'import_sheets_2026_10'

export const estJourneeImportee = point => point?.source === SOURCE_IMPORT_SHEETS
