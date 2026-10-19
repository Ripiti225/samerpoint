// ──────────────────────────────────────────────────────────────────────────────
// Trésorerie — Chèques émis sur BACI et SIB.
//
// Un chèque émis et pas encore débité est une prévision : son montant sort de
// la trésorerie nette réelle dès la saisie ; le solde de la banque ne baisse
// qu'au moment où l'on coche « Encaissé » (date réelle du débit). Relié à une
// ligne d'À payer (dette, charge), l'encaissement paie aussi la ligne.
// Rappels : la veille, le jour même et chaque jour de retard (9 h / 14 h).
// Base : supabase_tresorerie_cheques.sql · logique : lib/cheques.js
// ──────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react'
import { Alert, Image, SafeAreaView, ScrollView, Text, TouchableOpacity, View } from 'react-native'

import {
  Bouton, Champ, ChampCalendrier, ChampMontant, Entete, EtatEcran, Feuille, Hero, HeroCase, ItemIcone, Ligne, Puces,
  TitreSection, styleCategorie, useStylesTreso, useTresorerie,
} from '../components/tresorerie/commun'
import { titreDu } from '../components/tresorerie/du'
import { libelleCheque, montantEnCirculation, statutCheque, trierCheques } from '../lib/cheques'
import { usePhoto } from '../lib/usePhoto'
import {
  LIBELLES_CATEGORIE, aujourdhuiISO, estTeteDeFond, fmt, formatDateFR, paiementsParDu, peut, resteDu, soldeCompte,
} from '../lib/tresorerie'
import { annulerCheque, annulerEncaissementCheque, encaisserCheque, enregistrerCheque } from '../lib/tresorerieDb'

const FILTRES = [
  { valeur: 'a_encaisser', label: 'À encaisser' },
  { valeur: 'encaisse', label: 'Encaissés' },
  { valeur: 'annule', label: 'Annulés' },
  { valeur: 'tous', label: 'Tous' },
]

const estBanque = c => c && c.nom !== 'Espèces' && !estTeteDeFond(c)

// Couleur et icône de chaque état.
function styleEtat(cle, colors) {
  switch (cle) {
    case 'en_retard': return { couleur: colors.error, icone: 'alert-circle-outline', surligne: colors.errorLight }
    case 'aujourdhui':
    case 'demain': return { couleur: colors.warningDark, icone: 'clock-alert-outline', surligne: colors.warningLight }
    case 'encaisse': return { couleur: colors.success, icone: 'check-circle-outline' }
    case 'annule': return { couleur: colors.textMuted, icone: 'close-circle-outline' }
    default: return { couleur: '#2563EB', icone: 'checkbook' }
  }
}

export default function TresorerieChequesScreen() {
  const { styles, colors } = useStylesTreso()
  const t = useTresorerie()
  const { donnees, niveau, user, recharger } = t
  const [compteId, setCompteId] = useState(null)
  const [filtre, setFiltre] = useState('a_encaisser')
  const [edition, setEdition] = useState(null)        // {} nouveau · chèque à modifier
  const [detail, setDetail] = useState(null)
  const [encaissement, setEncaissement] = useState(null)
  const [annulation, setAnnulation] = useState(null)

  const banques = useMemo(() => (donnees?.comptes || []).filter(estBanque), [donnees])
  useEffect(() => {
    if (banques.length && !banques.some(c => c.id === compteId)) setCompteId(banques[0].id)
  }, [banques, compteId])

  const aujourdhui = aujourdhuiISO()
  const compte = banques.find(c => c.id === compteId)
  const cheques = donnees?.cheques
  const duCompte = useMemo(() => (cheques || []).filter(c => c.compte_id === compteId), [cheques, compteId])
  const lignes = useMemo(() => trierCheques(duCompte.filter(c => (
    filtre === 'tous' ? true : filtre === 'a_encaisser' ? c.statut === 'emis' : c.statut === filtre
  )), aujourdhui), [duCompte, filtre, aujourdhui])

  const peutSaisir = peut(niveau, 'saisir_banque')
  const nomResto = id => donnees?.restaurants.find(r => r.id === id)?.nom || 'Groupe'
  const duDe = id => (donnees?.dus || []).find(d => d.id === id)

  const solde = compte ? soldeCompte(compte.mouvements) : 0
  const circulation = montantEnCirculation(cheques || [], compteId)
  const nbUrgents = duCompte.filter(c => c.statut === 'emis' && ['en_retard', 'aujourdhui', 'demain'].includes(statutCheque(c, aujourdhui).cle)).length

  const bloque = (t.loading && !donnees) || t.erreur || !peut(niveau, 'voir_banque')

  function annulerEncaissement(c) {
    Alert.alert(
      'Annuler l\'encaissement ?',
      `${libelleCheque(c)} · ${fmt(c.montant)} F. La sortie de banque${c.du_id ? ' et le paiement de la ligne' : ''} seront retirés ; le chèque redevient « à encaisser ».`,
      [
        { text: 'Garder', style: 'cancel' },
        {
          text: 'Annuler l\'encaissement', style: 'destructive', onPress: async () => {
            try { await annulerEncaissementCheque(c, user); await recharger(); setDetail(null) }
            catch (e) { Alert.alert('Annulation impossible', e?.message || 'Réessayez.') }
          },
        },
      ],
    )
  }

  return (
    <SafeAreaView style={styles.container}>
      <Entete titre="Chèques émis" sous={compte ? `${compte.nom} · ${fmt(circulation)} F à encaisser` : null} />
      {bloque ? <EtatEcran {...t} autorise={peut(niveau, 'voir_banque')} /> : (
        <ScrollView style={styles.body} contentContainerStyle={styles.bodyContenu}>
          {cheques === null ? (
            <View style={styles.avert}>
              <Text style={styles.avertTxt}>
                Les chèques ne sont pas encore installés dans la base : il faut passer le fichier supabase_tresorerie_cheques.sql dans Supabase.
              </Text>
            </View>
          ) : (
            <>
              <Puces valeur={compteId} onChange={setCompteId} options={banques.map(c => ({ valeur: c.id, label: c.nom }))} />

              <Hero icone="checkbook" titre={`Chèques à encaisser · ${compte?.nom || ''}`} valeur={`${fmt(circulation)} F`}
                sous={nbUrgents ? `${nbUrgents} à surveiller (retard, aujourd'hui ou demain)` : 'déjà retirés de la trésorerie nette réelle'}>
                <View style={styles.heroCases}>
                  <HeroCase label={`Solde ${compte?.nom || ''}`} valeur={fmt(solde)} couleur="#A7F3D0" />
                  <HeroCase label="Après les chèques" valeur={`${solde - circulation < 0 ? '− ' : ''}${fmt(Math.abs(solde - circulation))}`}
                    couleur={solde - circulation < 0 ? '#FECACA' : '#BAE6FD'} />
                </View>
              </Hero>

              {peutSaisir && (
                <Bouton icone="plus" titre="Nouveau chèque" style={{ marginBottom: 12 }} onPress={() => setEdition({ compte_id: compteId })} />
              )}

              <TitreSection icone="format-list-bulleted" titre="Chèques" droite={`${lignes.length}`} />
              <Puces valeur={filtre} onChange={setFiltre} options={FILTRES} />
              {lignes.length === 0 && (
                <Text style={styles.vide}>{filtre === 'a_encaisser' ? 'Aucun chèque à encaisser.' : 'Aucun chèque.'}</Text>
              )}
              {lignes.map(({ cheque: c, etat }) => {
                const se = styleEtat(etat.cle, colors)
                const du = c.du_id ? duDe(c.du_id) : null
                return (
                  <ItemIcone key={c.id} onPress={() => setDetail(c)} icone={se.icone} couleur={se.couleur}
                    surligne={se.surligne || null} estompe={etat.cle === 'annule'}
                    titre={`N° ${c.numero} · ${c.ordre}`}
                    sous={<Text style={[styles.petit, se.surligne && { color: se.couleur, fontWeight: '700' }]}>
                      {[etat.message, `émis le ${formatDateFR(c.date_emission)}`, du ? `paie ${titreDu(du, nomResto)}` : ''].filter(Boolean).join(' · ')}
                    </Text>}
                    droite={`${fmt(c.montant)} F`} couleurDroite={etat.cle === 'encaisse' ? colors.successDark : colors.text}
                    sousDroite={c.statut === 'emis' && peutSaisir ? (
                      <Bouton icone="check" titre="Encaissé" style={styles.btnPetit} onPress={() => setEncaissement(c)} />
                    ) : null}
                  />
                )
              })}
              <Text style={[styles.petit, { marginTop: 10 }]}>
                Un chèque à encaisser compte comme une prévision : il est déjà retiré de la trésorerie nette réelle. Le solde de {compte?.nom || 'la banque'} ne baisse que quand vous cochez « Encaissé ».
              </Text>
            </>
          )}
        </ScrollView>
      )}

      {donnees && cheques && (
        <>
          <FeuilleCheque cheque={edition} banques={banques} donnees={donnees} nomResto={nomResto} user={user}
            onFermer={() => setEdition(null)} apres={recharger} />
          <FeuilleDetailCheque cheque={detail} du={detail?.du_id ? duDe(detail.du_id) : null} nomResto={nomResto}
            aujourdhui={aujourdhui} peutSaisir={peutSaisir} onFermer={() => setDetail(null)}
            onEncaisser={c => { setDetail(null); setEncaissement(c) }}
            onModifier={c => { setDetail(null); setEdition(c) }}
            onAnnuler={c => { setDetail(null); setAnnulation(c) }}
            onAnnulerEncaissement={annulerEncaissement} />
          <FeuilleEncaissement cheque={encaissement} user={user} onFermer={() => setEncaissement(null)} apres={recharger} />
          <FeuilleAnnulation cheque={annulation} user={user} onFermer={() => setAnnulation(null)} apres={recharger} />
        </>
      )}
    </SafeAreaView>
  )
}

// ── Détail ───────────────────────────────────────────────────────────────────

function FeuilleDetailCheque({ cheque: c, du, nomResto, aujourdhui, peutSaisir, onFermer, onEncaisser, onModifier, onAnnuler, onAnnulerEncaissement }) {
  const { styles, colors } = useStylesTreso()
  if (!c) return null
  const etat = statutCheque(c, aujourdhui)
  const se = styleEtat(etat.cle, colors)
  return (
    <Feuille visible onFermer={onFermer} titre={libelleCheque(c)}>
      <View style={styles.carte}>
        <Text style={styles.label}>À l'ordre de</Text>
        <Text style={[styles.itemTitre, { fontSize: 18 }]}>{c.ordre}</Text>
        <Text style={[styles.grand, { marginTop: 6, fontSize: 28 }]}>{fmt(c.montant)} F</Text>
        <Text style={[styles.petit, { color: se.couleur, fontWeight: '700' }]}>{etat.message}</Text>
        <View style={{ marginTop: 8 }}>
          <LigneTexte label="Banque" valeur={c.banque} />
          <LigneTexte label="Date d'émission" valeur={formatDateFR(c.date_emission)} />
          <LigneTexte label="Date d'encaissement prévue" valeur={formatDateFR(c.date_encaissement)} />
          {c.encaisse_le && <LigneTexte label="Encaissé le" valeur={formatDateFR(c.encaisse_le)} />}
        </View>
        {du && (
          <Text style={[styles.petit, { marginTop: 6 }]}>
            Paie : {LIBELLES_CATEGORIE[du.categorie]} · {titreDu(du, nomResto)}
          </Text>
        )}
        {!!c.note && <Text style={[styles.petit, { marginTop: 6 }]}>{c.note}</Text>}
        {!!c.cree_par_nom && <Text style={styles.petit}>Saisi par {c.cree_par_nom}</Text>}
        {!!c.photo_url && (
          <Image source={{ uri: c.photo_url }} style={{ width: '100%', height: 180, borderRadius: 10, marginTop: 10 }} resizeMode="cover" />
        )}
      </View>
      {peutSaisir && c.statut === 'emis' && (
        <View style={{ gap: 8 }}>
          <Bouton icone="check" titre="Encaissé" onPress={() => onEncaisser(c)} />
          <View style={styles.rangee}>
            <Bouton style={{ flex: 1 }} secondaire icone="pencil-outline" titre="Modifier" onPress={() => onModifier(c)} />
            <Bouton style={{ flex: 1 }} danger icone="close" titre="Annuler le chèque" onPress={() => onAnnuler(c)} />
          </View>
        </View>
      )}
      {peutSaisir && c.statut === 'encaisse' && (
        <Bouton secondaire icone="undo-variant" titre="Annuler l'encaissement" onPress={() => onAnnulerEncaissement(c)} />
      )}
    </Feuille>
  )
}

function LigneTexte({ label, valeur }) {
  const { styles } = useStylesTreso()
  return (
    <View style={styles.ligne}>
      <Text style={styles.ligneLabel}>{label}</Text>
      <Text style={styles.ligneValeur}>{valeur}</Text>
    </View>
  )
}

// ── Saisie / modification ────────────────────────────────────────────────────

function FeuilleCheque({ cheque, banques, donnees, nomResto, user, onFermer, apres }) {
  const { styles, colors } = useStylesTreso()
  const { choisirPhoto } = usePhoto()
  const [compteId, setCompteId] = useState(null)
  const [numero, setNumero] = useState('')
  const [banque, setBanque] = useState('')
  const [ordre, setOrdre] = useState('')
  const [lien, setLien] = useState('libre')          // 'libre' | 'ligne'
  const [duId, setDuId] = useState(null)
  const [recherche, setRecherche] = useState('')
  const [montant, setMontant] = useState('')
  const [dateEmission, setDateEmission] = useState(aujourdhuiISO())
  const [dateEncaissement, setDateEncaissement] = useState('')
  const [note, setNote] = useState('')
  const [photo, setPhoto] = useState(null)
  const [photoEnCours, setPhotoEnCours] = useState(false)
  const [occupe, setOccupe] = useState(false)

  useEffect(() => {
    if (!cheque) return
    const cpt = banques.find(b => b.id === cheque.compte_id) || banques[0]
    setCompteId(cpt?.id || null)
    setNumero(cheque.numero || '')
    setBanque(cheque.banque || cpt?.nom || '')
    setOrdre(cheque.ordre || '')
    setLien(cheque.du_id ? 'ligne' : 'libre')
    setDuId(cheque.du_id || null)
    setRecherche('')
    setMontant(cheque.montant ? String(cheque.montant) : '')
    setDateEmission(cheque.date_emission || aujourdhuiISO())
    setDateEncaissement(cheque.date_encaissement || '')
    setNote(cheque.note || '')
    setPhoto(cheque.photo_url || null)
  }, [cheque]) // eslint-disable-line react-hooks/exhaustive-deps

  const parDu = useMemo(() => paiementsParDu(donnees.paiements), [donnees])
  // Lignes qu'un chèque peut payer : celles qui ont un reste, dettes d'abord.
  const lignesOuvertes = useMemo(() => (donnees.dus || [])
    .map(d => ({ du: d, reste: resteDu(d, parDu[d.id]) }))
    .filter(x => x.reste > 0 || x.du.id === cheque?.du_id)
    .sort((a, b) => (a.du.categorie === 'dette' ? 0 : 1) - (b.du.categorie === 'dette' ? 0 : 1)
      || titreDu(a.du, nomResto).localeCompare(titreDu(b.du, nomResto))), [donnees, parDu, cheque]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!cheque) return null
  const modification = !!cheque.id
  const choisie = lignesOuvertes.find(x => x.du.id === duId)
  // La prévision du chèque ne baisse pas le reste : en modification, le plafond ne change pas.
  const resteLigne = choisie?.reste ?? 0
  const filtrees = lignesOuvertes.filter(x => !recherche.trim()
    || `${LIBELLES_CATEGORIE[x.du.categorie]} ${titreDu(x.du, nomResto)}`.toLowerCase().includes(recherche.trim().toLowerCase()))

  function choisirLigne(du) {
    setDuId(du.id)
    if (!ordre.trim()) setOrdre(du.categorie === 'dette' ? du.creancier || '' : titreDu(du, nomResto))
  }

  function choisirCompte(id) {
    const ancien = banques.find(b => b.id === compteId)
    setCompteId(id)
    // La banque suit le compte, sauf si on l'a changée à la main.
    if (!banque.trim() || banque === ancien?.nom) setBanque(banques.find(b => b.id === id)?.nom || '')
  }

  async function ajouterPhoto() {
    setPhotoEnCours(true)
    const url = await choisirPhoto('photos')
    if (url) setPhoto(url)
    setPhotoEnCours(false)
  }

  async function enregistrer() {
    const v = montant === '' ? 0 : parseInt(montant, 10) || 0
    if (!compteId) { Alert.alert('Compte manquant', 'Sur quel compte le chèque est-il tiré ?'); return }
    if (!numero.trim()) { Alert.alert('Numéro manquant', 'Recopiez le numéro du chèque.'); return }
    if (!banque.trim()) { Alert.alert('Banque manquante', 'Quelle banque ?'); return }
    if (lien === 'ligne' && !duId) { Alert.alert('Ligne manquante', 'Choisissez ce que paie le chèque, ou « Sans lien ».'); return }
    if (!ordre.trim()) { Alert.alert('Ordre manquant', 'À l\'ordre de qui est le chèque ?'); return }
    if (!v) { Alert.alert('Montant manquant', 'Quel est le montant du chèque ?'); return }
    if (lien === 'ligne' && v > resteLigne) {
      Alert.alert('Montant trop élevé', `Il ne reste que ${fmt(resteLigne)} F à payer sur cette ligne.`); return
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateEmission) || !/^\d{4}-\d{2}-\d{2}$/.test(dateEncaissement)) {
      Alert.alert('Date manquante', 'Choisissez la date d\'émission et la date d\'encaissement dans le calendrier.'); return
    }
    if (dateEncaissement < dateEmission) {
      Alert.alert('Dates à vérifier', 'La date d\'encaissement ne peut pas être avant la date d\'émission.'); return
    }
    setOccupe(true)
    try {
      await enregistrerCheque({
        id: cheque.id, compte_id: compteId, numero: numero.trim(), banque: banque.trim(), ordre: ordre.trim(),
        du_id: lien === 'ligne' ? duId : null, montant: v, date_emission: dateEmission, date_encaissement: dateEncaissement,
        note: note.trim(), photo_url: photo,
      }, user)
      await apres()
      onFermer()
    } catch (e) {
      Alert.alert('Non enregistré', e?.message || 'Réessayez.')
    } finally {
      setOccupe(false)
    }
  }

  return (
    <Feuille visible onFermer={onFermer} titre={modification ? `Modifier · chèque n° ${cheque.numero}` : 'Nouveau chèque émis'}>
      <Text style={styles.label}>Compte</Text>
      <Puces valeur={compteId} onChange={choisirCompte} options={banques.map(b => ({ valeur: b.id, label: b.nom }))} />
      <Champ label="Numéro du chèque" value={numero} onChangeText={setNumero} placeholder="ex. 0012345" />
      <Champ label="Banque" value={banque} onChangeText={setBanque} />

      <Text style={styles.label}>Ce que paie le chèque</Text>
      <Puces valeur={lien} onChange={v => { setLien(v); if (v === 'libre') setDuId(null) }}
        options={[{ valeur: 'libre', label: 'Sans lien' }, { valeur: 'ligne', label: 'Une dette ou une charge' }]} />
      {lien === 'ligne' && (
        choisie ? (
          <View style={[styles.carte, { marginBottom: 12 }]}>
            <Text style={styles.itemTitre}>{LIBELLES_CATEGORIE[choisie.du.categorie]} · {titreDu(choisie.du, nomResto)}</Text>
            <Text style={styles.petit}>Reste à payer : {fmt(choisie.reste)} F</Text>
            <TouchableOpacity onPress={() => setDuId(null)} style={{ marginTop: 6 }}>
              <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 13 }}>Changer</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={{ marginBottom: 12 }}>
            <Champ label="Chercher" value={recherche} onChangeText={setRecherche} placeholder="ex. Ali sable, loyer…" />
            {filtrees.length === 0 && <Text style={styles.vide}>Aucune ligne à payer.</Text>}
            {filtrees.slice(0, 40).map(({ du, reste }) => (
              <ItemIcone key={du.id} onPress={() => choisirLigne(du)}
                icone={styleCategorie(du.categorie).icone} couleur={styleCategorie(du.categorie).couleur}
                titre={`${LIBELLES_CATEGORIE[du.categorie]} · ${titreDu(du, nomResto)}`}
                droite={`${fmt(reste)} F`} />
            ))}
          </View>
        )
      )}

      <Champ label="À l'ordre de" value={ordre} onChangeText={setOrdre} placeholder="ex. Ali sable" />
      <ChampMontant label="Montant" valeur={montant} onChange={setMontant} />
      <ChampCalendrier label="Date d'émission" valeur={dateEmission} onChange={setDateEmission} />
      <ChampCalendrier label="Date d'encaissement prévue" valeur={dateEncaissement} onChange={setDateEncaissement} />
      <Champ label="Note (facultatif)" value={note} onChangeText={setNote} />
      <Text style={styles.label}>Photo du chèque ou du talon (facultatif)</Text>
      {photo ? <Image source={{ uri: photo }} style={{ width: '100%', height: 160, borderRadius: 10, marginBottom: 12 }} resizeMode="cover" /> : null}
      <Bouton secondaire icone="camera-outline" titre={photo ? 'Changer la photo' : 'Ajouter une photo'} onPress={ajouterPhoto}
        occupe={photoEnCours} style={{ marginBottom: 14 }} />
      <Bouton titre={modification ? 'Enregistrer' : 'Enregistrer le chèque'} onPress={enregistrer} occupe={occupe} />
      <Text style={[styles.petit, { marginTop: 10 }]}>
        Le montant est retiré tout de suite de la trésorerie nette réelle (prévision). Le solde de la banque ne baisse qu'au moment où vous cochez « Encaissé ». Rappel la veille, le jour même et chaque jour de retard.
      </Text>
    </Feuille>
  )
}

// ── Encaissé ─────────────────────────────────────────────────────────────────

function FeuilleEncaissement({ cheque: c, user, onFermer, apres }) {
  const { styles } = useStylesTreso()
  const [date, setDate] = useState(aujourdhuiISO())
  const [occupe, setOccupe] = useState(false)

  useEffect(() => { if (c) setDate(aujourdhuiISO()) }, [c])
  if (!c) return null

  async function confirmer() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { Alert.alert('Date invalide', 'Choisissez la date dans le calendrier.'); return }
    setOccupe(true)
    try {
      await encaisserCheque(c, date, user)
      await apres()
      onFermer()
    } catch (e) {
      Alert.alert('Non enregistré', e?.message || 'Réessayez.')
    } finally {
      setOccupe(false)
    }
  }

  return (
    <Feuille visible onFermer={onFermer} titre={`Encaissé · ${libelleCheque(c)}`}>
      <Ligne label={`À l'ordre de ${c.ordre}`} valeur={c.montant} fort />
      <ChampCalendrier label="Date du débit (relevé)" valeur={date} onChange={setDate} />
      <Bouton icone="check" titre="Confirmer l'encaissement" onPress={confirmer} occupe={occupe} />
      <Text style={[styles.petit, { marginTop: 10 }]}>
        {fmt(c.montant)} F sortent du solde {c.banque} à cette date{c.du_id ? ', et la ligne payée baisse d\'autant' : ''}. La prévision disparaît.
      </Text>
    </Feuille>
  )
}

// ── Annulation (perdu, refait, jamais remis) ─────────────────────────────────

function FeuilleAnnulation({ cheque: c, user, onFermer, apres }) {
  const { styles } = useStylesTreso()
  const [motif, setMotif] = useState('')
  const [occupe, setOccupe] = useState(false)

  useEffect(() => { if (c) setMotif('') }, [c])
  if (!c) return null

  async function confirmer() {
    if (!motif.trim()) { Alert.alert('Motif manquant', 'Pourquoi ce chèque est-il annulé ?'); return }
    setOccupe(true)
    try {
      await annulerCheque(c, motif.trim(), user)
      await apres()
      onFermer()
    } catch (e) {
      Alert.alert('Annulation impossible', e?.message || 'Réessayez.')
    } finally {
      setOccupe(false)
    }
  }

  return (
    <Feuille visible onFermer={onFermer} titre={`Annuler · ${libelleCheque(c)}`}>
      <Text style={[styles.petit, { marginBottom: 10 }]}>
        {fmt(c.montant)} F à l'ordre de {c.ordre}. Le chèque reste dans l'historique (son numéro ne resservira pas) ; sa prévision disparaît.
      </Text>
      <Champ label="Motif" value={motif} onChangeText={setMotif} placeholder="ex. chèque perdu, refait au n° …" />
      <Bouton danger icone="close" titre="Annuler le chèque" onPress={confirmer} occupe={occupe} />
    </Feuille>
  )
}
