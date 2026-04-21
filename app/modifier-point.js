import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import {
    ActivityIndicator,
    Alert,
    SafeAreaView, ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native'
import { Calendar } from 'react-native-calendars'
import { supabase } from '../lib/supabase'

const ONGLETS = ['Résumé', 'Ventes', 'Dépenses', 'Fournisseurs', 'Présences']

export default function ModifierPointScreen() {
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

    // Charger transactions fournisseurs
    const { data: trans } = await supabase
      .from('transactions_fournisseurs').select('*').eq('point_id', pointData.id)
    setTransactions(trans || [])

    setEtape(3)
    setLoading(false)
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

  async function sauvegarder() {
    Alert.alert(
      'Confirmer la modification',
      `Ventes : ${fmt(val(form.vente_total))}\nDépenses : ${fmt(val(form.depense_total))}\nBénéfice SC : ${fmt(beneficeSC())}\n\nModifier ce point ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Confirmer', onPress: async () => {
          setLoading(true)
          const { error } = await supabase.from('points').update({
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
          }).eq('id', point.id)
          setLoading(false)
          if (error) {
            Alert.alert('Erreur', error.message)
          } else {
            Alert.alert('Succès', 'Point modifié !')
            if (router.canGoBack()) router.back()
            else router.replace('/accueil')
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
      <ScrollView showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionTitre}>Ventes shifts (lecture seule)</Text>
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
          <View style={[styles.resumeRow, { borderBottomWidth: 0, paddingTop: 8 }]}>
            <Text style={[styles.resumeLabel, { fontWeight: '600', color: '#BA7517' }]}>Total shifts</Text>
            <Text style={[styles.resumeValue, { color: '#BA7517', fontWeight: '700' }]}>{fmt(totalShifts)}</Text>
          </View>
        </View>

        <View style={styles.card}>
          <InputLigne label="Yango TAB (×0,77)" champ="yango_tab" />
          <InputLigne label="Glovo TAB (×0,705)" champ="glovo_tab" />
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

        <TouchableOpacity style={styles.saveBtn} onPress={sauvegarder}>
          <Text style={styles.saveTxt}>💾 Enregistrer</Text>
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
                <View key={i} style={styles.inputLigne}>
                  <Text style={styles.inputLabel}>{d.libelle || 'Sans nom'}</Text>
                  <TextInput
                    style={styles.inputField}
                    value={String(d.montant || '')}
                    onChangeText={v => {
                      const newDep = [...depenses]
                      const idx = newDep.findIndex(x => x.id === d.id)
                      if (idx >= 0) newDep[idx] = { ...newDep[idx], montant: parseFloat(v) || 0 }
                      setDepenses(newDep)
                    }}
                    keyboardType="numeric"
                    placeholder="0"
                    placeholderTextColor="#bbb"
                  />
                </View>
              ))}
              <View style={styles.catTotal}>
                <Text style={styles.catTotalLabel}>Total {cat}</Text>
                <Text style={styles.catTotalValue}>{fmt(lignes.reduce((s, d) => s + (d.montant || 0), 0))}</Text>
              </View>
            </View>
          </View>
        ))}

        {depenses.length === 0 && (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyTxt}>Aucune dépense enregistrée pour ce point</Text>
          </View>
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
            for (const d of depenses) {
              await supabase.from('depenses').update({ montant: d.montant }).eq('id', d.id)
            }
            const totalDep = depenses.reduce((s, d) => s + (d.montant || 0), 0)
            await supabase.from('points').update({ depense_total: totalDep }).eq('id', point.id)
            setForm(p => ({ ...p, depense_total: String(totalDep) }))
            setLoading(false)
            Alert.alert('Succès', 'Dépenses mises à jour !')
          }}
        >
          <Text style={styles.saveTxt}>💾 Enregistrer les dépenses</Text>
        </TouchableOpacity>
        <View style={{ height: 40 }} />
      </ScrollView>
    )
  }

  function renderFournisseurs() {
    return (
      <ScrollView showsVerticalScrollIndicator={false}>
        {transactions.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyTxt}>Aucune transaction fournisseur</Text>
          </View>
        ) : transactions.map((t, i) => (
          <View key={i} style={styles.fournCard}>
            <Text style={styles.fournNom}>Fournisseur {i + 1}</Text>
            <View style={styles.inputLigne}>
              <Text style={styles.inputLabel}>Facture</Text>
              <TextInput
                style={styles.inputField}
                value={String(t.facture || '')}
                onChangeText={v => {
                  const newTrans = [...transactions]
                  newTrans[i] = { ...newTrans[i], facture: parseFloat(v) || 0 }
                  setTransactions(newTrans)
                }}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor="#bbb"
              />
            </View>
            <View style={styles.inputLigne}>
              <Text style={styles.inputLabel}>Payé</Text>
              <TextInput
                style={styles.inputField}
                value={String(t.paye || '')}
                onChangeText={v => {
                  const newTrans = [...transactions]
                  newTrans[i] = {
                    ...newTrans[i],
                    paye: parseFloat(v) || 0,
                    reste: (newTrans[i].facture || 0) - (parseFloat(v) || 0)
                  }
                  setTransactions(newTrans)
                }}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor="#bbb"
              />
            </View>
            <View style={[styles.resumeRow, { borderBottomWidth: 0, marginTop: 8 }]}>
              <Text style={styles.resumeLabel}>Reste dû</Text>
              <Text style={[styles.resumeValue, { color: (t.facture - t.paye) > 0 ? '#A32D2D' : '#3B6D11', fontWeight: '600' }]}>
                {fmt(t.facture - t.paye)}
              </Text>
            </View>
          </View>
        ))}

        <TouchableOpacity
          style={styles.saveBtn}
          onPress={async () => {
            setLoading(true)
            for (const t of transactions) {
              await supabase.from('transactions_fournisseurs').update({
                facture: t.facture,
                paye: t.paye,
                reste: t.facture - t.paye,
              }).eq('id', t.id)
            }
            setLoading(false)
            Alert.alert('Succès', 'Fournisseurs mis à jour !')
          }}
        >
          <Text style={styles.saveTxt}>💾 Enregistrer les fournisseurs</Text>
        </TouchableOpacity>
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
            for (const p of presences) {
              await supabase.from('presences').update({ paye: p.paye }).eq('id', p.id)
            }
            setLoading(false)
            Alert.alert('Succès', 'Présences mises à jour !')
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
            <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
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
            <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
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
                {ongletActif === 'Ventes' && renderVentes()}
                {ongletActif === 'Dépenses' && renderDepenses()}
                {ongletActif === 'Fournisseurs' && renderFournisseurs()}
                {ongletActif === 'Présences' && renderPresences()}
              </View>
            </>
          )}
        </>
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: { backgroundColor: '#534AB7', padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: { fontSize: 16, color: '#CECBF6', fontWeight: '500' },
  headerTitre: { fontSize: 16, fontWeight: '600', color: '#fff', textAlign: 'center' },
  headerSub: { fontSize: 11, color: '#CECBF6', textAlign: 'center' },
  stepBar: { flexDirection: 'row', backgroundColor: '#fff', padding: 14, borderBottomWidth: 0.5, borderBottomColor: '#eee', alignItems: 'center', justifyContent: 'center' },
  stepItem: { flexDirection: 'row', alignItems: 'center' },
  stepNum: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#f5f5f5', alignItems: 'center', justifyContent: 'center', marginRight: 6, borderWidth: 0.5, borderColor: '#eee' },
  stepDone: { backgroundColor: '#534AB7' },
  stepActive: { backgroundColor: '#534AB7' },
  stepNumTxt: { fontSize: 11, fontWeight: '600', color: '#fff' },
  stepLine: { width: 30, height: 1, backgroundColor: '#eee', marginHorizontal: 6 },
  stepLabel: { fontSize: 11, color: '#888', marginRight: 6 },
  stepLabelActive: { color: '#534AB7', fontWeight: '600' },
  ongletBar: { backgroundColor: '#fff', maxHeight: 46, borderBottomWidth: 0.5, borderBottomColor: '#eee' },
  ongletBtn: { paddingHorizontal: 16, paddingVertical: 12 },
  ongletBtnActive: { borderBottomWidth: 2, borderBottomColor: '#534AB7' },
  ongletTxt: { fontSize: 13, color: '#888' },
  ongletTxtActive: { color: '#534AB7', fontWeight: '600' },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, padding: 14 },
  sectionTitre: { fontSize: 12, fontWeight: '600', color: '#888', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 8 },
  restoCard: { backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 0.5, borderColor: '#eee' },
  restoDot: { width: 12, height: 12, borderRadius: 6 },
  restoNom: { fontSize: 14, fontWeight: '600', color: '#1a1a1a' },
  restoSub: { fontSize: 11, color: '#888', marginTop: 2 },
  restoArrow: { fontSize: 18, color: '#ccc' },
  legendeRow: { flexDirection: 'row', gap: 16, marginBottom: 12 },
  legendeItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendeDot: { width: 10, height: 10, borderRadius: 5 },
  legendeTxt: { fontSize: 11, color: '#888' },
  calendar: { borderRadius: 14, borderWidth: 0.5, borderColor: '#eee', marginBottom: 14 },
  infoBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 14, borderWidth: 0.5, borderColor: '#eee' },
  infoBarTxt: { fontSize: 13, fontWeight: '600', color: '#1a1a1a' },
  valideBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  valideTxt: { fontSize: 11, fontWeight: '500' },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  kpiCard: { width: '47%', backgroundColor: '#fff', borderRadius: 12, padding: 12, borderWidth: 0.5, borderColor: '#eee' },
  kpiLabel: { fontSize: 10, color: '#888', marginBottom: 4 },
  kpiValue: { fontSize: 14, fontWeight: '600' },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 14, borderWidth: 0.5, borderColor: '#eee' },
  resumeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 0.5, borderBottomColor: '#f5f5f5' },
  resumeLabel: { fontSize: 13, color: '#888', flex: 1 },
  resumeValue: { fontSize: 13, fontWeight: '500', color: '#1a1a1a' },
  inputLigne: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: '#f5f5f5' },
  inputLabel: { fontSize: 13, color: '#555', flex: 1 },
  inputField: { width: 130, backgroundColor: '#f5f5f5', borderRadius: 8, padding: 8, fontSize: 14, color: '#1a1a1a', textAlign: 'right' },
  catTotal: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 10, marginTop: 4 },
  catTotalLabel: { fontSize: 13, fontWeight: '600', color: '#1a1a1a' },
  catTotalValue: { fontSize: 14, fontWeight: '600', color: '#EF9F27' },
  recapCard: { backgroundColor: '#FAEEDA', borderRadius: 14, padding: 14, marginBottom: 14 },
  recapTitre: { fontSize: 13, fontWeight: '600', color: '#854F0B', marginBottom: 10 },
  recapLabel: { fontSize: 13, color: '#854F0B', flex: 1 },
  recapValue: { fontSize: 13, fontWeight: '500' },
  fournCard: { backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 0.5, borderColor: '#eee' },
  fournNom: { fontSize: 13, fontWeight: '600', color: '#1a1a1a', marginBottom: 8 },
  presenceCard: { backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 0.5, borderColor: '#eee' },
  presenceHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#EF9F27', alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontSize: 13, fontWeight: '600', color: '#fff' },
  presenceNom: { fontSize: 14, fontWeight: '600', color: '#1a1a1a' },
  presenceStatut: { fontSize: 12, color: '#888', marginTop: 2 },
  emptyBox: { alignItems: 'center', paddingVertical: 30 },
  emptyTxt: { fontSize: 13, color: '#888', textAlign: 'center' },
  saveBtn: { backgroundColor: '#534AB7', borderRadius: 14, padding: 16, alignItems: 'center', marginBottom: 10, marginTop: 8 },
  saveTxt: { fontSize: 15, fontWeight: '600', color: '#fff' },
})