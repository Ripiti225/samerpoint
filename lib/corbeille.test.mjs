import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

let estTableCorbeilleManquante
try {
  ({ estTableCorbeilleManquante } = await import('./erreursCorbeille.js'))
} catch {
  // Le premier passage TDD doit échouer par assertion tant que le classifieur
  // précis n'existe pas encore.
}

describe('estTableCorbeilleManquante — distinguer migration et refus RLS', () => {
  test('reconnaît une table réellement absente du cache PostgREST', () => {
    assert.equal(typeof estTableCorbeilleManquante, 'function')
    assert.equal(estTableCorbeilleManquante({
      code: 'PGRST205',
      message: "Could not find the table 'public.suppressions_archive' in the schema cache",
    }), true)
  })

  test('reconnaît le code PostgreSQL relation inexistante', () => {
    assert.equal(typeof estTableCorbeilleManquante, 'function')
    assert.equal(estTableCorbeilleManquante({
      code: '42P01',
      message: 'relation "suppressions_archive" does not exist',
    }), true)
  })

  test('ne présente pas un refus RLS comme une migration absente', () => {
    assert.equal(typeof estTableCorbeilleManquante, 'function')
    assert.equal(estTableCorbeilleManquante({
      code: '42501',
      message: 'new row violates row-level security policy for table "suppressions_archive"',
    }), false)
  })

  test('ne présente pas une erreur de contrainte comme une migration absente', () => {
    assert.equal(typeof estTableCorbeilleManquante, 'function')
    assert.equal(estTableCorbeilleManquante({
      code: '23503',
      message: 'insert or update on table "suppressions_archive" violates foreign key constraint',
    }), false)
  })
})
