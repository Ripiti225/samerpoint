// ──────────────────────────────────────────────────────────────────────────────
// Trésorerie — accès Supabase. La logique de calcul est dans lib/tresorerie.js.
//
// Toutes les lectures passent par `toutesLesLignes` : Supabase coupe en silence
// à 1 000 lignes, et les mouvements de banque dépasseront vite ce nombre.
// Les écritures journalisent sans jamais bloquer l'action.
// ──────────────────────────────────────────────────────────────────────────────
import { journaliser } from './journal'
import { envoyerNotifReceptionPartenaire } from './notifications'
import { etatPrevision, nomPartenaire } from './previsions'
import { nomLigne } from './rappelsTresorerie'
import { chargerChargesResultat } from './chargesMois'
import { supabase } from './supabase'
import { aujourdhuiISO, chargesFixesACreer, fmt, moisLoyersACreer, premierDuMois } from './tresorerie'

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
    const e = new Error("Cette partie de la Trésorerie n'est pas encore installée dans la base : il faut passer les fichiers supabase_tresorerie*.sql dans Supabase.")
    e.migrationManquante = true
    return e
  }
  return error
}

// Réglages de l'étape 1 (jours limites, montants fixes) : vides tant que
// supabase_tresorerie_charges.sql n'est pas passé, sans bloquer l'écran.
async function lireReglage(table, ordre) {
  const { data, error } = await supabase.from(table).select('*').order(ordre).range(0, 999)
  return error ? [] : (data || [])
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
    const [comptes, mouvements, loyers, restaurants, fournisseurs, echeances, chargesFixes, previsions, receptions] = await Promise.all([
      toutesLesLignes(() => supabase.from('tresorerie_comptes').select('*').eq('actif', true).order('ordre').order('id')),
      toutesLesLignes(() => supabase.from('tresorerie_mouvements').select('*').order('date', { ascending: false }).order('id')),
      toutesLesLignes(() => supabase.from('tresorerie_loyers').select('*').order('restaurant_id')),
      toutesLesLignes(() => supabase.from('restaurants').select('id, nom').order('nom').order('id')),
      toutesLesLignes(() => supabase.from('fournisseurs').select('id, credit_actuel, actif').order('id')),
      lireReglage('tresorerie_echeances', 'categorie'),
      lireReglage('tresorerie_charges_fixes', 'restaurant_id'),
      // Prévisions (étape 4) : vides tant que supabase_tresorerie_previsions.sql n'est pas passé.
      toutesLesLignes(() => supabase.from('tresorerie_previsions').select('*').order('created_at').order('id'))
        .catch(() => []),
      // Réceptions partenaires : déclencheur « à la prochaine réception ».
      toutesLesLignes(() => supabase.from('tresorerie_partenaire_lignes').select('id, partenaire, type, date, created_at')
        .eq('type', 'recu').order('created_at', { ascending: false }).order('id'))
        .catch(() => []),
    ])

    let dus = await toutesLesLignes(() => supabase.from('tresorerie_dus').select('*').order('created_at').order('id'))

    if (creerLoyers) {
      const mc = premierDuMois(aujourdhuiISO())
      const aCreer = [...moisLoyersACreer(loyers, dus, mc), ...chargesFixesACreer(chargesFixes, echeances, dus, mc)]
      if (aCreer.length) {
        // insert et pas upsert : l'index unique des mois est partiel, PostgREST
        // ne sait pas cibler son ON CONFLICT (l'upsert échouait à chaque fois).
        // Les mois existants sont déjà écartés par moisLoyersACreer / chargesFixesACreer.
        const { error } = await supabase.from('tresorerie_dus')
          .insert(aCreer.map(d => ({ ...d, cree_par: user.userId || null, cree_par_nom: 'Automatique' })))
        if (error) console.warn('[tresorerie] création automatique des charges', error.message)
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
      echeances,
      chargesFixes,
      previsions,
      receptions,
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

// Entrée d'espèces venant d'un restaurant (saisie à la main).
export async function entreeEspeces({ compteId, montant, date, restaurantId, restaurantNom, note, photoUrl }, user) {
  const { error } = await supabase.from('tresorerie_mouvements').insert({
    compte_id: compteId, date, montant, type: 'especes', restaurant_id: restaurantId || null,
    libelle: `Espèces · ${restaurantNom || 'restaurant'}${note ? ` · ${note}` : ''}`, photo_url: photoUrl || null,
    cree_par: user?.userId || null, cree_par_nom: user?.userNom || null,
  })
  if (error) throw verifierTable(error)
  journaliser('tresorerie_entree_especes', { compte_id: compteId, montant, date, note }, { ...contexte(user), restaurantId })
}

// Prêt reçu en espèces : l'entrée et la dette du prêteur, ensemble.
export async function entreePret({ compteId, montant, date, creancier, note }, user) {
  const { error } = await supabase.rpc('tresorerie_entree_pret', {
    p_compte_id: compteId, p_montant: montant, p_date: date, p_creancier: creancier, p_note: note || null,
    p_user_id: user?.userId || null, p_user_nom: user?.userNom || null,
  })
  if (error) throw verifierTable(error)
  journaliser('tresorerie_pret_recu', { compte_id: compteId, montant, date, creancier, note }, contexte(user))
}

export async function virement({ deId, versId, montant, date, libelle }, user) {
  const { error } = await supabase.rpc('tresorerie_virement', {
    p_de: deId, p_vers: versId, p_montant: montant, p_date: date, p_libelle: libelle || null,
    p_user_id: user?.userId || null, p_user_nom: user?.userNom || null,
  })
  if (error) throw verifierTable(error)
  journaliser('tresorerie_virement', { de: deId, vers: versId, montant, date }, contexte(user))
}

// Un virement s'annule en entier (ses deux mouvements) ; un prêt, avec sa dette.
export async function supprimerMouvement(mouvement, user) {
  let error
  if (mouvement.type === 'pret') {
    ({ error } = await supabase.rpc('tresorerie_annuler_pret', { p_mouvement: mouvement.id }))
  } else if (mouvement.groupe) {
    ({ error } = await supabase.from('tresorerie_mouvements').delete().eq('groupe', mouvement.groupe))
  } else {
    ({ error } = await supabase.from('tresorerie_mouvements').delete().eq('id', mouvement.id))
  }
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
  // Colonne de la migration supabase_tresorerie_charges.sql : écrite seulement
  // pour une autre charge, pour que les autres saisies marchent sans elle.
  if (du.categorie === 'autre') ligne.categorie_direction = du.categorie_direction || null
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
// previsionId : le paiement est fait depuis cette prévision (son réalisé).
export async function payer({ parts, source, compteId, date, libelle, photoUrl, previsionId = null }, user) {
  const { error } = await supabase.rpc('tresorerie_payer', {
    p_parts: previsionId ? parts.map(x => ({ ...x, prevision_id: previsionId })) : parts,
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

// plan : { aCreer, aModifier, aSupprimer } (voir planReglageLoyer). Les mois
// supprimés n'ont aucun paiement : rien à annuler en banque.
export async function enregistrerLoyer({ restaurantId, montant, jourEcheance, moisDepart, actif, plan }, user) {
  const { error } = await supabase.from('tresorerie_loyers').upsert({
    restaurant_id: restaurantId, montant, jour_echeance: jourEcheance, mois_depart: moisDepart,
    actif, updated_at: new Date().toISOString(),
  }, { onConflict: 'restaurant_id' })
  if (error) throw verifierTable(error)

  const { aCreer = [], aModifier = [], aSupprimer = [] } = plan || {}
  if (aCreer.length) {
    const { error: e } = await supabase.from('tresorerie_dus').insert(
      aCreer.map(d => ({ ...d, cree_par: user?.userId || null, cree_par_nom: user?.userNom || null })))
    if (e) throw verifierTable(e)
  }
  for (const d of aModifier) {
    const { error: e } = await supabase.from('tresorerie_dus')
      .update({ montant_du: d.montant_du, echeance: d.echeance }).eq('id', d.id)
    if (e) throw verifierTable(e)
  }
  if (aSupprimer.length) {
    const { error: e } = await supabase.from('tresorerie_dus').delete().in('id', aSupprimer.map(d => d.id))
    if (e) throw verifierTable(e)
  }
  journaliser('tresorerie_loyer_regle', {
    montant, jour_echeance: jourEcheance, mois_depart: moisDepart, actif,
    mois_ajoutes: aCreer.map(d => d.mois), mois_retires: aSupprimer.map(d => d.mois),
    mois_corriges: aModifier.map(d => d.mois),
  }, { ...contexte(user), restaurantId })
}

// ── Réglages des charges (étape 1) ───────────────────────────────────────────

// dus : lignes déjà recalculées par dusAMettreAJour (montant, échéance, mois).
export async function mettreAJourDus(dus = []) {
  for (const d of dus) {
    const { error } = await supabase.from('tresorerie_dus')
      .update({ montant_du: d.montant_du, echeance: d.echeance, mois: d.mois }).eq('id', d.id)
    if (error) throw verifierTable(error)
  }
}

export async function enregistrerEcheance({ categorie, jour }, majDus = [], user) {
  const { error } = await supabase.from('tresorerie_echeances')
    .upsert({ categorie, jour, updated_at: new Date().toISOString() }, { onConflict: 'categorie' })
  if (error) throw verifierTable(error)
  await mettreAJourDus(majDus)
  journaliser('tresorerie_echeance_reglee', { categorie, jour, lignes_mises_a_jour: majDus.length }, contexte(user))
}

export async function enregistrerChargeFixe({
  categorie, restaurantId, montant, moisDepart, bailMois = null, bailJour = null, actif = true,
}, majDus = [], user) {
  const { error } = await supabase.from('tresorerie_charges_fixes').upsert({
    categorie, restaurant_id: restaurantId, montant, mois_depart: moisDepart,
    bail_mois: bailMois, bail_jour: bailJour, actif, updated_at: new Date().toISOString(),
  }, { onConflict: 'categorie,restaurant_id' })
  if (error) throw verifierTable(error)
  await mettreAJourDus(majDus)
  journaliser('tresorerie_charge_fixe_reglee', {
    categorie, montant, bail_mois: bailMois, bail_jour: bailJour, actif, lignes_mises_a_jour: majDus.length,
  }, { ...contexte(user), restaurantId })
}

// Saisie groupée : plan rendu par planSaisieGroupee / planSaisieBaux. Les lignes
// supprimées n'ont aucun paiement (le plan écarte les lignes entamées).
export async function appliquerPlanDus({ aCreer = [], aModifier = [], aSupprimer = [] }, user, details = {}) {
  if (aCreer.length) {
    const { error } = await supabase.from('tresorerie_dus').insert(
      aCreer.map(d => ({ ...d, cree_par: user?.userId || null, cree_par_nom: user?.userNom || null })))
    if (error) {
      if (error.code === '23505') throw new Error('Une ligne existe déjà pour un de ces restaurants : rechargez l\'écran et recommencez.')
      throw verifierTable(error)
    }
  }
  await mettreAJourDus(aModifier)
  if (aSupprimer.length) {
    const { error } = await supabase.from('tresorerie_dus').delete().in('id', aSupprimer.map(d => d.id))
    if (error) throw verifierTable(error)
  }
  journaliser('tresorerie_saisie_groupee', {
    ...details,
    crees: aCreer.map(d => ({ restaurant_id: d.restaurant_id, montant: d.montant_du })),
    corriges: aModifier.map(d => ({ restaurant_id: d.restaurant_id, montant: d.montant_du })),
    supprimes: aSupprimer.map(d => ({ restaurant_id: d.restaurant_id, montant: d.montant_du })),
  }, contexte(user))
}

// Passage manuel en Dette (autres charges, prêts) et retour « à payer ».
export async function basculerDette(du, enDette, user) {
  const { error } = await supabase.from('tresorerie_dus')
    .update({ en_dette_depuis: enDette ? aujourdhuiISO() : null }).eq('id', du.id)
  if (error) throw verifierTable(error)
  journaliser(enDette ? 'tresorerie_du_en_dette' : 'tresorerie_du_hors_dette', {
    categorie: du.categorie, libelle: du.libelle, montant_du: du.montant_du,
  }, { ...contexte(user), restaurantId: du.restaurant_id })
}

// ── Prévisions (étape 4) ─────────────────────────────────────────────────────

export async function ajouterPrevision({ du, montant, datePrevue, partenaire, note }, user) {
  const { error } = await supabase.from('tresorerie_previsions').insert({
    du_id: du.id, montant, date_prevue: datePrevue || null, partenaire: partenaire || null, note: note || null,
    cree_par: user?.userId || null, cree_par_nom: user?.userNom || null,
  })
  if (error) throw verifierTable(error)
  journaliser('tresorerie_prevision_ajoutee', {
    categorie: du.categorie, du_id: du.id, montant, date_prevue: datePrevue, partenaire,
  }, { ...contexte(user), restaurantId: du.restaurant_id })
}

// Les paiements déjà faits depuis elle restent (ils perdent seulement le lien).
export async function supprimerPrevision(prevision, user) {
  const { error } = await supabase.from('tresorerie_previsions').delete().eq('id', prevision.id)
  if (error) throw verifierTable(error)
  journaliser('tresorerie_prevision_supprimee', { du_id: prevision.du_id, montant: prevision.montant }, contexte(user))
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
  // Prévisions qui attendaient ce partenaire : prévenir tout de suite (sans bloquer).
  notifierPrevisionsDeclenchees(partenaire).catch(() => {})
}

async function notifierPrevisionsDeclenchees(partenaire) {
  const { data: prevs, error } = await supabase.from('tresorerie_previsions').select('*').eq('partenaire', partenaire)
  if (error || !prevs?.length) return
  const ids = [...new Set(prevs.map(p => p.du_id))]
  const [dusR, paiesR, restosR] = await Promise.all([
    supabase.from('tresorerie_dus').select('*').in('id', ids),
    supabase.from('tresorerie_paiements').select('du_id, montant, date, prevision_id').in('du_id', ids),
    supabase.from('restaurants').select('id, nom'),
  ])
  const maintenant = new Date().toISOString()
  const receptions = [{ partenaire, type: 'recu', created_at: maintenant }]
  const nomResto = id => (restosR.data || []).find(r => r.id === id)?.nom?.trim() || 'Groupe'
  const lignes = []
  for (const p of prevs) {
    const du = (dusR.data || []).find(d => d.id === p.du_id)
    if (!du || p.created_at >= maintenant) continue
    const paiementsDu = (paiesR.data || []).filter(x => x.du_id === du.id)
    const e = etatPrevision(p, { du, paiementsDu, receptions, aujourdhui: maintenant.slice(0, 10) })
    if (e.statut === 'a_payer') lignes.push(`${nomLigne(du, nomResto)} ${fmt(e.aPayer)} F`)
  }
  await envoyerNotifReceptionPartenaire(nomPartenaire(partenaire), lignes)
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
  const [coffre, objectifs, depenses, emprunts, receptions] = await Promise.all([
    toutesLesLignes(() => supabase.from('tresorerie_coffre_mouvements').select('*').order('date', { ascending: false }).order('id')),
    toutesLesLignes(() => supabase.from('tresorerie_coffre_objectifs').select('*').order('mois')),
    toutesLesLignes(() => supabase.from('tresorerie_depenses_direction').select('*').order('date', { ascending: false }).order('id')),
    // Emprunts : vides tant que supabase_tresorerie_especes.sql n'est pas passé.
    toutesLesLignes(() => supabase.from('tresorerie_coffre_emprunts').select('*').order('date', { ascending: false }).order('id'))
      .catch(() => []),
    // Réceptions partenaires : déclencheur « rembourser à la prochaine réception ».
    toutesLesLignes(() => supabase.from('tresorerie_partenaire_lignes').select('id, partenaire, type, date, created_at')
      .eq('type', 'recu').order('created_at', { ascending: false }).order('id'))
      .catch(() => []),
  ])
  return { coffre, objectifs, depenses, emprunts, receptions }
}

export async function operationCoffre({ type, montant, source, compteId, date, libelle }, user) {
  const { error } = await supabase.rpc('tresorerie_coffre_operation', {
    p_type: type, p_montant: montant, p_source: source, p_compte_id: source === 'compte' ? compteId : null,
    p_date: date, p_libelle: libelle || null, p_user_id: user?.userId || null, p_user_nom: user?.userNom || null,
  })
  if (error) throw verifierTable(error)
  journaliser(`tresorerie_coffre_${type}`, { montant, source, compte_id: compteId, date }, contexte(user))
}

export async function emprunterCoffre({ montant, compteId, date, rembourserLe, rembourserPartenaire, note }, user) {
  const { error } = await supabase.rpc('tresorerie_coffre_emprunter', {
    p_montant: montant, p_compte_id: compteId, p_date: date, p_rembourser_le: rembourserLe || null,
    p_rembourser_partenaire: rembourserPartenaire || null, p_note: note || null,
    p_user_id: user?.userId || null, p_user_nom: user?.userNom || null,
  })
  if (error) throw verifierTable(error)
  journaliser('tresorerie_coffre_emprunt', {
    montant, compte_id: compteId, date, rembourser_le: rembourserLe, rembourser_partenaire: rembourserPartenaire,
  }, contexte(user))
}

export async function rembourserEmprunt({ emprunt, compteId, date }, user) {
  const { error } = await supabase.rpc('tresorerie_coffre_rembourser', {
    p_emprunt: emprunt.id, p_compte_id: compteId, p_date: date,
    p_user_id: user?.userId || null, p_user_nom: user?.userNom || null,
  })
  if (error) throw verifierTable(error)
  journaliser('tresorerie_coffre_remboursement', { montant: emprunt.montant, compte_id: compteId, date }, contexte(user))
}

export async function annulerEmprunt(emprunt, user) {
  const { error } = await supabase.rpc('tresorerie_coffre_emprunt_annuler', { p_emprunt: emprunt.id })
  if (error) throw verifierTable(error)
  journaliser('tresorerie_coffre_emprunt_annule', { montant: emprunt.montant, date: emprunt.date }, contexte(user))
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
    chargerChargesResultat(supabase, mois),
    toutesLesLignes(() => supabase.from('tresorerie_depenses_direction').select('*').gte('date', debut).lte('date', fin).order('id'))
      .catch(() => []),
    toutesLesLignes(() => supabase.from('tresorerie_partenaire_lignes').select('*').eq('type', 'pub')
      .gte('periode_debut', debut).lte('periode_debut', fin).order('id'))
      .catch(() => []),
  ])
  return { points, shifts, charges, depenses, pubs }
}
