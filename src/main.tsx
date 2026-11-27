import { createRoot } from 'react-dom/client'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type CSSProperties } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Administration, Editor, Reorder, removeMedia, roles } from './admin'
import { Assets, db, inviteSetup, loadLibrary, probe, profile, signed, sharedLinkCode, openSharedSession, forgetSharedLink } from './data'
import { makeDemo } from './demo'
import { Mixer } from './mixer'
import { Output } from './output'
import { defaults, isVisual, kinds, labels, message, theme, time, type Kind, type Media, type Profile } from './model'
import './style.css'
type Library = Awaited<ReturnType<typeof loadLibrary>>
const empty:Library = {media:[],categories:[],settings:defaults}
const demoUser:Profile={user_id:'demo',display_name:'動作確認',role:'viewer'}
const levelsDefault={bgm:40,entrance:75,effect:75,video:75,master:70}
const levelLabels={bgm:'BGM',entrance:'登場曲',effect:'効果音',video:'動画',master:'マスター'}

function SignIn({session,passwordSetup,onDone}:{session:Session|null;passwordSetup:boolean;onDone:()=>void}) {
  const [error,setError]=useState('')
  const [busy,setBusy]=useState(false)
  async function submit(e:FormEvent<HTMLFormElement>) {
    e.preventDefault();setError('');setBusy(true)
    const f=new FormData(e.currentTarget)
    const email=String(f.get('email')??'')
    const password=String(f.get('password'))
    try {
      const result=passwordSetup && session ? await db!.auth.updateUser({password}) : await db!.auth.signInWithPassword({email,password})
      if (result.error) throw result.error
      onDone()
    } catch (e) {setError(message(e))}
    finally {setBusy(false)}
  }
  return <main className="login"><div className="panel login-card"><span className="eyebrow">2026.12.17 · 広島東支部 南③地区会</span><h1>忘年会 AVコントローラー</h1><p>{theme}</p>
    <form onSubmit={submit}>
      {!passwordSetup && <label>メールアドレス<input name="email" type="email" autoComplete="username" required/></label>}
      <label>{passwordSetup?'新しいパスワード（8文字以上）':'パスワード'}<input name="password" type="password" autoComplete={passwordSetup?'new-password':'current-password'} minLength={passwordSetup?8:1} required/></label>
      {error && <p role="alert">{error}</p>}
      <button className="primary" disabled={busy}>{passwordSetup?'パスワードを設定':'ログイン'}</button>
    </form></div></main>
}
function Gate() {
  const [session,setSession]=useState<Session|null>(null)
  const [member,setMember]=useState<Profile|null>(null)
  const [loading,setLoading]=useState(!!db)
  const [error,setError]=useState('')
  const [setup,setSetup]=useState(inviteSetup)
  const [link,setLink]=useState(sharedLinkCode)
  const [linkStatus,setLinkStatus]=useState('')
  useEffect(()=>{
    if (!db) return
    const {data}=db.auth.onAuthStateChange((event,s)=>{
      if (event==='PASSWORD_RECOVERY') setSetup(true)
      setSession(s);setLoading(false)
    })
    return ()=>data.subscription.unsubscribe()
  },[])
  useEffect(()=>{
    if (!loading && !session && !link) setLink(sharedLinkCode())
  },[loading,session,link])
  useEffect(()=>{
    if (!db || !link || loading) return
    let cancelled=false
    async function openSharedLink() {
      await openSharedSession(link!)
      if (!cancelled) setLink(null)
    }
    void openSharedLink().catch(e=>{if(!cancelled)setLinkStatus(message(e))})
    return ()=>{cancelled=true}
  },[link,loading])
  const userId=session?.user.id
  useEffect(()=>{
    if (!userId) {setMember(null);return}
    let active=true
    void profile(userId).then(p=>{if(active){setMember(p);setError(p?'':'このアカウントに共有ライブラリの権限がありません')}}).catch(e=>{if(active)setError(message(e))})
    return ()=>{active=false}
  },[userId])
  if (!db) return <Board actor={demoUser} demo/>
  if (loading) return <p className="loading">認証を確認しています…</p>
  if (link) return <main className="login"><div className="panel login-card"><h1>忘年会 AVコントローラー</h1><p role={linkStatus?'alert':'status'}>{linkStatus || '共有ライブラリに接続しています…'}</p></div></main>
  if (!session || setup) return <SignIn session={session} passwordSetup={setup && !!session} onDone={()=>setSetup(false)}/>
  if (!member || member.user_id!==userId) return <main className="login"><div className="panel login-card"><p>{error || 'メンバー権限を確認しています…'}</p><button onClick={()=>void (forgetSharedLink(),db!.auth.signOut({scope:'local'}))}>ログアウト</button></div></main>
  return <Board key={member.user_id} actor={member} onSignOut={async()=>{forgetSharedLink();return db!.auth.signOut({scope:'local'})}}/>
}
function Thumbnail({media,local}:{media:Media;local:Map<string,string>}) {
  const [src,setSrc]=useState('')
  useEffect(()=>{
    let active=true
    setSrc(local.get(media.storage_path)??'')
    if(media.thumbnail_path) void signed(media.thumbnail_path).then(url=>{if(active)setSrc(url)}).catch(()=>{})
    return ()=>{active=false}
  },[media.thumbnail_path,media.storage_path,local])
  return src ? <img className="thumb" src={src} alt="" loading="lazy"/> : <div className="placeholder" aria-hidden>{media.media_type==='video'?'▶':media.media_type==='image'?'▧':media.media_type==='effect'?'✦':'♪'}</div>
}
function Preview({media,url,close}:{media:Media;url:string;close:()=>void}) {
  const player=useRef<HTMLMediaElement>(null)
  const [devices,setDevices]=useState<MediaDeviceInfo[]>([])
  const [error,setError]=useState('')
  async function headphones(id:string) {
    const el=player.current
    if (!el) return
    el.pause();el.muted=true;setError('')
    if(!id)return
    try {
      await el.setSinkId(id)
      el.muted=false
      await el.play()
    } catch (e) {el.muted=true;setError('音声出力先を切り替えられません — '+message(e))}
  }
  return <dialog open className="panel dialog"><h2>素材プレビュー</h2><p>{media.title} · 投影から独立</p>
    {media.media_type==='image'?<img className="preview-media" src={url} alt={media.title}/>:media.media_type==='video'?<video className="preview-media" src={url} muted autoPlay playsInline ref={el=>{player.current=el}}/>:<audio src={url} muted ref={el=>{player.current=el}}/>}
    {media.media_type!=='image' && <><p>初期状態は消音です。試聴には会場送りと別系統のヘッドホンを接続し、出力先を確認してください。</p>
      <button onClick={()=>void navigator.mediaDevices?.enumerateDevices().then(items=>setDevices(items.filter(d=>d.kind==='audiooutput' && d.deviceId && d.deviceId!=='default' && d.deviceId!=='communications' && d.label))).catch(e=>setError(message(e)))}>試聴用デバイスを確認</button>
      {devices.length>0 && <label>ヘッドホンを選んで試聴<select onChange={e=>void headphones(e.target.value)}><option value="">消音</option>{devices.map(d=><option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}</select></label>}
      {media.media_type==='video' && <button onClick={()=>{const el=player.current;if(el?.paused)void el.play().catch(e=>setError(message(e)));else el?.pause()}}>プレビュー再生／一時停止</button>}
    </>}
    {error && <p role="alert">{error}</p>}<button onClick={close}>閉じる</button>
  </dialog>
}

function PlaybackTimeline({label,position,duration,seek}:{label:string;position:number;duration:number;seek:(seconds:number)=>void}) {
  const [draft,setDraft]=useState<number|null>(null)
  const isDragging=useRef(false)
  const draftValue=useRef(position)
  const end=Number.isFinite(duration)?duration:0
  const value=Math.max(0,Math.min(draft ?? (Number.isFinite(position)?position:0),end))
  return <label className="playback-timeline">
    <span className="timeline-label">{label}</span>
    <span className="timeline-track">
      <span aria-hidden="true">{time(value)}</span>
      <input type="range" aria-label={label} aria-valuetext={time(value)+' / '+time(duration)} min={0} max={end}
        step={0.1} value={value} disabled={!end}
        onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);isDragging.current=true;draftValue.current=value;setDraft(value)}}
        onChange={e=>{
          const next=e.currentTarget.valueAsNumber
          if(isDragging.current){draftValue.current=next;setDraft(next)}
          else seek(next)
        }}
        onPointerUp={()=>{
          if (!isDragging.current) return
          isDragging.current=false
          seek(draftValue.current)
          setDraft(null)
        }}
        onPointerCancel={()=>{isDragging.current=false;setDraft(null)}}
        onLostPointerCapture={()=>{isDragging.current=false;setDraft(null)}}
        onBlur={()=>{isDragging.current=false;setDraft(null)}}/>
      <span aria-hidden="true">{time(duration)}</span>
    </span>
  </label>
}
function Board({actor,demo=false,onSignOut}:{actor:Profile;demo?:boolean;onSignOut?:()=>Promise<unknown>}) {
  const assets=useMemo(()=>new Assets(),[])
  const [library,setLibrary]=useState<Library>(()=>demo?{...empty,media:makeDemo(assets.local)}:empty)
  const [frozen,setFrozen]=useState<Library|null>(null)
  const shown=frozen ?? library
  const [levels,setLevels]=useState(levelsDefault)
  const [duck,setDuck]=useState<boolean|null>(null)
  const [online,setOnline]=useState(navigator.onLine)
  const [status,setStatus]=useState('')
  const [error,setError]=useState('')
  const [ready,setReady]=useState(false)
  const [prepare,setPrepare]=useState(false)
  const [tab,setTab]=useState<Kind|'all'>('all')
  const [reorder,setReorder]=useState(false)
  const [edit,setEdit]=useState<Media|null|undefined>(undefined)
  const [admin,setAdmin]=useState(false)
  const [preview,setPreview]=useState<{media:Media;url:string}|null>(null)
  const [checked,setChecked]=useState(false)
  const [backup,setBackup]=useState(false)
  const [clock,setClock]=useState(0)
  const canvas=useRef<HTMLCanvasElement>(null)
  const engine=useRef<{mixer:Mixer;output:Output}|null>(null)
  const latest=useRef(shown)
  latest.current=shown
  const canEdit=!demo && actor.role!=='viewer' && !frozen && !prepare
  const refresh=useCallback(async()=>{
    if(demo)return
    try {setLibrary(await loadLibrary())} catch(e){setError(message(e))}
  },[demo])
  useEffect(()=>{
    if(demo)return
    void refresh()
    const interval=window.setInterval(()=>{if(navigator.onLine)void refresh()},12000)
    const channel=db!.channel('av-library').on('postgres_changes',{event:'*',schema:'public'},()=>void refresh()).subscribe()
    return ()=>{clearInterval(interval);void db!.removeChannel(channel)}
  },[demo,refresh])
  useEffect(()=>{
    const net=()=>setOnline(navigator.onLine)
    window.addEventListener('online',net);window.addEventListener('offline',net)
    const timer=window.setInterval(()=>{
      setClock(v=>v+1)
      if(canvas.current && engine.current)engine.current.output.draw(canvas.current)
    },200)
    const unload=()=>engine.current?.output.close()
    window.addEventListener('pagehide',unload)
    return ()=>{
      clearInterval(timer);window.removeEventListener('online',net);window.removeEventListener('offline',net);window.removeEventListener('pagehide',unload)
      engine.current?.output.close();void engine.current?.mixer.ctx.close();void assets.clear()
      for (const url of assets.local.values())URL.revokeObjectURL(url)
    }
  },[assets])
  const {mixer,output}=engine.current ?? {}
  useEffect(()=>{mixer?.levels(levels)},[mixer,levels])
  useEffect(()=>{mixer?.settings({...shown.settings,duck:duck ?? shown.settings.duck})},[mixer,shown.settings,duck])
  function getEngine() {
    if(!engine.current) {
      const mixer=new Mixer()
      mixer.levels(levels);mixer.settings({...shown.settings,duck:duck ?? shown.settings.duck})
      const output=new Output(mixer,m=>assets.resolve(m),()=>latest.current.media.find(m=>m.id===latest.current.settings.standby),()=>setClock(v=>v+1))
      engine.current={mixer,output}
    }
    return engine.current
  }
  async function run(action:()=>unknown) {
    setError('')
    try {await action()} catch(e){setError(message(e))}
  }
  async function activate() {
    const {mixer}=getEngine()
    await mixer.ctx.resume();setClock(v=>v+1)
  }
  function play(media:Media) {
    void run(async()=>{
      const {mixer,output}=getEngine()
      if(isVisual(media)) {void mixer.ctx.resume().catch(e=>setError(message(e)));await output.play(media)}
      else await mixer.play(media,()=>assets.resolve(media))
    })
  }
  async function stage() {
    const {mixer}=getEngine()
    if(edit!==undefined || admin || preview || reorder)throw new Error('編集やプレビューを閉じてから準備してください')
    if(!shown.media.length)throw new Error('ライブラリに素材を登録してください')
    setPrepare(true);setReady(false);setStatus('事前読み込みを開始…')
    try {
      await assets.prepare(shown.media,(m,u)=>m.media_type==='effect' && (m.duration??Infinity)<=20?mixer.preload(m,u):probe(u,m.media_type),
        (n,total)=>setStatus('事前読み込み '+n+' / '+total))
      setReady(true);setFrozen(shown);setStatus('本番モード · '+shown.media.length+' 件を準備済み')
    } catch (e) {setStatus('事前読み込みに失敗');throw e}
    finally {setPrepare(false)}
  }
  async function endShow() {
    mixer?.stop(0);output?.clear(true);mixer?.clearBuffers()
    await assets.clear();setReady(false);setFrozen(null);setStatus('')
    void refresh()
  }
  const rows=shown.media.filter(m=>tab==='all' || m.media_type===tab)
  const renderCue=(m:Media)=>{
    const cat=shown.categories.find(c=>c.id===m.category_id)
    return <><Thumbnail media={m} local={assets.local}/><span className="cueText"><small>{labels[m.media_type]}{cat?' / '+cat.name:''}</small><strong>{m.title}</strong></span></>
  }
  const video=output?.connected && output.media?.media_type==='video'?output.video:null
  const duration=video?.duration ?? NaN
  const signal=output?.connected ? output.status : '未接続'
  const audio=mixer?.ctx.state==='running'
  return <main className="console" data-tick={clock%2}>
    <header className="top"><div><span className="eyebrow">広島東支部 南③地区会　/　2026.12.17</span><h1>忘年会 AVコントローラー</h1></div>
      <div className="header-actions"><span className="user">{actor.display_name} · {roles[actor.role]}</span>{canEdit && <button onClick={()=>setAdmin(true)}>共有設定</button>}{onSignOut && <button disabled={!!frozen || prepare} onClick={()=>void run(onSignOut)}>ログアウト</button>}</div></header>
    {demo && <p className="demo">動作確認モード · 共有機能は Supabase 設定後に利用できます</p>}
    <div className="statusbar"><span className={audio?'ok':''}>● 音声 {audio?'有効':'未有効'}</span><span className={output?.connected?'ok':''}>● 映像 {signal}</span><span className={online?'ok':'warn'}>● {online?'オンライン':'オフライン'}</span><button onClick={()=>void run(activate)}>音声を有効化</button><button onClick={()=>void run(()=>getEngine().output.open())}>映像出力画面を開く</button></div>
    {(error || output?.error) && <div className="alert" role="alert">{error || output?.error}</div>}
    {mixer?.current && <section className="panel now-playing" aria-label="BGMプレーヤー">
      <strong>{mixer.current.title}</strong>
      <PlaybackTimeline key={mixer.current.id} label="BGMの再生位置" position={mixer.position} duration={mixer.duration} seek={seconds=>{mixer.seekBgm(seconds);setClock(v=>v+1)}}/>
    </section>}
    <div className="workspace">
      <section className="library panel">
        {reorder ? <Reorder media={shown.media} kind={tab} renderCue={renderCue} done={async()=>{await refresh();setReorder(false)}} cancel={()=>{setReorder(false);void refresh()}}/> : <>
        <div className="sectionHead"><h2>メディアライブラリ</h2>{canEdit && <div className="row">{rows.length>1 && <button onClick={()=>setReorder(true)}>並べ替えモード</button>}<button className="primary" onClick={()=>setEdit(null)}>＋ メディア登録</button></div>}</div>
        <nav className="tabs" aria-label="メディア種別">{(['all',...kinds] as const).map(k=><button key={k} aria-pressed={tab===k} onClick={()=>setTab(k)}>{k==='all'?'すべて':labels[k]}</button>)}</nav>
        <div className="cards">{rows.map(m=>{
          const active=output?.media?.id===m.id || mixer?.current?.id===m.id || Array.from(mixer?.voices ?? []).some(v=>v.media.id===m.id)
          return <article className={'cue'+(active?' active':'')} key={m.id} style={{'--cue':m.color} as CSSProperties}>
            <button className="cuePlay" aria-label={m.title+'を本番出力'} onClick={()=>play(m)}>{renderCue(m)}<span className="playIcon">{active?'●':'▶'}</span></button>
            <div className="cueActions">{active && <span className="ok">{m.media_type==='bgm' && mixer?.isPaused?'一時停止':isVisual(m)?signal:'再生中'}</span>}
              <button onClick={()=>void run(async()=>setPreview({media:m,url:await assets.resolve(m)}))}>確認</button>
              {canEdit && <><button onClick={()=>setEdit(m)}>編集</button><button onClick={()=>{if(confirm(m.title+' を共有ライブラリから削除しますか？'))void run(async()=>{try{await removeMedia(m)}finally{await refresh()}})}}>削除</button></>}
            </div></article>
        })}</div>
        {!rows.length && <p className="empty">表示できるメディアがありません。</p>}
        </>}
      </section>
      <aside className="side">
        <section className="panel monitor"><div className="sectionHead"><h2>映像出力</h2><span className={output?.connected?'ok':'muted'}>{signal}</span></div>
          <canvas ref={canvas} width="480" height="270" aria-label="現在の投影映像"/>
          <p>{output?.media?.title ?? '投影素材なし'}</p>
          <div className="row"><button disabled={!video} onClick={()=>void output?.transport('toggle')}>{video?.paused?'再開':'一時停止'}</button><button disabled={!video} onClick={()=>void output?.transport('restart')}>頭出し</button></div>
          {video && <PlaybackTimeline key={output?.media?.id} label="動画の再生位置" position={video.currentTime} duration={duration} seek={seconds=>{output?.seek(seconds);setClock(v=>v+1)}}/>}
          <div className="row"><button disabled={!output?.connected} onClick={()=>void run(()=>output?.showStandby())}>待機画面</button><button disabled={!output?.connected} onClick={()=>output?.clear(false)}>黒画面</button></div>
        </section>
        <section className="panel prep"><div className="sectionHead"><h2>本番準備</h2><span className={frozen?'ok':'muted'}>{frozen?'本番モード':'準備モード'}</span></div>
          <ul><li>{audio?'✓':'○'} 音声を有効化</li><li>{output?.connected?'✓':'○'} 投影ウィンドウを接続</li><li>{ready?'✓':'○'} 素材読み込み{ready?'済み':'未実施'}</li><li>{online?'✓':'○'} インターネット接続</li></ul>
          <label className="inline"><input type="checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)}/>必要な素材を確認</label>
          <label className="inline"><input type="checkbox" checked={backup} onChange={e=>setBackup(e.target.checked)}/>予備素材・機材を準備</label>
          <button className={frozen?'':'primary'} disabled={prepare} onClick={()=>void run(frozen?endShow:stage)}>{frozen?'本番モードを終了':prepare?'準備中…':'事前読み込み・本番モード開始'}</button>
          {status && <p role="status">{status}</p>}
        </section>
      </aside>
    </div>
    <footer className="mixer panel"><div className="mixerHead"><div><h2>オーディオミキサー</h2>{!mixer?.current && <p>BGM 停止中</p>}</div>
      <div className="row"><button disabled={!mixer?.current} onClick={()=>mixer?.toggleBgm()}>{mixer?.isPaused?'BGM再開':'BGM一時停止'}</button><button onClick={()=>setDuck(!(duck??shown.settings.duck))}>ダッキング {(duck??shown.settings.duck)?'ON':'OFF'}</button></div></div>
      <div className="levels">{(Object.keys(levels) as (keyof typeof levels)[]).map(k=><label key={k}><span>{levelLabels[k]} <b>{levels[k]}%</b></span><input type="range" min={0} max={100} value={levels[k]} onChange={e=>setLevels({...levels,[k]:+e.target.value})}/></label>)}</div>
      <div className="row stops"><button onClick={()=>{mixer?.stop();output?.mute(output.media?.fade_out_ms ?? 500)}}>フェードアウト</button><button className="danger" onClick={()=>{mixer?.stop(0);output?.mute()}}>全音声停止</button><button className="danger" onClick={()=>output?.clear(false)}>映像停止</button><button className="danger solid" onClick={()=>{mixer?.stop(0);output?.clear(false)}}>全停止</button></div>
    </footer>
    {canEdit && edit!==undefined && <Editor item={edit} actor={actor} categories={shown.categories} nextOrder={shown.media.reduce((top,m)=>Math.max(top,m.sort_order),0)+1} done={()=>{setEdit(undefined);void refresh()}} cancel={()=>setEdit(undefined)}/>}
    {canEdit && admin && <Administration actor={actor} settings={shown.settings} categories={shown.categories} media={shown.media} refresh={()=>void refresh()} close={()=>setAdmin(false)}/>}
    {preview && <Preview {...preview} close={()=>setPreview(null)}/>}
  </main>
}
createRoot(document.getElementById('root')!).render(<Gate/>)
