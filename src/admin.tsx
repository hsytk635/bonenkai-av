import { useEffect, useState, type FormEvent } from 'react'
import { bucket, db, inspect, probe, upload } from './data'
import { isVisual, kinds, labels, message, type Category, type Media, type Profile, type Settings } from './model'
const roles = {admin:'管理者',editor:'編集者',viewer:'閲覧者'}
export {roles}
const check = ({error}:{error:unknown}) => { if (error) throw error }
export function Editor({item,categories,actor,done,cancel}:{item:Media | null; categories:Category[];actor:Profile;done:()=>void;cancel:()=>void}) {
  const [kind,setKind] = useState(item?.media_type ?? 'bgm')
  const [busy,setBusy] = useState(false)
  const [progress,setProgress] = useState(0)
  const [error,setError] = useState('')
  async function save(e:FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const file = f.get('file')
    const id = item?.id ?? crypto.randomUUID()
    const fields = {title:String(f.get('title')).trim(),media_type:kind,category_id:f.get('category') || null,color:f.get('color'),volume:Number(f.get('volume')),sort_order:Number(f.get('order')),fade_in_ms:Number(f.get('fadeIn')),fade_out_ms:Number(f.get('fadeOut')),loop_enabled:f.has('loop'),ducking_enabled:f.has('duck'),end_action:f.get('end')}
    const pending:string[]=[]
    setBusy(true);setError('');setProgress(0)
    try {
      if (!fields.title) throw new Error('表示名を入力してください')
      if (item) check(await db!.from('media').update(fields).eq('id',id).select('id').single())
      else {
        if (!(file instanceof File)) throw new Error('ファイルを選択してください')
        const {ext,mime,checksum}=await inspect(file,kind)
        const duplicate=await db!.from('media').select('title').eq('checksum',checksum).maybeSingle()
        check(duplicate)
        if (duplicate.data) throw new Error('同じファイルが登録済みです — '+duplicate.data.title)
        const local = URL.createObjectURL(file)
        const media = await probe(local,kind,true).finally(()=>URL.revokeObjectURL(local))
        const prefix = actor.user_id+'/'+id
        const path = prefix+'/original.'+ext
        pending.push(path)
        await upload(path,file,mime,setProgress)
        let thumbnail:string | null=null
        if (media.blob) {
          thumbnail=prefix+'/thumb.jpg'
          pending.push(thumbnail)
          await upload(thumbnail,media.blob,'image/jpeg',()=>{})
        }
        const result = await db!.from('media').insert({...fields,id,storage_path:path,thumbnail_path:thumbnail,file_name:file.name,mime_type:mime,file_size:file.size,duration:media.duration,created_by:actor.user_id,checksum})
        check(result)
        pending.length=0
      }
      done()
    } catch (e) {
      const cleanup = pending.length ? await db!.storage.from(bucket).remove(pending) : null
      setError(message(e)+(cleanup?.error ? ' ／ 未使用ファイルの整理が必要です' : ''))
    } finally {setBusy(false)}
  }
  return <dialog open className="panel dialog"><form onSubmit={save}>
    <h2>{item?'メディア編集':'メディア登録'}</h2>
    <fieldset disabled={busy} className="fields">
      <label>表示名<input name="title" required maxLength={120} defaultValue={item?.title}/></label>
      <label>種別<select value={kind} disabled={!!item} onChange={e=>setKind(e.target.value as Media['media_type'])}>{kinds.map(k=><option key={k} value={k}>{labels[k]}</option>)}</select></label>
      {!item && <label className="wide">ファイル（50 MBまで）<input name="file" type="file" required accept=".mp3,.wav,.m4a,.mp4,.webm,.png,.jpg,.jpeg,.webp"/></label>}
      <label>カテゴリ<select name="category" defaultValue={item?.category_id ?? ''}><option value="">未分類</option>{categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label>表示色<input name="color" type="color" defaultValue={item?.color ?? '#65c5b1'}/></label>
      <label>音量（%）<input name="volume" type="number" min="0" max="100" defaultValue={item?.volume ?? 100} required/></label>
      <label>並び順<input name="order" type="number" defaultValue={item?.sort_order ?? 0} required/></label>
      <label>フェードイン（ms）<input name="fadeIn" type="number" min="0" max="30000" defaultValue={item?.fade_in_ms ?? 0} required/></label>
      <label>フェードアウト（ms）<input name="fadeOut" type="number" min="0" max="30000" defaultValue={item?.fade_out_ms ?? 500} required/></label>
      <label>終了後<select name="end" defaultValue={item?.end_action ?? 'standby'}><option value="standby">待機画面</option><option value="hold">最終フレーム保持</option><option value="black">黒画面</option></select></label>
      <div><label className="inline"><input type="checkbox" name="loop" defaultChecked={item?.loop_enabled ?? kind==='bgm'}/>ループ</label><label className="inline"><input type="checkbox" name="duck" defaultChecked={item?.ducking_enabled ?? true}/>ダッキング対象</label></div>
    </fieldset>
    {busy && <p role="status">処理中 <progress value={progress} max={100}/> {progress}%</p>}{error && <p role="alert">{error}</p>}
    <div className="row"><button className="primary" disabled={busy}>保存</button><button type="button" disabled={busy} onClick={cancel}>閉じる</button></div>
  </form></dialog>
}
export async function removeMedia(m:Media) {
  check(await db!.from('media').delete().eq('id',m.id).select('id').single())
  check(await db!.storage.from(bucket).remove([m.storage_path,...(m.thumbnail_path?[m.thumbnail_path]:[])]))
}
export function Administration({actor,settings,media,categories,refresh,close}:{actor:Profile;settings:Settings;media:Media[];categories:Category[];refresh:()=>void;close:()=>void}) {
  const admin=actor.role==='admin'
  const [members,setMembers]=useState<Profile[]>([])
  const [status,setStatus]=useState('')
  const [busy,setBusy]=useState(false)
  const [category,setCategory]=useState<Category|null>(null)
  async function getMembers() {
    const result=await db!.from('profiles').select('*').order('display_name')
    check(result);setMembers(result.data as Profile[])
  }
  useEffect(()=>{if (admin) void getMembers().catch(e=>setStatus(message(e)))},[admin])
  async function run(job:()=>Promise<void>) {
    setBusy(true);setStatus('')
    try {await job();refresh();setStatus('設定を更新しました')}
    catch (e) {setStatus(message(e))}
    finally {setBusy(false)}
  }
  function values(e:FormEvent<HTMLFormElement>) {e.preventDefault();return new FormData(e.currentTarget)}
  return <dialog open className="panel dialog"><h2>共有設定</h2>
    <fieldset disabled={busy}>
    {admin && <>
      <form onSubmit={e=>{const f=values(e);void run(async()=>check(await db!.from('settings').upsert({setting_key:'show',setting_value:{duck:f.has('duck'),reduction:Number(f.get('reduction')),attack:Number(f.get('attack')),release:Number(f.get('release')),standby:f.get('standby')}})))}}>
        <h3>待機映像・ダッキング既定値</h3>
        <div className="fields">
          <label className="inline"><input name="duck" type="checkbox" defaultChecked={settings.duck}/>ダッキング有効</label>
          <label>低減率（%）<input type="number" name="reduction" min="0" max="100" defaultValue={settings.reduction} required/></label>
          <label>Attack（ms）<input type="number" name="attack" min="0" max="10000" defaultValue={settings.attack} required/></label>
          <label>Release（ms）<input type="number" name="release" min="0" max="10000" defaultValue={settings.release} required/></label>
          <label>待機映像<select name="standby" defaultValue={settings.standby}><option value="">イベントタイトル</option>{media.filter(isVisual).map(m=><option key={m.id} value={m.id}>{m.title}</option>)}</select></label>
        </div><button>共有設定を保存</button>
      </form>
      <h3>メンバー</h3>
      <form className="row" onSubmit={e=>{const f=values(e);void run(async()=>{const result=await db!.functions.invoke('invite-member',{body:{email:f.get('email'),display_name:f.get('name'),role:f.get('role'),redirectTo:new URL('.',location.href).href}});check(result); await getMembers()})}}>
        <input type="email" name="email" placeholder="メールアドレス" aria-label="招待先メール" required/><input name="name" placeholder="表示名" aria-label="表示名" required maxLength={120}/><select name="role" aria-label="招待する権限"><option value="viewer">閲覧者</option><option value="editor">編集者</option></select><button>招待メールを送る</button>
      </form>
      {members.map(p=><div className="row member" key={p.user_id}><span>{p.display_name}</span>{p.role==='admin'?<span>{roles.admin}</span>:<><select aria-label={p.display_name+'の権限'} value={p.role} onChange={e=>{const role=e.target.value;void run(async()=>{check(await db!.rpc('manage_member',{target:p.user_id,next_role:role}));await getMembers()})}}><option value="viewer">閲覧者</option><option value="editor">編集者</option></select><button type="button" className="danger" onClick={()=>{if(confirm(p.display_name+' のアクセスを取り消しますか？'))void run(async()=>{check(await db!.rpc('manage_member',{target:p.user_id,next_role:null}));await getMembers()})}}>アクセス取消</button></>}</div>)}
    </>}
    <h3>カテゴリ</h3>
    <select aria-label="編集するカテゴリ" value={category?.id ?? ''} onChange={e=>setCategory(categories.find(c=>c.id===e.target.value) ?? null)}><option value="">新規カテゴリ</option>{categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
    <form className="row" key={category?.id ?? 'new'} onSubmit={e=>{const f=values(e);void run(async()=>{const data={name:f.get('name'),color:f.get('color'),sort_order:Number(f.get('order'))};check(category?await db!.from('categories').update(data).eq('id',category.id).select('id').single():await db!.from('categories').insert(data));setCategory(null)})}}>
      <input name="name" aria-label="カテゴリ名" placeholder="カテゴリ名" defaultValue={category?.name} maxLength={120} required/><input type="color" name="color" aria-label="カテゴリ色" defaultValue={category?.color ?? '#65c5b1'}/><input type="number" name="order" aria-label="カテゴリ並び順" defaultValue={category?.sort_order ?? 0} required/><button>カテゴリを保存</button>
      {category && <button type="button" className="danger" onClick={()=>{if(confirm('カテゴリを削除しますか？ メディアは未分類になります。'))void run(async()=>{check(await db!.from('categories').delete().eq('id',category.id).select('id').single());setCategory(null)})}}>削除</button>}
    </form>
    </fieldset><p role="status">{status}</p><button disabled={busy} onClick={close}>閉じる</button>
  </dialog>
}
