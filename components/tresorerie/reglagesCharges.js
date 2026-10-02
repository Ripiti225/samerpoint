// ──────────────────────────────────────────────────────────────────────────────
// Trésorerie — réglages des charges à échéance (RH et propriétaire) :
// loyers, jour limite commun, montants fixes (impôts, ITS, TEE).
// Les baux se saisissent par année : components/tresorerie/saisieGroupee.js.
// Tout se paie après coup : la charge du mois M est due au jour limite de M+1.
// Spéc : docs/superpowers/specs/2026-10-02-nouvelle-tresorerie-design.md
// ──────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react'
import { Alert, Text, TouchableOpacity, View } from 'react-native'

import {
  LIBELLES_CATEGORIE, aujourdhuiISO, dusAMettreAJour, fmt, jourCommun, libelleMois, moisEntre,
  paiementsParDu, planReglageLoyer, premierDuMois, resteDu, resumeLoyersParRestaurant,
} from '../../lib/tresorerie'
import { enregistrerChargeFixe, enregistrerEcheance, enregistrerLoyer } from '../../lib/tresorerieDb'
import { Bouton, Champ, ChampMontant, Feuille, useStylesTreso } from './commun'

const NOMS_MOIS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre']

function lireJour(texte) {
  const j = parseInt(texte, 10)
  return j >= 1 && j <= 31 ? j : null
}

// ── Loyers ───────────────────────────────────────────────────────────────────

// Le loyer mensuel, le jour limite, et les mois passés que l'on doit encore
// (cochés). Le mois en cours et les suivants se créent tout seuls.
export function FeuilleReglageLoyers({ visible, donnees, user, onFermer, apres }) {
  const { styles, colors } = useStylesTreso()
  const [restaurantId, setRestaurantId] = useState(null)
  const [montant, setMontant] = useState('')
  const [jour, setJour] = useState('5')
  const [moisCoches, setMoisCoches] = useState([])
  const [occupe, setOccupe] = useState(false)

  const courant = premierDuMois(aujourdhuiISO())
  // Les 12 mois passés (le mois en cours n'est dû que le mois prochain : il se crée seul).
  const moisProposes = moisEntre('2000-01-01', courant).slice(-13, -1)
  const parDu = useMemo(() => paiementsParDu(donnees.paiements), [donnees])
  const dusResto = donnees.dus.filter(d => d.categorie === 'loyer' && d.restaurant_id === restaurantId)
  const entame = m => dusResto.some(d => d.mois === m && parDu[d.id]?.length)
  const resume = useMemo(() => resumeLoyersParRestaurant(donnees.dus, donnees.paiements, courant), [donnees, courant])

  useEffect(() => {
    if (!restaurantId) return
    const l = donnees.loyers.find(x => x.restaurant_id === restaurantId)
    setMontant(l ? String(l.montant) : '')
    setJour(l ? String(l.jour_echeance) : '5')
    setMoisCoches(dusResto.filter(d => moisProposes.includes(d.mois)).map(d => d.mois))
  }, [restaurantId])

  if (!visible) return null

  function basculer(m) {
    if (entame(m)) {
      Alert.alert('Mois déjà entamé', `Un paiement existe pour ${libelleMois(m)}. Annulez-le d'abord depuis le détail du mois.`)
      return
    }
    setMoisCoches(l => (l.includes(m) ? l.filter(x => x !== m) : [...l, m]))
  }

  async function enregistrer() {
    const v = montant === '' ? 0 : parseInt(montant, 10)
    const j = lireJour(jour)
    if (!restaurantId) { Alert.alert('Restaurant manquant', 'Choisissez le restaurant.'); return }
    if (!v) { Alert.alert('Montant manquant', 'Saisissez le loyer mensuel.'); return }
    if (!j) { Alert.alert('Jour invalide', 'Le jour limite va de 1 à 31.'); return }
    const l = donnees.loyers.find(x => x.restaurant_id === restaurantId)
    const plan = planReglageLoyer({
      restaurantId, montant: v, jourEcheance: j, moisCoches, moisProposes,
      dusExistants: donnees.dus, paiements: donnees.paiements,
    })
    // Le mois en cours suit aussi un nouveau montant ou un nouveau jour, s'il n'est pas entamé.
    const enCours = dusAMettreAJour({
      categorie: 'loyer', restaurantId, montant: v, jour: j,
      dus: donnees.dus.filter(d => d.mois >= courant), paiements: donnees.paiements, aujourdhui: aujourdhuiISO(),
    })
    setOccupe(true)
    try {
      await enregistrerLoyer({
        restaurantId, montant: v, jourEcheance: j, moisDepart: courant,
        actif: l ? l.actif : true, plan: { ...plan, aModifier: [...plan.aModifier, ...enCours] },
      }, user)
      await apres()
      setRestaurantId(null)
    } catch (e) {
      Alert.alert('Non enregistré', e?.message || 'Réessayez.')
    } finally {
      setOccupe(false)
    }
  }

  const totalCoche = moisCoches.reduce((s, m) => {
    const d = dusResto.find(x => x.mois === m)
    return s + (d && parDu[d.id]?.length ? resteDu(d, parDu[d.id]) : (parseInt(montant, 10) || 0))
  }, 0)

  return (
    <Feuille visible onFermer={onFermer} titre="Loyers des restaurants">
      {donnees.restaurants.map(r => {
        const l = donnees.loyers.find(x => x.restaurant_id === r.id)
        const doit = resume[r.id]?.reste || 0
        return (
          <TouchableOpacity key={r.id} style={[styles.item, restaurantId === r.id && { backgroundColor: colors.primaryLight }]}
            onPress={() => setRestaurantId(r.id)}>
            <Text style={[styles.itemTitre, { flex: 1 }]}>{r.nom}</Text>
            <Text style={styles.petit}>
              {l ? `${fmt(l.montant)} F · le ${l.jour_echeance}${doit ? ` · doit ${fmt(doit)} F` : ''}` : 'non réglé'}
            </Text>
          </TouchableOpacity>
        )
      })}

      {restaurantId && (
        <View style={[styles.carte, { marginTop: 12 }]}>
          <Text style={[styles.itemTitre, { marginBottom: 10 }]}>{donnees.restaurants.find(r => r.id === restaurantId)?.nom}</Text>
          <ChampMontant label="Loyer mensuel" valeur={montant} onChange={setMontant} />
          <Champ label="Jour limite dans le mois suivant (1 à 31)" value={jour} onChangeText={t => setJour(t.replace(/[^\d]/g, ''))} keyboardType="number-pad" />
          <Text style={styles.label}>Mois passés que l'on doit encore</Text>
          <View style={styles.puces}>
            {[...moisProposes].reverse().map(m => {
              const actif = moisCoches.includes(m)
              return (
                <TouchableOpacity key={m} style={[styles.puce, actif && styles.puceActive]} onPress={() => basculer(m)}>
                  <Text style={[styles.puceTxt, actif && styles.puceTxtActive]}>{libelleMois(m)}{entame(m) ? ' · entamé' : ''}</Text>
                </TouchableOpacity>
              )
            })}
          </View>
          <View style={[styles.ligne, { marginBottom: 10 }]}>
            <Text style={styles.ligneLabel}>Total dû pour ces mois</Text>
            <Text style={[styles.ligneValeur, { color: totalCoche ? colors.error : colors.success }]}>{fmt(totalCoche)} F</Text>
          </View>
          <Text style={[styles.petit, { marginBottom: 10 }]}>
            Le loyer d'un mois est dû le mois suivant : celui de {libelleMois(courant)} avant le {lireJour(jour) || '…'} {NOMS_MOIS[Number(courant.slice(5, 7)) % 12].toLowerCase()}.
            Le mois en cours et les suivants s'ajoutent tout seuls.
          </Text>
          <Bouton titre="Enregistrer le loyer" onPress={enregistrer} occupe={occupe} />
        </View>
      )}
    </Feuille>
  )
}

// ── Jour limite commun (salaires, CNPS, impôts, ITS, TEE) ────────────────────

export function FeuilleEcheance({ categorie, donnees, user, onFermer, apres }) {
  const { styles } = useStylesTreso()
  const [jour, setJour] = useState('')
  const [occupe, setOccupe] = useState(false)

  useEffect(() => {
    if (categorie) setJour(String(jourCommun(donnees.echeances, categorie)))
  }, [categorie])

  if (!categorie) return null

  async function enregistrer() {
    const j = lireJour(jour)
    if (!j) { Alert.alert('Jour invalide', 'Le jour limite va de 1 à 31.'); return }
    const maj = dusAMettreAJour({ categorie, jour: j, dus: donnees.dus, paiements: donnees.paiements, aujourdhui: aujourdhuiISO() })
    setOccupe(true)
    try {
      await enregistrerEcheance({ categorie, jour: j }, maj, user)
      await apres()
      onFermer()
    } catch (e) {
      Alert.alert('Non enregistré', e?.message || 'Réessayez.')
    } finally {
      setOccupe(false)
    }
  }

  return (
    <Feuille visible onFermer={onFermer} titre={`Date limite · ${LIBELLES_CATEGORIE[categorie]}`}>
      <Champ label="Jour limite dans le mois suivant (1 à 31)" value={jour}
        onChangeText={t => setJour(t.replace(/[^\d]/g, ''))} keyboardType="number-pad" />
      <Text style={[styles.petit, { marginBottom: 12 }]}>
        Le même jour pour tous les restaurants. Exemple : avec le {lireJour(jour) || '…'}, la charge de septembre est à payer avant le {lireJour(jour) || '…'} octobre.
        Les lignes pas encore payées et pas encore en retard suivent le nouveau jour.
      </Text>
      <Bouton titre="Enregistrer" onPress={enregistrer} occupe={occupe} />
    </Feuille>
  )
}

// ── Montants fixes (impôts, ITS, TEE) ────────────────────────────────────────

export function FeuilleMontantsFixes({ categorie, donnees, user, onFermer, apres }) {
  const { styles } = useStylesTreso()
  const [valeurs, setValeurs] = useState({})
  const [occupe, setOccupe] = useState(false)

  const existants = useMemo(
    () => Object.fromEntries((donnees.chargesFixes || []).filter(f => f.categorie === categorie).map(f => [f.restaurant_id, f])),
    [donnees, categorie],
  )

  useEffect(() => {
    if (!categorie) return
    setValeurs(Object.fromEntries(Object.values(existants).map(f => [f.restaurant_id, f.actif ? String(f.montant) : ''])))
  }, [categorie])

  if (!categorie) return null

  async function enregistrer() {
    const courant = premierDuMois(aujourdhuiISO())
    setOccupe(true)
    try {
      for (const r of donnees.restaurants) {
        const avant = existants[r.id]
        const texte = valeurs[r.id] ?? ''
        const montant = texte === '' ? 0 : parseInt(texte, 10) || 0
        if (montant > 0) {
          if (avant && avant.actif && Number(avant.montant) === montant) continue
          const maj = dusAMettreAJour({
            categorie, restaurantId: r.id, montant, dus: donnees.dus, paiements: donnees.paiements, aujourdhui: aujourdhuiISO(),
          })
          await enregistrerChargeFixe({
            categorie, restaurantId: r.id, montant, moisDepart: avant?.mois_depart || courant, actif: true,
          }, maj, user)
        } else if (avant?.actif) {
          // Champ vidé : plus de nouvelle ligne ; celles déjà créées restent.
          await enregistrerChargeFixe({
            categorie, restaurantId: r.id, montant: Number(avant.montant), moisDepart: avant.mois_depart, actif: false,
          }, [], user)
        }
      }
      await apres()
      onFermer()
    } catch (e) {
      Alert.alert('Non enregistré', e?.message || 'Réessayez.')
    } finally {
      setOccupe(false)
    }
  }

  const jour = jourCommun(donnees.echeances, categorie)

  return (
    <Feuille visible onFermer={onFermer} titre={`Montants · ${LIBELLES_CATEGORIE[categorie]}`}>
      <Text style={[styles.petit, { marginBottom: 12 }]}>
        Montant mensuel, fixe sur l'année. Une ligne par mois se crée toute seule, due le {jour} du mois suivant.
        Champ vide = plus de nouvelle ligne pour ce restaurant.
      </Text>
      {donnees.restaurants.map(r => (
        <ChampMontant key={r.id} label={r.nom} valeur={valeurs[r.id] || ''}
          onChange={v => setValeurs(x => ({ ...x, [r.id]: v }))} placeholder="Pas de montant" />
      ))}
      <Bouton titre="Enregistrer" onPress={enregistrer} occupe={occupe} />
    </Feuille>
  )
}
