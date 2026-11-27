import { defaults, type Media, type Settings } from './model'
type Bus = 'bgm' | 'entrance' | 'effect' | 'video'
type Voice = { media:Media; buffer:AudioBuffer; source:AudioBufferSourceNode; gain:GainNode; started:number; offset:number; stopping:boolean }
export class Mixer {
  readonly ctx = new AudioContext()
  readonly master = this.ctx.createGain()
  readonly duck = this.ctx.createGain()
  readonly videoGain = this.ctx.createGain()
  readonly videoGate = this.ctx.createGain()
  readonly buses = { bgm:this.ctx.createGain(), entrance:this.ctx.createGain(), effect:this.ctx.createGain(), video:this.ctx.createGain() }
  readonly voices = new Set<Voice>()
  private buffers = new Map<string, Promise<AudioBuffer>>()
  private decodedEffectBytes = 0
  private lastEffect = new Map<string,number>()
  private bgmRequest = 0
  private generation = 0
  private bgm: Voice | null = null
  private paused: { media:Media; buffer:AudioBuffer; offset:number } | null = null
  private video: Media | null = null
  private ducked = false
  private config = defaults
  constructor() {
    const limiter = this.ctx.createDynamicsCompressor()
    limiter.threshold.value = -6
    limiter.ratio.value = 16
    this.master.connect(limiter).connect(this.ctx.destination)
    this.buses.bgm.connect(this.duck).connect(this.master)
    this.buses.entrance.connect(this.master)
    this.buses.effect.connect(this.master)
    this.buses.video.connect(this.master)
    this.videoGain.connect(this.videoGate).connect(this.buses.video)
    this.videoGate.gain.value = 0
  }
  private ramp(param: AudioParam, value: number, ms: number) {
    const now = this.ctx.currentTime
    param.cancelAndHoldAtTime(now)
    param.linearRampToValueAtTime(value, now + Math.max(ms, 5)/1000)
  }
  levels(values: Record<Bus | 'master',number>) {
    for (const bus of Object.keys(this.buses) as Bus[]) this.ramp(this.buses[bus].gain,values[bus]/100,30)
    this.ramp(this.master.gain,values.master/100,30)
  }
  settings(config:Settings) { this.config = config; this.updateDuck(true) }
  private updateDuck(force = false) {
    const active = this.config.duck && (!!this.video?.ducking_enabled ||
      Array.from(this.voices).some(v => v.media.media_type !== 'bgm' && v.media.ducking_enabled))
    if (!force && active === this.ducked) return
    this.ducked = active
    this.ramp(this.duck.gain, active ? 1-this.config.reduction/100 : 1, active ? this.config.attack : this.config.release)
  }
  attach(video:HTMLVideoElement) {
    const node = this.ctx.createMediaElementSource(video)
    node.connect(this.videoGain)
    return () => node.disconnect()
  }
  videoPlaying(media:Media | null, restore = false) {
    this.video = media
    if (media) {
      this.ramp(this.videoGain.gain,media.volume/100,media.fade_in_ms)
      if (restore) this.ramp(this.videoGate.gain,1,10)
    }
    this.updateDuck()
  }
  muteVideo(ms=10) { this.ramp(this.videoGate.gain,0,ms); this.videoPlaying(null) }
  preload(media:Media, url:string, keep = media.media_type === 'effect' && (media.duration ?? Infinity) <= 20) {
    const cached = this.buffers.get(media.storage_path)
    if (cached) return cached
    const pending = fetch(url).then(r => {
      if (!r.ok) throw new Error('音声を取得できません')
      return r.arrayBuffer()
    }).then(bytes => this.ctx.decodeAudioData(bytes))
    if (keep) {
      this.buffers.set(media.storage_path,pending)
      void pending.then(buffer => {
        if (this.buffers.get(media.storage_path) !== pending) return
        const bytes = buffer.length * buffer.numberOfChannels * Float32Array.BYTES_PER_ELEMENT
        if (this.decodedEffectBytes + bytes > 64 * 1024 * 1024) this.buffers.delete(media.storage_path)
        else this.decodedEffectBytes += bytes
      }, () => {
        if (this.buffers.get(media.storage_path) === pending) this.buffers.delete(media.storage_path)
      })
    }
    return pending
  }
  async play(media:Media, resolve:() => Promise<string>) {
    const gen = this.generation
    const request = media.media_type === 'bgm' ? ++this.bgmRequest : 0
    if (media.media_type === 'effect') {
      const now = performance.now()
      if (now - (this.lastEffect.get(media.id) ?? -Infinity) < 140) return
      this.lastEffect.set(media.id, now)
    }
    const activation = this.ctx.state==='running' ? Promise.resolve() : this.ctx.resume()
    void activation.catch(()=>{})
    const buffer = this.buffers.has(media.storage_path) ? await this.buffers.get(media.storage_path)! : await this.preload(media,await resolve())
    await activation
    if (gen !== this.generation || (request && request !== this.bgmRequest)) return
    if (this.voices.size >= 32 && !request) return
    if (request) {
      if (this.bgm) this.end(this.bgm,10)
      this.paused = null
    }
    this.start(media,buffer,0)
  }
  private start(media:Media, buffer:AudioBuffer, offset:number) {
    const source = this.ctx.createBufferSource()
    const gain = this.ctx.createGain()
    gain.gain.value = 0
    source.buffer = buffer
    source.loop = media.loop_enabled
    source.connect(gain).connect(this.buses[media.media_type as Bus])
    const voice:Voice = {media,buffer,source,gain,offset,started:this.ctx.currentTime,stopping:false}
    this.voices.add(voice)
    if (media.media_type === 'bgm') this.bgm = voice
    source.onended = () => {
      this.voices.delete(voice)
      if (this.bgm === voice) this.bgm = null
      source.disconnect()
      gain.disconnect()
      this.updateDuck()
    }
    this.updateDuck()
    this.ramp(gain.gain,media.volume/100,media.fade_in_ms)
    source.start(0,offset)
  }
  private end(voice:Voice, ms:number) {
    if (voice.stopping && ms > 10) return
    voice.stopping = true
    this.ramp(voice.gain.gain,0,ms)
    voice.source.stop(this.ctx.currentTime + Math.max(5,ms)/1000)
  }
  stop(ms?:number) {
    this.generation++
    this.paused = null
    for (const voice of this.voices) this.end(voice,ms ?? voice.media.fade_out_ms)
  }
  toggleBgm() {
    this.bgmRequest++
    if (this.bgm && !this.bgm.stopping) {
      const { media,buffer } = this.bgm
      this.paused = {media,buffer,offset:this.position}
      this.end(this.bgm,10)
      this.bgm = null
    } else if (this.paused) {
      const { media,buffer,offset } = this.paused
      this.paused = null
      this.start(media,buffer,offset)
    }
  }
  get position() {
    if (!this.bgm) return this.paused?.offset ?? 0
    const pos = this.ctx.currentTime - this.bgm.started + this.bgm.offset
    return this.bgm.media.loop_enabled ? pos % this.bgm.buffer.duration : pos
  }
  get current() { return this.bgm?.media ?? this.paused?.media }
  get isPaused() { return !!this.paused }
  clearBuffers() { this.buffers.clear(); this.decodedEffectBytes = 0 }
}
