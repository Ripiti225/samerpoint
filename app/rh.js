// L'écran « Ressources Humaines » a été fusionné dans « Équipe globale ».
// Cette route reste pour les anciennes notifications (screen: 'rh') et les
// dernières routes mémorisées : elle redirige en gardant les paramètres.
import { Redirect, useLocalSearchParams } from 'expo-router'

export default function RHRedirection() {
  const params = useLocalSearchParams()
  return <Redirect href={{ pathname: '/equipe', params }} />
}
