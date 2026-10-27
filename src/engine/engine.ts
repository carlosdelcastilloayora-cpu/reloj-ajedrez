// Stockfish 16 (WASM, un solo hilo) en un Web Worker. GitHub Pages no permite los headers
// COOP/COEP que necesita la versión multihilo.
//
// La red NNUE (nn-5af11540bbfe.nnue, 40 MB) la descarga el propio motor al empezar a pensar,
// desde la misma carpeta. El service worker la deja en caché para jugar sin internet; si aun
// así no se puede cargar, el motor se reinicia con la evaluación clásica (sin red).
//
// Juego limpio: mientras haya una partida de Lichess en curso el motor se niega a funcionar.

export interface SearchInfo { depth: number; cp: number | null; mate: number | null; pv: string[] }
export interface SearchResult { bestmove: string; info: SearchInfo | null }
export interface Strength { kind: 'skill' | 'elo'; skill: number; elo: number }

const ENGINE_URL = 'stockfish/stockfish-nnue-16-single.js'
const NNUE_FAIL = 'network file was not loaded'

let _locked: () => boolean = () => false
/** La sesión registra aquí su comprobación de "partida en línea en curso". */
export function setEngineLock(fn: () => boolean) { _locked = fn }

class Engine {
  private w: Worker | null = null
  private ready: Promise<void> | null = null
  private listener: ((line: string) => void) | null = null
  private chain: Promise<unknown> = Promise.resolve()
  private strengthCmds: string[] = []
  nnue = true                          // false si la red no se pudo cargar (evaluación clásica)

  private boot(): Promise<void> {
    if (this.ready) return this.ready
    this.w = new Worker(new URL(ENGINE_URL, document.baseURI))
    this.w.onmessage = (e: MessageEvent) => this.listener?.(String(e.data))
    this.ready = new Promise(resolve => {
      this.listener = line => { if (line === 'readyok') { this.listener = null; resolve() } }
      this.send('uci')
      this.send('setoption name Hash value 64')
      this.send(`setoption name Use NNUE value ${this.nnue}`)
      this.send('isready')
    })
    return this.ready
  }

  private kill() {
    this.w?.terminate()
    this.w = null; this.ready = null; this.listener = null
  }

  private send(cmd: string) { this.w?.postMessage(cmd) }

  /** Precarga el motor (para que la primera jugada no tarde). */
  warmup() { if (!_locked()) this.boot() }

  setStrength(s: Strength) {
    this.strengthCmds = s.kind === 'elo'
      ? ['setoption name Skill Level value 20', 'setoption name UCI_LimitStrength value true', `setoption name UCI_Elo value ${s.elo}`]
      : ['setoption name UCI_LimitStrength value false', `setoption name Skill Level value ${s.skill}`]
  }

  /** Sin límite de fuerza (para el análisis). */
  fullStrength() {
    this.strengthCmds = ['setoption name UCI_LimitStrength value false', 'setoption name Skill Level value 20']
  }

  /** Lanza una búsqueda; las búsquedas se encadenan (una a la vez). */
  search(position: string, go: string, onInfo?: (i: SearchInfo) => void): Promise<SearchResult> {
    if (_locked()) return Promise.reject(new Error('Motor bloqueado durante una partida en línea'))
    const run = () => this.run(position, go, onInfo)
    const p = this.chain.then(run, run)
    this.chain = p.catch(() => {})
    return p
  }

  /** Corta la búsqueda en curso (devuelve enseguida su mejor jugada hasta el momento). */
  stop() { this.send('stop') }

  private async run(position: string, go: string, onInfo?: (i: SearchInfo) => void, retried = false): Promise<SearchResult> {
    await this.boot()
    return new Promise<SearchResult>((resolve, reject) => {
      let last: SearchInfo | null = null
      this.listener = line => {
        if (line.includes(NNUE_FAIL)) {
          // Red NNUE no disponible (sin caché y sin internet): reiniciar con evaluación clásica
          this.nnue = false
          this.kill()
          if (retried) { reject(new Error('El motor no pudo arrancar')); return }
          this.run(position, go, onInfo, true).then(resolve, reject)
          return
        }
        if (line.startsWith('info') && line.includes(' pv ')) {
          if (/ multipv (?!1 )\d+/.test(line)) return
          const cp = line.match(/ score cp (-?\d+)/), mate = line.match(/ score mate (-?\d+)/)
          last = {
            depth: Number(line.match(/ depth (\d+)/)?.[1] ?? 0),
            cp: cp ? Number(cp[1]) : null, mate: mate ? Number(mate[1]) : null,
            pv: (line.match(/ pv (.+)/)?.[1] ?? '').trim().split(' '),
          }
          onInfo?.(last)
        } else if (line.startsWith('bestmove')) {
          this.listener = null
          const bm = line.split(' ')[1]
          resolve({ bestmove: bm && bm !== '(none)' ? bm : '', info: last })
        }
      }
      for (const c of this.strengthCmds) this.send(c)
      this.send('setoption name MultiPV value 1')
      this.send(position)
      this.send(go)
    })
  }
}

export const engine = new Engine()
