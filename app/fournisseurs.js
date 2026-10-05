import { router } from 'expo-router'
import { retour } from '../lib/navigation'
import { useEffect, useMemo, useState } from 'react'
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
import PhotoJustificatif from '../components/PhotoJustificatif'
import { useApp } from '../context/AppContext'
import { useTheme } from '../context/ThemeContext'
import { saveOneTransactionFournisseur } from '../lib/api'
import { chargerDerniersRestes } from '../lib/derniersRestesFournisseurs'
import { appliquerFacturesMensuelles } from '../lib/facturesMensuelles'
import { estPhotoEnAttente, estPhotoValide } from '../lib/photoQueue'
import { usePhoto } from '../lib/usePhoto'
import { supabase } from '../lib/supabase'

export default function FournisseursScreen() {
  const {
    pointId, pointValide, fournisseursJour, dateJour,
    setFournisseursJour, estBloque, restaurantId, userId, userNom,
    postShiftReset, setPostShiftReset, roleActif,
  } = useApp()
  const { prendrePhoto: capturer, choisirPhoto: choisir } = usePhoto()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const [fournisseurs, setFournisseurs] = useState([])
  const [creditsVeille, setCreditsVeille] = useState({})
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState(null)
  const [validatedIds, setValidatedIds] = useState(new Set())
  const [savedAmounts, setSavedAmounts] = useState({})
  const today = new Date().toISOString().split('T')[0]

  useEffect(() => {
    if (restaurantId) chargerFournisseurs()
  }, [restaurantId, pointId])

  async function chargerFournisseurs() {
    setLoading(true)
    // Avant toute lecture : la facture mensuelle du 1er doit être dans la chaîne.
    await appliquerFacturesMensuelles(supabase)

    const fournQuery = supabase
      .from('fournisseurs')
      .select('id, nom, actif, credit_actuel')
      .eq('restaurant_id', restaurantId)
      .eq('actif', true)
      .order('nom')

    const transQuery = pointId
      ? supabase.from('transactions_fournisseurs').select('*').eq('point_id', pointId)
      : Promise.resolve({ data: [] })

    const [{ data: fourn }, { data: trans }] = await Promise.all([fournQuery, transQuery])

    setFournisseurs(fourn || [])

    const credits = {}
    ;(fourn || []).forEach(f => {
      credits[f.id] = f.credit_actuel ?? 0
    })

    // Après resetShift(), ne pas restaurer les anciennes données
    if (postShiftReset) {
      setPostShiftReset(false)
      setCreditsVeille(credits)
      setLoading(false)
      return
    }

    // Source de vérité pour le crédit du jour = reste de la transaction la plus récente
    // par DATE DE JOURNÉE (points.date), en excluant le point courant.
    // Priorité quand même date : gerant_caissier > gerant > caissier.
    // Garde-fou : si reste < 0 mais credit_actuel >= 0 → incohérence historique → fallback credit_actuel.
    {
      const fournIdsAll = (fourn || []).map(f => f.id)
      const fournCreditActuel = {}
      ;(fourn || []).forEach(f => { fournCreditActuel[f.id] = f.credit_actuel || 0 })
      // Filtre par fournisseur_id (robust même si restaurant_id=NULL sur les transactions).
      // Lecture paginée : non paginée, elle était coupée à 1 000 lignes.
      const prevMap = await chargerDerniersRestes(supabase, fournIdsAll, pointId)
      Object.entries(prevMap).forEach(([id, info]) => {
        // Si reste négatif alors que credit_actuel >= 0 : incohérence de données historiques
        // → utiliser credit_actuel (source de vérité corrigée par le gérant ou le bouton Fix)
        const ca = fournCreditActuel[id] || 0
        credits[id] = (info.reste < 0 && ca >= 0) ? ca : info.reste
      })
    }

    if (trans && trans.length > 0) {
      // Dédupliquer : préférer la saisie gérant
      const priorite = { gerant: 3, caissier: 2 }
      const dedup = {}
      trans.forEach(t => {
        const existing = dedup[t.fournisseur_id]
        if (!existing || (priorite[t.saisi_par] || 1) >= (priorite[existing.saisi_par] || 1)) {
          dedup[t.fournisseur_id] = t
        }
      })

      // Filtrer selon le rôle courant : ne jamais mélanger les transactions caissier
      // dans le contexte du gérant, ni l'inverse — chaque shift est indépendant
      const estCaissier = roleActif === 'caissier'
      const transactionsPropres = Object.values(dedup).filter(t => {
        if (!estCaissier) return t.saisi_par === 'gerant'
        if (t.saisi_par !== 'caissier') return false
        // Pour les caissiers : ne restaurer que les transactions du caissier courant
        if (userId && t.caissier_id) return t.caissier_id === userId
        if (userNom && t.caissier_nom) return t.caissier_nom === userNom
        return true
      })

      // Marquer "Validé" uniquement pour les transactions du rôle courant
      setValidatedIds(new Set(transactionsPropres.map(t => t.fournisseur_id)))

      // Back-calculer le crédit d'origine uniquement pour les transactions du rôle courant
      // pour bloquer le double-comptage si l'utilisateur valide à nouveau
      // reste = originalCredit + facture - paye  →  originalCredit = reste - facture + paye
      transactionsPropres.forEach(t => {
        credits[t.fournisseur_id] = (t.reste || 0) - (t.facture || 0) + (t.paye || 0)
      })

      // Restaurer les transactions déjà validées du rôle courant dans fournisseursJour
      // — uniquement pour les fournisseurs dont l'entrée locale est encore vide, afin de :
      // 1) ne jamais écraser une saisie en cours (en mémoire) de l'utilisateur
      // 2) ne jamais mélanger les transactions d'un autre caissier dont le shift est clôturé
      // Une vérification par fournisseur (plutôt que sur l'objet entier) est nécessaire car
      // après une validation, l'entrée locale est remise à vide puis persistée en session —
      // un objet "non vide" ne signifiait donc pas forcément "déjà restauré".
      if (transactionsPropres.length > 0) {
        setFournisseursJour(prev => {
          let changed = false
          const merged = { ...prev }
          transactionsPropres.forEach(t => {
            const existing = merged[t.fournisseur_id]
            // Seuls facture/payé sont remis à vide après validation (la photo est conservée) —
            // ne se baser que sur eux pour décider si une restauration est nécessaire.
            const estVide = !existing || (!existing.facture && !existing.paye)
            if (estVide) {
              merged[t.fournisseur_id] = {
                facture: String(t.facture ?? ''),
                paye: String(t.paye ?? ''),
                hasPhoto: !!t.photo_url,
                photoUri: t.photo_url || null,
                saved: true,
              }
              changed = true
            }
          })
          return changed ? merged : prev
        })
      }
    }

    setCreditsVeille(credits)
    setLoading(false)
  }

  function getTransaction(id) {
    return fournisseursJour[id] || { facture: '', paye: '', hasPhoto: false, photoUri: null }
  }

  function setTransaction(id, champ, valeur) {
    if (estBloque(pointValide)) return
    setFournisseursJour(prev => ({
      ...prev,
      [id]: { ...getTransaction(id), [champ]: valeur }
    }))
  }

  function creditVeille(id) {
    return creditsVeille[id] || 0
  }

  function restedu(id) {
    const t = getTransaction(id)
    return creditVeille(id) + (parseFloat(t.facture) || 0) - (parseFloat(t.paye) || 0)
  }

  function totalCredits() {
    return fournisseurs.reduce((sum, f) => sum + creditVeille(f.id), 0)
  }

  function totalFactures() {
    return fournisseurs.reduce((sum, f) => sum + (parseFloat(getTransaction(f.id).facture) || 0), 0)
  }

  function totalPaye() {
    return fournisseurs.reduce((sum, f) => sum + (parseFloat(getTransaction(f.id).paye) || 0), 0)
  }

  function totalReste() {
    return fournisseurs.reduce((sum, f) => sum + restedu(f.id), 0)
  }

  function fmt(n) { return Math.round(n).toLocaleString('fr-FR') + ' FCFA' }

  async function prendrePhoto(id) {
    const url = await capturer('fournisseurs')
    if (url) {
      setTransaction(id, 'hasPhoto', true)
      setTransaction(id, 'photoUri', url)
    }
  }

  async function choisirPhoto(id) {
    const url = await choisir('fournisseurs')
    if (url) {
      setTransaction(id, 'hasPhoto', true)
      setTransaction(id, 'photoUri', url)
    }
  }

  // Sauvegarde d'un fournisseur (cœur, sans Alert). Retourne { ok, raison, skip }.
  async function saveFournisseur(f) {
    const t = getTransaction(f.id)
    const factureAmount = parseFloat(t.facture) || 0
    const payeAmount = parseFloat(t.paye) || 0
    if (!factureAmount && !payeAmount) return { ok: true, skip: true }
    // Test volontairement strict : `!t.photoUri` acceptait une URI locale
    // (`file:///…`) et laissait passer une facture dont la photo n'existait sur
    // aucun serveur. Un jeton en attente reste accepté (travail hors ligne).
    if (factureAmount > 0 && !estPhotoValide(t.photoUri)) return { ok: false, raison: 'photo' }
    if (factureAmount > 0) {
      const saisiParCourant = roleActif === 'caissier' ? 'caissier' : 'gerant'
      const { data: existants } = await supabase
        .from('transactions_fournisseurs')
        .select('caissier_nom, saisi_par')
        .eq('point_id', pointId)
        .eq('fournisseur_id', f.id)
        .eq('facture', factureAmount)
      const doublon = (existants || []).find(tx => {
        const isOwn = tx.saisi_par === saisiParCourant &&
          (saisiParCourant === 'gerant' || tx.caissier_nom === userNom)
        return !isOwn
      })
      if (doublon) return { ok: false, raison: 'doublon' }
    }
    const credit = creditVeille(f.id)
    const saisiPar = roleActif === 'caissier' ? 'caissier' : 'gerant'
    const ok = await saveOneTransactionFournisseur(pointId, f.id, t, credit, saisiPar, userNom, restaurantId, userId, f.nom)
    if (ok) {
      const nouveauReste = credit + (parseFloat(t.facture) || 0) - (parseFloat(t.paye) || 0)
      // credit_actuel mis à jour pour TOUTE saisie (gérant ET caissier) : le solde officiel
      // doit toujours refléter la dernière transaction (plus de blocage caissier).
      await supabase.from('fournisseurs').update({ credit_actuel: nouveauReste }).eq('id', f.id)
      // Motif spécifique par rôle pour permettre la déduplication lors de la validation du shift caissier
      const motifPrefix = saisiPar === 'caissier'
        ? `caissier|${today}|`
        : `Journée du ${dateJour || today}: `
      const motifTexte = `${motifPrefix}facture ${Math.round(parseFloat(t.facture)||0).toLocaleString('fr-FR')} FCFA, payé ${Math.round(parseFloat(t.paye)||0).toLocaleString('fr-FR')} FCFA`
      // Séquencer delete puis insert pour éviter la race condition (fire-and-forget causait la perte de l'entrée)
      await supabase.from('historique_credit_fournisseurs')
        .delete()
        .eq('fournisseur_id', f.id)
        .eq('restaurant_id', restaurantId)
        .like('motif', `${motifPrefix}%`)
      await supabase.from('historique_credit_fournisseurs').insert({
        fournisseur_id: f.id,
        restaurant_id: restaurantId,
        point_id: pointId,
        source: saisiPar,
        ancien_credit: credit,
        nouveau_credit: nouveauReste,
        facture: parseFloat(t.facture) || 0,
        paye: parseFloat(t.paye) || 0,
        photo_url: t.photoUri || null,
        motif: motifTexte,
        modified_by: userId || null,
      })
      // Mettre à jour le crédit affiché immédiatement depuis Supabase
      const { data: updatedFourn } = await supabase
        .from('fournisseurs').select('credit_actuel').eq('id', f.id).maybeSingle()
      if (updatedFourn) {
        setFournisseurs(prev => prev.map(item =>
          item.id === f.id ? { ...item, credit_actuel: updatedFourn.credit_actuel } : item
        ))
        // Garder creditsVeille au crédit d'origine (avant la transaction du jour)
        // — évite le double-comptage si le gérant corrige et re-valide sur le même point
        setCreditsVeille(prev => ({ ...prev, [f.id]: credit }))
        // Conserver les montants à l'écran (verrouillés) au lieu de les vider.
        // Le marqueur `saved` évite qu'ils soient ré-enregistrés (ex. à la validation
        // du shift caissier → sinon doublon).
        setFournisseursJour(prev => ({
          ...prev,
          [f.id]: {
            facture: t.facture, paye: t.paye,
            hasPhoto: prev[f.id]?.hasPhoto || !!t.photoUri,
            photoUri: prev[f.id]?.photoUri || t.photoUri || null,
            saved: true,
          },
        }))
      }
    } else {
      return { ok: false, raison: 'erreur' }
    }
    setValidatedIds(prev => new Set([...prev, f.id]))
    setSavedAmounts(prev => ({ ...prev, [f.id]: { facture: factureAmount, paye: payeAmount } }))
    return { ok: true }
  }

  // Enregistrement global : sauvegarde en une fois tous les fournisseurs saisis.
  async function enregistrerTout() {
    if (!pointId) { Alert.alert('Erreur', 'Aucun point actif'); return }
    const aSauver = fournisseurs.filter(f => {
      const t = getTransaction(f.id)
      if (t.saved) return false // déjà enregistré → ne pas ré-enregistrer
      return (parseFloat(t.facture) || 0) > 0 || (parseFloat(t.paye) || 0) > 0
    })
    if (aSauver.length === 0) {
      Alert.alert('Rien à enregistrer', 'Saisissez au moins une facture ou un paiement.')
      return
    }
    // Photos obligatoires pour les factures > 0
    const sansPhoto = aSauver.filter(f => {
      const t = getTransaction(f.id)
      return (parseFloat(t.facture) || 0) > 0 && !estPhotoValide(t.photoUri)
    })
    if (sansPhoto.length) {
      Alert.alert('Photo manquante', `Ajoutez une photo de la facture pour :\n${sansPhoto.map(f => `• ${f.nom}`).join('\n')}`)
      return
    }
    setSavingId('ALL')
    let nbOk = 0
    const doublons = []
    for (const f of aSauver) {
      const r = await saveFournisseur(f)
      if (r.ok && !r.skip) nbOk++
      else if (r.raison === 'doublon') doublons.push(f.nom)
    }
    setSavingId(null)
    let msg = `${nbOk} fournisseur(s) enregistré(s).`
    if (doublons.length) msg += `\n\n🚫 Ignorés (facture en double) : ${doublons.join(', ')}.`
    Alert.alert('✅ Enregistrement terminé', msg)
  }

  // Suppression volontaire d'une transaction fournisseur déjà enregistrée sur ce point.
  // Le crédit revient au solde d'avant la transaction (creditVeille).
  async function supprimerFournisseur(f) {
    if (!pointId) { Alert.alert('Erreur', 'Aucun point actif'); return }
    Alert.alert(
      'Supprimer la transaction ?',
      `Annuler la facture/paiement enregistré pour "${f.nom}" sur ce point ?\n\nLe crédit reviendra au solde précédent.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: '🗑 Supprimer', style: 'destructive',
          onPress: async () => {
            setSavingId(f.id)
            const saisiPar = roleActif === 'caissier' ? 'caissier' : 'gerant'

            // 1) Supprimer la transaction du point pour ce fournisseur / rôle courant
            let delQ = supabase.from('transactions_fournisseurs')
              .delete()
              .eq('point_id', pointId)
              .eq('fournisseur_id', f.id)
              .eq('saisi_par', saisiPar)
            if (saisiPar === 'caissier') {
              if (userId) delQ = delQ.eq('caissier_id', userId)
              else if (userNom) delQ = delQ.eq('caissier_nom', userNom)
            }
            await delQ

            // 2) Rétablir credit_actuel au solde d'avant (gérant ET caissier) : la suppression
            // d'une transaction doit toujours ramener le solde officiel à sa valeur précédente.
            const creditAvant = creditVeille(f.id)
            await supabase.from('fournisseurs').update({ credit_actuel: creditAvant }).eq('id', f.id)
            setFournisseurs(prev => prev.map(item =>
              item.id === f.id ? { ...item, credit_actuel: creditAvant } : item
            ))

            // 3) Supprimer les lignes d'historique de cette transaction
            const motifPrefix = saisiPar === 'caissier' ? `caissier|${today}|` : `Journée du ${dateJour || today}: `
            await supabase.from('historique_credit_fournisseurs')
              .delete()
              .eq('fournisseur_id', f.id)
              .eq('restaurant_id', restaurantId)
              .like('motif', `${motifPrefix}%`)

            // 4) Réinitialiser l'état local
            setValidatedIds(prev => { const n = new Set(prev); n.delete(f.id); return n })
            setSavedAmounts(prev => { const n = { ...prev }; delete n[f.id]; return n })
            setFournisseursJour(prev => ({
              ...prev,
              [f.id]: { facture: '', paye: '', hasPhoto: false, photoUri: null },
            }))
            setSavingId(null)
          },
        },
      ]
    )
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => retour()}>
            <Text style={styles.back}>‹ Retour</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitre}>Fournisseurs</Text>
          <View style={{ width: 60 }} />
        </View>
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#EF9F27" />
          <Text style={styles.loadingTxt}>Chargement des fournisseurs...</Text>
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
          <Text style={styles.headerTitre}>Fournisseurs</Text>
          <Text style={styles.headerSub}>{fournisseurs.length} fournisseurs</Text>
        </View>
        <View style={styles.totalBadge}>
          <Text style={styles.totalBadgeTxt}>{fmt(totalPaye())}</Text>
        </View>
      </View>

      {pointValide && (
        <View style={styles.valideBanner}>
          <Text style={styles.valideTxt}>🔒 Point validé — lecture seule</Text>
        </View>
      )}

      <ScrollView style={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {fournisseurs.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyTxt}>Aucun fournisseur actif</Text>
            <Text style={styles.emptySub}>Ajoutez des fournisseurs dans les paramètres</Text>
          </View>
        ) : (
          <>
            {[
              { label: '🔴 Fournisseurs', filtre: f => (creditsVeille[f.id] ?? 0) >= 0 },
              { label: '🟢 Cotisations',  filtre: f => (creditsVeille[f.id] ?? 0) < 0 },
            ].map(({ label, filtre }) => {
              const liste = fournisseurs.filter(filtre)
              if (liste.length === 0) return null
              return (
                <View key={label}>
                  <Text style={styles.sectionTitre}>{label}</Text>
                  {liste.map(f => {
                    const t = getTransaction(f.id)
                    const credit = creditVeille(f.id)
                    const reste = restedu(f.id)
                    const hasActivity = t.facture || t.paye
                    const hasDebt = reste > 0
                    const isCotisation = credit < 0

                    return (
                      <View key={f.id} style={[
                        styles.fournCard,
                        hasDebt && styles.fournCardDue,
                        !hasDebt && (hasActivity || credit !== 0) && styles.fournCardOk,
                      ]}>
                        <View style={styles.fournHeader}>
                          <View style={[styles.typeBadge, { backgroundColor: isCotisation ? '#E6F1FB' : '#FAEEDA' }]}>
                            <Text style={[styles.typeTxt, { color: isCotisation ? '#185FA5' : '#854F0B' }]}>
                              {isCotisation ? '🟢 Cotis.' : '🔴 Fourn.'}
                            </Text>
                          </View>
                          <Text style={styles.fournNom}>{f.nom}</Text>
                          {credit > 0 && (
                            <View style={styles.creditBadge}>
                              <Text style={styles.creditBadgeTxt}>💳 {fmt(credit)}</Text>
                            </View>
                          )}
                          {credit < 0 && (
                            <View style={styles.prepayBadge}>
                              <Text style={styles.prepayBadgeTxt}>✅ {fmt(Math.abs(credit))} avance</Text>
                            </View>
                          )}
                          {t.hasPhoto && <View style={styles.photoBadge}><Text style={styles.photoTxt}>📷</Text></View>}
                        </View>

                        {credit > 0 && (
                          <View style={styles.creditBanner}>
                            <Text style={styles.creditLabel}>Crédit reporté (veille)</Text>
                            <Text style={styles.creditVal}>{fmt(credit)}</Text>
                          </View>
                        )}
                        {credit < 0 && (
                          <View style={[styles.creditBanner, { backgroundColor: '#EAF3DE', borderColor: '#C0DD97' }]}>
                            <Text style={[styles.creditLabel, { color: '#3B6D11' }]}>Avance payée (veille)</Text>
                            <Text style={[styles.creditVal, { color: '#3B6D11' }]}>{fmt(Math.abs(credit))}</Text>
                          </View>
                        )}

                        {!estBloque(pointValide) && (
                          <>
                            <View style={styles.inputsRow}>
                              <View style={styles.inputBox}>
                                <Text style={styles.inputLabel}>
                                  Facture {parseFloat(t.facture) > 0 && !estPhotoValide(t.photoUri) ? '⚠️' : ''}
                                </Text>
                                <TextInput
                                  style={[styles.input, t.saved && styles.inputLocked]}
                                  value={t.facture}
                                  onChangeText={v => setTransaction(f.id, 'facture', v)}
                                  editable={!t.saved}
                                  keyboardType="numeric"
                                  placeholder="0"
                                  placeholderTextColor="#bbb"
                                />
                              </View>
                              <View style={styles.inputBox}>
                                <Text style={styles.inputLabel}>
                                  Payé
                                </Text>
                                <TextInput
                                  style={[styles.input, { backgroundColor: '#FAEEDA' }, t.saved && styles.inputLocked]}
                                  value={t.paye}
                                  onChangeText={v => setTransaction(f.id, 'paye', v)}
                                  editable={!t.saved}
                                  keyboardType="numeric"
                                  placeholder="0"
                                  placeholderTextColor="#bbb"
                                />
                              </View>
                              <View style={styles.inputBox}>
                                <Text style={styles.inputLabel}>Reste dû</Text>
                                <Text style={[styles.resteVal, {
                                  color: reste > 0 ? '#A32D2D' : reste < 0 ? '#185FA5' : '#3B6D11'
                                }]}>
                                  {(hasActivity || credit > 0) ? fmt(reste) : '—'}
                                </Text>
                              </View>
                            </View>

                            {/* Photo obligatoire si facture saisie, optionnelle sinon */}
                            {(parseFloat(t.facture) > 0 || estPhotoValide(t.photoUri)) && (
                              <View style={styles.photoRow}>
                                <TouchableOpacity style={[
                                  styles.photoBtn,
                                  parseFloat(t.facture) > 0 && !estPhotoValide(t.photoUri) && styles.photoBtnRequired
                                ]} onPress={() => prendrePhoto(f.id)}>
                                  <Text style={styles.photoBtnTxt}>📷 Photo</Text>
                                </TouchableOpacity>
                                <TouchableOpacity style={[
                                  styles.photoBtn,
                                  parseFloat(t.facture) > 0 && !estPhotoValide(t.photoUri) && styles.photoBtnRequired
                                ]} onPress={() => choisirPhoto(f.id)}>
                                  <Text style={styles.photoBtnTxt}>🖼 Galerie</Text>
                                </TouchableOpacity>
                                {estPhotoEnAttente(t.photoUri)
                                  ? <Text style={styles.photoAttente}>⏳ envoi en attente</Text>
                                  : estPhotoValide(t.photoUri) && (
                                      <PhotoJustificatif uri={t.photoUri} style={styles.photoThumb} compact />
                                    )}
                              </View>
                            )}

                            {/* Boutons photo quand pas encore de facture mais on peut quand même ajouter une photo */}
                            {!parseFloat(t.facture) && !estPhotoValide(t.photoUri) && (
                              <View style={styles.photoRow}>
                                <TouchableOpacity style={styles.photoBtn} onPress={() => prendrePhoto(f.id)}>
                                  <Text style={styles.photoBtnTxt}>📷 Photo</Text>
                                </TouchableOpacity>
                                <TouchableOpacity style={styles.photoBtn} onPress={() => choisirPhoto(f.id)}>
                                  <Text style={styles.photoBtnTxt}>🖼 Galerie</Text>
                                </TouchableOpacity>
                              </View>
                            )}

                            {parseFloat(t.facture) > 0 && !estPhotoValide(t.photoUri) && (
                              <Text style={styles.photoWarning}>⚠️ Photo de la facture obligatoire</Text>
                            )}

                            {/* Statut + suppression — l'enregistrement se fait via le bouton global en bas */}
                            {validatedIds.has(f.id) && (
                              <>
                                <View style={[styles.validerBtn, styles.validerBtnDone]}>
                                  <Text style={styles.validerBtnTxtDone}>✅ Enregistré</Text>
                                </View>
                                {savedAmounts[f.id] && (savedAmounts[f.id].facture > 0 || savedAmounts[f.id].paye > 0) && (
                                  <Text style={styles.savedAmountTxt}>
                                    {savedAmounts[f.id].facture > 0 ? `Facture : ${fmt(savedAmounts[f.id].facture)}` : ''}
                                    {savedAmounts[f.id].facture > 0 && savedAmounts[f.id].paye > 0 ? '  •  ' : ''}
                                    {savedAmounts[f.id].paye > 0 ? `Payé : ${fmt(savedAmounts[f.id].paye)}` : ''}
                                  </Text>
                                )}
                                <TouchableOpacity
                                  style={styles.supprimerBtn}
                                  onPress={() => supprimerFournisseur(f)}
                                  disabled={!!savingId}
                                >
                                  <Text style={styles.supprimerBtnTxt}>🗑 Supprimer la transaction</Text>
                                </TouchableOpacity>
                              </>
                            )}
                          </>
                        )}

                        {estBloque(pointValide) && (hasActivity || credit !== 0) && (
                          <View style={styles.inputsRow}>
                            <View style={styles.inputBox}>
                              <Text style={styles.inputLabel}>Facture</Text>
                              <Text style={styles.readOnly}>{fmt(parseFloat(t.facture) || 0)}</Text>
                            </View>
                            <View style={styles.inputBox}>
                              <Text style={styles.inputLabel}>Payé</Text>
                              <Text style={styles.readOnly}>{fmt(parseFloat(t.paye) || 0)}</Text>
                            </View>
                            <View style={styles.inputBox}>
                              <Text style={styles.inputLabel}>Reste dû</Text>
                              <Text style={[styles.readOnly, { color: reste > 0 ? '#A32D2D' : '#3B6D11' }]}>{fmt(reste)}</Text>
                            </View>
                          </View>
                        )}
                      </View>
                    )
                  })}
                </View>
              )
            })}

            <View style={styles.recapCard}>
              <Text style={styles.recapTitre}>Récapitulatif</Text>
              {totalCredits() > 0 && (
                <View style={styles.recapRow}>
                  <Text style={styles.recapLabel}>Crédits reportés (veille)</Text>
                  <Text style={[styles.recapVal, { color: '#A32D2D' }]}>{fmt(totalCredits())}</Text>
                </View>
              )}
              <View style={styles.recapRow}>
                <Text style={styles.recapLabel}>Total factures du jour</Text>
                <Text style={styles.recapVal}>{fmt(totalFactures())}</Text>
              </View>
              <View style={styles.recapRow}>
                <Text style={styles.recapLabel}>Total payé</Text>
                <Text style={[styles.recapVal, { color: '#EF9F27', fontWeight: '600' }]}>{fmt(totalPaye())}</Text>
              </View>
              <View style={[styles.recapRow, { borderBottomWidth: 0 }]}>
                <Text style={[styles.recapLabel, { fontWeight: '600', color: '#1a1a1a' }]}>Total reste dû</Text>
                <Text style={[styles.recapVal, { color: totalReste() > 0 ? '#A32D2D' : '#3B6D11', fontWeight: '600', fontSize: 15 }]}>
                  {fmt(totalReste())}
                </Text>
              </View>
            </View>
          </>
        )}

        {/* Boutons de validation individuels — affichés via les cartes fournisseurs */}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Enregistrement global — une seule sauvegarde pour tous les fournisseurs */}
      {!estBloque(pointValide) && (
        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.enregistrerBtn, savingId === 'ALL' && { opacity: 0.6 }]}
            onPress={enregistrerTout}
            disabled={savingId === 'ALL'}
          >
            <Text style={styles.enregistrerBtnTxt}>
              {savingId === 'ALL' ? 'Enregistrement…' : '💾 Enregistrer'}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  )
}

function makeStyles(colors) { return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { backgroundColor: '#EF9F27', padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: { fontSize: 16, color: '#412402', fontWeight: '500' },
  headerTitre: { fontSize: 16, fontWeight: '600', color: '#412402', textAlign: 'center' },
  headerSub: { fontSize: 11, color: '#854F0B', textAlign: 'center' },
  totalBadge: { backgroundColor: '#BA7517', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  totalBadgeTxt: { fontSize: 11, color: '#FAEEDA', fontWeight: '500' },
  valideBanner: { backgroundColor: '#FAECE7', padding: 10, alignItems: 'center' },
  valideTxt: { fontSize: 12, color: '#993C1D', fontWeight: '500' },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingTxt: { fontSize: 13, color: colors.textMuted, marginTop: 12 },
  body: { flex: 1, padding: 14 },
  emptyBox: { alignItems: 'center', paddingVertical: 40 },
  emptyTxt: { fontSize: 14, color: colors.textMuted, fontWeight: '500' },
  emptySub: { fontSize: 12, color: colors.textPlaceholder, marginTop: 6 },
  sectionTitre: { fontSize: 12, fontWeight: '600', color: colors.textMuted, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  fournCard: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 0.5, borderColor: colors.border },
  fournCardDue: { borderColor: '#F09595', backgroundColor: '#FCEBEB' },
  fournCardOk: { borderColor: '#C0DD97', backgroundColor: '#F4FAF0' },
  fournHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  typeBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  typeTxt: { fontSize: 10, fontWeight: '500' },
  fournNom: { fontSize: 14, fontWeight: '600', color: colors.text, flex: 1 },
  photoBadge: { backgroundColor: '#E6F1FB', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  photoTxt: { fontSize: 12 },
  creditBadge: { backgroundColor: colors.warningLight, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 0.5, borderColor: '#EF9F27' },
  creditBadgeTxt: { fontSize: 10, color: '#854F0B', fontWeight: '600' },
  prepayBadge: { backgroundColor: '#EAF3DE', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 0.5, borderColor: '#C0DD97' },
  prepayBadgeTxt: { fontSize: 10, color: '#3B6D11', fontWeight: '600' },
  creditBanner: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.warningLight, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, marginBottom: 10 },
  creditLabel: { fontSize: 11, color: colors.warningDark, fontWeight: '500' },
  creditVal: { fontSize: 13, fontWeight: '700', color: '#A32D2D' },
  inputsRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  inputBox: { flex: 1, alignItems: 'center' },
  inputLabel: { fontSize: 10, color: colors.textMuted, marginBottom: 4 },
  input: { width: '100%', backgroundColor: colors.inputBg, borderRadius: 8, padding: 8, fontSize: 13, textAlign: 'center', color: colors.text },
  inputLocked: { opacity: 0.55 },
  resteVal: { fontSize: 13, fontWeight: '600', marginTop: 8 },
  readOnly: { fontSize: 13, fontWeight: '500', color: colors.text, marginTop: 8 },
  photoRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 4 },
  photoBtn: { backgroundColor: colors.inputBg, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  photoBtnRequired: { backgroundColor: '#FCEBEB', borderWidth: 1, borderColor: '#F09595' },
  photoBtnTxt: { fontSize: 12, color: colors.textSecondary },
  photoThumb: { width: 40, height: 40, borderRadius: 8 },
  photoWarning: { fontSize: 11, color: '#A32D2D', marginTop: 6, textAlign: 'center', fontWeight: '500' },
  photoAttente: { fontSize: 11, color: colors.textMuted, fontWeight: '500' },
  recapCard: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, marginBottom: 14, borderWidth: 0.5, borderColor: colors.border },
  recapTitre: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: 12 },
  recapRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7, borderBottomWidth: 0.5, borderBottomColor: colors.bg },
  recapLabel: { fontSize: 13, color: colors.textMuted },
  recapVal: { fontSize: 13, fontWeight: '500', color: colors.text },
  saveBtn: { backgroundColor: '#EF9F27', borderRadius: 14, padding: 16, alignItems: 'center', marginBottom: 10 },
  saveTxt: { fontSize: 15, fontWeight: '600', color: '#412402' },
  validerBtn: { marginTop: 10, backgroundColor: '#EF9F27', borderRadius: 10, padding: 10, alignItems: 'center' },
  validerBtnDone: { backgroundColor: '#EAF3DE' },
  validerBtnTxt: { fontSize: 13, fontWeight: '600', color: '#412402' },
  validerBtnTxtDone: { color: '#3B6D11' },
  savedAmountTxt: { fontSize: 11, color: colors.textMuted, textAlign: 'center', marginTop: 4 },
  supprimerBtn: { marginTop: 8, backgroundColor: '#FAECE7', borderRadius: 10, padding: 9, alignItems: 'center', borderWidth: 0.5, borderColor: '#E0A99B' },
  supprimerBtnTxt: { fontSize: 12, fontWeight: '600', color: '#A32D2D' },
  footer: { backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border, padding: 12 },
  enregistrerBtn: { backgroundColor: '#3B6D11', borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  enregistrerBtnTxt: { fontSize: 16, fontWeight: '700', color: '#fff' },
}) }
