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
import { Alert, Image, SafeAreaView, ScrollView, Text, View } from 'react-native'

import {
  BarreRepartition, Bouton, Champ, ChampCalendrier, ChampMontant, Entete, EtatEcran, Feuille, Hero, ItemIcone, Pastille, Puces,
  TitreSection, useStylesTreso, useTresorerie,
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
  cotisation: 'Cotisation reçue',
  autre: 'Autre',
}

// Mouvements nés ailleurs : ils s'annulent depuis leur écran, pas d'ici.
const LIES = {
  paiement: 'Pour l\'enlever, annulez le paiement depuis « À payer ».',
  partenaire: 'Pour l\'enlever, annulez la réception depuis « Partenaires ».',
  coffre: 'Pour l\'enlever, annulez l\'opération depuis « Coffre ».',
  direction: 'Pour l\'enlever, supprimez la dépense depuis « Dépenses direction ».',
  cotisation: 'Pour l\'enlever, annulez la cotisation reçue depuis le détail de la charge (« À payer ») : le solde de la cotisation sera remis aussi.',
}

const estEspeces = c => c?.nom === 'Espèces'
const estTete = c => String(c?.nom || '').startsWith('Tête de fond')

// Icône de chaque type de mouvement.
const ICONES_TYPE = {
  recalage: 'scale-balance', recu_banque: 'bank-transfer-in', paiement: 'cash-minus', partenaire: 'moped',
  coffre: 'safe', direction: 'briefcase-outline', especes: 'cash-plus', virement: 'swap-horizontal',
  pret: 'hand-coin-outline', cotisation: 'piggy-bank-outline', autre: 'dots-horizontal',
}

// Icône et couleur d'un compte : banque, espèces ou tête de fond (OM, Wave, Djamo).
function styleCompte(c) {
  const nom = String(c?.nom || '')
  if (estEspeces(c)) return { icone: 'cash-multiple', couleur: '#D97706' }
  if (estTete(c)) {
    if (/wave/i.test(nom)) return { icone: 'waves', couleur: '#0284C7' }
    if (/djamo/i.test(nom)) return { icone: 'credit-card-outline', couleur: '#6366F1' }
    return { icone: 'cellphone', couleur: '#EA580C' }
  }
  return { icone: 'bank', couleur: '#0E9F6E' }
}

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
          <Hero icone="bank" titre="Banque et espèces" valeur={`${fmt(total)} F`} sous={`${comptes.length} comptes · le solde est la somme des mouvements`}>
            <View style={{ marginTop: 14 }}>
              <BarreRepartition segments={comptes.map(c => ({ valeur: soldeCompte(c.mouvements), couleur: styleCompte(c).couleur }))} />
            </View>
          </Hero>

          <View style={styles.comptesGrille}>
            {comptes.map(c => {
              const dernierRecalage = c.mouvements.find(m => m.type === 'recalage')
              const sc = styleCompte(c)
              return (
                <View key={c.id} style={[styles.carte, styles.compteCarte]}>
                  <View style={[styles.compteTrait, { backgroundColor: sc.couleur }]} />
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <Pastille icone={sc.icone} couleur={sc.couleur} taille={36} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.itemTitre} numberOfLines={1}>{c.nom}</Text>
                      <Text style={[styles.petit, { marginTop: 0 }]} numberOfLines={1}>
                        {dernierRecalage ? `recalé le ${formatDateFR(dernierRecalage.date)}` : 'jamais recalé'}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.compteSolde} numberOfLines={1} adjustsFontSizeToFit>{fmt(soldeCompte(c.mouvements))} F</Text>
                  {peutSaisir && (
                    <View style={{ gap: 6, marginTop: 10 }}>
                      {estEspeces(c) ? (
                        <Bouton style={styles.btnPetit} icone="plus" titre="Entrée d'espèces" onPress={() => setEspeces(c)} />
                      ) : (
                        <Bouton style={styles.btnPetit} icone="plus" titre={estTete(c) ? 'Entrée' : 'Reçu banque'}
                          onPress={() => setSaisie({ mode: 'recu_banque', compte: c })} />
                      )}
                      <Bouton style={styles.btnPetit} secondaire icone="tune-variant"
                        titre={!dernierRecalage ? 'Solde de départ' : 'Recaler'}
                        onPress={() => setSaisie({ mode: 'recalage', compte: c })} />
                    </View>
                  )}
                </View>
              )
            })}
          </View>

          {!comptes.some(estEspeces) && (
            <Text style={[styles.petit, { marginBottom: 10 }]}>
              Le compte Espèces apparaîtra après le passage du fichier supabase_tresorerie_especes.sql dans Supabase.
            </Text>
          )}
          {peutSaisir && (
            <View style={[styles.rangee, { marginBottom: 12 }]}>
              <Bouton style={{ flex: 1 }} icone="swap-horizontal" titre="Virement" onPress={() => setVirementVisible(true)} />
              {peut(niveau, 'voir_coffre') && (
                <Bouton style={{ flex: 1 }} secondaire icone="safe" titre="Épargner au coffre"
                  onPress={() => router.push('/tresorerie-coffre?op=epargner')} />
              )}
            </View>
          )}

          <TitreSection icone="swap-vertical" titre="Mouvements" droite={`${mouvements.length}`} />
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

          {mouvements.length === 0 && <Text style={styles.vide}>Aucun mouvement.</Text>}
          {mouvements.slice(0, 300).map(m => {
            const entree = m.montant >= 0
            return (
              <ItemIcone key={m.id}
                onLongPress={peutSaisir ? () => confirmerSuppression(m) : undefined}
                icone={ICONES_TYPE[m.type] || 'swap-horizontal'} couleur={entree ? colors.success : colors.error}
                titre={m.libelle || LIBELLES_TYPE[m.type]}
                sous={[formatDateFR(m.date), nomCompte(m.compte_id), LIBELLES_TYPE[m.type] || 'Mouvement', m.photo_url ? 'photo' : '', m.cree_par_nom || '']
                  .filter(Boolean).join(' · ')}
                droite={`${entree ? '+ ' : '− '}${fmt(Math.abs(m.montant))}`}
                couleurDroite={entree ? colors.successDark : colors.error}
              />
            )
          })}
          {mouvements.length > 300 && <Text style={styles.petit}>300 derniers mouvements affichés sur {mouvements.length}.</Text>}
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
      Alert.alert('Date invalide', 'Choisissez la date dans le calendrier.')
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
      <ChampCalendrier label="Date" valeur={date} onChange={setDate} />
      <Text style={styles.label}>Photo du reçu (facultatif)</Text>
      {photo
        ? <Image source={{ uri: photo }} style={{ width: '100%', height: 160, borderRadius: 10, marginBottom: 12 }} resizeMode="cover" />
        : null}
      <Bouton secondaire icone="camera-outline" titre={photo ? 'Changer la photo' : 'Ajouter une photo'} onPress={ajouterPhoto} occupe={photoEnCours} style={{ marginBottom: 14 }} />
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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { Alert.alert('Date invalide', 'Choisissez la date dans le calendrier.'); return }
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
          <View style={styles.avert}>
            <Text style={styles.avertTxt}>Ce montant sera déduit tout seul du « FC reçu » du point du restaurant à cette date (ou du prochain point, s'il est déjà validé).</Text>
          </View>
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
      <ChampCalendrier label="Date" valeur={date} onChange={setDate} />
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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { Alert.alert('Date invalide', 'Choisissez la date dans le calendrier.'); return }
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
      <ChampCalendrier label="Date" valeur={date} onChange={setDate} />
      <Champ label="Libellé (facultatif)" value={libelle} onChangeText={setLibelle} placeholder="Ex : dépôt des espèces à la BACI" />
      <Bouton titre="Enregistrer" onPress={enregistrer} occupe={occupe} />
      <Text style={[styles.petit, { marginTop: 10 }]}>Le montant sort du premier compte et entre dans le second : le total ne change pas.</Text>
    </Feuille>
  )
}
