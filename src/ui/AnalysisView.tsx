import { useEffect, useMemo, useRef, useState } from 'react'
import { Chess, type Move } from 'chess.js'
import { engine, type SearchInfo } from '../engine/engine'
import { display } from '../game/session'
import { useLichess } from '../lichess/online'
import { placementOf } from '../board/placement'
import { MiniBoard } from './ClockScreen'

// Evaluación en centipeones desde el punto de vista de las BLANCAS (mate = ±1000)
function whiteCp(info: SearchInfo | null, fen: string): number | null {
  if (!info) return null
  const v = info.mate != null ? (info.mate > 0 ? 1000 : -1000) : Math.max(-1000, Math.min(1000, info.cp ?? 0))
  return fen.split(' ')[1] === 'b' ? -v : v
}

function fmtEval(info: SearchInfo | null, fen: string): string {
  if (!info) return '…'
  const blackToMove = fen.split(' ')[1] === 'b'
  if (info.mate != null) {
    const m = blackToMove ? -info.mate : info.mate
    return m > 0 ? `#${m} (mate de blancas)` : `#${-m} (mate de negras)`
  }
  const cp = (blackToMove ? -(info.cp ?? 0) : info.cp ?? 0) / 100
  return `${cp > 0 ? '+' : ''}${cp.toFixed(2)}`
}

function uciToSan(fen: string, uci?: string): string {
  if (!uci) return ''
  try { return new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san } catch { return uci }
}

type Mark = '??' | '?' | '?!' | ''
const MARK_ES: Record<string, string> = { '??': 'error grave', '?': 'error', '?!': 'imprecisión' }

export default function AnalysisView({ pgn, onClose }: { pgn: string; onClose: () => void }) {
  const ongoing = useLichess(s => s.ongoing)
  const moves = useMemo<Move[]>(() => {
    const c = new Chess()
    try { c.loadPgn(pgn) } catch { return [] }
    return c.history({ verbose: true })
  }, [pgn])
  const fens = useMemo(() => [moves[0]?.before ?? new Chess().fen(), ...moves.map(m => m.after)], [moves])

  const [idx, setIdx] = useState(fens.length - 1)
  const [info, setInfo] = useState<SearchInfo | null>(null)
  const [scan, setScan] = useState<{ done: number; evals: (number | null)[] } | null>(null)
  const token = useRef(0)

  // Juego limpio: sin análisis mientras haya partidas de Lichess abiertas
  const blocked = ongoing.length > 0

  // Evaluación de la posición actual
  useEffect(() => {
    if (blocked || (scan && scan.done < fens.length)) return
    const t = ++token.current
    setInfo(null)
    engine.fullStrength()
    engine.stop()
    engine.search(`position fen ${fens[idx]}`, 'go depth 15', i => { if (t === token.current && i.depth >= 8) setInfo(i) })
      .then(r => { if (t === token.current) setInfo(r.info) })
      .catch(() => {})
    // Cortar solo si esta búsqueda sigue siendo la vigente (no la de "Revisar errores")
    return () => { if (t === token.current) { token.current++; engine.stop() } }
  }, [idx, fens, blocked, scan?.done])

  // Revisar errores: evalúa todas las posiciones (profundidad 10) y marca las jugadas que pierden mucho
  const runScan = async () => {
    token.current++
    engine.stop()
    engine.fullStrength()
    const evals: (number | null)[] = []
    setScan({ done: 0, evals })
    for (let i = 0; i < fens.length; i++) {
      const c = new Chess(fens[i])
      if (c.isGameOver()) evals.push(c.isCheckmate() ? (c.turn() === 'w' ? -1000 : 1000) : 0)
      else {
        try { evals.push(whiteCp((await engine.search(`position fen ${fens[i]}`, 'go depth 10')).info, fens[i])) }
        catch { evals.push(null) }
      }
      setScan({ done: i + 1, evals: [...evals] })
    }
  }

  const marks: Mark[] = moves.map((m, i) => {
    const a = scan?.evals[i], b = scan?.evals[i + 1]
    if (a == null || b == null) return ''
    const loss = (a - b) * (m.color === 'w' ? 1 : -1)
    return loss >= 300 ? '??' : loss >= 150 ? '?' : loss >= 70 ? '?!' : ''
  })
  const scanning = !!scan && scan.done < fens.length

  const cur = idx > 0 ? moves[idx - 1] : null
  const label = (i: number) => `${Math.floor(i / 2) + 1}${i % 2 === 0 ? '.' : '…'} ${display(moves[i].san)}${marks[i]}`
  const pairs: number[] = []
  for (let i = 0; i < moves.length; i += 2) pairs.push(i)

  if (blocked) return (
    <div className="overlay">
      <h2>Análisis bloqueado</h2>
      <p className="reason">Tienes una partida de Lichess en curso. El análisis se habilita cuando no haya partidas abiertas.</p>
      <button className="big" onClick={onClose}>Volver</button>
    </div>
  )

  return (
    <div className="overlay analysis">
      <div className="an-board">
        <MiniBoard placement={placementOf(fens[idx])} bad={[]} marks={cur ? [cur.from, cur.to] : []} />
      </div>
      <div className="an-side">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ fontSize: 30 }}>Análisis</h2>
          <button onClick={onClose}>✕ Cerrar</button>
        </div>
        <div className="line">{cur ? label(idx - 1) : 'Posición inicial'}</div>
        <div className="huge">{scanning ? '…' : fmtEval(info, fens[idx])}</div>
        <div className="line">
          {!scanning && info?.pv?.[0] ? `Mejor: ${display(uciToSan(fens[idx], info.pv[0]))} · prof. ${info.depth}` : ''}
          {cur && marks[idx - 1] ? ` · ${MARK_ES[marks[idx - 1]]}` : ''}
        </div>
        <div className="row nav">
          <button onClick={() => setIdx(0)}>⏮</button>
          <button onClick={() => setIdx(Math.max(0, idx - 1))}>◀</button>
          <button onClick={() => setIdx(Math.min(fens.length - 1, idx + 1))}>▶</button>
          <button onClick={() => setIdx(fens.length - 1)}>⏭</button>
        </div>
        {!scan && <button onClick={runScan}>Revisar errores de la partida</button>}
        {scanning && <div className="line">Revisando… {scan!.done}/{fens.length}</div>}
        {scan && !scanning && (
          <div className="small">
            Errores graves: {marks.filter(m => m === '??').length} · errores: {marks.filter(m => m === '?').length} · imprecisiones: {marks.filter(m => m === '?!').length}
          </div>
        )}
        <div className="an-moves">
          {pairs.map(i => (
            <div key={i} className="an-pair">
              <span className={idx === i + 1 ? 'cur' : ''} onClick={() => setIdx(i + 1)}>{label(i)}</span>
              {moves[i + 1] && <span className={idx === i + 2 ? 'cur' : ''} onClick={() => setIdx(i + 2)}>{display(moves[i + 1].san)}{marks[i + 1]}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
