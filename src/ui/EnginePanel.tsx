import { useEffect, useState } from 'react'
import { useGame } from '../game/session'

const ELO_STEPS = [1320, 1400, 1500, 1600, 1700, 1800, 1900, 2000, 2200, 2400, 2600, 2800, 3000, 3190]

/** Comprueba si el motor y su red neuronal ya están guardados para jugar sin internet. */
function useOfflineReady(): 'ready' | 'partial' | 'none' | 'unknown' {
  const [st, setSt] = useState<'ready' | 'partial' | 'none' | 'unknown'>('unknown')
  useEffect(() => {
    if (!('caches' in window)) return
    const base = document.baseURI
    Promise.all([
      caches.match(new URL('stockfish/stockfish-nnue-16-single.wasm', base).href),
      caches.match(new URL('stockfish/nn-5af11540bbfe.nnue', base).href),
    ]).then(([w, n]) => setSt(w && n ? 'ready' : w ? 'partial' : 'none')).catch(() => {})
  }, [])
  return st
}

export default function EnginePanel() {
  const s = useGame(st => st.settings)
  const set = useGame(st => st.setSettings)
  const offline = useOfflineReady()

  return (
    <section>
      <h2>Stockfish (sin internet)</h2>
      <div className="row">
        <button className={s.sfStrength === 'skill' ? 'sel' : ''} onClick={() => set({ sfStrength: 'skill' })}>Por nivel (0–20)</button>
        <button className={s.sfStrength === 'elo' ? 'sel' : ''} onClick={() => set({ sfStrength: 'elo' })}>Por Elo (1320–3190)</button>
      </div>

      {s.sfStrength === 'skill' ? (
        <div className="row" style={{ marginTop: 10 }}>
          <span className="muted">Nivel:</span>
          <button onClick={() => set({ sfSkill: Math.max(0, s.sfSkill - 1) })} style={{ width: 64 }}>−</button>
          <span className="line" style={{ fontSize: 30, fontWeight: 800, minWidth: 60, textAlign: 'center' }}>{s.sfSkill}</span>
          <button onClick={() => set({ sfSkill: Math.min(20, s.sfSkill + 1) })} style={{ width: 64 }}>+</button>
          {[0, 3, 5, 8, 12, 16, 20].map(n => (
            <button key={n} className={s.sfSkill === n ? 'sel' : ''} style={{ minWidth: 60 }} onClick={() => set({ sfSkill: n })}>{n}</button>
          ))}
        </div>
      ) : (
        <div className="grid-btn" style={{ marginTop: 10 }}>
          {ELO_STEPS.map(e => (
            <button key={e} className={s.sfElo === e ? 'sel' : ''} onClick={() => set({ sfElo: e })}>{e}</button>
          ))}
        </div>
      )}

      <div className="row" style={{ marginTop: 10 }}>
        <span className="muted">Juego con:</span>
        {(['white', 'random', 'black'] as const).map(c => (
          <button key={c} className={s.sfColor === c ? 'sel' : ''} onClick={() => set({ sfColor: c })}>
            {c === 'white' ? 'Blancas' : c === 'black' ? 'Negras' : 'Al azar'}
          </button>
        ))}
      </div>

      <div className="row" style={{ marginTop: 10 }}>
        <span className="muted">Stockfish responde:</span>
        <button className={s.sfFast ? 'sel' : ''} onClick={() => set({ sfFast: true })}>Rápido (1–2 s)</button>
        <button className={!s.sfFast ? 'sel' : ''} onClick={() => set({ sfFast: false })}>Administrando su reloj</button>
      </div>

      <p className="muted" style={{ margin: '8px 0 0' }}>
        {offline === 'ready' && 'Listo para modo avión: el motor y su red neuronal están guardados en la tablet.'}
        {offline === 'partial' && 'Motor guardado; la red neuronal (40 MB) aún se está descargando. Sin ella juega con evaluación clásica.'}
        {offline === 'none' && 'El motor aún no está guardado para jugar sin internet: abre la app con conexión y espera un momento.'}
        {offline === 'unknown' && 'Cualquier ritmo, incluido bullet. Análisis al terminar la partida.'}
      </p>
    </section>
  )
}
