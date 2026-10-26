import { create } from 'zustand'
import { Chess, type Move } from 'chess.js'
import { useBoard } from '../board/chessnut'
import { diffSquares, findMove, findPawnPromotion, placementOf, sanEs } from '../board/placement'
import { clock, other, type Side } from '../clock/clock'
import { beep, flashScreen, keepAwake } from '../eink/eink'
import type { ButtonId } from '../input/keys'

// ── Ajustes (persisten en localStorage) ──
export type Mode = 'board' | 'clock'
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
}

const SETTINGS_KEY = 'reloj.settings'
const DEFAULTS: Settings = {
  mode: 'board', baseMin: 10, incSec: 5, delaySec: 0, whiteLeft: true, input: 'touch',
  flashAfterMove: false, flashEverySec: 0, leds: true, spanish: true,
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
}

let _chess = new Chess()
let _noticeTimer: number | null = null
let _ledKey = ''

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
  checkGameEnd()
  // re-evaluar con la última lectura (por si el tablero ya va por delante)
  useGame.getState().onPlacement()
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
    set({
      phase: 'ready', fen: _chess.fen(), turn: 'w', moves: [], lastMove: null, pending: null,
      promoChoice: null, sync: 'nodata', diff: [], result: null, reason: null, notice: null, clockMoves: 0,
    })
    get().onPlacement()
    keepAwake(true)
  },

  toSetup: () => {
    clock.stop()
    keepAwake(false)
    setLedsIfChanged([])
    set({ phase: 'setup', pending: null, promoChoice: null })
  },

  // Botón físico (o tecla / toque)
  press: (b) => {
    const s = get()
    if (b === 'menu') { s.togglePause(); return }
    const side: Side = (b === 'left') === s.settings.whiteLeft ? 'w' : 'b'

    if (s.phase === 'ready') {
      if (s.settings.mode === 'board' && s.sync !== 'ok') {
        notice(s.sync === 'nodata' ? 'Conecta el tablero' : 'Coloca las piezas en la posición inicial')
        return
      }
      clock.start('w')            // cualquiera de los dos botones arranca el reloj de las blancas
      set({ phase: 'running', turn: 'w' })
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
    if (phase === 'running') { clock.pause(); set({ phase: 'paused' }) }
    else if (phase === 'paused') { clock.resume(); set({ phase: 'running' }); get().onPlacement() }
  },

  undo: () => {
    const s = get()
    if (s.settings.mode === 'clock') {
      if (s.clockMoves === 0) return
      clock.setTurn(other(s.turn))
      set({ turn: other(s.turn), clockMoves: s.clockMoves - 1 })
      return
    }
    const m = _chess.undo()
    if (!m) return
    const hist = _chess.history({ verbose: true })
    const prev = hist[hist.length - 1]
    const n = Math.ceil(hist.length / 2)
    clock.setTurn(m.color as Side)
    set({
      fen: _chess.fen(), turn: _chess.turn() as Side, moves: _chess.history(), pending: null, promoChoice: null,
      lastMove: prev ? { from: prev.from, to: prev.to, san: prev.san, num: prev.color === 'w' ? `${n}.` : `${n}…`, color: prev.color as Side } : null,
    })
    get().onPlacement()   // el tablero ahora debe volver a la posición anterior
  },

  finish: (result, reason) => {
    clock.stop()
    keepAwake(false)
    _chess.setHeader('Result', result)
    set({ phase: 'over', result, reason, pending: null, promoChoice: null })
    beep(660, 250, 2)
  },

  // Reevalúa el tablero físico contra la partida (lo llama el Chessnut tras el debounce,
  // y también al confirmar, reanudar o deshacer).
  onPlacement: () => {
    const s = get()
    if (s.settings.mode !== 'board' || s.phase === 'setup') return
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
    if (s.phase === 'running' || s.phase === 'paused') {
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
}))

// ── Enlaces con el tablero y el reloj ──
useBoard.getState().setMoveHandler(() => useGame.getState().onPlacement())

useBoard.subscribe((b, prev) => {
  if (b.status === prev.status) return
  const g = useGame.getState()
  // Tablero caído a mitad de partida (modo tablero) → pausa automática para no perder tiempo
  if (b.status !== 'connected' && g.phase === 'running' && g.settings.mode === 'board') {
    g.togglePause()
    notice('Tablero desconectado: reloj en pausa')
    beep(440, 300)
  }
  g.onPlacement()
})

clock.onFlag((side) => {
  const g = useGame.getState()
  if (g.phase !== 'running') return
  const winner = other(side)
  if (g.settings.mode === 'board' && cannotMate(winner)) g.finish('1/2-1/2', 'Tiempo agotado; el rival no puede dar mate')
  else g.finish(winner === 'w' ? '1-0' : '0-1', `Tiempo agotado (${side === 'w' ? 'blancas' : 'negras'})`)
})

export { display }
