// ──────────────────────────────────────────────────────────────────────────────
// « Remettre le fond à 0 » : transfère tout ou partie d'un fond de caisse
// négatif vers la dette administration ou le fournisseur « Report caisse »,
// et liste les transferts du restaurant (annulables). Ouverte depuis la
// Trésorerie (alerte « Fond bas », bloc « Fonds négatifs ») et la Vérification.
// Spéc : docs/superpowers/specs/2026-10-12-fond-negatif-transfert-design.md
// ──────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Text, TouchableOpacity, View } from 'react-native'

import { Bouton, Champ, ChampMontant, Feuille, Ligne, Puces, useStylesTreso } from './commun'
import { fmt, formatDateFR } from '../../lib/tresorerie'
import { DESTINATIONS, fondApres, fondLaisse, montantMaxTransfert, validerTransfert } from '../../lib/transfertFond'
import { annulerTransfert, chargerFondRestaurant, chargerTransferts, transfererFond } from '../../lib/transfertFondDb'

const signe = v => (v < 0 ? `− ${fmt(-v)}` : fmt(v))

export default function FeuilleTransfertFond({ restaurantId, nomResto, user, peutTransferer = true, onFermer, apres }) {
  const { styles, colors } = useStylesTreso()
  const [point, setPoint] = useState(undefined)   // undefined : chargement ; null : aucune journée validée
  const [historique, setHistorique] = useState({ lignes: [], migration: false })
  const [destination, setDestination] = useState('dette_admin')
  const [montant, setMontant] = useState('')
  const [note, setNote] = useState('')
  const [occupe, setOccupe] = useState(false)
  const [erreur, setErreur] = useState(null)

  const charger = useCallback(async () => {
    setErreur(null)
    try {
      const [p, h] = await Promise.all([chargerFondRestaurant(restaurantId), chargerTransferts(restaurantId)])
      setPoint(p)
      setHistorique(h)
    } catch (e) {
      setErreur(e?.message || 'Chargement impossible.')
    }
  }, [restaurantId])

  useEffect(() => {
    if (!restaurantId) return
    setPoint(undefined); setMontant(''); setNote(''); setDestination('dette_admin')
    charger()
  }, [restaurantId, charger])

  if (!restaurantId) return null

  const fond = point ? fondLaisse(point) : 0
  const max = montantMaxTransfert(fond)
  const v = montant === '' ? 0 : parseInt(montant, 10)

  async function transferer() {
    setOccupe(true)
    try {
      await transfererFond({ restaurantId, montant: v, destination, note: note.trim() }, user)
      setMontant(''); setNote('')
      await charger()
      if (apres) await apres()
    } catch (e) {
      Alert.alert('Transfert non enregistré', e?.message || 'Réessayez.')
    } finally {
      setOccupe(false)
    }
  }

  function confirmer() {
    const err = validerTransfert({ fond, montant: v, destination })
    if (err) { Alert.alert('Transfert impossible', err); return }
    Alert.alert(
      'Confirmer le transfert ?',
      `${fmt(v)} F vers ${DESTINATIONS[destination].label}.\nFond de ${nomResto} : ${signe(fond)} F → ${signe(fondApres(fond, v))} F.`,
      [
        { text: 'Retour', style: 'cancel' },
        { text: 'Transférer', onPress: transferer },
      ],
    )
  }

  function annuler(t) {
    const suite = t.destination === 'dette_admin'
      ? 'la dette administration est supprimée'
      : 'une écriture inverse est passée au fournisseur Report caisse'
    Alert.alert(
      'Annuler ce transfert ?',
      `${fmt(t.montant)} F vers ${DESTINATIONS[t.destination]?.label}. Le fond redescend d'autant et ${suite}.`,
      [
        { text: 'Garder', style: 'cancel' },
        {
          text: 'Annuler le transfert', style: 'destructive', onPress: async () => {
            try { await annulerTransfert(t.id, user); await charger(); if (apres) await apres() }
            catch (e) { Alert.alert('Annulation impossible', e?.message || 'Réessayez.') }
          },
        },
      ],
    )
  }

  let contenu
  if (erreur) contenu = <Text style={styles.erreur}>{erreur}</Text>
  else if (point === undefined) contenu = <ActivityIndicator color={colors.primary} style={{ marginVertical: 20 }} />
  else if (point === null) contenu = <Text style={styles.muted}>Aucune journée validée pour ce restaurant.</Text>
  else {
    contenu = (
      <>
        <Ligne label={`Fond laissé le ${formatDateFR(point.date)}`} valeur={fond} fort
          couleur={fond < 0 ? colors.error : colors.success} />
        {historique.migration && <Text style={[styles.erreur, { marginTop: 8 }]}>Migration à passer : supabase_fond_transferts.sql (SQL Editor de Supabase).</Text>}

        {peutTransferer && max > 0 && !historique.migration && (
          <View style={{ marginTop: 14 }}>
            <Text style={styles.label}>Transférer vers</Text>
            <Puces options={Object.entries(DESTINATIONS).map(([valeur, d]) => ({ valeur, label: d.label }))}
              valeur={destination} onChange={setDestination} />
            <Text style={[styles.petit, { marginBottom: 12 }]}>{DESTINATIONS[destination].detail}</Text>

            <ChampMontant label="Montant" valeur={montant} onChange={setMontant} placeholder={fmt(max)} />
            <TouchableOpacity onPress={() => setMontant(String(max))} style={{ marginTop: -6, marginBottom: 12 }}
              accessibilityRole="button" accessibilityLabel={`Tout transférer, ${fmt(max)} francs`}>
              <Text style={{ color: colors.primary, fontWeight: '700' }}>Tout ({fmt(max)} F)</Text>
            </TouchableOpacity>
            {v > 0 && (
              <Ligne label="Fond après transfert" valeur={fondApres(fond, v)}
                couleur={fondApres(fond, v) < 0 ? colors.error : colors.success} />
            )}
            <Champ label="Motif (facultatif)" value={note} onChangeText={setNote} placeholder="Ex : dépenses gérant non couvertes" />
            <Bouton titre="Remettre le fond à 0" icone="cash-refund" onPress={confirmer} occupe={occupe} desactive={!v} />
          </View>
        )}
        {peutTransferer && max === 0 && (
          <Text style={styles.muted}>Le fond n'est pas négatif : rien à transférer.</Text>
        )}

        {historique.lignes.length > 0 && (
          <View style={{ marginTop: 20 }}>
            <Text style={styles.label}>Transferts du fond</Text>
            {historique.lignes.map(t => (
              <View key={t.id} style={[styles.ligne, { opacity: t.annule_le ? 0.5 : 1 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.ligneLabel}>
                    {formatDateFR(t.date)} · {DESTINATIONS[t.destination]?.label} · {fmt(t.montant)} F
                  </Text>
                  <Text style={styles.petit}>
                    {[t.cree_par_nom, t.note, t.annule_le ? `annulé par ${t.annule_par_nom || '—'}` : null].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                {peutTransferer && !t.annule_le && (
                  <TouchableOpacity onPress={() => annuler(t)} accessibilityRole="button" accessibilityLabel="Annuler ce transfert">
                    <Text style={{ color: colors.error, fontWeight: '700' }}>Annuler</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </View>
        )}
      </>
    )
  }

  return (
    <Feuille visible onFermer={onFermer} titre={`Fond de caisse · ${nomResto}`}>
      {contenu}
    </Feuille>
  )
}
