// ──────────────────────────────────────────────────────────────────────────────
// Carte PDF d'un travailleur (bouton « 📄 Carte PDF » de la fiche Équipe).
// Aux couleurs et au logo de la marque du restaurant ; état civil et pièce
// d'identité. Le salaire n'y figure PAS : la carte peut être montrée ou
// imprimée (choix du 29/10/2026).
// ──────────────────────────────────────────────────────────────────────────────
import { couleurPourResto, marquePourResto } from './logos.js'

const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

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
  if (t.statut === 'archive') return { txt: 'Archivé', coul: '#A32D2D' }
  return t.actif ? { txt: 'Actif', coul: '#2D7D46' } : { txt: 'Inactif', coul: '#888888' }
}

function section(titre, lignes, accent) {
  const pleines = lignes.filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '')
  const corps = pleines.length
    ? pleines.map(([l, v]) => `<tr><td class="ct-l">${esc(l)}</td><td class="ct-v">${esc(v)}</td></tr>`).join('')
    : '<tr><td class="ct-vide" colspan="2">Non renseigné</td></tr>'
  return `<div class="ct-sec" style="border-left-color:${accent};background:${accent}0F;">
      <div class="ct-sec-t" style="color:${assombrir(accent, 0.15)};">${esc(titre)}</div>
      <table class="ct-tab">${corps}</table>
    </div>`
}

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
  const fonce = assombrir(accent)
  const st = statut(t)

  const ini = String(t.nom || '').trim().split(/\s+/).map(n => n[0] || '').join('').slice(0, 2).toUpperCase()
  const photo = t.photo_url
    ? `<img class="ct-photo" src="${esc(t.photo_url)}" />`
    : `<div class="ct-photo ct-ini" style="background:${accent};">${esc(ini)}</div>`
  const logo = marque.logo
    ? `<img class="ct-logo" src="${marque.logo}" alt="${esc(marque.nom)}" />`
    : `<div class="ct-logo-txt" style="color:${fonce};">${esc(marque.nom)}</div>`

  const a = age(t.date_naissance, aujourdhui)
  const naissance = t.date_naissance
    ? `${dateFr(t.date_naissance)}${a !== null ? ` (${a} ans)` : ''}`
    : ''
  const pastilles = [
    t.type_contrat ? `<span class="ct-p" style="background:${accent}22;color:${fonce};">${esc(t.type_contrat)}</span>` : '',
    `<span class="ct-p" style="background:${st.coul}22;color:${st.coul};">${st.txt}</span>`,
    t.identifiant ? `<span class="ct-p" style="background:#00000010;color:#444;">ID ${esc(t.identifiant)}</span>` : '',
  ].join('')

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>Carte — ${esc(t.nom)}</title>
<style>
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; }
  .ct-page { font-family: Arial, Helvetica, sans-serif; padding: 24px 12px; }
  .ct-carte { max-width: 430px; margin: 0 auto; background: #fff; border-radius: 22px; overflow: hidden;
    box-shadow: 0 6px 24px rgba(0,0,0,0.12); border: 1px solid #00000012; }
  .ct-tete { padding: 18px 20px 56px; text-align: center; color: #fff; }
  .ct-logo-box { display: inline-block; background: #fff; border-radius: 14px; padding: 8px 16px; }
  .ct-logo { height: 62px; max-width: 200px; object-fit: contain; display: block; }
  .ct-logo-txt { font-size: 20px; font-weight: 900; letter-spacing: 1px; line-height: 62px; }
  .ct-resto { margin-top: 10px; font-size: 15px; font-weight: 800; letter-spacing: .5px; }
  .ct-titre { margin-top: 2px; font-size: 10px; letter-spacing: 2.5px; text-transform: uppercase; opacity: .85; }
  .ct-centre { text-align: center; margin-top: -46px; padding: 0 20px; }
  .ct-photo { width: 96px; height: 96px; border-radius: 50%; border: 4px solid #fff; object-fit: cover;
    box-shadow: 0 2px 10px rgba(0,0,0,0.18); background: #eee; }
  .ct-ini { display: inline-flex; align-items: center; justify-content: center; font-size: 32px; font-weight: 800; color: #fff; }
  .ct-nom { margin: 10px 0 2px; font-size: 22px; color: #1a1a1a; }
  .ct-poste { margin: 0; color: #777; font-size: 14px; }
  .ct-pastilles { margin-top: 10px; }
  .ct-p { display: inline-block; margin: 0 3px 4px; padding: 3px 10px; border-radius: 10px; font-size: 11px; font-weight: 700; }
  .ct-corps { padding: 14px 18px 4px; }
  .ct-sec { border-left: 4px solid; border-radius: 10px; padding: 8px 12px; margin-bottom: 10px; }
  .ct-sec-t { font-size: 10.5px; font-weight: 800; letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 2px; }
  .ct-tab { width: 100%; border-collapse: collapse; font-size: 13px; }
  .ct-tab td { padding: 4px 0; vertical-align: top; }
  .ct-l { color: #888; width: 44%; }
  .ct-v { text-align: right; font-weight: 700; color: #1a1a1a; }
  .ct-vide { color: #aaa; font-style: italic; }
  .ct-pied { padding: 10px 18px 16px; text-align: center; font-size: 10.5px; color: #999; line-height: 1.5; }
  .ct-bande { height: 6px; }
</style></head>
<body style="margin:0;background:#f0f2f5;">
<div class="ct-page"><div class="ct-carte">
  <div class="ct-tete" style="background:linear-gradient(135deg, ${accent} 0%, ${fonce} 100%);">
    <div class="ct-logo-box">${logo}</div>
    <div class="ct-resto">${esc(restoNom)}</div>
    <div class="ct-titre">Carte du travailleur</div>
  </div>
  <div class="ct-centre">
    ${photo}
    <h1 class="ct-nom">${esc([t.civilite, t.nom].filter(Boolean).join(' '))}</h1>
    <p class="ct-poste">${esc(t.poste || 'Sans poste')}</p>
    <div class="ct-pastilles">${pastilles}</div>
  </div>
  <div class="ct-corps">
    ${section('État civil', [
      ['Nom de famille', t.nom_famille],
      ['Prénoms', t.prenoms],
      ['Né(e) le', naissance],
      ['À', t.lieu_naissance],
      ['Nationalité', t.nationalite],
      ['Situation de famille', t.situation_famille],
    ], accent)}
    ${section("Pièce d'identité", [
      ['N° CNI', t.cni_numero],
      ['N° NNI', t.nni_numero],
    ], accent)}
    ${section('Coordonnées', [
      ['Téléphone', t.contact],
      ['Lieu de résidence', t.lieu_residence],
    ], accent)}
  </div>
  <div class="ct-pied">
    ${esc(marque.societe)}${marque.contact ? `<br>${esc(marque.contact)}` : ''}
    <br>Carte éditée le ${esc(dateFr(aujourdhui))}
  </div>
  <div class="ct-bande" style="background:${accent};"></div>
</div></div>
</body></html>`
}
