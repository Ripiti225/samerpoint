# Correction et complément des fiches par la RH — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** permettre au manager, au directeur et à la RH de corriger une fiche envoyée par un gérant avant de l'accepter, et de compléter les fiches incomplètes depuis une liste dédiée.

**Architecture :** la logique reste pure dans `lib/miseAJourFiches.js` (testée avec `node:test`) ; les écritures restent dans `lib/miseAJourFichesDb.js`, `lib/contratsSignesDb.js` et `lib/equipeDb.js`. L'interface réutilise `ModalFormTravailleur` et ajoute deux composants : `ChampsCorrectionFiche` et `OngletACompleter`.

**Tech Stack :** React Native / Expo, Supabase, `node:test`.

**Conception :** `docs/superpowers/specs/2026-11-06-correction-fiches-rh-design.md`.

## Global Constraints

- Interface et messages en français courant, sans code technique.
- Jamais de date tapée : toute date passe par `ChampDate`.
- Aucune migration de base de données.
- Lectures Supabase susceptibles de dépasser 1000 lignes : toujours `.range()` + `.order()` stable.
- `journaliser` ne bloque jamais une action (`.catch(() => {})`).
- `git` : préfixer par `export DEVELOPER_DIR=/Library/Developer/CommandLineTools`. Ne jamais lancer `git add -A` : le dossier contient le travail d'une autre personne ou session (voir Task 2).
- Ne jamais lancer `expo start` ni `localhost` : vérifier par tests, lint et export web.
- Commit et push à chaque tâche. **Aucune publication Vercel ou EAS dans ce plan.**
- Tests : `node lib/miseAJourFiches.test.mjs` ; tout : `for f in lib/*.test.mjs; do node "$f"; done`.

---

### Task 1 : logique pure

**Files :**
- Modify : `lib/miseAJourFiches.js`
- Test : `lib/miseAJourFiches.test.mjs`, `lib/equipe.test.mjs`

**Interfaces :**
- Produces (depuis `lib/miseAJourFiches.js`) :
  - `nomSuivi(trav, nouveau) → string | null`
  - `CHAMPS_CORRIGIBLES: string[]`
  - `demandeCorrigee(demande, form) → demande`
  - `champsCorriges(demande) → objet`
  - `correctionsRH(depart, form) → [{ champ, envoye, retenu }]`
  - `correctionComplete(form) → boolean`
  - `changementsFiche(avant, apres) → [{ champ, avant, apres }]`
  - `fichesACompleter(travailleurs, demandes, { restaurantId, manque }) → lignes de listeEquipe`
  - `comptesManquants(travailleurs, demandes, { restaurantId }) → [{ libelle, nombre }]`
  - `diffFiche` et `fusionFiche` incluent désormais `nom` quand il suit.

- [ ] **Step 1 : écrire les tests qui échouent**

Dans `lib/miseAJourFiches.test.mjs`, étendre l'import :

```js
import {
  contratDejaTermine, dateLimiteDepassee, demandesEnAttenteParTravailleur, diffFiche, etatFiche,
  champsAEnvoyer, ficheVersFormulaire, formulaireCorrection, fusionFiche, listeEquipe, manquantsFiche, nbACompleter, proposerNomPrenoms,
  resumeCampagne, typeContratPropose,
  changementsFiche, champsCorriges, comptesManquants, correctionComplete, correctionsRH, demandeCorrigee, fichesACompleter, nomSuivi,
} from './miseAJourFiches.js'
```

Ajouter à la fin du fichier :

```js
describe('nomSuivi', () => {
  const trav = { nom: 'KOUASSI Jean', nom_famille: 'KOUASSI', prenoms: 'Jean' }
  test('nom de famille changé : le nom complet suit', () => {
    assert.equal(nomSuivi(trav, { nom_famille: 'Kouadio', prenoms: 'Jean' }), 'KOUADIO Jean')
  })
  test('un seul champ fourni : l’autre vient de la fiche', () => {
    assert.equal(nomSuivi(trav, { prenoms: 'Jean Marc' }), 'KOUASSI Jean Marc')
  })
  test('identité inchangée : le nom ne bouge pas, même différent du format', () => {
    assert.equal(nomSuivi({ ...trav, nom: 'Kouassi J.' }, { nom_famille: 'KOUASSI', prenoms: 'Jean' }), null)
  })
  test('valeur vidée : pas de renommage', () => {
    assert.equal(nomSuivi(trav, { nom_famille: '', prenoms: 'Marc' }), null)
    assert.equal(nomSuivi(trav, { nom_famille: null, prenoms: 'Marc' }), null)
  })
  test('résultat identique au nom actuel : rien', () => {
    const sansIdentite = { nom: 'KOUASSI Jean', nom_famille: null, prenoms: null }
    assert.equal(nomSuivi(sansIdentite, { nom_famille: 'Kouassi', prenoms: 'Jean' }), null)
  })
})

describe('diffFiche et fusionFiche avec le nom complet', () => {
  test('une correction du nom ajoute la ligne Nom complet et écrit nom', () => {
    const d = { ...complete, nom_famille: 'Kouadio', piece_identite_urls: [], papiers_urls: [] }
    const ligne = diffFiche(complete, d).find(x => x.cle === 'nom')
    assert.deepEqual(ligne, { cle: 'nom', libelle: 'Nom complet', avant: 'KOUASSI Jean', apres: 'KOUADIO Jean' })
    assert.equal(fusionFiche(complete, d).maj.nom, 'KOUADIO Jean')
  })
  test('prénoms envoyés vides : les prénoms de la fiche sont repris dans le nom', () => {
    const d = { ...complete, nom_famille: 'Kouadio', prenoms: '', piece_identite_urls: [] }
    assert.equal(fusionFiche(complete, d).maj.nom, 'KOUADIO Jean')
  })
})

describe('corrections de la RH', () => {
  const demande = { id: 'd1', statut: 'envoyee', photo_url: 'g.jpg', nom_famille: 'Kouassi', prenoms: 'Jean', date_embauche: null, lieu_naissance: 'Bouaké' }
  test('demandeCorrigee : applique, vide en null, garde photo et statut', () => {
    const c = demandeCorrigee(demande, { nom_famille: ' Kouadio ', prenoms: 'Jean', date_embauche: '2026-01-09', lieu_naissance: '  ' })
    assert.equal(c.nom_famille, 'Kouadio')
    assert.equal(c.date_embauche, '2026-01-09')
    assert.equal(c.lieu_naissance, null)
    assert.equal(c.photo_url, 'g.jpg')
    assert.equal(c.statut, 'envoyee')
  })
  test('champsCorriges : seulement les champs corrigibles', () => {
    const c = champsCorriges({ ...demande, cni_numero: 'CI1' })
    assert.equal(c.cni_numero, 'CI1')
    assert.ok(!('id' in c) && !('statut' in c) && !('photo_url' in c))
  })
  test('correctionsRH : seulement ce qui a changé', () => {
    const depart = { nom_famille: 'Kouassi', prenoms: 'Jean', date_embauche: '' }
    const form = { nom_famille: 'Kouassi', prenoms: 'Jean Marc', date_embauche: '2026-01-09' }
    assert.deepEqual(correctionsRH(depart, form), [
      { champ: 'Prénoms', envoye: 'Jean', retenu: 'Jean Marc' },
      { champ: "Date d'embauche", envoye: null, retenu: '2026-01-09' },
    ])
  })
  test('correctionComplete : nom de famille et prénoms exigés', () => {
    assert.equal(correctionComplete({ nom_famille: 'A', prenoms: 'B' }), true)
    assert.equal(correctionComplete({ nom_famille: 'A', prenoms: ' ' }), false)
  })
  test('formulaireCorrection sans fiche : part de la demande (embauche)', () => {
    const f = formulaireCorrection(null, demande)
    assert.equal(f.nom_famille, 'Kouassi')
    assert.equal(f.lieu_naissance, 'Bouaké')
  })
})

describe('changementsFiche', () => {
  test('liste uniquement ce qui change, nom compris, vide en null', () => {
    const avant = { nom: 'A B', contact: '07', date_embauche: null, poste: 'Serveur/se' }
    const apres = { nom: 'A C', contact: '07', date_embauche: '2026-01-09', poste: 'Serveur/se' }
    assert.deepEqual(changementsFiche(avant, apres), [
      { champ: 'Nom complet', avant: 'A B', apres: 'A C' },
      { champ: "Date d'embauche", avant: null, apres: '2026-01-09' },
    ])
  })
})

describe('fichesACompleter', () => {
  const t1 = { ...complete, id: 'c1', nom: 'A', restaurant_id: 'r1', date_embauche: null }
  const t2 = { ...complete, id: 'c2', nom: 'B', restaurant_id: 'r2', date_embauche: null, cni_numero: null, contact: '' }
  const t3 = { ...complete, id: 'c3', nom: 'C', restaurant_id: 'r1' }
  const t4 = { ...complete, id: 'c4', nom: 'D', restaurant_id: 'r1' }
  const archive = { ...t2, id: 'c5', statut: 'archive' }
  const refus = { id: 'dr', type: 'mise_a_jour', travailleur_id: 'c4', statut: 'refusee', created_at: '2026-11-01' }
  const envoi = { id: 'de', type: 'mise_a_jour', travailleur_id: 'c3', statut: 'envoyee', created_at: '2026-11-01' }
  const tous = [t1, t2, t3, t4, archive]

  test('incomplètes et refusées, plus incomplètes d’abord, sans archivés ni complètes en attente', () => {
    assert.deepEqual(fichesACompleter(tous, [refus, envoi]).map(l => l.trav.id), ['c2', 'c1', 'c4'])
  })
  test('filtre restaurant et donnée manquante', () => {
    assert.deepEqual(fichesACompleter(tous, [], { restaurantId: 'r1' }).map(l => l.trav.id), ['c1'])
    assert.deepEqual(fichesACompleter(tous, [], { manque: 'Téléphone' }).map(l => l.trav.id), ['c2'])
  })
  test('la demande en attente accompagne la ligne', () => {
    assert.equal(fichesACompleter(tous, [refus]).find(l => l.trav.id === 'c4').demande.id, 'dr')
  })
  test('comptesManquants : du plus fréquent au moins fréquent, par restaurant', () => {
    const c = comptesManquants(tous, [])
    assert.deepEqual(c[0], { libelle: "Date d'embauche", nombre: 2 })
    assert.deepEqual(comptesManquants(tous, [], { restaurantId: 'r1' }), [{ libelle: "Date d'embauche", nombre: 1 }])
  })
})
```

Dans `lib/equipe.test.mjs`, ajouter après le test « un homonyme dans deux restaurants » :

```js
  test('un homonyme archivé dans un autre restaurant empêche de deviner ailleurs', () => {
    const fiches = [{ id: 'a1', nom: 'Moussa', restaurant_id: A }, { id: 'a2', nom: 'Moussa', restaurant_id: B, statut: 'archive' }]
    const r = rattacherPaiesGerant([paie('d1', 'Moussa', 1000, 'resto-c'), paie('d2', 'Moussa', 1000, A)], fiches)
    assert.deepEqual(r.map(d => d.travailleur_id), [null, 'a1'])
  })
```

- [ ] **Step 2 : vérifier l'échec**

Run : `node lib/miseAJourFiches.test.mjs`
Attendu : échec, les fonctions n'existent pas encore.

- [ ] **Step 3 : implémenter**

Dans `lib/miseAJourFiches.js`, remplacer l'en-tête :

```js
// Une mise à jour = demande_travailleurs de type 'mise_a_jour' rattachée au
// travailleur. À l'acceptation, un champ envoyé vide n'efface JAMAIS une
// valeur connue. `nom` suit le nom de famille et les prénoms quand ils changent
// (nomSuivi) ; les écritures relient d'abord les anciennes paies à la fiche.
// ──────────────────────────────────────────────────────────────────────────────
import { contratEnCours, contratsSignes } from './contrats.js'
import { nomComplet } from './recrutement.js'
```

Ajouter après la définition de `norm` :

```js
/**
 * Nouveau nom complet si le nom de famille ou les prénoms changent, que les deux
 * sont remplis et que le résultat diffère ; sinon null. Un champ absent de
 * `nouveau` garde sa valeur de la fiche. Empêche tout renommage en masse.
 */
export function nomSuivi(trav, nouveau) {
  const t = trav || {}
  const n = nouveau || {}
  const famille = 'nom_famille' in n ? norm(n.nom_famille) : norm(t.nom_famille)
  const prenoms = 'prenoms' in n ? norm(n.prenoms) : norm(t.prenoms)
  if (famille === norm(t.nom_famille) && prenoms === norm(t.prenoms)) return null
  if (!famille || !prenoms) return null
  const nom = nomComplet({ nom_famille: famille, prenoms })
  return nom === norm(t.nom) ? null : nom
}
```

Remplacer `diffFiche` :

```js
/** Champs qui changent : envoyés remplis ET différents de la fiche, plus le nom complet s'il suit. */
export function diffFiche(trav, demande) {
  const t = trav || {}
  const lignes = CHAMPS_FUSION
    .filter(cle => !vide(demande?.[cle]) && norm(demande[cle]) !== norm(t[cle]))
    .map(cle => ({ cle, libelle: LIBELLES[cle], avant: vide(t[cle]) ? null : t[cle], apres: demande[cle] }))
  const identite = {}
  for (const { cle, apres } of lignes) if (cle === 'nom_famille' || cle === 'prenoms') identite[cle] = apres
  const nom = nomSuivi(t, identite)
  if (nom) lignes.push({ cle: 'nom', libelle: 'Nom complet', avant: vide(t.nom) ? null : t.nom, apres: nom })
  return lignes
}
```

Remplacer le commentaire de `fusionFiche` par :

```js
/** Ce que l'acceptation écrit : jamais un vide, pièces sans doublon ; `nom` seulement s'il suit (voir diffFiche). */
```

Ajouter après `fusionFiche` :

```js
// ── Corrections de la RH et complément direct ─────────────────────────────────

export const CHAMPS_CORRIGIBLES = CHAMPS_FUSION.filter(c => c !== 'photo_url')

/** La demande avec les valeurs retenues par la RH : texte nettoyé, champ vide → null. */
export function demandeCorrigee(demande, form) {
  const sortie = { ...demande }
  for (const c of CHAMPS_CORRIGIBLES) sortie[c] = norm(form?.[c]) || null
  return sortie
}

export function champsCorriges(demande) {
  return Object.fromEntries(CHAMPS_CORRIGIBLES.map(c => [c, demande?.[c] ?? null]))
}

/** Ce que la RH a changé par rapport au formulaire ouvert, pour le journal. */
export function correctionsRH(depart, form) {
  return CHAMPS_CORRIGIBLES
    .filter(c => norm(depart?.[c]) !== norm(form?.[c]))
    .map(c => ({ champ: LIBELLES[c], envoye: norm(depart?.[c]) || null, retenu: norm(form?.[c]) || null }))
}

/** La table des demandes exige nom de famille et prénoms. */
export const correctionComplete = form => !vide(form?.nom_famille) && !vide(form?.prenoms)

const LIBELLES_JOURNAL = {
  nom: 'Nom complet', ...LIBELLES, poste: 'Poste', type_contrat: 'Type de contrat', salaire_journalier: 'Salaire journalier',
}

/** Avant → après d'une fiche modifiée, pour le journal. */
export function changementsFiche(avant, apres) {
  return Object.keys(LIBELLES_JOURNAL)
    .filter(c => c in (apres || {}) && norm(avant?.[c]) !== norm(apres[c]))
    .map(c => ({ champ: LIBELLES_JOURNAL[c], avant: norm(avant?.[c]) || null, apres: norm(apres[c]) || null }))
}
```

Ajouter avant `resumeCampagne` :

```js
const aCompleter = (travailleurs, demandes, restaurantId) => listeEquipe(travailleurs, demandes)
  .filter(x => x.manquants.length > 0 || x.etat === 'refusee')
  .filter(x => !restaurantId || x.trav.restaurant_id === restaurantId)

/** Fiches incomplètes ou refusées : celles où il manque le plus d'abord, puis par nom. */
export function fichesACompleter(travailleurs, demandes, { restaurantId = null, manque = null } = {}) {
  return aCompleter(travailleurs, demandes, restaurantId)
    .filter(x => !manque || x.manquants.includes(manque))
    .sort((a, b) => b.manquants.length - a.manquants.length
      || String(a.trav.nom || '').localeCompare(String(b.trav.nom || '')))
}

/** Nombre de fiches par donnée manquante, du plus fréquent au moins fréquent. */
export function comptesManquants(travailleurs, demandes, { restaurantId = null } = {}) {
  const compte = {}
  for (const x of aCompleter(travailleurs, demandes, restaurantId)) {
    for (const m of x.manquants) compte[m] = (compte[m] || 0) + 1
  }
  return Object.entries(compte)
    .map(([libelle, nombre]) => ({ libelle, nombre }))
    .sort((a, b) => b.nombre - a.nombre || a.libelle.localeCompare(b.libelle))
}
```

Dans le module, `listeEquipe` est une déclaration `function` : elle reste utilisable depuis `aCompleter`.

- [ ] **Step 4 : vérifier le succès**

Run : `node lib/miseAJourFiches.test.mjs && node lib/equipe.test.mjs && node lib/recrutement.test.mjs`
Attendu : `fail 0` partout.

Dans le test `'fusion : un champ vide n’efface pas'`, `assert.ok(!('nom' in f.maj))` doit rester vrai : l'identité n'y change pas.

- [ ] **Step 5 : commit**

```bash
export DEVELOPER_DIR=/Library/Developer/CommandLineTools
git add lib/miseAJourFiches.js lib/miseAJourFiches.test.mjs lib/equipe.test.mjs
git commit -m "feat(equipe): logique du nom suivi, des corrections RH et des fiches à compléter

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

---

### Task 2 : renommage protégé dans Équipe → Modifier

**Files :**
- Modify : `lib/equipeDb.js`, `components/equipe/Modales.js`, `app/equipe.js`

**Interfaces :**
- Consumes : `nomSuivi`, `changementsFiche` (Task 1).
- Produces :
  - `rattacherPaiesAvantRenommage(trav) → Promise<number>` depuis `lib/equipeDb.js`. Lève une `Error` au message français, avec `e.francais = true`.
  - `enregistrerTravailleur({ form, travailleurEdition, resto, papiers, ctx })`.
  - Prop `ctx` de `ModalFormTravailleur`.

**Attention :** `components/equipe/Modales.js` contient déjà un travail non commité qui n'est pas de ce chantier (message du badge dans `ModalArchive`). Il ne faut ni le perdre ni le commiter ici. Sa copie est dans `/private/tmp/claude-501/-Users-macbookpro-samtrackly/7fbeaf1d-8fc2-47f4-b689-4c6fb106736c/scratchpad/modales-autre-travail.patch`.

- [ ] **Step 1 : rattachement et enregistrement dans `lib/equipeDb.js`**

Ajouter aux imports :

```js
import { journaliser } from './journal'
import { changementsFiche, nomSuivi } from './miseAJourFiches'
```

Remplacer dans `chargerPaiesGerantTravailleur` la ligne `const motCle = …` par `const motCle = motCleNom(trav.nom)`, le motif `ilike` par `` `%${echappeLike(motCle)}%` ``, et ajouter au-dessus de la doc de cette fonction :

```js
const motCleNom = nom => String(nom || '').trim().split(/\s+/).sort((a, b) => b.length - a.length)[0] || ''
const echappeLike = s => s.replace(/[%_\\]/g, c => `\\${c}`)

/**
 * Avant de renommer : les anciennes paies de gérant sans fiche ne se retrouvent
 * que par le nom. On écrit leur travailleur_id tant que l'ancien nom est encore
 * sur la fiche. Le choix vise toutes les fiches, archivées comprises : un
 * homonyme ambigu laisse la paie intacte. → nombre de paies reliées.
 */
export async function rattacherPaiesAvantRenommage(trav) {
  const motCle = motCleNom(trav.nom)
  if (!motCle) return 0
  try {
    const [lignes, travailleurs] = await Promise.all([
      toutesLesPages(() => supabase.from('depenses').select('id, libelle, travailleur_id, points!inner(date, restaurant_id)')
        .eq('categorie', 'Paie').eq('saisi_par', 'gerant').is('travailleur_id', null)
        .ilike('libelle', `%${echappeLike(motCle)}%`).order('id')),
      toutesLesPages(() => supabase.from('travailleurs').select('id, nom, restaurant_id').order('id')),
    ])
    const ids = rattacherPaiesGerant(aplatirPoint(lignes), travailleurs)
      .filter(d => d.travailleur_id === trav.id).map(d => d.id)
    for (let i = 0; i < ids.length; i += 200) {
      const { error } = await supabase.from('depenses').update({ travailleur_id: trav.id }).in('id', ids.slice(i, i + 200))
      if (error) throw error
    }
    return ids.length
  } catch {
    const e = new Error("Le nom n'a pas été changé : les anciennes paies n'ont pas pu être reliées à la fiche. Vérifie ta connexion et réessaie.")
    e.francais = true
    throw e
  }
}
```

Remplacer le début d'`enregistrerTravailleur`, jusqu'à la fin de la branche d'édition :

```js
export async function enregistrerTravailleur({ form, travailleurEdition, resto, papiers, ctx = null }) {
  const champs = {
    poste: form.poste,
    type_contrat: form.type_contrat,
    contact: form.contact || null,
    photo_url: form.photo_url || null,
    salaire_journalier: parseInt(form.salaire_journalier) || null,
    date_embauche: form.date_embauche || null,
    ...champsJourRepos(form.jour_repos_choix, travailleurEdition),
    ...champsIdentite(form),
  }

  let travId = travailleurEdition?.id
  // En édition, le nom complet ne suit que le nom de famille et les prénoms (nomSuivi).
  const nouveauNom = travailleurEdition ? nomSuivi(travailleurEdition, champs) : null
  const nomFinal = travailleurEdition ? (nouveauNom || travailleurEdition.nom) : form.nom
  if (travailleurEdition) {
    const paiesReliees = nouveauNom ? await rattacherPaiesAvantRenommage(travailleurEdition) : 0
    const ecriture = { nom: nomFinal, ...champs }
    const { error } = await supabase.from('travailleurs').update(ecriture).eq('id', travId)
    if (error) throw error
    notifier({
      type: 'travailleur_modifie', titre: '✏️ Travailleur modifié',
      message: `${nomFinal} — ${resto?.nom || ''}`, restaurant_id: resto?.id || null,
    })
    journaliser('FICHE_TRAV_MODIFIEE', {
      travailleur_id: travId, travailleur: nomFinal,
      changements: changementsFiche(travailleurEdition, ecriture), paies_rattachees: paiesReliees,
    }, { userId: ctx?.userId || null, userNom: ctx?.userNom || null, restaurantId: travailleurEdition.restaurant_id || null }).catch(() => {})
  } else {
```

La suite (branche d'ajout) reste identique. Dans le bloc `papiers`, remplacer `form.nom` par `nomFinal`.

- [ ] **Step 2 : modale, sans toucher à `ModalArchive`**

Dans `components/equipe/Modales.js` :

Remplacer l'import d'`equipeDb` et ajouter celui de `nomSuivi` :

```js
import { champsIdentite, enregistrerTravailleur } from '../../lib/equipeDb'
import { nomSuivi } from '../../lib/miseAJourFiches'
```

Ajouter `ctx` à la signature :

```js
export function ModalFormTravailleur({ visible, edition, restaurants, restoParDefaut, styles, colors, ctx, onFermer, onEnregistre }) {
```

Après `const peutEnregistrer = …` :

```js
  const nouveauNom = edition ? nomSuivi(edition, champsIdentite(form)) : null
```

Remplacer le corps du `try/catch` d'`enregistrer` :

```js
    try {
      await enregistrerTravailleur({ form, travailleurEdition: edition, resto, papiers, ctx })
      onEnregistre()
      Alert.alert('Succès', edition ? 'Travailleur modifié !' : 'Travailleur ajouté !')
    } catch (e) {
      Alert.alert('Erreur', e?.francais ? e.message : "L'enregistrement a échoué. Vérifiez la connexion et réessayez.")
    }
```

Juste après `<SectionIdentite form={form} setForm={setForm} styles={styles} />` :

```jsx
          {nouveauNom && (
            <Text style={[styles.motifTxt, { fontSize: 13, fontWeight: '700', marginBottom: 14 }]}>
              ✏️ Nom complet : {edition.nom} → {nouveauNom}
            </Text>
          )}
```

- [ ] **Step 3 : écran Équipe**

Dans `app/equipe.js`, ajouter à `<ModalFormTravailleur` :

```jsx
        ctx={{ userId: userId || null, userNom: userNom || null }}
```

- [ ] **Step 4 : vérifier**

Run : `npm run lint 2>&1 | tail -5 && node lib/equipe.test.mjs && node lib/miseAJourFiches.test.mjs`
Attendu : 0 erreur de lint, `fail 0`.

- [ ] **Step 5 : commit sans le travail de l'autre chantier**

```bash
export DEVELOPER_DIR=/Library/Developer/CommandLineTools
PATCH=/private/tmp/claude-501/-Users-macbookpro-samtrackly/7fbeaf1d-8fc2-47f4-b689-4c6fb106736c/scratchpad/modales-autre-travail.patch
git diff components/equipe/Modales.js | grep -q badgeManquant && AUTRE=1 || AUTRE=0
if [ "$AUTRE" = 1 ]; then
  TMP=$(mktemp); cp components/equipe/Modales.js "$TMP"
  patch -R --no-backup-if-mismatch "$TMP" < "$PATCH"
  H=$(git hash-object -w "$TMP"); git update-index --cacheinfo 100644,"$H",components/equipe/Modales.js; rm -f "$TMP"
else
  git add components/equipe/Modales.js
fi
git add lib/equipeDb.js app/equipe.js
git diff --cached -- components/equipe/Modales.js | grep -c badgeManquant
```

Attendu : `0` à la dernière ligne, le travail sur le badge reste non indexé. Si `patch` échoue, s'arrêter et le signaler.

```bash
git commit -m "feat(equipe): le nom complet suit l'identité, anciennes paies reliées d'abord

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

---

### Task 3 : acceptation avec corrections et reprise d'une fiche refusée

**Files :**
- Modify : `lib/miseAJourFichesDb.js`, `lib/contratsSignesDb.js`

**Interfaces :**
- Consumes : `champsCorriges` (Task 1), `rattacherPaiesAvantRenommage` (Task 2).
- Produces :
  - `accepterMiseAJour(demande, ctx, corrections = [])` : `demande` est la version corrigée, `demande.statut` vaut `envoyee` ou `refusee`.
  - `accepterDemande(demande, options, ctx, corrections = [])`.

- [ ] **Step 1 : `accepterMiseAJour`**

Dans `lib/miseAJourFichesDb.js`, ajouter aux imports :

```js
import { rattacherPaiesAvantRenommage } from './equipeDb'
import { TEXTE_DATE_LIMITE, champsAEnvoyer, champsCorriges, fusionFiche } from './miseAJourFiches'
```

(la seconde ligne remplace l'import existant de `./miseAJourFiches`.)

Remplacer le commentaire et toute la fonction :

```js
/**
 * RH : réserve d'abord la demande sur le statut lu à l'ouverture (une seule fois :
 * si le gérant l'a renvoyée entre-temps, on s'arrête), puis écrit pièces et fiche.
 * `demande` porte les valeurs retenues ; `corrections` = ce que la RH a changé.
 * Si une écriture échoue, la demande retrouve son état d'origine pour qu'un nouvel
 * essai réécrive tout.
 */
export async function accepterMiseAJour(demande, ctx, corrections = []) {
  const { data, error } = await supabase.from('demandes_travailleurs').update({
    ...(corrections.length ? champsCorriges(demande) : {}),
    statut: 'acceptee', motif_refus: null, traite_par: ctx?.userId || null, traite_par_nom: ctx?.userNom || null,
    traite_le: maintenant(), updated_at: maintenant(),
  }).eq('id', demande.id).eq('statut', demande.statut).select('id')
  if (error) throw new Error("La validation n'a pas été enregistrée. Réessaie.")
  if (!data?.length) throw new Error('Cette fiche vient de changer : quelqu’un l’a déjà traitée ou le gérant l’a renvoyée. Recharge la liste.')

  let trav
  let nomFinal
  let paiesReliees = 0
  try {
    trav = await chargerTravailleur(demande.travailleur_id)
    const { maj, nouvellesPieces, nouveauxPapiers } = fusionFiche(trav, demande)
    nomFinal = maj.nom || trav.nom
    // Pièces avant la fiche : si l'insertion échoue, un nouvel essai réajoute les pièces
    // (fusionFiche les compare à piece_identite_urls, pas encore mis à jour).
    const papiers = [
      ...nouvellesPieces.map(url => ({ type_document: 'CNI', fichier_url: url })),
      ...nouveauxPapiers.map(url => ({ type_document: 'Autre', fichier_url: url })),
    ]
    if (papiers.length) {
      const { error: errPapiers } = await supabase.from('documents_travailleurs').insert(papiers.map(p => ({
        travailleur_id: trav.id, ...p, description: estPdf(p.fichier_url) ? 'pdf' : 'image',
      })))
      if (errPapiers) throw new Error("Les pièces n'ont pas été enregistrées. Réessaie.")
    }
    // Tant que l'ancien nom est sur la fiche : sinon ses anciennes paies se détacheraient.
    if (maj.nom) paiesReliees = await rattacherPaiesAvantRenommage(trav)
    if (Object.keys(maj).length) {
      const { error: errFiche } = await supabase.from('travailleurs').update(maj).eq('id', trav.id)
      if (errFiche) throw new Error("La fiche n'a pas été mise à jour. Réessaie.")
    }
  } catch (e) {
    // Remise dans l'état d'origine, au mieux : si elle échoue aussi, la demande reste acceptée à tort
    // (signalée dans le rapport, pas de rattrapage automatique ici).
    try {
      await supabase.from('demandes_travailleurs').update({
        statut: demande.statut, motif_refus: demande.motif_refus ?? null, traite_par: demande.traite_par ?? null,
        traite_par_nom: demande.traite_par_nom ?? null, traite_le: demande.traite_le ?? null, updated_at: maintenant(),
      }).eq('id', demande.id)
    } catch (_) {}
    throw e
  }
  notifier({
    type: 'fiche_trav_validee', titre: '✅ Fiche validée',
    message: `${nomFinal} : la fiche est à jour`, restaurant_id: trav.restaurant_id || null,
    cible_role: ['gerant'], screen: 'recrutement', params: { onglet: 'equipe' },
  })
  tracer('FICHE_TRAV_VALIDEE', {
    demande_id: demande.id, travailleur_id: trav.id, travailleur: nomFinal || nomComplet(demande),
    corrections, paies_rattachees: paiesReliees,
    ...(nomFinal !== trav.nom ? { nom_avant: trav.nom } : {}),
  }, ctx, trav.restaurant_id)
  return chargerTravailleur(trav.id)
}
```

- [ ] **Step 2 : `accepterDemande`**

Dans `lib/contratsSignesDb.js`, ajouter :

```js
import { champsCorriges } from './miseAJourFiches'
```

Remplacer la signature et le début du corps :

```js
export async function accepterDemande(demande, { salaire_journalier, reutiliserId = null }, ctx, corrections = []) {
  if (demande.type === 'mise_a_jour') {
    throw new Error('Cette demande est une mise à jour de fiche : ouvre-la depuis « À valider » après avoir rechargé l’application.')
  }
  if (corrections.length) {
    const { error } = await supabase.from('demandes_travailleurs')
      .update({ ...champsCorriges(demande), updated_at: maintenant() }).eq('id', demande.id)
    if (error) throw new Error("Les corrections n'ont pas été enregistrées. Réessaie.")
  }
```

Ajouter `corrections,` à l'objet de `tracer('DEMANDE_TRAV_ACCEPTEE', { … })`.

- [ ] **Step 3 : vérifier**

Run : `npm run lint 2>&1 | tail -5`
Attendu : 0 erreur. Vérifier qu'aucun cycle d'import n'apparaît : `grep -n "miseAJourFichesDb\|contratsSignesDb" lib/equipeDb.js lib/miseAJourFiches.js` ne doit rien afficher.

- [ ] **Step 4 : commit**

```bash
export DEVELOPER_DIR=/Library/Developer/CommandLineTools
git add lib/miseAJourFichesDb.js lib/contratsSignesDb.js
git commit -m "feat(embauches): acceptation avec corrections de la RH et reprise des refusées

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

---

### Task 4 : corriger dans les feuilles de validation

**Files :**
- Create : `components/contrats/ChampsCorrectionFiche.js`
- Modify : `components/contrats/FeuilleMiseAJourRH.js`, `components/contrats/FeuilleDemandeRH.js`, `app/embauches.js`

**Interfaces :**
- Consumes : `formulaireCorrection`, `demandeCorrigee`, `correctionsRH`, `correctionComplete` (Task 1) ; `accepterMiseAJour`, `accepterDemande` (Task 3).
- Produces : `<ChampsCorrectionFiche form setForm styles colors />`.

- [ ] **Step 1 : créer `components/contrats/ChampsCorrectionFiche.js`**

```jsx
// Champs que la RH peut corriger ou compléter sur une fiche envoyée par un gérant.
import { Text, View } from 'react-native'

import ChampDate from '../ChampDate'
import { Champ, Libelle, Puces } from '../ui/EcranModerne'
import { aujourdhuiISO } from '../../lib/contrats'
import { correctionComplete } from '../../lib/miseAJourFiches'
import { CIVILITES, SITUATIONS_FAMILLE } from '../../lib/recrutement'

export default function ChampsCorrectionFiche({ form, setForm, styles, colors }) {
  const maj = (cle, v) => setForm(p => ({ ...p, [cle]: v }))
  const texte = (cle, label, props = {}) => (
    <View key={cle}>
      <Libelle styles={styles}>{label}</Libelle>
      <Champ styles={styles} colors={colors} value={form[cle] || ''} onChangeText={v => maj(cle, v)} {...props} />
    </View>
  )
  const puces = (cle, label, elements) => (
    <View key={cle}>
      <Libelle styles={styles}>{label}</Libelle>
      {/* Toucher le choix actif l'efface. */}
      <Puces petit styles={styles} actif={form[cle] || null} onChoisir={v => maj(cle, form[cle] === v ? '' : v)}
        elements={elements.map(e => ({ cle: e, label: e }))} />
    </View>
  )
  return (
    <View style={{ marginTop: 8 }}>
      {puces('civilite', 'Civilité', CIVILITES)}
      {texte('nom_famille', 'Nom de famille *', { autoCapitalize: 'characters', placeholder: 'Ex. GBADIE' })}
      {texte('prenoms', 'Prénoms *', { placeholder: 'Ex. Gogre Tanguy' })}
      {!correctionComplete(form) && (
        <Text style={{ color: '#C2462B', fontWeight: '700', marginBottom: 8 }}>Le nom de famille et les prénoms sont obligatoires.</Text>
      )}
      <View style={{ marginBottom: 12 }}>
        <ChampDate label="Date de naissance" valeur={form.date_naissance || ''} onChange={v => maj('date_naissance', v)}
          maxDate={aujourdhuiISO()} naissance effacable />
      </View>
      {texte('lieu_naissance', 'Lieu de naissance', { placeholder: 'Ex. Yopougon' })}
      {texte('nationalite', 'Nationalité', { placeholder: 'Ex. Ivoirienne' })}
      {puces('situation_famille', 'Situation de famille', SITUATIONS_FAMILLE)}
      {texte('cni_numero', "N° de carte d'identité (CNI)", { autoCapitalize: 'characters', placeholder: 'Ex. CI007879705' })}
      {texte('nni_numero', 'NNI', { keyboardType: 'number-pad', placeholder: 'Ex. 11919240401' })}
      {texte('lieu_residence', 'Lieu de résidence', { placeholder: 'Ex. Yopougon' })}
      {texte('contact', 'Téléphone', { keyboardType: 'phone-pad', placeholder: 'Ex. 07 00 00 00 00' })}
      <View style={{ marginBottom: 12 }}>
        <ChampDate label="Date d'embauche" valeur={form.date_embauche || ''} onChange={v => maj('date_embauche', v)} effacable />
      </View>
    </View>
  )
}
```

- [ ] **Step 2 : `FeuilleMiseAJourRH`**

Remplacer les imports de la logique :

```js
import ChampsCorrectionFiche from './ChampsCorrectionFiche'
import {
  correctionComplete, correctionsRH, demandeCorrigee, diffFiche, formulaireCorrection, fusionFiche, manquantsFiche, typeContratPropose,
} from '../../lib/miseAJourFiches'
```

Ajouter les états et réinitialiser à l'ouverture :

```js
  const [depart, setDepart] = useState(null)
  const [form, setForm] = useState(null)

  useEffect(() => {
    if (!visible || !demande) return
    setTrav(null); setRefus(false); setMotif(''); setDepart(null); setForm(null)
    chargerTravailleur(demande.travailleur_id).then(setTrav).catch(e => Alert.alert('Fiche', e.message))
  }, [visible, demande])
```

Remplacer le calcul du diff (tout ce qui suit `if (!demande) return null` jusqu'à `encore`) :

```js
  if (!demande) return null
  const effective = form ? demandeCorrigee(demande, form) : demande
  const diff = trav ? diffFiche(trav, effective) : []
  const { maj, nouvellesPieces, nouveauxPapiers } = trav ? fusionFiche(trav, effective) : { maj: {}, nouvellesPieces: [], nouveauxPapiers: [] }
  const encore = trav ? manquantsFiche({ ...trav, ...maj }) : []
  const peutAccepter = !form || correctionComplete(form)

  function ouvrirCorrection() {
    const f = formulaireCorrection(trav, demande)
    setDepart(f)
    setForm(f)
  }
```

Dans `accepter`, remplacer l'appel :

```js
      const t = await accepterMiseAJour(effective, ctx, form ? correctionsRH(depart, form) : [])
```

Dans le rendu, juste avant `<Libelle styles={styles}>Ce qui change</Libelle>` :

```jsx
          {demande.statut === 'refusee' && demande.motif_refus
            ? <Info icone="❌" styles={styles} couleur="#C2462B">Refusée : {demande.motif_refus}</Info>
            : null}
```

Après le bloc `encore.length > 0`, avant `{occupe ? …` :

```jsx
          {form
            ? <ChampsCorrectionFiche form={form} setForm={setForm} styles={styles} colors={colors} />
            : (
              <View style={{ marginTop: 10 }}>
                <Bouton styles={styles} couleur={accent} label="✏️ Corriger / compléter" onPress={ouvrirCorrection} />
              </View>
            )}
```

Remplacer le bloc des deux boutons finaux :

```jsx
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
              {demande.statut === 'envoyee' && <Bouton flex styles={styles} couleur="#C2462B" label="❌ Refuser" onPress={() => setRefus(true)} />}
              <Bouton flex grand styles={styles} couleur="#3B8D2F" variante="plein" label="✅ Accepter" disabled={!peutAccepter} onPress={accepter} />
            </View>
```

- [ ] **Step 3 : `FeuilleDemandeRH`**

Ajouter les imports :

```js
import ChampsCorrectionFiche from './ChampsCorrectionFiche'
import { correctionComplete, correctionsRH, demandeCorrigee, formulaireCorrection } from '../../lib/miseAJourFiches'
```

Ajouter les états et compléter l'`useEffect` avec `setDepart(null); setForm(null)` :

```js
  const [depart, setDepart] = useState(null)
  const [form, setForm] = useState(null)
```

Remplacer les lignes qui suivent `if (!demande) return null` jusqu'à `const nom = …` :

```js
  const effective = form ? demandeCorrigee(demande, form) : demande
  const doublon = (effective.doublon_travailleur_id && (travailleursConnus || []).find(t => t.id === effective.doublon_travailleur_id))
    || trouverDoublon(effective, travailleursConnus)
  const { incomplets } = manquantsDemande(effective)
  const nom = nomComplet(effective)
  const peutAccepter = !form || correctionComplete(form)

  function ouvrirCorrection() {
    const f = formulaireCorrection(null, demande)
    setDepart(f)
    setForm(f)
  }
```

Dans `accepter`, remplacer l'appel :

```js
      const trav = await accepterDemande(effective, { salaire_journalier: salaire, reutiliserId: doublon && reutiliser ? doublon.id : null }, ctx, form ? correctionsRH(depart, form) : [])
```

Dans le rendu, remplacer tous les `ligne(...)` de la fiche par `effective.` au lieu de `demande.` (civilité, naissance, nationalité, téléphone, situation, CNI, NNI, résidence, date d'embauche), et ajouter juste après `{ligne("Date d'embauche", …)}` :

```jsx
      {form
        ? <ChampsCorrectionFiche form={form} setForm={setForm} styles={styles} colors={colors} />
        : (
          <View style={{ marginTop: 10 }}>
            <Bouton styles={styles} couleur={accent} label="✏️ Corriger / compléter" onPress={ouvrirCorrection} />
          </View>
        )}
```

Ajouter `disabled={!peutAccepter}` au bouton « ✅ Accepter ».

- [ ] **Step 4 : ouvrir les refusées dans `app/embauches.js`**

Remplacer dans `ouvrir` la première ligne :

```js
    if ((d.statut === 'envoyee' || d.statut === 'refusee') && estMaj(d)) { setMajOuverte(d); return }
```

Remplacer `cliquable` :

```js
    const cliquable = d.statut === 'envoyee' || (d.statut === 'refusee' && estMaj(d)) || (d.statut === 'acceptee' && d.travailleur_id)
```

Après la ligne `{d.statut === 'envoyee' && <Text …>Valider ›</Text>}` :

```jsx
          {d.statut === 'refusee' && estMaj(d) && <Text style={{ color: accent, fontWeight: '800' }}>Reprendre ›</Text>}
```

- [ ] **Step 5 : vérifier**

Run : `npm run lint 2>&1 | tail -5`
Attendu : 0 erreur.

Run : `npx expo export -p web 2>&1 | tail -3`
Attendu : export terminé sans erreur.

- [ ] **Step 6 : commit**

```bash
export DEVELOPER_DIR=/Library/Developer/CommandLineTools
git add components/contrats/ChampsCorrectionFiche.js components/contrats/FeuilleMiseAJourRH.js components/contrats/FeuilleDemandeRH.js app/embauches.js
git commit -m "feat(embauches): corriger ou compléter une fiche avant de l'accepter

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

---

### Task 5 : onglet « À compléter »

**Files :**
- Create : `components/contrats/OngletACompleter.js`
- Modify : `app/embauches.js`

**Interfaces :**
- Consumes : `fichesACompleter`, `comptesManquants` (Task 1) ; `ModalFormTravailleur` avec `ctx` (Task 2).
- Produces : `<OngletACompleter styles lignes comptes filtre onFiltre restoNom onOuvrir />`.

- [ ] **Step 1 : créer `components/contrats/OngletACompleter.js`**

```jsx
// Fiches incomplètes ou refusées : ce qu'il manque à chacun, un toucher pour le saisir.
import { Text, TouchableOpacity, View } from 'react-native'

import Avatar from '../equipe/Avatar'
import { Puces, Vide } from '../ui/EcranModerne'

export default function OngletACompleter({ styles, lignes, comptes, filtre, onFiltre, restoNom, onOuvrir }) {
  return (
    <>
      {comptes.length > 0 && (
        <Puces ligne petit styles={styles} actif={filtre} onChoisir={onFiltre} elements={[
          { cle: null, label: 'Toutes' },
          ...comptes.map(c => ({ cle: c.libelle, label: `${c.libelle} (${c.nombre})` })),
        ]} />
      )}
      {lignes.length === 0
        ? <Vide icone="✅" styles={styles} texte="Toutes ces fiches sont complètes." sous={null} />
        : lignes.map(({ trav, demande, manquants }) => (
          <TouchableOpacity key={trav.id} style={styles.carte} activeOpacity={0.8} onPress={() => onOuvrir(trav, demande)}>
            <View style={styles.carteTop}>
              <Avatar nom={trav.nom} photo={trav.photo_url} taille={44} />
              <View style={{ flex: 1 }}>
                <Text style={styles.carteTitre}>{trav.nom}</Text>
                <Text style={styles.carteSous}>{restoNom(trav.restaurant_id) || 'Sans restaurant'}{trav.poste ? ` · ${trav.poste}` : ''}</Text>
              </View>
            </View>
            {manquants.length > 0 && (
              <Text style={[styles.infoTxt, { flex: 0, marginTop: 6, color: '#C27C1A', fontWeight: '700' }]}>Manque : {manquants.join(', ')}</Text>
            )}
            {demande?.statut === 'envoyee' && (
              <Text style={[styles.infoTxt, { flex: 0, marginTop: 4 }]}>📋 Fiche envoyée par le gérant, à valider</Text>
            )}
            {demande?.statut === 'refusee' && (
              <Text style={[styles.infoTxt, { flex: 0, marginTop: 4, color: '#C2462B' }]}>❌ Refusée{demande.motif_refus ? ` : ${demande.motif_refus}` : ''}</Text>
            )}
          </TouchableOpacity>
        ))}
    </>
  )
}
```

- [ ] **Step 2 : brancher dans `app/embauches.js`**

Ajouter aux imports :

```js
import OngletACompleter from '../components/contrats/OngletACompleter'
import { ModalFormTravailleur } from '../components/equipe/Modales'
import { makeStyles } from '../components/equipe/styles'
import { comptesManquants, fichesACompleter, resumeCampagne } from '../lib/miseAJourFiches'
```

(la dernière ligne remplace l'import existant de `resumeCampagne`.)

Remplacer `const { styles, accent } = useEcranModerne('orange')` :

```js
  const { styles, colors, accent } = useEcranModerne('orange')
  const stylesEquipe = useMemo(() => makeStyles(colors), [colors])
```

Ajouter après les états existants :

```js
  const [filtreManque, setFiltreManque] = useState(null)
  const [ficheEdition, setFicheEdition] = useState(null)
```

Remplacer `const affichees = …` :

```js
  const hors = ['suivi', 'completer']
  const affichees = hors.includes(onglet) ? [] : demandes.filter(d => d.statut === ONGLETS[onglet] && dansResto(d))
```

Ajouter après le `useMemo` de `resume` :

```js
  const restaurantIdFiltre = filtreResto === 'tous' ? null : filtreResto
  const comptes = useMemo(
    () => comptesManquants(campagne.travailleurs, demandes, { restaurantId: restaurantIdFiltre }),
    [campagne, demandes, restaurantIdFiltre],
  )
  // Une donnée qui n'est plus manquante (fiche complétée, autre restaurant) ne garde pas le filtre.
  const manqueActif = comptes.some(c => c.libelle === filtreManque) ? filtreManque : null
  const aCompleter = useMemo(
    () => fichesACompleter(campagne.travailleurs, demandes, { restaurantId: restaurantIdFiltre, manque: manqueActif }),
    [campagne, demandes, restaurantIdFiltre, manqueActif],
  )

  function ouvrirACompleter(trav, demande) {
    if (demande) setMajOuverte(demande)
    else setFicheEdition(trav)
  }
```

Dans la liste des puces d'onglets, entre « Acceptées » et « Suivi » :

```js
        { cle: 'completer', label: `✏️ À compléter${aCompleter.length && !manqueActif ? ` (${aCompleter.length})` : ''}` },
```

Remplacer le contenu du `ScrollView` :

```jsx
          {onglet === 'suivi'
            ? <OngletSuiviCampagne styles={styles} accent={accent} resume={resume} onRelancer={relancer} onPrevenirTous={prevenirTous} total={resumeTous.total} envoiEnCours={envoiEnCours} />
            : onglet === 'completer'
              ? <OngletACompleter styles={styles} lignes={aCompleter} comptes={comptes} filtre={manqueActif} onFiltre={setFiltreManque} restoNom={restoNom} onOuvrir={ouvrirACompleter} />
              : affichees.length
                ? affichees.map(renderDemande)
                : <Vide icone={vides.icone} styles={styles} texte={vides.texte} sous={vides.sous} />}
```

Ajouter après `<FeuilleMiseAJourRH … />` :

```jsx
      <ModalFormTravailleur
        visible={!!ficheEdition} edition={ficheEdition} restaurants={restaurants} restoParDefaut={null}
        styles={stylesEquipe} colors={colors} ctx={ctx}
        onFermer={() => setFicheEdition(null)}
        onEnregistre={async () => { setFicheEdition(null); await charger() }}
      />
```

- [ ] **Step 3 : vérifier**

`Puces` compare `actif === e.cle` : `null === null` sélectionne bien « Toutes ».

Run : `npm run lint 2>&1 | tail -5`
Attendu : 0 erreur.

Run : `for f in lib/*.test.mjs; do node "$f" 2>&1 | grep -E "^# fail|^ℹ fail" ; done | sort | uniq -c`
Attendu : uniquement des lignes `fail 0`.

Run : `npx expo export -p web 2>&1 | tail -3`
Attendu : export terminé sans erreur.

- [ ] **Step 4 : commit**

```bash
export DEVELOPER_DIR=/Library/Developer/CommandLineTools
git add components/contrats/OngletACompleter.js app/embauches.js
git commit -m "feat(embauches): onglet À compléter avec ce qui manque à chaque travailleur

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

---

### Task 6 : contrôle final

**Files :** aucun fichier de code ; `graphify-out/` seulement si le dépôt le suit déjà.

- [ ] **Step 1 : mettre à jour le graphe**

Run : `graphify update .`

- [ ] **Step 2 : relire les écarts avec la conception**

Vérifier point par point la section 1 à 4 de la conception. Corriger tout écart et le commiter.

- [ ] **Step 3 : contrôle de lecture en base (aucune écriture)**

```sql
select count(*) from depenses where categorie = 'Paie' and saisi_par = 'gerant' and travailleur_id is null;
```

Attendu : le résultat reste cohérent avec le constat (98 ou moins), aucun test n'a écrit en production.

- [ ] **Step 4 : signaler sans publier**

Rapporter à l'utilisateur : ce qui est fait, résultats des contrôles, travail non commité restant dans `Modales.js`, et la vérification à faire côté Windows sur `externe_id`. Ne pas publier sans son accord explicite.
