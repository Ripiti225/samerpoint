import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Modal,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native'
import { CalendrierPeriode } from '../components/ChampDate'
import { useTheme } from '../context/ThemeContext'
import { CATEGORIES_INVENTAIRE } from '../lib/constants'
import { supabase } from '../lib/supabase'
import {
  chargerDetailProduit, exporterDetailXlsx, exporterDetailPdf, formaterDateFr,
} from '../lib/detailProduitStock'
import '../lib/webAlert'   // remplace Alert.alert par les dialogues du navigateur

// Index produit_id → catégorie (+ ordre d'affichage des catégories)
const PRODUIT_CAT = {}
CATEGORIES_INVENTAIRE.forEach(c => c.produits.forEach(p => { PRODUIT_CAT[p.id] = c.nom }))
const CAT_ORDER = [...CATEGORIES_INVENTAIRE.map(c => c.nom), 'Autres']

function isoJour(d) {
  return d.toISOString().split('T')[0]
}

// Presets de période → { debut, fin } en 'YYYY-MM-DD'
function calcPreset(preset) {
  const fin = new Date()
  const debut = new Date()
  if (preset === '7j') debut.setDate(fin.getDate() - 6)
  else if (preset === '30j') debut.setDate(fin.getDate() - 29)
  else if (preset === 'mois') { debut.setDate(1) }
  else if (preset === 'jour') { /* aujourd'hui */ }
  return { debut: isoJour(debut), fin: isoJour(fin) }
}

const PRESETS = [
  { key: 'jour', label: "Aujourd'hui" },
  { key: '7j', label: '7 jours' },
  { key: '30j', label: '30 jours' },
  { key: 'mois', label: 'Ce mois' },
  { key: 'perso', label: 'Personnalisé' },
]

function fmtDateCourt(iso) {
  if (!iso) return ''
  const [y, m, j] = iso.split('-')
  const mois = ['jan', 'fév', 'mar', 'avr', 'mai', 'juin', 'jul', 'aoû', 'sep', 'oct', 'nov', 'déc']
  return `${parseInt(j)} ${mois[parseInt(m) - 1]} ${y}`
}

export default function GestionStockScreen() {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const [restaurants, setRestaurants] = useState([])
  // Ouvert depuis la recherche globale : restaurant, jour et produit de l'inventaire.
  const params = useLocalSearchParams()
  const jourRecherche = typeof params.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : null
  const [restoFilter, setRestoFilter] = useState(typeof params.restaurant_id === 'string' ? params.restaurant_id : null)
  const [showRestoPicker, setShowRestoPicker] = useState(false)

  const [preset, setPreset] = useState(jourRecherche ? 'perso' : '30j')
  const [debut, setDebut] = useState(jourRecherche || calcPreset('30j').debut)
  const [fin, setFin] = useState(jourRecherche || calcPreset('30j').fin)
  const [showCalendar, setShowCalendar] = useState(false)
  // Période en cours de choix dans le calendrier, appliquée quand elle est complète.
  const [brouillon, setBrouillon] = useState({ debut: '', fin: '' })

  const [produits, setProduits] = useState([])
  const [loading, setLoading] = useState(true)
  const [categoriesRepliees, setCategoriesRepliees] = useState({})

  // Mode « un seul produit » : le détail mouvement par mouvement, avec la
  // ventilation des entrées par fournisseur.
  const [produitFilter, setProduitFilter] = useState(typeof params.produit_id === 'string'
    ? { id: params.produit_id, nom: typeof params.produit_nom === 'string' ? params.produit_nom : params.produit_id }
    : null)   // { id, nom }
  const [showProduitPicker, setShowProduitPicker] = useState(false)
  const [detail, setDetail] = useState(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [exportEnCours, setExportEnCours] = useState(null)

  function toggleCat(nom) {
    setCategoriesRepliees(prev => ({ ...prev, [nom]: !prev[nom] }))
  }

  useEffect(() => {
    supabase.from('restaurants').select('id, nom').order('nom').then(({ data }) => setRestaurants(data || []))
  }, [])

  useEffect(() => { charger() }, [restoFilter, debut, fin])

  function choisirPreset(key) {
    setPreset(key)
    if (key === 'perso') { setShowCalendar(true); setBrouillon({ debut, fin }); return }
    const p = calcPreset(key)
    setDebut(p.debut); setFin(p.fin)
  }

  async function charger() {
    setLoading(true)
    const map = {}
    const PAGE = 1000
    let from = 0
    // Pagination : PostgREST plafonne à 1000 lignes par requête. Sans ça, le
    // total « tous les restaurants » est tronqué et devient faux (plus petit
    // qu'un restaurant seul).
    for (;;) {
      let q = supabase
        .from('inventaire_lignes')
        .select('produit_id, produit_nom, sorties, entrees, inventaires_shifts!inner(date, restaurant_id)')
        .gte('inventaires_shifts.date', debut)
        .lte('inventaires_shifts.date', fin)
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1)
      if (restoFilter) q = q.eq('inventaires_shifts.restaurant_id', restoFilter)
      const { data, error } = await q
      if (error) { setProduits([]); setLoading(false); return }
      for (const l of data || []) {
        const key = l.produit_id
        if (!map[key]) map[key] = { produit_id: key, produit_nom: l.produit_nom || key, sorties: 0, entrees: 0 }
        map[key].sorties += Number(l.sorties) || 0
        map[key].entrees += Number(l.entrees) || 0
      }
      if (!data || data.length < PAGE) break
      from += PAGE
    }
    const rows = Object.values(map).sort((a, b) => b.sorties - a.sorties)
    setProduits(rows)
    setLoading(false)
  }

  useEffect(() => {
    if (!produitFilter) { setDetail(null); return }
    let vivant = true
    setLoadingDetail(true)
    chargerDetailProduit({
      produitId: produitFilter.id, produitNom: produitFilter.nom,
      restaurantId: restoFilter, debut, fin,
    })
      .then(d => { if (vivant) setDetail(d) })
      .catch(e => {
        console.error('[gestion-stock] détail', e)
        if (vivant) { setDetail(null); Alert.alert('Erreur', e.message || 'Chargement impossible') }
      })
      .finally(() => { if (vivant) setLoadingDetail(false) })
    return () => { vivant = false }
  }, [produitFilter, restoFilter, debut, fin])

  async function exporter(format) {
    if (!detail || exportEnCours) return
    setExportEnCours(format)
    try {
      await (format === 'pdf' ? exporterDetailPdf(detail) : exporterDetailXlsx(detail))
    } catch (e) {
      console.error('[gestion-stock] export', e)
      Alert.alert('Export impossible', e.message || 'Une erreur est survenue.')
    }
    setExportEnCours(null)
  }

  const totalSorties = produits.reduce((s, p) => s + p.sorties, 0)
  const totalEntrees = produits.reduce((s, p) => s + p.entrees, 0)
  const restoNom = restoFilter ? restaurants.find(r => r.id === restoFilter)?.nom || 'Restaurant' : 'Tous les restaurants'

  // Regroupement par catégorie (ordre CAT_ORDER, produits triés par sorties desc)
  const categories = useMemo(() => {
    const par = {}
    for (const p of produits) {
      const cat = PRODUIT_CAT[p.produit_id] || 'Autres'
      if (!par[cat]) par[cat] = { nom: cat, produits: [], sorties: 0, entrees: 0 }
      par[cat].produits.push(p)
      par[cat].sorties += p.sorties
      par[cat].entrees += p.entrees
    }
    return CAT_ORDER
      .filter(nom => par[nom])
      .map(nom => ({ ...par[nom], produits: par[nom].produits.sort((a, b) => b.sorties - a.sorties) }))
  }, [produits])

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.canGoBack() ? router.back() : router.replace('/accueil')}>
          <Text style={styles.back}>‹ Retour</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitre}>Gestion de stock</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* Filtre restaurant */}
      <View style={styles.filtersRow}>
        <TouchableOpacity style={styles.restoBtn} onPress={() => setShowRestoPicker(true)}>
          <Text style={styles.restoBtnTxt} numberOfLines={1}>🏪 {restoNom} ▾</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.restoBtn, produitFilter && styles.restoBtnActif]}
          onPress={() => setShowProduitPicker(true)}
        >
          <Text style={[styles.restoBtnTxt, produitFilter && styles.restoBtnTxtActif]} numberOfLines={1}>
            📦 {produitFilter ? produitFilter.nom : 'Tous les produits'} ▾
          </Text>
        </TouchableOpacity>
      </View>

      {/* Filtre période */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[styles.presetRow, { flexGrow: 0 }]} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
        {PRESETS.map(p => (
          <TouchableOpacity key={p.key} style={[styles.presetBtn, preset === p.key && styles.presetBtnActive]} onPress={() => choisirPreset(p.key)}>
            <Text style={[styles.presetTxt, preset === p.key && styles.presetTxtActive]}>{p.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <TouchableOpacity style={styles.periodeInfo} onPress={() => { setPreset('perso'); setShowCalendar(true); setBrouillon({ debut, fin }) }}>
        <Text style={styles.periodeTxt}>📅 {fmtDateCourt(debut)} → {fmtDateCourt(fin)}</Text>
      </TouchableOpacity>

      {produitFilter ? (
        <DetailProduit
          detail={detail}
          loading={loadingDetail}
          exportEnCours={exportEnCours}
          onExporter={exporter}
          onFermer={() => setProduitFilter(null)}
          styles={styles}
          colors={colors}
        />
      ) : loading ? (
        <View style={styles.loadingBox}><ActivityIndicator size="large" color="#534AB7" /></View>
      ) : (
        <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
          {/* Totaux */}
          <View style={styles.totauxRow}>
            <View style={[styles.totalCard, { borderColor: '#A32D2D' }]}>
              <Text style={styles.totalLabel}>Total sorties</Text>
              <Text style={[styles.totalVal, { color: '#A32D2D' }]}>{totalSorties.toLocaleString('fr-FR')}</Text>
            </View>
            <View style={[styles.totalCard, { borderColor: '#3B6D11' }]}>
              <Text style={styles.totalLabel}>Total entrées</Text>
              <Text style={[styles.totalVal, { color: '#3B6D11' }]}>{totalEntrees.toLocaleString('fr-FR')}</Text>
            </View>
          </View>

          {produits.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyIcon}>📦</Text>
              <Text style={styles.emptyTxt}>Aucune donnée de stock sur cette période</Text>
            </View>
          ) : (
            categories.map(cat => {
              const ouvert = !categoriesRepliees[cat.nom]
              return (
                <View key={cat.nom} style={styles.catBloc}>
                  <TouchableOpacity style={styles.catHead} onPress={() => toggleCat(cat.nom)} activeOpacity={0.7}>
                    <Text style={styles.catTitre}>{ouvert ? '▾' : '▸'} {cat.nom}</Text>
                    <View style={styles.catTotaux}>
                      <Text style={styles.catEntrees}>+{cat.entrees.toLocaleString('fr-FR')}</Text>
                      <Text style={styles.catSorties}>−{cat.sorties.toLocaleString('fr-FR')}</Text>
                    </View>
                  </TouchableOpacity>
                  {ouvert && (
                    <>
                      <View style={styles.tableHead}>
                        <Text style={styles.thProduit}>Produit</Text>
                        <Text style={styles.thNum}>Entrées</Text>
                        <Text style={styles.thNum}>Sorties</Text>
                      </View>
                      {cat.produits.map(p => (
                        <View key={p.produit_id} style={styles.row}>
                          <Text style={styles.rowProduit} numberOfLines={2}>{p.produit_nom}</Text>
                          <Text style={styles.rowEntrees}>{p.entrees.toLocaleString('fr-FR')}</Text>
                          <Text style={styles.rowSorties}>{p.sorties.toLocaleString('fr-FR')}</Text>
                        </View>
                      ))}
                    </>
                  )}
                </View>
              )
            })
          )}
          <View style={{ height: 40 }} />
        </ScrollView>
      )}

      {/* Picker restaurant */}
      <Modal visible={showRestoPicker} transparent animationType="slide">
        <TouchableWithoutFeedback onPress={() => setShowRestoPicker(false)}>
          <View style={styles.modalOverlay}>
            <View style={styles.pickerModal}>
              <Text style={styles.pickerTitre}>Choisir un restaurant</Text>
              <ScrollView>
                <TouchableOpacity style={styles.pickerItem} onPress={() => { setRestoFilter(null); setShowRestoPicker(false) }}>
                  <Text style={[styles.pickerItemTxt, !restoFilter && { fontWeight: '700', color: '#534AB7' }]}>🌍 Tous les restaurants</Text>
                </TouchableOpacity>
                {restaurants.map(r => (
                  <TouchableOpacity key={r.id} style={styles.pickerItem} onPress={() => { setRestoFilter(r.id); setShowRestoPicker(false) }}>
                    <Text style={[styles.pickerItemTxt, restoFilter === r.id && { fontWeight: '700', color: '#534AB7' }]}>🏪 {r.nom}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* Picker produit */}
      <Modal visible={showProduitPicker} transparent animationType="slide">
        <TouchableWithoutFeedback onPress={() => setShowProduitPicker(false)}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback>
              <View style={styles.pickerModal}>
                <Text style={styles.pickerTitre}>Choisir un produit</Text>
                <ScrollView>
                  <TouchableOpacity
                    style={styles.pickerItem}
                    onPress={() => { setProduitFilter(null); setShowProduitPicker(false) }}
                  >
                    <Text style={[styles.pickerItemTxt, !produitFilter && { fontWeight: '700', color: '#534AB7' }]}>
                      📦 Tous les produits
                    </Text>
                  </TouchableOpacity>
                  {categories.map(cat => (
                    <View key={cat.nom}>
                      <Text style={styles.pickerGroupe}>{cat.nom}</Text>
                      {cat.produits.map(p => (
                        <TouchableOpacity
                          key={p.produit_id}
                          style={styles.pickerItem}
                          onPress={() => {
                            setProduitFilter({ id: p.produit_id, nom: p.produit_nom })
                            setShowProduitPicker(false)
                          }}
                        >
                          <Text style={[styles.pickerItemTxt,
                            produitFilter?.id === p.produit_id && { fontWeight: '700', color: '#534AB7' }]}>
                            {p.produit_nom}
                          </Text>
                          <Text style={styles.pickerItemMeta}>
                            +{p.entrees.toLocaleString('fr-FR')} · −{p.sorties.toLocaleString('fr-FR')}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  ))}
                  {categories.length === 0 && (
                    <Text style={styles.pickerVide}>
                      Aucun produit sur cette période. Élargissez les dates ou changez de restaurant.
                    </Text>
                  )}
                </ScrollView>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* Calendrier période personnalisée */}
      <Modal visible={showCalendar} transparent animationType="slide">
        <TouchableWithoutFeedback onPress={() => setShowCalendar(false)}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback>
              <View style={styles.pickerModal}>
                <Text style={styles.pickerTitre}>
                  {brouillon.debut && !brouillon.fin ? 'Touchez la date de fin' : 'Touchez la date de début, ou un mois'}
                </Text>
                <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
                  <View style={[styles.dateBtn, !brouillon.fin && styles.dateBtnActive]}>
                    <Text style={[styles.dateBtnTxt, !brouillon.fin && { color: '#fff' }]}>{brouillon.debut ? fmtDateCourt(brouillon.debut) : 'Début'}</Text>
                  </View>
                  <Text style={{ color: colors.textMuted, alignSelf: 'center' }}>→</Text>
                  <View style={[styles.dateBtn, !!brouillon.fin && styles.dateBtnActive]}>
                    <Text style={[styles.dateBtnTxt, !!brouillon.fin && { color: '#fff' }]}>{brouillon.fin ? fmtDateCourt(brouillon.fin) : 'Fin'}</Text>
                  </View>
                </View>
                <CalendrierPeriode debut={brouillon.debut} fin={brouillon.fin} couleur="#534AB7"
                  onChange={p => {
                    setBrouillon(p)
                    // Période complète : appliquée et calendrier fermé, comme avant.
                    if (p.debut && p.fin) { setDebut(p.debut); setFin(p.fin); setShowCalendar(false) }
                  }} />
                <TouchableOpacity style={styles.closeCalBtn} onPress={() => setShowCalendar(false)}>
                  <Text style={styles.closeCalTxt}>Fermer</Text>
                </TouchableOpacity>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </SafeAreaView>
  )
}

// ─── Vue « un seul produit » ───────────────────────────────────────────────
// Les mouvements sont regroupés par journée : c'est l'unité à laquelle le
// gérant raisonne, et ça évite de répéter la date sur chaque shift.

function DetailProduit({ detail, loading, exportEnCours, onExporter, onFermer, styles, colors }) {
  const parJour = useMemo(() => {
    if (!detail) return []
    const map = new Map()
    detail.mouvements.forEach(m => {
      if (!map.has(m.date)) map.set(m.date, [])
      map.get(m.date).push(m)
    })
    return [...map.entries()].map(([date, mouvements]) => ({
      date,
      mouvements,
      entrees: mouvements.reduce((s, x) => s + x.entrees, 0),
      sorties: mouvements.reduce((s, x) => s + x.sorties, 0),
    }))
  }, [detail])

  if (loading) {
    return (
      <View style={styles.loadingBox}>
        <ActivityIndicator size="large" color="#534AB7" />
        <Text style={styles.loadingTxt}>Chargement du détail…</Text>
      </View>
    )
  }
  if (!detail || detail.mouvements.length === 0) {
    return (
      <View style={styles.emptyBox}>
        <Text style={styles.emptyIcon}>📦</Text>
        <Text style={styles.emptyTxt}>Aucun mouvement pour ce produit sur la période</Text>
        <TouchableOpacity style={styles.retourListeBtn} onPress={onFermer}>
          <Text style={styles.retourListeTxt}>← Revenir à tous les produits</Text>
        </TouchableOpacity>
      </View>
    )
  }

  const t = detail.totaux
  return (
    <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
      <View style={styles.totauxRow}>
        <View style={[styles.totalCard, { borderColor: '#3B6D11' }]}>
          <Text style={styles.totalLabel}>Entrées</Text>
          <Text style={[styles.totalVal, { color: '#3B6D11' }]}>{t.entrees.toLocaleString('fr-FR')}</Text>
        </View>
        <View style={[styles.totalCard, { borderColor: '#A32D2D' }]}>
          <Text style={styles.totalLabel}>Sorties</Text>
          <Text style={[styles.totalVal, { color: '#A32D2D' }]}>{t.sorties.toLocaleString('fr-FR')}</Text>
        </View>
        <View style={[styles.totalCard, { borderColor: t.ecart < 0 ? '#A32D2D' : colors.border }]}>
          <Text style={styles.totalLabel}>Écart</Text>
          <Text style={[styles.totalVal, { color: t.ecart < 0 ? '#A32D2D' : colors.text }]}>
            {t.ecart.toLocaleString('fr-FR')}
          </Text>
        </View>
      </View>

      <Text style={styles.detailMeta}>
        {t.nbMouvements} mouvement{t.nbMouvements > 1 ? 's' : ''} sur {t.nbJours} journée
        {t.nbJours > 1 ? 's' : ''}
        {t.montantDeduit > 0 ? ` · ${t.montantDeduit.toLocaleString('fr-FR')} F déduits` : ''}
      </Text>

      <View style={styles.exportRow}>
        <TouchableOpacity
          style={[styles.exportBtn, exportEnCours && styles.exportBtnBloque]}
          disabled={!!exportEnCours}
          onPress={() => onExporter('xlsx')}
        >
          <Text style={styles.exportTxt}>
            {exportEnCours === 'xlsx' ? '…' : '📊'} Excel
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.exportBtn, exportEnCours && styles.exportBtnBloque]}
          disabled={!!exportEnCours}
          onPress={() => onExporter('pdf')}
        >
          <Text style={styles.exportTxt}>
            {exportEnCours === 'pdf' ? '…' : '📕'} PDF
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.exportBtnSecondaire} onPress={onFermer}>
          <Text style={styles.exportTxtSecondaire}>← Tous</Text>
        </TouchableOpacity>
      </View>

      {t.fournisseurs.length > 0 && (
        <View style={styles.catBloc}>
          <View style={styles.catHead}>
            <Text style={styles.catTitre}>Fournisseurs sur la période</Text>
          </View>
          {t.fournisseurs.map(f => (
            <View key={f.nom} style={styles.row}>
              <Text style={styles.rowProduit} numberOfLines={1}>{f.nom}</Text>
              <Text style={styles.rowEntrees}>{f.quantite.toLocaleString('fr-FR')}</Text>
              <Text style={styles.rowPart}>
                {t.entrees ? Math.round((f.quantite / t.entrees) * 100) + ' %' : '—'}
              </Text>
            </View>
          ))}
        </View>
      )}

      {parJour.map(j => (
        <View key={j.date} style={styles.catBloc}>
          <View style={styles.catHead}>
            <Text style={styles.catTitre}>{formaterDateFr(j.date)}</Text>
            <View style={styles.catTotaux}>
              <Text style={styles.catEntrees}>+{j.entrees.toLocaleString('fr-FR')}</Text>
              <Text style={styles.catSorties}>−{j.sorties.toLocaleString('fr-FR')}</Text>
            </View>
          </View>
          {j.mouvements.map((m, i) => (
            <View key={i} style={styles.mvtBloc}>
              <Text style={styles.mvtEntete}>
                {m.shift} · {m.restaurant}
                {m.caissier !== '—' ? ` · ${m.caissier}` : ''}
                {!m.valide ? '  (non validé)' : ''}
              </Text>
              <View style={styles.mvtChiffres}>
                <Text style={styles.mvtCase}>initial {m.stockInitial.toLocaleString('fr-FR')}</Text>
                <Text style={[styles.mvtCase, { color: '#3B6D11' }]}>+{m.entrees.toLocaleString('fr-FR')}</Text>
                <Text style={[styles.mvtCase, { color: '#A32D2D' }]}>−{m.sorties.toLocaleString('fr-FR')}</Text>
                <Text style={styles.mvtCase}>final {m.stockFinal == null ? '—' : m.stockFinal.toLocaleString('fr-FR')}</Text>
                {m.ecart !== 0 && (
                  <Text style={[styles.mvtCase, styles.mvtEcart]}>écart {m.ecart.toLocaleString('fr-FR')}</Text>
                )}
              </View>
              {m.fournisseurs.map((f, k) => (
                <Text key={k} style={styles.mvtFournisseur}>
                  └ {f.nom} — {f.quantite.toLocaleString('fr-FR')}
                </Text>
              ))}
            </View>
          ))}
        </View>
      ))}
      <View style={{ height: 40 }} />
    </ScrollView>
  )
}

function makeStyles(colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
    back: { fontSize: 16, color: '#534AB7', fontWeight: '500' },
    headerTitre: { fontSize: 18, fontWeight: '700', color: colors.text },
    filtersRow: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
    restoBtn: { flex: 1, backgroundColor: colors.surface, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: colors.border },
    restoBtnActif: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
    restoBtnTxtActif: { color: colors.primaryDark, fontWeight: '700' },

    pickerGroupe: { fontSize: 11, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4 },
    pickerItemMeta: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
    pickerVide: { fontSize: 13, color: colors.textMuted, textAlign: 'center', padding: 24, lineHeight: 19 },

    loadingTxt: { marginTop: 12, fontSize: 13, color: colors.textMuted },
    detailMeta: { fontSize: 12, color: colors.textMuted, textAlign: 'center', marginBottom: 12 },

    exportRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
    exportBtn: { flex: 1, backgroundColor: colors.primaryLight, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
    exportBtnBloque: { opacity: 0.4 },
    exportTxt: { fontSize: 13, fontWeight: '600', color: colors.primaryDark },
    exportBtnSecondaire: { paddingHorizontal: 14, justifyContent: 'center', borderRadius: 10, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border },
    exportTxtSecondaire: { fontSize: 12, color: colors.textSecondary, fontWeight: '600' },

    retourListeBtn: { marginTop: 16, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, backgroundColor: colors.primaryLight },
    retourListeTxt: { fontSize: 13, color: colors.primaryDark, fontWeight: '600' },

    rowPart: { width: 58, textAlign: 'right', fontSize: 12, color: colors.textMuted },

    mvtBloc: { paddingHorizontal: 16, paddingVertical: 9, borderTopWidth: 1, borderTopColor: colors.borderLight },
    mvtEntete: { fontSize: 12, fontWeight: '600', color: colors.text, marginBottom: 5 },
    mvtChiffres: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    mvtCase: { fontSize: 12, color: colors.textSecondary },
    mvtEcart: { color: '#A32D2D', fontWeight: '700' },
    mvtFournisseur: { fontSize: 11, color: colors.textMuted, marginTop: 4, marginLeft: 6 },
    restoBtnTxt: { fontSize: 14, color: colors.text, fontWeight: '500' },
    presetRow: { paddingVertical: 8, flexGrow: 0 },
    presetBtn: { backgroundColor: colors.surface, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7, borderWidth: 1, borderColor: colors.border },
    presetBtnActive: { backgroundColor: '#534AB7', borderColor: '#534AB7' },
    presetTxt: { fontSize: 13, color: colors.textMuted, fontWeight: '500' },
    presetTxtActive: { color: '#fff' },
    periodeInfo: { paddingHorizontal: 16, paddingBottom: 8 },
    periodeTxt: { fontSize: 13, color: colors.textMuted, fontWeight: '500' },
    loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    body: { flex: 1, paddingHorizontal: 16 },
    totauxRow: { flexDirection: 'row', gap: 12, marginTop: 8, marginBottom: 16 },
    totalCard: { flex: 1, backgroundColor: colors.surface, borderRadius: 14, padding: 14, borderWidth: 1.5, alignItems: 'center' },
    totalLabel: { fontSize: 12, color: colors.textMuted, marginBottom: 4 },
    totalVal: { fontSize: 22, fontWeight: '800' },
    emptyBox: { alignItems: 'center', paddingTop: 50 },
    emptyIcon: { fontSize: 44, marginBottom: 12 },
    emptyTxt: { color: colors.textMuted, fontSize: 15, textAlign: 'center' },
    catBloc: { marginBottom: 16 },
    catHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surface, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 14, borderWidth: 1, borderColor: colors.border },
    catTitre: { fontSize: 15, fontWeight: '800', color: colors.text, flex: 1 },
    catTotaux: { flexDirection: 'row', gap: 14 },
    catEntrees: { fontSize: 14, fontWeight: '700', color: '#3B6D11' },
    catSorties: { fontSize: 14, fontWeight: '700', color: '#A32D2D' },
    tableHead: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 12, borderBottomWidth: 2, borderBottomColor: colors.border },
    thProduit: { flex: 1, fontSize: 11, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
    thNum: { width: 70, textAlign: 'right', fontSize: 11, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
    row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface, borderRadius: 8, marginTop: 4 },
    rowProduit: { flex: 1, fontSize: 14, color: colors.text, fontWeight: '500', paddingRight: 8 },
    rowEntrees: { width: 70, textAlign: 'right', fontSize: 14, color: '#3B6D11', fontWeight: '600' },
    rowSorties: { width: 70, textAlign: 'right', fontSize: 14, color: '#A32D2D', fontWeight: '700' },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    pickerModal: { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '80%' },
    pickerTitre: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 14 },
    pickerItem: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
    pickerItemTxt: { fontSize: 15, color: colors.text },
    dateBtn: { flex: 1, backgroundColor: colors.background, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
    dateBtnActive: { backgroundColor: '#534AB7', borderColor: '#534AB7' },
    dateBtnTxt: { fontSize: 13, color: colors.text, fontWeight: '600' },
    closeCalBtn: { marginTop: 14, backgroundColor: '#534AB7', borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
    closeCalTxt: { color: '#fff', fontSize: 15, fontWeight: '700' },
  })
}
