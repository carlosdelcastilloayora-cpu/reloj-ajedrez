// Botones del reloj: el ESP32 se presenta como teclado BLE y manda 'a' (izquierdo),
// 'l' (derecho) y 'p' (ambos en pulsación larga = menú/pausa). Un teclado normal sirve igual.
export type ButtonId = 'left' | 'right' | 'menu'

const KEYMAP: Record<string, ButtonId> = { a: 'left', l: 'right', p: 'menu' }

export function listenButtons(handler: (b: ButtonId) => void): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return
    const t = e.target as HTMLElement | null
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
    const b = KEYMAP[e.key.toLowerCase()]
    if (!b) return
    e.preventDefault()
    if (e.repeat) return   // tecla mantenida: solo cuenta la primera
    handler(b)
  }
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}
