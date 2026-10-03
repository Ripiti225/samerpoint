// ──────────────────────────────────────────────────────────────────────────────
// Remplit « FC reçu » avec le fond donné par la Trésorerie (fonds en espèces −
// espèces reprises au restaurant). Le gérant ne peut pas le changer.
// fc_recu_auto = null tant que la Trésorerie n'a pas répondu (hors ligne,
// migration pas passée) : la case reste alors en saisie manuelle.
// Utilisé par Ventes et par le Récapitulatif (avant validation).
// ──────────────────────────────────────────────────────────────────────────────
import { useEffect } from 'react'

import { chargerFondTresorerie } from './fondTresorerieDb'

export function useFondTresorerie({ pointId, restaurantId, dateJour, pointValide, setVentesJour }) {
  useEffect(() => {
    if (!pointId || pointValide || !setVentesJour) return
    let vivant = true
    chargerFondTresorerie({ restaurantId, datePoint: dateJour, pointId }).then(r => {
      if (!vivant || !r) return
      setVentesJour(prev => ({
        ...prev,
        fc_recu: r.montant ? String(r.montant) : '',
        fc_recu_auto: r.montant,
        fc_recu_detail: r.lignes,
      }))
    })
    return () => { vivant = false }
  }, [pointId, restaurantId, dateJour, pointValide])
}
