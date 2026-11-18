/**
 * Photo avatar rendered in 3D: a real portrait turned into a depth-displaced mesh (WebGL2), so the head
 * actually turns, nods and tilts with parallax instead of sliding around as a flat picture.
 *
 *  - Depth: built from the calibrated face landmarks: a head ellipsoid with nose ridge, eye sockets and
 *    lips, a neck cylinder and a torso, blended with a smooth max. The background stays flat.
 *  - Head pose: vertices inside the head (fading out over the hair and neck) rotate about a pivot in the
 *    neck, and the surface shading follows the rotated normals, so light moves across the face.
 *  - The camera orbits a little and the chest breathes, so the face shows parallax against the backdrop.
 *  - The head follows the pointer while idle or listening; it nods, tilts and looks away per state.
 *  - Mouth: the fragment shader opens the lips with the agent's voice (lower lip and chin pushed down,
 *    upper lip lifted, lens-shaped dark interior with a soft hint of teeth).
 *  - Blinks: the upper eyelid skin is stretched down over the eye for about 150 ms every few seconds.
 *
 * Without WebGL2 the portrait is shown as a still image.
 */

import { useEffect, useRef, useState } from 'react'
import type { RealisticDriver, RealisticFraming } from './RealisticAvatar'

export interface PortraitSpec {
  src: string
  /** lip seam centre (fractions of width / height) */
  mouth: { x: number; y: number }
  /** half the mouth width, fraction of image width */
  mouthHalfWidth: number
  /** bottom of the chin, fraction of image height */
  chinY: number
  /** face ellipse (forehead to chin, cheek to cheek): centre, x radius (of width), y radius (of height) */
  head: { x: number; y: number; rx: number; ry: number }
  /** nose tip */
  nose: { x: number; y: number }
  /** the two eye openings: centre and half width (of width) / half height (of height) */
  eyes: [{ x: number; y: number; w: number; h: number }, { x: number; y: number; w: number; h: number }]
  /** neck centre and half width (of width), and where the shoulders start (of height) */
  neck: { x: number; halfWidth: number; shoulderY: number }
  /** visible area per framing: centre and height, fractions of the image */
  frames: Record<RealisticFraming, { x: number; y: number; h: number }>
}

interface Props {
  spec: PortraitSpec
  framing: RealisticFraming
  width: number
  height: number
  driver?: { current: RealisticDriver }
  className?: string
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const DEG = Math.PI / 180
const FOV = 20 * DEG

const VERT = `#version 300 es
precision highp float;
in vec2 aUV;
uniform vec2 uImg;
uniform vec4 uHead;   // cx, cy, rx, ry (px)
uniform vec2 uNose;
uniform vec4 uEyeL, uEyeR;
uniform vec3 uMouth;  // cx, cy, chin y
uniform vec3 uNeck;   // cx, half width, shoulder y
uniform mat3 uRot;
uniform vec3 uPivot;
uniform float uBreath;
uniform mat4 uViewProj;
out vec2 vUV;
out float vShade;
out float vFocus;

float smax(float a, float b, float k) { float h = max(k - abs(a - b), 0.0) / k; return max(a, b) + h * h * k * 0.25; }
float gauss(vec2 d, vec2 s) { vec2 q = d / s; return exp(-dot(q, q)); }

float depth(vec2 p) {
  float R = uHead.z;
  vec2 hd = (p - uHead.xy) / uHead.zw;
  float e = dot(hd, hd);
  float z = R * 0.9 * sqrt(max(0.0, 1.0 - e));
  z = smax(z, R * 0.45 * max(0.0, 1.0 - e / 2.2), R * 0.2);          // skull and hair behind the outline
  float eyeY = (uEyeL.y + uEyeR.y) * 0.5;
  vec2 bridge = vec2(uNose.x, mix(eyeY, uNose.y, 0.6));
  z += R * 0.22 * gauss(p - bridge, vec2(R * 0.13, (uNose.y - eyeY) * 0.6));   // nose
  z -= R * 0.06 * gauss(p - uEyeL.xy, vec2(uEyeL.z * 1.3));                  // eye sockets
  z -= R * 0.06 * gauss(p - uEyeR.xy, vec2(uEyeR.z * 1.3));
  z += R * 0.04 * gauss(p - uMouth.xy, vec2(R * 0.3, R * 0.12));             // lips
  float nx = (p.x - uNeck.x) / uNeck.y;
  float zn = uNeck.y * 0.75 * sqrt(max(0.0, 1.0 - nx * nx)) * smoothstep(uHead.y, uMouth.z, p.y);
  z = smax(z, zn, R * 0.15);
  vec2 tc = vec2(uNeck.x, uImg.y * 1.25);
  vec2 tr = vec2(uImg.x * 0.6, uImg.y * 1.25 - uNeck.z);
  vec2 td = (p - tc) / tr;
  z = smax(z, R * 0.75 * sqrt(max(0.0, 1.0 - dot(td, td))), R * 0.25);       // chest and shoulders
  return z;
}

void main() {
  vec2 p = aUV * uImg;
  float z = depth(p);
  float zx = depth(p + vec2(2.0, 0.0)) - z;
  float zy = depth(p + vec2(0.0, 2.0)) - z;
  vec3 n0 = normalize(vec3(-zx * 0.5, zy * 0.5, 1.0));
  vec3 P = vec3(p.x - uImg.x * 0.5, uImg.y * 0.5 - p.y, z) / uImg.y;
  // how much of the head pose this point follows: the whole face, fading over hair and neck
  float w = 1.0 - smoothstep(1.0, 1.7, length((p - uHead.xy) / uHead.zw));
  w *= 1.0 - smoothstep(uMouth.z, uNeck.z, p.y);
  P = mix(P, uPivot + uRot * (P - uPivot), w);
  vec3 n1 = normalize(mix(n0, uRot * n0, w));
  P.y += uBreath * (0.35 + 0.65 * smoothstep(uHead.y - uHead.w, uNeck.z, p.y));
  vec3 L = normalize(vec3(-0.35, 0.45, 0.82));
  vShade = 1.0 + 0.9 * (dot(n1, L) - dot(n0, L));
  vUV = aUV;
  // focus: head with its hair, the neck and hair column, and the chest; everything else is backdrop
  float hdist = length((p - uHead.xy) / uHead.zw);
  float f = 1.0 - smoothstep(1.35, 2.4, hdist);
  f = max(f, (1.0 - smoothstep(1.6, 2.6, abs(p.x - uNeck.x) / uNeck.y))
           * (1.0 - smoothstep(uNeck.z + uHead.w * 0.6, uNeck.z + uHead.w * 1.2, p.y))
           * smoothstep(uHead.y - uHead.w, uHead.y, p.y));
  vec2 tq = (p - vec2(uNeck.x, uImg.y * 1.25)) / vec2(uImg.x * 0.6, uImg.y * 1.25 - uNeck.z);
  vFocus = max(f, 1.0 - smoothstep(0.8, 1.0, dot(tq, tq)));
  gl_Position = uViewProj * vec4(P, 1.0);
}`

const FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
in float vShade;
in float vFocus;
uniform sampler2D uTex;
uniform vec2 uImg;
uniform vec2 uRes;
uniform vec4 uEyeL, uEyeR;
uniform vec3 uMouth;
uniform float uHalfW;
uniform float uOpen;
uniform float uBlink;
out vec4 outColor;

// stretch the upper-eyelid skin down over the eye
float blinkY(vec2 p, vec4 e) {
  float dx = (p.x - e.x) / e.z;
  if (uBlink <= 0.0 || abs(dx) >= 1.0) return p.y;
  float prof = sqrt(1.0 - dx * dx);
  float top = e.y - e.w * 3.0;
  float open = e.y - e.w * 0.85 * prof;
  float L = mix(open, e.y + e.w * 1.1 * prof, uBlink);
  if (p.y < top || p.y > L) return p.y;
  return top + (p.y - top) * (open - top) / (L - top);
}

void main() {
  vec2 p = vUV * uImg;
  vec2 s = vec2(p.x, blinkY(vec2(p.x, blinkY(p, uEyeL)), uEyeR));
  vec3 inner = vec3(0.0);
  float ia = 0.0;
  float cx = uMouth.x, cy = uMouth.y, hw = uHalfW;
  float drop = uOpen * hw * 0.36;
  float u = (p.x - cx) / (hw * 0.96);
  if (drop > 0.3 && abs(u) < 1.0) {
    float g = drop * pow(cos(abs(u) * 1.5707963), 1.3);
    float lo = g * 0.75, hi = g * 0.25;
    float reach = (uMouth.z - cy) * 1.9, up = hw * 0.9;
    float top = cy - hi, bot = cy + lo;
    if (p.y >= bot && p.y < cy + reach) s.y = cy + (p.y - bot) * reach / (reach - lo);
    else if (p.y >= cy - up && p.y < top) s.y = cy - up + (p.y - cy + up) * up / (up - hi);
    else if (p.y >= top && p.y < bot) s.y = cy;
    ia = smoothstep(top - 0.6, top + 0.6, p.y) * (1.0 - smoothstep(bot - 0.6, bot + 0.6, p.y)) * smoothstep(0.0, 0.6, g);
    inner = mix(vec3(38.0, 13.0, 15.0), vec3(74.0, 26.0, 30.0), clamp((p.y - top) / max(g, 0.001), 0.0, 1.0)) / 255.0;
    if (g > hw * 0.15 && abs(u) < 0.6) {
      float th = min(g * 0.3, hw * 0.1);
      float ta = min(0.5, g / (hw * 0.36) * 0.5) * (1.0 - smoothstep(0.0, th, p.y - top));
      inner = mix(inner, vec3(228.0, 218.0, 210.0) / 255.0, ta);
    }
  }
  // portrait mode: the flat backdrop (no depth) is softly out of focus
  vec3 c = texture(uTex, s / uImg, (1.0 - vFocus) * 2.0).rgb;
  c = mix(c, inner, ia);
  c *= vShade;
  // studio grade: gentle S-curve, a touch of warmth, soft vignette
  c = mix(c, c * c * (3.0 - 2.0 * c), 0.18);
  c *= vec3(1.015, 1.0, 0.985);
  vec2 q = gl_FragCoord.xy / uRes - 0.5;
  c *= 1.0 - dot(q, q) * 0.38;
  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`

// ---- tiny matrix helpers (column-major, like GLSL)
function perspective(fovy: number, aspect: number, near: number, far: number) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far)
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]
}
function lookAt(e: number[], t: number[], up: number[]) {
  let zx = e[0] - t[0], zy = e[1] - t[1], zz = e[2] - t[2]
  let l = Math.hypot(zx, zy, zz); zx /= l; zy /= l; zz /= l
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx
  l = Math.hypot(xx, xy, xz); xx /= l; xy /= l; xz /= l
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx
  return [xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
    -(xx * e[0] + xy * e[1] + xz * e[2]), -(yx * e[0] + yy * e[1] + yz * e[2]), -(zx * e[0] + zy * e[1] + zz * e[2]), 1]
}
function mul4(a: number[], b: number[]) {
  const o = new Array(16).fill(0)
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]
  return o
}
/** R = Ry(yaw) · Rx(pitch) · Rz(roll), column-major mat3 */
function rotation(yaw: number, pitch: number, roll: number) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cx = Math.cos(pitch), sx = Math.sin(pitch), cz = Math.cos(roll), sz = Math.sin(roll)
  // rows of Rx·Rz
  const m = [[cz, -sz, 0], [cx * sz, cx * cz, -sx], [sx * sz, sx * cz, cx]]
  const r = [
    [cy * m[0][0] + sy * m[2][0], cy * m[0][1] + sy * m[2][1], cy * m[0][2] + sy * m[2][2]],
    m[1],
    [-sy * m[0][0] + cy * m[2][0], -sy * m[0][1] + cy * m[2][1], -sy * m[0][2] + cy * m[2][2]],
  ]
  return [r[0][0], r[1][0], r[2][0], r[0][1], r[1][1], r[2][1], r[0][2], r[1][2], r[2][2]]
}

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const sh = gl.createShader(type)!
  gl.shaderSource(sh, src); gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'shader error')
  return sh
}

export default function PhotoAvatar({ spec, framing, width, height, driver, className }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const framingRef = useRef(framing)
  framingRef.current = framing
  const [status, setStatus] = useState<'loading' | 'ready' | 'still'>('loading')

  useEffect(() => {
    if (!host.current) return
    // a fresh canvas per mount: its GL context is released on unmount and can't be reused
    const cv = document.createElement('canvas')
    cv.className = 'pointer-events-none absolute inset-0 h-full w-full'
    host.current.appendChild(cv)
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    cv.width = Math.round(width * dpr)
    cv.height = Math.round(height * dpr)
    const gl = cv.getContext('webgl2', { antialias: true, alpha: false, preserveDrawingBuffer: true })
    if (!gl) { cv.remove(); setStatus('still'); return }

    let raf = 0
    let cancelled = false
    let prog: WebGLProgram | null = null
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const pointer = { x: 0, y: 0, at: -1e9 }
    const onPointer = (e: PointerEvent) => {
      const r = cv.getBoundingClientRect()
      pointer.x = clamp((e.clientX - (r.left + r.width / 2)) / (window.innerWidth * 0.5), -1, 1)
      pointer.y = clamp((e.clientY - (r.top + r.height / 2)) / (window.innerHeight * 0.5), -1, 1)
      pointer.at = performance.now()
    }
    window.addEventListener('pointermove', onPointer, { passive: true })

    const img = new Image()
    img.decoding = 'async'
    img.src = spec.src

    const start = () => {
      const W = img.naturalWidth, H = img.naturalHeight
      try {
        prog = gl.createProgram()!
        gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT))
        gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG))
        gl.linkProgram(prog)
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link error')
      } catch (err) {
        console.warn('PhotoAvatar: WebGL shader failed, showing the still photo', err)
        cv.remove(); setStatus('still'); return
      }
      gl.useProgram(prog)

      // grid mesh over the whole photo
      const nx = 150, ny = Math.round(nx * (H / W))
      const uv = new Float32Array((nx + 1) * (ny + 1) * 2)
      for (let j = 0, k = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) { uv[k++] = i / nx; uv[k++] = j / ny }
      const idx = new Uint32Array(nx * ny * 6)
      for (let j = 0, k = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1
        idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d
      }
      const vao = gl.createVertexArray(); gl.bindVertexArray(vao)
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, uv, gl.STATIC_DRAW)
      const loc = gl.getAttribLocation(prog, 'aUV')
      gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW)

      const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img)
      gl.generateMipmap(gl.TEXTURE_2D)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

      const U = (n: string) => gl.getUniformLocation(prog!, n)
      const [eL, eR] = spec.eyes[0].x < spec.eyes[1].x ? spec.eyes : [spec.eyes[1], spec.eyes[0]]
      const headPx = { x: spec.head.x * W, y: spec.head.y * H, rx: spec.head.rx * W, ry: spec.head.ry * H }
      const chin = spec.chinY * H, shoulder = spec.neck.shoulderY * H
      gl.uniform2f(U('uImg'), W, H)
      gl.uniform4f(U('uHead'), headPx.x, headPx.y, headPx.rx, headPx.ry)
      gl.uniform2f(U('uNose'), spec.nose.x * W, spec.nose.y * H)
      gl.uniform4f(U('uEyeL'), eL.x * W, eL.y * H, eL.w * W, eL.h * H)
      gl.uniform4f(U('uEyeR'), eR.x * W, eR.y * H, eR.w * W, eR.h * H)
      gl.uniform3f(U('uMouth'), spec.mouth.x * W, spec.mouth.y * H, chin)
      gl.uniform3f(U('uNeck'), spec.neck.x * W, spec.neck.halfWidth * W, shoulder)
      gl.uniform1f(U('uHalfW'), spec.mouthHalfWidth * W)
      gl.uniform1i(U('uTex'), 0)
      gl.uniform2f(U('uRes'), cv.width, cv.height)
      // pivot: inside the neck, a little behind the face
      const pivotPx = { x: headPx.x, y: chin + (shoulder - chin) * 0.3, z: -headPx.rx * 0.2 }
      gl.uniform3f(U('uPivot'), (pivotPx.x - W / 2) / H, (H / 2 - pivotPx.y) / H, pivotPx.z / H)
      const uRot = U('uRot'), uViewProj = U('uViewProj'), uBreath = U('uBreath'), uOpen = U('uOpen'), uBlink = U('uBlink')
      gl.enable(gl.DEPTH_TEST)
      gl.viewport(0, 0, cv.width, cv.height)

      // animated state
      const cur = { open: 0, yaw: 0, pitch: 0, roll: 0, frameX: 0, frameY: 0, frameH: 0 }
      let smooth = 0, syllable = 0, syllableLeft = 0
      let last = performance.now()
      let goodbyeAt = -1
      let lastReaction: RealisticDriver['reaction'] = null
      let nextBlink = last + 1500, blinkStart = -1
      let wanderAt = 0, wanderYaw = 0, wanderPitch = 0

      const draw = (now: number) => {
        raf = requestAnimationFrame(draw)
        const dt = Math.min(100, now - last); last = now
        const t = now / 1000
        const d = driver?.current
        const state = d?.state ?? null
        const m = reduce ? 0.3 : 1
        const speaking = state === 'speaking'

        // voice → mouth opening (0..1)
        const raw = speaking ? Math.min(1, (d?.level() ?? 0) * 1.5) : 0
        smooth += (raw - smooth) * (raw > smooth ? 0.5 : 0.2)
        syllableLeft -= dt
        if (syllableLeft <= 0) { syllable = 0.55 + Math.random() * 0.45; syllableLeft = 80 + Math.random() * 70 }
        cur.open = lerp(cur.open, smooth > 0.04 ? Math.min(1, smooth * syllable * 1.3) : 0, Math.min(1, dt / 55))

        // blinks
        if (blinkStart < 0 && now >= nextBlink) blinkStart = now
        let blink = 0
        if (blinkStart >= 0) {
          const k = (now - blinkStart) / 150
          if (k >= 1) { blinkStart = -1; nextBlink = now + 2200 + Math.random() * 3800 } else blink = Math.sin(k * Math.PI)
        }

        // head pose per state (degrees)
        if (d?.reaction !== lastReaction) { if (d?.reaction === 'goodbye') goodbyeAt = t; lastReaction = d?.reaction ?? null }
        if (now > wanderAt) { wanderYaw = (Math.random() - 0.5) * 5; wanderPitch = (Math.random() - 0.5) * 3; wanderAt = now + 2500 + Math.random() * 3000 }
        const follow = now - pointer.at < 4000 && (state === null || state === 'idle' || state === 'listening')
        let yaw = wanderYaw + Math.sin(t * 0.37) * 1.5, pitch = wanderPitch + Math.sin(t * 0.5) * 1, roll = Math.sin(t * 0.6) * 0.8
        if (follow) { yaw = pointer.x * 9; pitch = pointer.y * 6 }
        if (state === 'listening') { roll += 3; pitch += 2 }
        else if (state === 'thinking') { yaw = -7; pitch = -5; roll = -2 }
        else if (speaking) { yaw = Math.sin(t * 0.9) * 4; pitch = Math.sin(t * 2.1) * 2.5 * smooth + Math.sin(t * 0.6); roll = Math.sin(t * 1.3) * 1.5 }
        if (goodbyeAt >= 0 && t - goodbyeAt < 1.4) pitch += Math.sin((t - goodbyeAt) * Math.PI * 2 / 0.7) * 7
        const k = Math.min(1, dt / 220)
        cur.yaw = lerp(cur.yaw, yaw * m, k); cur.pitch = lerp(cur.pitch, pitch * m, Math.min(1, dt / 120)); cur.roll = lerp(cur.roll, roll * m, k)

        // framing → camera
        const f = spec.frames[framingRef.current]
        if (!cur.frameH) { cur.frameX = f.x; cur.frameY = f.y; cur.frameH = f.h }
        cur.frameX = lerp(cur.frameX, f.x, 0.12); cur.frameY = lerp(cur.frameY, f.y, 0.12); cur.frameH = lerp(cur.frameH, f.h, 0.12)
        const aspect = cv.width / cv.height
        const imgW = W / H
        let vh = Math.min(1, cur.frameH), vw = vh * aspect
        if (vw > imgW) { vw = imgW; vh = vw / aspect }
        const cxw = clamp(cur.frameX * imgW, vw / 2, imgW - vw / 2) - imgW / 2
        const cyw = 0.5 - clamp(cur.frameY, vh / 2, 1 - vh / 2)
        const zoom = 1.07 // headroom so motion never shows the photo's edges
        const dist = (vh / zoom / 2) / Math.tan(FOV / 2)
        const oy = (Math.sin(t * 0.23) * 1.6 + cur.yaw * 0.25) * DEG * m
        const ox = (Math.sin(t * 0.31) * 0.8 - cur.pitch * 0.15) * DEG * m
        const target = [cxw, cyw, 0]
        const eye = [cxw + dist * Math.sin(oy) * Math.cos(ox), cyw + dist * Math.sin(ox), dist * Math.cos(oy) * Math.cos(ox)]
        const vp = mul4(perspective(FOV, aspect, dist * 0.5, dist * 2), lookAt(eye, target, [0, 1, 0]))

        gl.uniformMatrix4fv(uViewProj, false, vp)
        gl.uniformMatrix3fv(uRot, false, rotation(cur.yaw * DEG, cur.pitch * DEG, -cur.roll * DEG))
        gl.uniform1f(uBreath, Math.sin(t * 1.6) * 0.0022 * m)
        gl.uniform1f(uOpen, cur.open)
        gl.uniform1f(uBlink, blink)
        gl.clearColor(0.85, 0.86, 0.88, 1)
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
        gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_INT, 0)
      }
      setStatus('ready')
      raf = requestAnimationFrame(draw)
    }

    img.onload = () => { if (!cancelled) start() }
    img.onerror = () => { if (!cancelled) setStatus('still') }
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', onPointer)
      gl.getExtension('WEBGL_lose_context')?.loseContext() // free the context; browsers cap how many stay alive
      cv.remove()
    }
  }, [spec, width, height, driver])

  return (
    <div className={`relative overflow-hidden bg-slate-200 ${className ?? ''}`} style={{ width, height }}>
      <div ref={host} className={status === 'still' ? 'hidden' : ''} />
      {status === 'loading' && <div className="skeleton absolute inset-0 rounded-none" />}
      {status === 'still' && (
        <img src={spec.src} alt="" className="absolute inset-0 h-full w-full object-cover"
          style={{ objectPosition: `${spec.frames[framing].x * 100}% ${spec.frames[framing].y * 100}%` }} />
      )}
    </div>
  )
}
