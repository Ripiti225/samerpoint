import { router } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import {
    ActivityIndicator,
    Alert,
    Image,
    SafeAreaView, ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native'
import { useApp } from '../context/AppContext'
import { useTheme } from '../context/ThemeContext'
import { saveOneTransactionFournisseur } from '../lib/api'
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
  const today = new Date().toISOString().split('T')[0]

  useEffect(() => {
    if (restaurantId) chargerFournisseurs()
  }, [restaurantId, pointId])

  async function chargerFournisseurs() {
    setLoading(true)

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
      const sourcePrio = { gerant_caissier: 3, gerant: 2, caissier: 1 }
      const fournIdsAll = (fourn || []).map(f => f.id)
      const fournCreditActuel = {}
      ;(fourn || []).forEach(f => { fournCreditActuel[f.id] = f.credit_actuel || 0 })
      // Filtre par fournisseur_id (robust même si restaurant_id=NULL sur les transactions)
      let prevQ = supabase
        .from('transactions_fournisseurs')
        .select('fournisseur_id, reste, saisi_par, point_id')
        .in('fournisseur_id', fournIdsAll)
      if (pointId) prevQ = prevQ.neq('point_id', pointId)
      const { data: prevTrans } = await prevQ

      // Récupérer les dates des points séparément (évite la jointure qui échoue silencieusement)
      const prevPointIds = [...new Set((prevTrans || []).map(t => t.point_id).filter(Boolean))]
      const { data: prevPoints } = prevPointIds.length
        ? await supabase.from('points').select('id, date').in('id', prevPointIds)
        : { data: [] }
      const prevDateByPoint = {}
      ;(prevPoints || []).forEach(p => { prevDateByPoint[p.id] = p.date })

      const prevMap = {}
      ;(prevTrans || []).forEach(t => {
        const date = prevDateByPoint[t.point_id] || ''
        const ex = prevMap[t.fournisseur_id]
        const tp = sourcePrio[t.saisi_par] || 0
        const ep = ex ? (sourcePrio[ex.saisi_par] || 0) : -1
        if (!ex || date > ex.date || (date === ex.date && tp > ep)) {
          prevMap[t.fournisseur_id] = { reste: t.reste, date, saisi_par: t.saisi_par }
        }
      })
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

  async function validerFournisseur(f) {
    if (!pointId) { Alert.alert('Erreur', 'Aucun point actif'); return }
    const t = getTransaction(f.id)
    if (parseFloat(t.facture) > 0 && !t.photoUri) {
      Alert.alert('Photo manquante', `Ajoutez une photo de la facture pour "${f.nom}" avant de valider.`)
      return
    }
    setSavingId(f.id)
    const credit = creditVeille(f.id)
    const saisiPar = roleActif === 'caissier' ? 'caissier' : 'gerant'
    const ok = await saveOneTransactionFournisseur(pointId, f.id, t, credit, saisiPar, userNom, restaurantId, userId, f.nom)
    if (ok) {
      const nouveauReste = credit + (parseFloat(t.facture) || 0) - (parseFloat(t.paye) || 0)
      // Ne mettre à jour credit_actuel que pour le gérant — les caissiers ne doivent pas écraser le solde officiel
      if (saisiPar !== 'caissier') {
        await supabase.from('fournisseurs').update({ credit_actuel: nouveauReste }).eq('id', f.id)
      }
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
        setFournisseursJour(prev => ({
          ...prev,
          [f.id]: { facture: '', paye: '', hasPhoto: prev[f.id]?.hasPhoto || false, photoUri: prev[f.id]?.photoUri || null },
        }))
      }
    }
    setSavingId(null)
    setValidatedIds(prev => new Set([...prev, f.id]))
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
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
                                  Facture {parseFloat(t.facture) > 0 && !t.photoUri ? '⚠️' : ''}
                                </Text>
                                <TextInput
                                  style={styles.input}
                                  value={t.facture}
                                  onChangeText={v => setTransaction(f.id, 'facture', v)}
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
                                  style={[styles.input, { backgroundColor: '#FAEEDA' }]}
                                  value={t.paye}
                                  onChangeText={v => setTransaction(f.id, 'paye', v)}
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
                            {(parseFloat(t.facture) > 0 || t.photoUri) && (
                              <View style={styles.photoRow}>
                                <TouchableOpacity style={[
                                  styles.photoBtn,
                                  parseFloat(t.facture) > 0 && !t.photoUri && styles.photoBtnRequired
                                ]} onPress={() => prendrePhoto(f.id)}>
                                  <Text style={styles.photoBtnTxt}>📷 Photo</Text>
                                </TouchableOpacity>
                                <TouchableOpacity style={[
                                  styles.photoBtn,
                                  parseFloat(t.facture) > 0 && !t.photoUri && styles.photoBtnRequired
                                ]} onPress={() => choisirPhoto(f.id)}>
                                  <Text style={styles.photoBtnTxt}>🖼 Galerie</Text>
                                </TouchableOpacity>
                                {t.photoUri && (
                                  <Image source={{ uri: t.photoUri }} style={styles.photoThumb} />
                                )}
                              </View>
                            )}

                            {/* Boutons photo quand pas encore de facture mais on peut quand même ajouter une photo */}
                            {!parseFloat(t.facture) && !t.photoUri && (
                              <View style={styles.photoRow}>
                                <TouchableOpacity style={styles.photoBtn} onPress={() => prendrePhoto(f.id)}>
                                  <Text style={styles.photoBtnTxt}>📷 Photo</Text>
                                </TouchableOpacity>
                                <TouchableOpacity style={styles.photoBtn} onPress={() => choisirPhoto(f.id)}>
                                  <Text style={styles.photoBtnTxt}>🖼 Galerie</Text>
                                </TouchableOpacity>
                              </View>
                            )}

                            {parseFloat(t.facture) > 0 && !t.photoUri && (
                              <Text style={styles.photoWarning}>⚠️ Photo de la facture obligatoire</Text>
                            )}

                            {/* Bouton Valider individuel */}
                            {(hasActivity || credit !== 0) && (
                              <TouchableOpacity
                                style={[
                                  styles.validerBtn,
                                  validatedIds.has(f.id) && styles.validerBtnDone,
                                  savingId === f.id && { opacity: 0.6 },
                                ]}
                                onPress={() => validerFournisseur(f)}
                                disabled={savingId === f.id}
                              >
                                <Text style={[styles.validerBtnTxt, validatedIds.has(f.id) && styles.validerBtnTxtDone]}>
                                  {savingId === f.id
                                    ? 'Enregistrement...'
                                    : validatedIds.has(f.id)
                                    ? '✅ Validé'
                                    : '✅ Valider'}
                                </Text>
                              </TouchableOpacity>
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
  resteVal: { fontSize: 13, fontWeight: '600', marginTop: 8 },
  readOnly: { fontSize: 13, fontWeight: '500', color: colors.text, marginTop: 8 },
  photoRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 4 },
  photoBtn: { backgroundColor: colors.inputBg, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  photoBtnRequired: { backgroundColor: '#FCEBEB', borderWidth: 1, borderColor: '#F09595' },
  photoBtnTxt: { fontSize: 12, color: colors.textSecondary },
  photoThumb: { width: 40, height: 40, borderRadius: 8 },
  photoWarning: { fontSize: 11, color: '#A32D2D', marginTop: 6, textAlign: 'center', fontWeight: '500' },
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
}) }
