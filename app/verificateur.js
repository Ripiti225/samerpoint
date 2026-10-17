/*
 * Écran VÉRIFICATEUR — comptage physique du stock.
 *
 * Le vérificateur sélectionne un restaurant. Le système charge le DERNIER stock
 * réel enregistré par le caissier (colonne « Stock réel », pré-remplie). Le
 * vérificateur compte physiquement et saisit « Stock compté ». L'« Écart » se
 * calcule automatiquement (compté − réel).
 *
 * Si ≥ 30 % des produits comptés présentent un écart, une PROPOSITION de demande
 * d'explication part à la direction (manager, RH, directeur) : c'est elle qui
 * décide de l'envoyer ou non, et à qui. Rien n'arrive au gérant avant.
 *
 * Le comptage est enregistré dans la table verifications_stock (best-effort) —
 * voir supabase_verifications_stock.sql.
 */

import { router } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import RecapVerifications from '../components/RecapVerifications'
import { useApp } from '../context/AppContext'
import { useTheme } from '../context/ThemeContext'
import { CATEGORIES_INVENTAIRE } from '../lib/constants'
import { journaliser } from '../lib/journal'
import { creerNotification } from '../lib/notificationsInterne'
import {
  caissiersResponsables, enregistrerDeductions, prixProduit, proposerRepartition,
} from '../lib/deductionsVerification'
import { supabase } from '../lib/supabase'
import { appliquerComptage } from '../lib/verificationStock'

// ≥ 30 % des produits comptés en écart → proposition de demande d'explication à
// la direction, avec les personnes concernées (gérant, caissier en poste, caissier
// du shift précédent). La direction choisit à qui l'envoyer.
const SEUIL_ECART = 0.3

// Ordre des produits selon le catalogue (IDs stables).
const ORDRE_PRODUIT = {}
CATEGORIES_INVENTAIRE.forEach((cat, ci) => {
  cat.produits.forEach((p, pi) => { ORDRE_PRODUIT[p.id] = ci * 1000 + pi })
})

function aujourdhui() {
  return new Date().toISOString().slice(0, 10)
}

export default function VerificateurScreen() {
  const { userId, userNom, roleActif, deconnecter } = useApp() ?? {}
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const [restaurants, setRestaurants] = useState([])
  const [resto, setResto] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [produits, setProduits] = useState([])      // [{ produit_id, produit_nom, stock_reel }]
  const [comptes, setComptes] = useState({})         // { produit_id: '12' }
  const [refInfo, setRefInfo] = useState(null)       // { date, caissierId, caissierNom }
  const [tab, setTab] = useState('comptage')         // 'comptage' | 'recap'
  const [explications, setExplications] = useState({})  // { produit_id: 'texte' }
  const [shiftsJour, setShiftsJour] = useState([])      // points_shifts du jour + veille

  useEffect(() => { chargerRestaurants() }, [])

  async function chargerRestaurants() {
    setLoading(true)
    const { data } = await supabase
      .from('restaurants').select('id, nom').order('nom')
    const restos = data || []
    setRestaurants(restos)
    if (restos[0]) {
      setResto(restos[0])
      await chargerStock(restos[0].id)
    }
    setLoading(false)
  }

  // Charge le stock final du DERNIER SHIFT VALIDÉ (valide = true) du restaurant.
  // Ex : à 18h, si le shift 08h-16h est validé mais le 16h-00h ne l'est pas,
  // la référence est le stock final de l'inventaire 08h-16h.
  async function chargerStock(restoId) {
    setLoading(true)
    setComptes({})
    setProduits([])
    setRefInfo(null)
    setExplications({})

    // Shifts de caisse du jour ET de la veille : à 07h30, le shift précédent
    // est celui du soir d'hier, c'est lui qui a déclaré le stock.
    const jour = aujourdhui()
    const veille = new Date(new Date(jour).getTime() - 86400000).toISOString().split('T')[0]
    const { data: psJour } = await supabase
      .from('points_shifts')
      .select('date, caissier_id, caissier_nom, heure_debut, heure_fin')
      .eq('restaurant_id', restoId).in('date', [jour, veille])
    setShiftsJour((psJour || []).map(x => ({ ...x, _veille: x.date === veille })))

    const { data: shifts } = await supabase
      .from('inventaires_shifts')
      .select('id, date, caissier_id, type_shift, heure_debut, heure_fin, created_at, inventaire_lignes(produit_id, produit_nom, stock_reel)')
      .eq('restaurant_id', restoId)
      .eq('valide', true)
      .order('created_at', { ascending: false })
      .limit(1)

    const shift = (shifts || [])[0]

    const map = {}
    ;(shift?.inventaire_lignes || []).forEach(l => {
      if (l.stock_reel == null) return
      if (!(l.produit_id in map)) {
        map[l.produit_id] = {
          produit_id: l.produit_id,
          produit_nom: l.produit_nom,
          stock_reel: Number(l.stock_reel),
        }
      }
    })

    const liste = Object.values(map).sort(
      (a, b) => (ORDRE_PRODUIT[a.produit_id] ?? 9999) - (ORDRE_PRODUIT[b.produit_id] ?? 9999)
    )
    setProduits(liste)

    // Caissier du shift validé — destinataire de l'explication.
    let caissierNom = null
    if (shift?.caissier_id) {
      const { data: u } = await supabase
        .from('utilisateurs').select('nom').eq('id', shift.caissier_id).maybeSingle()
      caissierNom = u?.nom || null
    }
    setRefInfo({
      date: shift?.date || null,
      caissierId: shift?.caissier_id || null,
      caissierNom,
      heureDebut: shift?.heure_debut || null,
      heureFin: shift?.heure_fin || null,
      typeShift: shift?.type_shift || null,
    })
    setLoading(false)
  }

  async function changerResto(r) {
    setResto(r)
    await chargerStock(r.id)
  }

  function setCompte(produitId, val) {
    const clean = val.replace(',', '.').replace(/[^0-9.]/g, '')
    setComptes(prev => ({ ...prev, [produitId]: clean }))
  }

  function ecartDe(p) {
    const raw = comptes[p.produit_id]
    if (raw == null || raw === '') return null
    const c = parseFloat(raw)
    if (isNaN(c)) return null
    return c - p.stock_reel
  }

  // Caissiers imputables : celui en poste à cette heure, plus celui du shift
  // précédent. Recalculé à chaque rendu pour rester juste si le comptage
  // s'étale sur un changement de shift.
  const responsables = useMemo(
    () => caissiersResponsables(shiftsJour, new Date().toTimeString().slice(0, 5)),
    [shiftsJour],
  )

  // Récap live
  const recap = useMemo(() => {
    let comptees = 0, avecEcart = 0
    produits.forEach(p => {
      const e = (() => {
        const raw = comptes[p.produit_id]
        if (raw == null || raw === '') return null
        const c = parseFloat(raw)
        return isNaN(c) ? null : c - p.stock_reel
      })()
      if (e != null) { comptees++; if (Math.abs(e) > 0.001) avecEcart++ }
    })
    const pct = comptees > 0 ? Math.round((avecEcart / comptees) * 100) : 0
    return { comptees, avecEcart, pct }
  }, [produits, comptes])

  function seDeconnecter() {
    deconnecter?.()
    router.replace('/login')
  }

  async function valider() {
    if (!resto) return
    if (recap.comptees === 0) {
      Alert.alert('Aucun comptage', 'Saisissez le stock compté d’au moins un produit avant de valider.')
      return
    }
    setSaving(true)
    const date = aujourdhui()

    // Lignes comptées avec écart calculé
    const lignes = produits
      .map(p => {
        const raw = comptes[p.produit_id]
        if (raw == null || raw === '') return null
        const compte = parseFloat(raw)
        if (isNaN(compte)) return null
        return { ...p, stock_compte: compte, ecart: compte - p.stock_reel }
      })
      .filter(Boolean)

    const avecEcart = lignes.filter(l => Math.abs(l.ecart) > 0.001)
    const ratio = lignes.length ? avecEcart.length / lignes.length : 0
    const pct = Math.round(ratio * 100)

    // Enregistrement du comptage (best-effort — n'empêche pas le flux si la table manque)
    const lot = `${userId || 'v'}-${Date.now()}` // regroupe les lignes de ce comptage
    const rows = lignes.map(l => ({
      lot_id: lot,
      restaurant_id: resto.id,
      date,
      verificateur_id: userId || null,
      verificateur_nom: userNom || null,
      produit_id: l.produit_id,
      produit_nom: l.produit_nom,
      stock_reel: l.stock_reel,
      stock_compte: l.stock_compte,
      ecart: l.ecart,
    }))
    try {
      const { error: insErr } = await supabase.from('verifications_stock').insert(rows)
      // Colonne lot_id absente sur une table déjà créée → réessai sans lot_id.
      if (insErr) {
        const rowsSansLot = rows.map(({ lot_id, ...r }) => r)
        await supabase.from('verifications_stock').insert(rowsSansLot)
      }
    } catch (_) { /* table absente : on continue */ }

    // Le stock compté devient le stock initial de l'inventaire (en cours si
    // ouvert, sinon le prochain créé). Sans ça le manque physique retomberait
    // en écart sur le caissier du shift suivant.
    let report = { cible: 'prochain', statut: 'ok' }
    try {
      report = await appliquerComptage({ restaurantId: resto.id, lotId: lot, lignes })
    } catch (_) { report = { cible: 'prochain', statut: 'erreur' } }

    // Chaque écart devient un montant à déduire, partagé à parts égales entre
    // le caissier en poste et celui du shift précédent. L'administration
    // tranchera ensuite depuis l'écran Vérification.
    let statutDeduc = 'vide'
    let totalDeduit = 0
    if (avecEcart.length > 0) {
      const aChiffrer = avecEcart.map(l => ({ ...l, explication: explications[l.produit_id] }))
      // L'app PROPOSE une répartition ; c'est l'administration qui tranchera.
      const { constat, parts } = proposerRepartition(aChiffrer, responsables)
      totalDeduit = constat.montant_plafond
      const explicationsJointes = avecEcart
        .map(l => (explications[l.produit_id] || '').trim() && `${l.produit_nom} : ${explications[l.produit_id].trim()}`)
        .filter(Boolean).join(' · ')
      statutDeduc = await enregistrerDeductions(parts.map(x => ({
        ...x, explication: explicationsJointes || null,
      })), {
        restaurantId: resto.id,
        date,
        lotId: lot,
        verificateurId: userId || null,
        verificateurNom: userNom || null,
      })
    }

    journaliser('verification_stock', {
      restaurant_id: resto.id, comptes: lignes.length, ecarts: avecEcart.length, pct,
      stock_initial_reporte: report.cible, report_statut: report.statut,
      montant_a_deduire: totalDeduit,
      caissiers_imputes: responsables.map(r => r.caissier_nom).join(', ') || '—',
    }, { par: userNom || roleActif, restaurantId: resto.id }).catch(() => {})

    // Notifier manager + directeur de la vérification de stock enregistrée.
    creerNotification({
      type: 'verification_stock',
      titre: '🔍 Vérification de stock',
      message: `${userNom || 'Vérificateur'}${resto.nom ? ` — ${resto.nom}` : ''} : ${lignes.length} produit(s) comptés, ${avecEcart.length} écart(s) (${pct}%)`,
      restaurant_id: resto.id,
      cible_role: ['manager', 'directeur'],
      screen: null,
    }).catch(() => {})

    // Ce que devient le stock compté — à dire clairement au vérificateur.
    const msgDeduc = statutDeduc === 'ok'
      ? `\n\n\u{1F4B0} ${totalDeduit.toLocaleString('fr-FR')} F \u00e0 r\u00e9partir. `
        + `Proposition : ${responsables.map(r => r.caissier_nom).join(' et ')}. `
        + `L'administration r\u00e9partira le montant d\u00e9finitivement.`
      : statutDeduc === 'migration'
        ? "\n\n\u26a0\ufe0f Montants NON enregistr\u00e9s : le script supabase_deductions_verification.sql n'a pas encore \u00e9t\u00e9 pass\u00e9."
        : statutDeduc === 'erreur'
          ? "\n\n\u26a0\ufe0f Les montants \u00e0 d\u00e9duire n'ont pas pu \u00eatre enregistr\u00e9s."
          : (responsables.length === 0 && avecEcart.length > 0)
            ? "\n\n\u26a0\ufe0f Aucun caissier identifi\u00e9 sur ce cr\u00e9neau : aucun montant n'a \u00e9t\u00e9 imput\u00e9."
            : ''

    const msgReport =
      report.statut === 'migration'
        ? '\n\n⚠️ Le stock compté n’a PAS été repris comme stock initial (mise à jour de la base requise).'
        : report.statut === 'erreur'
          ? '\n\n⚠️ Le stock compté n’a pas pu être repris comme stock initial.'
          : report.cible === 'ouvert'
            ? '\n\n📦 Le stock compté devient le stock initial de l’inventaire en cours.'
            : '\n\n📦 Le stock compté servira de stock initial au prochain inventaire.'

    // Seuil atteint → proposition de demande d'explication à la direction
    if (ratio >= SEUIL_ECART) {
      const proposes = await proposerDemandeExplication(avecEcart, lignes.length, pct, date)
      setSaving(false)
      Alert.alert(
        '⚠️ Écarts importants',
        `${avecEcart.length}/${lignes.length} produits comptés présentent un écart (${pct}%).\n\n` +
        (proposes
          ? `📨 Demande d'explication proposée à la direction (manager, RH, directeur), qui décidera de l'envoyer et à qui.`
            + (proposes.length ? ` Personnes proposées : ${proposes.join(', ')}.` : '')
          : "⚠️ La proposition de demande d'explication n'a pas pu être enregistrée. Prévenez le manager.") +
        msgReport + msgDeduc
      )
    } else {
      setSaving(false)
      Alert.alert(
        '✅ Comptage enregistré',
        `${avecEcart.length}/${lignes.length} produits en écart (${pct}%). En dessous du seuil de 30 % — aucune demande envoyée.${msgReport}${msgDeduc}`
      )
    }
    setComptes({})
    setExplications({})
  }

  /**
   * Proposition de demande d'explication (seuil d'écarts atteint), table
   * demandes_explication en « en_attente_acceptation » : une ligne par personne
   * concernée — gérant, caissier en poste, caissier du shift précédent —
   * insérées d'un seul coup (même created_at) pour que la direction les voie
   * comme UNE proposition (lib/demandes.js › regrouperPropositions). Elle coche
   * qui doit la recevoir, en ajoute, ou n'envoie rien.
   * @returns {string[]|null} noms proposés ([] = aucune personne identifiée), null si échec
   */
  async function proposerDemandeExplication(avecEcart, nbComptes, pct, date) {
    // Destinataires : les caissiers identifiés + le gérant du restaurant.
    const destinataires = responsables.map(r => ({
      nom: r.caissier_nom,
      role: r.role_dans_ecart === 'en_poste' ? 'caissier en poste' : 'caissier du shift précédent',
    }))
    const { data: gerants } = await supabase
      .from('utilisateurs').select('nom')
      .eq('restaurant_id', resto.id).eq('role', 'gerant').eq('actif', true)
    ;(gerants || []).forEach(g => {
      if (g.nom && !destinataires.some(d => d.nom === g.nom)) {
        destinataires.push({ nom: g.nom, role: 'gérant' })
      }
    })
    if (destinataires.length === 0 && refInfo?.caissierNom) {
      destinataires.push({ nom: refInfo.caissierNom, role: 'caissier' })
    }
    // Personne n'est identifié : la proposition part quand même, la direction
    // désignera elle-même le travailleur.
    if (destinataires.length === 0) destinataires.push({ nom: null, role: 'à désigner' })

    const liste = avecEcart
      .map(l => `• ${l.produit_nom} : réel ${l.stock_reel}, compté ${l.stock_compte} (écart ${l.ecart > 0 ? '+' : ''}${l.ecart})`)
      .join('\n')
    const lignesDemande = []
    for (const dest of destinataires) {
      // Le destinataire est un utilisateur : on le relie au travailleur
      // homonyme s'il existe, pour que la demande arrive sur sa fiche.
      let travailleurId = null, travailleurPoste = null
      if (dest.nom) {
        const { data: trav } = await supabase
          .from('travailleurs').select('id, poste')
          .eq('restaurant_id', resto.id).ilike('nom', dest.nom).limit(1)
        if (trav && trav.length) { travailleurId = trav[0].id; travailleurPoste = trav[0].poste || null }
      }

      const description =
        `Comptage du vérificateur (${userNom || 'Vérificateur'}) le ${date} : ` +
        `${avecEcart.length}/${nbComptes} produits comptés présentent un écart (${pct}%).\n\n` +
        `Vous êtes concerné en tant que ${dest.role}.\n\n` +
        `Produits concernés :\n${liste}\n\nMerci de justifier ces écarts.`

      lignesDemande.push({
        restaurant_id: resto.id,
        travailleur_id: travailleurId,
        travailleur_nom: dest.nom,
        travailleur_poste: travailleurPoste,
        motif: `Écarts de stock au comptage (${pct}%) — ${dest.role}`,
        description,
        // En attente de la décision de la direction. cree_par_role fixé à
        // 'verificateur' : c'est lui qui la range dans « Reçues » et la cache au gérant.
        statut: 'en_attente_acceptation',
        numero: 1,
        cree_par_id: userId || null,
        cree_par_nom: userNom || roleActif || 'Vérificateur',
        cree_par_role: 'verificateur',
      })
    }

    // Un seul INSERT : toutes les lignes partagent le même created_at.
    const { error } = await supabase.from('demandes_explication').insert(lignesDemande)
    if (error) return null

    const noms = destinataires.map(d => d.nom).filter(Boolean)
    creerNotification({
      type: 'explication_nouvelle',
      titre: "Demande d'explication à décider",
      message: `📨 ${resto.nom} · écarts de stock ${pct}% · proposés : ${noms.join(', ') || 'personne identifiée'} · envoyer ou non ?`,
      restaurant_id: resto.id,
      cible_role: ['rh', 'directeur', 'manager'],
      created_by: userId || null,
      screen: 'demandes-explication-admin',
    }).catch(() => {})
    return noms
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={seDeconnecter}>
          <Text style={styles.back}>⎋ Déconnexion</Text>
        </TouchableOpacity>
        <View>
          <Text style={styles.headerTitre}>Vérification du stock</Text>
          <Text style={styles.headerSub}>Comptage physique</Text>
        </View>
        <View style={{ width: 70 }} />
      </View>

      {/* Onglets */}
      <View style={styles.tabBar}>
        <TouchableOpacity style={[styles.tabBtn, tab === 'comptage' && styles.tabBtnActive]} onPress={() => setTab('comptage')}>
          <Text style={[styles.tabTxt, tab === 'comptage' && styles.tabTxtActive]}>📝 Comptage</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tabBtn, tab === 'recap' && styles.tabBtnActive]} onPress={() => setTab('recap')}>
          <Text style={[styles.tabTxt, tab === 'recap' && styles.tabTxtActive]}>🗒️ Récap du jour</Text>
        </TouchableOpacity>
      </View>

      {tab === 'recap' ? (
        <RecapVerifications colors={colors} />
      ) : (
        <>
      {/* Sélection restaurant */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[styles.restoBar, { flexGrow: 0 }]}>
        {restaurants.map(r => (
          <TouchableOpacity
            key={r.id}
            style={[styles.restoBtn, resto?.id === r.id && styles.restoBtnActive]}
            onPress={() => changerResto(r)}
          >
            <Text style={[styles.restoTxt, resto?.id === r.id && styles.restoTxtActive]}>{r.nom}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {refInfo?.date && (
        <Text style={styles.refTxt}>
          Référence : dernier shift validé
          {refInfo.heureDebut && refInfo.heureFin ? ` ${refInfo.heureDebut.slice(0, 5)}–${refInfo.heureFin.slice(0, 5)}` : (refInfo.typeShift ? ` (${refInfo.typeShift})` : '')}
          {' '}du {refInfo.date}
          {refInfo.caissierNom ? ` — caissier ${refInfo.caissierNom}` : ''}
        </Text>
      )}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingTxt}>Chargement du stock…</Text>
        </View>
      ) : produits.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>📦</Text>
          <Text style={styles.emptyTxt}>Aucun stock enregistré</Text>
          <Text style={styles.emptySub}>Ce restaurant n&apos;a pas d&apos;inventaire récent à vérifier.</Text>
        </View>
      ) : (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <View style={styles.tableHead}>
            <Text style={[styles.colProduit, styles.thTxt]}>Produit</Text>
            <Text style={[styles.colNum, styles.thTxt]}>Réel</Text>
            <Text style={[styles.colNum, styles.thTxt]}>Compté</Text>
            <Text style={[styles.colNum, styles.thTxt]}>Écart</Text>
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 140 }} keyboardShouldPersistTaps="handled">
            {produits.map(p => {
              const e = ecartDe(p)
              const enEcart = e != null && Math.abs(e) > 0.001
              return (
                <View key={p.produit_id} style={styles.rowWrap}>
                  <View style={styles.row}>
                  <Text style={styles.colProduit} numberOfLines={2}>{p.produit_nom}</Text>
                  <Text style={[styles.colNum, styles.reelTxt]}>{p.stock_reel}</Text>
                  <TextInput
                    style={[styles.colNum, styles.input]}
                    value={comptes[p.produit_id] ?? ''}
                    onChangeText={v => setCompte(p.produit_id, v)}
                    placeholder="—"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="numeric"
                  />
                  <Text style={[styles.colNum, styles.ecartTxt, enEcart && styles.ecartActif]}>
                    {e == null ? '—' : (e > 0 ? '+' : '') + e}
                  </Text>
                  </View>
                  {enEcart && (
                    <View style={styles.explBox}>
                      <Text style={styles.explMontant}>
                        💰 {Math.round(Math.abs(e) * prixProduit(p.produit_id)).toLocaleString('fr-FR')} F
                        {responsables.length > 0
                          ? ` · ${responsables.length} caissier(s) · ${Math.round(Math.abs(e) * prixProduit(p.produit_id) / responsables.length).toLocaleString('fr-FR')} F chacun`
                          : ' · aucun caissier identifié'}
                      </Text>
                      <TextInput
                        style={styles.explInput}
                        value={explications[p.produit_id] ?? ''}
                        onChangeText={v => setExplications(prev => ({ ...prev, [p.produit_id]: v }))}
                        placeholder="Explication donnée par le caissier (facultatif)"
                        placeholderTextColor={colors.textMuted}
                        multiline
                      />
                    </View>
                  )}
                </View>
              )
            })}
          </ScrollView>

          {/* Barre récap + validation */}
          <View style={styles.footer}>
            <View style={styles.recapBox}>
              <Text style={styles.recapTxt}>
                {recap.comptees} compté(s) · {recap.avecEcart} écart(s)
              </Text>
              <Text style={[styles.recapPct, recap.pct >= 30 && styles.recapPctAlert]}>
                {recap.pct}%{recap.pct >= 30 ? ' ⚠️' : ''}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.validerBtn, saving && { opacity: 0.6 }]}
              onPress={valider}
              disabled={saving}
            >
              {saving
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.validerTxt}>✅ Valider le comptage</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      )}
        </>
      )}
    </SafeAreaView>
  )
}

function makeStyles(colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    header: {
      backgroundColor: colors.headerBg, padding: 16,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    },
    back: { fontSize: 15, color: colors.primaryText, fontWeight: '500' },
    headerTitre: { fontSize: 16, fontWeight: '600', color: colors.surface, textAlign: 'center' },
    headerSub: { fontSize: 11, color: colors.primaryText, textAlign: 'center' },
    tabBar: { flexDirection: 'row', backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
    tabBtn: { flex: 1, paddingVertical: 12, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
    tabBtnActive: { borderBottomColor: colors.primary },
    tabTxt: { fontSize: 13, color: colors.textMuted, fontWeight: '500' },
    tabTxtActive: { color: colors.primary, fontWeight: '700' },
    restoBar: { backgroundColor: colors.surface, maxHeight: 46, borderBottomWidth: 0.5, borderBottomColor: '#eee', flexGrow: 0 },
    restoBtn: { paddingHorizontal: 14, paddingVertical: 12 },
    restoBtnActive: { borderBottomWidth: 2, borderBottomColor: colors.primary },
    restoTxt: { fontSize: 12, color: colors.textMuted },
    restoTxtActive: { color: colors.primary, fontWeight: '600' },
    refTxt: { fontSize: 11, color: colors.textMuted, paddingHorizontal: 14, paddingVertical: 8, fontStyle: 'italic' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
    loadingTxt: { marginTop: 12, color: colors.textMuted },
    emptyIcon: { fontSize: 40, marginBottom: 10 },
    emptyTxt: { fontSize: 16, fontWeight: '600', color: colors.text },
    emptySub: { fontSize: 13, color: colors.textMuted, textAlign: 'center', marginTop: 6 },
    tableHead: {
      flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10,
      backgroundColor: colors.surfaceAlt, borderBottomWidth: 1, borderBottomColor: colors.border,
    },
    thTxt: { fontSize: 11, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase' },
    row: {
      flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8,
      borderBottomWidth: 0.5, borderBottomColor: colors.border, backgroundColor: colors.surface,
    },
    colProduit: { flex: 1, fontSize: 13, color: colors.text, paddingRight: 6 },
    colNum: { width: 64, textAlign: 'center', fontSize: 14 },
    reelTxt: { color: colors.textMuted, fontWeight: '500' },
    input: {
      borderWidth: 1, borderColor: colors.primary, borderRadius: 8, paddingVertical: 6,
      color: colors.text, backgroundColor: colors.bg,
    },
    rowWrap: { borderBottomWidth: 1, borderBottomColor: colors.borderLight },
    explBox: { paddingHorizontal: 12, paddingBottom: 10, paddingTop: 2, backgroundColor: colors.surfaceAlt },
    explMontant: { fontSize: 11, fontWeight: '700', color: '#A32D2D', marginBottom: 5 },
    explInput: { borderWidth: 1, borderColor: colors.inputBorder, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, fontSize: 12, color: colors.text, backgroundColor: colors.inputBg, minHeight: 34 },
    ecartTxt: { color: colors.textMuted, fontWeight: '600' },
    ecartActif: { color: '#A32D2D', fontWeight: '800' },
    footer: {
      position: 'absolute', left: 0, right: 0, bottom: 0,
      backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border,
      padding: 12, gap: 10,
    },
    recapBox: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    recapTxt: { fontSize: 13, color: colors.text, fontWeight: '500' },
    recapPct: { fontSize: 18, fontWeight: '800', color: colors.textMuted },
    recapPctAlert: { color: '#A32D2D' },
    validerBtn: { backgroundColor: '#3B6D11', borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
    validerTxt: { fontSize: 15, fontWeight: '700', color: '#fff' },
  })
}
