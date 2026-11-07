import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_ORIGIN') ?? 'null',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

function response(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return response(405, { error: 'Method not allowed.' })

  const authHeader = request.headers.get('Authorization')
  if (!authHeader) return response(401, { error: 'Sign in to review an issue note.' })
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const client = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } })
  const { data: userData, error: authError } = await client.auth.getUser()
  if (authError || !userData.user) return response(401, { error: 'Your session has expired. Sign in again.' })
  const { data: profile } = await client.from('profiles').select('role,active').eq('id', userData.user.id).maybeSingle()
  if (!profile?.active || !['admin','merchandiser'].includes(profile.role)) return response(403, { error: 'Only an authorised merchandiser can review AI issue suggestions.' })

  let body: { transcript?: string; sourceLanguage?: string; targetLanguage?: string }
  try { body = await request.json() } catch { return response(400, { error: 'Send a valid JSON request.' }) }
  const transcript = body.transcript?.trim()
  if (!transcript || transcript.length > 4000) return response(400, { error: 'Add a transcript of 1–4000 characters.' })
  const sourceLanguage = body.sourceLanguage?.slice(0, 40) || 'Tamil'
  const targetLanguage = body.targetLanguage?.slice(0, 40) || 'English'
  const prompt = `Translate the ${sourceLanguage} factory issue note into ${targetLanguage}. Suggest one issue category from material, equipment, capacity, quality, printing_finishing, other. This is advisory only. Do not infer or return quantities, production status, dates, or actions. Return JSON only with keys translation and category. Note: ${transcript}`
  const failures: string[] = []

  const nvidiaKey = Deno.env.get('NVIDIA_API_KEY')
  if (nvidiaKey) {
    try {
      const result = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
        method: 'POST', headers: { Authorization: `Bearer ${nvidiaKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: Deno.env.get('NVIDIA_MODEL') || 'nvidia/nemotron-3.5-lightning-30b-a3b', temperature: 0.1, max_tokens: 400, messages: [{ role: 'system', content: 'You translate and classify factory issue notes. Follow the requested JSON format exactly.' }, { role: 'user', content: prompt }] }),
        signal: AbortSignal.timeout(20000)
      })
      if (!result.ok) throw new Error(`Nemotron returned HTTP ${result.status}`)
      const data = await result.json()
      const raw = data.choices?.[0]?.message?.content
      const parsed = parseSuggestion(raw)
      return response(200, { ...parsed, provider: 'Nemotron', needsHumanReview: true })
    } catch (error) { failures.push(error instanceof Error ? error.message : 'Nemotron request failed') }
  } else failures.push('Nemotron key is not configured')

  const geminiKey = Deno.env.get('GEMINI_API_KEY')
  if (geminiKey) {
    try {
      const model = Deno.env.get('GEMINI_MODEL') || 'gemini-3-flash-preview'
      const result = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(geminiKey)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.1, responseMimeType: 'application/json' } }),
        signal: AbortSignal.timeout(25000)
      })
      if (!result.ok) throw new Error(`Gemini returned HTTP ${result.status}`)
      const data = await result.json()
      const raw = data.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || '').join('')
      return response(200, { ...parseSuggestion(raw), provider: 'Gemini', needsHumanReview: true, fallback: true })
    } catch (error) { failures.push(error instanceof Error ? error.message : 'Gemini request failed') }
  } else failures.push('Gemini key is not configured')

  return response(503, { error: 'AI issue assistance is unavailable. Keep the original note and review it manually.', details: failures })
})

function parseSuggestion(value: unknown): { translation: string; category: string } {
  if (typeof value !== 'string') throw new Error('Provider returned no text suggestion')
  const json = value.match(/\{[\s\S]*\}/)?.[0]
  if (!json) throw new Error('Provider returned an unreadable suggestion')
  const parsed = JSON.parse(json) as { translation?: unknown; category?: unknown }
  const allowed = ['material','equipment','capacity','quality','printing_finishing','other']
  if (typeof parsed.translation !== 'string' || typeof parsed.category !== 'string' || !allowed.includes(parsed.category)) throw new Error('Provider returned an invalid suggestion')
  return { translation: parsed.translation.slice(0, 4000), category: parsed.category }
}
