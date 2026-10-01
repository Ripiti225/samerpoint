/*
 * SQL À EXÉCUTER DANS SUPABASE AVANT D'UTILISER CE MODULE :
 *
 * CREATE TABLE demandes (
 *   id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
 *   restaurant_id uuid REFERENCES restaurants(id),
 *   travailleur_id uuid REFERENCES travailleurs(id),
 *   travailleur_nom text,
 *   type text NOT NULL,
 *   necessite_dates boolean DEFAULT false,
 *   date_debut date,
 *   date_fin date,
 *   description text,
 *   statut text DEFAULT 'en_attente',
 *   cree_par_id uuid REFERENCES utilisateurs(id),
 *   cree_par_nom text,
 *   traite_par_id uuid REFERENCES utilisateurs(id),
 *   traite_par_nom text,
 *   motif_decline text,
 *   annule_par_id uuid REFERENCES utilisateurs(id),
 *   annule_par_nom text,
 *   annule_at timestamptz,
 *   created_at timestamptz DEFAULT now(),
 *   traite_at timestamptz
 * );
 *
 * -- Migration données existantes (optionnel) :
 * INSERT INTO demandes (
 *   restaurant_id, travailleur_id, travailleur_nom, type, necessite_dates,
 *   date_debut, date_fin, description, statut, created_at
 * )
 * SELECT
 *   restaurant_id, travailleur_id, travailleur_nom,
 *   CASE WHEN type = 'conge' THEN 'Congé annuel' ELSE 'Autre' END,
 *   true, date_debut, date_fin, motif, 'validee', created_at
 * FROM permissions_conges;
 */

import { retour } from '../lib/navigation'
import { useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native'
import { Calendar } from 'react-native-calendars'
import { useApp } from '../context/AppContext'
import { useTheme } from '../context/ThemeContext'
import { journaliser } from '../lib/journal'
import { TYPES_DEMANDE } from '../lib/constants'
import { creerNotification } from '../lib/notificationsInterne'
import { envoyerNotifDemandeNouvelle } from '../lib/notifications'
import { supabase } from '../lib/supabase'

const STATUT_CONFIG = {
  en_attente: { label: '🟡 En attente', bg: '#FEF9EC', text: '#854F0B' },
  validee:    { label: '✅ Validée',    bg: '#EAF3DE', text: '#3B6D11' },
  declinee:   { label: '❌ Déclinée',   bg: '#FAECE7', text: '#993C1D' },
  annulee:    { label: '🚫 Annulée',    bg: '#F1EFE8', text: '#666'    },
}

function fmtDate(d) {
  if (!d) return ''
  const [y, m, j] = d.split('-')
  const mois = ['jan','fév','mar','avr','mai','juin','jul','aoû','sep','oct','nov','déc']
  return `${parseInt(j)} ${mois[parseInt(m) - 1]} ${y}`
}

export default function DemandesScreen() {
  const { restaurantId, restaurantNom, userId, userNom, roleActif } = useApp()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const [demandes, setDemandes] = useState([])
  const [travailleurs, setTravailleurs] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showModal, setShowModal] = useState(false)

  // Form state
  const [formType, setFormType] = useState(null)        // TYPES_DEMANDE item
  const [formTrav, setFormTrav] = useState(null)        // { id, nom }
  const [formDesc, setFormDesc] = useState('')
  const [formMontant, setFormMontant] = useState('')
  const [formDateDebut, setFormDateDebut] = useState('')
  const [formDateFin, setFormDateFin] = useState('')
  const [dateChamp, setDateChamp] = useState(null)      // 'debut' | 'fin' | null

  useEffect(() => {
    if (restaurantId) charger()
  }, [restaurantId])

  async function charger() {
    setLoading(true)
    const [{ data: travData }, { data: demandesData }] = await Promise.all([
      supabase.from('travailleurs').select('id, nom').eq('restaurant_id', restaurantId).eq('actif', true).order('nom'),
      supabase.from('demandes').select('*').eq('restaurant_id', restaurantId).order('created_at', { ascending: false }),
    ])
    setTravailleurs(travData || [])
    setDemandes(demandesData || [])
    setLoading(false)
  }

  function resetForm() {
    setFormType(null)
    setFormTrav(null)
    setFormDesc('')
    setFormMontant('')
    setFormDateDebut('')
    setFormDateFin('')
    setDateChamp(null)
  }

  async function soumettre() {
    if (!formType) return Alert.alert('Erreur', 'Sélectionnez un type de demande')
    if (!formTrav) return Alert.alert('Erreur', 'Sélectionnez un travailleur')
    if (formType.necessiteDates && (!formDateDebut || !formDateFin)) {
      return Alert.alert('Erreur', 'Les dates sont obligatoires pour ce type de demande')
    }
    if (formType.necessiteDates && formDateFin < formDateDebut) {
      return Alert.alert('Erreur', 'La date de fin doit être après la date de début')
    }
    if (formType.necessiteMontant && !(parseFloat(formMontant) > 0)) {
      return Alert.alert('Montant requis', 'Saisissez le montant demandé (supérieur à 0) pour ce type de demande.')
    }
    setSaving(true)
    const { error } = await supabase.from('demandes').insert({
      restaurant_id: restaurantId,
      travailleur_id: formTrav.id,
      travailleur_nom: formTrav.nom,
      type: formType.label,
      necessite_dates: formType.necessiteDates,
      date_debut: formType.necessiteDates ? formDateDebut : null,
      date_fin: formType.necessiteDates ? formDateFin : null,
      montant: formType.necessiteMontant ? (parseFloat(formMontant) || 0) : null,
      description: formDesc.trim() || null,
      statut: 'en_attente',
      cree_par_id: userId,
      cree_par_nom: userNom,
    })
    if (error) {
      setSaving(false)
      return Alert.alert('Erreur', error.message)
    }
    creerNotification({
      type: 'demande_nouvelle',
      titre: 'Nouvelle demande',
      message: `${formType.icon} ${formType.label} pour ${formTrav.nom} — ${restaurantNom}`,
      restaurant_id: restaurantId,
      cible_role: ['directeur', 'rh', 'manager'],
      created_by: userId,
      screen: 'demandes-admin',
    }).catch(() => {})
    envoyerNotifDemandeNouvelle(formTrav.nom, `${formType.icon} ${formType.label}`, restaurantId).catch(() => {})
    journaliser({ action: 'demande_creee', details: `${formType.label} pour ${formTrav.nom}`, userId, restaurantId }).catch(() => {})
    setSaving(false)
    setShowModal(false)
    resetForm()
    charger()
  }

  if (loading) return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => retour()}>
          <Text style={styles.back}>‹ Retour</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitre}>Demandes</Text>
        <View style={{ width: 60 }} />
      </View>
      <View style={styles.loadingBox}>
        <ActivityIndicator size="large" color="#534AB7" />
      </View>
    </SafeAreaView>
  )

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => retour()}>
          <Text style={styles.back}>‹ Retour</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitre}>Demandes</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
        <TouchableOpacity style={styles.addBtn} onPress={() => { resetForm(); setShowModal(true) }}>
          <Text style={styles.addBtnTxt}>+ Nouvelle demande</Text>
        </TouchableOpacity>

        {demandes.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyIcon}>📋</Text>
            <Text style={styles.emptyTxt}>Aucune demande pour ce restaurant</Text>
          </View>
        ) : (
          demandes.map(d => {
            const cfg = STATUT_CONFIG[d.statut] || STATUT_CONFIG.en_attente
            const typeDef = TYPES_DEMANDE.find(t => t.label === d.type)
            return (
              <View key={d.id} style={styles.card}>
                <View style={styles.cardTop}>
                  <Text style={styles.cardType}>{typeDef?.icon || '📋'} {d.type}</Text>
                  <View style={[styles.statutBadge, { backgroundColor: cfg.bg }]}>
                    <Text style={[styles.statutTxt, { color: cfg.text }]}>{cfg.label}</Text>
                  </View>
                </View>
                <Text style={styles.cardTrav}>{d.travailleur_nom}</Text>
                {d.date_debut && (
                  <Text style={styles.cardDates}>📅 {fmtDate(d.date_debut)} → {fmtDate(d.date_fin)}</Text>
                )}
                {d.montant > 0 && (
                  <Text style={styles.cardMontant}>💰 Montant demandé : {Math.round(d.montant).toLocaleString('fr-FR')} FCFA</Text>
                )}
                {d.description ? <Text style={styles.cardDesc}>"{d.description}"</Text> : null}
                <Text style={styles.cardMeta}>
                  Soumis le {fmtDate(d.created_at?.split('T')[0])}
                  {d.cree_par_nom ? ` par ${d.cree_par_nom}` : ''}
                </Text>
                {d.statut === 'validee' && d.montant_alloue > 0 && (
                  <Text style={styles.cardMontant}>✅ Montant alloué : {Math.round(d.montant_alloue).toLocaleString('fr-FR')} FCFA</Text>
                )}
                {d.statut === 'validee' && d.traite_par_nom && (
                  <Text style={styles.cardMeta}>✅ Validé par {d.traite_par_nom}</Text>
                )}
                {d.statut === 'declinee' && (
                  <View style={styles.declineBox}>
                    <Text style={styles.declineTitre}>Motif du refus :</Text>
                    <Text style={styles.declineTxt}>{d.motif_decline}</Text>
                  </View>
                )}
                {d.statut === 'annulee' && d.annule_par_nom && (
                  <Text style={styles.cardMeta}>🚫 Annulé par {d.annule_par_nom}</Text>
                )}
              </View>
            )
          })
        )}
        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Modal nouvelle demande */}
      <Modal visible={showModal} transparent animationType="slide">
        <TouchableWithoutFeedback onPress={Platform.OS === 'web' ? undefined : Keyboard.dismiss}>
          <View style={styles.modalOverlay}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ width: '100%' }}>
              <View style={styles.modal}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitre}>Nouvelle demande</Text>
                  <TouchableOpacity onPress={() => { setShowModal(false); resetForm() }}>
                    <Text style={styles.modalClose}>✕</Text>
                  </TouchableOpacity>
                </View>

                <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                  {/* Type de demande */}
                  <Text style={styles.label}>Type de demande</Text>
                  <View style={styles.typesGrid}>
                    {TYPES_DEMANDE.map(t => (
                      <TouchableOpacity
                        key={t.label}
                        style={[styles.typeChip, formType?.label === t.label && styles.typeChipActive]}
                        onPress={() => { setFormType(t); setFormDateDebut(''); setFormDateFin(''); setDateChamp(null) }}
                      >
                        <Text style={[styles.typeChipTxt, formType?.label === t.label && styles.typeChipTxtActive]}>
                          {t.icon} {t.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {/* Travailleur */}
                  <Text style={styles.label}>Travailleur</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginBottom: 14 }}>
                    {travailleurs.map(t => (
                      <TouchableOpacity
                        key={t.id}
                        style={[styles.travChip, formTrav?.id === t.id && styles.travChipActive]}
                        onPress={() => setFormTrav(t)}
                      >
                        <Text style={[styles.travChipTxt, formTrav?.id === t.id && styles.travChipTxtActive]}>
                          {t.nom}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>

                  {/* Dates — seulement si necessiteDates */}
                  {formType?.necessiteDates && (
                    <>
                      <Text style={styles.label}>Dates</Text>
                      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
                        <TouchableOpacity
                          style={[styles.dateBtn, dateChamp === 'debut' && styles.dateBtnActive]}
                          onPress={() => setDateChamp(dateChamp === 'debut' ? null : 'debut')}
                        >
                          <Text style={[styles.dateBtnTxt, formDateDebut && { color: colors.text, fontWeight: '600' }, dateChamp === 'debut' && { color: '#fff' }]}>
                            {formDateDebut ? fmtDate(formDateDebut) : '📅 Début'}
                          </Text>
                        </TouchableOpacity>
                        <Text style={{ color: colors.textMuted, alignSelf: 'center' }}>→</Text>
                        <TouchableOpacity
                          style={[styles.dateBtn, dateChamp === 'fin' && styles.dateBtnActive]}
                          onPress={() => setDateChamp(dateChamp === 'fin' ? null : 'fin')}
                        >
                          <Text style={[styles.dateBtnTxt, formDateFin && { color: colors.text, fontWeight: '600' }, dateChamp === 'fin' && { color: '#fff' }]}>
                            {formDateFin ? fmtDate(formDateFin) : '📅 Fin'}
                          </Text>
                        </TouchableOpacity>
                      </View>
                      {dateChamp !== null && (
                        <Calendar
                          onDayPress={day => {
                            if (dateChamp === 'debut') setFormDateDebut(day.dateString)
                            else setFormDateFin(day.dateString)
                            setDateChamp(null)
                          }}
                          markedDates={{
                            ...(formDateDebut ? { [formDateDebut]: { selected: true, selectedColor: '#534AB7' } } : {}),
                            ...(formDateFin ? { [formDateFin]: { selected: true, selectedColor: '#3B6D11' } } : {}),
                          }}
                          theme={{
                            selectedDayBackgroundColor: dateChamp === 'debut' ? '#534AB7' : '#3B6D11',
                            todayTextColor: '#534AB7',
                            arrowColor: '#534AB7',
                            monthTextColor: colors.text,
                            dayTextColor: colors.text,
                            textDisabledColor: '#ccc',
                          }}
                        />
                      )}
                    </>
                  )}

                  {/* Montant — seulement pour les demandes financières */}
                  {formType?.necessiteMontant && (
                    <>
                      <Text style={styles.label}>Montant demandé (FCFA)</Text>
                      <TextInput
                        style={[styles.input, { color: colors.text, borderColor: colors.border }]}
                        placeholder="Ex : 50000"
                        placeholderTextColor={colors.textMuted}
                        keyboardType="numeric"
                        value={formMontant}
                        onChangeText={v => setFormMontant(v.replace(/[^0-9]/g, ''))}
                      />
                    </>
                  )}

                  {/* Description */}
                  <Text style={styles.label}>Description (optionnelle)</Text>
                  <TextInput
                    style={[styles.textArea, { color: colors.text, borderColor: colors.border }]}
                    placeholder="Précisez les détails..."
                    placeholderTextColor={colors.textMuted}
                    multiline
                    numberOfLines={3}
                    value={formDesc}
                    onChangeText={setFormDesc}
                  />

                  <TouchableOpacity
                    style={[styles.submitBtn, saving && { opacity: 0.6 }]}
                    onPress={soumettre}
                    disabled={saving}
                  >
                    <Text style={styles.submitBtnTxt}>{saving ? 'Envoi...' : '📤 Soumettre la demande'}</Text>
                  </TouchableOpacity>
                  <View style={{ height: 30 }} />
                </ScrollView>
              </View>
            </KeyboardAvoidingView>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </SafeAreaView>
  )
}

function makeStyles(colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
    back: { fontSize: 16, color: '#534AB7', fontWeight: '500' },
    headerTitre: { fontSize: 18, fontWeight: '700', color: colors.text },
    loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    body: { flex: 1, paddingHorizontal: 16 },
    addBtn: { backgroundColor: '#534AB7', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 16, marginBottom: 16 },
    addBtnTxt: { color: '#fff', fontSize: 15, fontWeight: '700' },
    emptyBox: { alignItems: 'center', paddingTop: 60 },
    emptyIcon: { fontSize: 44, marginBottom: 12 },
    emptyTxt: { color: colors.textMuted, fontSize: 15 },
    card: { backgroundColor: colors.surface, borderRadius: 14, padding: 16, marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
    cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
    cardType: { fontSize: 15, fontWeight: '700', color: colors.text, flex: 1 },
    statutBadge: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
    statutTxt: { fontSize: 12, fontWeight: '600' },
    cardTrav: { fontSize: 14, color: colors.text, fontWeight: '600', marginBottom: 4 },
    cardDates: { fontSize: 13, color: colors.textMuted, marginBottom: 4 },
    cardMontant: { fontSize: 13, color: '#3B6D11', fontWeight: '700', marginBottom: 4 },
    cardDesc: { fontSize: 13, color: colors.textMuted, fontStyle: 'italic', marginBottom: 4 },
    cardMeta: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
    declineBox: { backgroundColor: '#FAECE7', borderRadius: 8, padding: 10, marginTop: 8 },
    declineTitre: { fontSize: 12, fontWeight: '700', color: '#993C1D', marginBottom: 2 },
    declineTxt: { fontSize: 13, color: '#993C1D' },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    modal: { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '92%' },
    modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
    modalTitre: { fontSize: 18, fontWeight: '700', color: colors.text },
    modalClose: { fontSize: 20, color: colors.textMuted, padding: 4 },
    label: { fontSize: 13, fontWeight: '600', color: colors.textMuted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
    typesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
    typeChip: { backgroundColor: colors.background, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: colors.border },
    typeChipActive: { backgroundColor: '#534AB7', borderColor: '#534AB7' },
    typeChipTxt: { fontSize: 13, color: colors.textMuted, fontWeight: '500' },
    typeChipTxtActive: { color: '#fff' },
    travChip: { backgroundColor: colors.background, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: colors.border, marginRight: 8 },
    travChipActive: { backgroundColor: '#534AB7', borderColor: '#534AB7' },
    travChipTxt: { fontSize: 13, color: colors.textMuted, fontWeight: '500' },
    travChipTxtActive: { color: '#fff' },
    dateBtn: { flex: 1, backgroundColor: colors.background, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
    dateBtnActive: { backgroundColor: '#534AB7', borderColor: '#534AB7' },
    dateBtnTxt: { fontSize: 13, color: colors.textMuted, fontWeight: '500' },
    input: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 15, marginBottom: 16, backgroundColor: colors.background },
    textArea: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 14, minHeight: 80, textAlignVertical: 'top', marginBottom: 16, backgroundColor: colors.background },
    submitBtn: { backgroundColor: '#534AB7', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
    submitBtnTxt: { color: '#fff', fontSize: 15, fontWeight: '700' },
  })
}
