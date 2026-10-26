export type Side = 'w' | 'b'
export const other = (s: Side): Side => (s === 'w' ? 'b' : 'w')

export interface ClockConfig {
  baseMs: number      // tiempo inicial por jugador
  incMs: number       // incremento Fischer: se suma al terminar cada jugada
  delayMs: number     // demora simple: los primeros N ms de cada turno no descuentan
}

type Listener = () => void

// Reloj de ajedrez puro (sin UI). Lleva el tiempo con performance.now() para no acumular
// deriva por intervalos. Emite 'tick' cada 100 ms mientras corre y 'flag' al caer una bandera.
export class ChessClock {
  ms: Record<Side, number> = { w: 0, b: 0 }
  running: Side | null = null          // lado cuyo reloj corre (null = detenido)
  paused = false
  flagged: Side | null = null
  delayLeft = 0
  cfg: ClockConfig = { baseMs: 300000, incMs: 0, delayMs: 0 }

  private last = 0
  private timer: number | null = null
  private tickL = new Set<Listener>()
  private flagL = new Set<(s: Side) => void>()

  reset(cfg: ClockConfig) {
    this.stopTimer()
    this.cfg = cfg
    this.ms = { w: cfg.baseMs, b: cfg.baseMs }
    this.running = null
    this.paused = false
    this.flagged = null
    this.delayLeft = 0
    this.emit()
  }

  /** Arranca el reloj de `side` (inicio de partida). */
  start(side: Side) {
    this.running = side
    this.paused = false
    this.delayLeft = this.cfg.delayMs
    this.startTimer()
    this.emit()
  }

  /** `side` terminó su jugada: suma incremento y pasa el turno al rival. */
  press(side: Side) {
    if (this.running !== side || this.flagged) return
    this.update()
    if (this.flagged) return
    this.ms[side] += this.cfg.incMs
    this.running = other(side)
    this.delayLeft = this.cfg.delayMs
    this.last = performance.now()
    if (!this.paused) this.startTimer()
    this.emit()
  }

  /** Cambia el turno sin incremento (deshacer jugada). */
  setTurn(side: Side) {
    this.update()
    this.running = side
    this.delayLeft = this.cfg.delayMs
    this.last = performance.now()
    this.emit()
  }

  pause() {
    if (this.paused || !this.running) return
    this.update()
    this.paused = true
    this.stopTimer()
    this.emit()
  }

  resume() {
    if (!this.paused) return
    this.paused = false
    if (this.running && !this.flagged) this.startTimer()
    this.emit()
  }

  stop() {
    this.update()
    this.stopTimer()
    this.running = null
    this.emit()
  }

  /** Tiempos oficiales del servidor (Lichess): reemplazan los locales. */
  sync(wMs: number, bMs: number, running: Side | null) {
    this.ms = { w: wMs, b: bMs }
    this.running = running
    this.delayLeft = 0
    this.last = performance.now()
    if (running && !this.paused) this.startTimer(); else this.stopTimer()
    this.emit()
  }

  /** Tiempo restante actual de `side` en ms. */
  get(side: Side): number {
    if (this.running === side && this.timer !== null) {
      let dt = performance.now() - this.last
      dt -= Math.min(dt, this.delayLeft)
      return Math.max(0, this.ms[side] - dt)
    }
    return Math.max(0, this.ms[side])
  }

  /** Demora restante del turno actual (ms). */
  getDelay(): number {
    if (!this.running || this.timer === null) return this.delayLeft
    return Math.max(0, this.delayLeft - (performance.now() - this.last))
  }

  onTick(fn: Listener) { this.tickL.add(fn); return () => { this.tickL.delete(fn) } }
  onFlag(fn: (s: Side) => void) { this.flagL.add(fn); return () => { this.flagL.delete(fn) } }

  private update() {
    if (!this.running || this.timer === null) return
    const now = performance.now()
    let dt = now - this.last
    this.last = now
    const d = Math.min(dt, this.delayLeft)
    this.delayLeft -= d
    dt -= d
    this.ms[this.running] -= dt
    if (this.ms[this.running] <= 0) {
      this.ms[this.running] = 0
      this.flagged = this.running
      this.stopTimer()
      this.emit()
      this.flagL.forEach(f => f(this.flagged!))
    }
  }

  private startTimer() {
    this.last = performance.now()
    if (this.timer !== null) return
    this.timer = window.setInterval(() => { this.update(); this.emit() }, 100)
  }

  private stopTimer() {
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null }
  }

  private emit() { this.tickL.forEach(f => f()) }
}

/** Formato de pantalla: h:mm:ss · m:ss · s.d (décimas solo bajo 10 s). */
export function formatMs(ms: number): string {
  if (ms < 10000) {
    const t = Math.floor(Math.max(0, ms) / 100)
    return `${Math.floor(t / 10)}.${t % 10}`
  }
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60
  const p = (n: number) => String(n).padStart(2, '0')
  return h ? `${h}:${p(m)}:${p(ss)}` : `${m}:${p(ss)}`
}

export const clock = new ChessClock()
