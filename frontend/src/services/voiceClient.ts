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

  constructor(id: string, onDone: () => void) {
    this.id = id
    this.onDone = onDone
    this.audio.onended = () => this.finish()
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
  private ev: VoiceEvents

  constructor(events: VoiceEvents) {
    this.ev = events
  }

  async connect(url: string, withMic = true) {
    this.ev.onState?.('connecting')
    if (withMic) {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      })
      this.ctx = new AudioContext()
      await this.ctx.audioWorklet.addModule('/pcm-worklet.js')
      const src = this.ctx.createMediaStreamSource(this.stream)
      this.node = new AudioWorkletNode(this.ctx, 'pcm-capture')
      this.node.port.onmessage = (e: MessageEvent<{ pcm: ArrayBuffer; level: number }>) => {
        this.ev.onLevel?.(e.data.level)
        if (!this.muted && this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'audio', data: bytesToB64(e.data.pcm) }))
        }
      }
      src.connect(this.node)
    }
    this.ws = new WebSocket(url)
    this.ws.onmessage = (m) => this.handle(JSON.parse(m.data))
    this.ws.onclose = () => { this.ev.onState?.('ended'); this.cleanupAudio() }
    this.ws.onerror = () => this.ev.onError?.('Connection error')
  }

  setMuted(m: boolean) { this.muted = m }

  sendText(text: string) {
    this.ws?.send(JSON.stringify({ type: 'text', text }))
  }

  hangup() {
    try { this.ws?.send(JSON.stringify({ type: 'stop' })) } catch { /* closed */ }
    this.ws?.close()
    this.cleanupAudio()
  }

  private cleanupAudio() {
    this.player?.stop()
    this.player = null
    this.node?.disconnect()
    this.stream?.getTracks().forEach((t) => t.stop())
    this.ctx?.close().catch(() => {})
    this.node = null; this.stream = null; this.ctx = null
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
            this.ws?.send(JSON.stringify({ type: 'playback_done', utterance_id: uid }))
          })
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
