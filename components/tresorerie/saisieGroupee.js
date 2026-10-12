// ──────────────────────────────────────────────────────────────────────────────
// Trésorerie — saisie groupée : tous les restaurants sur un seul écran.
//  - un mois de salaires, CNPS, timbre, ITS ou TEE : un montant par restaurant ;
//  - une année de baux : montant + date limite par restaurant.
// Une ligne déjà saisie apparaît préremplie et se corrige ici, sauf si un
// paiement a déjà été fait (elle se corrige alors depuis son détail).
// Logique : planSaisieGroupee / planSaisieBaux (lib/tresorerie.js).
// ──────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react'
import { Alert, Text, TextInput, TouchableOpacity, View } from 'react-native'

import { CalendrierFr } from '../ChampDate'

import {
  CATEGORIES_MONTANT_FIXE, LIBELLES_CATEGORIE, aujourdhuiISO, fmt, jourCommun, libelleMois, moisEntre,
  paiementsParDu, planSaisieBaux, planSaisieGroupee, premierDuMois,
} from '../../lib/tresorerie'
import { cotisationPourCategorie, cotiseParDu } from '../../lib/cotisations'
import { chargerLitigesRestaurant } from '../../lib/litigesGlobal'
import { lireRegleRetenue } from '../../lib/retenueLitiges'
import { supabase } from '../../lib/supabase'
import { appliquerPlanDus, enregistrerChargeFixe, enregistrerRetenueLitiges, recevoirCotisation } from '../../lib/tresorerieDb'
import { Bouton, Feuille, Puces, useStylesTreso } from './commun'

const TITRES = {
  salaire: 'État de salaires',
  cnps: 'Déclaration CNPS',
  impot: 'Timbre du mois',
  its: 'ITS du mois',
  tee: 'TEE du mois',
}

const lireMontant = t => (t === '' || t == null ? null : parseInt(t, 10) || 0)

// Le restaurant à gauche, ses champs en face.
function Rangee({ nom, children }) {
  const { styles } = useStylesTreso()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
      <Text style={[styles.itemTitre, { flex: 1 }]} numberOfLines={2}>{nom}</Text>
      {children}
    </View>
  )
}

function Saisie({ valeur, onChange, placeholder, largeur, montant = false }) {
  const { styles, colors } = useStylesTreso()
  return (
    <TextInput
      style={[styles.input, { width: largeur, textAlign: 'right', paddingVertical: 9 }]}
      value={valeur}
      onChangeText={t => onChange(montant ? t.replace(/[^\d]/g, '') : t)}
      keyboardType={montant ? 'number-pad' : 'numbers-and-punctuation'}
      placeholder={placeholder}
      placeholderTextColor={colors.textMuted}
    />
  )
}

// Ligne verrouillée : un paiement existe, on n'y touche pas d'ici.
function LigneEntamee({ nom, montant }) {
  const { styles } = useStylesTreso()
  return (
    <View style={[styles.item, { marginBottom: 8 }]}>
      <Text style={[styles.itemTitre, { flex: 1 }]}>{nom}</Text>
      <Text style={styles.petit}>{fmt(montant)} F · déjà payé en partie, à corriger depuis son détail</Text>
    </View>
  )
}

// ── Un mois, tous les restaurants ────────────────────────────────────────────

export function FeuilleSaisieMois({ categorie, donnees, user, onFermer, apres }) {
  const { styles, colors } = useStylesTreso()
  const courant = premierDuMois(aujourdhuiISO())
  const [mois, setMois] = useState(null)
  const [valeurs, setValeurs] = useState({})
  // « dont cotisé » : ce que chaque restaurant remet au RH aujourd'hui (lib/cotisations.js).
  const [cotises, setCotises] = useState({})
  // Salaires : retenue sur les litiges du mois (« 30% » ou un montant) par restaurant.
  const [litiges, setLitiges] = useState(null)   // { [restaurant_id]: total } une fois calculés
  const [retenues, setRetenues] = useState({})
  const [occupe, setOccupe] = useState(false)

  const parDu = useMemo(() => paiementsParDu(donnees.paiements), [donnees])
  const dejaCotise = useMemo(() => cotiseParDu(donnees.cotisations || []), [donnees])
  const ligneDe = restaurantId => donnees.dus.find(d => d.categorie === categorie && d.restaurant_id === restaurantId && d.mois === mois)
  const cotisationsActives = Array.isArray(donnees.cotisations)

  // Post-payé : on saisit d'habitude le mois écoulé (l'état de septembre en octobre).
  useEffect(() => {
    if (categorie) setMois(moisEntre('2000-01-01', courant).slice(-2)[0])
  }, [categorie])

  // Préremplissage : la ligne du mois si elle existe ; sinon, pour un montant
  // fixe (timbre, ITS, TEE), le montant réglé du restaurant.
  useEffect(() => {
    if (!categorie || !mois) return
    const fixes = Object.fromEntries((donnees.chargesFixes || [])
      .filter(f => f.categorie === categorie && f.actif).map(f => [f.restaurant_id, f.montant]))
    setValeurs(Object.fromEntries(donnees.restaurants.map(r => {
      const d = ligneDe(r.id)
      const v = d ? d.montant_du : CATEGORIES_MONTANT_FIXE.includes(categorie) ? fixes[r.id] : null
      return [r.id, v != null ? String(v) : '']
    })))
    setCotises({})
    setRetenues(Object.fromEntries(donnees.restaurants.map(r => [r.id, ligneDe(r.id)?.retenue_regle || ''])))
  }, [categorie, mois])

  // Litiges du mois de chaque restaurant (mêmes calculs que l'écran Litiges).
  useEffect(() => {
    if (categorie !== 'salaire' || !mois) return
    let vivant = true
    setLitiges(null)
    const debut = String(mois).slice(0, 10)
    const [a, m] = debut.split('-').map(Number)
    const fin = `${debut.slice(0, 7)}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, '0')}`
    Promise.all(donnees.restaurants.map(r => chargerLitigesRestaurant(r, debut, fin).then(d => [r.id, Math.round(d.total || 0)]).catch(() => [r.id, 0])))
      .then(l => { if (vivant) setLitiges(Object.fromEntries(l)) })
    return () => { vivant = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categorie, mois])

  if (!categorie) return null

  const choixMois = [...moisEntre('2000-01-01', courant).slice(-12), ...moisEntre(courant, '2999-12-01').slice(1, 2)]
    .reverse().map(m => ({ valeur: m, label: libelleMois(m) }))
  const entamee = r => { const d = ligneDe(r.id); return d && parDu[d.id]?.length ? d : null }
  const total = donnees.restaurants.reduce((s, r) => {
    const d = entamee(r)
    return s + (d ? Number(d.montant_du) : lireMontant(valeurs[r.id]) || 0)
  }, 0)

  async function enregistrer() {
    const montants = {}
    for (const r of donnees.restaurants) if (!entamee(r)) montants[r.id] = lireMontant(valeurs[r.id])
    const plan = planSaisieGroupee({
      categorie, mois, montants, jour: jourCommun(donnees.echeances, categorie),
      dus: donnees.dus, paiements: donnees.paiements,
    })
    const aCotiser = donnees.restaurants.map(r => ({ r, montant: lireMontant(cotises[r.id]) || 0 })).filter(x => x.montant > 0)
    // Retenues sur litiges modifiées (salaires seulement).
    const aRetenir = categorie === 'salaire' && litiges ? donnees.restaurants.map(r => {
      const avant = ligneDe(r.id)?.retenue_regle || ''
      const texte = (retenues[r.id] || '').trim()
      if (texte === avant) return null
      return { r, texte, lecture: lireRegleRetenue(texte, litiges[r.id] || 0) }
    }).filter(Boolean) : []
    const erreurRetenue = aRetenir.find(x => x.lecture.erreur)
    if (erreurRetenue) { Alert.alert(`Retenue · ${erreurRetenue.r.nom}`, erreurRetenue.lecture.erreur); return }
    const rienAuPlan = !plan.aCreer.length && !plan.aModifier.length && !plan.aSupprimer.length
    if (rienAuPlan && !aCotiser.length && !aRetenir.length) {
      Alert.alert('Rien à enregistrer', 'Aucun montant n\'a changé.'); return
    }
    setOccupe(true)
    try {
      if (!rienAuPlan) await appliquerPlanDus(plan, user, { categorie, mois })
      if (aCotiser.length || aRetenir.length) {
        // Les lignes du mois, à jour (celles qu'on vient de créer comprises).
        const { data: lignes, error } = await supabase.from('tresorerie_dus').select('*')
          .eq('categorie', categorie).eq('mois', mois)
        if (error) throw error
        for (const { r, lecture } of aRetenir) {
          const du = (lignes || []).find(d => d.restaurant_id === r.id)
          if (!du) throw new Error(`${r.nom} : saisissez d'abord le montant des salaires avant la retenue.`)
          await enregistrerRetenueLitiges(lecture.vide
            ? { du, total: 0, regle: null, retenu: 0 }
            : { du, total: litiges[r.id] || 0, regle: lecture.regle, retenu: lecture.retenu }, user)
        }
        const especes = (donnees.comptes || []).find(c => c.nom === 'Espèces')
        for (const { r, montant } of aCotiser) {
          const du = (lignes || []).find(d => d.restaurant_id === r.id)
          if (!du) throw new Error(`${r.nom} : saisissez d'abord le montant du mois avant la part cotisée.`)
          await recevoirCotisation({
            du, montant, date: aujourdhuiISO(), compteEspecesId: especes?.id, nomResto: r.nom,
            fournisseur: cotisationPourCategorie(categorie, donnees.fournisseurs, r.id),
          }, user)
        }
      }
      await apres()
      onFermer()
    } catch (e) {
      Alert.alert('Non enregistré', e?.message || 'Réessayez.')
      // Une partie a pu être enregistrée : repartir de l'état réel.
      apres().catch(() => {})
    } finally {
      setOccupe(false)
    }
  }

  const jour = jourCommun(donnees.echeances, categorie)
  return (
    <Feuille visible onFermer={onFermer} titre={TITRES[categorie] || LIBELLES_CATEGORIE[categorie]}>
      <Text style={styles.label}>Mois concerné</Text>
      <Puces options={choixMois} valeur={mois} onChange={setMois} />
      {mois && (
        <Text style={[styles.petit, { marginBottom: 12 }]}>
          À payer avant le {jour} du mois suivant. {CATEGORIES_MONTANT_FIXE.includes(categorie)
            ? 'Champ vide = 0 F ce mois-ci (la ligne se crée chaque mois toute seule).'
            : 'Champ vide = pas de ligne pour ce restaurant ce mois-ci.'}
        </Text>
      )}
      {mois && cotisationsActives && (
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginBottom: 4 }}>
          <Text style={[styles.label, { width: 130, textAlign: 'right', marginBottom: 0 }]}>Montant du mois</Text>
          <Text style={[styles.label, { width: 110, textAlign: 'right', marginBottom: 0 }]}>Dont cotisé</Text>
        </View>
      )}
      {mois && donnees.restaurants.map(r => {
        const d = entamee(r)
        const ligne = ligneDe(r.id)
        const deja = ligne ? dejaCotise[ligne.id] || 0 : 0
        const champCotise = cotisationsActives ? (
          <Saisie montant largeur={110} valeur={cotises[r.id] ?? ''} placeholder="0"
            onChange={v => setCotises(x => ({ ...x, [r.id]: v }))} />
        ) : null
        return (
          <View key={r.id}>
            {d ? (
              <Rangee nom={r.nom}>
                <Text style={[styles.petit, { width: 130, textAlign: 'right' }]}>{fmt(d.montant_du)} F · déjà payé en partie</Text>
                {champCotise}
              </Rangee>
            ) : (
              <Rangee nom={r.nom}>
                <Saisie montant largeur={cotisationsActives ? 130 : 150} valeur={valeurs[r.id] ?? ''} placeholder="0"
                  onChange={v => setValeurs(x => ({ ...x, [r.id]: v }))} />
                {champCotise}
              </Rangee>
            )}
            {deja > 0 && (
              <Text style={[styles.petit, { textAlign: 'right', marginTop: -4, marginBottom: 8, color: colors.successDark }]}>
                déjà {fmt(deja)} F cotisés reçus pour ce mois
              </Text>
            )}
            {categorie === 'salaire' && (() => {
              const total = litiges?.[r.id]
              const lecture = litiges ? lireRegleRetenue(retenues[r.id], total || 0) : null
              return (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: -2, marginBottom: 10 }}>
                  <Text style={[styles.petit, { flex: 1, marginTop: 0 }]}>
                    {litiges === null ? 'Litiges du mois : calcul…'
                      : `Litiges ${fmt(total || 0)} F${lecture && !lecture.vide && !lecture.erreur ? ` · retenu ${fmt(lecture.retenu)} · annulé ${fmt(lecture.annule)}` : ''}`}
                    {lecture?.erreur ? <Text style={{ color: colors.error }}>{` · ${lecture.erreur}`}</Text> : null}
                  </Text>
                  <Saisie largeur={110} valeur={retenues[r.id] ?? ''} placeholder="Retenue"
                    onChange={v => setRetenues(x => ({ ...x, [r.id]: v }))} />
                </View>
              )
            })()}
          </View>
        )
      })}
      {mois && categorie === 'salaire' && (
        <Text style={[styles.petit, { marginBottom: 6 }]}>
          « Retenue » : la part des litiges du mois retenue sur les salaires du restaurant, en pourcentage (30%) ou en
          montant (40000). Le reste des litiges est annulé. Les salaires à payer baissent d'autant ; le résultat garde
          la charge entière et compte la retenue en revenu.
        </Text>
      )}
      {mois && cotisationsActives && (
        <Text style={[styles.petit, { marginBottom: 6 }]}>
          « Dont cotisé » : l'argent que le restaurant vous remet aujourd'hui. Il entre dans les espèces, le solde de sa
          cotisation baisse, et son résultat ne déduit plus que le reste.
        </Text>
      )}
      <View style={[styles.ligne, { marginVertical: 10 }]}>
        <Text style={styles.ligneLabel}>Total {mois ? libelleMois(mois) : ''}</Text>
        <Text style={[styles.ligneValeur, { color: colors.text }]}>{fmt(total)} F</Text>
      </View>
      <Bouton titre="Enregistrer" onPress={enregistrer} occupe={occupe} />
    </Feuille>
  )
}

// ── Une année de baux, tous les restaurants ──────────────────────────────────

// « 20/11 » → { jour: 20, mois: 11 } ; null si la date n'est pas lisible.
function lireDate(texte) {
  const m = String(texte || '').trim().match(/^(\d{1,2})\s*[/.-]\s*(\d{1,2})$/)
  if (!m) return null
  const jour = Number(m[1])
  const mois = Number(m[2])
  return jour >= 1 && jour <= 31 && mois >= 1 && mois <= 12 ? { jour, mois } : null
}

const jjmm = (jour, mois) => `${String(jour).padStart(2, '0')}/${String(mois).padStart(2, '0')}`
const deux = n => String(n).padStart(2, '0')

export function FeuilleSaisieBaux({ visible, donnees, user, onFermer, apres }) {
  const { styles, colors } = useStylesTreso()
  const anCourant = Number(aujourdhuiISO().slice(0, 4))
  const [an, setAn] = useState(anCourant)
  const [valeurs, setValeurs] = useState({})   // { [restaurant_id]: { montant, date } }
  const [occupe, setOccupe] = useState(false)
  const [calendrierPour, setCalendrierPour] = useState(null)   // restaurant dont le calendrier est ouvert

  const parDu = useMemo(() => paiementsParDu(donnees.paiements), [donnees])
  const ligneDe = restaurantId => donnees.dus.find(d => d.categorie === 'bail' && d.restaurant_id === restaurantId && d.mois?.startsWith(`${an}-`))

  // Préremplissage : la ligne de l'année si elle existe, sinon le réglage du restaurant.
  useEffect(() => {
    if (!visible) return
    const fixes = Object.fromEntries((donnees.chargesFixes || [])
      .filter(f => f.categorie === 'bail' && f.actif).map(f => [f.restaurant_id, f]))
    setValeurs(Object.fromEntries(donnees.restaurants.map(r => {
      const d = ligneDe(r.id)
      const f = fixes[r.id]
      if (d) return [r.id, { montant: String(d.montant_du), date: jjmm(Number(d.echeance.slice(8, 10)), Number(d.echeance.slice(5, 7))) }]
      if (f) return [r.id, { montant: String(f.montant), date: jjmm(f.bail_jour, f.bail_mois) }]
      return [r.id, { montant: '', date: '' }]
    })))
  }, [visible, an])

  if (!visible) return null

  const entamee = r => { const d = ligneDe(r.id); return d && parDu[d.id]?.length ? d : null }
  const maj = (id, k, v) => setValeurs(x => ({ ...x, [id]: { ...(x[id] || {}), [k]: v } }))
  const total = donnees.restaurants.reduce((s, r) => {
    const d = entamee(r)
    return s + (d ? Number(d.montant_du) : lireMontant(valeurs[r.id]?.montant) || 0)
  }, 0)

  async function enregistrer() {
    const saisies = {}
    for (const r of donnees.restaurants) {
      if (entamee(r)) continue
      const v = valeurs[r.id] || {}
      const montant = lireMontant(v.montant)
      if (!montant) { saisies[r.id] = null; continue }
      const date = lireDate(v.date)
      if (!date) {
        Alert.alert('Date limite manquante', `${r.nom} : choisissez la date limite dans le calendrier (📅).`); return
      }
      saisies[r.id] = { montant, ...date }
    }
    const plan = planSaisieBaux({
      an, saisies, dus: donnees.dus, paiements: donnees.paiements, fixes: donnees.chargesFixes || [],
      moisCourant: premierDuMois(aujourdhuiISO()),
    })
    if (!plan.reglages.length && !plan.aCreer.length && !plan.aModifier.length && !plan.aSupprimer.length) {
      Alert.alert('Rien à enregistrer', 'Aucun bail n\'a changé.'); return
    }
    setOccupe(true)
    try {
      for (const g of plan.reglages) await enregistrerChargeFixe({ categorie: 'bail', ...g }, [], user)
      await appliquerPlanDus(plan, user, { categorie: 'bail', an })
      await apres()
      onFermer()
    } catch (e) {
      Alert.alert('Non enregistré', e?.message || 'Réessayez.')
      // Une partie a pu être enregistrée : repartir de l'état réel.
      apres().catch(() => {})
    } finally {
      setOccupe(false)
    }
  }

  return (
    <Feuille visible onFermer={onFermer} titre="Contrats de bail">
      <Text style={styles.label}>Année</Text>
      <Puces options={[anCourant - 1, anCourant, anCourant + 1].map(a => ({ valeur: a, label: String(a) }))} valeur={an} onChange={setAn} />
      <Text style={[styles.petit, { marginBottom: 12 }]}>
        En face de chaque restaurant : le montant annuel et la date limite (touchez 📅 pour la choisir). Les années suivantes, la ligne apparaît toute seule
        un mois avant sa date, avec ces valeurs. Champ vide = plus de bail pour ce restaurant.
      </Text>
      {donnees.restaurants.map(r => {
        const d = entamee(r)
        if (d) return <LigneEntamee key={r.id} nom={r.nom} montant={d.montant_du} />
        const date = lireDate(valeurs[r.id]?.date)
        const ouvert = calendrierPour === r.id
        return (
          <View key={r.id}>
            <Rangee nom={r.nom}>
              <Saisie montant largeur={120} valeur={valeurs[r.id]?.montant ?? ''} placeholder="Montant"
                onChange={v => maj(r.id, 'montant', v)} />
              <TouchableOpacity onPress={() => setCalendrierPour(ouvert ? null : r.id)}
                style={[styles.input, { width: 92, paddingVertical: 9, borderColor: ouvert ? colors.primary : colors.inputBorder }]}>
                <Text style={{ fontSize: 15, textAlign: 'right', color: date ? colors.text : colors.textMuted }}>
                  📅 {date ? jjmm(date.jour, date.mois) : 'Date'}
                </Text>
              </TouchableOpacity>
            </Rangee>
            {ouvert && (
              <View style={{ marginBottom: 10, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: colors.border }}>
                <CalendrierFr
                  valeur={date ? `${an}-${deux(date.mois)}-${deux(date.jour)}` : ''}
                  initial={`${an}-${aujourdhuiISO().slice(5, 7)}-01`}
                  onChoisir={iso => { maj(r.id, 'date', jjmm(Number(iso.slice(8, 10)), Number(iso.slice(5, 7)))); setCalendrierPour(null) }}
                />
              </View>
            )}
          </View>
        )
      })}
      <View style={[styles.ligne, { marginVertical: 10 }]}>
        <Text style={styles.ligneLabel}>Total {an}</Text>
        <Text style={[styles.ligneValeur, { color: colors.text }]}>{fmt(total)} F</Text>
      </View>
      <Bouton titre="Enregistrer" onPress={enregistrer} occupe={occupe} />
    </Feuille>
  )
}
