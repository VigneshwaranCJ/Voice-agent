// AudioWorklet: downsample mic audio to 16 kHz mono PCM16 and post ~100 ms frames to the main thread.
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super()
    this.ratio = sampleRate / 16000
    this.buf = []
    this.pos = 0
    this.frame = 1600 // 100 ms @ 16 kHz
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (!ch) return true
    // Linear-interpolation resampler (input rate is usually 48 kHz).
    while (this.pos < ch.length) {
      const i = Math.floor(this.pos)
      const frac = this.pos - i
      const a = ch[i]
      const b = i + 1 < ch.length ? ch[i + 1] : a
      this.buf.push(a + (b - a) * frac)
      this.pos += this.ratio
    }
    this.pos -= ch.length
    if (this.buf.length >= this.frame) {
      const out = new Int16Array(this.frame)
      let peak = 0
      for (let k = 0; k < this.frame; k++) {
        const s = Math.max(-1, Math.min(1, this.buf[k]))
        out[k] = s < 0 ? s * 0x8000 : s * 0x7fff
        peak = Math.max(peak, Math.abs(s))
      }
      this.buf = this.buf.slice(this.frame)
      this.port.postMessage({ pcm: out.buffer, level: peak }, [out.buffer])
    }
    return true
  }
}

registerProcessor('pcm-capture', PcmCapture)
