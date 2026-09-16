/**
 * Retourne uniquement les justificatifs réellement consultables d'un canal.
 * Un montant sans URI n'est pas une « photo manquante » à afficher : le POS
 * ne transmet plus ces images.
 */
export function photosCanalDisponibles(shifts = [], {
  montantChamp,
  photoChamp,
  label,
} = {}) {
  return shifts.flatMap((shift, index) => {
    const montant = Number(shift?.[montantChamp]) || 0
    const uri = shift?.[photoChamp]
    if (montant <= 0 || !uri) return []
    return [{ uri, label: `${label} S${index + 1}`, montant }]
  })
}
