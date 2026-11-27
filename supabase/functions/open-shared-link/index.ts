import { createClient } from 'npm:@supabase/supabase-js@2'

Deno.serve(async req => {
  const site = Deno.env.get('AV_SITE_URL')
  const origin = req.headers.get('origin')
  if (!site || origin !== new URL(site).origin) return new Response(null,{status:403})
  const headers = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json',
    'Vary': 'Origin',
  }
  const reply = (status:number,body:object) => new Response(JSON.stringify(body),{status,headers})
  if (req.method==='OPTIONS') return new Response(null,{status:204,headers})
  if (req.method!=='POST') return reply(405,{error:'Method not allowed'})
  let code:unknown
  try { ({code} = await req.json()) } catch { return reply(400,{error:'Invalid link'}) }
  if (typeof code!=='string' || !/^[A-Za-z0-9_-]{43}$/.test(code)) return reply(403,{error:'Invalid link'})

  const admin = createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    {auth:{persistSession:false,autoRefreshToken:false}})
  const allowed = await admin.rpc('av_link_allowed',{code})
  if (!allowed.data || allowed.error) return reply(403,{error:'Invalid or expired link'})
  // Generate a one-time token without sending email.
  const auth = await admin.auth.admin.generateLink({type:'magiclink',email:'operator@bonenkai-av.example.com'})
  if (auth.error || !auth.data.properties?.hashed_token || !auth.data.user?.id) {
    console.error('Shared account token could not be issued',auth.error?.code)
    return reply(503,{error:'Shared access temporarily unavailable'})
  }
  const membership = await admin.rpc('av_bind_link',{code,actor:auth.data.user.id})
  if (!membership.data || membership.error) return reply(403,{error:'Invalid or expired link'})
  return reply(200,{token_hash:auth.data.properties.hashed_token})
})
