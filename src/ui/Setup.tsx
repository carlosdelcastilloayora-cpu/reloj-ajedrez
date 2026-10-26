import { useGame } from '../game/session'
import { enterFullscreen } from '../eink/eink'
import BoardPanel from './BoardPanel'
import { useEffect, useState } from 'react'
import { listenButtons, type ButtonId } from '../input/keys'

const PRESETS: [number, number][] = [
  [1, 0], [2, 1], [3, 0], [3, 2], [5, 0], [5, 3], [10, 0], [10, 5], [15, 10], [30, 0], [30, 20], [90, 30],
]

function Stepper({ label, value, onChange, min, max, step, unit }: {
  label: string; value: number; onChange: (v: number) => void; min: number; max: number; step: (v: number, dir: 1 | -1) => number; unit: string
}) {
  return (
    <div className="stepper">
      <span className="muted">{label}</span>
      <button onClick={() => onChange(Math.max(min, value - step(value, -1)))} aria-label={`menos ${label}`}>−</button>
      <span className="val">{value}<span className="muted"> {unit}</span></span>
      <button onClick={() => onChange(Math.min(max, value + step(value, 1)))} aria-label={`más ${label}`}>+</button>
    </div>
  )
}

const minStep = (v: number, dir: 1 | -1) => (dir === 1 ? (v >= 30 ? 15 : v >= 10 ? 5 : 1) : (v > 30 ? 15 : v > 10 ? 5 : 1))

// Prueba en vivo de los botones del ESP32 (o del teclado): muestra la última tecla recibida
function ButtonTest() {
  const [last, setLast] = useState<{ b: ButtonId; n: number } | null>(null)
  useEffect(() => listenButtons(b => setLast(l => ({ b, n: (l?.n ?? 0) + 1 }))), [])
  const name: Record<ButtonId, string> = { left: 'Izquierdo (A)', right: 'Derecho (L)', menu: 'Ambos largo = menú (P)' }
  return (
    <div style={{ marginTop: 10 }}>
      <p className="muted" style={{ margin: 0 }}>
        Empareja el ESP32 en Ajustes de Android → Bluetooth (aparece como <b>Reloj Ajedrez</b>) y pulsa sus botones para probar:
      </p>
      <div className="line" style={{ fontSize: 30, fontWeight: 800, border: '3px solid #000', padding: '8px 14px', marginTop: 8, display: 'inline-block', minWidth: 420 }}>
        {last ? `${name[last.b]} · #${last.n}` : 'Esperando pulsación…'}
      </div>
      <p className="muted" style={{ margin: '8px 0 0' }}>Sin ESP32 también sirve un teclado Bluetooth: <b>A</b> izquierdo · <b>L</b> derecho · <b>P</b> pausa/menú.</p>
    </div>
  )
}

export default function Setup() {
  const s = useGame(st => st.settings)
  const set = useGame(st => st.setSettings)
  const newGame = useGame(st => st.newGame)

  const start = () => { enterFullscreen(); newGame() }

  return (
    <div className="setup">
      <h1>Reloj Ajedrez</h1>

      <section>
        <h2>Modo</h2>
        <div className="row">
          <button className={s.mode === 'board' ? 'sel' : ''} onClick={() => set({ mode: 'board' })}>Dos jugadores con tablero</button>
          <button className={s.mode === 'clock' ? 'sel' : ''} onClick={() => set({ mode: 'clock' })}>Solo reloj</button>
          <button disabled>Lichess (fase 2)</button>
          <button disabled>Stockfish (fase 3)</button>
        </div>
      </section>

      <section>
        <h2>Ritmo: {s.baseMin}+{s.incSec}{s.delaySec ? ` · demora ${s.delaySec}s` : ''}</h2>
        <div className="grid-btn">
          {PRESETS.map(([m, i]) => (
            <button key={`${m}+${i}`} className={s.baseMin === m && s.incSec === i ? 'sel' : ''}
              onClick={() => set({ baseMin: m, incSec: i })}>{m}+{i}</button>
          ))}
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <Stepper label="Minutos" value={s.baseMin} min={1} max={180} step={minStep} unit="min" onChange={v => set({ baseMin: v })} />
          <Stepper label="Incremento" value={s.incSec} min={0} max={60} step={() => 1} unit="s" onChange={v => set({ incSec: v })} />
          <Stepper label="Demora" value={s.delaySec} min={0} max={30} step={() => 1} unit="s" onChange={v => set({ delaySec: v })} />
        </div>
      </section>

      <section>
        <h2>Cómo se pulsa el reloj</h2>
        <div className="row">
          <button className={s.input === 'touch' ? 'sel' : ''} onClick={() => set({ input: 'touch' })}>En la pantalla de la tablet</button>
          <button className={s.input === 'external' ? 'sel' : ''} onClick={() => set({ input: 'external' })}>Botones externos (ESP32)</button>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <span className="muted">Blancas a la:</span>
          <button className={s.whiteLeft ? 'sel' : ''} onClick={() => set({ whiteLeft: true })}>Izquierda{s.input === 'external' ? ' (A)' : ''}</button>
          <button className={!s.whiteLeft ? 'sel' : ''} onClick={() => set({ whiteLeft: false })}>Derecha{s.input === 'external' ? ' (L)' : ''}</button>
        </div>
        {s.input === 'touch'
          ? <p className="muted" style={{ margin: '8px 0 0' }}>Cada jugador toca <b>su mitad</b> de la pantalla al terminar su jugada. Los toques del lado que no juega se ignoran. Pausa con el botón de arriba.</p>
          : <ButtonTest />}
      </section>

      {s.mode === 'board' && <BoardPanel />}

      <section>
        <h2>Pantalla</h2>
        <div className="row">
          <button className={s.flashAfterMove ? 'sel' : ''} onClick={() => set({ flashAfterMove: !s.flashAfterMove })}>
            Limpiar tras cada jugada: {s.flashAfterMove ? 'Sí' : 'No'}
          </button>
          <span className="muted">Limpiar cada:</span>
          {[0, 30, 60, 120, 300].map(n => (
            <button key={n} className={s.flashEverySec === n ? 'sel' : ''} onClick={() => set({ flashEverySec: n })}>
              {n === 0 ? 'Nunca' : n < 60 ? `${n} s` : `${n / 60} min`}
            </button>
          ))}
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button className={s.spanish ? 'sel' : ''} onClick={() => set({ spanish: true })}>Notación Cf3</button>
          <button className={!s.spanish ? 'sel' : ''} onClick={() => set({ spanish: false })}>Notación Nf3</button>
        </div>
      </section>

      <div className="start">
        <button className="big" onClick={start}>Comenzar partida</button>
      </div>
    </div>
  )
}
