// ──────────────────────────────────────────────────────────────────────────────
// Trésorerie — Coffre de sécurité (M. Zreik seul).
//
// Argent réel mis à part : il ne compte pas dans la trésorerie nette. Un dépôt
// depuis BACI / SIB sort de la banque ; un retrait vers BACI / SIB y entre.
// Objectif fixé mois par mois ; un mois sans objectif reprend le précédent.
// ──────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react'
import { Alert, SafeAreaView, ScrollView, Text, TouchableOpacity, View } from 'react-native'

import {
  Bouton, Champ, ChampMontant, Entete, EtatEcran, Feuille, Puces, useStylesTreso, useTresorerie,
} from '../components/tresorerie/commun'
import { objectifDuMois, progression, soldeCoffre } from '../lib/direction'
import { aujourdhuiISO, fmt, formatDateFR, libelleMois, peut, premierDuMois } from '../lib/tresorerie'
import { annulerOperationCoffre, definirObjectifCoffre, operationCoffre } from '../lib/tresorerieDb'

const LIBELLES = { depot: 'Dépôt', retrait: 'Retrait', depense: 'Dépense direction' }

export default function TresorerieCoffreScreen() {
  const { styles, colors } = useStylesTreso()
  const t = useTresorerie({ avecDirection: true })
  const { donnees, niveau, user, recharger } = t
  const [operation, setOperation] = useState(null) // 'depot' | 'retrait'
  const [objectifVisible, setObjectifVisible] = useState(false)

  const d = donnees?.direction
  const mois = premierDuMois(aujourdhuiISO())
  const solde = d ? soldeCoffre(d.coffre) : 0
  const objectif = d ? objectifDuMois(d.objectifs, mois) : 0
  const pct = progression(solde, objectif)
  const nomCompte = id => donnees?.comptes.find(c => c.id === id)?.nom || '?'

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
            <Bouton style={[styles.btnPetit, { flex: 1 }]} secondaire titre="− Retrait" onPress={() => setOperation('retrait')} />
            <Bouton style={[styles.btnPetit, { flex: 1 }]} titre="+ Dépôt" onPress={() => setOperation('depot')} />
          </View>
        </View>

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
          <FeuilleOperation type={operation} donnees={donnees} solde={solde} user={user} onFermer={() => setOperation(null)} apres={recharger} />
          <FeuilleObjectif visible={objectifVisible} mois={mois} actuel={objectif} user={user} onFermer={() => setObjectifVisible(false)} apres={recharger} />
        </>
      )}
    </SafeAreaView>
  )
}

function FeuilleOperation({ type, donnees, solde, user, onFermer, apres }) {
  const { styles } = useStylesTreso()
  const [montant, setMontant] = useState('')
  const [source, setSource] = useState(null)
  const [date, setDate] = useState(aujourdhuiISO())
  const [libelle, setLibelle] = useState('')
  const [occupe, setOccupe] = useState(false)

  useEffect(() => { if (type) { setMontant(''); setSource(null); setDate(aujourdhuiISO()); setLibelle('') } }, [type])
  if (!type) return null
  const depot = type === 'depot'

  async function enregistrer() {
    const v = montant === '' ? 0 : parseInt(montant, 10)
    if (!v) { Alert.alert('Montant manquant', 'Saisissez le montant.'); return }
    if (!source) { Alert.alert(depot ? 'Origine manquante' : 'Destination manquante', depot ? 'D\'où vient l\'argent ?' : 'Où va l\'argent ?'); return }
    if (!depot && v > solde) { Alert.alert('Solde insuffisant', `Le coffre ne contient que ${fmt(solde)} F.`); return }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { Alert.alert('Date invalide', 'Écrivez la date au format AAAA-MM-JJ.'); return }
    setOccupe(true)
    try {
      await operationCoffre({
        type, montant: v, source: source === 'especes' ? 'especes' : 'compte', compteId: source === 'especes' ? null : source,
        date, libelle: libelle.trim() || (depot ? 'Dépôt au coffre' : 'Retrait du coffre'),
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
    <Feuille visible onFermer={onFermer} titre={depot ? 'Dépôt au coffre' : 'Retrait du coffre'}>
      <ChampMontant label="Montant" valeur={montant} onChange={setMontant} />
      <Text style={styles.label}>{depot ? 'L\'argent vient de' : 'L\'argent va vers'}</Text>
      <Puces options={[...donnees.comptes.map(c => ({ valeur: c.id, label: c.nom })), { valeur: 'especes', label: 'Espèces' }]}
        valeur={source} onChange={setSource} />
      <Champ label="Date (AAAA-MM-JJ)" value={date} onChangeText={setDate} autoCapitalize="none" />
      <Champ label="Libellé (facultatif)" value={libelle} onChangeText={setLibelle} />
      <Bouton titre="Enregistrer" onPress={enregistrer} occupe={occupe} />
      <Text style={[styles.petit, { marginTop: 10 }]}>
        {depot ? 'Depuis BACI ou SIB : la sortie apparaît dans la banque.' : 'Vers BACI ou SIB : l\'entrée apparaît dans la banque.'}
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
