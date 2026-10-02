// ──────────────────────────────────────────────────────────────────────────────
// Trésorerie — Coffre de sécurité (M. Zreik seul).
//
// Épargne : il ne compte pas dans la trésorerie nette. « Épargner » sort
// l'argent d'Espèces, BACI ou SIB ; « Emprunter » le remet sur le compte choisi
// et demande quand rembourser (date, ou prochaine réception Glovo, Wave…).
// Le moment venu, l'emprunt passe « à rembourser » : simple rappel.
// Objectif fixé mois par mois ; un mois sans objectif reprend le précédent.
// ──────────────────────────────────────────────────────────────────────────────
import { useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { Alert, SafeAreaView, ScrollView, Text, TouchableOpacity, View } from 'react-native'

import {
  Bouton, Champ, ChampMontant, Entete, EtatEcran, Feuille, Puces, useStylesTreso, useTresorerie,
} from '../components/tresorerie/commun'
import { objectifDuMois, progression, resteARembourser, soldeCoffre, statutEmprunt } from '../lib/direction'
import { aujourdhuiISO, fmt, formatDateFR, libelleMois, peut, premierDuMois } from '../lib/tresorerie'
import {
  annulerEmprunt, annulerOperationCoffre, definirObjectifCoffre, emprunterCoffre, operationCoffre, rembourserEmprunt,
} from '../lib/tresorerieDb'

const LIBELLES = { depot: 'Épargne', retrait: 'Sortie', depense: 'Dépense direction' }

const PARTENAIRES = [
  { valeur: 'glovo', label: 'Glovo' }, { valeur: 'yango', label: 'Yango' }, { valeur: 'wave', label: 'Wave' },
  { valeur: 'om', label: 'Orange Money' }, { valeur: 'djamo', label: 'Djamo' },
]
const nomPartenaire = v => PARTENAIRES.find(p => p.valeur === v)?.label || v

export default function TresorerieCoffreScreen() {
  const { styles, colors } = useStylesTreso()
  const t = useTresorerie({ avecDirection: true })
  const { donnees, niveau, user, recharger } = t
  const params = useLocalSearchParams()
  const [operation, setOperation] = useState(null) // 'depot' | 'emprunt'
  const [remboursement, setRemboursement] = useState(null) // emprunt à rembourser
  const [objectifVisible, setObjectifVisible] = useState(false)

  // Raccourci « Épargner » depuis Banque et espèces.
  useEffect(() => { if (params.op === 'epargner') setOperation('depot') }, [params.op])

  const d = donnees?.direction
  const mois = premierDuMois(aujourdhuiISO())
  const solde = d ? soldeCoffre(d.coffre) : 0
  const objectif = d ? objectifDuMois(d.objectifs, mois) : 0
  const pct = progression(solde, objectif)
  const nomCompte = id => donnees?.comptes.find(c => c.id === id)?.nom || '?'
  const aujourdhui = aujourdhuiISO()
  const emprunts = (d?.emprunts || []).filter(e => !e.rembourse_le)
  const aRendre = resteARembourser(d?.emprunts)

  function annulerUnEmprunt(e) {
    Alert.alert('Annuler cet emprunt ?', `${fmt(e.montant)} F du ${formatDateFR(e.date)}. L'argent revient au coffre et sort de ${nomCompte(e.compte_id)}.`, [
      { text: 'Garder', style: 'cancel' },
      {
        text: 'Annuler l\'emprunt', style: 'destructive', onPress: async () => {
          try { await annulerEmprunt(e, user); await recharger() }
          catch (err) { Alert.alert('Annulation impossible', err?.message || 'Réessayez.') }
        },
      },
    ])
  }

  function annuler(m) {
    if (m.type === 'depense') {
      Alert.alert('Sortie liée à une dépense', 'Pour l\'enlever, supprimez la dépense direction.')
      return
    }
    Alert.alert(`Annuler ce ${LIBELLES[m.type].toLowerCase()} ?`, `${fmt(Math.abs(m.montant))} F du ${formatDateFR(m.date)}. Le mouvement de banque lié est retiré aussi.`, [
      { text: 'Garder', style: 'cancel' },
      {
        text: 'Annuler', style: 'destructive', onPress: async () => {
          try { await annulerOperationCoffre(m, user); await recharger() }
          catch (e) { Alert.alert('Annulation impossible', e?.message || 'Réessayez.') }
        },
      },
    ])
  }

  const bloque = (t.loading && !donnees) || t.erreur || !peut(niveau, 'voir_coffre')
  let contenu
  if (bloque) contenu = <EtatEcran {...t} autorise={peut(niveau, 'voir_coffre')} />
  else if (d === null) {
    contenu = (
      <View style={styles.centre}>
        <Text style={styles.erreur}>Le coffre n'est pas encore installé dans la base : il faut passer le fichier supabase_tresorerie_direction.sql dans Supabase.</Text>
      </View>
    )
  } else {
    contenu = (
      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContenu}>
        <View style={styles.carte}>
          <Text style={styles.lbl}>Solde du coffre</Text>
          <Text style={styles.grand}>{fmt(solde)} F</Text>
          <View style={{ height: 10, backgroundColor: colors.surfaceAlt, borderRadius: 6, overflow: 'hidden', marginTop: 10 }}>
            <View style={{ height: '100%', width: `${Math.min(100, pct || 0)}%`, backgroundColor: colors.success }} />
          </View>
          <View style={[styles.ligne, { paddingVertical: 4 }]}>
            <Text style={styles.petit}>{pct === null ? 'Pas d\'objectif' : `${pct} %`}</Text>
            <TouchableOpacity onPress={() => setObjectifVisible(true)}>
              <Text style={[styles.petit, { color: colors.primary, fontWeight: '700' }]}>
                Objectif {libelleMois(mois).split(' ')[0].toLowerCase()} : {objectif ? `${fmt(objectif)} F` : 'à fixer'} ✏️
              </Text>
            </TouchableOpacity>
          </View>
          <View style={[styles.rangee, { marginTop: 8 }]}>
            <Bouton style={[styles.btnPetit, { flex: 1 }]} secondaire titre="Emprunter" onPress={() => setOperation('emprunt')} />
            <Bouton style={[styles.btnPetit, { flex: 1 }]} titre="+ Épargner" onPress={() => setOperation('depot')} />
          </View>
        </View>

        {emprunts.length > 0 && (
          <View style={styles.carte}>
            <View style={styles.ligne}>
              <Text style={styles.lbl}>À rembourser au coffre</Text>
              <Text style={[styles.ligneValeur, { color: colors.warningDark }]}>{fmt(aRendre)} F</Text>
            </View>
            {emprunts.map(e => {
              const st = statutEmprunt(e, d.receptions, aujourdhui)
              const quand = e.rembourser_le ? `le ${formatDateFR(e.rembourser_le)}` : `à la prochaine réception ${nomPartenaire(e.rembourser_partenaire)}`
              return (
                <TouchableOpacity key={e.id} onLongPress={() => annulerUnEmprunt(e)} delayLongPress={500}
                  style={[styles.item, st === 'a_rembourser' && { backgroundColor: colors.warningLight, borderRadius: 10, paddingHorizontal: 8 }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemTitre}>{fmt(e.montant)} F · {nomCompte(e.compte_id)}</Text>
                    <Text style={[styles.petit, st === 'a_rembourser' && { color: colors.warningDark, fontWeight: '700' }]}>
                      {st === 'a_rembourser' ? `C'est le moment de rembourser (prévu ${quand})` : `Emprunté le ${formatDateFR(e.date)} · rembourser ${quand}`}
                      {e.note ? ` · ${e.note}` : ''}
                    </Text>
                  </View>
                  <Bouton titre="Rembourser" style={styles.btnPetit} onPress={() => setRemboursement(e)} />
                </TouchableOpacity>
              )
            })}
            <Text style={styles.petit}>Appui long sur un emprunt pour l'annuler.</Text>
          </View>
        )}

        <View style={styles.carte}>
          {d.coffre.length === 0 && <Text style={styles.vide}>Aucun mouvement.</Text>}
          {d.coffre.map(m => (
            <TouchableOpacity key={m.id} style={styles.item} onLongPress={() => annuler(m)} delayLongPress={500}>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemTitre}>{m.libelle || LIBELLES[m.type]}</Text>
                <Text style={styles.petit}>
                  {formatDateFR(m.date)} · {LIBELLES[m.type]}
                  {m.source === 'compte' ? ` · ${m.type === 'depot' ? 'depuis' : 'vers'} ${nomCompte(m.compte_id)}` : m.source === 'especes' ? ' · espèces' : ''}
                </Text>
              </View>
              <Text style={[styles.ligneValeur, { color: m.montant >= 0 ? colors.success : colors.error }]}>
                {m.montant >= 0 ? '+ ' : '− '}{fmt(Math.abs(m.montant))}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.petit}>Appui long sur un mouvement pour l'annuler. Le coffre ne compte pas dans la trésorerie nette.</Text>
      </ScrollView>
    )
  }

  return (
    <SafeAreaView style={styles.container}>
      <Entete titre="Coffre de sécurité" sous="M. Zreik seul" />
      {contenu}
      {donnees && (
        <>
          <FeuilleEpargne visible={operation === 'depot'} donnees={donnees} user={user} onFermer={() => setOperation(null)} apres={recharger} />
          <FeuilleEmprunt visible={operation === 'emprunt'} donnees={donnees} solde={solde} user={user} onFermer={() => setOperation(null)} apres={recharger} />
          <FeuilleRemboursement emprunt={remboursement} donnees={donnees} user={user} onFermer={() => setRemboursement(null)} apres={recharger} />
          <FeuilleObjectif visible={objectifVisible} mois={mois} actuel={objectif} user={user} onFermer={() => setObjectifVisible(false)} apres={recharger} />
        </>
      )}
    </SafeAreaView>
  )
}

// Épargner : l'argent sort d'Espèces, BACI ou SIB et entre au coffre.
function FeuilleEpargne({ visible, donnees, user, onFermer, apres }) {
  const { styles } = useStylesTreso()
  const [montant, setMontant] = useState('')
  const [source, setSource] = useState(null)
  const [date, setDate] = useState(aujourdhuiISO())
  const [libelle, setLibelle] = useState('')
  const [occupe, setOccupe] = useState(false)

  useEffect(() => { if (visible) { setMontant(''); setSource(null); setDate(aujourdhuiISO()); setLibelle('') } }, [visible])
  if (!visible) return null

  async function enregistrer() {
    const v = montant === '' ? 0 : parseInt(montant, 10)
    if (!v) { Alert.alert('Montant manquant', 'Saisissez le montant.'); return }
    if (!source) { Alert.alert('Origine manquante', 'D\'où vient l\'argent : Espèces, BACI ou SIB ?'); return }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { Alert.alert('Date invalide', 'Écrivez la date au format AAAA-MM-JJ.'); return }
    setOccupe(true)
    try {
      await operationCoffre({
        type: 'depot', montant: v, source: 'compte', compteId: source,
        date, libelle: libelle.trim() || 'Épargne',
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
    <Feuille visible onFermer={onFermer} titre="Épargner">
      <ChampMontant label="Montant à mettre de côté" valeur={montant} onChange={setMontant} />
      <Text style={styles.label}>L'argent vient de</Text>
      <Puces options={donnees.comptes.map(c => ({ valeur: c.id, label: c.nom }))} valeur={source} onChange={setSource} />
      <Champ label="Date (AAAA-MM-JJ)" value={date} onChangeText={setDate} autoCapitalize="none" />
      <Champ label="Libellé (facultatif)" value={libelle} onChangeText={setLibelle} />
      <Bouton titre="Enregistrer" onPress={enregistrer} occupe={occupe} />
      <Text style={[styles.petit, { marginTop: 10 }]}>
        La somme sort du compte choisi et entre au coffre (hors trésorerie).
      </Text>
    </Feuille>
  )
}

function FeuilleObjectif({ visible, mois, actuel, user, onFermer, apres }) {
  const [montant, setMontant] = useState('')
  const [occupe, setOccupe] = useState(false)
  useEffect(() => { if (visible) setMontant(actuel ? String(actuel) : '') }, [visible])
  if (!visible) return null

  async function enregistrer() {
    const v = montant === '' ? 0 : parseInt(montant, 10)
    setOccupe(true)
    try {
      await definirObjectifCoffre({ mois, montant: v }, user)
      await apres()
      onFermer()
    } catch (e) {
      Alert.alert('Non enregistré', e?.message || 'Réessayez.')
    } finally {
      setOccupe(false)
    }
  }

  return (
    <Feuille visible onFermer={onFermer} titre={`Objectif du coffre · ${libelleMois(mois)}`}>
      <ChampMontant label="Montant à atteindre ce mois-ci" valeur={montant} onChange={setMontant} />
      <Bouton titre="Enregistrer" onPress={enregistrer} occupe={occupe} />
    </Feuille>
  )
}

// Emprunter au coffre : l'argent va sur le compte choisi ; on dit tout de suite
// quand on le rendra (date, ou prochaine réception d'un partenaire).
function FeuilleEmprunt({ visible, donnees, solde, user, onFermer, apres }) {
  const { styles } = useStylesTreso()
  const [montant, setMontant] = useState('')
  const [compte, setCompte] = useState(null)
  const [quand, setQuand] = useState(null)        // 'date' | 'reception'
  const [dateRetour, setDateRetour] = useState('')
  const [partenaire, setPartenaire] = useState(null)
  const [note, setNote] = useState('')
  const [occupe, setOccupe] = useState(false)

  useEffect(() => {
    if (visible) { setMontant(''); setCompte(null); setQuand(null); setDateRetour(''); setPartenaire(null); setNote('') }
  }, [visible])
  if (!visible) return null

  async function enregistrer() {
    const v = montant === '' ? 0 : parseInt(montant, 10)
    if (!v) { Alert.alert('Montant manquant', 'Saisissez le montant à emprunter.'); return }
    if (v > solde) { Alert.alert('Coffre insuffisant', `Le coffre ne contient que ${fmt(solde)} F.`); return }
    if (!compte) { Alert.alert('Compte manquant', 'Où va l\'argent : Espèces, BACI ou SIB ?'); return }
    if (!quand) { Alert.alert('Remboursement', 'Quand allez-vous rembourser le coffre ?'); return }
    if (quand === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(dateRetour)) {
      Alert.alert('Date invalide', 'Écrivez la date de remboursement au format AAAA-MM-JJ.'); return
    }
    if (quand === 'reception' && !partenaire) { Alert.alert('Partenaire manquant', 'À la réception de quel partenaire ?'); return }
    setOccupe(true)
    try {
      await emprunterCoffre({
        montant: v, compteId: compte, date: aujourdhuiISO(),
        rembourserLe: quand === 'date' ? dateRetour : null,
        rembourserPartenaire: quand === 'reception' ? partenaire : null,
        note: note.trim(),
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
    <Feuille visible onFermer={onFermer} titre="Emprunter au coffre">
      <Text style={[styles.petit, { marginBottom: 10 }]}>Dans le coffre : {fmt(solde)} F</Text>
      <ChampMontant label="Montant emprunté" valeur={montant} onChange={setMontant} />
      <Text style={styles.label}>L'argent va sur</Text>
      <Puces options={donnees.comptes.map(c => ({ valeur: c.id, label: c.nom }))} valeur={compte} onChange={setCompte} />
      <Text style={styles.label}>Quand rembourser le coffre ?</Text>
      <Puces options={[{ valeur: 'date', label: 'À une date' }, { valeur: 'reception', label: 'À la prochaine réception' }]}
        valeur={quand} onChange={setQuand} />
      {quand === 'date' && (
        <Champ label="Date de remboursement (AAAA-MM-JJ)" value={dateRetour} onChangeText={setDateRetour} autoCapitalize="none" placeholder="Ex : 2026-10-15" />
      )}
      {quand === 'reception' && <Puces options={PARTENAIRES} valeur={partenaire} onChange={setPartenaire} />}
      <Champ label="Pour quoi ? (facultatif)" value={note} onChangeText={setNote} placeholder="Ex : salaires KMS" />
      <Bouton titre="Emprunter" onPress={enregistrer} occupe={occupe} />
      <Text style={[styles.petit, { marginTop: 10 }]}>Le moment venu, l'emprunt passe en orange « à rembourser ». Rien n'est remboursé tout seul.</Text>
    </Feuille>
  )
}

// Rembourser : le montant emprunté revient au coffre depuis le compte choisi.
function FeuilleRemboursement({ emprunt, donnees, user, onFermer, apres }) {
  const { styles } = useStylesTreso()
  const [compte, setCompte] = useState(null)
  const [date, setDate] = useState(aujourdhuiISO())
  const [occupe, setOccupe] = useState(false)

  useEffect(() => { if (emprunt) { setCompte(emprunt.compte_id); setDate(aujourdhuiISO()) } }, [emprunt])
  if (!emprunt) return null

  async function enregistrer() {
    if (!compte) { Alert.alert('Compte manquant', 'D\'où part l\'argent ?'); return }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { Alert.alert('Date invalide', 'Écrivez la date au format AAAA-MM-JJ.'); return }
    setOccupe(true)
    try {
      await rembourserEmprunt({ emprunt, compteId: compte, date }, user)
      await apres()
      onFermer()
    } catch (e) {
      Alert.alert('Non enregistré', e?.message || 'Réessayez.')
    } finally {
      setOccupe(false)
    }
  }

  return (
    <Feuille visible onFermer={onFermer} titre={`Rembourser ${fmt(emprunt.montant)} F au coffre`}>
      <Text style={styles.label}>L'argent part de</Text>
      <Puces options={donnees.comptes.map(c => ({ valeur: c.id, label: c.nom }))} valeur={compte} onChange={setCompte} />
      <Champ label="Date (AAAA-MM-JJ)" value={date} onChangeText={setDate} autoCapitalize="none" />
      <Bouton titre="Rembourser" onPress={enregistrer} occupe={occupe} />
    </Feuille>
  )
}
