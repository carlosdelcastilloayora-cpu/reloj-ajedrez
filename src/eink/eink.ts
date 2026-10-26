// Utilidades para la pantalla de tinta electrónica: limpieza de fantasmas, Wake Lock,
// pantalla completa y un pitido simple.

let flashing = false

/** Flash negro → blanco de pantalla completa para borrar fantasmas de la tinta. */
export function flashScreen() {
  if (flashing) return
  flashing = true
  const el = document.createElement('div')
  el.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#000'
  document.body.appendChild(el)
  setTimeout(() => { el.style.background = '#fff' }, 180)
  setTimeout(() => { el.remove(); flashing = false }, 360)
}

// ── Wake Lock: la pantalla no se apaga mientras haya partida ──
let lock: any = null
let wanted = false

async function acquire() {
  try {
    if (!wanted || lock || document.visibilityState !== 'visible') return
    lock = await (navigator as any).wakeLock?.request('screen')
    lock?.addEventListener('release', () => { lock = null })
  } catch { lock = null }
}

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') acquire() })

export function keepAwake(on: boolean) {
  wanted = on
  if (on) acquire()
  else { try { lock?.release() } catch { /* noop */ } lock = null }
}

export function enterFullscreen() {
  try {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {})
  } catch { /* noop */ }
}

// ── Sonido ──
let ctx: AudioContext | null = null
export function beep(freq = 880, ms = 180, times = 1) {
  try {
    ctx ??= new AudioContext()
    for (let i = 0; i < times; i++) {
      const t0 = ctx.currentTime + i * (ms / 1000 + 0.08)
      const o = ctx.createOscillator(), g = ctx.createGain()
      o.frequency.value = freq
      g.gain.setValueAtTime(0.25, t0)
      g.gain.setValueAtTime(0, t0 + ms / 1000)
      o.connect(g).connect(ctx.destination)
      o.start(t0); o.stop(t0 + ms / 1000 + 0.02)
    }
  } catch { /* sin audio */ }
}
