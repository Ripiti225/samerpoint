// Vérification → Stock : « Inventaire global » du jour = la somme des
// inventaires des shifts, produit par produit. Toucher un produit montre les
// plats de la journée qui l'ont fait sortir. Calcul : lib/inventaireGlobal.js
import { useMemo, useState } from 'react'
import { Text, TouchableOpacity, View } from 'react-native'

import { inventaireGlobal } from '../../lib/inventaireGlobal'
import { UNITES } from '../../lib/recettesInventaire'
import PlatsDuProduit from './PlatsDuProduit'

const SEUIL_ECART = 0.01
const fmt = v => Number(v).toLocaleString('fr-FR')

/**
 * @param {object} p
 * @param {Array} p.shifts          shifts d'inventaire (nouveau format), ordre chronologique
 * @param {object|null} p.ventesJour { plat: quantité } de toute la journée, null pendant le chargement
 * @param {string|null} p.erreurVentes
 * @param {boolean} p.peutVoirEcarts manager / directeur : les écarts chiffrés
 * @param {object} p.styles          styles de l'écran Vérification
 * @param {object} p.colors
 */
export default function InventaireGlobal({ shifts, ventesJour, erreurVentes, peutVoirEcarts, styles, colors }) {
  const lignes = useMemo(() => inventaireGlobal(shifts), [shifts])
  const [ouvert, setOuvert] = useState(null)
  if (lignes.length === 0) return null

  return (
    <>
      <Text style={[styles.sectionTitre, { marginTop: 8 }]}>🧮 Inventaire global du jour</Text>
      <View style={styles.invShiftCard}>
        <View style={styles.invShiftHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.invShiftNom}>Somme des {shifts.length} shift(s)</Text>
            <Text style={styles.invLigneSub}>Touchez un produit pour voir les plats vendus qui l'ont utilisé</Text>
          </View>
          <Text style={styles.invShiftCount}>{lignes.length} produit(s)</Text>
        </View>
        {lignes.map(l => {
          const cle = l.produitId || l.produitNom
          const unite = UNITES[l.produitId] ? ` ${UNITES[l.produitId]}` : ''
          const hasEcart = Math.abs(l.ecart) > SEUIL_ECART
          const estOuvert = ouvert === cle
          return (
            <View key={cle}>
              <TouchableOpacity activeOpacity={0.7} onPress={() => setOuvert(estOuvert ? null : cle)}
                style={[styles.invLigneRow, hasEcart && styles.invLigneRowAlert]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.invLigneNom, hasEcart && { color: '#A32D2D' }]}>
                    {estOuvert ? '▾ ' : '▸ '}{l.produitNom}
                  </Text>
                  <Text style={styles.invLigneSub}>
                    Début : {fmt(l.stockInitial)}{unite} | +{fmt(l.entrees)} | -{fmt(l.sorties)} | Fin : {fmt(l.stockReel)}{unite}
                  </Text>
                </View>
                <View style={[styles.invEcartBadge, { backgroundColor: hasEcart ? '#FCEBEB' : '#EAF3DE' }]}>
                  <Text style={[styles.invEcartTxt, { color: hasEcart ? '#A32D2D' : '#3B6D11' }]}>
                    {hasEcart ? (peutVoirEcarts ? `${l.ecart > 0 ? '+' : ''}${fmt(l.ecart)}` : '⚠️') : '✅'}
                  </Text>
                </View>
              </TouchableOpacity>
              {estOuvert && (
                <PlatsDuProduit produitId={l.produitId} sortiePOS={l.sorties} ventes={ventesJour} erreur={erreurVentes} colors={colors} />
              )}
            </View>
          )
        })}
      </View>
    </>
  )
}
