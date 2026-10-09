// Détail des KDO d'un shift caissier : produits offerts et explication saisie
// au POS, pour l'écran « Point caissier ».
//
// Les lignes brutes viennent de la fonction `kdo_services` du cloud POS
// (pos_cloud_kdo_services.sql) : une ligne par commande offerte payée.
// Aucun accès réseau ici — lecture : lib/statsPOSDb.js (chargerKdoServices).
//
// Import avec l'extension `.js` : le module doit rester chargeable tel quel
// par `node lib/kdoPOS.test.mjs`, comme les autres modules purs.

const nombre = (v) => Number(v) || 0

// Abidjan est à l'heure UTC toute l'année : l'heure UTC est l'heure locale.
function heureCommande(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

// Un supplément peut arriver en texte ou en objet { nom, prix } selon la caisse.
function nomSupplement(s) {
  if (typeof s === 'string') return s
  return s?.nom || s?.libelle || ''
}

function versArticle(a) {
  const supplements = (Array.isArray(a?.supplements) ? a.supplements : [])
    .map(nomSupplement).filter(Boolean)
  return {
    nom: String(a?.nom || 'Article').trim(),
    qte: nombre(a?.qte) || 1,
    montant: nombre(a?.qte || 1) * nombre(a?.prix),
    supplements,
  }
}

/**
 * Range les commandes offertes par service POS, dans l'ordre de l'heure.
 * Renvoie { [serviceId]: [{ ticket, heure, total, motif, articles }] }.
 * Un motif vide devient null : l'écran affiche alors « Aucune explication ».
 */
export function grouperKdoParService(lignes) {
  const parService = {}
  for (const l of Array.isArray(lignes) ? lignes : []) {
    if (!l?.service) continue
    const liste = parService[l.service] || (parService[l.service] = [])
    liste.push({
      ticket: l.ticket ?? null,
      heure: heureCommande(l.heure),
      horodatage: String(l.heure || ''),
      total: nombre(l.total),
      motif: String(l.motif || '').trim() || null,
      articles: (Array.isArray(l.articles) ? l.articles : []).map(versArticle),
    })
  }
  for (const liste of Object.values(parService)) {
    liste.sort((a, b) => a.horodatage.localeCompare(b.horodatage))
  }
  return parService
}

/**
 * Ce que l'écran affiche pour le KDO d'un shift.
 *  - origine 'pos'    : shift venu du POS, commandes détaillées disponibles ;
 *  - origine 'manuel' : saisi à la main (avant la bascule POS), pas de détail.
 * `ecart` = montant KDO du shift − somme des commandes trouvées (0 attendu) :
 * non nul si une commande offerte a été modifiée après la clôture.
 */
export function detailKdoShift(shift, parService) {
  const montant = nombre(shift?.kdo)
  const serviceId = shift?.pos_service_id
  if (!serviceId) return { montant, origine: 'manuel', commandes: [], ecart: 0 }
  const commandes = parService?.[serviceId] || []
  const somme = commandes.reduce((s, c) => s + c.total, 0)
  return { montant, origine: 'pos', commandes, ecart: montant - somme }
}
