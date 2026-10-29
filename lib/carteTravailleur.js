// ──────────────────────────────────────────────────────────────────────────────
// Carte PDF d'un travailleur (bouton « 📄 Carte PDF » de la fiche Équipe).
// Aux couleurs et au logo de la marque du restaurant ; état civil et pièce
// d'identité. Le salaire n'y figure PAS : la carte peut être montrée ou
// imprimée (choix du 29/10/2026). Une information absente est omise, et une
// section entièrement vide disparaît.
// ──────────────────────────────────────────────────────────────────────────────
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

/** Section en lignes « libellé … valeur » ; '' si aucune ligne n'est renseignée. */
function section(titre, lignes, accent) {
  const pleines = lignes.filter(([, v]) => rempli(v))
  if (!pleines.length) return ''
  const corps = pleines.map(([l, v]) => `<div class="ct-ligne">
        <span class="ct-l">${esc(l)}</span><span class="ct-v">${esc(v)}</span></div>`).join('')
  return `<div class="ct-sec">
      <div class="ct-sec-t"><span class="ct-barre" style="background:${accent};"></span>${esc(titre)}</div>
      <div class="ct-bloc">${corps}</div>
    </div>`
}

const ICONE_TEL = couleur => `<svg width="13" height="13" viewBox="0 0 24 24" style="vertical-align:-2px;margin-right:6px;"><path fill="${couleur}" d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 0 1 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1z"/></svg>`

/**
 * HTML de la carte.
 * @param t       ligne `travailleurs`
 * @param resto   ligne `restaurants` ({ nom, couleur, … }) ; repli sur t.restaurants
 * @param aujourdhui AAAA-MM-JJ (âge et date d'édition)
 */
export function htmlCarteTravailleur(t, resto, aujourdhui) {
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
  const logo = marque.logo
    ? `<img class="ct-logo" src="${marque.logo}" alt="${esc(marque.nom)}" />`
    : `<div class="ct-logo-txt" style="color:${fonce};">${esc(marque.nom)}</div>`

  const a = age(t.date_naissance, aujourdhui)
  const naissance = t.date_naissance ? `${dateFr(t.date_naissance)}${a !== null ? ` · ${a} ans` : ''}` : ''
  const pastilles = [
    t.type_contrat ? `<span class="ct-p" style="background:${accent};color:#fff;">${esc(t.type_contrat)}</span>` : '',
    `<span class="ct-p" style="border:1.5px solid ${st.coul};color:${st.coul};"><span class="ct-pt" style="background:${st.coul};"></span>${st.txt}</span>`,
    t.identifiant ? `<span class="ct-p" style="background:#EFEFF2;color:#444;">ID ${esc(t.identifiant)}</span>` : '',
  ].join('')
  const numeros = NUMEROS_A_JOINDRE
    .map(n => `<a class="ct-num" href="tel:${n}">${ICONE_TEL(accent)}${telEspace(n)}</a>`).join('')

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>Carte — ${esc(t.nom)}</title>
<style>
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; }
  .ct-page { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; padding: 28px 12px; }
  .ct-carte { max-width: 430px; margin: 0 auto; background: #fff; border-radius: 26px; overflow: hidden;
    box-shadow: 0 18px 45px rgba(0,0,0,0.18), 0 2px 6px rgba(0,0,0,0.06); }
  .ct-tete { position: relative; overflow: hidden; padding: 14px 18px 44px; color: #fff;
    display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .ct-rond1, .ct-rond2 { position: absolute; border-radius: 50%; background: rgba(255,255,255,0.10); }
  .ct-rond1 { width: 160px; height: 160px; top: -90px; right: -50px; }
  .ct-rond2 { width: 110px; height: 110px; bottom: -70px; left: 35%; background: rgba(0,0,0,0.10); }
  .ct-logo-box { position: relative; display: inline-block; background: #fff; border-radius: 14px; padding: 8px 16px;
    box-shadow: 0 6px 16px rgba(0,0,0,0.18); }
  .ct-logo { height: 62px; max-width: 200px; object-fit: contain; display: block; }
  .ct-logo-txt { font-size: 20px; font-weight: 900; letter-spacing: 1px; line-height: 62px; }
  .ct-droite { position: relative; text-align: right; }
  .ct-resto { font-size: 16px; font-weight: 800; letter-spacing: 2px; text-transform: uppercase; }
  .ct-titre { display: inline-block; margin-top: 6px; padding: 4px 12px; border: 1px solid rgba(255,255,255,0.55);
    border-radius: 20px; font-size: 9.5px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; }
  .ct-centre { text-align: center; margin-top: -40px; padding: 0 22px; position: relative; }
  .ct-anneau { display: inline-block; padding: 4px; border-radius: 50%; box-shadow: 0 8px 22px rgba(0,0,0,0.22); }
  .ct-photo { width: 96px; height: 96px; border-radius: 50%; border: 4px solid #fff; object-fit: cover; display: block; background: #eee; }
  .ct-ini { display: flex; align-items: center; justify-content: center; font-size: 32px; font-weight: 800; color: #fff; }
  .ct-nom { margin: 12px 0 3px; font-size: 25px; font-weight: 800; color: #111; letter-spacing: -0.3px; }
  .ct-poste { margin: 0; font-size: 12px; font-weight: 800; letter-spacing: 2.5px; text-transform: uppercase; }
  .ct-pastilles { margin-top: 12px; }
  .ct-p { display: inline-block; margin: 0 3px 4px; padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 800; letter-spacing: .3px; }
  .ct-pt { display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin-right: 6px; vertical-align: 1px; }
  .ct-corps { padding: 18px 20px 6px; }
  .ct-sec { margin-bottom: 16px; }
  .ct-sec-t { font-size: 11px; font-weight: 800; letter-spacing: 2px; text-transform: uppercase; color: #111; margin-bottom: 8px; }
  .ct-barre { display: inline-block; width: 18px; height: 4px; border-radius: 2px; margin-right: 8px; vertical-align: 3px; }
  .ct-bloc { border: 1px solid #E8E8EC; border-radius: 14px; padding: 0 14px; }
  .ct-ligne { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding: 9px 0; border-bottom: 1px solid #F0F0F3; }
  .ct-ligne:last-child { border-bottom: none; }
  .ct-l { font-size: 12.5px; color: #8E8E93; white-space: nowrap; }
  .ct-v { font-size: 13.5px; font-weight: 700; color: #111; text-align: right; }
  .ct-pied { padding: 14px 20px 16px; text-align: center; border-top: 1px solid #ECECEF; }
  .ct-pied-t { font-size: 9.5px; font-weight: 700; letter-spacing: 2.5px; text-transform: uppercase; color: #8E8E93; margin-bottom: 6px; }
  .ct-num { display: inline-block; margin: 0 10px 4px; font-size: 15px; font-weight: 800; color: #111; text-decoration: none; letter-spacing: .5px; }
  .ct-societe { margin-top: 8px; font-size: 10px; color: #A0A0A5; letter-spacing: .5px; }
</style></head>
<body style="margin:0;background:#ECEDF1;">
<div class="ct-page"><div class="ct-carte">
  <div class="ct-tete" style="background:linear-gradient(140deg, ${accent} 0%, ${fonce} 100%);">
    <div class="ct-rond1"></div><div class="ct-rond2"></div>
    <div class="ct-logo-box">${logo}</div>
    <div class="ct-droite">
      <div class="ct-resto">${esc(restoNom)}</div>
      <div class="ct-titre">Carte du travailleur</div>
    </div>
  </div>
  <div class="ct-centre">
    <div class="ct-anneau" style="background:linear-gradient(135deg, ${accent}, ${fonce});">${photo}</div>
    <h1 class="ct-nom">${esc([t.civilite, t.nom].filter(Boolean).join(' '))}</h1>
    ${rempli(t.poste) ? `<p class="ct-poste" style="color:${accent};">${esc(t.poste)}</p>` : ''}
    <div class="ct-pastilles">${pastilles}</div>
  </div>
  <div class="ct-corps">
    ${section('État civil', [
      ['Nom de famille', t.nom_famille],
      ['Prénoms', t.prenoms],
      ['Né(e) le', naissance],
      ['Lieu de naissance', t.lieu_naissance],
      ['Nationalité', t.nationalite],
      ['Situation de famille', t.situation_famille],
    ], accent)}
    ${section("Pièce d'identité", [
      ['N° CNI', t.cni_numero],
      ['N° NNI', t.nni_numero],
    ], accent)}
    ${section('Coordonnées', [
      ['Téléphone', rempli(t.contact) ? telEspace(t.contact) : ''],
      ['Lieu de résidence', t.lieu_residence],
    ], accent)}
  </div>
  <div class="ct-pied">
    <div class="ct-pied-t">Numéros à joindre</div>
    ${numeros}
    <div class="ct-societe">${esc(marque.societe)} · Carte éditée le ${esc(dateFr(aujourdhui))}</div>
  </div>
  <div style="height:5px;background:${accent};"></div>
</div></div>
</body></html>`
}
