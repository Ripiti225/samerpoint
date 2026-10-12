// Fournisseur administratif payé par la direction (banque, espèces de la
// trésorerie, coffre) : baisse son crédit, sort l'argent du compte choisi et
// crée une dépense direction « Fournisseur administratif », comptée comme
// charge du restaurant dans le résultat net du mois.
// styles : ceux de l'écran Crédits fournisseurs (même apparence).
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Modal, SafeAreaView, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native'
import ChampDate from '../ChampDate'
import { useTheme } from '../../context/ThemeContext'
import { aujourdhuiISO } from '../../lib/tresorerie'
import { chargerComptesTresorerie, payerFournisseurAdminDirection } from '../../lib/tresorerieDb'

const fmt = v => `${Math.round(Number(v) || 0).toLocaleString('fr-FR')} FCFA`

export default function FeuillePaiementDirection({ fournisseur, userId, userNom, styles, onFermer, onEnregistre }) {
  const { colors } = useTheme()
  const [comptes, setComptes] = useState([])
  const [source, setSource] = useState(null)
  const [montant, setMontant] = useState('')
  const [date, setDate] = useState(aujourdhuiISO())
  const [note, setNote] = useState('')
  const [occupe, setOccupe] = useState(false)
  const [erreur, setErreur] = useState(null)

  useEffect(() => {
    if (!fournisseur) return
    const du = Number(fournisseur.credit_actuel) || 0
    setMontant(du > 0 ? String(Math.round(du)) : '')
    setDate(aujourdhuiISO())
    setNote('')
    setSource(null)
    setErreur(null)
    chargerComptesTresorerie().then(setComptes).catch(e => setErreur(e?.message || 'Comptes introuvables.'))
  }, [fournisseur])

  const v = parseInt(montant, 10) || 0
  const pret = v > 0 && source && /^\d{4}-\d{2}-\d{2}$/.test(date)

  async function enregistrer() {
    if (!pret || occupe) return
    setOccupe(true)
    setErreur(null)
    try {
      await payerFournisseurAdminDirection({ fournisseur, date, montant: v, source, note: note.trim() }, { userId, userNom })
      onEnregistre()
    } catch (e) {
      setErreur(e?.message || 'Paiement non enregistré. Réessayez.')
    }
    setOccupe(false)
  }

  const reste = (Number(fournisseur?.credit_actuel) || 0) - v

  return (
    <Modal visible={!!fournisseur} animationType="slide" presentationStyle="formSheet" onRequestClose={onFermer}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={onFermer} style={styles.enteteBtn} accessibilityRole="button" accessibilityLabel="Fermer">
            <MaterialCommunityIcons name="close" size={22} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={[styles.modalTitre, { flex: 1, textAlign: 'center' }]} numberOfLines={1}>Payé par la direction</Text>
          <View style={{ width: 40 }} />
        </View>
        {fournisseur && (
          <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
            <View style={styles.fournInfo}>
              <Text style={styles.fournInfoNom}>{fournisseur.nom}</Text>
              <Text style={styles.fournInfoSub}>
                {fournisseur.restaurant_nom ? `${fournisseur.restaurant_nom} · ` : ''}dû : {fmt(Math.max(0, Number(fournisseur.credit_actuel) || 0))}
              </Text>
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Montant payé *</Text>
              <TextInput style={[styles.formInput, { fontSize: 20, textAlign: 'center', fontWeight: '700' }]} value={montant}
                onChangeText={t => setMontant(t.replace(/[^0-9]/g, ''))} keyboardType="numeric"
                placeholder="0" placeholderTextColor={colors.textPlaceholder} />
            </View>

            <ChampDate label="Date du paiement" styleLabel={styles.formLabel} valeur={date} onChange={setDate} maxDate={aujourdhuiISO()} />

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Payé depuis *</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {[...comptes.map(c => ({ id: c.id, nom: c.nom })), { id: 'coffre', nom: 'Coffre' }].map(c => (
                  <TouchableOpacity key={c.id} style={[styles.moisChip, source === c.id && styles.moisChipActive]} onPress={() => setSource(c.id)}>
                    <Text style={[styles.moisChipTxt, source === c.id && styles.moisChipTxtActive]}>{c.nom}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Note (facultatif)</Text>
              <TextInput style={styles.formInput} value={note} onChangeText={setNote}
                placeholder="Ex : TEE septembre et octobre" placeholderTextColor={colors.textPlaceholder} />
            </View>

            <View style={styles.traceNote}>
              <MaterialCommunityIcons name="information-outline" size={16} color={colors.textSecondary} />
              <Text style={styles.traceNoteTxt}>
                {v > 0 ? `Après ce paiement : ${reste < 0 ? `${fmt(-reste)} d'avance` : `${fmt(reste)} encore dû`}. ` : ''}
                Le paiement est noté dans Dépenses direction et compte comme une charge du restaurant ce mois-là.
              </Text>
            </View>

            {erreur ? <Text style={{ color: colors.error, marginBottom: 10, fontWeight: '600' }}>{erreur}</Text> : null}

            <TouchableOpacity style={[styles.saveBtn, { backgroundColor: colors.primary }, (!pret || occupe) && { opacity: 0.6 }]}
              onPress={enregistrer} disabled={!pret || occupe}>
              {occupe ? <ActivityIndicator size="small" color="#FFFFFF" /> : <MaterialCommunityIcons name="cash-check" size={18} color="#FFFFFF" />}
              <Text style={styles.saveBtnTxt}>{occupe ? 'Enregistrement…' : 'Enregistrer le paiement'}</Text>
            </TouchableOpacity>
            <View style={{ height: 30 }} />
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  )
}
