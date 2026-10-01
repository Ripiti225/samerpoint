// ──────────────────────────────────────────────────────────────────────────────
// Trésorerie — accès Supabase. La logique de calcul est dans lib/tresorerie.js.
//
// Toutes les lectures passent par `toutesLesLignes` : Supabase coupe en silence
// à 1 000 lignes, et les mouvements de banque dépasseront vite ce nombre.
// Les écritures journalisent sans jamais bloquer l'action.
// ──────────────────────────────────────────────────────────────────────────────
import { journaliser } from './journal'
import { supabase } from './supabase'
import { aujourdhuiISO, moisLoyersACreer, premierDuMois } from './tresorerie'

const PAGE = 1000

async function toutesLesLignes(construire) {
  const lignes = []
  for (let debut = 0; ; debut += PAGE) {
    const { data, error } = await construire().range(debut, debut + PAGE - 1)
    if (error) throw error
    lignes.push(...(data || []))
    if (!data || data.length < PAGE) break
  }
  return lignes
}

// Message lisible quand la migration n'a pas été passée.
function verifierTable(error) {
  const msg = error?.message || ''
  if (/tresorerie_\w+/.test(msg) && /(does not exist|schema cache|Could not find)/i.test(msg)) {
    const e = new Error("L'onglet Trésorerie n'est pas encore installé dans la base : il faut passer le fichier supabase_tresorerie.sql dans Supabase.")
    e.migrationManquante = true
    return e
  }
  return error
}

export async function chargerDroits() {
  const { data, error } = await supabase.from('tresorerie_droits').select('*').order('user_nom')
  if (error) throw verifierTable(error)
  return data || []
}

// Charge tout ce dont l'onglet a besoin, et crée au passage les loyers des mois
// écoulés qui n'existent pas encore.
export async function chargerTresorerie({ creerLoyers = false, user = {} } = {}) {
  try {
    const [comptes, mouvements, loyers, restaurants, fournisseurs] = await Promise.all([
      toutesLesLignes(() => supabase.from('tresorerie_comptes').select('*').eq('actif', true).order('ordre').order('id')),
      toutesLesLignes(() => supabase.from('tresorerie_mouvements').select('*').order('date', { ascending: false }).order('id')),
      toutesLesLignes(() => supabase.from('tresorerie_loyers').select('*').order('restaurant_id')),
      toutesLesLignes(() => supabase.from('restaurants').select('id, nom').order('nom').order('id')),
      toutesLesLignes(() => supabase.from('fournisseurs').select('id, credit_actuel, actif').order('id')),
    ])

    let dus = await toutesLesLignes(() => supabase.from('tresorerie_dus').select('*').order('created_at').order('id'))

    if (creerLoyers) {
      const aCreer = moisLoyersACreer(loyers, dus, premierDuMois(aujourdhuiISO()))
      if (aCreer.length) {
        const { error } = await supabase.from('tresorerie_dus')
          .upsert(aCreer.map(d => ({ ...d, cree_par: user.userId || null, cree_par_nom: 'Automatique (loyer)' })),
            { onConflict: 'categorie,restaurant_id,mois', ignoreDuplicates: true })
        if (error) console.warn('[tresorerie] création des loyers', error.message)
        dus = await toutesLesLignes(() => supabase.from('tresorerie_dus').select('*').order('created_at').order('id'))
      }
    }

    const paiements = await toutesLesLignes(() => supabase.from('tresorerie_paiements').select('*').order('date').order('id'))

    const mvtsParCompte = {}
    mouvements.forEach(m => { (mvtsParCompte[m.compte_id] ||= []).push(m) })

    return {
      comptes: comptes.map(c => ({ ...c, mouvements: mvtsParCompte[c.id] || [] })),
      mouvements,
      loyers,
      restaurants,
      fournisseurs,
      dus,
      paiements,
    }
  } catch (e) {
    throw verifierTable(e)
  }
}

function contexte(user) {
  return { userId: user?.userId, userNom: user?.userNom }
}

// ── Banque ───────────────────────────────────────────────────────────────────

export async function ajouterMouvement({ compteId, date, montant, type, libelle, photoUrl }, user) {
  const { error } = await supabase.from('tresorerie_mouvements').insert({
    compte_id: compteId, date, montant, type, libelle: libelle || null, photo_url: photoUrl || null,
    cree_par: user?.userId || null, cree_par_nom: user?.userNom || null,
  })
  if (error) throw verifierTable(error)
  journaliser(`tresorerie_${type}`, { compte_id: compteId, montant, libelle, date }, contexte(user))
}

export async function supprimerMouvement(mouvement, user) {
  const { error } = await supabase.from('tresorerie_mouvements').delete().eq('id', mouvement.id)
  if (error) throw verifierTable(error)
  journaliser('tresorerie_mouvement_supprime', {
    compte_id: mouvement.compte_id, montant: mouvement.montant, type: mouvement.type,
    libelle: mouvement.libelle, date: mouvement.date,
  }, contexte(user))
}

// ── Dus ──────────────────────────────────────────────────────────────────────

export async function enregistrerDu(du, user) {
  const ligne = {
    categorie: du.categorie,
    restaurant_id: du.restaurant_id || null,
    mois: du.mois || null,
    libelle: du.libelle || null,
    creancier: du.creancier || null,
    montant_du: du.montant_du,
    echeance: du.echeance || null,
    note: du.note || null,
  }
  let error
  if (du.id) {
    ({ error } = await supabase.from('tresorerie_dus').update(ligne).eq('id', du.id))
  } else {
    ({ error } = await supabase.from('tresorerie_dus').insert({
      ...ligne, cree_par: user?.userId || null, cree_par_nom: user?.userNom || null,
    }))
  }
  if (error) {
    if (error.code === '23505') {
      throw new Error('Il existe déjà une ligne pour ce restaurant et ce mois. Modifiez-la plutôt que d\'en créer une deuxième.')
    }
    throw verifierTable(error)
  }
  journaliser(du.id ? 'tresorerie_du_modifie' : 'tresorerie_du_ajoute', ligne, {
    ...contexte(user), restaurantId: ligne.restaurant_id,
  })
}

export async function supprimerDu(du, user) {
  const { data: paies } = await supabase.from('tresorerie_paiements').select('groupe').eq('du_id', du.id)
  // Les sorties de banque liées partent avec les paiements.
  for (const g of [...new Set((paies || []).map(p => p.groupe))]) {
    const { error } = await supabase.rpc('tresorerie_annuler_paiement', { p_groupe: g })
    if (error) throw verifierTable(error)
  }
  const { error } = await supabase.from('tresorerie_dus').delete().eq('id', du.id)
  if (error) throw verifierTable(error)
  journaliser('tresorerie_du_supprime', {
    categorie: du.categorie, mois: du.mois, montant_du: du.montant_du,
    libelle: du.libelle, creancier: du.creancier,
  }, { ...contexte(user), restaurantId: du.restaurant_id })
}

export async function chargerDusLoyer(restaurantId, mois) {
  const { data, error } = await supabase.from('tresorerie_dus').select('*')
    .eq('categorie', 'loyer').eq('restaurant_id', restaurantId).in('mois', mois)
  if (error) throw verifierTable(error)
  return data || []
}

// ── Paiements ────────────────────────────────────────────────────────────────

// parts : [{ du_id, montant }] — déjà réparties (voir repartirPaiement).
export async function payer({ parts, source, compteId, date, libelle, photoUrl }, user) {
  const { error } = await supabase.rpc('tresorerie_payer', {
    p_parts: parts,
    p_source: source,
    p_compte_id: source === 'compte' ? compteId : null,
    p_date: date,
    p_libelle: libelle || null,
    p_photo_url: photoUrl || null,
    p_user_id: user?.userId || null,
    p_user_nom: user?.userNom || null,
  })
  if (error) throw verifierTable(error)
  journaliser('tresorerie_paiement', { parts, source, compte_id: compteId, date, libelle }, contexte(user))
}

export async function annulerPaiement(groupe, details, user) {
  const { error } = await supabase.rpc('tresorerie_annuler_paiement', { p_groupe: groupe })
  if (error) throw verifierTable(error)
  journaliser('tresorerie_paiement_annule', { groupe, ...details }, contexte(user))
}

// ── Loyers ───────────────────────────────────────────────────────────────────

export async function enregistrerLoyer({ restaurantId, montant, jourEcheance, moisDepart, actif }, user) {
  const { error } = await supabase.from('tresorerie_loyers').upsert({
    restaurant_id: restaurantId, montant, jour_echeance: jourEcheance, mois_depart: moisDepart,
    actif, updated_at: new Date().toISOString(),
  }, { onConflict: 'restaurant_id' })
  if (error) throw verifierTable(error)
  journaliser('tresorerie_loyer_regle', { montant, jour_echeance: jourEcheance, mois_depart: moisDepart, actif }, {
    ...contexte(user), restaurantId,
  })
}

// ── Droits ───────────────────────────────────────────────────────────────────

export async function enregistrerDroit({ userIdCible, userNomCible, niveau }, user) {
  const { error } = await supabase.from('tresorerie_droits').upsert({
    user_id: userIdCible, user_nom: userNomCible, niveau, updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' })
  if (error) throw verifierTable(error)
  journaliser('tresorerie_droit', { user_id: userIdCible, user_nom: userNomCible, niveau }, contexte(user))
}

export async function retirerDroit(ligne, user) {
  const { error } = await supabase.from('tresorerie_droits').delete().eq('user_id', ligne.user_id)
  if (error) throw verifierTable(error)
  journaliser('tresorerie_droit_retire', { user_id: ligne.user_id, user_nom: ligne.user_nom }, contexte(user))
}

export async function chargerUtilisateursAdmin() {
  const { data, error } = await supabase.from('utilisateurs')
    .select('id, nom, role')
    .in('role', ['manager', 'directeur', 'rh'])
    .order('nom')
  if (error) throw error
  return data || []
}
