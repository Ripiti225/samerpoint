// ──────────────────────────────────────────────────────────────────────────────
// Trésorerie — Partenaires à recevoir : Yango, Glovo, Wave, Orange Money, Djamo.
//
// Une période affiche UNE valeur : l'export s'il est importé (l'estimé est alors
// barré), sinon l'estimé tiré des points. Seules les périodes terminées comptent
// dans le total. La période en cours est affichée à part, pour information.
// Chaque partenaire a ses propres réceptions : Glovo par restaurant (un
// restaurant peut arriver en plusieurs virements, ex. KMS sur BACI puis SIB),
// Yango en un virement, OM / Wave / Djamo sur leur tête de fond (reçu noté par restaurant,
// le total entre sur la tête de fond ; un virement l'envoie ensuite en banque).
// Une période entièrement reçue quitte cet écran : elle se retrouve dans
// Historique → onglet Partenaires (qui rouvre son détail ici, ?partenaire=&periode=).
// Logique : lib/partenaires.js · lecture des exports : lib/partenairesImport.js
// ──────────────────────────────────────────────────────────────────────────────
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Platform, SafeAreaView, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native'

import {
  Bouton, Champ, ChampCalendrier, ChampMontant, Entete, EtatEcran, Feuille, Hero, HeroCase, Ligne, Pastille, Puces, STYLE_PARTENAIRE,
  useStylesTreso, useTresorerie,
} from '../components/tresorerie/commun'
import { choisirEtLireExcel } from '../lib/lireExcel'
import {
  COMPTE_TETE_DE_FOND, INFOS_PARTENAIRE, MODE_PAR_DEFAUT, PARTENAIRES, ajouterJours, libellePeriode, periodeDe,
  periodeSoldee, vuesPartenaires,
} from '../lib/partenaires'
import { CODES, analyserGlovo, analyserYango } from '../lib/partenairesImport'
import { aujourdhuiISO, fmt, formatDateFR, peut } from '../lib/tresorerie'
import {
  ajouterPubs, annulerReception, enregistrerAlias, enregistrerReglagePartenaire, importerExport,
  recevoir, recevoirDetaille, supprimerImport, supprimerLignePub,
} from '../lib/tresorerieDb'
import { useFocusRecherche } from '../lib/useFocusRecherche'
import { ORIGINE_YANGO, etatPub, messageValide, pubParCode, semainesProposees } from '../lib/ventesYangoFavori'

const LIBELLES_MODE = {
  groupe: 'un virement pour tous les restaurants',
  restaurant: 'un virement par restaurant',
  tete_de_fond: 'reçu par restaurant sur la tête de fond',
}

export default function TresoreriePartenairesScreen() {
  const { styles } = useStylesTreso()
  const params = useLocalSearchParams()
  const t = useTresorerie({ avecPartenaires: true })
  const { donnees, niveau, user, recharger } = t
  const [ouverte, setOuverte] = useState(null)        // { partenaire, periode }
  const [reglage, setReglage] = useState(null)        // partenaire
  const [importP, setImportP] = useState(null)        // partenaire
  const aujourdhui = aujourdhuiISO()
  // Ouvert par le favori « Ventes Yango » depuis le portail : import Yango en mode favori.
  const [favori] = useState(() => Platform.OS === 'web' && params.favori === 'yango')

  const p = donnees?.partenaires
  const nomResto = id => donnees?.restaurants.find(r => r.id === id)?.nom || 'Groupe'

  // Toutes les situations, par partenaire.
  const vues = useMemo(() => (p ? vuesPartenaires(p, aujourdhui) : {}), [p, aujourdhui])

  // Ouvert depuis l'Historique : le détail de la période demandée s'affiche (une seule fois).
  useEffect(() => {
    if (!params.partenaire || !params.periode || !vues[params.partenaire]) return
    const s = vues[params.partenaire].situations.find(x => x.periode.debut === params.periode)
    if (s) setOuverte({ partenaire: params.partenaire, periode: s.periode })
    router.setParams({ partenaire: undefined, periode: undefined })
  }, [vues, params.partenaire, params.periode])

  // Une seule fois, dès que les partenaires sont chargés.
  const partenairesCharges = !!p
  const favoriOuvert = useRef(false)
  useEffect(() => {
    if (!favori || !partenairesCharges || favoriOuvert.current) return
    favoriOuvert.current = true
    setImportP('yango')
  }, [favori, partenairesCharges])

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
        <Hero icone="moped" titre="À recevoir des partenaires" valeur={`${fmt(total)} F`} sous="Périodes terminées seulement">
          <View style={styles.heroCases}>
            {PARTENAIRES.map(part => (
              <HeroCase key={part} label={INFOS_PARTENAIRE[part].nom} valeur={fmt(vues[part]?.total || 0)} couleur={STYLE_PARTENAIRE[part]?.couleur} />
            ))}
          </View>
        </Hero>
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
      <Entete titre="Partenaires à recevoir" sous="Yango · Glovo · Wave · Orange Money · Djamo" />
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
          <FeuilleImport partenaire={importP} donnees={donnees} user={user} onFermer={() => setImportP(null)} apres={recharger} favori={favori && importP === 'yango'} />
        </>
      )}
    </SafeAreaView>
  )
}

// ── Carte d'un partenaire ───────────────────────────────────────────────────

function CartePartenaire({ partenaire, vue, niveau, onOuvrir, onRegler, onImporter }) {
  const { styles, colors } = useStylesTreso()
  const info = INFOS_PARTENAIRE[partenaire]
  const sp = STYLE_PARTENAIRE[partenaire] || { icone: 'handshake-outline', couleur: colors.primary }
  if (!vue) return null

  const { reg, situations } = vue
  const enCours = situations.filter(s => !s.terminee)
  const aRecevoir = situations.filter(s => s.terminee && s.aRecevoir > 0)
  // Les périodes entièrement reçues sont dans l'Historique.
  const nbRecues = situations.filter(periodeSoldee).length

  return (
    <View style={[styles.carte, { overflow: 'hidden', paddingTop: 18 }]}>
      <View style={[styles.compteTrait, { backgroundColor: sp.couleur }]} />
      <View style={styles.carteEntete}>
        <Pastille icone={sp.icone} couleur={sp.couleur} taille={44} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.itemTitre, { fontSize: 17 }]}>{info.nom}</Text>
          <Text style={styles.petit}>{info.rythme}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[styles.itemMontant, { fontSize: 18, color: vue.total ? colors.text : colors.textMuted }]}>{fmt(vue.total)} F</Text>
          <Text style={styles.petit}>à recevoir</Text>
        </View>
      </View>
      <Text style={styles.petit}>
        {LIBELLES_MODE[vue.mode] || LIBELLES_MODE.restaurant}
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
      {reg.date_depart && !situations.length && <Text style={styles.vide}>Aucune période depuis la date de départ.</Text>}
      {reg.date_depart && situations.length > 0 && !aRecevoir.length && (
        <Text style={[styles.petit, { marginTop: 8 }]}>Rien à recevoir sur les périodes terminées.</Text>
      )}
      {nbRecues > 0 && (
        <TouchableOpacity onPress={() => router.push(`/tresorerie-restaurant?onglet=partenaires&partenaire=${partenaire}`)}
          style={[styles.histoBouton, { marginTop: 10 }]} accessibilityRole="button">
          <MaterialCommunityIcons name="history" size={18} color={colors.primary} />
          <Text style={styles.histoBoutonTxt}>
            {nbRecues} période{nbRecues > 1 ? 's' : ''} reçue{nbRecues > 1 ? 's' : ''} · voir l'historique
          </Text>
          <MaterialCommunityIcons name="chevron-right" size={20} color={colors.primary} />
        </TouchableOpacity>
      )}

      <View style={[styles.rangee, { marginTop: 10 }]}>
        {info.importable && peut(niveau, 'recevoir_partenaires') && reg.date_depart && (
          <Bouton style={[styles.btnPetit, { flex: 1 }]} secondaire icone="file-import-outline" titre={`Importer l'export`} onPress={onImporter} />
        )}
        {peut(niveau, 'regler_partenaires') && (
          <Bouton
            style={[styles.btnPetit, info.importable && reg.date_depart ? { flexShrink: 0, minWidth: 96, paddingHorizontal: 16 } : { flex: 1 }]}
            secondaire icone="cog-outline" titre="Régler" onPress={onRegler}
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
        marginTop: 8, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: colors.borderLight,
        backgroundColor: enCours ? 'transparent' : colors.surfaceAlt, borderStyle: enCours ? 'dashed' : 'solid',
        opacity: enCours ? 0.75 : 1,
      }}>
      <View style={styles.ligne}>
        <Text style={styles.itemTitre}>{libellePeriode(s.periode)}</Text>
        <View style={[styles.badge, styles.badgeLigne, { backgroundColor: badge.fond }]}>
          <View style={[styles.badgePoint, { backgroundColor: badge.texte }]} />
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
  const [reception, setReception] = useState(null)   // { restaurantId | null, attendu, complement }
  const [receptionTete, setReceptionTete] = useState(false)
  const [pubVisible, setPubVisible] = useState(false)
  // Ouvert depuis la recherche globale : ligne encadrée.
  const focus = useFocusRecherche(useLocalSearchParams().focus)

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
            // Déjà reçu : un autre virement peut encore arriver (KMS : un magasin sur la BACI, l'autre sur la SIB).
            const complement = !groupe && !tete && r.recuFait && peutRecevoir && situation.terminee
            const ouvrir = () => setReception({ restaurantId: r.restaurant_id, attendu: r.attendu })
            const ouvrirComplement = () => setReception({ restaurantId: r.restaurant_id, attendu: r.reste, complement: true })
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
                  {!groupe && r.recuFait ? ` · reçu ${fmt(r.recu)}${r.nbRecus > 1 ? ` en ${r.nbRecus} virements` : ''}${r.ecart ? ` (écart ${r.ecart > 0 ? '+' : '−'} ${fmt(Math.abs(r.ecart))})` : ''}` : ''}
                </Text>
              </View>
              <Text style={styles.ligneValeur}>{fmt(r.attendu)}</Text>
              {recevable && <Bouton titre="Reçu" style={styles.btnPetit} onPress={ouvrir} />}
              {complement && <Bouton secondaire titre="+ Virement" style={styles.btnPetit} onPress={ouvrirComplement} />}
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
            <View key={l.id} {...focus.props(l.id)} style={[styles.item, focus.style(l.id)]}>
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
            <View key={l.id} {...focus.props(l.id)} style={[styles.item, focus.style(l.id)]}>
              <Text style={[styles.itemTitre, { flex: 1 }]}>Pub · {nomResto(l.restaurant_id)}{l.note ? ` · ${l.note}` : ''}</Text>
              <Text style={[styles.ligneValeur, { color: colors.error }]}>− {fmt(l.montant)}</Text>
              {peutRecevoir && <TouchableOpacity onPress={() => retirerPub(l)}><Text style={{ color: colors.error, fontSize: 13, marginLeft: 8 }}>✕</Text></TouchableOpacity>}
            </View>
          ))}
          {peutRecevoir && (
            <View style={{ gap: 8, marginTop: 10 }}>
              {imp && <Bouton secondaire titre={`+ Pub ${info.nom}`} onPress={() => setPubVisible(true)} />}
              <Bouton secondaire icone="file-import-outline" titre={imp ? "Réimporter l'export" : 'Importer l\'export'} onPress={() => { onFermer(); onImporter() }} />
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
    // Jamais prérempli avec l'attendu : validé sans y toucher, c'était l'import
    // (et non ce qui est arrivé sur le relevé) qui entrait en banque.
    setMontant('')
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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { Alert.alert('Date invalide', 'Choisissez la date dans le calendrier.'); return }
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
        <Ligne label={demande.complement ? 'Reste attendu' : 'Montant attendu'} valeur={demande.attendu} fort />
        {demande.complement && (
          <Text style={[styles.petit, { marginTop: 6 }]}>
            Autre virement pour ce restaurant (ex. KMS : un magasin Glovo payé sur la BACI, l'autre sur la SIB). Choisissez bien le compte où il est arrivé.
          </Text>
        )}
      </View>
      <ChampMontant label="Montant réellement reçu (celui du relevé)" valeur={montant} onChange={setMontant} />
      <Text style={styles.label}>Arrivé sur</Text>
      <Puces options={donnees.comptes.map(c => ({ valeur: c.id, label: c.nom }))} valeur={compte} onChange={setCompte} />
      <ChampCalendrier label="Date de réception" valeur={date} onChange={setDate} />
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

// Le reçu de chaque restaurant (à taper : jamais prérempli avec l'attendu, qui
// reste affiché à côté ; il peut le dépasser) ; leur total entre sur la tête de
// fond en une seule entrée.
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
    setValeurs(Object.fromEntries(restos.map(r => [r.id, ''])))
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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { Alert.alert('Date invalide', 'Choisissez la date dans le calendrier.'); return }
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
        Tapez ce que chaque restaurant a réellement versé sur la tête de fond (l'attendu est rappelé sous son nom).
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
      <ChampCalendrier label="Date de réception" valeur={date} onChange={setDate} />
      <Champ label="Note (facultatif)" value={note} onChangeText={setNote} />
      <Bouton titre={`Enregistrer · ${fmt(total)} F`} onPress={enregistrer} occupe={occupe} />
      <Text style={[styles.petit, { marginTop: 10 }]}>
        Le total entre sur le compte choisi. Pour l'envoyer en banque : Banque et espèces → Virement entre comptes.
      </Text>
    </Feuille>
  )
}

// ── Pub ─────────────────────────────────────────────────────────────────────

// Une ligne par restaurant : on tape la pub de chacun (vide = pas de pub) et
// on enregistre tout d'un coup. L'attendu de chaque restaurant est rappelé,
// avec ce qu'il deviendra après la pub.
function FeuillePub({ visible, partenaire, periode, situation, donnees, user, onFermer, apres }) {
  const { styles, colors } = useStylesTreso()
  const [valeurs, setValeurs] = useState({})
  const [note, setNote] = useState('')
  const [occupe, setOccupe] = useState(false)

  const parResto = useMemo(
    () => Object.fromEntries((situation?.parResto || []).map(r => [r.restaurant_id, r])),
    [situation],
  )
  // Ceux qui ont un attendu d'abord (ils sont sur la plateforme), puis les autres.
  const restos = useMemo(() => [...(donnees.restaurants || [])]
    .sort((a, b) => (parResto[b.id]?.attendu ? 1 : 0) - (parResto[a.id]?.attendu ? 1 : 0) || a.nom.localeCompare(b.nom)),
  [donnees, parResto])

  useEffect(() => { if (visible) { setValeurs({}); setNote('') } }, [visible])
  if (!visible) return null

  const info = INFOS_PARTENAIRE[partenaire]
  const lire = t => (t === '' || t == null ? 0 : parseInt(t, 10) || 0)
  const parts = restos.map(r => ({ restaurant_id: r.id, montant: lire(valeurs[r.id]) })).filter(x => x.montant > 0)
  const total = parts.reduce((t, x) => t + x.montant, 0)

  async function enregistrer() {
    if (!parts.length) { Alert.alert('Montant manquant', 'Tapez la pub d\'au moins un restaurant.'); return }
    setOccupe(true)
    try {
      await ajouterPubs({ partenaire, periodeDebut: periode.debut, parts, note: note.trim() }, user)
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
      <Text style={[styles.petit, { marginBottom: 10 }]}>
        Tapez la pub payée par chaque restaurant, puis enregistrez tout d'un coup. Laissez vide ceux qui n'en ont pas.
      </Text>
      {restos.map(r => {
        const sit = parResto[r.id]
        const v = lire(valeurs[r.id])
        return (
          <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.itemTitre}>{r.nom}</Text>
              <Text style={styles.petit}>
                {sit ? `à recevoir ${fmt(sit.attendu)}` : 'rien à recevoir'}
                {sit?.pub ? ` · déjà − ${fmt(sit.pub)} de pub` : ''}
                {sit && v > 0 ? ` → ${fmt(sit.attendu - v)}` : ''}
              </Text>
            </View>
            <TextInput
              style={[styles.input, { width: 140, textAlign: 'right', paddingVertical: 9 }]}
              value={valeurs[r.id] ?? ''} placeholder="0" placeholderTextColor={colors.textMuted} keyboardType="number-pad"
              onChangeText={t => setValeurs(x => ({ ...x, [r.id]: t.replace(/[^\d]/g, '') }))}
            />
          </View>
        )
      })}
      <Champ label="Note (facultatif, pour toutes les lignes)" value={note} onChangeText={setNote} />
      {partenaire === 'glovo' && (
        <Text style={[styles.petit, { marginBottom: 10 }]}>Cette pub s'ajoute aux frais d'annonces déjà déduits dans l'export Glovo.</Text>
      )}
      <Bouton
        titre={parts.length ? `Enregistrer · ${parts.length} restaurant${parts.length > 1 ? 's' : ''} · ${fmt(total)} F` : 'Enregistrer la pub'}
        onPress={enregistrer} occupe={occupe} />
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
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) { Alert.alert('Date invalide', 'Choisissez la date dans le calendrier.'); return }
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
      <ChampCalendrier label="Suivre à partir du" valeur={date} onChange={setDate} effacable placeholder="Pas suivi" />
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

function FeuilleImport({ partenaire, donnees, user, onFermer, apres, favori }) {
  const { styles, colors } = useStylesTreso()
  const [fichier, setFichier] = useState(null)        // { nom, lignes }
  const [seuil, setSeuil] = useState(null)
  const [periode, setPeriode] = useState(null)
  const [codes, setCodes] = useState({})              // code → restaurant_id | 'ignorer'
  const [lecture, setLecture] = useState(false)
  const [occupe, setOccupe] = useState(false)
  const [erreur, setErreur] = useState(null)
  const [pubFavori, setPubFavori] = useState(null)        // { pubs, pubAJourAu } lus par le favori
  const [etatFavori, setEtatFavori] = useState(null)      // { etape: 'attente'|'pret'|'lecture'|'erreur', texte }
  const semaines = useMemo(() => semainesProposees(aujourdhuiISO()), [])
  const [semaine, setSemaine] = useState(null)

  useEffect(() => {
    if (!partenaire) return
    setFichier(null); setSeuil(null); setPeriode(null); setCodes({}); setErreur(null); setPubFavori(null)
  }, [partenaire])

  // Mode favori : la fenêtre a été ouverte par le favori depuis le portail Yango.
  useEffect(() => {
    if (!favori) return
    const opener = typeof window !== 'undefined' ? window.opener : null
    if (!opener) {
      setEtatFavori({ etape: 'erreur', texte: 'Cette fenêtre s’ouvre en cliquant sur le favori « Ventes Yango », depuis le portail Yango.' })
      return
    }
    setEtatFavori({ etape: 'attente', texte: 'Connexion au favori…' })
    function ecoute(e) {
      if (!messageValide(e, opener)) return
      const d = e.data
      if (d.type === 'favori') setEtatFavori({ etape: 'pret', texte: '' })
      else if (d.type === 'progression') setEtatFavori({ etape: 'lecture', texte: String(d.texte || '') })
      else if (d.type === 'erreur') setEtatFavori({ etape: 'erreur', texte: String(d.message || 'La lecture Yango n’a pas abouti.') })
      else if (d.type === 'ventes' && Array.isArray(d.lignes) && d.periode?.debut) {
        setFichier({ nom: `Favori Yango du ${formatDateFR(aujourdhuiISO())}`, lignes: d.lignes })
        setSeuil(null)
        setPeriode(periodeDe('yango', d.periode.debut))
        setPubFavori({ pubs: Array.isArray(d.pubs) ? d.pubs : [], pubAJourAu: d.pubAJourAu || null })
        setEtatFavori({ etape: 'pret', texte: '' })
      }
    }
    window.addEventListener('message', ecoute)
    opener.postMessage({ type: 'pret' }, ORIGINE_YANGO)
    return () => window.removeEventListener('message', ecoute)
  }, [favori])

  function lireSemaine(s) {
    setErreur(null)
    setEtatFavori({ etape: 'lecture', texte: 'Lecture sur le portail Yango…' })
    window.opener?.postMessage({ type: 'lire', debut: s.debut, fin: s.fin }, ORIGINE_YANGO)
  }

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
      for (const code of [...Object.keys(analyse.parCode), ...Object.keys(pubParCode(pubFavori?.pubs))]) {
        if (out[code] === undefined && connus[code]) out[code] = connus[code]
      }
      return out
    })
    if (!periode && analyse.j1) {
      // Yango : l'export part du jeudi (veille de la semaine) ; Glovo : du 1er jour.
      setPeriode(periodeDe(partenaire, partenaire === 'yango' ? ajouterJours(analyse.j1, 1) : analyse.j1))
    }
  }, [analyse, pubFavori])

  if (!partenaire) return null
  const info = INFOS_PARTENAIRE[partenaire]

  async function choisir() {
    setErreur(null)
    setLecture(true)
    try {
      const f = await choisirEtLireExcel()
      if (f) { setFichier(f); setPeriode(null); setSeuil(null); setPubFavori(null) }
    } catch (e) {
      setErreur(`Fichier illisible : ${e?.message || 'format inconnu'}.`)
    } finally {
      setLecture(false)
    }
  }

  // Codes des ventes, plus ceux de la pub lue par le favori (à associer aussi).
  const codesExport = analyse && !analyse.erreur
    ? [...new Set([...Object.keys(analyse.parCode), ...Object.keys(pubParCode(pubFavori?.pubs))])]
    : []
  const totauxCode = code => analyse.parCode[code] || { nb: 0, montant: 0, paye: 0 }
  const manquants = codesExport.filter(c => !codes[c])
  const choixPeriodes = periode
    ? [periodeDe(partenaire, ajouterJours(periode.debut, -1)), periode, periodeDe(partenaire, ajouterJours(periode.fin, 1))]
    : []
  const dejaImporte = periode && donnees.partenaires.imports.some(i => i.partenaire === partenaire && i.periode_debut === periode.debut)
  const dejaSaisie = periode
    ? donnees.partenaires.lignes
      .filter(l => l.partenaire === 'yango' && l.type === 'pub' && l.periode_debut === periode.debut)
      .reduce((s, l) => s + Number(l.montant || 0), 0)
    : 0
  const pub = partenaire === 'yango' && pubFavori && periode
    ? etatPub({ ...pubFavori, periode, codes, dejaSaisie })
    : null

  async function confirmer() {
    if (!periode) { Alert.alert('Période manquante', 'Choisissez la période de cet export.'); return }
    if (manquants.length) { Alert.alert('Restaurants à associer', 'Associez chaque code à un restaurant (ou ignorez-le).'); return }
    // Plusieurs codes peuvent tomber sur le même restaurant : on additionne.
    const parResto = {}
    for (const code of codesExport) {
      const r = codes[code]
      if (r === 'ignorer') continue
      const t = totauxCode(code)
      if (!t.nb) continue
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
          annulees_payees: analyse.annuleesPayees ?? null,
        },
        lignes: Object.values(parResto),
      }, user)
      if (pub?.statut === 'a_jour') {
        await ajouterPubs({ partenaire: 'yango', periodeDebut: periode.debut, parts: pub.parts, note: 'Lue sur le portail Yango' }, user)
      }
      await apres()
      onFermer()
    } catch (e) {
      Alert.alert('Import non enregistré', e?.message || 'Réessayez.')
    } finally {
      setOccupe(false)
    }
  }

  const restos = [...donnees.restaurants.map(r => ({ valeur: r.id, label: r.nom })), { valeur: 'ignorer', label: 'Ignorer' }]
  const totalPaye = codesExport.reduce((s, c) => s + (codes[c] === 'ignorer' ? 0 : totauxCode(c).paye), 0)

  return (
    <Feuille visible onFermer={onFermer} titre={`Importer l'export ${info.nom}`}>
      <Text style={[styles.petit, { marginBottom: 10 }]}>
        {partenaire === 'yango'
          ? "Export brut Yango (du jeudi au vendredi). L'app garde la fenêtre 22h → 22h (21h en hiver), retire les commandes non payables (les annulées que Yango paie quand même sont comptées), puis applique Montant × 0,77."
          : "Export brut Glovo (orderDetails). L'app retire les commandes non payables, puis calcule PAYE = vente − commission 29,5 % − frais opérationnels − frais d'annonces − frais d'attente."}
      </Text>
      {favori && (
        <View style={[styles.carte, { marginBottom: 10 }]}>
          <Text style={styles.lbl}>Lire une semaine sur le portail Yango</Text>
          {!!etatFavori?.texte && (
            <Text style={[etatFavori.etape === 'erreur' ? styles.erreur : styles.petit, { marginTop: 6 }]}>{etatFavori.texte}</Text>
          )}
          {etatFavori && etatFavori.etape !== 'attente' && window.opener ? (
            <>
              <Puces options={semaines.map(s => ({ valeur: s.debut, label: libellePeriode(s) }))}
                valeur={semaine?.debut} onChange={d => setSemaine(semaines.find(s => s.debut === d))} />
              <Bouton titre={semaine ? `Lire la semaine ${libellePeriode(semaine)}` : 'Choisissez une semaine'}
                onPress={() => lireSemaine(semaine)} desactive={!semaine || etatFavori.etape === 'lecture'}
                occupe={etatFavori.etape === 'lecture'} />
            </>
          ) : null}
        </View>
      )}
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
            {!!analyse.annuleesPayees && (
              <Text style={styles.petit}>Dont {analyse.annuleesPayees} annulée{analyse.annuleesPayees > 1 ? 's' : ''} que Yango paie : comptée{analyse.annuleesPayees > 1 ? 's' : ''}</Text>
            )}
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
            const tot = totauxCode(code)
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

          {pub && (
            <View style={styles.carte}>
              <Text style={styles.lbl}>Pub Yango</Text>
              {pub.statut === 'a_jour' && (
                <>
                  <Text style={styles.petit}>Lue sur le portail : enregistrée avec l'import.</Text>
                  {Object.entries(pub.parCode).map(([code, m]) => (
                    <Ligne key={code} label={code === '?' ? 'Noms inconnus' : code} valeur={m} signe="-" />
                  ))}
                  <Ligne label="Total pub" valeur={pub.total} signe="-" fort />
                </>
              )}
              {pub.statut === 'pas_a_jour' && (
                <Text style={[styles.petit, { color: colors.error }]}>
                  {pubFavori.pubAJourAu
                    ? `Yango n'a compté la pub que jusqu'au ${formatDateFR(pubFavori.pubAJourAu)} : elle n'est pas enregistrée. Recliquez sur le favori plus tard, ou saisissez-la à la main.`
                    : "Yango n'a encore compté aucune pub pour cette semaine : elle n'est pas enregistrée. Recliquez sur le favori plus tard, ou saisissez-la à la main."}
                </Text>
              )}
              {pub.statut === 'deja_saisie' && (
                <Text style={styles.petit}>Pub déjà saisie pour cette semaine : {fmt(dejaSaisie)} F. Rien n'est ajouté.</Text>
              )}
              {pub.statut === 'aucune' && <Text style={styles.petit}>Aucune pub Yango cette semaine.</Text>}
            </View>
          )}

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
}
