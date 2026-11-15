// Détail « quels plats ont fait sortir ce produit », sous une ligne d'inventaire
// (Vérification → Stock). Calcul : lib/inventaireGlobal.js (platsDuProduit).
import { ActivityIndicator, Text, View } from 'react-native'

import { platsDuProduit } from '../../lib/inventaireGlobal'
import { POS_NON_INSTALLE } from '../../lib/statsPOSDb'

/** Erreur à passer quand le shift n'a pas de service de caisse POS. */
export const SANS_POS = 'sans_pos'

const fmtQte =(v, unite) => `${Number(v).toLocaleString('fr-FR')}${unite ? ` ${unite}` : ''}`

/**
 * @param {object} p
 * @param {string} p.produitId
 * @param {number} p.sortiePOS     sortie calculée par le POS pour la période
 * @param {object|null} p.ventes   { plat: quantité } ou null pendant le chargement
 * @param {string|null} p.erreur   erreur de lecture du POS
 * @param {object} p.colors
 */
export default function PlatsDuProduit({ produitId, sortiePOS, ventes, erreur, colors }) {
  const boite = { backgroundColor: colors.bg, borderRadius: 10, padding: 10, marginTop: 6, marginBottom: 4 }
  const petit = { fontSize: 11, color: colors.textMuted }

  if (erreur) {
    const message = erreur === POS_NON_INSTALLE
      ? 'Les plats vendus ne sont pas encore disponibles : passez pos_cloud_plats_services.sql dans le projet pos-samer-cloud.'
      : erreur === SANS_POS
        ? 'Ce shift ne vient pas du POS : pas de plats vendus à montrer.'
        : 'Impossible de lire les plats vendus dans le POS pour le moment.'
    return <View style={boite}><Text style={petit}>{message}</Text></View>
  }
  if (!ventes) return <View style={boite}><ActivityIndicator size="small" color={colors.primary} /></View>

  const r = platsDuProduit(produitId, ventes, sortiePOS)
  if (!r.aRecette) {
    return <View style={boite}><Text style={petit}>Pas encore de recette pour ce produit : impossible de dire quels plats l'ont utilisé.</Text></View>
  }

  return (
    <View style={boite}>
      {r.lignes.length === 0
        ? <Text style={petit}>Aucun plat vendu qui utilise ce produit.</Text>
        : r.lignes.map(l => (
          <View key={l.plat} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 }}>
            <Text style={{ fontSize: 12, color: colors.text, flex: 1, paddingRight: 8 }} numberOfLines={1}>
              {l.plat}
            </Text>
            <Text style={{ fontSize: 12, color: colors.text, fontWeight: '700' }}>
              {l.parPlat === 1 && !r.unite ? `× ${l.nombre}` : `× ${l.nombre} → ${fmtQte(l.consomme, r.unite)}`}
            </Text>
          </View>
        ))}
      <View style={{ borderTopWidth: 0.5, borderTopColor: colors.border, marginTop: 6, paddingTop: 6 }}>
        <Text style={petit}>
          Total des plats : {fmtQte(r.totalCalcule, r.unite)} · Sortie POS : {fmtQte(sortiePOS, r.unite)}
        </Text>
        {Math.abs(r.ecart) > 0.001 && (
          <Text style={[petit, { color: '#854F0B', marginTop: 2 }]}>
            Écart avec le POS : {r.ecart > 0 ? '+' : ''}{fmtQte(r.ecart, r.unite)} (plat offert, annulé ou absent de la recette)
          </Text>
        )}
      </View>
    </View>
  )
}
