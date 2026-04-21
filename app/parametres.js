import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import {
    Alert,
    Image,
    Keyboard,
    KeyboardAvoidingView,
    Modal,
    Platform,
    SafeAreaView, ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    TouchableWithoutFeedback,
    View
} from 'react-native'
import { useApp } from '../context/AppContext'
import { supabase } from '../lib/supabase'
import { usePhoto } from '../lib/usePhoto'

const SECTIONS = [
  { key: 'restaurants', label: '🏪 Restaurants' },
  { key: 'travailleurs', label: '👥 Travailleurs' },
  { key: 'utilisateurs', label: '🔑 Utilisateurs' },
  { key: 'fournisseurs', label: '🧾 Fournisseurs' },
]

export default function ParametresScreen() {
  const { isManager } = useApp()
  const { prendrePhoto, choisirPhoto } = usePhoto()

  const [sectionActive, setSectionActive] = useState('restaurants')
  const [restaurants, setRestaurants] = useState([])
  const [travailleurs, setTravailleurs] = useState([])
  const [utilisateurs, setUtilisateurs] = useState([])
  const [fournisseurs, setFournisseurs] = useState([])
  const [tousRestaurants, setTousRestaurants] = useState([])
  const [modal, setModal] = useState({ visible: false, type: '', data: null })
  const [form, setForm] = useState({})
  const [loading, setLoading] = useState(false)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [creditActuel, setCreditActuel] = useState(null)
  const [restaurantFiltre, setRestaurantFiltre] = useState(null)
  const [badgeTravailleur, setBadgeTravailleur] = useState(null)

  useEffect(() => { chargerTousRestaurants() }, [])
  useEffect(() => { chargerDonnees() }, [sectionActive])
  useEffect(() => {
    if (tousRestaurants.length > 0 && !restaurantFiltre) {
      setRestaurantFiltre(tousRestaurants[0].id)
    }
  }, [tousRestaurants])

  async function chargerTousRestaurants() {
    const { data } = await supabase.from('restaurants').select('*').order('nom')
    setTousRestaurants(data || [])
  }

  async function chargerDonnees() {
    setLoading(true)
    if (sectionActive === 'restaurants') {
      const { data } = await supabase.from('restaurants').select('*').order('nom')
      setRestaurants(data || [])
      setTousRestaurants(data || [])
    }
    if (sectionActive === 'travailleurs') {
      const { data } = await supabase.from('travailleurs').select('*, restaurants(nom)').order('nom')
      setTravailleurs(data || [])
    }
    if (sectionActive === 'utilisateurs') {
      const { data } = await supabase.from('utilisateurs').select('*, restaurants(nom)').order('nom')
      setUtilisateurs(data || [])
    }
    if (sectionActive === 'fournisseurs') {
      const { data } = await supabase.from('fournisseurs').select('*, restaurants(nom)').order('nom')
      setFournisseurs(data || [])
    }
    setLoading(false)
  }

  async function ouvrirModal(type, data = null, defaults = {}) {
    setForm(data ? { ...data } : { ...defaults })
    setModal({ visible: true, type, data })
    setCreditActuel(null)

    if (type === 'fournisseur' && data?.id && isManager) {
      const { data: derniereTrans } = await supabase
        .from('transactions_fournisseurs')
        .select('reste')
        .eq('fournisseur_id', data.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()
      setCreditActuel(derniereTrans?.reste ?? 0)
    }
  }

  async function modifierCredit(fournisseurId, restaurantId, nouveauCredit) {
    const { data: derniereTrans } = await supabase
      .from('transactions_fournisseurs')
      .select('id')
      .eq('fournisseur_id', fournisseurId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (derniereTrans) {
      await supabase
        .from('transactions_fournisseurs')
        .update({ reste: nouveauCredit })
        .eq('id', derniereTrans.id)
    } else {
      const { data: point } = await supabase
        .from('points')
        .select('id')
        .eq('restaurant_id', restaurantId)
        .order('date', { ascending: false })
        .limit(1)
        .single()
      if (point) {
        await supabase.from('transactions_fournisseurs').insert({
          point_id: point.id,
          fournisseur_id: fournisseurId,
          facture: 0,
          paye: 0,
          reste: nouveauCredit,
          photo_url: null,
        })
      }
    }
  }

  async function sauvegarder() {
    const { type, data } = modal
    setLoading(true)

    try {
      // ── RESTAURANT ──────────────────────────────────────────
      if (type === 'restaurant') {
        if (!form.nom) {
          Alert.alert('Erreur', 'Le nom est obligatoire')
          setLoading(false); return
        }
        if (!form.pin || form.pin.length !== 4) {
          Alert.alert('Erreur', 'Le PIN du restaurant doit avoir 4 chiffres')
          setLoading(false); return
        }
        if (data?.id) {
          const { error } = await supabase.from('restaurants')
            .update({
              nom: form.nom,
              localisation: form.localisation,
              couleur: form.couleur,
              pin: form.pin,
              photo_url: form.photo_url || null,
            })
            .eq('id', data.id)
          if (error) throw error
        } else {
          const { error } = await supabase.from('restaurants')
            .insert({
              nom: form.nom,
              localisation: form.localisation,
              couleur: form.couleur || 'orange',
              pin: form.pin,
              photo_url: form.photo_url || null,
            })
          if (error) throw error
        }
      }

      // ── TRAVAILLEUR ─────────────────────────────────────────
      if (type === 'travailleur') {
        if (!form.nom) {
          Alert.alert('Erreur', 'Le nom est obligatoire')
          setLoading(false); return
        }
        if (!form.restaurant_id) {
          Alert.alert('Erreur', 'Choisissez un restaurant')
          setLoading(false); return
        }
        if (data?.id) {
          const { error } = await supabase.from('travailleurs')
            .update({
              nom: form.nom,
              poste: form.poste,
              type_contrat: form.type_contrat,
              restaurant_id: form.restaurant_id,
              identifiant: form.identifiant || null,
              contact: form.contact || null,
              photo_url: form.photo_url || null,
            })
            .eq('id', data.id)
          if (error) throw error
        } else {
          const { error } = await supabase.from('travailleurs')
            .insert({
              nom: form.nom,
              poste: form.poste,
              type_contrat: form.type_contrat || 'CDD',
              restaurant_id: form.restaurant_id,
              identifiant: form.identifiant || null,
              contact: form.contact || null,
              photo_url: form.photo_url || null,
              actif: true,
            })
          if (error) throw error
        }
      }

      // ── UTILISATEUR ─────────────────────────────────────────
      if (type === 'utilisateur') {
        if (!form.nom || !form.pin) {
          Alert.alert('Erreur', 'Nom et PIN obligatoires')
          setLoading(false); return
        }
        if (form.pin.length !== 4) {
          Alert.alert('Erreur', 'Le PIN doit avoir 4 chiffres')
          setLoading(false); return
        }
        const estManagerOuAdmin = form.role === 'manager'
        if (!form.restaurant_id && !estManagerOuAdmin) {
          Alert.alert('Erreur', 'Choisissez un restaurant pour ce rôle')
          setLoading(false); return
        }
        if (data?.id) {
          const { error } = await supabase.from('utilisateurs')
            .update({
              nom: form.nom,
              role: form.role,
              pin: form.pin,
              restaurant_id: estManagerOuAdmin ? null : form.restaurant_id,
            })
            .eq('id', data.id)
          if (error) throw error
        } else {
          const { error } = await supabase.from('utilisateurs')
            .insert({
              nom: form.nom,
              role: form.role || 'caissier',
              pin: form.pin,
              actif: true,
              restaurant_id: estManagerOuAdmin ? null : form.restaurant_id,
            })
          if (error) throw error
        }
      }

      // ── FOURNISSEUR ─────────────────────────────────────────
      if (type === 'fournisseur') {
        if (!form.nom) {
          Alert.alert('Erreur', 'Le nom est obligatoire')
          setLoading(false); return
        }
        if (data?.id) {
          // Modification d'un fournisseur existant
          if (!form.restaurant_id) {
            Alert.alert('Erreur', 'Choisissez un restaurant')
            setLoading(false); return
          }
          const { error } = await supabase.from('fournisseurs')
            .update({
              nom: form.nom,
              type: form.type,
              restaurant_id: form.restaurant_id,
              identifiant: form.identifiant || null,
              contact: form.contact || null,
            })
            .eq('id', data.id)
          if (error) throw error

          // Modification du crédit (manager uniquement)
          if (isManager && form.nouveau_credit !== undefined && form.nouveau_credit !== '') {
            await modifierCredit(data.id, data.restaurant_id, parseFloat(form.nouveau_credit) || 0)
          }
        } else {
          // Création multi-restaurants
          const ids = form.restaurant_ids || []
          if (ids.length === 0) {
            Alert.alert('Erreur', 'Choisissez au moins un restaurant')
            setLoading(false); return
          }
          for (const rId of ids) {
            const { error } = await supabase.from('fournisseurs')
              .insert({
                nom: form.nom,
                type: form.type || 'fournisseur',
                restaurant_id: rId,
                identifiant: form.identifiant || null,
                contact: form.contact || null,
                actif: true,
              })
            if (error) throw error
          }
        }
      }

      setModal({ visible: false, type: '', data: null })
      setLoading(false)
      chargerDonnees()
      chargerTousRestaurants()
      Alert.alert('Succès', 'Enregistré !')
    } catch (error) {
      setLoading(false)
      Alert.alert('Erreur', error.message || "Impossible d'enregistrer")
    }
  }

  async function choisirPhotoResto() {
    setUploadingPhoto(true)
    Alert.alert('Photo du restaurant', 'Choisir la source', [
      {
        text: '📷 Caméra',
        onPress: async () => {
          const url = await prendrePhoto('restaurants')
          if (url) setForm(p => ({ ...p, photo_url: url }))
          setUploadingPhoto(false)
        }
      },
      {
        text: '🖼 Galerie',
        onPress: async () => {
          const url = await choisirPhoto('restaurants')
          if (url) setForm(p => ({ ...p, photo_url: url }))
          setUploadingPhoto(false)
        }
      },
      { text: 'Annuler', style: 'cancel', onPress: () => setUploadingPhoto(false) }
    ])
  }

  async function choisirPhotoProfil() {
    setUploadingPhoto(true)
    Alert.alert('Photo de profil', 'Choisir la source', [
      {
        text: '📷 Caméra',
        onPress: async () => {
          const url = await prendrePhoto('travailleurs')
          if (url) setForm(p => ({ ...p, photo_url: url }))
          setUploadingPhoto(false)
        }
      },
      {
        text: '🖼 Galerie',
        onPress: async () => {
          const url = await choisirPhoto('travailleurs')
          if (url) setForm(p => ({ ...p, photo_url: url }))
          setUploadingPhoto(false)
        }
      },
      { text: 'Annuler', style: 'cancel', onPress: () => setUploadingPhoto(false) }
    ])
  }

  async function toggleActif(table, id, actif) {
    await supabase.from(table).update({ actif: !actif }).eq('id', id)
    chargerDonnees()
  }

  async function supprimer(table, id, nom) {
    if (nom === 'Manager General' || nom === 'Administrateur') {
      Alert.alert('Impossible', 'Le Manager General et l\'Administrateur ne peuvent pas être supprimés.')
      return
    }
    Alert.alert('Confirmer', 'Supprimer cet élément ?', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: async () => {
        await supabase.from(table).delete().eq('id', id)
        chargerDonnees()
      }}
    ])
  }

  function SelectRestaurant() {
    return (
      <>
        <Text style={styles.modalLabel}>Restaurant *</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
          {tousRestaurants.map(r => {
            const selected = form.restaurant_id === r.id
            return (
              <TouchableOpacity
                key={r.id}
                style={[styles.restoBadgeBtn, selected && styles.restoBadgeBtnSelected]}
                onPress={() => setForm(p => ({ ...p, restaurant_id: r.id }))}
              >
                {r.photo_url ? (
                  <Image source={{ uri: r.photo_url }} style={styles.restoBadgeImg} />
                ) : (
                  <View style={[styles.restoBadgeAvatar, { backgroundColor: r.couleur === 'vert' ? '#2D7D46' : '#EF9F27' }]}>
                    <Text style={styles.restoBadgeAvatarTxt}>{r.nom.slice(0, 2).toUpperCase()}</Text>
                  </View>
                )}
                <Text style={[styles.restoBadgeTxt, selected && styles.restoBadgeTxtSelected]} numberOfLines={1}>
                  {r.nom}
                </Text>
                {selected && <Text style={styles.restoBadgeCheck}>✓</Text>}
              </TouchableOpacity>
            )
          })}
        </ScrollView>
      </>
    )
  }

  function SelectMultipleRestaurants() {
    const ids = form.restaurant_ids || []
    return (
      <>
        <Text style={styles.modalLabel}>Restaurants * (sélection multiple)</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
          {tousRestaurants.map(r => {
            const selected = ids.includes(r.id)
            return (
              <TouchableOpacity
                key={r.id}
                style={[styles.restoBadgeBtn, selected && styles.restoBadgeBtnSelected]}
                onPress={() => setForm(p => {
                  const prev = p.restaurant_ids || []
                  return {
                    ...p,
                    restaurant_ids: selected
                      ? prev.filter(id => id !== r.id)
                      : [...prev, r.id]
                  }
                })}
              >
                {r.photo_url ? (
                  <Image source={{ uri: r.photo_url }} style={styles.restoBadgeImg} />
                ) : (
                  <View style={[styles.restoBadgeAvatar, { backgroundColor: r.couleur === 'vert' ? '#2D7D46' : '#EF9F27' }]}>
                    <Text style={styles.restoBadgeAvatarTxt}>{r.nom.slice(0, 2).toUpperCase()}</Text>
                  </View>
                )}
                <Text style={[styles.restoBadgeTxt, selected && styles.restoBadgeTxtSelected]} numberOfLines={1}>
                  {r.nom}
                </Text>
                {selected && <Text style={styles.restoBadgeCheck}>✓</Text>}
              </TouchableOpacity>
            )
          })}
        </View>
        {ids.length > 0 && (
          <View style={styles.infoBox}>
            <Text style={styles.infoTxt}>
              {ids.length} restaurant{ids.length > 1 ? 's' : ''} sélectionné{ids.length > 1 ? 's' : ''} — un fournisseur sera créé pour chacun.
            </Text>
          </View>
        )}
      </>
    )
  }

  function FiltreRestaurants() {
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filtreBar} contentContainerStyle={{ paddingHorizontal: 2, paddingBottom: 10 }}>
        {tousRestaurants.map(r => (
          <TouchableOpacity
            key={r.id}
            style={[styles.filtrePill, restaurantFiltre === r.id && styles.filtrePillActive]}
            onPress={() => setRestaurantFiltre(r.id)}
          >
            <View style={[styles.filtreDot, { backgroundColor: r.couleur === 'vert' ? '#2D7D46' : '#EF9F27', opacity: restaurantFiltre === r.id ? 1 : 0.4 }]} />
            <Text style={[styles.filtrePillTxt, restaurantFiltre === r.id && styles.filtrePillTxtActive]}>
              {r.nom}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    )
  }

  // ─── RENDU RESTAURANTS ─────────────────────────────────────
  function renderRestaurants() {
    return (
      <>
        <TouchableOpacity style={styles.addBtn} onPress={() => ouvrirModal('restaurant')}>
          <Text style={styles.addTxt}>+ Ajouter un restaurant</Text>
        </TouchableOpacity>
        {restaurants.map(r => (
          <View key={r.id} style={styles.itemCard}>
            <View style={styles.itemLeft}>
              {r.photo_url ? (
                <Image source={{ uri: r.photo_url }} style={{ width: 40, height: 40, borderRadius: 10 }} />
              ) : (
                <View style={[styles.itemDot, { width: 40, height: 40, borderRadius: 10, backgroundColor: r.couleur === 'vert' ? '#2D7D46' : '#EF9F27', alignItems: 'center', justifyContent: 'center' }]}>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: '#fff' }}>{r.nom.slice(0, 2).toUpperCase()}</Text>
                </View>
              )}
              <View>
                <Text style={styles.itemNom}>{r.nom}</Text>
                <Text style={styles.itemSub}>{r.localisation || 'Pas de localisation'}</Text>
                <Text style={styles.itemPin}>PIN: {r.pin || '----'}</Text>
              </View>
            </View>
            <View style={styles.itemActions}>
              <TouchableOpacity style={styles.editBtn} onPress={() => ouvrirModal('restaurant', r)}>
                <Text style={styles.editTxt}>✏️</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.deleteBtn} onPress={() => supprimer('restaurants', r.id, r.nom)}>
                <Text style={styles.deleteTxt}>🗑</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </>
    )
  }

  // ─── RENDU TRAVAILLEURS ────────────────────────────────────
  function renderTravailleurs() {
    const filtres = travailleurs.filter(t => !restaurantFiltre || t.restaurant_id === restaurantFiltre)
    const restoNom = tousRestaurants.find(r => r.id === restaurantFiltre)?.nom || ''
    return (
      <>
        <FiltreRestaurants />
        <TouchableOpacity style={styles.addBtn} onPress={() => ouvrirModal('travailleur', null, { restaurant_id: restaurantFiltre })}>
          <Text style={styles.addTxt}>+ Ajouter un travailleur {restoNom ? `— ${restoNom}` : ''}</Text>
        </TouchableOpacity>
        {filtres.length === 0 && (
          <View style={styles.emptyFiltreBox}>
            <Text style={styles.emptyFiltreTxt}>Aucun travailleur pour ce restaurant</Text>
          </View>
        )}
        {filtres.map(t => (
          <TouchableOpacity
            key={t.id}
            style={[styles.itemCard, !t.actif && styles.itemCardInactif]}
            onPress={() => setBadgeTravailleur(t)}
            activeOpacity={0.75}
          >
            <View style={styles.itemLeft}>
              {t.photo_url ? (
                <Image source={{ uri: t.photo_url }} style={styles.avatarPhoto} />
              ) : (
                <View style={styles.avatar}>
                  <Text style={styles.avatarTxt}>
                    {t.nom.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                  </Text>
                </View>
              )}
              <View>
                <Text style={[styles.itemNom, !t.actif && { color: '#aaa' }]}>{t.nom}</Text>
                <Text style={styles.itemSub}>{t.poste} — {t.type_contrat}</Text>
                {t.identifiant && <Text style={styles.itemPin}>ID: {t.identifiant}</Text>}
                {t.contact && <Text style={styles.itemSub}>{t.contact}</Text>}
              </View>
            </View>
            <View style={styles.itemActions}>
              <TouchableOpacity
                style={[styles.statutBtn, { backgroundColor: t.actif ? '#EAF3DE' : '#FAECE7' }]}
                onPress={(e) => { e.stopPropagation?.(); toggleActif('travailleurs', t.id, t.actif) }}
              >
                <Text style={[styles.statutTxt, { color: t.actif ? '#3B6D11' : '#993C1D' }]}>
                  {t.actif ? 'Actif' : 'Inactif'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.editBtn}
                onPress={(e) => { e.stopPropagation?.(); ouvrirModal('travailleur', t) }}
              >
                <Text style={styles.editTxt}>✏️</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        ))}
      </>
    )
  }

  // ─── RENDU UTILISATEURS ────────────────────────────────────
  function renderUtilisateurs() {
    const isManagerOuAdmin = (u) => u.nom === 'Manager General' || u.nom === 'Administrateur'
    const globaux = utilisateurs.filter(u => isManagerOuAdmin(u))
    const filtres = utilisateurs.filter(u => !isManagerOuAdmin(u) && (!restaurantFiltre || u.restaurant_id === restaurantFiltre))
    const restoNom = tousRestaurants.find(r => r.id === restaurantFiltre)?.nom || ''
    return (
      <>
        <FiltreRestaurants />
        <TouchableOpacity style={styles.addBtn} onPress={() => ouvrirModal('utilisateur', null, { restaurant_id: restaurantFiltre })}>
          <Text style={styles.addTxt}>+ Ajouter un utilisateur {restoNom ? `— ${restoNom}` : ''}</Text>
        </TouchableOpacity>

        {globaux.map(u => (
          <View key={u.id} style={[styles.itemCard, styles.itemCardManager]}>
            <View style={styles.itemLeft}>
              <View style={[styles.avatar, { backgroundColor: '#534AB7' }]}>
                <Text style={styles.avatarTxt}>
                  {u.nom.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                </Text>
              </View>
              <View>
                <Text style={styles.itemNom}>{u.nom}</Text>
                <Text style={styles.itemSub}>{u.role} — PIN: {u.pin}</Text>
                <Text style={styles.itemSub2}>Accès global — tous les restaurants</Text>
              </View>
            </View>
            <View style={styles.itemActions}>
              <View style={styles.globalBadge}>
                <Text style={styles.globalTxt}>Global</Text>
              </View>
              <TouchableOpacity style={styles.editBtn} onPress={() => ouvrirModal('utilisateur', u)}>
                <Text style={styles.editTxt}>✏️</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}

        {filtres.length === 0 ? (
          <View style={styles.emptyFiltreBox}>
            <Text style={styles.emptyFiltreTxt}>Aucun utilisateur pour ce restaurant</Text>
          </View>
        ) : (
          <>
            <Text style={styles.separateur}>Utilisateurs — {restoNom}</Text>
            {filtres.map(u => (
              <View key={u.id} style={[styles.itemCard, !u.actif && styles.itemCardInactif]}>
                <View style={styles.itemLeft}>
                  <View style={[styles.avatar, { backgroundColor: u.role === 'gerant' ? '#EF9F27' : '#888' }]}>
                    <Text style={styles.avatarTxt}>
                      {u.nom.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                    </Text>
                  </View>
                  <View>
                    <Text style={[styles.itemNom, !u.actif && { color: '#aaa' }]}>{u.nom}</Text>
                    <Text style={styles.itemSub}>{u.role} — PIN: {u.pin}</Text>
                  </View>
                </View>
                <View style={styles.itemActions}>
                  <TouchableOpacity
                    style={[styles.statutBtn, { backgroundColor: u.actif ? '#EAF3DE' : '#FAECE7' }]}
                    onPress={() => toggleActif('utilisateurs', u.id, u.actif)}
                  >
                    <Text style={[styles.statutTxt, { color: u.actif ? '#3B6D11' : '#993C1D' }]}>
                      {u.actif ? 'Actif' : 'Inactif'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.editBtn} onPress={() => ouvrirModal('utilisateur', u)}>
                    <Text style={styles.editTxt}>✏️</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.deleteBtn} onPress={() => supprimer('utilisateurs', u.id, u.nom)}>
                    <Text style={styles.deleteTxt}>🗑</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </>
        )}
      </>
    )
  }

  // ─── RENDU FOURNISSEURS ────────────────────────────────────
  function renderFournisseurs() {
    const filtres = fournisseurs.filter(f => !restaurantFiltre || f.restaurant_id === restaurantFiltre)
    const restoNom = tousRestaurants.find(r => r.id === restaurantFiltre)?.nom || ''
    return (
      <>
        <FiltreRestaurants />
        <TouchableOpacity style={styles.addBtn} onPress={() => ouvrirModal('fournisseur', null, { restaurant_ids: restaurantFiltre ? [restaurantFiltre] : [] })}>
          <Text style={styles.addTxt}>+ Ajouter un fournisseur {restoNom ? `— ${restoNom}` : ''}</Text>
        </TouchableOpacity>
        {filtres.length === 0 && (
          <View style={styles.emptyFiltreBox}>
            <Text style={styles.emptyFiltreTxt}>Aucun fournisseur pour ce restaurant</Text>
          </View>
        )}
        {filtres.map(f => (
          <View key={f.id} style={[styles.itemCard, !f.actif && styles.itemCardInactif]}>
            <View style={styles.itemLeft}>
              <View style={[styles.typeBadge, f.type === 'cotisation' && styles.typeBadgeCotis]}>
                <Text style={[styles.typeTxt, f.type === 'cotisation' && styles.typeTxtCotis]}>
                  {f.type === 'cotisation' ? 'Cotis.' : 'Fourn.'}
                </Text>
              </View>
              <View>
                <Text style={[styles.itemNom, !f.actif && { color: '#aaa' }]}>{f.nom}</Text>
                {f.identifiant && <Text style={styles.itemPin}>ID: {f.identifiant}</Text>}
                {f.contact && <Text style={styles.itemSub}>{f.contact}</Text>}
              </View>
            </View>
            <View style={styles.itemActions}>
              <TouchableOpacity
                style={[styles.statutBtn, { backgroundColor: f.actif ? '#EAF3DE' : '#FAECE7' }]}
                onPress={() => toggleActif('fournisseurs', f.id, f.actif)}
              >
                <Text style={[styles.statutTxt, { color: f.actif ? '#3B6D11' : '#993C1D' }]}>
                  {f.actif ? 'Actif' : 'Inactif'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.editBtn} onPress={() => ouvrirModal('fournisseur', f)}>
                <Text style={styles.editTxt}>✏️</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.deleteBtn} onPress={() => supprimer('fournisseurs', f.id, f.nom)}>
                <Text style={styles.deleteTxt}>🗑</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </>
    )
  }

  // ─── CONTENU MODAL ─────────────────────────────────────────
  function renderModalContent() {
    const { type } = modal
    const estManager = form.role === 'manager'

    if (type === 'restaurant') return (
      <>
        <Text style={styles.modalTitre}>{modal.data ? 'Modifier restaurant' : 'Nouveau restaurant'}</Text>

        {/* Photo du restaurant */}
        <View style={styles.photoProfilBox}>
          {form.photo_url ? (
            <Image source={{ uri: form.photo_url }} style={styles.restoPhotoPreview} />
          ) : (
            <View style={[styles.photoProfilVide, { borderRadius: 14 }]}>
              <Text style={styles.photoProfilVideEmoji}>🏪</Text>
            </View>
          )}
          <TouchableOpacity
            style={styles.photoProfilBtn}
            onPress={choisirPhotoResto}
            disabled={uploadingPhoto}
          >
            <Text style={styles.photoProfilBtnTxt}>
              {uploadingPhoto ? '⏳ Chargement...' : form.photo_url ? '🔄 Changer la photo' : '📷 Ajouter une photo'}
            </Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.modalLabel}>Nom du restaurant *</Text>
        <TextInput
          style={styles.modalInput}
          value={form.nom || ''}
          onChangeText={v => setForm(p => ({ ...p, nom: v }))}
          placeholder="Ex: Samer Angré 7E"
          placeholderTextColor="#bbb"
        />

        <Text style={styles.modalLabel}>Localisation</Text>
        <TextInput
          style={styles.modalInput}
          value={form.localisation || ''}
          onChangeText={v => setForm(p => ({ ...p, localisation: v }))}
          placeholder="Ex: Angré 7e, Abidjan"
          placeholderTextColor="#bbb"
        />

        <Text style={styles.modalLabel}>Code PIN du restaurant * (4 chiffres)</Text>
        <TextInput
          style={styles.modalInput}
          value={form.pin || ''}
          onChangeText={v => setForm(p => ({ ...p, pin: v }))}
          placeholder="Ex: 1234"
          keyboardType="numeric"
          maxLength={4}
          placeholderTextColor="#bbb"
          secureTextEntry={false}
        />
        <View style={styles.pinInfo}>
          <Text style={styles.pinInfoTxt}>
            🔒 Ce code sera demandé à tous les utilisateurs avant d'accéder au restaurant
          </Text>
        </View>

        <Text style={styles.modalLabel}>Famille</Text>
        <View style={styles.couleurRow}>
          {[
            { val: 'orange', label: '🟡 Samer', bg: '#EF9F27' },
            { val: 'vert', label: '🟢 Al Kayan', bg: '#2D7D46' }
          ].map(c => (
            <TouchableOpacity
              key={c.val}
              style={[
                styles.couleurBtn,
                { backgroundColor: c.bg },
                form.couleur === c.val && styles.couleurBtnSelected
              ]}
              onPress={() => setForm(p => ({ ...p, couleur: c.val }))}
            >
              <Text style={styles.couleurTxt}>{c.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </>
    )

    if (type === 'travailleur') return (
      <>
        <Text style={styles.modalTitre}>{modal.data ? 'Modifier travailleur' : 'Nouveau travailleur'}</Text>

        {/* Photo de profil */}
        <View style={styles.photoProfilBox}>
          {form.photo_url ? (
            <Image source={{ uri: form.photo_url }} style={styles.photoProfilPreview} />
          ) : (
            <View style={styles.photoProfilVide}>
              <Text style={styles.photoProfilVideEmoji}>👤</Text>
            </View>
          )}
          <TouchableOpacity
            style={styles.photoProfilBtn}
            onPress={choisirPhotoProfil}
            disabled={uploadingPhoto}
          >
            <Text style={styles.photoProfilBtnTxt}>
              {uploadingPhoto ? '⏳ Chargement...' : form.photo_url ? '🔄 Changer la photo' : '📷 Ajouter une photo'}
            </Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.modalLabel}>Nom complet *</Text>
        <TextInput
          style={styles.modalInput}
          value={form.nom || ''}
          onChangeText={v => setForm(p => ({ ...p, nom: v }))}
          placeholder="Ex: Kouamé Assi"
          placeholderTextColor="#bbb"
        />

        <Text style={styles.modalLabel}>Identifiant unique</Text>
        <View style={styles.identifiantRow}>
          <TextInput
            style={[styles.modalInput, { flex: 1, marginBottom: 0 }]}
            value={form.identifiant || ''}
            onChangeText={v => setForm(p => ({ ...p, identifiant: v }))}
            placeholder="Ex: EMP-001"
            placeholderTextColor="#bbb"
            autoCapitalize="characters"
          />
          <TouchableOpacity
            style={styles.genererBtn}
            onPress={() => setForm(p => ({ ...p, identifiant: 'EMP-' + Date.now().toString().slice(-5) }))}
          >
            <Text style={styles.genererTxt}>Générer</Text>
          </TouchableOpacity>
        </View>
        <View style={{ height: 14 }} />

        <Text style={styles.modalLabel}>Contact (téléphone)</Text>
        <TextInput
          style={styles.modalInput}
          value={form.contact || ''}
          onChangeText={v => setForm(p => ({ ...p, contact: v }))}
          placeholder="Ex: +225 07 00 00 00 00"
          placeholderTextColor="#bbb"
          keyboardType="phone-pad"
        />

        <Text style={styles.modalLabel}>Poste</Text>
        <TextInput
          style={styles.modalInput}
          value={form.poste || ''}
          onChangeText={v => setForm(p => ({ ...p, poste: v }))}
          placeholder="Ex: Caissier, Cuisine, Service"
          placeholderTextColor="#bbb"
        />

        <Text style={styles.modalLabel}>Type de contrat</Text>
        <View style={styles.contratRow}>
          {['CDI', 'CDD', 'Journalier'].map(c => (
            <TouchableOpacity
              key={c}
              style={[styles.contratBtn, form.type_contrat === c && styles.contratBtnSelected]}
              onPress={() => setForm(p => ({ ...p, type_contrat: c }))}
            >
              <Text style={[styles.contratTxt, form.type_contrat === c && styles.contratTxtSelected]}>{c}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <SelectRestaurant />
      </>
    )

    if (type === 'utilisateur') return (
      <>
        <Text style={styles.modalTitre}>{modal.data ? 'Modifier utilisateur' : 'Nouvel utilisateur'}</Text>

        <Text style={styles.modalLabel}>Nom complet *</Text>
        <TextInput
          style={styles.modalInput}
          value={form.nom || ''}
          onChangeText={v => setForm(p => ({ ...p, nom: v }))}
          placeholder="Ex: Séraphin Pokou"
          placeholderTextColor="#bbb"
        />

        <Text style={styles.modalLabel}>Code PIN personnel * (4 chiffres)</Text>
        <TextInput
          style={styles.modalInput}
          value={form.pin || ''}
          onChangeText={v => setForm(p => ({ ...p, pin: v }))}
          placeholder="Ex: 1234"
          keyboardType="numeric"
          maxLength={4}
          placeholderTextColor="#bbb"
        />

        <Text style={styles.modalLabel}>Rôle</Text>
        <View style={styles.contratRow}>
          {['caissier', 'gerant', 'manager'].map(r => (
            <TouchableOpacity
              key={r}
              style={[styles.contratBtn, form.role === r && styles.contratBtnSelected]}
              onPress={() => setForm(p => ({ ...p, role: r }))}
            >
              <Text style={[styles.contratTxt, form.role === r && styles.contratTxtSelected]}>{r}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {estManager ? (
          <View style={styles.infoBox}>
            <Text style={styles.infoTxt}>
              ℹ️ Le Manager a accès à tous les restaurants — pas besoin de choisir un restaurant spécifique.
            </Text>
          </View>
        ) : (
          <SelectRestaurant />
        )}
      </>
    )

    if (type === 'fournisseur') return (
      <>
        <Text style={styles.modalTitre}>{modal.data ? 'Modifier fournisseur' : 'Nouveau fournisseur'}</Text>

        <Text style={styles.modalLabel}>Nom du fournisseur *</Text>
        <TextInput
          style={styles.modalInput}
          value={form.nom || ''}
          onChangeText={v => setForm(p => ({ ...p, nom: v }))}
          placeholder="Ex: Anicet — Viande & Filet"
          placeholderTextColor="#bbb"
        />

        <Text style={styles.modalLabel}>Identifiant unique</Text>
        <View style={styles.identifiantRow}>
          <TextInput
            style={[styles.modalInput, { flex: 1, marginBottom: 0 }]}
            value={form.identifiant || ''}
            onChangeText={v => setForm(p => ({ ...p, identifiant: v }))}
            placeholder="Ex: FOUR-001"
            placeholderTextColor="#bbb"
            autoCapitalize="characters"
          />
          <TouchableOpacity
            style={styles.genererBtn}
            onPress={() => setForm(p => ({ ...p, identifiant: 'FOUR-' + Date.now().toString().slice(-5) }))}
          >
            <Text style={styles.genererTxt}>Générer</Text>
          </TouchableOpacity>
        </View>
        <View style={{ height: 14 }} />

        <Text style={styles.modalLabel}>Contact (téléphone)</Text>
        <TextInput
          style={styles.modalInput}
          value={form.contact || ''}
          onChangeText={v => setForm(p => ({ ...p, contact: v }))}
          placeholder="Ex: +225 07 00 00 00 00"
          placeholderTextColor="#bbb"
          keyboardType="phone-pad"
        />

        <Text style={styles.modalLabel}>Type</Text>
        <View style={styles.contratRow}>
          {['fournisseur', 'cotisation'].map(t => (
            <TouchableOpacity
              key={t}
              style={[styles.contratBtn, form.type === t && styles.contratBtnSelected]}
              onPress={() => setForm(p => ({ ...p, type: t }))}
            >
              <Text style={[styles.contratTxt, form.type === t && styles.contratTxtSelected]}>{t}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {modal.data ? <SelectRestaurant /> : <SelectMultipleRestaurants />}

        {isManager && modal.data && (
          <>
            <View style={styles.creditSeparateur} />
            <Text style={styles.modalLabel}>Modifier le crédit (Manager)</Text>
            {creditActuel !== null && (
              <View style={styles.creditActuelBanner}>
                <Text style={styles.creditActuelLabel}>Crédit actuel enregistré</Text>
                <Text style={styles.creditActuelVal}>
                  {Math.round(creditActuel).toLocaleString('fr-FR')} FCFA
                </Text>
              </View>
            )}
            <TextInput
              style={styles.modalInput}
              value={form.nouveau_credit || ''}
              onChangeText={v => setForm(p => ({ ...p, nouveau_credit: v }))}
              keyboardType="numeric"
              placeholder="Nouveau montant du crédit (ex: 15000)"
              placeholderTextColor="#bbb"
            />
            <View style={styles.infoBox}>
              <Text style={styles.infoTxt}>
                ⚠️ Cette valeur écrase le crédit actuel du fournisseur. À utiliser uniquement pour corriger une erreur.
              </Text>
            </View>
          </>
        )}
      </>
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
        <Text style={styles.headerTitre}>Paramètres</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabs}>
        {SECTIONS.map(s => (
          <TouchableOpacity
            key={s.key}
            style={[styles.tab, sectionActive === s.key && styles.tabActive]}
            onPress={() => setSectionActive(s.key)}
          >
            <Text style={[styles.tabTxt, sectionActive === s.key && styles.tabTxtActive]}>{s.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
        {sectionActive === 'restaurants' && renderRestaurants()}
        {sectionActive === 'travailleurs' && renderTravailleurs()}
        {sectionActive === 'utilisateurs' && renderUtilisateurs()}
        {sectionActive === 'fournisseurs' && renderFournisseurs()}
        <View style={{ height: 40 }} />
      </ScrollView>

      {/* ── BADGE TRAVAILLEUR ── */}
      <Modal visible={!!badgeTravailleur} transparent animationType="fade">
        <TouchableWithoutFeedback onPress={() => setBadgeTravailleur(null)}>
          <View style={styles.badgeOverlay}>
            <TouchableWithoutFeedback>
              <View style={styles.badgeCard}>
                {/* En-tête coloré */}
                <View style={styles.badgeHeader}>
                  <Text style={styles.badgeHeaderTxt}>
                    {tousRestaurants.find(r => r.id === badgeTravailleur?.restaurant_id)?.nom || 'Samtrackly'}
                  </Text>
                  <TouchableOpacity onPress={() => setBadgeTravailleur(null)}>
                    <Text style={styles.badgeClose}>✕</Text>
                  </TouchableOpacity>
                </View>

                {/* Photo */}
                <View style={styles.badgeAvatarBox}>
                  {badgeTravailleur?.photo_url ? (
                    <Image source={{ uri: badgeTravailleur.photo_url }} style={styles.badgePhoto} />
                  ) : (
                    <View style={styles.badgeAvatarVide}>
                      <Text style={styles.badgeAvatarTxt}>
                        {(badgeTravailleur?.nom || '').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                      </Text>
                    </View>
                  )}
                  <View style={[styles.badgeStatutDot, {
                    backgroundColor: badgeTravailleur?.actif ? '#3B6D11' : '#A32D2D'
                  }]} />
                </View>

                {/* Infos */}
                <Text style={styles.badgeNom}>{badgeTravailleur?.nom}</Text>
                <Text style={styles.badgePoste}>{badgeTravailleur?.poste || '—'}</Text>

                <View style={styles.badgeSeparateur} />

                <View style={styles.badgeInfoGrid}>
                  <View style={styles.badgeInfoItem}>
                    <Text style={styles.badgeInfoLabel}>Contrat</Text>
                    <Text style={styles.badgeInfoVal}>{badgeTravailleur?.type_contrat || '—'}</Text>
                  </View>
                  <View style={styles.badgeInfoItem}>
                    <Text style={styles.badgeInfoLabel}>Statut</Text>
                    <Text style={[styles.badgeInfoVal, { color: badgeTravailleur?.actif ? '#3B6D11' : '#A32D2D' }]}>
                      {badgeTravailleur?.actif ? 'Actif' : 'Inactif'}
                    </Text>
                  </View>
                  {badgeTravailleur?.contact && (
                    <View style={styles.badgeInfoItem}>
                      <Text style={styles.badgeInfoLabel}>Contact</Text>
                      <Text style={styles.badgeInfoVal}>{badgeTravailleur.contact}</Text>
                    </View>
                  )}
                </View>

                {/* ID unique */}
                {badgeTravailleur?.identifiant && (
                  <View style={styles.badgeId}>
                    <Text style={styles.badgeIdTxt}>{badgeTravailleur.identifiant}</Text>
                  </View>
                )}

                {/* Bouton modifier */}
                <TouchableOpacity
                  style={styles.badgeEditBtn}
                  onPress={() => {
                    setBadgeTravailleur(null)
                    ouvrirModal('travailleur', badgeTravailleur)
                  }}
                >
                  <Text style={styles.badgeEditTxt}>✏️ Modifier le profil</Text>
                </TouchableOpacity>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      <Modal visible={modal.visible} transparent animationType="slide">
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.modalOverlay}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
              <ScrollView
                style={styles.modal}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                {renderModalContent()}
                <View style={styles.modalBtns}>
                  <TouchableOpacity
                    style={styles.modalCancel}
                    onPress={() => setModal({ visible: false, type: '', data: null })}
                  >
                    <Text style={styles.modalCancelTxt}>Annuler</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalConfirm, loading && { opacity: 0.6 }]}
                    onPress={sauvegarder}
                    disabled={loading}
                  >
                    <Text style={styles.modalConfirmTxt}>
                      {loading ? 'Enregistrement...' : 'Enregistrer'}
                    </Text>
                  </TouchableOpacity>
                </View>
                <View style={{ height: 30 }} />
              </ScrollView>
            </KeyboardAvoidingView>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: {
    backgroundColor: '#534AB7', padding: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'
  },
  back: { fontSize: 16, color: '#CECBF6', fontWeight: '500' },
  headerTitre: { fontSize: 16, fontWeight: '600', color: '#fff' },
  tabs: { backgroundColor: '#fff', maxHeight: 46, borderBottomWidth: 0.5, borderBottomColor: '#eee' },
  tab: { paddingHorizontal: 16, paddingVertical: 12 },
  tabActive: { borderBottomWidth: 2, borderBottomColor: '#534AB7' },
  tabTxt: { fontSize: 13, color: '#888' },
  tabTxtActive: { color: '#534AB7', fontWeight: '600' },
  body: { flex: 1, padding: 14 },
  addBtn: {
    borderWidth: 1, borderStyle: 'dashed', borderColor: '#534AB7',
    borderRadius: 12, padding: 14, alignItems: 'center', marginBottom: 12
  },
  addTxt: { fontSize: 14, color: '#534AB7', fontWeight: '500' },
  separateur: {
    fontSize: 11, fontWeight: '600', color: '#888',
    letterSpacing: 0.5, textTransform: 'uppercase', marginVertical: 10
  },
  itemCard: {
    backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 10,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderWidth: 0.5, borderColor: '#eee'
  },
  itemCardInactif: { opacity: 0.5 },
  itemCardManager: { borderColor: '#534AB7', backgroundColor: '#EEEDFE' },
  itemLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  itemDot: { width: 12, height: 12, borderRadius: 6 },
  avatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#EF9F27', alignItems: 'center', justifyContent: 'center'
  },
  avatarTxt: { fontSize: 13, fontWeight: '600', color: '#fff' },
  itemNom: { fontSize: 14, fontWeight: '600', color: '#1a1a1a' },
  itemSub: { fontSize: 11, color: '#888', marginTop: 2 },
  itemSub2: { fontSize: 10, color: '#bbb', marginTop: 1 },
  itemPin: { fontSize: 10, color: '#534AB7', marginTop: 2, fontWeight: '500' },
  itemActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  editBtn: { padding: 6 },
  editTxt: { fontSize: 16 },
  deleteBtn: { padding: 6 },
  deleteTxt: { fontSize: 16 },
  statutBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  statutTxt: { fontSize: 11, fontWeight: '500' },
  globalBadge: { backgroundColor: '#534AB7', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  globalTxt: { fontSize: 11, color: '#fff', fontWeight: '500' },
  typeBadge: { backgroundColor: '#FAEEDA', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10 },
  typeBadgeCotis: { backgroundColor: '#E6F1FB' },
  typeTxt: { fontSize: 10, color: '#854F0B', fontWeight: '500' },
  typeTxtCotis: { color: '#185FA5' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modal: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, maxHeight: '90%' },
  modalTitre: { fontSize: 18, fontWeight: '600', color: '#1a1a1a', marginBottom: 20 },
  modalLabel: {
    fontSize: 11, fontWeight: '600', color: '#888',
    letterSpacing: 0.5, marginBottom: 6, textTransform: 'uppercase'
  },
  modalInput: {
    backgroundColor: '#f5f5f5', borderRadius: 12,
    padding: 14, fontSize: 15, color: '#1a1a1a', marginBottom: 14
  },
  pinInfo: {
    backgroundColor: '#EEEDFE', borderRadius: 10,
    padding: 10, marginBottom: 14
  },
  pinInfoTxt: { fontSize: 12, color: '#3C3489', lineHeight: 18 },
  couleurRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  couleurBtn: { flex: 1, padding: 12, borderRadius: 10, alignItems: 'center', opacity: 0.6 },
  couleurBtnSelected: { opacity: 1, borderWidth: 2, borderColor: '#1a1a1a' },
  couleurTxt: { fontSize: 13, color: '#fff', fontWeight: '600' },
  contratRow: { flexDirection: 'row', gap: 8, marginBottom: 14, flexWrap: 'wrap' },
  contratBtn: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    backgroundColor: '#f5f5f5', borderWidth: 0.5, borderColor: '#eee'
  },
  contratBtnSelected: { backgroundColor: '#534AB7', borderColor: '#534AB7' },
  contratTxt: { fontSize: 13, color: '#888' },
  contratTxtSelected: { color: '#fff', fontWeight: '600' },
  restoBtn: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    backgroundColor: '#f5f5f5', borderWidth: 0.5, borderColor: '#eee', marginRight: 8
  },
  restoBtnSelected: { backgroundColor: '#EF9F27', borderColor: '#EF9F27' },
  restoTxt: { fontSize: 12, color: '#888' },
  restoTxtSelected: { color: '#412402', fontWeight: '600' },
  infoBox: { backgroundColor: '#EAF3DE', borderRadius: 10, padding: 10, marginBottom: 14 },
  infoTxt: { fontSize: 12, color: '#3B6D11', lineHeight: 18 },
  modalBtns: { flexDirection: 'row', gap: 10, marginTop: 8 },
  modalCancel: { flex: 1, padding: 14, borderRadius: 12, backgroundColor: '#f5f5f5', alignItems: 'center' },
  modalCancelTxt: { fontSize: 14, color: '#888' },
  modalConfirm: { flex: 2, padding: 14, borderRadius: 12, backgroundColor: '#534AB7', alignItems: 'center' },
  modalConfirmTxt: { fontSize: 14, fontWeight: '600', color: '#fff' },
  filtreBar: { marginBottom: 4, marginHorizontal: -14 },
  filtrePill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: '#f0f0f0', marginRight: 8, borderWidth: 1, borderColor: 'transparent' },
  filtrePillActive: { backgroundColor: '#EEEDFE', borderColor: '#534AB7' },
  filtreDot: { width: 8, height: 8, borderRadius: 4 },
  filtrePillTxt: { fontSize: 12, color: '#888', fontWeight: '500' },
  filtrePillTxtActive: { color: '#534AB7', fontWeight: '600' },
  emptyFiltreBox: { alignItems: 'center', paddingVertical: 30 },
  emptyFiltreTxt: { fontSize: 13, color: '#bbb' },
  identifiantRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 0 },
  genererBtn: { backgroundColor: '#EEEDFE', paddingHorizontal: 12, paddingVertical: 14, borderRadius: 12 },
  genererTxt: { fontSize: 12, color: '#534AB7', fontWeight: '600' },
  avatarPhoto: { width: 40, height: 40, borderRadius: 20 },
  photoProfilBox: { alignItems: 'center', marginBottom: 20 },
  photoProfilPreview: { width: 100, height: 100, borderRadius: 50, marginBottom: 10 },
  photoProfilVide: {
    width: 100, height: 100, borderRadius: 50, backgroundColor: '#EEEDFE',
    alignItems: 'center', justifyContent: 'center', marginBottom: 10,
  },
  photoProfilVideEmoji: { fontSize: 40 },
  photoProfilBtn: {
    backgroundColor: '#EEEDFE', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20,
  },
  photoProfilBtnTxt: { fontSize: 13, color: '#534AB7', fontWeight: '500' },
  badgeOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center', alignItems: 'center', padding: 24,
  },
  badgeCard: {
    backgroundColor: '#fff', borderRadius: 24, width: '100%',
    overflow: 'hidden', alignItems: 'center',
  },
  badgeHeader: {
    backgroundColor: '#534AB7', width: '100%', paddingHorizontal: 20,
    paddingVertical: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  badgeHeaderTxt: { fontSize: 13, fontWeight: '600', color: '#CECBF6' },
  badgeClose: { fontSize: 18, color: '#fff' },
  badgeAvatarBox: { marginTop: 24, marginBottom: 12, position: 'relative' },
  badgePhoto: { width: 110, height: 110, borderRadius: 55, borderWidth: 3, borderColor: '#534AB7' },
  badgeAvatarVide: {
    width: 110, height: 110, borderRadius: 55,
    backgroundColor: '#EEEDFE', alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: '#534AB7',
  },
  badgeAvatarTxt: { fontSize: 36, fontWeight: '700', color: '#534AB7' },
  badgeStatutDot: {
    position: 'absolute', bottom: 4, right: 4,
    width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: '#fff',
  },
  badgeNom: { fontSize: 22, fontWeight: '700', color: '#1a1a1a', textAlign: 'center', paddingHorizontal: 20 },
  badgePoste: { fontSize: 14, color: '#534AB7', fontWeight: '500', marginTop: 4, marginBottom: 16 },
  badgeSeparateur: { height: 1, backgroundColor: '#f0f0f0', width: '85%', marginBottom: 16 },
  badgeInfoGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10, paddingHorizontal: 20, marginBottom: 16 },
  badgeInfoItem: { backgroundColor: '#f5f5f5', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10, alignItems: 'center', minWidth: '40%' },
  badgeInfoLabel: { fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  badgeInfoVal: { fontSize: 14, fontWeight: '600', color: '#1a1a1a' },
  badgeId: {
    backgroundColor: '#EEEDFE', borderRadius: 20, paddingHorizontal: 20, paddingVertical: 8,
    marginBottom: 20, borderWidth: 1, borderColor: '#CECBF6',
  },
  badgeIdTxt: { fontSize: 13, fontWeight: '700', color: '#534AB7', letterSpacing: 1 },
  badgeEditBtn: {
    backgroundColor: '#534AB7', marginHorizontal: 24, marginBottom: 24,
    padding: 14, borderRadius: 14, alignItems: 'center', width: '85%',
  },
  badgeEditTxt: { fontSize: 14, fontWeight: '600', color: '#fff' },
  creditSeparateur: { height: 1, backgroundColor: '#eee', marginVertical: 16 },
  creditActuelBanner: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#FFF3CD', borderRadius: 10, padding: 12, marginBottom: 10 },
  creditActuelLabel: { fontSize: 12, color: '#7A4F00', fontWeight: '500' },
  creditActuelVal: { fontSize: 15, fontWeight: '700', color: '#A32D2D' },
  restoPhotoPreview: { width: 100, height: 100, borderRadius: 14, marginBottom: 10 },
  restoBadgeBtn: {
    alignItems: 'center', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 14,
    backgroundColor: '#f5f5f5', borderWidth: 1, borderColor: '#eee', marginRight: 8, minWidth: 72,
  },
  restoBadgeBtnSelected: { backgroundColor: '#EEEDFE', borderColor: '#534AB7' },
  restoBadgeImg: { width: 44, height: 44, borderRadius: 10, marginBottom: 4 },
  restoBadgeAvatar: { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  restoBadgeAvatarTxt: { fontSize: 14, fontWeight: '700', color: '#fff' },
  restoBadgeTxt: { fontSize: 10, color: '#888', textAlign: 'center', maxWidth: 70 },
  restoBadgeTxtSelected: { color: '#534AB7', fontWeight: '600' },
  restoBadgeCheck: { fontSize: 12, color: '#534AB7', fontWeight: '700', marginTop: 2 },
})