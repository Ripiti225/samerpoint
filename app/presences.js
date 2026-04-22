import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  SafeAreaView, ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View
} from 'react-native'
import { useApp } from '../context/AppContext'
import { supabase } from '../lib/supabase'

const STATUTS = ['Présent', 'Absent', 'Repos', 'Congé', 'Malade', 'Permission']

const STATUT_COLORS = {
  'Présent': { bg: '#EAF3DE', text: '#3B6D11' },
  'Absent': { bg: '#FAECE7', text: '#993C1D' },
  'Repos': { bg: '#E6F1FB', text: '#185FA5' },
  'Congé': { bg: '#EEEDFE', text: '#3C3489' },
  'Malade': { bg: '#FAEEDA', text: '#854F0B' },
  'Permission': { bg: '#F1EFE8', text: '#444441' },
}

export default function PresencesScreen() {
  const {
    pointId, pointValide, estBloque, restaurantId, setPaiesJour
  } = useApp()

  const [travailleurs, setTravailleurs] = useState([])
  const [presences, setPresences] = useState({}) // { travailleurId: { statut, paye, shift_nom, heure_debut, heure_fin, presenceId } }
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState(null)

  // Modal shift
  const [modalShift, setModalShift] = useState(false)
  const [travailleurEnCours, setTravailleurEnCours] = useState(null)
  const [formShift, setFormShift] = useState({ nom: '', heure_debut: '', heure_fin: '', paye: '' })
  const [shiftMode, setShiftMode] = useState(null) // 's1' | 's2' | 's3' | 'custom' | null

  const SHIFTS_PRESETS = [
    { key: 's1', label: 'Shift 1', emoji: '🌅', debut: '08:00', fin: '16:00', desc: '08h00 → 16h00' },
    { key: 's2', label: 'Shift 2', emoji: '🌇', debut: '16:00', fin: '00:00', desc: '16h00 → 00h00' },
    { key: 's3', label: 'Nuit',    emoji: '🌙', debut: '00:00', fin: '08:00', desc: '00h00 → 08h00' },
    { key: 'custom', label: 'Personnalisé', emoji: '✏️', debut: '', fin: '', desc: 'Heures libres' },
  ]

  useEffect(() => {
    if (restaurantId) chargerDonnees()
  }, [restaurantId, pointId])

  // Sync paies vers AppContext pour que point-shift les voie
  useEffect(() => {
    const paies = {}
    Object.entries(presences).forEach(([id, p]) => {
      if (parseFloat(p.paye) > 0) paies[id] = p.paye
    })
    setPaiesJour(paies)
  }, [presences])

  async function chargerDonnees() {
    setLoading(true)

    // Charger travailleurs
    const { data: travData } = await supabase
      .from('travailleurs')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .eq('actif', true)
      .order('nom')
    setTravailleurs(travData || [])

    // Charger présences existantes depuis Supabase
    if (pointId) {
      const { data: presData } = await supabase
        .from('presences')
        .select('*')
        .eq('point_id', pointId)

      const presMap = {}
      ;(presData || []).forEach(p => {
        if (p.travailleur_id) {
          presMap[p.travailleur_id] = {
            statut: p.statut,
            paye: String(p.paye || ''),
            shift_nom: p.shift_nom || '',
            heure_debut: p.heure_debut || '',
            heure_fin: p.heure_fin || '',
            presenceId: p.id,
          }
        }
      })
      setPresences(presMap)
    }

    setLoading(false)
  }

  async function sauvegarderPresence(travailleur, statut, paye, shiftNom, heureDebut, heureFin) {
    if (!pointId) return

    const existant = presences[travailleur.id]

    if (existant?.presenceId) {
      // Mettre à jour
      await supabase.from('presences')
        .update({
          statut,
          paye: parseFloat(paye) || 0,
          shift_nom: shiftNom || '',
          heure_debut: heureDebut || '',
          heure_fin: heureFin || '',
        })
        .eq('id', existant.presenceId)
    } else {
      // Créer
      const { data } = await supabase.from('presences')
        .insert({
          point_id: pointId,
          travailleur_id: travailleur.id,
          travailleur_nom: travailleur.nom,
          statut,
          paye: parseFloat(paye) || 0,
          shift_nom: shiftNom || '',
          heure_debut: heureDebut || '',
          heure_fin: heureFin || '',
          restaurant_id: restaurantId,
          date: new Date().toISOString().split('T')[0],
        })
        .select()
        .single()

      if (data) {
        setPresences(prev => ({
          ...prev,
          [travailleur.id]: {
            ...prev[travailleur.id],
            presenceId: data.id,
          }
        }))
      }
    }
  }

  async function setStatutRapide(travailleur, statut) {
    if (estBloque(pointValide)) return

    // Si statut = Présent → ouvrir modal shift
    if (statut === 'Présent') {
      const existant = presences[travailleur.id]
      setTravailleurEnCours(travailleur)
      setFormShift({
        nom: existant?.shift_nom || '',
        heure_debut: existant?.heure_debut || '',
        heure_fin: existant?.heure_fin || '',
        paye: existant?.paye || '',
      })
      // Détecter le preset correspondant si déjà renseigné
      if (existant?.heure_debut && existant?.heure_fin) {
        const preset = SHIFTS_PRESETS.find(
          s => s.debut === existant.heure_debut && s.fin === existant.heure_fin && s.key !== 'custom'
        )
        setShiftMode(preset ? preset.key : 'custom')
      } else {
        setShiftMode(null)
      }
      setModalShift(true)
      return
    }

    // Autres statuts → sauvegarder directement
    setPresences(prev => ({
      ...prev,
      [travailleur.id]: {
        ...prev[travailleur.id],
        statut,
        paye: '',
        shift_nom: '',
        heure_debut: '',
        heure_fin: '',
      }
    }))
    await sauvegarderPresence(travailleur, statut, '', '', '', '')
  }

  async function confirmerShift() {
    if (!formShift.heure_debut || !formShift.heure_fin) {
      Alert.alert('Erreur', 'Heure de début et de fin obligatoires')
      return
    }
    if (!travailleurEnCours) return

    const shiftNom = formShift.nom || `Shift ${formShift.heure_debut}-${formShift.heure_fin}`

    setPresences(prev => ({
      ...prev,
      [travailleurEnCours.id]: {
        ...prev[travailleurEnCours.id],
        statut: 'Présent',
        paye: formShift.paye,
        shift_nom: shiftNom,
        heure_debut: formShift.heure_debut,
        heure_fin: formShift.heure_fin,
      }
    }))

    await sauvegarderPresence(
      travailleurEnCours,
      'Présent',
      formShift.paye,
      shiftNom,
      formShift.heure_debut,
      formShift.heure_fin
    )

    setModalShift(false)
    setTravailleurEnCours(null)
    setShiftMode(null)
    setFormShift({ nom: '', heure_debut: '', heure_fin: '', paye: '' })
  }

  function totalPaie() {
    return Object.values(presences).reduce((sum, p) => sum + (parseFloat(p.paye) || 0), 0)
  }

  function fmt(n) { return Math.round(n).toLocaleString('fr-FR') + ' FCFA' }

  function nbParStatut(statut) {
    return Object.values(presences).filter(p => p.statut === statut).length
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => {
            if (router.canGoBack()) router.back()
            else router.replace('/accueil')
          }}>
            <Text style={styles.back}>‹ Retour</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitre}>Présences</Text>
          <View style={{ width: 60 }} />
        </View>
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#EF9F27" />
          <Text style={styles.loadingTxt}>Chargement de l'équipe...</Text>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => {
          if (router.canGoBack()) router.back()
          else router.replace('/accueil')
        }}>
          <Text style={styles.back}>‹ Retour</Text>
        </TouchableOpacity>
        <View>
          <Text style={styles.headerTitre}>Présences</Text>
          <Text style={styles.headerSub}>{travailleurs.length} travailleurs</Text>
        </View>
        <View style={styles.totalBadge}>
          <Text style={styles.totalBadgeTxt}>{fmt(totalPaie())}</Text>
        </View>
      </View>

      {pointValide && (
        <View style={styles.valideBanner}>
          <Text style={styles.valideTxt}>🔒 Point validé — lecture seule</Text>
        </View>
      )}

      {!pointValide && (
        <View style={styles.autosaveBanner}>
          <Text style={styles.autosaveTxt}>💾 Sauvegarde automatique — visible par tous les comptes</Text>
        </View>
      )}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.statsBar}>
        {STATUTS.map(s => {
          const nb = nbParStatut(s)
          if (nb === 0) return null
          return (
            <View key={s} style={[styles.statBadge, { backgroundColor: STATUT_COLORS[s].bg }]}>
              <Text style={[styles.statBadgeTxt, { color: STATUT_COLORS[s].text }]}>
                {s} ({nb})
              </Text>
            </View>
          )
        })}
      </ScrollView>

      <ScrollView style={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {travailleurs.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyTxt}>Aucun travailleur actif</Text>
            <Text style={styles.emptySub}>Ajoutez des travailleurs dans les paramètres</Text>
          </View>
        ) : (
          travailleurs.map(t => {
            const pres = presences[t.id]
            const statut = pres?.statut || null
            const isSelected = selectedId === t.id
            const couleurStatut = statut ? STATUT_COLORS[statut] : null

            return (
              <View key={t.id} style={[
                styles.travCard,
                statut && { borderLeftColor: couleurStatut.text, borderLeftWidth: 3 }
              ]}>
                <TouchableOpacity
                  style={styles.travHeader}
                  onPress={() => setSelectedId(isSelected ? null : t.id)}
                  disabled={estBloque(pointValide)}
                >
                  <View style={styles.avatar}>
                    <Text style={styles.avatarTxt}>
                      {t.nom.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.travInfo}>
                    <Text style={styles.travNom}>{t.nom}</Text>
                    <Text style={styles.travPoste}>{t.poste} — {t.type_contrat}</Text>
                    {pres?.shift_nom && (
                      <Text style={styles.travShift}>
                        ⏰ {pres.shift_nom} ({pres.heure_debut} → {pres.heure_fin})
                      </Text>
                    )}
                  </View>
                  <View style={styles.travRight}>
                    {statut ? (
                      <View style={[styles.statutBadge, { backgroundColor: couleurStatut.bg }]}>
                        <Text style={[styles.statutTxt, { color: couleurStatut.text }]}>{statut}</Text>
                      </View>
                    ) : (
                      <View style={styles.statutBadgeVide}>
                        <Text style={styles.statutTxtVide}>Non défini</Text>
                      </View>
                    )}
                    <Text style={styles.chevron}>{isSelected ? '▲' : '▼'}</Text>
                  </View>
                </TouchableOpacity>

                {isSelected && !estBloque(pointValide) && (
                  <View style={styles.statutSelector}>
                    <Text style={styles.selectorLabel}>Choisir le statut</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      <View style={styles.statutRow}>
                        {STATUTS.map(s => (
                          <TouchableOpacity
                            key={s}
                            style={[
                              styles.statutChoix,
                              { backgroundColor: STATUT_COLORS[s].bg },
                              statut === s && { borderWidth: 2, borderColor: STATUT_COLORS[s].text }
                            ]}
                            onPress={() => setStatutRapide(t, s)}
                          >
                            <Text style={[styles.statutChoixTxt, { color: STATUT_COLORS[s].text }]}>
                              {s}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </ScrollView>

                    {/* Bouton modifier shift si présent */}
                    {statut === 'Présent' && (
                      <TouchableOpacity
                        style={styles.modifShiftBtn}
                        onPress={() => {
                          setTravailleurEnCours(t)
                          setFormShift({
                            nom: pres?.shift_nom || '',
                            heure_debut: pres?.heure_debut || '',
                            heure_fin: pres?.heure_fin || '',
                            paye: pres?.paye || '',
                          })
                          const preset = SHIFTS_PRESETS.find(
                            s => s.debut === pres?.heure_debut && s.fin === pres?.heure_fin && s.key !== 'custom'
                          )
                          setShiftMode(pres?.heure_debut ? (preset ? preset.key : 'custom') : null)
                          setModalShift(true)
                        }}
                      >
                        <Text style={styles.modifShiftTxt}>✏️ Modifier shift & paie</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}

                {/* Affichage paie */}
                {statut === 'Présent' && pres?.paye && parseFloat(pres.paye) > 0 && (
                  <View style={styles.paieAffichage}>
                    <Text style={styles.paieAffichageTxt}>
                      💰 {fmt(parseFloat(pres.paye) || 0)}
                    </Text>
                  </View>
                )}
              </View>
            )
          })
        )}

        {/* Récapitulatif */}
        {travailleurs.length > 0 && (
          <View style={styles.recapCard}>
            <Text style={styles.recapTitre}>Récapitulatif</Text>
            {STATUTS.map(s => {
              const nb = nbParStatut(s)
              if (nb === 0) return null
              return (
                <View key={s} style={styles.recapRow}>
                  <Text style={[styles.recapLabel, { color: STATUT_COLORS[s].text }]}>{s}</Text>
                  <Text style={styles.recapVal}>{nb} personne(s)</Text>
                </View>
              )
            })}
            <View style={[styles.recapRow, { borderBottomWidth: 0, marginTop: 8 }]}>
              <Text style={[styles.recapLabel, { fontWeight: '600', color: '#1a1a1a' }]}>Total paie</Text>
              <Text style={[styles.recapVal, { fontWeight: '600', color: '#EF9F27', fontSize: 15 }]}>
                {fmt(totalPaie())}
              </Text>
            </View>
          </View>
        )}

        <TouchableOpacity
          style={styles.validerBtn}
          onPress={() => {
            const nbPresents = Object.values(presences).filter(p => p.statut === 'Présent').length
            Alert.alert(
              '✅ Salaires enregistrés',
              `${nbPresents} présence(s) enregistrée(s)\nTotal paie : ${fmt(totalPaie())}`,
              [{ text: 'OK', onPress: () => {
                if (router.canGoBack()) router.back()
                else router.replace('/accueil')
              }}]
            )
          }}
        >
          <Text style={styles.validerTxt}>✅ Valider les présences</Text>
          <Text style={styles.validerSub}>Données sauvegardées automatiquement</Text>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Modal shift */}
      <Modal visible={modalShift} transparent animationType="slide">
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.modalOverlay}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
              <View style={styles.modal}>
                <Text style={styles.modalTitre}>
                  Shift de {travailleurEnCours?.nom}
                </Text>

                {/* ── Sélection du shift ── */}
                <Text style={styles.modalLabel}>Choisir le shift</Text>
                <View style={styles.shiftGrid}>
                  {SHIFTS_PRESETS.map(s => {
                    const actif = shiftMode === s.key
                    return (
                      <TouchableOpacity
                        key={s.key}
                        style={[styles.shiftPresetBtn, actif && styles.shiftPresetBtnActif]}
                        onPress={() => {
                          setShiftMode(s.key)
                          if (s.key !== 'custom') {
                            setFormShift(p => ({
                              ...p,
                              heure_debut: s.debut,
                              heure_fin: s.fin,
                              nom: p.nom || s.label,
                            }))
                          } else {
                            setFormShift(p => ({ ...p, heure_debut: '', heure_fin: '' }))
                          }
                        }}
                      >
                        <Text style={styles.shiftPresetEmoji}>{s.emoji}</Text>
                        <Text style={[styles.shiftPresetLabel, actif && styles.shiftPresetLabelActif]}>
                          {s.label}
                        </Text>
                        <Text style={[styles.shiftPresetDesc, actif && { color: '#534AB7' }]}>
                          {s.desc}
                        </Text>
                      </TouchableOpacity>
                    )
                  })}
                </View>

                {/* Heures uniquement si personnalisé */}
                {shiftMode === 'custom' && (
                  <>
                    <Text style={styles.modalLabel}>Heure de début *</Text>
                    <TextInput
                      style={styles.modalInput}
                      placeholder="Ex: 08:00"
                      value={formShift.heure_debut}
                      onChangeText={v => setFormShift(p => ({ ...p, heure_debut: v }))}
                      placeholderTextColor="#bbb"
                      keyboardType="numbers-and-punctuation"
                    />
                    <Text style={styles.modalLabel}>Heure de fin *</Text>
                    <TextInput
                      style={styles.modalInput}
                      placeholder="Ex: 16:00"
                      value={formShift.heure_fin}
                      onChangeText={v => setFormShift(p => ({ ...p, heure_fin: v }))}
                      placeholderTextColor="#bbb"
                      keyboardType="numbers-and-punctuation"
                    />
                  </>
                )}

                {/* Récap heures si preset sélectionné */}
                {shiftMode && shiftMode !== 'custom' && (
                  <View style={styles.shiftRecap}>
                    <Text style={styles.shiftRecapTxt}>
                      ⏰ {formShift.heure_debut} → {formShift.heure_fin}
                    </Text>
                  </View>
                )}

                <Text style={styles.modalLabel}>Paie du jour (FCFA)</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="Ex: 5000"
                  value={formShift.paye}
                  onChangeText={v => setFormShift(p => ({ ...p, paye: v }))}
                  placeholderTextColor="#bbb"
                  keyboardType="numeric"
                />

                <View style={styles.modalBtns}>
                  <TouchableOpacity
                    style={styles.modalCancel}
                    onPress={() => {
                      setModalShift(false)
                      setTravailleurEnCours(null)
                      setShiftMode(null)
                    }}
                  >
                    <Text style={styles.modalCancelTxt}>Annuler</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.modalConfirm,
                      (!shiftMode || !formShift.heure_debut || !formShift.heure_fin) && { opacity: 0.4 }
                    ]}
                    onPress={confirmerShift}
                    disabled={!shiftMode || !formShift.heure_debut || !formShift.heure_fin}
                  >
                    <Text style={styles.modalConfirmTxt}>Confirmer</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </KeyboardAvoidingView>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: {
    backgroundColor: '#EF9F27', padding: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'
  },
  back: { fontSize: 16, color: '#412402', fontWeight: '500' },
  headerTitre: { fontSize: 16, fontWeight: '600', color: '#412402', textAlign: 'center' },
  headerSub: { fontSize: 11, color: '#854F0B', textAlign: 'center' },
  totalBadge: { backgroundColor: '#BA7517', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  totalBadgeTxt: { fontSize: 11, color: '#FAEEDA', fontWeight: '500' },
  valideBanner: { backgroundColor: '#FAECE7', padding: 10, alignItems: 'center' },
  valideTxt: { fontSize: 12, color: '#993C1D', fontWeight: '500' },
  autosaveBanner: { backgroundColor: '#EAF3DE', padding: 8, alignItems: 'center' },
  autosaveTxt: { fontSize: 11, color: '#3B6D11', fontWeight: '500' },
  statsBar: {
    backgroundColor: '#fff', maxHeight: 44,
    borderBottomWidth: 0.5, borderBottomColor: '#eee', paddingHorizontal: 12
  },
  statBadge: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, marginRight: 8, marginVertical: 6 },
  statBadgeTxt: { fontSize: 11, fontWeight: '500' },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingTxt: { fontSize: 13, color: '#888', marginTop: 12 },
  body: { flex: 1, padding: 14 },
  emptyBox: { alignItems: 'center', paddingVertical: 40 },
  emptyTxt: { fontSize: 14, color: '#888', fontWeight: '500' },
  emptySub: { fontSize: 12, color: '#bbb', marginTop: 6 },
  travCard: {
    backgroundColor: '#fff', borderRadius: 14, marginBottom: 10,
    borderWidth: 0.5, borderColor: '#eee', overflow: 'hidden'
  },
  travHeader: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  avatar: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: '#EF9F27', alignItems: 'center', justifyContent: 'center'
  },
  avatarTxt: { fontSize: 15, fontWeight: '600', color: '#fff' },
  travInfo: { flex: 1 },
  travNom: { fontSize: 14, fontWeight: '600', color: '#1a1a1a' },
  travPoste: { fontSize: 11, color: '#888', marginTop: 2 },
  travShift: { fontSize: 10, color: '#534AB7', marginTop: 3 },
  travRight: { alignItems: 'flex-end', gap: 4 },
  statutBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  statutTxt: { fontSize: 11, fontWeight: '500' },
  statutBadgeVide: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, backgroundColor: '#f5f5f5' },
  statutTxtVide: { fontSize: 11, color: '#bbb' },
  chevron: { fontSize: 10, color: '#ccc' },
  statutSelector: { borderTopWidth: 0.5, borderTopColor: '#f0f0f0', padding: 14 },
  selectorLabel: {
    fontSize: 11, fontWeight: '600', color: '#888',
    marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5
  },
  statutRow: { flexDirection: 'row', gap: 8 },
  statutChoix: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  statutChoixTxt: { fontSize: 13, fontWeight: '500' },
  modifShiftBtn: {
    marginTop: 12, backgroundColor: '#EEEDFE',
    borderRadius: 10, padding: 10, alignItems: 'center'
  },
  modifShiftTxt: { fontSize: 13, color: '#534AB7', fontWeight: '500' },
  paieAffichage: { paddingHorizontal: 14, paddingBottom: 10 },
  paieAffichageTxt: { fontSize: 12, color: '#EF9F27', fontWeight: '500' },
  recapCard: {
    backgroundColor: '#fff', borderRadius: 14, padding: 14,
    marginBottom: 14, borderWidth: 0.5, borderColor: '#eee'
  },
  recapTitre: { fontSize: 13, fontWeight: '600', color: '#1a1a1a', marginBottom: 12 },
  recapRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 6, borderBottomWidth: 0.5, borderBottomColor: '#f5f5f5'
  },
  recapLabel: { fontSize: 13, color: '#888' },
  recapVal: { fontSize: 13, color: '#1a1a1a' },
  validerBtn: {
    backgroundColor: '#3B6D11', borderRadius: 14, padding: 16,
    alignItems: 'center', marginBottom: 10
  },
  validerTxt: { fontSize: 15, fontWeight: '600', color: '#fff' },
  validerSub: { fontSize: 11, color: '#C0DD97', marginTop: 4 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modal: {
    backgroundColor: '#fff', borderTopLeftRadius: 24,
    borderTopRightRadius: 24, padding: 24, paddingBottom: 40
  },
  modalTitre: { fontSize: 18, fontWeight: '600', color: '#1a1a1a', marginBottom: 20 },
  modalLabel: {
    fontSize: 11, fontWeight: '600', color: '#888',
    letterSpacing: 0.5, marginBottom: 6, textTransform: 'uppercase'
  },
  modalInput: {
    backgroundColor: '#f5f5f5', borderRadius: 12,
    padding: 14, fontSize: 15, color: '#1a1a1a', marginBottom: 14
  },
  shiftGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  shiftPresetBtn: {
    width: '47%', backgroundColor: '#f5f5f5', borderRadius: 12,
    padding: 12, alignItems: 'center', borderWidth: 1.5, borderColor: '#eee'
  },
  shiftPresetBtnActif: { backgroundColor: '#EEEDFE', borderColor: '#534AB7' },
  shiftPresetEmoji: { fontSize: 22, marginBottom: 4 },
  shiftPresetLabel: { fontSize: 13, fontWeight: '600', color: '#1a1a1a', marginBottom: 2 },
  shiftPresetLabelActif: { color: '#534AB7' },
  shiftPresetDesc: { fontSize: 10, color: '#888', textAlign: 'center' },
  shiftRecap: {
    backgroundColor: '#EEEDFE', borderRadius: 10, padding: 10,
    alignItems: 'center', marginBottom: 14
  },
  shiftRecapTxt: { fontSize: 14, fontWeight: '600', color: '#534AB7' },
  modalBtns: { flexDirection: 'row', gap: 10, marginTop: 6 },
  modalCancel: { flex: 1, padding: 14, borderRadius: 12, backgroundColor: '#f5f5f5', alignItems: 'center' },
  modalCancelTxt: { fontSize: 14, color: '#888' },
  modalConfirm: { flex: 2, padding: 14, borderRadius: 12, backgroundColor: '#EF9F27', alignItems: 'center' },
  modalConfirmTxt: { fontSize: 14, fontWeight: '600', color: '#412402' },
})