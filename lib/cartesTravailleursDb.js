// ──────────────────────────────────────────────────────────────────────────────
// Cartes des travailleurs : émission, dernière carte, QR, badge rendu.
// Table `cartes_travailleurs` + fonction `verifier_carte` :
// migration supabase_cartes_travailleurs.sql.
//
// Le QR est calculé SANS attente (modules internes de `qrcode`) : sur iPhone,
// Safari bloque la fenêtre d'impression si elle s'ouvre après un `await`.
// D'où deux temps dans la fiche : « Créer la carte » (base), puis « Imprimer ».
// ──────────────────────────────────────────────────────────────────────────────
import QRCodeCore from 'qrcode/lib/core/qrcode'
import SvgTag from 'qrcode/lib/renderer/svg-tag'
import { ajouterMois, urlVerification, VALIDITE_MOIS } from './carteTravailleur.js'
import { aujourdhuiISO } from './contrats'
import { supabase } from './supabase'

const MIGRATION = 'La vérification des cartes n\'est pas encore activée (migration supabase_cartes_travailleurs.sql à passer).'
const manqueMigration = e => /cartes_travailleurs|badge_rendu|schema cache|does not exist/i.test(e?.message || '')

/** SVG du QR de vérification d'une carte, calculé immédiatement. */
export function qrSvgCarte(jeton) {
  const qr = QRCodeCore.create(urlVerification(jeton), { errorCorrectionLevel: 'M' })
  return SvgTag.render(qr, { margin: 0 })
}

/** Dernière carte imprimée pour ce travailleur (null si aucune ou migration absente). */
export async function derniereCarte(travailleurId) {
  const { data, error } = await supabase.from('cartes_travailleurs')
    .select('id, valide_jusqua, emise_le')
    .eq('travailleur_id', travailleurId)
    .order('emise_le', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) return manqueMigration(error) ? { indisponible: true } : null
  return data
}

/** Nouvelle carte valable VALIDITE_MOIS mois ; la précédente devient « remplacée ». */
export async function emettreCarte(travailleurId, emisePar) {
  const { data, error } = await supabase.from('cartes_travailleurs').insert({
    travailleur_id: travailleurId,
    valide_jusqua: ajouterMois(aujourdhuiISO(), VALIDITE_MOIS),
    emise_par: emisePar || null,
  }).select('id, valide_jusqua, emise_le').single()
  if (error) throw new Error(manqueMigration(error) ? MIGRATION : 'Impossible de créer la carte. Vérifiez la connexion.')
  return data
}

/** Le badge d'un travailleur archivé a été rapporté. */
export async function marquerBadgeRendu(travailleurId) {
  const { error } = await supabase.from('travailleurs')
    .update({ badge_rendu: true, badge_rendu_le: aujourdhuiISO() })
    .eq('id', travailleurId)
  if (error) throw new Error(manqueMigration(error) ? MIGRATION : 'Enregistrement impossible. Vérifiez la connexion.')
}
