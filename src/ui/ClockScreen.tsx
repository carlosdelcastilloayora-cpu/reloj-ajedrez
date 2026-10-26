import { useEffect, useRef } from 'react'
import { useGame, display } from '../game/session'
import { useBoard } from '../board/chessnut'
import { clock, formatMs, type Side } from '../clock/clock'
import { flashScreen } from '../eink/eink'
import { placementMap, placementOf } from '../board/placement'
import type { ButtonId } from '../input/keys'

const GLYPH: Record<string, string> = {
  K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙', k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟',
}
export const glyph = (p: string) => (GLYPH[p] ?? '') + '︎'   // ︎ = forzar glifo de texto, no emoji

// Dígitos del reloj: se escriben directo en el DOM y SOLO cuando cambia el texto
// (sin re-render de React → la tinta solo refresca los dígitos que cambian).
function Time({ side }: { side: Side }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const upd = () => {
      const el = ref.current
      if (!el) return
      const t = formatMs(clock.get(side))
      if (el.textContent !== t) { el.textContent = t; el.dataset.len = String(t.length) }
    }
    upd()
    return clock.onTick(upd)
  }, [side])
  return <div className="time" ref={ref} />
}

function Half({ pos, side }: { pos: ButtonId; side: Side }) {
  const turn = useGame(s => s.turn)
  const phase = useGame(s => s.phase)
  const touch = useGame(s => s.settings.input === 'touch')
  const mode = useGame(s => s.settings.mode)
  const pending = useGame(s => s.pending)
  const press = useGame(s => s.press)
  const active = (phase === 'running' || phase === 'paused') && turn === side
  const flagged = phase === 'over' && clock.flagged === side
  const act = touch ? 'toca aquí' : `pulsa el botón ${pos === 'left' ? 'A' : 'L'}`

  let sub = ''
  if (flagged) sub = 'SIN TIEMPO'
  else if (active && pending) sub = `${display(pending.san)} · ${act} para confirmar`
  else if (active && phase === 'running' && (mode === 'clock' || touch)) sub = `${act} al terminar tu jugada`
  else if (phase === 'ready') sub = `${act} para empezar`

  return (
    <div className={`half${active ? ' active' : ''}${flagged ? ' flag' : ''}${touch ? ' touch' : ''}`}
      onPointerDown={e => { if (touch && e.isPrimary) press(pos) }}>
      <div className="bar" />
      <div className="who">{side === 'w' ? 'BLANCAS' : 'NEGRAS'}</div>
      <Time side={side} />
      <div className="sub">{sub}</div>
    </div>
  )
}

function MiniBoard({ placement, bad, marks }: { placement: string; bad: string[]; marks: string[] }) {
  const map = placementMap(placement)
  const cells = []
  for (let r = 8; r >= 1; r--) for (let f = 0; f < 8; f++) {
    const sq = String.fromCharCode(97 + f) + r
    const cls = ((f + r) % 2 === 1 ? 'l' : 'd') + (bad.includes(sq) ? ' bad' : marks.includes(sq) ? ' mv' : '')
    cells.push(<div key={sq} className={cls}><span className="glyph">{map[sq] ? glyph(map[sq]) : ''}</span></div>)
  }
  return <div className="mini">{cells}</div>
}

// Qué hay que corregir en cada casilla: poner / quitar / cambiar
function fixes(boardPl: string, expectedPl: string, squares: string[]): string[] {
  const got = placementMap(boardPl), exp = placementMap(expectedPl)
  return squares.map(sq => {
    const g = got[sq], e = exp[sq]
    if (e && !g) return `${sq}: poner ${glyph(e)}`
    if (!e && g) return `${sq}: quitar ${glyph(g)}`
    return `${sq}: ${glyph(g)}→${glyph(e)}`
  })
}

function Status() {
  const g = useGame()
  const lastPlacement = useBoard(s => s.lastPlacement)
  const expected = placementOf(g.fen)
  const board = g.settings.mode === 'board'
  const lm = g.lastMove

  let main: JSX.Element
  if (g.notice) {
    main = <div className="notice">{g.notice}</div>
  } else if (g.phase === 'ready') {
    main = !board || g.sync === 'ok'
      ? <><div className="line">Listo. Toca o pulsa cualquier lado para empezar:</div><div className="huge">arrancan las blancas</div></>
      : g.sync === 'nodata'
        ? <div className="huge">Conecta el tablero</div>
        : <><div className="line">Coloca la posición inicial</div><div className="small">{fixes(lastPlacement ?? '', expected, g.diff).join(' · ')}</div></>
  } else if (board && g.sync === 'mismatch') {
    main = <><div className="line">El tablero no coincide</div>
      <div className="small">{fixes(lastPlacement ?? '', expected, g.diff).slice(0, 8).join(' · ')}</div></>
  } else if (board && g.sync === 'nodata') {
    main = <div className="huge">Sin lectura del tablero</div>
  } else if (board && g.pending) {
    main = <><div className="line">{g.settings.input === 'touch' ? 'Pendiente — confirma tocando tu lado del reloj' : 'Pendiente — confirma con tu botón'}</div><div className="huge">{display(g.pending.san)}</div></>
  } else if (lm) {
    main = <><div className="line">Última jugada</div>
      <div className="huge">{lm.num} {display(lm.san)} <span className="small">{lm.from}→{lm.to}</span></div></>
  } else if (!board) {
    main = <div className="huge">{g.clockMoves ? `Jugada ${Math.floor(g.clockMoves / 2) + 1}` : 'En juego'}</div>
  } else {
    main = <div className="huge">Juegan blancas</div>
  }

  const showMini = board && (g.sync === 'mismatch' || (g.phase !== 'ready' && g.sync !== 'nodata'))
  const pairs: string[] = []
  for (let i = 0; i < g.moves.length; i += 2) {
    pairs.push(`${i / 2 + 1}. ${display(g.moves[i])} ${g.moves[i + 1] ? display(g.moves[i + 1]) : ''}`)
  }

  return (
    <div className="status">
      {showMini && <MiniBoard placement={expected} bad={g.sync === 'mismatch' ? g.diff : []} marks={lm ? [lm.from, lm.to] : []} />}
      <div className="msg">{main}</div>
      {board && <div className="moves">{pairs.slice(-7).map((p, i) => <div key={i}>{p}</div>)}</div>}
    </div>
  )
}

function TopBar() {
  const phase = useGame(s => s.phase)
  const s = useGame(st => st.settings)
  const togglePause = useGame(st => st.togglePause)
  const toSetup = useGame(st => st.toSetup)
  const b = useBoard()
  const boardTxt = s.mode !== 'board' ? 'Solo reloj'
    : b.status === 'connected' ? `Tablero ✓${b.battery != null ? ` ${b.battery}%` : ''}`
      : b.status === 'reconnecting' ? 'Tablero: reconectando…' : 'Tablero: desconectado'
  return (
    <div className="topbar">
      {phase === 'ready' || phase === 'over'
        ? <button onClick={toSetup}>‹ Ajustes</button>
        : <button onClick={togglePause}>❚❚ Pausa (P)</button>}
      <div className="info">{s.baseMin}+{s.incSec}{s.delaySec ? ` d${s.delaySec}` : ''} · {boardTxt}</div>
      {s.mode === 'board' && b.status === 'disconnected' && <button onClick={() => b.connect()}>Conectar</button>}
      <button onClick={flashScreen}>Limpiar</button>
    </div>
  )
}

export default function ClockScreen() {
  const whiteLeft = useGame(s => s.settings.whiteLeft)
  return (
    <div className="game">
      <TopBar />
      <div className="clocks">
        <Half pos="left" side={whiteLeft ? 'w' : 'b'} />
        <Half pos="right" side={whiteLeft ? 'b' : 'w'} />
      </div>
      <Status />
    </div>
  )
}
