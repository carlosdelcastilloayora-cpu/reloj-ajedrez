import { useState } from 'react'
import { useGame } from '../game/session'
import { joinGame, useLichess } from '../lichess/online'
import { PERSONAL_TOKEN_URL } from '../lichess/auth'
import { speedOf, SPEED_ES, timeControlError } from '../lichess/api'
import { enterFullscreen } from '../eink/eink'

const NET_ES = { loggedOut: 'sin sesión', connecting: 'conectando…', online: 'en línea', offline: 'sin conexión, reintentando…' }

function Account() {
  const lc = useLichess()
  const [token, setToken] = useState('')
  const [showToken, setShowToken] = useState(false)

  if (lc.user) return (
    <div className="row">
      <span className="line" style={{ fontSize: 22, fontWeight: 800 }}>{lc.user.username} · {NET_ES[lc.net]}</span>
      <button onClick={() => lc.logout()}>Cerrar sesión</button>
    </div>
  )
  return (
    <>
      <div className="row">
        <button onClick={lc.login}>Iniciar sesión con Lichess</button>
        <button className={showToken ? 'sel' : ''} onClick={() => setShowToken(!showToken)}>Usar token personal</button>
      </div>
      {showToken && (
        <div className="row" style={{ marginTop: 10 }}>
          <input className="text" type="password" placeholder="lip_…" value={token} onChange={e => setToken(e.target.value)} autoComplete="off" />
          <button onClick={() => lc.loginWithToken(token)} disabled={!token.trim()}>Guardar</button>
          <a className="muted" href={PERSONAL_TOKEN_URL} target="_blank" rel="noreferrer">Crear token en Lichess ↗</a>
        </div>
      )}
      <p className="muted" style={{ margin: '8px 0 0' }}>Permisos: jugar con tablero (board:play) y crear retos (challenge:write). El token se guarda solo en esta tablet.</p>
    </>
  )
}

export default function LichessPanel() {
  const s = useGame(st => st.settings)
  const set = useGame(st => st.setSettings)
  const lc = useLichess()
  const err = timeControlError(s.lcOpponent, s.baseMin, s.incSec)

  return (
    <section>
      <h2>Lichess</h2>
      <Account />
      {lc.error && <p className="err" onClick={lc.clearError}>{lc.error} ✕</p>}

      {lc.user && <>
        {lc.incoming.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <h2>Retos recibidos</h2>
            {lc.incoming.map(i => (
              <div className="row" key={i.id} style={{ marginBottom: 8 }}>
                <span className="line" style={{ fontSize: 22, fontWeight: 700 }}>
                  {i.from}{i.rating ? ` (${i.rating})` : ''} · {i.tc} · {i.rated ? 'con rating' : 'amistosa'}
                </span>
                <button onClick={() => { enterFullscreen(); lc.accept(i.id) }}>Aceptar</button>
                <button onClick={() => lc.decline(i.id)}>Rechazar</button>
              </div>
            ))}
          </div>
        )}

        {lc.ongoing.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <h2>Partidas en curso</h2>
            {lc.ongoing.map(g => (
              <div className="row" key={g.gameId} style={{ marginBottom: 8 }}>
                <span className="line" style={{ fontSize: 22, fontWeight: 700 }}>
                  vs {g.opponent} · {g.color === 'white' ? 'blancas' : 'negras'}{g.isMyTurn ? ' · tu turno' : ''}
                </span>
                {g.board
                  ? <button onClick={() => { enterFullscreen(); joinGame(g.gameId) }}>Continuar</button>
                  : <span className="muted">(ritmo no permitido por la Board API)</span>}
              </div>
            ))}
          </div>
        )}

        <div style={{ marginTop: 12 }}>
          <h2>Rival</h2>
          <div className="row">
            <button className={s.lcOpponent === 'ai' ? 'sel' : ''} onClick={() => set({ lcOpponent: 'ai' })}>IA de Lichess</button>
            <button className={s.lcOpponent === 'user' ? 'sel' : ''} onClick={() => set({ lcOpponent: 'user' })}>Retar a usuario o bot</button>
            <button className={s.lcOpponent === 'seek' ? 'sel' : ''} onClick={() => set({ lcOpponent: 'seek' })}>Buscar en el lobby</button>
          </div>

          {s.lcOpponent === 'ai' && (
            <div className="row" style={{ marginTop: 10 }}>
              <span className="muted">Nivel:</span>
              {[1, 2, 3, 4, 5, 6, 7, 8].map(l => (
                <button key={l} className={s.lcLevel === l ? 'sel' : ''} style={{ minWidth: 64 }} onClick={() => set({ lcLevel: l })}>{l}</button>
              ))}
            </div>
          )}
          {s.lcOpponent === 'user' && (
            <div className="row" style={{ marginTop: 10 }}>
              <span className="muted">Usuario:</span>
              <input className="text" placeholder="nombre de usuario o bot" value={s.lcUser}
                onChange={e => set({ lcUser: e.target.value })} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
            </div>
          )}
          {s.lcOpponent !== 'seek' && (
            <div className="row" style={{ marginTop: 10 }}>
              <span className="muted">Juego con:</span>
              {(['white', 'random', 'black'] as const).map(c => (
                <button key={c} className={s.lcColor === c ? 'sel' : ''} onClick={() => set({ lcColor: c })}>
                  {c === 'white' ? 'Blancas' : c === 'black' ? 'Negras' : 'Al azar'}
                </button>
              ))}
            </div>
          )}
          {s.lcOpponent !== 'ai' && (
            <div className="row" style={{ marginTop: 10 }}>
              <button className={s.lcRated ? 'sel' : ''} onClick={() => set({ lcRated: !s.lcRated })}>
                Con rating: {s.lcRated ? 'Sí' : 'No'}
              </button>
            </div>
          )}
          <p className="muted" style={{ margin: '8px 0 0' }}>
            Ritmo {s.baseMin}+{s.incSec} = {SPEED_ES[speedOf(s.baseMin * 60, s.incSec)]}.
            {' '}Lobby: solo rápidas y clásicas · IA y retos: también blitz · nunca bullet.
          </p>
          {err && <p className="err">{err}</p>}
        </div>
      </>}
    </section>
  )
}

/** Botón de inicio en modo Lichess (crea la partida según el tipo de rival). */
export function LichessStart() {
  const s = useGame(st => st.settings)
  const lc = useLichess()
  const err = timeControlError(s.lcOpponent, s.baseMin, s.incSec)
  const disabled = !lc.user || lc.net !== 'online' || !!err || (s.lcOpponent === 'user' && !s.lcUser.trim())
  const label = s.lcOpponent === 'ai' ? `Jugar contra la IA (nivel ${s.lcLevel})`
    : s.lcOpponent === 'user' ? `Retar a ${s.lcUser.trim() || '…'}` : 'Buscar rival'
  return (
    <button className="big" disabled={disabled} onClick={() => {
      enterFullscreen()
      lc.play({ kind: s.lcOpponent, baseMin: s.baseMin, incSec: s.incSec, level: s.lcLevel, username: s.lcUser, color: s.lcColor, rated: s.lcRated })
    }}>{lc.user ? label : 'Inicia sesión en Lichess'}</button>
  )
}

/** Capa de espera mientras se crea la partida / se busca rival. */
export function WaitingOverlay() {
  const w = useLichess(s => s.waiting)
  const cancel = useLichess(s => s.cancelWaiting)
  if (!w) return null
  return (
    <div className="overlay">
      <h2>Lichess</h2>
      <div className="reason">{w.text}</div>
      <p className="muted">La partida empieza sola en cuanto Lichess la cree.</p>
      <button className="big" onClick={cancel}>Cancelar</button>
    </div>
  )
}
