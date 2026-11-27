import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({mode}) => {
  const env = loadEnv(mode,process.cwd(),'VITE_SUPABASE_')
  const url = env.VITE_SUPABASE_URL
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY
  if ((url || key) && (!url || !key?.startsWith('sb_publishable_'))) {
    throw new Error('Supabase の Project URL と Publishable key を指定してください。秘密キーは指定できません。')
  }
  return {base:'./'}
})
