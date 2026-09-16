function nombre(valeur) {
  if (valeur === null || valeur === undefined || valeur === '') return 0
  const n = Number(valeur)
  return Number.isFinite(n) ? n : 0
}

function horodatageShift(shift) {
  const date = shift?.date || '0000-00-00'
  const heure = shift?.heure_fin || shift?.heure_debut || '00:00:00'
  return `${date}T${heure}`
}

export function aggregerStatsCaissiers(shifts) {
  const map = new Map()

  for (const shift of shifts || []) {
    const identite = shift?.caissier_id
      ? `id:${shift.caissier_id}`
      : `nom:${String(shift?.caissier_nom || 'Inconnu').trim().toLowerCase()}`

    if (!map.has(identite)) {
      map.set(identite, {
        id: shift?.caissier_id || null,
        nom: String(shift?.caissier_nom || '').trim() || 'Inconnu',
        nbShifts: 0,
        venteTotal: 0,
        depensesTotal: 0,
        fournisseursTotal: 0,
        especeTotal: 0,
        kdoTotal: 0,
        retourTotal: 0,
        manquantTotal: 0,
        surplusTotal: 0,
        shiftsAvecManquant: 0,
        shiftsSansMesure: 0,
        shifts: [],
      })
    }

    const caissier = map.get(identite)
    caissier.nbShifts += 1
    caissier.venteTotal += nombre(shift?.vente_shift)
    caissier.depensesTotal += nombre(shift?.depenses)
    caissier.fournisseursTotal += nombre(shift?.fournisseurs)
    caissier.especeTotal += nombre(shift?.espece)
    caissier.kdoTotal += nombre(shift?.kdo)
    caissier.retourTotal += nombre(shift?.retour)
    caissier.shifts.push(shift)

    const ecart = resumerEcartShift(shift)
    if (ecart.type === 'manquant') {
      caissier.manquantTotal += ecart.montant
      caissier.shiftsAvecManquant += 1
    } else if (ecart.type === 'surplus') {
      caissier.surplusTotal += ecart.montant
    } else if (ecart.type === 'indisponible') {
      caissier.shiftsSansMesure += 1
    }
  }

  return [...map.values()]
    .map(caissier => ({
      ...caissier,
      venteTotal: Math.round(caissier.venteTotal),
      depensesTotal: Math.round(caissier.depensesTotal),
      fournisseursTotal: Math.round(caissier.fournisseursTotal),
      especeTotal: Math.round(caissier.especeTotal),
      kdoTotal: Math.round(caissier.kdoTotal),
      retourTotal: Math.round(caissier.retourTotal),
      manquantTotal: Math.round(caissier.manquantTotal),
      surplusTotal: Math.round(caissier.surplusTotal),
      venteMoyenne: caissier.nbShifts > 0
        ? Math.round(caissier.venteTotal / caissier.nbShifts)
        : 0,
      shifts: [...caissier.shifts].sort((a, b) => horodatageShift(b).localeCompare(horodatageShift(a))),
    }))
    .sort((a, b) => b.venteTotal - a.venteTotal)
}

export function resumerEcartShift(shift) {
  const brut = shift?.ecart_pos
  const explication = String(shift?.explication_ecart ?? '').trim() || null
  if (brut === null || brut === undefined || brut === '') {
    return { type: 'indisponible', montant: null, explication }
  }

  const ecart = Number(brut)
  if (!Number.isFinite(ecart)) return { type: 'indisponible', montant: null, explication }
  if (ecart < 0) return { type: 'manquant', montant: Math.abs(ecart), explication }
  if (ecart > 0) return { type: 'surplus', montant: ecart, explication }
  return { type: 'equilibre', montant: 0, explication }
}

export function choisirInventaireShift(shift, inventaires) {
  if (!shift?.point_id || !shift?.caissier_id) return null
  const candidats = (inventaires || [])
    .filter(inventaire =>
      String(inventaire?.point_id || '') === String(shift.point_id) &&
      String(inventaire?.caissier_id || '') === String(shift.caissier_id)
    )
    .sort((a, b) => String(b?.created_at || '').localeCompare(String(a?.created_at || '')))

  if (candidats.length === 0) return null

  const memeService = shift.pos_service_id && candidats.find(inventaire =>
    String(inventaire.pos_service_id || '') === String(shift.pos_service_id)
  )
  if (memeService) return memeService

  const memeType = shift.type_shift && candidats.find(inventaire => inventaire.type_shift === shift.type_shift)
  if (memeType) return memeType

  const debut = String(shift.heure_debut || '').slice(0, 5)
  const memeHeure = debut && candidats.find(inventaire => String(inventaire.heure_debut || '').slice(0, 5) === debut)
  return memeHeure || candidats[0]
}

export function resumerInventaire(inventaire) {
  const lignes = inventaire?.inventaire_lignes || []
  const lignesEcart = lignes.flatMap(ligne => {
    const stockInitial = nombre(ligne?.stock_initial)
    const entrees = nombre(ligne?.entrees)
    const sorties = nombre(ligne?.sorties)
    const stockAttendu = stockInitial + entrees - sorties
    const stockReel = nombre(ligne?.stock_reel)
    const ecartBrut = ligne?.ecart
    const ecart = ecartBrut === null || ecartBrut === undefined || ecartBrut === ''
      ? stockReel - stockAttendu
      : nombre(ecartBrut)
    const explication = String(ligne?.explication ?? '').trim() || null
    const montantDeduit = nombre(ligne?.montant_deduit)

    if (ecart === 0 && !explication && montantDeduit === 0) return []
    return [{
      produitId: ligne?.produit_id || null,
      produitNom: ligne?.produit_nom || ligne?.produit_id || 'Produit',
      stockAttendu,
      stockReel,
      ecart,
      nombreExplique: nombre(ligne?.nombre_explique),
      explication,
      montantDeduit,
    }]
  })

  return {
    nbProduits: lignes.length,
    nbEcarts: lignesEcart.length,
    montantADeduire: nombre(inventaire?.montant_a_deduire),
    lignesEcart,
  }
}
