// ──────────────────────────────────────────────────────────────────────────────
// Générer un contrat (RH) — ou corriger un contrat refusé par le travailleur.
//
// Ordre de raisonnement : quel contrat, pour combien de temps, quels montants,
// puis ce qui manque sur la fiche. Le bouton reste grisé tant que le modèle ne
// peut pas être rempli entièrement : un contrat avec des trous ne part pas.
//
// Dates : un stage commence TOUJOURS à la date d'embauche (règle de
// l'utilisateur, 14/10/2026) ; un CDD/CDI commence le lendemain du contrat
// précédent, sinon à l'embauche. La fin découle toujours de la durée : le texte
// du contrat cite les deux, ils ne peuvent pas se contredire.
// ──────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, Text, TouchableOpacity, View } from 'react-native'

import ApercuContrat from './ApercuContrat'
import ChampDate from '../ChampDate'
import { debutParDefaut } from '../FormulaireContrat'
import { Bouton, Champ, Feuille, Info, Libelle, Puces, teinte, useEcranModerne } from '../ui/EcranModerne'
import { baremePour, differeDuBareme, montantsDepuisBareme } from '../../lib/baremes'
import { DUREES_MOIS, TYPES_CONTRAT, calculerDateFin, formatFR, validerDureeLibre } from '../../lib/contrats'
import {
  completerFiche, corrigerContratRefuse, enregistrerBareme, genererContrat, marqueDuResto,
} from '../../lib/contratsSignesDb'
import { champsManquantsContrat, donneesDepuisFiche, marqueContrat } from '../../lib/modelesContrat'
import { CIVILITES, SITUATIONS_FAMILLE } from '../../lib/recrutement'

const LIBELLE_DUREE = { 1: '1 mois', 2: '2 mois', 3: '3 mois', 6: '6 mois', 12: '1 an' }

// Champs de la fiche que le contrat lit, avec leur libellé dans
// champsManquantsContrat (lib/modelesContrat.js).
const CHAMPS_FICHE = [
  { cle: 'civilite', libelle: 'Civilité', choix: CIVILITES.map(c => ({ cle: c, label: c === 'M.' ? 'Monsieur' : 'Madame' })) },
  { cle: 'nom_famille', libelle: 'Nom', placeholder: 'Ex. GBADIE' },
  { cle: 'prenoms', libelle: 'Prénoms', placeholder: 'Ex. Gogre Tanguy' },
  { cle: 'date_naissance', libelle: 'Date de naissance', date: true },
  { cle: 'lieu_naissance', libelle: 'Lieu de naissance', placeholder: 'Ex. Yopougon' },
  { cle: 'nationalite', libelle: 'Nationalité', placeholder: 'Ex. Ivoirienne' },
  { cle: 'situation_famille', libelle: 'Situation de famille', choix: SITUATIONS_FAMILLE.map(s => ({ cle: s, label: s })), facultatif: true },
  { cle: 'cni_numero', libelle: "Pièce d'identité", placeholder: 'N° CNI, ex. CI007879705' },
  { cle: 'nni_numero', libelle: "Pièce d'identité", placeholder: 'NNI (facultatif si CNI)', secondaire: true },
  { cle: 'lieu_residence', libelle: 'Lieu de résidence', placeholder: 'Ex. Yopougon' },
  { cle: 'contact', libelle: 'Téléphone', placeholder: 'Ex. 01 01 35 48 69' },
  { cle: 'poste', libelle: 'Poste', placeholder: 'Ex. Caissier' },
  { cle: 'date_embauche', libelle: 'Date de début', date: true, titre: "Date d'embauche" },
]

// Pour les fiches d'avant (un seul champ `nom`) : « GBADIE Gogre Tanguy » →
// nom GBADIE, prénoms Gogre Tanguy. Une proposition, que la RH vérifie.
function decouperNom(nom) {
  const mots = String(nom || '').trim().split(/\s+/).filter(Boolean)
  return { nom_famille: mots[0] || '', prenoms: mots.slice(1).join(' ') }
}

function demander(titre, message, oui, non) {
  return new Promise(resolve => Alert.alert(titre, message, [
    { text: non, style: 'cancel', onPress: () => resolve(false) },
    { text: oui, onPress: () => resolve(true) },
  ]))
}

export default function FormulaireGeneration({
  visible, travailleur, contratsExistants, contratRefuse = null, demandeId = null, baremes, ctx, onFermer, onGenere,
}) {
  const { styles, colors, accent, principale } = useEcranModerne('orange')
  const [type, setType] = useState('CDD')
  const [duree, setDuree] = useState(3)
  const [dureeLibre, setDureeLibre] = useState('')
  const [dateDebut, setDateDebut] = useState('')
  const [montants, setMontants] = useState({})
  const [fiche, setFiche] = useState({})          // champs de la fiche modifiés ici
  const [ouverts, setOuverts] = useState([])      // champs de fiche affichés
  const [apercu, setApercu] = useState(false)
  const [envoi, setEnvoi] = useState(false)

  const marque = marqueDuResto(travailleur?.restaurants)
  const modele = marqueContrat(marque)
  const trav = { ...(travailleur || {}), ...fiche }

  // Ouverture : type et dates du contrat refusé, sinon CDD par défaut.
  useEffect(() => {
    if (!visible || !travailleur) return
    const d = contratRefuse?.donnees
    const t = contratRefuse?.type || 'CDD'
    setType(t)
    const mois = d?.duree_mois || 3
    setDuree(DUREES_MOIS.includes(mois) ? mois : 'autre')
    setDureeLibre(DUREES_MOIS.includes(mois) ? '' : String(mois))
    setDateDebut(d?.date_debut || debutParDefaut(travailleur, contratsExistants))
    setMontants(d ? { ...d } : montantsDepuisBareme(baremePour(baremes, travailleur.poste, t), t))
    // Fiche d'avant : proposer nom / prénoms découpés depuis `nom`.
    const proposition = !travailleur.nom_famille && !travailleur.prenoms ? decouperNom(travailleur.nom) : {}
    setFiche(proposition)
    setApercu(false)
    const d0 = donneesDepuisFiche({ ...travailleur }, marque, { type: t, duree_mois: mois, date_debut: '2000-01-01', date_fin: '2000-01-02', montants: {} })
    const manque = champsManquantsContrat(t, d0)
    setOuverts(CHAMPS_FICHE.filter(c => manque.includes(c.libelle) || proposition[c.cle] !== undefined).map(c => c.cle))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, travailleur?.id, contratRefuse?.id])

  function changerType(t) {
    setType(t)
    if (!contratRefuse) setMontants(montantsDepuisBareme(baremePour(baremes, trav.poste, t), t))
  }

  const estStage = type === 'Stage'
  const estCDI = type === 'CDI'
  const debut = estStage ? (trav.date_embauche || '') : dateDebut
  const mois = estCDI ? null : (duree === 'autre' ? validerDureeLibre(dureeLibre).mois : duree)
  const fin = !estCDI && mois && debut ? calculerDateFin(debut, mois) : null

  const choix = { type, duree_mois: mois, date_debut: debut, date_fin: fin, montants }
  const donnees = useMemo(() => donneesDepuisFiche(trav, marque, choix),
    [JSON.stringify(trav), marque, JSON.stringify(choix)]) // eslint-disable-line react-hooks/exhaustive-deps
  const manquants = travailleur ? champsManquantsContrat(type, donnees) : []

  const bareme = baremePour(baremes, trav.poste, type)

  async function generer() {
    setEnvoi(true)
    try {
      if (Object.keys(fiche).length) await completerFiche(travailleur.id, fiche)
      if (differeDuBareme(bareme, montants, type)) {
        const retenir = await demander(
          'Retenir ces montants ?',
          `Proposer ces montants pour tous les « ${trav.poste} » (${estStage ? 'stage' : 'CDD et CDI'}) ? Ils resteront modifiables.`,
          'Oui, retenir', 'Non',
        )
        if (retenir) await enregistrerBareme(trav.poste, type, montants).catch(() => {})
      }
      if (contratRefuse) await corrigerContratRefuse(contratRefuse, { travailleur: trav, choix }, ctx)
      else await genererContrat({ travailleur: trav, choix, demandeId }, ctx)
      Alert.alert('Contrat envoyé', `Le gérant de ${travailleur.restaurants?.nom || 'son restaurant'} va le faire signer à ${travailleur.nom}.`)
      onGenere?.()
    } catch (e) {
      Alert.alert('Contrat non envoyé', e.message)
    } finally {
      setEnvoi(false)
    }
  }

  const majMontant = (cle, v) => setMontants(m => ({ ...m, [cle]: v }))
  const champMontant = (cle, libelle, placeholder) => (
    <View style={{ flex: 1, minWidth: 140 }}>
      <Libelle styles={styles}>{libelle}</Libelle>
      <Champ styles={styles} colors={colors} keyboardType="number-pad" placeholder={placeholder}
        value={montants[cle] === null || montants[cle] === undefined ? '' : String(montants[cle])}
        onChangeText={v => majMontant(cle, v.replace(/\D/g, ''))} />
    </View>
  )

  if (!travailleur) return null

  return (
    <Feuille visible={visible} styles={styles} onFermer={onFermer}
      titre={contratRefuse ? 'Corriger le contrat refusé' : 'Générer un contrat'}
      sous={`${travailleur.nom} · ${travailleur.restaurants?.nom || ''}`}>

      {!modele && (
        <Info icone="⚠️" styles={styles} couleur="#C2462B" gras>
          Le modèle de contrat de ce restaurant n&apos;est pas encore prêt (pas de cachet ni de coordonnées). Enregistre un contrat papier en photo à la place.
        </Info>
      )}
      {contratRefuse?.motif_refus ? (
        <Info icone="⛔" styles={styles} couleur="#C2462B">Refusé par le travailleur : {contratRefuse.motif_refus}</Info>
      ) : null}

      <Libelle styles={styles}>Type de contrat</Libelle>
      <Puces styles={styles} actif={type} onChoisir={changerType} elements={TYPES_CONTRAT.map(t => ({ cle: t, label: t }))} />
      {estCDI && (
        <Info icone="⚖️" styles={styles} couleur="#C27C1A">
          Le texte du CDI est dérivé du CDD : faites-le relire par un juriste avant de l&apos;utiliser.
        </Info>
      )}

      {!estCDI && (
        <>
          <Libelle styles={styles}>Durée</Libelle>
          <Puces styles={styles} actif={duree} onChoisir={setDuree}
            elements={[...DUREES_MOIS.map(m => ({ cle: m, label: LIBELLE_DUREE[m] })), { cle: 'autre', label: 'Autre' }]} />
          {duree === 'autre' && (
            <Champ styles={styles} colors={colors} keyboardType="number-pad" placeholder="Nombre de mois (1 à 60)"
              value={dureeLibre} onChangeText={v => setDureeLibre(v.replace(/\D/g, ''))} />
          )}
        </>
      )}

      {estStage ? (
        <Info icone="📅" styles={styles}>
          {trav.date_embauche
            ? `Un stage commence toujours à la date d'embauche : le ${formatFR(trav.date_embauche)}.`
            : "Un stage commence toujours à la date d'embauche : renseigne-la ci-dessous."}
        </Info>
      ) : (
        <ChampDate label="Date de début" valeur={dateDebut} onChange={setDateDebut} couleur={principale} />
      )}
      {fin ? <Info icone="🏁" styles={styles}>Fin du contrat : le {formatFR(fin)}</Info> : null}

      <Text style={[styles.resultat, { marginTop: 14 }]}>Rémunération{bareme ? ' — barème du poste' : ''}</Text>
      {estStage ? (
        <View style={{ flexDirection: 'row' }}>{champMontant('prime_journaliere', 'Prime journalière (F / jour)', 'Ex. 3000')}</View>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          <View style={{ flex: 1, minWidth: 140 }}>
            <Libelle styles={styles}>Catégorie</Libelle>
            <Champ styles={styles} colors={colors} placeholder="Ex. 1" value={String(montants.categorie ?? '')}
              onChangeText={v => majMontant('categorie', v)} />
          </View>
          {champMontant('salaire_categoriel', 'Salaire catégoriel (F)', 'Ex. 75000')}
          {champMontant('prime_tenue', 'Prime de tenue (F)', 'Ex. 3031')}
          {champMontant('indemnite_transport', 'Indemnité de transport (F)', 'Ex. 30000')}
        </View>
      )}

      <Text style={[styles.resultat, { marginTop: 14 }]}>Fiche du travailleur</Text>
      {CHAMPS_FICHE.filter(c => ouverts.includes(c.cle) || (c.secondaire && ouverts.includes('cni_numero'))).map(c => {
        const valeur = trav[c.cle] ?? ''
        const titre = c.titre || (c.secondaire ? 'NNI' : c.libelle)
        if (c.choix) {
          return (
            <View key={c.cle}>
              <Libelle styles={styles}>{titre}</Libelle>
              <Puces styles={styles} actif={valeur} onChoisir={v => setFiche(f => ({ ...f, [c.cle]: v }))} elements={c.choix} />
            </View>
          )
        }
        if (c.date) {
          return <ChampDate key={c.cle} label={titre} valeur={valeur} onChange={v => setFiche(f => ({ ...f, [c.cle]: v }))} couleur={principale} />
        }
        return (
          <View key={c.cle}>
            <Libelle styles={styles}>{titre}</Libelle>
            <Champ styles={styles} colors={colors} value={String(valeur)} placeholder={c.placeholder}
              onChangeText={v => setFiche(f => ({ ...f, [c.cle]: v }))} />
          </View>
        )
      })}
      {ouverts.length < CHAMPS_FICHE.length - 1 && (
        <TouchableOpacity onPress={() => setOuverts(CHAMPS_FICHE.map(c => c.cle))} style={{ paddingVertical: 8 }}>
          <Text style={{ color: accent, fontWeight: '700' }}>✏️ Voir / modifier toute la fiche</Text>
        </TouchableOpacity>
      )}

      {manquants.length > 0 && (
        <View style={{ padding: 12, borderRadius: 12, backgroundColor: teinte('#C2462B', '12'), marginTop: 10 }}>
          <Text style={{ color: '#C2462B', fontWeight: '700' }}>Il manque : {manquants.join(', ')}.</Text>
        </View>
      )}

      <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
        <Bouton flex styles={styles} couleur={accent} variante="contour" label={apercu ? "Masquer l'aperçu" : '👁 Aperçu'}
          onPress={() => setApercu(a => !a)} />
      </View>
      {apercu && <View style={{ marginTop: 12 }}><ApercuContrat donnees={donnees} /></View>}

      <View style={{ height: 14 }} />
      {envoi
        ? <ActivityIndicator size="large" color={accent} />
        : <Bouton grand styles={styles} couleur={principale} variante="plein"
          label={contratRefuse ? 'Renvoyer au gérant' : 'Générer et envoyer au gérant'}
          disabled={manquants.length > 0 || !modele} onPress={generer} />}
    </Feuille>
  )
}
