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
import { Alert, Image, SafeAreaView, ScrollView, Text, TouchableOpacity, View } from 'react-native'

import {
  Bouton, Champ, ChampMontant, Entete, EtatEcran, Feuille, Puces, useStylesTreso, useTresorerie,
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
    Alert.alert('Supprimer cette dépense ?', `${categorieDirection(dep.categorie)?.label} · ${fmt(dep.montant)} F. La sortie liée (banque ou coffre) est retirée aussi.`, [
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
        <View style={styles.carte}>
          <View style={styles.ligne}>
            <Text style={styles.lbl}>À payer · autres charges</Text>
            <Text style={[styles.ligneValeur, { color: totalAPayer ? colors.error : colors.success }]}>{fmt(totalAPayer)} F</Text>
          </View>
          {aPayer.length === 0 && <Text style={styles.petit}>Rien à payer. Notez ici une charge avant de la payer.</Text>}
          {aPayer.map(x => {
            const p = parDu[x.id] || []
            const st = classement[x.id] || 'a_payer'
            return (
              <TouchableOpacity key={x.id} style={styles.item} onPress={() => setDetail(x)}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemTitre}>{x.libelle || 'Autre charge'} · {nomResto(x.restaurant_id)}</Text>
                  <Text style={styles.petit}>
                    {categorieDirection(x.categorie_direction)?.label || 'Autre'}
                    {totalPaye(p) > 0 ? ` · payé ${fmt(totalPaye(p))}` : ''} · <Text style={{ fontWeight: '800', color: colors.text }}>reste {fmt(resteDu(x, p))}</Text>
                  </Text>
                </View>
                <Badge c={cs[st]} />
              </TouchableOpacity>
            )
          })}
          <Bouton secondaire titre="+ Charge à payer" onPress={() => setCharge({})} style={{ marginTop: 8 }} />
        </View>
        <Bouton titre="+ Nouvelle dépense direction (déjà payée)" onPress={() => setSaisie(true)} style={{ marginBottom: 12 }} />
        {parMois.length === 0 && <Text style={styles.vide}>Aucune dépense direction.</Text>}
        {parMois.map(([m, deps]) => (
          <View key={m} style={styles.carte}>
            <View style={styles.ligne}>
              <Text style={styles.lbl}>{libelleMois(`${m}-01`)}</Text>
              <Text style={styles.ligneValeur}>{fmt(deps.reduce((s, x) => s + Number(x.montant || 0), 0))} F</Text>
            </View>
            {deps.map(dep => (
              <TouchableOpacity key={dep.id} style={styles.item} onLongPress={() => supprimer(dep)} delayLongPress={500}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemTitre}>{categorieDirection(dep.categorie)?.label} · {nomResto(dep.restaurant_id)}</Text>
                  <Text style={styles.petit}>
                    {formatDateFR(dep.date)} · {dep.source === 'compte' ? nomCompte(dep.compte_id) : dep.source === 'coffre' ? 'coffre' : 'espèces'}
                    {dep.note ? ` · ${dep.note}` : ''}{dep.photo_url ? ' · 📷' : ''}
                  </Text>
                  <Text style={[styles.petit, { color: compteDansResultat(dep) ? colors.warningDark : colors.textMuted }]}>
                    {compteDansResultat(dep) ? 'compte dans le résultat du restaurant' : 'hors résultat des restaurants'}
                  </Text>
                </View>
                <Text style={[styles.ligneValeur, { color: colors.error }]}>− {fmt(dep.montant)}</Text>
              </TouchableOpacity>
            ))}
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
      <Puces options={CATEGORIES_DIRECTION.map(c => ({ valeur: c.id, label: c.label }))} valeur={categorie} onChange={setCategorie} />
      {cat?.aide && <Text style={[styles.petit, { marginTop: -6, marginBottom: 10 }]}>{cat.aide}</Text>}
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
            {compteDansResultat({ categorie, restaurant_id: restaurantId })
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
