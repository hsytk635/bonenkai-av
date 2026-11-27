import { createClient } from 'npm:@supabase/supabase-js@2'

Deno.serve(async req => {
  const redirectTo = Deno.env.get('AV_SITE_URL') ?? ''
  const origin = req.headers.get('origin')
  const allowedOrigin = redirectTo ? new URL(redirectTo).origin : ''
  const headers = {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
    'Vary': 'Origin',
  }
  const reply = (status: number, body: object) => new Response(JSON.stringify(body), {status,headers})
  if (!allowedOrigin || origin !== allowedOrigin) return reply(403,{error:'招待の接続元が許可されていません'})
  if (req.method==='OPTIONS') return new Response(null,{status:204,headers})
  if (req.method!=='POST') return reply(405,{error:'POST required'})
  const token=req.headers.get('authorization')
  if (!token?.startsWith('Bearer ')) return reply(401,{error:'ログインしてください'})
  const url=Deno.env.get('SUPABASE_URL')!
  const auth={persistSession:false,autoRefreshToken:false}
  const user=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{auth,global:{headers:{Authorization:token}}})
  const {data:role,error}=await user.rpc('av_role')
  if (error || role!=='admin') return reply(403,{error:'管理者権限が必要です'})
  let input
  try { input=await req.json() } catch {return reply(400,{error:'入力が無効です'})}
  const email=typeof input?.email==='string'?input.email.trim():''
  const name=typeof input?.display_name==='string'?input.display_name.trim():''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length>254 || !name || name.length>120 || !['viewer','editor'].includes(input?.role)) return reply(400,{error:'招待情報を確認してください'})
  const admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth})
  const invited=await admin.auth.admin.inviteUserByEmail(email,{redirectTo})
  if (invited.error || !invited.data.user) return reply(409,{error:'メール招待に失敗しました。既存ユーザーや SMTP 設定を確認してください'})
  const result=await admin.from('profiles').insert({user_id:invited.data.user.id,display_name:name,role:input.role})
  if (result.error) {
    const rollback=await admin.auth.admin.deleteUser(invited.data.user.id)
    return reply(500,{error:rollback.error?'登録に失敗しました。Supabaseで招待ユーザーを確認してください':'登録に失敗しました。招待を取り消しました'})
  }
  return reply(200,{ok:true})
})
