/**
 * iPadOS-style pointer.
 *
 * - A soft translucent dot that glides after the mouse.
 * - Over small controls (buttons, links, pills) it morphs into a highlight around the control and drifts
 *   slightly with the mouse.
 * - Elements with `data-cursor="Label"` turn it into a dark pill showing that label (e.g. the avatar's
 *   "Tap to talk").
 * - Text fields keep the native I-beam. Touch devices and reduced-motion users keep the system cursor.
 */

import { useEffect, useRef } from 'react'

const INTERACTIVE = 'a[href], button:not(:disabled), [role=button], [role=radio], [role=menuitem], select, summary, label[for], input[type=checkbox], input[type=radio], input[type=color], [data-cursor]'
const TEXT = 'input:not([type=checkbox]):not([type=radio]):not([type=color]):not([type=range]), textarea, [contenteditable=true]'
const lerp = (a: number, b: number, k: number) => a + (b - a) * k

export default function CustomCursor() {
  const el = useRef<HTMLDivElement>(null)
  const label = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const fine = window.matchMedia('(pointer: fine)')
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (!fine.matches || reduce.matches || !el.current) return
    const root = document.documentElement
    root.classList.add('custom-cursor')

    const mouse = { x: -100, y: -100 }
    const cur = { x: -100, y: -100, w: 18, h: 18, r: 9, a: 0 }
    let target: Element | null = null
    let mode: 'dot' | 'snap' | 'label' | 'text' = 'dot'
    let pressed = false
    let visible = false
    let raf = 0

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      mouse.x = e.clientX; mouse.y = e.clientY
      if (!visible) { visible = true; cur.x = mouse.x; cur.y = mouse.y }
      const t = e.target as Element | null
      if (t?.closest(TEXT)) { mode = 'text'; target = null; return }
      const hit = t?.closest(INTERACTIVE) ?? null
      target = hit
      if (!hit) { mode = 'dot'; return }
      const text = hit.getAttribute('data-cursor')
      if (text) {
        mode = 'label'
        if (label.current && label.current.textContent !== text) label.current.textContent = text
        return
      }
      const r = hit.getBoundingClientRect()
      mode = r.width <= 360 && r.height <= 72 ? 'snap' : 'dot'
    }
    const onDown = () => { pressed = true }
    const onUp = () => { pressed = false }
    const onLeave = () => { visible = false }

    const frame = () => {
      const node = el.current
      if (!node) return // unmounted (e.g. an error boundary replaced the tree): stop the loop
      let tx = mouse.x, ty = mouse.y, tw = 18, th = 18, tr = 9, ta = visible ? 1 : 0
      let bg = 'rgba(29, 29, 31, 0.28)'
      let showLabel = false
      if (mode === 'text') ta = 0
      else if (mode === 'snap' && target?.isConnected) {
        const r = target.getBoundingClientRect()
        const pad = 6
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2
        tx = cx + (mouse.x - cx) * 0.12  // gentle parallax towards the mouse
        ty = cy + (mouse.y - cy) * 0.12
        tw = r.width + pad * 2; th = r.height + pad * 2
        const radius = parseFloat(getComputedStyle(target).borderRadius) || 10
        tr = Math.min(radius + pad, th / 2)
        bg = 'rgba(29, 29, 31, 0.07)'
      } else if (mode === 'label') {
        tw = (label.current?.offsetWidth ?? 60) + 26; th = 30; tr = 15
        tx = mouse.x + tw / 2 + 10; ty = mouse.y + 24
        bg = 'rgba(29, 29, 31, 0.86)'
        showLabel = true
      }
      if (pressed) { tw *= 0.9; th *= 0.9 }
      const k = mode === 'dot' ? 0.35 : 0.22
      cur.x = lerp(cur.x, tx, k); cur.y = lerp(cur.y, ty, k)
      cur.w = lerp(cur.w, tw, 0.25); cur.h = lerp(cur.h, th, 0.25); cur.r = lerp(cur.r, tr, 0.25)
      cur.a = lerp(cur.a, ta, 0.3)
      node.style.transform = `translate3d(${(cur.x - cur.w / 2).toFixed(1)}px, ${(cur.y - cur.h / 2).toFixed(1)}px, 0)`
      node.style.width = `${cur.w.toFixed(1)}px`
      node.style.height = `${cur.h.toFixed(1)}px`
      node.style.borderRadius = `${cur.r.toFixed(1)}px`
      node.style.opacity = cur.a.toFixed(2)
      node.style.background = bg
      if (label.current) label.current.style.opacity = showLabel ? '1' : '0'
      raf = requestAnimationFrame(frame)
    }

    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('pointerup', onUp)
    document.addEventListener('mouseleave', onLeave)
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      root.classList.remove('custom-cursor')
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointerup', onUp)
      document.removeEventListener('mouseleave', onLeave)
    }
  }, [])

  return (
    <div ref={el} aria-hidden="true"
      className="pointer-events-none fixed left-0 top-0 z-[9999] flex items-center justify-center opacity-0 backdrop-blur-[2px]"
      style={{ width: 18, height: 18, borderRadius: 9, willChange: 'transform, width, height' }}>
      <span ref={label} className="whitespace-nowrap px-3 text-xs font-medium text-white opacity-0 transition-opacity duration-200" />
    </div>
  )
}
