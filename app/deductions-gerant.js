import { router } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  SafeAreaView, ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native'
import { useApp } from '../context/AppContext'
import { useTheme } from '../context/ThemeContext'
import { CATEGORIES_DEPENSES } from '../lib/constants'
import { supabase } from '../lib/supabase'
import { usePhoto } from '../lib/usePhoto'

export default function DeductionsGerantScreen() {
  const {
    restaurantId, pointId, userId, userNom, dateJour,
    depensesGerantCaisse, setDepensesGerantCaisse,
    fournisseursGerantCaisse, setFournisseursGerantCaisse,
    paiesGerantCaisse, setPaiesGerantCaisse,
    totalDepensesGerantCaisse,
  } = useApp()

  // pointId peut être null si le gérant n'a pas encore sélectionné de journée

  const { prendrePhoto, choisirPhoto } = usePhoto()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const [sectionsOuvertes, setSectionsOuvertes] = useState(new Set())
  const [fournisseursList, setFournisseursList] = useState([])
  const [travailleurs, setTravailleurs] = useState([])
  const [uploading, setUploading] = useState(false)
  const [chargement, setChargement] = useState(false)
  const [modalPaie, setModalPaie] = useState(false)
  const [paieEditIndex, setPaieEditIndex] = useState(null)
  const [saveStatus, setSaveStatus] = useState(null) // null | 'saving' | 'ok' | 'error'

  useEffect(() => {
    if (restaurantId) chargerDonnees()
  }, [restaurantId])

  useEffect(() => {
    if (pointId) chargerBrouillon()
  }, [pointId])

  async function chargerDonnees() {
    setChargement(true)
    const [{ data: fours }, { data: travs }] = await Promise.all([
      supabase.from('fournisseurs').select('id, nom, credit_actuel, montant_cotise').eq('restaurant_id', restaurantId).order('nom'),
      supabase.from('travailleurs').select('id, nom, poste').eq('restaurant_id', restaurantId).order('nom'),
    ])

    setTravailleurs(travs || [])

    let creditMap = {}
    let caissierMap = {}

    if (fours && fours.length > 0) {
      // Crédit net directement depuis fournisseurs (credit_actuel - montant_cotise)
      fours.forEach(f => {
        creditMap[f.id] = (f.credit_actuel || 0) - (f.montant_cotise || 0)
      })

      // Factures caissier du jour (shift validé ou en cours)
      // gerant_caissier est déjà dans credit_actuel (mis à jour par sauvegarder)
      if (pointId) {
        const { data: txCaissier } = await supabase
          .from('transactions_fournisseurs')
          .select('fournisseur_id, facture, paye')
          .eq('point_id', pointId)
          .eq('saisi_par', 'caissier')
        ;(txCaissier || []).forEach(tx => {
          const net = (tx.facture || 0) - (tx.paye || 0)
          if (net > 0) caissierMap[tx.fournisseur_id] = net
        })
      }
    }

    setFournisseursList((fours || []).map(f => ({
      ...f,
      credit_veille: (creditMap[f.id] || 0) + (caissierMap[f.id] || 0),
      caissier_facture: caissierMap[f.id] || 0,
    })))
    setChargement(false)
  }

  async function chargerBrouillon() {
    try {
      const { data: point } = await supabase
        .from('points')
        .select('valide, draft_gerant')
        .eq('id', pointId)
        .maybeSingle()
      if (!point || point.valide) return
      const draft = point.draft_gerant
      if (!draft) return
      if (draft.depenses) setDepensesGerantCaisse(draft.depenses)
      if (draft.fournisseurs) setFournisseursGerantCaisse(draft.fournisseurs)
      if (draft.paies) setPaiesGerantCaisse(draft.paies)
    } catch (_) {}
  }

  async function sauvegarder() {
    if (!pointId) {
      Alert.alert('Aucun point actif', 'Sélectionnez une date depuis l\'accueil avant de sauvegarder.')
      return
    }
    setSaveStatus('saving')
    try {
      const { error } = await supabase
        .from('points')
        .update({
          draft_gerant: {
            depenses: depensesGerantCaisse,
            fournisseurs: fournisseursGerantCaisse,
            paies: paiesGerantCaisse,
          }
        })
        .eq('id', pointId)
      if (error) throw error
      setSaveStatus('ok')

      // Mettre à jour credit_actuel + historique pour chaque fournisseur gérant
      const today = dateJour || new Date().toISOString().split('T')[0]
      const motifPrefix = `deduction_gerant|${today}|`

      for (const [fournId, data] of Object.entries(fournisseursGerantCaisse)) {
        const paye = parseFloat(data?.paye) || 0
        const facture = parseFloat(data?.montant_facture) || 0
        if (paye === 0 && facture === 0) continue

        const creditVeille = data?.credit_veille != null
          ? parseFloat(data.credit_veille) || 0
          : (fournisseursList.find(f => f.id === fournId)?.credit_veille ?? 0)
        const nouveauCredit = creditVeille + facture - paye

        // Vérifier si une entrée existe déjà pour ce fournisseur aujourd'hui (filtré par restaurant)
        const { data: existant } = await supabase
          .from('historique_credit_fournisseurs')
          .select('id')
          .eq('fournisseur_id', fournId)
          .eq('restaurant_id', restaurantId)
          .like('motif', `${motifPrefix}%`)
          .limit(1)

        if (existant && existant.length > 0) {
          // Demander confirmation avant d'écraser
          const nomFourn = data?.nom || fournisseursList.find(f => f.id === fournId)?.nom || 'ce fournisseur'
          const confirme = await new Promise(resolve =>
            Alert.alert(
              '⚠️ Facture déjà enregistrée',
              `La facture de ${nomFourn} a déjà été enregistrée aujourd'hui.\n\nVoulez-vous mettre à jour avec les nouveaux montants ?`,
              [
                { text: 'Annuler', style: 'cancel', onPress: () => resolve(false) },
                { text: 'Mettre à jour', style: 'destructive', onPress: () => resolve(true) },
              ]
            )
          )
          if (!confirme) continue
          // Supprimer l'ancienne entrée avant d'insérer la nouvelle
          await supabase.from('historique_credit_fournisseurs')
            .delete()
            .eq('fournisseur_id', fournId)
            .eq('restaurant_id', restaurantId)
            .like('motif', `${motifPrefix}%`)
        }

        await supabase.from('fournisseurs').update({ credit_actuel: nouveauCredit }).eq('id', fournId)
        await supabase.from('historique_credit_fournisseurs').insert({
          fournisseur_id: fournId,
          restaurant_id: restaurantId,
          point_id: pointId,
          source: 'deduction_gerant',
          ancien_credit: creditVeille,
          nouveau_credit: nouveauCredit,
          facture,
          paye,
          photo_url: data?.photoUri || null,
          motif: `${motifPrefix}facture ${facture} FCFA, payé ${paye} FCFA`,
          modified_by: userId || null,
        })
        // Enregistrer dans transactions_fournisseurs (source de vérité crédit veille)
        await supabase.from('transactions_fournisseurs')
          .delete()
          .eq('point_id', pointId)
          .eq('fournisseur_id', fournId)
          .eq('saisi_par', 'gerant_caissier')
        await supabase.from('transactions_fournisseurs').insert({
          point_id: pointId,
          fournisseur_id: fournId,
          fournisseur_nom: fournisseursList.find(f => f.id === fournId)?.nom || null,
          source: 'deduction_gerant',
          restaurant_id: restaurantId,
          facture,
          paye,
          reste: nouveauCredit,
          saisi_par: 'gerant_caissier',
          caissier_nom: userNom || null,
          modified_by: userId || null,
        })
        // Synchroniser fournisseurs_restaurants si la table a un credit_actuel
        supabase.from('fournisseurs_restaurants')
          .update({ credit_actuel: nouveauCredit })
          .eq('fournisseur_id', fournId)
          .eq('restaurant_id', restaurantId)
          .catch(() => {})
      }

      // Rafraîchir l'affichage des crédits après sauvegarde
      await chargerDonnees()
    } catch (_) {
      setSaveStatus('error')
    } finally {
      setTimeout(() => setSaveStatus(null), 3000)
    }
  }

  function ouvrirSelecteurTravailleur(index) {
    setPaieEditIndex(index)
    setModalPaie(true)
  }

  function selectionnerTravailleur(trav) {
    setPaiesGerantCaisse(prev => prev.map((l, i) =>
      i === paieEditIndex ? { ...l, travailleur_id: trav.id, travailleur_nom: trav.nom } : l
    ))
    setModalPaie(false)
    setPaieEditIndex(null)
  }

  function toggleSection(key) {
    setSectionsOuvertes(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function ajouterLigneDep(cat) {
    setDepensesGerantCaisse(prev => ({
      ...prev,
      [cat]: [...(prev[cat] || []), { id: Date.now().toString(), description: '', montant: '', photoUri: null }]
    }))
  }

  function supprimerLigneDep(cat, index) {
    setDepensesGerantCaisse(prev => ({
      ...prev,
      [cat]: (prev[cat] || []).filter((_, i) => i !== index)
    }))
  }

  function updateLigneDep(cat, index, champ, valeur) {
    setDepensesGerantCaisse(prev => ({
      ...prev,
      [cat]: (prev[cat] || []).map((l, i) => i === index ? { ...l, [champ]: valeur } : l)
    }))
  }

  function updateFournisseurGerant(fourId, fourNom, champ, valeur) {
    const fourn = fournisseursList.find(f => f.id === fourId)
    setFournisseursGerantCaisse(prev => ({
      ...prev,
      [fourId]: {
        ...prev[fourId],
        nom: fourNom,
        [champ]: valeur,
        // Après le spread pour ne pas être écrasé par prev[fourId].credit_veille = undefined
        credit_veille: prev[fourId]?.credit_veille ?? (fourn?.credit_veille ?? 0),
      }
    }))
  }

  function getCreditVeille(four) {
    const data = fournisseursGerantCaisse[four.id]
    if (data?.credit_veille !== undefined) return parseFloat(data.credit_veille) || 0
    return four.credit_veille || 0
  }

  function gererPhoto(setter, dossier) {
    async function executer(source) {
      setUploading(true)
      try {
        const url = source === 'camera'
          ? await prendrePhoto(dossier)
          : await choisirPhoto(dossier)
        if (url) setter(url)
      } finally {
        setUploading(false)
      }
    }

    if (Platform.OS === 'web') {
      executer('gallery')
    } else {
      Alert.alert(
        'Ajouter une photo',
        'Choisissez la source',
        [
          { text: 'Annuler', style: 'cancel' },
          { text: '📷 Caméra', onPress: () => executer('camera') },
          { text: '🖼 Galerie', onPress: () => executer('gallery') },
        ]
      )
    }
  }

  function fmt(n) { return Math.round(n).toLocaleString('fr-FR') + ' FCFA' }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.back}>‹ Retour</Text>
        </TouchableOpacity>
        <View>
          <Text style={styles.headerTitre}>Déductions Gérant</Text>
          <Text style={styles.headerSub}>Prélevées sur les espèces de caisse</Text>
        </View>
        <View style={{ width: 60 }} />
      </View>

      {uploading && (
        <View style={styles.uploadBanner}>
          <ActivityIndicator size="small" color="#fff" />
          <Text style={styles.uploadTxt}>Upload de la photo en cours...</Text>
        </View>
      )}

      {totalDepensesGerantCaisse() > 0 && (
        <View style={styles.totalBanner}>
          <Text style={styles.totalBannerLabel}>Total saisi</Text>
          <Text style={styles.totalBannerVal}>− {fmt(totalDepensesGerantCaisse())}</Text>
        </View>
      )}

      <ScrollView style={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

        {/* Bande Fournisseurs */}
        <TouchableOpacity style={styles.bandHeader} onPress={() => toggleSection('fournisseurs')}>
          <Text style={styles.bandTitre}>🏪 Fournisseurs</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {Object.keys(fournisseursGerantCaisse).length > 0 && (
              <Text style={styles.bandCount}>{Object.keys(fournisseursGerantCaisse).length} saisie(s)</Text>
            )}
            <Text style={styles.bandChevron}>{sectionsOuvertes.has('fournisseurs') ? '▲' : '▼'}</Text>
          </View>
        </TouchableOpacity>

        {sectionsOuvertes.has('fournisseurs') && (
          <View style={styles.bandContent}>
            {chargement ? (
              <ActivityIndicator size="small" color="#EF9F27" style={{ paddingVertical: 16 }} />
            ) : fournisseursList.length === 0 ? (
              <Text style={styles.bandVide}>Aucun fournisseur enregistré pour ce restaurant</Text>
            ) : (
              fournisseursList.map(four => {
                const data = fournisseursGerantCaisse[four.id] || {}
                const fourOpen = sectionsOuvertes.has(`four_${four.id}`)
                const creditV = getCreditVeille(four)
                const montFact = parseFloat(data.montant_facture) || 0
                const payé = parseFloat(data.paye) || 0
                const reste = creditV + montFact - payé
                return (
                  <View key={four.id}>
                    <TouchableOpacity style={styles.fourRow} onPress={() => toggleSection(`four_${four.id}`)}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.fourNom}>{four.nom}</Text>
                        {creditV !== 0 && (
                          <Text style={{ fontSize: 10, color: creditV < 0 ? '#3B6D11' : colors.textMuted, marginTop: 1 }}>
                            {creditV > 0 ? `Crédit total dû : ${fmt(creditV)}` : `Avance veille : ${fmt(Math.abs(creditV))}`}
                            {four.caissier_facture > 0 ? ` (dont facture caissier : ${fmt(four.caissier_facture)})` : ''}
                          </Text>
                        )}
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        {payé > 0 && (
                          <Text style={styles.fourMontant}>Payé {fmt(payé)}</Text>
                        )}
                        {data.photoUri && <Text style={{ fontSize: 12 }}>📷</Text>}
                        <Text style={styles.bandChevron}>{fourOpen ? '▲' : '▼'}</Text>
                      </View>
                    </TouchableOpacity>
                    {fourOpen && (
                      <View style={styles.fourDetails}>
                        <View style={styles.fourCreditRow}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.fourCreditLabel}>{creditV >= 0 ? 'Total dû (crédit)' : 'Avance veille'}</Text>
                            <Text style={{ fontSize: 10, color: colors.textMuted }}>
                              {four.caissier_facture > 0
                                ? `Veille + facture caissier ${fmt(four.caissier_facture)}`
                                : 'Calculé auto depuis jours précédents'}
                            </Text>
                          </View>
                          <Text style={[styles.fourCreditVal, creditV < 0 && { color: '#3B6D11' }]}>{fmt(Math.abs(creditV))}</Text>
                        </View>

                        <TextInput
                          style={styles.depInput}
                          value={data.facture_ref || ''}
                          onChangeText={v => updateFournisseurGerant(four.id, four.nom, 'facture_ref', v)}
                          placeholder="N° facture / référence (optionnel)"
                          placeholderTextColor="#bbb"
                        />
                        <TextInput
                          style={styles.depInput}
                          value={data.montant_facture || ''}
                          onChangeText={v => updateFournisseurGerant(four.id, four.nom, 'montant_facture', v)}
                          keyboardType="numeric"
                          placeholder="Montant facture du jour (FCFA)"
                          placeholderTextColor="#bbb"
                        />
                        <TextInput
                          style={[styles.depInput, { borderWidth: 1, borderColor: '#EF9F27' }]}
                          value={data.paye || ''}
                          onChangeText={v => updateFournisseurGerant(four.id, four.nom, 'paye', v)}
                          keyboardType="numeric"
                          placeholder="Montant payé ce jour (FCFA)"
                          placeholderTextColor="#bbb"
                        />

                        {(montFact > 0 || payé > 0 || creditV !== 0) && (
                          <View style={[styles.fourResteRow, {
                            backgroundColor: reste <= 0 ? '#EAF3DE' : '#FAEEDA',
                            borderColor: reste <= 0 ? '#3B6D11' : '#EF9F27',
                          }]}>
                            <Text style={[styles.fourResteLabel, { color: reste <= 0 ? '#3B6D11' : '#854F0B' }]}>
                              {reste <= 0 ? 'Avance payée' : 'Reste dû après paiement'}
                            </Text>
                            <Text style={[styles.fourResteVal, { color: reste <= 0 ? '#3B6D11' : '#A32D2D' }]}>
                              {fmt(Math.abs(reste))}
                            </Text>
                          </View>
                        )}

                        <View style={[styles.photoBlock, montFact > 0 && !data.photoUri && styles.photoBlockRequired]}>
                          <View style={styles.photoBlockHeader}>
                            <Text style={styles.photoBlockLabel}>
                              📷 Justificatif facture
                              {montFact > 0 && <Text style={{ color: '#A32D2D' }}> *</Text>}
                            </Text>
                            {data.photoUri ? (
                              <View style={styles.photoBadgeOk}><Text style={styles.photoBadgeOkTxt}>✅ OK</Text></View>
                            ) : montFact > 0 ? (
                              <View style={styles.photoBadgeReq}><Text style={styles.photoBadgeReqTxt}>⚠️ Requis</Text></View>
                            ) : null}
                          </View>
                          {data.photoUri && (
                            <Image source={{ uri: data.photoUri }} style={styles.photoPreview} resizeMode="cover" />
                          )}
                          <TouchableOpacity
                            style={styles.photoBtn}
                            onPress={() => gererPhoto(url => updateFournisseurGerant(four.id, four.nom, 'photoUri', url), 'depenses-gerant')}
                            disabled={uploading}
                          >
                            {uploading ? (
                              <ActivityIndicator size="small" color="#412402" />
                            ) : (
                              <Text style={styles.photoBtnTxt}>
                                {data.photoUri ? '🔄 Changer la photo' : '📷 Ajouter une photo'}
                              </Text>
                            )}
                          </TouchableOpacity>
                        </View>
                      </View>
                    )}
                  </View>
                )
              })
            )}
          </View>
        )}

        {/* Bandes catégories */}
        {[
          { key: CATEGORIES_DEPENSES[0], emoji: '🛒' },
          { key: CATEGORIES_DEPENSES[1], emoji: '🥦' },
          { key: CATEGORIES_DEPENSES[2], emoji: '🍊' },
          { key: CATEGORIES_DEPENSES[3], emoji: '📦' },
        ].map(({ key, emoji }) => {
          const lignes = depensesGerantCaisse[key] || []
          const isOpen = sectionsOuvertes.has(key)
          return (
            <View key={key}>
              <TouchableOpacity style={styles.bandHeader} onPress={() => toggleSection(key)}>
                <Text style={styles.bandTitre}>{emoji} {key}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  {lignes.length > 0 && (
                    <Text style={styles.bandCount}>{lignes.length} ligne(s)</Text>
                  )}
                  <Text style={styles.bandChevron}>{isOpen ? '▲' : '▼'}</Text>
                </View>
              </TouchableOpacity>
              {isOpen && (
                <View style={styles.bandContent}>
                  {lignes.map((ligne, i) => (
                    <View key={ligne.id || i} style={styles.ligneDepCard}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                        <Text style={styles.ligneDepNum}>Ligne {i + 1}</Text>
                        <TouchableOpacity onPress={() => supprimerLigneDep(key, i)}>
                          <Text style={{ color: '#993C1D', fontSize: 12, fontWeight: '500' }}>✕ Supprimer</Text>
                        </TouchableOpacity>
                      </View>
                      <TextInput
                        style={styles.depInput}
                        value={ligne.description || ''}
                        onChangeText={v => updateLigneDep(key, i, 'description', v)}
                        placeholder="Description"
                        placeholderTextColor="#bbb"
                      />
                      <TextInput
                        style={styles.depInput}
                        value={ligne.montant || ''}
                        onChangeText={v => updateLigneDep(key, i, 'montant', v)}
                        keyboardType="numeric"
                        placeholder="Montant (FCFA)"
                        placeholderTextColor="#bbb"
                      />
                    </View>
                  ))}
                  <TouchableOpacity style={styles.ajouterLigneBtn} onPress={() => ajouterLigneDep(key)}>
                    <Text style={styles.ajouterLigneTxt}>+ Ajouter une ligne</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )
        })}

        {/* Paies de salaire */}
        <TouchableOpacity style={styles.bandHeader} onPress={() => toggleSection('paies')}>
          <Text style={styles.bandTitre}>💵 Paies de salaire</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {paiesGerantCaisse.length > 0 && (
              <Text style={styles.bandCount}>{paiesGerantCaisse.length} ligne(s)</Text>
            )}
            <Text style={styles.bandChevron}>{sectionsOuvertes.has('paies') ? '▲' : '▼'}</Text>
          </View>
        </TouchableOpacity>

        {sectionsOuvertes.has('paies') && (
          <View style={styles.bandContent}>
            {paiesGerantCaisse.map((ligne, i) => (
              <View key={ligne.id || i} style={styles.ligneDepCard}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                  <Text style={styles.ligneDepNum}>Paie {i + 1}</Text>
                  <TouchableOpacity onPress={() => setPaiesGerantCaisse(prev => prev.filter((_, j) => j !== i))}>
                    <Text style={{ color: '#993C1D', fontSize: 12, fontWeight: '500' }}>✕ Supprimer</Text>
                  </TouchableOpacity>
                </View>
                {/* Sélecteur travailleur */}
                <TouchableOpacity style={styles.travSelectBtn} onPress={() => ouvrirSelecteurTravailleur(i)}>
                  <Text style={ligne.travailleur_nom ? styles.travSelectNom : styles.travSelectPlaceholder}>
                    {ligne.travailleur_nom || '👤 Sélectionner un travailleur…'}
                  </Text>
                  <Text style={styles.travSelectChevron}>›</Text>
                </TouchableOpacity>
                <TextInput
                  style={styles.depInput}
                  value={ligne.montant || ''}
                  onChangeText={v => setPaiesGerantCaisse(prev => prev.map((l, j) => j === i ? { ...l, montant: v } : l))}
                  keyboardType="numeric"
                  placeholder="Montant payé (FCFA)"
                  placeholderTextColor="#bbb"
                />
              </View>
            ))}
            <TouchableOpacity
              style={styles.ajouterLigneBtn}
              onPress={() => setPaiesGerantCaisse(prev => [
                ...prev,
                { id: Date.now().toString(), travailleur_id: null, travailleur_nom: '', montant: '' }
              ])}
            >
              <Text style={styles.ajouterLigneTxt}>+ Ajouter une paie</Text>
            </TouchableOpacity>
          </View>
        )}

        {totalDepensesGerantCaisse() > 0 && (
          <View style={styles.totalDepGerantCard}>
            <Text style={styles.totalDepGerantLabel}>Total dépenses gérant caisse</Text>
            <Text style={styles.totalDepGerantVal}>− {fmt(totalDepensesGerantCaisse())}</Text>
          </View>
        )}

        {/* Bouton Sauvegarder */}
        <TouchableOpacity
          style={[styles.sauvegarderBtn, saveStatus === 'saving' && { opacity: 0.6 }]}
          onPress={sauvegarder}
          disabled={saveStatus === 'saving'}
        >
          {saveStatus === 'saving' ? (
            <ActivityIndicator color="#412402" size="small" />
          ) : (
            <Text style={styles.sauvegarderTxt}>
              {saveStatus === 'ok' ? '✅ Sauvegardé' : saveStatus === 'error' ? '❌ Erreur — Réessayez' : '💾 Sauvegarder'}
            </Text>
          )}
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Modal sélection travailleur */}
      <Modal visible={modalPaie} transparent animationType="slide" onRequestClose={() => setModalPaie(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitre}>Sélectionner un travailleur</Text>
              <TouchableOpacity onPress={() => setModalPaie(false)}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              {travailleurs.length === 0 ? (
                <Text style={styles.travVide}>Aucun travailleur enregistré pour ce restaurant</Text>
              ) : (
                travailleurs.map(trav => {
                  const dejaSelectionne = paiesGerantCaisse.some(
                    (l, i) => i !== paieEditIndex && l.travailleur_id === trav.id
                  )
                  return (
                    <TouchableOpacity
                      key={trav.id}
                      style={[styles.travItem, dejaSelectionne && styles.travItemDejaPaye]}
                      onPress={() => !dejaSelectionne && selectionnerTravailleur(trav)}
                      disabled={dejaSelectionne}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.travItemNom, dejaSelectionne && { color: '#aaa' }]}>{trav.nom}</Text>
                        {trav.poste ? (
                          <Text style={styles.travItemPoste}>{trav.poste}</Text>
                        ) : null}
                      </View>
                      {dejaSelectionne && (
                        <Text style={styles.travItemDejaTag}>Déjà payé</Text>
                      )}
                    </TouchableOpacity>
                  )
                })
              )}
              <View style={{ height: 20 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

function makeStyles(colors) { return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    backgroundColor: '#EF9F27', padding: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'
  },
  back: { fontSize: 16, color: '#412402', fontWeight: '500' },
  headerTitre: { fontSize: 16, fontWeight: '600', color: '#412402', textAlign: 'center' },
  headerSub: { fontSize: 11, color: '#854F0B', textAlign: 'center' },
  uploadBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#EF9F27', padding: 8, paddingHorizontal: 14
  },
  uploadTxt: { fontSize: 12, color: '#412402', fontWeight: '500' },
  totalBanner: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#FAECE7', padding: 12, paddingHorizontal: 16,
    borderBottomWidth: 0.5, borderBottomColor: '#F09595'
  },
  totalBannerLabel: { fontSize: 13, color: '#993C1D', fontWeight: '500' },
  totalBannerVal: { fontSize: 15, fontWeight: '700', color: '#A32D2D' },
  body: { flex: 1, padding: 12 },
  bandHeader: {
    backgroundColor: colors.surface, borderRadius: 12, padding: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 2, marginTop: 6, borderWidth: 0.5, borderColor: colors.border
  },
  bandTitre: { fontSize: 14, fontWeight: '600', color: colors.text },
  bandChevron: { fontSize: 12, color: colors.textMuted },
  bandCount: {
    fontSize: 11, color: '#EF9F27', fontWeight: '600',
    backgroundColor: colors.orangeLight, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10
  },
  bandContent: {
    backgroundColor: colors.surfaceAlt, borderRadius: 12, padding: 12,
    marginBottom: 2, borderWidth: 0.5, borderColor: colors.border, borderTopWidth: 0, borderTopLeftRadius: 0, borderTopRightRadius: 0
  },
  bandVide: { fontSize: 12, color: colors.textPlaceholder, textAlign: 'center', paddingVertical: 12 },
  fourRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: colors.border
  },
  fourNom: { fontSize: 13, color: colors.text, fontWeight: '500' },
  fourMontant: { fontSize: 12, color: '#A32D2D', fontWeight: '600' },
  fourDetails: { paddingTop: 10, paddingBottom: 6 },
  fourCreditRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.primaryLight, borderRadius: 10, padding: 10, marginBottom: 8
  },
  fourCreditLabel: { fontSize: 12, fontWeight: '600', color: colors.primary },
  fourCreditVal: { fontSize: 14, fontWeight: '700', color: colors.primaryDark },
  fourResteRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderRadius: 10, padding: 10, marginBottom: 8, borderWidth: 1
  },
  fourResteLabel: { fontSize: 12, fontWeight: '500' },
  fourResteVal: { fontSize: 14, fontWeight: '700' },
  depInput: {
    backgroundColor: colors.bg, borderRadius: 10, padding: 11,
    fontSize: 14, color: colors.text, marginBottom: 8
  },
  ligneDepCard: {
    backgroundColor: colors.surface, borderRadius: 10, padding: 12,
    marginBottom: 8, borderWidth: 0.5, borderColor: colors.border
  },
  ligneDepNum: { fontSize: 12, fontWeight: '600', color: colors.textMuted },
  ajouterLigneBtn: {
    backgroundColor: '#EF9F27', borderRadius: 10, padding: 12,
    alignItems: 'center', marginTop: 6
  },
  ajouterLigneTxt: { fontSize: 13, fontWeight: '600', color: '#412402' },
  photoBlock: {
    marginTop: 10, backgroundColor: colors.surfaceAlt,
    borderRadius: 10, padding: 10, borderWidth: 0.5, borderColor: colors.border
  },
  photoBlockRequired: { backgroundColor: '#FAECE7', borderColor: '#F09595' },
  photoBlockHeader: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 8
  },
  photoBlockLabel: { fontSize: 12, color: colors.textSecondary, fontWeight: '500' },
  photoBadgeOk: { backgroundColor: '#EAF3DE', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  photoBadgeOkTxt: { fontSize: 10, color: '#3B6D11', fontWeight: '500' },
  photoBadgeReq: { backgroundColor: '#FAECE7', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  photoBadgeReqTxt: { fontSize: 10, color: '#993C1D', fontWeight: '500' },
  photoPreview: { width: '100%', height: 140, borderRadius: 10, marginBottom: 8 },
  photoBtn: { backgroundColor: '#EF9F27', borderRadius: 10, padding: 10, alignItems: 'center' },
  photoBtnTxt: { fontSize: 13, color: '#412402', fontWeight: '500' },
  totalDepGerantCard: {
    backgroundColor: '#FAECE7', borderRadius: 12, padding: 14,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: 12, marginBottom: 8, borderWidth: 1, borderColor: '#F09595'
  },
  totalDepGerantLabel: { fontSize: 13, color: '#993C1D', fontWeight: '500' },
  totalDepGerantVal: { fontSize: 16, fontWeight: '700', color: '#A32D2D' },
  sauvegarderBtn: {
    backgroundColor: '#EF9F27', borderRadius: 14, padding: 16,
    alignItems: 'center', marginTop: 8, marginBottom: 4,
  },
  sauvegarderTxt: { fontSize: 15, fontWeight: '700', color: '#412402' },
  // ── Sélecteur travailleur ──
  travSelectBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.bg, borderRadius: 10, padding: 12, marginBottom: 8,
    borderWidth: 1, borderColor: colors.primary
  },
  travSelectNom: { fontSize: 14, color: colors.text, fontWeight: '500', flex: 1 },
  travSelectPlaceholder: { fontSize: 14, color: colors.textPlaceholder, flex: 1 },
  travSelectChevron: { fontSize: 18, color: colors.primary, marginLeft: 6 },
  // ── Modal sélection ──
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end'
  },
  modalBox: {
    backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, maxHeight: '75%'
  },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 14
  },
  modalTitre: { fontSize: 16, fontWeight: '700', color: colors.text },
  modalClose: { fontSize: 18, color: colors.textMuted, padding: 4 },
  travItem: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 12, paddingHorizontal: 4,
    borderBottomWidth: 0.5, borderBottomColor: colors.borderLight
  },
  travItemDejaPaye: { opacity: 0.4 },
  travItemNom: { fontSize: 14, fontWeight: '600', color: colors.text },
  travItemPoste: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  travItemDejaTag: {
    fontSize: 10, color: '#3B6D11', backgroundColor: '#EAF3DE',
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, fontWeight: '600'
  },
  travVide: { fontSize: 13, color: colors.textPlaceholder, textAlign: 'center', paddingVertical: 20 },
}) }
