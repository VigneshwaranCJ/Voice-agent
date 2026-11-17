/**
 * MangaFace avatar (art: github.com/miladnia/MangaFace, MIT — see public/avatars/mangaface/).
 *
 * Renders the layered PNG face at the manifest's positions on its 180 × 187 canvas. The voice loop in
 * TalkingCharacter drives it through refs: it swaps mouth images for lip-sync, squashes the eyes to
 * blink, lifts the brows and moves the head.
 */

import type { RefObject } from 'react'

const BASE = '/avatars/mangaface'
export const CANVAS = { w: 180, h: 187 }

export const SKIN = { light: '#f9d5c3', plain: '#fabe9f', dark: '#e0a182' } as const
export const HAIR = { black: '#1f1b1a', brown: '#6b4226', blond: '#d9b26a', red: '#a3402a' } as const
export const EYE = { black: '#222', brown: '#6b4226', hazel: '#8e7240', green: '#3f7d4a', blue: '#3b6fb5', gray: '#8a8f98' } as const
export const CLOTH = { white: '#f8fafc', black: '#1f2937', blue: '#2563eb', green: '#16a34a', red: '#dc2626', violet: '#7c3aed', yellow: '#eab308', brown: '#7c4a2a' } as const

export type Skin = keyof typeof SKIN
export type HairColor = keyof typeof HAIR
export type EyeColor = keyof typeof EYE
export type ClothColor = keyof typeof CLOTH

export interface MangaLook {
  skin: Skin
  head: number      // 1–30
  ears: number      // 1–6
  hair: number      // 0 = none, 1–62
  hairColor: HairColor
  eyes: number      // 1–28
  eyeColor: EyeColor
  brows: number     // 1–27
  nose: number      // 1–34
  mouth: number     // resting mouth, 1–23
  mustache: number  // 0 = none, 1–29
  shirt: number     // 1–25
  shirtColor: ClothColor
  glasses: number   // 0 = none, 1–34
  background: number // 0 = none, 1–24
}

export const MANGA_RANGES: Record<keyof Omit<MangaLook, 'skin' | 'hairColor' | 'eyeColor' | 'shirtColor'>, [number, number]> = {
  head: [1, 30], ears: [1, 6], hair: [0, 62], eyes: [1, 28], brows: [1, 27], nose: [1, 34], mouth: [1, 23],
  mustache: [0, 29], shirt: [1, 25], glasses: [0, 34], background: [0, 24],
}

export const DEFAULT_MANGA: MangaLook = {
  skin: 'plain', head: 1, ears: 1, hair: 31, hairColor: 'black', eyes: 1, eyeColor: 'black', brows: 1, nose: 1,
  mouth: 15, mustache: 0, shirt: 5, shirtColor: 'blue', glasses: 0, background: 0,
}

/** Mouths picked (by eye) from the pack's 23 shapes, closed → wide open, for loudness-driven lip-sync. */
export const LIPSYNC_MOUTHS = [15, 10, 22, 17, 18]
export const MOUTH = { surprised: 13, listening: 2, thinking: 23 }

/** Hairstyles that cover the ears in the pack's rules (manifest `ear_covering_hair`). */
const EAR_COVERING_HAIR = new Set([33, 37, 38, 39, 41, 43, 44, 60, 62])

export const mouthUrl = (skin: Skin, n: number) => `${BASE}/mouth/${skin}/${n}.png`

export interface MangaRefs {
  head: RefObject<HTMLDivElement | null>
  body: RefObject<HTMLDivElement | null>
  eyes: RefObject<HTMLDivElement | null>
  brows: RefObject<HTMLDivElement | null>
  mouth: RefObject<HTMLImageElement | null>
}

function Layer({ src, top = 0, left = 0 }: { src: string; top?: number; left?: number }) {
  return (
    <img src={src} alt="" draggable={false} style={{ position: 'absolute', top, left }}
      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
      onLoad={(e) => { (e.currentTarget as HTMLImageElement).style.display = '' }} />
  )
}

export function MangaFaceAvatar({ look, refs, width }: { look: MangaLook; refs: MangaRefs; width: number }) {
  const k = width / CANVAS.w
  const s = look.skin
  const showEars = !(look.hair && EAR_COVERING_HAIR.has(look.hair))
  return (
    <div style={{ width, height: CANVAS.h * k }} className="relative">
      <div style={{ width: CANVAS.w, height: CANVAS.h, transform: `scale(${k})`, transformOrigin: 'top left' }} className="relative">
        {look.background > 0 && (
          <div className="absolute inset-0 overflow-hidden rounded-full">
            <Layer src={`${BASE}/bg_color/${look.background}.png`} />
          </div>
        )}
        <div ref={refs.body} className="absolute inset-0">
          <Layer src={`${BASE}/body_shape/${s}/1.png`} top={134} left={26} />
          <Layer src={`${BASE}/shirt/${look.shirtColor}/${look.shirt}.png`} top={124} left={26} />
        </div>
        {/* head pivots around the neck */}
        <div ref={refs.head} className="absolute inset-0" style={{ transformOrigin: '90px 140px' }}>
          {look.hair > 0 && <Layer src={`${BASE}/hair_back/${look.hairColor}/${look.hair}.png`} top={23} left={0} />}
          {showEars && <Layer src={`${BASE}/right_ear/${s}/${look.ears}.png`} top={64} left={12} />}
          {showEars && <Layer src={`${BASE}/left_ear/${s}/${look.ears}.png`} top={64} left={137} />}
          <Layer src={`${BASE}/head_shape/${s}/${look.head}.png`} top={0} left={30} />
          <img ref={refs.mouth} src={mouthUrl(s, look.mouth)} alt="" draggable={false} style={{ position: 'absolute', top: 107, left: 52 }} />
          {look.mustache > 0 && <Layer src={`${BASE}/mustache/${look.hairColor}/${look.mustache}.png`} top={104} left={49} />}
          <Layer src={`${BASE}/nose/${s}/${look.nose}.png`} top={68} left={65} />
          <div ref={refs.eyes} className="absolute inset-0" style={{ transformOrigin: '90px 78px' }}>
            <Layer src={`${BASE}/left_eye/${look.eyeColor}/${look.eyes}.png`} top={68} left={97} />
            <Layer src={`${BASE}/right_eye/${look.eyeColor}/${look.eyes}.png`} top={68} left={41} />
          </div>
          <div ref={refs.brows} className="absolute inset-0">
            <Layer src={`${BASE}/left_eyebrow/${look.hairColor}/${look.brows}.png`} top={52} left={93} />
            <Layer src={`${BASE}/right_eyebrow/${look.hairColor}/${look.brows}.png`} top={52} left={39} />
          </div>
          {look.hair > 0 && <Layer src={`${BASE}/hair_front/${look.hairColor}/${look.hair}.png`} />}
          {look.glasses > 0 && <Layer src={`${BASE}/glasses/${look.glasses}.png`} top={57} left={27} />}
        </div>
      </div>
    </div>
  )
}

/** Warm the browser cache so mouth swaps never flash while speaking. */
export function preloadMouths(skin: Skin) {
  for (const n of [...LIPSYNC_MOUTHS, ...Object.values(MOUTH)]) {
    const img = new Image()
    img.src = mouthUrl(skin, n)
  }
}

const STEPPERS: { key: keyof typeof MANGA_RANGES; label: string }[] = [
  { key: 'head', label: 'Face shape' }, { key: 'hair', label: 'Hairstyle' }, { key: 'eyes', label: 'Eyes' },
  { key: 'brows', label: 'Eyebrows' }, { key: 'nose', label: 'Nose' }, { key: 'mouth', label: 'Resting mouth' },
  { key: 'ears', label: 'Ears' }, { key: 'mustache', label: 'Mustache' }, { key: 'shirt', label: 'Shirt' },
  { key: 'glasses', label: 'Glasses' }, { key: 'background', label: 'Background' },
]

export function randomManga(): MangaLook {
  const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)]
  const n = ([a, b]: [number, number]) => a + Math.floor(Math.random() * (b - a + 1))
  return {
    skin: pick(Object.keys(SKIN) as Skin[]), head: n(MANGA_RANGES.head), ears: n(MANGA_RANGES.ears),
    hair: n([1, 62]), hairColor: pick(Object.keys(HAIR) as HairColor[]), eyes: n(MANGA_RANGES.eyes),
    eyeColor: pick(Object.keys(EYE) as EyeColor[]), brows: n(MANGA_RANGES.brows), nose: n(MANGA_RANGES.nose),
    mouth: 15, mustache: Math.random() < 0.2 ? n([1, 29]) : 0, shirt: n(MANGA_RANGES.shirt),
    shirtColor: pick(Object.keys(CLOTH) as ClothColor[]), glasses: Math.random() < 0.3 ? n([1, 34]) : 0, background: 0,
  }
}

export function MangaEditor({ look, onChange }: { look: MangaLook; onChange: (l: MangaLook) => void }) {
  const set = <K extends keyof MangaLook>(k: K, v: MangaLook[K]) => onChange({ ...look, [k]: v })
  const step = (k: keyof typeof MANGA_RANGES, d: number) => {
    const [a, b] = MANGA_RANGES[k]
    const v = look[k] + d
    set(k, v > b ? a : v < a ? b : v)
  }
  return (
    <div className="space-y-3">
      <ColorRow label="Skin" palette={SKIN} value={look.skin} onChange={(v) => set('skin', v)} />
      <ColorRow label="Hair & brows" palette={HAIR} value={look.hairColor} onChange={(v) => set('hairColor', v)} />
      <ColorRow label="Eye colour" palette={EYE} value={look.eyeColor} onChange={(v) => set('eyeColor', v)} />
      <ColorRow label="Shirt colour" palette={CLOTH} value={look.shirtColor} onChange={(v) => set('shirtColor', v)} />
      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        {STEPPERS.map(({ key, label }) => (
          <div key={key}>
            <span className="label">{label}</span>
            <div className="flex items-center justify-between rounded-md ring-1 ring-slate-200">
              <button className="px-2 py-1 text-slate-500 hover:text-slate-800" aria-label={`Previous ${label}`} onClick={() => step(key, -1)}>‹</button>
              <span className="text-xs tabular-nums text-slate-700">{look[key] === 0 ? 'none' : look[key]}</span>
              <button className="px-2 py-1 text-slate-500 hover:text-slate-800" aria-label={`Next ${label}`} onClick={() => step(key, 1)}>›</button>
            </div>
          </div>
        ))}
      </div>
      <button className="w-full rounded-md bg-slate-100 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-200" onClick={() => onChange(randomManga())}>
        Randomise
      </button>
    </div>
  )
}

function ColorRow<T extends string>({ label, palette, value, onChange }: {
  label: string; palette: Record<T, string>; value: T; onChange: (v: T) => void
}) {
  return (
    <div>
      <span className="label">{label}</span>
      <div className="flex flex-wrap gap-2">
        {(Object.keys(palette) as T[]).map((name) => (
          <button key={name} title={name} aria-label={`${label} ${name}`} aria-pressed={value === name} onClick={() => onChange(name)}
            className={`h-6 w-6 rounded-full ring-2 ring-offset-2 ${value === name ? 'ring-brand-500' : 'ring-slate-200'}`} style={{ background: palette[name] }} />
        ))}
      </div>
    </div>
  )
}
