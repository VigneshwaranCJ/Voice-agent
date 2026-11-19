/**
 * Browser voice client: mic → 16 kHz PCM16 frames over WebSocket; streamed MP3 replies played with
 * MediaSource (falls back to whole-utterance playback). Supports barge-in ("interrupt" from server).
 */

export type AgentState = 'connecting' | 'listening' | 'thinking' | 'speaking' | 'ended'

export interface VoiceEvents {
  onState?: (s: AgentState) => void
  onTranscript?: (t: { role: 'user' | 'agent'; text: string; final: boolean; language?: string | null; id?: string }) => void
  onEvent?: (e: Record<string, unknown>) => void
  onLevel?: (level: number) => void
  onError?: (msg: string) => void
  onReady?: (info: Record<string, unknown>) => void
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function bytesToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

/** Plays one utterance's MP3 chunks as they arrive. */
class UtterancePlayer {
  readonly id: string
  private audio = new Audio()
  private ms: MediaSource | null = null
  private sb: SourceBuffer | null = null
  private queue: Uint8Array[] = []
  private chunks: Uint8Array[] = []
  private ended = false
  private stopped = false
  private onDone: () => void
  private useMse = typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported('audio/mpeg')

  constructor(id: string, onDone: () => void, output?: { ctx: AudioContext; analyser: AnalyserNode }) {
    this.id = id
    this.onDone = onDone
    this.audio.onended = () => this.finish()
    if (output) {
      // Route playback through an analyser so the avatar can lip-sync to the agent's voice.
      try { output.ctx.createMediaElementSource(this.audio).connect(output.analyser) } catch { /* plays directly */ }
    }
    if (this.useMse) {
      this.ms = new MediaSource()
      this.audio.src = URL.createObjectURL(this.ms)
      this.ms.addEventListener('sourceopen', () => {
        this.sb = this.ms!.addSourceBuffer('audio/mpeg')
        this.sb.mode = 'sequence'
        this.sb.addEventListener('updateend', () => this.pump())
        this.pump()
      })
      this.audio.play().catch(() => { /* autoplay resolved by user gesture on connect */ })
    }
  }

  push(chunk: Uint8Array) {
    if (this.stopped) return
    this.chunks.push(chunk)
    if (this.useMse) { this.queue.push(chunk); this.pump() }
  }

  end() {
    this.ended = true
    if (this.useMse) this.pump()
    else {
      const blob = new Blob(this.chunks as BlobPart[], { type: 'audio/mpeg' })
      this.audio.src = URL.createObjectURL(blob)
      this.audio.play().catch(() => this.finish())
    }
  }

  private pump() {
    if (!this.sb || this.sb.updating || this.stopped) return
    const next = this.queue.shift()
    if (next) {
      try { this.sb.appendBuffer(next as BufferSource) } catch { /* quota/abort */ }
    } else if (this.ended && this.ms?.readyState === 'open') {
      try { this.ms.endOfStream() } catch { /* already ended */ }
    }
    if (this.audio.paused && !this.stopped) this.audio.play().catch(() => {})
  }

  stop() {
    this.stopped = true
    this.audio.pause()
    this.audio.removeAttribute('src')
    this.audio.load()
  }

  private finish() {
    if (!this.stopped) { this.stopped = true; this.onDone() }
  }
}

export class VoiceClient {
  private ws: WebSocket | null = null
  private ctx: AudioContext | null = null
  private stream: MediaStream | null = null
  private node: AudioWorkletNode | null = null
  private player: UtterancePlayer | null = null
  private muted = false
  private hungUp = false // the caller ended the call, so a close is expected
  private ev: VoiceEvents
  private out: { ctx: AudioContext; analyser: AnalyserNode; buf: Float32Array<ArrayBuffer> } | null = null

  /** Latest caller mic level (0..~0.4 RMS). Read every frame by the avatar; no React re-render needed. */
  micLevel = 0

  constructor(events: VoiceEvents) {
    this.ev = events
  }

  /** Current loudness of the agent's voice, 0..1 (smoothed by the analyser). */
  agentLevel(): number {
    if (!this.out) return 0
    this.out.analyser.getFloatTimeDomainData(this.out.buf)
    let sum = 0
    for (let i = 0; i < this.out.buf.length; i++) sum += this.out.buf[i] * this.out.buf[i]
    return Math.min(1, Math.sqrt(sum / this.out.buf.length) * 4)
  }

  async connect(url: string, withMic = true) {
    this.ev.onState?.('connecting')
    // Created inside the user's click, so autoplay policies allow it.
    try {
      const ctx = new AudioContext()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 1024
      analyser.smoothingTimeConstant = 0.5
      analyser.connect(ctx.destination)
      this.out = { ctx, analyser, buf: new Float32Array(analyser.fftSize) }
    } catch { this.out = null }
    if (withMic) {
      // Browsers only expose the microphone on HTTPS (or localhost); on plain http:// mediaDevices is undefined.
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        throw new Error('The microphone needs a secure connection. Open this page with https:// (or use Text only).')
      }
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      })
      this.ctx = new AudioContext()
      await this.ctx.audioWorklet.addModule('/pcm-worklet.js')
      const src = this.ctx.createMediaStreamSource(this.stream)
      this.node = new AudioWorkletNode(this.ctx, 'pcm-capture')
      this.node.port.onmessage = (e: MessageEvent<{ pcm: ArrayBuffer; level: number }>) => {
        this.micLevel = this.muted ? 0 : e.data.level
        this.ev.onLevel?.(e.data.level)
        if (!this.muted && this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'audio', data: bytesToB64(e.data.pcm) }))
        }
      }
      src.connect(this.node)
    }
    this.ws = new WebSocket(url)
    let received = false
    this.ws.onmessage = (m) => { received = true; this.handle(JSON.parse(m.data)) }
    this.ws.onclose = (e) => {
      // 1000 = normal end, 4xxx = the server ended the call on purpose (and already sent a reason).
      if (!this.hungUp && e.code !== 1000 && e.code < 4000) {
        this.ev.onError?.(received
          ? `The connection to the voice server was lost (code ${e.code}).`
          : `The call could not connect: the voice server closed the connection before sending anything (code ${e.code}). `
            + 'This usually means the web host is not passing WebSocket traffic through.')
      }
      this.ev.onState?.('ended'); this.cleanupAudio()
    }
    this.ws.onerror = () => { if (!received) return; this.ev.onError?.('Connection error') } // onclose explains early failures
  }

  setMuted(m: boolean) { this.muted = m }

  private send(msg: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg))
  }

  sendText(text: string) {
    this.send({ type: 'text', text })
  }

  hangup() {
    this.hungUp = true
    this.send({ type: 'stop' })
    this.ws?.close()
    this.cleanupAudio()
  }

  private cleanupAudio() {
    this.player?.stop()
    this.player = null
    this.node?.disconnect()
    this.stream?.getTracks().forEach((t) => t.stop())
    this.ctx?.close().catch(() => {})
    this.out?.ctx.close().catch(() => {})
    this.node = null; this.stream = null; this.ctx = null; this.out = null; this.micLevel = 0
  }

  private handle(msg: Record<string, any>) {
    switch (msg.type) {
      case 'ready': this.ev.onReady?.(msg); break
      case 'state': this.ev.onState?.(msg.value); break
      case 'transcript':
        this.ev.onTranscript?.({ role: 'user', text: msg.text, final: msg.final, language: msg.language }); break
      case 'agent_text':
        this.ev.onTranscript?.({ role: 'agent', text: msg.text, final: true, language: msg.language, id: msg.utterance_id })
        break
      case 'audio': {
        if (!this.player || this.player.id !== msg.utterance_id) {
          this.player?.stop()
          const uid = msg.utterance_id as string
          this.player = new UtterancePlayer(uid, () => {
            this.send({ type: 'playback_done', utterance_id: uid })
          }, this.out ?? undefined)
        }
        this.player.push(b64ToBytes(msg.data))
        break
      }
      case 'audio_end':
        if (this.player && this.player.id === msg.utterance_id) this.player.end()
        break
      case 'interrupt':
        this.player?.stop(); this.player = null
        this.ev.onEvent?.(msg); break
      case 'error': this.ev.onError?.(msg.message); break
      case 'ended': this.ev.onEvent?.(msg); this.ws?.close(); break
      default: this.ev.onEvent?.(msg)
    }
  }
}
