// ──────────────────────────────────────────────────────────────────────────────
// Litiges d'un restaurant sur une période : écarts de caisse, inventaire,
// comptage du vérificateur, avis clients, Yango, Glovo, contacts manquants,
// points pas faits. UNE seule définition, lue par l'écran Litiges (vue « tous
// les restaurants », PDF) et par l'onglet Litiges du Dashboard global : les
// deux affichent forcément les mêmes montants.
// Résumé et « restaurant sans litige » : lib/litigesResume.js (pur, testé).
// ──────────────────────────────────────────────────────────────────────────────
import { supabase } from './supabase'
import {
  calculerLitigeContact, chargerPointsContact, chargerShiftsContact, choisirNombreContacts, compterContacts,
  contactsViennentDuPOS,
} from './litigeContacts'
import {
  CHAMPS_SHIFT_ECART, CHAMPS_SHIFT_ECART_LEGACY, SOURCE_DECISION_POS, fusionnerResponsablesEcart, responsablesEcartPOS,
} from './ecartPOS'

// Les shifts d'une liste de points, avec les colonnes d'écart du POS.
//
// Paginé : au-delà de 1000 lignes Supabase tronque SANS erreur, et un shift
// manquant fausse le cumul donc l'écart de la journée — le genre de panne
// silencieuse qui a déjà fabriqué de faux litiges.
//
// Repli si supabase_pos_bascule.sql n'est pas passée : on relit sans les
// colonnes du POS, et l'écran retombe exactement sur son comportement
// d'avant (aucune mesure, donc aucun responsable déduit).
export async function chargerShiftsEcart(pointIds) {
  if (!pointIds?.length) return []
  const PAGE = 1000
  const req = (champs, debut) => supabase
    .from('points_shifts').select(champs)
    .in('point_id', pointIds)
    .order('id', { ascending: true })   // ordre stable : sans ça la pagination saute des lignes
    .range(debut, debut + PAGE - 1)

  let champs = `${CHAMPS_SHIFT_ECART}, vente_shift`
  const tout = []
  for (let debut = 0; ; debut += PAGE) {
    let { data, error } = await req(champs, debut)
    if (error) {
      champs = `${CHAMPS_SHIFT_ECART_LEGACY}, vente_shift`
      ;({ data, error } = await req(champs, debut))
    }
    if (error || !data?.length) break
    tout.push(...data)
    if (data.length < PAGE) break
  }
  return tout
}


/** Tous les litiges d'un restaurant entre deux dates (AAAA-MM-JJ). */
export async function chargerLitigesRestaurant(resto, debut, fin) {
  // Écarts
  const { data: pointsData } = await supabase
    .from('points').select('id, date, vente_machine, explication_machine_statut, ecart_regularisations')
    .eq('restaurant_id', resto.id).gte('date', debut).lte('date', fin)
  let ecartTotal = 0
  // Responsables déduits des shifts POS de ce restaurant (lib/ecartPOS.js).
  // Vide sur un site sans POS : aucun shift n'y porte `ecart_pos`.
  let mesuresPOS = []
  // Points dont l'écart ne pèse plus rien : annulé, justifié, entièrement
  // régularisé, ou simple surplus. Sert à filtrer les responsables plus bas.
  const pointsSoldes = new Set()
  if (pointsData?.length) {
    const ids = pointsData.map(p => p.id)
    const shifts = await chargerShiftsEcart(ids)
    const regularisationsPOS = pointsData.flatMap(p =>
      (Array.isArray(p.ecart_regularisations) ? p.ecart_regularisations : [])
        .filter(r => r?.source === SOURCE_DECISION_POS)
        .map(r => ({ ...r, point_id: r.point_id || p.id }))
    )
    mesuresPOS = responsablesEcartPOS(shifts, regularisationsPOS)
    const byPoint = {}
    ;(shifts || []).forEach(s => { byPoint[s.point_id] = (byPoint[s.point_id] || 0) + (s.vente_shift || 0) })
    pointsData.forEach(p => {
      if (['annulee', 'justifiee'].includes(p.explication_machine_statut)) { // écart soldé → 0
        pointsSoldes.add(p.id)
        return
      }
      const brut = (p.vente_machine || 0) - (byPoint[p.id] || 0)
      // Les régularisations partielles réduisent l'écart : sans ça, annuler
      // 8 000 sur un manquant de 10 000 laissait 10 000 dans le total.
      const reguls = Array.isArray(p.ecart_regularisations) ? p.ecart_regularisations : []
      const totalRegul = reguls
        .filter(r => r?.source !== SOURCE_DECISION_POS)
        .reduce((s2, r) => s2 + (parseFloat(r.montant) || 0), 0)
      const reste = Math.max(0, brut - totalRegul)
      if (reste <= 0) pointsSoldes.add(p.id)
      ecartTotal += reste
    })
  }

  // Comptages du vérificateur : montants à déduire, plafonnés par comptage.
  const { data: dedVerif } = await supabase
    .from('deductions_verification')
    .select('*')
    .eq('restaurant_id', resto.id).gte('date', debut).lte('date', fin)
    .neq('statut', 'validee')
  const verifLignes = dedVerif || []
  // Le montant est déjà plafonné et réparti à l'enregistrement : on somme
  // simplement les parts. L'écart réel sert seulement à expliquer l'écart
  // entre ce qui a été constaté et ce qui est réellement retenu.
  const verifRetenu = verifLignes.reduce((s2, l) => s2 + (Number(l.montant) || 0), 0)
  const lots = {}
  verifLignes.forEach(l => { lots[l.lot_id || l.date] = Number(l.montant_ecart) || 0 })
  const verifReel = Object.values(lots).reduce((s2, v) => s2 + v, 0)

  // Responsables des écarts : le total ci-dessus ne dit pas QUI doit quoi.
  // C'est pourtant le plus gros poste de litiges, et chaque ligne porte un nom.
  const { data: responsablesBruts } = await supabase
    .from('litiges_responsables')
    // `id` et `restaurant_id` servent à la déduplication avec les mesures
    // du POS (fusionnerResponsablesEcart) : sans eux, une vieille ligne
    // sans `point_id` ne serait pas reconnue et l'écart compterait double.
    .select('id, point_id, restaurant_id, date, responsable_nom, role, montant, type')
    .eq('restaurant_id', resto.id).gte('date', debut).lte('date', fin)
    .order('montant', { ascending: false })

  // Deux filtres, pour que le détail affiché colle enfin au montant annoncé :
  //   • les surplus ne sont pas des litiges — ecartTotal les exclut déjà, mais
  //     ils s'affichaient quand même sous « Écart point », en rouge ;
  //   • un écart soldé n'a plus de responsable à montrer. litiges_responsables
  //     n'est réécrite que par ventes.js (syncLitigesResponsables) : elle ignore
  //     tout des annulations et justifications décidées dans Vérification.
  // Une ligne sans point_id (format ancien) est conservée : on ne peut pas la
  // rattacher à une journée, mieux vaut l'afficher que la perdre.
  // La caisse complète l'imputation manuelle, elle ne la double jamais :
  // sur une journée déjà imputée à la main, la main gagne.
  const responsables = fusionnerResponsablesEcart(responsablesBruts || [], mesuresPOS)
    .filter(r => r.type !== 'surplus' && !(r.point_id && pointsSoldes.has(r.point_id)))

  // Inventaire + détail
  const { data: invShifts } = await supabase
    .from('inventaires_shifts').select('id, caissier_id, type_shift, montant_a_deduire, date')
    .eq('restaurant_id', resto.id).gte('date', debut).lte('date', fin).eq('valide', true)
  let invEnriched = []
  let invTotal = 0
  if (invShifts?.length) {
    invTotal = invShifts.reduce((s, x) => s + (x.montant_a_deduire || 0), 0)
    const caissierIds = [...new Set(invShifts.map(s => s.caissier_id).filter(Boolean))]
    const { data: users } = await supabase.from('utilisateurs').select('id, nom').in('id', caissierIds)
    const nomById = {}
    ;(users || []).forEach(u => { nomById[u.id] = u.nom })
    const shiftIds = invShifts.map(s => s.id)
    const { data: lignes } = await supabase
      .from('inventaire_lignes')
      .select('inventaire_id, produit_id, produit_nom, montant_deduit, explication, nombre_explique, ecart')
      .in('inventaire_id', shiftIds).gt('montant_deduit', 0)
    const lignesByShift = {}
    ;(lignes || []).forEach(l => {
      if (!lignesByShift[l.inventaire_id]) lignesByShift[l.inventaire_id] = []
      lignesByShift[l.inventaire_id].push(l)
    })
    invEnriched = invShifts.map(s => ({
      ...s,
      caissier_nom: nomById[s.caissier_id] || 'Caissier',
      lignes: lignesByShift[s.id] || [],
    }))
  }

  // Avis / Yango / Glovo
  const [{ data: avis }, { data: yango }, { data: glovo }] = await Promise.all([
    supabase.from('litiges_avis_clients').select('*').eq('restaurant_id', resto.id).gte('date', debut).lte('date', fin).order('date', { ascending: false }),
    supabase.from('litiges_yango').select('*').eq('restaurant_id', resto.id).gte('date', debut).lte('date', fin).order('date', { ascending: false }),
    supabase.from('litiges_glovo').select('*').eq('restaurant_id', resto.id).gte('date', debut).lte('date', fin).order('date', { ascending: false }),
  ])
  const avisTotal  = (avis  || []).reduce((s, x) => s + (x.montant || 0), 0)
  const yangoTotal = (yango || []).reduce((s, x) => s + (x.montant || 0), 0)
  const glovoTotal = (glovo || []).reduce((s, x) => s + (x.montant || 0), 0)

  // Contacts manquants — règle et corrections dans lib/litigeContacts.js
  const ptsContact = await chargerPointsContact(resto.id, debut, fin)
  let contacts = []
  let contactTotal = 0
  let contactsEnAttente = 0
  if (ptsContact?.length) {
    const idsContact = ptsContact.map(p => p.id)
    const sourceContacts = contactsViennentDuPOS(resto) ? 'POS' : 'SAMTRACKLY'
    const surPOS = sourceContacts === 'POS'
    const [{ parPoint: contactsByPoint }, { parPoint: shiftsParPoint }] = await Promise.all([
      surPOS ? Promise.resolve({ parPoint: {} }) : compterContacts(idsContact),
      surPOS ? chargerShiftsContact(idsContact) : Promise.resolve({ parPoint: {} }),
    ])
    const calculs = ptsContact.map(p => {
      const infoContacts = choisirNombreContacts({
        sourcePoint: sourceContacts,
        shifts: shiftsParPoint[p.id] || [],
        contactsSamtrackly: contactsByPoint[p.id] || 0,
      })
      return { date: p.date, ...calculerLitigeContact(p, infoContacts.nombre, infoContacts) }
    })
    contacts = calculs.filter(r => r.litige > 0)
    contactTotal = contacts.reduce((s, r) => s + r.litige, 0)
    // Journées dont le comptage POS n'est pas arrivé : signalées, jamais facturées.
    contactsEnAttente = calculs.filter(r => r.calculSuspendu && r.nbCommandes > 0).length
  }

  // Point pas fait
  const { data: pasFait } = await supabase
    .from('litiges_point_pas_fait').select('*')
    .eq('restaurant_id', resto.id).gte('date', debut).lte('date', fin)
    .order('date', { ascending: false })
  const pasFaitTotal = (pasFait || []).reduce((s, x) => s + (x.montant || 0), 0)

  return {
    restaurant: resto, ecartTotal, invTotal, invEnriched,
    responsables,
    avis: avis || [], avisTotal,
    yango: yango || [], yangoTotal,
    glovo: glovo || [], glovoTotal,
    contacts, contactTotal, contactsEnAttente,
    pasFait: pasFait || [], pasFaitTotal,
    verifLignes, verifRetenu, verifReel,
    // Le total du restaurant n'intègre que le montant RETENU (plafonné),
    // jamais l'écart brut : c'est ce qui sera effectivement déduit.
    total: ecartTotal + invTotal + avisTotal + yangoTotal + glovoTotal
      + contactTotal + pasFaitTotal + verifRetenu,
  }
}
