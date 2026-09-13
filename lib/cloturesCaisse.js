// Contrat d'affichage des clôtures de caisse reçues du POS.
//
// `ecart_reconciliation` est la copie exacte de `rapport_z.diff` : c'est
// l'indicateur global officiel. `ecart_pos` vient du comptage du tiroir
// (`services_caisse.ecart`) et reste un détail espèces séparé. Aucune fonction
// de ce module ne remplace le premier par le second.

function entierOuNull(valeur) {
  if (valeur === null || valeur === undefined || valeur === '') return null
  const nombre = Number(valeur)
  return Number.isSafeInteger(nombre) ? nombre : null
}

export function formaterMontantSigneFCFA(valeur) {
  const montant = entierOuNull(valeur)
  if (montant === null) return 'Non disponible'
  const absolu = Math.abs(montant).toLocaleString('fr-FR').replace(/\s/g, ' ')
  if (montant > 0) return `+${absolu} FCFA`
  if (montant < 0) return `-${absolu} FCFA`
  return '0 FCFA'
}

function estCloturePOS(service) {
  const aIdentifiantPOS = service?.pos_service_id !== null && service?.pos_service_id !== undefined
    && service?.pos_service_id !== ''
  const aReconciliation = service?.ecart_reconciliation !== null
    && service?.ecart_reconciliation !== undefined && service?.ecart_reconciliation !== ''
  return service?.valide === true && (aIdentifiantPOS || aReconciliation)
}

function dedupliquerClotures(services) {
  const uniques = new Map()
  for (const service of services || []) {
    if (!estCloturePOS(service)) continue
    const cle = service.pos_service_id ? `pos:${service.pos_service_id}` : `shift:${service.id}`
    if (!uniques.has(cle)) uniques.set(cle, service)
  }
  return [...uniques.values()]
}

export function cloturesPOS(services) {
  return dedupliquerClotures(services).map(service => {
    const ecartGlobal = entierOuNull(service.ecart_reconciliation)
    const ecartEspeces = entierOuNull(service.ecart_pos)
    return {
      ...service,
      ecartGlobal,
      ecartGlobalTexte: formaterMontantSigneFCFA(ecartGlobal),
      ecartEspeces,
      ecartEspecesTexte: formaterMontantSigneFCFA(ecartEspeces),
    }
  })
}

export function resumerEcartsGlobaux(services) {
  const clotures = cloturesPOS(services)
  const disponibles = clotures.filter(c => c.ecartGlobal !== null)
  const total = disponibles.length
    ? disponibles.reduce((somme, c) => somme + c.ecartGlobal, 0)
    : null
  return {
    total,
    totalTexte: formaterMontantSigneFCFA(total),
    disponibles: disponibles.length,
    indisponibles: clotures.length - disponibles.length,
    clotures: clotures.length,
  }
}

export function resumerEcartsEspeces(services) {
  const disponibles = cloturesPOS(services).filter(c => c.ecartEspeces !== null)
  return disponibles.length
    ? disponibles.reduce((somme, c) => somme + c.ecartEspeces, 0)
    : null
}
