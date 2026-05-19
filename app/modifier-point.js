import { router } from 'expo-router'
import { useEffect, useState, useMemo } from 'react'
import {
    ActivityIndicator,
    Alert,
    Modal,
    SafeAreaView, ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native'
import { Calendar } from 'react-native-calendars'
import { supabase } from '../lib/supabase'
import { useTheme } from '../context/ThemeContext'

const ONGLETS = ['Résumé', 'Shifts', 'Ventes', 'Dépenses', 'Fournisseurs', 'Présences']
const CATS_DEPENSES = ['Marché', 'Légumes', 'Fruits', 'Dépenses annexes']

export default function ModifierPointScreen() {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const [etape, setEtape] = useState(1)
  const [restaurants, setRestaurants] = useState([])
  const [selectedResto, setSelectedResto] = useState(null)
  const [selectedDate, setSelectedDate] = useState('')
  const [point, setPoint] = useState(null)
  const [loading, setLoading] = useState(false)
  const [datesAvec, setDatesAvec] = useState({})
  const [ongletActif, setOngletActif] = useState('Résumé')
  const [form, setForm] = useState({})
  const [depenses, setDepenses] = useState([])
  const [presences, setPresences] = useState([])
  const [transactions, setTransactions] = useState([])
  const [shifts, setShifts] = useState([])
  // Fournisseurs du restaurant pour ajout
  const [fournisseursList, setFournisseursList] = useState([])
  const [showAddFour, setShowAddFour] = useState(false)
  const [newFourId, setNewFourId] = useState(null)
  const [newFourFact, setNewFourFact] = useState('')
  const [newFourPaye, setNewFourPaye] = useState('')
  // Nouvelle dépense
  const [showAddDep, setShowAddDep] = useState(false)
  const [newDepCat, setNewDepCat] = useState('Marché')
  const [newDepLib, setNewDepLib] = useState('')
  const [newDepMontant, setNewDepMontant] = useState('')
  // Suppression shifts
  const [modeSelShifts, setModeSelShifts] = useState(false)
  const [shiftsSelectionnes, setShiftsSelectionnes] = useState(new Set())
  const [suppressionEnCours, setSuppressionEnCours] = useState(false)
  const [confirmSupprShift, setConfirmSupprShift] = useState(null)
  const [confirmSupprMultiple, setConfirmSupprMultiple] = useState(false)
  // Édition inline des shifts
  const [shiftEdits, setShiftEdits] = useState({})
  // Suppression dépenses / transactions
  const [confirmSupprDep, setConfirmSupprDep] = useState(null)
  const [confirmSupprTrans, setConfirmSupprTrans] = useState(null)

  useEffect(() => { chargerRestaurants() }, [])

  async function chargerRestaurants() {
    const { data } = await supabase.from('restaurants').select('*').order('nom')
    setRestaurants(data || [])
  }

  async function chargerDatesAvec(restoId) {
    const { data } = await supabase
      .from('points').select('date, valide')
      .eq('restaurant_id', restoId)
    const marked = {}
    ;(data || []).forEach(p => {
      marked[p.date] = {
        marked: true,
        dotColor: p.valide ? '#3B6D11' : '#EF9F27',
      }
    })
    setDatesAvec(marked)
  }

  async function chargerPoint(restoId, date) {
    setLoading(true)
    const { data: pointData } = await supabase
      .from('points').select('*')
      .eq('restaurant_id', restoId)
      .eq('date', date)
      .single()

    if (!pointData) {
      Alert.alert('Aucun point', 'Aucun point trouvé pour cette date.')
      setLoading(false)
      return
    }

    setPoint(pointData)
    setForm({
      vente_total: String(pointData.vente_total || ''),
      depense_total: String(pointData.depense_total || ''),
      kdo: String(pointData.kdo || ''),
      retour: String(pointData.retour || ''),
      yango_cse: String(pointData.yango_cse || ''),
      yango_tab: String(pointData.yango_tab || ''),
      glovo_cse: String(pointData.glovo_cse || ''),
      glovo_tab: String(pointData.glovo_tab || ''),
      wave: String(pointData.wave || ''),
      om: String(pointData.om || ''),
      djamo: String(pointData.djamo || ''),
      fc_veille: String(pointData.fc_veille || ''),
      fond_recu: String(pointData.fond_recu || ''),
    })

    // Charger dépenses
    const { data: dep } = await supabase
      .from('depenses').select('*').eq('point_id', pointData.id)
    setDepenses(dep || [])

    // Charger shifts
    const { data: sh } = await supabase
      .from('points_shifts').select('*').eq('point_id', pointData.id).order('created_at')
    setShifts(sh || [])

    // Charger présences
    const { data: pres } = await supabase
      .from('presences').select('*').eq('point_id', pointData.id)
    setPresences(pres || [])

    // Charger transactions fournisseurs — dédupliquer par fournisseur_id
    // (gérant et caissier peuvent avoir chacun sauvegardé le même fournisseur)
    const { data: trans } = await supabase
      .from('transactions_fournisseurs').select('*, fournisseurs(nom)').eq('point_id', pointData.id)
    const priorite = { gerant: 3, caissier: 2 }
    const transDedup = Object.values(
      (trans || []).reduce((acc, t) => {
        const id = t.fournisseur_id
        const existing = acc[id]
        if (!existing || (priorite[t.saisi_par] || 1) >= (priorite[existing.saisi_par] || 1)) {
          acc[id] = t
        }
        return acc
      }, {})
    )
    setTransactions(transDedup)

    // Charger liste fournisseurs du restaurant
    const { data: fourn } = await supabase
      .from('fournisseurs').select('id, nom').eq('restaurant_id', restoId).eq('actif', true).order('nom')
    setFournisseursList(fourn || [])
    setNewFourId(null)

    setEtape(3)
    setLoading(false)
  }

  async function supprimerShift(shift) {
    if (point?.valide) {
      Alert.alert('Suppression impossible', 'Ce point est déjà validé.')
      setConfirmSupprShift(null)
      return
    }
    setSuppressionEnCours(true)
    try {
      if (shift.caissier_id) {
        await supabase.from('presences').delete()
          .eq('point_id', shift.point_id).eq('caissier_id', shift.caissier_id)
      }
      await supabase.from('depenses').delete()
        .eq('point_id', shift.point_id).eq('saisi_par', 'caissier')
      await supabase.from('transactions_fournisseurs').delete()
        .eq('point_id', shift.point_id).eq('saisi_par', 'caissier')
      await supabase.from('points_shifts').delete().eq('id', shift.id)
      setConfirmSupprShift(null)
      const { data: sh } = await supabase
        .from('points_shifts').select('*').eq('point_id', point.id).order('created_at')
      setShifts(sh || [])
    } catch (err) {
      Alert.alert('Erreur', err.message)
    } finally {
      setSuppressionEnCours(false)
    }
  }

  async function supprimerShiftsMultiples() {
    if (point?.valide) {
      Alert.alert('Suppression impossible', 'Ce point est déjà validé.')
      setConfirmSupprMultiple(false)
      return
    }
    setSuppressionEnCours(true)
    setConfirmSupprMultiple(false)
    const selectedShifts = shifts.filter(s => shiftsSelectionnes.has(s.id))
    const pointIds = [...new Set(selectedShifts.map(s => s.point_id))]
    const shiftIds = selectedShifts.map(s => s.id)
    try {
      for (const shift of selectedShifts) {
        if (shift.caissier_id) {
          await supabase.from('presences').delete()
            .eq('point_id', shift.point_id).eq('caissier_id', shift.caissier_id)
        }
      }
      await supabase.from('depenses').delete()
        .in('point_id', pointIds).eq('saisi_par', 'caissier')
      await supabase.from('transactions_fournisseurs').delete()
        .in('point_id', pointIds).eq('saisi_par', 'caissier')
      await supabase.from('points_shifts').delete().in('id', shiftIds)
      setModeSelShifts(false)
      setShiftsSelectionnes(new Set())
      const { data: sh } = await supabase
        .from('points_shifts').select('*').eq('point_id', point.id).order('created_at')
      setShifts(sh || [])
    } catch (err) {
      Alert.alert('Erreur', err.message)
    } finally {
      setSuppressionEnCours(false)
    }
  }

  function toggleSelShift(id) {
    setShiftsSelectionnes(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function initShiftEdit(shift) {
    setShiftEdits(prev => ({
      ...prev,
      [shift.id]: {
        vente_shift: String(shift.vente_shift || ''),
        heure_debut: shift.heure_debut || '',
        heure_fin: shift.heure_fin || '',
        espece: String(shift.espece || ''),
        editing: true,
      }
    }))
  }

  async function sauverShift(shift) {
    const edits = shiftEdits[shift.id]
    if (!edits) return
    setLoading(true)
    const { error } = await supabase.from('points_shifts').update({
      vente_shift: parseFloat(edits.vente_shift) || 0,
      heure_debut: edits.heure_debut || shift.heure_debut,
      heure_fin: edits.heure_fin || shift.heure_fin,
      espece: parseFloat(edits.espece) || 0,
    }).eq('id', shift.id)
    if (error) { setLoading(false); Alert.alert('Erreur', error.message); return }
    const { data: sh } = await supabase.from('points_shifts').select('*').eq('point_id', point.id).order('created_at')
    setShifts(sh || [])
    const totalEspece = (sh || []).reduce((s, s2) => s + (s2.espece || 0), 0)
    await supabase.from('points').update({ espece_shifts: totalEspece }).eq('id', point.id)
    setShiftEdits(prev => ({ ...prev, [shift.id]: { ...prev[shift.id], editing: false } }))
    setLoading(false)
    Alert.alert('Succès', 'Shift mis à jour !')
  }

  async function supprimerDepense(dep) {
    setLoading(true)
    const { error } = await supabase.from('depenses').delete().eq('id', dep.id)
    if (error) { setLoading(false); Alert.alert('Erreur', error.message); return }
    const nouvelles = depenses.filter(d => d.id !== dep.id)
    setDepenses(nouvelles)
    const total = nouvelles.reduce((s, d) => s + (d.montant || 0), 0)
               + transactions.reduce((s, t) => s + (t.paye || 0), 0)
    await supabase.from('points').update({ depense_total: total }).eq('id', point.id)
    setForm(p => ({ ...p, depense_total: String(total) }))
    setLoading(false)
    setConfirmSupprDep(null)
  }

  async function supprimerTransaction(trans) {
    setLoading(true)
    const { error } = await supabase.from('transactions_fournisseurs').delete().eq('id', trans.id)
    if (error) { setLoading(false); Alert.alert('Erreur', error.message); return }
    const restantes = transactions.filter(t => t.id !== trans.id)
    setTransactions(restantes)
    const total = depenses.reduce((s, d) => s + (d.montant || 0), 0)
               + restantes.reduce((s, t) => s + (t.paye || 0), 0)
    await supabase.from('points').update({ depense_total: total }).eq('id', point.id)
    setForm(p => ({ ...p, depense_total: String(total) }))
    setLoading(false)
    setConfirmSupprTrans(null)
  }

  function renderShifts() {
    const pointValide = point?.valide
    return (
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {pointValide && (
          <View style={styles.warningBanner}>
            <Text style={styles.warningTxt}>🔒 Point validé — suppression désactivée</Text>
          </View>
        )}

        {!pointValide && shifts.length > 0 && (
          <View style={styles.selectionBar}>
            {modeSelShifts ? (
              <>
                <TouchableOpacity style={styles.selBtnTout}
                  onPress={() => setShiftsSelectionnes(new Set(shifts.map(s => s.id)))}>
                  <Text style={styles.selBtnToutTxt}>Tout sélectionner</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.selBtnAnnuler}
                  onPress={() => { setModeSelShifts(false); setShiftsSelectionnes(new Set()) }}>
                  <Text style={styles.selBtnAnnulerTxt}>Annuler</Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity style={styles.selBtnActiver} onPress={() => setModeSelShifts(true)}>
                <Text style={styles.selBtnActiverTxt}>☑️ Sélectionner</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {shifts.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: 40 }}>
            <Text style={{ fontSize: 13, color: colors.textMuted }}>Aucun shift enregistré</Text>
          </View>
        ) : (
          shifts.map((s, i) => {
            const sel = shiftsSelectionnes.has(s.id)
            const edit = shiftEdits[s.id] || {}
            const isEditing = !!edit.editing
            return (
              <View key={s.id} style={[styles.shiftCard, modeSelShifts && sel && styles.shiftCardSelected, isEditing && styles.shiftCardEditing]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  {modeSelShifts && (
                    <TouchableOpacity onPress={() => toggleSelShift(s.id)}>
                      <View style={[styles.checkbox, sel && styles.checkboxSelected]}>
                        {sel && <Text style={styles.checkboxCheck}>✓</Text>}
                      </View>
                    </TouchableOpacity>
                  )}
                  <View style={styles.shiftNumBox}>
                    <Text style={styles.shiftNumTxt}>S{i + 1}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text }}>
                      ⏰ {s.heure_debut} → {s.heure_fin}
                    </Text>
                    {s.caissier_nom && (
                      <Text style={{ fontSize: 11, color: colors.primary, marginTop: 2 }}>👤 {s.caissier_nom}</Text>
                    )}
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 6 }}>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: '#EF9F27' }}>{fmt(s.vente_shift || 0)}</Text>
                    {s.espece > 0 && (
                      <Text style={{ fontSize: 11, color: colors.textMuted }}>💵 {fmt(s.espece)}</Text>
                    )}
                    {!pointValide && !modeSelShifts && (
                      <View style={{ flexDirection: 'row', gap: 6 }}>
                        <TouchableOpacity style={styles.editBtn} onPress={() => isEditing
                          ? setShiftEdits(prev => ({ ...prev, [s.id]: { ...prev[s.id], editing: false } }))
                          : initShiftEdit(s)
                        }>
                          <Text style={styles.editBtnTxt}>{isEditing ? '✕' : '✏️'}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.supprimerBtn} onPress={() => setConfirmSupprShift(s)}>
                          <Text style={styles.supprimerBtnTxt}>🗑️</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                </View>

                {isEditing && (
                  <View style={styles.shiftEditPanel}>
                    <View style={styles.inputLigne}>
                      <Text style={styles.inputLabel}>Vente shift</Text>
                      <TextInput
                        style={styles.inputField}
                        value={edit.vente_shift || ''}
                        onChangeText={v => setShiftEdits(prev => ({ ...prev, [s.id]: { ...prev[s.id], vente_shift: v } }))}
                        keyboardType="numeric" placeholder="0" placeholderTextColor="#bbb"
                      />
                    </View>
                    <View style={styles.inputLigne}>
                      <Text style={styles.inputLabel}>Heure début</Text>
                      <TextInput
                        style={styles.inputField}
                        value={edit.heure_debut || ''}
                        onChangeText={v => setShiftEdits(prev => ({ ...prev, [s.id]: { ...prev[s.id], heure_debut: v } }))}
                        placeholder="08:00" placeholderTextColor="#bbb"
                      />
                    </View>
                    <View style={styles.inputLigne}>
                      <Text style={styles.inputLabel}>Heure fin</Text>
                      <TextInput
                        style={styles.inputField}
                        value={edit.heure_fin || ''}
                        onChangeText={v => setShiftEdits(prev => ({ ...prev, [s.id]: { ...prev[s.id], heure_fin: v } }))}
                        placeholder="16:00" placeholderTextColor="#bbb"
                      />
                    </View>
                    <View style={[styles.inputLigne, { borderBottomWidth: 0 }]}>
                      <Text style={styles.inputLabel}>Espèces</Text>
                      <TextInput
                        style={styles.inputField}
                        value={edit.espece || ''}
                        onChangeText={v => setShiftEdits(prev => ({ ...prev, [s.id]: { ...prev[s.id], espece: v } }))}
                        keyboardType="numeric" placeholder="0" placeholderTextColor="#bbb"
                      />
                    </View>
                    <TouchableOpacity style={[styles.saveBtn, { marginTop: 10, marginBottom: 0 }]} onPress={() => sauverShift(s)}>
                      <Text style={styles.saveTxt}>💾 Sauvegarder ce shift</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )
          })
        )}

        {modeSelShifts && shiftsSelectionnes.size > 0 && (
          <TouchableOpacity
            style={[styles.btnSupprimerSel, suppressionEnCours && { opacity: 0.6 }, { marginTop: 8 }]}
            onPress={() => setConfirmSupprMultiple(true)}
            disabled={suppressionEnCours}
          >
            {suppressionEnCours
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={styles.btnSupprimerSelTxt}>🗑️ Supprimer la sélection ({shiftsSelectionnes.size})</Text>
            }
          </TouchableOpacity>
        )}
        <View style={{ height: 40 }} />
      </ScrollView>
    )
  }

  function val(v) { return parseFloat(v) || 0 }

  function resteEspeces() {
    return val(form.vente_total) - val(form.depense_total)
      - val(form.kdo) - val(form.retour)
      - val(form.yango_cse) - val(form.glovo_cse)
      - val(form.wave) - val(form.om) - val(form.djamo)
  }

  function fc() {
    return resteEspeces() + val(form.fc_veille) + val(form.fond_recu)
  }

  function beneficeSC() {
    return (val(form.yango_tab) * 0.77)
      + (val(form.glovo_tab) * 0.705)
      + (val(form.om) * 0.99)
      + (val(form.wave) * 0.99)
      + (val(form.djamo) * 0.99)
      + resteEspeces()
  }

  function fmt(n) { return Math.round(n).toLocaleString('fr-FR') + ' FCFA' }

  function formatDate(dateStr) {
    if (!dateStr) return ''
    const [y, m, d] = dateStr.split('-')
    const mois = ['jan', 'fév', 'mar', 'avr', 'mai', 'juin', 'juil', 'août', 'sep', 'oct', 'nov', 'déc']
    return `${parseInt(d)} ${mois[parseInt(m) - 1]} ${y}`
  }

  async function sauvegarder({ naviguer = true } = {}) {
    Alert.alert(
      'Confirmer la modification',
      `Ventes : ${fmt(val(form.vente_total))}\nDépenses : ${fmt(val(form.depense_total))}\nBénéfice SC : ${fmt(beneficeSC())}\n\nModifier ce point ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Confirmer', onPress: async () => {
          setLoading(true)
          const { data: updated, error } = await supabase.from('points').update({
            vente_total: val(form.vente_total),
            depense_total: val(form.depense_total),
            kdo: val(form.kdo),
            retour: val(form.retour),
            yango_cse: val(form.yango_cse),
            yango_tab: val(form.yango_tab),
            glovo_cse: val(form.glovo_cse),
            glovo_tab: val(form.glovo_tab),
            wave: val(form.wave),
            om: val(form.om),
            djamo: val(form.djamo),
            fc_veille: val(form.fc_veille),
            fond_recu: val(form.fond_recu),
            reste_especes: resteEspeces(),
            reste_fc: fc(),
            benefice_sc: beneficeSC(),
          }).eq('id', point.id).select('id')
          setLoading(false)
          if (error) {
            Alert.alert('Erreur', error.message)
          } else if (!updated?.length) {
            Alert.alert('Erreur', 'Modification refusée (droits insuffisants ou point introuvable).')
          } else {
            Alert.alert('✅ Sauvegardé', 'Ventes enregistrées avec succès !')
            if (naviguer) {
              if (router.canGoBack()) router.back()
              else router.replace('/accueil')
            }
          }
        }}
      ]
    )
  }

  function InputLigne({ label, champ }) {
    return (
      <View style={styles.inputLigne}>
        <Text style={styles.inputLabel}>{label}</Text>
        <TextInput
          style={styles.inputField}
          value={form[champ] || ''}
          onChangeText={v => setForm(p => ({ ...p, [champ]: v }))}
          keyboardType="numeric"
          placeholderTextColor="#bbb"
          placeholder="0"
        />
      </View>
    )
  }

  function renderResume() {
    return (
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.infoBar}>
          <Text style={styles.infoBarTxt}>{selectedResto?.nom} — {formatDate(selectedDate)}</Text>
          <View style={[styles.valideBadge, { backgroundColor: point?.valide ? '#EAF3DE' : '#FAEEDA' }]}>
            <Text style={[styles.valideTxt, { color: point?.valide ? '#3B6D11' : '#854F0B' }]}>
              {point?.valide ? '✅ Validé' : '⏳ En cours'}
            </Text>
          </View>
        </View>

        <View style={styles.kpiGrid}>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Ventes</Text>
            <Text style={[styles.kpiValue, { color: '#BA7517' }]}>{fmt(val(form.vente_total))}</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Dépenses</Text>
            <Text style={[styles.kpiValue, { color: '#A32D2D' }]}>{fmt(val(form.depense_total))}</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Bénéfice SC</Text>
            <Text style={[styles.kpiValue, { color: '#3B6D11' }]}>{fmt(beneficeSC())}</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Reste + FC</Text>
            <Text style={[styles.kpiValue, { color: fc() >= 0 ? '#BA7517' : '#A32D2D' }]}>{fmt(fc())}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitre}>Canaux de vente</Text>
        <View style={styles.card}>
          {[
            ['Yango CSE', form.yango_cse], ['Yango TAB', form.yango_tab],
            ['Glovo CSE', form.glovo_cse], ['Glovo TAB', form.glovo_tab],
            ['Wave', form.wave], ['Orange Money', form.om], ['Djamo', form.djamo],
          ].map(([label, v], i) => (
            <View key={i} style={styles.resumeRow}>
              <Text style={styles.resumeLabel}>{label}</Text>
              <Text style={styles.resumeValue}>{fmt(parseFloat(v) || 0)}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.sectionTitre}>Shifts ({shifts.length})</Text>
        <View style={styles.card}>
          {shifts.length === 0 ? (
            <Text style={styles.emptyTxt}>Aucun shift enregistré</Text>
          ) : shifts.map((s, i) => (
            <View key={i} style={styles.resumeRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.resumeLabel}>S{i + 1} — {s.heure_debut} → {s.heure_fin}</Text>
                {s.caissier_nom && <Text style={[styles.resumeLabel, { color: '#534AB7', fontSize: 11 }]}>{s.caissier_nom}</Text>}
              </View>
              <Text style={styles.resumeValue}>{fmt(s.vente_shift || 0)}</Text>
            </View>
          ))}
          {shifts.length > 0 && (
            <View style={[styles.resumeRow, { borderBottomWidth: 0, paddingTop: 8 }]}>
              <Text style={[styles.resumeLabel, { fontWeight: '600', color: '#1a1a1a' }]}>Total shifts</Text>
              <Text style={[styles.resumeValue, { color: '#BA7517', fontWeight: '600' }]}>
                {fmt(shifts.reduce((s, sh) => s + (sh.vente_shift || 0), 0))}
              </Text>
            </View>
          )}
        </View>

        <Text style={styles.sectionTitre}>Dépenses ({depenses.length} lignes)</Text>
        <View style={styles.card}>
          {depenses.length === 0 ? (
            <Text style={styles.emptyTxt}>Aucune dépense enregistrée</Text>
          ) : (
            Object.entries(
              depenses.reduce((acc, d) => {
                if (!acc[d.categorie]) acc[d.categorie] = 0
                acc[d.categorie] += d.montant
                return acc
              }, {})
            ).map(([cat, total], i) => (
              <View key={i} style={styles.resumeRow}>
                <Text style={styles.resumeLabel}>{cat}</Text>
                <Text style={styles.resumeValue}>{fmt(total)}</Text>
              </View>
            ))
          )}
        </View>

        <Text style={styles.sectionTitre}>Fournisseurs ({transactions.length})</Text>
        <View style={styles.card}>
          {transactions.length === 0 ? (
            <Text style={styles.emptyTxt}>Aucune transaction fournisseur</Text>
          ) : transactions.map((t, i) => (
            <View key={i} style={styles.resumeRow}>
              <Text style={styles.resumeLabel}>Fournisseur</Text>
              <Text style={styles.resumeValue}>Payé: {fmt(t.paye)} | Reste: {fmt(t.reste)}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.sectionTitre}>Présences ({presences.length})</Text>
        <View style={styles.card}>
          {presences.length === 0 ? (
            <Text style={styles.emptyTxt}>Aucune présence enregistrée</Text>
          ) : presences.map((p, i) => (
            <View key={i} style={styles.resumeRow}>
              <Text style={styles.resumeLabel}>{p.travailleur_nom}</Text>
              <Text style={styles.resumeValue}>{p.statut} — {fmt(p.paye)}</Text>
            </View>
          ))}
        </View>

        <TouchableOpacity style={styles.saveBtn} onPress={sauvegarder}>
          <Text style={styles.saveTxt}>💾 Enregistrer les modifications</Text>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
    )
  }

  function renderVentes() {
    const totalShifts = shifts.reduce((s, sh) => s + (sh.vente_shift || 0), 0)
    return (
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

        <Text style={styles.sectionTitre}>Total ventes</Text>
        <View style={styles.card}>
          <InputLigne label="Vente totale" champ="vente_total" />
        </View>

        <Text style={styles.sectionTitre}>Ventes shifts (référence)</Text>
        <View style={styles.card}>
          {shifts.length === 0 ? (
            <Text style={styles.emptyTxt}>Aucun shift</Text>
          ) : shifts.map((s, i) => (
            <View key={i} style={styles.resumeRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.resumeLabel}>S{i + 1} — {s.heure_debut} → {s.heure_fin}</Text>
                {s.caissier_nom && <Text style={[styles.resumeLabel, { fontSize: 11, color: '#534AB7' }]}>{s.caissier_nom}</Text>}
              </View>
              <Text style={styles.resumeValue}>{fmt(s.vente_shift || 0)}</Text>
            </View>
          ))}
          {shifts.length > 0 && (
            <View style={[styles.resumeRow, { borderBottomWidth: 0, paddingTop: 8 }]}>
              <Text style={[styles.resumeLabel, { fontWeight: '600', color: '#BA7517' }]}>Total shifts</Text>
              <Text style={[styles.resumeValue, { color: '#BA7517', fontWeight: '700' }]}>{fmt(totalShifts)}</Text>
            </View>
          )}
        </View>

        <Text style={styles.sectionTitre}>Canaux de vente</Text>
        <View style={styles.card}>
          <InputLigne label="Yango CSE" champ="yango_cse" />
          <InputLigne label="Yango TAB (×0,77)" champ="yango_tab" />
          <InputLigne label="Glovo CSE" champ="glovo_cse" />
          <InputLigne label="Glovo TAB (×0,705)" champ="glovo_tab" />
          <InputLigne label="Wave" champ="wave" />
          <InputLigne label="Orange Money" champ="om" />
          <InputLigne label="Djamo" champ="djamo" />
        </View>

        <Text style={styles.sectionTitre}>Déductions</Text>
        <View style={styles.card}>
          <InputLigne label="KDO" champ="kdo" />
          <InputLigne label="Retour" champ="retour" />
        </View>

        <Text style={styles.sectionTitre}>Fond de caisse</Text>
        <View style={styles.card}>
          <InputLigne label="FC de la veille" champ="fc_veille" />
          <InputLigne label="Fond reçu" champ="fond_recu" />
        </View>

        <View style={styles.recapCard}>
          <Text style={styles.recapTitre}>Résultats calculés</Text>
          <View style={styles.resumeRow}>
            <Text style={styles.recapLabel}>Reste espèces</Text>
            <Text style={[styles.recapValue, { color: resteEspeces() >= 0 ? '#BA7517' : '#A32D2D' }]}>{fmt(resteEspeces())}</Text>
          </View>
          <View style={styles.resumeRow}>
            <Text style={styles.recapLabel}>Reste + FC</Text>
            <Text style={[styles.recapValue, { color: fc() >= 0 ? '#BA7517' : '#A32D2D' }]}>{fmt(fc())}</Text>
          </View>
          <View style={[styles.resumeRow, { borderBottomWidth: 0 }]}>
            <Text style={[styles.recapLabel, { fontWeight: '600', color: '#1a1a1a' }]}>Bénéfice SC</Text>
            <Text style={[styles.recapValue, { color: '#3B6D11', fontWeight: '600', fontSize: 15 }]}>{fmt(beneficeSC())}</Text>
          </View>
        </View>

        <TouchableOpacity style={styles.saveBtn} onPress={() => sauvegarder({ naviguer: false })}>
          <Text style={styles.saveTxt}>💾 Enregistrer les ventes</Text>
        </TouchableOpacity>
        <View style={{ height: 40 }} />
      </ScrollView>
    )
  }

  function renderDepenses() {
    const categories = {}
    depenses.forEach(d => {
      if (!categories[d.categorie]) categories[d.categorie] = []
      categories[d.categorie].push(d)
    })

    return (
      <ScrollView showsVerticalScrollIndicator={false}>
        {Object.entries(categories).map(([cat, lignes]) => (
          <View key={cat}>
            <Text style={styles.sectionTitre}>{cat}</Text>
            <View style={styles.card}>
              {lignes.map((d, i) => (
                <View key={d.id} style={styles.depLigneBlock}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <TextInput
                        style={styles.libellInput}
                        value={d.libelle || ''}
                        onChangeText={v => {
                          const nd = [...depenses]
                          const idx = nd.findIndex(x => x.id === d.id)
                          if (idx >= 0) nd[idx] = { ...nd[idx], libelle: v }
                          setDepenses(nd)
                        }}
                        placeholder="Description"
                        placeholderTextColor="#bbb"
                      />
                    </View>
                    <TextInput
                      style={styles.inputField}
                      value={String(d.montant || '')}
                      onChangeText={v => {
                        const nd = [...depenses]
                        const idx = nd.findIndex(x => x.id === d.id)
                        if (idx >= 0) nd[idx] = { ...nd[idx], montant: parseFloat(v) || 0 }
                        setDepenses(nd)
                      }}
                      keyboardType="numeric"
                      placeholder="0"
                      placeholderTextColor="#bbb"
                    />
                    <TouchableOpacity style={styles.supprimerBtnRond} onPress={() => setConfirmSupprDep(d)}>
                      <Text style={styles.supprimerBtnTxt}>🗑️</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
              <View style={styles.catTotal}>
                <Text style={styles.catTotalLabel}>Total {cat}</Text>
                <Text style={styles.catTotalValue}>{fmt(lignes.reduce((s, d) => s + (d.montant || 0), 0))}</Text>
              </View>
            </View>
          </View>
        ))}

        {depenses.length === 0 && !showAddDep && (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyTxt}>Aucune dépense enregistrée pour ce point</Text>
          </View>
        )}

        {/* Formulaire nouvelle dépense */}
        {showAddDep ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitre}>Nouvelle dépense</Text>
            <Text style={styles.inputLabel}>Catégorie</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
              {CATS_DEPENSES.map(c => (
                <TouchableOpacity key={c}
                  style={[styles.fourChip, newDepCat === c && styles.fourChipActive]}
                  onPress={() => setNewDepCat(c)}>
                  <Text style={[styles.fourChipTxt, newDepCat === c && styles.fourChipTxtActive]}>{c}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <View style={styles.inputLigne}>
              <Text style={styles.inputLabel}>Description</Text>
              <TextInput style={[styles.inputField, { width: 180 }]} value={newDepLib}
                onChangeText={setNewDepLib} placeholder="Ex: Tomates" placeholderTextColor="#bbb" />
            </View>
            <View style={styles.inputLigne}>
              <Text style={styles.inputLabel}>Montant</Text>
              <TextInput style={styles.inputField} value={newDepMontant} onChangeText={setNewDepMontant}
                keyboardType="numeric" placeholder="0" placeholderTextColor="#bbb" />
            </View>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
              <TouchableOpacity style={[styles.saveBtn, { flex: 1, backgroundColor: '#f5f5f5', marginTop: 0 }]}
                onPress={() => setShowAddDep(false)}>
                <Text style={[styles.saveTxt, { color: '#888' }]}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveBtn, { flex: 2, backgroundColor: '#EF9F27', marginTop: 0 }]}
                onPress={async () => {
                  const montant = parseFloat(newDepMontant) || 0
                  if (!montant) { Alert.alert('Erreur', 'Saisissez un montant'); return }
                  setLoading(true)
                  const { data, error } = await supabase.from('depenses').insert({
                    point_id: point.id,
                    categorie: newDepCat,
                    libelle: newDepLib || newDepCat,
                    montant,
                    saisi_par: 'gerant',
                  }).select().single()
                  if (error) { setLoading(false); Alert.alert('Erreur', error.message); return }
                  const nouvellesDep = [...depenses, data]
                  setDepenses(nouvellesDep)
                  const nouveauTotal = nouvellesDep.reduce((s, d) => s + (d.montant || 0), 0)
                  await supabase.from('points').update({ depense_total: nouveauTotal }).eq('id', point.id)
                  setForm(p => ({ ...p, depense_total: String(nouveauTotal) }))
                  setLoading(false)
                  setNewDepLib(''); setNewDepMontant(''); setShowAddDep(false)
                  Alert.alert('Succès', 'Dépense ajoutée !')
                }}
              >
                <Text style={[styles.saveTxt, { color: '#412402' }]}>✅ Ajouter</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <TouchableOpacity style={[styles.saveBtn, { backgroundColor: '#f5f5f5', borderWidth: 1, borderColor: '#534AB7' }]}
            onPress={() => setShowAddDep(true)}>
            <Text style={[styles.saveTxt, { color: '#534AB7' }]}>+ Ajouter une dépense</Text>
          </TouchableOpacity>
        )}

        <View style={styles.recapCard}>
          <View style={[styles.resumeRow, { borderBottomWidth: 0 }]}>
            <Text style={[styles.recapLabel, { fontWeight: '600', color: '#1a1a1a' }]}>Total dépenses</Text>
            <Text style={[styles.recapValue, { color: '#A32D2D', fontWeight: '600', fontSize: 15 }]}>
              {fmt(depenses.reduce((s, d) => s + (d.montant || 0), 0))}
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={styles.saveBtn}
          onPress={async () => {
            setLoading(true)
            let errMsg = null
            for (const d of depenses) {
              if (!d.id) continue
              const { data: r, error } = await supabase
                .from('depenses')
                .update({ montant: d.montant, libelle: d.libelle })
                .eq('id', d.id)
                .select('id')
              if (error) { errMsg = error.message; break }
              if (!r?.length) { errMsg = `Modification refusée pour "${d.libelle || 'dépense'}" (droits insuffisants).`; break }
            }
            if (errMsg) { setLoading(false); Alert.alert('Erreur', errMsg); return }
            const totalDep = depenses.reduce((s, d) => s + (d.montant || 0), 0)
            const { error: errTotal } = await supabase
              .from('points').update({ depense_total: totalDep }).eq('id', point.id)
            if (errTotal) { setLoading(false); Alert.alert('Erreur', errTotal.message); return }
            setForm(p => ({ ...p, depense_total: String(totalDep) }))
            setLoading(false)
            Alert.alert('✅ Sauvegardé', 'Dépenses enregistrées dans la base de données !')
          }}
        >
          <Text style={styles.saveTxt}>💾 Enregistrer les dépenses</Text>
        </TouchableOpacity>
        <View style={{ height: 40 }} />
      </ScrollView>
    )
  }

  function renderFournisseurs() {
    const existingIds = transactions.map(t => t.fournisseur_id)
    const disponibles = fournisseursList.filter(f => !existingIds.includes(f.id))

    async function sauverFournisseurs() {
      setLoading(true)
      let errMsg = null
      for (const t of transactions) {
        const { data: r, error } = await supabase
          .from('transactions_fournisseurs')
          .update({
            facture: t.facture,
            paye: t.paye,
            reste: (t.facture || 0) - (t.paye || 0),
          })
          .eq('id', t.id)
          .select('id')
        if (error) { errMsg = error.message; break }
        if (!r?.length) { errMsg = `Modification refusée pour "${t.fournisseurs?.nom || 'fournisseur'}" (droits insuffisants).`; break }
      }
      setLoading(false)
      if (errMsg) { Alert.alert('Erreur', errMsg); return }
      Alert.alert('✅ Sauvegardé', 'Fournisseurs enregistrés dans la base de données !')
    }

    async function ajouterFournisseur() {
      if (!newFourId) { Alert.alert('Erreur', 'Sélectionnez un fournisseur'); return }
      const facture = parseFloat(newFourFact) || 0
      const paye = parseFloat(newFourPaye) || 0
      if (!facture && !paye) { Alert.alert('Erreur', 'Saisissez au moins un montant'); return }
      setLoading(true)
      const { data, error } = await supabase.from('transactions_fournisseurs').insert({
        point_id: point.id,
        fournisseur_id: newFourId,
        facture,
        paye,
        reste: facture - paye,
      }).select('*, fournisseurs(nom)').single()
      setLoading(false)
      if (error) { Alert.alert('Erreur', error.message); return }
      setTransactions(prev => [...prev, data])
      setNewFourId(null); setNewFourFact(''); setNewFourPaye('')
      setShowAddFour(false)
      Alert.alert('Succès', 'Fournisseur ajouté !')
    }

    return (
      <ScrollView showsVerticalScrollIndicator={false}>
        {transactions.length === 0 && !showAddFour && (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyTxt}>Aucune transaction fournisseur</Text>
          </View>
        )}

        {transactions.map((t, i) => (
          <View key={t.id} style={styles.fournCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <Text style={styles.fournNom}>{t.fournisseurs?.nom || `Fournisseur ${i + 1}`}</Text>
              <TouchableOpacity style={styles.supprimerBtn} onPress={() => setConfirmSupprTrans(t)}>
                <Text style={styles.supprimerBtnTxt}>🗑️ Supprimer</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.inputLigne}>
              <Text style={styles.inputLabel}>Facture</Text>
              <TextInput
                style={styles.inputField}
                value={String(t.facture || '')}
                onChangeText={v => {
                  const n = [...transactions]; n[i] = { ...n[i], facture: parseFloat(v) || 0 }; setTransactions(n)
                }}
                keyboardType="numeric" placeholder="0" placeholderTextColor="#bbb"
              />
            </View>
            <View style={styles.inputLigne}>
              <Text style={styles.inputLabel}>Payé</Text>
              <TextInput
                style={styles.inputField}
                value={String(t.paye || '')}
                onChangeText={v => {
                  const n = [...transactions]; n[i] = { ...n[i], paye: parseFloat(v) || 0, reste: (n[i].facture || 0) - (parseFloat(v) || 0) }; setTransactions(n)
                }}
                keyboardType="numeric" placeholder="0" placeholderTextColor="#bbb"
              />
            </View>
            <View style={[styles.resumeRow, { borderBottomWidth: 0, marginTop: 8 }]}>
              <Text style={styles.resumeLabel}>Reste dû</Text>
              <Text style={[styles.resumeValue, { color: ((t.facture || 0) - (t.paye || 0)) > 0 ? '#A32D2D' : '#3B6D11', fontWeight: '600' }]}>
                {fmt((t.facture || 0) - (t.paye || 0))}
              </Text>
            </View>
          </View>
        ))}

        {/* Formulaire ajout fournisseur */}
        {showAddFour ? (
          <View style={styles.fournCard}>
            <Text style={styles.fournNom}>Nouveau fournisseur</Text>
            <Text style={styles.inputLabel}>Sélectionner</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
              {disponibles.map(f => (
                <TouchableOpacity
                  key={f.id}
                  style={[styles.fourChip, newFourId === f.id && styles.fourChipActive]}
                  onPress={() => setNewFourId(f.id)}
                >
                  <Text style={[styles.fourChipTxt, newFourId === f.id && styles.fourChipTxtActive]}>
                    {f.nom}
                  </Text>
                </TouchableOpacity>
              ))}
              {disponibles.length === 0 && (
                <Text style={[styles.emptyTxt, { margin: 8 }]}>Tous les fournisseurs sont déjà ajoutés</Text>
              )}
            </ScrollView>
            <View style={styles.inputLigne}>
              <Text style={styles.inputLabel}>Facture</Text>
              <TextInput style={styles.inputField} value={newFourFact} onChangeText={setNewFourFact}
                keyboardType="numeric" placeholder="0" placeholderTextColor="#bbb" />
            </View>
            <View style={styles.inputLigne}>
              <Text style={styles.inputLabel}>Payé</Text>
              <TextInput style={styles.inputField} value={newFourPaye} onChangeText={setNewFourPaye}
                keyboardType="numeric" placeholder="0" placeholderTextColor="#bbb" />
            </View>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
              <TouchableOpacity style={[styles.saveBtn, { flex: 1, backgroundColor: '#f5f5f5', marginTop: 0 }]}
                onPress={() => setShowAddFour(false)}>
                <Text style={[styles.saveTxt, { color: '#888' }]}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.saveBtn, { flex: 2, backgroundColor: '#EF9F27', marginTop: 0 }]}
                onPress={ajouterFournisseur}>
                <Text style={[styles.saveTxt, { color: '#412402' }]}>✅ Ajouter</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : disponibles.length > 0 && (
          <TouchableOpacity style={[styles.saveBtn, { backgroundColor: '#f5f5f5', borderWidth: 1, borderColor: '#EF9F27' }]}
            onPress={() => setShowAddFour(true)}>
            <Text style={[styles.saveTxt, { color: '#EF9F27' }]}>+ Ajouter un fournisseur</Text>
          </TouchableOpacity>
        )}

        {transactions.length > 0 && (
          <TouchableOpacity style={styles.saveBtn} onPress={sauverFournisseurs}>
            <Text style={styles.saveTxt}>💾 Enregistrer les fournisseurs</Text>
          </TouchableOpacity>
        )}
        <View style={{ height: 40 }} />
      </ScrollView>
    )
  }

  function renderPresences() {
    return (
      <ScrollView showsVerticalScrollIndicator={false}>
        {presences.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyTxt}>Aucune présence enregistrée</Text>
          </View>
        ) : presences.map((p, i) => (
          <View key={i} style={styles.presenceCard}>
            <View style={styles.presenceHeader}>
              <View style={styles.avatar}>
                <Text style={styles.avatarTxt}>
                  {(p.travailleur_nom || 'T').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.presenceNom}>{p.travailleur_nom}</Text>
                <Text style={styles.presenceStatut}>{p.statut}</Text>
              </View>
            </View>
            <View style={styles.inputLigne}>
              <Text style={styles.inputLabel}>Paie</Text>
              <TextInput
                style={styles.inputField}
                value={String(p.paye || '')}
                onChangeText={v => {
                  const newPres = [...presences]
                  newPres[i] = { ...newPres[i], paye: parseFloat(v) || 0 }
                  setPresences(newPres)
                }}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor="#bbb"
              />
            </View>
          </View>
        ))}

        <View style={styles.recapCard}>
          <View style={[styles.resumeRow, { borderBottomWidth: 0 }]}>
            <Text style={[styles.recapLabel, { fontWeight: '600' }]}>Total paie</Text>
            <Text style={[styles.recapValue, { color: '#EF9F27', fontWeight: '600', fontSize: 15 }]}>
              {fmt(presences.reduce((s, p) => s + (p.paye || 0), 0))}
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={styles.saveBtn}
          onPress={async () => {
            setLoading(true)
            let errMsg = null
            for (const p of presences) {
              if (!p.id) continue
              const { data: r, error } = await supabase
                .from('presences')
                .update({ paye: p.paye })
                .eq('id', p.id)
                .select('id')
              if (error) { errMsg = error.message; break }
              if (!r?.length) { errMsg = `Modification refusée pour "${p.travailleur_nom || 'employé'}" (droits insuffisants).`; break }
            }
            setLoading(false)
            if (errMsg) { Alert.alert('Erreur', errMsg); return }
            Alert.alert('✅ Sauvegardé', 'Présences enregistrées dans la base de données !')
          }}
        >
          <Text style={styles.saveTxt}>💾 Enregistrer les présences</Text>
        </TouchableOpacity>
        <View style={{ height: 40 }} />
      </ScrollView>
    )
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => {
          if (etape > 1) setEtape(etape - 1)
          else if (router.canGoBack()) router.back()
          else router.replace('/accueil')
        }}>
          <Text style={styles.back}>‹ Retour</Text>
        </TouchableOpacity>
        <View>
          <Text style={styles.headerTitre}>Modifier un point</Text>
          <Text style={styles.headerSub}>
            {etape === 1 ? 'Choisir le restaurant' : etape === 2 ? 'Choisir la date' : formatDate(selectedDate)}
          </Text>
        </View>
        <View style={{ width: 60 }} />
      </View>

      <View style={styles.stepBar}>
        {['Restaurant', 'Date', 'Données'].map((s, i) => (
          <View key={i} style={styles.stepItem}>
            <View style={[styles.stepNum, etape > i + 1 && styles.stepDone, etape === i + 1 && styles.stepActive]}>
              <Text style={styles.stepNumTxt}>{etape > i + 1 ? '✓' : i + 1}</Text>
            </View>
            <Text style={[styles.stepLabel, etape === i + 1 && styles.stepLabelActive]}>{s}</Text>
            {i < 2 && <View style={styles.stepLine} />}
          </View>
        ))}
      </View>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#534AB7" />
        </View>
      ) : (
        <>
          {/* ETAPE 1 */}
          {etape === 1 && (
            <ScrollView style={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={styles.sectionTitre}>Choisissez un restaurant</Text>
              {restaurants.map(r => (
                <TouchableOpacity
                  key={r.id}
                  style={styles.restoCard}
                  onPress={() => {
                    setSelectedResto(r)
                    chargerDatesAvec(r.id)
                    setEtape(2)
                  }}
                >
                  <View style={[styles.restoDot, { backgroundColor: r.couleur === 'vert' ? '#2D7D46' : '#EF9F27' }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.restoNom}>{r.nom}</Text>
                    <Text style={styles.restoSub}>{r.localisation || 'Abidjan'}</Text>
                  </View>
                  <Text style={styles.restoArrow}>›</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          {/* ETAPE 2 */}
          {etape === 2 && (
            <ScrollView style={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={styles.sectionTitre}>{selectedResto?.nom}</Text>
              <View style={styles.legendeRow}>
                <View style={styles.legendeItem}>
                  <View style={[styles.legendeDot, { backgroundColor: '#3B6D11' }]} />
                  <Text style={styles.legendeTxt}>Point validé</Text>
                </View>
                <View style={styles.legendeItem}>
                  <View style={[styles.legendeDot, { backgroundColor: '#EF9F27' }]} />
                  <Text style={styles.legendeTxt}>Point en cours</Text>
                </View>
              </View>
              <Calendar
                onDayPress={day => {
                  setSelectedDate(day.dateString)
                  chargerPoint(selectedResto.id, day.dateString)
                }}
                markedDates={{
                  ...datesAvec,
                  ...(selectedDate ? { [selectedDate]: { selected: true, selectedColor: '#534AB7' } } : {})
                }}
                maxDate={new Date().toISOString().split('T')[0]}
                theme={{
                  selectedDayBackgroundColor: '#534AB7',
                  todayTextColor: '#534AB7',
                  arrowColor: '#534AB7',
                  monthTextColor: '#1a1a1a',
                  dayTextColor: '#1a1a1a',
                  textDisabledColor: '#ccc',
                }}
                style={styles.calendar}
              />
            </ScrollView>
          )}

          {/* ETAPE 3 — Onglets */}
          {etape === 3 && point && (
            <>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.ongletBar}>
                {ONGLETS.map(o => (
                  <TouchableOpacity
                    key={o}
                    style={[styles.ongletBtn, ongletActif === o && styles.ongletBtnActive]}
                    onPress={() => setOngletActif(o)}
                  >
                    <Text style={[styles.ongletTxt, ongletActif === o && styles.ongletTxtActive]}>{o}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <View style={styles.body}>
                {ongletActif === 'Résumé' && renderResume()}
                {ongletActif === 'Shifts' && renderShifts()}
                {ongletActif === 'Ventes' && renderVentes()}
                {ongletActif === 'Dépenses' && renderDepenses()}
                {ongletActif === 'Fournisseurs' && renderFournisseurs()}
                {ongletActif === 'Présences' && renderPresences()}
              </View>
            </>
          )}
        </>
      )}

      {/* Modal confirmation suppression individuelle */}
      <Modal visible={!!confirmSupprShift} transparent animationType="fade">
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmBox}>
            <Text style={styles.confirmTitre}>Supprimer ce shift ?</Text>
            <Text style={styles.confirmMsg}>
              {confirmSupprShift?.caissier_nom ? `👤 ${confirmSupprShift.caissier_nom}\n` : ''}
              {confirmSupprShift ? `⏰ ${confirmSupprShift.heure_debut} → ${confirmSupprShift.heure_fin}\n\n` : ''}
              Cette action est irréversible.
            </Text>
            <View style={styles.confirmBtns}>
              <TouchableOpacity style={styles.confirmCancel} onPress={() => setConfirmSupprShift(null)} disabled={suppressionEnCours}>
                <Text style={styles.confirmCancelTxt}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmOk, suppressionEnCours && { opacity: 0.6 }]}
                onPress={() => supprimerShift(confirmSupprShift)}
                disabled={suppressionEnCours}
              >
                {suppressionEnCours
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.confirmOkTxt}>🗑️ Confirmer</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal confirmation suppression multiple */}
      <Modal visible={confirmSupprMultiple} transparent animationType="fade">
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmBox}>
            <Text style={styles.confirmTitre}>Supprimer {shiftsSelectionnes.size} shift(s) ?</Text>
            <Text style={styles.confirmMsg}>
              Toutes les données liées (présences, dépenses, fournisseurs) seront supprimées.{'\n\n'}Cette action est irréversible.
            </Text>
            <View style={styles.confirmBtns}>
              <TouchableOpacity style={styles.confirmCancel} onPress={() => setConfirmSupprMultiple(false)}>
                <Text style={styles.confirmCancelTxt}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmOk} onPress={supprimerShiftsMultiples}>
                <Text style={styles.confirmOkTxt}>🗑️ Supprimer tout</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal suppression dépense */}
      <Modal visible={!!confirmSupprDep} transparent animationType="fade">
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmBox}>
            <Text style={styles.confirmTitre}>Supprimer cette dépense ?</Text>
            <Text style={styles.confirmMsg}>
              {confirmSupprDep?.libelle || 'Sans libellé'} — {confirmSupprDep ? fmt(confirmSupprDep.montant || 0) : ''}{'\n\n'}Cette action est irréversible.
            </Text>
            <View style={styles.confirmBtns}>
              <TouchableOpacity style={styles.confirmCancel} onPress={() => setConfirmSupprDep(null)}>
                <Text style={styles.confirmCancelTxt}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.confirmOk, loading && { opacity: 0.6 }]}
                onPress={() => supprimerDepense(confirmSupprDep)} disabled={loading}>
                {loading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.confirmOkTxt}>🗑️ Confirmer</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal suppression transaction fournisseur */}
      <Modal visible={!!confirmSupprTrans} transparent animationType="fade">
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmBox}>
            <Text style={styles.confirmTitre}>Supprimer ce fournisseur ?</Text>
            <Text style={styles.confirmMsg}>
              {confirmSupprTrans?.fournisseurs?.nom || 'Fournisseur'}{'\n'}Facture : {confirmSupprTrans ? fmt(confirmSupprTrans.facture || 0) : ''} — Payé : {confirmSupprTrans ? fmt(confirmSupprTrans.paye || 0) : ''}{'\n\n'}Cette action est irréversible.
            </Text>
            <View style={styles.confirmBtns}>
              <TouchableOpacity style={styles.confirmCancel} onPress={() => setConfirmSupprTrans(null)}>
                <Text style={styles.confirmCancelTxt}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.confirmOk, loading && { opacity: 0.6 }]}
                onPress={() => supprimerTransaction(confirmSupprTrans)} disabled={loading}>
                {loading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.confirmOkTxt}>🗑️ Confirmer</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

function makeStyles(colors) { return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { backgroundColor: colors.headerBg, padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: { fontSize: 16, color: colors.primaryText, fontWeight: '500' },
  headerTitre: { fontSize: 16, fontWeight: '600', color: colors.surface, textAlign: 'center' },
  headerSub: { fontSize: 11, color: colors.primaryText, textAlign: 'center' },
  stepBar: { flexDirection: 'row', backgroundColor: colors.surface, padding: 14, borderBottomWidth: 0.5, borderBottomColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  stepItem: { flexDirection: 'row', alignItems: 'center' },
  stepNum: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', marginRight: 6, borderWidth: 0.5, borderColor: colors.border },
  stepDone: { backgroundColor: colors.primary },
  stepActive: { backgroundColor: colors.primary },
  stepNumTxt: { fontSize: 11, fontWeight: '600', color: colors.surface },
  stepLine: { width: 30, height: 1, backgroundColor: colors.border, marginHorizontal: 6 },
  stepLabel: { fontSize: 11, color: colors.textMuted, marginRight: 6 },
  stepLabelActive: { color: colors.primary, fontWeight: '600' },
  ongletBar: { backgroundColor: colors.surface, maxHeight: 46, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  ongletBtn: { paddingHorizontal: 16, paddingVertical: 12 },
  ongletBtnActive: { borderBottomWidth: 2, borderBottomColor: colors.primary },
  ongletTxt: { fontSize: 13, color: colors.textMuted },
  ongletTxtActive: { color: colors.primary, fontWeight: '600' },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, padding: 14 },
  sectionTitre: { fontSize: 12, fontWeight: '600', color: colors.textMuted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 8 },
  restoCard: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 0.5, borderColor: colors.border },
  restoDot: { width: 12, height: 12, borderRadius: 6 },
  restoNom: { fontSize: 14, fontWeight: '600', color: colors.text },
  restoSub: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  restoArrow: { fontSize: 18, color: '#ccc' },
  legendeRow: { flexDirection: 'row', gap: 16, marginBottom: 12 },
  legendeItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendeDot: { width: 10, height: 10, borderRadius: 5 },
  legendeTxt: { fontSize: 11, color: colors.textMuted },
  calendar: { borderRadius: 14, borderWidth: 0.5, borderColor: colors.border, marginBottom: 14 },
  infoBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 12, padding: 12, marginBottom: 14, borderWidth: 0.5, borderColor: colors.border },
  infoBarTxt: { fontSize: 13, fontWeight: '600', color: colors.text },
  valideBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  valideTxt: { fontSize: 11, fontWeight: '500' },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  kpiCard: { width: '47%', backgroundColor: colors.surface, borderRadius: 12, padding: 12, borderWidth: 0.5, borderColor: colors.border },
  kpiLabel: { fontSize: 10, color: colors.textMuted, marginBottom: 4 },
  kpiValue: { fontSize: 14, fontWeight: '600' },
  card: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, marginBottom: 14, borderWidth: 0.5, borderColor: colors.border },
  resumeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 0.5, borderBottomColor: '#f5f5f5' },
  resumeLabel: { fontSize: 13, color: colors.textMuted, flex: 1 },
  resumeValue: { fontSize: 13, fontWeight: '500', color: colors.text },
  inputLigne: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: '#f5f5f5' },
  inputLabel: { fontSize: 13, color: colors.textSecondary, flex: 1 },
  inputField: { width: 130, backgroundColor: colors.bg, borderRadius: 8, padding: 8, fontSize: 14, color: colors.text, textAlign: 'right' },
  catTotal: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 10, marginTop: 4 },
  catTotalLabel: { fontSize: 13, fontWeight: '600', color: colors.text },
  catTotalValue: { fontSize: 14, fontWeight: '600', color: '#EF9F27' },
  recapCard: { backgroundColor: colors.orangeLight, borderRadius: 14, padding: 14, marginBottom: 14 },
  recapTitre: { fontSize: 13, fontWeight: '600', color: colors.orangeDark, marginBottom: 10 },
  recapLabel: { fontSize: 13, color: colors.orangeDark, flex: 1 },
  recapValue: { fontSize: 13, fontWeight: '500' },
  fournCard: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 0.5, borderColor: colors.border },
  fournNom: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: 8 },
  presenceCard: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 0.5, borderColor: colors.border },
  presenceHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#EF9F27', alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontSize: 13, fontWeight: '600', color: '#fff' },
  presenceNom: { fontSize: 14, fontWeight: '600', color: colors.text },
  presenceStatut: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  emptyBox: { alignItems: 'center', paddingVertical: 30 },
  emptyTxt: { fontSize: 13, color: colors.textMuted, textAlign: 'center' },
  saveBtn: { backgroundColor: colors.primary, borderRadius: 14, padding: 16, alignItems: 'center', marginBottom: 10, marginTop: 8 },
  saveTxt: { fontSize: 15, fontWeight: '600', color: colors.surface },
  fourChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: colors.bg, marginRight: 8, borderWidth: 1, borderColor: colors.border },
  fourChipActive: { backgroundColor: '#EF9F27', borderColor: '#BA7517' },
  fourChipTxt: { fontSize: 13, color: colors.textMuted },
  fourChipTxtActive: { color: '#412402', fontWeight: '600' },
  warningBanner: { backgroundColor: '#FAECE7', borderRadius: 12, padding: 12, marginBottom: 12, borderWidth: 0.5, borderColor: '#F09595' },
  warningTxt: { fontSize: 13, color: '#A32D2D', textAlign: 'center' },
  selectionBar: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginBottom: 10 },
  selBtnActiver: { backgroundColor: colors.inputBg, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  selBtnActiverTxt: { fontSize: 13, color: colors.text, fontWeight: '500' },
  selBtnTout: { backgroundColor: '#E6F1FB', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  selBtnToutTxt: { fontSize: 13, color: '#185FA5', fontWeight: '500' },
  selBtnAnnuler: { backgroundColor: colors.inputBg, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  selBtnAnnulerTxt: { fontSize: 13, color: colors.textMuted },
  shiftCard: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 0.5, borderColor: colors.border },
  shiftCardSelected: { borderColor: '#EF9F27', borderWidth: 2, backgroundColor: '#FFF8ED' },
  shiftNumBox: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#EF9F27', alignItems: 'center', justifyContent: 'center' },
  shiftNumTxt: { fontSize: 12, fontWeight: '600', color: '#412402' },
  checkbox: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: colors.border, backgroundColor: colors.inputBg, alignItems: 'center', justifyContent: 'center' },
  checkboxSelected: { backgroundColor: '#EF9F27', borderColor: '#EF9F27' },
  checkboxCheck: { fontSize: 14, fontWeight: '700', color: '#fff' },
  supprimerBtn: { backgroundColor: '#FAECE7', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 0.5, borderColor: '#F09595' },
  supprimerBtnRond: { backgroundColor: '#FAECE7', borderRadius: 8, padding: 6, borderWidth: 0.5, borderColor: '#F09595' },
  supprimerBtnTxt: { fontSize: 11, color: '#A32D2D', fontWeight: '500' },
  btnSupprimerSel: { backgroundColor: '#A32D2D', borderRadius: 14, padding: 16, alignItems: 'center' },
  btnSupprimerSelTxt: { fontSize: 15, fontWeight: '600', color: '#fff' },
  editBtn: { backgroundColor: '#E6F1FB', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 0.5, borderColor: '#B8D4F5' },
  editBtnTxt: { fontSize: 11, color: '#185FA5', fontWeight: '500' },
  shiftCardEditing: { borderColor: '#185FA5', borderWidth: 1.5, backgroundColor: '#F5F8FF' },
  shiftEditPanel: { marginTop: 12, paddingTop: 12, borderTopWidth: 0.5, borderTopColor: '#eee' },
  depLigneBlock: { paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: '#f5f5f5' },
  libellInput: { backgroundColor: colors.bg, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, fontSize: 13, color: colors.text },
  confirmOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  confirmBox: { backgroundColor: colors.surface, borderRadius: 18, padding: 24, width: '100%', maxWidth: 380 },
  confirmTitre: { fontSize: 17, fontWeight: '700', color: colors.text, marginBottom: 12 },
  confirmMsg: { fontSize: 14, color: colors.textSecondary, lineHeight: 22, marginBottom: 20 },
  confirmBtns: { flexDirection: 'row', gap: 10 },
  confirmCancel: { flex: 1, padding: 14, borderRadius: 12, backgroundColor: colors.inputBg, alignItems: 'center' },
  confirmCancelTxt: { fontSize: 14, color: colors.textMuted },
  confirmOk: { flex: 1, padding: 14, borderRadius: 12, backgroundColor: '#A32D2D', alignItems: 'center' },
  confirmOkTxt: { fontSize: 14, fontWeight: '600', color: '#fff' },
}) }
