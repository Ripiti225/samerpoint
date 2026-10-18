// ──────────────────────────────────────────────────────────────────────────────
// Contacts — SMS & WhatsApp groupés, et suivi des contacts clients pris.
//
// Onglet Clients : période + restaurant, résumé comparé à la période juste
// avant (même durée, cf. lib/periodeComparee.js), puis les numéros de la
// période : ceux saisis dans Samtrackly avant la bascule POS, et ceux saisis
// au POS, rapatriés à chaque shift validé (table contacts_clients, fonction
// import-contacts-pos).
// Onglet Analyse : les clients de la période en groupes (perdus, une seule
// commande, fidèles, nouveaux) sur tout l'historique — lib/analyseClients.js.
// Calculs : lib/contactsPeriode.js — Chargement : lib/contactsPeriodeDb.js
// ──────────────────────────────────────────────────────────────────────────────
import { router, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, Linking, Platform, SafeAreaView, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native'

import { ChampPeriode } from '../components/ChampDate'
import AnalyseClients from '../components/contacts/AnalyseClients'
import ResumeContacts from '../components/contacts/ResumeContacts'
import { Bouton, EnTete, Feuille, Libelle, Puces, Recherche, Vide, teinte, useEcranModerne } from '../components/ui/EcranModerne'
import { useApp } from '../context/AppContext'
import { GROUPES_CLIENTS, groupesClients, ilYa, profilsClients } from '../lib/analyseClients'
import { CANAUX_CONTACT, numerosUniques, parJour, parRestaurant, totaux } from '../lib/contactsPeriode'
import { chargerContactsPeriode, chargerEquipeEtFournisseurs, chargerHistoriqueClients, dernierNumeroPOS } from '../lib/contactsPeriodeDb'
import { aujourdhuiISO } from '../lib/contrats'
import { PERIODES, plageDates, titrePeriode } from '../lib/equipe'
import { libelleJour, periodePrecedente } from '../lib/periodeComparee'
import { supabase } from '../lib/supabase'

const PAR_PAGE = 100

export default function ContactsScreen() {
  const { roleActif, restaurantId } = useApp()
  const { styles, colors, accent, principale } = useEcranModerne('beige')
  const isGerant = roleActif === 'gerant'
  const isRH = roleActif === 'rh'
  const onglets = isRH ? ['Équipe', 'Fournisseurs'] : ['Clients', 'Analyse', 'Équipe', 'Fournisseurs']
  const avecPeriode = onglet => onglet === 'Clients' || onglet === 'Analyse'

  const [restaurants, setRestaurants] = useState([])
  // Ouvert depuis la recherche globale : numéro cherché, sur le jour de la commande.
  const params = useLocalSearchParams()
  const dateRecherche = typeof params.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : null
  const [restoId, setRestoId] = useState(isGerant ? restaurantId : (typeof params.restaurant_id === 'string' ? params.restaurant_id : null)) // null = tous
  const [onglet, setOnglet] = useState(onglets[0])
  const [periodeKey, setPeriodeKey] = useState(dateRecherche ? 'custom' : 'month')
  const [perso, setPerso] = useState(dateRecherche ? { debut: dateRecherche, fin: dateRecherche } : {})
  const [feuillePeriode, setFeuillePeriode] = useState(false)
  const [brouillon, setBrouillon] = useState({ debut: '', fin: '' })

  const [donnees, setDonnees] = useState({ lignes: [], commandes: [] })
  const [equipe, setEquipe] = useState({ travailleurs: [], fournisseurs: [] })
  const [dernierNumero, setDernierNumero] = useState(null)
  const [loading, setLoading] = useState(true)
  // Analyse : tout l'historique, lu seulement à l'ouverture de l'onglet (une fois par restaurant).
  const [historique, setHistorique] = useState(null) // { restoId, lignes }
  const [groupeActif, setGroupeActif] = useState(GROUPES_CLIENTS[0].cle)

  const [recherche, setRecherche] = useState(typeof params.recherche === 'string' ? params.recherche : '')
  const [canal, setCanal] = useState(null) // Clients : null = tous, 'yango', 'glovo', 'autres'
  const [nbAffiches, setNbAffiches] = useState(PAR_PAGE)
  const [selectionnes, setSelectionnes] = useState({})
  const [composeur, setComposeur] = useState(null) // 'sms' | 'whatsapp' | null
  const [message, setMessage] = useState('')

  const plageA = useMemo(() => plageDates(periodeKey, perso), [periodeKey, perso])
  const plageB = useMemo(() => (plageA ? periodePrecedente(plageA.debut, plageA.fin) : null), [plageA])
  const restoParId = useMemo(() => Object.fromEntries(restaurants.map(r => [r.id, r])), [restaurants])

  useEffect(() => {
    supabase.from('restaurants').select('id, nom').order('nom').then(({ data }) => setRestaurants(data || []))
    dernierNumeroPOS().then(setDernierNumero).catch(() => {})
  }, [])

  // Une seule lecture couvre les deux périodes (B est juste avant A).
  const charger = useCallback(async () => {
    if (!plageA || !plageB) return
    setLoading(true)
    setSelectionnes({})
    try {
      const [c, e] = await Promise.all([
        isRH ? { lignes: [], commandes: [] } : chargerContactsPeriode({ debut: plageB.debut, fin: plageA.fin, restoId }),
        chargerEquipeEtFournisseurs(restoId),
      ])
      setDonnees(c); setEquipe(e)
    } catch {
      Alert.alert('Erreur', 'Impossible de charger les contacts. Vérifiez la connexion.')
    }
    setLoading(false)
  }, [plageA, plageB, restoId, isRH])

  useEffect(() => { charger() }, [charger])
  useEffect(() => { setNbAffiches(PAR_PAGE); setSelectionnes({}) }, [onglet, recherche, canal, restoId, plageA, groupeActif])

  const historiquePret = historique?.restoId === restoId
  useEffect(() => {
    if (onglet !== 'Analyse' || historiquePret) return
    let annule = false
    chargerHistoriqueClients(restoId)
      .then(lignes => { if (!annule) setHistorique({ restoId, lignes }) })
      .catch(() => {
        if (annule) return
        setHistorique({ restoId, lignes: [] }) // pas de roue sans fin ; changer de restaurant relance la lecture
        Alert.alert('Erreur', "Impossible de charger l'historique des clients. Vérifiez la connexion.")
      })
    return () => { annule = true }
  }, [onglet, restoId, historiquePret])

  const profils = useMemo(() => (historiquePret ? profilsClients(historique.lignes) : []), [historique, historiquePret])
  const groupes = useMemo(() => (plageA ? groupesClients(profils, { ...plageA, aujourdhui: aujourdhuiISO() }) : null), [profils, plageA])
  const premiereDate = useMemo(() => profils.reduce((m, p) => (!m || p.premiere < m ? p.premiere : m), ''), [profils])

  // ── Résumé ──
  const dans = (l, p) => !!p && l.date >= p.debut && l.date <= p.fin
  const lignesA = useMemo(() => donnees.lignes.filter(l => dans(l, plageA)), [donnees, plageA])
  const lignesB = useMemo(() => donnees.lignes.filter(l => dans(l, plageB)), [donnees, plageB])
  const totA = useMemo(() => totaux(lignesA), [lignesA])
  const totB = useMemo(() => totaux(lignesB), [lignesB])
  const jourA = useMemo(() => (plageA ? parJour(lignesA, plageA.debut, plageA.fin) : []), [lignesA, plageA])
  const jourB = useMemo(() => (plageB ? parJour(lignesB, plageB.debut, plageB.fin) : []), [lignesB, plageB])
  const classement = useMemo(() => (restoId ? null : parRestaurant(lignesA, lignesB, restaurants)), [restoId, lignesA, lignesB, restaurants])

  // ── Listes ──
  const q = recherche.trim().toLowerCase()
  const listes = useMemo(() => ({
    Clients: numerosUniques(donnees.commandes.filter(c => dans(c, plageA))).map(c => ({
      id: c.id, nom: c.numero, numero: c.numero, canaux: c.canaux,
      detail: `${c.partenaire} · ${c.fois > 1 ? `${c.fois} commandes · ` : ''}dernière le ${libelleJour(c.dernier)}${!restoId && restoParId[c.restaurant_id] ? ` · ${restoParId[c.restaurant_id].nom}` : ''}`,
    })),
    Analyse: (groupes?.[groupeActif] || []).map(p => ({
      id: p.id, nom: p.numero, numero: p.numero, canaux: p.canaux,
      detail: `${p.partenaire} · ${p.fois} commande${p.fois > 1 ? 's' : ''} · dernière le ${libelleJour(p.derniere)} (${ilYa(p.depuis)})${p.fois > 1 ? ` · première le ${libelleJour(p.premiere)}` : ''}${!restoId && restoParId[p.restaurant_id] ? ` · ${restoParId[p.restaurant_id].nom}` : ''}`,
    })),
    'Équipe': equipe.travailleurs.map(t => ({
      id: t.id, nom: t.nom, numero: t.contact,
      detail: `${t.poste || 'Équipe'}${!restoId && restoParId[t.restaurant_id] ? ` · ${restoParId[t.restaurant_id].nom}` : ''}`,
    })),
    Fournisseurs: equipe.fournisseurs.map(f => ({
      id: f.id, nom: f.nom, numero: f.contact,
      detail: `${f.type === 'cotisation' ? 'Cotisation' : 'Fournisseur'}${!restoId && restoParId[f.restaurant_id] ? ` · ${restoParId[f.restaurant_id].nom}` : ''}`,
    })),
  }), [donnees, equipe, plageA, restoId, restoParId, groupes, groupeActif])
  const trouves = (listes[onglet] || []).filter(c => !q || c.nom.toLowerCase().includes(q) || c.detail.toLowerCase().includes(q) || String(c.numero).includes(q))
  // Filtre par type (Clients et Analyse) : un client passé par Yango puis par Glovo apparaît sous les deux.
  const liste = avecPeriode(onglet) && canal ? trouves.filter(c => c.canaux?.includes(canal)) : trouves
  const parCanal = cle => (cle ? trouves.filter(c => c.canaux?.includes(cle)).length : trouves.length)
  const affiches = liste.slice(0, nbAffiches)

  const nbSelectionnes = Object.values(selectionnes).filter(Boolean).length
  const numerosSelectionnes = liste.filter(c => selectionnes[c.id]).map(c => c.numero)

  function toutSelectionner() {
    const tous = {}
    liste.forEach(c => { tous[c.id] = true })
    setSelectionnes(tous)
  }

  function nettoyer(numero) {
    return String(numero).replace(/\s+/g, '').replace(/[^\d+]/g, '')
  }

  function envoyerSMS() {
    if (!message.trim()) { Alert.alert('Message vide', "Écrivez votre message avant d'envoyer."); return }
    const sep = Platform.OS === 'ios' ? '&' : '?'
    Linking.openURL(`sms:${numerosSelectionnes.join(',')}${sep}body=${encodeURIComponent(message)}`)
      .catch(() => Alert.alert('Erreur', "Impossible d'ouvrir l'application SMS."))
    setComposeur(null); setMessage('')
  }

  function envoyerWhatsApp() {
    if (!message.trim()) { Alert.alert('Message vide', 'Écrivez votre message.'); return }
    // WhatsApp ne sait pas écrire à plusieurs numéros d'un coup : un par un.
    Alert.alert('WhatsApp', `WhatsApp sera ouvert ${numerosSelectionnes.length} fois (un par contact). Continuer ?`, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Continuer', onPress: () => {
          const texte = encodeURIComponent(message)
          numerosSelectionnes.forEach((num, i) => setTimeout(() => {
            Linking.openURL(`https://wa.me/${nettoyer(num)}?text=${texte}`).catch(() => Alert.alert('Erreur', "Impossible d'ouvrir WhatsApp."))
          }, i * 1500))
          setComposeur(null); setMessage('')
        },
      },
    ])
  }

  const restoNom = restoId ? restoParId[restoId]?.nom || '' : 'Tous les restaurants'
  const heureDernier = dernierNumero
    ? new Date(dernierNumero).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })
    : null

  return (
    <SafeAreaView style={styles.container}>
      <EnTete titre="Contacts" sous={restoNom} styles={styles}
        onRetour={() => (router.canGoBack() ? router.back() : router.replace('/accueil'))} />

      {!isGerant && (
        <Puces ligne styles={styles} actif={restoId} onChoisir={setRestoId}
          elements={[{ cle: null, label: 'Tous' }, ...restaurants.map(r => ({ cle: r.id, label: r.nom }))]} />
      )}

      <View style={styles.ongletsWrap}>
        {onglets.map(o => (
          <TouchableOpacity key={o} style={[styles.onglet, onglet === o && styles.ongletActive]} onPress={() => setOnglet(o)}>
            <Text style={[styles.ongletTxt, onglet === o && styles.ongletTxtActive]}>
              {o}{!avecPeriode(o) && listes[o].length ? ` (${listes[o].length})` : ''}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {avecPeriode(onglet) && (
        <Puces ligne petit styles={styles} actif={periodeKey}
          onChoisir={k => (k === 'custom' ? (setBrouillon({ debut: perso.debut || '', fin: perso.fin || '' }), setFeuillePeriode(true)) : setPeriodeKey(k))}
          elements={PERIODES.map(p => ({ cle: p.key, label: p.key === 'custom' && periodeKey === 'custom' ? `📅 ${titrePeriode('custom', perso)}` : p.label }))} />
      )}

      {loading || (onglet === 'Analyse' && !historiquePret) ? (
        <View style={styles.loadingBox}><ActivityIndicator size="large" color={accent} /></View>
      ) : (
        <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
          {onglet === 'Clients' && plageA && plageB && (
            <ResumeContacts styles={styles} colors={colors} principale={principale} accent={accent}
              a={totA} b={totB} plageA={plageA} plageB={plageB} jourA={jourA} jourB={jourB} restaurants={classement} />
          )}

          {onglet === 'Analyse' && groupes && (
            <AnalyseClients styles={styles} colors={colors} principale={principale} groupes={groupes}
              actif={groupeActif} onChoisir={setGroupeActif} plage={plageA} depuis={premiereDate ? libelleJour(premiereDate) : ''} />
          )}

          {onglet === 'Analyse' && (
            <Text style={[styles.resultat, { marginTop: 4 }]}>
              {GROUPES_CLIENTS.find(g => g.cle === groupeActif).icone} {GROUPES_CLIENTS.find(g => g.cle === groupeActif).titre}
            </Text>
          )}

          {onglet === 'Clients' && (
            <>
              <Text style={[styles.resultat, { marginTop: 4 }]}>Numéros clients de la période</Text>
              {heureDernier && (
                <View style={[styles.carte, { backgroundColor: teinte(principale, '14'), borderColor: teinte(principale, '40'), padding: 12 }]}>
                  <Text style={[styles.infoTxt, { color: colors.text, fontSize: 12.5 }]}>
                    🔄 Les numéros pris au POS arrivent ici à chaque shift validé. Dernier reçu : {heureDernier}.
                  </Text>
                </View>
              )}
            </>
          )}

          <View style={{ marginHorizontal: -14 }}>
            <Recherche value={recherche} onChange={setRecherche} styles={styles} colors={colors}
              placeholder={avecPeriode(onglet) ? '🔍 Rechercher un numéro…' : '🔍 Rechercher un nom, un numéro…'} />
            {avecPeriode(onglet) && (
              <Puces ligne petit styles={styles} actif={canal} onChoisir={setCanal}
                elements={CANAUX_CONTACT.map(c => ({ cle: c.cle, label: `${c.label} (${parCanal(c.cle).toLocaleString('fr-FR')})` }))} />
            )}
          </View>

          {liste.length > 0 && (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: 10 }}>
              <Text style={[styles.resultat, { marginBottom: 0 }]}>
                {liste.length} contact{liste.length > 1 ? 's' : ''}{nbSelectionnes ? ` · ${nbSelectionnes} sélectionné${nbSelectionnes > 1 ? 's' : ''}` : ''}
              </Text>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <Bouton label="Tout" couleur={accent} styles={styles} onPress={toutSelectionner} />
                <Bouton label="Aucun" variante="contour" couleur={colors.textSecondary} styles={styles} onPress={() => setSelectionnes({})} />
              </View>
            </View>
          )}

          {liste.length === 0 ? (
            <Vide styles={styles} icone={avecPeriode(onglet) ? '🛵' : onglet === 'Équipe' ? '👥' : '🧾'}
              texte={onglet === 'Analyse' ? 'Aucun client dans ce groupe' : onglet === 'Clients' ? (canal ? `Aucun client ${CANAUX_CONTACT.find(c => c.cle === canal).label} sur cette période` : 'Aucun numéro sur cette période') : 'Aucun contact'}
              sous={onglet === 'Analyse' ? 'Changez de période, de restaurant ou de groupe.' : onglet === 'Clients' ? 'Les numéros viennent des commandes Yango / Glovo (POS et Samtrackly).' : 'Ajoutez des numéros dans Paramètres.'} />
          ) : affiches.map(c => {
            const sel = !!selectionnes[c.id]
            return (
              <TouchableOpacity key={c.id} activeOpacity={0.75}
                onPress={() => setSelectionnes(p => ({ ...p, [c.id]: !p[c.id] }))}
                style={[styles.carte, { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, marginBottom: 8 },
                  sel && { borderColor: principale, backgroundColor: teinte(principale, '12') }]}>
                <View style={{
                  width: 24, height: 24, borderRadius: 12, borderWidth: 2, alignItems: 'center', justifyContent: 'center',
                  borderColor: sel ? principale : colors.border, backgroundColor: sel ? principale : 'transparent',
                }}>
                  {sel && <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>✓</Text>}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.carteTitre, { fontSize: 14 }]}>{c.nom}</Text>
                  <Text style={styles.carteSous} numberOfLines={2}>{c.detail}</Text>
                  {c.nom !== c.numero && <Text style={[styles.carteSous, { color: accent, fontWeight: '700' }]}>{c.numero}</Text>}
                </View>
                <TouchableOpacity hitSlop={6} onPress={() => Linking.openURL(`https://wa.me/${nettoyer(c.numero)}`).catch(() => Alert.alert('Erreur', "Impossible d'ouvrir WhatsApp."))}
                  style={{ backgroundColor: '#25D366', paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10 }}>
                  <Text style={{ fontSize: 11.5, fontWeight: '800', color: '#fff' }}>WA</Text>
                </TouchableOpacity>
              </TouchableOpacity>
            )
          })}
          {liste.length > affiches.length && (
            <Bouton label={`Voir ${Math.min(PAR_PAGE, liste.length - affiches.length)} de plus (${liste.length - affiches.length} restants)`}
              variante="contour" couleur={accent} styles={styles} onPress={() => setNbAffiches(n => n + PAR_PAGE)} />
          )}
          <View style={{ height: 130 }} />
        </ScrollView>
      )}

      {/* Barre d'envoi */}
      {nbSelectionnes > 0 && (
        <View style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: colors.surface, padding: 16, paddingBottom: 28,
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: colors.borderLight,
          shadowColor: '#000', shadowOffset: { width: 0, height: -2 }, shadowOpacity: 0.08, shadowRadius: 8, elevation: 8,
        }}>
          <Text style={{ fontSize: 14, fontWeight: '800', color: accent }}>{nbSelectionnes} contact{nbSelectionnes > 1 ? 's' : ''}</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Bouton label="💬 SMS" variante="plein" couleur={principale} styles={styles} onPress={() => setComposeur('sms')} />
            <Bouton label="WhatsApp" variante="plein" couleur="#25D366" styles={styles} onPress={() => setComposeur('whatsapp')} />
          </View>
        </View>
      )}

      {/* Période personnalisée */}
      <Feuille visible={feuillePeriode} titre="Choisir une période" sous="Comparée aux mêmes nombre de jours juste avant"
        onFermer={() => setFeuillePeriode(false)} styles={styles}>
        <ChampPeriode label="Période" debut={brouillon.debut} fin={brouillon.fin} couleur={principale}
          onChange={p => setBrouillon(p)}
          onMoisEntier={p => { setBrouillon(p); setPerso(p); setPeriodeKey('custom'); setFeuillePeriode(false) }} />
        <Bouton label="Voir les contacts" variante="plein" couleur={principale} grand styles={styles}
          disabled={!brouillon.debut || !brouillon.fin || brouillon.fin < brouillon.debut}
          onPress={() => { setPerso(brouillon); setPeriodeKey('custom'); setFeuillePeriode(false) }} />
      </Feuille>

      {/* Composer le message */}
      <Feuille visible={!!composeur} titre={composeur === 'sms' ? '💬 Envoyer un SMS' : 'WhatsApp'}
        sous={`${numerosSelectionnes.length} destinataire${numerosSelectionnes.length > 1 ? 's' : ''} — ${restoNom}`}
        onFermer={() => { setComposeur(null); setMessage('') }} styles={styles}>
        <Libelle styles={styles}>Votre message</Libelle>
        <TextInput style={[styles.input, styles.textArea, { minHeight: 120 }]} value={message} onChangeText={setMessage}
          placeholder="Bonjour, nous avons une offre spéciale pour vous…" placeholderTextColor={colors.textPlaceholder}
          multiline textAlignVertical="top" autoFocus />
        <Text style={[styles.infoTxt, { textAlign: 'right', fontSize: 11, marginTop: -10, marginBottom: 12 }]}>{message.length} caractère{message.length > 1 ? 's' : ''}</Text>
        <Puces petit styles={styles} actif={null} onChoisir={() => {}}
          elements={[...numerosSelectionnes.slice(0, 8).map(n => ({ cle: n, label: n })),
            ...(numerosSelectionnes.length > 8 ? [{ cle: 'plus', label: `+${numerosSelectionnes.length - 8}` }] : [])]} />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Bouton label="Annuler" variante="contour" couleur={colors.textSecondary} flex grand styles={styles} onPress={() => { setComposeur(null); setMessage('') }} />
          <Bouton label={composeur === 'sms' ? '💬 Envoyer le SMS' : '📲 Envoyer sur WhatsApp'} variante="plein" flex grand styles={styles}
            couleur={composeur === 'sms' ? principale : '#25D366'} onPress={composeur === 'sms' ? envoyerSMS : envoyerWhatsApp} />
        </View>
      </Feuille>
    </SafeAreaView>
  )
}
