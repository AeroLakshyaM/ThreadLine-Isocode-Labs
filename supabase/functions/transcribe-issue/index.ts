import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const configuredOrigin = Deno.env.get('APP_ORIGIN')?.trim()
const appOrigin = configuredOrigin && configuredOrigin !== 'null' ? configuredOrigin.replace(/\/+$/, '') : 'https://threadline-ruddy.vercel.app'
const cors = { 'Access-Control-Allow-Origin': appOrigin, 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return reply(405, { error: 'Method not allowed.' })
  const authorization = request.headers.get('Authorization')
  if (!authorization) return reply(401, { error: 'Sign in to review this voice note.' })
  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } })
  const { data: authData, error: authError } = await userClient.auth.getUser()
  if (authError || !authData.user) return reply(401, { error: 'Your session has expired. Sign in again.' })
  const { data: profile } = await userClient.from('profiles').select('role,active').eq('id', authData.user.id).maybeSingle()
  if (!profile?.active || !['admin','merchandiser'].includes(profile.role)) return reply(403, { error: 'Only an authorised reviewer can request a transcript.' })
  let body: { updateId?: string }
  try { body = await request.json() } catch { return reply(400, { error: 'Invalid request.' }) }
  if (!body.updateId) return reply(400, { error: 'Select a production update.' })
  const { data: update, error: updateError } = await userClient.from('production_updates').select('id,audio_path').eq('id', body.updateId).maybeSingle()
  if (updateError || !update?.audio_path) return reply(404, { error: 'Original audio was not found for this update.' })
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const geminiKey = Deno.env.get('GEMINI_API_KEY')
  if (!serviceKey || !geminiKey) return reply(503, { error: 'Gemini transcription is not configured. The original audio remains available for manual review.' })
  const service = createClient(url, serviceKey)
  const { data: audio, error: downloadError } = await service.storage.from('production-evidence').download(update.audio_path)
  if (downloadError || !audio) return reply(503, { error: 'Could not retrieve the original audio. Retry later; the file remains stored.' })
  if (audio.size > 5 * 1024 * 1024) return reply(413, { error: 'This voice note exceeds the current transcription size limit.' })
  const mimeType = audio.type || 'audio/webm'
  const bytes = new Uint8Array(await audio.arrayBuffer())
  const base64 = encodeBase64(bytes)
  const model = Deno.env.get('GEMINI_TRANSCRIBE_MODEL') || 'gemini-3-flash-preview'
  try {
    const result = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(geminiKey)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ inline_data: { mime_type: mimeType, data: base64 } }, { text: 'Transcribe this factory voice note verbatim in its spoken language, preserving the original script and wording. Do not translate it, guess quantities, add context, or correct uncertain words. Return only the transcript. The transcript will be reviewed by a human.' }] }], generationConfig: { temperature: 0, maxOutputTokens: 1200 } }),
      signal: AbortSignal.timeout(30000)
    })
    if (!result.ok) return reply(503, { error: `Gemini transcription failed with HTTP ${result.status}. The original audio remains stored; you can retry.` })
    const data = await result.json()
    const transcript = data.candidates?.[0]?.content?.parts?.map((part: {text?:string}) => part.text || '').join('').trim()
    if (!transcript) return reply(503, { error: 'Gemini returned no transcript. The original audio remains stored; you can retry or enter a text note.' })
    return reply(200, { transcript: transcript.slice(0, 4000), language: 'Tamil (model output; verify during review)', provider: 'Gemini', needsHumanReview: true })
  } catch {
    return reply(503, { error: 'Gemini transcription could not be reached. The original audio remains stored; retry when online.' })
  }
})

function encodeBase64(bytes: Uint8Array) {
  let binary = ''
  const step = 0x8000
  for (let i = 0; i < bytes.length; i += step) binary += String.fromCharCode(...bytes.subarray(i, i + step))
  return btoa(binary)
}
