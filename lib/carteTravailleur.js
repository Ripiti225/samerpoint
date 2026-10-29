// ──────────────────────────────────────────────────────────────────────────────
// Carte PDF d'un travailleur (bouton « 📄 Carte PDF » de la fiche Équipe).
// Aux couleurs et au logo de la marque du restaurant ; état civil et pièce
// d'identité. Le salaire n'y figure PAS : la carte peut être montrée ou
// imprimée (choix du 29/10/2026). Une information absente est omise, et un
// groupe entièrement vide disparaît.
//
// Format CARTE BANCAIRE vertical (54 × 85,6 mm) : tout doit tenir sur la carte
// à l'impression. Tailles en mm/pt, valeurs trop longues coupées (…), au plus
// 8 lignes d'infos. Nom et prénoms ne sont pas répétés dans les infos : ils
// sont déjà écrits en grand sous la photo.
//
// VERSO (quand `verif` est fourni) : QR de vérification en direct
// (verif-personnel.vercel.app → verifier_carte), n° de carte, validité
// (validiteCarte : fin du contrat en cours ; CDI = jusqu'à l'archivage ;
// sans contrat saisi = 6 mois),
// mention « propriété de … à restituer en fin de contrat ». Un ancien
// travailleur qui garde son badge : le scan affiche « Ne fait plus partie du
// personnel ».
// ──────────────────────────────────────────────────────────────────────────────
import { contratEnCours, contratsSignes, finEffective } from './contrats.js'
import { couleurPourResto, marquePourResto } from './logos.js'

/** Numéros à joindre, imprimés en pied de chaque carte. */
export const NUMEROS_A_JOINDRE = ['0143111118', '0779696370']

const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const rempli = v => v !== null && v !== undefined && String(v).trim() !== ''

/** « 0143111118 » → « 01 43 11 11 18 ». */
export function telEspace(n) {
  const c = String(n || '').replace(/\D/g, '')
  return c.length === 10 ? c.replace(/(\d{2})(?=\d)/g, '$1 ') : String(n || '')
}

/** « 1995-03-12 » → « 12 mars 1995 ». */
function dateFr(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''))
  if (!m) return ''
  return `${parseInt(m[3], 10)} ${MOIS[parseInt(m[2], 10) - 1]} ${m[1]}`
}

/** Âge révolu à la date `aujourdhui` (AAAA-MM-JJ). */
export function age(naissance, aujourdhui) {
  const n = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(naissance || ''))
  const a = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(aujourdhui || ''))
  if (!n || !a) return null
  let ans = Number(a[1]) - Number(n[1])
  if (a[2] + a[3] < n[2] + n[3]) ans -= 1
  return ans >= 0 && ans < 120 ? ans : null
}

/** Mélange une couleur « #RRGGBB » avec du noir (f = part de noir). */
function assombrir(hex, f = 0.28) {
  const v = parseInt(hex.slice(1), 16)
  const c = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map(x => Math.round(x * (1 - f)))
  return `#${c.map(x => x.toString(16).padStart(2, '0')).join('')}`
}

function statut(t) {
  if (t.statut === 'archive') return { txt: 'Archivé', coul: '#C0392B' }
  return t.actif ? { txt: 'Actif', coul: '#1E9E5A' } : { txt: 'Inactif', coul: '#8A8A8A' }
}

export const CARTE_MM = { largeur: 54, hauteur: 85.6 }

/** Validité par défaut quand aucun contrat n'est saisi (choix du 29/10/2026). */
export const VALIDITE_MOIS = 6

/** Adresse imprimée dans le QR : gravée sur les cartes, ne pas la changer.
 *  Site Vercel À PART (dossier verif-personnel/), indépendant de l'application. */
export const URL_VERIFICATION = 'https://verif-personnel.vercel.app/'

export const urlVerification = jeton => `${URL_VERIFICATION}?c=${jeton}`

/** N° lisible d'une carte : les 8 premiers caractères de son code. */
export const numeroCarte = jeton => String(jeton || '').replace(/-/g, '').slice(0, 8).toUpperCase()

/** AAAA-MM-JJ + n mois ; le 31 août + 6 mois = le 28 (ou 29) février. */
export function ajouterMois(iso, n) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''))
  if (!m) return null
  const total = Number(m[1]) * 12 + (Number(m[2]) - 1) + n
  const an = Math.floor(total / 12)
  const mois = total % 12 + 1
  const finMois = new Date(Date.UTC(an, mois, 0)).getUTCDate()
  const jour = Math.min(Number(m[3]), finMois)
  return `${an}-${String(mois).padStart(2, '0')}-${String(jour).padStart(2, '0')}`
}

/** Une carte est-elle encore utilisable ? `valide_jusqua` vide = CDI, sans expiration. */
export const carteEnCours = (carte, aujourdhui) =>
  !!carte?.id && (!carte.valide_jusqua || carte.valide_jusqua >= aujourdhui)

const estCDI = v => /^\s*cdi\s*$/i.test(String(v || ''))

/**
 * Validité d'une nouvelle carte : « le temps du contrat en cours » (29/10/2026).
 *  - contrat signé en cours avec une fin → sa fin (rupture anticipée comprise) ;
 *  - CDI (contrat en cours sans fin, ou fiche marquée CDI) → null : valable
 *    jusqu'à l'archivage ;
 *  - aucun contrat saisi (journaliers, CDD non saisis…) → VALIDITE_MOIS mois.
 * @returns { valideJusqua: 'AAAA-MM-JJ' | null, source: 'contrat' | 'cdi' | 'defaut' }
 */
export function validiteCarte(trav, contrats, aujourdhui) {
  const c = contratEnCours(contratsSignes(contrats), aujourdhui)
  if (c) {
    const fin = finEffective(c)
    if (fin) return { valideJusqua: fin, source: 'contrat' }
    return { valideJusqua: null, source: 'cdi' }
  }
  if (estCDI(trav?.type_contrat)) return { valideJusqua: null, source: 'cdi' }
  return { valideJusqua: ajouterMois(aujourdhui, VALIDITE_MOIS), source: 'defaut' }
}

/** Texte court de la validité : « jusqu'au 19 janv. 2027 » ou « CDI, jusqu'au départ ». */
export const libelleValidite = valideJusqua =>
  valideJusqua ? `jusqu'au ${dateFr(valideJusqua)}` : 'CDI, jusqu\'au départ'

/** Groupe de lignes « libellé … valeur » ; '' si aucune n'est renseignée. */
function groupe(lignes) {
  const pleines = lignes.filter(([, v]) => rempli(v))
  if (!pleines.length) return ''
  return `<div class="ct-bloc">${pleines.map(([l, v]) => `<div class="ct-ligne">
      <span class="ct-l">${esc(l)}</span><span class="ct-v">${esc(v)}</span></div>`).join('')}</div>`
}

/** Nom long : police réduite plutôt que coupé (largeur utile ~48 mm). */
export function taillePolice(nom) {
  const n = String(nom || '').length
  return n <= 22 ? 8.5 : n <= 30 ? 7 : 6
}

const ICONE_TEL = couleur => `<svg viewBox="0 0 24 24" class="ct-ico"><path fill="${couleur}" d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 0 1 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1z"/></svg>`

/**
 * HTML de la carte.
 * @param t       ligne `travailleurs`
 * @param resto   ligne `restaurants` ({ nom, couleur, … }) ; repli sur t.restaurants
 * @param aujourdhui AAAA-MM-JJ (âge et date d'édition)
 * @param verif   { jeton, qrSvg, valideJusqua } → ajoute le verso ; sinon recto seul
 */
export function htmlCarteTravailleur(t, resto, aujourdhui, verif = null) {
  const r = resto || t.restaurants || null
  const restoNom = String(r?.nom || '').trim() || 'Sans restaurant'
  const marque = marquePourResto(r || restoNom)
  const accent = couleurPourResto(r || restoNom)
  const fonce = assombrir(accent, 0.35)
  const st = statut(t)

  const ini = String(t.nom || '').trim().split(/\s+/).map(n => n[0] || '').join('').slice(0, 2).toUpperCase()
  const photo = t.photo_url
    ? `<img class="ct-photo" src="${esc(t.photo_url)}" />`
    : `<div class="ct-photo ct-ini" style="background:linear-gradient(135deg, ${accent}, ${fonce});">${esc(ini)}</div>`
  // Chez Samer : logo d'une seule couleur → en blanc, posé sur le bandeau.
  // Les autres (Al Kayan multicolore, À la Braise sans image) gardent la plaque blanche.
  const logo = marque.id === 'samer' && marque.logo
    ? `<img class="ct-logo ct-logo-blanc" src="${marque.logo}" alt="${esc(marque.nom)}" />`
    : `<div class="ct-logo-box">${marque.logo
      ? `<img class="ct-logo" src="${marque.logo}" alt="${esc(marque.nom)}" />`
      : `<div class="ct-logo-txt" style="color:${fonce};">${esc(marque.nom)}</div>`}</div>`

  const nomComplet = [t.civilite, t.nom].filter(Boolean).join(' ')
  const a = age(t.date_naissance, aujourdhui)
  const naissance = t.date_naissance ? `${dateFr(t.date_naissance)}${a !== null ? ` · ${a} ans` : ''}` : ''
  const pastilles = [
    t.type_contrat ? `<span class="ct-p" style="background:${accent};color:#fff;">${esc(t.type_contrat)}</span>` : '',
    `<span class="ct-p" style="border:0.2mm solid ${st.coul};color:${st.coul};"><span class="ct-pt" style="background:${st.coul};"></span>${st.txt}</span>`,
    t.identifiant ? `<span class="ct-p" style="background:#EFEFF2;color:#444;">ID ${esc(t.identifiant)}</span>` : '',
  ].join('')
  const numeros = NUMEROS_A_JOINDRE
    .map(n => `<a class="ct-num" href="tel:${n}">${ICONE_TEL(accent)}${telEspace(n)}</a>`).join('')

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>Carte — ${esc(t.nom)}</title>
<style>
  @page { size: ${CARTE_MM.largeur}mm ${CARTE_MM.hauteur}mm; margin: 0; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; }
  .ct-page { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; padding: 8mm 0; }
  .ct-carte { width: ${CARTE_MM.largeur}mm; height: ${CARTE_MM.hauteur}mm; margin: 0 auto; background: #fff; border-radius: 3mm;
    overflow: hidden; display: flex; flex-direction: column; box-shadow: 0 2mm 6mm rgba(0,0,0,0.18); }
  .ct-tete { position: relative; overflow: hidden; height: 15mm; flex-shrink: 0; padding: 2.4mm 3mm 0; color: #fff;
    display: flex; align-items: flex-start; justify-content: space-between; gap: 2mm; }
  .ct-rond1 { position: absolute; border-radius: 50%; background: rgba(255,255,255,0.10); width: 26mm; height: 26mm; top: -15mm; right: -8mm; }
  .ct-logo-box { position: relative; background: #fff; border-radius: 1.8mm; padding: 0.8mm 1.6mm; box-shadow: 0 0.6mm 1.6mm rgba(0,0,0,0.18); }
  .ct-logo { height: 7.2mm; max-width: 19mm; object-fit: contain; display: block; }
  .ct-logo-blanc { position: relative; height: 9mm; filter: brightness(0) invert(1); }
  .ct-logo-txt { font-size: 6pt; font-weight: 900; letter-spacing: 0.2pt; line-height: 7.2mm; white-space: nowrap; }
  .ct-droite { position: relative; text-align: right; min-width: 0; }
  .ct-resto { font-size: 6.2pt; font-weight: 800; letter-spacing: 0.4pt; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ct-titre { margin-top: 0.5mm; font-size: 3.8pt; font-weight: 700; letter-spacing: 0.6pt; text-transform: uppercase;
    white-space: nowrap; opacity: 0.85; }
  .ct-centre { text-align: center; margin-top: -7mm; padding: 0 3mm; position: relative; flex-shrink: 0; }
  .ct-anneau { display: inline-block; padding: 0.6mm; border-radius: 50%; box-shadow: 0 0.8mm 2mm rgba(0,0,0,0.2); }
  .ct-photo { width: 15mm; height: 15mm; border-radius: 50%; border: 0.7mm solid #fff; object-fit: cover; display: block; background: #eee; }
  .ct-ini { display: flex; align-items: center; justify-content: center; font-size: 13pt; font-weight: 800; color: #fff; }
  .ct-nom { margin: 1mm 0 0.3mm; font-size: 8.5pt; font-weight: 800; color: #111; line-height: 1.15;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ct-poste { margin: 0; font-size: 4.8pt; font-weight: 800; letter-spacing: 0.7pt; text-transform: uppercase;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ct-pastilles { margin-top: 1.1mm; white-space: nowrap; }
  .ct-p { display: inline-block; margin: 0 0.4mm; padding: 0.4mm 1.6mm; border-radius: 2mm; font-size: 4.4pt; font-weight: 800; }
  .ct-pt { display: inline-block; width: 1mm; height: 1mm; border-radius: 50%; margin-right: 0.8mm; vertical-align: 0.2mm; }
  .ct-corps { flex: 1; min-height: 0; overflow: hidden; padding: 1.8mm 3mm 0; }
  .ct-bloc { border: 0.2mm solid #E6E6EA; border-radius: 1.6mm; padding: 0 1.8mm; margin-bottom: 1.2mm; }
  .ct-ligne { display: flex; justify-content: space-between; align-items: baseline; gap: 1.5mm; padding: 0.55mm 0; border-bottom: 0.15mm solid #F0F0F3; }
  .ct-ligne:last-child { border-bottom: none; }
  .ct-l { font-size: 4.8pt; color: #8E8E93; white-space: nowrap; flex-shrink: 0; }
  .ct-v { font-size: 5.2pt; font-weight: 700; color: #111; text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .ct-pied { flex-shrink: 0; padding: 1.2mm 2mm 1.3mm; text-align: center; border-top: 0.2mm solid #ECECEF; }
  .ct-pied-t { font-size: 3.6pt; font-weight: 700; letter-spacing: 0.6pt; text-transform: uppercase; color: #8E8E93; margin-bottom: 0.5mm; }
  .ct-num { display: inline-block; margin: 0 1.1mm; font-size: 5.6pt; font-weight: 800; color: #111; text-decoration: none; white-space: nowrap; }
  .ct-ico { width: 2mm; height: 2mm; vertical-align: -0.3mm; margin-right: 0.6mm; }
  .ct-societe { margin-top: 0.5mm; font-size: 3.6pt; color: #A0A0A5; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ct-bande { height: 1.2mm; flex-shrink: 0; }
  .ct-verso { break-before: page; page-break-before: always; margin-top: 8mm; }
  .ct-v-tete { height: 7mm; flex-shrink: 0; color: #fff; display: flex; align-items: center; justify-content: center;
    font-size: 4.6pt; font-weight: 800; letter-spacing: 1pt; text-transform: uppercase; }
  .ct-v-corps { flex: 1; min-height: 0; display: flex; flex-direction: column; align-items: center; justify-content: space-evenly;
    padding: 1mm 4mm; text-align: center; }
  .ct-v-consigne { font-size: 5pt; color: #555; line-height: 1.3; }
  .ct-qr { padding: 1.4mm; border: 0.4mm solid; border-radius: 2.4mm; background: #fff; }
  .ct-qr svg { width: 29mm; height: 29mm; display: block; }
  .ct-v-num { font-size: 4.6pt; color: #8E8E93; letter-spacing: 0.6pt; }
  .ct-v-num b { color: #111; letter-spacing: 0.8pt; }
  .ct-v-valid { padding: 0.8mm 2.4mm; border-radius: 2mm; font-size: 5.4pt; font-weight: 600; }
  .ct-v-mention { font-size: 4.4pt; color: #444; line-height: 1.4; }
  .ct-v-trouvee { font-size: 4.4pt; color: #8E8E93; line-height: 1.5; }
  .ct-v-trouvee b { color: #111; font-size: 5.2pt; }
  @media screen { .ct-carte { zoom: 2; } }
  @media print {
    html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
    .ct-page { padding: 0; }
    .ct-carte { box-shadow: none; border-radius: 0; zoom: 1; }
    .ct-anneau, .ct-logo-box { box-shadow: none; }
    .ct-verso { margin-top: 0; }
  }
</style></head>
<body style="margin:0;background:#ECEDF1;">
<div class="ct-page"><div class="ct-carte">
  <div class="ct-tete" style="background:linear-gradient(140deg, ${accent} 0%, ${fonce} 100%);">
    <div class="ct-rond1"></div>
    ${logo}
    <div class="ct-droite">
      <div class="ct-resto">${esc(restoNom)}</div>
      <div class="ct-titre">Carte du travailleur</div>
    </div>
  </div>
  <div class="ct-centre">
    <div class="ct-anneau" style="background:linear-gradient(135deg, ${accent}, ${fonce});">${photo}</div>
    <div class="ct-nom" style="font-size:${taillePolice(nomComplet)}pt;">${esc(nomComplet)}</div>
    ${rempli(t.poste) ? `<p class="ct-poste" style="color:${accent};">${esc(t.poste)}</p>` : ''}
    <div class="ct-pastilles">${pastilles}</div>
  </div>
  <div class="ct-corps">
    ${groupe([
      ['Né(e) le', naissance],
      ['Lieu de naissance', t.lieu_naissance],
      ['Nationalité', t.nationalite],
      ['Situation de famille', t.situation_famille],
    ])}
    ${groupe([
      ['N° CNI', t.cni_numero],
      ['N° NNI', t.nni_numero],
    ])}
    ${groupe([
      ['Téléphone', rempli(t.contact) ? telEspace(t.contact) : ''],
      ['Résidence', t.lieu_residence],
    ])}
  </div>
  <div class="ct-pied">
    <div class="ct-pied-t">Numéros à joindre</div>
    ${numeros}
    <div class="ct-societe">${esc(marque.societe)} · Éditée le ${esc(dateFr(aujourdhui))}</div>
  </div>
  <div class="ct-bande" style="background:${accent};"></div>
</div>${verif ? verso(verif, marque, accent, fonce) : ''}</div>
</body></html>`
}

function verso({ jeton, qrSvg, valideJusqua }, marque, accent, fonce) {
  const nums = NUMEROS_A_JOINDRE.map(n => `<b>${telEspace(n)}</b>`).join(' · ')
  return `
<div class="ct-carte ct-verso">
  <div class="ct-v-tete" style="background:linear-gradient(140deg, ${accent} 0%, ${fonce} 100%);">Vérification de la carte</div>
  <div class="ct-v-corps">
    <div class="ct-v-consigne">Scannez ce code avec un téléphone<br>pour vérifier que la carte est valide</div>
    <div class="ct-qr" style="border-color:${accent};">${qrSvg}</div>
    <div class="ct-v-num">CARTE N° <b>${esc(numeroCarte(jeton))}</b></div>
    <div class="ct-v-valid" style="background:${accent}22;color:${fonce};">${valideJusqua
      ? `Valable jusqu'au <b>${esc(dateFr(valideJusqua))}</b>`
      : 'Valable pendant le <b>CDI</b> en cours'}</div>
    <div class="ct-v-mention">Cette carte est la propriété de <b>${esc(marque.societe)}</b>.<br>Strictement personnelle, elle doit être<br>restituée en fin de contrat.</div>
    <div class="ct-v-trouvee">Carte trouvée ? Merci d'appeler<br>${nums}</div>
  </div>
  <div class="ct-bande" style="background:${accent};"></div>
</div>`
}
