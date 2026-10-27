// Login con Lichess por OAuth2 PKCE (sin client secret; Lichess no exige registrar la app).
import { LICHESS } from './api'

const CLIENT_ID = 'reloj-ajedrez'
const SCOPES = 'board:play challenge:write'
const PKCE_KEY = 'reloj.lichess.pkce'

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const redirectUri = () => location.origin + location.pathname

/** Redirige a lichess.org para autorizar. Al volver, finishLogin() canjea el código. */
export async function startLogin() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)))
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)))
  // localStorage (no sessionStorage): en la PWA instalada la vuelta puede abrir otra pestaña
  try { localStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state })) } catch { /* noop */ }
  location.assign(`${LICHESS}/oauth?` + new URLSearchParams({
    response_type: 'code', client_id: CLIENT_ID, redirect_uri: redirectUri(),
    code_challenge_method: 'S256', code_challenge: challenge, scope: SCOPES, state,
  }))
}

/** Si la URL trae ?code= de Lichess, lo canjea por un token. Devuelve el token o null. */
export async function finishLogin(): Promise<string | null> {
  const p = new URLSearchParams(location.search)
  const code = p.get('code'), err = p.get('error')
  if (!code && !err) return null
  history.replaceState(null, '', location.pathname)   // limpiar la URL
  if (err) throw new Error(err === 'access_denied' ? 'Autorización cancelada' : `Lichess: ${err}`)
  let saved: { verifier: string; state: string } | null = null
  try { saved = JSON.parse(localStorage.getItem(PKCE_KEY) || 'null'); localStorage.removeItem(PKCE_KEY) } catch { /* noop */ }
  if (!saved || saved.state !== p.get('state')) throw new Error('Respuesta de login no válida; vuelve a intentarlo')
  const res = await fetch(`${LICHESS}/api/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', code: code!, code_verifier: saved.verifier,
      redirect_uri: redirectUri(), client_id: CLIENT_ID,
    }),
  })
  if (!res.ok) throw new Error(`No se pudo obtener el token (HTTP ${res.status})`)
  const j = await res.json()
  return j.access_token as string
}

/** Página de Lichess para crear un token personal con los permisos justos. */
export const PERSONAL_TOKEN_URL =
  `${LICHESS}/account/oauth/token/create?scopes[]=board:play&scopes[]=challenge:write&description=Reloj%20Ajedrez`
