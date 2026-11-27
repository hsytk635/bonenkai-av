import { createClient } from '@supabase/supabase-js'
import { Upload } from 'tus-js-client'
import { defaults, type Category, type Media, type Profile, type Settings } from './model'
export const inviteSetup = /(?:[#&]type=)(invite|recovery)(?:&|$)/.test(location.hash)
const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
export const db = url && key ? createClient(url,key) : null
export const bucket = 'av-media'
export const maxSize = 50_000_000
const formats: Record<string,string> = {mp3:'audio/mpeg',wav:'audio/wav',mp4:'video/mp4',webm:'video/webm',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp'}
export async function loadLibrary() {
  const connection = db!
  const [media,categories,settings] = await Promise.all([
    connection.from('media').select('*').order('sort_order').order('title'),
    connection.from('categories').select('*').order('sort_order'),
    connection.from('settings').select('setting_value').eq('setting_key','show').maybeSingle()
  ])
  for (const res of [media,categories,settings]) if (res.error) throw res.error
  return {media:media.data as Media[],categories:categories.data as Category[],settings:{...defaults,...settings.data?.setting_value} as Settings}
}
export async function profile(id:string) {
  const {data,error} = await db!.from('profiles').select('*').eq('user_id',id).maybeSingle()
  if (error) throw error
  return data as Profile | null
}
export async function signed(path:string) {
  const {data,error} = await db!.storage.from(bucket).createSignedUrl(path,900)
  if (error) throw error
  return data.signedUrl
}
export async function inspect(file:File, kind:Media['media_type']) {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  const mime = formats[ext]
  const prefix = kind === 'image' || kind === 'video' ? kind : 'audio'
  if (!mime?.startsWith(prefix+'/') || !file.size || file.size > maxSize) throw new Error('指定種別の対応形式と50 MB以内のサイズを確認してください')
  const bytes = new Uint8Array(await file.slice(0,16).arrayBuffer())
  const ascii = (a:number,b:number) => String.fromCharCode(...bytes.slice(a,b))
  const valid = {
    mp3: ascii(0,3)==='ID3' || (bytes[0]===255 && (bytes[1]&224)===224),
    wav: ascii(0,4)==='RIFF' && ascii(8,12)==='WAVE', mp4:ascii(4,8)==='ftyp',
    webm:bytes[0]===26 && bytes[1]===69 && bytes[2]===223 && bytes[3]===163,
    png:bytes[0]===137 && ascii(1,4)==='PNG', jpg:bytes[0]===255 && bytes[1]===216, jpeg:bytes[0]===255 && bytes[1]===216,
    webp:ascii(0,4)==='RIFF' && ascii(8,12)==='WEBP'
  }[ext]
  if (!valid) throw new Error('ファイルの内容と拡張子が一致しません')
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))
  return {ext,mime,checksum:Array.from(hash,n=>n.toString(16).padStart(2,'0')).join('')}
}
export async function probe(objectUrl:string, kind:Media['media_type'], thumbnail=false) {
  const image = kind==='image' ? new Image() : null
  const player = image ? null : document.createElement(kind==='video' ? 'video' : 'audio')
  try {
    const element = image ?? player!
    const loaded = new Promise<void>((resolve,reject) => {
      const timer = window.setTimeout(()=>reject(new Error('メディアの読み込みがタイムアウトしました')),15000)
      element.addEventListener('error',()=>{clearTimeout(timer);reject(new Error('このブラウザで開けないメディアです'))},{once:true})
      element.addEventListener(image ? 'load' : 'loadeddata',()=>{clearTimeout(timer);resolve()},{once:true})
    })
    if (player) { player.muted = true; player.preload='auto' }
    element.src = objectUrl
    await loaded
    const video = kind === 'video' ? player as HTMLVideoElement : null
    const w = image?.naturalWidth ?? video?.videoWidth ?? 0
    const h = image?.naturalHeight ?? video?.videoHeight ?? 0
    if ((image || video) && !(w && h)) throw new Error('有効な映像トラックがありません')
    let blob:Blob | null = null
    if (thumbnail && w && h) {
      const canvas = document.createElement('canvas')
      const scale = Math.min(320/w,180/h,1)
      canvas.width = Math.max(1,Math.round(w*scale)); canvas.height = Math.max(1,Math.round(h*scale))
      canvas.getContext('2d')!.drawImage(image ?? video!,0,0,canvas.width,canvas.height)
      blob = await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.8))
    }
    return {duration: player && Number.isFinite(player.duration) ? player.duration : null, blob}
  } finally { if (player) { player.removeAttribute('src'); player.load() } }
}
export async function upload(path:string, body:Blob, mime:string, progress:(n:number)=>void) {
  const {data,error} = await db!.auth.getSession()
  if (error || !data.session) throw error ?? new Error('ログインしてください')
  const endpoint = new URL(url)
  if (endpoint.hostname.endsWith('.supabase.co')) endpoint.hostname=endpoint.hostname.replace('.supabase.co','.storage.supabase.co')
  endpoint.pathname='/storage/v1/upload/resumable'
  await new Promise<void>((resolve,reject)=>{
    const transfer = new Upload(body,{
      endpoint:endpoint.href, headers:{authorization:'Bearer '+data.session!.access_token,apikey:key},
      retryDelays:[0,1000,3000,5000,10000], uploadDataDuringCreation:true, removeFingerprintOnSuccess:true,
      chunkSize:6*1024*1024, metadata:{bucketName:bucket, objectName:path, contentType:mime, cacheControl:'300'},
      onProgress:(sent,total)=>progress(Math.round(sent/total*100)),onError:reject,onSuccess:()=>resolve()
    })
    transfer.start()
  })
}

export class Assets {
  private files = new Map<string,string>()
  private cache?: Cache
  private readonly name = 'bonenkai-av-session-'+crypto.randomUUID()
  locked = false
  local = new Map<string,string>()
  async resolve(m:Media) {
    const existing = this.files.get(m.storage_path) ?? this.local.get(m.storage_path)
    if (existing) return existing
    if (this.locked) throw new Error('本番セットにファイルがありません')
    return signed(m.storage_path)
  }
  async prepare(media:Media[], verify:(m:Media,u:string)=>Promise<unknown>, report:(count:number,total:number)=>void) {
    await this.clear()
    try {
      for (const [i,m] of media.entries()) {
        const source = await this.resolve(m)
        const cache = this.cache ??= await caches.open(this.name)
        const request = new Request(new URL('?offlineAsset='+encodeURIComponent(m.storage_path),location.href))
        const response = await fetch(source,{cache:'no-store',signal:AbortSignal.timeout(90000)})
        if (!response.ok) throw new Error(m.title+' を取得できません')
        await cache.put(request,response)
        const copy = await cache.match(request)
        if (!copy) throw new Error(m.title+' のキャッシュを確認できません')
        const object = URL.createObjectURL(await copy.blob())
        this.files.set(m.storage_path,object)
        await verify(m,object).catch(e=>{throw new Error(m.title+' — '+e.message)})
        report(i+1,media.length)
      }
      this.locked = true
    } catch (e) { await this.clear(); throw e }
  }
  async clear() {
    this.locked = false
    for (const object of this.files.values()) URL.revokeObjectURL(object)
    this.files.clear()
    this.cache = undefined
    if ('caches' in window) await caches.delete(this.name)
  }
}
