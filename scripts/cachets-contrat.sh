#!/bin/sh
# Régénère lib/cachetsContrat.js depuis les cachets « M. ADOU ERIC JC » scannés
# (assets/cachets-contrat/*.jpg). À relancer si un cachet est remplacé.
set -e
cd "$(dirname "$0")/.."
SAMER=$(base64 -i assets/cachets-contrat/cachet-contrat-samer.jpg | tr -d '\n')
KAYAN=$(base64 -i assets/cachets-contrat/cachet-contrat-alkayan.jpg | tr -d '\n')
cat > lib/cachetsContrat.js <<JS
// ─────────────────────────────────────────────────────────────────────────
//  CACHETS DES CONTRATS DE TRAVAIL — « M. ADOU ERIC JC, Responsable
//  administratif », un par marque. Fichier GÉNÉRÉ par
//  scripts/cachets-contrat.sh depuis assets/cachets-contrat/ : ne pas
//  modifier à la main.
//
//  Distincts du cachet des autres documents RH (lib/cachets.js), qui reste
//  inchangé. À la Braise n'a pas de cachet : pas de contrat généré.
// ─────────────────────────────────────────────────────────────────────────

export const CACHET_CONTRAT_SAMER = 'data:image/jpeg;base64,${SAMER}'
export const CACHET_CONTRAT_KAYAN = 'data:image/jpeg;base64,${KAYAN}'

/** Cachet pour une marque de lib/modelesContrat.js, ou null. */
export function cachetContrat(marque) {
  if (marque === 'samer') return CACHET_CONTRAT_SAMER
  if (marque === 'alkayan') return CACHET_CONTRAT_KAYAN
  return null
}
JS
echo "lib/cachetsContrat.js régénéré"
