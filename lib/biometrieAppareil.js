// Face ID / empreinte : une seule interface (toujours asynchrone) pour
// l'écran de connexion, qui aiguille vers le navigateur (WebAuthn) ou
// l'appli installée (expo-local-authentication).
import { Platform } from 'react-native'
import * as natif from './biometrieNatif'
import * as web from './biometrieWeb'

const impl = Platform.OS === 'web' ? web : natif

export const messageErreur = web.messageErreur

export async function estSupportee() { return impl.estSupportee() }
export async function signature(utilisateur, restaurant) { return impl.signature(utilisateur, restaurant) }
export async function lireEnrolements() { return impl.lireEnrolements() }
export async function oublierEnrolement(credentialId) { return impl.oublierEnrolement(credentialId) }
export async function aRefuse(userId) { return impl.aRefuse(userId) }
export async function noterRefus(userId) { return impl.noterRefus(userId) }
export async function activer(utilisateur, restaurant) { return impl.activer(utilisateur, restaurant) }
export async function verifier(enrolement) { return impl.verifier(enrolement) }
