import { router } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import {
  Modal, SafeAreaView, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View
} from 'react-native'
import { useApp } from '../context/AppContext'
import { useTheme } from '../context/ThemeContext'
import { CATEGORIES_INVENTAIRE as CATEGORIES } from '../lib/constants'
import { supabase } from '../lib/supabase'

const TYPES_SHIFTS = [
  { id: 'matin',       label: '🌅 Shift Matin',  debut: '08:00', fin: '16:00' },
  { id: 'soir',        label: '🌆 Shift Soir',   debut: '16:00', fin: '00:00' },
  { id: 'nuit',        label: '🌙 Shift Nuit',   debut: '00:00', fin: '08:00' },
  { id: 'double',      label: '🔄 Shift Double', debut: '12:00', fin: '20:00' },
]

// IDs exclus du rendu produit standard (gérés dans leurs sections dédiées)
const EXCLUS = new Set([
  'po1','po2','po3','po4','po5','po6','po7','po8',
  'f2','f3','f4','f5','f6','f7','f8','f9','f10',
  'fr1','fr2','fr3',
  'g1','g2','g3',
  'b7',
])

// Produits sélectionnables pour une entrée fournisseur
const PRODUITS_ENTREE = CATEGORIES.flatMap(cat =>
  cat.produits.filter(p => {
    if (p.auto) return false
    if (p.totalPoulet) return false
    if (['po2','po3','po4','po5','po6'].includes(p.id)) return false
    if (p.id === 'f1') return false
    if (p.fromage) return false
    if (['fr1','fr2'].includes(p.id)) return false
    if (['g1','g2'].includes(p.id)) return false
    return true
  }).map(p => ({ ...p, categorie: cat.nom }))
)
const CATS_ENTREE = [...new Set(PRODUITS_ENTREE.map(p => p.categorie))]

export default function InventaireScreen() {
  const { pointId, dateJour, restaurantId, userId, roleActif, setInventaireTermine } = useApp()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])

  // Étape 1 : sélection shift
  const [selectedShift, setSelectedShift] = useState(null)
  const [heureDebut, setHeureDebut] = useState('')
  const [heureFin, setHeureFin] = useState('')

  // Inventaire en cours
  const [inventaireId, setInventaireId] = useState(null)
  const [isValide, setIsValide] = useState(false)
  const [loading, setLoading] = useState(false)

  // Données inventaire
  const [stocksInitiaux, setStocksInitiaux] = useState({})
  // stocks[id] = { sorties: '', stockReel: '' }
  const [stocks, setStocks] = useState({})
  // entrees[id] = nombre total reçu dans ce shift
  const [entrees, setEntrees] = useState({})
  const [entreesList, setEntreesList] = useState([])
  // explications[key] = { nombre: '', texte: '' }
  const [explications, setExplications] = useState({})

  // UI
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState(null)
  const [confirmValider, setConfirmValider] = useState(false)
  const [catActive, setCatActive] = useState(CATEGORIES[0]?.nom || '')
  const [fournisseursListe, setFournisseursListe] = useState([])

  // Modal entrée
  const [showEntreeModal, setShowEntreeModal] = useState(false)
  const [entreeMode, setEntreeMode] = useState('reception')
  const [entreeFournisseurId, setEntreeFournisseurId] = useState(null)
  const [catEntree, setCatEntree] = useState(CATS_ENTREE[0] || '')
  const [qtesEntree, setQtesEntree] = useState({})
  const [savingEntree, setSavingEntree] = useState(false)
  const [entreeMsg, setEntreeMsg] = useState(null)

  useEffect(() => {
    if (restaurantId) {
      supabase.from('fournisseurs').select('id, nom')
        .eq('restaurant_id', restaurantId).eq('actif', true).order('nom')
        .then(({ data }) => setFournisseursListe(data || []))
    }
  }, [restaurantId])

  useEffect(() => {
    if (selectedShift && pointId) chargerOuCreer(selectedShift)
  }, [selectedShift, pointId])

  // ─── CHARGEMENT ──────────────────────────────────────────────────────────────
  async function chargerOuCreer(shift) {
    setLoading(true)
    setSaveMsg(null)
    try {
      const { data: existant } = await supabase
        .from('inventaires_shifts')
        .select('id, valide')
        .eq('point_id', pointId)
        .eq('caissier_id', userId)
        .eq('type_shift', shift.id)
        .maybeSingle()

      if (existant) {
        setInventaireId(existant.id)
        setIsValide(existant.valide || false)
        const hasLines = await chargerLignes(existant.id)
        if (!hasLines) await chargerStockInitial(existant.id)
        if (existant.valide) setInventaireTermine(true)
      } else {
        const { data: nouveau, error } = await supabase
          .from('inventaires_shifts')
          .insert({
            point_id: pointId,
            caissier_id: userId,
            restaurant_id: restaurantId,
            date: dateJour,
            type_shift: shift.id,
            heure_debut: shift.debut || null,
            heure_fin: shift.fin || null,
          })
          .select('id').single()

        if (error) throw new Error(error.message)
        setInventaireId(nouveau.id)
        setIsValide(false)
        await chargerStockInitial(nouveau.id)
      }
    } catch (e) {
      setSaveMsg('❌ ' + (e.message || 'Erreur chargement'))
    } finally {
      setLoading(false)
    }
  }

  async function chargerLignes(invId) {
    const [{ data: lignes }, { data: entreesData }] = await Promise.all([
      supabase.from('inventaire_lignes').select('*').eq('inventaire_id', invId),
      supabase.from('entrees_shift').select('*').eq('inventaire_id', invId),
    ])

    const initials = {}, newStocks = {}, newExpls = {}
    ;(lignes || []).forEach(l => {
      initials[l.produit_id] = l.stock_initial ?? 0
      newStocks[l.produit_id] = {
        sorties: l.sorties != null ? String(l.sorties) : '',
        stockReel: l.stock_reel != null ? String(l.stock_reel) : '',
        // Pour Darina : entrées stockées dans inventaire_lignes.entrees
        ...(l.produit_id === 'b7' && { entrees: l.entrees != null ? String(l.entrees) : '' }),
      }
      if (l.nombre_explique != null || l.explication) {
        newExpls[l.produit_id] = {
          nombre: l.nombre_explique != null ? String(l.nombre_explique) : '',
          texte: l.explication || '',
        }
      }
    })
    setStocksInitiaux(initials)
    setStocks(newStocks)
    setExplications(newExpls)

    const totEnt = {}
    ;(entreesData || []).forEach(e => {
      totEnt[e.produit_id] = (totEnt[e.produit_id] || 0) + (parseFloat(e.quantite) || 0)
    })
    setEntrees(totEnt)
    setEntreesList(entreesData || [])

    return (lignes || []).length > 0
  }

  async function chargerStockInitial(idActuel = null) {
    if (!restaurantId) return

    // Chercher les derniers shifts de ce restaurant (toute date), excluant l'actuel
    let query = supabase
      .from('inventaires_shifts')
      .select('id, inventaire_lignes(produit_id, stock_reel)')
      .eq('restaurant_id', restaurantId)
      .order('created_at', { ascending: false })
      .limit(10)
    if (idActuel) query = query.neq('id', idActuel)

    const { data: allShifts } = await query

    // Prendre le premier shift qui a au moins une ligne avec stock_reel renseigné
    const found = (allShifts || []).find(s =>
      s.inventaire_lignes && s.inventaire_lignes.some(l => l.stock_reel != null)
    )

    if (found) {
      const init = {}
      ;(found.inventaire_lignes || []).forEach(l => { if (l.stock_reel != null) init[l.produit_id] = l.stock_reel })
      setStocksInitiaux(init)
      return
    }

    // Fallback ancien format : chercher dans les points récents de ce restaurant
    const { data: ancienPoints } = await supabase
      .from('points').select('id')
      .eq('restaurant_id', restaurantId)
      .order('date', { ascending: false }).limit(7)

    for (const pt of (ancienPoints || [])) {
      const { data: lignes } = await supabase
        .from('inventaires').select('produit_id, stock_final')
        .eq('point_id', pt.id).not('stock_final', 'is', null)
      if (lignes && lignes.length > 0) {
        const init = {}
        lignes.forEach(l => { if (l.stock_final != null) init[l.produit_id] = l.stock_final })
        setStocksInitiaux(init)
        return
      }
    }
  }

  // ─── HELPERS ─────────────────────────────────────────────────────────────────
  function getInit(id) { return parseFloat(stocksInitiaux[id] ?? 0) || 0 }
  function getSort(id) { return parseFloat(stocks[id]?.sorties || '') || 0 }
  function getReel(id) { return stocks[id]?.stockReel ?? '' }
  function getEnt(id)  { return parseFloat(entrees[id] || '') || 0 }
  function setField(id, champ, v) {
    setStocks(prev => ({ ...prev, [id]: { ...prev[id], [champ]: v } }))
  }

  // ─── CALCULS SPÉCIAUX ────────────────────────────────────────────────────────
  // Poulet
  function pouletInit()   { return getInit('po8') }
  function pouletEnt()    { return getEnt('po1') }
  function pouletSort()   { return ['po2','po3','po4','po5','po6'].reduce((s,id) => s + getSort(id), 0) }
  function pouletTh()     { return pouletInit() + pouletEnt() - pouletSort() }
  function pouletReel()   { const r = getReel('po8'); return r !== '' ? parseFloat(r) || 0 : null }
  function ecartPoulet()  { const r = pouletReel(); return r == null ? null : r - pouletTh() }
  function oblgPoulet()   { return pouletInit() > 0 || pouletEnt() > 0 }

  // Fromage
  const catFromage = CATEGORIES.find(c => c.nom === 'Fromage & Pizzas')
  function fromageInit()  { return getInit('f10') }
  function fromageEnt()   { return getEnt('f10') }
  function fromageSort()  {
    return catFromage.produits.filter(p => p.fromage)
      .reduce((s, p) => s + getSort(p.id) * p.fromage, 0)
  }
  function fromageTh()    { return fromageInit() + fromageEnt() - fromageSort() }
  function ecartFromage() { const r = getReel('f10'); return r === '' ? null : parseFloat(r) - fromageTh() }
  function oblgFromage()  { return fromageInit() > 0 || fromageEnt() > 0 }

  // Glace
  function totalBoules()  { return getSort('g1') * 2 + getSort('g2') * 3 }
  function glaceEnt()     { return getEnt('g3') }
  function glaceTh()      { return getInit('g3') + glaceEnt() - totalBoules() / 38 }
  function ecartGlace()   { const r = getReel('g3'); return r === '' ? null : parseFloat(r) - glaceTh() }
  function oblgGlace()    { return getInit('g3') > 0 || glaceEnt() > 0 }

  // Frites
  function totalSachets() { return getSort('fr1') / 8 + getSort('fr2') / 15 }
  function fritesEnt()    { return getEnt('fr3') }
  function fritesTh()     { return getInit('fr3') + fritesEnt() - totalSachets() }
  function ecartFrites()  { const r = getReel('fr3'); return r === '' ? null : parseFloat(r) - fritesTh() }
  function oblgFrites()   { return getInit('fr3') > 0 || fritesEnt() > 0 }

  // Darina (b7) — sorties = Pot Fresco (b6), entrées saisies manuellement
  function darinaSort() { return getSort('b6') }
  function darinaEnt()  { return parseFloat(stocks['b7']?.entrees || '') || 0 }
  function darinaTh()   { return getInit('b7') + darinaEnt() - darinaSort() }
  function ecartDarina() { const r = getReel('b7'); return r === '' ? null : parseFloat(r) - darinaTh() }
  function oblgDarina()  { return getInit('b7') > 0 || darinaEnt() > 0 || darinaSort() > 0 }

  // Produit générique
  function ecartProduit(id) {
    const r = getReel(id)
    if (r === '') return null
    return parseFloat(r) - (getInit(id) + getEnt(id) - getSort(id))
  }
  function oblgProduit(id) { return getInit(id) > 0 || getEnt(id) > 0 }

  // Montant déduit pour un écart
  function montantDeduit(ecartVal, prix, key) {
    if (ecartVal == null || Math.abs(ecartVal) < 0.01) return 0
    const nb = parseFloat(explications[key]?.nombre || '') || 0
    const diff = Math.max(0, Math.abs(ecartVal) - nb)
    return Math.round(diff * (prix || 0))
  }

  function totalMontant() {
    let t = 0
    const eP = ecartPoulet(); if (eP !== null) t += montantDeduit(eP, 8000, 'po_total')
    const eF = ecartFromage(); if (eF !== null) t += montantDeduit(eF, 5, 'f_total')
    const eG = ecartGlace();  if (eG !== null) t += montantDeduit(eG, 6000, 'g3')
    const eFr = ecartFrites(); if (eFr !== null) t += montantDeduit(eFr, 2500, 'fr3')
    CATEGORIES.forEach(cat => cat.produits.forEach(p => {
      if (EXCLUS.has(p.id) || p.auto || p.noAlert || p.boules) return
      const e = ecartProduit(p.id)
      if (e !== null) t += montantDeduit(e, p.prix || 0, p.id)
    }))
    return t
  }

  function nbEcarts() {
    let n = 0
    const specials = [ecartPoulet(), ecartFromage(), ecartGlace(), ecartFrites()]
    specials.forEach(e => { if (e !== null && Math.abs(e) > 0.01) n++ })
    CATEGORIES.forEach(cat => cat.produits.forEach(p => {
      if (EXCLUS.has(p.id) || p.auto || p.noAlert || p.boules) return
      const e = ecartProduit(p.id)
      if (e !== null && Math.abs(e) > 0.01) n++
    }))
    return n
  }

  function prodsMandatairesManquants() {
    const m = []
    if (oblgPoulet()  && getReel('po8') === '') m.push('Total Poulet')
    if (oblgFromage() && getReel('f10') === '')  m.push('Total Fromage')
    if (oblgGlace()   && getReel('g3')  === '')  m.push('Pot de glace')
    if (oblgFrites()  && getReel('fr3') === '')  m.push('Sachets frites')
    CATEGORIES.forEach(cat => cat.produits.forEach(p => {
      if (EXCLUS.has(p.id) || p.auto || p.noAlert || p.fromage || p.boules) return
      if (oblgProduit(p.id) && getReel(p.id) === '') m.push(p.nom)
    }))
    return m
  }

  // ─── SAUVEGARDE ──────────────────────────────────────────────────────────────
  async function sauvegarder(valider = false) {
    if (!inventaireId) { setSaveMsg('❌ Aucun inventaire actif'); return }
    setSaving(true)
    setSaveMsg(null)
    try {
      if (valider) {
        const manquants = prodsMandatairesManquants()
        if (manquants.length > 0) {
          setSaveMsg(`❌ Produits manquants : ${manquants.slice(0,3).join(', ')}${manquants.length > 3 ? '…' : ''}`)
          setSaving(false)
          return
        }
      }

      await supabase.from('inventaire_lignes').delete().eq('inventaire_id', inventaireId)
      const lignes = []

      // Poulet (po8 + formes)
      if (pouletInit() > 0 || getReel('po8') !== '' || pouletSort() > 0) {
        const eP = ecartPoulet() ?? 0
        lignes.push({
          inventaire_id: inventaireId, produit_id: 'po8', produit_nom: 'Total poulet',
          stock_initial: pouletInit(), entrees: pouletEnt(), sorties: pouletSort(),
          stock_reel: pouletReel(), ecart: eP,
          nombre_explique: parseFloat(explications['po_total']?.nombre) || null,
          explication: explications['po_total']?.texte || null,
          montant_deduit: montantDeduit(eP, 8000, 'po_total'),
        })
        ;[['po2','Pané'],['po3','Rôti'],['po4','Braisé'],['po5','Désossé'],['po6','Cuisses']].forEach(([id, nom]) => {
          if (getSort(id) > 0) lignes.push({ inventaire_id: inventaireId, produit_id: id, produit_nom: nom,
            stock_initial: 0, entrees: 0, sorties: getSort(id), stock_reel: null, ecart: 0, montant_deduit: 0 })
        })
      }

      // Fromage (f10 + formes)
      if (fromageInit() > 0 || getReel('f10') !== '' || fromageSort() > 0) {
        const eF = ecartFromage() ?? 0
        lignes.push({
          inventaire_id: inventaireId, produit_id: 'f10', produit_nom: 'Total Fromage (g)',
          stock_initial: fromageInit(), entrees: fromageEnt(), sorties: fromageSort(),
          stock_reel: getReel('f10') !== '' ? parseFloat(getReel('f10')) : null,
          ecart: eF,
          nombre_explique: parseFloat(explications['f_total']?.nombre) || null,
          explication: explications['f_total']?.texte || null,
          montant_deduit: montantDeduit(eF, 5, 'f_total'),
        })
        catFromage.produits.filter(p => p.fromage).forEach(p => {
          if (getSort(p.id) > 0) lignes.push({ inventaire_id: inventaireId, produit_id: p.id, produit_nom: p.nom,
            stock_initial: 0, entrees: 0, sorties: getSort(p.id), stock_reel: null, ecart: 0, montant_deduit: 0 })
        })
      }

      // Frites
      if (getInit('fr3') > 0 || getReel('fr3') !== '' || getSort('fr1') > 0 || getSort('fr2') > 0) {
        const eFr = ecartFrites() ?? 0
        lignes.push({
          inventaire_id: inventaireId, produit_id: 'fr3', produit_nom: 'Sachet de frites',
          stock_initial: getInit('fr3'), entrees: fritesEnt(),
          sorties: parseFloat(totalSachets().toFixed(4)),
          stock_reel: getReel('fr3') !== '' ? parseFloat(getReel('fr3')) : null,
          ecart: eFr,
          nombre_explique: parseFloat(explications['fr3']?.nombre) || null,
          explication: explications['fr3']?.texte || null,
          montant_deduit: montantDeduit(eFr, 2500, 'fr3'),
        })
        ;[['fr1','Portions de frites'],['fr2','Tacos vendus']].forEach(([id, nom]) => {
          if (getSort(id) > 0) lignes.push({ inventaire_id: inventaireId, produit_id: id, produit_nom: nom,
            stock_initial: 0, entrees: 0, sorties: getSort(id), stock_reel: null, ecart: 0, montant_deduit: 0 })
        })
      }

      // Glace
      if (getInit('g3') > 0 || getReel('g3') !== '' || totalBoules() > 0) {
        const eG = ecartGlace() ?? 0
        lignes.push({
          inventaire_id: inventaireId, produit_id: 'g3', produit_nom: 'Pot de glace',
          stock_initial: getInit('g3'), entrees: glaceEnt(),
          sorties: parseFloat((totalBoules() / 38).toFixed(4)),
          stock_reel: getReel('g3') !== '' ? parseFloat(getReel('g3')) : null,
          ecart: eG,
          nombre_explique: parseFloat(explications['g3']?.nombre) || null,
          explication: explications['g3']?.texte || null,
          montant_deduit: montantDeduit(eG, 6000, 'g3'),
        })
        ;[['g1','Glace 2 boules'],['g2','Milkshake/Spéciale']].forEach(([id, nom]) => {
          if (getSort(id) > 0) lignes.push({ inventaire_id: inventaireId, produit_id: id, produit_nom: nom,
            stock_initial: 0, entrees: 0, sorties: getSort(id), stock_reel: null, ecart: 0, montant_deduit: 0 })
        })
      }

      // Produits standard
      CATEGORIES.forEach(cat => cat.produits.forEach(p => {
        if (EXCLUS.has(p.id) || p.auto) return
        const init = getInit(p.id), sort = getSort(p.id), reel = getReel(p.id), ent = getEnt(p.id)
        if (init === 0 && sort === 0 && reel === '') return
        const e = ecartProduit(p.id) ?? 0
        lignes.push({
          inventaire_id: inventaireId, produit_id: p.id, produit_nom: p.nom,
          stock_initial: init, entrees: ent, sorties: sort,
          stock_reel: reel !== '' ? parseFloat(reel) : null,
          ecart: e,
          nombre_explique: parseFloat(explications[p.id]?.nombre) || null,
          explication: explications[p.id]?.texte || null,
          montant_deduit: montantDeduit(e, p.prix || 0, p.id),
        })
      }))

      // Darina (b7) — sorties auto depuis Pot Fresco
      const dInit = getInit('b7'), dEnt = darinaEnt(), dSort = darinaSort()
      const dReel = getReel('b7') !== '' ? parseFloat(getReel('b7')) : null
      if (dInit > 0 || dEnt > 0 || dSort > 0 || dReel !== null) {
        const eD = dReel != null ? dReel - darinaTh() : 0
        lignes.push({
          inventaire_id: inventaireId, produit_id: 'b7', produit_nom: 'Darina',
          stock_initial: dInit, entrees: dEnt, sorties: dSort,
          stock_reel: dReel, ecart: eD, montant_deduit: 0,
        })
      }

      if (lignes.length > 0) {
        const { error } = await supabase.from('inventaire_lignes').insert(lignes)
        if (error) throw new Error(error.message)
      }

      const montant = totalMontant()
      await supabase.from('inventaires_shifts').update({ montant_a_deduire: montant }).eq('id', inventaireId)

      if (valider) {
        const { error } = await supabase.from('inventaires_shifts')
          .update({ valide: true, montant_a_deduire: montant }).eq('id', inventaireId)
        if (error) throw new Error(error.message)

        // Accumuler dans points.montant_inventaire (silencieux si colonne absente)
        supabase.from('points').select('montant_inventaire').eq('id', pointId).single()
          .then(({ data: pt }) => {
            if (pt && 'montant_inventaire' in pt) {
              const ancien = parseFloat(pt.montant_inventaire || 0)
              supabase.from('points').update({ montant_inventaire: ancien + montant }).eq('id', pointId)
            }
          }).catch(() => {})

        setIsValide(true)
        setInventaireTermine(true)
        setConfirmValider(false)
        if (router.canGoBack()) router.back()
        else router.replace('/accueil')
      } else {
        setSaveMsg('ok')
        setTimeout(() => setSaveMsg(null), 3000)
      }
    } catch (e) {
      setSaveMsg('❌ ' + (e.message || 'Erreur inconnue'))
    } finally {
      setSaving(false)
    }
  }

  // ─── AJOUTER ENTRÉE ──────────────────────────────────────────────────────────
  async function ajouterEntrees() {
    if (!entreeFournisseurId) { setEntreeMsg('❌ Fournisseur obligatoire'); return }
    const lignes = Object.entries(qtesEntree).filter(([, v]) => parseFloat(v) > 0)
    if (lignes.length === 0) { setEntreeMsg('❌ Aucune quantité saisie'); return }

    const fourn = fournisseursListe.find(f => f.id === entreeFournisseurId)
    setSavingEntree(true)
    const rows = lignes.map(([prodId, qte]) => {
      const prod = PRODUITS_ENTREE.find(p => p.id === prodId)
      return {
        inventaire_id: inventaireId,
        fournisseur_id: entreeFournisseurId, fournisseur_nom: fourn?.nom || null,
        produit_id: prodId, produit_nom: prod?.nom || prodId,
        quantite: parseFloat(qte), source: entreeMode,
      }
    })
    const { error } = await supabase.from('entrees_shift').insert(rows)
    setSavingEntree(false)

    if (error) { setEntreeMsg('❌ ' + error.message); return }

    const { data: nouvellesEntrees } = await supabase
      .from('entrees_shift').select('*').eq('inventaire_id', inventaireId)
    const totEnt = {}
    ;(nouvellesEntrees || []).forEach(e => {
      totEnt[e.produit_id] = (totEnt[e.produit_id] || 0) + (parseFloat(e.quantite) || 0)
    })
    setEntrees(totEnt)
    setEntreesList(nouvellesEntrees || [])
    setQtesEntree({})
    setEntreeFournisseurId(null)
    setEntreeMsg('ok')
    setTimeout(() => { setEntreeMsg(null); setShowEntreeModal(false) }, 1200)
  }

  // ─── ÉCRAN SÉLECTION SHIFT ───────────────────────────────────────────────────
  if (!selectedShift) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.back}>‹ Retour</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitre}>📦 Inventaire</Text>
          <View style={{ width: 60 }} />
        </View>
        <ScrollView style={styles.body} contentContainerStyle={{ padding: 20 }}>
          <View style={styles.shiftCard}>
            <Text style={styles.shiftQuestion}>Pour quel shift faites-vous votre inventaire ?</Text>
            {TYPES_SHIFTS.map(s => (
              <TouchableOpacity key={s.id} style={styles.shiftBtn}
                onPress={() => setSelectedShift(s)}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.shiftBtnLabel}>{s.label}</Text>
                  <Text style={styles.shiftBtnHeure}>{s.debut} → {s.fin}</Text>
                </View>
                <Text style={styles.shiftArrow}>›</Text>
              </TouchableOpacity>
            ))}

            <View style={styles.shiftPersonnalise}>
              <Text style={styles.shiftPersonnaliseLabel}>✏️ Shift personnalisé</Text>
              <View style={styles.shiftHeureRow}>
                <TextInput style={styles.shiftHeureInput} placeholder="Début ex: 09:00"
                  value={heureDebut} onChangeText={setHeureDebut} placeholderTextColor="#ccc" />
                <Text style={styles.shiftHeureSep}>→</Text>
                <TextInput style={styles.shiftHeureInput} placeholder="Fin ex: 17:00"
                  value={heureFin} onChangeText={setHeureFin} placeholderTextColor="#ccc" />
              </View>
              <TouchableOpacity style={[styles.shiftBtn, { marginTop: 8 }]}
                onPress={() => {
                  if (heureDebut && heureFin)
                    setSelectedShift({ id: 'personnalise', label: '✏️ Personnalisé', debut: heureDebut, fin: heureFin })
                }}>
                <Text style={styles.shiftBtnLabel}>Confirmer ce shift</Text>
                <Text style={styles.shiftArrow}>›</Text>
              </TouchableOpacity>
            </View>
          </View>
          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>
    )
  }

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <Text style={{ color: colors.textMuted, fontSize: 15 }}>Chargement inventaire…</Text>
      </SafeAreaView>
    )
  }

  // ─── ÉCRAN INVENTAIRE ─────────────────────────────────────────────────────────
  const manquants = prodsMandatairesManquants()
  const montant = totalMontant()
  const nEcarts = nbEcarts()

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => {
          if (router.canGoBack()) router.back()
          else router.replace('/accueil')
        }}>
          <Text style={styles.back}>‹ Retour</Text>
        </TouchableOpacity>
        <View style={{ alignItems: 'center' }}>
          <Text style={styles.headerTitre}>Inventaire</Text>
          <Text style={styles.headerSub}>{selectedShift.label} · {selectedShift.debut}→{selectedShift.fin}</Text>
        </View>
        <View style={styles.totalBadge}>
          <Text style={styles.totalBadgeTxt}>
            {isValide ? '🔒' : nEcarts > 0 ? `⚠️${nEcarts}` : '✅'}
          </Text>
        </View>
      </View>

      {isValide && (
        <View style={styles.valideBanner}>
          <Text style={styles.valideBannerTxt}>🔒 Inventaire validé — lecture seule</Text>
        </View>
      )}
      {nEcarts > 0 && !isValide && (
        <View style={styles.alertBanner}>
          <Text style={styles.alertTxt}>⚠️ {nEcarts} anomalie(s) — justification requise</Text>
        </View>
      )}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabs}>
        {CATEGORIES.map(cat => (
          <TouchableOpacity key={cat.nom}
            style={[styles.tab, catActive === cat.nom && styles.tabActive]}
            onPress={() => setCatActive(cat.nom)}>
            <Text style={[styles.tabTxt, catActive === cat.nom && styles.tabTxtActive]}>{cat.nom}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView style={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {renderCatActive()}

        {!isValide && (
          <TouchableOpacity style={styles.entreeBtn} onPress={() => setShowEntreeModal(true)}>
            <Text style={styles.entreeBtnTxt}>📥 Ajouter une entrée fournisseur</Text>
            <Text style={styles.entreeSubTxt}>
              {entreesList.length > 0 ? `${entreesList.length} entrée(s) enregistrée(s) ✓` : 'Réception ou rattrapage — fournisseur obligatoire'}
            </Text>
          </TouchableOpacity>
        )}

        {/* Résumé */}
        <View style={styles.resumeValidation}>
          <Text style={styles.resumeValidationTitre}>📋 Résumé du shift</Text>
          <View style={styles.resumeValidationRow}>
            <Text style={styles.resumeValidationLabel}>Produits obligatoires manquants</Text>
            <Text style={[styles.resumeValidationVal, manquants.length > 0 && { color: '#A32D2D' }]}>
              {manquants.length === 0 ? '✅ Tous renseignés' : `⚠️ ${manquants.length}`}
            </Text>
          </View>
          <View style={styles.resumeValidationRow}>
            <Text style={styles.resumeValidationLabel}>Écarts détectés</Text>
            <Text style={[styles.resumeValidationVal, nEcarts > 0 && { color: '#854F0B' }]}>{nEcarts}</Text>
          </View>
          <View style={styles.resumeValidationRow}>
            <Text style={styles.resumeValidationLabel}>Montant à déduire</Text>
            <Text style={[styles.resumeValidationVal, montant > 0 && { color: '#A32D2D', fontWeight: '800' }]}>
              {montant > 0 ? `${montant.toLocaleString('fr-FR')} FCFA` : '0 FCFA ✅'}
            </Text>
          </View>
        </View>

        {/* Feedback */}
        {saveMsg === 'ok' && (
          <View style={styles.saveMsgOk}>
            <Text style={styles.saveMsgTxt}>✅ Inventaire sauvegardé</Text>
          </View>
        )}
        {saveMsg && saveMsg !== 'ok' && (
          <View style={styles.saveMsgErr}>
            <Text style={styles.saveMsgTxt}>{saveMsg}</Text>
          </View>
        )}

        {!isValide && (
          <>
            <TouchableOpacity
              style={[styles.saveBtn, { backgroundColor: '#185FA5' }, saving && { opacity: 0.6 }]}
              onPress={() => sauvegarder(false)} disabled={saving}>
              <Text style={styles.saveTxt}>{saving ? '⏳ Sauvegarde…' : '💾 Sauvegarder (continuer plus tard)'}</Text>
            </TouchableOpacity>

            {!confirmValider ? (
              <TouchableOpacity
                style={[styles.saveBtn, { backgroundColor: manquants.length > 0 ? '#999' : '#A32D2D', marginTop: 8 }, saving && { opacity: 0.6 }]}
                onPress={() => { if (manquants.length === 0) setConfirmValider(true) }}
                disabled={saving}>
                <Text style={styles.saveTxt}>
                  {manquants.length > 0 ? `⚠️ ${manquants.length} produit(s) manquant(s)` : '🔒 Valider l\'inventaire'}
                </Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.confirmTerminerBox}>
                <Text style={styles.confirmTerminerTxt}>
                  ⚠️ Confirmer la validation ? Verrouillé définitivement.{'\n'}
                  Montant à déduire : {montant.toLocaleString('fr-FR')} FCFA
                </Text>
                <View style={styles.confirmTerminerBtns}>
                  <TouchableOpacity style={styles.confirmTerminerCancel} onPress={() => setConfirmValider(false)}>
                    <Text style={styles.confirmTerminerCancelTxt}>Annuler</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.confirmTerminerOk, saving && { opacity: 0.6 }]}
                    onPress={() => sauvegarder(true)} disabled={saving}>
                    <Text style={styles.confirmTerminerOkTxt}>{saving ? '⏳…' : '✅ Confirmer'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </>
        )}
        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Modal entrées */}
      <Modal visible={showEntreeModal} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
          <View style={[styles.modalHeader, { backgroundColor: '#185FA5' }]}>
            <Text style={styles.modalTitre}>📥 Entrée fournisseur</Text>
            <TouchableOpacity onPress={() => { setShowEntreeModal(false); setQtesEntree({}); setEntreeFournisseurId(null); setEntreeMsg(null) }}>
              <Text style={[styles.modalFermer, { color: '#A8D4F5' }]}>Fermer</Text>
            </TouchableOpacity>
          </View>

          {/* Type d'entrée */}
          <View style={{ flexDirection: 'row', backgroundColor: '#EBF3FB', padding: 12, gap: 8 }}>
            {[['reception','📦 Réception'],['oubli','⚠️ Rattrapage/Oubli']].map(([mode, label]) => (
              <TouchableOpacity key={mode} onPress={() => setEntreeMode(mode)}
                style={[styles.modeBtn, entreeMode === mode && styles.modeBtnActive]}>
                <Text style={[styles.modeBtnTxt, entreeMode === mode && styles.modeBtnTxtActive]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {entreeMode === 'oubli' && (
            <View style={{ backgroundColor: '#FFF3CD', padding: 10 }}>
              <Text style={{ fontSize: 12, color: '#854F0B', textAlign: 'center' }}>
                Entrée non enregistrée lors de la réception — fournisseur obligatoire
              </Text>
            </View>
          )}

          {/* Fournisseur (obligatoire) */}
          <View style={styles.entreeFournisseurBox}>
            <Text style={styles.entreeFournisseurLabel}>Fournisseur * (obligatoire)</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 6 }}>
              {fournisseursListe.map(f => (
                <TouchableOpacity key={f.id}
                  style={[styles.fournPill, entreeFournisseurId === f.id && styles.fournPillActive]}
                  onPress={() => setEntreeFournisseurId(f.id)}>
                  <Text style={[styles.fournPillTxt, entreeFournisseurId === f.id && styles.fournPillTxtActive]}>{f.nom}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          {/* Entrées existantes */}
          {entreesList.length > 0 && (
            <View style={styles.entreeListSection}>
              <Text style={styles.entreeListTitre}>Entrées du shift ({entreesList.length})</Text>
              <ScrollView style={{ maxHeight: 100 }}>
                {entreesList.map((e, i) => (
                  <View key={e.id || i} style={styles.entreeListRow}>
                    <Text style={styles.entreeListNom} numberOfLines={1}>{e.produit_nom}</Text>
                    <Text style={styles.entreeListQte}>+{e.quantite}</Text>
                    <Text style={styles.entreeListFourn}>{e.fournisseur_nom}</Text>
                  </View>
                ))}
              </ScrollView>
            </View>
          )}

          {/* Catégories produits */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabs}>
            {CATS_ENTREE.map(cat => (
              <TouchableOpacity key={cat}
                style={[styles.tab, catEntree === cat && styles.tabActive]}
                onPress={() => setCatEntree(cat)}>
                <Text style={[styles.tabTxt, catEntree === cat && styles.tabTxtActive]}>{cat}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <ScrollView style={{ flex: 1, padding: 12 }} keyboardShouldPersistTaps="handled">
            {PRODUITS_ENTREE.filter(p => p.categorie === catEntree).map(p => (
              <View key={p.id} style={[styles.prodCard, parseFloat(qtesEntree[p.id]) > 0 && { borderColor: '#185FA5', backgroundColor: '#EEF4FC' }]}>
                <View style={styles.prodHeader}>
                  <Text style={styles.prodNom}>{p.nom}</Text>
                  {p.prix > 0 && <Text style={styles.prodPrix}>{p.prix.toLocaleString()} F</Text>}
                </View>
                <TextInput
                  style={[styles.fieldInput, { backgroundColor: '#E6F1FB', color: '#185FA5', fontWeight: '600', marginTop: 4 }]}
                  placeholder="Quantité" value={qtesEntree[p.id] || ''}
                  onChangeText={v => setQtesEntree(prev => ({ ...prev, [p.id]: v }))}
                  keyboardType="numeric" placeholderTextColor="#ccc" />
              </View>
            ))}

            {entreeMsg === 'ok' && (
              <View style={styles.saveMsgOk}><Text style={styles.saveMsgTxt}>✅ Entrées enregistrées</Text></View>
            )}
            {entreeMsg && entreeMsg !== 'ok' && (
              <View style={styles.saveMsgErr}><Text style={styles.saveMsgTxt}>{entreeMsg}</Text></View>
            )}

            <TouchableOpacity
              style={[styles.saveBtn, { backgroundColor: '#185FA5', marginTop: 8 }, savingEntree && { opacity: 0.6 }]}
              onPress={ajouterEntrees} disabled={savingEntree}>
              <Text style={styles.saveTxt}>{savingEntree ? 'Enregistrement…' : '✅ Enregistrer les entrées'}</Text>
            </TouchableOpacity>
            <View style={{ height: 40 }} />
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  )

  // ─── RENDU CATÉGORIE ─────────────────────────────────────────────────────────
  function renderCatActive() {
    const cat = CATEGORIES.find(c => c.nom === catActive)
    if (!cat) return null
    if (cat.nom === 'Poulet') return renderPouletSection()
    if (cat.nom === 'Fromage & Pizzas') return renderFromageSection()
    if (cat.nom === 'Frites') return renderFritesSection()
    if (cat.nom === 'Glaces & Cornets') return renderGlaceSection()
    if (cat.nom === 'Boissons') return (
      <View>
        {cat.produits.filter(p => p.id !== 'b7').map(p => renderProduitGenerique(p))}
        {renderDarinaSection()}
      </View>
    )
    return <View>{cat.produits.map(p => renderProduitGenerique(p))}</View>
  }

  function renderDarinaSection() {
    const eD = ecartDarina()
    const hasEcart = eD !== null && Math.abs(eD) > 0.01
    const oblg = oblgDarina()
    return (
      <View style={[styles.prodCard, hasEcart && styles.prodCardAlert]}>
        <View style={styles.prodHeader}>
          <Text style={[styles.prodNom, hasEcart && styles.prodNomAlert]}>Darina</Text>
          {oblg && !isValide && <View style={styles.oblgBadge}><Text style={styles.oblgTxt}>obligatoire</Text></View>}
        </View>
        {getInit('b7') > 0 && (
          <View style={styles.initialBadge}><Text style={styles.initialTxt}>📊 Initial : {getInit('b7')}</Text></View>
        )}
        <View style={styles.prodFields}>
          <View style={styles.fieldBox}>
            <Text style={styles.fieldLabel}>Entrées</Text>
            <TextInput
              style={[styles.fieldInput, isValide ? styles.fieldReadOnly : styles.fieldEdit]}
              placeholder="0" value={stocks['b7']?.entrees || ''}
              onChangeText={v => setStocks(prev => ({ ...prev, b7: { ...prev.b7, entrees: v } }))}
              keyboardType="numeric" placeholderTextColor="#ccc" editable={!isValide} />
          </View>
          <View style={styles.fieldBox}>
            <Text style={styles.fieldLabel}>Sorties (auto)</Text>
            <View style={[styles.fieldInput, { justifyContent: 'center' }]}>
              <Text style={{ fontSize: 12, textAlign: 'center', color: '#185FA5', fontWeight: '600' }}>
                {darinaSort()}
              </Text>
            </View>
          </View>
          <View style={styles.fieldBox}>
            <Text style={styles.fieldLabel}>Stock réel</Text>
            <TextInput
              style={[styles.fieldInput, isValide ? styles.fieldReadOnly : styles.fieldEdit,
                oblg && getReel('b7') === '' && !isValide && { borderColor: '#EF9F27', borderWidth: 1 }]}
              placeholder={oblg ? 'requis' : '0'} value={stocks['b7']?.stockReel || ''}
              onChangeText={v => setField('b7', 'stockReel', v)}
              keyboardType="numeric"
              placeholderTextColor={oblg ? '#EF9F27' : '#ccc'} editable={!isValide} />
          </View>
        </View>
        {hasEcart && (
          <View style={styles.ecartRow}>
            <Text style={styles.ecartWarningTxt}>⚠️ Écart : {eD > 0 ? '+' : ''}{eD?.toFixed(2)}</Text>
          </View>
        )}
        {eD !== null && !hasEcart && (
          <View style={[styles.ecartRow, styles.ecartOk]}>
            <Text style={styles.ecartValOk}>✅ Aucun écart</Text>
          </View>
        )}
      </View>
    )
  }

  function renderEcart(key, ecartVal, prix, unite) {
    const expl = explications[key] || {}
    const nb = parseFloat(expl.nombre || '') || 0
    const abs = Math.abs(ecartVal)
    const diff = Math.max(0, abs - nb)
    const mont = Math.round(diff * (prix || 0))
    return (
      <View style={styles.justifContainer}>
        <View style={styles.ecartWarning}>
          <Text style={styles.ecartWarningTxt}>
            ⚠️ Écart : {ecartVal > 0 ? '+' : ''}{ecartVal.toFixed(2)}{unite ? ` ${unite}` : ''}
          </Text>
        </View>
        {!isValide && (
          <>
            <View style={styles.justifRow}>
              <Text style={styles.justifLabel}>Nombre à expliquer{unite ? ` (${unite})` : ''}</Text>
              <TextInput style={styles.justifInput} placeholder="0"
                value={expl.nombre || ''}
                onChangeText={v => setExplications(prev => ({ ...prev, [key]: { ...prev[key], nombre: v } }))}
                keyboardType="decimal-pad" placeholderTextColor="#ccc" />
            </View>
            <TextInput style={styles.explInput}
              placeholder="Explication (casse, offerts, perte…)"
              value={expl.texte || ''}
              onChangeText={v => setExplications(prev => ({ ...prev, [key]: { ...prev[key], texte: v } }))}
              placeholderTextColor="#F09595" />
          </>
        )}
        <View style={styles.justifResume}>
          {diff <= 0.01
            ? <Text style={styles.justifOk}>✅ Écart totalement expliqué — 0 FCFA déduit</Text>
            : <Text style={styles.justifPartiel}>
                ⚠️ Montant déduit : {mont.toLocaleString('fr-FR')} FCFA
                {diff > 0 ? ` (${diff.toFixed(2)}${unite ? ` ${unite}` : ''} inexpliqué)` : ''}
              </Text>
          }
        </View>
      </View>
    )
  }

  function renderProduitGenerique(p) {
    if (p.auto) return null
    if (p.totalPoulet || p.totalFromage || p.totalGlace || p.totalFrites) return null
    const e = p.boules ? null : ecartProduit(p.id)
    const hasEcart = e !== null && Math.abs(e) > 0.01
    const oblg = oblgProduit(p.id)
    const ent = getEnt(p.id)

    return (
      <View key={p.id} style={[styles.prodCard, hasEcart && styles.prodCardAlert]}>
        <View style={styles.prodHeader}>
          <Text style={[styles.prodNom, hasEcart && styles.prodNomAlert]}>{p.nom}</Text>
          {oblg && !isValide && <View style={styles.oblgBadge}><Text style={styles.oblgTxt}>obligatoire</Text></View>}
          {p.prix > 0 && !p.boules && <Text style={styles.prodPrix}>{p.prix.toLocaleString()} F</Text>}
        </View>
        {ent > 0 && (
          <View style={styles.entreeJourBadge}><Text style={styles.entreeJourTxt}>🟢 Entrées shift : {ent}</Text></View>
        )}
        {getInit(p.id) > 0 && (
          <View style={styles.initialBadge}><Text style={styles.initialTxt}>📊 Initial : {getInit(p.id)}</Text></View>
        )}

        {p.boules ? (
          <View style={styles.prodFields}>
            <View style={styles.fieldBox}>
              <Text style={styles.fieldLabel}>Sorties</Text>
              <TextInput style={[styles.fieldInput, isValide ? styles.fieldReadOnly : styles.fieldEdit]}
                placeholder="0" value={stocks[p.id]?.sorties || ''}
                onChangeText={v => setField(p.id, 'sorties', v)}
                keyboardType="numeric" placeholderTextColor="#ccc" editable={!isValide} />
            </View>
            <View style={styles.fieldBox}>
              <Text style={styles.fieldLabel}>Boules</Text>
              <View style={[styles.fieldInput, { justifyContent: 'center' }]}>
                <Text style={{ fontSize: 12, textAlign: 'center', color: '#185FA5', fontWeight: '600' }}>
                  {getSort(p.id) * p.boules}
                </Text>
              </View>
            </View>
          </View>
        ) : (
          <View style={styles.prodFields}>
            <View style={styles.fieldBox}>
              <Text style={styles.fieldLabel}>Sorties</Text>
              <TextInput style={[styles.fieldInput, isValide ? styles.fieldReadOnly : styles.fieldEdit]}
                placeholder="0" value={stocks[p.id]?.sorties || ''}
                onChangeText={v => setField(p.id, 'sorties', v)}
                keyboardType="numeric" placeholderTextColor="#ccc" editable={!isValide} />
            </View>
            <View style={styles.fieldBox}>
              <Text style={styles.fieldLabel}>Stock réel</Text>
              <TextInput
                style={[styles.fieldInput, isValide ? styles.fieldReadOnly : styles.fieldEdit,
                  oblg && getReel(p.id) === '' && !isValide && { borderColor: '#EF9F27', borderWidth: 1 }]}
                placeholder={oblg ? 'requis' : '0'} value={stocks[p.id]?.stockReel || ''}
                onChangeText={v => setField(p.id, 'stockReel', v)}
                keyboardType="numeric"
                placeholderTextColor={oblg ? '#EF9F27' : '#ccc'} editable={!isValide} />
            </View>
          </View>
        )}
        {hasEcart && !p.noAlert && renderEcart(p.id, e, p.prix || 0)}
        {e !== null && !hasEcart && (
          <View style={[styles.ecartRow, styles.ecartOk]}>
            <Text style={styles.ecartValOk}>✅ Aucun écart</Text>
          </View>
        )}
      </View>
    )
  }

  function renderPouletSection() {
    const eP = ecartPoulet()
    const hasEcart = eP !== null && Math.abs(eP) > 0.01
    const oblg = oblgPoulet()
    return (
      <View>
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>📊 Stock poulet</Text>
          <View style={styles.resumeRow}>
            <Text style={styles.resumeLabel}>Stock initial</Text>
            <View style={styles.resumeReadOnly}><Text style={styles.resumeReadOnlyTxt}>{pouletInit()} poulets</Text></View>
          </View>
          <View style={styles.resumeRow}>
            <Text style={styles.resumeLabel}>Entrées shift</Text>
            <View style={styles.resumeReadOnly}><Text style={styles.resumeReadOnlyTxt}>{pouletEnt()} poulets</Text></View>
          </View>
          <View style={[styles.resumeRow, styles.resumeTotalRow]}>
            <Text style={styles.resumeTotalLabel}>Total disponible</Text>
            <Text style={styles.resumeTotalVal}>{pouletInit() + pouletEnt()} poulets</Text>
          </View>
        </View>
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>🔪 Sorties du shift</Text>
          {[['po2','Pané'],['po3','Rôti'],['po4','Braisé'],['po5','Désossé'],['po6','Cuisses']].map(([id, nom]) => (
            <View key={id} style={styles.resumeRow}>
              <Text style={styles.resumeLabel}>{nom}</Text>
              <TextInput style={[styles.resumeInput, isValide ? styles.fieldReadOnly : styles.fieldEdit]}
                value={stocks[id]?.sorties || ''} onChangeText={v => setField(id, 'sorties', v)}
                keyboardType="numeric" placeholder="0" placeholderTextColor="#ccc" editable={!isValide} />
            </View>
          ))}
          <View style={[styles.resumeRow, styles.resumeTotalRow]}>
            <Text style={styles.resumeTotalLabel}>Total sorties</Text>
            <Text style={styles.resumeTotalVal}>{pouletSort()} poulets</Text>
          </View>
        </View>
        <View style={[styles.sectionCard, hasEcart && styles.sectionCardAlert]}>
          <Text style={styles.sectionTitle}>📦 Stock réel constaté</Text>
          <View style={styles.resumeRow}>
            <Text style={styles.resumeLabel}>Total poulets restants</Text>
            <TextInput
              style={[styles.resumeInput, isValide ? styles.fieldReadOnly : styles.fieldEdit,
                oblg && getReel('po8') === '' && !isValide && { borderColor: '#EF9F27', borderWidth: 1 }]}
              value={stocks['po8']?.stockReel || ''} onChangeText={v => setField('po8', 'stockReel', v)}
              keyboardType="numeric" placeholder={oblg ? 'requis' : '0'}
              placeholderTextColor={oblg ? '#EF9F27' : '#ccc'} editable={!isValide} />
          </View>
          {eP !== null && !hasEcart && <View style={[styles.ecartRow, styles.ecartOk]}><Text style={styles.ecartValOk}>✅ Aucun écart poulets</Text></View>}
          {hasEcart && renderEcart('po_total', eP, 8000, 'poulet(s)')}
        </View>
      </View>
    )
  }

  function renderFromageSection() {
    const eF = ecartFromage()
    const hasEcart = eF !== null && Math.abs(eF) > 0.01
    const oblg = oblgFromage()
    return (
      <View>
        {renderProduitGenerique({ id: 'f1', nom: 'Philadelphia', prix: 2500 })}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>📊 Stock fromage (g)</Text>
          <View style={styles.resumeRow}>
            <Text style={styles.resumeLabel}>Stock initial</Text>
            <View style={styles.resumeReadOnly}><Text style={styles.resumeReadOnlyTxt}>{fromageInit()}g</Text></View>
          </View>
          <View style={styles.resumeRow}>
            <Text style={styles.resumeLabel}>Entrées shift</Text>
            <View style={styles.resumeReadOnly}><Text style={styles.resumeReadOnlyTxt}>{fromageEnt()}g</Text></View>
          </View>
          <View style={[styles.resumeRow, styles.resumeTotalRow]}>
            <Text style={styles.resumeTotalLabel}>Total disponible</Text>
            <Text style={styles.resumeTotalVal}>{fromageInit() + fromageEnt()}g</Text>
          </View>
        </View>
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>🔪 Quantités vendues</Text>
          {catFromage.produits.filter(p => p.fromage).map(p => (
            <View key={p.id} style={styles.fromageRow}>
              <Text style={styles.fromageNom} numberOfLines={2}>{p.nom}</Text>
              <TextInput style={[styles.fromageInput, isValide ? styles.fieldReadOnly : styles.fieldEdit]}
                value={stocks[p.id]?.sorties || ''} onChangeText={v => setField(p.id, 'sorties', v)}
                keyboardType="numeric" placeholder="0" placeholderTextColor="#ccc" editable={!isValide} />
              <Text style={styles.fromageGrammes}>
                {getSort(p.id) > 0 ? `${getSort(p.id) * p.fromage}g` : `×${p.fromage}g`}
              </Text>
            </View>
          ))}
          <View style={[styles.resumeRow, styles.resumeTotalRow]}>
            <Text style={styles.resumeTotalLabel}>Total utilisé</Text>
            <Text style={styles.resumeTotalVal}>{fromageSort()}g</Text>
          </View>
        </View>
        <View style={[styles.sectionCard, hasEcart && styles.sectionCardAlert]}>
          <Text style={styles.sectionTitle}>📦 Stock réel constaté</Text>
          <View style={styles.resumeRow}>
            <Text style={styles.resumeLabel}>Total fromage (g)</Text>
            <TextInput
              style={[styles.resumeInput, isValide ? styles.fieldReadOnly : styles.fieldEdit,
                oblg && getReel('f10') === '' && !isValide && { borderColor: '#EF9F27', borderWidth: 1 }]}
              value={stocks['f10']?.stockReel || ''} onChangeText={v => setField('f10', 'stockReel', v)}
              keyboardType="numeric" placeholder={oblg ? 'requis' : 'peser'}
              placeholderTextColor={oblg ? '#EF9F27' : '#ccc'} editable={!isValide} />
          </View>
          {eF !== null && !hasEcart && <View style={[styles.ecartRow, styles.ecartOk]}><Text style={styles.ecartValOk}>✅ Aucun écart fromage</Text></View>}
          {hasEcart && renderEcart('f_total', eF, 5, 'g')}
        </View>
      </View>
    )
  }

  function renderGlaceSection() {
    const eG = ecartGlace()
    const hasEcart = eG !== null && Math.abs(eG) > 0.01
    const oblg = oblgGlace()
    return (
      <View>
        {renderProduitGenerique({ id: 'g1', nom: 'Glace 2 boules', prix: 0, boules: 2 })}
        {renderProduitGenerique({ id: 'g2', nom: 'Milkshake/Spéciale', prix: 0, boules: 3 })}
        <View style={[styles.sectionCard, hasEcart && styles.sectionCardAlert]}>
          <Text style={styles.sectionTitle}>📦 Stock glace (pots)</Text>
          <View style={styles.resumeRow}>
            <Text style={styles.resumeLabel}>Stock initial</Text>
            <View style={styles.resumeReadOnly}><Text style={styles.resumeReadOnlyTxt}>{getInit('g3')} pot(s)</Text></View>
          </View>
          <View style={styles.resumeRow}>
            <Text style={styles.resumeLabel}>Entrées shift</Text>
            <View style={styles.resumeReadOnly}><Text style={styles.resumeReadOnlyTxt}>{glaceEnt()} pot(s)</Text></View>
          </View>
          <View style={styles.resumeRow}>
            <Text style={styles.resumeLabel}>Boules → pots ({totalBoules()} boules)</Text>
            <View style={styles.resumeReadOnly}>
              <Text style={styles.resumeReadOnlyTxt}>{(totalBoules()/38).toFixed(2)} pot(s)</Text>
            </View>
          </View>
          <View style={styles.resumeRow}>
            <Text style={styles.resumeLabel}>Stock réel</Text>
            <TextInput
              style={[styles.resumeInput, isValide ? styles.fieldReadOnly : styles.fieldEdit,
                oblg && getReel('g3') === '' && !isValide && { borderColor: '#EF9F27', borderWidth: 1 }]}
              value={stocks['g3']?.stockReel || ''} onChangeText={v => setField('g3', 'stockReel', v)}
              keyboardType="numeric" placeholder={oblg ? 'requis' : '0'}
              placeholderTextColor={oblg ? '#EF9F27' : '#ccc'} editable={!isValide} />
          </View>
          {eG !== null && !hasEcart && <View style={[styles.ecartRow, styles.ecartOk]}><Text style={styles.ecartValOk}>✅ Aucun écart glace</Text></View>}
          {hasEcart && renderEcart('g3', eG, 6000)}
        </View>
        {renderProduitGenerique({ id: 'g4', nom: 'Cornets', prix: 1000 })}
      </View>
    )
  }

  function renderFritesSection() {
    const eFr = ecartFrites()
    const hasEcart = eFr !== null && Math.abs(eFr) > 0.01
    const oblg = oblgFrites()
    return (
      <View>
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>📊 Stock frites (sachets)</Text>
          <View style={styles.resumeRow}>
            <Text style={styles.resumeLabel}>Stock initial</Text>
            <View style={styles.resumeReadOnly}><Text style={styles.resumeReadOnlyTxt}>{getInit('fr3')} sachet(s)</Text></View>
          </View>
          <View style={styles.resumeRow}>
            <Text style={styles.resumeLabel}>Entrées shift</Text>
            <View style={styles.resumeReadOnly}><Text style={styles.resumeReadOnlyTxt}>{fritesEnt()} sachet(s)</Text></View>
          </View>
        </View>
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>🍟 Sorties du shift</Text>
          <View style={styles.resumeRow}>
            <Text style={styles.resumeLabel}>Portions vendues</Text>
            <TextInput style={[styles.resumeInput, isValide ? styles.fieldReadOnly : styles.fieldEdit]}
              value={stocks['fr1']?.sorties || ''} onChangeText={v => setField('fr1', 'sorties', v)}
              keyboardType="numeric" placeholder="0" placeholderTextColor="#ccc" editable={!isValide} />
          </View>
          {getSort('fr1') > 0 && <Text style={styles.fritesEquiv}>→ {(getSort('fr1')/8).toFixed(2)} sachet(s) (÷8)</Text>}
          <View style={styles.resumeRow}>
            <Text style={styles.resumeLabel}>Tacos vendus</Text>
            <TextInput style={[styles.resumeInput, isValide ? styles.fieldReadOnly : styles.fieldEdit]}
              value={stocks['fr2']?.sorties || ''} onChangeText={v => setField('fr2', 'sorties', v)}
              keyboardType="numeric" placeholder="0" placeholderTextColor="#ccc" editable={!isValide} />
          </View>
          {getSort('fr2') > 0 && <Text style={styles.fritesEquiv}>→ {(getSort('fr2')/15).toFixed(2)} sachet(s) (÷15)</Text>}
          <View style={[styles.resumeRow, styles.resumeTotalRow]}>
            <Text style={styles.resumeTotalLabel}>Total utilisé</Text>
            <Text style={styles.resumeTotalVal}>{totalSachets().toFixed(2)} sachet(s)</Text>
          </View>
        </View>
        <View style={[styles.sectionCard, hasEcart && styles.sectionCardAlert]}>
          <Text style={styles.sectionTitle}>📦 Stock réel constaté</Text>
          <View style={styles.resumeRow}>
            <Text style={styles.resumeLabel}>Sachets restants</Text>
            <TextInput
              style={[styles.resumeInput, isValide ? styles.fieldReadOnly : styles.fieldEdit,
                oblg && getReel('fr3') === '' && !isValide && { borderColor: '#EF9F27', borderWidth: 1 }]}
              value={stocks['fr3']?.stockReel || ''} onChangeText={v => setField('fr3', 'stockReel', v)}
              keyboardType="numeric" placeholder={oblg ? 'requis' : '0'}
              placeholderTextColor={oblg ? '#EF9F27' : '#ccc'} editable={!isValide} />
          </View>
          {eFr !== null && !hasEcart && <View style={[styles.ecartRow, styles.ecartOk]}><Text style={styles.ecartValOk}>✅ Aucun écart frites</Text></View>}
          {hasEcart && renderEcart('fr3', eFr, 2500, 'sachet(s)')}
        </View>
      </View>
    )
  }
}

function makeStyles(colors) { return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { backgroundColor: '#EF9F27', padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: { fontSize: 16, color: '#412402', fontWeight: '500' },
  headerTitre: { fontSize: 15, fontWeight: '700', color: '#412402', textAlign: 'center' },
  headerSub: { fontSize: 10, color: '#854F0B', textAlign: 'center' },
  totalBadge: { backgroundColor: '#BA7517', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  totalBadgeTxt: { fontSize: 11, color: '#FAEEDA', fontWeight: '600' },
  valideBanner: { backgroundColor: '#E6F1FB', padding: 10, alignItems: 'center', borderBottomWidth: 0.5, borderBottomColor: '#B8D4F5' },
  valideBannerTxt: { fontSize: 12, color: '#185FA5', fontWeight: '600' },
  alertBanner: { backgroundColor: '#FAECE7', padding: 10, alignItems: 'center', borderBottomWidth: 0.5, borderBottomColor: '#F5C4B3' },
  alertTxt: { fontSize: 12, color: '#993C1D', fontWeight: '500' },
  tabs: { backgroundColor: colors.surface, borderBottomWidth: 0.5, borderBottomColor: colors.borderLight, maxHeight: 46 },
  tab: { paddingHorizontal: 14, paddingVertical: 12 },
  tabActive: { borderBottomWidth: 2, borderBottomColor: '#EF9F27' },
  tabTxt: { fontSize: 12, color: colors.textMuted },
  tabTxtActive: { color: '#EF9F27', fontWeight: '600' },
  body: { flex: 1, padding: 12 },

  // Shift sélection
  shiftCard: { backgroundColor: colors.surface, borderRadius: 16, padding: 20, borderWidth: 0.5, borderColor: colors.borderLight },
  shiftQuestion: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 16, textAlign: 'center' },
  shiftBtn: { backgroundColor: colors.bg, borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 0.5, borderColor: colors.border, flexDirection: 'row', alignItems: 'center' },
  shiftBtnLabel: { fontSize: 15, fontWeight: '600', color: colors.text },
  shiftBtnHeure: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  shiftArrow: { fontSize: 20, color: colors.textMuted },
  shiftPersonnalise: { marginTop: 16, padding: 14, backgroundColor: colors.inputBg, borderRadius: 12 },
  shiftPersonnaliseLabel: { fontSize: 13, fontWeight: '600', color: colors.textSecondary, marginBottom: 10 },
  shiftHeureRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  shiftHeureInput: { flex: 1, backgroundColor: colors.surface, borderRadius: 8, padding: 10, fontSize: 13, color: colors.text, borderWidth: 0.5, borderColor: colors.border },
  shiftHeureSep: { fontSize: 16, color: colors.textMuted },

  // Sections
  sectionCard: { backgroundColor: colors.surface, borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 0.5, borderColor: colors.borderLight },
  sectionCardAlert: { borderColor: '#F09595', backgroundColor: '#FCEBEB' },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: '#412402', marginBottom: 10 },
  resumeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  resumeLabel: { fontSize: 13, color: colors.textSecondary, flex: 1 },
  resumeInput: { width: 90, backgroundColor: colors.inputBg, borderRadius: 8, padding: 8, fontSize: 13, textAlign: 'center', color: colors.text },
  resumeReadOnly: { backgroundColor: colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  resumeReadOnlyTxt: { fontSize: 13, color: colors.textSecondary, fontWeight: '500' },
  resumeTotalRow: { marginTop: 4, paddingTop: 10, borderTopWidth: 0.5, borderTopColor: colors.borderLight, marginBottom: 0 },
  resumeTotalLabel: { fontSize: 13, fontWeight: '700', color: colors.text, flex: 1 },
  resumeTotalVal: { fontSize: 15, fontWeight: '800', color: '#185FA5' },

  // Produit cards
  prodCard: { backgroundColor: colors.surface, borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 0.5, borderColor: colors.borderLight },
  prodCardAlert: { borderColor: '#F09595', backgroundColor: '#FCEBEB' },
  prodHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  prodNom: { fontSize: 13, fontWeight: '600', color: colors.text, flex: 1 },
  prodNomAlert: { color: '#A32D2D' },
  prodPrix: { fontSize: 10, color: colors.textMuted },
  oblgBadge: { backgroundColor: '#FFF3CD', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10 },
  oblgTxt: { fontSize: 9, color: '#854F0B', fontWeight: '600' },
  entreeJourBadge: { backgroundColor: '#EAF3DE', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 3, alignSelf: 'flex-start', marginBottom: 6 },
  entreeJourTxt: { fontSize: 11, color: '#3B6D11', fontWeight: '500' },
  initialBadge: { backgroundColor: '#E6F1FB', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 3, alignSelf: 'flex-start', marginBottom: 6 },
  initialTxt: { fontSize: 11, color: '#185FA5', fontWeight: '500' },
  prodFields: { flexDirection: 'row', gap: 6 },
  fieldBox: { flex: 1, alignItems: 'center' },
  fieldLabel: { fontSize: 9, color: colors.textMuted, marginBottom: 4 },
  fieldInput: { width: '100%', backgroundColor: colors.inputBg, borderRadius: 6, padding: 6, fontSize: 12, textAlign: 'center', color: colors.text },
  fieldEdit: { backgroundColor: '#FAEEDA', color: '#412402' },
  fieldReadOnly: { opacity: 0.7 },

  // Écart
  ecartRow: { marginTop: 8, padding: 8, borderRadius: 8 },
  ecartOk: { backgroundColor: '#EAF3DE' },
  ecartValOk: { fontSize: 12, color: '#3B6D11', fontWeight: '600', textAlign: 'center' },
  justifContainer: { marginTop: 8 },
  ecartWarning: { backgroundColor: '#FFF3CD', borderRadius: 8, padding: 8, marginBottom: 8, alignItems: 'center' },
  ecartWarningTxt: { fontSize: 13, fontWeight: '700', color: '#854F0B' },
  justifRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  justifLabel: { fontSize: 12, color: colors.text, flex: 1, marginRight: 8 },
  justifInput: { width: 90, borderWidth: 1, borderColor: '#EF9F27', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, fontSize: 13, textAlign: 'center', color: colors.text, backgroundColor: colors.card },
  explInput: { marginTop: 4, backgroundColor: '#FFF8F8', borderRadius: 8, padding: 10, fontSize: 12, color: '#A32D2D', borderWidth: 0.5, borderColor: '#F09595' },
  justifResume: { backgroundColor: colors.surface, borderRadius: 8, padding: 10, marginTop: 6, borderWidth: 0.5, borderColor: colors.borderLight },
  justifOk: { fontSize: 12, color: '#3B6D11', fontWeight: '700' },
  justifPartiel: { fontSize: 12, color: '#A32D2D', fontWeight: '700' },

  // Fromage
  fromageRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 6 },
  fromageNom: { flex: 1, fontSize: 12, color: colors.textSecondary },
  fromageInput: { width: 70, backgroundColor: colors.inputBg, borderRadius: 8, padding: 8, fontSize: 13, textAlign: 'center', color: colors.text },
  fromageGrammes: { width: 60, fontSize: 11, color: '#185FA5', fontWeight: '600', textAlign: 'right' },
  fritesEquiv: { fontSize: 11, color: '#185FA5', marginBottom: 8, marginLeft: 4, fontStyle: 'italic' },

  // Résumé validation
  resumeValidation: { backgroundColor: colors.surface, borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 0.5, borderColor: colors.borderLight },
  resumeValidationTitre: { fontSize: 13, fontWeight: '700', color: colors.text, marginBottom: 12 },
  resumeValidationRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  resumeValidationLabel: { fontSize: 13, color: colors.textSecondary, flex: 1 },
  resumeValidationVal: { fontSize: 13, fontWeight: '700', color: colors.text },

  // Entrée btn
  entreeBtn: { backgroundColor: colors.surface, borderRadius: 12, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#185FA5', alignItems: 'center' },
  entreeBtnTxt: { fontSize: 15, fontWeight: '700', color: '#185FA5' },
  entreeSubTxt: { fontSize: 11, color: colors.textSecondary, marginTop: 4, textAlign: 'center' },

  // Save
  saveBtn: { borderRadius: 14, padding: 16, alignItems: 'center', marginBottom: 4 },
  saveTxt: { fontSize: 15, fontWeight: '600', color: '#fff' },
  saveMsgOk: { backgroundColor: '#EAF3DE', borderRadius: 10, padding: 12, marginBottom: 8, alignItems: 'center', borderWidth: 1, borderColor: '#B3D99B' },
  saveMsgErr: { backgroundColor: '#FAECE7', borderRadius: 10, padding: 12, marginBottom: 8, alignItems: 'center', borderWidth: 1, borderColor: '#F09595' },
  saveMsgTxt: { fontSize: 13, fontWeight: '600', color: colors.text },
  confirmTerminerBox: { backgroundColor: '#FAECE7', borderRadius: 14, padding: 16, marginTop: 8, marginBottom: 4, borderWidth: 1, borderColor: '#F09595' },
  confirmTerminerTxt: { fontSize: 13, color: '#993C1D', lineHeight: 20, marginBottom: 14 },
  confirmTerminerBtns: { flexDirection: 'row', gap: 10 },
  confirmTerminerCancel: { flex: 1, backgroundColor: colors.surface, borderRadius: 10, padding: 13, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  confirmTerminerCancelTxt: { fontSize: 14, color: colors.textMuted, fontWeight: '500' },
  confirmTerminerOk: { flex: 1, backgroundColor: '#3B6D11', borderRadius: 10, padding: 13, alignItems: 'center' },
  confirmTerminerOkTxt: { fontSize: 14, color: '#fff', fontWeight: '700' },

  // Modal
  modalHeader: { padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitre: { fontSize: 17, fontWeight: '700', color: '#fff' },
  modalFermer: { fontSize: 14, fontWeight: '500' },
  modeBtn: { flex: 1, padding: 10, borderRadius: 10, backgroundColor: colors.inputBg, alignItems: 'center' },
  modeBtnActive: { backgroundColor: '#185FA5' },
  modeBtnTxt: { fontSize: 12, color: colors.textSecondary, fontWeight: '500' },
  modeBtnTxtActive: { color: '#fff', fontWeight: '700' },
  entreeFournisseurBox: { padding: 12, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  entreeFournisseurLabel: { fontSize: 12, color: colors.textMuted, fontWeight: '600', marginBottom: 4 },
  fournPill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: colors.inputBg, marginRight: 6, borderWidth: 0.5, borderColor: colors.border },
  fournPillActive: { backgroundColor: '#185FA5', borderColor: '#185FA5' },
  fournPillTxt: { fontSize: 12, color: colors.textSecondary },
  fournPillTxtActive: { color: '#fff', fontWeight: '600' },
  entreeListSection: { backgroundColor: colors.surface, borderBottomWidth: 0.5, borderBottomColor: colors.border, padding: 12 },
  entreeListTitre: { fontSize: 12, fontWeight: '600', color: colors.textMuted, marginBottom: 6 },
  entreeListRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  entreeListNom: { fontSize: 12, color: colors.text, flex: 1 },
  entreeListQte: { fontSize: 12, fontWeight: '700', color: '#185FA5' },
  entreeListFourn: { fontSize: 10, color: colors.textMuted, fontStyle: 'italic' },
}) }
