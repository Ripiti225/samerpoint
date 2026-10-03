import * as DocumentPicker from 'expo-document-picker'
import * as ImagePicker from 'expo-image-picker'
import { router } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, Linking, Platform, SafeAreaView, ScrollView, Text, View } from 'react-native'
import { CarteExplication } from '../components/demandes/Cartes'
import { Bouton, Champ, Compteurs, EnTete, Feuille, Libelle, Puces, Recherche, Vide, useDemandesStyles } from '../components/demandes/ui'
import { useApp } from '../context/AppContext'
import { uploadFichier } from '../lib/api'
import { COULEURS_ETAPES, ETAPES_EXPLICATION, VIOLET, compterExplications, filtrerExplications } from '../lib/demandes'
import { journaliser } from '../lib/journal'
import { creerNotification } from '../lib/notificationsInterne'
import { envoyerNotifExplicationNouvelle } from '../lib/notifications'
import { genererPdfExplication } from '../lib/pdfDocuments'
import { supabase } from '../lib/supabase'

export default function DemandesExplicationScreen() {
  const { restaurantId, restaurantNom, userId, userNom, roleActif } = useApp()
  const { styles, colors, accent } = useDemandesStyles()

  const [demandes, setDemandes] = useState([])
  const [travailleurs, setTravailleurs] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showModal, setShowModal] = useState(false)

  const [formTrav, setFormTrav] = useState(null)
  const [formMotif, setFormMotif] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [uploadingId, setUploadingId] = useState(null)

  // Filtres de la liste (compteurs par étape cliquables + recherche)
  const [etape, setEtape] = useState(null)
  const [recherche, setRecherche] = useState('')
  const comptes = useMemo(() => compterExplications(demandes), [demandes])
  const visibles = useMemo(() => filtrerExplications(demandes, { etape, recherche }), [demandes, etape, recherche])

  useEffect(() => {
    if (restaurantId) charger()
  }, [restaurantId])

  async function charger() {
    setLoading(true)
    const [{ data: travData }, { data: demData }] = await Promise.all([
      supabase.from('travailleurs').select('id, nom, poste').eq('restaurant_id', restaurantId).eq('actif', true).order('nom'),
      supabase.from('demandes_explication').select('*').eq('restaurant_id', restaurantId).order('created_at', { ascending: false }),
    ])
    setTravailleurs(travData || [])
    setDemandes(demData || [])
    setLoading(false)
  }

  function resetForm() {
    setFormTrav(null)
    setFormMotif('')
    setFormDesc('')
  }

  async function soumettre() {
    if (!formTrav) return Alert.alert('Erreur', 'Sélectionnez un travailleur')
    if (!formMotif.trim()) return Alert.alert('Erreur', "Précisez le motif de la demande d'explication")
    setSaving(true)
    const { error } = await supabase.from('demandes_explication').insert({
      restaurant_id: restaurantId,
      travailleur_id: formTrav.id,
      travailleur_nom: formTrav.nom,
      travailleur_poste: formTrav.poste || null,
      motif: formMotif.trim(),
      description: formDesc.trim() || null,
      statut: 'en_attente_acceptation',
      numero: 1,
      cree_par_id: userId,
      cree_par_nom: userNom,
      cree_par_role: roleActif,
    })
    if (error) {
      setSaving(false)
      return Alert.alert('Erreur', error.message)
    }
    creerNotification({
      type: 'explication_nouvelle',
      titre: "Demande d'explication",
      message: `📨 ${formTrav.nom} — ${restaurantNom} · à accepter`,
      restaurant_id: restaurantId,
      cible_role: ['directeur', 'rh', 'manager'],
      created_by: userId,
      screen: 'demandes-explication-admin',
    }).catch(() => {})
    envoyerNotifExplicationNouvelle(formTrav.nom, restaurantId).catch(() => {})
    journaliser({ action: 'explication_creee', details: `${formTrav.nom} — ${formMotif.trim()}`, userId, restaurantId }).catch(() => {})
    setSaving(false)
    setShowModal(false)
    resetForm()
    charger()
  }

  async function imprimerPdf(d) {
    try {
      await genererPdfExplication({
        travailleurNom: d.travailleur_nom,
        poste: d.travailleur_poste,
        restaurantNom,
        motif: d.motif,
        description: d.description,
        date: d.envoyee_at || d.created_at,
      })
    } catch (_e) {
      Alert.alert('Erreur', "Impossible de générer le PDF")
    }
  }

  async function uploaderReponse(d, mode) {
    if (uploadingId) return
    let uri = null
    try {
      if (mode === 'image') {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
        if (perm.status !== 'granted' && Platform.OS !== 'web') {
          return Alert.alert('Autorisation requise', "Autorisez l'accès aux photos pour uploader la réponse.")
        }
        const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7 })
        if (res.canceled) return
        uri = res.assets?.[0]?.uri
      } else {
        const res = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true })
        if (res.canceled) return
        uri = res.assets?.[0]?.uri
      }
    } catch (_e) {
      return Alert.alert('Erreur', "Impossible d'ouvrir le sélecteur de fichier")
    }
    if (!uri) return
    setUploadingId(d.id)
    const url = await uploadFichier(uri, 'reponses_explication')
    if (!url) { setUploadingId(null); return Alert.alert('Erreur', "L'upload a échoué. Réessayez.") }
    await supabase.from('demandes_explication').update({
      reponse_fichier_url: url,
      reponse_fichier_type: mode === 'image' ? 'image' : 'pdf',
      reponse_uploadee_at: new Date().toISOString(),
    }).eq('id', d.id)
    creerNotification({
      type: 'explication_reponse_upload',
      titre: 'Réponse reçue',
      message: `📎 Réponse de ${d.travailleur_nom} déposée — ${restaurantNom}`,
      restaurant_id: restaurantId,
      cible_role: ['directeur', 'rh', 'manager'],
      created_by: userId,
      screen: 'demandes-explication-admin',
    }).catch(() => {})
    journaliser({ action: 'explication_reponse_upload', details: `${d.travailleur_nom}`, userId, restaurantId }).catch(() => {})
    setUploadingId(null)
    charger()
  }

  function voirFichier(url) {
    if (!url) return
    if (Platform.OS === 'web') window.open(url, '_blank')
    else Linking.openURL(url).catch(() => Alert.alert('Erreur', "Impossible d'ouvrir le fichier"))
  }

  const compteurs = ETAPES_EXPLICATION.map(e => ({
    cle: e.cle, label: e.label, valeur: comptes[e.cle],
    couleur: e.cle ? COULEURS_ETAPES[e.cle] : accent,
    alerte: e.cle === 'attente' && comptes.retard > 0 ? `⏰ ${comptes.retard} en retard` : null,
  }))

  return (
    <SafeAreaView style={styles.container}>
      <EnTete titre="Demandes d'explication" sous={restaurantNom} styles={styles}
        onRetour={() => (router.canGoBack() ? router.back() : router.replace('/accueil'))} />

      {loading ? (
        <View style={styles.loadingBox}><ActivityIndicator size="large" color={accent} /></View>
      ) : (
        <>
          <Compteurs elements={compteurs} actif={etape} onChoisir={setEtape} styles={styles} />
          <Recherche value={recherche} onChange={setRecherche} placeholder="🔍 Rechercher un travailleur, un motif…" styles={styles} colors={colors} />

          <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
            <View style={{ marginBottom: 14 }}>
              <Bouton label="+ Demander une explication" variante="plein" grand styles={styles}
                onPress={() => { resetForm(); setShowModal(true) }} />
            </View>

            {visibles.length > 0 && <Text style={styles.resultat}>{visibles.length} demande(s)</Text>}
            {visibles.length === 0 ? (
              <Vide icone="📨" styles={styles}
                texte={demandes.length === 0 ? "Aucune demande d'explication" : 'Aucune demande trouvée'}
                sous={demandes.length === 0 ? 'Touchez « Demander une explication » pour en créer une.' : 'Changez le filtre ou la recherche.'} />
            ) : visibles.map(d => {
              const peutPdf = ['acceptee', 'envoyee', 'relancee', 'reponse_recuperee'].includes(d.statut)
              const peutDeposer = !d.reponse_fichier_url && ['envoyee', 'relancee'].includes(d.statut)
              return (
              <CarteExplication key={d.id} d={d} styles={styles} onVoirReponse={voirFichier} libelleReponse="Réponse déposée — voir">
                {peutPdf || peutDeposer ? (
                  <View style={styles.actions}>
                    {peutPdf && (
                      <Bouton label="📄 Télécharger la demande" variante="contour" couleur={accent} flex styles={styles} onPress={() => imprimerPdf(d)} />
                    )}
                    {/* Réponse du travailleur : déposée par le gérant */}
                    {peutDeposer && (
                      <View style={{ width: '100%', gap: 8 }}>
                        <Text style={[styles.label, { marginBottom: 0 }]}>📎 Déposer la réponse du travailleur</Text>
                        {uploadingId === d.id ? (
                          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 8 }}>
                            <ActivityIndicator size="small" color={accent} />
                            <Text style={styles.infoTxt}>Envoi…</Text>
                          </View>
                        ) : (
                          <View style={{ flexDirection: 'row', gap: 8 }}>
                            <Bouton label="🖼️ Photo" variante="plein" couleur={VIOLET} flex styles={styles} onPress={() => uploaderReponse(d, 'image')} />
                            <Bouton label="📄 PDF" variante="plein" couleur={VIOLET} flex styles={styles} onPress={() => uploaderReponse(d, 'pdf')} />
                          </View>
                        )}
                      </View>
                    )}
                  </View>
                ) : null}
              </CarteExplication>
              )
            })}
            <View style={{ height: 40 }} />
          </ScrollView>
        </>
      )}

      <Feuille visible={showModal} titre="Demande d'explication" sous={restaurantNom} styles={styles}
        onFermer={() => { setShowModal(false); resetForm() }}>
        <Libelle styles={styles}>Travailleur concerné</Libelle>
        <View style={{ marginBottom: 16 }}>
          <Puces styles={styles} petit actif={formTrav?.id}
            elements={travailleurs.map(t => ({ cle: t.id, label: t.nom }))}
            onChoisir={id => setFormTrav(travailleurs.find(t => t.id === id))} />
        </View>

        <Libelle styles={styles}>Motif de la demande</Libelle>
        <Champ styles={styles} colors={colors} placeholder="Ex : Retard répété, caisse manquante…" value={formMotif} onChangeText={setFormMotif} />

        <Libelle styles={styles}>Détails (optionnel)</Libelle>
        <Champ styles={styles} colors={colors} multiline numberOfLines={3} placeholder="Précisez les faits, dates, montants…"
          value={formDesc} onChangeText={setFormDesc} />

        <Bouton label={saving ? 'Envoi…' : '📤 Soumettre'} variante="plein" couleur={VIOLET} grand onPress={soumettre} disabled={saving} styles={styles} />
        <Text style={styles.hint}>La demande sera acceptée puis envoyée par le manager, la RH ou la direction.</Text>
      </Feuille>
    </SafeAreaView>
  )
}
