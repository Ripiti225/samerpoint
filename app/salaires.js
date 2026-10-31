// ──────────────────────────────────────────────────────────────────────────────
// Salaires du mois — écran RH / manager.
//
// Une carte par restaurant : statut de l'état (à préparer, brouillon, soumis,
// validé) et ses totaux. Toucher une carte ouvre le détail (DetailEtat).
//   RH       prépare / recalcule, corrige une ligne, soumet au manager.
//   Manager  valide (l'état se fige, dû Trésorerie) ou renvoie avec un motif.
// Conception : docs/superpowers/specs/2026-10-30-etats-salaire-bulletins-design.md
// ──────────────────────────────────────────────────────────────────────────────
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, SafeAreaView, ScrollView, Text, TouchableOpacity, View } from 'react-native'

import DetailEtat from '../components/salaires/DetailEtat'
import FeuilleEmployeurs from '../components/salaires/FeuilleEmployeurs'
import { EnTete, Pastille, useEcranModerne } from '../components/ui/EcranModerne'
import { useApp } from '../context/AppContext'
import { chargerRestaurants } from '../lib/equipeDb'
import { chargerEtatsDuMois, libelleMois, restoAvecPaie } from '../lib/paieDb'

export const STATUTS_ETAT = {
  aucun: { label: 'À préparer', couleur: '#64748B' },
  brouillon: { label: 'Brouillon RH', couleur: '#C2410C' },
  soumis: { label: 'À valider', couleur: '#2F6FD8' },
  valide: { label: 'Validé', couleur: '#047857' },
}

/** Mois précédent le mois en cours : c'est celui qu'on paie. */
function moisParDefaut(aujourdhui = new Date()) {
  const d = new Date(Date.UTC(aujourdhui.getFullYear(), aujourdhui.getMonth() - 1, 1))
  return d.toISOString().slice(0, 10)
}
function decaler(mois, n) {
  const [a, m] = mois.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1 + n, 1)).toISOString().slice(0, 10)
}
const F = v => `${Math.round(Number(v) || 0).toLocaleString('fr-FR')} F`

export default function SalairesScreen() {
  const { userId, userNom, roleActif } = useApp() ?? {}
  const ctx = { userId: userId || null, userNom: userNom || null }
  const estManager = roleActif === 'manager' || roleActif === 'directeur'
  const { styles, colors, accent } = useEcranModerne('orange')
  const params = useLocalSearchParams()

  const [mois, setMois] = useState(typeof params.mois === 'string' ? params.mois : moisParDefaut())
  const [restaurants, setRestaurants] = useState([])
  const [etats, setEtats] = useState({})
  const [loading, setLoading] = useState(true)
  const [erreur, setErreur] = useState('')
  const [ouvert, setOuvert] = useState(null)
  const [employeurs, setEmployeurs] = useState(false)

  useEffect(() => { charger() }, [mois])

  async function charger() {
    setLoading(true)
    setErreur('')
    try {
      const [r, e] = await Promise.all([chargerRestaurants(), chargerEtatsDuMois(mois)])
      setRestaurants(r.filter(restoAvecPaie))
      setEtats(e)
    } catch (e) {
      setErreur(e.message)
    } finally {
      setLoading(false)
    }
  }

  const total = Object.values(etats).reduce((s, e) => s + Number(e.totaux?.reste_a_payer || 0), 0)

  return (
    <SafeAreaView style={styles.container}>
      <EnTete titre="Salaires du mois" sous={`Reste à payer : ${F(total)}`} styles={styles}
        onRetour={() => (router.canGoBack() ? router.back() : router.replace('/accueil'))} />

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16, paddingVertical: 10 }}>
        <TouchableOpacity onPress={() => setMois(decaler(mois, -1))} hitSlop={12} style={{ minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 22, color: accent }}>‹</Text>
        </TouchableOpacity>
        <Text style={{ fontSize: 18, fontWeight: '800', color: colors.text, textTransform: 'capitalize' }}>{libelleMois(mois)}</Text>
        <TouchableOpacity onPress={() => setMois(decaler(mois, 1))} hitSlop={12} style={{ minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 22, color: accent }}>›</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingBox}><ActivityIndicator size="large" color={accent} /></View>
      ) : (
        <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
          {erreur ? <Text style={[styles.infoTxt, { color: '#B91C1C', flex: 0, marginBottom: 12 }]}>{erreur}</Text> : null}
          {restaurants.map(r => {
            const e = etats[r.id]
            const cfg = STATUTS_ETAT[e?.statut || 'aucun']
            return (
              <TouchableOpacity key={r.id} style={styles.carte} activeOpacity={0.8} onPress={() => setOuvert(r)}>
                <View style={styles.carteTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.carteTitre}>{r.nom}</Text>
                    <Text style={styles.carteSous}>
                      {e ? `Reste à payer ${F(e.totaux?.reste_a_payer)} · brut bulletins ${F(e.totaux?.brut)}` : 'Aucun état pour ce mois'}
                    </Text>
                  </View>
                  <Text style={{ color: accent, fontWeight: '800' }}>Ouvrir ›</Text>
                </View>
                <Pastille cfg={cfg} styles={styles} />
                {e?.statut === 'brouillon' && e.renvoi_motif
                  ? <Text style={[styles.infoTxt, { color: '#C2410C', marginTop: 6, flex: 0 }]}>Renvoyé : {e.renvoi_motif}</Text>
                  : null}
              </TouchableOpacity>
            )
          })}
          {estManager && (
            <TouchableOpacity onPress={() => setEmployeurs(true)} style={{ paddingVertical: 16, alignItems: 'center' }}>
              <Text style={{ color: accent, fontWeight: '700' }}>🏢 Employeurs (en-tête des bulletins)</Text>
            </TouchableOpacity>
          )}
          <View style={{ height: 60 }} />
        </ScrollView>
      )}

      <DetailEtat visible={!!ouvert} resto={ouvert} mois={mois} ctx={ctx} estManager={estManager}
        onFermer={() => { setOuvert(null); charger() }} />
      <FeuilleEmployeurs visible={employeurs} ctx={ctx} onFermer={() => setEmployeurs(false)} />
    </SafeAreaView>
  )
}
