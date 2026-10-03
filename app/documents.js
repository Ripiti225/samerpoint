// ──────────────────────────────────────────────────────────────────────────────
// Documents administratifs des restaurants (registre de commerce, bail…).
// Manager / RH : tous les restaurants ou un seul, ajout et modification.
// Gérant / caissier : leur restaurant, en lecture.
// Photos dans le bucket `photos` (usePhoto), PDF dans `documents-pdf`.
// ──────────────────────────────────────────────────────────────────────────────
import * as DocumentPicker from 'expo-document-picker'
import { router } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator, Alert, Image, Linking, Modal, SafeAreaView, ScrollView, Text, TouchableOpacity, View,
} from 'react-native'

import {
  Bouton, Champ, Compteurs, EnTete, Feuille, Libelle, Puces, Recherche, Vide, teinte, useEcranModerne,
} from '../components/ui/EcranModerne'
import { useApp } from '../context/AppContext'
import { creerNotification } from '../lib/notificationsInterne'
import { supabase } from '../lib/supabase'
import { usePhoto } from '../lib/usePhoto'

const sansAccents = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

function formatDate(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
}

const FORM_VIDE = { titre: '', description: '', type: 'photo', url: null, localUri: null, restaurant_id: null }

export default function DocumentsScreen() {
  const { roleActif, restaurantId, restaurantNom } = useApp()
  const { styles, colors, accent, principale } = useEcranModerne('beige')
  const { prendrePhoto: capturer, choisirPhoto: choisir } = usePhoto()
  const isRH = roleActif === 'rh'
  const isManager = roleActif === 'manager'
  const canAdd = isRH || isManager
  const hasRestoFixe = !isManager && !isRH // gérant et caissier ont un resto fixe

  const [restaurants, setRestaurants] = useState([])
  const [restoId, setRestoId] = useState(hasRestoFixe ? restaurantId : null) // null = tous
  const [documents, setDocuments] = useState([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [modalDoc, setModalDoc] = useState(false)
  const [docEnEdition, setDocEnEdition] = useState(null)
  const [form, setForm] = useState(FORM_VIDE)
  const [docSelectionne, setDocSelectionne] = useState(null)
  const [uploadingPdf, setUploadingPdf] = useState(false)
  const [pdfName, setPdfName] = useState('')

  const [filtre, setFiltre] = useState(null) // null | 'photo' | 'pdf'
  const [recherche, setRecherche] = useState('')
  const [grille, setGrille] = useState(true)

  useEffect(() => {
    if (!hasRestoFixe) {
      supabase.from('restaurants').select('id, nom').order('nom').then(({ data }) => setRestaurants(data || []))
    }
  }, [hasRestoFixe])

  useEffect(() => { chargerDocuments() }, [restoId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function chargerDocuments() {
    if (hasRestoFixe && !restoId) return
    setLoading(true)
    let q = supabase.from('documents').select('*').order('created_at', { ascending: false })
    if (restoId) q = q.eq('restaurant_id', restoId)
    const { data } = await q.range(0, 4999)
    setDocuments(data || [])
    setLoading(false)
  }

  const restoParId = useMemo(() => Object.fromEntries(restaurants.map(r => [r.id, r])), [restaurants])
  const nomResto = id => (hasRestoFixe ? restaurantNom : restoParId[id]?.nom) || ''

  const q = sansAccents(recherche).trim()
  const trouves = documents.filter(d => !q || sansAccents(d.titre).includes(q) || sansAccents(d.description).includes(q))
  const visibles = trouves.filter(d => !filtre || (filtre === 'pdf' ? d.type === 'pdf' : d.type !== 'pdf'))
  const compteurs = [
    { cle: null, label: 'Tous', valeur: trouves.length, couleur: accent },
    { cle: 'photo', label: 'Photos', valeur: trouves.filter(d => d.type !== 'pdf').length, couleur: '#3B8D2F' },
    { cle: 'pdf', label: 'PDF', valeur: trouves.filter(d => d.type === 'pdf').length, couleur: '#2F6FD8' },
  ]

  async function choisirPhoto() {
    const url = await choisir('documents')
    if (url) setForm(p => ({ ...p, type: 'photo', localUri: url, url }))
  }

  async function prendrePhoto() {
    const url = await capturer('documents')
    if (url) setForm(p => ({ ...p, type: 'photo', localUri: url, url }))
  }

  function resetForm() {
    setForm({ ...FORM_VIDE, restaurant_id: restoId })
    setDocEnEdition(null)
    setPdfName('')
  }

  async function sauvegarder() {
    if (!form.titre) { Alert.alert('Erreur', 'Le titre est obligatoire'); return }
    const restoCible = docEnEdition ? docEnEdition.restaurant_id : form.restaurant_id
    if (!restoCible) { Alert.alert('Erreur', 'Choisissez le restaurant du document'); return }
    setSaving(true)
    try {
      if (docEnEdition) {
        await supabase.from('documents')
          .update({ titre: form.titre, description: form.description, type: form.type, url: form.url })
          .eq('id', docEnEdition.id)
      } else {
        await supabase.from('documents').insert({
          restaurant_id: restoCible, titre: form.titre, description: form.description,
          type: form.type, url: form.url, created_by: roleActif,
        })
        creerNotification({
          type: 'nouveau_document', titre: '📁 Nouveau document', message: `"${form.titre}" ajouté`,
          restaurant_id: restoCible, cible_role: ['manager', 'directeur'], screen: 'documents',
        }).catch(() => {})
      }
      setSaving(false)
      setModalDoc(false)
      resetForm()
      chargerDocuments()
      Alert.alert('Succès', 'Document enregistré !')
    } catch (error) {
      setSaving(false)
      Alert.alert('Erreur', error.message)
    }
  }

  function supprimerDoc(doc) {
    Alert.alert('Confirmer', `Supprimer "${doc.titre}" ?`, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer', style: 'destructive', onPress: async () => {
          await supabase.from('documents').delete().eq('id', doc.id)
          setDocSelectionne(null)
          chargerDocuments()
        },
      },
    ])
  }

  async function choisirPDF() {
    const restoCible = docEnEdition ? docEnEdition.restaurant_id : form.restaurant_id
    if (!restoCible) { Alert.alert('Restaurant', "Choisissez d'abord le restaurant du document."); return }
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true })
      if (result.canceled || !result.assets?.[0]) return
      const asset = result.assets[0]
      setUploadingPdf(true)
      const path = `${restoCible}/${Date.now()}_${asset.name || 'document.pdf'}`
      const blob = await (await fetch(asset.uri)).blob()
      const { error } = await supabase.storage.from('documents-pdf').upload(path, blob, { contentType: 'application/pdf', upsert: true })
      if (error) {
        Alert.alert('Erreur', `L'envoi du PDF a échoué : ${error.message}`)
        setUploadingPdf(false)
        return
      }
      const { data: urlData } = supabase.storage.from('documents-pdf').getPublicUrl(path)
      setForm(p => ({ ...p, type: 'pdf', url: urlData.publicUrl }))
      setPdfName(asset.name || 'document.pdf')
      setUploadingPdf(false)
    } catch (err) {
      setUploadingPdf(false)
      Alert.alert('Erreur', err.message)
    }
  }

  function ouvrirEdition(doc) {
    setDocSelectionne(null)
    setDocEnEdition(doc)
    setForm({ titre: doc.titre, description: doc.description || '', type: doc.type || 'photo', url: doc.url, localUri: doc.url, restaurant_id: doc.restaurant_id })
    setModalDoc(true)
  }

  // Fonction d'affichage, pas un composant : déclaré dans l'écran, un composant
  // serait recréé à chaque rendu et ferait clignoter les images.
  function vignette(doc) {
    const pdf = doc.type === 'pdf'
    const resto = !restoId ? nomResto(doc.restaurant_id) : ''
    if (grille) {
      return (
        <TouchableOpacity key={doc.id} onPress={() => setDocSelectionne(doc)} activeOpacity={0.85}
          style={[styles.carte, { width: '48%', padding: 0, overflow: 'hidden', marginBottom: 12 }]}>
          {!pdf && doc.url ? (
            <Image source={{ uri: doc.url }} style={{ width: '100%', aspectRatio: 1.1 }} resizeMode="cover" />
          ) : (
            <View style={{ width: '100%', aspectRatio: 1.1, alignItems: 'center', justifyContent: 'center', backgroundColor: teinte('#2F6FD8', '14') }}>
              <Text style={{ fontSize: 42 }}>📄</Text>
              <Text style={{ fontSize: 11, fontWeight: '800', color: '#2F6FD8', marginTop: 4 }}>PDF</Text>
            </View>
          )}
          <View style={{ padding: 10 }}>
            <Text style={[styles.carteTitre, { fontSize: 13.5 }]} numberOfLines={2}>{doc.titre}</Text>
            <Text style={[styles.carteSous, { fontSize: 11.5 }]} numberOfLines={1}>{resto || formatDate(doc.created_at)}</Text>
          </View>
        </TouchableOpacity>
      )
    }
    return (
      <TouchableOpacity key={doc.id} onPress={() => setDocSelectionne(doc)} activeOpacity={0.85}
        style={[styles.carte, { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 }]}>
        {!pdf && doc.url ? (
          <Image source={{ uri: doc.url }} style={{ width: 56, height: 56, borderRadius: 12 }} resizeMode="cover" />
        ) : (
          <View style={[styles.bulle, { width: 56, height: 56, borderRadius: 12, backgroundColor: teinte('#2F6FD8', '14') }]}>
            <Text style={{ fontSize: 26 }}>📄</Text>
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={[styles.carteTitre, { fontSize: 14 }]} numberOfLines={1}>{doc.titre}</Text>
          {doc.description ? <Text style={styles.carteSous} numberOfLines={1}>{doc.description}</Text> : null}
          <Text style={[styles.carteSous, { fontSize: 11.5 }]}>{resto ? `${resto} · ` : ''}{formatDate(doc.created_at)}</Text>
        </View>
        <View style={[styles.pastille, { marginTop: 0, backgroundColor: teinte(pdf ? '#2F6FD8' : '#3B8D2F', '1F') }]}>
          <Text style={[styles.pastilleTxt, { color: pdf ? '#2F6FD8' : '#3B8D2F' }]}>{pdf ? 'PDF' : 'Photo'}</Text>
        </View>
      </TouchableOpacity>
    )
  }

  const titreResto = hasRestoFixe ? restaurantNom : restoId ? nomResto(restoId) : 'Tous les restaurants'
  const restoForm = docEnEdition ? docEnEdition.restaurant_id : form.restaurant_id

  return (
    <SafeAreaView style={styles.container}>
      <EnTete titre="Documents" sous={titreResto} styles={styles}
        onRetour={() => (router.canGoBack() ? router.back() : router.replace('/accueil'))} />

      {!hasRestoFixe && (
        <Puces ligne styles={styles} actif={restoId} onChoisir={setRestoId}
          elements={[{ cle: null, label: 'Tous' }, ...restaurants.map(r => ({ cle: r.id, label: r.nom }))]} />
      )}
      <Compteurs elements={compteurs} actif={filtre} onChoisir={setFiltre} styles={styles} />
      <Recherche value={recherche} onChange={setRecherche} placeholder="🔍 Rechercher un document…" styles={styles} colors={colors} />

      {loading ? (
        <View style={styles.loadingBox}><ActivityIndicator size="large" color={accent} /></View>
      ) : (
        <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
          {canAdd && (
            <View style={{ marginBottom: 14 }}>
              <Bouton label="+ Ajouter un document" variante="plein" couleur={principale} grand styles={styles}
                onPress={() => { resetForm(); setModalDoc(true) }} />
            </View>
          )}

          {visibles.length > 0 && (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <Text style={[styles.resultat, { marginBottom: 0 }]}>{visibles.length} document{visibles.length > 1 ? 's' : ''}</Text>
              <View style={{ flexDirection: 'row', backgroundColor: colors.surfaceAlt, borderRadius: 12, padding: 3 }}>
                {[[true, '▦ Grille'], [false, '☰ Liste']].map(([v, l]) => (
                  <TouchableOpacity key={l} onPress={() => setGrille(v)}
                    style={[{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 9 }, grille === v && { backgroundColor: colors.surface }]}>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: grille === v ? accent : colors.textMuted }}>{l}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {visibles.length === 0 ? (
            <Vide icone="📁" styles={styles}
              texte={documents.length === 0 ? 'Aucun document pour ce restaurant' : 'Aucun document trouvé'}
              sous={documents.length === 0 ? (canAdd ? 'Appuyez sur « + Ajouter un document » pour commencer.' : null) : 'Changez le filtre ou la recherche.'} />
          ) : (
            <View style={grille ? { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' } : null}>
              {visibles.map(vignette)}
            </View>
          )}
          <View style={{ height: 40 }} />
        </ScrollView>
      )}

      {/* Ajout / modification */}
      <Feuille visible={modalDoc} titre={docEnEdition ? 'Modifier le document' : 'Nouveau document'}
        sous={docEnEdition ? nomResto(docEnEdition.restaurant_id) : null}
        onFermer={() => { setModalDoc(false); resetForm() }} styles={styles}>
        {!docEnEdition && !hasRestoFixe && (
          <>
            <Libelle styles={styles}>Restaurant *</Libelle>
            <Puces petit styles={styles} actif={form.restaurant_id} onChoisir={id => setForm(p => ({ ...p, restaurant_id: id }))}
              elements={restaurants.map(r => ({ cle: r.id, label: r.nom }))} />
          </>
        )}

        <Libelle styles={styles}>Titre *</Libelle>
        <Champ styles={styles} colors={colors} placeholder="Ex : Registre de commerce, Contrat de bail…"
          value={form.titre} onChangeText={v => setForm(p => ({ ...p, titre: v }))} />

        <Libelle styles={styles}>Description (optionnelle)</Libelle>
        <Champ styles={styles} colors={colors} multiline placeholder="Description du document…"
          value={form.description} onChangeText={v => setForm(p => ({ ...p, description: v }))} />

        <Libelle styles={styles}>Type de document</Libelle>
        <Puces styles={styles} actif={form.type} onChoisir={t => setForm(p => ({ ...p, type: t }))}
          elements={[{ cle: 'photo', label: '📷 Photo' }, { cle: 'pdf', label: '📄 PDF' }]} />

        {form.type === 'photo' && (
          <>
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
              <Bouton label="📷 Prendre une photo" couleur={accent} flex grand styles={styles} onPress={prendrePhoto} />
              <Bouton label="🖼 Galerie" couleur={accent} flex grand styles={styles} onPress={choisirPhoto} />
            </View>
            {form.localUri ? <Image source={{ uri: form.localUri }} style={{ width: '100%', height: 200, borderRadius: 14, marginBottom: 14 }} resizeMode="cover" /> : null}
          </>
        )}

        {form.type === 'pdf' && (
          <View style={{ marginBottom: 14 }}>
            <Bouton label={uploadingPdf ? 'Envoi…' : '📄 Choisir un fichier PDF'} couleur={accent} grand styles={styles}
              onPress={choisirPDF} disabled={uploadingPdf || (!restoForm && !hasRestoFixe)} />
            <Text style={[styles.infoTxt, { marginTop: 8, textAlign: 'center' }, form.url && { color: '#3B8D2F', fontWeight: '700' }]}>
              {uploadingPdf ? 'Envoi en cours…' : form.url ? `✓ ${pdfName || 'PDF enregistré'}` : 'Sélectionnez un PDF depuis votre appareil'}
            </Text>
          </View>
        )}

        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Bouton label="Annuler" variante="contour" couleur={colors.textSecondary} flex grand styles={styles} onPress={() => { setModalDoc(false); resetForm() }} />
          <Bouton label={saving ? 'Enregistrement…' : 'Enregistrer'} variante="plein" couleur={principale} flex grand styles={styles}
            onPress={sauvegarder} disabled={saving} />
        </View>
      </Feuille>

      {/* Aperçu */}
      <Modal visible={!!docSelectionne} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setDocSelectionne(null)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }}>
          <View style={{ padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderBottomColor: '#222' }}>
            <TouchableOpacity onPress={() => setDocSelectionne(null)} hitSlop={10}>
              <Text style={{ fontSize: 14, color: '#fff', fontWeight: '600' }}>✕ Fermer</Text>
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: '#fff' }} numberOfLines={1}>{docSelectionne?.titre}</Text>
              <Text style={{ fontSize: 11.5, color: '#999', marginTop: 2 }} numberOfLines={2}>
                {[nomResto(docSelectionne?.restaurant_id), formatDate(docSelectionne?.created_at), docSelectionne?.description].filter(Boolean).join(' · ')}
              </Text>
            </View>
            {canAdd && docSelectionne && (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity onPress={() => ouvrirEdition(docSelectionne)} style={{ backgroundColor: '#ffffff22', borderRadius: 10, padding: 8 }}>
                  <Text>✏️</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => supprimerDoc(docSelectionne)} style={{ backgroundColor: '#ffffff22', borderRadius: 10, padding: 8 }}>
                  <Text>🗑</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
          {docSelectionne?.url && docSelectionne?.type !== 'pdf' ? (
            <Image source={{ uri: docSelectionne.url }} style={{ flex: 1 }} resizeMode="contain" />
          ) : (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
              <Text style={{ fontSize: 60 }}>📄</Text>
              <Text style={{ color: '#fff', marginTop: 12, fontSize: 15, fontWeight: '700', textAlign: 'center' }}>{docSelectionne?.titre}</Text>
              {docSelectionne?.url ? (
                <TouchableOpacity onPress={() => Linking.openURL(docSelectionne.url)}
                  style={{ marginTop: 22, backgroundColor: principale, borderRadius: 14, paddingHorizontal: 24, paddingVertical: 14 }}>
                  <Text style={{ color: '#fff', fontSize: 15, fontWeight: '800' }}>🔗 Ouvrir le PDF</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  )
}
