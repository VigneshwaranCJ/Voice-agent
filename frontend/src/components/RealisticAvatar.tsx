/**
 * Realistic avatars: animated photo portraits (PhotoAvatar) and 3D characters (TalkingHead).
 *
 * Renderer: TalkingHead by Mika Suominen (MIT), https://github.com/met4citizen/TalkingHead
 * Models:   from the TalkingHead repo; see public/avatars/realistic/README.md. Nandhini and
 *           Divyadharshini (MPFB, CC0) may be used commercially; the other three are non-commercial only.
 *
 * Lip-sync is driven from the agent audio's loudness (we have no word timings from streaming TTS):
 * every ~90 ms a new mouth shape (Oculus viseme) is picked and scaled by the loudness, with the jaw
 * following. States and reactions map to TalkingHead moods, gaze and hand gestures.
 */

import { useEffect, useRef, useState } from 'react'
import type { SceneNode, TalkingHead as TalkingHeadT } from '@met4citizen/talkinghead'
import type { AgentState } from '../services/voiceClient'
import PhotoAvatar, { type PortraitSpec } from './PhotoAvatar'

export type RealisticModelId = 'kavya' | 'amara' | 'nandhini' | 'nandhika' | 'rashmi' | 'aarya' | 'divyadharshini'

type Groups = Record<'skin' | 'hair' | 'outfit', string[]>
type Tints = Pick<RealisticLook, 'skin' | 'hair' | 'outfit'>
export interface RealisticModel {
  id: RealisticModelId
  name: string
  /** 'photo' = animated portrait (PhotoAvatar); '3d' = TalkingHead model */
  kind: 'photo' | '3d'
  portrait?: PortraitSpec
  /** true = free for commercial use; false = non-commercial licence only */
  commercial: boolean
  credit: string
  url: string
  avatar: Record<string, unknown>
  /** glTF material names to tint (three.js rewrites node names, but keeps material names) */
  groups: Groups
  /** colours applied when this character is picked ('#ffffff' = as modelled) */
  tints: Tints
  /** signature colours: studio backdrop, thumbnail and the speaking ring */
  accent: [string, string]
}

const AS_MODELLED: Tints = { skin: '#ffffff', hair: '#ffffff', outfit: '#ffffff' }
const MPFB = {
  url: '/avatars/realistic/woman.glb',
  credit: 'MPFB / MakeHuman · CC0',
  avatar: { body: 'F', baseline: { headRotateX: -0.01, eyeBlinkLeft: 0.05, eyeBlinkRight: 0.05 } },
  groups: { skin: ['Human.body'], hair: ['Human.ponytail01'], outfit: ['Human.female_casualsuit01'] },
}

const PHOTO = { kind: 'photo' as const, commercial: true, credit: 'Your portrait', avatar: {}, groups: { skin: [], hair: [], outfit: [] }, tints: AS_MODELLED }

export const REALISTIC_MODELS: RealisticModel[] = [
  {
    id: 'kavya', name: 'Kavya', ...PHOTO, accent: ['#f8cf8a', '#e07a52'], url: '/avatars/photo/portrait-1.jpg',
    portrait: {
      src: '/avatars/photo/portrait-1.jpg',
      mouth: { x: 0.5016, y: 0.4414 }, mouthHalfWidth: 0.0536, chinY: 0.4929,
      head: { x: 0.5048, y: 0.3893, rx: 0.134, ry: 0.1179 }, nose: { x: 0.5038, y: 0.3971 },
      eyes: [{ x: 0.4277, y: 0.3486, w: 0.0332, h: 0.00714 }, { x: 0.5681, y: 0.3471, w: 0.0332, h: 0.00714 }],
      neck: { x: 0.495, halfWidth: 0.0857, shoulderY: 0.621 },
      frames: { upper: { x: 0.5, y: 0.43, h: 0.6 }, head: { x: 0.5, y: 0.38, h: 0.36 } },
    },
  },
  {
    id: 'amara', name: 'Amara', ...PHOTO, accent: ['#e3cdb9', '#9a6f5c'], url: '/avatars/photo/portrait-2.jpg',
    portrait: {
      src: '/avatars/photo/portrait-2.jpg',
      mouth: { x: 0.529, y: 0.5145 }, mouthHalfWidth: 0.056, chinY: 0.6137,
      head: { x: 0.538, y: 0.4007, rx: 0.1534, ry: 0.231 }, nose: { x: 0.5253, y: 0.4495 },
      eyes: [{ x: 0.435, y: 0.35, w: 0.0325, h: 0.0108 }, { x: 0.603, y: 0.361, w: 0.0415, h: 0.0126 }],
      neck: { x: 0.534, halfWidth: 0.112, shoulderY: 0.812 },
      frames: { upper: { x: 0.5, y: 0.5, h: 1 }, head: { x: 0.52, y: 0.46, h: 0.64 } },
    },
  },
  { id: 'nandhini', name: 'Nandhini', kind: '3d', commercial: true, ...MPFB, tints: { ...AS_MODELLED, outfit: '#a9c9b6' }, accent: ['#d9ebe0', '#7fae95'] },
  {
    id: 'nandhika', name: 'Nandhika', kind: '3d', commercial: false, credit: 'Ready Player Me · CC BY-NC 4.0',
    url: '/avatars/realistic/samples/brunette.glb',
    avatar: { body: 'F' },
    groups: { skin: ['Wolf3D_Skin', 'Wolf3D_Body'], hair: ['Wolf3D_Hair'], outfit: ['Wolf3D_Outfit_Top', 'Wolf3D_Outfit_Bottom'] },
    tints: { ...AS_MODELLED, outfit: '#a9bcff' }, accent: ['#dce6ff', '#7f9cf0'],
  },
  {
    id: 'rashmi', name: 'Rashmi', kind: '3d', commercial: false, credit: 'Avaturn · non-commercial',
    url: '/avatars/realistic/samples/avaturn.glb',
    avatar: {
      body: 'F',
      retarget: {
        Hips: { y: 0.03 }, Spine: { y: 0.02 }, Spine1: { y: 0.02, z: 0.01 },
        Spine2: { y: 0.02, z: 0.01 }, Neck: { z: 0.02, y: 0.01 }, Head: { z: 0.02 },
        LeftShoulder: { rx: -0.5 }, RightShoulder: { rx: -0.5 },
        scaleToHipsLevel: 1.0,
      },
      baseline: { headRotateX: -0.05, eyeBlinkLeft: 0.15, eyeBlinkRight: 0.15 },
    },
    groups: { skin: ['Body', 'Head'], hair: ['avaturn_hair_0_material', 'avaturn_hair_1_material'], outfit: ['avaturn_look_0_material'] },
    tints: { ...AS_MODELLED, outfit: '#f4b3c2' }, accent: ['#ffe1e8', '#e88aa3'],
  },
  {
    id: 'aarya', name: 'Aarya', kind: '3d', commercial: false, credit: 'VRoid Studio sample · non-commercial',
    url: '/avatars/realistic/samples/vroid.glb',
    avatar: { body: 'F', baseline: { headRotateX: -0.1, eyeBlinkLeft: 0.05, eyeBlinkRight: 0.05 } },
    groups: {
      skin: ['N00_000_00_Body_00_SKIN (Instance)', 'N00_000_00_Face_00_SKIN (Instance)'],
      hair: ['N00_000_Hair_00_HAIR (Instance)'],
      outfit: [
        'N00_010_01_Onepiece_00_CLOTH_01 (Instance)', 'N00_010_01_Onepiece_00_CLOTH_02 (Instance)',
        'N00_007_01_Tops_01_CLOTH_01 (Instance)', 'N00_007_01_Tops_01_CLOTH_02 (Instance)',
        'N00_002_03_Tops_01_CLOTH_01 (Instance)', 'N00_002_03_Tops_01_CLOTH_02 (Instance)',
      ],
    },
    tints: { ...AS_MODELLED, outfit: '#cdbdff' }, accent: ['#ebe3ff', '#9b83f0'],
  },
  // Same CC0 model as Nandhini with her own colouring, so she is also safe to sell.
  { id: 'divyadharshini', name: 'Divyadharshini', kind: '3d', commercial: true, ...MPFB, tints: { skin: '#b07a58', hair: '#2a1f1a', outfit: '#f6b08a' }, accent: ['#ffe4d2', '#f0936a'] },
]
export const realisticModel = (id: string | undefined) => REALISTIC_MODELS.find((m) => m.id === id) ?? REALISTIC_MODELS[0]

export type RealisticMood = 'neutral' | 'happy' | 'love'
export type RealisticFraming = 'head' | 'upper'

export interface RealisticLook {
  model: RealisticModelId
  mood: RealisticMood
  framing: RealisticFraming
  skin: string
  hair: string
  outfit: string
}

export const DEFAULT_REALISTIC: RealisticLook = { model: 'kavya', mood: 'happy', framing: 'upper', skin: '#ffffff', hair: '#ffffff', outfit: '#ffffff' }

// Colours multiply the original textures, so '#ffffff' means "as modelled".
export const REAL_SKIN = [
  { v: '#ffffff', n: 'Light' }, { v: '#f0d2bb', n: 'Warm' }, { v: '#d8a982', n: 'Tan' }, { v: '#b07a58', n: 'Brown' }, { v: '#80553c', n: 'Deep' },
]
export const REAL_HAIR = [
  { v: '#ffffff', n: 'Chestnut' }, { v: '#5c4033', n: 'Dark brown' }, { v: '#2a1f1a', n: 'Black' }, { v: '#c46a3a', n: 'Auburn' }, { v: '#e8c48a', n: 'Honey' },
]
export const REAL_OUTFIT = [
  { v: '#ffffff', n: 'Original' }, { v: '#a9c9b6', n: 'Sage' }, { v: '#a9bcff', n: 'Sky' }, { v: '#f4b3c2', n: 'Rose' },
  { v: '#cdbdff', n: 'Lavender' }, { v: '#f6b08a', n: 'Apricot' }, { v: '#4a4a4f', n: 'Graphite' },
]

const VIEW_OPT: Record<RealisticFraming, Record<string, number>> = {
  head: { cameraDistance: 1, cameraY: 0 },
  upper: { cameraDistance: -1.2, cameraY: -0.1 },
}
/** Jump the camera to a framing without TalkingHead's eased transition. */
function frame(th: TalkingHeadT, view: RealisticFraming) {
  ;(th as unknown as { cameraClock: number | null }).cameraClock = null
  th.setView(view, VIEW_OPT[view])
}

const VISEMES = ['viseme_aa', 'viseme_E', 'viseme_I', 'viseme_O', 'viseme_U', 'viseme_aa', 'viseme_E', 'viseme_O'] as const
const CLOSERS = ['viseme_PP', 'viseme_FF', 'viseme_nn', 'viseme_DD', 'viseme_SS'] as const
const MOUTH_KEYS = [...new Set([...VISEMES, ...CLOSERS, 'jawOpen'])]

// TalkingHead makes an AudioContext per instance and dispose() never closes it, so every editor
// preview would leak one. All instances share this one (it only plays silence for us anyway).
let sharedAudioCtx: AudioContext | null = null
const audioCtx = () => (sharedAudioCtx ??= new AudioContext())

export interface RealisticDriver {
  state: AgentState | null
  reaction: 'surprised' | 'concerned' | 'goodbye' | null
  level: () => number
}

interface Props {
  look: RealisticLook
  width: number
  height: number
  /** Live data read every frame; omit for a static preview. */
  driver?: { current: RealisticDriver }
  className?: string
}

function applyTints(scene: SceneNode | null, look: RealisticLook, groups: Groups) {
  if (!scene) return
  scene.traverse((o) => {
    if (!o.isMesh || !o.material) return
    const mats = Array.isArray(o.material) ? o.material : [o.material]
    for (const m of mats) {
      for (const [key, names] of Object.entries(groups) as [keyof Groups, string[]][]) {
        if (!m.name || !names.includes(m.name)) continue
        m.color?.set(look[key])
        // Colours multiply the texture, so a printed outfit can't change hue. For a chosen outfit colour,
        // drop the printed texture and show plain fabric in that colour; 'as modelled' brings it back.
        if (key === 'outfit') {
          if (!('origMap' in m.userData)) m.userData.origMap = m.map ?? null
          const map = look.outfit === '#ffffff' ? m.userData.origMap : null
          if (m.map !== map) { m.map = map; m.needsUpdate = true }
          // flat fabric has no texture shading to tone it down, so match the brightness of real cloth
          if (!map) m.color?.set(look.outfit).multiplyScalar(0.3)
        }
      }
    }
  })
}

/** Soft studio backdrop in the character's colours: a lit centre falling off to the edges. */
export const backdrop = ([a, b]: [string, string]) =>
  `radial-gradient(110% 80% at 50% 28%, #ffffff 0%, ${a} 42%, ${b} 100%)`

/** Round thumbnail: the portrait's face for photos, a monogram on the backdrop for 3D characters. */
export function CharacterThumb({ id, size = 40, className }: { id: string; size?: number; className?: string }) {
  const m = realisticModel(id)
  const p = m.portrait
  if (p) {
    const ch = p.head.ry * 2.3 // crop: the face plus a little hair, as a fraction of the image height
    return (
      <span aria-hidden className={`relative block shrink-0 overflow-hidden rounded-full bg-slate-200 ring-1 ring-black/10 ${className ?? ''}`} style={{ width: size, height: size }}>
        <img src={p.src} alt="" draggable={false} className="absolute max-w-none"
          style={{ height: `${100 / ch}%`, top: `${(-(p.head.y - ch / 2) / ch) * 100}%`, left: '50%', transform: `translateX(-${p.head.x * 100}%)` }} />
      </span>
    )
  }
  return (
    <span aria-hidden className={`flex shrink-0 items-center justify-center rounded-full font-semibold text-white ring-1 ring-black/10 ${className ?? ''}`}
      style={{ width: size, height: size, fontSize: size * 0.42, background: `linear-gradient(140deg, ${m.accent[0]}, ${m.accent[1]})`, textShadow: '0 1px 2px rgb(0 0 0 / 0.25)' }}>
      {m.name[0]}
    </span>
  )
}

/** Remounts the renderer when the model changes (TalkingHead loads one model per instance). */
export default function RealisticAvatar(props: Props) {
  const m = realisticModel(props.look.model)
  if (m.kind === 'photo' && m.portrait) {
    return <PhotoAvatar key={m.id} spec={m.portrait} framing={props.look.framing} width={props.width} height={props.height} driver={props.driver} className={props.className} />
  }
  return <RealisticAvatarInner key={m.id} {...props} />
}

function RealisticAvatarInner({ look, width, height, driver, className }: Props) {
  const model = realisticModel(look.model)
  const host = useRef<HTMLDivElement>(null)
  const head = useRef<TalkingHeadT | null>(null)
  const scene = useRef<SceneNode | null>(null)
  const lookRef = useRef(look)
  lookRef.current = look
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [progress, setProgress] = useState(0)

  // Create the renderer once.
  useEffect(() => {
    let cancelled = false
    let th: TalkingHeadT | null = null
    ;(async () => {
      try {
        const { TalkingHead } = await import('@met4citizen/talkinghead')
        if (cancelled || !host.current) return
        th = new TalkingHead(host.current, {
          audioCtx: audioCtx(),
          lipsyncModules: [],          // we drive the mouth from audio loudness; no TTS, no word timings
          cameraView: lookRef.current.framing,
          ...VIEW_OPT[lookRef.current.framing],
          cameraRotateEnable: false, cameraPanEnable: false, cameraZoomEnable: false,
          avatarMood: lookRef.current.mood,
          avatarIdleEyeContact: 0.6, avatarSpeakingEyeContact: 0.8,
          // studio portrait lighting: soft warm key, gentle fill, cool rim from behind
          lightAmbientColor: 0xfff8f2, lightAmbientIntensity: 2.1,
          lightDirectColor: 0xfff0e4, lightDirectIntensity: 26,
          lightSpotColor: 0xc4dcff, lightSpotIntensity: 10, lightSpotPhi: 0.1, lightSpotTheta: 4, lightSpotDispersion: 1,
          modelFPS: 30,
          modelPixelRatio: Math.min(2, window.devicePixelRatio || 1), // crisp on high-DPI screens
        })
        await th.showAvatar(
          { ...model.avatar, url: model.url, avatarMood: lookRef.current.mood, lipsyncLang: 'en' },
          (e) => { if (e.lengthComputable) setProgress(e.loaded / e.total) },
          (gltf) => { scene.current = gltf.scene },
        )
        if (cancelled) { th.dispose(); return }
        applyTints(scene.current, lookRef.current, model.groups)
        head.current = th
        installDriver(th, driver)
        setStatus('ready')
      } catch (err) {
        // Unmounted mid-load (e.g. the editor closed): dispose() already tore the renderer down, so a
        // throw from the half-finished load is expected and not worth reporting.
        if (cancelled) return
        console.error('Realistic avatar failed to load', err)
        setStatus('error')
      }
    })()
    return () => {
      cancelled = true
      head.current = null
      try { th?.dispose() } catch { /* already gone */ }
    }
    // driver is a stable ref object; the renderer is created once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Live look changes.
  useEffect(() => { applyTints(scene.current, look, model.groups) }, [look, status, model.groups])
  useEffect(() => { if (status === 'ready') try { head.current?.setMood(look.mood) } catch { /* unknown mood */ } }, [look.mood, status])
  useEffect(() => { if (status === 'ready' && head.current) frame(head.current, look.framing) }, [look.framing, status])

  return (
    <div className={`relative overflow-hidden ${className ?? ''}`} style={{ width, height, background: backdrop(model.accent) }}>
      <div ref={host} className="absolute inset-0 [&_canvas]:pointer-events-none" />
      {status === 'loading' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-xs text-slate-500">
          <div className="h-9 w-9 animate-spin rounded-full border-2 border-white/60 border-t-slate-700" />
          <span className="font-medium text-slate-700/80">{progress > 0 ? `${Math.round(progress * 100)}%` : 'Loading…'}</span>
        </div>
      )}
      {status === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center p-3 text-center text-xs text-rose-600">
          3D avatar could not load (WebGL needed). Pick another character in the editor.
        </div>
      )}
    </div>
  )
}

/** Hooks lip-sync, gaze and gestures into TalkingHead's own animation loop. */
function installDriver(th: TalkingHeadT, driver?: { current: RealisticDriver }) {
  if (!driver) return
  let smooth = 0
  let shape: string = 'viseme_aa'
  let shapeLeft = 0
  let wasSpeaking = false
  let lastState: AgentState | null = null
  let lastReaction: RealisticDriver['reaction'] = null
  const cur: Record<string, number> = Object.fromEntries(MOUTH_KEYS.map((k) => [k, 0]))

  const set = (k: string, v: number | null) => {
    const mt = th.mtAvatar[k]
    if (mt) Object.assign(mt, { realtime: v, needsUpdate: true })
  }

  th.opt.update = (dt: number) => {
    const { state, reaction, level } = driver.current
    const ms = Math.min(dt, 100)

    // ---- state changes: gaze & gestures
    if (state !== lastState) {
      if (state === 'listening') th.makeEyeContact(4000)
      else if (state === 'thinking') th.lookAt(window.innerWidth * 0.75, window.innerHeight * 0.05, 1400)
      else if (state === 'speaking') th.lookAtCamera(2500)
      lastState = state
    }
    if (reaction !== lastReaction) {
      if (reaction === 'goodbye') th.playGesture('handup', 2.5)
      else if (reaction === 'surprised') { th.playGesture('shrug', 1.2) }
      else if (reaction === 'concerned') th.lookAtCamera(3000)
      lastReaction = reaction
    }

    // ---- lip-sync from loudness
    const speaking = state === 'speaking'
    const raw = speaking ? Math.min(1, level()) : 0
    smooth += (raw - smooth) * (raw > smooth ? 0.55 : 0.25)
    if (!speaking && smooth < 0.01) {
      if (wasSpeaking) { MOUTH_KEYS.forEach((k) => set(k, null)); wasSpeaking = false }
      return
    }
    wasSpeaking = true
    shapeLeft -= ms
    if (shapeLeft <= 0) {
      // Mostly vowels; briefly close the lips now and then, like consonants do.
      shape = Math.random() < 0.22 ? CLOSERS[Math.floor(Math.random() * CLOSERS.length)] : VISEMES[Math.floor(Math.random() * VISEMES.length)]
      shapeLeft = 70 + Math.random() * 60
    }
    const amp = Math.min(1, smooth * 1.4)
    for (const k of MOUTH_KEYS) {
      let target = 0
      if (k === shape) target = shape.startsWith('viseme_') && (CLOSERS as readonly string[]).includes(shape) ? 0.6 * Math.min(1, amp * 2) : amp * 0.85
      if (k === 'jawOpen') target = (CLOSERS as readonly string[]).includes(shape) ? amp * 0.05 : amp * 0.22
      cur[k] += (target - cur[k]) * Math.min(1, ms / 45)
      set(k, cur[k] < 0.005 ? 0 : cur[k])
    }
  }
}
