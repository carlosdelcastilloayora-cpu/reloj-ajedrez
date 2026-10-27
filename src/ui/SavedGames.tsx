import { useEffect, useState } from 'react'
import { deleteGame, listGames, type SavedGame } from '../storage/games'
import AnalysisView from './AnalysisView'

const SRC_ES = { board: 'Dos jugadores', engine: 'Stockfish', lichess: 'Lichess' }

export default function SavedGames() {
  const [open, setOpen] = useState(false)
  const [games, setGames] = useState<SavedGame[]>([])
  const [copied, setCopied] = useState<number | null>(null)
  const [confirmDel, setConfirmDel] = useState<number | null>(null)
  const [analyse, setAnalyse] = useState<string | null>(null)

  useEffect(() => { if (open) listGames().then(setGames) }, [open])

  const copy = async (g: SavedGame) => {
    try { await navigator.clipboard.writeText(g.pgn); setCopied(g.id) } catch { /* sin portapapeles */ }
  }
  const del = async (id: number) => {
    if (confirmDel !== id) { setConfirmDel(id); return }
    await deleteGame(id)
    setConfirmDel(null)
    setGames(await listGames())
  }

  return (
    <section>
      <h2>Partidas guardadas</h2>
      <button onClick={() => setOpen(!open)}>{open ? 'Ocultar' : 'Ver partidas guardadas en la tablet'}</button>
      {open && games.length === 0 && <p className="muted">Todavía no hay partidas. Se guardan solas al terminar (tablero, Stockfish y Lichess).</p>}
      {open && games.slice(0, 30).map(g => (
        <div key={g.id} className="saved">
          <div className="line" style={{ fontSize: 20, fontWeight: 700 }}>
            {new Date(g.date).toLocaleDateString()} · {SRC_ES[g.source]} · {g.white} – {g.black} · <b>{g.result === '1/2-1/2' ? '½–½' : g.result}</b>
            <span className="muted"> · {g.reason} · {g.timeControl}</span>
          </div>
          <div className="row">
            {g.source !== 'lichess' && <button onClick={() => setAnalyse(g.pgn)}>Analizar</button>}
            <button onClick={() => copy(g)}>{copied === g.id ? 'PGN copiado ✓' : 'Copiar PGN'}</button>
            {g.lichessUrl && <a className="muted" href={g.lichessUrl} target="_blank" rel="noreferrer">Ver en Lichess ↗</a>}
            <button className={confirmDel === g.id ? 'sel' : ''} onClick={() => del(g.id)}>{confirmDel === g.id ? '¿Borrar? Sí' : 'Borrar'}</button>
          </div>
        </div>
      ))}
      {analyse && <AnalysisView pgn={analyse} onClose={() => setAnalyse(null)} />}
    </section>
  )
}
