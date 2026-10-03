import { retour } from '../lib/navigation'
import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, SafeAreaView, ScrollView, Text, View } from 'react-native'
import { CarteDemande } from '../components/demandes/Cartes'
import {
  Bouton, ChampDates, Champ, Compteurs, EnTete, Feuille, Libelle, Puces, Recherche, Vide, useDemandesStyles,
} from '../components/ui/EcranModerne'
import { useApp } from '../context/AppContext'
import { journaliser } from '../lib/journal'
import { TYPES_DEMANDE } from '../lib/constants'
import { FILTRES_DEMANDE, STATUTS_DEMANDE, VIOLET, compterDemandes, filtrerDemandes, fmtMontant } from '../lib/demandes'
import { creerNotification } from '../lib/notificationsInterne'
import { envoyerNotifDemandeStatut } from '../lib/notifications'
import { supabase } from '../lib/supabase'

export default function DemandesAdminScreen() {
  const { userId, userNom, roleActif } = useApp()
  const { styles, colors, accent } = useDemandesStyles()

  const peutAnnuler = roleActif === 'rh' || roleActif === 'directeur' || roleActif === 'manager'

  const [restaurants, setRestaurants] = useState([])
  const [restoFilter, setRestoFilter] = useState(null)
  const [demandes, setDemandes] = useState([])
  const [loading, setLoading] = useState(true)

  // Filtres de la liste : statut (compteurs cliquables) et recherche, côté téléphone
  // pour que les compteurs restent justes quel que soit le filtre.
  const [filtre, setFiltre] = useState(null)
  const [recherche, setRecherche] = useState('')
  const comptes = useMemo(() => compterDemandes(demandes), [demandes])
  const visibles = useMemo(() => filtrerDemandes(demandes, { statut: filtre, recherche }), [demandes, filtre, recherche])

  // Modal déclin
  const [showDeclineModal, setShowDeclineModal] = useState(false)
  const [demandeEnCours, setDemandeEnCours] = useState(null)
  const [showMontantModal, setShowMontantModal] = useState(false)
  const [montantAlloue, setMontantAlloue] = useState('')
  const [motifDecline, setMotifDecline] = useState('')
  const [saving, setSaving] = useState(false)
  // Modal confirmation annulation
  const [showAnnulerModal, setShowAnnulerModal] = useState(false)
  const [demandeAnnuler, setDemandeAnnuler] = useState(null)

  // Modal création (RH/manager/directeur — ex : planifier un congé futur)
  const peutCreer = roleActif === 'rh' || roleActif === 'directeur' || roleActif === 'manager'
  const [showCreer, setShowCreer] = useState(false)
  const [creerResto, setCreerResto] = useState(null)
  const [travCreer, setTravCreer] = useState([])
  const [cType, setCType] = useState(null)
  const [cTrav, setCTrav] = useState(null)
  const [cDesc, setCDesc] = useState('')
  const [cMontant, setCMontant] = useState('')
  const [cDebut, setCDebut] = useState('')
  const [cFin, setCFin] = useState('')
  const [cDateChamp, setCDateChamp] = useState(null)

  useEffect(() => {
    chargerRestaurants()
  }, [])

  useEffect(() => {
    charger()
  }, [restoFilter])

  async function chargerRestaurants() {
    const { data } = await supabase.from('restaurants').select('id, nom').order('nom')
    setRestaurants(data || [])
  }

  async function charger() {
    setLoading(true)
    let q = supabase.from('demandes').select('*').order('created_at', { ascending: false })
    if (restoFilter) q = q.eq('restaurant_id', restoFilter)
    const { data } = await q
    setDemandes(data || [])
    setLoading(false)
  }

  // Une demande financière exige un montant alloué à la validation
  function estFinanciere(d) {
    return !!TYPES_DEMANDE.find(t => t.label === d.type)?.necessiteMontant
  }

  function demanderValidation(d) {
    if (saving) return
    if (estFinanciere(d)) {
      setDemandeEnCours(d)
      setMontantAlloue(d.montant != null ? String(Math.round(d.montant)) : '')
      setShowMontantModal(true)
      return
    }
    valider(d, null)
  }

  async function confirmerValidation() {
    if (!(parseFloat(montantAlloue) > 0)) {
      return Alert.alert('Montant requis', 'Saisissez le montant alloué (supérieur à 0).')
    }
    await valider(demandeEnCours, parseFloat(montantAlloue))
    setShowMontantModal(false)
    setMontantAlloue('')
  }

  async function valider(d, montantAlloueVal = null) {
    if (saving) return
    setSaving(true)
    const maj = {
      statut: 'validee',
      traite_par_id: userId,
      traite_par_nom: userNom,
      traite_at: new Date().toISOString(),
    }
    if (montantAlloueVal != null) maj.montant_alloue = montantAlloueVal
    await supabase.from('demandes').update(maj).eq('id', d.id)
    const sufMontant = montantAlloueVal != null ? ` — ${Math.round(montantAlloueVal).toLocaleString('fr-FR')} FCFA alloués` : ''
    creerNotification({
      type: 'demande_validee',
      titre: 'Demande validée',
      message: `✅ ${d.type} pour ${d.travailleur_nom} — validée${sufMontant}`,
      restaurant_id: d.restaurant_id,
      cible_user_id: d.cree_par_id,
      created_by: userId,
      screen: 'demandes',
    }).catch(() => {})
    envoyerNotifDemandeStatut(d.travailleur_nom, d.type, 'validee', d.cree_par_id).catch(() => {})
    journaliser({ action: 'demande_validee', details: `${d.type} pour ${d.travailleur_nom}${sufMontant}`, userId, restaurantId: d.restaurant_id }).catch(() => {})
    setSaving(false)
    charger()
  }

  function ouvrirDeclin(d) {
    setDemandeEnCours(d)
    setMotifDecline('')
    setShowDeclineModal(true)
  }

  async function confirmerDeclin() {
    if (!motifDecline.trim()) return Alert.alert('Erreur', 'Le motif du refus est obligatoire')
    setSaving(true)
    await supabase.from('demandes').update({
      statut: 'declinee',
      motif_decline: motifDecline.trim(),
      traite_par_id: userId,
      traite_par_nom: userNom,
      traite_at: new Date().toISOString(),
    }).eq('id', demandeEnCours.id)
    creerNotification({
      type: 'demande_declinee',
      titre: 'Demande déclinée',
      message: `❌ ${demandeEnCours.type} pour ${demandeEnCours.travailleur_nom} — Motif : ${motifDecline.trim()}`,
      restaurant_id: demandeEnCours.restaurant_id,
      cible_user_id: demandeEnCours.cree_par_id,
      created_by: userId,
      screen: 'demandes',
    }).catch(() => {})
    envoyerNotifDemandeStatut(demandeEnCours.travailleur_nom, demandeEnCours.type, 'declinee', demandeEnCours.cree_par_id).catch(() => {})
    journaliser({ action: 'demande_declinee', details: `${demandeEnCours.type} — motif: ${motifDecline.trim()}`, userId, restaurantId: demandeEnCours.restaurant_id }).catch(() => {})
    setSaving(false)
    setShowDeclineModal(false)
    setDemandeEnCours(null)
    charger()
  }

  function confirmerAnnulation(d) {
    setDemandeAnnuler(d)
    setShowAnnulerModal(true)
  }

  async function executerAnnulation() {
    if (!demandeAnnuler || saving) return
    setSaving(true)
    await supabase.from('demandes').update({
      statut: 'annulee',
      annule_par_id: userId,
      annule_par_nom: userNom,
      annule_at: new Date().toISOString(),
    }).eq('id', demandeAnnuler.id)
    creerNotification({
      type: 'demande_annulee',
      titre: 'Demande annulée',
      message: `🚫 ${demandeAnnuler.type} pour ${demandeAnnuler.travailleur_nom} — annulée par ${userNom}`,
      restaurant_id: demandeAnnuler.restaurant_id,
      cible_user_id: demandeAnnuler.cree_par_id,
      created_by: userId,
      screen: 'demandes',
    }).catch(() => {})
    journaliser({ action: 'demande_annulee', details: `${demandeAnnuler.type} pour ${demandeAnnuler.travailleur_nom}, annulé par ${userNom}`, userId, restaurantId: demandeAnnuler.restaurant_id }).catch(() => {})
    setSaving(false)
    setShowAnnulerModal(false)
    setDemandeAnnuler(null)
    charger()
  }

  // ── Création directe par un admin (auto-validée) ──
  function ouvrirCreer() {
    setCreerResto(null); setTravCreer([]); setCType(null); setCTrav(null)
    setCDesc(''); setCMontant(''); setCDebut(''); setCFin(''); setCDateChamp(null)
    setShowCreer(true)
  }
  async function choisirRestoCreer(r) {
    setCreerResto(r); setCTrav(null)
    const { data } = await supabase.from('travailleurs').select('id, nom').eq('restaurant_id', r.id).eq('actif', true).order('nom')
    setTravCreer(data || [])
  }
  async function soumettreCreation() {
    if (!cType) return Alert.alert('Erreur', 'Sélectionnez un type de demande')
    if (!creerResto) return Alert.alert('Erreur', 'Sélectionnez un restaurant')
    if (!cTrav) return Alert.alert('Erreur', 'Sélectionnez un travailleur')
    if (cType.necessiteDates && (!cDebut || !cFin)) return Alert.alert('Erreur', 'Les dates sont obligatoires pour ce type')
    if (cType.necessiteDates && cFin < cDebut) return Alert.alert('Erreur', 'La date de fin doit être après la date de début')
    if (cType.necessiteMontant && !(parseFloat(cMontant) > 0)) return Alert.alert('Montant requis', 'Saisissez le montant (supérieur à 0).')
    setSaving(true)
    const now = new Date().toISOString()
    const montantVal = cType.necessiteMontant ? (parseFloat(cMontant) || 0) : null
    const { error } = await supabase.from('demandes').insert({
      restaurant_id: creerResto.id,
      travailleur_id: cTrav.id,
      travailleur_nom: cTrav.nom,
      type: cType.label,
      necessite_dates: cType.necessiteDates,
      date_debut: cType.necessiteDates ? cDebut : null,
      date_fin: cType.necessiteDates ? cFin : null,
      montant: montantVal,
      montant_alloue: montantVal,
      description: cDesc.trim() || null,
      statut: 'validee', // créée et validée directement par l'admin
      cree_par_id: userId,
      cree_par_nom: userNom,
      traite_par_id: userId,
      traite_par_nom: userNom,
      traite_at: now,
    })
    if (error) { setSaving(false); return Alert.alert('Erreur', error.message) }
    journaliser({ action: 'demande_creee_admin', details: `${cType.label} pour ${cTrav.nom}`, userId, restaurantId: creerResto.id }).catch(() => {})
    setSaving(false); setShowCreer(false); charger()
  }

  const restoNom = restoFilter ? restaurants.find(r => r.id === restoFilter)?.nom || 'Restaurant' : 'Tous les restaurants'
  const nomResto = id => restaurants.find(r => r.id === id)?.nom || ''
  const compteurs = FILTRES_DEMANDE.map(f => ({
    cle: f.cle, label: f.label, valeur: comptes[f.cle],
    couleur: f.cle ? STATUTS_DEMANDE[f.cle].couleur : accent,
  }))

  return (
    <SafeAreaView style={styles.container}>
      <EnTete titre="Demandes" sous={restoNom} onRetour={() => retour()} styles={styles} />

      <Puces ligne styles={styles} actif={restoFilter} onChoisir={setRestoFilter}
        elements={[{ cle: null, label: 'Tous' }, ...restaurants.map(r => ({ cle: r.id, label: r.nom }))]} />
      <Compteurs elements={compteurs} actif={filtre} onChoisir={setFiltre} styles={styles} />
      <Recherche value={recherche} onChange={setRecherche} placeholder="🔍 Rechercher un travailleur, un type…" styles={styles} colors={colors} />

      {loading ? (
        <View style={styles.loadingBox}><ActivityIndicator size="large" color={accent} /></View>
      ) : (
        <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
          {peutCreer && (
            <View style={{ marginBottom: 14 }}>
              <Bouton label="+ Nouvelle demande (validée directement)" variante="plein" grand styles={styles} onPress={ouvrirCreer} />
            </View>
          )}
          {visibles.length > 0 && (
            <Text style={styles.resultat}>
              {visibles.length} demande(s){filtre ? ` · ${STATUTS_DEMANDE[filtre].label.toLowerCase()}` : ''}
            </Text>
          )}
          {visibles.length === 0 ? (
            <Vide icone="📋" styles={styles} texte="Aucune demande trouvée"
              sous={demandes.length === 0 ? 'Aucune demande pour ce choix de restaurant.' : 'Changez le filtre ou la recherche.'} />
          ) : visibles.map(d => (
            <CarteDemande key={d.id} d={d} restoNom={nomResto(d.restaurant_id)} styles={styles}>
              {d.statut === 'en_attente' && (
                <View style={styles.actions}>
                  <Bouton label="✅ Valider" couleur="#3B8D2F" flex styles={styles} onPress={() => demanderValidation(d)} disabled={saving} />
                  <Bouton label="❌ Décliner" couleur="#C2462B" flex styles={styles} onPress={() => ouvrirDeclin(d)} disabled={saving} />
                </View>
              )}
              {d.statut === 'validee' && peutAnnuler && (
                <View style={styles.actions}>
                  <Bouton label="🚫 Annuler la validation" couleur="#7A7A86" flex styles={styles} onPress={() => confirmerAnnulation(d)} disabled={saving} />
                </View>
              )}
            </CarteDemande>
          ))}
          <View style={{ height: 40 }} />
        </ScrollView>
      )}

      {/* Confirmation d'annulation */}
      <Feuille visible={showAnnulerModal} titre="Annuler la validation ?" styles={styles}
        sous={demandeAnnuler ? `${demandeAnnuler.type} pour ${demandeAnnuler.travailleur_nom}` : null}
        onFermer={() => { setShowAnnulerModal(false); setDemandeAnnuler(null) }}>
        <Text style={[styles.infoTxt, { marginBottom: 16 }]}>Le travailleur redeviendra immédiatement modifiable dans Présences.</Text>
        <View style={{ gap: 8 }}>
          <Bouton label={saving ? 'Annulation…' : "🚫 Confirmer l'annulation"} variante="plein" couleur="#5F5F6B" grand
            onPress={executerAnnulation} disabled={saving} styles={styles} />
          <Bouton label="Retour" variante="contour" couleur={colors.textSecondary} grand styles={styles}
            onPress={() => { setShowAnnulerModal(false); setDemandeAnnuler(null) }} />
        </View>
      </Feuille>

      {/* Motif du refus */}
      <Feuille visible={showDeclineModal} titre="Motif du refus" styles={styles}
        sous={demandeEnCours ? `${demandeEnCours.type} — ${demandeEnCours.travailleur_nom}` : null}
        onFermer={() => { setShowDeclineModal(false); setMotifDecline('') }}>
        <Champ styles={styles} colors={colors} multiline numberOfLines={4} autoFocus
          placeholder="Expliquez le motif du refus (obligatoire)…" value={motifDecline} onChangeText={setMotifDecline} />
        <Bouton label={saving ? 'Envoi…' : '❌ Confirmer le refus'} variante="plein" couleur="#C2462B" grand
          onPress={confirmerDeclin} disabled={!motifDecline.trim() || saving} styles={styles} />
      </Feuille>

      {/* Montant alloué (validation d'une demande financière) */}
      <Feuille visible={showMontantModal} titre="Montant alloué" styles={styles}
        sous={demandeEnCours ? `${demandeEnCours.type} — ${demandeEnCours.travailleur_nom}${demandeEnCours.montant > 0 ? ` · demandé ${fmtMontant(demandeEnCours.montant)}` : ''}` : null}
        onFermer={() => { setShowMontantModal(false); setMontantAlloue('') }}>
        <Champ styles={styles} colors={colors} autoFocus keyboardType="numeric" placeholder="Montant accordé (FCFA)"
          value={montantAlloue} onChangeText={v => setMontantAlloue(v.replace(/[^0-9]/g, ''))} />
        <Bouton label={saving ? 'Validation…' : '✅ Valider la demande'} variante="plein" couleur="#3B8D2F" grand
          onPress={confirmerValidation} disabled={!(parseFloat(montantAlloue) > 0) || saving} styles={styles} />
      </Feuille>

      {/* Création directe par un admin (validée) */}
      <Feuille visible={showCreer} titre="Nouvelle demande" sous="Créée directement validée" styles={styles} onFermer={() => setShowCreer(false)}>
        <Libelle styles={styles}>Type de demande</Libelle>
        <Puces styles={styles} actif={cType?.label}
          elements={TYPES_DEMANDE.map(t => ({ cle: t.label, label: `${t.icon} ${t.label}` }))}
          onChoisir={label => { setCType(TYPES_DEMANDE.find(t => t.label === label)); setCDebut(''); setCFin(''); setCDateChamp(null) }} />

        <Libelle styles={styles}>Restaurant</Libelle>
        <Puces styles={styles} petit actif={creerResto?.id}
          elements={restaurants.map(r => ({ cle: r.id, label: r.nom }))}
          onChoisir={id => choisirRestoCreer(restaurants.find(r => r.id === id))} />

        {creerResto && (
          <>
            <Libelle styles={styles}>Travailleur</Libelle>
            {travCreer.length === 0 ? (
              <Text style={[styles.infoTxt, { fontStyle: 'italic', marginBottom: 16 }]}>Aucun travailleur actif</Text>
            ) : (
              <Puces styles={styles} petit actif={cTrav?.id}
                elements={travCreer.map(t => ({ cle: t.id, label: t.nom }))}
                onChoisir={id => setCTrav(travCreer.find(t => t.id === id))} />
            )}
          </>
        )}

        {cType?.necessiteDates && (
          <>
            <Libelle styles={styles}>Dates (futures autorisées)</Libelle>
            <ChampDates debut={cDebut} fin={cFin} setDebut={setCDebut} setFin={setCFin}
              champ={cDateChamp} setChamp={setCDateChamp} styles={styles} colors={colors} accent={accent} />
          </>
        )}

        {cType?.necessiteMontant && (
          <>
            <Libelle styles={styles}>Montant (FCFA)</Libelle>
            <Champ styles={styles} colors={colors} placeholder="Ex : 50000" keyboardType="numeric"
              value={cMontant} onChangeText={v => setCMontant(v.replace(/[^0-9]/g, ''))} />
          </>
        )}

        <Libelle styles={styles}>Description (optionnelle)</Libelle>
        <Champ styles={styles} colors={colors} multiline placeholder="Précisez les détails…" value={cDesc} onChangeText={setCDesc} />

        <Bouton label={saving ? 'Enregistrement…' : '✅ Enregistrer (validée)'} variante="plein" couleur={VIOLET} grand
          onPress={soumettreCreation} disabled={saving} styles={styles} />
        <Text style={styles.hint}>Créée directement validée. Idéal pour planifier un congé à une date future.</Text>
      </Feuille>
    </SafeAreaView>
  )
}
