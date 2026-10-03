// ──────────────────────────────────────────────────────────────────────────────
// Trésorerie — un « dû » (ligne à payer) : son état, son détail, son paiement.
// Partagé par À payer et Dépenses direction (autres charges à payer).
// ──────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react'
import { Alert, Image, Text, TouchableOpacity, View } from 'react-native'

import { PARTENAIRES_PREVISION, etatPrevision, trierPrevisions } from '../../lib/previsions'
import { usePhoto } from '../../lib/usePhoto'
import {
  CATEGORIES_SERIE, LIBELLES_CATEGORIE, aujourdhuiISO, echeancePostPayee, fmt, formatDateFR, joursDeRetard,
  libelleMois, libelleMoisCourt, moisEntre, peut, premierDuMois, repartirPaiement, resteDu, totalPaye,
} from '../../lib/tresorerie'
import {
  ajouterPrevision, annulerPaiement, basculerDette, chargerDusLoyer, enregistrerDu, payer, payerAvant, supprimerDu, supprimerPrevision,
} from '../../lib/tresorerieDb'
import { Bouton, Champ, ChampMontant, Feuille, ItemIcone, Ligne, Pastille, Progression, Puces, TitreSection, styleCategorie, useStylesTreso } from './commun'

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
    <View style={[styles.badge, styles.badgeLigne, { backgroundColor: c.fond }]}>
      <View style={[styles.badgePoint, { backgroundColor: c.trait }]} />
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

// onPayer(du, prevision?) ; onPrevoir(du) : ouvre la feuille de prévision.
export function FeuilleDetail({
  du, paiements, classement, donnees, niveau, aujourdhui, nomResto, user, onFermer, onPayer, onModifier, onPrevoir, apres,
}) {
  const { styles, colors } = useStylesTreso()
  if (!du) return null
  const reste = resteDu(du, paiements)
  const nomCompte = id => donnees.comptes.find(c => c.id === id)?.nom || '?'
  const peutModifier = peutModifierDu(niveau, du)
  const cs = couleursStatut(colors)
  // Passage manuel en Dette : autres charges et prêts en espèces (les charges
  // en série y vont seules, les autres créanciers y sont déjà).
  const peutBasculer = (du.categorie === 'autre' || du.est_pret) && reste > 0 && peut(niveau, 'payer')

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

  // Charge déjà payée avant la mise en place de la trésorerie (ex. loyer d'août
  // payé en septembre) : elle compte dans le résultat, sans dette ni banque.
  function dejaPaye() {
    Alert.alert(
      'Déjà payé avant la trésorerie ?',
      `Le reste (${fmt(reste)} F) sera noté comme payé avant la trésorerie : la charge compte dans le résultat net, sans dette et sans mouvement en banque.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Oui, déjà payé', onPress: async () => {
            try { await payerAvant(du, user); await apres(); onFermer() }
            catch (e) { Alert.alert('Non enregistré', e?.message || 'Réessayez.') }
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
  const previsions = trierPrevisions((donnees.previsions || []).filter(x => x.du_id === du.id)
    .map(x => ({ prevision: x, etat: etatPrevision(x, { du, paiementsDu: paiements, receptions: donnees.receptions, aujourdhui }) })))

  function retirerPrevision(x) {
    Alert.alert('Supprimer cette prévision ?', `${fmt(x.montant)} F. Les paiements déjà faits restent.`, [
      { text: 'Garder', style: 'cancel' },
      {
        text: 'Supprimer', style: 'destructive', onPress: async () => {
          try { await supprimerPrevision(x, user); await apres() }
          catch (e) { Alert.alert('Suppression impossible', e?.message || 'Réessayez.') }
        },
      },
    ])
  }

  return (
    <Feuille visible onFermer={onFermer}
      titre={`${LIBELLES_CATEGORIE[du.categorie]} · ${titreDu(du, nomResto)}${du.mois ? ` · ${libelleMoisCourt(du.mois)}` : ''}`}>
      <View style={styles.carte}>
        <View style={styles.carteEntete}>
          <Pastille icone={styleCategorie(du.categorie).icone} couleur={styleCategorie(du.categorie).couleur} taille={46} />
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Reste à payer</Text>
            <Text style={[styles.grand, { marginTop: 0, fontSize: 28, color: reste ? colors.error : colors.success }]}>{fmt(reste)} F</Text>
          </View>
          {classement && cs[classement] && <Badge c={cs[classement]} />}
        </View>
        <Progression pct={du.montant_du ? Math.round((totalPaye(paiements) / du.montant_du) * 100) : 0} couleur={colors.success} hauteur={8} />
        <View style={{ marginTop: 8 }}>
          <Ligne label="Dû" valeur={du.montant_du} />
          <Ligne label="Déjà payé" valeur={totalPaye(paiements)} couleur={colors.successDark} />
        </View>
        {!!du.echeance && (
          <Text style={[styles.petit, retard ? { color: colors.error, fontWeight: '700' } : null]}>
            Date limite : {formatDateFR(du.echeance)}{retard ? ` · ${retard} j de retard` : ''}
          </Text>
        )}
        {!!du.en_dette_depuis && <Text style={styles.petit}>Passée en dette le {formatDateFR(du.en_dette_depuis)}</Text>}
        {!!du.note && <Text style={[styles.petit, { marginTop: 6 }]}>{du.note}</Text>}
        {!!du.cree_par_nom && <Text style={styles.petit}>Saisi par {du.cree_par_nom}</Text>}
      </View>

      {(previsions.length > 0 || (reste > 0 && onPrevoir && peut(niveau, 'payer'))) && (
        <>
          <TitreSection icone="calendar-clock" couleur="#D97706" titre="Prévisions" droite={previsions.length ? `${previsions.length}` : null} />
          <View style={styles.carte}>
            {previsions.length === 0 && <Text style={styles.vide}>Aucune prévision.</Text>}
            {previsions.map(({ prevision: x, etat }) => {
              const orange = etat.statut === 'a_payer'
              return (
                <View key={x.id} style={[styles.item, orange && { backgroundColor: colors.warningLight, borderRadius: 10, paddingHorizontal: 8 }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.itemTitre, etat.statut === 'realisee' && { color: colors.textMuted }]}>
                      {fmt(x.montant)} F{etat.realise > 0 && etat.statut !== 'realisee' ? ` · reste ${fmt(etat.reste)}` : ''}
                    </Text>
                    <Text style={[styles.petit, orange && { color: colors.warningDark, fontWeight: '700' }]}>
                      {etat.statut === 'realisee' ? `${etat.message} · réalisée` : etat.message}{x.note ? ` · ${x.note}` : ''}
                    </Text>
                  </View>
                  {orange && peut(niveau, 'payer') && <Bouton titre="Payer" style={styles.btnPetit} onPress={() => onPayer(du, x)} />}
                  {etat.statut !== 'realisee' && peut(niveau, 'payer') && (
                    <TouchableOpacity onPress={() => retirerPrevision(x)} style={{ marginLeft: 8 }}>
                      <Text style={{ color: colors.error, fontSize: 13 }}>Retirer</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )
            })}
            {reste > 0 && onPrevoir && peut(niveau, 'payer') && (
              <Bouton secondaire icone="calendar-plus" titre="Prévoir un paiement" style={{ marginTop: 8 }} onPress={() => onPrevoir(du)} />
            )}
          </View>
        </>
      )}

      <TitreSection icone="cash-check" couleur={colors.success} titre="Paiements" droite={paiements.length ? `${paiements.length}` : null} />
      {paiements.length === 0 && <Text style={styles.vide}>Aucun paiement.</Text>}
      {paiements.map(p => (
        <ItemIcone key={p.id} icone={p.source === 'avant' ? 'history' : p.source === 'compte' ? 'bank-transfer-out' : 'cash'} couleur={colors.success}
          titre={`${fmt(p.montant)} F`}
          sous={`${formatDateFR(p.date)} · ${p.source === 'compte' ? nomCompte(p.compte_id) : p.source === 'avant' ? 'payé avant la trésorerie' : 'Espèces'}${p.photo_url ? ' · photo' : ''}${p.cree_par_nom ? ` · ${p.cree_par_nom}` : ''}`}
          sousDroite={peut(niveau, 'payer') ? (
            <TouchableOpacity onPress={() => annuler(p)} style={styles.lienDanger}>
              <Text style={styles.lienDangerTxt}>Annuler</Text>
            </TouchableOpacity>
          ) : null}
        />
      ))}

      <View style={{ gap: 8, marginTop: 6 }}>
        {reste > 0 && peut(niveau, 'payer') && <Bouton icone="cash-fast" titre="Payer" onPress={() => onPayer(du)} />}
        {reste > 0 && CATEGORIES_SERIE.includes(du.categorie) && peut(niveau, 'payer') && (
          <Bouton secondaire icone="history" titre="Déjà payé avant la trésorerie" onPress={dejaPaye} />
        )}
        {peutBasculer && (
          <Bouton secondaire icone={du.en_dette_depuis ? 'undo-variant' : 'notebook-outline'} titre={du.en_dette_depuis ? 'Remettre à payer' : 'Passer en Dette'} onPress={basculer} />
        )}
        {peutModifier && (
          <View style={styles.rangee}>
            <Bouton style={{ flex: 1 }} secondaire icone="pencil-outline" titre="Modifier" onPress={() => onModifier(du)} />
            <Bouton style={{ flex: 1 }} danger icone="trash-can-outline" titre="Supprimer" onPress={supprimer} />
          </View>
        )}
      </View>
    </Feuille>
  )
}

// ── Paiement ─────────────────────────────────────────────────────────────────

// demande : { du } pour une ligne (ou { du, prevision } depuis une prévision :
// montant prévu prérempli, paiement rattaché à la prévision), ou
// { categorie: 'loyer', restaurantId } pour un loyer dont le mois se choisit à
// la main (rien n'est présélectionné).
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
    if (demande.du && demande.prevision) {
      const e = etatPrevision(demande.prevision, {
        du: demande.du, paiementsDu: parDu[demande.du.id] || [], receptions: donnees.receptions, aujourdhui: aujourdhuiISO(),
      })
      setMontant(String(e.aPayer))
    } else {
      setMontant(demande.du ? String(resteDu(demande.du, parDu[demande.du.id])) : '')
    }
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
      await payer({
        parts, source: compte ? 'compte' : 'especes', compteId: compte, date, libelle, photoUrl: photo,
        previsionId: demande.prevision?.id || null,
      }, user)
      await apres()
      onFermer()
    } catch (e) {
      Alert.alert('Paiement non enregistré', e?.message || 'Réessayez.')
    } finally {
      setOccupe(false)
    }
  }

  // Espèces est un compte (étape 2) ; l'ancienne option sans compte ne reste
  // que tant que la migration supabase_tresorerie_especes.sql n'est pas passée.
  const sources = [
    ...donnees.comptes.map(c => ({ valeur: c.id, label: c.nom })),
    ...(donnees.comptes.some(c => c.nom === 'Espèces') ? [] : [{ valeur: 'especes', label: 'Espèces' }]),
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
        Le montant sort du compte choisi : Espèces, BACI ou SIB.
      </Text>
    </Feuille>
  )
}

// ── Prévoir un paiement ──────────────────────────────────────────────────────

// Combien et quand : à une date, ou à la prochaine réception d'un partenaire.
export function FeuillePrevision({ du, donnees, nomResto, user, onFermer, apres }) {
  const { styles } = useStylesTreso()
  const [montant, setMontant] = useState('')
  const [quand, setQuand] = useState(null)        // 'date' | 'reception'
  const [datePrevue, setDatePrevue] = useState('')
  const [partenaire, setPartenaire] = useState(null)
  const [note, setNote] = useState('')
  const [occupe, setOccupe] = useState(false)

  const parDu = useMemo(() => paiementsDeLaLigne(donnees, du), [donnees, du])
  const reste = du ? resteDu(du, parDu) : 0
  // Déjà prévu sur cette ligne (prévisions ouvertes), pour proposer le reste.
  const dejaPrevu = du ? (donnees.previsions || []).filter(x => x.du_id === du.id)
    .map(x => etatPrevision(x, { du, paiementsDu: parDu, receptions: donnees.receptions, aujourdhui: aujourdhuiISO() }))
    .filter(e => e.statut !== 'realisee').reduce((t, e) => t + e.reste, 0) : 0

  useEffect(() => {
    if (!du) return
    setMontant(String(Math.max(0, reste - dejaPrevu) || reste))
    setQuand(null); setDatePrevue(''); setPartenaire(null); setNote('')
  }, [du])

  if (!du) return null

  async function enregistrer() {
    const v = montant === '' ? 0 : parseInt(montant, 10)
    if (!v) { Alert.alert('Montant manquant', 'Combien comptez-vous payer ?'); return }
    if (v > reste) { Alert.alert('Montant trop élevé', `Il ne reste que ${fmt(reste)} F à payer sur cette ligne.`); return }
    if (!quand) { Alert.alert('Quand ?', 'Choisissez une date ou la prochaine réception d\'un partenaire.'); return }
    if (quand === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(datePrevue)) {
      Alert.alert('Date invalide', 'Écrivez la date au format AAAA-MM-JJ, par exemple 2026-10-15.'); return
    }
    if (quand === 'reception' && !partenaire) { Alert.alert('Partenaire manquant', 'À la réception de quel partenaire ?'); return }
    setOccupe(true)
    try {
      await ajouterPrevision({
        du, montant: v, datePrevue: quand === 'date' ? datePrevue : null,
        partenaire: quand === 'reception' ? partenaire : null, note: note.trim(),
      }, user)
      await apres()
      onFermer()
    } catch (e) {
      Alert.alert('Non enregistrée', e?.message || 'Réessayez.')
    } finally {
      setOccupe(false)
    }
  }

  return (
    <Feuille visible onFermer={onFermer}
      titre={`Prévoir · ${LIBELLES_CATEGORIE[du.categorie]} · ${titreDu(du, nomResto)}${du.mois ? ` · ${libelleMoisCourt(du.mois)}` : ''}`}>
      <Text style={[styles.petit, { marginBottom: 10 }]}>
        Reste à payer : {fmt(reste)} F{dejaPrevu ? ` · déjà prévu : ${fmt(dejaPrevu)} F` : ''}
      </Text>
      <ChampMontant label="Montant prévu" valeur={montant} onChange={setMontant} />
      <Text style={styles.label}>Quand ?</Text>
      <Puces options={[{ valeur: 'date', label: 'À une date' }, { valeur: 'reception', label: 'À la prochaine réception' }]}
        valeur={quand} onChange={setQuand} />
      {quand === 'date' && (
        <Champ label="Date (AAAA-MM-JJ)" value={datePrevue} onChangeText={setDatePrevue} autoCapitalize="none" placeholder="Ex : 2026-10-15" />
      )}
      {quand === 'reception' && <Puces options={PARTENAIRES_PREVISION} valeur={partenaire} onChange={setPartenaire} />}
      <Champ label="Note (facultatif)" value={note} onChangeText={setNote} />
      <Bouton titre="Enregistrer la prévision" onPress={enregistrer} occupe={occupe} />
      <Text style={[styles.petit, { marginTop: 10 }]}>
        Le montant prévu est retiré tout de suite de la trésorerie nette réelle. Le moment venu, la prévision passe en orange : vous payez à la main.
      </Text>
    </Feuille>
  )
}

function paiementsDeLaLigne(donnees, du) {
  return du ? (donnees.paiements || []).filter(p => p.du_id === du.id) : []
}
