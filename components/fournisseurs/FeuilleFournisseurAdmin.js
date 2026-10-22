// Créer un fournisseur administratif (TEE, CNPS, bail, mairie…), régler son
// échéance automatique, ou transformer un fournisseur existant (son crédit et
// son historique ne bougent pas). RH, manager, directeur — depuis Crédits.
// À la création ou au passage en administratif : « Déjà dû avant aujourd'hui »
// (le retard) — une correction (ajustement_manager), pas une charge du mois.
// styles : ceux de l'écran Crédits fournisseurs (même apparence).
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Modal, SafeAreaView, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { useTheme } from '../../context/ThemeContext'
import { libelleMois } from '../../lib/facturesMensuelles'
import { TYPE_ADMIN, champsEcheance, choixMoisDepart, estAdministratif } from '../../lib/fournisseursAdmin'
import { ecritureAjustementCredit } from '../../lib/creditsFournisseurs'
import { chargerDerniersRestes } from '../../lib/derniersRestesFournisseurs'
import { cleRattachement, estFicheGroupe, nomRattachement } from '../../lib/groupes'
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
 * groupes : [{ id, nom }] — une fiche de groupe (« groupe:<id> » dans le choix)
 * n'a ni restaurant ni échéance ; seule la direction la paie (22/10/2026).
 */
export default function FeuilleFournisseurAdmin({
  visible, fournisseur, restaurants = [], groupes = [], restaurantParDefaut, roleActif, userId, userNom, styles, onFermer, onEnregistre,
}) {
  const { colors } = useTheme()
  const [nom, setNom] = useState('')
  const [restaurantId, setRestaurantId] = useState(null)
  const [montant, setMontant] = useState('')
  const [periodicite, setPeriodicite] = useState('mensuel')
  const [depuis, setDepuis] = useState(null)
  const [dejaDu, setDejaDu] = useState('')            // retard avant aujourd'hui ; vide = ne pas toucher
  const [occupe, setOccupe] = useState(false)
  const [erreur, setErreur] = useState(null)

  const dejaAdmin = estAdministratif(fournisseur)
  const aujourdhui = aujourdhuiISO()

  useEffect(() => {
    if (!visible) return
    const f = fournisseur || {}
    setNom(f.nom || '')
    setRestaurantId(f.restaurant_id || (f.groupe_id ? `groupe:${f.groupe_id}` : null) || restaurantParDefaut || null)
    setMontant(Number(f.facture_mensuelle) > 0 ? String(f.facture_mensuelle) : '')
    setPeriodicite(f.facture_periodicite === 'annuel' ? 'annuel' : 'mensuel')
    setDepuis(f.facture_mensuelle_depuis || null)
    setDejaDu('')
    setErreur(null)
  }, [visible, fournisseur, restaurantParDefaut])

  const choix = choixMoisDepart(periodicite, aujourdhui, depuis)
  const moisChoisi = depuis || choix.find(m => m > `${aujourdhui.slice(0, 7)}-01`) || choix[0]
  const nomResto = cle => nomRattachement(cle, restaurants, groupes)
  const choixGroupe = String(restaurantId || '').startsWith('groupe:')
  const ficheGroupe = choixGroupe || estFicheGroupe(fournisseur)
  const peutEnregistrer = nom.trim() && (fournisseur?.id || restaurantId)

  async function enregistrer() {
    if (!peutEnregistrer || occupe) return
    setOccupe(true)
    setErreur(null)
    try {
      // Fiche de groupe : pas d'échéance automatique (arriérés, payés par la direction).
      const champs = { nom: nom.trim(), type: TYPE_ADMIN, ...champsEcheance({ montant: ficheGroupe ? 0 : montant, periodicite, depuis: moisChoisi }, aujourdhui) }
      const resto = fournisseur?.restaurant_id || (choixGroupe ? null : restaurantId)
      const groupeId = fournisseur ? fournisseur.groupe_id || null : (choixGroupe ? restaurantId.slice('groupe:'.length) : null)
      let nouveauId = null
      if (fournisseur?.id) {
        const { error } = await supabase.from('fournisseurs').update(champs).eq('id', fournisseur.id)
        if (error) throw error
      } else {
        const { data, error } = await supabase.from('fournisseurs')
          .insert({ ...champs, restaurant_id: resto, groupe_id: groupeId, actif: true }).select('id').single()
        if (error) throw error
        nouveauId = data.id
        if (resto) {
          await supabase.from('fournisseurs_restaurants').upsert(
            { fournisseur_id: data.id, restaurant_id: resto, credit_actuel: 0 },
            { onConflict: 'fournisseur_id,restaurant_id' })
        }
      }
      if (!dejaAdmin && dejaDu !== '') await poserDejaDu(fournisseur?.id || nouveauId, Number(dejaDu) || 0, champs.nom)
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

  // Amène le crédit au retard saisi par une écriture datée du jour, depuis le
  // solde de l'historique (ce que voit le gérant), comme « Modifier ».
  async function poserDejaDu(id, voulu, nomF) {
    const derniers = await chargerDerniersRestes(supabase, [id])
    const enregistre = Number(fournisseur?.credit_actuel) || 0
    const solde = derniers[id] ? Number(derniers[id].reste) || 0 : enregistre
    const e = ecritureAjustementCredit(voulu - solde)
    if (!e) return
    const { data: txId, error } = await supabase.rpc('inserer_transaction_hors_point', {
      p_fournisseur: id, p_date: aujourdhui, p_facture: e.facture, p_paye: e.paye,
      p_saisi_par: roleActif || 'manager', p_source: 'ajustement_manager', p_caissier_nom: userNom || null,
    })
    if (error) throw error
    // credit_actuel avait pu dériver de l'historique : on l'aligne sur le retard saisi.
    if (fournisseur?.id && enregistre !== solde) await supabase.from('fournisseurs').update({ credit_actuel: voulu }).eq('id', id)
    if (txId) {
      await supabase.from('transactions_fournisseurs')
        .update({ facture_correction_raison: 'Dû avant le passage en administratif' }).eq('id', txId)
    }
    journaliser('fournisseur_admin_deja_du', { nom: nomF, avant: solde, du: voulu }, { restaurantId: fournisseur?.restaurant_id || restaurantId, userId, userNom }).catch(() => {})
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
              <Text style={{ color: colors.text, fontWeight: '700' }}>{nomResto(cleRattachement(fournisseur)) || fournisseur.restaurant_nom || '—'}</Text>
            ) : (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {restaurants.map(r => (
                  <Puce key={r.id} styles={styles} actif={restaurantId === r.id} label={r.nom} onPress={() => setRestaurantId(r.id)} />
                ))}
                {groupes.map(g => (
                  <Puce key={g.id} styles={styles} actif={restaurantId === `groupe:${g.id}`} label={g.nom}
                    onPress={() => setRestaurantId(`groupe:${g.id}`)} />
                ))}
              </View>
            )}
          </View>

          {!dejaAdmin && (
            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Déjà dû avant aujourd'hui (FCFA)</Text>
              <TextInput style={[styles.formInput, { fontSize: 18, fontWeight: '700' }]} value={dejaDu}
                onChangeText={v => setDejaDu(v.replace(/[^0-9]/g, ''))} keyboardType="numeric"
                placeholder={fournisseur ? `Vide = garder ${Math.round(Number(fournisseur.credit_actuel) || 0).toLocaleString('fr-FR')} F` : 'Vide = 0'}
                placeholderTextColor={colors.textPlaceholder} />
              <Text style={[styles.traceNoteTxt, { marginTop: 6 }]}>
                Le retard accumulé jusqu'ici. Un montant dû n'est jamais une charge : seul son paiement l'est.
              </Text>
            </View>
          )}

          {ficheGroupe ? (
            <Text style={[styles.formLabel, { marginBottom: 12 }]}>
              Fiche du groupe : pas d'échéance automatique, payée par la direction seulement.
            </Text>
          ) : (
          <>
          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>{dejaAdmin ? 'Montant de chaque échéance (FCFA)' : 'Puis, montant qui s\'ajoute à chaque échéance (FCFA)'}</Text>
            <TextInput style={[styles.formInput, { fontSize: 18, fontWeight: '700' }]} value={montant}
              onChangeText={v => setMontant(v.replace(/[^0-9]/g, ''))} keyboardType="numeric"
              placeholder="Vide = pas d'échéance automatique" placeholderTextColor={colors.textPlaceholder} />
            {!(Number(montant) > 0) && (
              <Text style={[styles.traceNoteTxt, { marginTop: 6 }]}>
                Sans montant automatique : chaque mois, ajoutez ce qui est dû avec « Ajouter un montant dû » sur la fiche.
              </Text>
            )}
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
          </>
          )}

          <View style={styles.traceNote}>
            <MaterialCommunityIcons name="information-outline" size={16} color={colors.textSecondary} />
            <Text style={styles.traceNoteTxt}>
              {dejaAdmin ? 'Pour corriger le retard, « Modifier » sur la fiche (manager). ' : ''}{ficheGroupe
                ? 'La direction la paie avec « Payé par la direction » ; le paiement compte dans le résultat de tous les restaurants.'
                : 'Le gérant le paie dans Déductions gérant → Administratifs ; la direction avec « Payé par la direction ».'}
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
