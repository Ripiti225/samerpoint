// ──────────────────────────────────────────────────────────────────────────────
// Trésorerie — lecture des exports bruts Yango et Glovo.
//
// Reproduit les skills `rapport-commandes-yango` et `rapport-commandes-glovo-2` :
// mêmes filtres, mêmes formules, mêmes codes restaurant. Logique pure : reçoit
// les lignes de la feuille (tableaux de cellules), ne touche ni fichier ni base.
//
// Tests : lib/partenairesImport.test.mjs
// ──────────────────────────────────────────────────────────────────────────────

export const COLONNES_YANGO = [
  'Nom du restaurant', 'Numéro de la commande', 'Montant', 'Statut',
  'La commande sera payée', 'Commande confirmée par le restaurant',
]

export const COLONNES_GLOVO = [
  'Nom du restaurant', 'Numéro de commande', 'Acceptée à', 'Sous-total',
  'Remise financée par vous', 'Commission', 'Frais opérationnels',
  "Frais d'annonces", "Frais de temps d'attente", 'est payable',
]

export const TAUX_YANGO = 0.77
export const TAUX_COMMISSION_GLOVO = 0.295
// « Frais d'annonces » = frais d'attente × 18 % : formule voulue, ne pas « corriger ».
export const TAUX_ANNONCES_GLOVO = 0.18

// Codes uniques de l'app. Z4 (Chez Samer Zone 4) et Remblais = KMS ; AK1 = ALK1.
export const CODES = ['7E', 'PALM', 'KMS', 'LVG', 'MRC', 'OASIS', 'ALK1']

export function normaliser(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

// ── Codes restaurant ────────────────────────────────────────────────────────

const GLOVO_EXACT = {
  'al kayan (annaneraie) [yop]': 'ALK1',
  'al kayan - abn - remblais': 'KMS',
  'chez samer - abn - c323+24j': 'KMS',
  'chez samer - abn - l 155 - voie de la 7e tranche': '7E',
  'chez samer - abn - riviera palmeraie abidjan ci': 'PALM',
  'chez samer - yop - 21 bp915 21': 'LVG',
  'chez samer - yop - s ci': 'MRC',
  'chez samer (s 584) [yop]': 'OASIS',
  // Nouveaux noms Glovo (export du 22 au 28/09/2026)
  'al kayan - yop - annaneraie': 'ALK1',
  'chez samer (21 bp915 21) [yop]': 'LVG',
  'chez samer (c323+24j) [abn]': 'KMS',
  'chez samer (l 155 - voie de la 7e tranche) [abn]': '7E',
  'chez samer (riviera palmeraie abidjan ci) [abn]': 'PALM',
  'chez samer (s ci) [yop]': 'MRC',
}

const contient = (txt, mots) => mots.some(m => txt.includes(normaliser(m)))

// Règles par mots-clés de la skill Yango (dans cet ordre).
function codeParMotsCles(nom) {
  const t = normaliser(nom)
  if (t.includes('al kayan')) {
    // Al Kayan de Yopougon (Annaneraie). Sans cette règle, le nouveau nom Glovo
    // « Al Kayan - YOP - Annaneraie » tombait en silence dans KMS.
    if (contient(t, ['Rue S95', 'commune Yopougon', 'Annaneraie', 'Ananeraie', '- YOP -', '[YOP]'])) return 'ALK1'
    if (contient(t, ['Angré', 'Angre'])) return 'PALM'
    return 'KMS'
  }
  if (contient(t, ['Palmeraie', 'Palmraie', 'Riviera', 'Riviéra', 'Rue I123', 'Пальнре'])) return 'PALM'
  if (contient(t, ['Angré', '7ième tranche', '7e tranche', 'Rue L56', 'Транш'])) return '7E'
  if (contient(t, ['Zone 4', 'Koumassi', 'Rue du 7 Décembre', 'Remblais', 'Décembre'])) return 'KMS'
  if (contient(t, ['St André', 'Saint André', 'Rue P239'])) return 'LVG'
  if (contient(t, ['Maroc'])) return 'MRC'
  if (contient(t, ['Ananeraie', 'Annaneraie', 'S584', 'С584'])) return 'OASIS'
  return null
}

// La table exacte de la skill Yango se résout entièrement par les mots-clés
// (les noms bruts contiennent l'adresse) ; on garde donc une seule règle.
export function codeYango(nom) {
  return codeParMotsCles(nom)
}

export function codeGlovo(nom) {
  return GLOVO_EXACT[normaliser(nom)] || codeParMotsCles(nom)
}

// ── Cellules ────────────────────────────────────────────────────────────────

export function lireNombre(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (v == null || v === '') return 0
  let s = String(v).replace(/[\s  ]/g, '').replace(/[^\d,.-]/g, '')
  if (s.includes(',') && s.includes('.')) s = s.replace(/,/g, '')
  else s = s.replace(',', '.')
  const x = parseFloat(s)
  return Number.isFinite(x) ? x : 0
}

// Date + heure d'une cellule : Date, nombre Excel, « AAAA-MM-JJ hh:mm:ss » ou
// « JJ/MM/AAAA hh:mm ». Rend { jour: 'AAAA-MM-JJ', minutes } ou null.
export function lireDateHeure(v) {
  if (v == null || v === '') return null
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const p = x => String(x).padStart(2, '0')
    return { jour: `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`, minutes: v.getHours() * 60 + v.getMinutes() }
  }
  if (typeof v === 'number') {
    // Nombre de jours depuis le 30/12/1899 (format Excel).
    const ms = Math.round((v - 25569) * 86400000)
    const d = new Date(ms)
    const p = x => String(x).padStart(2, '0')
    return { jour: `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`, minutes: d.getUTCHours() * 60 + d.getUTCMinutes() }
  }
  const s = String(v).trim()
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/)
  if (m) return { jour: `${m[1]}-${m[2]}-${m[3]}`, minutes: m[4] ? Number(m[4]) * 60 + Number(m[5]) : 0 }
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,]+(\d{1,2}):(\d{2}))?/)
  if (m) return { jour: `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`, minutes: m[4] ? Number(m[4]) * 60 + Number(m[5]) : 0 }
  return null
}

// Yango (skill) : « La commande sera payée » = Non / N / FALSE / VIDE → écartée.
const estNonYango = v => ['non', 'n', 'false', 'faux', '0', ''].includes(normaliser(v))
// Glovo (skill) : seuls Non / N / FALSE sont écartés. Une case VIDE = payée :
// dans l'export du 22 au 28/09/2026, 660 commandes sur 679 avaient la case vide.
const estNonGlovo = v => ['non', 'n', 'false', 'faux'].includes(normaliser(v))

// Trouve la ligne d'en-têtes (la première qui contient toutes les colonnes) et
// l'index de chaque colonne, par libellé — jamais par lettre de colonne.
export function trouverEntetes(lignes, colonnes) {
  for (let i = 0; i < Math.min(lignes.length, 15); i++) {
    const cellules = (lignes[i] || []).map(normaliser)
    const idx = {}
    for (const c of colonnes) {
      const j = cellules.indexOf(normaliser(c))
      if (j >= 0) idx[c] = j
    }
    if (Object.keys(idx).length === colonnes.length) return { ligne: i, idx }
  }
  // Pour le message d'erreur : les colonnes absentes de la ligne la plus proche.
  let meilleur = { manquantes: colonnes }
  for (let i = 0; i < Math.min(lignes.length, 15); i++) {
    const cellules = (lignes[i] || []).map(normaliser)
    const manquantes = colonnes.filter(c => !cellules.includes(normaliser(c)))
    if (manquantes.length < meilleur.manquantes.length) meilleur = { manquantes }
  }
  const e = new Error(`Colonnes introuvables dans le fichier : ${meilleur.manquantes.join(', ')}. Vérifiez que c'est bien l'export brut attendu.`)
  e.colonnesManquantes = meilleur.manquantes
  throw e
}

// Heure d'été (dernier dimanche de mars → dernier dimanche d'octobre) : 22h ; sinon 21h.
function dernierDimanche(annee, mois) {
  const d = new Date(Date.UTC(annee, mois + 1, 0))
  d.setUTCDate(d.getUTCDate() - d.getUTCDay())
  return d.toISOString().slice(0, 10)
}

export function seuilYango(jour) {
  const a = Number(jour.slice(0, 4))
  return jour >= dernierDimanche(a, 2) && jour < dernierDimanche(a, 9) ? 22 : 21
}

function totaliser(parCode, code, champs) {
  const cle = code || '?'
  if (!parCode[cle]) parCode[cle] = { nb: 0, ...Object.fromEntries(Object.keys(champs).map(k => [k, 0])) }
  parCode[cle].nb += 1
  for (const [k, v] of Object.entries(champs)) parCode[cle][k] += v
}

function arrondirTotaux(parCode) {
  for (const t of Object.values(parCode)) {
    for (const k of Object.keys(t)) if (k !== 'nb') t[k] = Math.round(t[k])
  }
  return parCode
}

// ── Yango ───────────────────────────────────────────────────────────────────
// seuil : heure de coupure (22 ou 21). Sans valeur, déduit de la saison.
export function analyserYango(lignes, { seuil } = {}) {
  const { ligne, idx } = trouverEntetes(lignes, COLONNES_YANGO)
  const donnees = lignes.slice(ligne + 1).filter(l => l && l.some(c => c !== null && c !== undefined && c !== ''))

  const dates = donnees.map(l => lireDateHeure(l[idx['Commande confirmée par le restaurant']])).filter(Boolean)
  if (!dates.length) throw new Error("Aucune date dans « Commande confirmée par le restaurant ».")
  const j1 = dates.reduce((m, d) => (d.jour < m ? d.jour : m), dates[0].jour)
  const jn = dates.reduce((m, d) => (d.jour > m ? d.jour : m), dates[0].jour)
  const seuilPropose = seuilYango(j1)
  const aCheval = seuilYango(j1) !== seuilYango(jn)
  const h = (seuil ?? seuilPropose) * 60

  // Annulées « Sera payée » : Yango les rembourse au restaurant, elles comptent
  // (choix du 27/10/2026, écart volontaire avec la skill qui les retirait).
  const ecarte = { bordDebut: 0, bordFin: 0, nonPayables: 0 }
  let annuleesPayees = 0
  const parCode = {}
  const nomsInconnus = new Set()
  for (const l of donnees) {
    const d = lireDateHeure(l[idx['Commande confirmée par le restaurant']])
    if (d && d.jour === j1 && d.minutes < h) { ecarte.bordDebut++; continue }
    if (d && d.jour === jn && d.minutes >= h) { ecarte.bordFin++; continue }
    if (estNonYango(l[idx['La commande sera payée']])) { ecarte.nonPayables++; continue }
    if (normaliser(l[idx.Statut]) === 'annule') annuleesPayees++
    const nom = l[idx['Nom du restaurant']]
    const code = codeYango(nom)
    if (!code) nomsInconnus.add(String(nom))
    const montant = lireNombre(l[idx.Montant])
    totaliser(parCode, code, { montant, paye: montant * TAUX_YANGO })
  }

  return {
    partenaire: 'yango', j1, jn, seuil: seuil ?? seuilPropose, seuilPropose, aCheval,
    ecarte, annuleesPayees, parCode: arrondirTotaux(parCode), nomsInconnus: [...nomsInconnus],
    nbCommandes: Object.values(parCode).reduce((s, t) => s + t.nb, 0),
  }
}

// ── Glovo ───────────────────────────────────────────────────────────────────
export function analyserGlovo(lignes) {
  const { ligne, idx } = trouverEntetes(lignes, COLONNES_GLOVO)
  const donnees = lignes.slice(ligne + 1).filter(l => l && l.some(c => c !== null && c !== undefined && c !== ''))

  const ecarte = { nonPayables: 0 }
  const parCode = {}
  const nomsInconnus = new Set()
  let j1 = null
  let jn = null
  for (const l of donnees) {
    if (estNonGlovo(l[idx['est payable']])) { ecarte.nonPayables++; continue }
    const d = lireDateHeure(l[idx['Acceptée à']])
    if (d) {
      if (!j1 || d.jour < j1) j1 = d.jour
      if (!jn || d.jour > jn) jn = d.jour
    }
    const nom = l[idx['Nom du restaurant']]
    const code = codeGlovo(nom)
    if (!code) nomsInconnus.add(String(nom))
    const vente = lireNombre(l[idx['Sous-total']]) - lireNombre(l[idx['Remise financée par vous']])
    const commission = vente * TAUX_COMMISSION_GLOVO
    const fraisOp = lireNombre(l[idx['Frais opérationnels']])
    const attente = lireNombre(l[idx["Frais de temps d'attente"]])
    const annonces = attente * TAUX_ANNONCES_GLOVO
    totaliser(parCode, code, {
      montant: vente,
      remise: lireNombre(l[idx['Remise financée par vous']]),
      commission,
      paye: vente - commission - fraisOp - annonces - attente,
    })
  }

  return {
    partenaire: 'glovo', j1, jn, ecarte, parCode: arrondirTotaux(parCode),
    nomsInconnus: [...nomsInconnus],
    nbCommandes: Object.values(parCode).reduce((s, t) => s + t.nb, 0),
  }
}
