# Mise à jour des fiches par les gérants et contrat pour tous — plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Les gérants mettent à jour les fiches de leur équipe (validées par la RH), puis chaque travailleur reçoit son contrat ; la direction suit et relance par restaurant.

**Architecture:** Une mise à jour est une ligne `demandes_travailleurs` de `type = 'mise_a_jour'` rattachée au travailleur (`travailleur_id`). Toute la logique (manques, différences, fusion, type de contrat proposé, suivi) vit dans le module pur testé `lib/miseAJourFiches.js` ; les écritures dans `lib/miseAJourFichesDb.js`. Les écrans existants (Recrutement du gérant, Nouveaux travailleurs de la RH, génération de contrat, accueil) sont étendus.

**Tech Stack:** Expo / React Native (web iOS Safari surtout), Supabase (supabase-js), tests `node:test` (`lib/*.test.mjs`), ESLint via `npm run lint`.

**Conception :** `docs/superpowers/specs/2026-10-29-mise-a-jour-fiches-contrats-design.md`.

## Global Constraints

- Toute l'interface, les messages et les commits en **français** ; commits conventionnels (`feat(equipe): …`), terminés par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Date limite : `2026-11-12`** (« jeudi 12 novembre »).
- Journalier → contrat **Stage** ; CDI → **CDI** ; sinon **CDD**. Le contrat commence à la **date d'embauche** (règle existante de `debutParDefaut` / Stage).
- Le gérant **peut envoyer une mise à jour incomplète** ; seuls photo, nom de famille et prénoms sont exigés (colonnes NOT NULL de `demandes_travailleurs` : `nom_famille`, `prenoms`, `poste`, `photo_url`). Le poste n'est pas demandé : on envoie celui de la fiche (`trav.poste || 'Non renseigné'`).
- À l'acceptation, **un champ envoyé vide n'efface jamais une valeur connue**. `travailleurs.nom` n'est jamais modifié.
- Une seule mise à jour en attente (`envoyee` ou `refusee`) par travailleur : un nouvel envoi **remplace** la ligne en attente.
- Jamais `npm start` / localhost : vérifier par `node lib/<x>.test.mjs`, `npm run lint` (0 erreur) et `npx expo export -p web`.
- Le DEVELOPER_DIR doit être exporté pour git : `export DEVELOPER_DIR=/Library/Developer/CommandLineTools`.
- Migration SQL : fichier à la racine, **passée à la main** par l'utilisateur dans le SQL Editor (ou par Claude avec son accord).

## Carte des fichiers

| Fichier | Rôle |
|---|---|
| `supabase_mise_a_jour_fiches.sql` (créé) | colonne `type`, contrainte, index unique partiel |
| `lib/miseAJourFiches.js` (créé) | logique pure : manques, diff, fusion, état, liste équipe, suivi, type proposé, date limite |
| `lib/miseAJourFiches.test.mjs` (créé) | tests node:test |
| `lib/miseAJourFichesDb.js` (créé) | envoi, acceptation, chargements, relances |
| `lib/contratsSignesDb.js` (modifié) | exporter `champsDemande` |
| `components/contrats/FormulaireDemande.js` (modifié) | mode « mise à jour » (`travailleur`) |
| `components/contrats/OngletMiseAJour.js` (créé) | onglet gérant « Mettre à jour mon équipe » |
| `app/recrutement.js` (modifié) | 3e onglet, chargement de l'équipe |
| `components/contrats/FeuilleMiseAJourRH.js` (créé) | validation RH avant → après |
| `components/contrats/OngletSuiviCampagne.js` (créé) | suivi par restaurant + relances |
| `app/embauches.js` (modifié) | étiquette « Mise à jour », feuille dédiée, onglet Suivi |
| `components/contrats/FormulaireGeneration.js` (modifié) | type proposé, alerte « déjà terminé » |
| `components/accueil/AccueilManager.js` (modifié) | badge gérant « N fiches à compléter » |

---

### Task 1: Migration + logique pure

**Files:**
- Create: `supabase_mise_a_jour_fiches.sql`
- Create: `lib/miseAJourFiches.js`
- Test: `lib/miseAJourFiches.test.mjs`

**Interfaces:**
- Produces (toutes exportées de `lib/miseAJourFiches.js`) :
  - `DATE_LIMITE: '2026-11-12'`, `TEXTE_DATE_LIMITE: 'jeudi 12 novembre'`
  - `CHAMPS_FUSION: string[]`, `LIBELLES: Record<string,string>`
  - `manquantsFiche(f) → string[]`
  - `proposerNomPrenoms(nom) → { nom_famille, prenoms }`
  - `ficheVersFormulaire(trav) → object` (valeurs du formulaire FormulaireDemande)
  - `diffFiche(trav, demande) → Array<{ cle, libelle, avant, apres }>`
  - `fusionFiche(trav, demande) → { maj: object, nouvellesPieces: string[], nouveauxPapiers: string[] }`
  - `typeContratPropose(trav) → 'Stage' | 'CDI' | 'CDD'`
  - `contratDejaTermine(fin, aujourdhui) → boolean`
  - `demandesEnAttenteParTravailleur(demandes) → Record<travailleurId, demande>`
  - `etatFiche(trav, demandeEnAttente) → 'a_jour' | 'envoyee' | 'refusee' | 'incomplete'`
  - `listeEquipe(travailleurs, demandes) → Array<{ trav, etat, manquants, demande }>`
  - `nbACompleter(travailleurs, demandes) → number`
  - `resumeCampagne({ travailleurs, demandes, contrats, restaurants, aujourdhui }) → { lignes, total }`
  - `dateLimiteDepassee(aujourdhui) → boolean`

- [ ] **Step 1: Écrire la migration**

`supabase_mise_a_jour_fiches.sql` :

```sql
-- =====================================================================
--  MISE À JOUR DES FICHES PAR LES GÉRANTS (29/10/2026)
--  À exécuter UNE fois dans le SQL Editor du projet SAMTRACKLY.
--  Une mise à jour = une demande_travailleurs de type 'mise_a_jour'
--  rattachée au travailleur (travailleur_id). Les demandes existantes
--  restent des embauches. Une seule mise à jour en attente par travailleur.
--  Relancer le script ne casse rien.
-- =====================================================================
alter table public.demandes_travailleurs add column if not exists type text not null default 'embauche';

alter table public.demandes_travailleurs drop constraint if exists demandes_travailleurs_type_check;
alter table public.demandes_travailleurs add constraint demandes_travailleurs_type_check
  check (type in ('embauche', 'mise_a_jour'));

create unique index if not exists demandes_trav_une_maj_en_attente
  on public.demandes_travailleurs (travailleur_id)
  where type = 'mise_a_jour' and statut in ('envoyee', 'refusee');

-- Contrôle : 1 colonne, 1 index.
select (select count(*) from information_schema.columns where table_name = 'demandes_travailleurs' and column_name = 'type') as colonne_ok,
       (select count(*) from pg_indexes where indexname = 'demandes_trav_une_maj_en_attente') as index_ok;
```

- [ ] **Step 2: Écrire les tests (échouent)**

`lib/miseAJourFiches.test.mjs` :

```js
// ──────────────────────────────────────────────────────────────────────────────
// Tests de lib/miseAJourFiches.js — mise à jour des fiches par les gérants.
//
// Les pièges : une mise à jour qui efface une info connue avec un champ vide ;
// une CNI déjà rangée ajoutée deux fois ; un archivé compté dans le suivi ;
// un journalier à qui l'on propose un CDD au lieu du Stage décidé.
// ──────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  contratDejaTermine, dateLimiteDepassee, demandesEnAttenteParTravailleur, diffFiche, etatFiche,
  ficheVersFormulaire, fusionFiche, listeEquipe, manquantsFiche, nbACompleter, proposerNomPrenoms,
  resumeCampagne, typeContratPropose,
} from './miseAJourFiches.js'

const complete = {
  id: 't1', nom: 'KOUASSI Jean', restaurant_id: 'r1', statut: 'actif', actif: true, type_contrat: 'Journalier',
  photo_url: 'p.jpg', civilite: 'M.', nom_famille: 'KOUASSI', prenoms: 'Jean', date_naissance: '1995-03-12',
  lieu_naissance: 'Bouaké', nationalite: 'Ivoirienne', situation_famille: 'Marié(e)', lieu_residence: 'Yopougon',
  cni_numero: 'CI001', nni_numero: null, contact: '0707070707', date_embauche: '2026-01-09',
  piece_identite_urls: ['cni1.jpg'],
}

describe('manquantsFiche', () => {
  test('fiche complète : rien ne manque', () => assert.deepEqual(manquantsFiche(complete), []))
  test('CNI ou NNI suffit', () => {
    assert.deepEqual(manquantsFiche({ ...complete, cni_numero: '', nni_numero: '119' }), [])
    assert.ok(manquantsFiche({ ...complete, cni_numero: '', nni_numero: '' }).includes('CNI ou NNI'))
  })
  test('date d’embauche et photo exigées, situation de famille non', () => {
    const m = manquantsFiche({ ...complete, date_embauche: null, photo_url: '', situation_famille: '' })
    assert.ok(m.includes("Date d'embauche") && m.includes('Photo'))
    assert.ok(!m.includes('Situation de famille'))
  })
})

describe('formulaire et noms', () => {
  test('nom découpé : premier mot = nom de famille', () => {
    assert.deepEqual(proposerNomPrenoms('KOUASSI Jean Marc'), { nom_famille: 'KOUASSI', prenoms: 'Jean Marc' })
  })
  test('ficheVersFormulaire : reprend la fiche, propose nom/prénoms s’ils manquent', () => {
    const f = ficheVersFormulaire({ ...complete, nom_famille: null, prenoms: null, nom: 'ANOMAN Anoman Stéphane' })
    assert.equal(f.nom_famille, 'ANOMAN')
    assert.equal(f.prenoms, 'Anoman Stéphane')
    assert.equal(f.date_embauche, '2026-01-09')
    assert.deepEqual(f.piece_identite_urls, ['cni1.jpg'])
    assert.deepEqual(f.papiers_urls, [])
  })
})

describe('diffFiche et fusionFiche', () => {
  const vide = { ...complete, date_naissance: null, lieu_residence: 'Yopougon', piece_identite_urls: ['cni1.jpg'] }
  const demande = { ...complete, date_naissance: '1995-03-12', lieu_residence: '', cni_numero: 'CI001',
    piece_identite_urls: ['cni1.jpg', 'cni2.jpg'], papiers_urls: ['diplome.pdf'] }

  test('diff : seulement ce qui change, jamais un champ envoyé vide', () => {
    const d = diffFiche(vide, demande)
    assert.deepEqual(d.map(x => x.cle), ['date_naissance'])
    assert.equal(d[0].avant, null)
    assert.equal(d[0].apres, '1995-03-12')
  })
  test('fusion : un champ vide n’efface pas, pièces sans doublon', () => {
    const f = fusionFiche(vide, demande)
    assert.deepEqual(f.maj.date_naissance, '1995-03-12')
    assert.ok(!('lieu_residence' in f.maj))
    assert.ok(!('nom' in f.maj))
    assert.deepEqual(f.maj.piece_identite_urls, ['cni1.jpg', 'cni2.jpg'])
    assert.deepEqual(f.nouvellesPieces, ['cni2.jpg'])
    assert.deepEqual(f.nouveauxPapiers, ['diplome.pdf'])
  })
  test('fusion sans nouvelle pièce : piece_identite_urls inchangé', () => {
    const f = fusionFiche(complete, { ...complete, piece_identite_urls: ['cni1.jpg'], papiers_urls: [] })
    assert.ok(!('piece_identite_urls' in f.maj))
    assert.deepEqual(f.nouvellesPieces, [])
  })
})

describe('type de contrat proposé', () => {
  test('Journalier → Stage, CDI → CDI, sinon CDD', () => {
    assert.equal(typeContratPropose({ type_contrat: 'Journalier' }), 'Stage')
    assert.equal(typeContratPropose({ type_contrat: 'CDI' }), 'CDI')
    assert.equal(typeContratPropose({ type_contrat: 'Stage' }), 'Stage')
    assert.equal(typeContratPropose({ type_contrat: 'CDD' }), 'CDD')
    assert.equal(typeContratPropose({ type_contrat: null }), 'CDD')
  })
  test('contrat déjà terminé', () => {
    assert.equal(contratDejaTermine('2026-04-09', '2026-10-29'), true)
    assert.equal(contratDejaTermine('2026-10-29', '2026-10-29'), false)
    assert.equal(contratDejaTermine(null, '2026-10-29'), false)
  })
})

describe('état des fiches et suivi', () => {
  const incomplet = { ...complete, id: 't2', nom: 'ABRO Paul', cni_numero: null, date_naissance: null }
  const archive = { ...incomplet, id: 't3', statut: 'archive' }
  const autreResto = { ...incomplet, id: 't4', restaurant_id: 'r2' }
  const dEnvoyee = { id: 'd1', type: 'mise_a_jour', travailleur_id: 't2', statut: 'envoyee', created_at: '2026-10-29T10:00:00Z' }
  const dEmbauche = { id: 'd0', type: 'embauche', travailleur_id: 't1', statut: 'envoyee', created_at: '2026-10-29T09:00:00Z' }

  test('seules les mises à jour en attente comptent', () => {
    const m = demandesEnAttenteParTravailleur([dEmbauche, dEnvoyee, { ...dEnvoyee, id: 'dx', travailleur_id: 't4', statut: 'acceptee' }])
    assert.deepEqual(Object.keys(m), ['t2'])
  })
  test('etatFiche', () => {
    assert.equal(etatFiche(complete, null), 'a_jour')
    assert.equal(etatFiche(incomplet, null), 'incomplete')
    assert.equal(etatFiche(incomplet, dEnvoyee), 'envoyee')
    assert.equal(etatFiche(incomplet, { ...dEnvoyee, statut: 'refusee' }), 'refusee')
  })
  test('liste équipe : archivés exclus, refusées puis plus incomplets d’abord, à jour en dernier', () => {
    const l = listeEquipe([complete, incomplet, archive, { ...autreResto, restaurant_id: 'r1', id: 't5', nom: 'ZZ', photo_url: '' }], [dEnvoyee])
    assert.deepEqual(l.map(x => x.trav.id), ['t5', 't2', 't1'])
    assert.equal(l.find(x => x.trav.id === 't2').etat, 'envoyee')
  })
  test('à compléter = incomplètes + refusées', () => {
    assert.equal(nbACompleter([complete, incomplet, autreResto], []), 2)
    assert.equal(nbACompleter([complete, incomplet, autreResto], [dEnvoyee]), 1)
  })
  test('resumeCampagne par restaurant', () => {
    const contrats = [{ travailleur_id: 't1', statut: 'signe', date_debut: '2026-01-09', date_fin: '2027-01-09', cloture_le: null }]
    const r = resumeCampagne({
      travailleurs: [complete, incomplet, archive, autreResto], demandes: [dEnvoyee], contrats,
      restaurants: [{ id: 'r1', nom: 'Samer 7E' }, { id: 'r2', nom: 'Al Kayan Yop' }], aujourdhui: '2026-10-29',
    })
    const r1 = r.lignes.find(l => l.restaurant_id === 'r1')
    assert.deepEqual({ total: r1.total, aJour: r1.aJour, enAttente: r1.enAttente, aCompleter: r1.aCompleter, contrats: r1.contratsSignes },
      { total: 2, aJour: 1, enAttente: 1, aCompleter: 0, contrats: 1 })
    assert.deepEqual(r.total, { total: 3, aJour: 1, enAttente: 1, aCompleter: 1, contratsSignes: 1 })
  })
  test('date limite', () => {
    assert.equal(dateLimiteDepassee('2026-11-12'), false)
    assert.equal(dateLimiteDepassee('2026-11-13'), true)
  })
})
```

- [ ] **Step 3: Lancer les tests (échec attendu)**

Run: `node lib/miseAJourFiches.test.mjs`
Expected: FAIL — `Cannot find module …/lib/miseAJourFiches.js`

- [ ] **Step 4: Écrire `lib/miseAJourFiches.js`**

```js
// ──────────────────────────────────────────────────────────────────────────────
// Mise à jour des fiches par les gérants et contrat pour tous (29/10/2026).
// Module pur : aucune lecture de la base ni de l'horloge (écritures :
// lib/miseAJourFichesDb.js). Conception :
// docs/superpowers/specs/2026-10-29-mise-a-jour-fiches-contrats-design.md
//
// Une mise à jour = demande_travailleurs de type 'mise_a_jour' rattachée au
// travailleur. À l'acceptation, un champ envoyé vide n'efface JAMAIS une
// valeur connue ; `nom` (lien POS et paies) n'est jamais modifié.
// ──────────────────────────────────────────────────────────────────────────────
import { contratEnCours, contratsSignes } from './contrats.js'

export const DATE_LIMITE = '2026-11-12'
export const TEXTE_DATE_LIMITE = 'jeudi 12 novembre'

// Champs que la mise à jour peut écrire sur la fiche.
export const CHAMPS_FUSION = [
  'photo_url', 'civilite', 'nom_famille', 'prenoms', 'date_naissance', 'lieu_naissance', 'nationalite',
  'situation_famille', 'lieu_residence', 'cni_numero', 'nni_numero', 'contact', 'date_embauche',
]

export const LIBELLES = {
  photo_url: 'Photo', civilite: 'Civilité', nom_famille: 'Nom de famille', prenoms: 'Prénoms',
  date_naissance: 'Date de naissance', lieu_naissance: 'Lieu de naissance', nationalite: 'Nationalité',
  situation_famille: 'Situation de famille', lieu_residence: 'Lieu de résidence', cni_numero: 'CNI',
  nni_numero: 'NNI', contact: 'Téléphone', date_embauche: "Date d'embauche",
}

const vide = v => v === null || v === undefined || String(v).trim() === ''
const norm = v => (vide(v) ? '' : String(v).trim())

/** Ce qu'exige le contrat (identité, pièce, résidence, téléphone, début) + la photo. */
export function manquantsFiche(f) {
  const x = f || {}
  const manque = []
  for (const cle of ['photo_url', 'civilite', 'nom_famille', 'prenoms', 'date_naissance', 'lieu_naissance', 'nationalite']) {
    if (vide(x[cle])) manque.push(LIBELLES[cle])
  }
  if (vide(x.cni_numero) && vide(x.nni_numero)) manque.push('CNI ou NNI')
  for (const cle of ['lieu_residence', 'contact', 'date_embauche']) if (vide(x[cle])) manque.push(LIBELLES[cle])
  return manque
}

/** « KOUASSI Jean Marc » → nom de famille = premier mot, prénoms = le reste. */
export function proposerNomPrenoms(nom) {
  const mots = String(nom || '').trim().split(/\s+/).filter(Boolean)
  return { nom_famille: mots[0] || '', prenoms: mots.slice(1).join(' ') }
}

/** Valeurs de départ du formulaire de mise à jour (FormulaireDemande). */
export function ficheVersFormulaire(trav) {
  const t = trav || {}
  const prop = vide(t.nom_famille) && vide(t.prenoms) ? proposerNomPrenoms(t.nom) : {}
  const f = {}
  for (const cle of CHAMPS_FUSION) f[cle] = vide(t[cle]) ? '' : t[cle]
  f.photo_url = t.photo_url || null
  return {
    ...f, ...prop, poste: t.poste || '', salaire_journalier: '',
    piece_identite_urls: [...(t.piece_identite_urls || [])], papiers_urls: [],
  }
}

/** Champs qui changent : envoyés remplis ET différents de la fiche. */
export function diffFiche(trav, demande) {
  const t = trav || {}
  return CHAMPS_FUSION
    .filter(cle => !vide(demande?.[cle]) && norm(demande[cle]) !== norm(t[cle]))
    .map(cle => ({ cle, libelle: LIBELLES[cle], avant: vide(t[cle]) ? null : t[cle], apres: demande[cle] }))
}

/** Ce que l'acceptation écrit : jamais un vide, jamais `nom`, pièces sans doublon. */
export function fusionFiche(trav, demande) {
  const maj = {}
  for (const { cle, apres } of diffFiche(trav, demande)) maj[cle] = typeof apres === 'string' ? apres.trim() : apres
  const connues = trav?.piece_identite_urls || []
  const nouvellesPieces = (demande?.piece_identite_urls || []).filter(u => u && !connues.includes(u))
  if (nouvellesPieces.length) maj.piece_identite_urls = [...connues, ...nouvellesPieces]
  const nouveauxPapiers = (demande?.papiers_urls || []).filter(Boolean)
  return { maj, nouvellesPieces, nouveauxPapiers }
}

/** Journalier (ou Stage) → Stage ; CDI → CDI ; sinon CDD (décision du 29/10/2026). */
export function typeContratPropose(trav) {
  const t = String(trav?.type_contrat || '').trim().toLowerCase()
  if (t === 'journalier' || t === 'stage') return 'Stage'
  if (t === 'cdi') return 'CDI'
  return 'CDD'
}

export const contratDejaTermine = (fin, aujourdhui) => !vide(fin) && fin < aujourdhui

/** travailleur_id → sa mise à jour en attente (envoyée ou refusée), la plus récente. */
export function demandesEnAttenteParTravailleur(demandes) {
  const m = {}
  for (const d of demandes || []) {
    if (d.type !== 'mise_a_jour' || !d.travailleur_id || !['envoyee', 'refusee'].includes(d.statut)) continue
    if (!m[d.travailleur_id] || String(d.created_at) > String(m[d.travailleur_id].created_at)) m[d.travailleur_id] = d
  }
  return m
}

export function etatFiche(trav, demandeEnAttente) {
  if (demandeEnAttente?.statut === 'envoyee') return 'envoyee'
  if (demandeEnAttente?.statut === 'refusee') return 'refusee'
  return manquantsFiche(trav).length ? 'incomplete' : 'a_jour'
}

const ORDRE = { refusee: 0, incomplete: 1, envoyee: 2, a_jour: 3 }
const actif = t => t && t.statut !== 'archive'

/** Équipe d'un gérant : refusées, puis les plus incomplètes, envoyées, à jour. */
export function listeEquipe(travailleurs, demandes) {
  const enAttente = demandesEnAttenteParTravailleur(demandes)
  return (travailleurs || []).filter(actif)
    .map(trav => {
      const demande = enAttente[trav.id] || null
      return { trav, demande, etat: etatFiche(trav, demande), manquants: manquantsFiche(trav) }
    })
    .sort((a, b) => ORDRE[a.etat] - ORDRE[b.etat]
      || b.manquants.length - a.manquants.length
      || String(a.trav.nom || '').localeCompare(String(b.trav.nom || '')))
}

/** Fiches que le gérant doit encore traiter : incomplètes ou refusées. */
export function nbACompleter(travailleurs, demandes) {
  return listeEquipe(travailleurs, demandes).filter(x => x.etat === 'incomplete' || x.etat === 'refusee').length
}

/** Suivi par restaurant pour la direction. */
export function resumeCampagne({ travailleurs, demandes, contrats, restaurants, aujourdhui }) {
  const parTrav = {}
  for (const c of contrats || []) (parTrav[c.travailleur_id] ||= []).push(c)
  const signe = t => !!contratEnCours(contratsSignes(parTrav[t.id]), aujourdhui)
  const equipe = listeEquipe(travailleurs, demandes)
  const compter = liste => ({
    total: liste.length,
    aJour: liste.filter(x => x.etat === 'a_jour').length,
    enAttente: liste.filter(x => x.etat === 'envoyee').length,
    aCompleter: liste.filter(x => x.etat === 'incomplete' || x.etat === 'refusee').length,
    contratsSignes: liste.filter(x => signe(x.trav)).length,
  })
  const lignes = (restaurants || [])
    .map(r => ({ restaurant_id: r.id, nom: String(r.nom || '').trim(), ...compter(equipe.filter(x => x.trav.restaurant_id === r.id)) }))
    .filter(l => l.total > 0)
  return { lignes, total: compter(equipe) }
}

export const dateLimiteDepassee = aujourdhui => aujourdhui > DATE_LIMITE
```

- [ ] **Step 5: Lancer les tests (succès attendu)**

Run: `node lib/miseAJourFiches.test.mjs`
Expected: PASS, `ℹ fail 0`

- [ ] **Step 6: Commit**

```bash
export DEVELOPER_DIR=/Library/Developer/CommandLineTools
git add supabase_mise_a_jour_fiches.sql lib/miseAJourFiches.js lib/miseAJourFiches.test.mjs
git commit -m "feat(equipe): logique de la mise à jour des fiches + migration

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Écritures en base

**Files:**
- Create: `lib/miseAJourFichesDb.js`
- Modify: `lib/contratsSignesDb.js` (rendre `champsDemande` exporté : `function champsDemande(form)` → `export function champsDemande(form)`)

**Interfaces:**
- Consumes: `fusionFiche`, `nbACompleter`, `TEXTE_DATE_LIMITE` (Task 1) ; `champsDemande(form)` de `lib/contratsSignesDb.js` ; `creerNotification` de `lib/notificationsInterne.js` ; `journaliser` de `lib/journal.js` ; `nomComplet`, `estPdf` de `lib/recrutement.js`.
- Produces :
  - `chargerEquipeRestaurant(restaurantId) → Promise<travailleur[]>` (non archivés, `select('*')`)
  - `chargerTravailleur(id) → Promise<travailleur>` (`*, restaurants(id, nom, couleur, code, marque)`)
  - `chargerCampagne() → Promise<{ travailleurs, contrats }>` (tous restaurants)
  - `envoyerMiseAJour(trav, form, ctx, demandeEnAttente) → Promise<void>`
  - `accepterMiseAJour(demande, ctx) → Promise<travailleur>` (fiche complète avec restaurant)
  - `relancerGerants({ restaurantId, nombre }) → Promise<void>`

- [ ] **Step 1: Exporter `champsDemande`**

Dans `lib/contratsSignesDb.js`, remplacer `function champsDemande(form) {` par `export function champsDemande(form) {`.

- [ ] **Step 2: Écrire `lib/miseAJourFichesDb.js`**

```js
// ──────────────────────────────────────────────────────────────────────────────
// Mise à jour des fiches par les gérants : écritures en base.
// Logique : lib/miseAJourFiches.js (pure, testée). Migration :
// supabase_mise_a_jour_fiches.sql. Les fonctions lèvent une Error au message
// français, prêt à afficher.
// ──────────────────────────────────────────────────────────────────────────────
import { champsDemande } from './contratsSignesDb'
import { journaliser } from './journal'
import { TEXTE_DATE_LIMITE, fusionFiche } from './miseAJourFiches'
import { creerNotification } from './notificationsInterne'
import { estPdf, nomComplet } from './recrutement'
import { supabase } from './supabase'

const ROLES_RH = ['manager', 'directeur', 'rh']
const MIGRATION = 'Mise à jour des fiches pas encore activée (migration supabase_mise_a_jour_fiches.sql à passer).'
const maintenant = () => new Date().toISOString()
const manqueMigration = e => /column .*type|demandes_travailleurs_type|schema cache/i.test(e?.message || '')
const notifier = p => { creerNotification(p).catch(() => {}) }
const tracer = (action, details, ctx, restaurantId) => journaliser(action, details, {
  userId: ctx?.userId || null, userNom: ctx?.userNom || null, restaurantId: restaurantId || null,
}).catch(() => {})

export async function chargerEquipeRestaurant(restaurantId) {
  const { data, error } = await supabase.from('travailleurs').select('*')
    .eq('restaurant_id', restaurantId).neq('statut', 'archive').order('nom').range(0, 999)
  if (error) throw new Error("Impossible de charger l'équipe. Vérifie ta connexion.")
  return data || []
}

export async function chargerTravailleur(id) {
  const { data, error } = await supabase.from('travailleurs')
    .select('*, restaurants(id, nom, couleur, code, marque)').eq('id', id).single()
  if (error) throw new Error('Fiche du travailleur introuvable.')
  return data
}

/** Tous les travailleurs non archivés et les contrats, pour le suivi par restaurant. */
export async function chargerCampagne() {
  const [t, c] = await Promise.all([
    supabase.from('travailleurs').select('*').neq('statut', 'archive').range(0, 4999),
    supabase.from('contrats_travailleurs').select('travailleur_id, statut, date_debut, date_fin, cloture_le').range(0, 9999),
  ])
  if (t.error) throw new Error('Impossible de charger le suivi. Vérifie ta connexion.')
  return { travailleurs: t.data || [], contrats: c.data || [] }
}

/** Gérant : envoie (ou remplace) la mise à jour en attente de ce travailleur. */
export async function envoyerMiseAJour(trav, form, ctx, demandeEnAttente) {
  const champs = { ...champsDemande(form), poste: trav.poste || 'Non renseigné', salaire_journalier: null, doublon_travailleur_id: null }
  const commun = { ...champs, type: 'mise_a_jour', travailleur_id: trav.id, restaurant_id: trav.restaurant_id || null,
    statut: 'envoyee', motif_refus: null, updated_at: maintenant() }
  const { error } = demandeEnAttente
    ? await supabase.from('demandes_travailleurs').update(commun).eq('id', demandeEnAttente.id)
    : await supabase.from('demandes_travailleurs').insert({ ...commun, cree_par: ctx?.userId || null, cree_par_nom: ctx?.userNom || null })
  if (error) throw new Error(manqueMigration(error) ? MIGRATION : "La mise à jour n'est pas partie. Vérifie ta connexion et réessaie.")
  notifier({
    type: 'fiche_trav_a_valider', titre: '📋 Fiche à valider',
    message: `${trav.nom} — mise à jour envoyée par ${ctx?.userNom || 'le gérant'}`,
    restaurant_id: trav.restaurant_id || null, cible_role: ROLES_RH, screen: 'embauches',
  })
  tracer('FICHE_TRAV_ENVOYEE', { travailleur_id: trav.id, travailleur: trav.nom }, ctx, trav.restaurant_id)
}

/** RH : fusionne dans la fiche (sans rien effacer), puis marque la demande acceptée. */
export async function accepterMiseAJour(demande, ctx) {
  const trav = await chargerTravailleur(demande.travailleur_id)
  const { maj, nouvellesPieces, nouveauxPapiers } = fusionFiche(trav, demande)
  if (Object.keys(maj).length) {
    const { error } = await supabase.from('travailleurs').update(maj).eq('id', trav.id)
    if (error) throw new Error("La fiche n'a pas été mise à jour. Réessaie.")
  }
  const papiers = [
    ...nouvellesPieces.map(url => ({ type_document: 'CNI', fichier_url: url })),
    ...nouveauxPapiers.map(url => ({ type_document: 'Autre', fichier_url: url })),
  ]
  if (papiers.length) {
    await supabase.from('documents_travailleurs').insert(papiers.map(p => ({
      travailleur_id: trav.id, ...p, description: estPdf(p.fichier_url) ? 'pdf' : 'image',
    }))).then(() => {}, () => {})
  }
  // Après la fiche : une double validation réécrit les mêmes valeurs, sans dégât.
  const { data, error } = await supabase.from('demandes_travailleurs').update({
    statut: 'acceptee', motif_refus: null, traite_par: ctx?.userId || null, traite_par_nom: ctx?.userNom || null,
    traite_le: maintenant(), updated_at: maintenant(),
  }).eq('id', demande.id).eq('statut', 'envoyee').select('id')
  if (error) throw new Error("La validation n'a pas été enregistrée. Réessaie.")
  if (!data?.length) throw new Error('Déjà traitée par quelqu’un d’autre.')
  notifier({
    type: 'fiche_trav_validee', titre: '✅ Fiche validée',
    message: `${trav.nom} : la fiche est à jour`, restaurant_id: trav.restaurant_id || null,
    cible_role: ['gerant'], screen: 'recrutement', params: { onglet: 'equipe' },
  })
  tracer('FICHE_TRAV_VALIDEE', { demande_id: demande.id, travailleur_id: trav.id, travailleur: trav.nom || nomComplet(demande) },
    ctx, trav.restaurant_id)
  return chargerTravailleur(trav.id)
}

/** Direction : relance les gérants d'un restaurant. */
export async function relancerGerants({ restaurantId, nombre }) {
  await creerNotification({
    type: 'campagne_fiches', titre: '📋 Fiches de votre équipe',
    message: `Il vous reste ${nombre} fiche${nombre > 1 ? 's' : ''} à compléter avant le ${TEXTE_DATE_LIMITE}.`,
    restaurant_id: restaurantId, cible_role: ['gerant'], screen: 'recrutement', params: { onglet: 'equipe' },
  })
}
```

- [ ] **Step 3: Vérifier**

Run: `npm run lint 2>&1 | grep "✖"`
Expected: `0 errors`

- [ ] **Step 4: Commit**

```bash
git add lib/miseAJourFichesDb.js lib/contratsSignesDb.js
git commit -m "feat(equipe): envoi, validation et relances des mises à jour de fiches

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Formulaire du gérant en mode « mise à jour »

**Files:**
- Modify: `components/contrats/FormulaireDemande.js`

**Interfaces:**
- Consumes: `ficheVersFormulaire` (Task 1), `envoyerMiseAJour` (Task 2).
- Produces: prop `travailleur` sur `FormulaireDemande` ; en sa présence le formulaire est une mise à jour ; `demande` = la mise à jour en attente (envoyée ou refusée) de ce travailleur, ou null. `onEnvoye()` appelé après l'envoi.

- [ ] **Step 1: Imports et état initial**

Ajouter aux imports :

```js
import { envoyerMiseAJour } from '../../lib/miseAJourFichesDb'
import { ficheVersFormulaire } from '../../lib/miseAJourFiches'
```

Ajouter `travailleur = null` aux props (après `restoParDefaut = null`). Puis, juste après la ligne `export default function FormulaireDemande({ … }) {`, définir :

```js
  const maj = !!travailleur
  // Mise à jour : la demande refusée (si elle existe) a priorité, sinon la fiche.
  const initial = () => (maj && !demande ? ficheVersFormulaire(travailleur) : depuisDemande(demande))
```

Remplacer `useState(depuisDemande(demande))` par `useState(initial)` et, dans le `useEffect` d'ouverture, `setForm(depuisDemande(demande))` par `setForm(initial())` ; ajouter `travailleur?.id` aux dépendances : `[visible, demande, restoParDefaut, travailleur?.id]`.

Attention : la fonction existante `const maj = (cle, val) => …` porte le même nom. La renommer `majChamp` partout dans le fichier (définition et tous les appels `maj('…', …)`), **avant** d'ajouter `const maj = !!travailleur`.

- [ ] **Step 2: Envoi**

Dans `envoyer(doublon)`, remplacer le corps du `try` par :

```js
      if (maj) await envoyerMiseAJour(travailleur, form, ctx, demande)
      else {
        const contenu = { ...form, doublon_travailleur_id: doublon?.id || null }
        if (demande) await corrigerEtRenvoyer(demande, contenu, ctx)
        else await envoyerDemande(contenu, ctx, restaurant)
      }
      onEnvoye?.()
```

Dans `valider()`, juste après `const { bloquants, incomplets } = manquantsDemande(form)`, ajouter :

```js
    // Mise à jour : le poste et le salaire restent ceux de la fiche.
    if (maj) {
      const b = bloquants.filter(x => x !== 'Poste')
      const inc = incomplets.filter(x => x !== 'Salaire journalier')
      if (b.length) { Alert.alert('Il manque des informations', `Obligatoire : ${b.join(', ')}.`); return }
      if (!inc.length) { envoyer(null); return }
      Alert.alert('Informations incomplètes',
        `Encore à compléter : ${inc.join(', ')}.\n\nTu peux envoyer quand même : la RH valide ce qui est rempli.`,
        [{ text: 'Compléter', style: 'cancel' }, { text: 'Envoyer quand même', onPress: () => envoyer(null) }])
      return
    }
```

- [ ] **Step 3: Affichage**

- Titre de la `Feuille` : `titre={maj ? 'Mettre à jour la fiche' : demande ? 'Corriger la demande' : 'Nouveau travailleur'}` et `sous={demande?.motif_refus ? \`Refus de la RH : ${demande.motif_refus}\` : maj ? travailleur.nom : direct ? 'Ajout direct — actif tout de suite' : restaurant?.nom}`.
- Juste après le bloc photo (avant `<Libelle styles={styles}>Civilité</Libelle>`), ajouter :

```js
      {maj && (
        <>
          <ChampDate label="Date d'embauche (premier jour de travail)" valeur={form.date_embauche}
            onChange={v => majChamp('date_embauche', v)} couleur={principale} />
          <Info icone="📅" styles={styles}>C'est la date de début de son contrat.</Info>
        </>
      )}
```

- Entourer le bloc « Poste * » (Libelle, Puces, Champ du poste), le champ salaire et le `ChampDate` « Date d'embauche » existant d'un `{!maj && ( <> … </> )}`.
- Texte de l'`Info` du bas : `{maj ? 'La RH vérifie puis met la fiche à jour ; rien ne change avant sa validation.' : direct ? … : …}` (garder les deux textes existants).
- Libellé du bouton : `label={direct ? 'Enregistrer le travailleur' : maj ? 'Envoyer à la RH' : demande ? 'Renvoyer à la RH' : 'Envoyer à la RH'}`.

- [ ] **Step 4: Vérifier**

Run: `npm run lint 2>&1 | grep -E "✖|  error"` puis `npx expo export -p web 2>&1 | tail -1`
Expected: `0 errors` ; `Exported: dist`

- [ ] **Step 5: Commit**

```bash
git add components/contrats/FormulaireDemande.js
git commit -m "feat(equipe): formulaire du gérant en mode « mise à jour de fiche »

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Onglet gérant « Mettre à jour mon équipe »

**Files:**
- Create: `components/contrats/OngletMiseAJour.js`
- Modify: `app/recrutement.js`

**Interfaces:**
- Consumes: `listeEquipe`, `nbACompleter`, `dateLimiteDepassee`, `TEXTE_DATE_LIMITE` (Task 1) ; `chargerEquipeRestaurant` (Task 2) ; `FormulaireDemande` prop `travailleur` (Task 3) ; `aujourdhuiISO` de `lib/contrats.js`.
- Produces: `OngletMiseAJour({ styles, principale, lignes, aujourdhui, onOuvrir })` où `lignes = listeEquipe(...)`, `onOuvrir({ trav, demande })`.

- [ ] **Step 1: Écrire `components/contrats/OngletMiseAJour.js`**

```js
// Onglet gérant « Mettre à jour mon équipe » (campagne du 29/10/2026) :
// bandeau de date limite, puis ses travailleurs, les plus incomplets d'abord.
import { Text, TouchableOpacity, View } from 'react-native'

import Avatar from '../equipe/Avatar'
import { Info, Vide, teinte } from '../ui/EcranModerne'
import { TEXTE_DATE_LIMITE, dateLimiteDepassee } from '../../lib/miseAJourFiches'

const ETATS = {
  incomplete: { couleur: '#C27C1A', texte: x => `⚠️ ${x.manquants.length} info${x.manquants.length > 1 ? 's' : ''} manquante${x.manquants.length > 1 ? 's' : ''}` },
  envoyee: { couleur: '#2F6FD8', texte: () => '🟡 Envoyée à la RH' },
  refusee: { couleur: '#C2462B', texte: x => `❌ Refusée : ${x.demande?.motif_refus || 'à corriger'}` },
  a_jour: { couleur: '#3B8D2F', texte: () => '✅ À jour' },
}

export default function OngletMiseAJour({ styles, principale, lignes, aujourdhui, onOuvrir }) {
  const aJour = lignes.filter(x => x.etat === 'a_jour').length
  const depasse = dateLimiteDepassee(aujourdhui)
  return (
    <>
      <Info icone={depasse ? '⏰' : '📋'} styles={styles} couleur={depasse ? '#C2462B' : principale}>
        {depasse ? 'Date limite dépassée' : 'Complétez les fiches de votre équipe'} : avant le {TEXTE_DATE_LIMITE}. {aJour} / {lignes.length} à jour.
      </Info>
      <View style={{ height: 8 }} />
      {lignes.length === 0
        ? <Vide icone="👥" styles={styles} texte="Aucun travailleur dans ton équipe." sous={null} />
        : lignes.map(x => {
          const cfg = ETATS[x.etat]
          const touchable = x.etat !== 'envoyee'
          return (
            <TouchableOpacity key={x.trav.id} style={[styles.carte, { borderLeftWidth: 4, borderLeftColor: cfg.couleur }]}
              activeOpacity={touchable ? 0.8 : 1} onPress={touchable ? () => onOuvrir(x) : undefined}>
              <View style={styles.carteTop}>
                <Avatar nom={x.trav.nom} photo={x.trav.photo_url} taille={44} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.carteTitre}>{x.trav.nom}</Text>
                  <Text style={styles.carteSous}>{x.trav.poste || 'Sans poste'}</Text>
                </View>
                {touchable ? <Text style={{ color: principale, fontWeight: '800' }}>{x.etat === 'a_jour' ? 'Voir ›' : 'Compléter ›'}</Text> : null}
              </View>
              <View style={{ alignSelf: 'flex-start', marginTop: 8, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, backgroundColor: teinte(cfg.couleur, '1A') }}>
                <Text style={{ color: cfg.couleur, fontWeight: '700', fontSize: 12 }}>{cfg.texte(x)}</Text>
              </View>
              {x.etat === 'incomplete' && (
                <Text style={[styles.infoTxt, { marginTop: 6, flex: 0 }]}>Manque : {x.manquants.join(', ')}</Text>
              )}
            </TouchableOpacity>
          )
        })}
    </>
  )
}
```

- [ ] **Step 2: Brancher dans `app/recrutement.js`**

Imports à ajouter :

```js
import OngletMiseAJour from '../components/contrats/OngletMiseAJour'
import { aujourdhuiISO, formatFR } from '../lib/contrats'
import { listeEquipe, nbACompleter } from '../lib/miseAJourFiches'
import { chargerEquipeRestaurant } from '../lib/miseAJourFichesDb'
```

(remplacer l'import existant `import { formatFR } from '../lib/contrats'`).

État : `const [onglet, setOnglet] = useState(params.onglet === 'signer' ? 'signer' : params.onglet === 'equipe' ? 'equipe' : 'demandes')`, et ajouter `const [equipe, setEquipe] = useState([])` et `const [majOuverte, setMajOuverte] = useState(null) // { trav, demande }`.

Dans `charger()`, ajouter `restaurantId ? chargerEquipeRestaurant(restaurantId).catch(() => []) : []` comme 4e élément du `Promise.all` (`const [d, c, t, e] = …`) et `setEquipe(e)`.

« Mes demandes » ne montre plus que les embauches : `const embauches = demandes.filter(d => (d.type || 'embauche') === 'embauche')` ; remplacer `demandes` par `embauches` dans `demandesOuvertes` et dans le rendu de l'onglet `demandes`.

Calculs : `const lignesEquipe = useMemo(() => listeEquipe(equipe, demandes), [equipe, demandes])` et `const nbEquipe = nbACompleter(equipe, demandes)`.

Puces : ajouter un 3e élément
`{ cle: 'equipe', label: \`📋 Mettre à jour mon équipe${nbEquipe ? \` (${nbEquipe})\` : ''}\` }`.

Rendu, dans le `ScrollView`, ajouter :

```js
          {onglet === 'equipe' && (
            <OngletMiseAJour styles={styles} principale={principale} lignes={lignesEquipe}
              aujourdhui={aujourdhuiISO()} onOuvrir={x => setMajOuverte(x)} />
          )}
```

Et un second formulaire, après le `FormulaireDemande` existant :

```js
      <FormulaireDemande
        visible={!!majOuverte}
        travailleur={majOuverte?.trav || null}
        demande={majOuverte?.demande || null}
        restaurant={restaurant}
        travailleursConnus={connus}
        ctx={ctx}
        onFermer={() => setMajOuverte(null)}
        onEnvoye={() => { setMajOuverte(null); charger() }}
      />
```

- [ ] **Step 3: Vérifier**

Run: `npm run lint 2>&1 | grep -E "✖|  error"` puis `npx expo export -p web 2>&1 | tail -1`
Expected: `0 errors` ; `Exported: dist`

- [ ] **Step 4: Commit**

```bash
git add components/contrats/OngletMiseAJour.js app/recrutement.js
git commit -m "feat(equipe): onglet gérant « Mettre à jour mon équipe »

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Validation RH (avant → après)

**Files:**
- Create: `components/contrats/FeuilleMiseAJourRH.js`
- Modify: `app/embauches.js`

**Interfaces:**
- Consumes: `diffFiche`, `fusionFiche`, `manquantsFiche`, `typeContratPropose` (Task 1) ; `accepterMiseAJour`, `chargerTravailleur` (Task 2) ; `refuserDemande` de `lib/contratsSignesDb.js`.
- Produces: `FeuilleMiseAJourRH({ visible, demande, ctx, onFermer, onTraitee })` ; `onTraitee({ travailleur, generer })` comme `FeuilleDemandeRH`.

- [ ] **Step 1: Écrire `components/contrats/FeuilleMiseAJourRH.js`**

```js
// Mise à jour de fiche envoyée par un gérant, côté RH : seulement ce qui
// change (avant → après), les nouvelles pièces, ce qui manquera encore.
// Accepter fusionne sans rien effacer (lib/miseAJourFiches.js → fusionFiche).
import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Image, Linking, Text, TouchableOpacity, View } from 'react-native'

import { Bouton, Champ, Feuille, Info, Libelle, useEcranModerne } from '../ui/EcranModerne'
import { formatFR } from '../../lib/contrats'
import { refuserDemande } from '../../lib/contratsSignesDb'
import { diffFiche, fusionFiche, manquantsFiche, typeContratPropose } from '../../lib/miseAJourFiches'
import { accepterMiseAJour, chargerTravailleur } from '../../lib/miseAJourFichesDb'
import { estPdf } from '../../lib/recrutement'

const lisible = (cle, v) => (v === null || v === undefined || v === '' ? 'vide'
  : /date_/.test(cle) ? formatFR(v) : cle === 'photo_url' ? 'nouvelle photo' : String(v))

export default function FeuilleMiseAJourRH({ visible, demande, ctx, onFermer, onTraitee }) {
  const { styles, colors, accent } = useEcranModerne('orange')
  const [trav, setTrav] = useState(null)
  const [refus, setRefus] = useState(false)
  const [motif, setMotif] = useState('')
  const [occupe, setOccupe] = useState(false)

  useEffect(() => {
    if (!visible || !demande) return
    setTrav(null); setRefus(false); setMotif('')
    chargerTravailleur(demande.travailleur_id).then(setTrav).catch(e => Alert.alert('Fiche', e.message))
  }, [visible, demande])

  if (!demande) return null
  const diff = trav ? diffFiche(trav, demande) : []
  const { nouvellesPieces, nouveauxPapiers } = trav ? fusionFiche(trav, demande) : { nouvellesPieces: [], nouveauxPapiers: [] }
  const encore = trav ? manquantsFiche({ ...trav, ...fusionFiche(trav, demande).maj }) : []

  async function accepter() {
    setOccupe(true)
    try {
      const t = await accepterMiseAJour(demande, ctx)
      const generer = await new Promise(resolve => Alert.alert('Fiche mise à jour',
        `${t.nom} : fiche à jour.\n\nGénérer son contrat maintenant (${typeContratPropose(t)} proposé) ?`,
        [{ text: 'Plus tard', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Générer le contrat', onPress: () => resolve(true) }]))
      onTraitee?.({ travailleur: t, generer })
    } catch (e) {
      Alert.alert('Validation impossible', e.message)
    } finally {
      setOccupe(false)
    }
  }

  async function refuser() {
    setOccupe(true)
    try {
      await refuserDemande(demande, motif, ctx)
      onTraitee?.({ travailleur: null, generer: false })
    } catch (e) {
      Alert.alert('Refus impossible', e.message)
    } finally {
      setOccupe(false)
    }
  }

  const vignette = u => (
    <TouchableOpacity key={u} onPress={() => Linking.openURL(u)}>
      {estPdf(u)
        ? <View style={{ width: 84, height: 84, borderRadius: 10, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 30 }}>📄</Text></View>
        : <Image source={{ uri: u }} style={{ width: 84, height: 84, borderRadius: 10, backgroundColor: colors.surfaceAlt }} />}
    </TouchableOpacity>
  )

  return (
    <Feuille visible={visible} styles={styles} onFermer={onFermer} titre={trav?.nom || 'Mise à jour de fiche'}
      sous={`Mise à jour envoyée par ${demande.cree_par_nom || 'le gérant'} le ${formatFR(String(demande.updated_at || demande.created_at).slice(0, 10))}`}>
      {!trav ? <ActivityIndicator size="large" color={accent} /> : (
        <>
          <Libelle styles={styles}>Ce qui change</Libelle>
          {diff.length === 0
            ? <Text style={[styles.infoTxt, { flex: 0 }]}>Aucun changement sur la fiche.</Text>
            : diff.map(d => (
              <Text key={d.cle} style={[styles.infoTxt, { flex: 0, marginBottom: 4 }]}>
                {d.libelle} : <Text style={{ color: '#C2462B' }}>{lisible(d.cle, d.avant)}</Text> → <Text style={{ color: colors.text, fontWeight: '700' }}>{lisible(d.cle, d.apres)}</Text>
              </Text>
            ))}
          {diff.some(d => d.cle === 'photo_url') && (
            <View style={{ flexDirection: 'row', gap: 10, marginVertical: 8 }}>
              {trav.photo_url ? <Image source={{ uri: trav.photo_url }} style={{ width: 84, height: 84, borderRadius: 42 }} /> : null}
              <Image source={{ uri: demande.photo_url }} style={{ width: 84, height: 84, borderRadius: 42 }} />
            </View>
          )}
          {(nouvellesPieces.length + nouveauxPapiers.length) > 0 && (
            <>
              <Libelle styles={styles}>Nouvelles pièces</Libelle>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{[...nouvellesPieces, ...nouveauxPapiers].map(vignette)}</View>
            </>
          )}
          {encore.length > 0 && (
            <Info icone="⚠️" styles={styles} couleur="#C27C1A">
              Encore manquant après validation : {encore.join(', ')}. Le contrat demandera de compléter.
            </Info>
          )}
          {occupe ? <ActivityIndicator size="large" color={accent} style={{ marginTop: 14 }} /> : refus ? (
            <View style={{ marginTop: 12 }}>
              <Libelle styles={styles}>Raison du refus (le gérant la verra)</Libelle>
              <Champ styles={styles} colors={colors} multiline value={motif} onChangeText={setMotif}
                placeholder="Ex. photo de la CNI illisible, reprends-la" />
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Bouton flex styles={styles} couleur={colors.textSecondary} variante="contour" label="Retour" onPress={() => setRefus(false)} />
                <Bouton flex styles={styles} couleur="#C2462B" variante="plein" label="Refuser" disabled={!motif.trim()} onPress={refuser} />
              </View>
            </View>
          ) : (
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
              <Bouton flex styles={styles} couleur="#C2462B" label="❌ Refuser" onPress={() => setRefus(true)} />
              <Bouton flex grand styles={styles} couleur="#3B8D2F" variante="plein" label="✅ Accepter" onPress={accepter} />
            </View>
          )}
        </>
      )}
    </Feuille>
  )
}
```

- [ ] **Step 2: Brancher dans `app/embauches.js`**

Import : `import FeuilleMiseAJourRH from '../components/contrats/FeuilleMiseAJourRH'`.

État : `const [majOuverte, setMajOuverte] = useState(null)`.

Helpers : `const estMaj = d => d.type === 'mise_a_jour'` et `const nomDemande = d => nomComplet(d) || connus.find(t => t.id === d.travailleur_id)?.nom || ''`.

Dans `ouvrir(d)` : première ligne `if (d.statut === 'envoyee' && estMaj(d)) { setMajOuverte(d); return }`.

Dans `renderDemande(d)` : remplacer les deux `nomComplet(d)` par `nomDemande(d)`, et ajouter sous la `<Pastille …/>` :

```js
        {estMaj(d) && (
          <Text style={{ alignSelf: 'flex-start', marginTop: 6, color: '#2F6FD8', fontWeight: '800', fontSize: 12 }}>📋 Mise à jour de fiche</Text>
        )}
```

Remplacer « Demandée par » par `{estMaj(d) ? 'Envoyée' : 'Demandée'} par`.

Après `<FeuilleDemandeRH … />`, ajouter :

```js
      <FeuilleMiseAJourRH
        visible={!!majOuverte}
        demande={majOuverte}
        ctx={ctx}
        onFermer={() => setMajOuverte(null)}
        onTraitee={async ({ travailleur, generer }) => {
          setMajOuverte(null)
          await charger()
          if (generer && travailleur?.id) {
            router.push({ pathname: '/contrats', params: { travailleur_id: travailleur.id, generer: '1' } })
          }
        }}
      />
```

- [ ] **Step 3: Vérifier**

Run: `npm run lint 2>&1 | grep -E "✖|  error"` puis `npx expo export -p web 2>&1 | tail -1`
Expected: `0 errors` ; `Exported: dist`

- [ ] **Step 4: Commit**

```bash
git add components/contrats/FeuilleMiseAJourRH.js app/embauches.js
git commit -m "feat(equipe): validation RH des mises à jour de fiches (avant → après)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Suivi par restaurant et relances

**Files:**
- Create: `components/contrats/OngletSuiviCampagne.js`
- Modify: `app/embauches.js`

**Interfaces:**
- Consumes: `resumeCampagne`, `TEXTE_DATE_LIMITE` (Task 1) ; `chargerCampagne`, `relancerGerants` (Task 2).
- Produces: `OngletSuiviCampagne({ styles, accent, resume, onRelancer, onPrevenirTous })` ; `onRelancer(ligne)`, `onPrevenirTous()`.

- [ ] **Step 1: Écrire `components/contrats/OngletSuiviCampagne.js`**

```js
// Suivi de la campagne « fiches + contrats » par restaurant (direction / RH).
import { Text, View } from 'react-native'

import { Bouton, Info } from '../ui/EcranModerne'
import { TEXTE_DATE_LIMITE } from '../../lib/miseAJourFiches'

function Barre({ part, couleur }) {
  return (
    <View style={{ height: 8, borderRadius: 4, backgroundColor: '#E5E5EA', overflow: 'hidden', marginTop: 6 }}>
      <View style={{ width: `${Math.round(part * 100)}%`, height: 8, backgroundColor: couleur }} />
    </View>
  )
}

export default function OngletSuiviCampagne({ styles, accent, resume, onRelancer, onPrevenirTous }) {
  const t = resume.total
  return (
    <>
      <View style={styles.carte}>
        <Text style={styles.carteTitre}>Tout le groupe — date limite le {TEXTE_DATE_LIMITE}</Text>
        <Text style={styles.carteSous}>Fiches à jour {t.aJour}/{t.total} · en attente RH {t.enAttente} · contrats signés {t.contratsSignes}/{t.total}</Text>
        <Barre part={t.total ? t.aJour / t.total : 0} couleur="#3B8D2F" />
        <View style={{ marginTop: 10 }}>
          <Bouton styles={styles} couleur={accent} variante="plein" label="📣 Prévenir tous les gérants" onPress={onPrevenirTous} />
        </View>
      </View>
      <Info icone="ℹ️" styles={styles}>Envoyez la notification de lancement une fois la version publiée (web et application).</Info>
      {resume.lignes.map(l => (
        <View key={l.restaurant_id} style={styles.carte}>
          <Text style={styles.carteTitre}>{l.nom}</Text>
          <Text style={styles.carteSous}>Fiches à jour {l.aJour}/{l.total} · en attente RH {l.enAttente} · contrats signés {l.contratsSignes}/{l.total}</Text>
          <Barre part={l.total ? l.aJour / l.total : 0} couleur="#3B8D2F" />
          <Barre part={l.total ? l.contratsSignes / l.total : 0} couleur="#2F6FD8" />
          {l.aCompleter > 0 && (
            <View style={{ marginTop: 10 }}>
              <Bouton styles={styles} couleur={accent} label={`🔔 Relancer le gérant (${l.aCompleter} à compléter)`} onPress={() => onRelancer(l)} />
            </View>
          )}
        </View>
      ))}
    </>
  )
}
```

- [ ] **Step 2: Brancher dans `app/embauches.js`**

Imports : `import OngletSuiviCampagne from '../components/contrats/OngletSuiviCampagne'`, `import { aujourdhuiISO } from '../lib/contrats'` (ajouter à l'import existant de `formatFR` s'il vient de `../lib/contrats`), `import { resumeCampagne } from '../lib/miseAJourFiches'`, `import { chargerCampagne, relancerGerants } from '../lib/miseAJourFichesDb'`, et `Alert` dans l'import `react-native`.

État : `const [campagne, setCampagne] = useState({ travailleurs: [], contrats: [] })`.

Dans `charger()` : 4e élément du `Promise.all` : `chargerCampagne().catch(() => ({ travailleurs: [], contrats: [] }))` → `setCampagne(cp)`.

Calcul : 

```js
  const resume = useMemo(() => resumeCampagne({
    travailleurs: campagne.travailleurs, demandes, contrats: campagne.contrats,
    restaurants: restaurants.filter(r => filtreResto === 'tous' || r.id === filtreResto), aujourdhui: aujourdhuiISO(),
  }), [campagne, demandes, restaurants, filtreResto])
```

(ajouter `useMemo` à l'import React).

Actions :

```js
  async function relancer(l) {
    try { await relancerGerants({ restaurantId: l.restaurant_id, nombre: l.aCompleter }); Alert.alert('Relance envoyée', `Les gérants de ${l.nom} ont reçu un rappel.`) }
    catch { Alert.alert('Relance', "La notification n'est pas partie. Réessaie.") }
  }
  async function prevenirTous() {
    const cibles = resume.lignes.filter(l => l.aCompleter > 0)
    await Promise.all(cibles.map(l => relancerGerants({ restaurantId: l.restaurant_id, nombre: l.aCompleter }).catch(() => {})))
    Alert.alert('Gérants prévenus', `${cibles.length} restaurant${cibles.length > 1 ? 's' : ''} prévenu${cibles.length > 1 ? 's' : ''}.`)
  }
```

Puces : 4e élément `{ cle: 'suivi', label: '📊 Suivi' }`. `ONGLETS` reste inchangé ; `affichees` vaut `[]` pour `suivi` (aucun statut `undefined`). Dans le `ScrollView`, remplacer le bloc liste par :

```js
          {onglet === 'suivi'
            ? <OngletSuiviCampagne styles={styles} accent={accent} resume={resume} onRelancer={relancer} onPrevenirTous={prevenirTous} />
            : affichees.length
              ? affichees.map(renderDemande)
              : <Vide icone={vides.icone} styles={styles} texte={vides.texte} sous={vides.sous} />}
```

et protéger `vides` : `const vides = { … }[onglet] || {}`.

- [ ] **Step 3: Vérifier**

Run: `npm run lint 2>&1 | grep -E "✖|  error"` puis `npx expo export -p web 2>&1 | tail -1`
Expected: `0 errors` ; `Exported: dist`

- [ ] **Step 4: Commit**

```bash
git add components/contrats/OngletSuiviCampagne.js app/embauches.js
git commit -m "feat(equipe): suivi par restaurant et relance des gérants

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Génération du contrat — type proposé et contrat déjà terminé

**Files:**
- Modify: `components/contrats/FormulaireGeneration.js`

**Interfaces:**
- Consumes: `typeContratPropose`, `contratDejaTermine` (Task 1) ; `aujourdhuiISO` de `lib/contrats.js`.

- [ ] **Step 1: Type proposé**

Import : `import { contratDejaTermine, typeContratPropose } from '../../lib/miseAJourFiches'` et ajouter `aujourdhuiISO` à l'import de `../../lib/contrats`.

Dans le `useEffect` d'ouverture : `const t = contratRefuse?.type || 'CDD'` → `const t = contratRefuse?.type || typeContratPropose(travailleur)`.

- [ ] **Step 2: Alerte « déjà terminé »**

Juste après `{fin ? <Info icone="🏁" styles={styles}>Fin du contrat : le {formatFR(fin)}</Info> : null}`, ajouter :

```js
      {contratDejaTermine(fin, aujourdhuiISO()) ? (
        <Info icone="⚠️" styles={styles} couleur="#C2462B">
          Avec cette durée, le contrat serait déjà terminé le {formatFR(fin)} : il commence à la date d'embauche. Choisis une durée plus longue.
        </Info>
      ) : null}
```

Mettre à jour le commentaire d'en-tête (ligne « Dates : … ») : ajouter « Type proposé à l'ouverture : Journalier → Stage, CDI → CDI, sinon CDD (lib/miseAJourFiches.js, 29/10/2026). »

- [ ] **Step 3: Vérifier**

Run: `npm run lint 2>&1 | grep -E "✖|  error"` puis `npx expo export -p web 2>&1 | tail -1`
Expected: `0 errors` ; `Exported: dist`

- [ ] **Step 4: Commit**

```bash
git add components/contrats/FormulaireGeneration.js
git commit -m "feat(contrats): type proposé selon la fiche et alerte contrat déjà terminé

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Badge d'accueil du gérant

**Files:**
- Modify: `components/accueil/AccueilManager.js`

**Interfaces:**
- Consumes: `nbACompleter` (Task 1).

- [ ] **Step 1: Charger l'équipe et les mises à jour du gérant**

Import : `import { nbACompleter } from '../../lib/miseAJourFiches'`.

Dans la branche gérant (`const [pts, corr, dem, …, supTaches] = await Promise.all([`), ajouter deux éléments à la fin du tableau et de la déstructuration (`…, supTaches, equipeG, majG]`) :

```js
          // Campagne fiches (29/10/2026) : fiches à compléter par le gérant.
          supabase.from('travailleurs').select('*').eq('restaurant_id', restaurantId).neq('statut', 'archive').range(0, 999),
          supabase.from('demandes_travailleurs').select('id, type, travailleur_id, statut, created_at')
            .eq('restaurant_id', restaurantId).in('statut', ['envoyee', 'refusee']),
```

Dans le `setEtat({ hier, gerant: { … }, … })` de cette branche, ajouter au niveau supérieur (à côté de `avisHier`) :

```js
          fichesACompleter: equipeG.error ? 0 : nbACompleter(equipeG.data || [], majG.error ? [] : majG.data || []),
```

- [ ] **Step 2: Badge**

Dans l'objet `badges`, ajouter :

```js
    'recrutement': etat?.fichesACompleter ? `${etat.fichesACompleter} fiche${etat.fichesACompleter > 1 ? 's' : ''} à compléter` : null,
```

- [ ] **Step 3: Vérifier**

Run: `npm run lint 2>&1 | grep -E "✖|  error"` ; `for f in lib/*.test.mjs; do node "$f" >/dev/null 2>&1 || echo "ÉCHEC $f"; done` ; `npx expo export -p web 2>&1 | tail -1`
Expected: `0 errors` ; aucune ligne « ÉCHEC » ; `Exported: dist`

- [ ] **Step 4: Commit**

```bash
git add components/accueil/AccueilManager.js
git commit -m "feat(accueil): badge « fiches à compléter » sur la tuile du gérant

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Clôture

- [ ] **Step 1:** `git push` ; `graphify update .` (règle du projet) puis commit `chore(graphify): graphe à jour` si des fichiers changent.
- [ ] **Step 2:** Mettre à jour la mémoire `mise-a-jour-fiches-campagne.md` (commits, migration à passer, rien de publié).
- [ ] **Step 3:** Publier d'abord (Vercel **et** EAS) ; faire recharger le web et relancer deux fois l'application sur les postes RH et manager ; **ensuite seulement** passer `supabase_mise_a_jour_fiches.sql` ; puis « 📣 Prévenir tous les gérants » (Nouveaux travailleurs → Suivi). Code avant migration = sans danger ; migration avant code = une mise à jour pourrait être acceptée comme une embauche par un ancien écran.
