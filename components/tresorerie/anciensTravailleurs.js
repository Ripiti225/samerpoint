// ──────────────────────────────────────────────────────────────────────────────
// Trésorerie → À payer → Anciens travailleurs : ce qu'on doit aux travailleurs
// partis, une fiche par travailleur, regroupées par restaurant.
// RH et managers créent / modifient ; la direction paie (banque, espèces de la
// trésorerie, coffre) ; le gérant paie en caisse dans ses Déductions.
// Spéc : docs/superpowers/specs/2026-10-12-droits-anciens-travailleurs-design.md
// ──────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, Switch, Text, View } from 'react-native'

import ChampDate from '../ChampDate'
import {
  Bouton, Champ, ChampMontant, Feuille, Hero, HeroCase, ItemIcone, Pastille, Puces, TitreSection,
  styleCategorie, useStylesTreso,
} from './commun'
import { ONGLET_ANCIENS, paiementsDroit, resumeDroitsParResto, sousTitreDepart } from '../../lib/droitsAnciensTravailleurs'
import {
  chargerDroitsAnciens, creerDroitAncien, modifierDroitAncien, remplacerAncienneFiche,
} from '../../lib/droitsAnciensTravailleursDb'
import { MOTIFS_ARCHIVE } from '../../lib/equipe'
import { aujourdhuiISO, fmt, formatDateFR, peut } from '../../lib/tresorerie'
import { chargerComptesTresorerie, payerFournisseurAdminDirection } from '../../lib/tresorerieDb'

const style = styleCategorie(ONGLET_ANCIENS)

export function OngletAnciensTravailleurs({ niveau, user, restaurants = [] }) {
  const { styles, colors } = useStylesTreso()
  const [donnees, setDonnees] = useState(null)
  const [erreur, setErreur] = useState(null)
  const [restantsSeulement, setRestantsSeulement] = useState(true)
  const [edition, setEdition] = useState(null)   // { fiche | null }
  const [detail, setDetail] = useState(null)     // fiche résumée
  const [paiement, setPaiement] = useState(null) // fiche résumée

  const charger = useCallback(async () => {
    setErreur(null)
    try { setDonnees(await chargerDroitsAnciens()) } catch (e) { setErreur(e?.message || 'Chargement impossible.') }
  }, [])
  useEffect(() => { charger() }, [charger])

  const parResto = useMemo(
    () => (donnees ? resumeDroitsParResto(donnees.fiches, donnees.transactions) : {}),
    [donnees],
  )
  const nomResto = id => restaurants.find(r => r.id === id)?.nom || '—'
  const peutSaisir = peut(niveau, 'saisir_anciens')
  const peutPayer = peut(niveau, 'payer')

  if (erreur) return <Text style={styles.vide}>{erreur}</Text>
  if (!donnees) return <ActivityIndicator color={colors.primary} style={{ paddingVertical: 24 }} />

  const groupes = Object.entries(parResto)
    .map(([rid, g]) => ({ rid, ...g, fiches: g.fiches.filter(f => !restantsSeulement || !f.solde) }))
    .filter(g => g.fiches.length)
    .sort((a, b) => nomResto(a.rid).localeCompare(nomResto(b.rid)))
  const total = Object.values(parResto).reduce((s, g) => (
    { du: s.du + g.du, paye: s.paye + g.paye, reste: s.reste + g.reste }), { du: 0, paye: 0, reste: 0 })

  return (
    <>
      <Hero icone={style.icone} titre="Anciens travailleurs · reste à payer" valeur={`${fmt(total.reste)} F`}
        sous="Droits dus aux travailleurs partis, payés par le gérant en caisse ou par la direction">
        <View style={styles.heroCases}>
          <HeroCase label="Dû" couleur="#FDBA74" valeur={fmt(total.du)} />
          <HeroCase label="Déjà payé" couleur="#86EFAC" valeur={fmt(total.paye)} />
        </View>
      </Hero>

      {!groupes.length && (
        <Text style={styles.vide}>{restantsSeulement ? 'Rien à payer aux anciens travailleurs.' : 'Aucun ancien travailleur enregistré.'}</Text>
      )}
      {groupes.map(g => (
        <View key={g.rid} style={styles.carte}>
          <View style={[styles.carteEntete, { marginBottom: 12 }]}>
            <Pastille icone="storefront-outline" couleur={style.couleur} taille={36} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.itemTitre, { fontSize: 16 }]}>{nomResto(g.rid)}</Text>
              <Text style={styles.petit}>{g.fiches.length} ancien{g.fiches.length > 1 ? 's' : ''} travailleur{g.fiches.length > 1 ? 's' : ''}</Text>
            </View>
            <View style={[styles.etatPilule, { backgroundColor: g.reste ? colors.errorLight : colors.successLight }]}>
              <Text style={[styles.etatPiluleTxt, { color: g.reste ? colors.errorDark : colors.successDark }]}>
                {g.reste ? `reste ${fmt(g.reste)}` : 'tout payé'}
              </Text>
            </View>
          </View>
          {g.fiches.map(f => (
            <ItemIcone key={f.id} onPress={() => setDetail(f)}
              icone="account-outline" couleur={f.solde ? colors.success : style.couleur}
              titre={f.nom}
              sous={`${sousTitreDepart(f)} · dû ${fmt(f.du)} · payé ${fmt(f.paye)}${f.nbPaiements > 1 ? ` en ${f.nbPaiements} fois` : ''}`}
              droite={f.solde ? 'Soldé' : `${fmt(f.reste)} F`}
              couleurDroite={f.solde ? colors.success : colors.error}
            />
          ))}
        </View>
      ))}

      <View style={[styles.ligne, { marginTop: 4 }]}>
        <Text style={styles.ligneLabel}>Restants seulement</Text>
        <Switch value={restantsSeulement} onValueChange={setRestantsSeulement}
          trackColor={{ false: colors.border, true: colors.primary }} thumbColor="#fff" />
      </View>

      {peutSaisir && (
        <View style={{ gap: 8, marginTop: 10 }}>
          <Bouton icone="account-plus-outline" titre="Ancien travailleur" onPress={() => setEdition({ fiche: null })} />
        </View>
      )}

      {peutSaisir && donnees.anciennes.length > 0 && (
        <AnciennesFiches fiches={donnees.anciennes} nomResto={nomResto} user={user} apres={charger} />
      )}

      <FeuilleDroit demande={edition} restaurants={restaurants} archives={donnees.archives} user={user}
        onFermer={() => setEdition(null)} apres={charger} />
      <FeuilleDetailDroit fiche={detail} transactions={donnees.transactions} nomResto={nomResto}
        peutSaisir={peutSaisir} peutPayer={peutPayer}
        onFermer={() => setDetail(null)}
        onModifier={f => { setDetail(null); setEdition({ fiche: f }) }}
        onPayer={f => { setDetail(null); setPaiement(f) }} />
      <FeuillePayerDroit fiche={paiement} nomResto={nomResto} user={user}
        onFermer={() => setPaiement(null)} apres={charger} />
    </>
  )
}

// ── Création / modification ─────────────────────────────────────────────────

function FeuilleDroit({ demande, restaurants, archives, user, onFermer, apres }) {
  const { styles } = useStylesTreso()
  const fiche = demande?.fiche || null
  const [restaurantId, setRestaurantId] = useState(null)
  const [travailleurId, setTravailleurId] = useState(null) // null = nom tapé
  const [nom, setNom] = useState('')
  const [departLe, setDepartLe] = useState(aujourdhuiISO())
  const [motif, setMotif] = useState('Démission')
  const [autre, setAutre] = useState('')
  const [montant, setMontant] = useState('')
  const [occupe, setOccupe] = useState(false)

  useEffect(() => {
    if (!demande) return
    const f = demande.fiche
    setRestaurantId(f?.restaurant_id || null)
    setTravailleurId(f?.travailleur_id || null)
    setNom(f?.nom || '')
    setDepartLe(f?.depart_le || aujourdhuiISO())
    const m = f?.depart_motif || 'Démission'
    setMotif(MOTIFS_ARCHIVE.includes(m) ? m : 'Autre')
    setAutre(MOTIFS_ARCHIVE.includes(m) ? '' : m)
    setMontant(f ? String(Math.round(f.du || 0)) : '')
  }, [demande])

  if (!demande) return null
  const archivesResto = archives.filter(t => t.restaurant_id === restaurantId)

  function choisirArchive(id) {
    const t = archives.find(x => x.id === id)
    setTravailleurId(id)
    if (!t) return
    setNom(t.nom || '')
    if (t.archived_at) setDepartLe(String(t.archived_at).slice(0, 10))
    if (t.archive_motif) {
      setMotif(MOTIFS_ARCHIVE.includes(t.archive_motif) ? t.archive_motif : 'Autre')
      setAutre(MOTIFS_ARCHIVE.includes(t.archive_motif) ? '' : t.archive_motif)
    }
  }

  async function enregistrer() {
    const v = parseInt(montant, 10) || 0
    if (!fiche && !restaurantId) { Alert.alert('Restaurant manquant', 'Choisissez le restaurant.'); return }
    if (!nom.trim()) { Alert.alert('Nom manquant', 'Choisissez ou écrivez le nom du travailleur.'); return }
    if (!fiche && v <= 0) { Alert.alert('Montant manquant', 'Saisissez le montant dû au travailleur.'); return }
    const m = motif === 'Autre' ? (autre.trim() || 'Autre') : motif
    setOccupe(true)
    try {
      if (fiche) await modifierDroitAncien(fiche, { nom, departLe, motif: m, montantDu: v }, user)
      else await creerDroitAncien({ restaurantId, nom, travailleurId, departLe, motif: m, montant: v }, user)
      await apres()
      onFermer()
    } catch (e) {
      Alert.alert('Non enregistré', e?.message || 'Réessayez.')
    } finally {
      setOccupe(false)
    }
  }

  return (
    <Feuille visible onFermer={onFermer} titre={fiche ? `Modifier · ${fiche.nom}` : 'Ancien travailleur'}>
      {!fiche && (
        <>
          <Text style={styles.label}>Restaurant</Text>
          <Puces options={restaurants.map(r => ({ valeur: r.id, label: r.nom }))} valeur={restaurantId}
            onChange={v => { setRestaurantId(v); setTravailleurId(null); setNom('') }} />
          {restaurantId && archivesResto.length > 0 && (
            <>
              <Text style={styles.label}>Travailleur archivé</Text>
              <Puces options={[...archivesResto.map(t => ({ valeur: t.id, label: t.nom })), { valeur: null, label: 'Autre nom…' }]}
                valeur={travailleurId} onChange={v => (v ? choisirArchive(v) : (setTravailleurId(null), setNom('')))} />
            </>
          )}
        </>
      )}
      {(fiche || !travailleurId) && (
        <Champ label="Nom du travailleur" value={nom} onChangeText={setNom} placeholder="Ex : Awa Koné" />
      )}
      <ChampDate label="A cessé de travailler le" styleLabel={styles.label} valeur={departLe} onChange={setDepartLe} maxDate={aujourdhuiISO()} />
      <Text style={styles.label}>Motif</Text>
      <Puces options={MOTIFS_ARCHIVE.map(m => ({ valeur: m, label: m }))} valeur={motif} onChange={setMotif} />
      {motif === 'Autre' && <Champ label="Préciser le motif" value={autre} onChangeText={setAutre} placeholder="Ex : Abandon de poste" />}
      <ChampMontant label={fiche ? 'Montant dû au total' : 'Montant dû'} valeur={montant} onChange={setMontant} />
      {fiche && (
        <Text style={[styles.petit, { marginBottom: 10 }]}>
          Changer le montant ajoute une correction ; les paiements déjà faits ne bougent pas.
        </Text>
      )}
      <Bouton titre="Enregistrer" onPress={enregistrer} occupe={occupe} />
    </Feuille>
  )
}

// ── Détail : paiements, puis Payer / Modifier ───────────────────────────────

function FeuilleDetailDroit({ fiche, transactions, nomResto, peutSaisir, peutPayer, onFermer, onModifier, onPayer }) {
  const { styles, colors } = useStylesTreso()
  if (!fiche) return null
  const paiements = paiementsDroit(transactions.filter(t => t.fournisseur_id === fiche.id))
  return (
    <Feuille visible onFermer={onFermer} titre={fiche.nom}>
      <Text style={styles.petit}>{nomResto(fiche.restaurant_id)} · {sousTitreDepart(fiche)}</Text>
      <View style={{ marginVertical: 12 }}>
        {[
          ['Montant dû', fiche.du, colors.text],
          ['Déjà payé', fiche.paye, colors.success],
          ['Reste à payer', Math.max(0, fiche.reste), colors.error],
        ].map(([l, v, c]) => (
          <View key={l} style={styles.ligne}>
            <Text style={styles.ligneLabel}>{l}</Text>
            <Text style={[styles.itemTitre, { color: c }]}>{fmt(v)} F</Text>
          </View>
        ))}
      </View>
      <TitreSection icone="cash-multiple" couleur={style.couleur} titre="Paiements" droite={`${paiements.length}`} />
      {paiements.length === 0
        ? <Text style={styles.vide}>Aucun paiement pour l'instant.</Text>
        : paiements.map(p => (
          <ItemIcone key={p.id} icone={p.par === 'Direction' ? 'bank-outline' : 'cash-register'} couleur={colors.success}
            titre={`${fmt(p.montant)} F`} sous={`${formatDateFR(p.date)} · ${p.par}`} />
        ))}
      <View style={{ gap: 8, marginTop: 12 }}>
        {peutPayer && fiche.reste > 0 && <Bouton icone="cash-fast" titre="Payer (direction)" onPress={() => onPayer(fiche)} />}
        {peutSaisir && <Bouton secondaire icone="pencil-outline" titre="Modifier" onPress={() => onModifier(fiche)} />}
      </View>
      <Text style={[styles.petit, { marginTop: 10 }]}>Le gérant paie en espèces dans Déductions gérant → Admin.</Text>
    </Feuille>
  )
}

// ── Paiement par la direction ───────────────────────────────────────────────

function FeuillePayerDroit({ fiche, nomResto, user, onFermer, apres }) {
  const { styles } = useStylesTreso()
  const [comptes, setComptes] = useState([])
  const [source, setSource] = useState(null)
  const [montant, setMontant] = useState('')
  const [date, setDate] = useState(aujourdhuiISO())
  const [occupe, setOccupe] = useState(false)

  useEffect(() => {
    if (!fiche) return
    setMontant(String(Math.max(0, Math.round(fiche.reste))))
    setDate(aujourdhuiISO())
    setSource(null)
    chargerComptesTresorerie().then(setComptes).catch(() => setComptes([]))
  }, [fiche])

  if (!fiche) return null
  const v = parseInt(montant, 10) || 0

  async function enregistrer() {
    if (v <= 0) { Alert.alert('Montant manquant', 'Saisissez le montant payé.'); return }
    if (v > fiche.reste) { Alert.alert('Montant trop élevé', `Il ne reste que ${fmt(fiche.reste)} F à payer.`); return }
    if (!source) { Alert.alert('Compte manquant', 'D\'où sort l\'argent ?'); return }
    setOccupe(true)
    try {
      await payerFournisseurAdminDirection({ fournisseur: fiche, date, montant: v, source, note: 'Droits ancien travailleur' }, user)
      await apres()
      onFermer()
    } catch (e) {
      Alert.alert('Paiement non enregistré', e?.message || 'Réessayez.')
    } finally {
      setOccupe(false)
    }
  }

  return (
    <Feuille visible onFermer={onFermer} titre={`Payer · ${fiche.nom}`}>
      <Text style={styles.petit}>{nomResto(fiche.restaurant_id)} · reste {fmt(fiche.reste)} F</Text>
      <ChampMontant label="Montant payé" valeur={montant} onChange={setMontant} />
      <ChampDate label="Date du paiement" styleLabel={styles.label} valeur={date} onChange={setDate} maxDate={aujourdhuiISO()} />
      <Text style={styles.label}>Payé depuis</Text>
      <Puces options={[...comptes.map(c => ({ valeur: c.id, label: c.nom })), { valeur: 'coffre', label: 'Coffre' }]}
        valeur={source} onChange={setSource} />
      <Text style={[styles.petit, { marginBottom: 10 }]}>
        Noté dans Dépenses direction ; compte comme une charge du restaurant ce mois-ci.
      </Text>
      <Bouton titre="Enregistrer le paiement" onPress={enregistrer} occupe={occupe} />
    </Feuille>
  )
}

// ── Anciennes fiches « ANCIEN TRAVAILLEURS » (une par restaurant) ───────────

function AnciennesFiches({ fiches, nomResto, user, apres }) {
  const { styles, colors } = useStylesTreso()
  const [occupe, setOccupe] = useState(null)

  function remplacer(f) {
    const reste = Number(f.credit_actuel) || 0
    Alert.alert('Fiche remplacée ?',
      `${f.nom.trim()} · ${nomResto(f.restaurant_id)}${reste ? ` : ${fmt(reste)} F seront remis à 0` : ''}. Saisissez d'abord une fiche par travailleur. L'historique est gardé.`, [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Remplacer', onPress: async () => {
            setOccupe(f.id)
            try { await remplacerAncienneFiche(f, user); await apres() } catch (e) { Alert.alert('Impossible', e?.message || 'Réessayez.') }
            setOccupe(null)
          },
        },
      ])
  }

  return (
    <>
      <TitreSection icone="archive-outline" couleur={colors.textMuted} titre="Anciennes fiches à remplacer" droite={`${fiches.length}`} />
      <Text style={[styles.petit, { marginBottom: 8 }]}>
        Avant le 12/10/2026, un seul fournisseur « Ancien travailleurs » par restaurant. Une fois les fiches par travailleur saisies, remplacez-le.
      </Text>
      {fiches.map(f => (
        <ItemIcone key={f.id} onPress={() => remplacer(f)} icone="account-group-outline" couleur={colors.textMuted}
          titre={`${f.nom.trim()} · ${nomResto(f.restaurant_id)}`}
          sous={occupe === f.id ? 'Remplacement…' : 'Toucher pour la remplacer'}
          droite={`${fmt(Number(f.credit_actuel) || 0)} F`} />
      ))}
    </>
  )
}
