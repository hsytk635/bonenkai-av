export type Kind = 'bgm' | 'entrance' | 'effect' | 'video' | 'image'
export type Role = 'admin' | 'editor' | 'viewer'
export type End = 'hold' | 'standby' | 'black'
export interface Media {
  id: string; title: string; media_type: Kind; category_id: string | null
  storage_path: string; file_name: string; mime_type: string; file_size: number
  duration: number | null; volume: number; loop_enabled: boolean; ducking_enabled: boolean
  fade_in_ms: number; fade_out_ms: number; sort_order: number; thumbnail_path: string | null
  created_by: string; created_at: string; updated_at: string; color: string; end_action: End
  checksum?: string
}
export interface Category { id: string; name: string; color: string; sort_order: number }
export interface Profile { user_id: string; display_name: string; role: Role }
export interface Settings { duck: boolean; reduction: number; attack: number; release: number; standby: string }
export const defaults: Settings = {duck:true,reduction:60,attack:100,release:500,standby:''}
export const labels: Record<Kind,string> = {bgm:'BGM',entrance:'登場曲',effect:'効果音',video:'動画',image:'画像'}
export const kinds = Object.keys(labels) as Kind[]
export const theme = '南③忘年会アワー 笑っていいとも！！！'
export const isVisual = (m: Media) => m.media_type === 'video' || m.media_type === 'image'
export const message = (e: unknown) => e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e)
export const time = (s: number) => Number.isFinite(s) ? Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2,'0') : '—'
