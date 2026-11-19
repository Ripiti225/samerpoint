// ──────────────────────────────────────────────────────────────────────────────
// Export comptable SYSCOHADA d'un mois, en Excel.
//
// Trois journaux dans l'onglet Journal :
//   CA — Caisse des restaurants (lib/journalCaisse.js) ;
//   BQ — Banque et Trésorerie, un mouvement = une pièce (lib/journalTresorerie.js) ;
//   OD — commissions estimées et publicité Glovo, par restaurant ;
//   PA — paie des états de salaire VALIDÉS (lib/journalPaie.js).
// Onglets Contrôle (restaurants), Contrôle journaux (+ compte d'attente 471) et
// Plan de comptes. Export d'un restaurant : ses journées et les mouvements qui lui
// sont rattachés. Mois non clôturé : PROVISOIRE (nom du fichier, en-têtes).
// Specs : docs/superpowers/specs/2026-11-19-export-comptable-{caisse,tresorerie,paie}-design.md
// ──────────────────────────────────────────────────────────────────────────────
import { bornesMois, libelleMois } from './clotureMois'
import { COMPTES } from './comptesSyscohada'
import { controleParJournal } from './ecrituresComptables'
import { enregistrer } from './exportRapportMensuel'
import { nomCourtResto } from './groupesAccueil'
import { controleJournal, journalDuMois, nomFichierJournal } from './journalCaisse'
import { clePaie, ecrituresPaie } from './journalPaie'
import { assiettesCommissions, ecrituresCommissions, ecrituresTresorerie } from './journalTresorerie'
import { supabase } from './supabase'
import { formatDateFR } from './tresorerie'

const PAGE = 1000
const PAQUET_IDS = 100
const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

const CHAMPS_POINT = 'id, restaurant_id, date, vente_total, vente_machine, yango_tab, glovo_tab, samer_delly_tab, source, valide, verifie'
const CHAMPS_SHIFT = 'id, point_id, vente_shift, espece, om, wave, djamo, yango_cse, glovo_cse, kdo, points_fidelite, retour, fournisseurs, depenses'

async function toutesLesPages(construire) {
  const out = []
  for (let de = 0; ; de += PAGE) {
    const { data, error } = await construire().order('id').range(de, de + PAGE - 1)
    if (error) throw error
    out.push(...(data || []))
    if (!data || data.length < PAGE) return out
  }
}

// Lignes rattachées à ces ids (colonne donnée), par paquets (URL courtes).
async function parIds(colonne, ids, construire) {
  const out = []
  for (let i = 0; i < ids.length; i += PAQUET_IDS) {
    const paquet = ids.slice(i, i + PAQUET_IDS)
    out.push(...await toutesLesPages(() => construire().in(colonne, paquet)))
  }
  return out
}

function grouper(lignes, cle) {
  const m = new Map()
  for (const l of lignes) {
    if (!m.has(l[cle])) m.set(l[cle], [])
    m.get(l[cle]).push(l)
  }
  return m
}

const parMouvement = lignes => new Map(lignes.map(l => [l.mouvement_id, l]))

async function chargerJournees(debut, fin, restaurantId) {
  const points = await toutesLesPages(() => {
    let q = supabase.from('points').select(CHAMPS_POINT).gte('date', debut).lt('date', fin)
    if (restaurantId) q = q.eq('restaurant_id', restaurantId)
    return q
  })
  const ids = points.map(p => p.id)
  const [shifts, depensesCaissier, deductionsGerant, factures] = await Promise.all([
    parIds('point_id', ids, () => supabase.from('points_shifts').select(CHAMPS_SHIFT)),
    parIds('point_id', ids, () => supabase.from('depenses').select('id, point_id, categorie, montant').eq('saisi_par', 'caissier')),
    parIds('point_id', ids, () => supabase.from('depenses_gerant_caisse').select('id, point_id, categorie, montant')),
    parIds('point_id', ids, () => supabase.from('transactions_fournisseurs').select('id, point_id, fournisseur_nom, facture').not('facture', 'is', null)),
  ])
  return {
    points,
    shifts: grouper(shifts, 'point_id'), depensesCaissier: grouper(depensesCaissier, 'point_id'),
    deductionsGerant: grouper(deductionsGerant, 'point_id'), factures: grouper(factures, 'point_id'),
  }
}

async function chargerTresorerie(debut, fin, restaurantId) {
  const [{ data: comptes, error }, mouvements, pubs] = await Promise.all([
    supabase.from('tresorerie_comptes').select('id, nom'),
    toutesLesPages(() => supabase.from('tresorerie_mouvements')
      .select('id, compte_id, date, montant, type, libelle, restaurant_id').gte('date', debut).lt('date', fin)),
    toutesLesPages(() => {
      let q = supabase.from('tresorerie_partenaire_lignes').select('id, restaurant_id, montant, periode_debut')
        .eq('type', 'pub').gte('periode_debut', debut).lt('periode_debut', fin)
      if (restaurantId) q = q.eq('restaurant_id', restaurantId)
      return q
    }),
  ])
  if (error) throw error
  const ids = mouvements.map(m => m.id)
  const [paiements, partenaires, direction] = await Promise.all([
    parIds('mouvement_id', ids, () => supabase.from('tresorerie_paiements').select('id, mouvement_id, du_id')),
    parIds('mouvement_id', ids, () => supabase.from('tresorerie_partenaire_lignes').select('id, mouvement_id, partenaire, restaurant_id')),
    parIds('mouvement_id', ids, () => supabase.from('tresorerie_depenses_direction').select('id, mouvement_id, categorie, restaurant_id')),
  ])
  const dus = await parIds('id', [...new Set(paiements.map(p => p.du_id).filter(Boolean))],
    () => supabase.from('tresorerie_dus').select('id, categorie, categorie_direction, restaurant_id, mois'))
  const duParId = new Map(dus.map(d => [d.id, d]))
  return {
    comptes: new Map((comptes || []).map(c => [c.id, c.nom])),
    mouvements, pubs,
    liens: {
      paiements: new Map(paiements.filter(p => duParId.has(p.du_id)).map(p => [p.mouvement_id, duParId.get(p.du_id)])),
      partenaires: parMouvement(partenaires),
      direction: parMouvement(direction),
    },
  }
}

// États de salaire VALIDÉS du mois et leurs bulletins.
async function chargerPaie(debut, restaurantId) {
  let q = supabase.from('etats_salaire').select('id, restaurant_id, mois').eq('statut', 'valide').eq('mois', debut)
  if (restaurantId) q = q.eq('restaurant_id', restaurantId)
  const { data: etats, error } = await q
  if (error) throw error
  const lignes = await parIds('etat_id', (etats || []).map(e => e.id),
    () => supabase.from('lignes_etat_salaire').select('id, etat_id, bulletin'))
  return { etats: etats || [], lignes: grouper(lignes, 'etat_id') }
}

function feuille(XLSX, titre, lignes, largeurs) {
  const ws = XLSX.utils.aoa_to_sheet([[titre], []])
  if (lignes.length) XLSX.utils.sheet_add_json(ws, lignes, { origin: 'A3' })
  else XLSX.utils.sheet_add_aoa(ws, [['Aucune écriture pour ce mois']], { origin: 'A3' })
  ws['!cols'] = largeurs.map(wch => ({ wch }))
  return ws
}

const sommeDe = (objets, cle) => objets.reduce((s, o) => s + o[cle], 0)

function lignesControleRestaurants(parResto, controle, paieValideePourNom) {
  const restos = Object.entries(parResto).sort(([a], [b]) => a.localeCompare(b))
  const ligne = (nom, r, c) => ({
    Restaurant: nom, 'Journées': r.journees, 'Total débit (caisse)': c.debit, 'Total crédit (caisse)': c.credit,
    'Différence (doit être 0)': c.difference, 'Écarts de caisse (+ surplus / − manque)': r.ecarts,
    'Journées non vérifiées': r.nonVerifiees, 'Journées exclues (anciens Sheets)': r.exclues,
    'Paie du mois': nom === 'TOTAL' ? '' : (paieValideePourNom(nom) ? 'État de salaire validé (journal PA)' : 'Comptée aux versements'),
  })
  const tous = Object.values(parResto)
  return [
    ...restos.map(([nom, r]) => ligne(nom, r, controle.parRestaurant[nom] || { debit: 0, credit: 0, difference: 0 })),
    ligne('TOTAL', {
      journees: sommeDe(tous, 'journees'), ecarts: sommeDe(tous, 'ecarts'),
      nonVerifiees: sommeDe(tous, 'nonVerifiees'), exclues: sommeDe(tous, 'exclues'),
    }, controle.groupe),
  ]
}

const NOMS_JOURNAUX = { CA: 'Caisse des restaurants', BQ: 'Banque et Trésorerie', OD: 'Opérations diverses (commissions, publicité)', PA: 'Paie (états de salaire validés)' }

/**
 * Télécharge (web) ou partage (téléphone) l'export comptable du mois.
 * @param {{ mois: string, restaurantId: string|null, provisoire: boolean, onProgres?: (t: string) => void }} options
 */
export async function exporterJournalCaisse({ mois, restaurantId = null, provisoire = false, onProgres }) {
  const dire = t => { if (typeof onProgres === 'function') onProgres(t) }
  const { debut, fin } = bornesMois(mois)

  dire('Chargement des journées et de la Trésorerie…')
  const { data: tousRestos, error } = await supabase.from('restaurants').select('id, nom')
  if (error) throw error
  const restaurants = (tousRestos || []).filter(r => !restaurantId || r.id === restaurantId)
  const restos = new Map((tousRestos || []).map(r => [r.id, { nom: r.nom.trim(), court: nomCourtResto(r.nom) }]))
  const [journees, treso, paie] = await Promise.all([
    chargerJournees(debut, fin, restaurantId), chargerTresorerie(debut, fin, restaurantId), chargerPaie(debut, restaurantId),
  ])
  const paieValidee = new Set(paie.etats.map(e => clePaie(e.restaurant_id, e.mois)))

  dire('Calcul des écritures…')
  const caisse = journalDuMois({ restaurants, ...journees, paieValidee })
  const nomResto = restaurantId ? restos.get(restaurantId)?.nom : null
  const banque = ecrituresTresorerie({ ...treso, restaurants: restos, paieValidee })
    .filter(l => !nomResto || l.restaurant === nomResto)
  const od = ecrituresCommissions({
    mois, assiettes: assiettesCommissions({ mois, points: journees.points, shifts: journees.shifts, pubs: treso.pubs, restaurants: restos }),
  })
  const pa = paie.etats.flatMap(e => ecrituresPaie({
    mois, restaurant: restos.get(e.restaurant_id) || { nom: '?', court: '?' }, lignes: paie.lignes.get(e.id) || [],
  }))
  const lignes = [...caisse.lignes, ...banque, ...od, ...pa]
  const nomsPaieValidee = new Set(paie.etats.map(e => restos.get(e.restaurant_id)?.nom))
  const controleCaisse = controleJournal(caisse.lignes)
  const controleJ = controleParJournal(lignes)

  dire('Construction du fichier Excel…')
  const XLSX = await import('xlsx')
  const portee = nomResto || 'Tout le groupe'
  const titre = `${provisoire ? 'PROVISOIRE — mois non clôturé, chiffres encore modifiables — ' : ''}`
    + `Export comptable ${libelleMois(mois)} — ${portee} — plan de comptes SYSCOHADA à valider par le cabinet`

  const journal = lignes.map(l => ({
    Journal: l.journal, Date: formatDateFR(l.date), Pièce: l.piece, Compte: l.compte, Intitulé: l.intitule,
    Libellé: l.libelle, Débit: l.debit || '', Crédit: l.credit || '', Restaurant: l.restaurant,
  }))
  const controleJournaux = [
    ...Object.entries(controleJ.parJournal).map(([code, j]) => ({
      Journal: `${code} — ${NOMS_JOURNAUX[code] || code}`, Lignes: j.lignes, 'Total débit': j.debit,
      'Total crédit': j.credit, 'Différence (doit être 0)': j.difference,
    })),
    { Journal: `Compte d'attente ${COMPTES.attente.compte} : solde à reclasser par le cabinet`, Lignes: '', 'Total débit': '', 'Total crédit': '', 'Différence (doit être 0)': controleJ.attente },
  ]
  const plan = Object.values(COMPTES).map(c => ({ Compte: c.compte, Intitulé: c.intitule }))

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, feuille(XLSX, titre, journal, [8, 11, 22, 8, 40, 46, 13, 13, 18]), 'Journal')
  XLSX.utils.book_append_sheet(wb, feuille(XLSX, titre, lignesControleRestaurants(caisse.parResto, controleCaisse, nom => nomsPaieValidee.has(nom)), [18, 9, 16, 16, 14, 20, 14, 16, 30]), 'Contrôle')
  XLSX.utils.book_append_sheet(wb, feuille(XLSX, titre, controleJournaux, [58, 8, 14, 14, 16]), 'Contrôle journaux')
  XLSX.utils.book_append_sheet(wb, feuille(XLSX, titre, plan, [9, 52]), 'Plan de comptes')

  const nomFichier = nomFichierJournal(mois, nomResto, provisoire)
  const base64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx', compression: true })
  await enregistrer(nomFichier, { base64 }, MIME_XLSX)
  return {
    nomFichier, nbLignes: lignes.length,
    nbExclues: sommeDe(Object.values(caisse.parResto), 'exclues'),
    difference: Object.values(controleJ.parJournal).reduce((s, j) => s + j.difference, 0),
  }
}
