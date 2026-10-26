import { useBoard } from '../board/chessnut'
import { useGame } from '../game/session'

const STATUS: Record<string, string> = {
  disconnected: 'Desconectado', connecting: 'Conectando…', connected: 'Conectado', reconnecting: 'Reconectando…',
}

export default function BoardPanel() {
  const b = useBoard()
  const leds = useGame(s => s.settings.leds)
  const set = useGame(s => s.setSettings)

  return (
    <section>
      <h2>Tablero Chessnut</h2>
      {!b.available && <p className="err">Este navegador no tiene Web Bluetooth. Usa Chrome (por HTTPS o localhost).</p>}
      <div className="row">
        <span className="line" style={{ fontSize: 22, fontWeight: 700 }}>
          {STATUS[b.status]}{b.deviceName ? ` · ${b.deviceName}` : ''}
          {b.battery != null ? ` · Batería ${b.battery}%${b.charging ? ' (cargando)' : ''}` : ''}
        </span>
        {b.status === 'disconnected'
          ? <button onClick={() => b.connect()} disabled={!b.available}>Conectar tablero</button>
          : <button onClick={() => b.disconnect()}>Desconectar</button>}
        <button className={leds ? 'sel' : ''} onClick={() => set({ leds: !leds })}>LEDs guía: {leds ? 'Sí' : 'No'}</button>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <span className="muted">Espera antes de leer la jugada:</span>
        <button onClick={() => b.setMoveLatency(b.moveLatency - 100)}>−</button>
        <span className="line" style={{ fontSize: 24, fontWeight: 800, minWidth: 90, textAlign: 'center' }}>{b.moveLatency} ms</span>
        <button onClick={() => b.setMoveLatency(b.moveLatency + 100)}>+</button>
      </div>
      {b.error && <p className="err">{b.error}</p>}
      <p className="muted" style={{ margin: '8px 0 0' }}>
        El Chessnut acepta una sola conexión: cierra la app oficial y Mastira antes de conectar.
      </p>
    </section>
  )
}
