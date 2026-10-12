/*
 * Recherche globale — la loupe de l'accueil (manager, gérant).
 * On tape un mot, on voit tous les endroits où il apparaît (libellés, notes,
 * motifs, noms…), groupés par source, avec l'écran où l'ouvrir.
 * Spéc : docs/superpowers/specs/2026-10-12-recherche-globale-design.md
 */

import { router } from 'expo-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator, FlatList, SafeAreaView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native'
import { useApp } from '../context/AppContext'
import { useTheme } from '../context/ThemeContext'
import { rechercheGlobale } from '../lib/api'
import { chargerAccesConfig, tuilesPourRole } from '../lib/menus'
import { retour } from '../lib/navigation'
import { rechercheCourante } from '../lib/rechercheCourante'
import {
  LIMITE_PAR_SOURCE, LONGUEUR_MIN, cheminEcran, dateCourte, extrait, grouperParSource, peutOuvrir, routePour, texteLisible,
} from '../lib/rechercheGlobale'

const DELAI_FRAPPE = 350

function montantTexte(m) {
  const n = Number(m)
  return m === null || m === undefined || !Number.isFinite(n) ? null : `${Math.round(n).toLocaleString('fr-FR')} F`
}

export default function Recherche() {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { roleActif, restaurantId, dateJour } = useApp()
  const manager = roleActif === 'manager'

  const [terme, setTerme] = useState('')
  const [etat, setEtat] = useState({ statut: 'vide', resultats: [] })
  const [idsTuiles, setIdsTuiles] = useState([])
  const numeroRequete = useRef(0)
  const champ = useRef(null)

  // Revenir sur la recherche efface le bandeau de rappel.
  useEffect(() => { rechercheCourante.definir(null) }, [])

  // Écrans que le gérant peut ouvrir (ses tuiles, réglées dans Paramètres).
  useEffect(() => {
    if (manager) return
    let actif = true
    chargerAccesConfig().then(config => {
      if (actif) setIdsTuiles(tuilesPourRole('gerant', config).map(t => (t.route || '').replace(/^\//, '') || t.id))
    })
    return () => { actif = false }
  }, [manager])

  useEffect(() => {
    const t = terme.trim()
    const numero = ++numeroRequete.current
    if (t.length < LONGUEUR_MIN) {
      setEtat({ statut: 'vide', resultats: [] })
      return
    }
    setEtat(e => ({ ...e, statut: 'chargement' }))
    const minuteur = setTimeout(async () => {
      try {
        const r = await rechercheGlobale(t, { restaurantId, manager, date: dateJour })
        if (numero !== numeroRequete.current) return // une frappe plus récente a pris le relais
        setEtat({ statut: r.horsLigne ? 'horsLigne' : 'ok', resultats: r.resultats })
      } catch {
        if (numero === numeroRequete.current) setEtat({ statut: 'erreur', resultats: [] })
      }
    }, DELAI_FRAPPE)
    return () => clearTimeout(minuteur)
  }, [terme, restaurantId, manager, dateJour])

  const groupes = useMemo(() => grouperParSource(etat.resultats), [etat.resultats])
  // Liste à plat : une bannière par source, puis ses cartes.
  const lignes = useMemo(() => groupes.flatMap(g => [
    { cle: `g:${g.source}`, groupe: g },
    ...g.resultats.map(r => ({ cle: `${r.source}:${r.id}`, resultat: r })),
    ...(g.resultats.length >= LIMITE_PAR_SOURCE ? [{ cle: `l:${g.source}`, limite: true }] : []),
  ]), [groupes])

  function ouvrir(r) {
    rechercheCourante.definir({ ...r, terme: terme.trim() })
    router.push(routePour(r))
  }

  function renderLigne({ item }) {
    if (item.groupe) {
      return (
        <View style={styles.banniere}>
          <Text style={styles.banniereTxt}>{item.groupe.source}</Text>
          <Text style={styles.banniereNb}>{item.groupe.resultats.length}</Text>
        </View>
      )
    }
    if (item.limite) {
      return <Text style={styles.limite}>Les {LIMITE_PAR_SOURCE} plus récents — précise ta recherche pour voir les autres</Text>
    }
    const r = item.resultat
    const ouvrable = peutOuvrir(r, idsTuiles, manager)
    const e = extrait(texteLisible(r.texte), terme)
    const montant = montantTexte(r.montant)
    return (
      <TouchableOpacity
        style={[styles.carte, !ouvrable && styles.carteGrisee]}
        disabled={!ouvrable}
        onPress={() => ouvrir(r)}
        accessibilityRole="button"
        accessibilityLabel={`${cheminEcran(r)}, ${r.champ} : ${texteLisible(r.texte)}`}
      >
        <View style={styles.carteHaut}>
          <Text style={styles.chemin} numberOfLines={1}>{cheminEcran(r)}</Text>
          <Text style={styles.date}>{dateCourte(r.date)}</Text>
        </View>
        {manager && r.restaurant_nom ? <Text style={styles.resto}>{r.restaurant_nom}</Text> : null}
        <Text style={styles.extrait}>
          <Text style={styles.champ}>{r.champ} : </Text>
          {e.avant}
          {e.trouve ? <Text style={styles.surligne}>{e.trouve}</Text> : null}
          {e.apres}
        </Text>
        <View style={styles.carteBas}>
          {montant ? <Text style={styles.montant}>{montant}</Text> : <View />}
          <Text style={ouvrable ? styles.ouvrir : styles.nonDispo}>{ouvrable ? 'Ouvrir ›' : 'Écran non disponible'}</Text>
        </View>
      </TouchableOpacity>
    )
  }

  function messageVide() {
    const t = terme.trim()
    if (etat.statut === 'chargement') return <ActivityIndicator size="large" color={colors.primary} />
    if (etat.statut === 'horsLigne') return <Text style={styles.videTxt}>Pas de connexion : la recherche a besoin d'internet.</Text>
    if (etat.statut === 'erreur') return <Text style={styles.videTxt}>La recherche n'a pas abouti. Réessaie dans un instant.</Text>
    if (t.length < LONGUEUR_MIN) {
      return (
        <>
          <Text style={styles.videTxt}>Tape au moins {LONGUEUR_MIN} lettres.</Text>
          <Text style={styles.videSous}>
            {manager
              ? 'Dépenses, fournisseurs, trésorerie, points, équipe, litiges, journal… tous les restaurants.'
              : dateJour
                ? `Ta journée du ${dateCourte(dateJour)} (dépenses, présences, litiges…), tes fournisseurs, ton équipe et tes demandes en cours.`
                : "Aucune journée ouverte : seulement tes fournisseurs, ton équipe et tes demandes en cours."}
          </Text>
        </>
      )
    }
    return <Text style={styles.videTxt}>Aucun résultat pour « {t} ».</Text>
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => retour()} style={styles.backBtn}>
          <Text style={styles.backTxt}>← Retour</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitre}>Recherche</Text>
        <View style={styles.champRecherche}>
          <Text style={styles.loupe}>🔍</Text>
          <TextInput
            style={styles.input}
            value={terme}
            onChangeText={setTerme}
            placeholder="paie, Konan, loyer, numéro…"
            placeholderTextColor={colors.textMuted}
            autoFocus
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            ref={champ}
          />
          {etat.statut === 'chargement' && lignes.length > 0 ? <ActivityIndicator size="small" color={colors.primary} /> : null}
          {terme ? (
            <TouchableOpacity style={styles.effacer} onPress={() => { setTerme(''); champ.current?.focus() }}
              accessibilityRole="button" accessibilityLabel="Effacer la recherche" hitSlop={8}>
              <Text style={styles.effacerTxt}>✕</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {lignes.length > 0 && etat.statut !== 'horsLigne' && etat.statut !== 'erreur' && terme.trim().length >= LONGUEUR_MIN ? (
        <FlatList
          data={lignes}
          keyExtractor={l => l.cle}
          renderItem={renderLigne}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.liste}
        />
      ) : (
        <View style={styles.vide}>{messageVide()}</View>
      )}
    </SafeAreaView>
  )
}

function makeStyles(colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    header: { backgroundColor: colors.headerBg, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 16 },
    backBtn: { marginBottom: 10 },
    backTxt: { color: colors.primaryText, fontSize: 14 },
    headerTitre: { fontSize: 22, fontWeight: '700', color: colors.headerText, marginBottom: 12 },
    champRecherche: {
      flexDirection: 'row', alignItems: 'center', backgroundColor: colors.inputBg, borderRadius: 12,
      borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, minHeight: 48,
    },
    loupe: { fontSize: 16, marginRight: 8 },
    input: { flex: 1, fontSize: 16, color: colors.text, paddingVertical: 10 },
    effacer: {
      width: 28, height: 28, borderRadius: 14, marginLeft: 8, alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border,
    },
    effacerTxt: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
    liste: { paddingBottom: 40 },
    banniere: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      marginHorizontal: 12, marginTop: 18, marginBottom: 2, paddingHorizontal: 4,
    },
    banniereTxt: { fontSize: 13, fontWeight: '800', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4 },
    banniereNb: {
      fontSize: 12, fontWeight: '700', color: colors.primaryDark, backgroundColor: colors.primaryLight,
      paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, overflow: 'hidden',
    },
    carte: {
      backgroundColor: colors.surface, marginHorizontal: 12, marginTop: 8, borderRadius: 12, padding: 14,
      borderWidth: 1, borderColor: colors.border,
    },
    carteGrisee: { opacity: 0.6 },
    carteHaut: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    chemin: { fontSize: 12.5, fontWeight: '700', color: colors.primary, flex: 1, marginRight: 8 },
    date: { fontSize: 12, color: colors.textMuted },
    resto: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
    extrait: { fontSize: 14, color: colors.text, marginTop: 6, lineHeight: 20 },
    champ: { color: colors.textMuted, fontSize: 12.5 },
    surligne: { backgroundColor: colors.warningLight, color: colors.text, fontWeight: '800' },
    carteBas: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
    montant: { fontSize: 13, fontWeight: '700', color: colors.text },
    ouvrir: { fontSize: 12.5, fontWeight: '700', color: colors.primary },
    nonDispo: { fontSize: 12, color: colors.textMuted, fontStyle: 'italic' },
    limite: { fontSize: 12, color: colors.textMuted, marginHorizontal: 16, marginTop: 8, fontStyle: 'italic' },
    vide: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
    videTxt: { fontSize: 15, color: colors.textMuted, textAlign: 'center' },
    videSous: { fontSize: 12.5, color: colors.textMuted, marginTop: 8, textAlign: 'center' },
  })
}
