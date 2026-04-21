import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import {
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
import { getInventaireShifts, saveInventaireShift } from '../lib/api'

const CATEGORIES = [
  {
    nom: 'Pains',
    produits: [
      { id: 'p1', nom: 'Pain chawarma', prix: 2500 },
      { id: 'p2', nom: 'Pain burger', prix: 3500 },
      { id: 'p3', nom: 'Pain fahita', prix: 3000 },
    ]
  },
  {
    nom: 'Poulet',
    produits: [
      { id: 'po1', nom: 'Poulet frais', prix: 0, noAlert: true },
      { id: 'po2', nom: 'Pané', prix: 0 },
      { id: 'po3', nom: 'Rôti', prix: 0 },
      { id: 'po4', nom: 'Braise', prix: 0 },
      { id: 'po5', nom: 'Désossé', prix: 0 },
      { id: 'po6', nom: 'Cuisses de poulet', prix: 0 },
      { id: 'po7', nom: 'Pâte de poulet', prix: 1000, auto: true },
      { id: 'po8', nom: 'Total poulet', prix: 8000, totalPoulet: true },
    ]
  },
  {
    nom: 'Apéritifs',
    produits: [
      { id: 'a1', nom: 'Nems', prix: 2000 },
      { id: 'a2', nom: 'Kébbé', prix: 1000 },
      { id: 'a3', nom: 'Bourak', prix: 2000 },
      { id: 'a4', nom: 'Fatayer viande', prix: 1000 },
      { id: 'a5', nom: 'Fatayer légumes', prix: 1000 },
      { id: 'a6', nom: 'Fatayer maison', prix: 1500 },
      { id: 'a7', nom: 'Fatayer JFromage', prix: 1500 },
      { id: 'a8', nom: 'Mini tacos', prix: 2000 },
      { id: 'a9', nom: 'Francisco', prix: 0 },
      { id: 'a10', nom: 'Brochette poulet', prix: 5000 },
      { id: 'a11', nom: 'Brochette viande', prix: 5000 },
    ]
  },
  {
    nom: 'Plats',
    produits: [
      { id: 'pl1', nom: 'Steak', prix: 6000 },
      { id: 'pl2', nom: 'Escalope plats', prix: 5000 },
      { id: 'pl3', nom: 'Chicken burger', prix: 0 },
      { id: 'pl4', nom: 'Viande burger', prix: 0 },
      { id: 'pl5', nom: 'Crispy 5pcs', prix: 5000 },
    ]
  },
  {
    nom: 'Fromage & Pizzas',
    produits: [
      { id: 'f1', nom: 'Philadelphia', prix: 2500 },
      { id: 'f2', nom: 'Manaïche (100g)', prix: 0, fromage: 100 },
      { id: 'f3', nom: 'Pizza spéciale (130g)', prix: 0, fromage: 130 },
      { id: 'f4', nom: 'Pizza moyenne (160g)', prix: 0, fromage: 160 },
      { id: 'f5', nom: 'Pizza grande (200g)', prix: 0, fromage: 200 },
      { id: 'f6', nom: 'Mini pizza (20g)', prix: 0, fromage: 20 },
      { id: 'f7', nom: 'Fatayer JF 30g', prix: 0, fromage: 30 },
      { id: 'f8', nom: 'Sandwich/Tacos (50g)', prix: 0, fromage: 50 },
      { id: 'f9', nom: 'Mini tacos (30g)', prix: 0, fromage: 30 },
      { id: 'f10', nom: 'Total Fromage (g)', prix: 5, totalFromage: true },
    ]
  },
  {
    nom: 'Boissons',
    produits: [
      { id: 'b1', nom: 'Nespresso', prix: 1000 },
      { id: 'b2', nom: 'Eau G', prix: 1000 },
      { id: 'b3', nom: 'Eau P', prix: 500 },
      { id: 'b4', nom: 'Boisson 1000f', prix: 1000 },
      { id: 'b5', nom: 'Boisson 1500f', prix: 1500 },
      { id: 'b6', nom: 'Pot Fresco', prix: 1000 },
      { id: 'b7', nom: 'Darina', prix: 0, auto: true },
      { id: 'b8', nom: 'Thé', prix: 1000 },
    ]
  },
  {
    nom: 'Glaces & Cornets',
    produits: [
      { id: 'g1', nom: 'Glace 2 boules', prix: 0, boules: 2 },
      { id: 'g2', nom: 'Milkshake/Spéciale', prix: 0, boules: 3 },
      { id: 'g3', nom: 'Pot de glace (38 boules)', prix: 6000, totalGlace: true },
      { id: 'g4', nom: 'Cornets', prix: 1000 },
    ]
  },
  {
    nom: 'Frites',
    produits: [
      { id: 'fr1', nom: 'Portions de frites', prix: 0 },
      { id: 'fr2', nom: 'Tacos vendus', prix: 0 },
      { id: 'fr3', nom: 'Sachet de frites', prix: 2500, totalFrites: true },
    ]
  },
  {
    nom: 'Jus',
    produits: [
      { id: 'j1', nom: 'Ananas (ml)', prix: 0 },
      { id: 'j2', nom: 'Orange (ml)', prix: 0 },
    ]
  },
  {
    nom: 'Poissons',
    produits: [
      { id: 'ps1', nom: 'Poissons', prix: 0 },
    ]
  },
]

export default function InventaireScreen() {
  const { pointId, setInventaireTermine } = useApp()

  const [shifts, setShifts] = useState([])
  const [shiftActif, setShiftActif] = useState(null)
  const [modalShift, setModalShift] = useState(false)
  const [formShift, setFormShift] = useState({ nom: '', heure_debut: '', heure_fin: '' })
  const [stocksParShift, setStocksParShift] = useState({})
  const [explications, setExplications] = useState({})
  const [catActive, setCatActive] = useState('Pains')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (pointId) chargerShifts()
  }, [pointId])

  async function chargerShifts() {
    const data = await getInventaireShifts(pointId)
    if (data && data.length > 0) {
      const uniqueShifts = []
      const seen = new Set()
      data.forEach(d => {
        if (!seen.has(d.shift_numero)) {
          seen.add(d.shift_numero)
          uniqueShifts.push({
            numero: d.shift_numero,
            nom: d.shift_nom,
            heure_debut: d.heure_debut,
            heure_fin: d.heure_fin,
            termine: false,
          })
        }
      })
      setShifts(uniqueShifts)

      // Charger stocks de tous les shifts
      const allStocks = {}
      uniqueShifts.forEach(shift => {
        const lignesShift = data.filter(d => d.shift_numero === shift.numero)
        const stocks = {}
        lignesShift.forEach(inv => {
          stocks[inv.produit_id] = {
            initial: String(inv.stock_initial || ''),
            entrees: String(inv.entrees || ''),
            sorties: String(inv.sorties || ''),
            final: String(inv.stock_final || ''),
            prevision: String(inv.prevision || ''),
          }
        })
        allStocks[shift.numero] = stocks
      })
      setStocksParShift(allStocks)
      setShiftActif(uniqueShifts[0])
    }
  }

  function getStock(id, champ) {
    if (!shiftActif) return ''
    return stocksParShift[shiftActif.numero]?.[id]?.[champ] || ''
  }

  function setStock(id, champ, valeur) {
    if (!shiftActif) return
    setStocksParShift(prev => ({
      ...prev,
      [shiftActif.numero]: {
        ...prev[shiftActif.numero],
        [id]: {
          ...prev[shiftActif.numero]?.[id],
          [champ]: valeur
        }
      }
    }))
  }

  async function ajouterShift() {
    if (!formShift.heure_debut || !formShift.heure_fin) {
      Alert.alert('Erreur', 'Heure de début et de fin obligatoires')
      return
    }
    const numero = shifts.length + 1
    const nom = formShift.nom || `Shift ${numero}`
    const newShift = {
      numero,
      nom,
      heure_debut: formShift.heure_debut,
      heure_fin: formShift.heure_fin,
      termine: false,
    }
    setShifts(prev => [...prev, newShift])
    setShiftActif(newShift)
    setStocksParShift(prev => ({ ...prev, [numero]: {} }))
    setFormShift({ nom: '', heure_debut: '', heure_fin: '' })
    setModalShift(false)
  }

  function changerShift(shift) {
    setShiftActif(shift)
  }

  // ─── Calculs ───────────────────────────────────────────────
  function calculEcart(produit) {
    if (produit.noAlert || produit.auto || produit.totalPoulet || produit.totalFromage || produit.totalGlace || produit.totalFrites) return null
    const initial = parseFloat(getStock(produit.id, 'initial')) || 0
    const entrees = parseFloat(getStock(produit.id, 'entrees')) || 0
    const sorties = parseFloat(getStock(produit.id, 'sorties')) || 0
    const final = getStock(produit.id, 'final')
    if (!final || final === '') return null
    return parseFloat(final) - (initial + entrees - sorties)
  }

  function totalFromageCalc() {
    const cat = CATEGORIES.find(c => c.nom === 'Fromage & Pizzas')
    return cat.produits.filter(p => p.fromage).reduce((sum, p) => {
      return sum + (parseFloat(getStock(p.id, 'sorties')) || 0) * p.fromage
    }, 0)
  }

  function totalPouletCalc() {
    const cat = CATEGORIES.find(c => c.nom === 'Poulet')
    return cat.produits.filter(p => !p.noAlert && !p.auto && !p.totalPoulet).reduce((sum, p) => {
      return sum + (parseFloat(getStock(p.id, 'sorties')) || 0)
    }, 0)
  }

  function totalBoulesCalc() {
    return (parseFloat(getStock('g1', 'sorties')) || 0) * 2
      + (parseFloat(getStock('g2', 'sorties')) || 0) * 3
  }

  function totalSachetsCalc() {
    return (parseFloat(getStock('fr1', 'sorties')) || 0) / 8
      + (parseFloat(getStock('fr2', 'sorties')) || 0) / 15
  }

  function ecartPouletTotal() {
    const initial = parseFloat(getStock('po8', 'initial')) || 0
    const entrees = parseFloat(getStock('po1', 'entrees')) || 0
    const final = getStock('po8', 'final')
    if (!final || final === '') return null
    return parseFloat(final) - (initial + entrees - totalPouletCalc())
  }

  function ecartFromageTotal() {
    const initial = parseFloat(getStock('f10', 'initial')) || 0
    const final = getStock('f10', 'final')
    if (!final || final === '') return null
    return parseFloat(final) - (initial - totalFromageCalc())
  }

  function ecartGlaceTotal() {
    const initial = parseFloat(getStock('g3', 'initial')) || 0
    const entrees = parseFloat(getStock('g3', 'entrees')) || 0
    const final = getStock('g3', 'final')
    if (!final || final === '') return null
    return parseFloat(final) - (initial + entrees - totalBoulesCalc() / 38)
  }

  function ecartSachetsTotal() {
    const initial = parseFloat(getStock('fr3', 'initial')) || 0
    const entrees = parseFloat(getStock('fr3', 'entrees')) || 0
    const final = getStock('fr3', 'final')
    if (!final || final === '') return null
    return parseFloat(final) - (initial + entrees - totalSachetsCalc())
  }

  function montantShift(shiftNumero) {
    const stocks = stocksParShift[shiftNumero] || {}
    let total = 0
    CATEGORIES.forEach(cat => {
      cat.produits.forEach(p => {
        if (p.prix === 0 || p.auto || p.noAlert || p.totalPoulet || p.totalFromage || p.totalGlace || p.totalFrites) return
        const s = stocks[p.id]
        if (!s || !s.final || s.final === '') return
        const initial = parseFloat(s.initial) || 0
        const entrees = parseFloat(s.entrees) || 0
        const sorties = parseFloat(s.sorties) || 0
        const final = parseFloat(s.final) || 0
        const ecart = final - (initial + entrees - sorties)
        if (Math.abs(ecart) > 0.01) total += Math.abs(ecart) * p.prix
      })
    })
    return total
  }

  function montantInventaireActif() {
    if (!shiftActif) return 0
    return montantShift(shiftActif.numero)
  }

  function montantTotalTousShifts() {
    return shifts.reduce((total, shift) => total + montantShift(shift.numero), 0)
  }

  function nbEcarts() {
    let count = 0
    CATEGORIES.forEach(cat => {
      cat.produits.forEach(p => {
        const e = calculEcart(p)
        if (e !== null && Math.abs(e) > 0.01) count++
      })
    })
    return count
  }

  function fmt(n) { return Number(n).toLocaleString('fr-FR') + ' FCFA' }

  // ─── Sauvegarde progressive ───────────────────────────────
  async function sauvegarderShift() {
    if (!pointId || !shiftActif) {
      Alert.alert('Erreur', 'Aucun point ou shift actif')
      return
    }
    setSaving(true)
    const stocks = stocksParShift[shiftActif.numero] || {}
    const ok = await saveInventaireShift(pointId, shiftActif, stocks, CATEGORIES)
    setSaving(false)
    if (ok) {
      Alert.alert('💾 Sauvegardé !', `${shiftActif.nom} sauvegardé.\nVous pouvez continuer plus tard ou reprendre depuis un autre compte.`)
    } else {
      Alert.alert('Erreur', "Impossible de sauvegarder")
    }
  }

  async function terminerShift() {
    if (!pointId || !shiftActif) {
      Alert.alert('Erreur', 'Aucun point ou shift actif')
      return
    }
    Alert.alert(
      'Terminer le shift',
      `Terminer ${shiftActif.nom} (${shiftActif.heure_debut} - ${shiftActif.heure_fin}) ?\nManquants : ${fmt(montantInventaireActif())}`,
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Confirmer', onPress: async () => {
          setSaving(true)
          const stocks = stocksParShift[shiftActif.numero] || {}
          const ok = await saveInventaireShift(pointId, shiftActif, stocks, CATEGORIES)
          setSaving(false)
          if (ok) {
            setShifts(prev => prev.map(s =>
              s.numero === shiftActif.numero ? { ...s, termine: true } : s
            ))
            Alert.alert('✅ Shift terminé !', `${shiftActif.nom} enregistré avec succès.`)
          } else {
            Alert.alert('Erreur', "Impossible d'enregistrer le shift")
          }
        }}
      ]
    )
  }

  async function terminerJournee() {
    Alert.alert(
      '🔒 Terminer la journée',
      `Terminer tous les inventaires du jour ?\nTotal manquants : ${fmt(montantTotalTousShifts())}\n\n⚠️ L'inventaire sera verrouillé définitivement.`,
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Confirmer', onPress: async () => {
          setSaving(true)
          if (shiftActif) {
            const stocks = stocksParShift[shiftActif.numero] || {}
            await saveInventaireShift(pointId, shiftActif, stocks, CATEGORIES)
          }
          setSaving(false)
          setInventaireTermine(true)
          Alert.alert('Succès', 'Inventaire de la journée terminé et verrouillé !')
          if (router.canGoBack()) router.back()
          else router.replace('/accueil')
        }}
      ]
    )
  }

  const catCourante = CATEGORIES.find(c => c.nom === catActive)

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
          <Text style={styles.headerTitre}>Inventaire</Text>
          <Text style={styles.headerSub}>
            {shiftActif
              ? `${shiftActif.nom} — ${shiftActif.heure_debut} à ${shiftActif.heure_fin}`
              : 'Aucun shift actif'}
          </Text>
        </View>
        <View style={styles.totalBadge}>
          <Text style={styles.totalBadgeTxt}>{fmt(montantInventaireActif())}</Text>
        </View>
      </View>

      {/* Barre des shifts */}
      <View style={styles.shiftBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
          {shifts.map(s => (
            <TouchableOpacity
              key={s.numero}
              style={[styles.shiftBtn, shiftActif?.numero === s.numero && styles.shiftBtnActive]}
              onPress={() => changerShift(s)}
            >
              <Text style={[styles.shiftTxt, shiftActif?.numero === s.numero && styles.shiftTxtActive]}>
                {s.termine ? '✅ ' : ''}{s.nom}
              </Text>
              <Text style={styles.shiftHeure}>{s.heure_debut}-{s.heure_fin}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <TouchableOpacity style={styles.addShiftBtn} onPress={() => setModalShift(true)}>
          <Text style={styles.addShiftTxt}>+ Shift</Text>
        </TouchableOpacity>
      </View>

      {shifts.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyIcon}>📦</Text>
          <Text style={styles.emptyTxt}>Aucun shift créé</Text>
          <Text style={styles.emptySub}>Appuyez sur "+ Shift" pour commencer</Text>
          <TouchableOpacity style={styles.createBtn} onPress={() => setModalShift(true)}>
            <Text style={styles.createTxt}>Créer le premier shift</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          {nbEcarts() > 0 && (
            <View style={styles.alertBanner}>
              <Text style={styles.alertTxt}>⚠️ {nbEcarts()} écart(s) détecté(s)</Text>
            </View>
          )}

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabs}>
            {CATEGORIES.map(cat => (
              <TouchableOpacity
                key={cat.nom}
                style={[styles.tab, catActive === cat.nom && styles.tabActive]}
                onPress={() => setCatActive(cat.nom)}
              >
                <Text style={[styles.tabTxt, catActive === cat.nom && styles.tabTxtActive]}>
                  {cat.nom}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
            {catCourante?.produits.map(produit => {
              const ecart = calculEcart(produit)
              const hasEcart = ecart !== null && Math.abs(ecart) > 0.01
              const isAuto = produit.auto
              const isTotal = produit.totalPoulet || produit.totalFromage || produit.totalGlace || produit.totalFrites

              let valeurAuto = ''
              if (produit.id === 'po7') valeurAuto = ((parseFloat(getStock('po1', 'entrees')) || 0) / 10).toFixed(2) + ' pâte'
              if (produit.id === 'b7') valeurAuto = ((parseFloat(getStock('b6', 'sorties')) || 0) / 10).toFixed(1) + ' Darina'
              if (produit.id === 'po8') {
                const e = ecartPouletTotal()
                valeurAuto = 'Sorties : ' + totalPouletCalc().toFixed(1) + (e !== null ? ' | Écart : ' + (e >= 0 ? '+' : '') + e.toFixed(1) : '')
              }
              if (produit.id === 'f10') {
                const e = ecartFromageTotal()
                valeurAuto = 'Sorties : ' + totalFromageCalc() + 'g' + (e !== null ? ' | Écart : ' + (e >= 0 ? '+' : '') + e.toFixed(0) + 'g' : '')
              }
              if (produit.id === 'g3') {
                const e = ecartGlaceTotal()
                valeurAuto = totalBoulesCalc() + ' boules (' + (totalBoulesCalc() / 38).toFixed(2) + ' pots)' + (e !== null ? ' | Écart : ' + (e >= 0 ? '+' : '') + e.toFixed(2) : '')
              }
              if (produit.id === 'fr3') {
                const e = ecartSachetsTotal()
                valeurAuto = totalSachetsCalc().toFixed(2) + ' sachets' + (e !== null ? ' | Écart : ' + (e >= 0 ? '+' : '') + e.toFixed(2) : '')
              }

              const totalEcart = produit.totalPoulet ? ecartPouletTotal() :
                produit.totalFromage ? ecartFromageTotal() :
                produit.totalGlace ? ecartGlaceTotal() :
                produit.totalFrites ? ecartSachetsTotal() : null
              const totalHasEcart = totalEcart !== null && Math.abs(totalEcart) > 0.01

              return (
                <View key={produit.id} style={[
                  styles.prodCard,
                  (hasEcart || totalHasEcart) && styles.prodCardAlert
                ]}>
                  <View style={styles.prodHeader}>
                    <Text style={[styles.prodNom, (hasEcart || totalHasEcart) && styles.prodNomAlert]}>
                      {produit.nom}
                    </Text>
                    {isAuto && <View style={styles.autoBadge}><Text style={styles.autoTxt}>auto</Text></View>}
                    {produit.noAlert && <View style={styles.normalBadge}><Text style={styles.normalTxt}>normal</Text></View>}
                    {produit.prix > 0 && !isTotal && (
                      <Text style={styles.prodPrix}>{produit.prix.toLocaleString()} F</Text>
                    )}
                  </View>

                  {isAuto ? (
                    <View style={styles.autoVal}>
                      <Text style={styles.autoValTxt}>{valeurAuto || '—'}</Text>
                    </View>
                  ) : isTotal ? (
                    <>
                      <View style={styles.autoVal}>
                        <Text style={styles.autoValTxt}>{valeurAuto || '—'}</Text>
                      </View>
                      {(produit.totalPoulet || produit.totalGlace) && (
                        <View style={styles.prodFields}>
                          <View style={styles.fieldBox}>
                            <Text style={styles.fieldLabel}>Initial</Text>
                            <TextInput
                              style={[styles.fieldInput, styles.fieldEdit]}
                              placeholder="0"
                              value={getStock(produit.id, 'initial')}
                              onChangeText={v => setStock(produit.id, 'initial', v)}
                              keyboardType="numeric"
                              placeholderTextColor="#ccc"
                            />
                          </View>
                          {produit.totalGlace && (
                            <View style={styles.fieldBox}>
                              <Text style={styles.fieldLabel}>Entrées</Text>
                              <TextInput
                                style={[styles.fieldInput, styles.fieldEdit]}
                                placeholder="0"
                                value={getStock(produit.id, 'entrees')}
                                onChangeText={v => setStock(produit.id, 'entrees', v)}
                                keyboardType="numeric"
                                placeholderTextColor="#ccc"
                              />
                            </View>
                          )}
                          <View style={styles.fieldBox}>
                            <Text style={styles.fieldLabel}>Stock final</Text>
                            <TextInput
                              style={[styles.fieldInput, styles.fieldEdit]}
                              placeholder="compter"
                              value={getStock(produit.id, 'final')}
                              onChangeText={v => setStock(produit.id, 'final', v)}
                              keyboardType="numeric"
                              placeholderTextColor="#ccc"
                            />
                          </View>
                        </View>
                      )}
                      {totalHasEcart && (
                        <TextInput
                          style={styles.explInput}
                          placeholder="Expliquez l'écart..."
                          value={explications[produit.id] || ''}
                          onChangeText={v => setExplications(prev => ({ ...prev, [produit.id]: v }))}
                          placeholderTextColor="#F09595"
                        />
                      )}
                    </>
                  ) : (
                    <>
                      <View style={styles.prodFields}>
                        <View style={styles.fieldBox}>
                          <Text style={styles.fieldLabel}>Initial</Text>
                          <TextInput
                            style={styles.fieldInput}
                            placeholder="0"
                            value={getStock(produit.id, 'initial')}
                            onChangeText={v => setStock(produit.id, 'initial', v)}
                            keyboardType="numeric"
                            placeholderTextColor="#ccc"
                          />
                        </View>
                        <View style={styles.fieldBox}>
                          <Text style={styles.fieldLabel}>Entrées</Text>
                          <TextInput
                            style={[styles.fieldInput, styles.fieldEdit]}
                            placeholder="0"
                            value={getStock(produit.id, 'entrees')}
                            onChangeText={v => setStock(produit.id, 'entrees', v)}
                            keyboardType="numeric"
                            placeholderTextColor="#ccc"
                          />
                        </View>
                        <View style={styles.fieldBox}>
                          <Text style={styles.fieldLabel}>Sorties</Text>
                          <TextInput
                            style={[styles.fieldInput, styles.fieldEdit]}
                            placeholder="0"
                            value={getStock(produit.id, 'sorties')}
                            onChangeText={v => setStock(produit.id, 'sorties', v)}
                            keyboardType="numeric"
                            placeholderTextColor="#ccc"
                          />
                        </View>
                        <View style={styles.fieldBox}>
                          <Text style={styles.fieldLabel}>Final</Text>
                          <TextInput
                            style={[styles.fieldInput, styles.fieldEdit]}
                            placeholder="compter"
                            value={getStock(produit.id, 'final')}
                            onChangeText={v => setStock(produit.id, 'final', v)}
                            keyboardType="numeric"
                            placeholderTextColor="#ccc"
                          />
                        </View>
                        <View style={styles.fieldBox}>
                          <Text style={styles.fieldLabel}>Écart</Text>
                          <Text style={[
                            styles.ecartVal,
                            ecart === null ? styles.ecartNull :
                            Math.abs(ecart) < 0.01 ? styles.ecartOk : styles.ecartAlert
                          ]}>
                            {ecart === null ? '—' : (ecart >= 0 ? '+' : '') + ecart.toFixed(1)}
                          </Text>
                        </View>
                      </View>
                      {hasEcart && !produit.noAlert && (
                        <TextInput
                          style={styles.explInput}
                          placeholder="Expliquez l'écart..."
                          value={explications[produit.id] || ''}
                          onChangeText={v => setExplications(prev => ({ ...prev, [produit.id]: v }))}
                          placeholderTextColor="#F09595"
                        />
                      )}
                    </>
                  )}
                </View>
              )
            })}

            {/* Prévisions */}
            <View style={styles.prevCard}>
              <Text style={styles.prevTitre}>📋 Prévisions prochain shift</Text>
              {catCourante?.produits
                .filter(p => !p.auto && !p.totalPoulet && !p.totalFromage && !p.totalGlace && !p.totalFrites && !p.noAlert)
                .map(p => (
                  <View key={p.id} style={styles.prevRow}>
                    <Text style={styles.prevNom}>{p.nom}</Text>
                    <TextInput
                      style={styles.prevInput}
                      placeholder="Qté"
                      value={getStock(p.id, 'prevision')}
                      onChangeText={v => setStock(p.id, 'prevision', v)}
                      keyboardType="numeric"
                      placeholderTextColor="#ccc"
                    />
                  </View>
                ))}
            </View>

            {/* Résumé tous shifts */}
            <View style={styles.resumeCard}>
              <Text style={styles.resumeTitre}>📊 Résumé journée</Text>
              {shifts.map(s => (
                <View key={s.numero} style={styles.resumeRow}>
                  <View>
                    <Text style={styles.resumeShiftNom}>
                      {s.termine ? '✅ ' : '⏳ '}{s.nom}
                    </Text>
                    <Text style={styles.resumeShiftHeure}>{s.heure_debut} → {s.heure_fin}</Text>
                  </View>
                  <Text style={[
                    styles.resumeShiftMontant,
                    { color: montantShift(s.numero) > 0 ? '#A32D2D' : '#3B6D11' }
                  ]}>
                    {fmt(montantShift(s.numero))}
                  </Text>
                </View>
              ))}
              {shifts.length > 1 && (
                <View style={styles.resumeTotalRow}>
                  <Text style={styles.resumeTotalLabel}>Total journée</Text>
                  <Text style={styles.resumeTotalVal}>{fmt(montantTotalTousShifts())}</Text>
                </View>
              )}
            </View>

            {/* Boutons */}
            <TouchableOpacity
              style={[styles.saveBtn, { backgroundColor: '#185FA5' }, saving && { opacity: 0.6 }]}
              onPress={sauvegarderShift}
              disabled={saving}
            >
              <Text style={[styles.saveTxt, { color: '#fff' }]}>
                💾 Sauvegarder (continuer plus tard)
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.saveBtn, { backgroundColor: '#EF9F27', marginTop: 8 }, saving && { opacity: 0.6 }]}
              onPress={terminerShift}
              disabled={saving}
            >
              <Text style={styles.saveTxt}>✅ Terminer ce shift</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.saveBtn, { backgroundColor: '#A32D2D', marginTop: 8 }]}
              onPress={terminerJournee}
            >
              <Text style={[styles.saveTxt, { color: '#fff' }]}>🔒 Terminer la journée</Text>
            </TouchableOpacity>

            <View style={{ height: 40 }} />
          </ScrollView>
        </>
      )}

      {/* Modal nouveau shift */}
      <Modal visible={modalShift} transparent animationType="slide">
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.modalOverlay}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
              <View style={styles.modal}>
                <Text style={styles.modalTitre}>Nouveau shift</Text>

                <Text style={styles.modalLabel}>Nom du shift (optionnel)</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder={`Shift ${shifts.length + 1}`}
                  value={formShift.nom}
                  onChangeText={v => setFormShift(p => ({ ...p, nom: v }))}
                  placeholderTextColor="#bbb"
                />

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
                  returnKeyType="done"
                  onSubmitEditing={Keyboard.dismiss}
                />

                <View style={styles.modalBtns}>
                  <TouchableOpacity style={styles.modalCancel} onPress={() => setModalShift(false)}>
                    <Text style={styles.modalCancelTxt}>Annuler</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.modalConfirm} onPress={ajouterShift}>
                    <Text style={styles.modalConfirmTxt}>Créer le shift</Text>
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
  header: { backgroundColor: '#EF9F27', padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: { fontSize: 16, color: '#412402', fontWeight: '500' },
  headerTitre: { fontSize: 16, fontWeight: '600', color: '#412402', textAlign: 'center' },
  headerSub: { fontSize: 10, color: '#854F0B', textAlign: 'center' },
  totalBadge: { backgroundColor: '#BA7517', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  totalBadgeTxt: { fontSize: 10, color: '#FAEEDA', fontWeight: '500' },
  shiftBar: { backgroundColor: '#fff', flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#eee', maxHeight: 56 },
  shiftBtn: { paddingHorizontal: 14, paddingVertical: 8, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  shiftBtnActive: { borderBottomColor: '#EF9F27' },
  shiftTxt: { fontSize: 12, color: '#888' },
  shiftTxtActive: { color: '#EF9F27', fontWeight: '600' },
  shiftHeure: { fontSize: 9, color: '#bbb', marginTop: 2 },
  addShiftBtn: { paddingHorizontal: 14, paddingVertical: 8, justifyContent: 'center', borderLeftWidth: 0.5, borderLeftColor: '#eee' },
  addShiftTxt: { fontSize: 12, color: '#EF9F27', fontWeight: '600' },
  emptyBox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyTxt: { fontSize: 16, fontWeight: '600', color: '#888', marginBottom: 8 },
  emptySub: { fontSize: 13, color: '#bbb', marginBottom: 24, textAlign: 'center' },
  createBtn: { backgroundColor: '#EF9F27', borderRadius: 14, paddingHorizontal: 24, paddingVertical: 14 },
  createTxt: { fontSize: 15, fontWeight: '600', color: '#412402' },
  alertBanner: { backgroundColor: '#FAECE7', padding: 10, alignItems: 'center', borderBottomWidth: 0.5, borderBottomColor: '#F5C4B3' },
  alertTxt: { fontSize: 12, color: '#993C1D', fontWeight: '500' },
  tabs: { backgroundColor: '#fff', borderBottomWidth: 0.5, borderBottomColor: '#eee', maxHeight: 46 },
  tab: { paddingHorizontal: 14, paddingVertical: 12 },
  tabActive: { borderBottomWidth: 2, borderBottomColor: '#EF9F27' },
  tabTxt: { fontSize: 12, color: '#888' },
  tabTxtActive: { color: '#EF9F27', fontWeight: '600' },
  body: { flex: 1, padding: 12 },
  prodCard: { backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 0.5, borderColor: '#eee' },
  prodCardAlert: { borderColor: '#F09595', backgroundColor: '#FCEBEB' },
  prodHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  prodNom: { fontSize: 13, fontWeight: '600', color: '#1a1a1a', flex: 1 },
  prodNomAlert: { color: '#A32D2D' },
  prodPrix: { fontSize: 10, color: '#888' },
  autoBadge: { backgroundColor: '#E6F1FB', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10 },
  autoTxt: { fontSize: 9, color: '#185FA5' },
  normalBadge: { backgroundColor: '#EAF3DE', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10 },
  normalTxt: { fontSize: 9, color: '#3B6D11' },
  autoVal: { backgroundColor: '#f5f5f5', borderRadius: 8, padding: 10, marginBottom: 8 },
  autoValTxt: { fontSize: 12, fontWeight: '500', color: '#185FA5', textAlign: 'center' },
  prodFields: { flexDirection: 'row', gap: 4, marginTop: 4 },
  fieldBox: { flex: 1, alignItems: 'center' },
  fieldLabel: { fontSize: 9, color: '#888', marginBottom: 4 },
  fieldInput: { width: '100%', backgroundColor: '#f5f5f5', borderRadius: 6, padding: 6, fontSize: 12, textAlign: 'center', color: '#1a1a1a' },
  fieldEdit: { backgroundColor: '#FAEEDA', color: '#412402' },
  ecartVal: { fontSize: 13, fontWeight: '600', marginTop: 6 },
  ecartNull: { color: '#ccc' },
  ecartOk: { color: '#3B6D11' },
  ecartAlert: { color: '#A32D2D' },
  explInput: { marginTop: 8, backgroundColor: '#FCEBEB', borderRadius: 8, padding: 10, fontSize: 12, color: '#A32D2D', borderWidth: 0.5, borderColor: '#F09595' },
  prevCard: { backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 0.5, borderColor: '#eee' },
  prevTitre: { fontSize: 13, fontWeight: '600', color: '#1a1a1a', marginBottom: 10 },
  prevRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 0.5, borderBottomColor: '#f0f0f0' },
  prevNom: { fontSize: 12, color: '#555', flex: 1 },
  prevInput: { width: 70, backgroundColor: '#f5f5f5', borderRadius: 6, padding: 6, fontSize: 12, textAlign: 'center', color: '#1a1a1a' },
  resumeCard: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: 0.5, borderColor: '#eee' },
  resumeTitre: { fontSize: 13, fontWeight: '600', color: '#1a1a1a', marginBottom: 12 },
  resumeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: '#f5f5f5' },
  resumeShiftNom: { fontSize: 13, fontWeight: '500', color: '#1a1a1a' },
  resumeShiftHeure: { fontSize: 10, color: '#888', marginTop: 2 },
  resumeShiftMontant: { fontSize: 14, fontWeight: '600' },
  resumeTotalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 10, marginTop: 4 },
  resumeTotalLabel: { fontSize: 14, fontWeight: '600', color: '#1a1a1a' },
  resumeTotalVal: { fontSize: 16, fontWeight: '600', color: '#A32D2D' },
  saveBtn: { borderRadius: 14, padding: 16, alignItems: 'center', marginBottom: 4 },
  saveTxt: { fontSize: 15, fontWeight: '600', color: '#412402' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  modal: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 },
  modalTitre: { fontSize: 18, fontWeight: '600', color: '#1a1a1a', marginBottom: 20 },
  modalLabel: { fontSize: 11, fontWeight: '600', color: '#888', letterSpacing: 0.5, marginBottom: 6, textTransform: 'uppercase' },
  modalInput: { backgroundColor: '#f5f5f5', borderRadius: 12, padding: 14, fontSize: 15, color: '#1a1a1a', marginBottom: 14 },
  modalBtns: { flexDirection: 'row', gap: 10, marginTop: 6 },
  modalCancel: { flex: 1, padding: 14, borderRadius: 12, backgroundColor: '#f5f5f5', alignItems: 'center' },
  modalCancelTxt: { fontSize: 14, color: '#888' },
  modalConfirm: { flex: 2, padding: 14, borderRadius: 12, backgroundColor: '#EF9F27', alignItems: 'center' },
  modalConfirmTxt: { fontSize: 14, fontWeight: '600', color: '#412402' },
})