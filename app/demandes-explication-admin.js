import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, Linking, Platform, SafeAreaView, ScrollView, Text, TouchableOpacity, View } from 'react-native'
import { CarteExplication } from '../components/demandes/Cartes'
import { Bouton, Champ, Compteurs, EnTete, Feuille, Libelle, Puces, Recherche, Vide, useDemandesStyles } from '../components/ui/EcranModerne'
import { useApp } from '../context/AppContext'
import { COULEURS_ETAPES, ETAPES_EXPLICATION, VIOLET, compterExplications, filtrerExplications } from '../lib/demandes'
import { journaliser } from '../lib/journal'
import { creerNotification } from '../lib/notificationsInterne'
import { envoyerNotifExplicationStatut } from '../lib/notifications'
import { genererPdfExplication } from '../lib/pdfDocuments'
import { supabase } from '../lib/supabase'

export default function DemandesExplicationAdminScreen() {
  const { userId, userNom, roleActif } = useApp()
  const { styles, colors, accent } = useDemandesStyles()
  // Arrivée depuis une notification « sans réponse » : onglet + étape imposés.
  const { onglet: ongletParam, etape: etapeParam } = useLocalSearchParams()

  const [onglet, setOnglet] = useState(ongletParam === 'miennes' ? 'miennes' : 'recues') // 'recues' | 'miennes'
  const [demandes, setDemandes] = useState([])
  const [restaurants, setRestaurants] = useState([])
  const [restoFilter, setRestoFilter] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Filtres de la liste (compteurs par étape cliquables + recherche)
  const [etape, setEtape] = useState(ETAPES_EXPLICATION.some(e => e.cle && e.cle === etapeParam) ? etapeParam : null)
  const [recherche, setRecherche] = useState('')
  const comptes = useMemo(() => compterExplications(demandes), [demandes])
  const visibles = useMemo(() => filtrerExplications(demandes, { etape, recherche }), [demandes, etape, recherche])

  // Modals action
  const [demandeEnCours, setDemandeEnCours] = useState(null)
  const [showRefus, setShowRefus] = useState(false)
  const [motifRefus, setMotifRefus] = useState('')
  const [showReponse, setShowReponse] = useState(false)
  const [noteReponse, setNoteReponse] = useState('')

  // Modal création (mes demandes)
  const [showCreer, setShowCreer] = useState(false)
  const [creerResto, setCreerResto] = useState(null)
  const [travailleurs, setTravailleurs] = useState([])
  const [formTrav, setFormTrav] = useState(null)
  const [formMotif, setFormMotif] = useState('')
  const [formDesc, setFormDesc] = useState('')

  useEffect(() => { chargerRestaurants() }, [])
  useEffect(() => { charger() }, [onglet, restoFilter])

  async function chargerRestaurants() {
    const { data } = await supabase.from('restaurants').select('id, nom').order('nom')
    setRestaurants(data || [])
  }

  async function charger() {
    setLoading(true)
    let q = supabase.from('demandes_explication').select('*').order('created_at', { ascending: false })
    // « Reçues » = demandes à examiner, émises par un rôle non-admin : le gérant,
    // et le vérificateur (demande automatique quand ≥ 40 % des produits comptés
    // sont en écart). Sans 'verificateur' ici, ces demandes n'apparaissaient
    // dans aucun des deux onglets.
    if (onglet === 'recues') q = q.in('cree_par_role', ['gerant', 'verificateur'])
    else q = q.eq('cree_par_id', userId)
    if (restoFilter) q = q.eq('restaurant_id', restoFilter)
    const { data } = await q
    setDemandes(data || [])
    setLoading(false)
  }

  // ── Acceptation ──
  async function accepter(d) {
    if (saving) return
    setSaving(true)
    const now = new Date().toISOString()
    await supabase.from('demandes_explication').update({
      statut: 'acceptee', accepte_par_id: userId, accepte_par_nom: userNom, accepte_at: now,
    }).eq('id', d.id)
    notifierGerant(d, 'acceptee')
    journaliser({ action: 'explication_acceptee', details: `${d.travailleur_nom}`, userId, restaurantId: d.restaurant_id }).catch(() => {})
    setSaving(false)
    charger()
  }

  function ouvrirRefus(d) { setDemandeEnCours(d); setMotifRefus(''); setShowRefus(true) }
  async function confirmerRefus() {
    if (!motifRefus.trim()) return Alert.alert('Erreur', 'Le motif du refus est obligatoire')
    setSaving(true)
    await supabase.from('demandes_explication').update({
      statut: 'refusee', refus_motif: motifRefus.trim(), refuse_par_nom: userNom, refuse_at: new Date().toISOString(),
    }).eq('id', demandeEnCours.id)
    notifierGerant(demandeEnCours, 'refusee')
    journaliser({ action: 'explication_refusee', details: `${demandeEnCours.travailleur_nom} — ${motifRefus.trim()}`, userId, restaurantId: demandeEnCours.restaurant_id }).catch(() => {})
    setSaving(false); setShowRefus(false); setDemandeEnCours(null); charger()
  }

  // ── Marquer envoyée ──
  async function marquerEnvoyee(d) {
    if (saving) return
    setSaving(true)
    await supabase.from('demandes_explication').update({
      statut: 'envoyee', envoyee_par_id: userId, envoyee_par_nom: userNom, envoyee_at: new Date().toISOString(),
    }).eq('id', d.id)
    journaliser({ action: 'explication_envoyee', details: `${d.travailleur_nom}`, userId, restaurantId: d.restaurant_id }).catch(() => {})
    setSaving(false)
    charger()
  }

  // ── Réponse récupérée ──
  function ouvrirReponse(d) { setDemandeEnCours(d); setNoteReponse(''); setShowReponse(true) }
  async function confirmerReponse() {
    setSaving(true)
    await supabase.from('demandes_explication').update({
      statut: 'reponse_recuperee', reponse_recuperee_par: userNom,
      reponse_recuperee_at: new Date().toISOString(), reponse_note: noteReponse.trim() || null,
    }).eq('id', demandeEnCours.id)
    journaliser({ action: 'explication_reponse', details: `${demandeEnCours.travailleur_nom}`, userId, restaurantId: demandeEnCours.restaurant_id }).catch(() => {})
    setSaving(false); setShowReponse(false); setDemandeEnCours(null); charger()
  }

  // ── Relancer (2e demande) ──
  function confirmerRelance(d) {
    Alert.alert(
      'Relancer ?',
      `Aucune réponse de ${d.travailleur_nom}. Une 2ᵉ demande d'explication sera créée et marquée envoyée.`,
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Relancer', style: 'destructive', onPress: () => relancer(d) },
      ],
    )
  }
  async function relancer(d) {
    if (saving) return
    setSaving(true)
    const now = new Date().toISOString()
    // L'originale devient terminale
    await supabase.from('demandes_explication').update({ statut: 'relancee' }).eq('id', d.id)
    // 2e demande, directement envoyée
    await supabase.from('demandes_explication').insert({
      restaurant_id: d.restaurant_id,
      travailleur_id: d.travailleur_id,
      travailleur_nom: d.travailleur_nom,
      travailleur_poste: d.travailleur_poste,
      motif: d.motif,
      description: d.description,
      statut: 'envoyee',
      numero: (d.numero || 1) + 1,
      relance_de: d.id,
      cree_par_id: d.cree_par_id,
      cree_par_nom: d.cree_par_nom,
      cree_par_role: d.cree_par_role,
      accepte_par_id: userId, accepte_par_nom: userNom, accepte_at: now,
      envoyee_par_id: userId, envoyee_par_nom: userNom, envoyee_at: now,
    })
    creerNotification({
      type: 'explication_relance',
      titre: 'Relance explication',
      message: `🔁 2ᵉ demande envoyée à ${d.travailleur_nom}`,
      restaurant_id: d.restaurant_id,
      cible_role: ['directeur', 'rh', 'manager'],
      cible_user_id: d.cree_par_id,
      created_by: userId,
      screen: 'demandes-explication-admin',
    }).catch(() => {})
    journaliser({ action: 'explication_relance', details: `${d.travailleur_nom} (2e demande)`, userId, restaurantId: d.restaurant_id }).catch(() => {})
    setSaving(false)
    charger()
  }

  function notifierGerant(d, statut) {
    creerNotification({
      type: statut === 'refusee' ? 'explication_refusee' : 'explication_acceptee',
      titre: statut === 'refusee' ? 'Explication refusée' : 'Explication acceptée',
      message: `${statut === 'refusee' ? '❌' : '✅'} ${d.travailleur_nom} — par ${userNom}`,
      restaurant_id: d.restaurant_id,
      cible_user_id: d.cree_par_id,
      created_by: userId,
      screen: 'demandes-explication',
    }).catch(() => {})
    envoyerNotifExplicationStatut(d.travailleur_nom, statut, d.cree_par_id).catch(() => {})
  }

  function voirFichier(url) {
    if (!url) return
    if (Platform.OS === 'web') window.open(url, '_blank')
    else Linking.openURL(url).catch(() => Alert.alert('Erreur', "Impossible d'ouvrir le fichier"))
  }

  async function imprimerPdf(d) {
    const restoNom = restaurants.find(r => r.id === d.restaurant_id)?.nom || ''
    try {
      await genererPdfExplication({
        travailleurNom: d.travailleur_nom, poste: d.travailleur_poste, restaurantNom: restoNom,
        motif: d.motif, description: d.description, date: d.envoyee_at || d.created_at,
      })
    } catch (_e) { Alert.alert('Erreur', 'Impossible de générer le PDF') }
  }

  // ── Création (mes demandes) : auto-acceptée ──
  async function ouvrirCreer() {
    setCreerResto(null); setTravailleurs([]); setFormTrav(null); setFormMotif(''); setFormDesc('')
    setShowCreer(true)
  }
  async function choisirRestoCreer(r) {
    setCreerResto(r); setFormTrav(null)
    const { data } = await supabase.from('travailleurs').select('id, nom, poste').eq('restaurant_id', r.id).eq('actif', true).order('nom')
    setTravailleurs(data || [])
  }
  async function soumettreCreation() {
    if (!creerResto) return Alert.alert('Erreur', 'Sélectionnez un restaurant')
    if (!formTrav) return Alert.alert('Erreur', 'Sélectionnez un travailleur')
    if (!formMotif.trim()) return Alert.alert('Erreur', 'Précisez le motif')
    setSaving(true)
    const now = new Date().toISOString()
    const { error } = await supabase.from('demandes_explication').insert({
      restaurant_id: creerResto.id,
      travailleur_id: formTrav.id,
      travailleur_nom: formTrav.nom,
      travailleur_poste: formTrav.poste || null,
      motif: formMotif.trim(),
      description: formDesc.trim() || null,
      statut: 'acceptee', // auto-accepté (saute l'étape acceptation)
      numero: 1,
      cree_par_id: userId, cree_par_nom: userNom, cree_par_role: roleActif,
      accepte_par_id: userId, accepte_par_nom: userNom, accepte_at: now,
    })
    if (error) { setSaving(false); return Alert.alert('Erreur', error.message) }
    journaliser({ action: 'explication_creee_admin', details: `${formTrav.nom} — ${formMotif.trim()}`, userId, restaurantId: creerResto.id }).catch(() => {})
    setSaving(false); setShowCreer(false); setOnglet('miennes'); charger()
  }

  const restoNomFiltre = restoFilter ? restaurants.find(r => r.id === restoFilter)?.nom || 'Restaurant' : 'Tous les restaurants'
  const nomResto = id => restaurants.find(r => r.id === id)?.nom || ''
  const compteurs = ETAPES_EXPLICATION.map(e => ({
    cle: e.cle, label: e.label, valeur: comptes[e.cle],
    couleur: e.cle ? COULEURS_ETAPES[e.cle] : accent,
    alerte: e.cle === 'attente' && comptes.retard > 0 ? `⏰ ${comptes.retard} en retard` : null,
  }))

  function renderActions(d) {
    const pdf = <Bouton label="📄 PDF" variante="contour" couleur={accent} styles={styles} onPress={() => imprimerPdf(d)} />
    if (onglet === 'recues' && d.statut === 'en_attente_acceptation') {
      return (
        <View style={styles.actions}>
          <Bouton label="✅ Accepter" couleur="#3B8D2F" flex styles={styles} onPress={() => accepter(d)} disabled={saving} />
          <Bouton label="❌ Refuser" couleur="#C2462B" flex styles={styles} onPress={() => ouvrirRefus(d)} disabled={saving} />
        </View>
      )
    }
    if (d.statut === 'acceptee') {
      return (
        <View style={styles.actions}>
          <Bouton label="📤 Marquer envoyée" variante="plein" couleur={VIOLET} flex styles={styles} onPress={() => marquerEnvoyee(d)} disabled={saving} />
          {pdf}
        </View>
      )
    }
    if (d.statut === 'envoyee') {
      return (
        <View style={styles.actions}>
          <Bouton label="✅ Réponse récupérée" couleur="#3B8D2F" flex styles={styles} onPress={() => ouvrirReponse(d)} disabled={saving} />
          <Bouton label="🔁 Relancer" couleur="#C27C1A" flex styles={styles} onPress={() => confirmerRelance(d)} disabled={saving} />
          {pdf}
        </View>
      )
    }
    if (['relancee', 'reponse_recuperee'].includes(d.statut)) {
      return <View style={styles.actions}><Bouton label="📄 Imprimer le PDF" variante="contour" couleur={accent} flex styles={styles} onPress={() => imprimerPdf(d)} /></View>
    }
    return null
  }

  return (
    <SafeAreaView style={styles.container}>
      <EnTete titre="Demandes d'explication" sous={restoNomFiltre} styles={styles}
        onRetour={() => (router.canGoBack() ? router.back() : router.replace('/accueil'))} />

      <View style={styles.ongletsWrap}>
        {[['recues', '📥 Reçues'], ['miennes', '📨 Mes demandes']].map(([cle, label]) => (
          <TouchableOpacity key={cle} style={[styles.onglet, onglet === cle && styles.ongletActive]} onPress={() => { setOnglet(cle); setEtape(null) }}>
            <Text style={[styles.ongletTxt, onglet === cle && styles.ongletTxtActive]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Puces ligne styles={styles} actif={restoFilter} onChoisir={setRestoFilter}
        elements={[{ cle: null, label: 'Tous' }, ...restaurants.map(r => ({ cle: r.id, label: r.nom }))]} />
      <Compteurs elements={compteurs} actif={etape} onChoisir={setEtape} styles={styles} />
      <Recherche value={recherche} onChange={setRecherche} placeholder="🔍 Rechercher un travailleur, un motif…" styles={styles} colors={colors} />

      {loading ? (
        <View style={styles.loadingBox}><ActivityIndicator size="large" color={accent} /></View>
      ) : (
        <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
          {onglet === 'miennes' && (
            <View style={{ marginBottom: 14 }}>
              <Bouton label="+ Nouvelle demande d'explication" variante="plein" grand styles={styles} onPress={ouvrirCreer} />
            </View>
          )}
          {visibles.length > 0 && <Text style={styles.resultat}>{visibles.length} demande(s)</Text>}
          {visibles.length === 0 ? (
            <Vide icone="📨" styles={styles} texte="Aucune demande trouvée"
              sous={demandes.length === 0
                ? (onglet === 'recues' ? 'Aucune demande reçue des gérants ou du vérificateur.' : "Vous n'avez créé aucune demande.")
                : 'Changez le filtre ou la recherche.'} />
          ) : visibles.map(d => (
            <CarteExplication key={d.id} d={d} restoNom={nomResto(d.restaurant_id)} styles={styles}
              onVoirReponse={voirFichier} libelleReponse="Réponse déposée par le gérant — voir">
              {renderActions(d)}
            </CarteExplication>
          ))}
          <View style={{ height: 40 }} />
        </ScrollView>
      )}

      {/* Motif du refus */}
      <Feuille visible={showRefus} titre="Motif du refus" styles={styles}
        sous={demandeEnCours ? `${demandeEnCours.travailleur_nom} — ${demandeEnCours.motif}` : null}
        onFermer={() => { setShowRefus(false); setMotifRefus('') }}>
        <Champ styles={styles} colors={colors} multiline autoFocus placeholder="Expliquez le motif du refus (obligatoire)…"
          value={motifRefus} onChangeText={setMotifRefus} />
        <Bouton label={saving ? 'Envoi…' : '❌ Confirmer le refus'} variante="plein" couleur="#C2462B" grand
          onPress={confirmerRefus} disabled={!motifRefus.trim() || saving} styles={styles} />
      </Feuille>

      {/* Réponse récupérée */}
      <Feuille visible={showReponse} titre="Réponse récupérée" styles={styles}
        sous={demandeEnCours ? demandeEnCours.travailleur_nom : null}
        onFermer={() => { setShowReponse(false); setNoteReponse('') }}>
        <Champ styles={styles} colors={colors} multiline placeholder="Note sur la réponse reçue (optionnel)…"
          value={noteReponse} onChangeText={setNoteReponse} />
        <Bouton label={saving ? '…' : '✅ Confirmer'} variante="plein" couleur="#3B8D2F" grand onPress={confirmerReponse} disabled={saving} styles={styles} />
      </Feuille>

      {/* Création (mes demandes) : acceptée automatiquement */}
      <Feuille visible={showCreer} titre="Nouvelle demande d'explication" sous="Acceptée automatiquement" styles={styles} onFermer={() => setShowCreer(false)}>
        <Libelle styles={styles}>Restaurant</Libelle>
        <Puces styles={styles} petit actif={creerResto?.id}
          elements={restaurants.map(r => ({ cle: r.id, label: r.nom }))}
          onChoisir={id => choisirRestoCreer(restaurants.find(r => r.id === id))} />

        {creerResto && (
          <>
            <Libelle styles={styles}>Travailleur</Libelle>
            {travailleurs.length === 0 ? (
              <Text style={[styles.infoTxt, { fontStyle: 'italic', marginBottom: 16 }]}>Aucun travailleur actif</Text>
            ) : (
              <Puces styles={styles} petit actif={formTrav?.id}
                elements={travailleurs.map(t => ({ cle: t.id, label: t.nom }))}
                onChoisir={id => setFormTrav(travailleurs.find(t => t.id === id))} />
            )}
          </>
        )}

        <Libelle styles={styles}>Motif</Libelle>
        <Champ styles={styles} colors={colors} placeholder="Ex : Retard répété…" value={formMotif} onChangeText={setFormMotif} />

        <Libelle styles={styles}>Détails (optionnel)</Libelle>
        <Champ styles={styles} colors={colors} multiline placeholder="Précisez les faits…" value={formDesc} onChangeText={setFormDesc} />

        <Bouton label={saving ? 'Envoi…' : '📤 Créer (acceptée automatiquement)'} variante="plein" couleur={VIOLET} grand
          onPress={soumettreCreation} disabled={saving} styles={styles} />
        <Text style={styles.hint}>Vos demandes sont acceptées automatiquement — il reste à les marquer « envoyée ».</Text>
      </Feuille>
    </SafeAreaView>
  )
}
