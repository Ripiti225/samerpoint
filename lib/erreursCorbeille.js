const CODES_TABLE_ABSENTE = new Set(['42P01', 'PGRST205'])

/**
 * Vrai seulement lorsque la table de corbeille n'existe réellement pas.
 *
 * Les erreurs RLS et de contrainte citent elles aussi
 * `suppressions_archive` dans leur message : le nom de la table seul ne
 * suffit donc pas pour conclure que la migration manque.
 */
export function estTableCorbeilleManquante(error) {
  if (CODES_TABLE_ABSENTE.has(error?.code)) return true

  const message = error?.message || ''
  return /could not find the table[^\n]*suppressions_archive[^\n]*schema cache/i.test(message)
    || /relation ["']?(?:public\.)?suppressions_archive["']? does not exist/i.test(message)
}
