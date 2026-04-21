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
import { useApp } from '../context/AppContext'
import { saveDepenses } from '../lib/api'
import { supabase } from '../lib/supabase'

const CATEGORIES = ['Marché', 'Légumes', 'Fruits', 'Dépenses annexes']

export default function DepensesScreen() {
  const {
    pointId, pointValide, estBloque,
    depensesJour, setDepensesJour,
    roleActif, restaurantId, userNom,
  } = useApp()

  const isGerant = roleActif === 'gerant'
  const isManager = roleActif === 'manager'
  const isCaissier = roleActif === 'caissier'

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [cumulShifts, setCumulShifts] = useState(null)

  // Dépenses propres au gérant (séparées des dépenses caissiers)
  const [depensesGerant, setDepensesGerant] = useState({
    'Marché': [],
    'Légumes': [],
    'Fruits': [],
    'Dépenses annexes': [],
  })

  useEffect(() => {
    if ((isGerant || isManager) && pointId) {
      chargerCumulDepensesShifts()
    }
  }, [pointId])

  async function chargerCumulDepensesShifts() {
    setLoading(true)
    const { data: shifts } = await supabase
      .from('points_shifts')
      .select('depenses, fournisseurs')
      .eq('point_id', pointId)

    if (shifts && shifts.length > 0) {
      setCumulShifts({
        depenses: shifts.reduce((sum, s) => sum + (s.depenses || 0), 0),
        fournisseurs: shifts.reduce((sum, s) => sum + (s.fournisseurs || 0), 0),
        nbShifts: shifts.length,
      })
    }

    // Charger les dépenses gérant existantes depuis Supabase
    const { data: depData } = await supabase
      .from('depenses')
      .select('*')
      .eq('point_id', pointId)
      .eq('saisi_par', 'gerant')
      .order('created_at')

    if (depData && depData.length > 0) {
      const newLignes = {
        'Marché': [],
        'Légumes': [],
        'Fruits': [],
        'Dépenses annexes': [],
      }
      depData.forEach(d => {
        if (newLignes[d.categorie] !== undefined) {
          newLignes[d.categorie].push({
            libelle: d.libelle,
            montant: String(d.montant)
          })
        }
      })
      setDepensesGerant(newLignes)
    }

    setLoading(false)
  }

  // ─── Fonctions pour dépenses caissier ─────────────────────
  function ajouterLigne(categorie) {
    if (estBloque(pointValide) && !isManager) return
    setDepensesJour(prev => ({
      ...prev,
      [categorie]: [...(prev[categorie] || []), { libelle: '', montant: '' }]
    }))
  }

  function supprimerLigne(categorie, index) {
    if (estBloque(pointValide) && !isManager) return
    setDepensesJour(prev => ({
      ...prev,
      [categorie]: (prev[categorie] || []).filter((_, i) => i !== index)
    }))
  }

  function setLibelle(categorie, index, valeur) {
    if (estBloque(pointValide) && !isManager) return
    setDepensesJour(prev => ({
      ...prev,
      [categorie]: (prev[categorie] || []).map((l, i) =>
        i === index ? { ...l, libelle: valeur } : l
      )
    }))
  }

  function setMontant(categorie, index, valeur) {
    if (estBloque(pointValide) && !isManager) return
    setDepensesJour(prev => ({
      ...prev,
      [categorie]: (prev[categorie] || []).map((l, i) =>
        i === index ? { ...l, montant: valeur } : l
      )
    }))
  }

  // ─── Fonctions pour dépenses gérant ───────────────────────
  function ajouterLigneGerant(categorie) {
    setDepensesGerant(prev => ({
      ...prev,
      [categorie]: [...(prev[categorie] || []), { libelle: '', montant: '' }]
    }))
  }

  function supprimerLigneGerant(categorie, index) {
    setDepensesGerant(prev => ({
      ...prev,
      [categorie]: (prev[categorie] || []).filter((_, i) => i !== index)
    }))
  }

  function setLibelleGerant(categorie, index, valeur) {
    setDepensesGerant(prev => ({
      ...prev,
      [categorie]: (prev[categorie] || []).map((l, i) =>
        i === index ? { ...l, libelle: valeur } : l
      )
    }))
  }

  function setMontantGerant(categorie, index, valeur) {
    setDepensesGerant(prev => ({
      ...prev,
      [categorie]: (prev[categorie] || []).map((l, i) =>
        i === index ? { ...l, montant: valeur } : l
      )
    }))
  }

  function totalCategorie(lignes) {
    return (lignes || []).reduce((sum, l) => sum + (parseFloat(l.montant) || 0), 0)
  }

  function totalDepensesCaissier() {
    return CATEGORIES.reduce((sum, cat) => sum + totalCategorie(depensesJour[cat]), 0)
  }

  function totalDepensesGerant() {
    return CATEGORIES.reduce((sum, cat) => sum + totalCategorie(depensesGerant[cat]), 0)
  }

  function fmt(n) { return Math.round(n).toLocaleString('fr-FR') + ' FCFA' }

  async function enregistrer() {
    if (!pointId) { Alert.alert('Erreur', 'Aucun point actif'); return }
    setSaving(true)

    if (isCaissier || isManager) {
      // Sauvegarder dépenses caissier
      await saveDepenses(pointId, depensesJour, 'caissier', userNom)
    }

    if (isGerant || isManager) {
      // Sauvegarder dépenses gérant (séparément)
      await saveDepensesGerant()
    }

    setSaving(false)
    Alert.alert('Succès', 'Dépenses enregistrées !')
    if (router.canGoBack()) router.back()
    else router.replace('/accueil')
  }

  async function saveDepensesGerant() {
    // Supprimer les anciennes dépenses gérant
    await supabase.from('depenses')
      .delete()
      .eq('point_id', pointId)
      .eq('saisi_par', 'gerant')

    // Réinsérer les nouvelles
    const lignes = []
    Object.entries(depensesGerant).forEach(([categorie, items]) => {
      items.forEach(item => {
        if (item.montant && parseFloat(item.montant) > 0) {
          lignes.push({
            point_id: pointId,
            categorie,
            libelle: item.libelle || '',
            montant: parseFloat(item.montant) || 0,
            saisi_par: 'gerant',
            caissier_nom: userNom,
          })
        }
      })
    })
    if (lignes.length > 0) {
      await supabase.from('depenses').insert(lignes)
    }
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
          <Text style={styles.headerTitre}>Dépenses</Text>
          <View style={{ width: 60 }} />
        </View>
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#EF9F27" />
          <Text style={styles.loadingTxt}>Chargement...</Text>
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
          <Text style={styles.headerTitre}>Dépenses</Text>
          <Text style={styles.headerSub}>
            {isCaissier ? 'Mes dépenses' : isGerant ? 'Dépenses du jour' : 'Toutes les dépenses'}
          </Text>
        </View>
        <View style={styles.totalBadge}>
          <Text style={styles.totalBadgeTxt}>
            {fmt(isCaissier ? totalDepensesCaissier() : totalDepensesGerant())}
          </Text>
        </View>
      </View>

      {pointValide && !isManager && (
        <View style={styles.valideBanner}>
          <Text style={styles.valideTxt}>🔒 Point validé — lecture seule</Text>
        </View>
      )}

      <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>

        {/* ══════════════════════════════════════════
            VUE CAISSIER — Ses propres dépenses
        ══════════════════════════════════════════ */}
        {(isCaissier || isManager) && (
          <>
            {CATEGORIES.map(cat => (
              <View key={cat} style={styles.categorieCard}>
                <View style={styles.categorieHeader}>
                  <Text style={styles.categorieTitre}>{cat}</Text>
                  <Text style={styles.categorieTotal}>
                    {fmt(totalCategorie(depensesJour[cat]))}
                  </Text>
                </View>

                {(depensesJour[cat] || []).map((ligne, i) => (
                  <View key={i} style={styles.ligneRow}>
                    <TextInput
                      style={styles.ligneLibelle}
                      value={ligne.libelle}
                      onChangeText={v => setLibelle(cat, i, v)}
                      placeholder="Description"
                      placeholderTextColor="#bbb"
                      editable={!estBloque(pointValide) || isManager}
                    />
                    <TextInput
                      style={styles.ligneMontant}
                      value={ligne.montant}
                      onChangeText={v => setMontant(cat, i, v)}
                      keyboardType="numeric"
                      placeholder="0"
                      placeholderTextColor="#bbb"
                      editable={!estBloque(pointValide) || isManager}
                    />
                    {(!estBloque(pointValide) || isManager) && (
                      <TouchableOpacity
                        style={styles.ligneDelete}
                        onPress={() => supprimerLigne(cat, i)}
                      >
                        <Text style={styles.ligneDeleteTxt}>✕</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ))}

                {(!estBloque(pointValide) || isManager) && (
                  <TouchableOpacity
                    style={styles.addLigneBtn}
                    onPress={() => ajouterLigne(cat)}
                  >
                    <Text style={styles.addLigneTxt}>+ Ajouter</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))}

            <View style={styles.totalCard}>
              <Text style={styles.totalLabel}>Total dépenses</Text>
              <Text style={styles.totalValue}>{fmt(totalDepensesCaissier())}</Text>
            </View>
          </>
        )}

        {/* ══════════════════════════════════════════
            VUE GÉRANT — Cumul shifts + Ses dépenses
        ══════════════════════════════════════════ */}
        {(isGerant) && (
          <>
            {/* Cumul dépenses caissiers (lecture seule) */}
            {cumulShifts && (
              <View style={styles.cumulCard}>
                <Text style={styles.cumulTitre}>
                  🔒 Dépenses caissiers — {cumulShifts.nbShifts} shift(s)
                </Text>
                <Text style={styles.cumulSub}>
                  Ces dépenses proviennent des shifts validés — non modifiables
                </Text>
                <View style={styles.cumulRow}>
                  <Text style={styles.cumulLabel}>Dépenses caissiers</Text>
                  <Text style={styles.cumulVal}>{fmt(cumulShifts.depenses)}</Text>
                </View>
                <View style={[styles.cumulRow, { borderBottomWidth: 0 }]}>
                  <Text style={styles.cumulLabel}>Fournisseurs caissiers</Text>
                  <Text style={styles.cumulVal}>{fmt(cumulShifts.fournisseurs)}</Text>
                </View>
                <View style={styles.cumulTotal}>
                  <Text style={styles.cumulTotalLabel}>Total caissiers</Text>
                  <Text style={styles.cumulTotalVal}>
                    {fmt((cumulShifts.depenses || 0) + (cumulShifts.fournisseurs || 0))}
                  </Text>
                </View>
              </View>
            )}

            {/* Dépenses propres du gérant */}
            <Text style={styles.sectionTitre}>Mes dépenses supplémentaires</Text>
            <Text style={styles.sectionSub}>
              Ajoutez ici vos propres dépenses en plus de celles des caissiers
            </Text>

            {CATEGORIES.map(cat => (
              <View key={cat} style={styles.categorieCard}>
                <View style={styles.categorieHeader}>
                  <Text style={styles.categorieTitre}>{cat}</Text>
                  <Text style={styles.categorieTotal}>
                    {fmt(totalCategorie(depensesGerant[cat]))}
                  </Text>
                </View>

                {(depensesGerant[cat] || []).map((ligne, i) => (
                  <View key={i} style={styles.ligneRow}>
                    <TextInput
                      style={styles.ligneLibelle}
                      value={ligne.libelle}
                      onChangeText={v => setLibelleGerant(cat, i, v)}
                      placeholder="Description"
                      placeholderTextColor="#bbb"
                    />
                    <TextInput
                      style={styles.ligneMontant}
                      value={ligne.montant}
                      onChangeText={v => setMontantGerant(cat, i, v)}
                      keyboardType="numeric"
                      placeholder="0"
                      placeholderTextColor="#bbb"
                    />
                    <TouchableOpacity
                      style={styles.ligneDelete}
                      onPress={() => supprimerLigneGerant(cat, i)}
                    >
                      <Text style={styles.ligneDeleteTxt}>✕</Text>
                    </TouchableOpacity>
                  </View>
                ))}

                <TouchableOpacity
                  style={styles.addLigneBtn}
                  onPress={() => ajouterLigneGerant(cat)}
                >
                  <Text style={styles.addLigneTxt}>+ Ajouter</Text>
                </TouchableOpacity>
              </View>
            ))}

            {/* Total global */}
            <View style={styles.totalGlobalCard}>
              <View style={styles.totalGlobalRow}>
                <Text style={styles.totalGlobalLabel}>Dépenses caissiers</Text>
                <Text style={styles.totalGlobalVal}>
                  {fmt((cumulShifts?.depenses || 0) + (cumulShifts?.fournisseurs || 0))}
                </Text>
              </View>
              <View style={styles.totalGlobalRow}>
                <Text style={styles.totalGlobalLabel}>Mes dépenses</Text>
                <Text style={styles.totalGlobalVal}>{fmt(totalDepensesGerant())}</Text>
              </View>
              <View style={[styles.totalGlobalRow, { borderBottomWidth: 0, marginTop: 8 }]}>
                <Text style={[styles.totalGlobalLabel, { fontWeight: '700', color: '#1a1a1a', fontSize: 15 }]}>
                  Total journalier
                </Text>
                <Text style={[styles.totalGlobalVal, { fontWeight: '700', color: '#EF9F27', fontSize: 17 }]}>
                  {fmt(
                    (cumulShifts?.depenses || 0) +
                    (cumulShifts?.fournisseurs || 0) +
                    totalDepensesGerant()
                  )}
                </Text>
              </View>
            </View>
          </>
        )}

        {/* Bouton enregistrer */}
        {(!estBloque(pointValide) || isManager || isGerant) && (
          <TouchableOpacity
            style={[styles.saveBtn, saving && { opacity: 0.6 }]}
            onPress={enregistrer}
            disabled={saving}
          >
            <Text style={styles.saveTxt}>
              {saving ? 'Enregistrement...' : '✅ Enregistrer les dépenses'}
            </Text>
          </TouchableOpacity>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
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
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingTxt: { fontSize: 13, color: '#888', marginTop: 12 },
  body: { flex: 1, padding: 14 },
  sectionTitre: {
    fontSize: 12, fontWeight: '600', color: '#888',
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6, marginTop: 8
  },
  sectionSub: { fontSize: 12, color: '#aaa', marginBottom: 10 },
  cumulCard: {
    backgroundColor: '#EEEDFE', borderRadius: 14, padding: 14,
    marginBottom: 14, borderWidth: 0.5, borderColor: '#CECBF6'
  },
  cumulTitre: { fontSize: 14, fontWeight: '600', color: '#534AB7', marginBottom: 4 },
  cumulSub: { fontSize: 11, color: '#888', marginBottom: 12, fontStyle: 'italic' },
  cumulRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 6, borderBottomWidth: 0.5, borderBottomColor: '#CECBF6'
  },
  cumulLabel: { fontSize: 13, color: '#534AB7' },
  cumulVal: { fontSize: 13, fontWeight: '500', color: '#3C3489' },
  cumulTotal: {
    flexDirection: 'row', justifyContent: 'space-between',
    marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#534AB7'
  },
  cumulTotalLabel: { fontSize: 14, fontWeight: '600', color: '#534AB7' },
  cumulTotalVal: { fontSize: 15, fontWeight: '700', color: '#3C3489' },
  categorieCard: {
    backgroundColor: '#fff', borderRadius: 14, padding: 14,
    marginBottom: 10, borderWidth: 0.5, borderColor: '#eee'
  },
  categorieHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 10
  },
  categorieTitre: { fontSize: 14, fontWeight: '600', color: '#1a1a1a' },
  categorieTotal: { fontSize: 13, fontWeight: '600', color: '#EF9F27' },
  ligneRow: {
    flexDirection: 'row', alignItems: 'center',
    gap: 8, marginBottom: 8
  },
  ligneLibelle: {
    flex: 1, backgroundColor: '#f5f5f5', borderRadius: 8,
    padding: 10, fontSize: 13, color: '#1a1a1a'
  },
  ligneMontant: {
    width: 100, backgroundColor: '#f5f5f5', borderRadius: 8,
    padding: 10, fontSize: 13, color: '#1a1a1a', textAlign: 'right'
  },
  ligneDelete: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: '#FAECE7', alignItems: 'center', justifyContent: 'center'
  },
  ligneDeleteTxt: { fontSize: 11, color: '#993C1D' },
  addLigneBtn: {
    borderWidth: 1, borderStyle: 'dashed', borderColor: '#EF9F27',
    borderRadius: 8, padding: 8, alignItems: 'center', marginTop: 4
  },
  addLigneTxt: { fontSize: 13, color: '#EF9F27', fontWeight: '500' },
  totalCard: {
    backgroundColor: '#FAEEDA', borderRadius: 14, padding: 14,
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 14
  },
  totalLabel: { fontSize: 14, fontWeight: '600', color: '#854F0B' },
  totalValue: { fontSize: 18, fontWeight: '600', color: '#412402' },
  totalGlobalCard: {
    backgroundColor: '#fff', borderRadius: 14, padding: 14,
    marginBottom: 14, borderWidth: 1, borderColor: '#EF9F27'
  },
  totalGlobalRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: '#f5f5f5'
  },
  totalGlobalLabel: { fontSize: 13, color: '#888' },
  totalGlobalVal: { fontSize: 13, fontWeight: '500', color: '#1a1a1a' },
  saveBtn: {
    backgroundColor: '#EF9F27', borderRadius: 14,
    padding: 16, alignItems: 'center', marginBottom: 10
  },
  saveTxt: { fontSize: 15, fontWeight: '600', color: '#412402' },
})