// ─────────────────────────────────────────────────────────────────────────
//  NORMALISATION DU TEXTE POUR jsPDF
//
//  Les polices standard de jsPDF (Helvetica & co) sont limitées à l'encodage
//  WinAnsi. Les accents passent, mais PAS l'espace fine insécable que
//  `toLocaleString('fr-FR')` insère entre les milliers (U+202F), ni le vrai
//  signe moins (U+2212) : ils ressortent en glyphes parasites.
//
//  Sans ce passage, « 103 311 391 F » s'imprime « 1 0 3 / 3 1 1 / 3 9 1 F »
//  et « −1 » devient un guillemet. Constaté en production, corrigé une fois,
//  centralisé ici pour ne pas réapparaître dans le prochain export.
//
//  À appliquer sur TOUTE chaîne passée à doc.text() ou à autoTable.
//  Inutile pour PowerPoint et Excel : Office gère l'Unicode nativement.
// ─────────────────────────────────────────────────────────────────────────

export function normaliserPourPdf(valeur) {
  return String(valeur ?? '')
    .replace(/[   ]/g, ' ')   // espaces fines / insécables
    .replace(/−/g, '-')                 // signe moins
    .replace(/[–—]/g, '-')         // tirets demi-cadratin et cadratin
    .replace(/’/g, "'")                 // apostrophe typographique
    .replace(/→/g, '->')
    .replace(/…/g, '...')
}
