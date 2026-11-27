import { type Media, theme } from './model'
export function makeDemo(local:Map<string,string>) {
  const specs = [
    ['bgm','開場BGM',220,'#72d6bc'],
    ['entrance','登場ジングル',392,'#d89dff'],
    ['effect','ピンポン',660,'#f4ba68'],
    ['effect','チャイム',523,'#f4ba68'],
    ['image','イベントタイトル',0,'#74b0ff'],
  ] as const
  return specs.map(([kind,title,freq,color],i):Media => {
    let blob:Blob
    const duration=kind==='bgm'?6:kind==='entrance'?2:0.5
    if (kind==='image') {
      blob=new Blob(['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720"><rect width="1280" height="720" fill="#111b2a"/><text x="640" y="320" text-anchor="middle" fill="#71dabe" font-size="42" font-family="sans-serif">2026.12.17</text><text x="640" y="414" text-anchor="middle" fill="white" font-size="52" font-family="sans-serif">'+theme+'</text></svg>'],{type:'image/svg+xml'})
    } else {
      const rate=24000, count=rate*duration
      const buffer=new ArrayBuffer(44+count*2)
      const view=new DataView(buffer)
      const str=(start:number,s:string)=>{for(const [j,c] of Array.from(s).entries()) view.setUint8(start+j,c.charCodeAt(0))}
      str(0,'RIFF');view.setUint32(4,36+count*2,true);str(8,'WAVEfmt ')
      view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);str(36,'data');view.setUint32(40,count*2,true)
      for(let j=0;j<count;j++){
        const t=j/rate
        const note=kind==='bgm'?[1,1.25,1.5,1.25][Math.floor(t*2)%4]:t<duration/2?1:1.25
        const envelope=Math.min(t*80,1,(duration-t)*12)*(kind==='bgm'?0.5:Math.exp(-3*t/duration))
        view.setInt16(44+j*2,Math.round(Math.sin(t*2*Math.PI*freq*note)*7000*envelope),true)
      }
      blob=new Blob([buffer],{type:'audio/wav'})
    }
    const path='demo-'+i
    local.set(path,URL.createObjectURL(blob))
    return {id:path,title,media_type:kind,category_id:null,storage_path:path,file_name:path,mime_type:blob.type,file_size:blob.size,duration:kind==='image'?null:duration,volume:100,loop_enabled:kind==='bgm',ducking_enabled:kind!=='bgm',fade_in_ms:20,fade_out_ms:300,sort_order:i,color,end_action:'standby',thumbnail_path:null,created_by:'demo',created_at:'2026-11-27',updated_at:'2026-11-27'}
  })
}
