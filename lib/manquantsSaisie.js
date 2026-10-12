// Ce qui manque avant d'enregistrer (Déductions gérant, Saisie des ventes) et
// résumés affichés par ces deux écrans. Une seule source pour l'affichage
// « Il manque : … » et pour le contrôle au moment d'appuyer : ils ne peuvent
// pas diverger. Les messages d'alerte sont repris mot pour mot de l'ancien
// contrôle de app/ventes.js.
import { facturesGerantSansPhoto } from './creditsFournisseurs.js'

const nombre = v => parseFloat(v) || 0
const fmt = n => Math.round(n).toLocaleString('fr-FR') + ' FCFA'

// Factures fournisseur sans photo : bloque la sauvegarde des déductions.
export function manquantsDeductions(fournisseursGerantCaisse, nomDe = () => 'Fournisseur') {
  return facturesGerantSansPhoto(fournisseursGerantCaisse).map(id => ({
    cle: `photo_${id}`,
    texte: `photo facture ${fournisseursGerantCaisse?.[id]?.nom || nomDe(id)}`,
    bloquant: true,
  }))
}

// Barre payé / dû d'un fournisseur. dû = crédit de la veille + facture du jour.
export function progressionFournisseur({ creditVeille, facture, paye }) {
  const du = nombre(creditVeille) + nombre(facture)
  const p = nombre(paye)
  const reste = du - p
  return { du, paye: p, reste, ratio: du > 0 ? Math.min(1, Math.max(0, p / du)) : 1, solde: reste <= 0 }
}

// Nombre de lignes et montant de chaque onglet des déductions. idsAdmin : ids
// des fournisseurs administratifs (onglet à part).
export function resumeDeductions(depenses, fournisseurs, paies, idsAdmin = new Set()) {
  const lignesDep = Object.values(depenses || {}).flatMap(l => l || [])
  const saisis = Object.entries(fournisseurs || {}).filter(([, f]) => nombre(f?.paye) > 0 || nombre(f?.montant_facture) > 0)
  const compter = liste => ({ n: liste.length, total: liste.reduce((s, [, f]) => s + nombre(f?.paye), 0) })
  const listePaies = paies || []
  return {
    fournisseurs: compter(saisis.filter(([id]) => !idsAdmin.has(id))),
    administratifs: compter(saisis.filter(([id]) => idsAdmin.has(id))),
    depenses: { n: lignesDep.length, total: lignesDep.reduce((s, l) => s + nombre(l?.montant), 0) },
    paies: { n: listePaies.length, total: listePaies.reduce((s, l) => s + nombre(l?.montant), 0) },
  }
}

// Photos obligatoires de la saisie des ventes (alerte « Continuer quand
// même », jamais bloquante). Pas de photo de la vente machine quand c'est
// le système qui l'a écrite : il n'y a aucun écran à photographier.
export function photosManquantesVentes({ ventesJour = {}, venteMachineDuSysteme = false, voitMachine = false }) {
  const manquantes = []
  if (nombre(ventesJour.yangoTab) > 0 && !ventesJour.photo_yango_tab) manquantes.push('Yango TAB')
  if (nombre(ventesJour.glovoTab) > 0 && !ventesJour.photo_glovo_tab) manquantes.push('Glovo TAB')
  if (!venteMachineDuSysteme && voitMachine && nombre(ventesJour.venteMachine) > 0 && !ventesJour.photoVenteMachine) {
    manquantes.push('Photo vente machine')
  }
  return manquantes
}

const PHOTOS = {
  'Yango TAB': { cle: 'photo_yango', etape: 1, texte: 'photo Yango TAB' },
  'Glovo TAB': { cle: 'photo_glovo', etape: 1, texte: 'photo Glovo TAB' },
  'Photo vente machine': { cle: 'photo_machine', etape: 3, texte: 'photo vente machine' },
}

// Tout ce qui manque à la saisie des ventes. Bloquants d'abord, dans l'ordre
// où l'ancien contrôle les vérifiait (le premier donne l'alerte affichée).
// Sur un site POS, l'écart est déjà mesuré, expliqué et rattaché à sa
// caissière dans la caisse : rien n'est redemandé. Le manager passe outre.
export function manquantsVentes({
  ventesJour = {}, cumulShifts = null, venteMachineRecue = false,
  venteMachineDuSysteme = false, voitMachine = false, isManager = false,
}) {
  if (isManager) return []
  const liste = []
  if (cumulShifts && venteMachineRecue && !venteMachineDuSysteme) {
    const ecartSigne = (cumulShifts.venteTotal || 0) - nombre(ventesJour.venteMachine)
    const ecart = Math.abs(ecartSigne)
    if (ecart > 0) {
      const libelle = ecartSigne < 0 ? 'manquant' : 'surplus'
      if ((ventesJour.explicacionEcartMachine || '').trim().length < 10) {
        liste.push({ cle: 'explication', etape: 3, bloquant: true, texte: "explication de l'écart", alerte: {
          titre: 'Explication requise',
          message: 'Un écart a été détecté entre la vente théorique et la vente machine.\n\nVeuillez saisir une explication d\'au moins 10 caractères avant de continuer.',
        } })
      }
      const responsables = ventesJour.ecartResponsables || []
      const totalImpute = responsables.reduce((s, r) => s + nombre(r.montant), 0)
      if (responsables.length === 0) {
        liste.push({ cle: 'responsable', etape: 3, bloquant: true, texte: `responsable du ${libelle}`, alerte: {
          titre: 'Responsable requis',
          message: `Un ${libelle} a été détecté.\n\nDésignez au moins un responsable et imputez-lui un montant avant de continuer.`,
        } })
      } else if (responsables.some(r => !(parseFloat(r.montant) > 0))) {
        liste.push({ cle: 'montant_responsable', etape: 3, bloquant: true, texte: "montant d'un responsable", alerte: {
          titre: 'Montant manquant',
          message: 'Chaque responsable doit avoir un montant supérieur à 0.',
        } })
      } else if (Math.round(totalImpute) !== Math.round(ecart)) {
        liste.push({ cle: 'repartition', etape: 3, bloquant: true, texte: `répartition du ${libelle}`, alerte: {
          titre: 'Répartition incomplète',
          message: `La somme imputée aux responsables (${fmt(totalImpute)}) doit être égale au ${libelle} total (${fmt(ecart)}).`,
        } })
      }
    }
  }
  for (const libelle of photosManquantesVentes({ ventesJour, venteMachineDuSysteme, voitMachine })) {
    liste.push({ ...PHOTOS[libelle], bloquant: false })
  }
  return liste
}
