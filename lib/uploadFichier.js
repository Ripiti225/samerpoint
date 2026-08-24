// ──────────────────────────────────────────────────────────────────────────────
// Upload d'un document de travailleur (image OU PDF).
//
// Tout part dans le bucket `photos`, rangé dans un dossier. C'est le seul
// bucket que la clé anon a le droit d'écrire : un bucket `documents-travailleurs`
// existe bien côté Supabase, mais sa policy refuse l'insertion
// (« new row violates row-level security policy »). Le viser faisait échouer
// 100 % des envois depuis la fiche travailleur, images comme PDF.
//
// Les documents qui ont fonctionné historiquement sont d'ailleurs tous à
// l'adresse `photos/documents-travailleurs/…` — c'est ce rangement qu'on garde.
//
// L'upload lui-même est délégué à `uploadFichier` de lib/api.js : FormData +
// fetch brut, la seule forme qui marche à la fois pour une blob URL du web et
// pour une URI de fichier React Native.
// ──────────────────────────────────────────────────────────────────────────────
import { uploadFichier } from './api'

export async function uploaderFichier({ uri, dossier, prefixe, estPDF = false }) {
  const url = await uploadFichier(uri, prefixe ? `${dossier}/${prefixe}` : dossier)
  if (!url) throw new Error("L'envoi du fichier a échoué")
  return { url, type: estPDF ? 'pdf' : 'photo' }
}
