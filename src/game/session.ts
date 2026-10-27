import { create } from 'zustand'
import { Chess, DEFAULT_POSITION, type Move } from 'chess.js'
import { useBoard } from '../board/chessnut'
import { diffSquares, findMove, findPawnPromotion, placementOf, sanEs } from '../board/placement'
import { clock, other, type Side } from '../clock/clock'
import { beep, flashScreen, keepAwake } from '../eink/eink'
import type { ButtonId } from '../input/keys'
import { api, uciToMove, type Opponent } from '../lichess/api'
import { stopGame } from '../lichess/online'
import { engine, setEngineLock } from '../engine/engine'
import { saveGame } from '../storage/games'

// ── Ajustes (persisten en localStorage) ──
export type Mode = 'board' | 'clock' | 'lichess' | 'engine'
// Dónde se pulsa el reloj: 'touch' = en la propia tablet (tocar tu mitad de la pantalla);
// 'external' = botones ESP32 (teclado BLE). El teclado funciona en ambos modos (útil para probar).
export type InputMode = 'touch' | 'external'
export interface Settings {
  mode: Mode              // 'board' = dos jugadores con Chessnut; 'clock' = solo reloj
  baseMin: number
  incSec: number
  delaySec: number
  whiteLeft: boolean      // blancas en el botón izquierdo ('a')
  input: InputMode
  flashAfterMove: boolean
  flashEverySec: number   // 0 = nunca
  leds: boolean           // LEDs del Chessnut marcan las casillas que no coinciden
  spanish: boolean        // notación española (C, A, T, D, R)
  // Lichess
  meLeft: boolean         // mi reloj a la izquierda (con un solo jugador humano)
  lcOpponent: Opponent    // 'ai' | 'user' | 'seek'
  lcLevel: number         // IA 1–8
  lcUser: string          // usuario o bot a retar
  lcColor: 'random' | 'white' | 'black'
  lcRated: boolean
  // Stockfish (sin internet)
  sfStrength: 'skill' | 'elo'
  sfSkill: number         // Skill Level 0–20
  sfElo: number           // UCI_Elo 1320–3190
  sfColor: 'random' | 'white' | 'black'
  sfFast: boolean         // true = responde en 1–2 s; false = administra su propio reloj
}

const SETTINGS_KEY = 'reloj.settings'
const DEFAULTS: Settings = {
  mode: 'board', baseMin: 10, incSec: 5, delaySec: 0, whiteLeft: true, input: 'touch',
  flashAfterMove: false, flashEverySec: 0, leds: true, spanish: true,
  meLeft: true, lcOpponent: 'ai', lcLevel: 3, lcUser: '', lcColor: 'random', lcRated: false,
  sfStrength: 'skill', sfSkill: 5, sfElo: 1500, sfColor: 'white', sfFast: true,
}
function loadSettings(): Settings {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') } } catch { return DEFAULTS }
}

export type Phase = 'setup' | 'ready' | 'running' | 'paused' | 'over'
// Estado del tablero físico respecto a la partida
//   ok       = coincide con la posición actual
//   pending  = coincide con la posición tras una jugada legal (jugada pendiente de confirmar)
//   mismatch = no coincide (piezas levantadas, mal colocadas, jugada ilegal)
//   nodata   = sin tablero / sin lectura
export type Sync = 'ok' | 'pending' | 'mismatch' | 'nodata'

export interface Pending { from: string; to: string; san: string; uci: string; needsChoice: boolean }
export interface LastMove { from: string; to: string; san: string; num: string; color: Side }
export interface PlayerInfo { name: string; rating?: number }
/** Partida de un humano contra un rival remoto (Lichess o Stockfish). */
export interface Seat { myColor: Side; white: PlayerInfo; black: PlayerInfo }
export interface OnlineInfo extends Seat { gameId: string; rated: boolean; speed: string }

interface GameStore {
  settings: Settings
  phase: Phase
  fen: string
  turn: Side
  moves: string[]            // SAN (inglés, para PGN)
  lastMove: LastMove | null
  pending: Pending | null
  promoChoice: { from: string; to: string } | null
  sync: Sync
  diff: string[]
  result: string | null      // '1-0' | '0-1' | '1/2-1/2'
  reason: string | null
  notice: string | null      // aviso breve (se borra solo)
  clockMoves: number         // jugadas en modo solo reloj
  leftSide: Side             // color cuyo reloj va a la izquierda
  online: OnlineInfo | null  // partida de Lichess en curso
  offer: { draw: boolean; takeback: boolean }   // ofertas del rival (Lichess)
  opponentGone: { claimAt: number } | null      // rival desconectado: se puede reclamar desde claimAt
  engineSeat: Seat | null    // partida contra Stockfish
  thinking: boolean          // Stockfish está pensando

  setSettings: (p: Partial<Settings>) => void
  newGame: () => void
  toSetup: () => void
  press: (b: ButtonId) => void
  choosePromotion: (piece: 'q' | 'r' | 'b' | 'n' | null) => void
  togglePause: () => void
  undo: () => void
  finish: (result: string, reason: string) => void
  onPlacement: () => void
  pgn: () => string
  history: () => Move[]
  onlineFull: (full: any, myId: string) => void
  onlineState: (st: any, initial?: boolean) => void
  onlineOpponentGone: (msg: any) => void
  leaveOnline: () => void
}

let _chess = new Chess()
let _noticeTimer: number | null = null
let _ledKey = ''
// Lichess
let _initialFen = DEFAULT_POSITION
let _serverCount = 0          // jugadas confirmadas por el servidor
let _lastState: any = null    // último gameState (para resincronizar si una jugada falla)
// Stockfish
let _think = 0                // ficha de la búsqueda vigente (las anteriores se descartan)

const display = (san: string) => (useGame.getState().settings.spanish ? sanEs(san) : san)

function setLedsIfChanged(squares: string[]) {
  const b = useBoard.getState()
  if (b.status !== 'connected') { _ledKey = ''; return }
  const key = squares.join(',')
  if (key === _ledKey) return
  _ledKey = key
  b.setLeds(squares)
}

function notice(msg: string) {
  if (_noticeTimer) clearTimeout(_noticeTimer)
  useGame.setState({ notice: msg })
  _noticeTimer = window.setTimeout(() => useGame.setState({ notice: null }), 2500)
}

// Material insuficiente del lado que NO perdió por tiempo → tablas (regla FIDE simplificada:
// solo rey, rey+alfil o rey+caballo no pueden dar mate).
function cannotMate(side: Side): boolean {
  const pieces = _chess.board().flat().filter(p => p && p.color === side && p.type !== 'k')
  if (pieces.length === 0) return true
  return pieces.length === 1 && (pieces[0]!.type === 'b' || pieces[0]!.type === 'n')
}

function checkGameEnd() {
  const g = _chess
  const s = useGame.getState()
  if (g.isCheckmate()) s.finish(g.turn() === 'w' ? '0-1' : '1-0', 'Jaque mate')
  else if (g.isStalemate()) s.finish('1/2-1/2', 'Rey ahogado')
  else if (g.isInsufficientMaterial()) s.finish('1/2-1/2', 'Material insuficiente')
  else if (g.isThreefoldRepetition()) s.finish('1/2-1/2', 'Triple repetición')
  else if (g.isDrawByFiftyMoves()) s.finish('1/2-1/2', 'Regla de 50 jugadas')
}

function commit(m: { from: string; to: string; promotion?: string }) {
  const s = useGame.getState()
  const online = s.settings.mode === 'lichess' ? s.online : null
  const side = _chess.turn() as Side
  let mv: Move
  try { mv = _chess.move(m) } catch { notice('Jugada ilegal'); return }
  clock.press(side)
  const fullmove = Math.ceil(_chess.history().length / 2)
  useGame.setState({
    fen: _chess.fen(),
    turn: _chess.turn() as Side,
    moves: _chess.history(),
    lastMove: { from: mv.from, to: mv.to, san: mv.san, num: side === 'w' ? `${fullmove}.` : `${fullmove}…`, color: side },
    pending: null,
    promoChoice: null,
    sync: 'ok',
    diff: [],
  })
  if (s.settings.flashAfterMove) flashScreen()
  if (online) {
    // Se aplica en local al instante (reloj fluido); el servidor confirma con el siguiente gameState.
    api.move(online.gameId, mv.from + mv.to + (mv.promotion ?? '')).catch(e => {
      notice(`Lichess rechazó la jugada: ${e.message}`)
      if (_lastState) useGame.getState().onlineState(_lastState, true)   // volver al estado del servidor
    })
  } else checkGameEnd()                 // en línea el fin de partida lo decide el servidor
  // re-evaluar con la última lectura (por si el tablero ya va por delante)
  useGame.getState().onPlacement()
  maybeEngine()
}

// ── Stockfish ──
/** Si es turno de Stockfish, lanza la búsqueda y juega su respuesta. */
function maybeEngine() {
  const s = useGame.getState()
  const seat = s.engineSeat
  if (s.settings.mode !== 'engine' || !seat || s.phase !== 'running' || s.turn === seat.myColor) return
  const token = ++_think
  const side = s.turn
  useGame.setState({ thinking: true })
  const ucis = _chess.history({ verbose: true }).map(m => m.from + m.to + (m.promotion ?? ''))
  const position = ucis.length ? `position startpos moves ${ucis.join(' ')}` : 'position startpos'
  const inc = clock.cfg.incMs
  const go = s.settings.sfFast
    ? `go movetime ${700 + Math.floor(Math.random() * 1300)}`
    : `go wtime ${Math.round(clock.get('w'))} btime ${Math.round(clock.get('b'))} winc ${inc} binc ${inc}`
  engine.search(position, go).then(r => {
    if (token !== _think) return          // búsqueda cancelada (pausa, deshacer, fin…)
    useGame.setState({ thinking: false })
    const g = useGame.getState()
    if (g.phase !== 'running' || g.turn !== side || !r.bestmove) return
    commit(uciToMove(_chess, r.bestmove))
    beep(880, 150)                        // aviso: jugó Stockfish
  }).catch(e => {
    if (token !== _think) return
    useGame.setState({ thinking: false })
    notice(`Stockfish: ${e.message}`)
  })
}

function cancelEngine() {
  if (useGame.getState().thinking) engine.stop()
  _think++
  useGame.setState({ thinking: false })
}

export const useGame = create<GameStore>((set, get) => ({
  settings: loadSettings(),
  phase: 'setup',
  fen: _chess.fen(),
  turn: 'w',
  moves: [],
  lastMove: null,
  pending: null,
  promoChoice: null,
  sync: 'nodata',
  diff: [],
  result: null,
  reason: null,
  notice: null,
  clockMoves: 0,
  leftSide: 'w',
  online: null,
  offer: { draw: false, takeback: false },
  opponentGone: null,
  engineSeat: null,
  thinking: false,

  setSettings: (p) => {
    const settings = { ...get().settings, ...p }
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)) } catch { /* noop */ }
    set({ settings })
  },

  newGame: () => {
    const { settings } = get()
    _chess = new Chess()
    _chess.setHeader('Event', 'Reloj Ajedrez')
    _chess.setHeader('Date', new Date().toISOString().slice(0, 10).replace(/-/g, '.'))
    _chess.setHeader('TimeControl', `${settings.baseMin * 60}+${settings.incSec}`)
    clock.reset({ baseMs: settings.baseMin * 60000, incMs: settings.incSec * 1000, delayMs: settings.delaySec * 1000 })
    _ledKey = ''
    cancelEngine()
    let engineSeat: Seat | null = null
    let leftSide: Side = settings.whiteLeft ? 'w' : 'b'
    if (settings.mode === 'engine') {
      const myColor: Side = settings.sfColor === 'white' ? 'w' : settings.sfColor === 'black' ? 'b' : Math.random() < 0.5 ? 'w' : 'b'
      const sf: PlayerInfo = {
        name: settings.sfStrength === 'elo' ? `Stockfish ${settings.sfElo}` : `Stockfish nivel ${settings.sfSkill}`,
        rating: settings.sfStrength === 'elo' ? settings.sfElo : undefined,
      }
      const me: PlayerInfo = { name: 'Yo' }
      engineSeat = { myColor, white: myColor === 'w' ? me : sf, black: myColor === 'w' ? sf : me }
      leftSide = settings.meLeft ? myColor : other(myColor)
      engine.setStrength({ kind: settings.sfStrength, skill: settings.sfSkill, elo: settings.sfElo })
      engine.warmup()
    }
    _chess.setHeader('White', engineSeat?.white.name ?? 'Blancas')
    _chess.setHeader('Black', engineSeat?.black.name ?? 'Negras')
    set({
      phase: 'ready', fen: _chess.fen(), turn: 'w', moves: [], lastMove: null, pending: null,
      promoChoice: null, sync: 'nodata', diff: [], result: null, reason: null, notice: null, clockMoves: 0,
      leftSide, online: null, offer: { draw: false, takeback: false }, opponentGone: null, engineSeat, thinking: false,
    })
    get().onPlacement()
    keepAwake(true)
  },

  toSetup: () => {
    if (get().online) stopGame()      // la partida de Lichess sigue en el servidor; se puede retomar
    cancelEngine()
    clock.stop()
    keepAwake(false)
    setLedsIfChanged([])
    set({ phase: 'setup', pending: null, promoChoice: null })
  },

  // Botón físico (o tecla / toque)
  press: (b) => {
    const s = get()
    if (b === 'menu') { s.togglePause(); return }
    const side: Side = b === 'left' ? s.leftSide : other(s.leftSide)

    const seat = s.settings.mode === 'lichess' ? s.online : s.settings.mode === 'engine' ? s.engineSeat : null
    if (seat && s.phase !== 'ready') {
      const on = seat
      if (s.phase !== 'running' || s.promoChoice) return
      if (side !== on.myColor) return          // el lado del rival no tiene botón: juega Lichess / Stockfish
      if (s.turn !== on.myColor) { notice(s.engineSeat ? 'Piensa Stockfish' : 'Es turno del rival'); return }
      get().onPlacement()
      const p = get().pending
      if (!p) { notice(get().sync === 'mismatch' ? 'El tablero no coincide' : 'Primero mueve en el tablero'); return }
      if (p.needsChoice) { set({ promoChoice: { from: p.from, to: p.to } }); return }
      commit({ from: p.from, to: p.to, promotion: p.uci.slice(4) || undefined })
      return
    }

    if (s.phase === 'ready') {
      if ((s.settings.mode === 'board' || s.settings.mode === 'engine') && s.sync !== 'ok') {
        notice(s.sync === 'nodata' ? 'Conecta el tablero' : 'Coloca las piezas en la posición inicial')
        return
      }
      clock.start('w')            // cualquiera de los dos botones arranca el reloj de las blancas
      set({ phase: 'running', turn: 'w' })
      maybeEngine()               // si Stockfish lleva blancas, empieza a pensar
      return
    }
    if (s.phase !== 'running' || s.promoChoice) return
    if (side !== s.turn) return   // botón del lado que no juega: se ignora

    if (s.settings.mode === 'clock') {
      clock.press(side)
      set({ turn: other(side), clockMoves: s.clockMoves + 1 })
      if (s.settings.flashAfterMove) flashScreen()
      return
    }

    // Modo tablero: confirmar la jugada pendiente con la lectura más reciente
    get().onPlacement()
    const p = get().pending
    if (!p) {
      notice(get().sync === 'mismatch' ? 'El tablero no coincide' : 'Primero mueve en el tablero')
      return
    }
    if (p.needsChoice) { set({ promoChoice: { from: p.from, to: p.to } }); return }
    commit({ from: p.from, to: p.to, promotion: p.uci.slice(4) || undefined })
  },

  choosePromotion: (piece) => {
    const pc = get().promoChoice
    if (!pc) return
    if (!piece) { set({ promoChoice: null }); return }
    commit({ from: pc.from, to: pc.to, promotion: piece })
  },

  togglePause: () => {
    const { phase } = get()
    // En Lichess el reloj lo lleva el servidor: el menú no lo detiene
    if (get().settings.mode === 'lichess') {
      if (phase === 'running') set({ phase: 'paused' })
      else if (phase === 'paused') { set({ phase: 'running' }); get().onPlacement() }
      return
    }
    if (phase === 'running') { cancelEngine(); clock.pause(); set({ phase: 'paused' }) }
    else if (phase === 'paused') { clock.resume(); set({ phase: 'running' }); get().onPlacement(); maybeEngine() }
  },

  undo: () => {
    const s = get()
    if (s.settings.mode === 'lichess') return
    if (s.settings.mode === 'clock') {
      if (s.clockMoves === 0) return
      clock.setTurn(other(s.turn))
      set({ turn: other(s.turn), clockMoves: s.clockMoves - 1 })
      return
    }
    let m: Move | null
    if (s.engineSeat) {
      // Contra Stockfish se deshace hasta volver a MI turno (su jugada y la mía)
      cancelEngine()
      const me = s.engineSeat.myColor
      const undone: Move[] = []
      while (_chess.history().length && (undone.length === 0 || (_chess.turn() as Side) !== me)) {
        const u = _chess.undo()
        if (!u) break
        undone.push(u)
      }
      if ((_chess.turn() as Side) !== me) {           // no había jugada mía que deshacer
        for (const u of undone.reverse()) _chess.move(u)
        return
      }
      m = undone[undone.length - 1] ?? null
    } else m = _chess.undo()
    if (!m) return
    const hist = _chess.history({ verbose: true })
    const prev = hist[hist.length - 1]
    const n = Math.ceil(hist.length / 2)
    clock.setTurn(_chess.turn() as Side)
    set({
      fen: _chess.fen(), turn: _chess.turn() as Side, moves: _chess.history(), pending: null, promoChoice: null,
      lastMove: prev ? { from: prev.from, to: prev.to, san: prev.san, num: prev.color === 'w' ? `${n}.` : `${n}…`, color: prev.color as Side } : null,
    })
    get().onPlacement()   // el tablero ahora debe volver a la posición anterior
  },

  finish: (result, reason) => {
    cancelEngine()
    clock.stop()
    keepAwake(false)
    _chess.setHeader('Result', result)
    set({ phase: 'over', result, reason, pending: null, promoChoice: null })
    beep(660, 250, 2)
    // Guardar la partida en la tablet (IndexedDB)
    const s = get()
    if (s.settings.mode !== 'clock' && _chess.history().length > 0) {
      const h = _chess.getHeaders()
      saveGame({
        id: Date.now(), date: new Date().toISOString(),
        source: s.settings.mode === 'lichess' ? 'lichess' : s.settings.mode === 'engine' ? 'engine' : 'board',
        white: h.White ?? 'Blancas', black: h.Black ?? 'Negras', result, reason,
        timeControl: s.online ? s.online.speed : `${s.settings.baseMin}+${s.settings.incSec}`,
        pgn: _chess.pgn(), lichessUrl: s.online ? `https://lichess.org/${s.online.gameId}` : undefined,
      })
    }
  },

  // Reevalúa el tablero físico contra la partida (lo llama el Chessnut tras el debounce,
  // y también al confirmar, reanudar o deshacer).
  onPlacement: () => {
    const s = get()
    if (s.settings.mode === 'clock' || s.phase === 'setup') return
    if (s.settings.mode === 'lichess' && !s.online) return
    const board = useBoard.getState()
    const placement = board.lastPlacement
    if (board.status !== 'connected' || !placement) {
      set({ sync: 'nodata', diff: [], pending: null })
      return
    }
    const current = placementOf(s.fen)
    if (placement === current) {
      set({ sync: 'ok', diff: [], pending: null })
      setLedsIfChanged([])
      return
    }
    // En Lichess solo se detecta jugada propia en tu turno; en el del rival el tablero debe
    // quedarse quieto (o reproducir su jugada).
    const seat = s.settings.mode === 'lichess' ? s.online : s.settings.mode === 'engine' ? s.engineSeat : null
    const myTurn = s.settings.mode === 'board' || (!!seat && s.turn === seat.myColor)
    if ((s.phase === 'running' || s.phase === 'paused') && myTurn) {
      const m = findMove(s.fen, placement)
      if (m) {
        set({ sync: 'pending', diff: [], pending: { from: m.from, to: m.to, san: m.san, uci: m.from + m.to + (m.promotion ?? ''), needsChoice: false } })
        setLedsIfChanged([])
        return
      }
      const pp = findPawnPromotion(s.fen, placement)
      if (pp) {
        set({ sync: 'pending', diff: [], pending: { ...pp, san: `${pp.to}=?`, uci: pp.from + pp.to, needsChoice: true } })
        setLedsIfChanged([])
        return
      }
    }
    const diff = diffSquares(placement, current)
    set({ sync: 'mismatch', diff, pending: null })
    setLedsIfChanged(s.settings.leds ? diff : [])
  },

  pgn: () => _chess.pgn(),
  history: () => _chess.history({ verbose: true }),

  // ── Lichess ──
  onlineFull: (full, myId) => {
    const s = get()
    const myColor: Side = full.white?.id === myId ? 'w' : 'b'
    const pl = (p: any): PlayerInfo => ({
      name: p?.aiLevel ? `IA Lichess nivel ${p.aiLevel}` : `${p?.title ? p.title + ' ' : ''}${p?.name ?? p?.id ?? '?'}`,
      rating: p?.rating,
    })
    const same = s.online?.gameId === full.id
    _initialFen = !full.initialFen || full.initialFen === 'startpos' ? DEFAULT_POSITION : full.initialFen
    if (!same) { _serverCount = 0; _ledKey = '' }
    clock.reset({ baseMs: full.clock?.initial ?? 0, incMs: full.clock?.increment ?? 0, delayMs: 0 })
    const online: OnlineInfo = {
      gameId: full.id, myColor, white: pl(full.white), black: pl(full.black), rated: !!full.rated, speed: full.speed ?? '',
    }
    if (s.settings.mode !== 'lichess') s.setSettings({ mode: 'lichess' })
    set({
      online, engineSeat: null, thinking: false, phase: 'running', leftSide: s.settings.meLeft ? myColor : other(myColor),
      result: null, reason: null, pending: null, promoChoice: null, opponentGone: null,
      ...(same ? {} : { sync: 'nodata' as Sync, diff: [], lastMove: null }),
    })
    keepAwake(true)
    get().onlineState(full.state, !same)
  },

  onlineState: (st, initial = false) => {
    const on = get().online
    if (!on || !st) return
    _lastState = st
    const ucis: string[] = (st.moves ?? '').trim().split(' ').filter(Boolean)
    const c = rebuild(on, ucis)
    // ¿Cambió algo respecto a lo local? (si solo confirma mi jugada optimista, no)
    if (c.fen() !== _chess.fen() || c.history().length !== _chess.history().length) _chess = c
    const isNew = ucis.length > _serverCount
    _serverCount = ucis.length
    const hist = _chess.history({ verbose: true })
    const lm = hist[hist.length - 1]
    const turn = _chess.turn() as Side
    // Los relojes de Lichess no corren hasta que cada bando hizo su primera jugada
    clock.sync(st.wtime ?? 0, st.btime ?? 0, st.status === 'started' && ucis.length >= 2 ? turn : null)
    const opp = other(on.myColor)
    const n = Math.ceil(hist.length / 2)
    set({
      fen: _chess.fen(), turn, moves: _chess.history(),
      lastMove: lm ? { from: lm.from, to: lm.to, san: lm.san, num: lm.color === 'w' ? `${n}.` : `${n}…`, color: lm.color as Side } : null,
      offer: { draw: !!(opp === 'w' ? st.wdraw : st.bdraw), takeback: !!(opp === 'w' ? st.wtakeback : st.btakeback) },
    })
    // Jugada nueva del rival: aviso sonoro (y limpieza si está activada)
    if (isNew && !initial && lm && lm.color === opp) {
      beep(880, 150)
      if (get().settings.flashAfterMove) flashScreen()
    }
    if (st.status && st.status !== 'started' && st.status !== 'created') {
      const w = st.winner
      const result = w === 'white' ? '1-0' : w === 'black' ? '0-1'
        : st.status === 'aborted' || st.status === 'noStart' ? '*' : '1/2-1/2'
      if (get().phase !== 'over') get().finish(result, STATUS_ES[st.status] ?? 'Partida terminada')
      return
    }
    get().onPlacement()
  },

  onlineOpponentGone: (msg) => {
    if (msg.gone) {
      set({ opponentGone: { claimAt: Date.now() + (msg.claimWinInSeconds ?? 0) * 1000 } })
      notice('El rival se desconectó')
    } else set({ opponentGone: null })
  },

  leaveOnline: () => { stopGame(); get().toSetup() },
}))

const STATUS_ES: Record<string, string> = {
  mate: 'Jaque mate', resign: 'Abandono', stalemate: 'Rey ahogado', timeout: 'El rival abandonó la partida',
  draw: 'Tablas', outoftime: 'Tiempo agotado', cheat: 'Trampa detectada', aborted: 'Partida abortada',
  noStart: 'La partida no empezó', unknownFinish: 'Partida terminada', insufficientMaterialClaim: 'Material insuficiente',
  variantEnd: 'Fin de variante',
}

// Reconstruye la partida a partir de las jugadas UCI del servidor (con cabeceras PGN)
function rebuild(on: OnlineInfo, ucis: string[]): Chess {
  const c = new Chess(_initialFen)
  c.setHeader('Event', `Lichess ${on.rated ? 'con rating' : 'amistosa'}`)
  c.setHeader('Site', `https://lichess.org/${on.gameId}`)
  c.setHeader('Date', new Date().toISOString().slice(0, 10).replace(/-/g, '.'))
  c.setHeader('White', on.white.name)
  c.setHeader('Black', on.black.name)
  if (on.white.rating) c.setHeader('WhiteElo', String(on.white.rating))
  if (on.black.rating) c.setHeader('BlackElo', String(on.black.rating))
  for (const u of ucis) {
    try { c.move(uciToMove(c, u)) } catch { break }
  }
  return c
}

/** true mientras hay una partida en línea: el motor y el análisis deben estar bloqueados. */
export const onlineLocked = () => {
  const s = useGame.getState()
  return s.settings.mode === 'lichess' && !!s.online && (s.phase === 'running' || s.phase === 'paused')
}

// ── Enlaces con el tablero y el reloj ──
useBoard.getState().setMoveHandler(() => useGame.getState().onPlacement())

useBoard.subscribe((b, prev) => {
  if (b.status === prev.status) return
  const g = useGame.getState()
  // Tablero caído a mitad de partida (modo tablero) → pausa automática para no perder tiempo
  if (b.status !== 'connected' && g.phase === 'running' && (g.settings.mode === 'board' || g.settings.mode === 'engine')) {
    g.togglePause()
    notice('Tablero desconectado: reloj en pausa')
    beep(440, 300)
  } else if (b.status !== 'connected' && g.phase === 'running' && g.settings.mode === 'lichess') {
    notice('Tablero desconectado: el reloj de Lichess sigue corriendo')   // no se puede pausar en línea
    beep(440, 300)
  }
  g.onPlacement()
})

clock.onFlag((side) => {
  const g = useGame.getState()
  if (g.phase !== 'running' || g.settings.mode === 'lichess') return   // en línea decide el servidor
  const winner = other(side)
  if ((g.settings.mode === 'board' || g.settings.mode === 'engine') && cannotMate(winner)) g.finish('1/2-1/2', 'Tiempo agotado; el rival no puede dar mate')
  else g.finish(winner === 'w' ? '1-0' : '0-1', `Tiempo agotado (${side === 'w' ? 'blancas' : 'negras'})`)
})

export { display }

// Juego limpio: el motor no funciona mientras haya una partida de Lichess en curso
setEngineLock(onlineLocked)
