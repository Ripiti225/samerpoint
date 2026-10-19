// ──────────────────────────────────────────────────────────────────────────────
// Trésorerie — accès Supabase. La logique de calcul est dans lib/tresorerie.js.
//
// Toutes les lectures passent par `toutesLesLignes` : Supabase coupe en silence
// à 1 000 lignes, et les mouvements de banque dépasseront vite ce nombre.
// Les écritures journalisent sans jamais bloquer l'action.
// ──────────────────────────────────────────────────────────────────────────────
import { journaliser } from './journal'
import { ecrituresCotisation } from './cotisations'
import { envoyerNotifReceptionPartenaire } from './notifications'
import { droitsPourPrevisions, estDroitAncienTravailleur } from './droitsAnciensTravailleurs'
import { etatPrevision, nomPartenaire } from './previsions'
import { nomLigne } from './rappelsTresorerie'
import { chargerChargesResultat } from './chargesMois'
import { creditFournisseursParRestoMois } from './creditFournisseursMois'
import { supabase } from './supabase'
import { aujourdhuiISO, fmt, moisLoyersACreer, premierDuMois, sansChargesAdministratives } from './tresorerie'

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
  if (/transaction_hors_point/.test(msg) && /(does not exist|schema cache|Could not find)/i.test(msg)) {
    const e = new Error("La cotisation reçue a besoin de supabase_factures_mensuelles.sql : il faut passer ce fichier dans Supabase.")
    e.migrationManquante = true
    return e
  }
  if (/tresorerie_\w+/.test(msg) && /(does not exist|schema cache|Could not find)/i.test(msg)) {
    const e = new Error("Cette partie de la Trésorerie n'est pas encore installée dans la base : il faut passer les fichiers supabase_tresorerie*.sql dans Supabase.")
    e.migrationManquante = true
    return e
  }
  return error
}

// Insère des charges en série en écartant celles qui existent déjà en base
// (même catégorie, restaurant, mois). L'index unique est partiel : pas d'upsert
// possible ; et un enregistrement interrompu puis relancé ne doit jamais
// tenter de recréer une ligne déjà créée (« duplicate key »).
async function insererAbsents(lignes = [], user, creeParNom = null) {
  if (!lignes.length) return []
  const cats = [...new Set(lignes.map(l => l.categorie))]
  const restos = [...new Set(lignes.map(l => l.restaurant_id).filter(Boolean))]
  const mois = [...new Set(lignes.map(l => l.mois).filter(Boolean))]
  const { data: deja, error: e1 } = await supabase.from('tresorerie_dus').select('categorie, restaurant_id, mois')
    .in('categorie', cats).in('restaurant_id', restos).in('mois', mois)
  if (e1) throw verifierTable(e1)
  const existe = new Set((deja || []).map(d => `${d.categorie}|${d.restaurant_id}|${d.mois}`))
  const absents = lignes.filter(l => !existe.has(`${l.categorie}|${l.restaurant_id}|${l.mois}`))
  if (!absents.length) return []
  const { error } = await supabase.from('tresorerie_dus').insert(
    absents.map(d => ({ ...d, cree_par: user?.userId || null, cree_par_nom: creeParNom || user?.userNom || null })))
  if (error) throw verifierTable(error)
  return absents
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
    const [comptes, mouvements, loyers, restaurants, fournisseurs, echeances, chargesFixes, previsions, receptions, cotisations, ajoutsDus, cheques] = await Promise.all([
      toutesLesLignes(() => supabase.from('tresorerie_comptes').select('*').eq('actif', true).order('ordre').order('id')),
      toutesLesLignes(() => supabase.from('tresorerie_mouvements').select('*').order('date', { ascending: false }).order('id')),
      toutesLesLignes(() => supabase.from('tresorerie_loyers').select('*').order('restaurant_id')),
      toutesLesLignes(() => supabase.from('restaurants').select('id, nom').order('nom').order('id')),
      // '*' : depart_le (droits des anciens travailleurs), absent avant migration.
      toutesLesLignes(() => supabase.from('fournisseurs').select('*').order('id')),
      lireReglage('tresorerie_echeances', 'categorie'),
      lireReglage('tresorerie_charges_fixes', 'restaurant_id'),
      // Prévisions (étape 4) : vides tant que supabase_tresorerie_previsions.sql n'est pas passé.
      toutesLesLignes(() => supabase.from('tresorerie_previsions').select('*').order('created_at').order('id'))
        .catch(() => []),
      // Réceptions partenaires : déclencheur « à la prochaine réception ».
      toutesLesLignes(() => supabase.from('tresorerie_partenaire_lignes').select('id, partenaire, type, date, created_at')
        .eq('type', 'recu').order('created_at', { ascending: false }).order('id'))
        .catch(() => []),
      // Cotisations reçues : vides tant que supabase_tresorerie_cotisations.sql n'est pas passé.
      toutesLesLignes(() => supabase.from('tresorerie_cotisations_recues').select('*').order('date').order('id'))
        .catch(() => null),
      // Dettes augmentées : vides tant que supabase_tresorerie_dettes_ajouts.sql n'est pas passé.
      toutesLesLignes(() => supabase.from('tresorerie_dus_ajouts').select('*').order('date').order('id'))
        .catch(() => []),
      // Chèques émis : null tant que supabase_tresorerie_cheques.sql n'est pas passé.
      toutesLesLignes(() => supabase.from('tresorerie_cheques').select('*').order('date_encaissement').order('id'))
        .catch(() => null),
    ])

    // CNPS, timbre, ITS, TEE, bail : fournisseurs administratifs depuis le
    // 12/10/2026 (lib/fournisseursAdmin.js) ; leurs anciennes lignes restent en
    // base pour le résultat net des mois passés, mais ne s'affichent plus ici.
    const lireDus = async () => sansChargesAdministratives(
      await toutesLesLignes(() => supabase.from('tresorerie_dus').select('*').order('created_at').order('id')))
    let dus = await lireDus()

    if (creerLoyers) {
      const mc = premierDuMois(aujourdhuiISO())
      const aCreer = moisLoyersACreer(loyers, dus, mc)
      if (aCreer.length) {
        // insert et pas upsert : l'index unique des mois est partiel, PostgREST
        // ne sait pas cibler son ON CONFLICT (l'upsert échouait à chaque fois).
        // Les mois existants sont déjà écartés par moisLoyersACreer.
        const { error } = await supabase.from('tresorerie_dus')
          .insert(aCreer.map(d => ({ ...d, cree_par: user.userId || null, cree_par_nom: 'Automatique' })))
        if (error) console.warn('[tresorerie] création automatique des charges', error.message)
        dus = await lireDus()
      }
    }

    const paiements = await toutesLesLignes(() => supabase.from('tresorerie_paiements').select('*').order('date').order('id'))

    // Droits des anciens travailleurs : lignes à part pour les prévisions
    // seulement (jamais dans dus : ils sont déjà comptés comme fournisseurs).
    const fichesDroits = fournisseurs.filter(estDroitAncienTravailleur)
    let txDroits = []
    if (fichesDroits.length) {
      const { data, error } = await supabase.from('transactions_fournisseurs')
        .select('id, fournisseur_id, facture, paye, source, date_point, created_at')
        .in('fournisseur_id', fichesDroits.map(f => f.id)).order('created_at')
      if (error) console.warn('[tresorerie] paiements des anciens travailleurs', error.message)
      txDroits = data || []
    }
    const droits = droitsPourPrevisions(fichesDroits, txDroits, previsions)

    const mvtsParCompte = {}
    mouvements.forEach(m => { (mvtsParCompte[m.compte_id] ||= []).push(m) })

    return {
      comptes: comptes.map(c => ({ ...c, mouvements: mvtsParCompte[c.id] || [] })),
      mouvements,
      loyers,
      echeances,
      chargesFixes,
      previsions: droits.previsions,
      droits: { dus: droits.dus, paiements: droits.paiements },
      receptions,
      restaurants,
      fournisseurs,
      cotisations,
      ajoutsDus,
      cheques,
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

// ── Cotisations des restaurants (lib/cotisations.js) ─────────────────────────
// Le restaurant remet au RH l'argent mis de côté pour une charge : il entre en
// Espèces, le solde de sa cotisation baisse, et la charge ne pèse plus sur son
// résultat que pour le reste. Trois écritures, rattachées à une ligne de
// tresorerie_cotisations_recues pour pouvoir tout défaire.
//
// La transaction fournisseur n'a pas de journée : elle passe par
// inserer_transaction_hors_point (supabase_factures_mensuelles.sql), qui la
// place en tête de sa date dans la chaîne des restes et décale la suite. Une
// insertion directe était ignorée par le crédit veille du gérant : le
// lendemain, le solde de la cotisation revenait comme avant la remise.
export async function recevoirCotisation({ du, fournisseur, montant, date, note, compteEspecesId, nomResto }, user) {
  if (!compteEspecesId) throw new Error('Compte Espèces introuvable.')
  // Le reste avant/après est calculé par la base (chaîne des transactions).
  const e = ecrituresCotisation({ montant, creditActuel: 0 })
  const libelle = `Cotisation reçue · ${nomResto || ''}${du.mois ? ` · ${String(du.mois).slice(0, 7)}` : ''}${fournisseur ? ` · ${fournisseur.nom.trim()}` : ''}`

  const mvt = await supabase.from('tresorerie_mouvements').insert({
    compte_id: compteEspecesId, date, montant: e.mouvement, type: 'cotisation', restaurant_id: du.restaurant_id || null,
    libelle, cree_par: user?.userId || null, cree_par_nom: user?.userNom || null,
  }).select('id').single()
  if (mvt.error) throw verifierTable(mvt.error)

  let transactionId = null
  try {
    if (fournisseur) {
      const tr = await supabase.rpc('inserer_transaction_hors_point', {
        p_fournisseur: fournisseur.id, p_date: date,
        p_facture: e.transaction.facture, p_paye: e.transaction.paye,
        p_saisi_par: 'tresorerie', p_source: 'cotisation_remise', p_caissier_nom: user?.userNom || null,
      })
      if (tr.error) throw tr.error
      transactionId = tr.data
    }
    const ins = await supabase.from('tresorerie_cotisations_recues').insert({
      du_id: du.id, restaurant_id: du.restaurant_id || null, fournisseur_id: fournisseur?.id || null,
      montant: e.mouvement, date, note: note || null, mouvement_id: mvt.data.id, transaction_id: transactionId,
      cree_par: user?.userId || null, cree_par_nom: user?.userNom || null,
    })
    if (ins.error) throw ins.error
  } catch (err) {
    // On ne laisse pas une demi-écriture : l'entrée d'espèces et la transaction sont retirées.
    await supabase.from('tresorerie_mouvements').delete().eq('id', mvt.data.id)
    if (transactionId) await supabase.rpc('retirer_transaction_hors_point', { p_transaction: transactionId })
    throw verifierTable(err)
  }
  journaliser('tresorerie_cotisation_recue', { du_id: du.id, montant: e.mouvement, fournisseur: fournisseur?.nom || null, date },
    { ...contexte(user), restaurantId: du.restaurant_id })
}

// Annule une cotisation reçue : retire l'entrée d'espèces et la transaction, et
// remet le solde de la cotisation comme avant.
export async function annulerCotisation(c, user) {
  if (c.transaction_id) {
    // Retire la transaction, redécale la suite de la chaîne et le solde de la fiche.
    const { error } = await supabase.rpc('retirer_transaction_hors_point', { p_transaction: c.transaction_id })
    if (error) throw verifierTable(error)
  } else if (c.fournisseur_id) {
    // Transaction déjà supprimée à la main : seul le solde de la fiche reste à remettre.
    const { data } = await supabase.from('fournisseurs').select('credit_actuel').eq('id', c.fournisseur_id).single()
    if (data) {
      const up = await supabase.from('fournisseurs').update({ credit_actuel: (Number(data.credit_actuel) || 0) - Number(c.montant) }).eq('id', c.fournisseur_id)
      if (up.error) throw up.error
    }
  }
  if (c.mouvement_id) await supabase.from('tresorerie_mouvements').delete().eq('id', c.mouvement_id)
  const { error } = await supabase.from('tresorerie_cotisations_recues').delete().eq('id', c.id)
  if (error) throw error
  journaliser('tresorerie_cotisation_annulee', { du_id: c.du_id, montant: c.montant }, { ...contexte(user), restaurantId: c.restaurant_id })
}

// ── Retenue sur litiges (salaires, lib/retenueLitiges.js) ───────────────────
// retenu = 0 retire la retenue. Les salaires à payer baissent du montant retenu ;
// le résultat garde la charge entière et compte la retenue en revenu.
export async function enregistrerRetenueLitiges({ du, total, regle, retenu }, user) {
  const r = Math.max(0, Math.round(Number(retenu) || 0))
  if (r > Number(du.montant_du || 0)) throw new Error('La retenue ne peut pas dépasser le montant des salaires.')
  const { error } = await supabase.from('tresorerie_dus').update({
    retenue_litiges: r,
    litiges_total: r ? Math.round(Number(total) || 0) : null,
    retenue_regle: r ? String(regle || r) : null,
    retenue_par_nom: r ? user?.userNom || null : null,
    retenue_le: r ? new Date().toISOString() : null,
  }).eq('id', du.id)
  if (error) {
    if (/retenue_litiges|litiges_total|retenue_regle/.test(error.message || '')) {
      throw new Error('La retenue sur litiges n\'est pas encore installée : passez le fichier supabase_tresorerie_retenues_litiges.sql dans Supabase.')
    }
    throw error
  }
  journaliser('tresorerie_retenue_litiges', { du_id: du.id, total, regle, retenu: r }, { ...contexte(user), restaurantId: du.restaurant_id })
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
  return chargerDusMois('loyer', restaurantId, mois)
}

async function chargerDusMois(categorie, restaurantId, mois) {
  const { data, error } = await supabase.from('tresorerie_dus').select('*')
    .eq('categorie', categorie).eq('restaurant_id', restaurantId).in('mois', mois)
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

  const { aCreer = [], aModifier = [], aSupprimer = [], payesAvant = [] } = plan || {}
  await appliquerPlanMois('loyer', restaurantId, plan, user)
  journaliser('tresorerie_loyer_regle', {
    montant, jour_echeance: jourEcheance, mois_depart: moisDepart, actif,
    mois_ajoutes: aCreer.map(d => d.mois), mois_retires: aSupprimer.map(d => d.mois),
    mois_corriges: aModifier.map(d => d.mois),
    mois_payes_avant: payesAvant,
  }, { ...contexte(user), restaurantId })
}

// Mois dus / déjà payés d'un restaurant pour TEE, ITS, timbre ou CNPS (plan de
// planReglageMois). chargeFixe : réglage du montant mensuel à enregistrer avec
// (TEE, ITS, timbre) ; son mois de départ passe au mois courant, pour que les
// mois passés retirés ici ne soient pas recréés tout seuls.
export async function enregistrerMoisCharge({ categorie, restaurantId, plan, chargeFixe = null }, user) {
  if (chargeFixe) await enregistrerChargeFixe({ categorie, restaurantId, ...chargeFixe }, [], user)
  const { aCreer = [], aModifier = [], aSupprimer = [], payesAvant = [] } = plan || {}
  await appliquerPlanMois(categorie, restaurantId, plan, user)
  journaliser('tresorerie_mois_regles', {
    categorie,
    mois_ajoutes: aCreer.map(d => d.mois), mois_retires: aSupprimer.map(d => d.mois),
    mois_corriges: aModifier.map(d => d.mois),
    mois_payes_avant: payesAvant,
  }, { ...contexte(user), restaurantId })
}

async function appliquerPlanMois(categorie, restaurantId, plan, user) {
  const { aCreer = [], aModifier = [], aSupprimer = [], payesAvant = [], annulerAvant = [] } = plan || {}
  await insererAbsents(aCreer, user)
  for (const d of aModifier) {
    const { error: e } = await supabase.from('tresorerie_dus')
      .update({ montant_du: d.montant_du, echeance: d.echeance }).eq('id', d.id)
    if (e) throw verifierTable(e)
  }
  if (aSupprimer.length) {
    const { error: e } = await supabase.from('tresorerie_dus').delete().in('id', aSupprimer.map(d => d.id))
    if (e) throw verifierTable(e)
  }
  if (annulerAvant.length) {
    const { error: e } = await supabase.from('tresorerie_paiements').delete().in('du_id', annulerAvant).eq('source', 'avant')
    if (e) throw verifierTable(e)
  }
  if (payesAvant.length) {
    const dus = await chargerDusMois(categorie, restaurantId, payesAvant)
    for (const du of dus) await payerAvant(du, user)
  }
}

// Solde une charge payée AVANT la trésorerie : paiement de source « avant »,
// sans mouvement en banque ; daté de sa date limite (ou d'aujourd'hui si elle
// est à venir). Elle compte dans le résultat net, plus en dette.
export async function payerAvant(du, user) {
  const { data: paies, error: e1 } = await supabase.from('tresorerie_paiements').select('montant').eq('du_id', du.id)
  if (e1) throw verifierTable(e1)
  const reste = Math.max(0, Number(du.montant_du || 0) - (paies || []).reduce((s, p) => s + Number(p.montant || 0), 0))
  if (!reste) return
  const aujourdhui = aujourdhuiISO()
  await payer({
    parts: [{ du_id: du.id, montant: reste }], source: 'avant', compteId: null,
    date: du.echeance && du.echeance < aujourdhui ? du.echeance : aujourdhui,
    libelle: 'Payé avant la trésorerie',
  }, user)
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
  await insererAbsents(aCreer, user)
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

// ── Ajouter une nouvelle dette à une dette existante ────────────────────────
// L'ajout est noté à part (date, montant, qui) et le montant dû monte d'autant,
// ensemble côté base (supabase_tresorerie_dettes_ajouts.sql).

export async function ajouterADette({ du, montant, date, note }, user) {
  const { error } = await supabase.rpc('tresorerie_ajouter_a_du', {
    p_du_id: du.id, p_montant: montant, p_date: date || aujourdhuiISO(), p_note: note || null,
    p_user_id: user?.userId || null, p_user_nom: user?.userNom || null,
  })
  if (error) {
    if (/tresorerie_ajouter_a_du/.test(error.message || '') && /(does not exist|schema cache|Could not find)/i.test(error.message || '')) {
      throw new Error("L'ajout de dette a besoin de supabase_tresorerie_dettes_ajouts.sql : il faut passer ce fichier dans Supabase.")
    }
    throw verifierTable(error)
  }
  journaliser('tresorerie_dette_augmentee', {
    du_id: du.id, creancier: du.creancier, montant, date, note, ancien_montant: du.montant_du,
    nouveau_montant: Number(du.montant_du || 0) + montant,
  }, { ...contexte(user), restaurantId: du.restaurant_id })
}

export async function retirerAjoutDette(ajout, du, user) {
  const { error } = await supabase.rpc('tresorerie_retirer_ajout_du', { p_ajout_id: ajout.id })
  if (error) throw verifierTable(error)
  journaliser('tresorerie_dette_ajout_retire', {
    du_id: du.id, creancier: du.creancier, montant: ajout.montant, date: ajout.date,
  }, { ...contexte(user), restaurantId: du.restaurant_id })
}

// ── Chèques émis (BACI, SIB) ─────────────────────────────────────────────────
// Tout passe par les fonctions de supabase_tresorerie_cheques.sql : le chèque
// et sa prévision (ou sa sortie de banque et son paiement) ensemble, ou rien.

function erreurCheque(error) {
  const msg = error?.message || ''
  if (/tresorerie_\w*cheque/.test(msg) && /(does not exist|schema cache|Could not find)/i.test(msg)) {
    return new Error("Les chèques ont besoin de supabase_tresorerie_cheques.sql : il faut passer ce fichier dans Supabase.")
  }
  if (/idx_treso_cheques_numero|duplicate key/.test(msg)) {
    return new Error('Ce numéro de chèque est déjà enregistré sur ce compte.')
  }
  if (/cheque_dates/.test(msg)) return new Error("La date d'encaissement ne peut pas être avant la date d'émission.")
  return verifierTable(error)
}

export async function enregistrerCheque(c, user) {
  const { error } = await supabase.rpc('tresorerie_enregistrer_cheque', {
    p_id: c.id || null, p_compte_id: c.compte_id, p_numero: c.numero, p_banque: c.banque, p_ordre: c.ordre,
    p_du_id: c.du_id || null, p_montant: c.montant, p_date_emission: c.date_emission,
    p_date_encaissement: c.date_encaissement, p_note: c.note || null, p_photo_url: c.photo_url || null,
    p_user_id: user?.userId || null, p_user_nom: user?.userNom || null,
  })
  if (error) throw erreurCheque(error)
  journaliser(c.id ? 'tresorerie_cheque_modifie' : 'tresorerie_cheque_emis', {
    numero: c.numero, banque: c.banque, ordre: c.ordre, montant: c.montant, du_id: c.du_id || null,
    date_emission: c.date_emission, date_encaissement: c.date_encaissement,
  }, contexte(user))
}

export async function encaisserCheque(c, date, user) {
  const { error } = await supabase.rpc('tresorerie_encaisser_cheque', {
    p_id: c.id, p_date: date, p_user_id: user?.userId || null, p_user_nom: user?.userNom || null,
  })
  if (error) throw erreurCheque(error)
  journaliser('tresorerie_cheque_encaisse', {
    numero: c.numero, banque: c.banque, ordre: c.ordre, montant: c.montant, date, du_id: c.du_id || null,
  }, contexte(user))
}

export async function annulerEncaissementCheque(c, user) {
  const { error } = await supabase.rpc('tresorerie_annuler_encaissement_cheque', { p_id: c.id })
  if (error) throw erreurCheque(error)
  journaliser('tresorerie_cheque_encaissement_annule', {
    numero: c.numero, banque: c.banque, montant: c.montant, encaisse_le: c.encaisse_le,
  }, contexte(user))
}

export async function annulerCheque(c, motif, user) {
  const { error } = await supabase.rpc('tresorerie_annuler_cheque', { p_id: c.id, p_motif: motif })
  if (error) throw erreurCheque(error)
  journaliser('tresorerie_cheque_annule', {
    numero: c.numero, banque: c.banque, ordre: c.ordre, montant: c.montant, motif,
  }, contexte(user))
}

// ── Prévisions (étape 4) ─────────────────────────────────────────────────────

export async function ajouterPrevision({ du, montant, datePrevue, partenaire, note }, user) {
  const { error } = await supabase.from('tresorerie_previsions').insert({
    // Droit d'ancien travailleur : la prévision porte sur sa fiche fournisseur.
    ...(du.droit ? { fournisseur_id: du.fiche.id } : { du_id: du.id }), montant, date_prevue: datePrevue || null, partenaire: partenaire || null, note: note || null,
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

// Réceptions et pubs des partenaires rattachées à un restaurant (fiche
// « Historique » du restaurant). Vide tant que la migration n'est pas passée.
export async function chargerPartenairesParResto() {
  return toutesLesLignes(() => supabase.from('tresorerie_partenaire_lignes')
    .select('id, partenaire, type, periode_debut, restaurant_id, montant, compte_id, date, note')
    .in('type', ['recu', 'pub']).not('restaurant_id', 'is', null).order('created_at').order('id'))
    .catch(() => [])
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

// Pub de plusieurs restaurants saisie d'un coup : `parts` = [{ restaurant_id, montant }].
// Un seul insert : soit toutes les lignes passent, soit aucune.
export async function ajouterPubs({ partenaire, periodeDebut, parts, note }, user) {
  const lignes = (parts || []).filter(p => p.restaurant_id && Number(p.montant) > 0)
  if (!lignes.length) return
  const { error } = await supabase.from('tresorerie_partenaire_lignes').insert(lignes.map(p => ({
    partenaire, periode_debut: periodeDebut, restaurant_id: p.restaurant_id, type: 'pub', montant: Number(p.montant),
    note: note || null, cree_par: user?.userId || null, cree_par_nom: user?.userNom || null,
  })))
  if (error) throw verifierTable(error)
  for (const p of lignes) {
    journaliser('tresorerie_pub', { partenaire, periode_debut: periodeDebut, montant: Number(p.montant) }, { ...contexte(user), restaurantId: p.restaurant_id })
  }
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
  // Les prévisions d'un droit d'ancien travailleur (sans du_id) ne sont pas notifiées ici.
  const ids = [...new Set(prevs.map(p => p.du_id).filter(Boolean))]
  if (!ids.length) return
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
    const du = sansChargesAdministratives(dusR.data).find(d => d.id === p.du_id)
    if (!du || p.created_at >= maintenant) continue
    const paiementsDu = (paiesR.data || []).filter(x => x.du_id === du.id)
    const e = etatPrevision(p, { du, paiementsDu, receptions, aujourdhui: maintenant.slice(0, 10) })
    if (e.statut === 'a_payer') lignes.push(`${nomLigne(du, nomResto)} ${fmt(e.aPayer)} F`)
  }
  await envoyerNotifReceptionPartenaire(nomPartenaire(partenaire), lignes)
}

// Tête de fond (OM, Wave, Djamo) : un reçu par restaurant, leur total entre sur
// le compte en un seul mouvement. parts : [{ restaurant_id, montant }].
export async function recevoirDetaille({ partenaire, periodeDebut, parts, compteId, date, libelle, note }, user) {
  const { error } = await supabase.rpc('tresorerie_recevoir_detaille', {
    p_partenaire: partenaire, p_debut: periodeDebut, p_parts: parts, p_compte_id: compteId, p_date: date,
    p_libelle: libelle || null, p_note: note || null,
    p_user_id: user?.userId || null, p_user_nom: user?.userNom || null,
  })
  if (error) throw verifierTable(error)
  journaliser('tresorerie_partenaire_recu', {
    partenaire, periode_debut: periodeDebut, compte_id: compteId, date,
    montant: parts.reduce((s, x) => s + Number(x.montant || 0), 0), par_restaurant: parts,
  }, contexte(user))
  notifierPrevisionsDeclenchees(partenaire).catch(() => {})
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

// d : mêmes champs qu'ajouterDepenseDirection + id ; dateSortie = date de la
// sortie banque/coffre (null = garder l'actuelle).
export async function modifierDepenseDirection(d, avant, user) {
  const { error } = await supabase.rpc('tresorerie_depense_direction_modifier', {
    p_id: d.id, p_date: d.date, p_date_sortie: d.dateSortie || null, p_categorie: d.categorie,
    p_restaurant_id: d.restaurantId || null, p_montant: d.montant,
    p_source: d.source, p_compte_id: d.source === 'compte' ? d.compteId : null, p_libelle: d.libelle || null,
    p_note: d.note || null, p_photo_url: d.photoUrl || null,
    p_user_id: user?.userId || null, p_user_nom: user?.userNom || null,
  })
  if (error) throw verifierTable(error)
  journaliser('tresorerie_depense_direction_modifiee', {
    avant: { categorie: avant.categorie, montant: avant.montant, date: avant.date, restaurant_id: avant.restaurant_id },
    apres: { categorie: d.categorie, montant: d.montant, date: d.date, restaurant_id: d.restaurantId || null },
  }, { ...contexte(user), restaurantId: d.restaurantId })
}

// Rend la variation des espèces du restaurant (+ ajoutées / − retirées du FC reçu).
export async function repartirDepenseDirection(dep, especes, dateJour, user) {
  const { data, error } = await supabase.rpc('tresorerie_depense_direction_repartir', {
    p_id: dep.id, p_especes: especes, p_date_jour: dateJour,
    p_user_id: user?.userId || null, p_user_nom: user?.userNom || null,
  })
  if (error) throw verifierTable(error)
  journaliser('tresorerie_fond_reparti', {
    date: dep.date, montant: dep.montant, categorie: dep.categorie, especes, nature: Number(dep.montant) - especes, delta: data,
  }, { ...contexte(user), restaurantId: dep.restaurant_id })
  return Number(data) || 0
}

export async function supprimerDepenseDirection(d, user) {
  const { error } = await supabase.rpc('tresorerie_depense_direction_supprimer', { p_id: d.id })
  if (error) throw verifierTable(error)
  journaliser('tresorerie_depense_direction_supprimee', {
    categorie: d.categorie, montant: d.montant, date: d.date,
  }, { ...contexte(user), restaurantId: d.restaurant_id })
}

// Fournisseur administratif payé par la direction (supabase_fournisseurs_administratifs.sql) :
// dépense direction « administratif » (charge du restaurant) + sortie + paiement sur son crédit.
// p : { fournisseur, date, montant, source: id de compte | 'coffre', note }
export async function payerFournisseurAdminDirection(p, user) {
  const estCompte = p.source !== 'coffre'
  const { error } = await supabase.rpc('tresorerie_payer_fournisseur_admin', {
    p_fournisseur: p.fournisseur.id, p_date: p.date, p_montant: p.montant,
    p_source: estCompte ? 'compte' : 'coffre', p_compte_id: estCompte ? p.source : null,
    p_note: p.note || null, p_user_id: user?.userId || null, p_user_nom: user?.userNom || null,
  })
  if (error) {
    if (/tresorerie_payer_fournisseur_admin/.test(error.message || '')) {
      throw new Error('Il faut d\'abord passer supabase_fournisseurs_administratifs.sql dans Supabase.')
    }
    throw verifierTable(error)
  }
  journaliser('fournisseur_admin_paye_direction', {
    fournisseur: p.fournisseur.nom, montant: p.montant, date: p.date, note: p.note || null,
  }, { ...contexte(user), restaurantId: p.fournisseur.restaurant_id })
}

// Comptes d'où la direction peut payer (BACI, SIB, Espèces, têtes de fond).
export async function chargerComptesTresorerie() {
  const { data, error } = await supabase.from('tresorerie_comptes').select('id, nom').eq('actif', true).order('ordre').order('id')
  if (error) throw verifierTable(error)
  return data || []
}

const PAQUET = 150

// Données du résultat net sur une plage de mois (AAAA-MM).
export async function chargerResultats(mois) {
  const debut = `${mois[0]}-01`
  const dernier = mois[mois.length - 1]
  const [a, m] = dernier.split('-').map(Number)
  const fin = `${dernier}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, '0')}`

  const points = await toutesLesLignes(() => supabase.from('points')
    .select('id, restaurant_id, date, yango_tab, glovo_tab, depenses_gerant_caisse_total, benefice_sc')
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
  // Crédit fournisseurs au début et à la fin de chaque mois : tout l'historique
  // jusqu'à la fin de la période (le dernier reste peut dater de loin).
  const [charges, depenses, pubs, fournisseurs, transactions] = await Promise.all([
    chargerChargesResultat(supabase, mois),
    toutesLesLignes(() => supabase.from('tresorerie_depenses_direction').select('*').gte('date', debut).lte('date', fin).order('id'))
      .catch(() => []),
    toutesLesLignes(() => supabase.from('tresorerie_partenaire_lignes').select('*').eq('type', 'pub')
      .gte('periode_debut', debut).lte('periode_debut', fin).order('id'))
      .catch(() => []),
    // '*' : type et administratif_depuis (fournisseurs administratifs), absents avant migration.
    toutesLesLignes(() => supabase.from('fournisseurs').select('*').order('id')),
    toutesLesLignes(() => supabase.from('transactions_fournisseurs')
      .select('id, fournisseur_id, reste, facture, paye, source, saisi_par, point_id, date_point, created_at')
      .lte('date_point', fin).order('id')),
  ])
  const creditFournisseurs = creditFournisseursParRestoMois({ fournisseurs, transactions, mois })
  // Retenues Glovo retirées du résultat (remboursements, temps d'attente).
  const litigesGlovo = await toutesLesLignes(() => supabase.from('litiges_glovo')
    .select('id, restaurant_id, date, type, montant').in('type', ['remboursement', 'temps_attente'])
    .gte('date', debut).lte('date', fin).order('id'))
  return { points, shifts, charges, depenses, pubs, creditFournisseurs, litigesGlovo }
}
