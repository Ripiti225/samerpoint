import { retour } from '../lib/navigation'
import { useEffect, useState } from 'react'
import { Alert, Platform, SafeAreaView, ScrollView } from 'react-native'
import OngletDepenses from '../components/deductions/OngletDepenses'
import OngletFournisseurs from '../components/deductions/OngletFournisseurs'
import OngletPaies from '../components/deductions/OngletPaies'
import {
  Bandeau, BarreBas, BoutonDegrade, Choix, EnTete, Feuille, Onglets, Vide, contexteJour, useStyleChaleureux,
} from '../components/ui/StyleChaleureux'
import { useApp } from '../context/AppContext'
import { facturesGerantSansPhoto } from '../lib/creditsFournisseurs'
import { chargerDerniersRestes } from '../lib/derniersRestesFournisseurs'
import { appliquerFacturesMensuelles } from '../lib/facturesMensuelles'
import { logErreur } from '../lib/logErreur'
import { manquantsDeductions, resumeDeductions } from '../lib/manquantsSaisie'
import { supabase } from '../lib/supabase'
import { usePhoto } from '../lib/usePhoto'

export default function DeductionsGerantScreen() {
  const {
    restaurantId, restaurantNom, pointId, userId, userNom, dateJour,
    depensesGerantCaisse, setDepensesGerantCaisse,
    fournisseursGerantCaisse, setFournisseursGerantCaisse,
    paiesGerantCaisse, setPaiesGerantCaisse,
    totalDepensesGerantCaisse,
  } = useApp()

  // pointId peut être null si le gérant n'a pas encore sélectionné de journée

  const { prendrePhoto, choisirPhoto } = usePhoto()
  const { p, styles, isDark } = useStyleChaleureux()

  const [onglet, setOnglet] = useState('fournisseurs')
  const [fournOuverts, setFournOuverts] = useState(new Set())
  const [fournisseursList, setFournisseursList] = useState([])
  const [travailleurs, setTravailleurs] = useState([])
  const [uploading, setUploading] = useState(false)
  const [chargement, setChargement] = useState(false)
  const [modalPaie, setModalPaie] = useState(false)
  const [paieEditIndex, setPaieEditIndex] = useState(null)
  const [saveStatus, setSaveStatus] = useState(null) // null | 'saving' | 'ok' | 'error'

  useEffect(() => {
    if (restaurantId) chargerDonnees()
  }, [restaurantId])

  useEffect(() => {
    if (pointId) chargerBrouillon()
  }, [pointId])

  async function chargerDonnees() {
    setChargement(true)
    // Avant toute lecture : la facture mensuelle du 1er doit être dans la chaîne.
    await appliquerFacturesMensuelles(supabase)
    const [{ data: fours }, { data: travs }] = await Promise.all([
      supabase.from('fournisseurs').select('id, nom').eq('restaurant_id', restaurantId).order('nom'),
      supabase.from('travailleurs').select('id, nom, poste').eq('restaurant_id', restaurantId).order('nom'),
    ])

    setTravailleurs(travs || [])

    const fournIds = (fours || []).map(f => f.id)
    const prevMap = {}
    const caissierMap = {}

    if (fournIds.length > 0) {
      // Source de vérité pour le crédit du jour = reste de la transaction la plus récente
      // par DATE DE JOURNÉE (points.date), en excluant le point courant.
      // Priorité quand même date : gerant_caissier > gerant > caissier
      // Cela évite le double-comptage : credit_actuel est déjà à jour après saveTransactionsFournisseurs,
      // donc on ne l'utilise PAS directement — on repart du point précédent.
      // Lecture paginée : non paginée, la requête était coupée à 1 000 lignes et
      // les fournisseurs hors de la page repartaient avec un crédit à 0.
      Object.assign(prevMap, await chargerDerniersRestes(supabase, fournIds, pointId))

      // Factures caissier du point courant (s'ajoutent au crédit de la veille
      // car le gérant caissier paye l'ensemble : dettes anciennes + factures caissier du jour)
      if (pointId) {
        const { data: txCaissier } = await supabase
          .from('transactions_fournisseurs')
          .select('fournisseur_id, facture, paye')
          .eq('point_id', pointId)
          .eq('saisi_par', 'caissier')
        ;(txCaissier || []).forEach(tx => {
          const net = (tx.facture || 0) - (tx.paye || 0)
          if (net > 0) caissierMap[tx.fournisseur_id] = net
        })
      }
    }

    setFournisseursList((fours || []).map(f => ({
      ...f,
      // credit_veille = reste du point précédent (par date) + factures caissier aujourd'hui
      // NE PAS utiliser credit_actuel : il est déjà mis à jour par le shift caissier,
      // l'ajouter à caissierMap provoquerait un double-comptage.
      // NE PAS retirer fournisseurs.montant_cotise : retiré ici à chaque journée,
      // il s'accumulait dans le reste (KMS, Cotisation salaire : 7 M en 35 jours).
      // L'avance cotisée est désormais une écriture unique (Paramètres).
      credit_veille: (prevMap[f.id]?.reste ?? 0) + (caissierMap[f.id] || 0),
      caissier_facture: caissierMap[f.id] || 0,
    })))
    setChargement(false)
  }

  async function chargerBrouillon() {
    try {
      const { data: point } = await supabase
        .from('points')
        .select('valide, draft_gerant')
        .eq('id', pointId)
        .maybeSingle()
      if (!point || point.valide) return
      const draft = point.draft_gerant
      if (!draft) return
      if (draft.depenses) setDepensesGerantCaisse(draft.depenses)
      if (draft.fournisseurs) setFournisseursGerantCaisse(draft.fournisseurs)
      if (draft.paies) setPaiesGerantCaisse(draft.paies)
    } catch (_) {}
  }

  async function sauvegarder() {
    if (uploading || saveStatus === 'saving') return
    if (!pointId) {
      Alert.alert('Aucun point actif', 'Sélectionnez une date depuis l\'accueil avant de sauvegarder.')
      return
    }
    const sansPhoto = facturesGerantSansPhoto(fournisseursGerantCaisse)
    if (sansPhoto.length > 0) {
      setOnglet('fournisseurs')
      setFournOuverts(prev => new Set([...prev, ...sansPhoto]))
      Alert.alert('Photo manquante', `Ajoutez une photo de la facture pour :\n${sansPhoto.map(id => `• ${fournisseursGerantCaisse[id]?.nom || fournisseursList.find(f => f.id === id)?.nom || 'Fournisseur'}`).join('\n')}`)
      return
    }
    setSaveStatus('saving')
    try {
      const { error } = await supabase
        .from('points')
        .update({
          draft_gerant: {
            depenses: depensesGerantCaisse,
            fournisseurs: fournisseursGerantCaisse,
            paies: paiesGerantCaisse,
          }
        })
        .eq('id', pointId)
      if (error) throw error

      // Mettre à jour credit_actuel + historique pour chaque fournisseur gérant
      const today = dateJour || new Date().toISOString().split('T')[0]
      const motifPrefix = `deduction_gerant|${today}|`

      for (const [fournId, data] of Object.entries(fournisseursGerantCaisse)) {
        const paye = parseFloat(data?.paye) || 0
        const facture = parseFloat(data?.montant_facture) || 0
        if (paye === 0 && facture === 0) continue

        const creditVeille = data?.credit_veille != null
          ? parseFloat(data.credit_veille) || 0
          : (fournisseursList.find(f => f.id === fournId)?.credit_veille ?? 0)
        const nouveauCredit = creditVeille + facture - paye

        // Doublon caissier : un caissier a-t-il déjà saisi cette facture aujourd'hui ?
        // Contrôle effectué AVANT toute écriture pour éviter un état partiel
        // (crédit/historique modifiés sans transaction correspondante).
        if (facture > 0) {
          const { data: doublonCaissier } = await supabase
            .from('transactions_fournisseurs')
            .select('caissier_nom, saisi_par')
            .eq('point_id', pointId)
            .eq('fournisseur_id', fournId)
            .eq('facture', facture)
            .neq('saisi_par', 'gerant_caissier')
            .limit(1)
          if (doublonCaissier?.length > 0) {
            const nomFourn = data?.nom || fournisseursList.find(f => f.id === fournId)?.nom || 'ce fournisseur'
            const parQui = doublonCaissier[0].caissier_nom ? ` par ${doublonCaissier[0].caissier_nom}` : ''
            const confirmeDoublon = await new Promise(resolve =>
              Alert.alert(
                '🚫 Facture en double',
                `Une facture de ${fmt(facture)} pour "${nomFourn}" a déjà été enregistrée aujourd'hui${parQui}.\n\nEnregistrer quand même ?`,
                [
                  { text: 'Annuler', style: 'cancel', onPress: () => resolve(false) },
                  { text: 'Enregistrer quand même', style: 'destructive', onPress: () => resolve(true) },
                ]
              )
            )
            if (!confirmeDoublon) continue
          }
        }

        // Vérifier si une entrée existe déjà pour ce fournisseur aujourd'hui (filtré par restaurant)
        const { data: existant } = await supabase
          .from('historique_credit_fournisseurs')
          .select('id')
          .eq('fournisseur_id', fournId)
          .eq('restaurant_id', restaurantId)
          .like('motif', `${motifPrefix}%`)
          .limit(1)

        if (existant && existant.length > 0) {
          // Demander confirmation avant d'écraser
          const nomFourn = data?.nom || fournisseursList.find(f => f.id === fournId)?.nom || 'ce fournisseur'
          const confirme = await new Promise(resolve =>
            Alert.alert(
              '⚠️ Facture déjà enregistrée',
              `La facture de ${nomFourn} a déjà été enregistrée aujourd'hui.\n\nVoulez-vous mettre à jour avec les nouveaux montants ?`,
              [
                { text: 'Annuler', style: 'cancel', onPress: () => resolve(false) },
                { text: 'Mettre à jour', style: 'destructive', onPress: () => resolve(true) },
              ]
            )
          )
          if (!confirme) continue
          // Supprimer l'ancienne entrée avant d'insérer la nouvelle
          await supabase.from('historique_credit_fournisseurs')
            .delete()
            .eq('fournisseur_id', fournId)
            .eq('restaurant_id', restaurantId)
            .like('motif', `${motifPrefix}%`)
        }

        await supabase.from('fournisseurs').update({ credit_actuel: nouveauCredit }).eq('id', fournId)
        await supabase.from('historique_credit_fournisseurs').insert({
          fournisseur_id: fournId,
          restaurant_id: restaurantId,
          point_id: pointId,
          source: 'deduction_gerant',
          ancien_credit: creditVeille,
          nouveau_credit: nouveauCredit,
          facture,
          paye,
          photo_url: data?.photoUri || null,
          motif: `${motifPrefix}facture ${facture} FCFA, payé ${paye} FCFA`,
          modified_by: userId || null,
        })
        // Enregistrer dans transactions_fournisseurs (source de vérité crédit veille)
        // ⚠️ NE PAS inclure modified_by : cette colonne n'existe pas sur cette table
        // et faisait échouer silencieusement TOUTES les insertions de déduction gérant.
        await supabase.from('transactions_fournisseurs')
          .delete()
          .eq('point_id', pointId)
          .eq('fournisseur_id', fournId)
          .eq('saisi_par', 'gerant_caissier')
        const { error: txErr } = await supabase.from('transactions_fournisseurs').insert({
          point_id: pointId,
          fournisseur_id: fournId,
          fournisseur_nom: fournisseursList.find(f => f.id === fournId)?.nom || null,
          source: 'deduction_gerant',
          restaurant_id: restaurantId,
          facture,
          paye,
          reste: nouveauCredit,
          photo_url: data?.photoUri || null,
          saisi_par: 'gerant_caissier',
          caissier_nom: userNom || null,
        })
        if (txErr) throw txErr
        // Synchroniser fournisseurs_restaurants si la table a un credit_actuel.
        // ⚠️ NE JAMAIS écrire `.catch()` sur une chaîne supabase : un query
        // builder est un « thenable » qui n'expose que `.then` — `.catch` y vaut
        // undefined et l'appeler lève une TypeError. C'est ce qui interrompait la
        // boucle ici : seul le PREMIER fournisseur était enregistré, les suivants
        // étaient perdus sans message. Avec `await` + `{ error }`, l'échec est
        // retourné au lieu d'être lancé, et l'on peut vraiment l'ignorer.
        const { error: syncErr } = await supabase.from('fournisseurs_restaurants')
          .update({ credit_actuel: nouveauCredit })
          .eq('fournisseur_id', fournId)
          .eq('restaurant_id', restaurantId)
        if (syncErr) {
          console.warn('[deductions-gerant] sync fournisseurs_restaurants ignorée :', syncErr.message)
        }
      }

      // Rafraîchir l'affichage des crédits après sauvegarde
      await chargerDonnees()
      setSaveStatus('ok')
    } catch (e) {
      // Journaliser la cause : avaler l'exception avait masqué pendant des mois
      // le plantage de la synchronisation fournisseurs_restaurants ci-dessus.
      logErreur('deductionsGerant.sauvegarder', e, { pointId, restaurantId })
      setSaveStatus('error')
    } finally {
      setTimeout(() => setSaveStatus(null), 3000)
    }
  }

  function ouvrirSelecteurTravailleur(index) {
    setPaieEditIndex(index)
    setModalPaie(true)
  }

  function selectionnerTravailleur(trav) {
    setPaiesGerantCaisse(prev => prev.map((l, i) =>
      i === paieEditIndex ? { ...l, travailleur_id: trav.id, travailleur_nom: trav.nom } : l
    ))
    setModalPaie(false)
    setPaieEditIndex(null)
  }

  function basculerFournisseur(id) {
    setFournOuverts(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function ajouterLigneDep(cat) {
    setDepensesGerantCaisse(prev => ({
      ...prev,
      [cat]: [...(prev[cat] || []), { id: Date.now().toString(), description: '', montant: '', photoUri: null }]
    }))
  }

  function supprimerLigneDep(cat, index) {
    setDepensesGerantCaisse(prev => ({
      ...prev,
      [cat]: (prev[cat] || []).filter((_, i) => i !== index)
    }))
  }

  function updateLigneDep(cat, index, champ, valeur) {
    setDepensesGerantCaisse(prev => ({
      ...prev,
      [cat]: (prev[cat] || []).map((l, i) => i === index ? { ...l, [champ]: valeur } : l)
    }))
  }

  function updateFournisseurGerant(fourId, fourNom, champ, valeur) {
    const fourn = fournisseursList.find(f => f.id === fourId)
    setFournisseursGerantCaisse(prev => ({
      ...prev,
      [fourId]: {
        ...prev[fourId],
        nom: fourNom,
        [champ]: valeur,
        // Après le spread pour ne pas être écrasé par prev[fourId].credit_veille = undefined
        credit_veille: prev[fourId]?.credit_veille ?? (fourn?.credit_veille ?? 0),
      }
    }))
  }

  function getCreditVeille(four) {
    const data = fournisseursGerantCaisse[four.id]
    if (data?.credit_veille !== undefined) return parseFloat(data.credit_veille) || 0
    return four.credit_veille || 0
  }

  function gererPhoto(setter, dossier) {
    async function executer(source) {
      setUploading(true)
      try {
        const url = source === 'camera'
          ? await prendrePhoto(dossier)
          : await choisirPhoto(dossier)
        if (url) setter(url)
      } finally {
        setUploading(false)
      }
    }

    if (Platform.OS === 'web') {
      executer('gallery')
    } else {
      Alert.alert(
        'Ajouter une photo',
        'Choisissez la source',
        [
          { text: 'Annuler', style: 'cancel' },
          { text: '📷 Caméra', onPress: () => executer('camera') },
          { text: '🖼 Galerie', onPress: () => executer('gallery') },
        ]
      )
    }
  }

  function fmt(n) { return Math.round(n).toLocaleString('fr-FR') + ' FCFA' }

  const total = totalDepensesGerantCaisse()
  const resume = resumeDeductions(depensesGerantCaisse, fournisseursGerantCaisse, paiesGerantCaisse)
  const detail = r => (r.n > 0 ? `${r.n} · ${Math.round(r.total).toLocaleString('fr-FR')}` : '—')
  const onglets = [
    { cle: 'fournisseurs', label: 'Fournisseurs', detail: detail(resume.fournisseurs) },
    { cle: 'depenses', label: 'Dépenses', detail: detail(resume.depenses) },
    { cle: 'paies', label: 'Paies', detail: detail(resume.paies) },
  ]
  const manquants = manquantsDeductions(
    fournisseursGerantCaisse,
    id => fournisseursList.find(f => f.id === id)?.nom || 'Fournisseur',
  )
  const libelleBouton = saveStatus === 'ok' ? '✅ Sauvegardé' : saveStatus === 'error' ? '❌ Erreur — Réessayez' : 'Sauvegarder'
  const totalTexte = total > 0 ? `− ${fmt(total)}` : fmt(0)

  return (
    <SafeAreaView style={styles.ecran}>
      <EnTete titre="Déductions gérant" sous="Prélevées sur les espèces de caisse" chiffre={totalTexte}
        contexte={contexteJour(restaurantNom, dateJour)} onRetour={() => retour()} flottant={!isDark} />
      <Onglets elements={onglets} actif={onglet} onChoisir={setOnglet} flottant={!isDark} />
      {uploading ? <Bandeau chargement texte="Envoi de la photo en cours…" /> : null}

      <ScrollView style={styles.corps} contentContainerStyle={styles.corpsContenu}
        showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {onglet === 'fournisseurs' ? (
          <OngletFournisseurs
            fournisseursList={fournisseursList}
            fournisseursGerantCaisse={fournisseursGerantCaisse}
            chargement={chargement}
            ouverts={fournOuverts}
            basculer={basculerFournisseur}
            getCreditVeille={getCreditVeille}
            majFournisseur={updateFournisseurGerant}
            onPhoto={four => gererPhoto(url => updateFournisseurGerant(four.id, four.nom, 'photoUri', url), 'depenses-gerant')}
            uploading={uploading}
            fmt={fmt}
          />
        ) : null}
        {onglet === 'depenses' ? (
          <OngletDepenses depenses={depensesGerantCaisse} ajouter={ajouterLigneDep}
            supprimer={supprimerLigneDep} maj={updateLigneDep} fmt={fmt} />
        ) : null}
        {onglet === 'paies' ? (
          <OngletPaies
            paies={paiesGerantCaisse}
            choisirTravailleur={ouvrirSelecteurTravailleur}
            majMontant={(i, v) => setPaiesGerantCaisse(prev => prev.map((l, j) => (j === i ? { ...l, montant: v } : l)))}
            supprimer={i => setPaiesGerantCaisse(prev => prev.filter((_, j) => j !== i))}
            ajouter={() => setPaiesGerantCaisse(prev => [
              ...prev,
              { id: Date.now().toString(), travailleur_id: null, travailleur_nom: '', montant: '' },
            ])}
          />
        ) : null}
      </ScrollView>

      <BarreBas libelle="Total prélevé" valeur={totalTexte} couleurValeur={total > 0 ? p.erreur : undefined} manquants={manquants}>
        <BoutonDegrade label={libelleBouton} onPress={sauvegarder} chargement={saveStatus === 'saving'}
          disabled={uploading} attenue={manquants.length > 0} />
      </BarreBas>

      <Feuille visible={modalPaie} titre="Choisir un travailleur" onFermer={() => setModalPaie(false)}>
        {travailleurs.length === 0 ? (
          <Vide texte="Aucun travailleur enregistré pour ce restaurant" />
        ) : travailleurs.map(trav => {
          const deja = paiesGerantCaisse.some((l, i) => i !== paieEditIndex && l.travailleur_id === trav.id)
          return (
            <Choix key={trav.id} nom={trav.nom} sous={trav.poste} desactive={deja}
              etiquette={deja ? 'Déjà payé' : null} onPress={() => selectionnerTravailleur(trav)} />
          )
        })}
      </Feuille>
    </SafeAreaView>
  )
}
