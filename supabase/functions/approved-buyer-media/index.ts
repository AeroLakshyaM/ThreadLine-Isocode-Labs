import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const configuredOrigin = Deno.env.get('APP_ORIGIN')?.trim()
const appOrigin = configuredOrigin && configuredOrigin !== 'null' ? configuredOrigin.replace(/\/+$/, '') : 'https://threadline-ruddy.vercel.app'
const cors = { 'Access-Control-Allow-Origin': appOrigin, 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return reply(405, { error: 'Method not allowed.' })
  const auth = request.headers.get('Authorization')
  if (!auth) return reply(401, { error: 'Sign in to view order media.' })
  const url = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } })
  const { data: user, error: userError } = await userClient.auth.getUser()
  if (userError || !user.user) return reply(401, { error: 'Your session has expired.' })
  const { data: profile } = await userClient.from('profiles').select('role,active').eq('id', user.user.id).maybeSingle()
  if (!profile?.active || profile.role !== 'buyer') return reply(403, { error: 'Buyer access is required.' })
  let body: { orderId?: string; path?: string }
  try { body = await request.json() } catch { return reply(400, { error: 'Invalid request.' }) }
  if (!body.orderId || !body.path) return reply(400, { error: 'Order and media path are required.' })
  const { data: allowed, error: permissionError } = await userClient.rpc('buyer_can_view_approved_photo', { target_order: body.orderId, target_path: body.path })
  if (permissionError || !allowed) return reply(404, { error: 'Approved media was not found for this order.' })
  // The user-scoped RPC verifies buyer ownership and the approval record before signing.
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!serviceKey) return reply(503, { error: 'Approved photo access is not configured.' })
  const service = createClient(url, serviceKey)
  const { data: signed, error } = await service.storage.from('production-evidence').createSignedUrl(body.path, 60)
  if (error || !signed) return reply(503, { error: 'Could not securely open the approved photo.' })
  return reply(200, { url: signed.signedUrl, expiresInSeconds: 60 })
})
