import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { groupePoste, personnesParGroupe, estChoisi, detailApresChoix } from './responsablesLitige.js'

describe('groupePoste', () => {
  test('postes réels de la base', () => {
    assert.equal(groupePoste('Caissière '), 'Caisse')
    assert.equal(groupePoste('caissier'), 'Caisse')
    assert.equal(groupePoste('Gérant / manager général '), 'Gérance')
    assert.equal(groupePoste('gerant'), 'Gérance')
    assert.equal(groupePoste('Pizzaïo'), 'Cuisine')
    assert.equal(groupePoste('Aide cuisinière '), 'Cuisine')
    assert.equal(groupePoste('Chef cuisinier'), 'Cuisine')
    assert.equal(groupePoste('Comptoiriste'), 'Service')
    assert.equal(groupePoste('Serveur/se'), 'Service')
    assert.equal(groupePoste('Technicien de surface '), 'Autres')
  })
})

describe('personnesParGroupe', () => {
  const comptes = [{ id: 'u1', nom: 'Koffi Akissi Océane', role: 'caissier' }, { id: 'u2', nom: 'Moussa', role: 'gerant' }]
  const equipe = [
    { id: 't1', nom: 'KOFFI AKISSI OCEANE', poste: 'Caissière ' },
    { id: 't2', nom: 'Awa', poste: 'Cuisinier' },
    { id: 't3', nom: 'Bamba', poste: 'Pizzaïo' },
    { id: 't4', nom: 'Jean', poste: 'Serveur/se' },
  ]
  test('comptes + équipe, sans doublon, rangés par poste', () => {
    const g = personnesParGroupe(comptes, equipe)
    assert.deepEqual(g.map(x => x.groupe), ['Caisse', 'Gérance', 'Cuisine', 'Service'])
    assert.deepEqual(g[0].personnes.map(p => [p.id, p.nom]), [['u1', 'Koffi Akissi Océane']])
    assert.deepEqual(g[2].personnes.map(p => [p.id, p.nom]), [[null, 'Awa'], [null, 'Bamba']])
  })
  test('prénom et nom inversés : une seule fois, avec le compte', () => {
    const g = personnesParGroupe([{ id: 'u9', nom: 'Noe Kouassi', role: 'gerant' }], [{ id: 't9', nom: 'KOUASSI NOE', poste: 'Gérant' }])
    assert.deepEqual(g.flatMap(x => x.personnes.map(p => [p.id, p.nom])), [['u9', 'Noe Kouassi']])
  })
  test('recherche sans accent ni majuscule', () => {
    const g = personnesParGroupe(comptes, equipe, 'oceane')
    assert.deepEqual(g.flatMap(x => x.personnes.map(p => p.nom)), ['Koffi Akissi Océane'])
  })
})

describe('estChoisi', () => {
  test('compte : par id ; travailleur : par nom', () => {
    assert.equal(estChoisi({ id: 'u1', nom: 'X' }, 'u1', 'X'), true)
    assert.equal(estChoisi({ id: 'u1', nom: 'X' }, 'u2', 'X'), false)
    assert.equal(estChoisi({ id: null, nom: 'Awa' }, null, 'AWA'), true)
    assert.equal(estChoisi({ id: null, nom: 'Awa' }, null, ''), false)
  })
})

describe('detailApresChoix', () => {
  const auto = { origine: 'auto', responsable_id: 'u1', responsable_nom: 'Koffi', detail: { lignes: [1] } }
  test('litige auto, responsable changé : marqué « à la main »', () => {
    assert.deepEqual(detailApresChoix(auto, null, 'Awa'), { lignes: [1], responsable_manuel: true })
  })
  test('responsable inchangé ou litige saisi à la main : on ne touche pas au detail', () => {
    assert.equal(detailApresChoix(auto, 'u1', 'Koffi'), undefined)
    assert.equal(detailApresChoix({ ...auto, origine: null }, null, 'Awa'), undefined)
  })
})
