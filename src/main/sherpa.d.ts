declare module 'sherpa-onnx-node' {
  export interface Waveform {
    samples: Float32Array
    sampleRate: number
  }
  export class OfflineStream {
    acceptWaveform(w: Waveform): void
  }
  export class OfflineRecognizer {
    static createAsync(config: unknown): Promise<OfflineRecognizer>
    createStream(): OfflineStream
    decodeAsync(stream: OfflineStream): Promise<{ text: string; lang?: string }>
  }
  export class OnlineStream {
    acceptWaveform(w: Waveform): void
    inputFinished(): void
  }
  export class SpeakerEmbeddingExtractor {
    constructor(config: { model: string; numThreads?: number; debug?: number; provider?: string })
    dim: number
    createStream(): OnlineStream
    isReady(s: OnlineStream): boolean
    compute(s: OnlineStream, enableExternalBuffer?: boolean): Float32Array
  }
}
