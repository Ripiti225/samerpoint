const MESSAGES = {
  LITIGE_DEJA_TRAITE: 'Ce litige a déjà été traité',
  LITIGE_INTROUVABLE: 'Litige introuvable',
  SHIFT_SORTANT_ABSENT: 'Le shift du caissier sortant n’est pas encore arrivé. Réessayez plus tard.',
  SHIFT_PLACE_ABSENT: 'Le shift du caissier sur place n’est pas encore arrivé. Réessayez plus tard.',
  PRIX_PRODUIT_INCONNU: 'Le prix de ce produit est inconnu : impossible de calculer la retenue.',
}

export function messageLitigeStock(erreur) {
  const message = erreur?.message || ''
  for (const [code, texte] of Object.entries(MESSAGES)) {
    if (message.includes(code)) return texte
  }
  if (/PGRST202|does not exist/.test(message)) {
    return 'Script supabase_correction_stock_initial.sql non passé dans Supabase.'
  }
  return message || 'Décision impossible'
}
