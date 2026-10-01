// ──────────────────────────────────────────────────────────────────────────────
// Trésorerie — Banque : soldes BACI / SIB, recalage sur relevé, reçus banque.
//
// Le solde n'est jamais saisi directement : c'est la somme des mouvements.
// « Recaler » ajoute le mouvement qui aligne l'app sur le relevé (le tout
// premier recalage sert de solde de départ).
// ──────────────────────────────────────────────────────────────────────────────
import { useMemo, useState } from 'react'
import { Alert, Image, SafeAreaView, ScrollView, Text, TouchableOpacity, View } from 'react-native'

import {
  Bouton, Champ, ChampMontant, Entete, EtatEcran, Feuille, Puces, useStylesTreso, useTresorerie,
} from '../components/tresorerie/commun'
import { usePhoto } from '../lib/usePhoto'
import {
  aujourdhuiISO, fmt, formatDateFR, montantRecalage, peut, soldeCompte,
} from '../lib/tresorerie'
import { ajouterMouvement, supprimerMouvement } from '../lib/tresorerieDb'

const LIBELLES_TYPE = {
  recalage: 'Recalage sur relevé',
  recu_banque: 'Reçu banque',
  paiement: 'Paiement',
  autre: 'Autre',
}

export default function TresorerieBanqueScreen() {
  const { styles, colors } = useStylesTreso()
  const t = useTresorerie()
  const { donnees, niveau, user, recharger } = t
  const [filtre, setFiltre] = useState('tous')
  const [saisie, setSaisie] = useState(null) // { mode: 'recalage' | 'recu_banque', compte }

  const peutSaisir = peut(niveau, 'saisir_banque')
  const comptes = donnees?.comptes || []
  const total = comptes.reduce((s, c) => s + soldeCompte(c.mouvements), 0)

  const mouvements = useMemo(() => {
    const tous = donnees?.mouvements || []
    if (filtre === 'tous') return tous
    if (filtre === 'entrees') return tous.filter(m => m.montant > 0)
    if (filtre === 'sorties') return tous.filter(m => m.montant < 0)
    return tous.filter(m => m.compte_id === filtre)
  }, [donnees, filtre])

  const nomCompte = id => comptes.find(c => c.id === id)?.nom || '?'

  function confirmerSuppression(m) {
    if (m.type === 'paiement') {
      Alert.alert('Mouvement lié à un paiement', 'Pour l\'enlever, annulez le paiement depuis « À payer ».')
      return
    }
    Alert.alert(
      'Supprimer ce mouvement ?',
      `${LIBELLES_TYPE[m.type]} · ${fmt(m.montant)} F · ${nomCompte(m.compte_id)}`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer', style: 'destructive', onPress: async () => {
            try { await supprimerMouvement(m, user); await recharger() }
            catch (e) { Alert.alert('Suppression impossible', e?.message || 'Réessayez.') }
          },
        },
      ],
    )
  }

  const bloque = (t.loading && !donnees) || t.erreur || !peut(niveau, 'voir_banque')

  return (
    <SafeAreaView style={styles.container}>
      <Entete titre="Banque" sous={donnees ? `Total ${fmt(total)} F` : null} />
      {bloque ? <EtatEcran {...t} autorise={peut(niveau, 'voir_banque')} /> : (
        <ScrollView style={styles.body} contentContainerStyle={styles.bodyContenu}>
          {comptes.map(c => {
            const dernierRecalage = c.mouvements.find(m => m.type === 'recalage')
            return (
              <View key={c.id} style={styles.carte}>
                <View style={styles.ligne}>
                  <Text style={styles.lbl}>{c.nom}</Text>
                  <Text style={styles.petit}>
                    {dernierRecalage ? `recalé le ${formatDateFR(dernierRecalage.date)}` : 'jamais recalé'}
                  </Text>
                </View>
                <Text style={styles.grand}>{fmt(soldeCompte(c.mouvements))} F</Text>
                {peutSaisir && (
                  <View style={[styles.rangee, { marginTop: 10 }]}>
                    <Bouton style={[styles.btnPetit, { flex: 1 }]} secondaire
                      titre={dernierRecalage ? 'Recaler sur relevé' : 'Saisir le solde de départ'}
                      onPress={() => setSaisie({ mode: 'recalage', compte: c })} />
                    <Bouton style={[styles.btnPetit, { flex: 1 }]} titre="+ Reçu banque"
                      onPress={() => setSaisie({ mode: 'recu_banque', compte: c })} />
                  </View>
                )}
              </View>
            )
          })}

          <Puces
            valeur={filtre}
            onChange={setFiltre}
            options={[
              { valeur: 'tous', label: 'Tous' },
              ...comptes.map(c => ({ valeur: c.id, label: c.nom })),
              { valeur: 'entrees', label: 'Entrées' },
              { valeur: 'sorties', label: 'Sorties' },
            ]}
          />

          <View style={styles.carte}>
            {mouvements.length === 0 && <Text style={styles.vide}>Aucun mouvement.</Text>}
            {mouvements.slice(0, 300).map(m => (
              <TouchableOpacity key={m.id} style={styles.item} onLongPress={peutSaisir ? () => confirmerSuppression(m) : undefined}
                delayLongPress={500} activeOpacity={peutSaisir ? 0.7 : 1}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemTitre}>{m.libelle || LIBELLES_TYPE[m.type]}</Text>
                  <Text style={styles.petit}>
                    {formatDateFR(m.date)} · {nomCompte(m.compte_id)} · {LIBELLES_TYPE[m.type]}{m.photo_url ? ' · 📷' : ''}
                    {m.cree_par_nom ? ` · ${m.cree_par_nom}` : ''}
                  </Text>
                </View>
                <Text style={[styles.ligneValeur, { color: m.montant >= 0 ? colors.success : colors.error }]}>
                  {m.montant >= 0 ? '+ ' : '− '}{fmt(Math.abs(m.montant))}
                </Text>
              </TouchableOpacity>
            ))}
            {mouvements.length > 300 && <Text style={styles.petit}>300 derniers mouvements affichés sur {mouvements.length}.</Text>}
          </View>
          {peutSaisir && <Text style={styles.petit}>Appui long sur un mouvement pour le supprimer.</Text>}
        </ScrollView>
      )}

      <FeuilleMouvement saisie={saisie} onFermer={() => setSaisie(null)} user={user} apres={recharger} />
    </SafeAreaView>
  )
}

function FeuilleMouvement({ saisie, onFermer, user, apres }) {
  const { styles, colors } = useStylesTreso()
  const { choisirPhoto } = usePhoto()
  const [montant, setMontant] = useState('')
  const [libelle, setLibelle] = useState('')
  const [date, setDate] = useState(aujourdhuiISO())
  const [photo, setPhoto] = useState(null)
  const [occupe, setOccupe] = useState(false)
  const [photoEnCours, setPhotoEnCours] = useState(false)

  const compte = saisie?.compte
  const estRecalage = saisie?.mode === 'recalage'
  const soldeActuel = compte ? soldeCompte(compte.mouvements) : 0
  const valeur = montant === '' ? null : parseInt(montant, 10)
  const ecart = estRecalage && valeur !== null ? montantRecalage(valeur, soldeActuel) : null

  function fermer() {
    setMontant(''); setLibelle(''); setPhoto(null); setDate(aujourdhuiISO())
    onFermer()
  }

  async function ajouterPhoto() {
    setPhotoEnCours(true)
    const url = await choisirPhoto('photos')
    if (url) setPhoto(url)
    setPhotoEnCours(false)
  }

  async function enregistrer() {
    if (valeur === null || (!estRecalage && valeur <= 0)) {
      Alert.alert('Montant manquant', estRecalage ? 'Saisissez le solde lu sur le relevé.' : 'Saisissez le montant reçu.')
      return
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      Alert.alert('Date invalide', 'Écrivez la date au format AAAA-MM-JJ, par exemple 2026-10-01.')
      return
    }
    if (estRecalage && ecart === 0) {
      Alert.alert('Déjà à jour', 'Le solde de l\'app correspond déjà au relevé.')
      return
    }
    setOccupe(true)
    try {
      await ajouterMouvement({
        compteId: compte.id,
        date,
        montant: estRecalage ? ecart : valeur,
        type: saisie.mode,
        libelle: estRecalage ? `Recalage relevé (${fmt(valeur)} F)` : libelle.trim(),
        photoUrl: photo,
      }, user)
      await apres()
      fermer()
    } catch (e) {
      Alert.alert('Non enregistré', e?.message || 'Réessayez.')
    } finally {
      setOccupe(false)
    }
  }

  return (
    <Feuille visible={!!saisie} onFermer={fermer}
      titre={estRecalage ? `Recaler ${compte?.nom || ''}` : `Reçu banque · ${compte?.nom || ''}`}>
      {estRecalage ? (
        <>
          <Text style={[styles.petit, { marginBottom: 10 }]}>Solde actuel dans l'app : {fmt(soldeActuel)} F</Text>
          <ChampMontant label="Solde lu sur le relevé" valeur={montant} onChange={setMontant} />
          {ecart !== null && ecart !== 0 && (
            <View style={styles.avert}>
              <Text style={styles.avertTxt}>
                Un mouvement de {ecart > 0 ? '+' : '−'} {fmt(Math.abs(ecart))} F sera ajouté pour aligner l'app sur le relevé.
              </Text>
            </View>
          )}
        </>
      ) : (
        <>
          <ChampMontant label="Montant reçu" valeur={montant} onChange={setMontant} />
          <Champ label="Libellé" value={libelle} onChangeText={setLibelle} placeholder="Ex : versement espèces 7E" />
        </>
      )}
      <Champ label="Date (AAAA-MM-JJ)" value={date} onChangeText={setDate} autoCapitalize="none" />
      <Text style={styles.label}>Photo du reçu (facultatif)</Text>
      {photo
        ? <Image source={{ uri: photo }} style={{ width: '100%', height: 160, borderRadius: 10, marginBottom: 12 }} resizeMode="cover" />
        : null}
      <Bouton secondaire titre={photo ? 'Changer la photo' : '📷 Ajouter une photo'} onPress={ajouterPhoto} occupe={photoEnCours} style={{ marginBottom: 14 }} />
      <Bouton titre="Enregistrer" onPress={enregistrer} occupe={occupe} />
      <Text style={[styles.petit, { marginTop: 10, color: colors.textMuted }]}>
        {estRecalage ? 'Le recalage corrige le solde sans effacer l\'historique.' : 'Le montant s\'ajoute au solde du compte.'}
      </Text>
    </Feuille>
  )
}
