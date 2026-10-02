// ──────────────────────────────────────────────────────────────────────────────
// Trésorerie — Banque et espèces : soldes BACI / SIB / Espèces / têtes de fond
// (OM, Wave, Djamo), recalage, reçus banque, entrées d'espèces (restaurant ou
// prêt), virements (ex. tête de fond → BACI).
//
// Le solde n'est jamais saisi directement : c'est la somme des mouvements.
// « Recaler » ajoute le mouvement qui aligne l'app sur le relevé (ou sur la
// caisse comptée, pour les espèces ; le tout premier sert de solde de départ).
// Un prêt reçu crée aussi la dette du prêteur (dette récente).
// ──────────────────────────────────────────────────────────────────────────────
import { router } from 'expo-router'
import { useMemo, useState } from 'react'
import { Alert, Image, SafeAreaView, ScrollView, Text, TouchableOpacity, View } from 'react-native'

import {
  Bouton, Champ, ChampMontant, Entete, EtatEcran, Feuille, Puces, useStylesTreso, useTresorerie,
} from '../components/tresorerie/commun'
import { usePhoto } from '../lib/usePhoto'
import {
  aujourdhuiISO, fmt, formatDateFR, montantRecalage, peut, soldeCompte,
} from '../lib/tresorerie'
import { ajouterMouvement, entreeEspeces, entreePret, supprimerMouvement, virement } from '../lib/tresorerieDb'

const LIBELLES_TYPE = {
  recalage: 'Recalage',
  recu_banque: 'Reçu banque',
  paiement: 'Paiement',
  partenaire: 'Réception partenaire',
  coffre: 'Coffre',
  direction: 'Dépense direction',
  especes: 'Entrée d\'espèces',
  virement: 'Virement',
  pret: 'Prêt reçu',
  autre: 'Autre',
}

// Mouvements nés ailleurs : ils s'annulent depuis leur écran, pas d'ici.
const LIES = {
  paiement: 'Pour l\'enlever, annulez le paiement depuis « À payer ».',
  partenaire: 'Pour l\'enlever, annulez la réception depuis « Partenaires ».',
  coffre: 'Pour l\'enlever, annulez l\'opération depuis « Coffre ».',
  direction: 'Pour l\'enlever, supprimez la dépense depuis « Dépenses direction ».',
}

const estEspeces = c => c?.nom === 'Espèces'
const estTete = c => String(c?.nom || '').startsWith('Tête de fond')

export default function TresorerieBanqueScreen() {
  const { styles, colors } = useStylesTreso()
  const t = useTresorerie()
  const { donnees, niveau, user, recharger } = t
  const [filtre, setFiltre] = useState('tous')
  const [saisie, setSaisie] = useState(null) // { mode: 'recalage' | 'recu_banque', compte }
  const [especes, setEspeces] = useState(null) // compte Espèces (entrée d'espèces)
  const [virementVisible, setVirementVisible] = useState(false)

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
    if (LIES[m.type]) {
      Alert.alert('Mouvement lié', LIES[m.type])
      return
    }
    const suite = m.type === 'virement' ? ' Les deux côtés du virement sont retirés.'
      : m.type === 'pret' ? ' La dette du prêteur est retirée aussi (si rien n\'a été remboursé).' : ''
    Alert.alert(
      'Supprimer ce mouvement ?',
      `${LIBELLES_TYPE[m.type] || 'Mouvement'} · ${fmt(m.montant)} F · ${nomCompte(m.compte_id)}.${suite}`,
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
      <Entete titre="Banque et espèces" sous={donnees ? `Total ${fmt(total)} F` : null} />
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
                      titre={!dernierRecalage ? 'Saisir le solde de départ' : estEspeces(c) ? 'Recaler sur la caisse' : estTete(c) ? 'Recaler sur le solde' : 'Recaler sur relevé'}
                      onPress={() => setSaisie({ mode: 'recalage', compte: c })} />
                    {estEspeces(c) ? (
                      <Bouton style={[styles.btnPetit, { flex: 1 }]} titre="+ Entrée d'espèces" onPress={() => setEspeces(c)} />
                    ) : (
                      <Bouton style={[styles.btnPetit, { flex: 1 }]} titre={estTete(c) ? '+ Entrée' : '+ Reçu banque'}
                        onPress={() => setSaisie({ mode: 'recu_banque', compte: c })} />
                    )}
                  </View>
                )}
              </View>
            )
          })}

          {!comptes.some(estEspeces) && (
            <Text style={[styles.petit, { marginBottom: 10 }]}>
              Le compte Espèces apparaîtra après le passage du fichier supabase_tresorerie_especes.sql dans Supabase.
            </Text>
          )}
          {peutSaisir && (
            <View style={[styles.rangee, { marginBottom: 12 }]}>
              <Bouton style={[styles.btnPetit, { flex: 1 }]} secondaire titre="Virement entre comptes" onPress={() => setVirementVisible(true)} />
              {peut(niveau, 'voir_coffre') && (
                <Bouton style={[styles.btnPetit, { flex: 1 }]} secondaire titre="Épargner (coffre)"
                  onPress={() => router.push('/tresorerie-coffre?op=epargner')} />
              )}
            </View>
          )}

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
                    {formatDateFR(m.date)} · {nomCompte(m.compte_id)} · {LIBELLES_TYPE[m.type] || 'Mouvement'}{m.photo_url ? ' · 📷' : ''}
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
      {donnees && (
        <>
          <FeuilleEntreeEspeces compte={especes} donnees={donnees} user={user} onFermer={() => setEspeces(null)} apres={recharger} />
          <FeuilleVirement visible={virementVisible} comptes={comptes} user={user} onFermer={() => setVirementVisible(false)} apres={recharger} />
        </>
      )}
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
        libelle: estRecalage ? `Recalage ${estEspeces(compte) ? 'caisse' : 'relevé'} (${fmt(valeur)} F)` : libelle.trim(),
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
          <ChampMontant label={estEspeces(compte) ? 'Espèces comptées' : 'Solde lu sur le relevé'} valeur={montant} onChange={setMontant} />
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

// Entrée d'espèces : d'un restaurant, ou d'un prêt (la dette du prêteur est
// créée en même temps, en dette récente).
function FeuilleEntreeEspeces({ compte, donnees, user, onFermer, apres }) {
  const { styles } = useStylesTreso()
  const [origine, setOrigine] = useState(null)      // 'restaurant' | 'pret'
  const [restaurantId, setRestaurantId] = useState(null)
  const [preteur, setPreteur] = useState('')
  const [montant, setMontant] = useState('')
  const [date, setDate] = useState(aujourdhuiISO())
  const [note, setNote] = useState('')
  const [occupe, setOccupe] = useState(false)

  // Prêteurs déjà connus (créanciers des dettes), pour ne pas retaper le nom.
  const connus = useMemo(() => [...new Set((donnees.dus || [])
    .filter(d => d.categorie === 'dette' && d.creancier).map(d => d.creancier.trim()))].sort(), [donnees])

  if (!compte) return null

  function fermer() {
    setOrigine(null); setRestaurantId(null); setPreteur(''); setMontant(''); setDate(aujourdhuiISO()); setNote('')
    onFermer()
  }

  async function enregistrer() {
    const v = montant === '' ? 0 : parseInt(montant, 10)
    if (!origine) { Alert.alert('Origine manquante', 'D\'où viennent ces espèces : d\'un restaurant ou d\'un prêt ?'); return }
    if (origine === 'restaurant' && !restaurantId) { Alert.alert('Restaurant manquant', 'Choisissez le restaurant.'); return }
    if (origine === 'pret' && !preteur.trim()) { Alert.alert('Prêteur manquant', 'Qui a prêté cet argent ?'); return }
    if (!v) { Alert.alert('Montant manquant', 'Saisissez le montant.'); return }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { Alert.alert('Date invalide', 'Écrivez la date au format AAAA-MM-JJ.'); return }
    setOccupe(true)
    try {
      if (origine === 'pret') {
        await entreePret({ compteId: compte.id, montant: v, date, creancier: preteur.trim(), note: note.trim() }, user)
      } else {
        await entreeEspeces({
          compteId: compte.id, montant: v, date, restaurantId,
          restaurantNom: donnees.restaurants.find(r => r.id === restaurantId)?.nom, note: note.trim(),
        }, user)
      }
      await apres()
      fermer()
    } catch (e) {
      Alert.alert('Non enregistré', e?.message || 'Réessayez.')
    } finally {
      setOccupe(false)
    }
  }

  return (
    <Feuille visible onFermer={fermer} titre="Entrée d'espèces">
      <Text style={styles.label}>D'où vient l'argent ?</Text>
      <Puces options={[{ valeur: 'restaurant', label: 'D\'un restaurant' }, { valeur: 'pret', label: 'D\'un prêt' }]}
        valeur={origine} onChange={setOrigine} />
      {origine === 'restaurant' && (
        <>
          <Text style={styles.label}>Restaurant</Text>
          <Puces options={donnees.restaurants.map(r => ({ valeur: r.id, label: r.nom }))} valeur={restaurantId} onChange={setRestaurantId} />
        </>
      )}
      {origine === 'pret' && (
        <>
          <Champ label="Prêteur" value={preteur} onChangeText={setPreteur} placeholder="Ex : Ibrahim" />
          {connus.length > 0 && (
            <Puces options={connus.map(c => ({ valeur: c, label: c }))} valeur={preteur.trim()} onChange={setPreteur} />
          )}
          <View style={styles.avert}>
            <Text style={styles.avertTxt}>La dette envers ce prêteur est créée en même temps, en dette récente. Vous la passerez en Dette à la main.</Text>
          </View>
        </>
      )}
      <ChampMontant label="Montant" valeur={montant} onChange={setMontant} />
      <Champ label="Date (AAAA-MM-JJ)" value={date} onChangeText={setDate} autoCapitalize="none" />
      <Champ label="Note (facultatif)" value={note} onChangeText={setNote} />
      <Bouton titre="Enregistrer" onPress={enregistrer} occupe={occupe} />
    </Feuille>
  )
}

// Virement entre deux comptes : le total ne bouge pas.
function FeuilleVirement({ visible, comptes, user, onFermer, apres }) {
  const { styles } = useStylesTreso()
  const [de, setDe] = useState(null)
  const [vers, setVers] = useState(null)
  const [montant, setMontant] = useState('')
  const [date, setDate] = useState(aujourdhuiISO())
  const [libelle, setLibelle] = useState('')
  const [occupe, setOccupe] = useState(false)

  if (!visible) return null

  function fermer() {
    setDe(null); setVers(null); setMontant(''); setDate(aujourdhuiISO()); setLibelle('')
    onFermer()
  }

  async function enregistrer() {
    const v = montant === '' ? 0 : parseInt(montant, 10)
    if (!de || !vers) { Alert.alert('Comptes manquants', 'Choisissez le compte de départ et le compte d\'arrivée.'); return }
    if (de === vers) { Alert.alert('Même compte', 'Choisissez deux comptes différents.'); return }
    if (!v) { Alert.alert('Montant manquant', 'Saisissez le montant.'); return }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { Alert.alert('Date invalide', 'Écrivez la date au format AAAA-MM-JJ.'); return }
    const nom = id => comptes.find(c => c.id === id)?.nom || '?'
    setOccupe(true)
    try {
      await virement({ deId: de, versId: vers, montant: v, date, libelle: libelle.trim() || `Virement ${nom(de)} → ${nom(vers)}` }, user)
      await apres()
      fermer()
    } catch (e) {
      Alert.alert('Non enregistré', e?.message || 'Réessayez.')
    } finally {
      setOccupe(false)
    }
  }

  const options = comptes.map(c => ({ valeur: c.id, label: `${c.nom} (${fmt(soldeCompte(c.mouvements))})` }))
  return (
    <Feuille visible onFermer={fermer} titre="Virement entre comptes">
      <Text style={styles.label}>De</Text>
      <Puces options={options} valeur={de} onChange={setDe} />
      <Text style={styles.label}>Vers</Text>
      <Puces options={options} valeur={vers} onChange={setVers} />
      <ChampMontant label="Montant" valeur={montant} onChange={setMontant} />
      <Champ label="Date (AAAA-MM-JJ)" value={date} onChangeText={setDate} autoCapitalize="none" />
      <Champ label="Libellé (facultatif)" value={libelle} onChangeText={setLibelle} placeholder="Ex : dépôt des espèces à la BACI" />
      <Bouton titre="Enregistrer" onPress={enregistrer} occupe={occupe} />
      <Text style={[styles.petit, { marginTop: 10 }]}>Le montant sort du premier compte et entre dans le second : le total ne change pas.</Text>
    </Feuille>
  )
}
