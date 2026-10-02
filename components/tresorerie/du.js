// ──────────────────────────────────────────────────────────────────────────────
// Trésorerie — un « dû » (ligne à payer) : son état, son détail, son paiement.
// Partagé par À payer et Dépenses direction (autres charges à payer).
// ──────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react'
import { Alert, Image, Text, TouchableOpacity, View } from 'react-native'

import { usePhoto } from '../../lib/usePhoto'
import {
  CATEGORIES_SERIE, LIBELLES_CATEGORIE, aujourdhuiISO, echeancePostPayee, fmt, formatDateFR, joursDeRetard,
  libelleMois, libelleMoisCourt, moisEntre, peut, premierDuMois, repartirPaiement, resteDu, totalPaye,
} from '../../lib/tresorerie'
import {
  annulerPaiement, basculerDette, chargerDusLoyer, enregistrerDu, payer, supprimerDu,
} from '../../lib/tresorerieDb'
import { Bouton, Champ, ChampMontant, Feuille, Ligne, Puces, useStylesTreso } from './commun'

// paye (vert) · a_payer (orange) · dette_recente (rouge) · dette (rouge foncé)
export function couleursStatut(colors) {
  return {
    paye: { trait: colors.success, fond: colors.successLight, texte: colors.successDark, label: 'payé' },
    a_payer: { trait: colors.warning, fond: colors.warningLight, texte: colors.warningDark, label: 'à payer' },
    dette_recente: { trait: colors.error, fond: colors.errorLight, texte: colors.errorDark, label: 'dette récente' },
    dette: { trait: colors.errorDark, fond: colors.errorLight, texte: colors.errorDark, label: 'dette' },
  }
}

export function Badge({ c }) {
  const { styles } = useStylesTreso()
  return (
    <View style={[styles.badge, { backgroundColor: c.fond }]}>
      <Text style={[styles.badgeTxt, { color: c.texte }]}>{c.label}</Text>
    </View>
  )
}

export function titreDu(d, nomResto) {
  if (d.categorie === 'dette') return d.creancier || 'Créancier'
  if (d.categorie === 'autre') return `${d.libelle || 'Autre charge'} · ${d.restaurant_id ? nomResto(d.restaurant_id) : 'Groupe'}`
  if (d.categorie === 'admin') return `${d.libelle || 'Charge admin'}${d.restaurant_id ? ` · ${nomResto(d.restaurant_id)}` : ''}`
  return nomResto(d.restaurant_id)
}

// Les sept charges en série se saisissent par le RH ; dettes et autres charges
// par le propriétaire.
export function peutModifierDu(niveau, du) {
  return CATEGORIES_SERIE.includes(du.categorie) ? peut(niveau, 'saisir_charges') : peut(niveau, 'saisir_dus')
}

// ── Détail ───────────────────────────────────────────────────────────────────

export function FeuilleDetail({
  du, paiements, classement, donnees, niveau, aujourdhui, nomResto, user, onFermer, onPayer, onModifier, apres,
}) {
  const { styles, colors } = useStylesTreso()
  if (!du) return null
  const reste = resteDu(du, paiements)
  const nomCompte = id => donnees.comptes.find(c => c.id === id)?.nom || '?'
  const peutModifier = peutModifierDu(niveau, du)
  const cs = couleursStatut(colors)
  // Passage manuel en Dette : autres charges seulement (les charges en série y
  // vont seules, les créanciers y sont déjà).
  const peutBasculer = du.categorie === 'autre' && reste > 0 && peut(niveau, 'payer')

  // Les lignes d'un même versement s'annulent ensemble.
  function annuler(p) {
    const lignes = donnees.paiements.filter(x => x.groupe === p.groupe)
    const total = lignes.reduce((s, x) => s + Number(x.montant || 0), 0)
    Alert.alert(
      'Annuler ce paiement ?',
      `${fmt(total)} F du ${formatDateFR(p.date)}${lignes.length > 1 ? ` (versement réparti sur ${lignes.length} lignes, tout sera annulé)` : ''}. La sortie de banque liée est retirée aussi.`,
      [
        { text: 'Garder', style: 'cancel' },
        {
          text: 'Annuler le paiement', style: 'destructive', onPress: async () => {
            try { await annulerPaiement(p.groupe, { du_id: du.id, montant: total }, user); await apres(); onFermer() }
            catch (e) { Alert.alert('Annulation impossible', e?.message || 'Réessayez.') }
          },
        },
      ],
    )
  }

  function supprimer() {
    Alert.alert(
      'Supprimer cette ligne ?',
      paiements.length ? 'Ses paiements et les sorties de banque liées seront supprimés aussi.' : 'Elle disparaîtra de la trésorerie.',
      [
        { text: 'Garder', style: 'cancel' },
        {
          text: 'Supprimer', style: 'destructive', onPress: async () => {
            try { await supprimerDu(du, user); await apres(); onFermer() }
            catch (e) { Alert.alert('Suppression impossible', e?.message || 'Réessayez.') }
          },
        },
      ],
    )
  }

  async function basculer() {
    try { await basculerDette(du, !du.en_dette_depuis, user); await apres(); onFermer() }
    catch (e) { Alert.alert('Non enregistré', e?.message || 'Réessayez.') }
  }

  const retard = reste && du.echeance ? joursDeRetard(du.echeance, aujourdhui) : 0

  return (
    <Feuille visible onFermer={onFermer}
      titre={`${LIBELLES_CATEGORIE[du.categorie]} · ${titreDu(du, nomResto)}${du.mois ? ` · ${libelleMoisCourt(du.mois)}` : ''}`}>
      <View style={styles.carte}>
        <Ligne label="Dû" valeur={du.montant_du} />
        <Ligne label="Déjà payé" valeur={totalPaye(paiements)} />
        <View style={styles.sep} />
        <Ligne label="Reste" valeur={reste} fort couleur={reste ? colors.error : colors.success} />
        {classement && cs[classement] && <View style={{ alignSelf: 'flex-start', marginVertical: 4 }}><Badge c={cs[classement]} /></View>}
        {!!du.echeance && (
          <Text style={styles.petit}>
            Date limite : {formatDateFR(du.echeance)}{retard ? ` · ${retard} j de retard` : ''}
          </Text>
        )}
        {!!du.en_dette_depuis && <Text style={styles.petit}>Passée en dette le {formatDateFR(du.en_dette_depuis)}</Text>}
        {!!du.note && <Text style={[styles.petit, { marginTop: 6 }]}>{du.note}</Text>}
        {!!du.cree_par_nom && <Text style={styles.petit}>Saisi par {du.cree_par_nom}</Text>}
      </View>

      <Text style={[styles.lbl, { marginBottom: 6 }]}>Paiements</Text>
      <View style={styles.carte}>
        {paiements.length === 0 && <Text style={styles.vide}>Aucun paiement.</Text>}
        {paiements.map(p => (
          <View key={p.id} style={styles.item}>
            <View style={{ flex: 1 }}>
              <Text style={styles.itemTitre}>{fmt(p.montant)} F</Text>
              <Text style={styles.petit}>
                {formatDateFR(p.date)} · {p.source === 'compte' ? nomCompte(p.compte_id) : 'Espèces'}
                {p.photo_url ? ' · 📷' : ''}{p.cree_par_nom ? ` · ${p.cree_par_nom}` : ''}
              </Text>
            </View>
            {peut(niveau, 'payer') && (
              <TouchableOpacity onPress={() => annuler(p)}><Text style={{ color: colors.error, fontSize: 13 }}>Annuler</Text></TouchableOpacity>
            )}
          </View>
        ))}
      </View>

      <View style={{ gap: 8 }}>
        {reste > 0 && peut(niveau, 'payer') && <Bouton titre="Payer" onPress={() => onPayer(du)} />}
        {peutBasculer && (
          <Bouton secondaire titre={du.en_dette_depuis ? 'Remettre à payer' : 'Passer en Dette'} onPress={basculer} />
        )}
        {peutModifier && <Bouton secondaire titre="Modifier" onPress={() => onModifier(du)} />}
        {peutModifier && <Bouton danger titre="Supprimer" onPress={supprimer} />}
      </View>
    </Feuille>
  )
}

// ── Paiement ─────────────────────────────────────────────────────────────────

// demande : { du } pour une ligne, ou { categorie: 'loyer', restaurantId } pour
// un loyer dont le mois se choisit à la main (rien n'est présélectionné).
export function FeuillePaiement({ demande, donnees, parDu, nomResto, user, onFermer, apres }) {
  const { styles, colors } = useStylesTreso()
  const { choisirPhoto } = usePhoto()
  const [montant, setMontant] = useState('')
  const [moisChoisi, setMoisChoisi] = useState(null)
  const [source, setSource] = useState(null)
  const [date, setDate] = useState(aujourdhuiISO())
  const [photo, setPhoto] = useState(null)
  const [occupe, setOccupe] = useState(false)
  const [photoEnCours, setPhotoEnCours] = useState(false)

  const estLoyer = demande?.categorie === 'loyer'
  const restaurantId = estLoyer ? demande.restaurantId : demande?.du?.restaurant_id
  const loyer = estLoyer ? donnees.loyers.find(l => l.restaurant_id === restaurantId) : null

  // Mois de loyer proposés : tous ceux qui ont un reste, plus les deux suivants
  // (paiement d'avance).
  const optionsMois = useMemo(() => {
    if (!estLoyer) return []
    const dus = donnees.dus.filter(d => d.categorie === 'loyer' && d.restaurant_id === restaurantId)
    const ouverts = dus.filter(d => resteDu(d, parDu[d.id]) > 0).map(d => d.mois)
    const courant = premierDuMois(aujourdhuiISO())
    const avance = moisEntre(courant, '2999-12-01').slice(1, 3).filter(m => !dus.some(d => d.mois === m))
    return [...new Set([...ouverts, ...avance])].sort()
  }, [estLoyer, donnees, restaurantId, parDu])

  useEffect(() => {
    if (!demande) return
    setMoisChoisi(null)
    setSource(null)
    setDate(aujourdhuiISO())
    setPhoto(null)
    setMontant(demande.du ? String(resteDu(demande.du, parDu[demande.du.id])) : '')
  }, [demande])

  // Reste du mois choisi ; un mois payé d'avance n'existe pas encore : loyer plein.
  const resteMois = m => {
    const d = donnees.dus.find(x => x.categorie === 'loyer' && x.restaurant_id === restaurantId && x.mois === m)
    return d ? resteDu(d, parDu[d.id]) : Number(loyer?.montant || 0)
  }

  // Montant proposé = reste du mois choisi, modifiable pour un paiement partiel.
  useEffect(() => {
    if (!estLoyer) return
    const r = moisChoisi ? resteMois(moisChoisi) : 0
    setMontant(r ? String(r) : '')
  }, [moisChoisi])

  if (!demande) return null

  async function ajouterPhoto() {
    setPhotoEnCours(true)
    const url = await choisirPhoto('photos')
    if (url) setPhoto(url)
    setPhotoEnCours(false)
  }

  async function enregistrer() {
    const valeur = montant === '' ? 0 : parseInt(montant, 10)
    if (estLoyer && !moisChoisi) {
      Alert.alert('Mois manquant', 'Choisissez le mois retenu par le propriétaire.'); return
    }
    if (!valeur || valeur <= 0) { Alert.alert('Montant manquant', 'Saisissez le montant versé.'); return }
    const plafond = estLoyer ? resteMois(moisChoisi) : resteDu(demande.du, parDu[demande.du.id])
    if (valeur > plafond) {
      Alert.alert('Montant trop élevé', `Il ne reste que ${fmt(plafond)} F à payer${estLoyer ? ` pour ${libelleMois(moisChoisi)}` : ''}.`); return
    }
    if (!source) { Alert.alert('Source manquante', 'Choisissez d\'où part l\'argent : BACI, SIB ou espèces.'); return }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      Alert.alert('Date invalide', 'Écrivez la date au format AAAA-MM-JJ, par exemple 2026-10-01.'); return
    }
    setOccupe(true)
    try {
      let dusCibles
      if (estLoyer) {
        // Un mois payé d'avance n'existe pas encore : on le crée d'abord.
        const existe = donnees.dus.some(d => d.categorie === 'loyer' && d.restaurant_id === restaurantId && d.mois === moisChoisi)
        if (!existe) {
          await enregistrerDu({
            categorie: 'loyer', restaurant_id: restaurantId, mois: moisChoisi,
            montant_du: Number(loyer?.montant || 0),
            echeance: echeancePostPayee(moisChoisi, loyer?.jour_echeance || 5),
          }, user)
        }
        dusCibles = await chargerDusLoyer(restaurantId, [moisChoisi])
      } else {
        dusCibles = [demande.du]
      }
      const parts = repartirPaiement(valeur, dusCibles, donnees.paiements)
      const compte = source === 'especes' ? null : source
      const libelle = estLoyer
        ? `Loyer ${nomResto(restaurantId)} · ${libelleMoisCourt(moisChoisi)}`
        : `${LIBELLES_CATEGORIE[demande.du.categorie]} · ${titreDu(demande.du, nomResto)}${demande.du.mois ? ` · ${libelleMoisCourt(demande.du.mois)}` : ''}`
      await payer({ parts, source: compte ? 'compte' : 'especes', compteId: compte, date, libelle, photoUrl: photo }, user)
      await apres()
      onFermer()
    } catch (e) {
      Alert.alert('Paiement non enregistré', e?.message || 'Réessayez.')
    } finally {
      setOccupe(false)
    }
  }

  const sources = [
    ...donnees.comptes.map(c => ({ valeur: c.id, label: c.nom })),
    { valeur: 'especes', label: 'Espèces' },
  ]
  const titre = estLoyer
    ? `Payer le loyer ${nomResto(restaurantId)}`
    : `Payer · ${titreDu(demande.du, nomResto)}`

  return (
    <Feuille visible onFermer={onFermer} titre={titre}>
      {estLoyer && (
        <>
          {loyer && <Text style={[styles.petit, { marginBottom: 10 }]}>Loyer mensuel : {fmt(loyer.montant)} F</Text>}
          <Text style={styles.label}>Mois retenu par le propriétaire</Text>
          <Puces options={optionsMois.map(m => ({ valeur: m, label: `${libelleMois(m)} · reste ${fmt(resteMois(m))}` }))}
            valeur={moisChoisi} onChange={setMoisChoisi} />
          {moisChoisi && (
            <Text style={[styles.petit, { marginBottom: 10 }]}>
              Payez moins que le reste si besoin : le reste de {libelleMois(moisChoisi)} se met à jour tout seul.
            </Text>
          )}
        </>
      )}
      <ChampMontant label="Montant versé" valeur={montant} onChange={setMontant} />
      <Text style={styles.label}>Payé depuis</Text>
      <Puces options={sources} valeur={source} onChange={setSource} />
      <Champ label="Date du versement (AAAA-MM-JJ)" value={date} onChangeText={setDate} autoCapitalize="none" />
      <Text style={styles.label}>Reçu (photo, facultatif)</Text>
      {photo ? <Image source={{ uri: photo }} style={{ width: '100%', height: 150, borderRadius: 10, marginBottom: 10 }} resizeMode="cover" /> : null}
      <Bouton secondaire titre={photo ? 'Changer la photo' : '📷 Ajouter une photo'} onPress={ajouterPhoto} occupe={photoEnCours} style={{ marginBottom: 14 }} />
      <Bouton titre="Enregistrer le paiement" onPress={enregistrer} occupe={occupe} />
      <Text style={[styles.petit, { marginTop: 10, color: colors.textMuted }]}>
        Payé depuis BACI ou SIB : la sortie apparaît dans la banque. En espèces : rien ne bouge en banque.
      </Text>
    </Feuille>
  )
}
