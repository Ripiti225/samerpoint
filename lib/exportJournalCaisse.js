// ──────────────────────────────────────────────────────────────────────────────
// Export comptable : journal de Caisse SYSCOHADA d'un mois, en Excel.
//
// Charge les journées du mois (tout le groupe ou un restaurant) et ce qui s'y
// rattache, calcule les écritures (lib/journalCaisse.js) et produit un classeur
// à trois onglets : Journal, Contrôle, Plan de comptes. Un mois non clôturé est
// marqué PROVISOIRE (nom du fichier et en-tête de chaque onglet).
// Spec : docs/superpowers/specs/2026-11-19-export-comptable-caisse-design.md
// ──────────────────────────────────────────────────────────────────────────────
import { bornesMois, libelleMois } from './clotureMois'
import { COMPTES } from './comptesSyscohada'
import { enregistrer } from './exportRapportMensuel'
import { controleJournal, journalDuMois, nomFichierJournal } from './journalCaisse'
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

// Lignes d'une table rattachées à ces points, par paquets d'ids (URL courtes).
async function parPoints(ids, construire) {
  const out = []
  for (let i = 0; i < ids.length; i += PAQUET_IDS) {
    const paquet = ids.slice(i, i + PAQUET_IDS)
    out.push(...await toutesLesPages(() => construire().in('point_id', paquet)))
  }
  return out
}

function grouperParPoint(lignes) {
  const m = new Map()
  for (const l of lignes) {
    if (!m.has(l.point_id)) m.set(l.point_id, [])
    m.get(l.point_id).push(l)
  }
  return m
}

async function chargerMois(mois, restaurantId) {
  const { debut, fin } = bornesMois(mois)
  let reqRestos = supabase.from('restaurants').select('id, nom')
  if (restaurantId) reqRestos = reqRestos.eq('id', restaurantId)
  const { data: restaurants, error } = await reqRestos
  if (error) throw error

  const points = await toutesLesPages(() => {
    let q = supabase.from('points').select(CHAMPS_POINT).gte('date', debut).lt('date', fin)
    if (restaurantId) q = q.eq('restaurant_id', restaurantId)
    return q
  })
  const ids = points.map(p => p.id)
  const [shifts, depensesCaissier, deductionsGerant, factures] = await Promise.all([
    parPoints(ids, () => supabase.from('points_shifts').select(CHAMPS_SHIFT)),
    parPoints(ids, () => supabase.from('depenses').select('id, point_id, categorie, montant').eq('saisi_par', 'caissier')),
    parPoints(ids, () => supabase.from('depenses_gerant_caisse').select('id, point_id, categorie, montant')),
    parPoints(ids, () => supabase.from('transactions_fournisseurs').select('id, point_id, fournisseur_nom, facture').not('facture', 'is', null)),
  ])
  return {
    restaurants: restaurants || [], points,
    shifts: grouperParPoint(shifts), depensesCaissier: grouperParPoint(depensesCaissier),
    deductionsGerant: grouperParPoint(deductionsGerant), factures: grouperParPoint(factures),
  }
}

function feuille(XLSX, titre, lignes, largeurs) {
  const ws = XLSX.utils.aoa_to_sheet([[titre], []])
  if (lignes.length) XLSX.utils.sheet_add_json(ws, lignes, { origin: 'A3' })
  else XLSX.utils.sheet_add_aoa(ws, [['Aucune journée pour ce mois']], { origin: 'A3' })
  ws['!cols'] = largeurs.map(wch => ({ wch }))
  return ws
}

/**
 * Télécharge (web) ou partage (téléphone) le journal de Caisse du mois.
 * @param {{ mois: string, restaurantId: string|null, provisoire: boolean, onProgres?: (t: string) => void }} options
 */
export async function exporterJournalCaisse({ mois, restaurantId = null, provisoire = false, onProgres }) {
  const dire = t => { if (typeof onProgres === 'function') onProgres(t) }
  dire('Chargement des journées…')
  const donnees = await chargerMois(mois, restaurantId)
  dire('Calcul des écritures…')
  const { lignes, parResto } = journalDuMois(donnees)
  const controle = controleJournal(lignes)

  dire('Construction du fichier Excel…')
  const XLSX = await import('xlsx')
  const nomResto = restaurantId ? donnees.restaurants[0]?.nom : null
  const portee = nomResto ? nomResto.trim() : 'Tout le groupe'
  const titre = `${provisoire ? 'PROVISOIRE — mois non clôturé, chiffres encore modifiables — ' : ''}`
    + `Journal de caisse ${libelleMois(mois)} — ${portee} — plan de comptes SYSCOHADA à valider par le cabinet`

  const journal = lignes.map(l => ({
    Journal: l.journal, Date: formatDateFR(l.date), Pièce: l.piece, Compte: l.compte, Intitulé: l.intitule,
    Libellé: l.libelle, Débit: l.debit || '', Crédit: l.credit || '', Restaurant: l.restaurant,
  }))
  const lignesControle = [
    ...Object.entries(parResto).sort(([a], [b]) => a.localeCompare(b)).map(([nom, r]) => {
      const c = controle.parRestaurant[nom] || { debit: 0, credit: 0, difference: 0 }
      return {
        Restaurant: nom, 'Journées': r.journees, 'Total débit': c.debit, 'Total crédit': c.credit,
        'Différence (doit être 0)': c.difference, 'Écarts de caisse (+ surplus / − manque)': r.ecarts,
        'Journées non vérifiées': r.nonVerifiees, 'Journées exclues (anciens Sheets)': r.exclues,
      }
    }),
    {
      Restaurant: 'TOTAL', 'Journées': Object.values(parResto).reduce((s, r) => s + r.journees, 0),
      'Total débit': controle.groupe.debit, 'Total crédit': controle.groupe.credit,
      'Différence (doit être 0)': controle.groupe.difference,
      'Écarts de caisse (+ surplus / − manque)': Object.values(parResto).reduce((s, r) => s + r.ecarts, 0),
      'Journées non vérifiées': Object.values(parResto).reduce((s, r) => s + r.nonVerifiees, 0),
      'Journées exclues (anciens Sheets)': Object.values(parResto).reduce((s, r) => s + r.exclues, 0),
    },
  ]
  const plan = Object.values(COMPTES).map(c => ({ Compte: c.compte, Intitulé: c.intitule }))

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, feuille(XLSX, titre, journal, [8, 11, 20, 8, 40, 46, 13, 13, 18]), 'Journal')
  XLSX.utils.book_append_sheet(wb, feuille(XLSX, titre, lignesControle, [18, 9, 14, 14, 14, 20, 14, 16]), 'Contrôle')
  XLSX.utils.book_append_sheet(wb, feuille(XLSX, titre, plan, [9, 52]), 'Plan de comptes')

  const nomFichier = nomFichierJournal(mois, nomResto, provisoire)
  const base64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx', compression: true })
  await enregistrer(nomFichier, { base64 }, MIME_XLSX)
  return {
    nomFichier, nbLignes: lignes.length,
    nbExclues: Object.values(parResto).reduce((s, r) => s + r.exclues, 0),
    difference: controle.groupe.difference,
  }
}
