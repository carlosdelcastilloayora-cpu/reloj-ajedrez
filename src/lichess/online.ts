// Conexión con Lichess: cuenta, stream de eventos (partidas y retos), creación de partidas
// (IA, reto a usuario/bot, lobby) y stream de la partida en curso, con reconexión automática.
import { create } from 'zustand'
import { api, getToken, saveToken, streamNdjson, LichessError, type Opponent } from './api'
import { finishLogin, startLogin } from './auth'
import { useGame } from '../game/session'

export interface OngoingGame { gameId: string; color: 'white' | 'black'; opponent: string; isMyTurn: boolean; speed: string; board: boolean }
export interface Incoming { id: string; from: string; rating?: number; tc: string; rated: boolean; speed: string }
export interface Waiting { kind: Opponent; text: string; challengeId?: string }
export type Net = 'loggedOut' | 'connecting' | 'online' | 'offline'

export interface PlayOptions {
  kind: Opponent
  baseMin: number
  incSec: number
  level: number                          // IA 1–8
  username: string                       // reto directo
  color: 'random' | 'white' | 'black'
  rated: boolean
}

interface LichessStore {
  user: { id: string; username: string } | null
  net: Net                 // stream de eventos (cuenta)
  gameNet: Net             // stream de la partida en curso
  error: string | null
  ongoing: OngoingGame[]
  incoming: Incoming[]
  waiting: Waiting | null

  init: () => Promise<void>
  login: () => void
  loginWithToken: (token: string) => Promise<void>
  logout: () => Promise<void>
  play: (o: PlayOptions) => Promise<void>
  cancelWaiting: () => void
  accept: (id: string) => Promise<void>
  decline: (id: string) => Promise<void>
  clearError: () => void
}

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>(resolve => {
  const t = setTimeout(done, ms)
  function done() { clearTimeout(t); window.removeEventListener('online', done); signal?.removeEventListener('abort', done); resolve() }
  window.addEventListener('online', done)            // al volver la red, reintentar ya
  signal?.addEventListener('abort', done)
})
const backoff = (n: number) => Math.min(30000, 1000 * 2 ** n)
const isAbort = (e: any) => e?.name === 'AbortError'

let _evCtrl: AbortController | null = null
let _evOpenedAt = 0
let _waitCtrl: AbortController | null = null
let _game: { id: string; ctrl: AbortController } | null = null
let _loginChecked = false

function inActiveGame() {
  const g = useGame.getState()
  return !!g.online && (g.phase === 'running' || g.phase === 'paused')
}

// ── Stream de eventos ──
function onEvent(msg: any) {
  const set = useLichess.setState, get = useLichess.getState
  if (msg.type === 'gameStart') {
    const g = msg.game ?? {}
    const id = g.gameId ?? g.id
    if (!id) return
    const entry: OngoingGame = {
      gameId: id, color: g.color, opponent: g.opponent?.username ?? (g.opponent?.ai ? `IA nivel ${g.opponent.ai}` : '?'),
      isMyTurn: !!g.isMyTurn, speed: g.speed ?? '', board: g.compat?.board !== false,
    }
    set({ ongoing: [entry, ...get().ongoing.filter(o => o.gameId !== id)] })
    if (!entry.board) return
    // Unirse sola si: estábamos esperando rival, o es una partida NUEVA (creada aquí o desde
    // otra app) y no hay otra en juego. Al abrir el stream Lichess manda también las partidas
    // ya en curso: esas solo se listan (se distinguen por llegar en los primeros segundos).
    const isNew = Date.now() - _evOpenedAt > 3000
    if (get().waiting || (isNew && !inActiveGame())) joinGame(id)
  } else if (msg.type === 'gameFinish') {
    const id = msg.game?.gameId ?? msg.game?.id
    set({ ongoing: get().ongoing.filter(o => o.gameId !== id) })
  } else if (msg.type === 'challenge') {
    const c = msg.challenge
    if (!c || c.challenger?.id === get().user?.id) return     // los retos propios no se listan
    const inc: Incoming = {
      id: c.id, from: c.challenger?.name ?? '?', rating: c.challenger?.rating,
      tc: c.timeControl?.show ?? (c.timeControl?.daysPerTurn ? `${c.timeControl.daysPerTurn} días` : '∞'),
      rated: !!c.rated, speed: c.speed ?? '',
    }
    set({ incoming: [inc, ...get().incoming.filter(i => i.id !== c.id)] })
  } else if (msg.type === 'challengeCanceled' || msg.type === 'challengeDeclined') {
    const c = msg.challenge
    set({ incoming: get().incoming.filter(i => i.id !== c?.id) })
    const w = get().waiting
    if (w?.challengeId && w.challengeId === c?.id) {
      _waitCtrl?.abort()
      set({ waiting: null, error: msg.type === 'challengeDeclined' ? `${c.destUser?.name ?? 'El rival'} rechazó el reto${c.declineReason ? `: ${c.declineReason}` : ''}` : 'Reto cancelado' })
    }
  }
}

async function eventLoop(ctrl: AbortController) {
  let attempt = 0
  while (getToken() && !ctrl.signal.aborted) {
    useLichess.setState({ net: 'connecting' })
    try {
      await streamNdjson('/api/stream/event', onEvent, {
        signal: ctrl.signal,
        onOpen: () => { _evOpenedAt = Date.now(); attempt = 0; useLichess.setState({ net: 'online', error: null }) },
      })
    } catch (e: any) {
      if (ctrl.signal.aborted) break
      if (e instanceof LichessError && e.status === 401) {
        saveToken(null)
        useLichess.setState({ user: null, net: 'loggedOut', error: 'La sesión de Lichess caducó; vuelve a iniciar sesión' })
        return
      }
      if (e instanceof LichessError && e.status === 429) { useLichess.setState({ net: 'offline' }); await sleep(60000, ctrl.signal); continue }
    }
    if (ctrl.signal.aborted) break
    useLichess.setState({ net: 'offline' })
    await sleep(backoff(attempt++), ctrl.signal)
  }
}

function startEvents() {
  _evCtrl?.abort()
  _evCtrl = new AbortController()
  eventLoop(_evCtrl)
}

// ── Stream de la partida ──
export function joinGame(gameId: string) {
  useLichess.setState({ waiting: null })
  _waitCtrl?.abort()
  if (_game?.id === gameId && !_game.ctrl.signal.aborted) return
  stopGame()
  const ctrl = new AbortController()
  _game = { id: gameId, ctrl }
  gameLoop(gameId, ctrl)
}

export function stopGame() {
  _game?.ctrl.abort()
  _game = null
  useLichess.setState({ gameNet: 'loggedOut' })
}

async function gameLoop(id: string, ctrl: AbortController) {
  let attempt = 0
  const me = useLichess.getState().user?.id ?? ''
  while (!ctrl.signal.aborted) {
    useLichess.setState({ gameNet: 'connecting' })
    try {
      await streamNdjson(`/api/board/game/stream/${id}`, msg => {
        const g = useGame.getState()
        if (msg.type === 'gameFull') g.onlineFull(msg, me)
        else if (msg.type === 'gameState') g.onlineState(msg)
        else if (msg.type === 'opponentGone') g.onlineOpponentGone(msg)
      }, { signal: ctrl.signal, onOpen: () => { attempt = 0; useLichess.setState({ gameNet: 'online' }) } })
    } catch (e: any) {
      if (ctrl.signal.aborted) break
      if (e instanceof LichessError && (e.status === 404 || e.status === 400 || e.status === 401)) {
        useLichess.setState({ gameNet: 'loggedOut', error: `No se pudo abrir la partida: ${e.message}` })
        break
      }
      if (e instanceof LichessError && e.status === 429) { await sleep(60000, ctrl.signal); continue }
    }
    if (ctrl.signal.aborted) break
    // El servidor cierra el stream al terminar la partida
    if (useGame.getState().phase === 'over') { useLichess.setState({ gameNet: 'loggedOut' }); break }
    useLichess.setState({ gameNet: 'offline' })
    await sleep(backoff(attempt++), ctrl.signal)
  }
  if (_game?.ctrl === ctrl) _game = null
}

export const useLichess = create<LichessStore>((set, get) => ({
  user: null,
  net: 'loggedOut',
  gameNet: 'loggedOut',
  error: null,
  ongoing: [],
  incoming: [],
  waiting: null,

  init: async () => {
    if (!_loginChecked) {                    // el código OAuth solo se puede canjear una vez
      _loginChecked = true
      try {
        const t = await finishLogin()        // vuelta del login OAuth (?code=…)
        if (t) saveToken(t)
      } catch (e: any) { set({ error: e.message }) }
    }
    if (get().user && get().net !== 'offline') return   // ya iniciado
    const token = getToken()
    if (!token) return
    try {
      set({ net: 'connecting' })
      const u = await api.account()
      set({ user: { id: u.id, username: u.username } })
      startEvents()
    } catch (e: any) {
      if (e instanceof LichessError && e.status === 401) { saveToken(null); set({ net: 'loggedOut', error: e.message }) }
      else {
        // sin red: reintentar más tarde (el token se conserva)
        set({ net: 'offline' })
        window.addEventListener('online', () => get().init(), { once: true })
      }
    }
  },

  login: () => { startLogin() },

  loginWithToken: async (token) => {
    token = token.trim()
    if (!token) return
    try {
      const u = await api.account(token)
      saveToken(token)
      set({ user: { id: u.id, username: u.username }, error: null })
      startEvents()
    } catch (e: any) { set({ error: e.message }) }
  },

  logout: async () => {
    stopGame()
    _evCtrl?.abort()
    _waitCtrl?.abort()
    try { await api.revoke() } catch { /* el token puede estar ya revocado */ }
    saveToken(null)
    set({ user: null, net: 'loggedOut', ongoing: [], incoming: [], waiting: null })
  },

  play: async (o) => {
    if (!get().user) { set({ error: 'Inicia sesión en Lichess' }); return }
    _waitCtrl?.abort()
    const ctrl = new AbortController()
    _waitCtrl = ctrl
    set({ error: null })
    try {
      if (o.kind === 'ai') {
        set({ waiting: { kind: 'ai', text: `Creando partida contra la IA de Lichess (nivel ${o.level})…` } })
        const g = await api.challengeAi(o.level, o.baseMin * 60, o.incSec, o.color)
        joinGame(g.id)
      } else if (o.kind === 'user') {
        const name = o.username.trim()
        if (!name) { set({ error: 'Escribe el usuario a retar' }); return }
        set({ waiting: { kind: 'user', text: `Reto enviado a ${name}. Esperando que lo acepte…` } })
        // keepAliveStream: el reto sigue abierto mientras la conexión siga abierta
        // (sin él, Lichess lo cancela a los 20 s). Cerrar la conexión = cancelar el reto.
        await streamNdjson(`/api/challenge/${encodeURIComponent(name)}`, msg => {
          const c = msg.challenge ?? msg
          if (c?.id && get().waiting) set({ waiting: { ...get().waiting!, challengeId: c.id } })
        }, {
          signal: ctrl.signal, staleMs: 10 * 60000,
          form: { rated: o.rated, 'clock.limit': o.baseMin * 60, 'clock.increment': o.incSec, color: o.color, variant: 'standard', keepAliveStream: true },
        })
        // El stream terminó solo: si en unos segundos no empezó partida ni llegó un rechazo, avisar
        await sleep(3000)
        if (get().waiting?.kind === 'user' && !ctrl.signal.aborted) set({ waiting: null, error: 'El reto terminó sin respuesta' })
      } else {
        set({ waiting: { kind: 'seek', text: `Buscando rival en el lobby (${o.baseMin}+${o.incSec}${o.rated ? ', con rating' : ''})…` } })
        // El seek vive mientras la conexión siga abierta; se cierra al encontrar rival.
        await streamNdjson('/api/board/seek', () => {}, {
          signal: ctrl.signal, staleMs: 60000,
          form: { rated: o.rated, time: o.baseMin, increment: o.incSec, variant: 'standard' },
        })
        // El seek se cerró (rival encontrado o expirado): si no empezó partida, avisar
        await sleep(5000)
        if (get().waiting?.kind === 'seek' && !ctrl.signal.aborted) set({ waiting: null, error: 'La búsqueda terminó sin rival; vuelve a intentarlo' })
      }
    } catch (e: any) {
      if (isAbort(e) && ctrl.signal.aborted) return
      set({ waiting: null, error: e.message || String(e) })
    }
  },

  cancelWaiting: () => {
    const w = get().waiting
    _waitCtrl?.abort()
    if (w?.challengeId) api.challengeCancel(w.challengeId).catch(() => {})
    set({ waiting: null })
  },

  accept: async (id) => {
    try {
      set({ incoming: get().incoming.filter(i => i.id !== id), waiting: { kind: 'user', text: 'Aceptando reto…' } })
      await api.challengeAccept(id)
      joinGame(id)                     // el id del reto es el id de la partida
    } catch (e: any) { set({ waiting: null, error: e.message }) }
  },

  decline: async (id) => {
    set({ incoming: get().incoming.filter(i => i.id !== id) })
    try { await api.challengeDecline(id) } catch { /* noop */ }
  },

  clearError: () => set({ error: null }),
}))
