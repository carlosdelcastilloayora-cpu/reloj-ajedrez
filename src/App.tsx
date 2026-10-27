import { useEffect } from 'react'
import { useGame } from './game/session'
import { listenButtons } from './input/keys'
import { flashScreen } from './eink/eink'
import Setup from './ui/Setup'
import ClockScreen from './ui/ClockScreen'
import { GameOver, PauseMenu, Promotion } from './ui/Overlays'
import { WaitingOverlay } from './ui/LichessPanel'
import { useLichess } from './lichess/online'

export default function App() {
  const phase = useGame(s => s.phase)
  const promo = useGame(s => s.promoChoice)
  const flashEvery = useGame(s => s.settings.flashEverySec)

  // Lichess: completar el login OAuth si volvemos de lichess.org, y abrir el stream de eventos
  useEffect(() => { useLichess.getState().init() }, [])

  // Botones del reloj (ESP32 / teclado): activos en toda la app salvo en la configuración
  useEffect(() => listenButtons(b => { if (useGame.getState().phase !== 'setup') useGame.getState().press(b) }), [])

  // Limpieza periódica de la tinta durante la partida
  useEffect(() => {
    if (phase !== 'running' || !flashEvery) return
    const t = window.setInterval(flashScreen, flashEvery * 1000)
    return () => clearInterval(t)
  }, [phase, flashEvery])

  if (phase === 'setup') return <><Setup /><WaitingOverlay /></>
  return (
    <>
      <ClockScreen />
      {phase === 'paused' && <PauseMenu />}
      {phase === 'over' && <GameOver />}
      {promo && phase === 'running' && <Promotion />}
    </>
  )
}
