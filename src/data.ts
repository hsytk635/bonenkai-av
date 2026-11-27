import { createClient } from '@supabase/supabase-js'
import { Upload } from 'tus-js-client'
import { defaults, type Category, type Media, type Profile, type Settings } from './model'
export const inviteSetup = /(?:[#&]type=)(invite|recovery)(?:&|$)/.test(location.hash)
const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
export const db = url && key ? createClient(url,key) : null
export const bucket = 'av-media'

const accessStorageKey = 'bonenkai-av-share'
export function sharedLinkCode() {
  const code = new URLSearchParams(location.hash.slice(1)).get('av')
  if (code) return code
  try { return sessionStorage.getItem(accessStorageKey) } catch { return null }
}
let opening: Promise<void> | null = null
export function openSharedSession(code: string) {
  if (opening) return opening
  opening = (async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const {data,error} = await db!.functions.invoke('open-shared-link',{body:{code}})
      if (error || !data?.token_hash) throw new Error('共有リンクを確認できません。担当者専用リンクを開き直してください。')
      const result = await db!.auth.verifyOtp({type:'magiclink',token_hash:data.token_hash})
      if (result.data.session && !result.error) {
        try { sessionStorage.setItem(accessStorageKey,code) } catch { /* The link in the address is still available. */ }
        return
      }
    }
    throw new Error('共有ライブラリに接続できません。少し待ってから再読み込みしてください。')
  })().finally(()=>{ opening = null })
  return opening
}
export function forgetSharedLink() {
  try { sessionStorage.removeItem(accessStorageKey) } catch { /* Storage may be unavailable. */ }
  history.replaceState(null,'',location.pathname+location.search)
}

type ReadError = {code?:string; status?:number | string; statusCode?:number | string; message:string}
const accessFailure = (e:ReadError) =>
  /^(401|403)$/.test(String(e.status ?? e.statusCode)) ||
  ['42501','PGRST301','PGRST303'].includes(e.code ?? '') ||
  /permission denied|jwt expired|invalid jwt/i.test(e.message)
const missingObject = (e:ReadError) =>
  Number(e.status ?? e.statusCode)===404 || /object\s*not\s*found/i.test(e.message)
let recovering: Promise<void> | null = null
function recoverSession() {
  if (recovering) return recovering
  recovering = (async () => {
    const refreshed = await db!.auth.refreshSession()
    if (refreshed.data.session && !refreshed.error) {
      const {data:role,error} = await db!.rpc('av_role')
      if (role && !error) return
    }
    const code = sharedLinkCode()
    if (code) await openSharedSession(code)
  })().finally(()=>{ recovering = null })
  return recovering
}
async function readWithAccess<T>(read:()=>PromiseLike<{data:T;error:ReadError|null}>, storage=false) {
  let result = await read()
  if (result.error && (accessFailure(result.error) || (storage && missingObject(result.error)))) {
    await recoverSession()
    result = await read()
  }
  if (result.error) {
    if (accessFailure(result.error)) throw new Error('共有ライブラリへのアクセスを確認できません。担当者専用リンクを開き直してください。')
    if (storage && missingObject(result.error)) throw new Error('共有ファイルが見つからないか、取得できません。ライブラリを再読み込みしてください。')
    throw result.error
  }
  return result.data
}

export const maxSize = 50_000_000
const formats: Record<string,string> = {mp3:'audio/mpeg',wav:'audio/wav',m4a:'audio/mp4',mp4:'video/mp4',webm:'video/webm',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp'}
export async function loadLibrary() {
  const connection = db!
  const [media,categories,settings] = await Promise.all([
    readWithAccess(()=>connection.from('media').select('*').order('sort_order').order('title').order('id')),
    readWithAccess(()=>connection.from('categories').select('*').order('sort_order')),
    readWithAccess(()=>connection.from('settings').select('setting_value').eq('setting_key','show').maybeSingle())
  ])
  return {media:media as Media[],categories:categories as Category[],settings:{...defaults,...settings?.setting_value} as Settings}
}
export async function profile(id:string) {
  const {data,error} = await db!.from('profiles').select('*').eq('user_id',id).maybeSingle()
  if (error) throw error
  return data as Profile | null
}
export async function signed(path:string) {
  const data = await readWithAccess(()=>db!.storage.from(bucket).createSignedUrl(path,900),true)
  if (!data) throw new Error('共有ファイルの再生URLを取得できません。')
  return data.signedUrl
}
const extension = (name:string) => name.split('.').pop()?.toLowerCase() ?? ''
export function fileFamily(name:string) {
  return formats[extension(name)]?.split('/')[0]
}
async function hasMp4Header(file:File) {
  let offset=0
  while (offset+8<=file.size && offset<1048576) {
    const header=new DataView(await file.slice(offset,offset+16).arrayBuffer())
    const size=header.getUint32(0)
    const tag=String.fromCharCode(...new Uint8Array(header.buffer,4,4))
    if(tag==='ftyp')return size>=16 && offset+size<=file.size
    if(!['free','skip','wide'].includes(tag) || size<8)break
    offset+=size
  }
  return false
}
export async function inspect(file:File, kind:Media['media_type']) {
  const ext = extension(file.name)
  const mime = formats[ext]
  const prefix = kind === 'image' || kind === 'video' ? kind : 'audio'
  if (!file.size) throw new Error('ファイルが空です。元のファイルを選んでください。')
  if (file.size > maxSize) throw new Error('このファイルは '+(file.size/1e6).toFixed(1)+' MB です。共有に登録できるサイズは50 MBまでです。動画は書き出し時に画質やビットレートを下げてください。')
  if (!mime) throw new Error('この拡張子は登録できません。動画はMP4またはWebMを選んでください。')
  if (!mime.startsWith(prefix+'/')) throw new Error('ファイルに合わせて種別を選んでください。MP4とWebMは「動画」です。')
  const bytes = new Uint8Array(await file.slice(0,16).arrayBuffer())
  const ascii = (a:number,b:number) => String.fromCharCode(...bytes.slice(a,b))
  const valid = {
    mp3: ascii(0,3)==='ID3' || (bytes[0]===255 && (bytes[1]&224)===224),
    wav: ascii(0,4)==='RIFF' && ascii(8,12)==='WAVE', mp4:true, m4a:true,
    webm:bytes[0]===26 && bytes[1]===69 && bytes[2]===223 && bytes[3]===163,
    png:bytes[0]===137 && ascii(1,4)==='PNG', jpg:bytes[0]===255 && bytes[1]===216, jpeg:bytes[0]===255 && bytes[1]===216,
    webp:ascii(0,4)==='RIFF' && ascii(8,12)==='WEBP'
  }[ext]
  if (!valid || ((ext==='mp4' || ext==='m4a') && !await hasMp4Header(file))) throw new Error('ファイルの内容と拡張子が一致しません。動画はMP4 (H.264 / AAC) で書き出してください。')
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
      element.addEventListener('error',()=>{clearTimeout(timer);reject(new Error(kind==='video'?'動画を読み込めません。MP4の場合は映像H.264・音声AACで書き出し、もう一度選んでください。':'このブラウザで開けないメディアです'))},{once:true})
      element.addEventListener(image ? 'load' : kind==='video' && thumbnail ? 'loadedmetadata' : 'loadeddata',()=>{clearTimeout(timer);resolve()},{once:true})
    })
    if (player) { player.muted = true; player.preload='auto' }
    element.src = objectUrl
    await loaded
    const video = kind === 'video' ? player as HTMLVideoElement : null
    const w = image?.naturalWidth ?? video?.videoWidth ?? 0
    const h = image?.naturalHeight ?? video?.videoHeight ?? 0
    if ((image || video) && !(w && h)) throw new Error('有効な映像トラックがありません')
    let blob:Blob | null = null
    // Some mobile browsers load video metadata on selection but defer decoding the first frame.
    if (thumbnail && video && video.readyState < 2) {
      await new Promise<void>((resolve,reject)=>{
        const finish=(error?:Error)=>{
          window.clearTimeout(timer)
          video.removeEventListener('loadeddata',ready)
          video.removeEventListener('error',failed)
          if(error)reject(error)
          else resolve()
        }
        const ready=()=>finish()
        const failed=()=>finish(new Error('動画を読み込めません。MP4の場合は映像H.264・音声AACで書き出してください。'))
        const timer=window.setTimeout(ready,2300)
        video.addEventListener('loadeddata',ready,{once:true})
        video.addEventListener('error',failed,{once:true})
      })
    }
    if (thumbnail && w && h && (!video || video.readyState >= 2)) {
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
