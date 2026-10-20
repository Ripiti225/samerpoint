// ──────────────────────────────────────────────────────────────────────────────
// Trésorerie — Banque et espèces : soldes BACI / SIB / Espèces / têtes de fond
// (OM, Wave, Djamo).
//
// Toucher un compte ouvre sa fenêtre : solde, entrées et sorties du mois,
// historique jour par jour (avec le solde après chaque mouvement) et les
// opérations — entrée, sortie libre, virement, recalage. Tout se fait dans
// cette fenêtre : aucune page à part.
//
// Le solde n'est jamais saisi directement : c'est la somme des mouvements.
// « Recaler » ajoute le mouvement qui aligne l'app sur le relevé (ou sur la
// caisse comptée, pour les espèces ; le tout premier sert de solde de départ).
// Un prêt reçu crée aussi la dette du prêteur (dette récente).
// ──────────────────────────────────────────────────────────────────────────────
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons'
import { router } from 'expo-router'
import { useMemo, useState } from 'react'
import { Alert, Image, SafeAreaView, ScrollView, Text, TouchableOpacity, View } from 'react-native'

import {
  BarreRepartition, Bouton, Champ, ChampCalendrier, ChampMontant, Entete, EtatEcran, Feuille, Hero, ItemIcone, Pastille, Puces,
  useStylesTreso, useTresorerie,
} from '../components/tresorerie/commun'
import { usePhoto } from '../lib/usePhoto'
import { historiqueCompte, resumeMois } from '../lib/historiqueCompte'
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
  cheque: 'Chèque encaissé',
  autre: 'Opération libre',
}

// Mouvements nés ailleurs : ils s'annulent depuis leur écran, pas d'ici.
const LIES = {
  paiement: 'Pour l\'enlever, annulez le paiement depuis « À payer ».',
  partenaire: 'Pour l\'enlever, annulez la réception depuis « Partenaires ».',
  coffre: 'Pour l\'enlever, annulez l\'opération depuis « Coffre ».',
  direction: 'Pour l\'enlever, supprimez la dépense depuis « Dépenses direction ».',
  cheque: 'Pour l\'enlever, annulez l\'encaissement depuis « Chèques émis ».',
  cotisation: 'Pour l\'enlever, annulez la cotisation reçue depuis le détail de la charge (« À payer ») : le solde de la cotisation sera remis aussi.',
}

const estEspeces = c => c?.nom === 'Espèces'
const estTete = c => String(c?.nom || '').startsWith('Tête de fond')

// Icône de chaque type de mouvement.
const ICONES_TYPE = {
  recalage: 'scale-balance', recu_banque: 'bank-transfer-in', paiement: 'cash-minus', partenaire: 'moped',
  coffre: 'safe', direction: 'briefcase-outline', especes: 'cash-plus', virement: 'swap-horizontal',
  pret: 'hand-coin-outline', cotisation: 'piggy-bank-outline', cheque: 'checkbook', autre: 'dots-horizontal',
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

const moisCourant = () => aujourdhuiISO().slice(0, 7)

// « + 1,2 M » sur les cartes, pour que les petits montants restent lisibles.
function court(v) {
  const a = Math.abs(v)
  if (a >= 1e6) return `${(a / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M`
  if (a >= 1e4) return `${Math.round(a / 1e3).toLocaleString('fr-FR')} k`
  return fmt(a)
}

export default function TresorerieBanqueScreen() {
  const { styles, colors } = useStylesTreso()
  const t = useTresorerie()
  const { donnees, niveau, user, recharger } = t
  const [compteOuvert, setCompteOuvert] = useState(null) // id du compte dont la fenêtre est ouverte
  const [virementVisible, setVirementVisible] = useState(false)

  const peutSaisir = peut(niveau, 'saisir_banque')
  const comptes = useMemo(() => donnees?.comptes || [], [donnees])
  const total = comptes.reduce((s, c) => s + soldeCompte(c.mouvements), 0)
  const mois = moisCourant()
  const resumeTotal = useMemo(() => resumeMois(comptes.flatMap(c => c.mouvements), mois), [comptes, mois])

  const bloque = (t.loading && !donnees) || t.erreur || !peut(niveau, 'voir_banque')

  return (
    <SafeAreaView style={styles.container}>
      <Entete titre="Banque et espèces" sous={donnees ? `Total ${fmt(total)} F` : null} />
      {bloque ? <EtatEcran {...t} autorise={peut(niveau, 'voir_banque')} /> : (
        <ScrollView style={styles.body} contentContainerStyle={styles.bodyContenu}>
          <Hero icone="bank" titre="Banque et espèces" valeur={`${fmt(total)} F`}
            sous={`Ce mois : + ${fmt(resumeTotal.entrees)} · − ${fmt(resumeTotal.sorties)}`}>
            <View style={{ marginTop: 14 }}>
              <BarreRepartition segments={comptes.map(c => ({ valeur: soldeCompte(c.mouvements), couleur: styleCompte(c).couleur }))} />
            </View>
          </Hero>

          <View style={styles.comptesGrille}>
            {comptes.map(c => (
              <CarteCompte key={c.id} compte={c} mois={mois} onPress={() => setCompteOuvert(c.id)} />
            ))}
          </View>

          {!comptes.some(estEspeces) && (
            <Text style={[styles.petit, { marginBottom: 10 }]}>
              Le compte Espèces apparaîtra après le passage du fichier supabase_tresorerie_especes.sql dans Supabase.
            </Text>
          )}
          {peutSaisir && (
            <View style={[styles.rangee, { marginBottom: 12 }]}>
              <Bouton style={{ flex: 1 }} secondaire icone="swap-horizontal" titre="Virement" onPress={() => setVirementVisible(true)} />
              {peut(niveau, 'voir_coffre') && (
                <Bouton style={{ flex: 1 }} secondaire icone="safe" titre="Épargner au coffre"
                  onPress={() => router.push('/tresorerie-coffre?op=epargner')} />
              )}
            </View>
          )}
          <Text style={[styles.petit, { textAlign: 'center', color: colors.textMuted }]}>
            Touchez un compte pour voir son historique et faire une opération.
          </Text>
        </ScrollView>
      )}

      {donnees && (
        <>
          <FeuilleCompte
            compte={comptes.find(c => c.id === compteOuvert) || null}
            comptes={comptes} donnees={donnees} user={user} peutSaisir={peutSaisir}
            onFermer={() => setCompteOuvert(null)} apres={recharger}
          />
          <Feuille visible={virementVisible} onFermer={() => setVirementVisible(false)} titre="Virement entre comptes">
            {virementVisible && (
              <FormVirement comptes={comptes} user={user} apres={recharger} onTermine={() => setVirementVisible(false)} />
            )}
          </Feuille>
        </>
      )}
    </SafeAreaView>
  )
}

// Carte d'un compte : solde, entrées / sorties du mois, dernier mouvement.
function CarteCompte({ compte: c, mois, onPress }) {
  const { styles, colors } = useStylesTreso()
  const sc = styleCompte(c)
  const solde = soldeCompte(c.mouvements)
  const { entrees, sorties } = resumeMois(c.mouvements, mois)
  const dernier = historiqueCompte(c.mouvements)[0]?.lignes[0]
  return (
    <TouchableOpacity
      style={[styles.carte, styles.compteCarte]} activeOpacity={0.75} onPress={onPress}
      accessibilityRole="button" accessibilityLabel={`${c.nom}, solde ${fmt(solde)} francs. Voir l'historique`}
    >
      <View style={[styles.compteTrait, { backgroundColor: sc.couleur }]} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Pastille icone={sc.icone} couleur={sc.couleur} taille={36} />
        <Text style={[styles.itemTitre, { flex: 1, minWidth: 0 }]} numberOfLines={1}>{c.nom}</Text>
        <MaterialCommunityIcons name="chevron-right" size={18} color={colors.textMuted} />
      </View>
      <Text style={[styles.compteSolde, solde < 0 && { color: colors.error }]} numberOfLines={1} adjustsFontSizeToFit>
        {fmt(solde)} F
      </Text>
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 6 }}>
        <Text style={{ fontSize: 12, fontWeight: '700', color: colors.successDark }} numberOfLines={1}>▲ {court(entrees)}</Text>
        <Text style={{ fontSize: 12, fontWeight: '700', color: colors.error }} numberOfLines={1}>▼ {court(sorties)}</Text>
        <Text style={[styles.petit, { marginTop: 0, flex: 1, textAlign: 'right' }]} numberOfLines={1}>ce mois</Text>
      </View>
      <Text style={[styles.petit, { marginTop: 4 }]} numberOfLines={1}>
        {dernier ? `Dernier : ${formatDateFR(dernier.date)} · ${dernier.montant >= 0 ? '+' : '−'} ${fmt(Math.abs(dernier.montant))}` : 'Aucun mouvement'}
      </Text>
    </TouchableOpacity>
  )
}

const PAR_PAGE = 60

// Fenêtre d'un compte : historique + opérations, dans la même fenêtre.
// `vue` bascule entre l'historique et le formulaire d'une opération (une
// fenêtre par-dessus une autre se comporte mal sur iPhone).
function FeuilleCompte({ compte, comptes, donnees, user, peutSaisir, onFermer, apres }) {
  const { styles, colors } = useStylesTreso()
  const [vue, setVue] = useState('historique') // historique | entree | sortie | virement | recalage
  const [filtre, setFiltre] = useState('tous')
  const [nbAffiches, setNbAffiches] = useState(PAR_PAGE)

  const jours = useMemo(() => historiqueCompte(compte?.mouvements, filtre), [compte, filtre])

  function fermer() {
    setVue('historique'); setFiltre('tous'); setNbAffiches(PAR_PAGE)
    onFermer()
  }

  if (!compte) return null

  const sc = styleCompte(compte)
  const solde = soldeCompte(compte.mouvements)
  const { entrees, sorties } = resumeMois(compte.mouvements, moisCourant())
  const nomCompte = id => comptes.find(c => c.id === id)?.nom || '?'
  const retour = () => setVue('historique')

  function confirmerSuppression(m) {
    if (LIES[m.type]) {
      Alert.alert('Mouvement lié', LIES[m.type])
      return
    }
    const suite = m.type === 'virement' ? ' Les deux côtés du virement sont retirés.'
      : m.type === 'pret' ? ' La dette du prêteur est retirée aussi (si rien n\'a été remboursé).' : ''
    Alert.alert(
      'Supprimer ce mouvement ?',
      `${m.libelle || LIBELLES_TYPE[m.type] || 'Mouvement'} · ${fmt(m.montant)} F · ${nomCompte(m.compte_id)}.${suite}`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer', style: 'destructive', onPress: async () => {
            try { await supprimerMouvement(m, user); await apres() }
            catch (e) { Alert.alert('Suppression impossible', e?.message || 'Réessayez.') }
          },
        },
      ],
    )
  }

  const TITRES = {
    historique: compte.nom,
    entree: estEspeces(compte) ? 'Entrée d\'espèces' : `${estTete(compte) ? 'Entrée' : 'Reçu banque'} · ${compte.nom}`,
    sortie: `Sortie · ${compte.nom}`,
    virement: `Virement depuis ${compte.nom}`,
    recalage: `Recaler ${compte.nom}`,
  }

  // Lignes visibles, coupées à nbAffiches en gardant les jours entiers.
  let reste = nbAffiches
  const visibles = []
  for (const j of jours) {
    if (reste <= 0) break
    visibles.push(j)
    reste -= j.lignes.length
  }
  const nbLignes = jours.reduce((s, j) => s + j.lignes.length, 0)

  return (
    <Feuille visible onFermer={fermer} titre={TITRES[vue]}>
      {vue !== 'historique' ? (
        <>
          <TouchableOpacity onPress={retour} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 12 }}
            accessibilityRole="button" accessibilityLabel="Retour à l'historique">
            <MaterialCommunityIcons name="chevron-left" size={20} color={colors.primary} />
            <Text style={{ color: colors.primary, fontWeight: '700' }}>Historique</Text>
          </TouchableOpacity>
          {vue === 'entree' && estEspeces(compte) && (
            <FormEntreeEspeces compte={compte} donnees={donnees} user={user} apres={apres} onTermine={retour} />
          )}
          {((vue === 'entree' && !estEspeces(compte)) || vue === 'sortie' || vue === 'recalage') && (
            <FormMouvement mode={vue === 'entree' ? 'recu_banque' : vue} compte={compte} user={user} apres={apres} onTermine={retour} />
          )}
          {vue === 'virement' && (
            <FormVirement comptes={comptes} deInitial={compte.id} user={user} apres={apres} onTermine={retour} />
          )}
        </>
      ) : (
        <>
          <View style={{ alignItems: 'center', marginBottom: 14 }}>
            <Pastille icone={sc.icone} couleur={sc.couleur} taille={48} />
            <Text style={[styles.grand, solde < 0 && { color: colors.error }]} adjustsFontSizeToFit numberOfLines={1}>{fmt(solde)} F</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
              <View style={{ backgroundColor: colors.successLight, borderRadius: 10, paddingVertical: 5, paddingHorizontal: 10 }}>
                <Text style={{ fontSize: 12, fontWeight: '700', color: colors.successDark }}>▲ {fmt(entrees)} ce mois</Text>
              </View>
              <View style={{ backgroundColor: colors.errorLight, borderRadius: 10, paddingVertical: 5, paddingHorizontal: 10 }}>
                <Text style={{ fontSize: 12, fontWeight: '700', color: colors.error }}>▼ {fmt(sorties)} ce mois</Text>
              </View>
            </View>
          </View>

          {peutSaisir && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
              <Bouton style={{ flexBasis: '47%', flexGrow: 1 }} icone="arrow-down-bold-circle-outline" titre="Entrée" onPress={() => setVue('entree')} />
              <Bouton style={{ flexBasis: '47%', flexGrow: 1 }} danger icone="arrow-up-bold-circle-outline" titre="Sortie" onPress={() => setVue('sortie')} />
              <Bouton style={{ flexBasis: '47%', flexGrow: 1 }} secondaire icone="swap-horizontal" titre="Virement" onPress={() => setVue('virement')} />
              <Bouton style={{ flexBasis: '47%', flexGrow: 1 }} secondaire icone="tune-variant" titre="Recaler" onPress={() => setVue('recalage')} />
            </View>
          )}

          <Puces
            valeur={filtre}
            onChange={v => { setFiltre(v); setNbAffiches(PAR_PAGE) }}
            options={[
              { valeur: 'tous', label: 'Tout' },
              { valeur: 'entrees', label: 'Entrées' },
              { valeur: 'sorties', label: 'Sorties' },
            ]}
          />

          {jours.length === 0 && <Text style={styles.vide}>Aucun mouvement.</Text>}
          {visibles.map(j => (
            <View key={j.date}>
              <Text style={[styles.label, { marginTop: 10 }]}>{formatDateFR(j.date)}</Text>
              {j.lignes.map(m => {
                const entree = m.montant >= 0
                return (
                  <ItemIcone key={m.id}
                    onLongPress={peutSaisir ? () => confirmerSuppression(m) : undefined}
                    icone={ICONES_TYPE[m.type] || 'swap-horizontal'} couleur={entree ? colors.success : colors.error}
                    titre={m.libelle || LIBELLES_TYPE[m.type]}
                    sous={[LIBELLES_TYPE[m.type] || 'Mouvement', m.photo_url ? 'photo' : '', m.cree_par_nom || ''].filter(Boolean).join(' · ')}
                    droite={`${entree ? '+ ' : '− '}${fmt(Math.abs(m.montant))}`}
                    couleurDroite={entree ? colors.successDark : colors.error}
                    sousDroite={<Text style={[styles.petit, { marginTop: 0 }]}>solde {fmt(m.soldeApres)}</Text>}
                  />
                )
              })}
            </View>
          ))}
          {nbLignes > nbAffiches && (
            <Bouton secondaire titre={`Voir plus (${nbLignes - nbAffiches} restants)`} onPress={() => setNbAffiches(x => x + PAR_PAGE)} style={{ marginTop: 8 }} />
          )}
          {peutSaisir && jours.length > 0 && <Text style={[styles.petit, { marginTop: 10 }]}>Appui long sur un mouvement pour le supprimer.</Text>}
        </>
      )}
    </Feuille>
  )
}

// Reçu banque / entrée (tête de fond), sortie libre, ou recalage.
function FormMouvement({ mode, compte, user, apres, onTermine }) {
  const { styles, colors } = useStylesTreso()
  const { choisirPhoto } = usePhoto()
  const [montant, setMontant] = useState('')
  const [libelle, setLibelle] = useState('')
  const [date, setDate] = useState(aujourdhuiISO())
  const [photo, setPhoto] = useState(null)
  const [occupe, setOccupe] = useState(false)
  const [photoEnCours, setPhotoEnCours] = useState(false)

  const estRecalage = mode === 'recalage'
  const estSortie = mode === 'sortie'
  const soldeActuel = soldeCompte(compte.mouvements)
  const valeur = montant === '' ? null : parseInt(montant, 10)
  const ecart = estRecalage && valeur !== null ? montantRecalage(valeur, soldeActuel) : null

  async function ajouterPhoto() {
    setPhotoEnCours(true)
    const url = await choisirPhoto('photos')
    if (url) setPhoto(url)
    setPhotoEnCours(false)
  }

  async function enregistrer() {
    if (valeur === null || (!estRecalage && valeur <= 0)) {
      Alert.alert('Montant manquant', estRecalage ? 'Saisissez le solde lu sur le relevé.' : estSortie ? 'Saisissez le montant sorti.' : 'Saisissez le montant reçu.')
      return
    }
    if (estSortie && !libelle.trim()) {
      Alert.alert('Motif manquant', 'Indiquez à quoi correspond cette sortie (frais bancaires, retrait…).')
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
        montant: estRecalage ? ecart : estSortie ? -valeur : valeur,
        type: estSortie ? 'autre' : mode,
        libelle: estRecalage ? `Recalage ${estEspeces(compte) ? 'caisse' : 'relevé'} (${fmt(valeur)} F)` : libelle.trim(),
        photoUrl: photo,
      }, user)
      await apres()
      onTermine()
    } catch (e) {
      Alert.alert('Non enregistré', e?.message || 'Réessayez.')
    } finally {
      setOccupe(false)
    }
  }

  return (
    <>
      <Text style={[styles.petit, { marginBottom: 10 }]}>Solde actuel : {fmt(soldeActuel)} F</Text>
      {estRecalage ? (
        <>
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
          <ChampMontant label={estSortie ? 'Montant sorti' : 'Montant reçu'} valeur={montant} onChange={setMontant} />
          <Champ label={estSortie ? 'Motif' : 'Libellé'} value={libelle} onChangeText={setLibelle}
            placeholder={estSortie ? 'Ex : frais de tenue de compte' : 'Ex : versement espèces 7E'} />
          {estSortie && valeur > soldeActuel && (
            <View style={styles.avert}>
              <Text style={styles.avertTxt}>Le solde de ce compte passera en négatif ({fmt(soldeActuel - valeur)} F).</Text>
            </View>
          )}
        </>
      )}
      <ChampCalendrier label="Date" valeur={date} onChange={setDate} />
      <Text style={styles.label}>Photo du justificatif (facultatif)</Text>
      {photo
        ? <Image source={{ uri: photo }} style={{ width: '100%', height: 160, borderRadius: 10, marginBottom: 12 }} resizeMode="cover" />
        : null}
      <Bouton secondaire icone="camera-outline" titre={photo ? 'Changer la photo' : 'Ajouter une photo'} onPress={ajouterPhoto} occupe={photoEnCours} style={{ marginBottom: 14 }} />
      <Bouton titre="Enregistrer" danger={estSortie} onPress={enregistrer} occupe={occupe} />
      <Text style={[styles.petit, { marginTop: 10, color: colors.textMuted }]}>
        {estRecalage ? 'Le recalage corrige le solde sans effacer l\'historique.'
          : estSortie ? 'Le montant est retiré du solde du compte.'
            : 'Le montant s\'ajoute au solde du compte.'}
      </Text>
    </>
  )
}

// Entrée d'espèces : d'un restaurant, ou d'un prêt (la dette du prêteur est
// créée en même temps, en dette récente).
function FormEntreeEspeces({ compte, donnees, user, apres, onTermine }) {
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
      onTermine()
    } catch (e) {
      Alert.alert('Non enregistré', e?.message || 'Réessayez.')
    } finally {
      setOccupe(false)
    }
  }

  return (
    <>
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
    </>
  )
}

// Virement entre deux comptes : le total ne bouge pas.
function FormVirement({ comptes, deInitial = null, user, apres, onTermine }) {
  const { styles } = useStylesTreso()
  const [de, setDe] = useState(deInitial)
  const [vers, setVers] = useState(null)
  const [montant, setMontant] = useState('')
  const [date, setDate] = useState(aujourdhuiISO())
  const [libelle, setLibelle] = useState('')
  const [occupe, setOccupe] = useState(false)

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
      onTermine()
    } catch (e) {
      Alert.alert('Non enregistré', e?.message || 'Réessayez.')
    } finally {
      setOccupe(false)
    }
  }

  const options = comptes.map(c => ({ valeur: c.id, label: `${c.nom} (${fmt(soldeCompte(c.mouvements))})` }))
  return (
    <>
      <Text style={styles.label}>De</Text>
      <Puces options={options} valeur={de} onChange={setDe} />
      <Text style={styles.label}>Vers</Text>
      <Puces options={options.filter(o => o.valeur !== de)} valeur={vers} onChange={setVers} />
      <ChampMontant label="Montant" valeur={montant} onChange={setMontant} />
      <ChampCalendrier label="Date" valeur={date} onChange={setDate} />
      <Champ label="Libellé (facultatif)" value={libelle} onChangeText={setLibelle} placeholder="Ex : dépôt des espèces à la BACI" />
      <Bouton titre="Enregistrer" onPress={enregistrer} occupe={occupe} />
      <Text style={[styles.petit, { marginTop: 10 }]}>Le montant sort du premier compte et entre dans le second : le total ne change pas.</Text>
    </>
  )
}
