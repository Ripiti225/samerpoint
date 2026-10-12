// Créer un fournisseur administratif (TEE, CNPS, bail, mairie…), régler son
// échéance automatique, ou transformer un fournisseur existant (son crédit et
// son historique ne bougent pas). RH, manager, directeur — depuis Crédits.
// Le retard déjà dû se saisit ensuite avec « Modifier » sur la fiche.
// styles : ceux de l'écran Crédits fournisseurs (même apparence).
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Modal, SafeAreaView, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { useTheme } from '../../context/ThemeContext'
import { libelleMois } from '../../lib/facturesMensuelles'
import { TYPE_ADMIN, champsEcheance, choixMoisDepart, estAdministratif } from '../../lib/fournisseursAdmin'
import { journaliser } from '../../lib/journal'
import { supabase } from '../../lib/supabase'
import { aujourdhuiISO } from '../../lib/tresorerie'

const MIGRATION = 'Il faut d\'abord passer supabase_fournisseurs_administratifs.sql dans Supabase.'

function Puce({ styles, actif, label, onPress }) {
  return (
    <TouchableOpacity style={[styles.moisChip, actif && styles.moisChipActive]} onPress={onPress}>
      <Text style={[styles.moisChipTxt, actif && styles.moisChipTxtActive]}>{label}</Text>
    </TouchableOpacity>
  )
}

/**
 * fournisseur : null = création ; sinon la fiche complète (select '*').
 * restaurants : [{ id, nom }] · restaurantParDefaut : id présélectionné (création).
 */
export default function FeuilleFournisseurAdmin({
  visible, fournisseur, restaurants = [], restaurantParDefaut, userId, userNom, styles, onFermer, onEnregistre,
}) {
  const { colors } = useTheme()
  const [nom, setNom] = useState('')
  const [restaurantId, setRestaurantId] = useState(null)
  const [montant, setMontant] = useState('')
  const [periodicite, setPeriodicite] = useState('mensuel')
  const [depuis, setDepuis] = useState(null)
  const [occupe, setOccupe] = useState(false)
  const [erreur, setErreur] = useState(null)

  const dejaAdmin = estAdministratif(fournisseur)
  const aujourdhui = aujourdhuiISO()

  useEffect(() => {
    if (!visible) return
    const f = fournisseur || {}
    setNom(f.nom || '')
    setRestaurantId(f.restaurant_id || restaurantParDefaut || null)
    setMontant(Number(f.facture_mensuelle) > 0 ? String(f.facture_mensuelle) : '')
    setPeriodicite(f.facture_periodicite === 'annuel' ? 'annuel' : 'mensuel')
    setDepuis(f.facture_mensuelle_depuis || null)
    setErreur(null)
  }, [visible, fournisseur, restaurantParDefaut])

  const choix = choixMoisDepart(periodicite, aujourdhui, depuis)
  const moisChoisi = depuis || choix.find(m => m > `${aujourdhui.slice(0, 7)}-01`) || choix[0]
  const nomResto = id => restaurants.find(r => r.id === id)?.nom || ''
  const peutEnregistrer = nom.trim() && (fournisseur?.id || restaurantId)

  async function enregistrer() {
    if (!peutEnregistrer || occupe) return
    setOccupe(true)
    setErreur(null)
    try {
      const champs = { nom: nom.trim(), type: TYPE_ADMIN, ...champsEcheance({ montant, periodicite, depuis: moisChoisi }, aujourdhui) }
      let resto = fournisseur?.restaurant_id || restaurantId
      if (fournisseur?.id) {
        const { error } = await supabase.from('fournisseurs').update(champs).eq('id', fournisseur.id)
        if (error) throw error
      } else {
        const { data, error } = await supabase.from('fournisseurs')
          .insert({ ...champs, restaurant_id: resto, actif: true }).select('id').single()
        if (error) throw error
        await supabase.from('fournisseurs_restaurants').upsert(
          { fournisseur_id: data.id, restaurant_id: resto, credit_actuel: 0 },
          { onConflict: 'fournisseur_id,restaurant_id' })
      }
      journaliser(fournisseur?.id ? (dejaAdmin ? 'fournisseur_admin_modifie' : 'fournisseur_passe_administratif') : 'fournisseur_admin_cree', {
        nom: champs.nom, montant: champs.facture_mensuelle, periodicite: champs.facture_periodicite,
        depuis: champs.facture_mensuelle_depuis,
      }, { restaurantId: resto, userId, userNom }).catch(() => {})
      onEnregistre()
    } catch (e) {
      setErreur(/facture_periodicite|administratif_depuis/.test(e?.message || '') ? MIGRATION : (e?.message || 'Enregistrement impossible. Réessayez.'))
    }
    setOccupe(false)
  }

  function repasserNormal() {
    Alert.alert('Repasser en fournisseur normal ?', `${fournisseur.nom} redevient un fournisseur de marchandise : plus d'échéance automatique. Son crédit ne change pas.`, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Confirmer', onPress: async () => {
          setOccupe(true)
          const { error } = await supabase.from('fournisseurs')
            .update({ type: 'fournisseur', facture_mensuelle: 0, facture_mensuelle_depuis: null }).eq('id', fournisseur.id)
          setOccupe(false)
          if (error) { setErreur(error.message); return }
          journaliser('fournisseur_admin_retire', { nom: fournisseur.nom }, { restaurantId: fournisseur.restaurant_id, userId, userNom }).catch(() => {})
          onEnregistre()
        },
      },
    ])
  }

  const titre = !fournisseur ? 'Nouveau fournisseur administratif' : dejaAdmin ? 'Réglages' : 'Passer en administratif'

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onFermer}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={onFermer} style={styles.enteteBtn} accessibilityRole="button" accessibilityLabel="Fermer">
            <MaterialCommunityIcons name="close" size={22} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={[styles.modalTitre, { flex: 1, textAlign: 'center' }]} numberOfLines={1}>{titre}</Text>
          <View style={{ width: 40 }} />
        </View>
        <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>Nom *</Text>
            <TextInput style={styles.formInput} value={nom} onChangeText={setNom}
              placeholder="Ex : TEE, CNPS, Contrat de bail, ODP…" placeholderTextColor={colors.textPlaceholder} />
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>Restaurant {fournisseur ? '' : '*'}</Text>
            {fournisseur ? (
              <Text style={{ color: colors.text, fontWeight: '700' }}>{nomResto(fournisseur.restaurant_id) || fournisseur.restaurant_nom || '—'}</Text>
            ) : (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {restaurants.map(r => (
                  <Puce key={r.id} styles={styles} actif={restaurantId === r.id} label={r.nom} onPress={() => setRestaurantId(r.id)} />
                ))}
              </View>
            )}
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>Montant de chaque échéance (FCFA)</Text>
            <TextInput style={[styles.formInput, { fontSize: 18, fontWeight: '700' }]} value={montant}
              onChangeText={v => setMontant(v.replace(/[^0-9]/g, ''))} keyboardType="numeric"
              placeholder="Vide = pas d'échéance automatique" placeholderTextColor={colors.textPlaceholder} />
          </View>

          {Number(montant) > 0 && (
            <>
              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Revient</Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Puce styles={styles} actif={periodicite === 'mensuel'} label="Chaque mois" onPress={() => { setPeriodicite('mensuel'); setDepuis(null) }} />
                  <Puce styles={styles} actif={periodicite === 'annuel'} label="Chaque année" onPress={() => { setPeriodicite('annuel'); setDepuis(null) }} />
                </View>
              </View>
              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>{periodicite === 'annuel' ? 'Mois de l\'échéance' : 'À partir de'}</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {choix.map(m => (
                    <Puce key={m} styles={styles} actif={moisChoisi === m} label={libelleMois(m)} onPress={() => setDepuis(m)} />
                  ))}
                </View>
              </View>
              <View style={styles.traceNote}>
                <MaterialCommunityIcons name="calendar-refresh" size={16} color={colors.textSecondary} />
                <Text style={styles.traceNoteTxt}>
                  {periodicite === 'annuel'
                    ? `Le 1er ${libelleMois(moisChoisi)}, puis chaque année ce mois-là, le montant s'ajoute à ce que doit le restaurant.`
                    : `Le 1er de chaque mois à partir de ${libelleMois(moisChoisi)}, le montant s'ajoute à ce que doit le restaurant.`}
                  {' '}Choisissez une échéance après le dernier mois déjà compté dans la Trésorerie.
                </Text>
              </View>
            </>
          )}

          <View style={styles.traceNote}>
            <MaterialCommunityIcons name="information-outline" size={16} color={colors.textSecondary} />
            <Text style={styles.traceNoteTxt}>
              Ce que le restaurant doit déjà (le retard) se règle ensuite avec « Modifier » sur sa fiche.
              Le gérant le paie dans Déductions gérant → Administratifs ; la direction avec « Payé par la direction ».
            </Text>
          </View>

          {erreur ? <Text style={{ color: colors.error, marginBottom: 10, fontWeight: '600' }}>{erreur}</Text> : null}

          <TouchableOpacity style={[styles.saveBtn, { backgroundColor: colors.primary }, (!peutEnregistrer || occupe) && { opacity: 0.6 }]}
            onPress={enregistrer} disabled={!peutEnregistrer || occupe}>
            {occupe ? <ActivityIndicator size="small" color="#FFFFFF" /> : <MaterialCommunityIcons name="content-save-outline" size={18} color="#FFFFFF" />}
            <Text style={styles.saveBtnTxt}>{occupe ? 'Enregistrement…' : 'Enregistrer'}</Text>
          </TouchableOpacity>

          {dejaAdmin && (
            <TouchableOpacity style={{ alignItems: 'center', paddingVertical: 14 }} onPress={repasserNormal} disabled={occupe}>
              <Text style={{ color: colors.textSecondary, fontWeight: '600' }}>Repasser en fournisseur normal</Text>
            </TouchableOpacity>
          )}
          <View style={{ height: 30 }} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  )
}
