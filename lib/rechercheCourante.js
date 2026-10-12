// Dernier résultat de recherche ouvert : alimente le bandeau de rappel
// (components/BandeauRecherche.js) sur l'écran d'arrivée. En mémoire seulement.
let courante = null
const abonnes = new Set()

export const rechercheCourante = {
  definir(r) {
    courante = r || null
    abonnes.forEach(fn => fn(courante))
  },
  lire() {
    return courante
  },
  abonner(fn) {
    abonnes.add(fn)
    return () => { abonnes.delete(fn) }
  },
}
