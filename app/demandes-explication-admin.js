import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Linking, Platform, SafeAreaView, ScrollView, Text, TouchableOpacity, View } from 'react-native'
import { CarteExplication } from '../components/demandes/Cartes'
import { Bouton, Champ, Compteurs, EnTete, Feuille, Libelle, Puces, Recherche, Vide, teinte, useDemandesStyles } from '../components/ui/EcranModerne'
import { useApp } from '../context/AppContext'
import {
  COULEURS_ETAPES, ETAPES_EXPLICATION, VIOLET, compterExplications, decisionProposition, descriptionPour,
  filtrerExplications, regrouperPropositions,
} from '../lib/demandes'
import { journaliser } from '../lib/journal'
import { creerNotification } from '../lib/notificationsInterne'
import { envoyerNotifExplicationStatut } from '../lib/notifications'
import { genererPdfExplication } from '../lib/pdfDocuments'
import { supabase } from '../lib/supabase'
import { useFocusRecherche } from '../lib/useFocusRecherche'

export default function DemandesExplicationAdminScreen() {
  const { userId, userNom, roleActif } = useApp()
  const { styles, colors, accent } = useDemandesStyles()
  // Arrivée depuis une notification « sans réponse » : onglet + étape imposés.
  const { onglet: ongletParam, etape: etapeParam, restaurant_id: restoParam, focus: focusParam } = useLocalSearchParams()
  // Ouvert depuis la recherche globale : restaurant + demande encadrée.
  const focus = useFocusRecherche(focusParam)
  const focusCherche = useRef(false)

  const [onglet, setOnglet] = useState(ongletParam === 'miennes' ? 'miennes' : 'recues') // 'recues' | 'miennes'
  const [demandes, setDemandes] = useState([])
  const [restaurants, setRestaurants] = useState([])
  const [restoFilter, setRestoFilter] = useState(typeof restoParam === 'string' ? restoParam : null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Filtres de la liste (compteurs par étape cliquables + recherche)
  const [etape, setEtape] = useState(ETAPES_EXPLICATION.some(e => e.cle && e.cle === etapeParam) ? etapeParam : null)
  const [recherche, setRecherche] = useState('')
  // Les propositions du vérificateur (une ligne par personne) n'en font qu'une.
  const elements = useMemo(() => regrouperPropositions(demandes), [demandes])
  const comptes = useMemo(() => compterExplications(elements), [elements])
  const visibles = useMemo(() => filtrerExplications(elements, { etape, recherche }), [elements, etape, recherche])

  // Proposition du vérificateur : personnes cochées / ajoutées, par proposition.
  const [choix, setChoix] = useState({})            // { [proposition.id]: { coches: ids, ajouts: travailleurs } }
  const [ajoutOuvert, setAjoutOuvert] = useState(null) // proposition.id dont la liste d'ajout est ouverte
  const [travParResto, setTravParResto] = useState({}) // { [restaurant_id]: travailleurs actifs }

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

  // La demande cherchée n'est pas dans « Reçues » : c'est une des miennes.
  useEffect(() => {
    if (loading || focusCherche.current || typeof focusParam !== 'string') return
    focusCherche.current = true
    if (onglet === 'recues' && !demandes.some(d => d.id === focusParam)) setOnglet('miennes')
  }, [loading, demandes]) // eslint-disable-line react-hooks/exhaustive-deps

  async function chargerRestaurants() {
    const { data } = await supabase.from('restaurants').select('id, nom').order('nom')
    setRestaurants(data || [])
  }

  async function charger() {
    setLoading(true)
    let q = supabase.from('demandes_explication').select('*').order('created_at', { ascending: false })
    // « Reçues » = demandes à examiner, émises par un rôle non-admin : le gérant,
    // et le vérificateur (proposition quand ≥ 30 % des produits comptés sont en
    // écart — la direction décide de l'envoyer et à qui). Sans 'verificateur'
    // ici, ces demandes n'apparaissaient dans aucun des deux onglets.
    if (onglet === 'recues') q = q.in('cree_par_role', ['gerant', 'verificateur', 'superviseur'])
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
    // Proposition du vérificateur : « Ne rien envoyer » refuse toutes ses lignes.
    const ids = demandeEnCours.proposition ? demandeEnCours.lignes.map(l => l.id) : [demandeEnCours.id]
    await supabase.from('demandes_explication').update({
      statut: 'refusee', refus_motif: motifRefus.trim(), refuse_par_nom: userNom, refuse_at: new Date().toISOString(),
    }).in('id', ids)
    if (!demandeEnCours.proposition) notifierGerant(demandeEnCours, 'refusee')
    journaliser({
      action: demandeEnCours.proposition ? 'explication_verificateur_non_envoyee' : 'explication_refusee',
      details: `${demandeEnCours.travailleur_nom || demandeEnCours.motif} — ${motifRefus.trim()}`,
      userId, restaurantId: demandeEnCours.restaurant_id,
    }).catch(() => {})
    setSaving(false); setShowRefus(false); setDemandeEnCours(null); charger()
  }

  // ── Proposition du vérificateur : la direction choisit à qui l'envoyer ──
  function choixDe(p) {
    return choix[p.id] || { coches: p.lignes.filter(l => l.travailleur_nom).map(l => l.id), ajouts: [] }
  }
  function majChoix(p, f) { setChoix(prev => ({ ...prev, [p.id]: f(choixDe(p)) })) }
  function basculerCoche(p, id) {
    majChoix(p, c => ({ ...c, coches: c.coches.includes(id) ? c.coches.filter(x => x !== id) : [...c.coches, id] }))
  }
  async function ouvrirAjout(p) {
    setAjoutOuvert(p.id)
    if (travParResto[p.restaurant_id]) return
    const { data } = await supabase.from('travailleurs').select('id, nom, poste')
      .eq('restaurant_id', p.restaurant_id).eq('actif', true).order('nom')
    setTravParResto(prev => ({ ...prev, [p.restaurant_id]: data || [] }))
  }
  function basculerAjout(p, t) {
    majChoix(p, c => ({
      ...c, ajouts: c.ajouts.some(a => a.id === t.id) ? c.ajouts.filter(a => a.id !== t.id) : [...c.ajouts, t],
    }))
  }

  async function envoyerProposition(p) {
    if (saving) return
    const dec = decisionProposition(p, choixDe(p).coches, choixDe(p).ajouts)
    if (!dec.nb) return Alert.alert('Personne de choisi', 'Cochez au moins une personne, ou touchez « Ne rien envoyer ».')
    setSaving(true)
    const now = new Date().toISOString()
    const accord = { accepte_par_id: userId, accepte_par_nom: userNom, accepte_at: now }
    const ops = []
    if (dec.accepter.length) {
      ops.push(supabase.from('demandes_explication').update({ statut: 'acceptee', ...accord }).in('id', dec.accepter))
    }
    if (dec.ecarter.length) {
      ops.push(supabase.from('demandes_explication').update({ statut: 'annulee', annule_par_nom: userNom, annule_at: now }).in('id', dec.ecarter))
    }
    if (dec.ajouter.length) {
      ops.push(supabase.from('demandes_explication').insert(dec.ajouter.map(t => ({
        restaurant_id: p.restaurant_id,
        travailleur_id: t.id, travailleur_nom: t.nom, travailleur_poste: t.poste || null,
        motif: `${p.motif} — désigné par la direction`,
        description: descriptionPour(p.description_source, 'désigné par la direction'),
        statut: 'acceptee', numero: 1,
        cree_par_id: p.cree_par_id, cree_par_nom: p.cree_par_nom, cree_par_role: 'verificateur',
        ...accord,
      }))))
    }
    const erreur = (await Promise.all(ops)).find(r => r.error)?.error
    if (erreur) {
      setSaving(false)
      return Alert.alert('Erreur', "La décision n'a pas pu être enregistrée entièrement. Rechargez l'écran et vérifiez.")
    }
    const noms = [
      ...p.lignes.filter(l => dec.accepter.includes(l.id)).map(l => l.travailleur_nom),
      ...dec.ajouter.map(t => t.nom),
    ]
    creerNotification({
      type: 'explication_acceptee',
      titre: "Demande d'explication à remettre",
      message: `📨 ${noms.join(', ')} — ${p.motif}`,
      restaurant_id: p.restaurant_id,
      cible_role: ['gerant'],
      created_by: userId,
      screen: 'demandes-explication',
    }).catch(() => {})
    journaliser({ action: 'explication_verificateur_envoyee', details: `${p.motif} — à : ${noms.join(', ')}`, userId, restaurantId: p.restaurant_id }).catch(() => {})
    setChoix(prev => { const { [p.id]: _, ...reste } = prev; return reste })
    setAjoutOuvert(null)
    setSaving(false)
    charger()
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

  function renderProposition(p) {
    const c = choixDe(p)
    const nb = decisionProposition(p, c.coches, c.ajouts).nb
    const proposes = p.lignes.filter(l => l.travailleur_nom)
    const dejaLa = new Set([...proposes.map(l => l.travailleur_id).filter(Boolean), ...c.ajouts.map(t => t.id)])
    const aAjouter = (travParResto[p.restaurant_id] || []).filter(t => !dejaLa.has(t.id))
    return (
      <View style={[styles.actions, { flexDirection: 'column', alignItems: 'stretch' }]}>
        <Text style={styles.label}>Qui doit recevoir la demande ?</Text>
        {proposes.length === 0 ? (
          <Text style={[styles.infoTxt, { fontStyle: 'italic' }]}>Aucune personne identifiée sur ce créneau : ajoutez le travailleur concerné.</Text>
        ) : null}
        {proposes.map(l => (
          <Coche key={l.id} actif={c.coches.includes(l.id)} titre={l.travailleur_nom} sous={l.role ? `proposé : ${l.role}` : null}
            onPress={() => basculerCoche(p, l.id)} colors={colors} accent={accent} />
        ))}
        {c.ajouts.map(t => (
          <Coche key={t.id} actif titre={t.nom} sous="ajouté par vous" onPress={() => basculerAjout(p, t)} colors={colors} accent={accent} />
        ))}
        {ajoutOuvert === p.id ? (
          travParResto[p.restaurant_id] == null ? <ActivityIndicator color={accent} /> : aAjouter.length === 0 ? (
            <Text style={[styles.infoTxt, { fontStyle: 'italic' }]}>Aucun autre travailleur actif dans ce restaurant.</Text>
          ) : (
            <Puces styles={styles} petit actif={null}
              elements={aAjouter.map(t => ({ cle: t.id, label: `+ ${t.nom}` }))}
              onChoisir={id => basculerAjout(p, aAjouter.find(t => t.id === id))} />
          )
        ) : (
          <Bouton label="+ Ajouter un travailleur" variante="contour" couleur={accent} styles={styles} onPress={() => ouvrirAjout(p)} />
        )}
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
          <Bouton label={nb ? `📤 Envoyer (${nb})` : '📤 Envoyer'} couleur="#3B8D2F" flex styles={styles}
            onPress={() => envoyerProposition(p)} disabled={saving || !nb} />
          <Bouton label="🚫 Ne rien envoyer" couleur="#C2462B" flex styles={styles} onPress={() => ouvrirRefus(p)} disabled={saving} />
        </View>
      </View>
    )
  }

  function renderActions(d) {
    if (d.proposition) return renderProposition(d)
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
            <CarteExplication key={d.id} restoNom={nomResto(d.restaurant_id)} styles={styles} focus={focus}
              d={d.proposition ? { ...d, travailleur_nom: '🔍 Comptage du vérificateur', travailleur_poste: 'À décider : envoyer ou non, et à qui' } : d}
              onVoirReponse={voirFichier} libelleReponse="Réponse déposée par le gérant — voir">
              {renderActions(d)}
            </CarteExplication>
          ))}
          <View style={{ height: 40 }} />
        </ScrollView>
      )}

      {/* Motif du refus */}
      <Feuille visible={showRefus} styles={styles}
        titre={demandeEnCours?.proposition ? 'Ne rien envoyer' : 'Motif du refus'}
        sous={demandeEnCours ? [demandeEnCours.travailleur_nom, demandeEnCours.motif].filter(Boolean).join(' — ') : null}
        onFermer={() => { setShowRefus(false); setMotifRefus('') }}>
        <Champ styles={styles} colors={colors} multiline autoFocus
          placeholder={demandeEnCours?.proposition ? 'Pourquoi aucune demande ne part (obligatoire)…' : 'Expliquez le motif du refus (obligatoire)…'}
          value={motifRefus} onChangeText={setMotifRefus} />
        <Bouton label={saving ? 'Envoi…' : demandeEnCours?.proposition ? '🚫 Confirmer : rien n’est envoyé' : '❌ Confirmer le refus'} variante="plein" couleur="#C2462B" grand
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

// Case à cocher d'une personne dans une proposition du vérificateur.
function Coche({ actif, titre, sous, onPress, colors, accent }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 12, minHeight: 48,
        borderRadius: 12, borderWidth: 1, borderColor: actif ? accent : colors.borderLight,
        backgroundColor: actif ? teinte(accent, '1C') : colors.surface,
      }}>
      <Text style={{ fontSize: 18 }}>{actif ? '☑️' : '⬜'}</Text>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 14.5, fontWeight: '700', color: colors.text }}>{titre}</Text>
        {sous ? <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 1 }}>{sous}</Text> : null}
      </View>
    </TouchableOpacity>
  )
}
