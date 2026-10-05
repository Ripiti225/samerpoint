import Constants from 'expo-constants'
import { comptesConnectables } from './comptesTechniques'
import { verifierAlertesTresorerie } from './alertesDb'
import { supabase } from './supabase'
import { chargerDerniersRestes } from './derniersRestesFournisseurs'
import {
  cacheFournisseurs, cachePoint, cacheRestaurants, cacheTravailleurs, cacheUtilisateurs,
  getCachedFournisseurs, getCachedPoint, getCachedRestaurants, getCachedTravailleurs, getCachedUtilisateurs,
} from './offlineCache'
import { enqueueOperation } from './offlineQueue'
import { isOnlineNow } from './networkStatus'
import { journaliser, ACTIONS } from './journal'
import { logErreur } from './logErreur'
import { ROLES_GLOBAUX } from './constants'

export async function getOrCreatePoint(date, gerantId, restaurantId) {
  if (!isOnlineNow()) {
    const cached = await getCachedPoint(restaurantId, date)
    return cached || null
  }
  const { data: existing } = await supabase
    .from('points')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .eq('date', date)
    .single()

  if (existing) {
    await cachePoint(restaurantId, date, existing)
    return existing
  }

  const { data: created, error } = await supabase
    .from('points')
    .insert({
      restaurant_id: restaurantId,
      date,
      gerant_id: gerantId,
      valide: false,
    })
    .select()
    .single()

  if (error) { logErreur('getOrCreatePoint', error); return null }
  if (created) await cachePoint(restaurantId, date, created)
  return created
}

export async function getDepenses(pointId) {
  const { data } = await supabase
    .from('depenses')
    .select('*')
    .eq('point_id', pointId)
    .order('created_at')
  return data || []
}

export async function saveDepenses(pointId, depensesJour, saisiPar = 'caissier', caissierNom = null, restaurantId = null) {
  if (!isOnlineNow()) {
    await enqueueOperation('saveDepenses', [pointId, depensesJour, saisiPar, caissierNom, restaurantId])
    return
  }
  // Supprimer uniquement les dépenses du même type (et du même caissier si applicable)
  let delDepQ = supabase.from('depenses').delete()
    .eq('point_id', pointId)
    .eq('saisi_par', saisiPar)
  if (caissierNom) delDepQ = delDepQ.eq('caissier_nom', caissierNom)
  await delDepQ

  const lignes = []
  Object.entries(depensesJour).forEach(([categorie, items]) => {
    items.forEach(item => {
      if (item.montant && parseFloat(item.montant) > 0) {
        lignes.push({
          point_id: pointId,
          categorie,
          libelle: item.libelle || '',
          montant: parseFloat(item.montant) || 0,
          saisi_par: saisiPar,
          caissier_nom: caissierNom,
        })
      }
    })
  })
  if (lignes.length > 0) {
    await supabase.from('depenses').insert(lignes)
  }
  const totalDepenses = lignes.reduce((s, l) => s + (l.montant || 0), 0)
  journaliser(ACTIONS.DEPENSES_SAUVEGARDEES, {
    nb_lignes: lignes.length,
    montant_total: totalDepenses,
    categories: [...new Set(lignes.map(l => l.categorie))].join(', ') || '—',
    saisi_par: saisiPar,
    caissier: caissierNom || '—',
  }, { pointId, restaurantId }).catch(() => {})
}

export async function getPresences(pointId) {
  const { data } = await supabase
    .from('presences')
    .select('*')
    .eq('point_id', pointId)
  return data || []
}

export async function savePresences(pointId, travailleurs, presencesJour, paiesJour, restaurantId = null) {
  if (!isOnlineNow()) {
    await enqueueOperation('savePresences', [pointId, travailleurs, presencesJour, paiesJour, restaurantId])
    return
  }
  await supabase.from('presences').delete().eq('point_id', pointId)
  const lignes = travailleurs
    .filter(t => presencesJour[t.id])
    .map(t => ({
      point_id: pointId,
      travailleur_id: t.id,
      travailleur_nom: t.nom,
      statut: presencesJour[t.id] || 'Absent',
      paye: parseFloat(paiesJour[t.id]) || 0,
    }))
  if (lignes.length > 0) {
    await supabase.from('presences').insert(lignes)
  }
  journaliser(ACTIONS.PRESENCES_SAUVEGARDEES, {
    nb_presences: lignes.length,
    total_paye: lignes.reduce((s2, l) => s2 + (l.paye || 0), 0),
  }, { pointId, restaurantId }).catch(() => {})
}

export async function getCommandes(pointId, userId = null) {
  try {
    let q = supabase.from('commandes').select('*').eq('point_id', pointId)
    if (userId) q = q.eq('caissier_id', userId)
    const { data } = await q
    return data || []
  } catch (_) {
    const { data } = await supabase.from('commandes').select('*').eq('point_id', pointId)
    return data || []
  }
}

export async function saveCommandes(pointId, livraisonsJour, userId = null, restaurantId = null) {
  if (!isOnlineNow()) {
    await enqueueOperation('saveCommandes', [pointId, livraisonsJour, userId, restaurantId])
    return
  }
  // Supprimer uniquement les commandes de ce caissier pour ne pas écraser les autres shifts
  let delQ = supabase.from('commandes').delete().eq('point_id', pointId)
  if (userId) delQ = delQ.eq('caissier_id', userId)
  await delQ
  const lignes = []
  Object.entries(livraisonsJour).forEach(([partenaire, items]) => {
    items.forEach(item => {
      lignes.push({
        point_id: pointId,
        caissier_id: userId || null,
        partenaire,
        numero_commande: item.numero || '',
        contact_client: item.contact || '',
        plat: item.plat || '',
      })
    })
  })
  if (lignes.length > 0) {
    await supabase.from('commandes').insert(lignes)
  }
  journaliser(ACTIONS.LIVRAISONS_SAUVEGARDEES, {
    nb_commandes: lignes.length,
    partenaires: [...new Set(lignes.map(l => l.partenaire))].join(', ') || '—',
  }, { pointId, restaurantId }).catch(() => {})
}

export async function getTransactionsFournisseurs(pointId) {
  const { data } = await supabase
    .from('transactions_fournisseurs')
    .select('*')
    .eq('point_id', pointId)
  return data || []
}

export async function saveTransactionsFournisseurs(pointId, fournisseursJour, creditsVeille = {}, saisiPar = 'gerant', restaurantId = null, caissierNom = null) {
  if (!isOnlineNow()) {
    await enqueueOperation('saveTransactionsFournisseurs', [pointId, fournisseursJour, creditsVeille, saisiPar, restaurantId, caissierNom])
    return
  }

  const fournIds = Object.keys(fournisseursJour).filter(id => {
    const t = fournisseursJour[id]
    if (t.saved) return false // déjà enregistré via l'écran fournisseurs → ne pas ré-insérer (doublon)
    return (parseFloat(t.facture) || 0) || (parseFloat(t.paye) || 0)
  })
  if (fournIds.length === 0) return

  // Lire les noms des fournisseurs
  const { data: fournData } = await supabase
    .from('fournisseurs').select('id, nom').in('id', fournIds)
  const nomDb = {}
  ;(fournData || []).forEach(f => { nomDb[f.id] = f.nom || null })

  // ── Lire TOUTES les transactions du point courant (tous caissiers) en une seule requête ──
  // Permet à la fois le backup anti-double-comptage et le report de crédit inter-shifts
  const { data: allCurrentTrans } = await supabase
    .from('transactions_fournisseurs')
    .select('*').eq('point_id', pointId)

  const isOwnTrans = t => t.saisi_par === saisiPar && (!caissierNom || t.caissier_nom === caissierNom)
  const backup = (allCurrentTrans || []).filter(isOwnTrans)
  const otherShiftTrans = (allCurrentTrans || []).filter(t => !isOwnTrans(t))

  // Anti-double-comptage : back-calculer le crédit d'origine avant toute sauvegarde précédente
  const creditOriginalBackup = {}
  backup.forEach(t => {
    creditOriginalBackup[t.fournisseur_id] = (t.reste || 0) - (t.facture || 0) + (t.paye || 0)
  })

  // Report inter-shifts (même journée, autre caissier) : prendre le reste le plus récent
  const creditSameDay = {}
  const latestSameDay = {}
  otherShiftTrans.forEach(t => {
    const ex = latestSameDay[t.fournisseur_id]
    if (!ex || t.created_at > ex.created_at) latestSameDay[t.fournisseur_id] = t
  })
  Object.entries(latestSameDay).forEach(([id, t]) => { creditSameDay[id] = t.reste })

  // Crédit depuis le point précédent (jour précédent, par date de journée)
  // Lecture paginée : non paginée, elle était coupée à 1 000 lignes.
  const creditDb = {}
  const prevMap = await chargerDerniersRestes(supabase, fournIds, pointId)
  Object.entries(prevMap).forEach(([id, info]) => { creditDb[id] = info.reste })

  // IMPORTANT : ne supprimer QUE les fournisseurs qu'on s'apprête à réinsérer
  // (fournIds). Un DELETE large effaçait les factures des fournisseurs absents
  // de l'état courant → factures qui « disparaissent » et crédit cumulatif faussé.
  let delQ = supabase.from('transactions_fournisseurs')
    .delete().eq('point_id', pointId).eq('saisi_par', saisiPar)
    .in('fournisseur_id', fournIds)
  if (caissierNom) delQ = delQ.eq('caissier_nom', caissierNom)
  await delQ

  const lignes = fournIds.map(fournisseurId => {
    const t = fournisseursJour[fournisseurId]
    // Priorité crédit :
    // 1. backup (anti-double-comptage si saveOneTransactionFournisseur a déjà tourné)
    // 2. autre caissier du même jour (enchaînement inter-shifts)
    // 3. jour précédent (par date de journée, insensible à l'ordre de saisie)
    // 4. creditsVeille passé en paramètre (fallback)
    const credit = creditOriginalBackup[fournisseurId] !== undefined
      ? creditOriginalBackup[fournisseurId]
      : (creditSameDay[fournisseurId] ?? creditDb[fournisseurId] ?? creditsVeille[fournisseurId] ?? 0)
    const facture = parseFloat(t.facture) || 0
    const paye = parseFloat(t.paye) || 0
    return { point_id: pointId, fournisseur_id: fournisseurId, fournisseur_nom: nomDb[fournisseurId] || null, source: saisiPar, restaurant_id: restaurantId || null, facture, paye, reste: credit + facture - paye, photo_url: t.photoUri || null, saisi_par: saisiPar, caissier_nom: caissierNom || null }
  })

  const { error: insertErr } = await supabase.from('transactions_fournisseurs').insert(lignes)
  if (insertErr) {
    logErreur('saveTransactionsFournisseurs.insert', insertErr)
    // Restaurer UNIQUEMENT les lignes réellement supprimées (fournIds) pour
    // éviter la perte de données — sans dupliquer les fournisseurs non touchés.
    const restaurables = (backup || []).filter(t => fournIds.includes(t.fournisseur_id))
    if (restaurables.length) {
      const toRestore = restaurables.map(({ point_id, fournisseur_id, fournisseur_nom, source,
        restaurant_id, facture, paye, reste, photo_url, saisi_par, caissier_nom, caissier_id }) => ({
        point_id, fournisseur_id, fournisseur_nom, source,
        restaurant_id, facture, paye, reste, photo_url, saisi_par, caissier_nom, caissier_id,
      }))
      await supabase.from('transactions_fournisseurs').insert(toRestore)
    }
    return
  }

  // Journal : UNE entrée par sauvegarde, avec le détail de chaque fournisseur
  // dans un tableau de lignes lisibles (l'écran Journal les affiche l'une sous
  // l'autre). Une entrée par fournisseur ferait grossir le journal d'environ
  // 2 200 lignes par mois pour la même information.
  const fmtF = n => Math.round(n || 0).toLocaleString('fr-FR') + ' F'
  journaliser(ACTIONS.FOURNISSEURS_SAUVEGARDES, {
    nb_fournisseurs: lignes.length,
    total_factures: lignes.reduce((s, l) => s + (l.facture || 0), 0),
    total_paye: lignes.reduce((s, l) => s + (l.paye || 0), 0),
    total_credit_restant: lignes.reduce((s, l) => s + (l.reste || 0), 0),
    saisi_par: saisiPar,
    caissier: caissierNom || '—',
    fournisseurs: lignes.map(l =>
      `${l.fournisseur_nom || 'Fournisseur inconnu'} — 📥 ${fmtF(l.facture)} · 📤 ${fmtF(l.paye)} · 💳 reste ${fmtF(l.reste)}`),
  }, { pointId, restaurantId, userNom: caissierNom || null }).catch(() => {})

  // Mettre à jour credit_actuel pour TOUTE saisie (gérant ET caissier) : le solde
  // officiel doit toujours refléter la dernière transaction, sinon l'écran Crédits
  // fournisseurs reste figé jusqu'à un « Fix » manuel.
  for (const ligne of lignes) {
    await supabase.from('fournisseurs')
      .update({ credit_actuel: ligne.reste })
      .eq('id', ligne.fournisseur_id)
  }

  // Enregistrer dans historique_credit_fournisseurs
  if (restaurantId && lignes.length > 0) {
    const today = new Date().toISOString().split('T')[0]
    const motifPrefix = `${saisiPar}|${today}|`
    for (const ligne of lignes) {
      await supabase.from('historique_credit_fournisseurs')
        .delete()
        .eq('fournisseur_id', ligne.fournisseur_id)
        .eq('restaurant_id', restaurantId)
        .like('motif', `${motifPrefix}%`)
    }
    const histoLignes = lignes.map(l => ({
      fournisseur_id: l.fournisseur_id,
      restaurant_id: restaurantId,
      point_id: pointId,
      source: saisiPar,
      ancien_credit: l.reste - l.facture + l.paye,
      nouveau_credit: l.reste,
      facture: l.facture,
      paye: l.paye,
      photo_url: l.photo_url || null,
      motif: `${motifPrefix}facture ${Math.round(l.facture).toLocaleString('fr-FR')} FCFA, payé ${Math.round(l.paye).toLocaleString('fr-FR')} FCFA`,
    }))
    const { error: histoErr } = await supabase.from('historique_credit_fournisseurs').insert(histoLignes)
    if (histoErr) logErreur('saveTransactionsFournisseurs.historique', histoErr)
  }
}

export async function getSequences(pointId) {
  const { data } = await supabase
    .from('sequences')
    .select('*')
    .eq('point_id', pointId)
    .order('numero')
  return data || []
}

export async function saveSequences(pointId, sequences) {
  if (!isOnlineNow()) {
    await enqueueOperation('saveSequences', [pointId, sequences])
    return
  }
  await supabase.from('sequences').delete().eq('point_id', pointId)
  const lignes = sequences
    .filter(s => s.montant && parseFloat(s.montant) > 0)
    .map((s, i) => ({
      point_id: pointId,
      numero: i + 1,
      montant: parseFloat(s.montant) || 0,
      photo_url: s.photo_url || null,
    }))
  if (lignes.length > 0) {
    await supabase.from('sequences').insert(lignes)
  }
}

export async function getDatesValidees(restaurantId) {
  const { data } = await supabase
    .from('points')
    .select('date')
    .eq('restaurant_id', restaurantId)
    .eq('valide', true)
  return (data || []).map(p => p.date)
}

export async function validerPoint(pointId, totaux, contexte = {}) {
  // La validation ne fonctionne qu'en ligne (opération critique)
  if (!isOnlineNow()) return false
  const { error } = await supabase
    .from('points')
    .update({ ...totaux, valide: true })
    .eq('id', pointId)
  if (!error) {
    journaliser(ACTIONS.POINT_VALIDE, {
      restaurant: contexte.restaurantNom || '—',
      date_point: contexte.dateJour || '—',
      vente_total: totaux.vente_total,
      depense_total: totaux.depense_total,
      benefice_sc: totaux.benefice_sc,
    }, { ...contexte, pointId }).catch(() => {})
    // Alertes trésorerie (déficit, CNPS, fond bas) : vérifiées après chaque
    // validation, en arrière-plan. Ne bloque jamais la validation.
    verifierAlertesTresorerie().catch(() => {})
  }
  return !error
}

export async function updatePoint(pointId, data) {
  if (!isOnlineNow()) {
    await enqueueOperation('updatePoint', [pointId, data])
    return true
  }
  const { error } = await supabase
    .from('points')
    .update(data)
    .eq('id', pointId)
  return !error
}

export async function getPointsPeriode(restaurantId, dateDebut, dateFin) {
  const { data } = await supabase
    .from('points')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .eq('valide', true)
    .gte('date', dateDebut)
    .lte('date', dateFin)
    .order('date')
  return data || []
}

// Dépenses des points validés d'une période, avec leur catégorie (pour Food/Labor/Prime Cost)
export async function getDepensesPeriode(restaurantId, dateDebut, dateFin) {
  const { data: points } = await supabase
    .from('points')
    .select('id')
    .eq('restaurant_id', restaurantId)
    .eq('valide', true)
    .gte('date', dateDebut)
    .lte('date', dateFin)
  const pointIds = (points || []).map(p => p.id)
  if (!pointIds.length) return []

  const { data: depenses } = await supabase
    .from('depenses')
    .select('point_id, categorie, montant')
    .in('point_id', pointIds)
  return depenses || []
}

// Présences des points validés d'une période (pour absentéisme — pilier 5)
export async function getPresencesPeriode(restaurantId, dateDebut, dateFin) {
  const { data: points } = await supabase
    .from('points')
    .select('id, date')
    .eq('restaurant_id', restaurantId)
    .eq('valide', true)
    .gte('date', dateDebut)
    .lte('date', dateFin)
  const pointIds = (points || []).map(p => p.id)
  if (!pointIds.length) return []
  const dateByPoint = {}
  points.forEach(p => { dateByPoint[p.id] = p.date })

  const { data: presences } = await supabase
    .from('presences')
    .select('point_id, travailleur_id, statut, paye')
    .in('point_id', pointIds)
  return (presences || []).map(p => ({ ...p, date: dateByPoint[p.point_id] }))
}

// Paiements fournisseurs des points validés d'une période, avec nom du fournisseur
export async function getFournisseursPeriodePaye(restaurantId, dateDebut, dateFin) {
  const { data: pts } = await supabase
    .from('points')
    .select('id')
    .eq('restaurant_id', restaurantId)
    .eq('valide', true)
    .gte('date', dateDebut)
    .lte('date', dateFin)
  const pointIds = (pts || []).map(p => p.id)
  if (!pointIds.length) return []

  const { data: txs } = await supabase
    .from('transactions_fournisseurs')
    .select('paye, fournisseurs(nom)')
    .in('point_id', pointIds)
  return (txs || []).map(t => ({ paye: t.paye || 0, nom: t.fournisseurs?.nom?.trim() || '' }))
}

// Somme des paies gérant (draft_gerant.paies) des points validés d'une période
export async function getPaiesGerantPeriode(restaurantId, dateDebut, dateFin) {
  const { data: pts } = await supabase
    .from('points')
    .select('draft_gerant')
    .eq('restaurant_id', restaurantId)
    .eq('valide', true)
    .gte('date', dateDebut)
    .lte('date', dateFin)
  let total = 0
  for (const p of pts || []) {
    const draft = p.draft_gerant
    const paies = (typeof draft === 'string' ? JSON.parse(draft) : draft)?.paies || []
    total += paies.reduce((sum, l) => sum + (parseFloat(l.montant) || 0), 0)
  }
  return total
}

export async function saveOneTransactionFournisseur(pointId, fournisseurId, transaction, creditVeille = 0, saisiPar = 'gerant', caissierNom = null, restaurantId = null, caissierUserId = null, fournisseurNom = null, source = null) {
  const facture = parseFloat(transaction.facture) || 0
  const paye = parseFloat(transaction.paye) || 0

  // Garde-fou : facture ET payé à 0 → ne rien faire (ni delete, ni insert).
  // Évite d'effacer une transaction déjà enregistrée quand on sauvegarde un
  // fournisseur laissé vide.
  if (!facture && !paye) return true

  if (!isOnlineNow()) {
    await enqueueOperation('saveOneTransactionFournisseur', [pointId, fournisseurId, transaction, creditVeille, saisiPar, caissierNom, restaurantId, caissierUserId, fournisseurNom, source])
    return true
  }

  // Appel RPC atomique (delete + insert en une transaction SQL)
  const { error: rpcError } = await supabase.rpc('upsert_transaction_fournisseur', {
    p_point_id: pointId,
    p_fournisseur_id: fournisseurId,
    p_saisi_par: saisiPar,
    p_caissier_nom: caissierNom || null,
    p_facture: facture,
    p_paye: paye,
    p_reste: creditVeille + facture - paye,
    p_fournisseur_nom: fournisseurNom || null,
    p_restaurant_id: restaurantId || null,
    p_caissier_id: caissierUserId || null,
    p_photo_url: transaction.photoUri || null,
    p_source: source || saisiPar,
  })

  if (!rpcError) return true

  // Fallback si le RPC n'existe pas encore — delete + insert classique.
  // PGRST202 = fonction absente du schéma : cas attendu tant que le RPC n'est
  // pas déployé, on ne log donc PAS pour éviter de saturer erreurs_client à
  // chaque sauvegarde. Tout autre échec RPC est en revanche remonté.
  if (rpcError.code !== 'PGRST202') {
    logErreur('saveOneTransactionFournisseur.rpc', rpcError, { pointId, fournisseurId })
  }

  let delQ = supabase.from('transactions_fournisseurs')
    .delete()
    .eq('point_id', pointId)
    .eq('fournisseur_id', fournisseurId)
    .eq('saisi_par', saisiPar)
  if (caissierNom) delQ = delQ.eq('caissier_nom', caissierNom)
  await delQ

  if (!facture && !paye) return true

  const { error } = await supabase.from('transactions_fournisseurs').insert({
    point_id: pointId,
    fournisseur_id: fournisseurId,
    fournisseur_nom: fournisseurNom || null,
    source: source || saisiPar,
    restaurant_id: restaurantId,
    caissier_id: caissierUserId,
    facture,
    paye,
    reste: creditVeille + facture - paye,
    photo_url: transaction.photoUri || null,
    saisi_par: saisiPar,
    caissier_nom: caissierNom,
  })
  if (error) { logErreur('saveOneTransactionFournisseur.insert_fallback', error); return false }
  return true
}

export async function getInventaireShifts(pointId) {
  const { data } = await supabase
    .from('inventaires')
    .select('*')
    .eq('point_id', pointId)
    .order('shift_numero')
  return data || []
}

export async function saveInventaireShift(pointId, shift, stocks, categories) {
  if (!isOnlineNow()) {
    await enqueueOperation('saveInventaireShift', [pointId, shift, stocks, categories])
    return true
  }
  await supabase.from('inventaires')
    .delete()
    .eq('point_id', pointId)
    .eq('shift_numero', shift.numero)

  const lignes = []
  categories.forEach(cat => {
    cat.produits.forEach(p => {
      const s = stocks[p.id]
      if (s && (s.initial || s.entrees || s.sorties || s.final)) {
        const initial = parseFloat(s.initial) || 0
        const entrees = parseFloat(s.entrees) || 0
        const sorties = parseFloat(s.sorties) || 0
        const final = parseFloat(s.final) || 0
        lignes.push({
          point_id: pointId,
          produit_id: p.id,
          produit_nom: p.nom,
          stock_initial: initial,
          entrees,
          sorties,
          stock_final: final,
          ecart: final - (initial + entrees - sorties),
          prevision: parseFloat(s.prevision) || 0,
          shift_numero: shift.numero,
          shift_nom: shift.nom,
          heure_debut: shift.heure_debut,
          heure_fin: shift.heure_fin,
        })
      }
    })
  })

  if (lignes.length > 0) {
    const { error } = await supabase.from('inventaires').insert(lignes)
    if (error) { logErreur('saveInventaireShift', error); return false }
  }
  journaliser(ACTIONS.INVENTAIRE_SAUVEGARDE, { shift: shift.nom, nb_produits: lignes.length }, { pointId }).catch(() => {})
  return true
}
// ─── Fonctions avec cache offline ──────────────────────────────────────────

export async function getRestaurants() {
  if (!isOnlineNow()) {
    const cached = await getCachedRestaurants()
    return cached || []
  }
  // `source_point` décide si le caissier saisit ici ou dans le POS. Il voyage
  // avec la fiche restaurant, donc il est aussi dans le cache hors ligne :
  // une coupure réseau ne fait jamais « oublier » qu'un site est basculé.
  const quete = (cols) => supabase
    .from('restaurants')
    .select(cols)
    .order('nom')

  let { data, error } = await quete('id, nom, localisation, couleur, photo_url, pin, source_point')
  // Repli si la migration supabase_pos_bascule.sql n'est pas encore passée :
  // sans la colonne, tous les sites restent en SAMTRACKLY (cf. lib/sourcePoint.js).
  if (error) ({ data, error } = await quete('id, nom, localisation, couleur, photo_url, pin'))

  if (error) logErreur('getRestaurants', error)
  const result = data || []
  await cacheRestaurants(result)
  return result
}

export async function getUtilisateurs(restaurantId) {
  if (!isOnlineNow()) {
    const cached = await getCachedUtilisateurs(restaurantId)
    return cached || []
  }
  const { data } = await supabase
    .from('utilisateurs')
    .select('id, nom, role, actif, restaurant_id, pin, restaurants(id, nom)')
    .eq('actif', true)
    .or(`restaurant_id.eq.${restaurantId},restaurant_id.is.null`)
    .order('nom')
  const result = comptesConnectables(data)
  await cacheUtilisateurs(restaurantId, result)
  return result
}

export async function getUtilisateursGlobaux() {
  if (!isOnlineNow()) {
    const cached = await getCachedUtilisateurs('global')
    return cached || []
  }
  const { data } = await supabase
    .from('utilisateurs')
    .select('id, nom, role, actif, restaurant_id, pin')
    .eq('actif', true)
    .in('role', ROLES_GLOBAUX)
    .order('nom')
  const vus = new Set()
  const uniques = (data || []).filter(u => {
    const cle = `${u.nom.trim().toLowerCase()}-${u.role}`
    if (vus.has(cle)) return false
    vus.add(cle)
    return true
  })
  await cacheUtilisateurs('global', uniques)
  return uniques
}

export async function getTravailleurs(restaurantId) {
  if (!isOnlineNow()) {
    const cached = await getCachedTravailleurs(restaurantId)
    return cached || []
  }
  const { data } = await supabase
    .from('travailleurs')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .eq('actif', true)
    .order('nom')
  const result = data || []
  await cacheTravailleurs(restaurantId, result)
  return result
}

export async function getFournisseurs(restaurantId) {
  if (!isOnlineNow()) {
    const cached = await getCachedFournisseurs(restaurantId)
    return cached || []
  }
  const { data } = await supabase
    .from('fournisseurs')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .eq('actif', true)
    .order('nom')
  const result = data || []
  await cacheFournisseurs(restaurantId, result)
  return result
}

// Sauvegarde d'une présence individuelle (depuis presences.js)
// caissierIdParam : userId du caissier — permet plusieurs entrées par employé (multi-shifts)
export async function saveOnePresence(pointId, travailleurId, travailleurNom, statut, paye,
  shiftNom, heureDebut, heureFin, presenceId, utilisateurId, restaurantId, dateJour, caissierIdParam) {
  if (!isOnlineNow()) {
    await enqueueOperation('saveOnePresence', [
      pointId, travailleurId, travailleurNom, statut, paye,
      shiftNom, heureDebut, heureFin, presenceId, utilisateurId, restaurantId, dateJour, caissierIdParam,
    ])
    return { queued: true }
  }

  if (presenceId) {
    const { error } = await supabase.from('presences')
      .update({ statut, paye: parseFloat(paye) || 0, shift_nom: shiftNom || '', heure_debut: heureDebut || '', heure_fin: heureFin || '' })
      .eq('id', presenceId)
    if (error) logErreur('saveOnePresence.update', error, { presenceId })
    return { id: presenceId }
  }

  const payload = {
    point_id: pointId,
    caissier_id: caissierIdParam || null,
    utilisateur_id: utilisateurId || null,
    travailleur_id: travailleurId,
    travailleur_nom: travailleurNom,
    statut,
    paye: parseFloat(paye) || 0,
    shift_nom: shiftNom || '',
    heure_debut: heureDebut || '',
    heure_fin: heureFin || '',
    restaurant_id: restaurantId,
    date: dateJour || new Date().toISOString().split('T')[0],
  }

  // Tentative 1 — upsert avec contrainte caissier (UNIQUE point_id, caissier_id, travailleur_id)
  if (caissierIdParam) {
    const { data, error } = await supabase.from('presences')
      .upsert(payload, { onConflict: 'point_id,caissier_id,travailleur_id' })
      .select().single()
    if (!error && data) return { id: data.id }

    // Un doublon ici n'est PAS une anomalie de données : c'est soit deux
    // sauvegardes concurrentes du même pointage (Postgres peut lever un
    // duplicate malgré le ON CONFLICT), soit un renvoi après une coupure
    // réseau où la première requête avait en réalité abouti. Dans les deux
    // cas la ligne existe déjà — on la met à jour au lieu de réessayer un
    // insert voué à heurter la même contrainte.
    const recuperee = await majPresenceExistante(payload)
    if (recuperee) return recuperee

    logErreur('saveOnePresence.upsert_caissier', error, { pointId, travailleurId })
  }

  // Tentative 2 — insert simple (cas d'une présence réellement nouvelle,
  // ou d'une saisie sans caissier_id qui n'a pas pu passer par l'upsert)
  const { data: d2, error: e2 } = await supabase.from('presences')
    .insert(payload)
    .select().single()
  if (!e2 && d2) return { id: d2.id }

  // Dernière chance : la ligne a pu apparaître entre-temps (course).
  const rattrapee = await majPresenceExistante(payload)
  if (rattrapee) return rattrapee

  logErreur('saveOnePresence.insert_fallback', e2, { pointId, travailleurId })

  return null
}

/**
 * Retrouve la présence déjà enregistrée pour ce trio et la met à jour.
 * Renvoie { id } si la reprise a fonctionné, null sinon — auquel cas
 * l'appelant journalise l'erreur d'origine.
 */
async function majPresenceExistante(payload) {
  try {
    let q = supabase.from('presences').select('id')
      .eq('point_id', payload.point_id)
      .eq('travailleur_id', payload.travailleur_id)
    // caissier_id est toujours renseigné en pratique, mais un NULL ne se
    // compare pas avec .eq() — d'où les deux chemins.
    q = payload.caissier_id ? q.eq('caissier_id', payload.caissier_id) : q.is('caissier_id', null)

    const { data: existante, error } = await q.limit(1).maybeSingle()
    if (error || !existante) return null

    const { error: majErr } = await supabase.from('presences').update({
      statut: payload.statut,
      paye: payload.paye,
      shift_nom: payload.shift_nom,
      heure_debut: payload.heure_debut,
      heure_fin: payload.heure_fin,
    }).eq('id', existante.id)
    if (majErr) return null

    return { id: existante.id }
  } catch {
    // Réseau coupé pendant la reprise : on laisse l'appelant journaliser.
    return null
  }
}

// Sauvegarde d'un shift caissier (depuis point-shift.js)
export async function savePointShiftData(shiftRecord, depensesJour, fournisseursJour, userNom) {
  if (!isOnlineNow()) {
    await enqueueOperation('savePointShiftData', [shiftRecord, depensesJour, fournisseursJour, userNom])
    return { queued: true }
  }

  const { error } = await supabase.from('points_shifts').insert(shiftRecord)
  if (error) throw new Error(error.message)

  await Promise.all([
    saveDepenses(shiftRecord.point_id, depensesJour, 'caissier', userNom, shiftRecord.restaurant_id),
    saveTransactionsFournisseurs(shiftRecord.point_id, fournisseursJour, {}, 'caissier', shiftRecord.restaurant_id, userNom),
  ])
  journaliser(ACTIONS.SHIFT_SAUVEGARDE, { caissier: shiftRecord.caissier_nom, vente: shiftRecord.vente_shift }, { pointId: shiftRecord.point_id, restaurantId: shiftRecord.restaurant_id, userNom }).catch(() => {})
  return { success: true }
}

const SUPABASE_URL =
  Constants.expoConfig?.extra?.supabaseUrl || process.env.EXPO_PUBLIC_SUPABASE_URL
const SUPABASE_ANON_KEY =
  Constants.expoConfig?.extra?.supabaseKey || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY

// Un échec réseau ponctuel ne doit pas coûter une photo de facture : on
// réessaie avant d'abandonner. L'appelant (usePhoto) met ensuite la photo en
// file d'attente — il ne se rabat JAMAIS sur l'URI locale.
const UPLOAD_TENTATIVES = 3

export async function uploadPhoto(uri, dossier = 'general') {
  for (let tentative = 1; tentative <= UPLOAD_TENTATIVES; tentative++) {
    const url = await tenterUploadPhoto(uri, dossier, tentative)
    if (url) return url
    if (tentative < UPLOAD_TENTATIVES) {
      await new Promise(r => setTimeout(r, 800 * tentative))
    }
  }
  return null
}

async function tenterUploadPhoto(uri, dossier, tentative) {
  try {
    const formData = new FormData()
    let nomFichier, contentType

    // Sur web, l'URI est un blob: ou data: URL — convertir en Blob d'abord
    if (typeof document !== 'undefined') {
      const blob = await (await fetch(uri)).blob()
      // Déduire l'extension depuis le type MIME réel du blob (pas depuis l'URI)
      const mime = blob.type || 'image/jpeg'
      const ext = mime.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg'
      nomFichier = `${dossier}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
      contentType = mime
      formData.append('file', blob, nomFichier)
    } else {
      // React Native : syntaxe objet native
      const ext = uri.split('.').pop()?.split('?')[0]?.toLowerCase() || 'jpg'
      contentType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`
      nomFichier = `${dossier}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
      formData.append('file', { uri, name: nomFichier, type: contentType })
    }

    const response = await fetch(
      `${SUPABASE_URL}/storage/v1/object/photos/${nomFichier}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'apikey': SUPABASE_ANON_KEY,
        },
        body: formData,
      }
    )

    if (!response.ok) {
      const errText = await response.text()
      // On ne loggue que le dernier échec, sinon 3 lignes par photo ratée.
      if (tentative === UPLOAD_TENTATIVES) logErreur('uploadPhoto', new Error(errText))
      return null
    }

    return `${SUPABASE_URL}/storage/v1/object/public/photos/${nomFichier}`

  } catch (err) {
    if (tentative === UPLOAD_TENTATIVES) logErreur('uploadPhoto.exception', err)
    return null
  }
}

// Upload d'un fichier quelconque (image OU PDF) vers le bucket `photos`.
// Contrairement à uploadPhoto, gère correctement le content-type PDF sur natif.
export async function uploadFichier(uri, dossier = 'documents') {
  try {
    const formData = new FormData()
    let nomFichier, contentType

    if (typeof document !== 'undefined') {
      // Web : le type MIME réel vient du blob
      const blob = await (await fetch(uri)).blob()
      const mime = blob.type || 'application/octet-stream'
      const ext = mime === 'application/pdf' ? 'pdf' : (mime.split('/')[1]?.replace('jpeg', 'jpg') || 'bin')
      nomFichier = `${dossier}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
      contentType = mime
      formData.append('file', blob, nomFichier)
    } else {
      // Natif : déduire depuis l'extension
      const ext = uri.split('.').pop()?.split('?')[0]?.toLowerCase() || 'bin'
      if (ext === 'pdf') contentType = 'application/pdf'
      else if (ext === 'png') contentType = 'image/png'
      else if (ext === 'jpg' || ext === 'jpeg') contentType = 'image/jpeg'
      else contentType = 'application/octet-stream'
      nomFichier = `${dossier}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
      formData.append('file', { uri, name: nomFichier, type: contentType })
    }

    const response = await fetch(
      `${SUPABASE_URL}/storage/v1/object/photos/${nomFichier}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'apikey': SUPABASE_ANON_KEY,
          'x-upsert': 'true',
        },
        body: formData,
      }
    )
    if (!response.ok) {
      const errText = await response.text()
      logErreur('uploadFichier', new Error(errText))
      return null
    }
    return `${SUPABASE_URL}/storage/v1/object/public/photos/${nomFichier}`
  } catch (err) {
    logErreur('uploadFichier.exception', err)
    return null
  }
}

// Annule DÉFINITIVEMENT la déduction d'inventaire d'un produit (ligne).
// Remet montant_deduit à 0, conserve le montant d'origine pour l'historique,
// et décrémente les totaux consommés en aval (shift + point).
// Idempotent : ne refait rien si la ligne est déjà annulée.
// Action manager/directeur uniquement (online).
export async function annulerDeductionInventaire({ ligneId, inventaireId, pointId, par }) {
  if (!ligneId) throw new Error('Ligne inventaire introuvable')

  // Source de vérité : on lit le montant depuis la DB (et on évite la double annulation).
  const { data: ligne, error: eRead } = await supabase
    .from('inventaire_lignes')
    .select('montant_deduit, deduction_annulee')
    .eq('id', ligneId)
    .single()
  if (eRead) throw new Error(eRead.message)
  if (!ligne) throw new Error('Ligne inventaire introuvable')
  if (ligne.deduction_annulee) return { montant: 0, dejaAnnule: true }

  const montant = Math.round(ligne.montant_deduit || 0)

  // 1. Marquer la ligne annulée (montant_deduit → 0, trace conservée).
  const { error: e1 } = await supabase
    .from('inventaire_lignes')
    .update({
      montant_deduit: 0,
      montant_deduit_annule: montant,
      deduction_annulee: true,
      deduction_annulee_par: par || 'Manager',
      deduction_annulee_at: new Date().toISOString(),
    })
    .eq('id', ligneId)
  if (e1) throw new Error(e1.message)

  // 2. Décrémenter le total du shift inventaire.
  if (inventaireId && montant > 0) {
    const { data: shift } = await supabase
      .from('inventaires_shifts').select('montant_a_deduire').eq('id', inventaireId).single()
    if (shift) {
      await supabase.from('inventaires_shifts')
        .update({ montant_a_deduire: Math.max(0, (shift.montant_a_deduire || 0) - montant) })
        .eq('id', inventaireId)
    }
  }

  // 3. Décrémenter le cumul du point (si la colonne existe).
  if (pointId && montant > 0) {
    const { data: pt } = await supabase
      .from('points').select('montant_inventaire').eq('id', pointId).single()
    if (pt && 'montant_inventaire' in pt) {
      await supabase.from('points')
        .update({ montant_inventaire: Math.max(0, parseFloat(pt.montant_inventaire || 0) - montant) })
        .eq('id', pointId)
    }
  }

  journaliser('annulation_deduction_inventaire', { ligne_id: ligneId, montant }, { par }).catch(() => {})
  return { montant, dejaAnnule: false }
}

// ── Décision manager sur un écart inventaire EXPLIQUÉ ──────────────────
// statut : 'validee' (accepte `quantiteAcceptee`) | 'refusee' (déduction pleine).
// La fonction SQL verrouille la ligne et ajuste les totaux shift/point dans la
// même transaction. SamerTrackly et le siège partagent ainsi la première décision.
// Correction d'une entrée de stock mal saisie (10 pains déclarés, 20 sur le
// reçu). Le recalcul de l'écart et des déductions se fait en base, d'un bloc.
// Voir supabase_correction_entrees.sql.
export async function corrigerEntreeInventaire({ inventaireId, produitId, produitNom, fournisseurNom, nouvelle, prix, raison, par }) {
  const { data, error } = await supabase.rpc('corriger_entree_inventaire', {
    p_inventaire_id: inventaireId,
    p_produit_id: produitId,
    p_produit_nom: produitNom || null,
    p_fournisseur_nom: fournisseurNom || null,
    p_nouvelle: nouvelle,
    p_prix: Math.max(0, Number(prix) || 0),
    p_raison: raison,
    p_par: par || 'Vérificateur',
  })
  if (error) {
    const m = error.message || ''
    if (/QUANTITE_IDENTIQUE/.test(m)) throw new Error('La nouvelle quantité est identique à l’actuelle.')
    if (/QUANTITE_INVALIDE/.test(m)) throw new Error('Quantité invalide.')
    if (/RAISON_OBLIGATOIRE/.test(m)) throw new Error('Le motif est obligatoire.')
    if (/PRIX_PRODUIT_INCONNU/.test(m)) throw new Error('Prix du produit inconnu : impossible de recalculer la déduction.')
    if (/INVENTAIRE_INTROUVABLE/.test(m)) throw new Error('Inventaire introuvable.')
    if (/corriger_entree_inventaire|PGRST202|does not exist/.test(m)) {
      throw new Error('Script supabase_correction_entrees.sql non passé dans Supabase.')
    }
    throw new Error(m)
  }
  const r = Array.isArray(data) ? data[0] : data
  return {
    ancienne: Number(r?.ancienne_quantite) || 0,
    ligneTrouvee: !!r?.ligne_trouvee,
    ancienMontant: Math.round(Number(r?.ancien_montant) || 0),
    nouveauMontant: Math.round(Number(r?.nouveau_montant) || 0),
  }
}

// statutActuel = l'état affiché à l'écran. Une ligne déjà validée/refusée
// passe par redecider_ecart_inventaire (supabase_redecision_inventaire.sql) :
// la fonction d'origine n'accepte que la première décision.
export async function deciderEcartInventaire({ ligneId, statut, quantiteAcceptee, prix, par, statutActuel = 'en_attente' }) {
  if (!ligneId) throw new Error('Ligne inventaire introuvable')

  const modification = !!statutActuel && statutActuel !== 'en_attente'
  const commun = {
    p_ligne_id: ligneId,
    p_statut: statut,
    p_quantite_acceptee: quantiteAcceptee ?? null,
    p_prix: Math.max(0, Number(prix) || 0),
    p_par: par || 'Manager',
  }
  const { data, error } = modification
    ? await supabase.rpc('redecider_ecart_inventaire', { ...commun, p_statut_actuel: statutActuel })
    : await supabase.rpc('decider_ecart_inventaire_atomique', commun)
  if (error) {
    if (/DECISION_CHANGEE_ENTRE_TEMPS/.test(error.message || '')) {
      throw new Error('Cette décision vient d’être changée par quelqu’un d’autre. Rouvrez le point.')
    }
    if (/DEDUCTION_ANNULEE/.test(error.message || '')) {
      throw new Error('La déduction de ce produit a été annulée : la décision ne peut plus changer.')
    }
    if (modification && /redecider_ecart_inventaire|PGRST202|does not exist/.test(error.message || '')) {
      throw new Error('Script supabase_redecision_inventaire.sql non passé dans Supabase.')
    }
    if (/EXPLICATION_DEJA_TRAITEE/.test(error.message || '')) {
      throw new Error('Cette explication a déjà été traitée')
    }
    if (/EXPLICATION_INTROUVABLE/.test(error.message || '')) {
      throw new Error('Explication introuvable')
    }
    throw new Error(error.message)
  }

  const resultat = Array.isArray(data) ? data[0] : data
  return { montant: Math.round(Number(resultat?.montant_deduit) || 0) }
}
