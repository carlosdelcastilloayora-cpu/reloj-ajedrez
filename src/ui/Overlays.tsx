import { useState } from 'react'
import { useGame } from '../game/session'
import { flashScreen } from '../eink/eink'
import { glyph } from './ClockScreen'

export function PauseMenu() {
  const g = useGame()
  const [ending, setEnding] = useState(false)
  const canUndo = g.settings.mode === 'clock' ? g.clockMoves > 0 : g.moves.length > 0

  if (ending) return (
    <div className="overlay">
      <h2>Terminar partida</h2>
      <div className="menu">
        <button onClick={() => g.finish('1-0', 'Acordado / abandono')}>Ganan blancas</button>
        <button onClick={() => g.finish('0-1', 'Acordado / abandono')}>Ganan negras</button>
        <button onClick={() => g.finish('1/2-1/2', 'Tablas acordadas')}>Tablas</button>
        <button onClick={() => setEnding(false)}>Volver</button>
      </div>
    </div>
  )

  return (
    <div className="overlay">
      <h2>Pausa</h2>
      <div className="menu">
        <button onClick={g.togglePause}>▶ Reanudar (P)</button>
        <button onClick={g.undo} disabled={!canUndo}>↶ Deshacer jugada</button>
        <button onClick={flashScreen}>Limpiar pantalla</button>
        <button onClick={() => setEnding(true)}>Terminar partida</button>
        <button onClick={g.toSetup}>Abandonar y ajustes</button>
      </div>
      {g.settings.mode === 'board' && g.moves.length > 0 &&
        <p className="muted">Al deshacer, regresa también las piezas en el tablero.</p>}
    </div>
  )
}

export function Promotion() {
  const choose = useGame(s => s.choosePromotion)
  const white = useGame(s => s.turn === 'w')
  const opts: ['q' | 'r' | 'b' | 'n', string][] = [['q', 'Dama'], ['r', 'Torre'], ['b', 'Alfil'], ['n', 'Caballo']]
  return (
    <div className="overlay">
      <h2>Promoción: elige pieza</h2>
      <div className="promo">
        {opts.map(([p, name]) => (
          <button key={p} onClick={() => choose(p)}>
            <span className="glyph">{glyph(white ? p.toUpperCase() : p)}</span>{name}
          </button>
        ))}
      </div>
      <button onClick={() => choose(null)}>Cancelar</button>
    </div>
  )
}

export function GameOver() {
  const g = useGame()
  const [copied, setCopied] = useState(false)
  const pgn = g.settings.mode === 'board' ? g.pgn() : ''
  const copy = async () => {
    try { await navigator.clipboard.writeText(pgn); setCopied(true) } catch { setCopied(false) }
  }
  return (
    <div className="overlay">
      <div className="result">{g.result === '1/2-1/2' ? '½–½' : g.result}</div>
      <div className="reason">{g.reason}</div>
      {pgn && <pre>{pgn}</pre>}
      <div className="menu">
        <button onClick={g.newGame}>Revancha (mismo ritmo)</button>
        <button onClick={g.toSetup}>Ajustes</button>
        {pgn && <button onClick={copy}>{copied ? 'PGN copiado ✓' : 'Copiar PGN'}</button>}
      </div>
    </div>
  )
}
