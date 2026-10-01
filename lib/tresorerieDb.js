// ──────────────────────────────────────────────────────────────────────────────
// Trésorerie — accès Supabase. La logique de calcul est dans lib/tresorerie.js.
//
// Toutes les lectures passent par `toutesLesLignes` : Supabase coupe en silence
// à 1 000 lignes, et les mouvements de banque dépasseront vite ce nombre.
// Les écritures journalisent sans jamais bloquer l'action.
// ──────────────────────────────────────────────────────────────────────────────
import { journaliser } from './journal'
import { chargerChargesMois } from './chargesMois'
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

// ── Partenaires à recevoir (étape 2) ────────────────────────────────────────

// Charge réglages, codes, imports, lignes et les points utiles à l'estimé.
// Rend null si la migration de l'étape 2 n'est pas encore passée.
export async function chargerPartenaires() {
  const { data: reglagesBruts, error } = await supabase.from('tresorerie_partenaires').select('*')
  if (error) {
    const e = verifierTable(error)
    if (e.migrationManquante || /tresorerie_partenaires/.test(error.message || '')) return null
    throw e
  }
  const reglages = Object.fromEntries((reglagesBruts || []).map(r => [r.partenaire, r]))

  const departs = Object.values(reglages).map(r => r.date_depart).filter(Boolean).sort()
  const dateMin = departs[0] || null

  const [alias, imports, lignes, points] = await Promise.all([
    toutesLesLignes(() => supabase.from('tresorerie_alias').select('*').order('code')),
    toutesLesLignes(() => supabase.from('tresorerie_partenaire_imports').select('*').order('periode_debut', { ascending: false }).order('id')),
    toutesLesLignes(() => supabase.from('tresorerie_partenaire_lignes').select('*').order('created_at').order('id')),
    dateMin
      ? toutesLesLignes(() => supabase.from('points')
        .select('id, restaurant_id, date, yango_tab, glovo_tab, wave, om, djamo')
        .gte('date', dateMin).order('date').order('id'))
      : Promise.resolve([]),
  ])
  return { reglages, alias, imports, lignes, points }
}

export async function enregistrerReglagePartenaire({ partenaire, dateDepart, modeVersement }, user) {
  const { error } = await supabase.from('tresorerie_partenaires').upsert({
    partenaire, date_depart: dateDepart || null, mode_versement: modeVersement,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'partenaire' })
  if (error) throw verifierTable(error)
  journaliser('tresorerie_partenaire_regle', { partenaire, date_depart: dateDepart, mode_versement: modeVersement }, contexte(user))
}

export async function enregistrerAlias(codes, user) {
  const lignes = Object.entries(codes).map(([code, restaurant_id]) => ({ code, restaurant_id, updated_at: new Date().toISOString() }))
  if (!lignes.length) return
  const { error } = await supabase.from('tresorerie_alias').upsert(lignes, { onConflict: 'code' })
  if (error) throw verifierTable(error)
  journaliser('tresorerie_alias', { codes }, contexte(user))
}

// lignes : [{ restaurant_id, montant, brut }]
export async function importerExport({ partenaire, periode, fichier, details, lignes }, user) {
  const { error } = await supabase.rpc('tresorerie_importer', {
    p_partenaire: partenaire, p_debut: periode.debut, p_fin: periode.fin, p_fichier: fichier || null,
    p_details: details || {}, p_lignes: lignes, p_user_id: user?.userId || null, p_user_nom: user?.userNom || null,
  })
  if (error) throw verifierTable(error)
  journaliser('tresorerie_export_importe', {
    partenaire, periode_debut: periode.debut, fichier,
    total: lignes.reduce((s, l) => s + Number(l.montant || 0), 0),
  }, contexte(user))
}

export async function supprimerImport(imp, user) {
  const { error } = await supabase.from('tresorerie_partenaire_imports').delete().eq('id', imp.id)
  if (error) throw verifierTable(error)
  journaliser('tresorerie_export_supprime', { partenaire: imp.partenaire, periode_debut: imp.periode_debut }, contexte(user))
}

export async function ajouterPub({ partenaire, periodeDebut, restaurantId, montant, note, photoUrl }, user) {
  const { error } = await supabase.from('tresorerie_partenaire_lignes').insert({
    partenaire, periode_debut: periodeDebut, restaurant_id: restaurantId, type: 'pub', montant,
    note: note || null, photo_url: photoUrl || null,
    cree_par: user?.userId || null, cree_par_nom: user?.userNom || null,
  })
  if (error) throw verifierTable(error)
  journaliser('tresorerie_pub', { partenaire, periode_debut: periodeDebut, montant }, { ...contexte(user), restaurantId })
}

export async function supprimerLignePub(ligne, user) {
  const { error } = await supabase.from('tresorerie_partenaire_lignes').delete().eq('id', ligne.id).eq('type', 'pub')
  if (error) throw verifierTable(error)
  journaliser('tresorerie_pub_supprimee', { partenaire: ligne.partenaire, periode_debut: ligne.periode_debut, montant: ligne.montant }, {
    ...contexte(user), restaurantId: ligne.restaurant_id,
  })
}

export async function recevoir({ partenaire, periodeDebut, restaurantId, montant, compteId, date, libelle, note, photoUrl }, user) {
  const { error } = await supabase.rpc('tresorerie_recevoir', {
    p_partenaire: partenaire, p_debut: periodeDebut, p_restaurant_id: restaurantId || null,
    p_montant: montant, p_compte_id: compteId, p_date: date, p_libelle: libelle || null,
    p_note: note || null, p_photo_url: photoUrl || null,
    p_user_id: user?.userId || null, p_user_nom: user?.userNom || null,
  })
  if (error) throw verifierTable(error)
  journaliser('tresorerie_partenaire_recu', { partenaire, periode_debut: periodeDebut, montant, compte_id: compteId, date }, {
    ...contexte(user), restaurantId,
  })
}

export async function annulerReception(ligne, user) {
  const { error } = await supabase.rpc('tresorerie_annuler_reception', { p_ligne: ligne.id })
  if (error) throw verifierTable(error)
  journaliser('tresorerie_partenaire_recu_annule', { partenaire: ligne.partenaire, periode_debut: ligne.periode_debut, montant: ligne.montant }, {
    ...contexte(user), restaurantId: ligne.restaurant_id,
  })
}

// ── Coffre et dépenses direction (étape 3) ──────────────────────────────────

// Rend null si la migration de l'étape 3 n'est pas encore passée.
export async function chargerDirection() {
  const { error } = await supabase.from('tresorerie_coffre_objectifs').select('mois').limit(1)
  if (error) {
    const e = verifierTable(error)
    if (e.migrationManquante) return null
    throw e
  }
  const [coffre, objectifs, depenses] = await Promise.all([
    toutesLesLignes(() => supabase.from('tresorerie_coffre_mouvements').select('*').order('date', { ascending: false }).order('id')),
    toutesLesLignes(() => supabase.from('tresorerie_coffre_objectifs').select('*').order('mois')),
    toutesLesLignes(() => supabase.from('tresorerie_depenses_direction').select('*').order('date', { ascending: false }).order('id')),
  ])
  return { coffre, objectifs, depenses }
}

export async function operationCoffre({ type, montant, source, compteId, date, libelle }, user) {
  const { error } = await supabase.rpc('tresorerie_coffre_operation', {
    p_type: type, p_montant: montant, p_source: source, p_compte_id: source === 'compte' ? compteId : null,
    p_date: date, p_libelle: libelle || null, p_user_id: user?.userId || null, p_user_nom: user?.userNom || null,
  })
  if (error) throw verifierTable(error)
  journaliser(`tresorerie_coffre_${type}`, { montant, source, compte_id: compteId, date }, contexte(user))
}

export async function annulerOperationCoffre(m, user) {
  const { error } = await supabase.rpc('tresorerie_coffre_annuler', { p_id: m.id })
  if (error) throw verifierTable(error)
  journaliser('tresorerie_coffre_annule', { type: m.type, montant: m.montant, date: m.date }, contexte(user))
}

export async function definirObjectifCoffre({ mois, montant }, user) {
  const { error } = await supabase.from('tresorerie_coffre_objectifs').upsert({
    mois, montant, updated_at: new Date().toISOString(),
  }, { onConflict: 'mois' })
  if (error) throw verifierTable(error)
  journaliser('tresorerie_coffre_objectif', { mois, montant }, contexte(user))
}

export async function ajouterDepenseDirection(d, user) {
  const { error } = await supabase.rpc('tresorerie_depense_direction', {
    p_date: d.date, p_categorie: d.categorie, p_restaurant_id: d.restaurantId || null, p_montant: d.montant,
    p_source: d.source, p_compte_id: d.source === 'compte' ? d.compteId : null, p_libelle: d.libelle || null,
    p_note: d.note || null, p_photo_url: d.photoUrl || null,
    p_user_id: user?.userId || null, p_user_nom: user?.userNom || null,
  })
  if (error) throw verifierTable(error)
  journaliser('tresorerie_depense_direction', {
    categorie: d.categorie, montant: d.montant, source: d.source, date: d.date, note: d.note,
  }, { ...contexte(user), restaurantId: d.restaurantId })
}

export async function supprimerDepenseDirection(d, user) {
  const { error } = await supabase.rpc('tresorerie_depense_direction_supprimer', { p_id: d.id })
  if (error) throw verifierTable(error)
  journaliser('tresorerie_depense_direction_supprimee', {
    categorie: d.categorie, montant: d.montant, date: d.date,
  }, { ...contexte(user), restaurantId: d.restaurant_id })
}

const PAQUET = 150

// Données du résultat net sur une plage de mois (AAAA-MM).
export async function chargerResultats(mois) {
  const debut = `${mois[0]}-01`
  const dernier = mois[mois.length - 1]
  const [a, m] = dernier.split('-').map(Number)
  const fin = `${dernier}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, '0')}`

  const points = await toutesLesLignes(() => supabase.from('points')
    .select('id, restaurant_id, date, yango_tab, glovo_tab, depenses_gerant_caisse_total')
    .eq('valide', true).gte('date', debut).lte('date', fin).order('date').order('id'))

  const shifts = []
  const ids = points.map(p => p.id)
  for (let i = 0; i < ids.length; i += PAQUET) {
    const paquet = ids.slice(i, i + PAQUET)
    shifts.push(...await toutesLesLignes(() => supabase.from('points_shifts')
      .select('id, point_id, om, wave, djamo, espece').in('point_id', paquet).order('id')))
  }

  // Dépenses direction et pubs : vides tant que les migrations des étapes 2 et 3
  // ne sont pas passées (le résultat reste juste, il n'a simplement rien à déduire).
  const [charges, depenses, pubs] = await Promise.all([
    chargerChargesMois(supabase, mois),
    toutesLesLignes(() => supabase.from('tresorerie_depenses_direction').select('*').gte('date', debut).lte('date', fin).order('id'))
      .catch(() => []),
    toutesLesLignes(() => supabase.from('tresorerie_partenaire_lignes').select('*').eq('type', 'pub')
      .gte('periode_debut', debut).lte('periode_debut', fin).order('id'))
      .catch(() => []),
  ])
  return { points, shifts, charges, depenses, pubs }
}
