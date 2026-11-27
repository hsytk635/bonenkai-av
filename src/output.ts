import { isVisual, message, theme, type Media } from './model'
import { Mixer } from './mixer'

export class Output {
  win: Window | null = null
  video!: HTMLVideoElement
  private image!: HTMLImageElement
  private stage!: HTMLElement
  private waiting!: HTMLElement
  private detach?: () => void
  private request = 0
  private watchdog = 0
  private timeout = 0
  media: Media | null = null
  status = '未接続'
  error = ''
  sound = false
  constructor(private mixer: Mixer, private resolve:(m:Media)=>Promise<string>, private standby:()=>Media | undefined, private changed:()=>void) {}
  get connected() { return !!this.win && !this.win.closed }
  open() {
    if (this.connected) { this.win!.focus(); return }
    this.win = window.open('','bonenkai-projector','popup,width=960,height=540')
    if (!this.win) throw new Error('ポップアップを許可してください')
    const doc = this.win.document
    doc.title = '忘年会 AV / 映像出力'
    doc.documentElement.lang = 'ja'
    doc.body.replaceChildren()
    doc.body.style.cssText = 'margin:0;background:#000;color:#fff;font-family:system-ui;overflow:hidden'
    this.stage = doc.createElement('main')
    this.stage.style.cssText = 'position:fixed;inset:0;background:black;display:grid;place-items:center'
    const full = doc.createElement('button')
    full.textContent = '全画面にする'
    full.title = '投影と動画再生の準備'
    full.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2;padding:12px;cursor:pointer'
    full.onclick = () => {
      void this.stage.requestFullscreen().catch(() => { full.style.display = 'none'; this.error = '全画面にできません。投影側で F11 をお試しください'; this.changed() })
    }
    this.video = doc.createElement('video')
    this.video.playsInline = true
    this.video.crossOrigin = 'anonymous'
    this.video.preload = 'auto'
    this.image = doc.createElement('img')
    for (const element of [this.video,this.image]) element.style.cssText = 'width:100%;height:100%;position:absolute;inset:0;object-fit:contain;display:none'
    this.waiting = doc.createElement('div')
    this.waiting.textContent = theme
    this.waiting.style.cssText = 'font-size:clamp(24px,5vw,80px);text-align:center;padding:5vw'
    this.stage.append(this.video,this.image,this.waiting)
    doc.body.append(this.stage,full)
    try { this.detach = this.mixer.attach(this.video) }
    catch (e) { this.win.close(); throw e }
    this.video.onplaying = () => {
      if (!this.media || this.video.paused) return
      window.clearTimeout(this.timeout)
      this.status = '再生中'
      if (this.sound) this.mixer.videoPlaying(this.media)
      this.changed()
    }
    this.video.onwaiting = () => {
      if (!this.media || this.video.paused) return
      this.status = '読み込み中'; this.mixer.videoPlaying(null); this.arm(); this.changed()
    }
    this.video.oncanplay = () => {
      if (this.media?.media_type === 'video' && this.status === '読み込み中') { this.status = '再生準備完了'; this.changed() }
    }
    this.video.onpause = () => {
      if (this.media?.media_type !== 'video' || !this.video.paused || this.video.ended) return
      this.status = '一時停止'; this.mixer.videoPlaying(null); this.changed()
    }
    this.video.onended = () => {
      if (!this.media || !this.video.ended) return
      this.mixer.videoPlaying(null)
      if (this.media.end_action === 'hold') { this.status = '再生終了'; this.changed() }
      else if (this.media.end_action === 'black') this.clear(false)
      else void this.showStandby()
    }
    this.video.onerror = () => { if (this.video.error && this.media?.media_type === 'video') this.fail('動画を開けません。形式、通信、ファイルを確認してください') }
    this.status = '接続済み'
    this.error = ''
    this.win.addEventListener('keydown', e => {
      if (e.key === 'f' && !doc.fullscreenElement) full.click()
    })
    this.watchdog = window.setInterval(() => { if (!this.connected) this.disconnect() }, 700)
    this.win.addEventListener('pagehide', () => this.disconnect(), {once:true})
    this.changed()
  }
  private disconnect() {
    this.request++
    window.clearInterval(this.watchdog)
    window.clearTimeout(this.timeout)
    this.detach?.()
    this.detach = undefined
    this.win = null
    this.media = null
    this.mixer.muteVideo()
    this.status = '切断'
    this.error = '映像出力が切断されました。出力画面を開き直してください'
    this.changed()
  }
  close() { const win = this.win; this.disconnect(); win?.close() }
  clear(waiting:boolean) {
    this.request++
    window.clearTimeout(this.timeout)
    this.media = null
    this.error = ''
    this.sound = false
    this.mixer.muteVideo()
    if (this.connected) {
      this.video.pause()
      this.video.removeAttribute('src')
      this.video.load()
      this.image.removeAttribute('src')
      this.video.style.display = this.image.style.display = 'none'
      this.waiting.style.display = waiting ? '' : 'none'
    }
    this.status = '停止中'
    this.changed()
  }
  private fail(reason:string) { this.clear(false); this.error = reason; this.status = 'エラー'; this.changed() }
  private arm() {
    window.clearTimeout(this.timeout)
    this.timeout = window.setTimeout(() => this.fail('映像の応答がありません。読み込みや投影接続を確認してください'), 20000)
  }
  async showStandby() {
    this.clear(true)
    const media = this.standby()
    if (media && this.connected) await this.play({...media,loop_enabled:true},true)
  }
  async play(media:Media, silent=false) {
    if (!this.connected) throw new Error('映像出力画面を開いてください')
    if (!isVisual(media)) return
    this.clear(false)
    this.media = media
    this.status = '読み込み中'
    const request = this.request
    this.arm()
    this.changed()
    try {
      const url = await this.resolve(media)
      if (request !== this.request || !this.connected) return
      if (media.media_type === 'image') {
        this.image.src = url
        await this.image.decode()
        if (request !== this.request) return
        this.image.style.display = ''
        this.status = '表示中'
        window.clearTimeout(this.timeout)
        this.changed()
        return
      }
      this.sound = !silent
      this.video.muted = silent
      this.video.loop = media.loop_enabled
      this.video.src = url
      this.video.style.display = ''
      if (this.sound) this.mixer.videoPlaying(null, false)
      await this.video.play()
      if (request === this.request && this.sound) this.mixer.videoPlaying(media,true)
    } catch (e) {
      if (request !== this.request) return
      const error = e && typeof e === 'object' && 'name' in e && e.name === 'NotAllowedError'
        ? '自動再生がブロックされました。投影ウィンドウをクリックして再試行してください' : message(e)
      this.fail(error)
    }
  }
  async transport(action:'toggle'|'restart') {
    if (!this.connected || this.media?.media_type !== 'video' || !this.video.src) return
    if (action === 'toggle' && !this.video.paused) { this.video.pause(); return }
    if (action === 'restart') this.video.currentTime = 0
    const request = this.request
    try { await this.video.play() } catch (e) { if (request === this.request) this.fail(message(e)) }
  }
  seek(position:number) {
    if (this.connected && this.media?.media_type === 'video' && Number.isFinite(this.video.duration)) this.video.currentTime = position
  }
  mute(ms = 10) { this.sound = false; this.mixer.muteVideo(ms) }
  draw(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = '#030508'
    ctx.fillRect(0,0,canvas.width,canvas.height)
    if (!this.connected || !this.media) return
    const video = this.media.media_type === 'video'
    const el = video ? this.video : this.image
    const w = video ? this.video.videoWidth : this.image.naturalWidth
    const h = video ? this.video.videoHeight : this.image.naturalHeight
    if (!w || !h || (video && this.video.readyState < 2)) return
    const scale=Math.min(canvas.width/w,canvas.height/h)
    ctx.drawImage(el,(canvas.width-w*scale)/2,(canvas.height-h*scale)/2,w*scale,h*scale)
  }
}
