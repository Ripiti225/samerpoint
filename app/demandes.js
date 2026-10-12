/*
 * SQL À EXÉCUTER DANS SUPABASE AVANT D'UTILISER CE MODULE :
 *
 * CREATE TABLE demandes (
 *   id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
 *   restaurant_id uuid REFERENCES restaurants(id),
 *   travailleur_id uuid REFERENCES travailleurs(id),
 *   travailleur_nom text,
 *   type text NOT NULL,
 *   necessite_dates boolean DEFAULT false,
 *   date_debut date,
 *   date_fin date,
 *   description text,
 *   statut text DEFAULT 'en_attente',
 *   cree_par_id uuid REFERENCES utilisateurs(id),
 *   cree_par_nom text,
 *   traite_par_id uuid REFERENCES utilisateurs(id),
 *   traite_par_nom text,
 *   motif_decline text,
 *   annule_par_id uuid REFERENCES utilisateurs(id),
 *   annule_par_nom text,
 *   annule_at timestamptz,
 *   created_at timestamptz DEFAULT now(),
 *   traite_at timestamptz
 * );
 *
 * -- Migration données existantes (optionnel) :
 * INSERT INTO demandes (
 *   restaurant_id, travailleur_id, travailleur_nom, type, necessite_dates,
 *   date_debut, date_fin, description, statut, created_at
 * )
 * SELECT
 *   restaurant_id, travailleur_id, travailleur_nom,
 *   CASE WHEN type = 'conge' THEN 'Congé annuel' ELSE 'Autre' END,
 *   true, date_debut, date_fin, motif, 'validee', created_at
 * FROM permissions_conges;
 */

import { retour } from '../lib/navigation'
import { useLocalSearchParams } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, SafeAreaView, ScrollView, Text, View } from 'react-native'
import { CarteDemande } from '../components/demandes/Cartes'
import {
  Bouton, ChampDates, Champ, Compteurs, EnTete, Feuille, Libelle, Puces, Recherche, Vide, useDemandesStyles,
} from '../components/ui/EcranModerne'
import { useApp } from '../context/AppContext'
import { journaliser } from '../lib/journal'
import { TYPES_DEMANDE } from '../lib/constants'
import { FILTRES_DEMANDE, STATUTS_DEMANDE, VIOLET, compterDemandes, filtrerDemandes } from '../lib/demandes'
import { creerNotification } from '../lib/notificationsInterne'
import { envoyerNotifDemandeNouvelle } from '../lib/notifications'
import { supabase } from '../lib/supabase'
import { useFocusRecherche } from '../lib/useFocusRecherche'

export default function DemandesScreen() {
  const { restaurantId, restaurantNom, userId, userNom, roleActif } = useApp()
  const { styles, colors, accent } = useDemandesStyles()

  const [demandes, setDemandes] = useState([])
  const [travailleurs, setTravailleurs] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showModal, setShowModal] = useState(false)

  // Form state
  const [formType, setFormType] = useState(null)        // TYPES_DEMANDE item
  const [formTrav, setFormTrav] = useState(null)        // { id, nom }
  const [formDesc, setFormDesc] = useState('')
  const [formMontant, setFormMontant] = useState('')
  const [formDateDebut, setFormDateDebut] = useState('')
  const [formDateFin, setFormDateFin] = useState('')
  const [dateChamp, setDateChamp] = useState(null)      // 'debut' | 'fin' | null

  // Filtres de la liste (compteurs cliquables + recherche)
  const [filtre, setFiltre] = useState(null)
  // Ouvert depuis la recherche globale : demande encadrée.
  const focus = useFocusRecherche(useLocalSearchParams().focus)
  const [recherche, setRecherche] = useState('')
  const comptes = useMemo(() => compterDemandes(demandes), [demandes])
  const visibles = useMemo(() => filtrerDemandes(demandes, { statut: filtre, recherche }), [demandes, filtre, recherche])

  useEffect(() => {
    if (restaurantId) charger()
  }, [restaurantId])

  async function charger() {
    setLoading(true)
    const [{ data: travData }, { data: demandesData }] = await Promise.all([
      supabase.from('travailleurs').select('id, nom').eq('restaurant_id', restaurantId).eq('actif', true).order('nom'),
      supabase.from('demandes').select('*').eq('restaurant_id', restaurantId).order('created_at', { ascending: false }),
    ])
    setTravailleurs(travData || [])
    setDemandes(demandesData || [])
    setLoading(false)
  }

  function resetForm() {
    setFormType(null)
    setFormTrav(null)
    setFormDesc('')
    setFormMontant('')
    setFormDateDebut('')
    setFormDateFin('')
    setDateChamp(null)
  }

  async function soumettre() {
    if (!formType) return Alert.alert('Erreur', 'Sélectionnez un type de demande')
    if (!formTrav) return Alert.alert('Erreur', 'Sélectionnez un travailleur')
    if (formType.necessiteDates && (!formDateDebut || !formDateFin)) {
      return Alert.alert('Erreur', 'Les dates sont obligatoires pour ce type de demande')
    }
    if (formType.necessiteDates && formDateFin < formDateDebut) {
      return Alert.alert('Erreur', 'La date de fin doit être après la date de début')
    }
    if (formType.necessiteMontant && !(parseFloat(formMontant) > 0)) {
      return Alert.alert('Montant requis', 'Saisissez le montant demandé (supérieur à 0) pour ce type de demande.')
    }
    setSaving(true)
    const { error } = await supabase.from('demandes').insert({
      restaurant_id: restaurantId,
      travailleur_id: formTrav.id,
      travailleur_nom: formTrav.nom,
      type: formType.label,
      necessite_dates: formType.necessiteDates,
      date_debut: formType.necessiteDates ? formDateDebut : null,
      date_fin: formType.necessiteDates ? formDateFin : null,
      montant: formType.necessiteMontant ? (parseFloat(formMontant) || 0) : null,
      description: formDesc.trim() || null,
      statut: 'en_attente',
      cree_par_id: userId,
      cree_par_nom: userNom,
    })
    if (error) {
      setSaving(false)
      return Alert.alert('Erreur', error.message)
    }
    creerNotification({
      type: 'demande_nouvelle',
      titre: 'Nouvelle demande',
      message: `${formType.icon} ${formType.label} pour ${formTrav.nom} — ${restaurantNom}`,
      restaurant_id: restaurantId,
      cible_role: ['directeur', 'rh', 'manager'],
      created_by: userId,
      screen: 'demandes-admin',
    }).catch(() => {})
    envoyerNotifDemandeNouvelle(formTrav.nom, `${formType.icon} ${formType.label}`, restaurantId).catch(() => {})
    journaliser({ action: 'demande_creee', details: `${formType.label} pour ${formTrav.nom}`, userId, restaurantId }).catch(() => {})
    setSaving(false)
    setShowModal(false)
    resetForm()
    charger()
  }

  const compteurs = FILTRES_DEMANDE.map(f => ({
    cle: f.cle, label: f.label, valeur: comptes[f.cle],
    couleur: f.cle ? STATUTS_DEMANDE[f.cle].couleur : accent,
  }))

  return (
    <SafeAreaView style={styles.container}>
      <EnTete titre="Demandes" sous={restaurantNom} onRetour={() => retour()} styles={styles} />

      {loading ? (
        <View style={styles.loadingBox}><ActivityIndicator size="large" color={accent} /></View>
      ) : (
        <>
          <Compteurs elements={compteurs} actif={filtre} onChoisir={setFiltre} styles={styles} />
          <Recherche value={recherche} onChange={setRecherche} placeholder="🔍 Rechercher un travailleur, un type…" styles={styles} colors={colors} />

          <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
            <View style={{ marginBottom: 14 }}>
              <Bouton label="+ Nouvelle demande" variante="plein" grand styles={styles}
                onPress={() => { resetForm(); setShowModal(true) }} />
            </View>

            {visibles.length > 0 && (
              <Text style={styles.resultat}>
                {visibles.length} demande(s){filtre ? ` · ${STATUTS_DEMANDE[filtre].label.toLowerCase()}` : ''}
              </Text>
            )}
            {visibles.length === 0 ? (
              <Vide icone="📋" styles={styles}
                texte={demandes.length === 0 ? 'Aucune demande pour ce restaurant' : 'Aucune demande trouvée'}
                sous={demandes.length === 0 ? 'Touchez « Nouvelle demande » pour en créer une.' : 'Changez le filtre ou la recherche.'} />
            ) : visibles.map(d => <CarteDemande key={d.id} d={d} styles={styles} focus={focus} />)}
            <View style={{ height: 40 }} />
          </ScrollView>
        </>
      )}

      <Feuille visible={showModal} titre="Nouvelle demande" sous={restaurantNom} styles={styles}
        onFermer={() => { setShowModal(false); resetForm() }}>
        <Libelle styles={styles}>Type de demande</Libelle>
        <Puces styles={styles} actif={formType?.label}
          elements={TYPES_DEMANDE.map(t => ({ cle: t.label, label: `${t.icon} ${t.label}` }))}
          onChoisir={label => { setFormType(TYPES_DEMANDE.find(t => t.label === label)); setFormDateDebut(''); setFormDateFin(''); setDateChamp(null) }} />

        <Libelle styles={styles}>Travailleur</Libelle>
        <View style={{ marginBottom: 16 }}>
          <Puces styles={styles} petit actif={formTrav?.id}
            elements={travailleurs.map(t => ({ cle: t.id, label: t.nom }))}
            onChoisir={id => setFormTrav(travailleurs.find(t => t.id === id))} />
        </View>

        {formType?.necessiteDates && (
          <>
            <Libelle styles={styles}>Dates</Libelle>
            <ChampDates debut={formDateDebut} fin={formDateFin} setDebut={setFormDateDebut} setFin={setFormDateFin}
              champ={dateChamp} setChamp={setDateChamp} styles={styles} colors={colors} accent={accent} />
          </>
        )}

        {formType?.necessiteMontant && (
          <>
            <Libelle styles={styles}>Montant demandé (FCFA)</Libelle>
            <Champ styles={styles} colors={colors} placeholder="Ex : 50000" keyboardType="numeric"
              value={formMontant} onChangeText={v => setFormMontant(v.replace(/[^0-9]/g, ''))} />
          </>
        )}

        <Libelle styles={styles}>Description (optionnelle)</Libelle>
        <Champ styles={styles} colors={colors} multiline numberOfLines={3} placeholder="Précisez les détails…"
          value={formDesc} onChangeText={setFormDesc} />

        <Bouton label={saving ? 'Envoi…' : '📤 Soumettre la demande'} variante="plein" couleur={VIOLET} grand
          onPress={soumettre} disabled={saving} styles={styles} />
      </Feuille>
    </SafeAreaView>
  )
}
