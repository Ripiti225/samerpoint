// Fournisseur administratif sans montant automatique : le RH (ou le manager)
// ajoute chaque mois ce qui est dû, sans facture. Crée une vraie ligne de
// transaction (source « montant_du_admin ») qui monte le dû. Ce n'est pas une
// charge (règle du 12/10/2026) : seul le paiement l'est — caisse du gérant
// (déjà dans ses dépenses) ou direction (dépense direction « administratif »).
// styles : ceux de l'écran Crédits fournisseurs (même apparence).
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Modal, SafeAreaView, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native'
import ChampDate from '../ChampDate'
import { useTheme } from '../../context/ThemeContext'
import { estAdministratif, SOURCE_MONTANT_DU } from '../../lib/fournisseursAdmin'
import { journaliser } from '../../lib/journal'
import { supabase } from '../../lib/supabase'
import { aujourdhuiISO } from '../../lib/tresorerie'

const fmt = v => `${Math.round(Number(v) || 0).toLocaleString('fr-FR')} FCFA`

export default function FeuilleMontantDu({ fournisseur, roleActif, userId, userNom, styles, onFermer, onEnregistre }) {
  const { colors } = useTheme()
  const [montant, setMontant] = useState('')
  const [date, setDate] = useState(aujourdhuiISO())
  const [motif, setMotif] = useState('')
  const [occupe, setOccupe] = useState(false)
  const [erreur, setErreur] = useState(null)

  useEffect(() => {
    if (!fournisseur) return
    setMontant('')
    setDate(aujourdhuiISO())
    setMotif('')
    setErreur(null)
  }, [fournisseur])

  const v = parseInt(montant, 10) || 0
  const pret = v > 0 && /^\d{4}-\d{2}-\d{2}$/.test(date) && estAdministratif(fournisseur)

  async function enregistrer() {
    if (!pret || occupe) return
    setOccupe(true)
    setErreur(null)
    try {
      const { data: txId, error } = await supabase.rpc('inserer_transaction_hors_point', {
        p_fournisseur: fournisseur.id, p_date: date, p_facture: v, p_paye: 0,
        p_saisi_par: roleActif || 'rh', p_source: SOURCE_MONTANT_DU, p_caissier_nom: userNom || null,
      })
      if (error) throw error
      // Le motif s'affiche sous la ligne dans l'historique (pas de colonne note).
      if (txId && motif.trim()) {
        await supabase.from('transactions_fournisseurs').update({ facture_correction_raison: motif.trim() }).eq('id', txId)
      }
      journaliser('fournisseur_admin_montant_du', {
        fournisseur: fournisseur.nom, montant: v, date, motif: motif.trim() || null,
      }, { restaurantId: fournisseur.restaurant_id, userId, userNom }).catch(() => {})
      onEnregistre()
    } catch (e) {
      setErreur(e?.message || 'Montant non enregistré. Réessayez.')
    }
    setOccupe(false)
  }

  const apres = (Number(fournisseur?.credit_actuel) || 0) + v

  return (
    <Modal visible={!!fournisseur} animationType="slide" presentationStyle="formSheet" onRequestClose={onFermer}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={onFermer} style={styles.enteteBtn} accessibilityRole="button" accessibilityLabel="Fermer">
            <MaterialCommunityIcons name="close" size={22} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={[styles.modalTitre, { flex: 1, textAlign: 'center' }]} numberOfLines={1}>Ajouter un montant dû</Text>
          <View style={{ width: 40 }} />
        </View>
        {fournisseur && (
          <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
            <View style={styles.fournInfo}>
              <Text style={styles.fournInfoNom}>{fournisseur.nom}</Text>
              <Text style={styles.fournInfoSub}>
                {fournisseur.restaurant_nom ? `${fournisseur.restaurant_nom} · ` : ''}dû aujourd'hui : {fmt(Number(fournisseur.credit_actuel) || 0)}
              </Text>
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Montant dû *</Text>
              <TextInput style={[styles.formInput, { fontSize: 20, textAlign: 'center', fontWeight: '700' }]} value={montant}
                onChangeText={t => setMontant(t.replace(/[^0-9]/g, ''))} keyboardType="numeric"
                placeholder="0" placeholderTextColor={colors.textPlaceholder} />
            </View>

            <ChampDate label="Date" styleLabel={styles.formLabel} valeur={date} onChange={setDate} />

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Motif (facultatif)</Text>
              <TextInput style={styles.formInput} value={motif} onChangeText={setMotif}
                placeholder="Ex : CNPS octobre" placeholderTextColor={colors.textPlaceholder} />
            </View>

            <View style={styles.traceNote}>
              <MaterialCommunityIcons name="information-outline" size={16} color={colors.textSecondary} />
              <Text style={styles.traceNoteTxt}>
                {v > 0 ? `Après l'ajout : ${fmt(apres)} dû. ` : ''}
                Une ligne est créée dans l'historique, sans facture. Ce n'est pas encore une charge : seul le paiement en sera une (par la caisse du gérant ou par la direction).
              </Text>
            </View>

            {erreur ? <Text style={{ color: colors.error, marginBottom: 10, fontWeight: '600' }}>{erreur}</Text> : null}

            <TouchableOpacity style={[styles.saveBtn, { backgroundColor: colors.primary }, (!pret || occupe) && { opacity: 0.6 }]}
              onPress={enregistrer} disabled={!pret || occupe}>
              {occupe ? <ActivityIndicator size="small" color="#FFFFFF" /> : <MaterialCommunityIcons name="calendar-plus" size={18} color="#FFFFFF" />}
              <Text style={styles.saveBtnTxt}>{occupe ? 'Enregistrement…' : 'Ajouter'}</Text>
            </TouchableOpacity>
            <View style={{ height: 30 }} />
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  )
}
