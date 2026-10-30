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
  champsAEnvoyer, ficheVersFormulaire, formulaireCorrection, fusionFiche, listeEquipe, manquantsFiche, nbACompleter, proposerNomPrenoms,
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

describe('champsAEnvoyer / formulaireCorrection', () => {
  const trav = { ...complete, contact: '0102030405', lieu_residence: 'Yopougon', piece_identite_urls: ['a.jpg'] }
  test('champ identique vidé, obligatoires conservés, champ modifié conservé', () => {
    const f = { ...ficheVersFormulaire(trav), contact: '0707070707', piece_identite_urls: ['a.jpg', 'b.jpg'], papiers_urls: ['c.pdf'] }
    const e = champsAEnvoyer(trav, f)
    assert.equal(e.lieu_residence, '')
    assert.equal(e.contact, '0707070707')
    assert.equal(e.photo_url, trav.photo_url)
    assert.equal(e.nom_famille, trav.nom_famille)
    assert.equal(e.prenoms, trav.prenoms)
    assert.deepEqual(e.piece_identite_urls, ['a.jpg', 'b.jpg'])
    assert.deepEqual(e.papiers_urls, ['c.pdf'])
  })
  test('correction : la fiche a changé depuis l’envoi, la demande n’a pas ce champ', () => {
    const demande = { civilite: '', contact: '', lieu_residence: 'Abobo', piece_identite_urls: ['a.jpg', 'b.jpg'], papiers_urls: ['c.pdf'] }
    const tNouveau = { ...trav, contact: '0999999999' }
    const f = formulaireCorrection(tNouveau, demande)
    assert.equal(f.contact, '0999999999')
    assert.equal(f.lieu_residence, 'Abobo')
    assert.deepEqual(f.piece_identite_urls, ['a.jpg', 'b.jpg'])
    assert.deepEqual(f.papiers_urls, ['c.pdf'])
  })
})
