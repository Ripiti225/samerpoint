# Refonte Déductions gérant & Saisie des ventes — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** Rhabiller `app/deductions-gerant.js` (3 onglets + barre du bas fixe) et `app/ventes.js` (3 étapes + barre du bas fixe) avec le style A (clair) / B (sombre), sans changer aucune règle ni écriture en base.

**Architecture :** Un kit de style `components/ui/StyleChaleureux.js` (palettes A/B choisies par `useTheme().isDark`, dégradés via `react-native-svg`). Les rendus sont découpés en composants par onglet / étape (`components/deductions/*`, `components/ventes/*`) ; l'état, les chargements et les enregistrements restent dans les écrans, déplacés tels quels. La logique « Il manque », la barre payé / dû et le résumé des onglets vivent dans `lib/manquantsSaisie.js`, testée sous `node:test`.

**Tech Stack :** Expo SDK 54, React 19.1, React Native 0.81, react-native-svg 15.12, `node:test`.

Spec : `docs/superpowers/specs/2026-10-05-deductions-ventes-refonte-design.md`.

## Global Constraints

- Aucune nouvelle dépendance (surtout native) : publication en OTA uniquement.
- Aucun changement de calcul, de contrôle ni d'écriture Supabase ; les fonctions `sauvegarder`, `sauvegarderPhotosPoints`, `syncLitigesResponsables`, `chargerDonnees`, `chargerCumulShifts`, etc. sont conservées mot pour mot.
- Interface 100 % en français ; zones tactiles ≥ 44–48 px.
- `npm run lint` → 0 erreur ; `for f in lib/*.test.mjs; do node "$f"; done` → 0 échec ; `npx expo export -p web` compile.
- Ne jamais lancer `expo start` / localhost ; jamais `CI=1`.
- Git : `export DEVELOPER_DIR=/Library/Developer/CommandLineTools` avant toute commande git ; commit + push à chaque tâche ; **pas** de Vercel / EAS avant la fin du chantier.
- Commits en français, terminés par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1 : Logique pure `lib/manquantsSaisie.js`

**Files :**
- Create : `lib/manquantsSaisie.js`
- Test : `lib/manquantsSaisie.test.mjs`

**Interfaces :**
- Consumes : `facturesGerantSansPhoto(fournisseurs) → string[]` (`lib/creditsFournisseurs.js`, pur).
- Produces :
  - `manquantsDeductions(fournisseursGerantCaisse, nomDe?: id => string) → [{ cle, texte, bloquant: true }]`
  - `progressionFournisseur({ creditVeille, facture, paye }) → { du, paye, reste, ratio, solde }`
  - `resumeDeductions(depenses, fournisseurs, paies) → { fournisseurs:{n,total}, depenses:{n,total}, paies:{n,total} }`
  - `photosManquantesVentes({ ventesJour, venteMachineDuSysteme, voitMachine }) → string[]` (libellés `'Yango TAB' | 'Glovo TAB' | 'Photo vente machine'`)
  - `manquantsVentes({ ventesJour, cumulShifts, venteMachineRecue, venteMachineDuSysteme, voitMachine, isManager }) → [{ cle, etape, texte, bloquant, alerte? }]`

- [ ] **Step 1 : écrire les tests** — `lib/manquantsSaisie.test.mjs`

```js
// Tests de lib/manquantsSaisie.js — « Il manque » et barre payé / dû des écrans gérant.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  manquantsDeductions, manquantsVentes, photosManquantesVentes, progressionFournisseur, resumeDeductions,
} from './manquantsSaisie.js'

const PHOTO = 'https://x.supabase.co/storage/v1/object/public/photos/a.jpg'

describe('manquantsDeductions', () => {
  test('facture sans photo → bloquant, avec le nom du fournisseur', () => {
    const r = manquantsDeductions({ f1: { nom: 'SOTRA', montant_facture: '5000' } })
    assert.deepEqual(r, [{ cle: 'photo_f1', texte: 'photo facture SOTRA', bloquant: true }])
  })
  test('facture avec photo, ou simple paiement de dette → rien', () => {
    assert.deepEqual(manquantsDeductions({ f1: { montant_facture: '5000', photoUri: PHOTO }, f2: { paye: '3000' } }), [])
  })
  test('nom repris de la liste quand la saisie ne l’a pas', () => {
    const r = manquantsDeductions({ f1: { montant_facture: '100' } }, id => (id === 'f1' ? 'Boulangerie' : 'Fournisseur'))
    assert.equal(r[0].texte, 'photo facture Boulangerie')
  })
})

describe('progressionFournisseur', () => {
  test('dette partiellement payée', () => {
    assert.deepEqual(
      progressionFournisseur({ creditVeille: 100000, facture: '20000', paye: '45000' }),
      { du: 120000, paye: 45000, reste: 75000, ratio: 0.375, solde: false },
    )
  })
  test('payé au-delà du dû → soldé, ratio plafonné', () => {
    const r = progressionFournisseur({ creditVeille: 8000, facture: 0, paye: '10000' })
    assert.equal(r.ratio, 1)
    assert.equal(r.solde, true)
    assert.equal(r.reste, -2000)
  })
  test('avance de la veille (dû ≤ 0) → soldé', () => {
    const r = progressionFournisseur({ creditVeille: -5000, facture: '', paye: '' })
    assert.equal(r.ratio, 1)
    assert.equal(r.solde, true)
  })
})

describe('resumeDeductions', () => {
  test('compte et additionne chaque onglet', () => {
    const r = resumeDeductions(
      { Marché: [{ montant: '8000' }, { montant: '4000' }], Fruits: [] },
      { f1: { paye: '45000', montant_facture: '0' }, f2: { montant_facture: '1000' }, f3: {} },
      [{ montant: '20000' }],
    )
    assert.deepEqual(r, { fournisseurs: { n: 2, total: 45000 }, depenses: { n: 2, total: 12000 }, paies: { n: 1, total: 20000 } })
  })
})

describe('photosManquantesVentes', () => {
  test('TAB avec montant et sans photo, vente machine saisie à la main', () => {
    assert.deepEqual(
      photosManquantesVentes({ ventesJour: { yangoTab: '85000', glovoTab: '0', venteMachine: '400000' }, voitMachine: true }),
      ['Yango TAB', 'Photo vente machine'],
    )
  })
  test('vente machine venue du POS → pas de photo demandée', () => {
    assert.deepEqual(photosManquantesVentes({ ventesJour: { venteMachine: '400000' }, venteMachineDuSysteme: true, voitMachine: true }), [])
  })
})

describe('manquantsVentes', () => {
  const base = { cumulShifts: { venteTotal: 412500 }, venteMachineRecue: true, voitMachine: true }
  test('écart sans explication ni responsable → deux bloquants, dans l’ordre du contrôle', () => {
    const r = manquantsVentes({ ...base, ventesJour: { venteMachine: '410000', photoVenteMachine: PHOTO } })
    assert.deepEqual(r.map(m => [m.cle, m.bloquant, m.etape]), [['explication', true, 3], ['responsable', true, 3]])
    assert.equal(r[0].alerte.titre, 'Explication requise')
    assert.match(r[1].alerte.message, /surplus/)
  })
  test('responsable à 0 → montant manquant', () => {
    const r = manquantsVentes({ ...base, ventesJour: {
      venteMachine: '415000', photoVenteMachine: PHOTO, explicacionEcartMachine: 'erreur de rendu monnaie',
      ecartResponsables: [{ travailleur_id: 'a', montant: '' }],
    } })
    assert.deepEqual(r.map(m => m.cle), ['montant_responsable'])
  })
  test('répartition incomplète puis complète', () => {
    const vj = { venteMachine: '415000', photoVenteMachine: PHOTO, explicacionEcartMachine: 'erreur de rendu monnaie' }
    const incomplete = manquantsVentes({ ...base, ventesJour: { ...vj, ecartResponsables: [{ travailleur_id: 'a', montant: '1000' }] } })
    assert.deepEqual(incomplete.map(m => m.cle), ['repartition'])
    assert.match(incomplete[0].alerte.message, /manquant/)
    assert.deepEqual(manquantsVentes({ ...base, ventesJour: { ...vj, ecartResponsables: [{ travailleur_id: 'a', montant: '2500' }] } }), [])
  })
  test('site POS : rien n’est redemandé', () => {
    assert.deepEqual(manquantsVentes({ ...base, venteMachineDuSysteme: true, ventesJour: { venteMachine: '410000' } }), [])
  })
  test('manager : jamais bloqué', () => {
    assert.deepEqual(manquantsVentes({ ...base, isManager: true, ventesJour: { venteMachine: '410000', yangoTab: '5000' } }), [])
  })
  test('photo TAB manquante → non bloquante, étape 1', () => {
    const r = manquantsVentes({ ...base, ventesJour: { yangoTab: '5000', venteMachine: '412500', photoVenteMachine: PHOTO } })
    assert.deepEqual(r, [{ cle: 'photo_yango', etape: 1, texte: 'photo Yango TAB', bloquant: false }])
  })
})
```

- [ ] **Step 2 : vérifier l'échec** — `node lib/manquantsSaisie.test.mjs` → échec « Cannot find module './manquantsSaisie.js' ».

- [ ] **Step 3 : implémenter** — `lib/manquantsSaisie.js`

```js
// Ce qui manque avant d'enregistrer (Déductions gérant, Saisie des ventes) et
// résumés affichés par ces deux écrans. Une seule source pour l'affichage
// « Il manque : … » et pour le contrôle au moment d'appuyer : ils ne peuvent
// pas diverger. Les messages d'alerte sont repris mot pour mot de l'ancien
// contrôle de app/ventes.js.
import { facturesGerantSansPhoto } from './creditsFournisseurs.js'

const nombre = v => parseFloat(v) || 0
const fmt = n => Math.round(n).toLocaleString('fr-FR') + ' FCFA'

// Factures fournisseur sans photo : bloque la sauvegarde des déductions.
export function manquantsDeductions(fournisseursGerantCaisse, nomDe = () => 'Fournisseur') {
  return facturesGerantSansPhoto(fournisseursGerantCaisse).map(id => ({
    cle: `photo_${id}`,
    texte: `photo facture ${fournisseursGerantCaisse?.[id]?.nom || nomDe(id)}`,
    bloquant: true,
  }))
}

// Barre payé / dû d'un fournisseur. dû = crédit de la veille + facture du jour.
export function progressionFournisseur({ creditVeille, facture, paye }) {
  const du = nombre(creditVeille) + nombre(facture)
  const p = nombre(paye)
  const reste = du - p
  return { du, paye: p, reste, ratio: du > 0 ? Math.min(1, Math.max(0, p / du)) : 1, solde: reste <= 0 }
}

// Nombre de lignes et montant de chaque onglet des déductions.
export function resumeDeductions(depenses, fournisseurs, paies) {
  const lignesDep = Object.values(depenses || {}).flatMap(l => l || [])
  const fours = Object.values(fournisseurs || {}).filter(f => nombre(f?.paye) > 0 || nombre(f?.montant_facture) > 0)
  const listePaies = paies || []
  return {
    fournisseurs: { n: fours.length, total: fours.reduce((s, f) => s + nombre(f?.paye), 0) },
    depenses: { n: lignesDep.length, total: lignesDep.reduce((s, l) => s + nombre(l?.montant), 0) },
    paies: { n: listePaies.length, total: listePaies.reduce((s, l) => s + nombre(l?.montant), 0) },
  }
}

// Photos obligatoires de la saisie des ventes (alerte « Continuer quand
// même », jamais bloquante). Pas de photo de la vente machine quand c'est
// le système qui l'a écrite : il n'y a aucun écran à photographier.
export function photosManquantesVentes({ ventesJour = {}, venteMachineDuSysteme = false, voitMachine = false }) {
  const manquantes = []
  if (nombre(ventesJour.yangoTab) > 0 && !ventesJour.photo_yango_tab) manquantes.push('Yango TAB')
  if (nombre(ventesJour.glovoTab) > 0 && !ventesJour.photo_glovo_tab) manquantes.push('Glovo TAB')
  if (!venteMachineDuSysteme && voitMachine && nombre(ventesJour.venteMachine) > 0 && !ventesJour.photoVenteMachine) {
    manquantes.push('Photo vente machine')
  }
  return manquantes
}

const PHOTOS = {
  'Yango TAB': { cle: 'photo_yango', etape: 1, texte: 'photo Yango TAB' },
  'Glovo TAB': { cle: 'photo_glovo', etape: 1, texte: 'photo Glovo TAB' },
  'Photo vente machine': { cle: 'photo_machine', etape: 3, texte: 'photo vente machine' },
}

// Tout ce qui manque à la saisie des ventes. Bloquants d'abord, dans l'ordre
// où l'ancien contrôle les vérifiait (le premier donne l'alerte affichée).
// Sur un site POS, l'écart est déjà mesuré, expliqué et rattaché à sa
// caissière dans la caisse : rien n'est redemandé. Le manager passe outre.
export function manquantsVentes({
  ventesJour = {}, cumulShifts = null, venteMachineRecue = false,
  venteMachineDuSysteme = false, voitMachine = false, isManager = false,
}) {
  if (isManager) return []
  const liste = []
  if (cumulShifts && venteMachineRecue && !venteMachineDuSysteme) {
    const ecartSigne = (cumulShifts.venteTotal || 0) - nombre(ventesJour.venteMachine)
    const ecart = Math.abs(ecartSigne)
    if (ecart > 0) {
      const libelle = ecartSigne < 0 ? 'manquant' : 'surplus'
      if ((ventesJour.explicacionEcartMachine || '').trim().length < 10) {
        liste.push({ cle: 'explication', etape: 3, bloquant: true, texte: "explication de l'écart", alerte: {
          titre: 'Explication requise',
          message: 'Un écart a été détecté entre la vente théorique et la vente machine.\n\nVeuillez saisir une explication d\'au moins 10 caractères avant de continuer.',
        } })
      }
      const responsables = ventesJour.ecartResponsables || []
      const totalImpute = responsables.reduce((s, r) => s + nombre(r.montant), 0)
      if (responsables.length === 0) {
        liste.push({ cle: 'responsable', etape: 3, bloquant: true, texte: `responsable du ${libelle}`, alerte: {
          titre: 'Responsable requis',
          message: `Un ${libelle} a été détecté.\n\nDésignez au moins un responsable et imputez-lui un montant avant de continuer.`,
        } })
      } else if (responsables.some(r => !(parseFloat(r.montant) > 0))) {
        liste.push({ cle: 'montant_responsable', etape: 3, bloquant: true, texte: "montant d'un responsable", alerte: {
          titre: 'Montant manquant',
          message: 'Chaque responsable doit avoir un montant supérieur à 0.',
        } })
      } else if (Math.round(totalImpute) !== Math.round(ecart)) {
        liste.push({ cle: 'repartition', etape: 3, bloquant: true, texte: `répartition du ${libelle}`, alerte: {
          titre: 'Répartition incomplète',
          message: `La somme imputée aux responsables (${fmt(totalImpute)}) doit être égale au ${libelle} total (${fmt(ecart)}).`,
        } })
      }
    }
  }
  for (const libelle of photosManquantesVentes({ ventesJour, venteMachineDuSysteme, voitMachine })) {
    liste.push({ ...PHOTOS[libelle], bloquant: false })
  }
  return liste
}
```

- [ ] **Step 4 : vérifier le succès** — `node lib/manquantsSaisie.test.mjs` → tous les tests passent.

- [ ] **Step 5 : commit**

```bash
export DEVELOPER_DIR=/Library/Developer/CommandLineTools
git add lib/manquantsSaisie.js lib/manquantsSaisie.test.mjs
git commit -m "feat(saisie): ce qui manque avant d'enregistrer, barre payé/dû et résumé des déductions (logique testée)"
git push
```

---

### Task 2 : Kit de style `components/ui/StyleChaleureux.js`

**Files :**
- Create : `components/ui/StyleChaleureux.js`

**Interfaces :**
- Consumes : `useTheme()` (`context/ThemeContext.js` → `{ isDark }`), `PhotoJustificatif` (`components/PhotoJustificatif.js`, props `uri, style, compact`), `nomCourtResto` (`lib/groupesAccueil.js`).
- Produces (tous exportés) :
  - `useStyleChaleureux() → { p, styles, isDark }` ; `CLAIR`, `SOMBRE`
  - `contexteJour(restaurantNom, dateJour) → string` (« Palmeraie · 05/10 »)
  - `Degrade({ couleurs, horizontal })`
  - `EnTete({ titre, surtitre, sous, chiffre, contexte, onRetour, libelleRetour, flottant, children })`
  - `Onglets({ elements: [{ cle, label, detail }], actif, onChoisir, flottant })`
  - `BarreEtapes({ etapes: string[], actuelle: number, onChoisir })`
  - `Carte({ children, style, active })`, `Rubrique({ children })`, `Etiquette({ texte, ton })` (ton : `neutre|ok|erreur|alerte|info`)
  - `Bandeau({ texte, ton, chargement, action: { icone, libelle, onPress, disabled }, style })`
  - `LigneValeur({ libelle, etiquette, valeur, fort, couleur })`
  - `BarreProgression({ ratio, solde })`
  - `Champ({ libelle, grand, accent, editable, multiline, style, ...TextInputProps })`
  - `BoutonDegrade({ label, onPress, disabled, attenue, chargement, style })`, `BoutonSecondaire({ label, onPress, disabled, style })`
  - `BarreBas({ libelle, valeur, couleurValeur, manquants, children })`
  - `BlocPhoto({ uri, valide, requis, label, onPress, uploading, modifiable })`
  - `Feuille({ visible, titre, onFermer, children })`, `Choix({ nom, sous, etiquette, desactive, onPress })`, `Vide({ texte })`
  - styles partagés utilisés par les tâches 3–4 : `ecran, corps, corpsContenu, ligne, ligneChamps, carteTitre, texte, texteDoux, texteVide, petitDoux, petitFort, montantFort, enormeChiffre, supprimer, champLibelle, bandeauDansCorps, vignettes, vignette, vignetteImage, vignetteRetirer, vignetteRetirerTxt, vignetteAjout, vignetteAjoutTxt`

- [ ] **Step 1 : écrire le kit**

```js
// ──────────────────────────────────────────────────────────────────────────────
// Style « chaleureux » des écrans Déductions gérant et Saisie des ventes.
//   Mode clair  = A · en-tête en dégradé orange, cartes blanches à ombre douce.
//   Mode sombre = B · fond nuit, gros chiffres orange lumineux, halo sur l'actif.
// Les dégradés passent par react-native-svg (déjà installé) : aucune dépendance
// native en plus, donc publiable en mise à jour automatique.
// ──────────────────────────────────────────────────────────────────────────────
import { useMemo } from 'react'
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import { useTheme } from '../../context/ThemeContext'
import { nomCourtResto } from '../../lib/groupesAccueil'
import PhotoJustificatif from '../PhotoJustificatif'

export const CLAIR = {
  fond: '#F6F3EE', carte: '#FFFFFF', carteFin: '#FFFFFF', bord: '#EFE6D8',
  texte: '#2B1A05', texteDoux: '#7A5A30', texteVide: '#B8A58A', champ: '#F6F3EE', champBord: '#E8D9C2',
  accent: '#C2410C', accentVif: '#E07B00',
  degrade: ['#F7B23B', '#E07B00', '#C2410C'], degradeBouton: ['#F7B23B', '#E07B00'], texteBouton: '#FFFFFF',
  enTeteTexte: '#FFFFFF', piste: '#F2E6D6', ombre: '#7A3A00', voile: 'rgba(43,26,5,0.45)',
  ok: '#15803D', okFond: '#E8F5EE', erreur: '#B42318', erreurFond: '#FDECEA',
  alerte: '#B45309', alerteFond: '#FFF7EB', info: '#185FA5', infoFond: '#E6F1FB',
}

export const SOMBRE = {
  fond: '#0D0D14', carte: '#1C1C2A', carteFin: '#15151F', bord: '#2A2A3A',
  texte: '#F2F2F7', texteDoux: '#8E8EA0', texteVide: '#4A4A5E', champ: '#12121B', champBord: '#2A2A3A',
  accent: '#FFB84D', accentVif: '#F5A54A',
  degrade: ['#FFB84D', '#FF6B3D'], degradeBouton: ['#FFB84D', '#FF6B3D'], texteBouton: '#1A0E00',
  enTeteTexte: '#F2F2F7', piste: '#2A2A3A', ombre: '#FF8A3D', voile: 'rgba(0,0,0,0.6)',
  ok: '#4ADE80', okFond: '#0F2A1C', erreur: '#FF7A6B', erreurFond: '#2A1416',
  alerte: '#F5A54A', alerteFond: '#241A0C', info: '#7CB4F5', infoFond: '#0F1E33',
}

function makeStyles(p, sombre) {
  const ombreCarte = sombre ? {} : {
    shadowColor: p.ombre, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.07, shadowRadius: 14, elevation: 2,
  }
  return StyleSheet.create({
    ecran: { flex: 1, backgroundColor: p.fond },
    corps: { flex: 1 },
    corpsContenu: { padding: 14, paddingBottom: 28 },
    ligne: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    ligneChamps: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },

    enTete: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 16, overflow: 'hidden', backgroundColor: sombre ? p.fond : p.accentVif },
    enTeteFlottant: { paddingBottom: 52 },
    enTeteRetour: { fontSize: 15, fontWeight: '600', color: sombre ? p.texteDoux : p.enTeteTexte, paddingVertical: 4 },
    enTeteContexte: { fontSize: 12, color: sombre ? p.texteDoux : p.enTeteTexte, opacity: sombre ? 1 : 0.9, flexShrink: 1 },
    enTeteSurtitre: sombre
      ? { fontSize: 11, fontWeight: '800', letterSpacing: 1.2, color: p.accentVif, marginTop: 14, textTransform: 'uppercase' }
      : { fontSize: 12, color: p.enTeteTexte, opacity: 0.85, marginTop: 10 },
    enTeteTitre: { fontSize: 21, fontWeight: '800', color: p.enTeteTexte, marginTop: 4 },
    enTeteGrand: { fontSize: 24, fontWeight: '800', color: p.texte, marginTop: 2 },
    enTeteChiffre: { fontSize: 32, color: p.accent, letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
    enTeteSous: { fontSize: 12, color: sombre ? p.texteDoux : p.enTeteTexte, opacity: sombre ? 1 : 0.85, marginTop: 2 },

    onglets: {
      flexDirection: 'row', gap: 4, padding: 5, marginHorizontal: 14, marginTop: 10, borderRadius: 18,
      backgroundColor: p.carte, borderWidth: sombre ? 1 : 0, borderColor: p.bord, ...ombreCarte,
    },
    ongletsFlottants: {
      marginTop: -40, shadowColor: p.accent, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.18, shadowRadius: 18, elevation: 5,
    },
    onglet: {
      flex: 1, minHeight: 48, borderRadius: 13, paddingVertical: 7, paddingHorizontal: 4,
      alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'transparent',
    },
    ongletActif: sombre
      ? { backgroundColor: '#2A2236', borderColor: p.accentVif, shadowColor: p.accentVif, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.45, shadowRadius: 12, elevation: 4 }
      : { backgroundColor: p.accentVif },
    ongletLabel: { fontSize: 13, fontWeight: '700', color: p.texteDoux },
    ongletLabelActif: { color: sombre ? p.accent : '#FFFFFF' },
    ongletDetail: { fontSize: 10.5, color: p.texteDoux, marginTop: 1, fontVariant: ['tabular-nums'] },
    ongletDetailActif: { color: sombre ? p.accent : '#FFFFFF', opacity: 0.9 },

    etapes: { flexDirection: 'row', gap: 6, marginTop: 12 },
    etapeTrait: { height: 5, borderRadius: 3, overflow: 'hidden', backgroundColor: sombre ? p.piste : 'rgba(255,255,255,0.35)' },
    etapeTraitFait: sombre ? {} : { backgroundColor: '#FFFFFF' },
    etapeTraitActuel: sombre ? { shadowColor: p.ombre, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 6 } : {},
    etapeLabel: { fontSize: 10.5, marginTop: 5, color: sombre ? p.texteDoux : p.enTeteTexte, opacity: sombre ? 1 : 0.75 },
    etapeLabelActuel: { fontWeight: '800', opacity: 1, color: sombre ? p.accent : p.enTeteTexte },

    carte: {
      backgroundColor: p.carte, borderRadius: 16, padding: 13, marginBottom: 10,
      ...(sombre ? { borderWidth: 1, borderColor: p.bord, overflow: 'hidden' } : ombreCarte),
    },
    carteActive: sombre ? { borderColor: p.accentVif + '88' } : { borderWidth: 1.5, borderColor: p.accentVif },
    carteTitre: { fontSize: 14.5, fontWeight: '700', color: p.texte, flexShrink: 1 },
    rubrique: { fontSize: 11, fontWeight: '800', letterSpacing: 0.8, color: p.texteDoux, marginTop: 8, marginBottom: 7, marginLeft: 2, textTransform: 'uppercase' },
    texte: { fontSize: 13.5, color: p.texte, lineHeight: 19 },
    texteDoux: { fontSize: 12.5, color: p.texteDoux },
    texteVide: { fontSize: 12, color: p.texteVide, marginTop: 6 },
    petitDoux: { fontSize: 11, color: p.texteDoux, marginTop: 2 },
    petitFort: { fontSize: 11, fontWeight: '700' },
    montantFort: { fontSize: 16, fontWeight: '800', color: p.accent, fontVariant: ['tabular-nums'] },
    enormeChiffre: { fontSize: 26, fontWeight: '800', color: p.accent, fontVariant: ['tabular-nums'], marginTop: 2 },
    supprimer: { fontSize: 15, color: p.erreur, fontWeight: '700', paddingHorizontal: 6, paddingVertical: 10 },

    etiquette: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start' },
    etiquetteTxt: { fontSize: 10.5, fontWeight: '700' },

    bandeau: {
      flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 14, marginTop: 10,
      borderRadius: 12, paddingVertical: 8, paddingHorizontal: 12, borderWidth: 1,
    },
    bandeauDansCorps: { marginHorizontal: 0, marginTop: 0, marginBottom: 10 },
    bandeauTxt: { flex: 1, fontSize: 12, fontWeight: '600', lineHeight: 17 },
    bandeauAction: { fontSize: 16, paddingHorizontal: 4 },

    ligneValeur: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 7, gap: 8 },
    ligneValeurForte: { borderTopWidth: 1, borderTopColor: p.bord, marginTop: 6, paddingTop: 10 },
    ligneValeurLibelle: { fontSize: 13, color: p.texteDoux, flexShrink: 1 },
    ligneValeurVal: { fontSize: 13.5, fontWeight: '700', color: p.texte, fontVariant: ['tabular-nums'] },
    ligneValeurValForte: { fontSize: 18, fontWeight: '800' },

    piste: { height: 6, borderRadius: 3, backgroundColor: p.piste, overflow: 'hidden', marginTop: 8 },
    remplissage: { height: '100%', borderRadius: 3, overflow: 'hidden' },

    champLibelle: { fontSize: 10.5, color: p.texteDoux, fontWeight: '600', marginBottom: 4 },
    champ: {
      backgroundColor: p.champ, borderRadius: 11, paddingHorizontal: 11, paddingVertical: 10,
      fontSize: 14, color: p.texte, borderWidth: 1, borderColor: p.champBord, minHeight: 44,
    },
    champGrand: { fontSize: 19, fontWeight: '800', fontVariant: ['tabular-nums'] },
    champAccent: { borderColor: p.accentVif, borderWidth: 1.5 },
    champInactif: { opacity: 0.6 },
    champMultiligne: { minHeight: 80, textAlignVertical: 'top' },

    boutonOmbre: sombre
      ? { borderRadius: 14, shadowColor: p.ombre, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.45, shadowRadius: 16, elevation: 6 }
      : { borderRadius: 14, shadowColor: p.accent, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 10, elevation: 3 },
    bouton: { borderRadius: 14, minHeight: 50, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, overflow: 'hidden' },
    boutonTxt: { fontSize: 15, fontWeight: '800', color: p.texteBouton },
    boutonAttenue: { opacity: 0.55 },
    boutonSecondaire: {
      borderRadius: 12, minHeight: 46, alignItems: 'center', justifyContent: 'center',
      borderWidth: 1.5, borderStyle: 'dashed', borderColor: p.accentVif, marginBottom: 10, paddingHorizontal: 12,
    },
    boutonSecondaireTxt: { fontSize: 13.5, fontWeight: '700', color: p.accent },

    barreBas: {
      paddingHorizontal: 14, paddingTop: 10, paddingBottom: 14, backgroundColor: sombre ? p.fond : p.carte,
      ...(sombre
        ? { borderTopWidth: 1, borderTopColor: p.bord }
        : { shadowColor: '#000', shadowOffset: { width: 0, height: -6 }, shadowOpacity: 0.08, shadowRadius: 16, elevation: 10 }),
    },
    manquants: { fontSize: 11.5, fontWeight: '600', marginBottom: 8, lineHeight: 16 },
    barreTotalLibelle: { fontSize: 10.5, color: p.texteDoux },
    barreTotalValeur: { fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] },

    photo: { marginTop: 10, borderRadius: 12, padding: 10, borderWidth: 1, borderColor: p.bord, backgroundColor: p.champ },
    photoRequise: { borderColor: p.erreur, backgroundColor: p.erreurFond },
    photoApercu: { width: '100%', height: 140, borderRadius: 10, marginBottom: 8 },
    photoBouton: {
      borderRadius: 10, minHeight: 44, alignItems: 'center', justifyContent: 'center',
      backgroundColor: p.carte, borderWidth: 1, borderColor: p.accentVif,
    },
    photoBoutonTxt: { fontSize: 13, fontWeight: '700', color: p.accent },

    vignettes: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
    vignette: { width: 72, height: 72, borderRadius: 10, overflow: 'hidden' },
    vignetteImage: { width: 72, height: 72 },
    vignetteRetirer: {
      position: 'absolute', top: 3, right: 3, width: 22, height: 22, borderRadius: 11,
      backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center',
    },
    vignetteRetirerTxt: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
    vignetteAjout: {
      width: 72, height: 72, borderRadius: 10, borderWidth: 1.5, borderStyle: 'dashed',
      borderColor: p.accentVif, alignItems: 'center', justifyContent: 'center',
    },
    vignetteAjoutTxt: { fontSize: 24, color: p.accent },

    voile: { flex: 1, backgroundColor: p.voile, justifyContent: 'flex-end' },
    feuille: {
      backgroundColor: p.carte, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 18,
      maxHeight: '78%', borderWidth: sombre ? 1 : 0, borderColor: p.bord,
    },
    feuilleTitre: { fontSize: 16, fontWeight: '800', color: p.texte, flexShrink: 1 },
    feuilleFermer: { fontSize: 18, color: p.texteDoux, padding: 4 },
    choix: {
      flexDirection: 'row', alignItems: 'center', paddingVertical: 12, minHeight: 48,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: p.bord,
    },
    choixNom: { fontSize: 14.5, fontWeight: '600', color: p.texte },
    choixSous: { fontSize: 11.5, color: p.texteDoux, marginTop: 2 },
    vide: { fontSize: 13, color: p.texteVide, textAlign: 'center', paddingVertical: 20 },
  })
}

// Calculés une fois : deux jeux de styles, choisis selon le mode.
const STYLES = { clair: makeStyles(CLAIR, false), sombre: makeStyles(SOMBRE, true) }

export function useStyleChaleureux() {
  const { isDark } = useTheme()
  return isDark
    ? { p: SOMBRE, styles: STYLES.sombre, isDark: true }
    : { p: CLAIR, styles: STYLES.clair, isDark: false }
}

// « Samer Palmeraie » + « 2026-10-05 » → « Palmeraie · 05/10 ».
export function contexteJour(restaurantNom, dateJour) {
  const nom = restaurantNom ? nomCourtResto(restaurantNom) : ''
  const date = dateJour ? `${dateJour.slice(8, 10)}/${dateJour.slice(5, 7)}` : ''
  return [nom, date].filter(Boolean).join(' · ')
}

const TONS = p => ({
  neutre: [p.piste, p.texteDoux], ok: [p.okFond, p.ok], erreur: [p.erreurFond, p.erreur],
  alerte: [p.alerteFond, p.alerte], info: [p.infoFond, p.info],
})

let numeroDegrade = 0

/** Fond en dégradé, posé en absolu derrière le contenu de son parent. */
export function Degrade({ couleurs, horizontal = false }) {
  const id = useMemo(() => `degrade${++numeroDegrade}`, [])
  return (
    <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" preserveAspectRatio="none" pointerEvents="none">
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="1" y2={horizontal ? '0' : '1'}>
          {couleurs.map((c, i) => (
            <Stop key={c + i} offset={couleurs.length > 1 ? i / (couleurs.length - 1) : 0} stopColor={c} />
          ))}
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  )
}

/**
 * Clair : dégradé orange, grand titre blanc. Sombre : surtitre orange, grand
 * chiffre (total du jour) ou grand titre. `flottant` laisse la place aux
 * onglets qui chevauchent le bas de l'en-tête (mode clair).
 */
export function EnTete({ titre, surtitre, sous, chiffre, contexte, onRetour, libelleRetour = '‹ Retour', flottant = false, children }) {
  const { p, styles, isDark } = useStyleChaleureux()
  const haut = (
    <View style={styles.ligne}>
      <TouchableOpacity onPress={onRetour} hitSlop={10} accessibilityRole="button" accessibilityLabel={libelleRetour.replace('‹ ', '')}>
        <Text style={styles.enTeteRetour}>{libelleRetour}</Text>
      </TouchableOpacity>
      {contexte ? <Text style={styles.enTeteContexte} numberOfLines={1}>{contexte}</Text> : null}
    </View>
  )
  if (isDark) {
    const label = surtitre || (chiffre ? titre : null)
    return (
      <View style={styles.enTete}>
        {haut}
        {label ? <Text style={styles.enTeteSurtitre}>{label}</Text> : null}
        <Text style={[styles.enTeteGrand, !label && { marginTop: 12 }, chiffre && styles.enTeteChiffre]} numberOfLines={1} adjustsFontSizeToFit>
          {chiffre || titre}
        </Text>
        {sous ? <Text style={styles.enTeteSous}>{sous}</Text> : null}
        {children}
      </View>
    )
  }
  return (
    <View style={[styles.enTete, flottant && styles.enTeteFlottant]}>
      <Degrade couleurs={p.degrade} />
      {haut}
      {surtitre ? <Text style={styles.enTeteSurtitre}>{surtitre}</Text> : null}
      <Text style={[styles.enTeteTitre, !surtitre && { marginTop: 10 }]}>{titre}</Text>
      {sous ? <Text style={styles.enTeteSous}>{sous}</Text> : null}
      {children}
    </View>
  )
}

export function Onglets({ elements, actif, onChoisir, flottant = false }) {
  const { styles } = useStyleChaleureux()
  return (
    <View style={[styles.onglets, flottant && styles.ongletsFlottants]} accessibilityRole="tablist">
      {elements.map(e => {
        const sel = e.cle === actif
        return (
          <TouchableOpacity key={e.cle} style={[styles.onglet, sel && styles.ongletActif]} onPress={() => onChoisir(e.cle)}
            accessibilityRole="tab" accessibilityState={{ selected: sel }} accessibilityLabel={`${e.label}, ${e.detail || ''}`}>
            <Text style={[styles.ongletLabel, sel && styles.ongletLabelActif]} numberOfLines={1}>{e.label}</Text>
            {e.detail ? <Text style={[styles.ongletDetail, sel && styles.ongletDetailActif]} numberOfLines={1}>{e.detail}</Text> : null}
          </TouchableOpacity>
        )
      })}
    </View>
  )
}

export function BarreEtapes({ etapes, actuelle, onChoisir }) {
  const { p, styles, isDark } = useStyleChaleureux()
  return (
    <View style={styles.etapes}>
      {etapes.map((label, i) => {
        const n = i + 1
        const faite = n <= actuelle
        return (
          <TouchableOpacity key={label} style={{ flex: 1 }} onPress={() => onChoisir(n)}
            accessibilityRole="button" accessibilityLabel={`Étape ${n} : ${label}`} accessibilityState={{ selected: n === actuelle }}>
            <View style={[styles.etapeTrait, faite && styles.etapeTraitFait, n === actuelle && styles.etapeTraitActuel]}>
              {isDark && faite ? <Degrade couleurs={p.degradeBouton} horizontal /> : null}
            </View>
            <Text style={[styles.etapeLabel, n === actuelle && styles.etapeLabelActuel]} numberOfLines={1}>{n} · {label}</Text>
          </TouchableOpacity>
        )
      })}
    </View>
  )
}

export function Carte({ children, style, active }) {
  const { p, styles, isDark } = useStyleChaleureux()
  return (
    <View style={[styles.carte, active && styles.carteActive, style]}>
      {isDark ? <Degrade couleurs={[p.carte, p.carteFin]} /> : null}
      {children}
    </View>
  )
}

export function Rubrique({ children }) {
  const { styles } = useStyleChaleureux()
  return <Text style={styles.rubrique}>{children}</Text>
}

export function Etiquette({ texte, ton = 'neutre' }) {
  const { p, styles } = useStyleChaleureux()
  const [fond, couleur] = TONS(p)[ton] || TONS(p).neutre
  return (
    <View style={[styles.etiquette, { backgroundColor: fond }]}>
      <Text style={[styles.etiquetteTxt, { color: couleur }]}>{texte}</Text>
    </View>
  )
}

export function Bandeau({ texte, ton = 'alerte', chargement, action, style }) {
  const { p, styles } = useStyleChaleureux()
  const [fond, couleur] = TONS(p)[ton] || TONS(p).alerte
  return (
    <View style={[styles.bandeau, { backgroundColor: fond, borderColor: couleur + '55' }, style]}>
      {chargement ? <ActivityIndicator size="small" color={couleur} /> : null}
      <Text style={[styles.bandeauTxt, { color: couleur }]}>{texte}</Text>
      {action ? (
        <TouchableOpacity onPress={action.onPress} disabled={action.disabled} hitSlop={10} accessibilityRole="button" accessibilityLabel={action.libelle}>
          <Text style={[styles.bandeauAction, { color: couleur }]}>{action.icone}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  )
}

export function LigneValeur({ libelle, etiquette, valeur, fort, couleur }) {
  const { styles } = useStyleChaleureux()
  const etq = typeof etiquette === 'string' ? { texte: etiquette } : etiquette
  return (
    <View style={[styles.ligneValeur, fort && styles.ligneValeurForte]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
        <Text style={[styles.ligneValeurLibelle, fort && { fontWeight: '800', color: couleur }]}>{libelle}</Text>
        {etq ? <Etiquette texte={etq.texte} ton={etq.ton} /> : null}
      </View>
      <Text style={[styles.ligneValeurVal, fort && styles.ligneValeurValForte, couleur && { color: couleur }]}>{valeur}</Text>
    </View>
  )
}

export function BarreProgression({ ratio, solde }) {
  const { p, styles } = useStyleChaleureux()
  const largeur = `${Math.round(Math.max(0, Math.min(1, ratio || 0)) * 100)}%`
  return (
    <View style={styles.piste}>
      <View style={[styles.remplissage, { width: largeur, backgroundColor: solde ? p.ok : p.accentVif }]}>
        {solde ? null : <Degrade couleurs={p.degradeBouton} horizontal />}
      </View>
    </View>
  )
}

export function Champ({ libelle, grand, accent, editable = true, multiline, style, ...props }) {
  const { p, styles } = useStyleChaleureux()
  return (
    <View style={style}>
      {libelle ? <Text style={styles.champLibelle}>{libelle}</Text> : null}
      <TextInput
        {...props}
        editable={editable}
        multiline={multiline}
        placeholderTextColor={p.texteVide}
        style={[styles.champ, grand && styles.champGrand, accent && styles.champAccent, multiline && styles.champMultiligne, !editable && styles.champInactif]}
      />
    </View>
  )
}

export function BoutonDegrade({ label, onPress, disabled, attenue, chargement, style }) {
  const { p, styles } = useStyleChaleureux()
  return (
    <View style={[styles.boutonOmbre, (attenue || disabled) && styles.boutonAttenue, style]}>
      <TouchableOpacity onPress={onPress} disabled={disabled || chargement} activeOpacity={0.85} style={styles.bouton}
        accessibilityRole="button" accessibilityLabel={label}>
        <Degrade couleurs={p.degradeBouton} horizontal />
        {chargement ? <ActivityIndicator color={p.texteBouton} /> : <Text style={styles.boutonTxt}>{label}</Text>}
      </TouchableOpacity>
    </View>
  )
}

export function BoutonSecondaire({ label, onPress, disabled, style }) {
  const { styles } = useStyleChaleureux()
  return (
    <TouchableOpacity style={[styles.boutonSecondaire, disabled && styles.boutonAttenue, style]} onPress={onPress} disabled={disabled}
      accessibilityRole="button" accessibilityLabel={label}>
      <Text style={styles.boutonSecondaireTxt}>{label}</Text>
    </TouchableOpacity>
  )
}

/** Barre fixe sous le défilement : « Il manque : … », total éventuel, bouton(s). */
export function BarreBas({ libelle, valeur, couleurValeur, manquants = [], children }) {
  const { p, styles } = useStyleChaleureux()
  const bloquant = manquants.some(m => m.bloquant)
  return (
    <View style={styles.barreBas}>
      {manquants.length > 0 ? (
        <Text style={[styles.manquants, { color: bloquant ? p.erreur : p.alerte }]}>
          ⚠ Il manque : {manquants.map(m => m.texte).join(', ')}
        </Text>
      ) : null}
      {libelle ? (
        <View style={styles.ligne}>
          <View style={{ flexShrink: 1 }}>
            <Text style={styles.barreTotalLibelle}>{libelle}</Text>
            <Text style={[styles.barreTotalValeur, { color: couleurValeur || p.texte }]} numberOfLines={1} adjustsFontSizeToFit>{valeur}</Text>
          </View>
          <View style={{ flexShrink: 0, minWidth: 150 }}>{children}</View>
        </View>
      ) : children}
    </View>
  )
}

export function BlocPhoto({ uri, valide, requis, label, onPress, uploading, modifiable = true }) {
  const { p, styles } = useStyleChaleureux()
  const manque = requis && !valide
  return (
    <View style={[styles.photo, manque && styles.photoRequise]}>
      <View style={[styles.ligne, { marginBottom: uri || modifiable ? 8 : 0 }]}>
        <Text style={styles.texteDoux}>
          📷 {label}{requis ? <Text style={{ color: p.erreur }}> *</Text> : null}
        </Text>
        {valide ? <Etiquette ton="ok" texte="Photo OK" /> : requis ? <Etiquette ton="erreur" texte="Requise" /> : null}
      </View>
      {uri ? <PhotoJustificatif uri={uri} style={styles.photoApercu} /> : null}
      {modifiable ? (
        <TouchableOpacity style={styles.photoBouton} onPress={onPress} disabled={uploading} accessibilityRole="button"
          accessibilityLabel={uri ? `Changer la photo : ${label}` : `Ajouter une photo : ${label}`}>
          {uploading
            ? <ActivityIndicator size="small" color={p.accent} />
            : <Text style={styles.photoBoutonTxt}>{uri ? 'Changer la photo' : 'Ajouter une photo'}</Text>}
        </TouchableOpacity>
      ) : null}
    </View>
  )
}

export function Feuille({ visible, titre, onFermer, children }) {
  const { styles } = useStyleChaleureux()
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onFermer}>
      <View style={styles.voile}>
        <View style={styles.feuille}>
          <View style={[styles.ligne, { marginBottom: 12 }]}>
            <Text style={styles.feuilleTitre}>{titre}</Text>
            <TouchableOpacity onPress={onFermer} hitSlop={10} accessibilityRole="button" accessibilityLabel="Fermer">
              <Text style={styles.feuilleFermer}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {children}
            <View style={{ height: 16 }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

export function Choix({ nom, sous, etiquette, desactive, onPress }) {
  const { styles } = useStyleChaleureux()
  return (
    <TouchableOpacity style={[styles.choix, desactive && { opacity: 0.4 }]} onPress={onPress} disabled={desactive}
      accessibilityRole="button" accessibilityLabel={nom}>
      <View style={{ flex: 1 }}>
        <Text style={styles.choixNom}>{nom}</Text>
        {sous ? <Text style={styles.choixSous}>{sous}</Text> : null}
      </View>
      {etiquette ? <Etiquette ton="ok" texte={etiquette} /> : null}
    </TouchableOpacity>
  )
}

export function Vide({ texte }) {
  const { styles } = useStyleChaleureux()
  return <Text style={styles.vide}>{texte}</Text>
}
```

- [ ] **Step 2 : lint** — `npx eslint components/ui/StyleChaleureux.js` → 0 erreur.

- [ ] **Step 3 : commit**

```bash
export DEVELOPER_DIR=/Library/Developer/CommandLineTools
git add components/ui/StyleChaleureux.js
git commit -m "feat(ui): kit de style chaleureux (dégradé clair / sombre premium) pour les écrans gérant"
git push
```

---

### Task 3 : Déductions gérant en onglets

**Files :**
- Create : `components/deductions/OngletFournisseurs.js`, `components/deductions/OngletDepenses.js`, `components/deductions/OngletPaies.js`
- Modify : `app/deductions-gerant.js` (rendu complet, état des sections, imports ; logique métier inchangée)

**Interfaces :**
- Consumes : kit de la Task 2 ; `manquantsDeductions`, `progressionFournisseur`, `resumeDeductions` (Task 1) ; `estPhotoValide` (`lib/photoQueue.js`) ; `CATEGORIES_DEPENSES` (`lib/constants.js`).
- Produces : `OngletFournisseurs({ fournisseursList, fournisseursGerantCaisse, chargement, ouverts, basculer, getCreditVeille, majFournisseur, onPhoto, uploading, fmt })`, `OngletDepenses({ depenses, ajouter, supprimer, maj, fmt })`, `OngletPaies({ paies, choisirTravailleur, majMontant, supprimer, ajouter })`.

- [ ] **Step 1 : `components/deductions/OngletFournisseurs.js`**

```js
// Onglet Fournisseurs des déductions gérant : une carte par fournisseur
// (dû, payé du jour, barre payé / dû, photo) ; toucher la carte ouvre la saisie.
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native'
import { progressionFournisseur } from '../../lib/manquantsSaisie'
import { estPhotoValide } from '../../lib/photoQueue'
import { BarreProgression, BlocPhoto, Carte, Champ, Etiquette, Vide, useStyleChaleureux } from '../ui/StyleChaleureux'

export default function OngletFournisseurs({
  fournisseursList, fournisseursGerantCaisse, chargement, ouverts, basculer,
  getCreditVeille, majFournisseur, onPhoto, uploading, fmt,
}) {
  const { p, styles } = useStyleChaleureux()
  if (chargement) return <ActivityIndicator color={p.accentVif} style={{ paddingVertical: 24 }} />
  if (fournisseursList.length === 0) return <Vide texte="Aucun fournisseur enregistré pour ce restaurant" />

  return (
    <>
      {fournisseursList.map(four => {
        const data = fournisseursGerantCaisse[four.id] || {}
        const ouvert = ouverts.has(four.id)
        const creditV = getCreditVeille(four)
        const facture = parseFloat(data.montant_facture) || 0
        const prog = progressionFournisseur({ creditVeille: creditV, facture, paye: data.paye })
        const photoOk = estPhotoValide(data.photoUri)
        const saisi = facture > 0 || prog.paye > 0
        const maj = champ => v => majFournisseur(four.id, four.nom, champ, v)
        return (
          <Carte key={four.id} active={ouvert}>
            <TouchableOpacity onPress={() => basculer(four.id)} accessibilityRole="button"
              accessibilityState={{ expanded: ouvert }} accessibilityLabel={`${four.nom}, ${ouvert ? 'fermer' : 'saisir'}`}>
              <View style={styles.ligne}>
                <Text style={styles.carteTitre} numberOfLines={1}>{four.nom}</Text>
                {creditV > 0
                  ? <Etiquette ton="erreur" texte={`dû ${fmt(creditV)}`} />
                  : creditV < 0 ? <Etiquette ton="ok" texte={`avance ${fmt(-creditV)}`} /> : null}
              </View>
              {four.caissier_facture > 0
                ? <Text style={styles.petitDoux}>dont facture caissier : {fmt(four.caissier_facture)}</Text>
                : null}
              {saisi ? (
                <>
                  <View style={[styles.ligne, { marginTop: 8 }]}>
                    <Text style={styles.texteDoux}>Payé aujourd'hui</Text>
                    <Text style={styles.montantFort}>{fmt(prog.paye)}</Text>
                  </View>
                  <BarreProgression ratio={prog.ratio} solde={prog.solde} />
                  <View style={[styles.ligne, { marginTop: 6 }]}>
                    <Text style={[styles.petitDoux, prog.solde && { color: p.ok, fontWeight: '700' }]}>
                      {prog.solde ? (prog.reste < 0 ? `Avance payée ${fmt(-prog.reste)}` : 'Soldé') : `Reste dû ${fmt(prog.reste)}`}
                    </Text>
                    {facture > 0
                      ? <Text style={[styles.petitFort, { color: photoOk ? p.ok : p.erreur }]}>{photoOk ? '● Photo OK' : '● Photo requise'}</Text>
                      : null}
                  </View>
                </>
              ) : (
                <Text style={styles.texteVide}>Rien saisi aujourd'hui · toucher pour saisir</Text>
              )}
            </TouchableOpacity>

            {ouvert ? (
              <View style={{ marginTop: 12, gap: 8 }}>
                <Champ value={data.facture_ref || ''} onChangeText={maj('facture_ref')} placeholder="N° facture / référence (optionnel)" />
                <View style={styles.ligneChamps}>
                  <Champ style={{ flex: 1 }} libelle="Facture du jour (FCFA)" keyboardType="numeric" placeholder="0"
                    value={data.montant_facture || ''} onChangeText={maj('montant_facture')} />
                  <Champ style={{ flex: 1 }} libelle="Payé ce jour (FCFA)" accent keyboardType="numeric" placeholder="0"
                    value={data.paye || ''} onChangeText={maj('paye')} />
                </View>
                <BlocPhoto uri={data.photoUri} valide={photoOk} requis={facture > 0} label="Justificatif facture"
                  onPress={() => onPhoto(four)} uploading={uploading} />
              </View>
            ) : null}
          </Carte>
        )
      })}
    </>
  )
}
```

- [ ] **Step 2 : `components/deductions/OngletDepenses.js`**

```js
// Onglet Dépenses des déductions gérant : les 4 catégories, lignes description / montant.
import { Text, TouchableOpacity, View } from 'react-native'
import { CATEGORIES_DEPENSES } from '../../lib/constants'
import { BoutonSecondaire, Carte, Champ, Rubrique, useStyleChaleureux } from '../ui/StyleChaleureux'

const EMOJIS = ['🛒', '🥦', '🍊', '📦']

export default function OngletDepenses({ depenses, ajouter, supprimer, maj, fmt }) {
  const { p, styles } = useStyleChaleureux()
  return (
    <>
      {CATEGORIES_DEPENSES.map((cat, k) => {
        const lignes = depenses[cat] || []
        const total = lignes.reduce((s, l) => s + (parseFloat(l.montant) || 0), 0)
        return (
          <View key={cat} style={{ marginBottom: 6 }}>
            <View style={styles.ligne}>
              <Rubrique>{EMOJIS[k]} {cat}</Rubrique>
              {total > 0 ? <Text style={[styles.petitFort, { color: p.accent }]}>{fmt(total)}</Text> : null}
            </View>
            {lignes.map((ligne, i) => (
              <Carte key={ligne.id || i}>
                <View style={[styles.ligneChamps, { alignItems: 'center' }]}>
                  <Champ style={{ flex: 2 }} value={ligne.description || ''} onChangeText={v => maj(cat, i, 'description', v)} placeholder="Description" />
                  <Champ style={{ flex: 1 }} keyboardType="numeric" value={ligne.montant || ''} onChangeText={v => maj(cat, i, 'montant', v)} placeholder="Montant" />
                  <TouchableOpacity onPress={() => supprimer(cat, i)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Supprimer la ligne">
                    <Text style={styles.supprimer}>✕</Text>
                  </TouchableOpacity>
                </View>
              </Carte>
            ))}
            <BoutonSecondaire label={`+ Ajouter (${cat})`} onPress={() => ajouter(cat)} />
          </View>
        )
      })}
    </>
  )
}
```

- [ ] **Step 3 : `components/deductions/OngletPaies.js`**

```js
// Onglet Paies des déductions gérant : travailleur + montant payé.
import { Text, TouchableOpacity, View } from 'react-native'
import { BoutonSecondaire, Carte, Champ, Vide, useStyleChaleureux } from '../ui/StyleChaleureux'

export default function OngletPaies({ paies, choisirTravailleur, majMontant, supprimer, ajouter }) {
  const { p, styles } = useStyleChaleureux()
  return (
    <>
      {paies.length === 0 ? <Vide texte="Aucune paie saisie aujourd'hui" /> : null}
      {paies.map((ligne, i) => (
        <Carte key={ligne.id || i}>
          <View style={[styles.ligneChamps, { alignItems: 'center' }]}>
            <TouchableOpacity style={[{ flex: 2 }, styles.ligne]} onPress={() => choisirTravailleur(i)}
              accessibilityRole="button" accessibilityLabel={ligne.travailleur_nom || 'Choisir un travailleur'}>
              <Text style={[styles.carteTitre, !ligne.travailleur_nom && { color: p.texteVide, fontWeight: '500' }]} numberOfLines={1}>
                {ligne.travailleur_nom || '👤 Choisir un travailleur…'}
              </Text>
              <Text style={{ color: p.accent, fontSize: 18 }}>›</Text>
            </TouchableOpacity>
            <Champ style={{ flex: 1 }} keyboardType="numeric" placeholder="Montant" value={ligne.montant || ''} onChangeText={v => majMontant(i, v)} />
            <TouchableOpacity onPress={() => supprimer(i)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Supprimer la paie">
              <Text style={styles.supprimer}>✕</Text>
            </TouchableOpacity>
          </View>
        </Carte>
      ))}
      <BoutonSecondaire label="+ Ajouter une paie" onPress={ajouter} />
    </>
  )
}
```

- [ ] **Step 4 : `app/deductions-gerant.js` — imports**

Remplacer le bloc d'imports (lignes 1–25) par :

```js
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
```

- [ ] **Step 5 : `app/deductions-gerant.js` — état**

Dans `useApp()` ajouter `restaurantNom`. Remplacer :

```js
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const [sectionsOuvertes, setSectionsOuvertes] = useState(new Set())
```
par :
```js
  const { p, styles, isDark } = useStyleChaleureux()

  const [onglet, setOnglet] = useState('fournisseurs')
  const [fournOuverts, setFournOuverts] = useState(new Set())
```

Dans `sauvegarder()`, remplacer la ligne
```js
      setSectionsOuvertes(prev => new Set([...prev, 'fournisseurs', ...sansPhoto.map(id => `four_${id}`)]))
```
par
```js
      setOnglet('fournisseurs')
      setFournOuverts(prev => new Set([...prev, ...sansPhoto]))
```

Remplacer `toggleSection` par :
```js
  function basculerFournisseur(id) {
    setFournOuverts(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
```
Toutes les autres fonctions (`chargerDonnees`, `chargerBrouillon`, `sauvegarder`, `ouvrirSelecteurTravailleur`, `selectionnerTravailleur`, `ajouterLigneDep`, `supprimerLigneDep`, `updateLigneDep`, `updateFournisseurGerant`, `getCreditVeille`, `gererPhoto`, `fmt`) restent identiques.

- [ ] **Step 6 : `app/deductions-gerant.js` — rendu**

Remplacer tout le `return (…)` du composant et supprimer `function makeStyles(…)` par :

```js
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
```

- [ ] **Step 7 : vérifier** — `npx eslint app/deductions-gerant.js components/deductions` → 0 erreur ; `for f in lib/*.test.mjs; do node "$f"; done` → 0 échec.

- [ ] **Step 8 : commit**

```bash
export DEVELOPER_DIR=/Library/Developer/CommandLineTools
git add app/deductions-gerant.js components/deductions
git commit -m "feat(deductions): onglets Fournisseurs / Dépenses / Paies, barre payé/dû et total collant"
git push
```

---

### Task 4 : Saisie des ventes en 3 étapes

**Files :**
- Create : `components/ventes/EtapeTab.js`, `components/ventes/EtapeFondBenefice.js`, `components/ventes/EtapeMachineEcart.js`
- Modify : `app/ventes.js` (imports, `verifierPhotosObligatoires`, `allerAuRecap`, suppression de `PhotoBlock`, rendu complet ; chargements et enregistrements inchangés)

**Interfaces :**
- Consumes : kit Task 2 ; `manquantsVentes`, `photosManquantesVentes` (Task 1) ; `COEFFICIENTS` ; `PhotoJustificatif`.
- Produces :
  - `EtapeTab({ ventesJour, setVente, setVentesJour, modifiable, cumulShifts, voitShifts, onPhoto, uploading, fmt })`
  - `EtapeFondBenefice({ ventesJour, setVente, modifiable, fcRecuAuto, resteEspeces, fc, beneficeSC, fmt })`
  - `EtapeMachineEcart({ ventesJour, setVente, setVentesJour, modifiable, cumulShifts, voitMachine, venteMachineDuPOS, saisieManuelle, secoursDisponible, onSecours, venteMachineRecue, venteMachineDuSysteme, onPhoto, uploading, responsablesDispo, onChoisirResponsable, onMontantResponsable, onRetirerResponsable, onAjouterPhotoEcart, onRetirerPhotoEcart, fmt })`

- [ ] **Step 1 : `components/ventes/EtapeTab.js`**

```js
// Étape 1 de la saisie des ventes : livraisons TAB (Yango, Glovo) et récap des shifts.
import { Text, View } from 'react-native'
import { COEFFICIENTS } from '../../lib/constants'
import { Bandeau, BlocPhoto, Carte, Champ, Etiquette, LigneValeur, Rubrique, useStyleChaleureux } from '../ui/StyleChaleureux'

const CANAUX = [
  { cle: 'yango', titre: 'Yango TAB', coeff: COEFFICIENTS.YANGO, montant: 'yangoTab', nb: 'yangoNbCommandes', photo: 'photo_yango_tab', dossier: 'yango_tab' },
  { cle: 'glovo', titre: 'Glovo TAB', coeff: COEFFICIENTS.GLOVO, montant: 'glovoTab', nb: 'glovoNbCommandes', photo: 'photo_glovo_tab', dossier: 'glovo_tab' },
]
const virgule = n => String(n).replace('.', ',')

export default function EtapeTab({ ventesJour, setVente, setVentesJour, modifiable, cumulShifts, voitShifts, onPhoto, uploading, fmt }) {
  const { p, styles } = useStyleChaleureux()
  const recap = cumulShifts ? [
    { label: 'Dépenses + Fournisseurs', val: cumulShifts.depenses + cumulShifts.fournisseurs },
    { label: 'Yango CSE', val: cumulShifts.yangoCse },
    { label: 'Glovo CSE', val: cumulShifts.glovoCse },
    { label: 'Wave', val: cumulShifts.wave },
    { label: 'Orange Money', val: cumulShifts.om },
    { label: 'Djamo', val: cumulShifts.djamo },
    { label: 'KDO', val: cumulShifts.kdo },
    { label: 'Retours', val: cumulShifts.retour },
    { label: 'Espèces en caisse', val: cumulShifts.espece },
  ].filter(r => r.val > 0) : []

  return (
    <>
      {voitShifts && cumulShifts ? (
        <Bandeau ton="alerte" style={styles.bandeauDansCorps}
          texte={`${cumulShifts.nbShifts} shift(s) déjà intégrés : Yango/Glovo CSE, Wave, OM, Djamo, KDO, retours et espèces sont pré-chargés. Seuls les canaux TAB restent à saisir.`} />
      ) : null}

      <Rubrique>À saisir</Rubrique>
      {CANAUX.map(c => {
        const montant = parseFloat(ventesJour[c.montant]) || 0
        return (
          <Carte key={c.cle}>
            <View style={styles.ligne}>
              <Text style={styles.carteTitre}>🛵 {c.titre}</Text>
              <Etiquette texte={montant > 0 ? `×${virgule(c.coeff)} → ${fmt(montant * c.coeff)}` : `×${virgule(c.coeff)}`} />
            </View>
            <View style={[styles.ligneChamps, { marginTop: 10 }]}>
              <Champ style={{ flex: 2 }} libelle="Montant (FCFA)" grand keyboardType="numeric" placeholder="0"
                value={ventesJour[c.montant] || ''} onChangeText={v => setVente(c.montant, v)} editable={modifiable} />
              <Champ style={{ flex: 1 }} libelle="Nb commandes" grand keyboardType="numeric" placeholder="0"
                value={ventesJour[c.nb] || ''} onChangeText={v => setVente(c.nb, v)} editable={modifiable} />
            </View>
            <BlocPhoto uri={ventesJour[c.photo]} valide={!!ventesJour[c.photo]} requis={montant > 0}
              label={`Photo ${c.titre}`} modifiable={modifiable} uploading={uploading}
              onPress={() => onPhoto(url => setVentesJour(prev => ({ ...prev, [c.photo]: url })), c.dossier)} />
          </Carte>
        )
      })}

      {voitShifts && cumulShifts ? (
        <>
          <Rubrique>Récap shifts (auto)</Rubrique>
          <Carte>
            {recap.map(r => <LigneValeur key={r.label} libelle={r.label} valeur={fmt(r.val)} />)}
            <LigneValeur fort libelle="Vente shifts total" valeur={fmt(cumulShifts.venteTotal)} couleur={p.accent} />
          </Carte>
        </>
      ) : null}
    </>
  )
}
```

- [ ] **Step 2 : `components/ventes/EtapeFondBenefice.js`**

```js
// Étape 2 de la saisie des ventes : fond de caisse et bénéfice SC (calculs de AppContext).
import { Text, View } from 'react-native'
import { COEFFICIENTS } from '../../lib/constants'
import { Carte, Champ, Etiquette, LigneValeur, Rubrique, useStyleChaleureux } from '../ui/StyleChaleureux'

export default function EtapeFondBenefice({ ventesJour, setVente, modifiable, fcRecuAuto, resteEspeces, fc, beneficeSC, fmt }) {
  const { p, styles } = useStyleChaleureux()
  const reste = resteEspeces()
  const detailTreso = (ventesJour.fc_recu_detail || [])
    .map(l => `${l.montant >= 0 ? '+' : '−'} ${fmt(Math.abs(l.montant))} (${l.type === 'fond' ? 'fond donné' : 'repris'} le ${l.date.slice(8, 10)}/${l.date.slice(5, 7)})`)
    .join(' · ')
  const benefices = [
    { label: `Yango TAB ×${COEFFICIENTS.YANGO}`, val: (parseFloat(ventesJour.yangoTab) || 0) * COEFFICIENTS.YANGO },
    { label: `Glovo TAB ×${COEFFICIENTS.GLOVO}`, val: (parseFloat(ventesJour.glovoTab) || 0) * COEFFICIENTS.GLOVO },
    { label: `Wave ×${COEFFICIENTS.WAVE}`, val: (parseFloat(ventesJour.wave) || 0) * COEFFICIENTS.WAVE },
    { label: `Orange Money ×${COEFFICIENTS.OM}`, val: (parseFloat(ventesJour.om) || 0) * COEFFICIENTS.OM },
    { label: `Djamo ×${COEFFICIENTS.DJAMO}`, val: (parseFloat(ventesJour.djamo) || 0) * COEFFICIENTS.DJAMO },
  ].filter(r => r.val > 0)

  return (
    <>
      <Rubrique>Fond de caisse</Rubrique>
      <Carte>
        <LigneValeur libelle="FC de la veille" etiquette="auto" valeur={fmt(parseFloat(ventesJour.fcVeille) || 0)} />
        <View style={{ paddingVertical: 7 }}>
          <View style={styles.ligne}>
            <View style={{ flexShrink: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={[styles.texte, { fontWeight: '700' }]}>FC reçu</Text>
                {fcRecuAuto ? <Etiquette ton="ok" texte="Trésorerie" /> : null}
              </View>
              {!fcRecuAuto ? <Text style={styles.petitDoux}>Ajustement admin (+ complément / − déduction)</Text> : null}
            </View>
            <Champ style={{ width: 130 }} keyboardType="numbers-and-punctuation" placeholder="0"
              value={ventesJour.fc_recu || ''} onChangeText={v => setVente('fc_recu', v)} editable={!fcRecuAuto && modifiable} />
          </View>
          {detailTreso ? (
            <Text style={[styles.petitDoux, { color: p.accent, fontWeight: '600', marginTop: 4 }]}>Trésorerie : {detailTreso}</Text>
          ) : null}
        </View>
        <LigneValeur libelle="Espèces en caisse" etiquette="shifts" valeur={fmt(reste)} />
        <LigneValeur fort libelle="FC calculé" valeur={fmt(fc())} couleur={p.accent} />
      </Carte>

      <Rubrique>Bénéfice SC</Rubrique>
      <Carte>
        {benefices.map(r => <LigneValeur key={r.label} libelle={r.label} valeur={fmt(r.val)} />)}
        <LigneValeur libelle="Reste espèces" valeur={reste >= 0 ? fmt(reste) : `− ${fmt(Math.abs(reste))}`}
          couleur={reste < 0 ? p.erreur : undefined} />
        <LigneValeur fort libelle="Bénéfice SC total" valeur={fmt(beneficeSC())} couleur={p.ok} />
      </Carte>
    </>
  )
}
```

- [ ] **Step 3 : `components/ventes/EtapeMachineEcart.js`**

```js
// Étape 3 de la saisie des ventes : vente machine (saisie ou 🔒 POS), clôtures
// POS (rapport Z), écart historique, explication, responsables et photos.
// Mêmes conditions d'affichage qu'avant la refonte (voir app/ventes.js).
import { Text, TouchableOpacity, View } from 'react-native'
import PhotoJustificatif from '../PhotoJustificatif'
import {
  Bandeau, BarreProgression, BlocPhoto, BoutonSecondaire, Carte, Champ, Etiquette, LigneValeur, Rubrique, Vide,
  useStyleChaleureux,
} from '../ui/StyleChaleureux'

function Justification({
  ventesJour, setVente, ecart, modifiable, responsablesDispo, onChoisirResponsable, onMontantResponsable,
  onRetirerResponsable, onAjouterPhotoEcart, onRetirerPhotoEcart, onPhoto, uploading, fmt,
}) {
  const { p, styles } = useStyleChaleureux()
  const libelle = ecart < 0 ? 'manquant' : 'surplus'
  const montantEcart = Math.abs(ecart)
  const responsables = ventesJour.ecartResponsables || []
  const totalImpute = responsables.reduce((s, r) => s + (parseFloat(r.montant) || 0), 0)
  const reste = montantEcart - totalImpute
  const complet = Math.round(reste) === 0
  const photos = ventesJour.ecartPhotos || []
  const longueur = (ventesJour.explicacionEcartMachine || '').trim().length

  return (
    <Carte style={{ borderWidth: 1, borderColor: p.erreur + '66' }}>
      <Rubrique>📝 Explication obligatoire</Rubrique>
      <Text style={styles.petitDoux}>Justifiez l'écart avant de continuer (min. 10 caractères)</Text>
      <Champ multiline style={{ marginTop: 8 }} value={ventesJour.explicacionEcartMachine || ''}
        onChangeText={v => setVente('explicacionEcartMachine', v)}
        placeholder="Ex : Erreur de saisie caissier, remboursement client..." editable={modifiable} />
      {longueur > 0 ? (
        <Text style={[styles.petitFort, { marginTop: 4, color: longueur >= 10 ? p.ok : p.erreur }]}>
          {longueur}/10 caractères minimum {longueur >= 10 ? '✅' : ''}
        </Text>
      ) : null}

      <Rubrique>👤 Responsables du {libelle}</Rubrique>
      <Text style={styles.petitDoux}>Répartissez le {libelle} de {fmt(montantEcart)} entre les responsables.</Text>
      {responsables.map(r => (
        <View key={r.travailleur_id} style={[styles.ligneChamps, { marginTop: 8, alignItems: 'center' }]}>
          <Text style={[styles.texte, { flex: 1, fontWeight: '600' }]} numberOfLines={1}>{r.nom}</Text>
          <Champ style={{ width: 120 }} keyboardType="numeric" placeholder="Montant" value={String(r.montant ?? '')}
            onChangeText={v => onMontantResponsable(r.travailleur_id, v.replace(/[^0-9]/g, ''))} editable={modifiable} />
          {modifiable ? (
            <TouchableOpacity onPress={() => onRetirerResponsable(r.travailleur_id)} hitSlop={8}
              accessibilityRole="button" accessibilityLabel={`Retirer ${r.nom}`}>
              <Text style={styles.supprimer}>✕</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ))}
      <BarreProgression ratio={montantEcart > 0 ? totalImpute / montantEcart : 1} solde={complet} />
      <Text style={[styles.petitFort, { marginTop: 5, color: complet ? p.ok : p.erreur }]}>
        {complet
          ? `✅ Réparti : ${fmt(totalImpute)} / ${fmt(montantEcart)}`
          : `Réparti : ${fmt(totalImpute)} / ${fmt(montantEcart)} — reste ${fmt(reste)}`}
      </Text>
      {modifiable && responsablesDispo.length > 0 ? (
        <BoutonSecondaire label="+ Ajouter un responsable" onPress={onChoisirResponsable} style={{ marginTop: 10 }} />
      ) : null}

      <Rubrique>📷 Photos justificatives</Rubrique>
      <Text style={styles.petitDoux}>Optionnel — ajoutez une ou plusieurs photos.</Text>
      <View style={styles.vignettes}>
        {photos.map((uri, i) => (
          <View key={uri + i} style={styles.vignette}>
            <PhotoJustificatif uri={uri} style={styles.vignetteImage} compact />
            {modifiable ? (
              <TouchableOpacity style={styles.vignetteRetirer} onPress={() => onRetirerPhotoEcart(i)}
                accessibilityRole="button" accessibilityLabel="Retirer la photo">
                <Text style={styles.vignetteRetirerTxt}>✕</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ))}
        {modifiable ? (
          <TouchableOpacity style={styles.vignetteAjout} disabled={uploading} onPress={() => onPhoto(onAjouterPhotoEcart, 'ecart-manquant')}
            accessibilityRole="button" accessibilityLabel="Ajouter une photo justificative">
            <Text style={styles.vignetteAjoutTxt}>{uploading ? '…' : '＋'}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </Carte>
  )
}

export default function EtapeMachineEcart(props) {
  const {
    ventesJour, setVente, setVentesJour, modifiable, cumulShifts, voitMachine, venteMachineDuPOS, saisieManuelle,
    secoursDisponible, onSecours, venteMachineRecue, venteMachineDuSysteme, onPhoto, uploading, fmt,
  } = props
  const { p, styles } = useStyleChaleureux()
  if (!voitMachine) return <Vide texte="La vente machine est saisie par le gérant." />

  const machine = parseFloat(ventesJour.venteMachine) || 0
  const ecart = cumulShifts ? cumulShifts.venteTotal - machine : 0
  const clotures = cumulShifts?.cloturesPOS || []
  const couleurEcart = v => (v == null ? p.texteDoux : v < 0 ? p.erreur : v > 0 ? p.ok : p.texteDoux)
  const verrouPOS = venteMachineDuPOS && !saisieManuelle
  const ecartHistorique = venteMachineRecue && cumulShifts && clotures.length === 0
  const aJustifier = venteMachineRecue && !venteMachineDuSysteme && cumulShifts && ecart !== 0 && modifiable
  const indispo = cumulShifts?.ecartsGlobaux?.indisponibles || 0

  return (
    <>
      <Carte>
        {cumulShifts ? <LigneValeur libelle="Vente théorique" etiquette="shifts" valeur={fmt(cumulShifts.venteTotal)} /> : null}
        <View style={{ marginTop: 8 }}>
          <Text style={[styles.texte, { fontWeight: '700' }]}>Vente machine</Text>
          <Text style={styles.petitDoux}>{venteMachineDuPOS ? 'Remplie automatiquement par le POS' : 'Montant lu sur la caisse / POS'}</Text>
          {verrouPOS ? (
            <>
              <Text style={[styles.enormeChiffre, !venteMachineRecue && { color: p.texteVide, fontSize: 16 }]}>
                {venteMachineRecue ? fmt(machine) : 'En attente du POS'}
              </Text>
              <Text style={styles.petitDoux}>🔒 Rempli par le POS</Text>
              {secoursDisponible ? (
                <BoutonSecondaire label="Saisir manuellement" onPress={onSecours} style={{ marginTop: 10, marginBottom: 0 }} />
              ) : null}
            </>
          ) : (
            <Champ style={{ marginTop: 8 }} grand accent keyboardType="numeric" placeholder="Saisir…"
              value={ventesJour.venteMachine || ''} onChangeText={v => setVente('venteMachine', v)} editable={modifiable} />
          )}
        </View>
        {!venteMachineDuSysteme && modifiable ? (
          <BlocPhoto uri={ventesJour.photoVenteMachine} valide={!!ventesJour.photoVenteMachine} requis label="Photo vente machine"
            uploading={uploading} onPress={() => onPhoto(url => setVentesJour(prev => ({ ...prev, photoVenteMachine: url })), 'vente-machine')} />
        ) : null}
      </Carte>

      {clotures.length > 0 ? (
        <Carte>
          <View style={styles.ligne}>
            <Rubrique>Clôtures de caisse POS</Rubrique>
            <Etiquette texte="Rapport Z" />
          </View>
          {clotures.map((c, i) => (
            <View key={c.pos_service_id || c.id || i} style={{ paddingVertical: 7 }}>
              <View style={styles.ligne}>
                <Text style={[styles.texte, { fontWeight: '700', flexShrink: 1 }]} numberOfLines={1}>
                  {c.caissier_nom || 'Caissier non identifié'}
                </Text>
                <Text style={[styles.petitFort, { fontSize: 12.5, color: couleurEcart(c.ecartGlobal) }]}>Écart global · {c.ecartGlobalTexte}</Text>
              </View>
              <Text style={styles.petitDoux}>Écart espèces · {c.ecartEspecesTexte}</Text>
              {c.explication_ecart ? <Text style={[styles.petitDoux, { fontStyle: 'italic' }]}>« {c.explication_ecart} »</Text> : null}
            </View>
          ))}
          <LigneValeur fort libelle="Écart global" valeur={cumulShifts.ecartsGlobaux.totalTexte} couleur={couleurEcart(cumulShifts.ecartsGlobaux.total)} />
          {indispo > 0 ? (
            <Text style={styles.petitDoux}>
              {indispo} clôture{indispo > 1 ? 's historiques exclues' : ' historique exclue'} du total : rapport Z non disponible.
            </Text>
          ) : null}
        </Carte>
      ) : null}

      {ecartHistorique ? (
        <Bandeau style={styles.bandeauDansCorps} ton={ecart === 0 ? 'ok' : ecart > 0 ? 'info' : 'erreur'}
          texte={`${ecart === 0 ? '✅ Aucun écart' : ecart > 0 ? '📈 Surplus' : '📉 Manquant'} — Écart : ${ecart >= 0 ? '+' : ''}${fmt(ecart)}`} />
      ) : null}

      {aJustifier ? <Justification {...props} ecart={ecart} /> : null}
    </>
  )
}
```

- [ ] **Step 4 : `app/ventes.js` — imports**

Remplacer le bloc d'imports (lignes 1–23) par :

```js
import { router, useFocusEffect } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { Alert, Platform, SafeAreaView, ScrollView, Text, View } from 'react-native'
import {
  Bandeau, BarreBas, BarreEtapes, BoutonDegrade, BoutonSecondaire, Choix, EnTete, Feuille, Vide, contexteJour,
  useStyleChaleureux,
} from '../components/ui/StyleChaleureux'
import EtapeFondBenefice from '../components/ventes/EtapeFondBenefice'
import EtapeMachineEcart from '../components/ventes/EtapeMachineEcart'
import EtapeTab from '../components/ventes/EtapeTab'
import { useApp } from '../context/AppContext'
import { cloturesPOS, resumerEcartsGlobaux } from '../lib/cloturesCaisse'
import { manquantsVentes, photosManquantesVentes } from '../lib/manquantsSaisie'
import { estRempliParLePOS, peutSaisirVenteMachineManuellement, venteMachineEstRecue, venteMachineVientDuPOS } from '../lib/sourcePoint'
import { useFondTresorerie } from '../lib/useFondTresorerie'
import { supabase } from '../lib/supabase'
import { usePhoto } from '../lib/usePhoto'

const ETAPES = ['Livraisons TAB', 'Fond & bénéfice', 'Vente machine & écart']
const ETAPES_COURTES = ['TAB', 'Fond & bénéfice', 'Machine']
```

- [ ] **Step 5 : `app/ventes.js` — état et contrôles**

Dans `useApp()` ajouter `restaurantNom`. Remplacer :
```js
  const { colors } = useTheme()
```
par
```js
  const { styles } = useStyleChaleureux()
```
et supprimer `const styles = useMemo(() => makeStyles(colors), [colors])`.

Remplacer `function verifierPhotosObligatoires() { … }` par (juste après la déclaration de `venteMachineDuSysteme`, le bloc reste au même endroit que l'ancienne fonction) :
```js
  const voitShifts = isGerant || isManager
  const modifiable = !bloque || isManager
  // Une seule source pour « Il manque » et pour le contrôle du bouton (lib/manquantsSaisie.js).
  const photosManquantes = photosManquantesVentes({ ventesJour, venteMachineDuSysteme, voitMachine: voitShifts })
  const manquants = manquantsVentes({
    ventesJour, cumulShifts, venteMachineRecue, venteMachineDuSysteme, voitMachine: voitShifts, isManager,
  })
  const dejaChoisis = new Set((ventesJour.ecartResponsables || []).map(r => r.travailleur_id))
  const responsablesDispo = travailleursEquipe.filter(t => !dejaChoisis.has(t.id))
```

Remplacer `async function allerAuRecap() { … }` par :
```js
  async function allerAuRecap() {
    if (!pointId) { Alert.alert('Erreur', 'Aucun point actif'); return }
    if (!isManager) {
      // Sur un site POS, l'écart est déjà mesuré, expliqué et rattaché à sa
      // caissière dans la caisse : manquantsVentes ne le redemande pas.
      const bloquant = manquants.find(m => m.bloquant)
      if (bloquant) {
        Alert.alert(bloquant.alerte.titre, bloquant.alerte.message)
        return
      }
      if (photosManquantes.length > 0) {
        setPhotosAlertVisible(true)
        return
      }
    }
    await sauvegarderEtContinuer()
  }
```

Supprimer le composant interne `function PhotoBlock(…) { … }`.

Ajouter, avant le `return` :
```js
  function revenir() {
    if (etape > 1) setEtape(etape - 1)
    else if (router.canGoBack()) router.back()
    else router.replace('/accueil')
  }

  function ouvrirSecours() {
    Alert.alert(
      'Saisie manuelle de secours',
      'Le POS n’a transmis aucune vente machine. Confirmez uniquement après avoir vérifié que sa synchronisation est terminée.',
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Saisir manuellement', onPress: () => setSaisieManuelleVenteMachine(true) },
      ]
    )
  }

  const manquantsAffiches = etape === 3 ? manquants : manquants.filter(m => m.etape === etape)
```

- [ ] **Step 6 : `app/ventes.js` — rendu**

Remplacer tout le `return (…)` et supprimer `function makeStyles(…)` par :

```js
  return (
    <SafeAreaView style={styles.ecran}>
      <EnTete surtitre="Saisie des ventes" titre={ETAPES[etape - 1]} contexte={contexteJour(restaurantNom, dateJour)}
        onRetour={revenir} libelleRetour={etape > 1 ? `‹ Étape ${etape - 1}` : '‹ Retour'}>
        <BarreEtapes etapes={ETAPES_COURTES} actuelle={etape} onChoisir={setEtape} />
      </EnTete>

      {pointValide && !isManager ? <Bandeau ton="erreur" texte="🔒 Point validé — lecture seule" /> : null}
      {voitShifts ? (
        <Bandeau ton="neutre" chargement={chargementShifts}
          texte={cumulShifts ? `📊 ${cumulShifts.nbShifts} shift(s) validé(s) — Vente : ${fmt(cumulShifts.venteTotal)}` : '📊 Aucun shift chargé'}
          action={{ icone: '🔄', libelle: 'Recharger les shifts', onPress: chargerCumulShifts, disabled: chargementShifts }} />
      ) : null}
      {uploading ? <Bandeau chargement texte="Envoi de la photo en cours…" /> : null}

      <ScrollView style={styles.corps} contentContainerStyle={styles.corpsContenu}
        showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {etape === 1 ? (
          <EtapeTab ventesJour={ventesJour} setVente={setVente} setVentesJour={setVentesJour} modifiable={modifiable}
            cumulShifts={cumulShifts} voitShifts={voitShifts} onPhoto={gererPhoto} uploading={uploading} fmt={fmt} />
        ) : null}
        {etape === 2 ? (
          <EtapeFondBenefice ventesJour={ventesJour} setVente={setVente} modifiable={modifiable} fcRecuAuto={fcRecuAuto}
            resteEspeces={resteEspeces} fc={fc} beneficeSC={beneficeSC} fmt={fmt} />
        ) : null}
        {etape === 3 ? (
          <EtapeMachineEcart
            ventesJour={ventesJour} setVente={setVente} setVentesJour={setVentesJour} modifiable={modifiable}
            cumulShifts={cumulShifts} voitMachine={voitShifts}
            venteMachineDuPOS={venteMachineDuPOS} saisieManuelle={saisieManuelleVenteMachine}
            secoursDisponible={secoursVenteMachineDisponible} onSecours={ouvrirSecours}
            venteMachineRecue={venteMachineRecue} venteMachineDuSysteme={venteMachineDuSysteme}
            onPhoto={gererPhoto} uploading={uploading}
            responsablesDispo={responsablesDispo} onChoisirResponsable={() => setShowResponsablePicker(true)}
            onMontantResponsable={modifierMontantResponsable} onRetirerResponsable={retirerResponsable}
            onAjouterPhotoEcart={ajouterPhotoEcart} onRetirerPhotoEcart={retirerPhotoEcart}
            fmt={fmt}
          />
        ) : null}
      </ScrollView>

      {etape < 3 || modifiable ? (
        <BarreBas manquants={manquantsAffiches}>
          {etape < 3 ? (
            <BoutonDegrade label={`Continuer › ${ETAPES[etape]}`} onPress={() => setEtape(etape + 1)} />
          ) : (
            <BoutonDegrade label="Voir le récapitulatif" onPress={allerAuRecap} chargement={saving}
              attenue={manquants.some(m => m.bloquant)} />
          )}
        </BarreBas>
      ) : null}

      <Feuille visible={photosAlertVisible} titre="⚠️ Photos manquantes" onFermer={() => setPhotosAlertVisible(false)}>
        <Text style={styles.texte}>
          {photosManquantes.map(m => `• ${m}`).join('\n')}
          {'\n\n'}Veuillez ajouter les photos manquantes.
        </Text>
        <View style={[styles.ligneChamps, { marginTop: 16, alignItems: 'center' }]}>
          <BoutonSecondaire style={{ flex: 1, marginBottom: 0 }} label="Annuler" onPress={() => setPhotosAlertVisible(false)} />
          <BoutonDegrade style={{ flex: 1 }} label="Continuer quand même"
            onPress={() => { setPhotosAlertVisible(false); sauvegarderEtContinuer() }} />
        </View>
      </Feuille>

      <Feuille visible={showResponsablePicker} titre="👤 Choisir un responsable" onFermer={() => setShowResponsablePicker(false)}>
        {responsablesDispo.length === 0 ? (
          <Vide texte="Aucun autre travailleur disponible." />
        ) : responsablesDispo.map(t => (
          <Choix key={t.id} nom={t.nom} sous={t.role ? (t.role === 'gerant' ? 'Gérant' : 'Caissier') : null}
            onPress={() => ajouterResponsable(t)} />
        ))}
      </Feuille>
    </SafeAreaView>
  )
}
```

Toutes les autres fonctions (`chargerVenteMachinePOS`, `chargerCumulShifts`, `setVente`, `gererPhoto`, `fmt`, `ajouterResponsable`, `modifierMontantResponsable`, `retirerResponsable`, `ajouterPhotoEcart`, `retirerPhotoEcart`, `sauvegarderPhotosPoints`, `syncLitigesResponsables`, `sauvegarderEtContinuer`) restent identiques.

- [ ] **Step 7 : vérifier** — `npx eslint app/ventes.js components/ventes` → 0 erreur ; `for f in lib/*.test.mjs; do node "$f"; done` → 0 échec.

- [ ] **Step 8 : commit**

```bash
export DEVELOPER_DIR=/Library/Developer/CommandLineTools
git add app/ventes.js components/ventes
git commit -m "feat(ventes): saisie en 3 étapes (TAB, fond & bénéfice, machine & écart) et « Il manque » avant d'appuyer"
git push
```

---

### Task 5 : Vérification finale

**Files :** aucun nouveau (sauf `graphify-out/` régénéré).

- [ ] **Step 1 :** `npm run lint` → 0 erreur.
- [ ] **Step 2 :** `for f in lib/*.test.mjs; do node "$f"; done` → 0 échec.
- [ ] **Step 3 :** `npx expo export -p web` → export réussi (aucune erreur de bundle).
- [ ] **Step 4 :** contrôle du bundle : `grep -l "Il manque" dist/_expo/static/js/web/*.js` (fragment sans accent) → au moins un fichier.
- [ ] **Step 5 :** `graphify update .` puis commit `chore(graphify): graphe à jour` et push.
- [ ] **Step 6 :** ne PAS publier (Vercel / EAS) : attendre le feu vert de l'utilisateur en fin de chantier.
