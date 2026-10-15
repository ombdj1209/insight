// Collects mono PCM into 30 ms frames (480 samples at 16 kHz) and posts them to the main thread.
class PcmFramer extends AudioWorkletProcessor {
  constructor() {
    super()
    this.frame = new Float32Array(480)
    this.pos = 0
  }
  process(inputs) {
    const input = inputs[0]
    if (!input || input.length === 0) return true
    const chs = input.length
    const len = input[0].length
    for (let i = 0; i < len; i++) {
      let v = 0
      for (let c = 0; c < chs; c++) v += input[c][i]
      this.frame[this.pos++] = v / chs
      if (this.pos === 480) {
        this.port.postMessage(this.frame.slice(0))
        this.pos = 0
      }
    }
    return true
  }
}
registerProcessor('pcm-framer', PcmFramer)
