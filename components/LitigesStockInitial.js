import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useTheme } from '../context/ThemeContext'
import { chargerLitigesStock, deciderLitigeStock } from '../lib/correctionStockInitial'

const fcfa = (n) => `${Math.round(n || 0).toLocaleString('fr-FR')} F`

const LIBELLES = {
  validee: 'Validé : le sortant paie',
  annulee: 'Annulé : le caissier sur place paie',
  appliquee: 'Réglé sur place',
  information: 'Pour information',
}

// Valider : le sortant paie. Annuler : le caissier sur place paie. Le stock de la
// caisse ne change pas : il y a bien le nombre corrigé, seule la retenue bouge.
export default function LitigesStockInitial({ pointId, par, onDecide }) {
  const { colors } = useTheme()
  const styles = useMemo(() => creerStyles(colors), [colors])
  const [litiges, setLitiges] = useState([])
  const [enCours, setEnCours] = useState(null)

  const charger = useCallback(async () => {
    setLitiges(pointId ? await chargerLitigesStock(pointId) : [])
  }, [pointId])

  useEffect(() => {
    charger()
  }, [charger])

  async function decider(litige, decision) {
    setEnCours(litige.id)
    try {
      await deciderLitigeStock(litige.id, decision, par)
      await charger()
      await onDecide?.()
    } catch (e) {
      Alert.alert('Décision impossible', e?.message || 'Réessayez plus tard.')
    } finally {
      setEnCours(null)
    }
  }

  function confirmer(litige, decision) {
    const valider = decision === 'validee'
    const nom = valider ? litige.caissier_sortant_nom || 'Le caissier sortant' : litige.caissier_place_nom || 'Le caissier sur place'
    const montant = valider ? litige.montant_si_valide : litige.montant_si_annule
    Alert.alert(
      valider ? 'Valider ce litige ?' : 'Annuler cette correction ?',
      `${nom} paiera ${fcfa(montant)}.`,
      [
        { text: 'Retour', style: 'cancel' },
        { text: 'Confirmer', onPress: () => decider(litige, decision) },
      ],
    )
  }

  if (litiges.length === 0) return null

  return (
    <View style={styles.bloc}>
      <Text style={styles.titre}>Litiges de stock initial ({litiges.length})</Text>
      {litiges.map((l) => (
        <View key={l.id} style={styles.carte}>
          <Text style={styles.produit}>{l.produit_nom} : {l.stock_reporte} → {l.stock_corrige}</Text>
          <Text style={styles.ligne}>
            Corrigé par {l.saisi_par_nom || l.caissier_place_nom || '—'} · Sortant : {l.caissier_sortant_nom || '—'}
          </Text>
          <Text style={styles.ligne}>« {l.explication} »</Text>
          {l.shift_intermediaire_debloque && (
            <Text style={styles.alerte}>
              Un shift a été débloqué sans comptage entre les deux : le chiffre vient d’un caissier plus ancien.
            </Text>
          )}
          {l.statut !== 'en_attente' ? (
            <Text style={styles.statut}>
              {LIBELLES[l.statut]}{l.decide_par ? ` · ${l.decide_par}` : ''}{l.nouveau_montant ? ` · ${fcfa(l.nouveau_montant)}` : ''}
            </Text>
          ) : enCours === l.id ? (
            <ActivityIndicator color={colors.primary} style={styles.chargement} />
          ) : (
            <>
              {!l.sortant_arrive && <Text style={styles.alerte}>Le shift du sortant n’est pas encore arrivé.</Text>}
              <View style={styles.boutons}>
                <TouchableOpacity
                  style={[styles.bouton, styles.valider, !l.sortant_arrive && styles.inactif]}
                  disabled={!l.sortant_arrive || !!enCours}
                  onPress={() => confirmer(l, 'validee')}
                >
                  <Text style={styles.boutonTxt}>
                    Valider : le sortant paie{l.montant_si_valide != null ? ` ${fcfa(l.montant_si_valide)}` : ''}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.bouton, styles.annuler]}
                  disabled={!!enCours}
                  onPress={() => confirmer(l, 'annulee')}
                >
                  <Text style={styles.boutonTxt}>Annuler : sur place paie {fcfa(l.montant_si_annule)}</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      ))}
    </View>
  )
}

const creerStyles = (colors) => StyleSheet.create({
  bloc: { marginBottom: 16 },
  titre: { fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: 8 },
  carte: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, marginBottom: 8, backgroundColor: colors.surface },
  produit: { fontSize: 15, fontWeight: '700', color: colors.text },
  ligne: { fontSize: 13, color: colors.textMuted, marginTop: 4 },
  alerte: { fontSize: 13, color: colors.warningDark, marginTop: 6, fontWeight: '600' },
  statut: { fontSize: 13, color: colors.textMuted, marginTop: 8, fontWeight: '700' },
  chargement: { marginTop: 10 },
  boutons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  bouton: { flexGrow: 1, flexBasis: 160, minHeight: 48, borderRadius: 8, padding: 10, alignItems: 'center', justifyContent: 'center' },
  valider: { backgroundColor: '#3B6D11' },
  annuler: { backgroundColor: '#A32D2D' },
  inactif: { opacity: 0.5 },
  boutonTxt: { color: '#FFFFFF', fontWeight: '700', fontSize: 13, textAlign: 'center' },
})
