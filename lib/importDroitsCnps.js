// ──────────────────────────────────────────────────────────────────────────────
// Import du 22/10/2026 : droits des anciens travailleurs (« depart par
// restaurant.xlsx ») et arriérés CNPS du Groupe Samer (« DETTE CNPS.xlsx »).
// Spéc : docs/superpowers/specs/2026-10-22-groupes-cnps-anciens-travailleurs-design.md
// Le script scripts/import-cnps-anciens/preparer.mjs lit les fichiers et appelle
// ces fonctions ; le SQL produit passe par inserer_transaction_hors_point (même
// chemin que « Modifier » dans l'app) et se repasse sans doublon.
// Pur : testé par lib/importDroitsCnps.test.mjs.
// ──────────────────────────────────────────────────────────────────────────────

const MARQUE = '[import 22/10]'

// Onglets par restaurant (version à jour) → rattachement. Feuil2/3/4 = brouillons.
const FEUILLES = {
  palmeraie: { restaurant_id: 'b862dfee-007f-413a-9de0-2c6e83b572ce' },
  angre: { restaurant_id: '2f09688d-a4b9-4b14-8c45-943543953379' },
  maroc: { restaurant_id: 'f4550ccf-fa52-4e56-b4bb-9cea4a155df9' },
  OASIS: { restaurant_id: 'ce8a00d8-0908-46b7-ad2f-c9b29d54f03f' },
  lavage: { restaurant_id: '99eb7f7e-baab-4159-872a-34a086374f49' },
  'AL KAYAN': { restaurant_id: '268695fe-972e-468e-b2b7-4e7f268dec4f' },
  koum: { restaurant_id: 'c12f15b9-6149-4b56-be2b-6e82ab447216' },
  autres: { groupe: 'Groupe Samer' },
}

// Absents des onglets par restaurant, ajoutés depuis Feuil1 (choix du 22/10).
// Feuil1 n'a pas d'observation (colonne H = contact).
const AJOUTS_FEUIL1 = {
  'TAPE BARRY BATESTI': { feuille: 'palmeraie', observation: 'réclame toujours' },
  "ETTIEN N'DA": { feuille: 'maroc', observation: '' },
  'LAGO AUDREY': { feuille: 'AL KAYAN', observation: '' },
}

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

const entier = v => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 0)
const texte = v => String(v ?? '').replace(/\s+/g, ' ').trim()

export function nomImport(s) {
  return texte(s).replace(/[’‘`]/g, "'").toLocaleUpperCase('fr-FR')
}

const motifPropre = m => {
  const t = texte(m).toLocaleLowerCase('fr-FR')
  return t ? t[0].toLocaleUpperCase('fr-FR') + t.slice(1) : ''
}

function ligneDroit(feuille, rattachement, l, observation) {
  const montant = entier(l[4])
  const regle = entier(l[5])
  return {
    nom: nomImport(l[1]), rattachement, feuille, depart_le: dateIso(l[2]),
    motif: motifPropre(l[6]), observation, montant, regle, reste: montant - regle,
  }
}

// Date d'une cellule : texte AAAA-MM-JJ, ou numéro de série Excel (lecture en
// flux sans les formats : 45658 = 01/01/2025).
export function dateIso(v) {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000).toISOString().slice(0, 10)
  }
  const t = texte(v)
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null
}

const estLigne = l => Array.isArray(l) && typeof l[0] === 'number' && texte(l[1])

export function lireDroits(feuilles = {}) {
  const out = []
  for (const [feuille, rattachement] of Object.entries(FEUILLES)) {
    for (const l of feuilles[feuille] || []) {
      if (estLigne(l)) out.push(ligneDroit(feuille, rattachement, l, texte(l[7])))
    }
  }
  for (const l of feuilles.Feuil1 || []) {
    if (!estLigne(l)) continue
    const ajout = AJOUTS_FEUIL1[nomImport(l[1])]
    if (ajout) out.push(ligneDroit('Feuil1', FEUILLES[ajout.feuille], l, ajout.observation))
  }
  return out
}

export function lireCnps(lignes = []) {
  const out = []
  for (const l of lignes) {
    const [periode, montant] = l || []
    if (typeof montant !== 'number') continue
    const p = typeof periode === 'number' ? dateIso(periode) : texte(periode)
    const iso = /^(\d{4})-(\d{2})-\d{2}$/.exec(p)
    const annuel = /^(REDRESSEMENT|DISA)\s+(\d{4})$/i.exec(p)
    if (iso) out.push({ libelle: `CNPS ${MOIS[Number(iso[2]) - 1]} ${iso[1]}`, date: `${iso[1]}-${iso[2]}-01`, montant: Math.round(montant) })
    else if (annuel) {
      const nature = annuel[1].toUpperCase() === 'DISA' ? 'DISA' : 'Redressement'
      out.push({ libelle: `${nature} ${annuel[2]}`, date: `${annuel[2]}-12-31`, montant: Math.round(montant) })
    } else throw new Error(`Période CNPS non reconnue : « ${p} »`)
  }
  return out
}

const NOMS_RESTOS = {
  'b862dfee-007f-413a-9de0-2c6e83b572ce': 'Samer Palmeraie',
  '2f09688d-a4b9-4b14-8c45-943543953379': 'Samer Angré 7E',
  'f4550ccf-fa52-4e56-b4bb-9cea4a155df9': 'Samer Maroc',
  'ce8a00d8-0908-46b7-ad2f-c9b29d54f03f': 'Samer Oasis',
  '99eb7f7e-baab-4159-872a-34a086374f49': 'Samer Lavage',
  '268695fe-972e-468e-b2b7-4e7f268dec4f': 'Al Kayan Yop',
  'c12f15b9-6149-4b56-be2b-6e82ab447216': 'Al Kayan KMS',
}
export const nomRattachementImport = r => (r.groupe ? r.groupe : NOMS_RESTOS[r.restaurant_id] || r.restaurant_id)

const dateFR = iso => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '')
export const motifComplet = d => [d.motif, d.observation].filter(Boolean).join(' — ')

export function csvControle(droits = []) {
  const lignes = [['Rattachement', 'Nom', 'Départ', 'Motif', 'Montant', 'Déjà payé', 'Reste', 'Onglet'].join(';')]
  const tries = [...droits].sort((a, b) =>
    nomRattachementImport(a.rattachement).localeCompare(nomRattachementImport(b.rattachement)) || a.nom.localeCompare(b.nom))
  for (const d of tries) {
    lignes.push([nomRattachementImport(d.rattachement), d.nom, dateFR(d.depart_le), motifComplet(d),
      d.montant, d.regle, d.reste, d.feuille].map(v => String(v).replace(/;/g, ',')).join(';'))
  }
  return lignes.join('\n') + '\n'
}

const fr = v => Number(v).toLocaleString('fr-FR').replace(/ | /g, ' ')

export function resumeImport(droits = [], cnps = []) {
  const par = {}
  for (const d of droits) {
    const k = nomRattachementImport(d.rattachement)
    const g = (par[k] ||= { n: 0, montant: 0, regle: 0, reste: 0 })
    g.n += 1; g.montant += d.montant; g.regle += d.regle; g.reste += d.reste
  }
  const out = ['ANCIENS TRAVAILLEURS']
  let tot = { n: 0, montant: 0, regle: 0, reste: 0 }
  for (const [k, g] of Object.entries(par).sort()) {
    out.push(`${k.padEnd(18)} ${String(g.n).padStart(3)} pers.  dû ${fr(g.montant).padStart(11)}  payé ${fr(g.regle).padStart(9)}  reste ${fr(g.reste).padStart(11)}`)
    tot = { n: tot.n + g.n, montant: tot.montant + g.montant, regle: tot.regle + g.regle, reste: tot.reste + g.reste }
  }
  out.push(`${'TOTAL'.padEnd(18)} ${String(tot.n).padStart(3)} pers.  dû ${fr(tot.montant).padStart(11)}  payé ${fr(tot.regle).padStart(9)}  reste ${fr(tot.reste).padStart(11)}`)
  const annee = c => c.libelle.replace(/^CNPS \S+ /, '')
  const parAn = {}
  for (const c of cnps) parAn[annee(c)] = (parAn[annee(c)] || 0) + c.montant
  out.push('', 'CNPS GROUPE SAMER (arriérés)')
  for (const [k, v] of Object.entries(parAn)) out.push(`${k.padEnd(18)} ${fr(v).padStart(11)}`)
  out.push(`${'TOTAL'.padEnd(18)} ${fr(cnps.reduce((s, c) => s + c.montant, 0)).padStart(11)}  (${cnps.length} lignes)`)
  return out.join('\n') + '\n'
}

const q = v => (v === null || v === undefined || v === '' ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`)

// SQL d'import : une transaction ; fonctions pg_temp (disparaissent à la fin de
// la session). Se repasse sans doublon : une fiche existante (même nom en
// majuscules, même restaurant ou groupe, avec date de départ) est corrigée à la
// différence près ; une ligne CNPS déjà posée (même raison) est sautée.
export function sqlImport(droits = [], cnps = []) {
  const l = []
  l.push('BEGIN;', '')
  l.push(`CREATE FUNCTION pg_temp.ecrire(p_f uuid, p_date date, p_delta numeric, p_raison text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_tx uuid;
BEGIN
  IF p_delta = 0 THEN RETURN; END IF;
  v_tx := inserer_transaction_hors_point(p_f, p_date, greatest(p_delta, 0), greatest(-p_delta, 0), 'manager', 'ajustement_manager', 'Import 22/10');
  UPDATE transactions_fournisseurs SET facture_correction_raison = p_raison WHERE id = v_tx;
END $$;`, '')
  l.push(`CREATE FUNCTION pg_temp.groupe(p_nom text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v uuid;
BEGIN
  SELECT id INTO v FROM groupes WHERE nom = p_nom;
  IF v IS NULL THEN RAISE EXCEPTION 'Groupe introuvable : % (passez supabase_groupes_restaurants.sql)', p_nom; END IF;
  RETURN v;
END $$;`, '')
  l.push(`CREATE FUNCTION pg_temp.droit(p_nom text, p_resto uuid, p_groupe text, p_depart date, p_motif text, p_montant bigint, p_regle bigint)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_g uuid; v_id uuid; v_du numeric; v_delta numeric;
BEGIN
  IF p_groupe IS NOT NULL THEN v_g := pg_temp.groupe(p_groupe); END IF;
  SELECT id INTO v_id FROM fournisseurs
   WHERE depart_le IS NOT NULL AND upper(trim(nom)) = upper(p_nom)
     AND restaurant_id IS NOT DISTINCT FROM p_resto AND groupe_id IS NOT DISTINCT FROM v_g
   LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO fournisseurs (nom, type, restaurant_id, groupe_id, actif, facture_mensuelle, depart_le, depart_motif)
    VALUES (p_nom, 'administratif', p_resto, v_g, true, 0, p_depart, nullif(p_motif, '')) RETURNING id INTO v_id;
    IF p_resto IS NOT NULL THEN
      INSERT INTO fournisseurs_restaurants (fournisseur_id, restaurant_id, credit_actuel) VALUES (v_id, p_resto, 0)
      ON CONFLICT (fournisseur_id, restaurant_id) DO NOTHING;
    END IF;
    PERFORM pg_temp.ecrire(v_id, current_date, p_montant, 'Droits à la sortie ${MARQUE}');
    PERFORM pg_temp.ecrire(v_id, current_date, -p_regle, 'Déjà payé avant l''app ${MARQUE}');
    RETURN 'créé';
  END IF;
  UPDATE fournisseurs SET depart_le = p_depart, depart_motif = nullif(p_motif, '') WHERE id = v_id;
  SELECT coalesce(sum(coalesce(facture, 0)), 0)
       - coalesce(sum(CASE WHEN source = 'ajustement_manager' THEN coalesce(paye, 0) ELSE 0 END), 0)
    INTO v_du FROM transactions_fournisseurs WHERE fournisseur_id = v_id;
  v_delta := (p_montant - p_regle) - v_du;
  PERFORM pg_temp.ecrire(v_id, current_date, v_delta, 'Montant dû corrigé selon le fichier ${MARQUE}');
  RETURN CASE WHEN v_delta = 0 THEN 'inchangé' ELSE 'corrigé' END;
END $$;`, '')

  l.push('-- Anciens travailleurs (chaque ligne rend créé / corrigé / inchangé)')
  for (const d of droits) {
    const r = d.rattachement
    l.push(`SELECT pg_temp.droit(${q(d.nom)}, ${r.restaurant_id ? `${q(r.restaurant_id)}::uuid` : 'NULL'}, ${q(r.groupe || null)}, ${q(d.depart_le)}::date, ${q(motifComplet(d))}, ${d.montant}, ${d.regle});`)
  }

  l.push('', '-- Fiches « CNPS — arriérés » des deux groupes, puis les lignes du Groupe Samer')
  l.push(`DO $$
DECLARE v_s uuid; v_a uuid; v_f uuid;
BEGIN
  v_s := pg_temp.groupe('Groupe Samer');
  v_a := pg_temp.groupe('Groupe Al Kayan');
  FOREACH v_f IN ARRAY ARRAY[v_s, v_a] LOOP
    IF NOT EXISTS (SELECT 1 FROM fournisseurs WHERE groupe_id = v_f AND nom = 'CNPS — arriérés') THEN
      INSERT INTO fournisseurs (nom, type, restaurant_id, groupe_id, actif, facture_mensuelle)
      VALUES ('CNPS — arriérés', 'administratif', NULL, v_f, true, 0);
    END IF;
  END LOOP;
END $$;`)
  l.push(`CREATE FUNCTION pg_temp.cnps(p_date date, p_montant bigint, p_raison text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_f uuid;
BEGIN
  SELECT id INTO v_f FROM fournisseurs WHERE groupe_id = pg_temp.groupe('Groupe Samer') AND nom = 'CNPS — arriérés';
  IF EXISTS (SELECT 1 FROM transactions_fournisseurs WHERE fournisseur_id = v_f AND facture_correction_raison = p_raison) THEN RETURN; END IF;
  PERFORM pg_temp.ecrire(v_f, p_date, p_montant, p_raison);
END $$;`)
  for (const c of cnps) l.push(`SELECT pg_temp.cnps(${q(c.date)}::date, ${c.montant}, ${q(`${c.libelle} ${MARQUE}`)});`)

  l.push('', '-- Anciennes fiches globales « ANCIEN TRAVAILLEURS » / « Salaire ancien » : remise à 0 tracée puis désactivation')
  l.push(`DO $$
DECLARE f record; v_reste numeric;
BEGIN
  FOR f IN SELECT id, credit_actuel FROM fournisseurs
            WHERE actif AND depart_le IS NULL
              AND (lower(nom) LIKE '%ancien travailleur%' OR lower(nom) LIKE '%salaire ancien%') LOOP
    SELECT t.reste INTO v_reste FROM transactions_fournisseurs t WHERE t.fournisseur_id = f.id
     ORDER BY coalesce(t.date_point, t.created_at::date) DESC,
              rang_transaction_fournisseur(t.point_id, t.saisi_par) DESC, t.created_at DESC
     LIMIT 1;
    IF NOT FOUND THEN v_reste := coalesce(f.credit_actuel, 0); END IF;
    PERFORM pg_temp.ecrire(f.id, current_date, -coalesce(v_reste, 0), 'Remplacée par une fiche par ancien travailleur ${MARQUE}');
    UPDATE fournisseurs SET actif = false WHERE id = f.id;
  END LOOP;
END $$;`)

  // Bilan APRÈS l'enregistrement : le SQL Editor de Supabase perd les tables
  // temporaires entre les requêtes (« relation resultat_import does not exist »
  // au 1er import du 22/10, alors que tout était passé).
  l.push('', 'COMMIT;', '')
  l.push(`SELECT (SELECT count(*) FROM fournisseurs WHERE depart_le IS NOT NULL) AS fiches_anciens,
       (SELECT sum(credit_actuel) FROM fournisseurs WHERE depart_le IS NOT NULL AND actif) AS reste_anciens,
       (SELECT credit_actuel FROM fournisseurs f JOIN groupes g ON g.id = f.groupe_id
         WHERE g.nom = 'Groupe Samer' AND f.nom = 'CNPS — arriérés') AS cnps_samer,
       (SELECT count(*) FROM transactions_fournisseurs WHERE facture_correction_raison LIKE '%${MARQUE}%') AS ecritures_import;`)
  return l.join('\n') + '\n'
}
