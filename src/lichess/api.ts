// Cliente mínimo de la API de Lichess (Board API + retos) para el navegador.
// El token se guarda SOLO en este dispositivo (localStorage); nunca se sube a ningún lado.
import type { Chess } from 'chess.js'

export const LICHESS = 'https://lichess.org'
const TOKEN_KEY = 'reloj.lichess.token'

export function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY) } catch { return null }
}
export function saveToken(t: string | null) {
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY) } catch { /* noop */ }
}

export class LichessError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

async function errorOf(res: Response): Promise<LichessError> {
  let msg = `HTTP ${res.status}`
  try {
    const j = await res.json()
    if (typeof j.error === 'string') msg = j.error
    else if (j.error) msg = JSON.stringify(j.error)
    else if (j.global) msg = [].concat(j.global).join(' ')
    else msg = JSON.stringify(j)
  } catch { /* cuerpo no JSON */ }
  if (res.status === 401) msg = 'Token inválido o sin permisos (board:play, challenge:write)'
  if (res.status === 429) msg = 'Demasiadas peticiones a Lichess; espera un minuto'
  return new LichessError(res.status, msg)
}

type Form = Record<string, string | number | boolean | undefined>

export async function req(path: string, opts: { method?: string; form?: Form; signal?: AbortSignal; token?: string } = {}): Promise<Response> {
  const token = opts.token ?? getToken()
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  let body: URLSearchParams | undefined
  if (opts.form) {
    body = new URLSearchParams()
    for (const [k, v] of Object.entries(opts.form)) if (v !== undefined) body.set(k, String(v))
    headers['Content-Type'] = 'application/x-www-form-urlencoded'
  }
  const res = await fetch(LICHESS + path, { method: opts.method ?? (body ? 'POST' : 'GET'), headers, body, signal: opts.signal })
  if (!res.ok) throw await errorOf(res)
  return res
}

/**
 * Lee un stream ndjson de Lichess línea a línea. Lichess manda una línea vacía cada ~7 s
 * (keepalive); si pasan `staleMs` sin recibir NADA, la conexión se da por muerta y se aborta
 * (así se detectan caídas de red en las que fetch se queda colgado).
 */
export async function streamNdjson(
  path: string, onMsg: (msg: any) => void,
  opts: { signal?: AbortSignal; form?: Form; staleMs?: number; onOpen?: () => void } = {},
): Promise<void> {
  const ctrl = new AbortController()
  const outer = opts.signal
  const onAbort = () => ctrl.abort()
  outer?.addEventListener('abort', onAbort)
  let watchdog = 0
  const kick = () => {
    clearTimeout(watchdog)
    watchdog = window.setTimeout(() => ctrl.abort(), opts.staleMs ?? 25000)
  }
  try {
    kick()
    const res = await req(path, { form: opts.form, signal: ctrl.signal })
    opts.onOpen?.()
    const reader = res.body!.getReader()
    const dec = new TextDecoder()
    let buf = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      kick()
      buf += dec.decode(value, { stream: true })
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        if (line) { try { onMsg(JSON.parse(line)) } catch { /* línea corrupta */ } }
      }
    }
  } finally {
    clearTimeout(watchdog)
    outer?.removeEventListener('abort', onAbort)
  }
}

// ── Endpoints usados ──
export const api = {
  account: (token?: string) => req('/api/account', { token }).then(r => r.json()) as Promise<{ id: string; username: string }>,
  revoke: () => req('/api/token', { method: 'DELETE' }),

  challengeAi: (level: number, limitSec: number, incSec: number, color: string) =>
    req('/api/challenge/ai', { form: { level, 'clock.limit': limitSec, 'clock.increment': incSec, color, variant: 'standard' } }).then(r => r.json()),
  challengeCancel: (id: string) => req(`/api/challenge/${id}/cancel`, { method: 'POST' }),
  challengeAccept: (id: string) => req(`/api/challenge/${id}/accept`, { method: 'POST' }),
  challengeDecline: (id: string) => req(`/api/challenge/${id}/decline`, { method: 'POST', form: { reason: 'generic' } }),

  move: (gameId: string, uci: string) => req(`/api/board/game/${gameId}/move/${uci}`, { method: 'POST' }),
  resign: (gameId: string) => req(`/api/board/game/${gameId}/resign`, { method: 'POST' }),
  abort: (gameId: string) => req(`/api/board/game/${gameId}/abort`, { method: 'POST' }),
  draw: (gameId: string, yes: boolean) => req(`/api/board/game/${gameId}/draw/${yes ? 'yes' : 'no'}`, { method: 'POST' }),
  takeback: (gameId: string, yes: boolean) => req(`/api/board/game/${gameId}/takeback/${yes ? 'yes' : 'no'}`, { method: 'POST' }),
  claimVictory: (gameId: string) => req(`/api/board/game/${gameId}/claim-victory`, { method: 'POST' }),
}

/**
 * Lichess escribe el enroque como "rey toma torre" (e1h1) por compatibilidad con Chess960.
 * chess.js espera e1g1: si el rey "captura" una torre propia, se traduce a la casilla g/c.
 */
export function uciToMove(chess: Chess, uci: string): { from: string; to: string; promotion?: string } {
  const from = uci.slice(0, 2)
  let to = uci.slice(2, 4)
  const p = chess.get(from as any), t = chess.get(to as any)
  if (p?.type === 'k' && t?.type === 'r' && t.color === p.color) to = (to[0] > from[0] ? 'g' : 'c') + from[1]
  return { from, to, promotion: uci[4] || undefined }
}

// ── Ritmos permitidos por la Board API ──
// Velocidad según Lichess: tiempo estimado = inicial + 40 × incremento (segundos).
export type Speed = 'ultraBullet' | 'bullet' | 'blitz' | 'rapid' | 'classical'
export function speedOf(limitSec: number, incSec: number): Speed {
  const est = limitSec + 40 * incSec
  return est < 30 ? 'ultraBullet' : est < 180 ? 'bullet' : est < 480 ? 'blitz' : est < 1500 ? 'rapid' : 'classical'
}
export const SPEED_ES: Record<Speed, string> = {
  ultraBullet: 'ultrabullet', bullet: 'bullet', blitz: 'blitz', rapid: 'rápida', classical: 'clásica',
}
export type Opponent = 'ai' | 'user' | 'seek'
/** null si el ritmo es válido; si no, el motivo. Board API: lobby solo rápidas/clásicas;
 *  blitz solo contra la IA o en retos directos; nunca bullet. */
export function timeControlError(kind: Opponent, baseMin: number, incSec: number): string | null {
  const sp = speedOf(baseMin * 60, incSec)
  if (sp === 'bullet' || sp === 'ultraBullet') return `${baseMin}+${incSec} es ${SPEED_ES[sp]}: la Board API de Lichess no permite bullet`
  if (kind === 'seek' && sp === 'blitz') return `${baseMin}+${incSec} es blitz: en el lobby solo se permiten rápidas y clásicas (blitz solo contra la IA o en reto directo)`
  if (incSec > 60 && kind !== 'seek') return 'Lichess permite como máximo 60 s de incremento en retos'
  return null
}
