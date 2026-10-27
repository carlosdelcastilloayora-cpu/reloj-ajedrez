import { useState } from 'react'
import { useGame } from '../game/session'
import { flashScreen } from '../eink/eink'
import { glyph } from './ClockScreen'
import { api } from '../lichess/api'

// Menú durante una partida de Lichess: el reloj del servidor NO se detiene
function OnlineMenu() {
  const g = useGame()
  const on = g.online!
  const [confirmResign, setConfirmResign] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const act = (fn: () => Promise<unknown>, ok: string) =>
    fn().then(() => { setMsg(ok); }).catch(e => setMsg(e.message))
  const canAbort = g.moves.length < 2
  return (
    <div className="overlay">
      <h2>Menú — el reloj sigue corriendo</h2>
      <div className="menu">
        <button onClick={g.togglePause}>▶ Volver a la partida (P)</button>
        <button onClick={() => act(() => api.draw(on.gameId, true), 'Tablas ofrecidas')}>½ Ofrecer tablas</button>
        {canAbort
          ? <button onClick={() => act(() => api.abort(on.gameId), 'Partida abortada')}>Abortar partida</button>
          : confirmResign
            ? <button className="sel" onClick={() => act(() => api.resign(on.gameId), 'Te rendiste')}>¿Seguro? Rendirme</button>
            : <button onClick={() => setConfirmResign(true)}>⚑ Rendirme</button>}
        {g.opponentGone && <button onClick={() => act(() => api.claimVictory(on.gameId), 'Victoria reclamada')}>Reclamar victoria</button>}
        <button onClick={flashScreen}>Limpiar pantalla</button>
        <button onClick={g.leaveOnline}>Salir (la partida sigue en Lichess)</button>
      </div>
      {msg && <p className="reason">{msg}</p>}
    </div>
  )
}

export function PauseMenu() {
  const g = useGame()
  const [ending, setEnding] = useState(false)
  if (g.online) return <OnlineMenu />
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
  const pgn = g.settings.mode !== 'clock' ? g.pgn() : ''
  const copy = async () => {
    try { await navigator.clipboard.writeText(pgn); setCopied(true) } catch { setCopied(false) }
  }
  return (
    <div className="overlay">
      <div className="result">{g.result === '1/2-1/2' ? '½–½' : g.result === '*' ? '—' : g.result}</div>
      <div className="reason">{g.reason}</div>
      {pgn && <pre>{pgn}</pre>}
      <div className="menu">
        {g.online
          ? <a className="btnlink" href={`https://lichess.org/${g.online.gameId}`} target="_blank" rel="noreferrer">Ver en Lichess ↗</a>
          : <button onClick={g.newGame}>Revancha (mismo ritmo)</button>}
        <button onClick={g.toSetup}>Ajustes</button>
        {pgn && <button onClick={copy}>{copied ? 'PGN copiado ✓' : 'Copiar PGN'}</button>}
      </div>
    </div>
  )
}
