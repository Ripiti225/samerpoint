// ──────────────────────────────────────────────────────────────────────────────
// Préremplit « FC reçu » avec le fond donné par la Trésorerie (fonds donnés −
// espèces reprises au restaurant), tant que le gérant n'a pas corrigé la case.
// Utilisé par Ventes et par le Récapitulatif (avant validation).
// ──────────────────────────────────────────────────────────────────────────────
import { useEffect } from 'react'

import { garderPrerempli } from './fondTresorerie'
import { chargerFondTresorerie } from './fondTresorerieDb'

export function useFondTresorerie({ pointId, restaurantId, dateJour, pointValide, setVentesJour }) {
  useEffect(() => {
    if (!pointId || pointValide || !setVentesJour) return
    let vivant = true
    chargerFondTresorerie({ restaurantId, datePoint: dateJour, pointId }).then(r => {
      if (!vivant || !r) return
      setVentesJour(prev => ({
        ...prev,
        fc_recu: garderPrerempli({ saisi: prev.fc_recu, ancienAuto: prev.fc_recu_auto ?? null, nouveauAuto: r.montant }),
        fc_recu_auto: r.montant,
        fc_recu_detail: r.lignes,
      }))
    })
    return () => { vivant = false }
  }, [pointId, restaurantId, dateJour, pointValide])
}
