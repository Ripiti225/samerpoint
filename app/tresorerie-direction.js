// ──────────────────────────────────────────────────────────────────────────────
// Trésorerie — Dépenses direction (M. Zreik seul).
//
// Chaque dépense sort de son compte (Espèces, BACI ou SIB). Le coffre n'est
// plus une source : on emprunte au coffre (avec date de remboursement), puis on
// paie depuis le compte. Réparation, matériel et équipement d'un restaurant
// comptent dans son résultat ; fond, investissement et retrait perso non.
//
// En tête : les autres charges notées AVANT d'être payées (catégorie « autre »
// de tresorerie_dus) : jamais en dette récente, passées en Dette à la main.
// ──────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react'
import { Alert, Image, SafeAreaView, ScrollView, Text, View } from 'react-native'

import {
  Bouton, Champ, ChampMontant, Entete, EtatEcran, Feuille, Hero, HeroCase, ItemIcone, Puces, TitreSection,
  useStylesTreso, useTresorerie,
} from '../components/tresorerie/commun'
import { Badge, FeuilleDetail, FeuillePaiement, FeuillePrevision, couleursStatut } from '../components/tresorerie/du'
import {
  CATEGORIES_CHARGE_A_PAYER, CATEGORIES_DIRECTION, categorieDirection, compteDansResultat,
} from '../lib/direction'
import { usePhoto } from '../lib/usePhoto'
import {
  aujourdhuiISO, classerTous, fmt, formatDateFR, libelleMois, paiementsParDu, peut, resteDu, totalPaye,
} from '../lib/tresorerie'
import { ajouterDepenseDirection, enregistrerDu, supprimerDepenseDirection } from '../lib/tresorerieDb'

// Icône et couleur de chaque catégorie de dépense direction.
const STYLE_DEPENSE = {
  fond: { icone: 'cash-refund', couleur: '#0E9F6E' },
  fond_nature: { icone: 'package-variant-closed', couleur: '#D97706' },
  reparation: { icone: 'hammer-wrench', couleur: '#DC2626' },
  materiel: { icone: 'silverware-fork-knife', couleur: '#2563EB' },
  equipement: { icone: 'stove', couleur: '#7C3AED' },
  investissement: { icone: 'office-building-cog-outline', couleur: '#0891B2' },
  retrait_perso: { icone: 'account-arrow-right-outline', couleur: '#64748B' },
  divers: { icone: 'dots-horizontal-circle-outline', couleur: '#64748B' },
}
const styleDepense = id => STYLE_DEPENSE[id] || STYLE_DEPENSE.divers

export default function TresorerieDirectionScreen() {
  const { styles, colors } = useStylesTreso()
  const t = useTresorerie({ avecDirection: true })
  const { donnees, niveau, user, recharger } = t
  const [saisie, setSaisie] = useState(false)
  const [charge, setCharge] = useState(null)      // autre charge en création / modification
  const [detail, setDetail] = useState(null)      // autre charge ouverte
  const [paiement, setPaiement] = useState(null)  // { du, prevision? }
  const [prevoir, setPrevoir] = useState(null)    // autre charge dont on prévoit le paiement

  const aujourdhui = aujourdhuiISO()
  const parDu = useMemo(() => paiementsParDu(donnees?.paiements), [donnees])
  const classement = useMemo(
    () => (donnees ? classerTous(donnees.dus, donnees.paiements, aujourdhui) : {}),
    [donnees, aujourdhui],
  )
  const aPayer = (donnees?.dus || [])
    .filter(x => x.categorie === 'autre' && resteDu(x, parDu[x.id]) > 0)
    .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))
  const totalAPayer = aPayer.reduce((s, x) => s + resteDu(x, parDu[x.id]), 0)
  const cs = couleursStatut(colors)

  const d = donnees?.direction
  const nomResto = id => (id ? donnees?.restaurants.find(r => r.id === id)?.nom || '?' : 'Groupe')
  const nomCompte = id => donnees?.comptes.find(c => c.id === id)?.nom || '?'

  const parMois = useMemo(() => {
    const out = {}
    for (const dep of d?.depenses || []) (out[dep.date.slice(0, 7)] ||= []).push(dep)
    return Object.entries(out).sort((a, b) => b[0].localeCompare(a[0]))
  }, [d])

  function supprimer(dep) {
    const dejaCompte = dep.categorie === 'fond' && dep.point_id
      ? ' Ce fond est déjà compté dans un point validé : corrigez aussi ce point (Modifier le point).' : ''
    Alert.alert('Supprimer cette dépense ?', `${categorieDirection(dep.categorie)?.label} · ${fmt(dep.montant)} F. La sortie liée (banque ou coffre) est retirée aussi.${dejaCompte}`, [
      { text: 'Garder', style: 'cancel' },
      {
        text: 'Supprimer', style: 'destructive', onPress: async () => {
          try { await supprimerDepenseDirection(dep, user); await recharger() }
          catch (e) { Alert.alert('Suppression impossible', e?.message || 'Réessayez.') }
        },
      },
    ])
  }

  const bloque = (t.loading && !donnees) || t.erreur || !peut(niveau, 'voir_direction')
  let contenu
  if (bloque) contenu = <EtatEcran {...t} autorise={peut(niveau, 'voir_direction')} />
  else if (d === null) {
    contenu = (
      <View style={styles.centre}>
        <Text style={styles.erreur}>Les dépenses direction ne sont pas encore installées dans la base : il faut passer le fichier supabase_tresorerie_direction.sql dans Supabase.</Text>
      </View>
    )
  } else {
    contenu = (
      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContenu}>
        <Hero icone="briefcase" titre="Autres charges à payer" valeur={`${fmt(totalAPayer)} F`}
          sous={aPayer.length ? `${aPayer.length} charge${aPayer.length > 1 ? 's' : ''} notée${aPayer.length > 1 ? 's' : ''} avant d'être payée${aPayer.length > 1 ? 's' : ''}` : 'Rien à payer'}>
          <View style={styles.heroCases}>
            <HeroCase label="Dépenses ce mois" couleur="#FDE68A"
              valeur={fmt((parMois.find(([m]) => m === aujourdhui.slice(0, 7))?.[1] || []).reduce((x, dep) => x + Number(dep.montant || 0), 0))} />
          </View>
        </Hero>

        {aPayer.length > 0 && <TitreSection icone="clock-outline" couleur={colors.warningDark} titre="À payer" droite={`${fmt(totalAPayer)} F`} style={{ marginTop: 0 }} />}
        {aPayer.map(x => {
          const p = parDu[x.id] || []
          const st = classement[x.id] || 'a_payer'
          const sd = styleDepense(x.categorie_direction)
          return (
            <ItemIcone key={x.id} onPress={() => setDetail(x)} icone={sd.icone} couleur={sd.couleur}
              titre={`${x.libelle || 'Autre charge'} · ${nomResto(x.restaurant_id)}`}
              sous={`${categorieDirection(x.categorie_direction)?.label || 'Autre'}${totalPaye(p) > 0 ? ` · payé ${fmt(totalPaye(p))}` : ''}`}
              droite={`${fmt(resteDu(x, p))} F`}
              sousDroite={<Badge c={cs[st]} />}
            />
          )
        })}
        <View style={[styles.rangee, { marginBottom: 6, marginTop: 4 }]}>
          <Bouton style={{ flex: 1 }} secondaire icone="clock-plus-outline" titre="Charge à payer" onPress={() => setCharge({})} />
          <Bouton style={{ flex: 1 }} icone="plus" titre="Dépense payée" onPress={() => setSaisie(true)} />
        </View>

        {parMois.length === 0 && <Text style={styles.vide}>Aucune dépense direction.</Text>}
        {parMois.map(([m, deps]) => (
          <View key={m}>
            <TitreSection icone="calendar-month-outline" titre={libelleMois(`${m}-01`)}
              droite={`${fmt(deps.reduce((s2, x) => s2 + Number(x.montant || 0), 0))} F`} />
            {deps.map(dep => {
              const sd = styleDepense(dep.categorie)
              return (
                <ItemIcone key={dep.id} onLongPress={() => supprimer(dep)} icone={sd.icone} couleur={sd.couleur}
                  titre={`${categorieDirection(dep.categorie)?.label} · ${nomResto(dep.restaurant_id)}`}
                  sous={
                    <>
                      <Text style={styles.petit}>
                        {formatDateFR(dep.date)} · {dep.source === 'compte' ? nomCompte(dep.compte_id) : dep.source === 'coffre' ? 'coffre' : 'espèces'}
                        {dep.note ? ` · ${dep.note}` : ''}{dep.photo_url ? ' · photo' : ''}
                      </Text>
                      <Text style={[styles.petit, { color: compteDansResultat(dep) ? colors.warningDark : colors.textMuted, fontWeight: '600' }]}>
                        {dep.categorie === 'fond' && dep.restaurant_id
                          ? (dep.point_id ? 'fond en espèces · compté dans le FC reçu d\'un point validé' : 'fond en espèces · ira dans le FC reçu du prochain point')
                          : dep.categorie === 'fond_nature'
                            ? 'fond en nature · déduit du résultat du restaurant'
                            : compteDansResultat(dep) ? 'compte dans le résultat du restaurant' : 'hors résultat des restaurants'}
                      </Text>
                    </>
                  }
                  droite={`− ${fmt(dep.montant)}`} couleurDroite={colors.error}
                />
              )
            })}
          </View>
        ))}
        <Text style={styles.petit}>Appui long sur une dépense pour la supprimer.</Text>
      </ScrollView>
    )
  }

  return (
    <SafeAreaView style={styles.container}>
      <Entete titre="Dépenses direction" sous="M. Zreik seul" />
      {contenu}
      {donnees && d && (
        <FeuilleDepense visible={saisie} donnees={donnees} user={user}
          onFermer={() => setSaisie(false)} apres={recharger} />
      )}
      {donnees && (
        <>
          <FeuilleChargeAPayer du={charge} donnees={donnees} user={user} onFermer={() => setCharge(null)} apres={recharger} />
          <FeuilleDetail
            du={detail} paiements={detail ? parDu[detail.id] || [] : []} classement={detail ? classement[detail.id] : null}
            donnees={donnees} niveau={niveau} aujourdhui={aujourdhui} nomResto={nomResto} user={user}
            onFermer={() => setDetail(null)}
            onPayer={(x, prevision) => { setDetail(null); setPaiement({ du: x, prevision }) }}
            onModifier={x => { setDetail(null); setCharge(x) }}
            onPrevoir={x => { setDetail(null); setPrevoir(x) }}
            apres={recharger}
          />
          <FeuillePrevision du={prevoir} donnees={donnees} nomResto={nomResto} user={user}
            onFermer={() => setPrevoir(null)} apres={recharger} />
          <FeuillePaiement demande={paiement} donnees={donnees} parDu={parDu} nomResto={nomResto} user={user}
            onFermer={() => setPaiement(null)} apres={recharger} />
        </>
      )}
    </SafeAreaView>
  )
}

function FeuilleDepense({ visible, donnees, user, onFermer, apres }) {
  const { styles } = useStylesTreso()
  const { choisirPhoto } = usePhoto()
  const [categorie, setCategorie] = useState(null)
  const [restaurantId, setRestaurantId] = useState(undefined)
  const [source, setSource] = useState(null)
  const [montant, setMontant] = useState('')
  const [date, setDate] = useState(aujourdhuiISO())
  const [note, setNote] = useState('')
  const [photo, setPhoto] = useState(null)
  const [photoEnCours, setPhotoEnCours] = useState(false)
  const [occupe, setOccupe] = useState(false)

  if (!visible) return null
  const cat = categorieDirection(categorie)
  const estFond = categorie === 'fond' || categorie === 'fond_nature'
  const nomResto = restaurantId ? donnees.restaurants.find(r => r.id === restaurantId)?.nom || 'ce restaurant' : null

  function fermer() {
    setCategorie(null); setRestaurantId(undefined); setSource(null); setMontant(''); setDate(aujourdhuiISO()); setNote(''); setPhoto(null)
    onFermer()
  }

  async function ajouterPhoto() {
    setPhotoEnCours(true)
    const url = await choisirPhoto('photos')
    if (url) setPhoto(url)
    setPhotoEnCours(false)
  }

  async function enregistrer() {
    const v = montant === '' ? 0 : parseInt(montant, 10)
    if (!categorie) { Alert.alert('Catégorie manquante', 'Choisissez la catégorie.'); return }
    if (restaurantId === undefined) { Alert.alert('Restaurant manquant', 'Choisissez un restaurant ou « Groupe ».'); return }
    if (estFond && !restaurantId) { Alert.alert('Restaurant manquant', 'Un fond se donne à un restaurant : choisissez lequel.'); return }
    if (!source) { Alert.alert('Source manquante', 'D\'où part l\'argent ?'); return }
    if (!v) { Alert.alert('Montant manquant', 'Saisissez le montant.'); return }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { Alert.alert('Date invalide', 'Écrivez la date au format AAAA-MM-JJ.'); return }
    setOccupe(true)
    try {
      const estCompte = source !== 'especes'
      await ajouterDepenseDirection({
        date, categorie, restaurantId, montant: v,
        source: estCompte ? 'compte' : source, compteId: estCompte ? source : null,
        libelle: `${cat.label}${restaurantId ? ` · ${donnees.restaurants.find(r => r.id === restaurantId)?.nom}` : ' · Groupe'}${note.trim() ? ` · ${note.trim()}` : ''}`,
        note: note.trim(), photoUrl: photo,
      }, user)
      await apres()
      fermer()
    } catch (e) {
      Alert.alert('Non enregistrée', e?.message || 'Réessayez.')
    } finally {
      setOccupe(false)
    }
  }

  return (
    <Feuille visible onFermer={fermer} titre="Nouvelle dépense direction">
      <Text style={styles.label}>Catégorie</Text>
      {/* « Fond en nature » se choisit sous « Fond » (comment est donné le fond). */}
      <Puces options={CATEGORIES_DIRECTION.filter(c => c.id !== 'fond_nature').map(c => ({ valeur: c.id, label: c.label }))}
        valeur={estFond ? 'fond' : categorie} onChange={setCategorie} />
      {estFond && (
        <>
          <Text style={styles.label}>Comment est donné ce fond ?</Text>
          <Puces options={[
            { valeur: 'fond', label: 'En espèces · passe par le point' },
            { valeur: 'fond_nature', label: 'En nature · marchandise' },
          ]} valeur={categorie} onChange={setCategorie} />
        </>
      )}
      {cat?.aide && !estFond && <Text style={[styles.petit, { marginTop: -6, marginBottom: 10 }]}>{cat.aide}</Text>}
      <Text style={styles.label}>Restaurant</Text>
      <Puces options={[{ valeur: null, label: 'Groupe' }, ...donnees.restaurants.map(r => ({ valeur: r.id, label: r.nom }))]}
        valeur={restaurantId} onChange={setRestaurantId} />
      <Text style={styles.label}>Payé depuis</Text>
      <Puces options={[
        ...donnees.comptes.map(c => ({ valeur: c.id, label: c.nom })),
        // Ancienne option sans compte : seulement avant la migration des espèces.
        ...(donnees.comptes.some(c => c.nom === 'Espèces') ? [] : [{ valeur: 'especes', label: 'Espèces' }]),
      ]} valeur={source} onChange={setSource} />
      <ChampMontant label="Montant" valeur={montant} onChange={setMontant} />
      <Champ label="Date (AAAA-MM-JJ)" value={date} onChangeText={setDate} autoCapitalize="none" />
      <Champ label="Note (facultatif)" value={note} onChangeText={setNote} placeholder="Ex : compresseur frigo" />
      {photo ? <Image source={{ uri: photo }} style={{ width: '100%', height: 150, borderRadius: 10, marginBottom: 10 }} resizeMode="cover" /> : null}
      <Bouton secondaire titre={photo ? 'Changer la photo' : '📷 Ajouter une photo (facultatif)'} onPress={ajouterPhoto} occupe={photoEnCours} style={{ marginBottom: 12 }} />
      {cat && restaurantId !== undefined && (
        <View style={styles.avert}>
          <Text style={styles.avertTxt}>
            {categorie === 'fond' && nomResto
              ? `Le fond remplira tout seul le « FC reçu » du point du ${formatDateFR(date)} de ${nomResto} (ou du prochain point, s'il est déjà validé). Ce que le restaurant achète avec est déjà dans ses dépenses : le fond n'est pas déduit de son résultat.`
              : categorie === 'fond_nature' && nomResto
                ? `La marchandise ne passe pas par le point de ${nomResto} : elle sera déduite de son résultat de ${/^\d{4}-\d{2}/.test(date) ? libelleMois(`${date.slice(0, 7)}-01`).toLowerCase() : 'ce mois'} comme une charge.`
                : compteDansResultat({ categorie, restaurant_id: restaurantId })
                  ? 'Cette dépense réduira le résultat net du restaurant.'
                  : 'Cette dépense ne touche pas le résultat des restaurants.'}
          </Text>
        </View>
      )}
      <Bouton titre="Enregistrer" onPress={enregistrer} occupe={occupe} />
    </Feuille>
  )
}

// Autre charge notée avant d'être payée : catégorie, restaurant ou Groupe,
// libellé, montant. Elle se paie ensuite depuis son détail (une ou plusieurs fois).
function FeuilleChargeAPayer({ du, donnees, user, onFermer, apres }) {
  const { styles } = useStylesTreso()
  const [categorie, setCategorie] = useState(null)
  const [restaurantId, setRestaurantId] = useState(undefined)
  const [libelle, setLibelle] = useState('')
  const [montant, setMontant] = useState('')
  const [note, setNote] = useState('')
  const [occupe, setOccupe] = useState(false)

  useEffect(() => {
    if (!du) return
    setCategorie(du.categorie_direction || null)
    setRestaurantId(du.id ? du.restaurant_id || null : undefined)
    setLibelle(du.libelle || '')
    setMontant(du.montant_du != null ? String(du.montant_du) : '')
    setNote(du.note || '')
  }, [du])

  if (!du) return null
  const cat = categorieDirection(categorie)

  async function enregistrer() {
    const v = montant === '' ? 0 : parseInt(montant, 10)
    if (!categorie) { Alert.alert('Catégorie manquante', 'Choisissez la catégorie.'); return }
    if (restaurantId === undefined) { Alert.alert('Restaurant manquant', 'Choisissez un restaurant ou « Groupe ».'); return }
    if (!libelle.trim()) { Alert.alert('Libellé manquant', 'Dites ce qu\'il faut payer, par exemple « Facture électricité ».'); return }
    if (!v) { Alert.alert('Montant manquant', 'Saisissez le montant à payer.'); return }
    setOccupe(true)
    try {
      await enregistrerDu({
        id: du.id, categorie: 'autre', restaurant_id: restaurantId, libelle: libelle.trim(),
        categorie_direction: categorie, montant_du: v, note: note.trim(),
      }, user)
      await apres()
      onFermer()
    } catch (e) {
      Alert.alert('Non enregistrée', e?.message || 'Réessayez.')
    } finally {
      setOccupe(false)
    }
  }

  return (
    <Feuille visible onFermer={onFermer} titre={du.id ? 'Modifier la charge à payer' : 'Charge à payer'}>
      <Text style={styles.label}>Catégorie</Text>
      <Puces options={CATEGORIES_CHARGE_A_PAYER.map(c => ({ valeur: c.id, label: c.label }))} valeur={categorie} onChange={setCategorie} />
      {cat?.aide && <Text style={[styles.petit, { marginTop: -6, marginBottom: 10 }]}>{cat.aide}</Text>}
      <Text style={styles.label}>Restaurant</Text>
      <Puces options={[{ valeur: null, label: 'Groupe' }, ...donnees.restaurants.map(r => ({ valeur: r.id, label: r.nom }))]}
        valeur={restaurantId} onChange={setRestaurantId} />
      <Champ label="Libellé" value={libelle} onChangeText={setLibelle} placeholder="Ex : facture électricité" />
      <ChampMontant label="Montant à payer" valeur={montant} onChange={setMontant} />
      <Champ label="Note (facultatif)" value={note} onChangeText={setNote} />
      {cat && restaurantId !== undefined && (
        <View style={styles.avert}>
          <Text style={styles.avertTxt}>
            {compteDansResultat({ categorie, restaurant_id: restaurantId })
              ? 'Une fois payée, elle réduira le résultat net du restaurant (mois du paiement).'
              : 'Elle ne touchera pas le résultat des restaurants.'}
          </Text>
        </View>
      )}
      <Text style={[styles.petit, { marginBottom: 10 }]}>Pas de date limite : elle ne passe jamais en dette récente. Vous pouvez la passer en Dette depuis son détail.</Text>
      <Bouton titre="Enregistrer" onPress={enregistrer} occupe={occupe} />
    </Feuille>
  )
}
