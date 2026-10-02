// ──────────────────────────────────────────────────────────────────────────────
// Trésorerie — Partenaires à recevoir : Yango, Glovo, Wave, Orange Money, Djamo.
//
// Une période affiche UNE valeur : l'export s'il est importé (l'estimé est alors
// barré), sinon l'estimé tiré des points. Seules les périodes terminées comptent
// dans le total. La période en cours est affichée à part, pour information.
// Chaque partenaire a ses propres réceptions : Glovo par restaurant, Yango en un
// virement, OM / Wave / Djamo sur leur tête de fond (reçu noté par restaurant,
// le total entre sur la tête de fond ; un virement l'envoie ensuite en banque).
// Logique : lib/partenaires.js · lecture des exports : lib/partenairesImport.js
// ──────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react'
import { Alert, SafeAreaView, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native'

import {
  Bouton, Champ, ChampMontant, Entete, EtatEcran, Feuille, Ligne, Puces, useStylesTreso, useTresorerie,
} from '../components/tresorerie/commun'
import ChampDate from '../components/ChampDate'
import { choisirEtLireExcel } from '../lib/lireExcel'
import {
  COMPTE_TETE_DE_FOND, INFOS_PARTENAIRE, MODE_PAR_DEFAUT, PARTENAIRES, ajouterJours, estimerPeriode, libellePeriode,
  periodeDe, periodesSuivies, situationPeriode,
} from '../lib/partenaires'
import { CODES, analyserGlovo, analyserYango } from '../lib/partenairesImport'
import { aujourdhuiISO, fmt, formatDateFR, peut } from '../lib/tresorerie'
import {
  ajouterPub, annulerReception, enregistrerAlias, enregistrerReglagePartenaire, importerExport,
  recevoir, recevoirDetaille, supprimerImport, supprimerLignePub,
} from '../lib/tresorerieDb'

const LIBELLES_MODE = {
  groupe: 'un virement pour tous les restaurants',
  restaurant: 'un virement par restaurant',
  tete_de_fond: 'reçu par restaurant sur la tête de fond',
}

const PERIODES_RECUES_VISIBLES = 3

export default function TresoreriePartenairesScreen() {
  const { styles } = useStylesTreso()
  const t = useTresorerie({ avecPartenaires: true })
  const { donnees, niveau, user, recharger } = t
  const [ouverte, setOuverte] = useState(null)        // { partenaire, periode }
  const [reglage, setReglage] = useState(null)        // partenaire
  const [importP, setImportP] = useState(null)        // partenaire
  const aujourdhui = aujourdhuiISO()

  const p = donnees?.partenaires
  const nomResto = id => donnees?.restaurants.find(r => r.id === id)?.nom || 'Groupe'

  // Toutes les situations, par partenaire.
  const vues = useMemo(() => {
    if (!p) return {}
    const out = {}
    for (const part of PARTENAIRES) {
      const reg = p.reglages[part] || {}
      const mode = reg.mode_versement || MODE_PAR_DEFAUT[part]
      const situations = periodesSuivies(part, reg.date_depart, aujourdhui).map(per => situationPeriode({
        periode: per,
        estimes: estimerPeriode(p.points, part, per),
        lignes: p.lignes.filter(l => l.partenaire === part && l.periode_debut === per.debut),
        mode,
        aujourdhui,
      }))
      out[part] = { reg, mode, situations, total: situations.reduce((s, x) => s + x.aRecevoir, 0) }
    }
    return out
  }, [p, aujourdhui])

  const total = Object.values(vues).reduce((s, v) => s + v.total, 0)
  const bloque = (t.loading && !donnees) || t.erreur || !peut(niveau, 'voir_partenaires')

  let contenu
  if (bloque) {
    contenu = <EtatEcran {...t} autorise={peut(niveau, 'voir_partenaires')} />
  } else if (p === null) {
    contenu = (
      <View style={styles.centre}>
        <Text style={styles.erreur}>
          Les partenaires ne sont pas encore installés dans la base : il faut passer le fichier
          supabase_tresorerie_partenaires.sql dans Supabase.
        </Text>
      </View>
    )
  } else {
    contenu = (
      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContenu}>
        {PARTENAIRES.map(part => (
          <CartePartenaire
            key={part} partenaire={part} vue={vues[part]} niveau={niveau}
            onOuvrir={per => setOuverte({ partenaire: part, periode: per })}
            onRegler={() => setReglage(part)}
            onImporter={() => setImportP(part)}
          />
        ))}
        <Text style={styles.petit}>
          Seules les périodes terminées comptent dans le total. Quand l'export est importé, l'estimé est barré et remplacé.
        </Text>
      </ScrollView>
    )
  }

  const situationOuverte = ouverte
    ? vues[ouverte.partenaire]?.situations.find(s => s.periode.debut === ouverte.periode.debut)
    : null

  return (
    <SafeAreaView style={styles.container}>
      <Entete titre="Partenaires à recevoir" sous={p ? `Total ${fmt(total)} F · périodes terminées` : null} />
      {contenu}

      {p && (
        <>
          <FeuillePeriode
            ouverte={ouverte} situation={situationOuverte} vue={ouverte ? vues[ouverte.partenaire] : null}
            donnees={donnees} niveau={niveau} nomResto={nomResto} user={user}
            onFermer={() => setOuverte(null)} apres={recharger}
            onImporter={() => { setImportP(ouverte.partenaire) }}
          />
          <FeuilleReglage partenaire={reglage} reglages={p.reglages} user={user} onFermer={() => setReglage(null)} apres={recharger} />
          <FeuilleImport partenaire={importP} donnees={donnees} user={user} onFermer={() => setImportP(null)} apres={recharger} />
        </>
      )}
    </SafeAreaView>
  )
}

// ── Carte d'un partenaire ───────────────────────────────────────────────────

function CartePartenaire({ partenaire, vue, niveau, onOuvrir, onRegler, onImporter }) {
  const { styles } = useStylesTreso()
  const info = INFOS_PARTENAIRE[partenaire]
  if (!vue) return null

  const { reg, situations } = vue
  const enCours = situations.filter(s => !s.terminee)
  const aRecevoir = situations.filter(s => s.terminee && s.aRecevoir > 0)
  const recues = situations.filter(s => s.terminee && s.aRecevoir === 0).slice(0, PERIODES_RECUES_VISIBLES)

  return (
    <View style={styles.carte}>
      <View style={styles.ligne}>
        <Text style={[styles.itemTitre, { fontSize: 16 }]}>{info.icone} {info.nom}</Text>
        <Text style={[styles.ligneValeur, { fontSize: 16 }]}>{fmt(vue.total)}</Text>
      </View>
      <Text style={styles.petit}>
        {info.rythme} · {LIBELLES_MODE[vue.mode] || LIBELLES_MODE.restaurant}
        {reg.date_depart ? ` · suivi depuis le ${formatDateFR(reg.date_depart)}` : ''}
      </Text>

      {!reg.date_depart ? (
        <View style={[styles.avert, { marginTop: 10 }]}>
          <Text style={styles.avertTxt}>
            {peut(niveau, 'regler_partenaires')
              ? 'Pas encore suivi : appuyez sur « Régler » pour choisir la date de départ du suivi.'
              : 'Pas encore suivi : seul le propriétaire de la trésorerie peut choisir la date de départ (bouton « Régler »).'}
          </Text>
        </View>
      ) : null}

      {aRecevoir.map(s => <LignePeriode key={s.periode.debut} s={s} onPress={() => onOuvrir(s.periode)} />)}
      {enCours.map(s => <LignePeriode key={s.periode.debut} s={s} onPress={() => onOuvrir(s.periode)} enCours />)}
      {recues.map(s => <LignePeriode key={s.periode.debut} s={s} onPress={() => onOuvrir(s.periode)} />)}
      {reg.date_depart && !situations.length && <Text style={styles.vide}>Aucune période depuis la date de départ.</Text>}

      <View style={[styles.rangee, { marginTop: 10 }]}>
        {info.importable && peut(niveau, 'recevoir_partenaires') && reg.date_depart && (
          <Bouton style={[styles.btnPetit, { flex: 1 }]} secondaire titre={`📥 Importer export ${info.nom}`} onPress={onImporter} />
        )}
        {peut(niveau, 'regler_partenaires') && (
          <Bouton
            style={[styles.btnPetit, info.importable && reg.date_depart ? { flexShrink: 0, minWidth: 96, paddingHorizontal: 16 } : { flex: 1 }]}
            secondaire titre="Régler" onPress={onRegler}
          />
        )}
      </View>
    </View>
  )
}

function LignePeriode({ s, onPress, enCours }) {
  const { styles, colors } = useStylesTreso()
  const badge = enCours
    ? { label: 'en cours', fond: colors.warningLight, texte: colors.warningDark }
    : s.aRecevoir === 0
      ? { label: 'reçu', fond: colors.successLight, texte: colors.successDark }
      : s.exportImporte
        ? { label: 'export', fond: colors.primaryLight, texte: colors.primary }
        : { label: 'estimé', fond: colors.warningLight, texte: colors.warningDark }
  const totalEstime = s.parResto.reduce((x, r) => x + r.estime, 0)
  const pubs = s.parResto.reduce((x, r) => x + r.pub, 0)

  return (
    <TouchableOpacity onPress={onPress}
      style={{
        marginTop: 8, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.border,
        backgroundColor: enCours ? 'transparent' : colors.surfaceAlt, borderStyle: enCours ? 'dashed' : 'solid',
        opacity: enCours ? 0.75 : 1,
      }}>
      <View style={styles.ligne}>
        <Text style={styles.itemTitre}>{libellePeriode(s.periode)}</Text>
        <View style={[styles.badge, { backgroundColor: badge.fond }]}>
          <Text style={[styles.badgeTxt, { color: badge.texte }]}>{badge.label}</Text>
        </View>
      </View>
      {s.exportImporte ? (
        <>
          <View style={styles.ligne}>
            <Text style={styles.petit}>Estimé</Text>
            <Text style={[styles.petit, { textDecorationLine: 'line-through' }]}>{fmt(totalEstime)}</Text>
          </View>
          <View style={styles.ligne}>
            <Text style={styles.petit}>Export importé</Text>
            <Text style={styles.petit}>{fmt(s.parResto.reduce((x, r) => x + (r.reel || 0), 0))}</Text>
          </View>
          {pubs > 0 && (
            <View style={styles.ligne}>
              <Text style={styles.petit}>− Pub</Text>
              <Text style={[styles.petit, { color: colors.error }]}>− {fmt(pubs)}</Text>
            </View>
          )}
        </>
      ) : null}
      <View style={styles.ligne}>
        <Text style={[styles.ligneLabel, { fontSize: 13 }]}>
          {enCours ? 'Estimé à ce jour · pas compté' : s.aRecevoir === 0 ? 'Reçu' : 'À recevoir'}
        </Text>
        <Text style={[styles.ligneValeur, { fontSize: 14 }]}>{fmt(enCours || s.aRecevoir === 0 ? s.attendu : s.aRecevoir)}</Text>
      </View>
    </TouchableOpacity>
  )
}

// ── Détail d'une période ────────────────────────────────────────────────────

function FeuillePeriode({ ouverte, situation, vue, donnees, niveau, nomResto, user, onFermer, apres, onImporter }) {
  const { styles, colors } = useStylesTreso()
  const [reception, setReception] = useState(null)   // { restaurantId | null, attendu }
  const [receptionTete, setReceptionTete] = useState(false)
  const [pubVisible, setPubVisible] = useState(false)

  if (!ouverte || !situation) return null
  const { partenaire, periode } = ouverte
  const info = INFOS_PARTENAIRE[partenaire]
  const lignes = donnees.partenaires.lignes.filter(l => l.partenaire === partenaire && l.periode_debut === periode.debut)
  const imp = donnees.partenaires.imports.find(i => i.partenaire === partenaire && i.periode_debut === periode.debut)
  const peutRecevoir = peut(niveau, 'recevoir_partenaires')
  const nomCompte = id => donnees.comptes.find(c => c.id === id)?.nom || '?'

  function annuler(l) {
    // Une réception sur la tête de fond regroupe plusieurs restaurants : elle s'annule en entier.
    const memes = l.mouvement_id ? lignes.filter(x => x.type === 'recu' && x.mouvement_id === l.mouvement_id) : [l]
    const total = memes.reduce((t, x) => t + Number(x.montant || 0), 0)
    const detail = memes.length > 1 ? ` (toute la réception : ${memes.length} restaurants)` : ''
    Alert.alert('Annuler cette réception ?', `${fmt(total)} F du ${formatDateFR(l.date)}${detail}. L'entrée sur le compte est retirée aussi.`, [
      { text: 'Garder', style: 'cancel' },
      {
        text: 'Annuler la réception', style: 'destructive', onPress: async () => {
          try { await annulerReception(l, user); await apres() }
          catch (e) { Alert.alert('Annulation impossible', e?.message || 'Réessayez.') }
        },
      },
    ])
  }

  function retirerPub(l) {
    Alert.alert('Supprimer cette pub ?', `${nomResto(l.restaurant_id)} · ${fmt(l.montant)} F`, [
      { text: 'Garder', style: 'cancel' },
      {
        text: 'Supprimer', style: 'destructive', onPress: async () => {
          try { await supprimerLignePub(l, user); await apres() }
          catch (e) { Alert.alert('Suppression impossible', e?.message || 'Réessayez.') }
        },
      },
    ])
  }

  function retirerImport() {
    Alert.alert("Supprimer l'export importé ?", "La période repassera sur l'estimé. Les pubs saisies restent.", [
      { text: 'Garder', style: 'cancel' },
      {
        text: 'Supprimer', style: 'destructive', onPress: async () => {
          try { await supprimerImport(imp, user); await apres() }
          catch (e) { Alert.alert('Suppression impossible', e?.message || 'Réessayez.') }
        },
      },
    ])
  }

  const groupe = vue.mode === 'groupe'
  const tete = vue.mode === 'tete_de_fond'
  const recusGroupe = lignes.filter(l => l.type === 'recu' && !l.restaurant_id)

  return (
    <Feuille visible onFermer={onFermer} titre={`${info.nom} · ${libellePeriode(periode)}`}>
      {!situation.terminee && (
        <View style={styles.avert}><Text style={styles.avertTxt}>Période en cours : elle ne compte pas encore dans le total.</Text></View>
      )}

      <View style={styles.carte}>
        <Text style={[styles.lbl, { marginBottom: 6 }]}>Par restaurant</Text>
        {situation.parResto.length === 0 && <Text style={styles.vide}>Aucune vente sur cette période.</Text>}
        {situation.parResto
          .slice().sort((a, b) => nomResto(a.restaurant_id).localeCompare(nomResto(b.restaurant_id)))
          .map(r => {
            // Tête de fond : chaque restaurant peut être reçu à part, dès que son argent arrive (OM surtout).
            const recevable = !groupe && !r.recuFait && peutRecevoir && situation.terminee
            const ouvrir = () => setReception({ restaurantId: r.restaurant_id, attendu: r.attendu })
            return (
            <TouchableOpacity key={r.restaurant_id} style={styles.item} disabled={!(tete && recevable)} onPress={ouvrir}>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemTitre}>{nomResto(r.restaurant_id)}{tete && recevable ? ' ›' : ''}</Text>
                <Text style={styles.petit}>
                  {r.reel !== null
                    ? <Text style={{ textDecorationLine: 'line-through' }}>estimé {fmt(r.estime)}</Text>
                    : `estimé ${fmt(r.estime)}`}
                  {r.reel !== null ? ` · export ${fmt(r.reel)}` : ''}
                  {r.pub ? ` · pub − ${fmt(r.pub)}` : ''}
                  {!groupe && r.recuFait ? ` · reçu ${fmt(r.recu)}${r.ecart ? ` (écart ${r.ecart > 0 ? '+' : '−'} ${fmt(Math.abs(r.ecart))})` : ''}` : ''}
                </Text>
              </View>
              <Text style={styles.ligneValeur}>{fmt(r.attendu)}</Text>
              {recevable && <Bouton titre="Reçu" style={styles.btnPetit} onPress={ouvrir} />}
            </TouchableOpacity>
            )
          })}
        <View style={styles.sep} />
        <Ligne label="Attendu" valeur={situation.attendu} fort />
        {situation.terminee && <Ligne label="Reste à recevoir" valeur={situation.aRecevoir} fort couleur={situation.aRecevoir ? colors.error : colors.success} />}
      </View>

      {groupe && (
        <View style={styles.carte}>
          <Text style={[styles.lbl, { marginBottom: 6 }]}>Virement unique (tous les restaurants)</Text>
          {recusGroupe.length === 0 && <Text style={styles.petit}>Pas encore reçu.</Text>}
          {situation.ecartGroupe !== 0 && (
            <Text style={styles.petit}>Écart avec l'attendu : {situation.ecartGroupe > 0 ? '+' : '−'} {fmt(Math.abs(situation.ecartGroupe))} F</Text>
          )}
          {!situation.recuFait && peutRecevoir && situation.terminee && (
            <Bouton titre="✓ Marquer reçu" style={{ marginTop: 8 }} onPress={() => setReception({ restaurantId: null, attendu: situation.attendu })} />
          )}
        </View>
      )}

      {tete && (
        <View style={styles.carte}>
          <Text style={[styles.lbl, { marginBottom: 6 }]}>Réception sur la tête de fond</Text>
          <Text style={styles.petit}>
            {situation.recuFait
              ? 'Tout est reçu. Pour l\'envoyer en banque : Banque et espèces → Virement entre comptes.'
              : 'Un restaurant à la fois (appuyez sur son nom, dès que son argent arrive), ou tous ceux qui restent d\'un coup.'}
          </Text>
          {!situation.recuFait && peutRecevoir && situation.terminee && (
            <Bouton titre="✓ Marquer reçu (tous ceux qui restent)" style={{ marginTop: 8 }} onPress={() => setReceptionTete(true)} />
          )}
        </View>
      )}

      {lignes.some(l => l.type === 'recu') && (
        <View style={styles.carte}>
          <Text style={[styles.lbl, { marginBottom: 6 }]}>Réceptions</Text>
          {lignes.filter(l => l.type === 'recu').map(l => (
            <View key={l.id} style={styles.item}>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemTitre}>{fmt(l.montant)} F{l.restaurant_id ? ` · ${nomResto(l.restaurant_id)}` : ''}</Text>
                <Text style={styles.petit}>{formatDateFR(l.date)} · {nomCompte(l.compte_id)}{l.note ? ` · ${l.note}` : ''}{l.cree_par_nom ? ` · ${l.cree_par_nom}` : ''}</Text>
              </View>
              {peutRecevoir && <TouchableOpacity onPress={() => annuler(l)}><Text style={{ color: colors.error, fontSize: 13 }}>Annuler</Text></TouchableOpacity>}
            </View>
          ))}
        </View>
      )}

      {info.importable && (
        <View style={styles.carte}>
          <Text style={[styles.lbl, { marginBottom: 6 }]}>Export et pub</Text>
          {imp
            ? <Text style={styles.petit}>Export « {imp.fichier_nom} » importé le {formatDateFR(imp.created_at?.slice(0, 10))}{imp.cree_par_nom ? ` par ${imp.cree_par_nom}` : ''}.</Text>
            : <Text style={styles.petit}>Export pas encore importé : la période est sur l'estimé. La pub se saisit après l'import.</Text>}
          {lignes.filter(l => l.type === 'pub').map(l => (
            <View key={l.id} style={styles.item}>
              <Text style={[styles.itemTitre, { flex: 1 }]}>Pub · {nomResto(l.restaurant_id)}{l.note ? ` · ${l.note}` : ''}</Text>
              <Text style={[styles.ligneValeur, { color: colors.error }]}>− {fmt(l.montant)}</Text>
              {peutRecevoir && <TouchableOpacity onPress={() => retirerPub(l)}><Text style={{ color: colors.error, fontSize: 13, marginLeft: 8 }}>✕</Text></TouchableOpacity>}
            </View>
          ))}
          {peutRecevoir && (
            <View style={{ gap: 8, marginTop: 10 }}>
              {imp && <Bouton secondaire titre={`+ Pub ${info.nom}`} onPress={() => setPubVisible(true)} />}
              <Bouton secondaire titre={imp ? "📥 Réimporter l'export" : '📥 Importer l\'export'} onPress={() => { onFermer(); onImporter() }} />
              {imp && <Bouton danger titre="Supprimer l'export importé" onPress={retirerImport} />}
            </View>
          )}
        </View>
      )}

      <FeuilleReception
        demande={reception} partenaire={partenaire} periode={periode} donnees={donnees} nomResto={nomResto} user={user}
        compteParDefaut={tete ? donnees.comptes.find(c => c.nom === COMPTE_TETE_DE_FOND[partenaire])?.id : null}
        onFermer={() => setReception(null)} apres={apres}
      />
      <FeuilleReceptionTete
        visible={receptionTete} partenaire={partenaire} periode={periode} situation={situation} donnees={donnees}
        nomResto={nomResto} user={user} onFermer={() => setReceptionTete(false)} apres={apres}
      />
      <FeuillePub
        visible={pubVisible} partenaire={partenaire} periode={periode} situation={situation} donnees={donnees} user={user}
        onFermer={() => setPubVisible(false)} apres={apres}
      />
    </Feuille>
  )
}

// ── Marquer reçu ────────────────────────────────────────────────────────────

function FeuilleReception({ demande, partenaire, periode, donnees, nomResto, user, compteParDefaut = null, onFermer, apres }) {
  const { styles } = useStylesTreso()
  const [montant, setMontant] = useState('')
  const [compte, setCompte] = useState(null)
  const [date, setDate] = useState(aujourdhuiISO())
  const [note, setNote] = useState('')
  const [occupe, setOccupe] = useState(false)

  useEffect(() => {
    if (!demande) return
    setMontant(demande.attendu > 0 ? String(demande.attendu) : '')
    setCompte(compteParDefaut || null)
    setDate(aujourdhuiISO())
    setNote('')
  }, [demande])

  if (!demande) return null
  const info = INFOS_PARTENAIRE[partenaire]
  const valeur = montant === '' ? 0 : parseInt(montant, 10)
  const ecart = valeur - demande.attendu

  async function enregistrer() {
    if (!valeur) { Alert.alert('Montant manquant', 'Saisissez le montant réellement reçu.'); return }
    if (!compte) { Alert.alert('Compte manquant', "Choisissez le compte où l'argent est arrivé."); return }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { Alert.alert('Date invalide', 'Écrivez la date au format AAAA-MM-JJ.'); return }
    setOccupe(true)
    try {
      await recevoir({
        partenaire, periodeDebut: periode.debut, restaurantId: demande.restaurantId, montant: valeur,
        compteId: compte, date, note: note.trim(),
        libelle: `${info.nom} ${libellePeriode(periode)}${demande.restaurantId ? ` · ${nomResto(demande.restaurantId)}` : ''}`,
      }, user)
      await apres()
      onFermer()
    } catch (e) {
      Alert.alert('Réception non enregistrée', e?.message || 'Réessayez.')
    } finally {
      setOccupe(false)
    }
  }

  return (
    <Feuille visible onFermer={onFermer}
      titre={`${info.nom} reçu · ${demande.restaurantId ? nomResto(demande.restaurantId) : 'tous les restaurants'}`}>
      <View style={styles.carte}>
        <Ligne label="Montant attendu" valeur={demande.attendu} fort />
      </View>
      <ChampMontant label="Montant réellement reçu" valeur={montant} onChange={setMontant} />
      <Text style={styles.label}>Arrivé sur</Text>
      <Puces options={donnees.comptes.map(c => ({ valeur: c.id, label: c.nom }))} valeur={compte} onChange={setCompte} />
      <Champ label="Date de réception (AAAA-MM-JJ)" value={date} onChangeText={setDate} autoCapitalize="none" />
      <Champ label="Note (facultatif)" value={note} onChangeText={setNote} />
      {valeur > 0 && ecart !== 0 && (
        <View style={styles.avert}>
          <Text style={styles.avertTxt}>Écart de {ecart > 0 ? '+' : '−'} {fmt(Math.abs(ecart))} F avec l'attendu. Il sera noté sur la période.</Text>
        </View>
      )}
      <Bouton titre="Enregistrer la réception" onPress={enregistrer} occupe={occupe} />
      <Text style={[styles.petit, { marginTop: 10 }]}>Le montant entre dans le solde du compte choisi.</Text>
    </Feuille>
  )
}

// ── Marquer reçu sur la tête de fond (OM, Wave, Djamo) ───────────────────────

// Le reçu de chaque restaurant (prérempli avec l'attendu, il peut le dépasser) ;
// leur total entre sur la tête de fond en une seule entrée.
function FeuilleReceptionTete({ visible, partenaire, periode, situation, donnees, nomResto, user, onFermer, apres }) {
  const { styles, colors } = useStylesTreso()
  const [valeurs, setValeurs] = useState({})
  const [compte, setCompte] = useState(null)
  const [date, setDate] = useState(aujourdhuiISO())
  const [note, setNote] = useState('')
  const [occupe, setOccupe] = useState(false)

  const attendus = useMemo(
    () => Object.fromEntries((situation?.parResto || []).map(r => [r.restaurant_id, r.attendu])),
    [situation],
  )
  // Seulement les restaurants pas encore reçus (ceux reçus un par un sont déjà notés) ;
  // ceux qui ont un attendu d'abord, puis les autres (un reçu imprévu reste possible).
  const restos = useMemo(() => {
    const recus = new Set((situation?.parResto || []).filter(r => r.recuFait).map(r => r.restaurant_id))
    return [...(donnees.restaurants || [])].filter(r => !recus.has(r.id))
      .sort((a, b) => (attendus[b.id] ? 1 : 0) - (attendus[a.id] ? 1 : 0) || a.nom.localeCompare(b.nom))
  }, [donnees, attendus, situation])

  useEffect(() => {
    if (!visible) return
    setValeurs(Object.fromEntries(restos.map(r => [r.id, attendus[r.id] > 0 ? String(attendus[r.id]) : ''])))
    const tete = donnees.comptes.find(c => c.nom === COMPTE_TETE_DE_FOND[partenaire])
    setCompte(tete?.id || null)
    setDate(aujourdhuiISO())
    setNote('')
  }, [visible])

  if (!visible || !situation) return null
  const info = INFOS_PARTENAIRE[partenaire]
  const lire = t => (t === '' || t == null ? 0 : parseInt(t, 10) || 0)
  const total = restos.reduce((t, r) => t + lire(valeurs[r.id]), 0)
  const attenduRestant = restos.reduce((t, r) => t + (attendus[r.id] || 0), 0)
  const ecart = total - attenduRestant

  async function enregistrer() {
    const parts = restos.map(r => ({ restaurant_id: r.id, montant: lire(valeurs[r.id]) })).filter(x => x.montant > 0)
    if (!parts.length) { Alert.alert('Montant manquant', 'Saisissez ce que chaque restaurant a versé.'); return }
    if (!compte) { Alert.alert('Compte manquant', 'Choisissez le compte où l\'argent est arrivé (la tête de fond).'); return }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { Alert.alert('Date invalide', 'Écrivez la date au format AAAA-MM-JJ.'); return }
    setOccupe(true)
    try {
      await recevoirDetaille({
        partenaire, periodeDebut: periode.debut, parts, compteId: compte, date, note: note.trim(),
        libelle: `${info.nom} ${libellePeriode(periode)} · ${parts.length} restaurant${parts.length > 1 ? 's' : ''}`,
      }, user)
      await apres()
      onFermer()
    } catch (e) {
      Alert.alert('Réception non enregistrée', e?.message || 'Réessayez.')
    } finally {
      setOccupe(false)
    }
  }

  return (
    <Feuille visible onFermer={onFermer} titre={`${info.nom} reçu · ${libellePeriode(periode)}`}>
      <Text style={[styles.petit, { marginBottom: 10 }]}>
        Ce que chaque restaurant a réellement versé sur la tête de fond (prérempli avec l'attendu).
      </Text>
      {restos.map(r => {
        const a = attendus[r.id] || 0
        const e = lire(valeurs[r.id]) - a
        return (
          <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.itemTitre}>{nomResto(r.id)}</Text>
              <Text style={styles.petit}>attendu {fmt(a)}{valeurs[r.id] !== '' && e !== 0 ? ` · écart ${e > 0 ? '+' : '−'} ${fmt(Math.abs(e))}` : ''}</Text>
            </View>
            <TextInput
              style={[styles.input, { width: 140, textAlign: 'right', paddingVertical: 9 }]}
              value={valeurs[r.id] ?? ''} placeholder="0" placeholderTextColor={colors.textMuted} keyboardType="number-pad"
              onChangeText={t => setValeurs(x => ({ ...x, [r.id]: t.replace(/[^\d]/g, '') }))}
            />
          </View>
        )
      })}
      <View style={styles.carte}>
        <Ligne label="Attendu (restaurants restants)" valeur={attenduRestant} />
        <Ligne label="Total reçu" valeur={total} fort />
        {total > 0 && ecart !== 0 && (
          <Text style={[styles.petit, { color: ecart > 0 ? colors.success : colors.error }]}>
            Écart de {ecart > 0 ? '+' : '−'} {fmt(Math.abs(ecart))} F avec l'attendu.
          </Text>
        )}
      </View>
      <Text style={styles.label}>Arrivé sur</Text>
      <Puces options={donnees.comptes.map(c => ({ valeur: c.id, label: c.nom }))} valeur={compte} onChange={setCompte} />
      <Champ label="Date de réception (AAAA-MM-JJ)" value={date} onChangeText={setDate} autoCapitalize="none" />
      <Champ label="Note (facultatif)" value={note} onChangeText={setNote} />
      <Bouton titre={`Enregistrer · ${fmt(total)} F`} onPress={enregistrer} occupe={occupe} />
      <Text style={[styles.petit, { marginTop: 10 }]}>
        Le total entre sur le compte choisi. Pour l'envoyer en banque : Banque et espèces → Virement entre comptes.
      </Text>
    </Feuille>
  )
}

// ── Pub ─────────────────────────────────────────────────────────────────────

function FeuillePub({ visible, partenaire, periode, situation, donnees, user, onFermer, apres }) {
  const { styles } = useStylesTreso()
  const [restaurantId, setRestaurantId] = useState(null)
  const [montant, setMontant] = useState('')
  const [note, setNote] = useState('')
  const [occupe, setOccupe] = useState(false)

  useEffect(() => { if (visible) { setRestaurantId(null); setMontant(''); setNote('') } }, [visible])
  if (!visible) return null

  const info = INFOS_PARTENAIRE[partenaire]
  const restos = donnees.restaurants.map(r => ({ valeur: r.id, label: r.nom }))
  const actuel = situation.parResto.find(r => r.restaurant_id === restaurantId)
  const valeur = montant === '' ? 0 : parseInt(montant, 10)

  async function enregistrer() {
    if (!restaurantId) { Alert.alert('Restaurant manquant', 'Choisissez le restaurant concerné par la pub.'); return }
    if (!valeur) { Alert.alert('Montant manquant', 'Saisissez le montant de la pub.'); return }
    setOccupe(true)
    try {
      await ajouterPub({ partenaire, periodeDebut: periode.debut, restaurantId, montant: valeur, note: note.trim() }, user)
      await apres()
      onFermer()
    } catch (e) {
      Alert.alert('Pub non enregistrée', e?.message || 'Réessayez.')
    } finally {
      setOccupe(false)
    }
  }

  return (
    <Feuille visible onFermer={onFermer} titre={`Pub ${info.nom} · ${libellePeriode(periode)}`}>
      <Text style={styles.label}>Restaurant concerné</Text>
      <Puces options={restos} valeur={restaurantId} onChange={setRestaurantId} />
      <ChampMontant label="Montant de la pub payée" valeur={montant} onChange={setMontant} />
      <Champ label="Note (facultatif)" value={note} onChangeText={setNote} />
      {actuel && valeur > 0 && (
        <View style={styles.carte}>
          <Ligne label="Montant actuel à recevoir" valeur={actuel.attendu} />
          <Ligne label="Après la pub" valeur={actuel.attendu - valeur} fort />
        </View>
      )}
      {partenaire === 'glovo' && (
        <Text style={[styles.petit, { marginBottom: 10 }]}>Cette pub s'ajoute aux frais d'annonces déjà déduits dans l'export Glovo.</Text>
      )}
      <Bouton titre="Enregistrer la pub" onPress={enregistrer} occupe={occupe} />
    </Feuille>
  )
}

// ── Réglage d'un partenaire ─────────────────────────────────────────────────

function FeuilleReglage({ partenaire, reglages, user, onFermer, apres }) {
  const { styles } = useStylesTreso()
  const [date, setDate] = useState('')
  const [mode, setMode] = useState('restaurant')
  const [occupe, setOccupe] = useState(false)

  useEffect(() => {
    if (!partenaire) return
    const r = reglages[partenaire] || {}
    setDate(r.date_depart || aujourdhuiISO())
    setMode(r.mode_versement || MODE_PAR_DEFAUT[partenaire])
  }, [partenaire])

  if (!partenaire) return null
  const info = INFOS_PARTENAIRE[partenaire]
  const premiereReelle = /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? (() => { let per = periodeDe(partenaire, date); if (per.debut < date) per = periodeDe(partenaire, ajouterJours(per.fin, 1)); return per })()
    : null

  async function enregistrer() {
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) { Alert.alert('Date invalide', 'Écrivez la date au format AAAA-MM-JJ, par exemple 2026-10-01.'); return }
    setOccupe(true)
    try {
      await enregistrerReglagePartenaire({ partenaire, dateDepart: date || null, modeVersement: mode }, user)
      await apres()
      onFermer()
    } catch (e) {
      Alert.alert('Réglage non enregistré', e?.message || 'Réessayez.')
    } finally {
      setOccupe(false)
    }
  }

  return (
    <Feuille visible onFermer={onFermer} titre={`Régler ${info.nom}`}>
      <ChampDate label="Suivre à partir du" valeur={date} onChange={setDate} effacable placeholder="Pas suivi" />
      {premiereReelle && (
        <Text style={[styles.petit, { marginBottom: 12 }]}>
          Première période suivie : {libellePeriode(premiereReelle)}. Les périodes d'avant sont considérées comme payées.
        </Text>
      )}
      <Text style={styles.label}>Versement</Text>
      <Puces
        options={[
          { valeur: 'groupe', label: 'Un virement pour tous' },
          { valeur: 'restaurant', label: 'Un virement par restaurant' },
          ...(COMPTE_TETE_DE_FOND[partenaire] ? [{ valeur: 'tete_de_fond', label: 'Par restaurant sur la tête de fond' }] : []),
        ]}
        valeur={mode} onChange={setMode}
      />
      <Bouton titre="Enregistrer" onPress={enregistrer} occupe={occupe} />
    </Feuille>
  )
}

// ── Import d'un export brut ─────────────────────────────────────────────────

function FeuilleImport({ partenaire, donnees, user, onFermer, apres }) {
  const { styles, colors } = useStylesTreso()
  const [fichier, setFichier] = useState(null)        // { nom, lignes }
  const [seuil, setSeuil] = useState(null)
  const [periode, setPeriode] = useState(null)
  const [codes, setCodes] = useState({})              // code → restaurant_id | 'ignorer'
  const [lecture, setLecture] = useState(false)
  const [occupe, setOccupe] = useState(false)
  const [erreur, setErreur] = useState(null)

  useEffect(() => {
    if (!partenaire) return
    setFichier(null); setSeuil(null); setPeriode(null); setCodes({}); setErreur(null)
  }, [partenaire])

  const analyse = useMemo(() => {
    if (!fichier) return null
    try {
      return partenaire === 'yango'
        ? analyserYango(fichier.lignes, { seuil: seuil ?? undefined })
        : analyserGlovo(fichier.lignes)
    } catch (e) {
      return { erreur: e.message }
    }
  }, [fichier, seuil, partenaire])

  // Codes déjà connus : repris de la table de correspondance.
  useEffect(() => {
    if (!analyse || analyse.erreur) return
    const connus = Object.fromEntries((donnees.partenaires.alias || []).map(a => [a.code, a.restaurant_id]))
    setCodes(c => {
      const out = { ...c }
      for (const code of Object.keys(analyse.parCode)) if (out[code] === undefined && connus[code]) out[code] = connus[code]
      return out
    })
    if (!periode && analyse.j1) {
      // Yango : l'export part du jeudi (veille de la semaine) ; Glovo : du 1er jour.
      setPeriode(periodeDe(partenaire, partenaire === 'yango' ? ajouterJours(analyse.j1, 1) : analyse.j1))
    }
  }, [analyse])

  if (!partenaire) return null
  const info = INFOS_PARTENAIRE[partenaire]

  async function choisir() {
    setErreur(null)
    setLecture(true)
    try {
      const f = await choisirEtLireExcel()
      if (f) { setFichier(f); setPeriode(null); setSeuil(null) }
    } catch (e) {
      setErreur(`Fichier illisible : ${e?.message || 'format inconnu'}.`)
    } finally {
      setLecture(false)
    }
  }

  const codesExport = analyse && !analyse.erreur ? Object.keys(analyse.parCode) : []
  const manquants = codesExport.filter(c => !codes[c])
  const choixPeriodes = periode
    ? [periodeDe(partenaire, ajouterJours(periode.debut, -1)), periode, periodeDe(partenaire, ajouterJours(periode.fin, 1))]
    : []
  const dejaImporte = periode && donnees.partenaires.imports.some(i => i.partenaire === partenaire && i.periode_debut === periode.debut)

  async function confirmer() {
    if (!periode) { Alert.alert('Période manquante', 'Choisissez la période de cet export.'); return }
    if (manquants.length) { Alert.alert('Restaurants à associer', 'Associez chaque code à un restaurant (ou ignorez-le).'); return }
    // Plusieurs codes peuvent tomber sur le même restaurant : on additionne.
    const parResto = {}
    for (const code of codesExport) {
      const r = codes[code]
      if (r === 'ignorer') continue
      const t = analyse.parCode[code]
      if (!parResto[r]) parResto[r] = { restaurant_id: r, montant: 0, brut: 0 }
      parResto[r].montant += t.paye
      parResto[r].brut += t.montant
    }
    setOccupe(true)
    try {
      const nouveaux = Object.fromEntries(codesExport.filter(c => c !== '?' && codes[c] !== 'ignorer').map(c => [c, codes[c]]))
      await enregistrerAlias(nouveaux, user)
      await importerExport({
        partenaire, periode, fichier: fichier.nom,
        details: {
          j1: analyse.j1, jn: analyse.jn, seuil: analyse.seuil ?? null, ecarte: analyse.ecarte,
          nb_commandes: analyse.nbCommandes, noms_inconnus: analyse.nomsInconnus, par_code: analyse.parCode,
        },
        lignes: Object.values(parResto),
      }, user)
      await apres()
      onFermer()
    } catch (e) {
      Alert.alert('Import non enregistré', e?.message || 'Réessayez.')
    } finally {
      setOccupe(false)
    }
  }

  const restos = [...donnees.restaurants.map(r => ({ valeur: r.id, label: r.nom })), { valeur: 'ignorer', label: 'Ignorer' }]
  const totalPaye = codesExport.reduce((s, c) => s + (codes[c] === 'ignorer' ? 0 : analyse.parCode[c].paye), 0)

  return (
    <Feuille visible onFermer={onFermer} titre={`Importer l'export ${info.nom}`}>
      <Text style={[styles.petit, { marginBottom: 10 }]}>
        {partenaire === 'yango'
          ? "Export brut Yango (du jeudi au vendredi). L'app garde la fenêtre 22h → 22h (21h en hiver), retire les commandes non payables et annulées, puis applique Montant × 0,77."
          : "Export brut Glovo (orderDetails). L'app retire les commandes non payables, puis calcule PAYE = vente − commission 29,5 % − frais opérationnels − frais d'annonces − frais d'attente."}
      </Text>
      <Bouton secondaire titre={fichier ? `Fichier : ${fichier.nom} · changer` : '📂 Choisir le fichier Excel'} onPress={choisir} occupe={lecture} />
      {!!erreur && <Text style={[styles.erreur, { marginTop: 10 }]}>{erreur}</Text>}
      {analyse?.erreur && <Text style={[styles.erreur, { marginTop: 10 }]}>{analyse.erreur}</Text>}

      {analyse && !analyse.erreur && (
        <View style={{ marginTop: 14 }}>
          <View style={styles.carte}>
            <Text style={styles.petit}>
              Fichier du {formatDateFR(analyse.j1)} au {formatDateFR(analyse.jn)} · {analyse.nbCommandes} commandes gardées
            </Text>
            <Text style={styles.petit}>
              Écartées : {Object.entries(analyse.ecarte).map(([k, v]) => `${v} ${LIBELLES_ECARTE[k]}`).join(' · ')}
            </Text>
          </View>

          {partenaire === 'yango' && (
            <>
              <Text style={styles.label}>Heure de coupure{analyse.aCheval ? ' (période à cheval sur le changement d\'heure : choisissez)' : ''}</Text>
              <Puces options={[{ valeur: 22, label: '22h (été)' }, { valeur: 21, label: '21h (hiver)' }]}
                valeur={analyse.seuil} onChange={v => setSeuil(v)} />
            </>
          )}

          <Text style={styles.label}>Période de cet export</Text>
          <Puces options={choixPeriodes.map(p => ({ valeur: p.debut, label: libellePeriode(p) }))}
            valeur={periode?.debut} onChange={d => setPeriode(choixPeriodes.find(p => p.debut === d))} />
          {dejaImporte && (
            <View style={styles.avert}><Text style={styles.avertTxt}>Un export existe déjà pour cette période : il sera remplacé.</Text></View>
          )}

          <Text style={[styles.lbl, { marginVertical: 8 }]}>Par restaurant</Text>
          {codesExport.map(code => {
            const tot = analyse.parCode[code]
            return (
              <View key={code} style={styles.carte}>
                <View style={styles.ligne}>
                  <Text style={styles.itemTitre}>{code === '?' ? 'Noms inconnus' : code} · {tot.nb} cmd</Text>
                  <Text style={styles.ligneValeur}>{fmt(tot.paye)}</Text>
                </View>
                {code === '?' && <Text style={[styles.petit, { color: colors.error }]}>{analyse.nomsInconnus.join(' · ')}</Text>}
                <Text style={[styles.petit, { marginBottom: 6 }]}>
                  {partenaire === 'yango' ? `Montant ${fmt(tot.montant)} × 0,77` : `Vente ${fmt(tot.montant)} · commission ${fmt(tot.commission)}`}
                </Text>
                <Puces options={restos} valeur={codes[code] || null} onChange={v => setCodes(c => ({ ...c, [code]: v }))} />
              </View>
            )
          })}

          <View style={styles.carte}>
            <Ligne label={partenaire === 'yango' ? 'Total SOUS TOTAL' : 'Total PAYE'} valeur={totalPaye} fort />
          </View>
          <Bouton titre="Importer" onPress={confirmer} occupe={occupe} desactive={!periode || manquants.length > 0} />
          {manquants.length > 0 && (
            <Text style={[styles.petit, { marginTop: 8 }]}>À associer : {manquants.map(c => (c === '?' ? 'noms inconnus' : c)).join(', ')}.</Text>
          )}
          <Text style={[styles.petit, { marginTop: 8 }]}>Codes de l'app : {CODES.join(', ')}. L'association est retenue pour les prochains imports.</Text>
        </View>
      )}
    </Feuille>
  )
}

const LIBELLES_ECARTE = {
  bordDebut: 'avant la coupure du 1er jour',
  bordFin: 'après la coupure du dernier jour',
  nonPayables: 'non payables',
  annulees: 'annulées',
}
