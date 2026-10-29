// Modèles PDF prédéfinis : demande d'explication & permission.
// Réutilise le même flux d'export que lib/generatePdf.js (web = téléchargement,
// natif = partage système via expo-sharing).
import { File, Paths } from 'expo-file-system'
import * as Print from 'expo-print'
import * as Sharing from 'expo-sharing'
import { Alert, Platform } from 'react-native'
import { cachetPourResto } from './cachets'
import { marquePourResto } from './logos'

const POINTILLES = '…………………………………'

function fmtDateLongue(iso) {
  const d = iso ? new Date(iso) : new Date()
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Ouvre un rendu imprimable du HTML, laisse l'utilisateur exporter en PDF via le dialog système
async function exporterWeb(html, nomFichier) {
  const win = window.open('', '_blank', 'width=900,height=700')
  if (!win) {
    Alert.alert('Erreur', 'Impossible d\'ouvrir la fenêtre d\'impression. Vérifiez les paramètres du navigateur.')
    return
  }

  win.document.write(`
    <!DOCTYPE html>
    <html lang="fr">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${nomFichier}</title>
      <style>
        @media print {
          body { margin: 0; padding: 0; background: #fff; }
          * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          @page { margin: 0; }
          .print-hint { display: none; }
        }
        @media screen {
          body { margin: 20px; padding: 20px; background: #f5f5f5; }
          .print-hint { padding: 12px; background: #e3f2fd; border-left: 4px solid #1976d2; margin-bottom: 20px; font-size: 13px; color: #333; }
        }
      </style>
    </head>
    <body>
      <div class="print-hint">
        💡 Cliquez sur <strong>Imprimer</strong> (Ctrl+P / Cmd+P) ou utilisez le bouton ci-bas pour exporter en PDF.
      </div>
      ${html}
      <script>
        // Impression quand les images (photo, logo) sont chargées, sinon elles
        // sortent vides ; au plus tard après 5 s.
        (function () {
          var fait = false
          function imprimer() { if (!fait) { fait = true; setTimeout(function () { window.print() }, 150) } }
          var imgs = Array.prototype.slice.call(document.images)
          Promise.all(imgs.map(function (i) {
            return i.complete ? 1 : new Promise(function (r) { i.onload = r; i.onerror = r })
          })).then(imprimer)
          setTimeout(imprimer, 5000)
        })()
      </script>
    </body>
    </html>
  `)
  win.document.close()
}

// Coquille commune : en-tête entreprise, corps, bloc signatures
function coquille({ titre, sousTitre, corps, accent = '#534AB7', cachet = null }) {
  const dateGen = fmtDateLongue()
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(titre)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; font-size: 13px; color: #1a1a1a; background: #fff; line-height: 1.55; }
  .doc-header { background: ${accent}; color: #fff; padding: 22px 28px; }
  .doc-header h1 { font-size: 20px; font-weight: 700; margin-bottom: 4px; }
  .doc-header .sub { font-size: 12px; opacity: 0.85; }
  .meta { padding: 18px 28px 0; text-align: right; font-size: 12px; color: #666; }
  .titre-doc { padding: 22px 28px 6px; text-align: center; }
  .titre-doc h2 { font-size: 17px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; text-decoration: underline; }
  .body { padding: 14px 28px 8px; }
  .body p { margin-bottom: 14px; text-align: justify; }
  .champ { font-weight: 700; }
  .encadre { background: #f6f6fb; border-left: 4px solid ${accent}; padding: 12px 14px; border-radius: 6px; margin: 6px 0 16px; }
  .signatures { display: flex; justify-content: space-between; padding: 34px 28px 20px; gap: 40px; }
  .sig-bloc { flex: 1; }
  .sig-label { font-size: 12px; color: #666; margin-bottom: 44px; }
  .sig-line { border-top: 1px solid #999; padding-top: 5px; font-size: 11px; color: #888; }
  /* Le cachet occupe la place laissée libre au-dessus du trait de signature :
     il ne décale donc pas la mise en page des documents sans cachet. */
  .sig-bloc.avec-cachet .sig-label { margin-bottom: 4px; }
  .sig-cachet { height: 74px; display: flex; align-items: center; }
  .sig-cachet img { max-height: 72px; max-width: 190px; }
  .doc-footer { padding: 16px 28px; text-align: center; font-size: 10px; color: #bbb; border-top: 1px solid #eee; margin-top: 10px; }
</style>
</head>
<body>
  <div class="doc-header">
    <h1>SAMER</h1>
    <div class="sub">Gestion des ressources humaines</div>
  </div>
  <div class="meta">Fait le ${dateGen}</div>
  <div class="titre-doc"><h2>${esc(sousTitre)}</h2></div>
  <div class="body">${corps}</div>
  <div class="signatures">
    <div class="sig-bloc"><div class="sig-label">Le travailleur</div><div class="sig-line">Nom & signature</div></div>
    <div class="sig-bloc${cachet ? ' avec-cachet' : ''}">
      <div class="sig-label">La Direction / RH</div>
      ${cachet ? `<div class="sig-cachet"><img src="${cachet}" alt="Cachet"></div>` : ''}
      <div class="sig-line">Nom & signature</div>
    </div>
  </div>
  <div class="doc-footer">Document généré par l'application SAMER · ${dateGen}</div>
</body>
</html>`
}

// Export web/natif commun — réutilisable par d'autres écrans (ex : litiges)
export async function exporterPdf(html, nomFichier, dialogTitle) {
  // Web : utiliser window.print() natif pour PDF vectoriel propre
  if (Platform.OS === 'web') {
    try {
      await exporterWeb(html, nomFichier)
      return { success: true, nomFichier }
    } catch (err) {
      Alert.alert('Erreur', `Impossible de générer le PDF : ${err.message}`)
      return { success: false }
    }
  }

  // Native (iOS/Android) : expo-print + partage système
  try {
    const { uri } = await Print.printToFileAsync({ html, base64: false })
    const canShare = await Sharing.isAvailableAsync()
    if (!canShare) {
      Alert.alert('Indisponible', "Le partage de fichiers n'est pas disponible sur cet appareil.")
      return { success: false }
    }
    const destFile = new File(Paths.document, nomFichier)
    if (destFile.exists) destFile.delete()
    await new File(uri).copy(destFile)
    await Sharing.shareAsync(destFile.uri, { mimeType: 'application/pdf', dialogTitle, UTI: 'com.adobe.pdf' })
    return { success: true, nomFichier }
  } catch (err) {
    Alert.alert('Erreur', `Impossible de générer le PDF : ${err.message}`)
    return { success: false }
  }
}

// ─── Demande d'explication (modèle juridique, Code du Travail ivoirien) ────────
export async function genererPdfExplication({ travailleurNom, poste, restaurantNom, motif, description, date }) {
  const m = marquePourResto(restaurantNom)
  // Signature électronique : uniquement les restaurants CHEZ SAMER.
  // Al Kayan n'a pas de cachet, cachetPourResto renvoie alors null.
  const cachet = cachetPourResto(restaurantNom)
  const dateLongue = fmtDateLongue(date)
  const faits = [motif, description].filter(Boolean).map(esc).join('<br>')

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Demande d'explication — ${esc(travailleurNom)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Times New Roman', Georgia, serif; font-size: 12.5px; color: #111; line-height: 1.5; background: #fff; }
  .page { padding: 34px 40px; }
  .entete { display: flex; align-items: center; gap: 16px; border-bottom: 3px solid ${m.accent}; padding-bottom: 14px; margin-bottom: 6px; }
  .entete img { height: 74px; width: auto; object-fit: contain; }
  .entete .soc { flex: 1; }
  .entete .soc .nom { font-size: 17px; font-weight: 700; color: ${m.accent}; letter-spacing: 0.3px; }
  .entete .soc .ligne { font-size: 11px; color: #333; margin-top: 2px; }
  .dotted { color: #444; }
  .date-lieu { text-align: right; margin: 14px 0 4px; }
  .ref { font-size: 12px; margin-bottom: 14px; }
  .bloc { margin-bottom: 12px; }
  .bloc .l { margin-bottom: 3px; }
  .champ { font-weight: 700; }
  .objet { text-align: center; font-weight: 700; text-decoration: underline; text-transform: uppercase; letter-spacing: 0.5px; margin: 16px 0; font-size: 13.5px; }
  p { text-align: justify; margin-bottom: 11px; }
  .faits { border: 1px solid #999; border-left: 4px solid ${m.accent}; background: #faf9f7; padding: 12px 14px; margin: 6px 0 14px; min-height: 60px; }
  .signature { margin-top: 22px; }
  /* Cachet apposé entre « Pour l'employeur » et la ligne de signature —
     comme un tampon posé à la main sur le document. */
  .cachet { margin: 6px 0 2px; }
  .cachet img { max-height: 78px; max-width: 210px; }
  .accuse { border: 1.5px dashed #777; border-radius: 6px; padding: 14px 16px; margin-top: 26px; }
  .accuse .titre { font-weight: 700; text-transform: uppercase; font-size: 11.5px; letter-spacing: 0.5px; margin-bottom: 8px; }
  .accuse .l { margin-bottom: 7px; font-size: 12px; }
</style>
</head>
<body>
<div class="page">

  <div class="entete">
    <img src="${m.logo}" alt="logo" />
    <div class="soc">
      <div class="nom">${esc(m.societe)}</div>
      ${restaurantNom ? `<div class="ligne">Établissement : ${esc(restaurantNom)}</div>` : ''}
      <div class="ligne">${m.adresse ? esc(m.adresse) : `Adresse : <span class="dotted">${POINTILLES}</span>`}</div>
      <div class="ligne">${m.contact ? esc(m.contact) : `Contact : <span class="dotted">${POINTILLES}</span>`}</div>
    </div>
  </div>

  <div class="date-lieu">Abidjan, le ${dateLongue}</div>
  <div class="ref">Réf. : N° <span class="dotted">………</span> /DE/${esc(m.sigle)}/<span class="dotted">………</span></div>

  <div class="bloc">
    <div class="l"><span class="champ">Destinataire :</span></div>
    <div class="l">Nom et prénoms : <span class="champ">${esc(travailleurNom)}</span></div>
    <div class="l">Fonction / Poste : ${poste ? `<span class="champ">${esc(poste)}</span>` : `<span class="dotted">${POINTILLES}</span>`}</div>
    <div class="l">Matricule : <span class="dotted">………………</span>&nbsp;&nbsp;&nbsp;Site d'affectation : <span class="champ">${esc(restaurantNom || '')}</span></div>
  </div>

  <div class="objet">Objet : Demande d'explication</div>

  <p>Madame, Monsieur <span class="champ">${esc(travailleurNom)}</span>,</p>

  <p>Il vous est reproché les faits suivants, survenus le <span class="dotted">…………</span> vers <span class="dotted">………</span> heures, sur le site de <span class="champ">${esc(restaurantNom || POINTILLES)}</span> :</p>
  <div class="faits">${faits || `<span class="dotted">${POINTILLES}</span>`}</div>

  <p>Ces faits sont, le cas échéant, susceptibles de constituer un manquement à vos obligations professionnelles telles que définies par votre contrat de travail et/ou le règlement intérieur de l'entreprise.</p>

  <p>Conformément à l'article 17.5 du Code du Travail ivoirien (loi n°2015-532 du 20 juillet 2015), qui dispose que préalablement à toute sanction disciplinaire le travailleur doit pouvoir s'expliquer, nous vous invitons à nous faire parvenir vos explications écrites dans un délai de <span class="champ">soixante-douze (72) heures</span> à compter de la réception de la présente.</p>

  <p>Vos explications peuvent être fournies par écrit ou verbalement. Dans ce dernier cas, vous pouvez, si vous le souhaitez, vous faire assister d'un à trois délégués du personnel ; vos explications verbales seront alors transcrites, lues et signées par vous-même ainsi que contresignées par l'employeur et les personnes ayant assisté à l'entretien.</p>

  <p>Nous vous rappelons qu'à défaut de réponse de votre part dans le délai imparti, ou si vos explications ne sont pas jugées satisfaisantes, l'employeur se réserve le droit de prendre à votre encontre la sanction disciplinaire qu'il jugera appropriée, proportionnée à la gravité des faits reprochés, conformément aux dispositions du Code du Travail et du règlement intérieur en vigueur.</p>

  <p>Dans l'attente de vos explications, nous vous prions d'agréer, Madame, Monsieur <span class="champ">${esc(travailleurNom)}</span>, l'expression de nos salutations distinguées.</p>

  <div class="signature">
    <div>Pour l'employeur,</div>
    ${cachet ? `<div class="cachet"><img src="${cachet}" alt="Cachet ${esc(m.nom)}"></div>` : ''}
    <div style="margin-top:6px">Nom, qualité et signature : <span class="dotted">${POINTILLES}</span></div>
  </div>

  <div class="accuse">
    <div class="titre">Accusé de réception du salarié</div>
    <div class="l">Reçu le <span class="dotted">……………</span> à <span class="dotted">………</span> heures.</div>
    <div class="l">Nom, signature du salarié : <span class="dotted">${POINTILLES}</span></div>
    <div class="l">Nom, signature du(des) témoin(s) / délégué(s) du personnel (si applicable) : <span class="dotted">${POINTILLES}</span></div>
  </div>

</div>
</body>
</html>`

  return exporterPdf(
    html,
    `demande_explication_${(travailleurNom || 'travailleur').replace(/\s+/g, '_')}.pdf`,
    "Demande d'explication",
  )
}

// ─── Permission / autorisation d'absence ──────────────────────────────────────
export async function genererPdfPermission({ travailleurNom, restaurantNom, motif, dateDebut, dateFin, description }) {
  const periode = dateDebut && dateFin
    ? `du <span class="champ">${fmtDateLongue(dateDebut)}</span> au <span class="champ">${fmtDateLongue(dateFin)}</span>`
    : dateDebut ? `à compter du <span class="champ">${fmtDateLongue(dateDebut)}</span>` : ''
  const corps = `
    <p>La Direction atteste avoir accordé à <span class="champ">${esc(travailleurNom)}</span>${restaurantNom ? `, ${esc(restaurantNom)}` : ''},
       une permission d'absence${periode ? ` ${periode}` : ''}.</p>
    ${motif ? `<p>Motif : <span class="champ">${esc(motif)}</span></p>` : ''}
    ${description ? `<div class="encadre">${esc(description)}</div>` : ''}
    <p>La présente autorisation est délivrée pour servir et valoir ce que de droit.</p>`
  return exporterPdf(
    coquille({ titre: 'Permission', sousTitre: "Autorisation d'absence", corps, accent: '#185FA5' }),
    `permission_${(travailleurNom || 'travailleur').replace(/\s+/g, '_')}.pdf`,
    'Permission',
  )
}
