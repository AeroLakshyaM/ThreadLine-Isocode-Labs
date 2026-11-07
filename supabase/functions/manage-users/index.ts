import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_ORIGIN') ?? 'null',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const validRoles = ['admin', 'merchandiser', 'supervisor', 'buyer'] as const
type AppRole = typeof validRoles[number]

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return reply(405, { error: 'Method not allowed.' })

  const authorization = request.headers.get('Authorization')
  if (!authorization) return reply(401, { error: 'Sign in as an administrator to manage users.' })
  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !anonKey || !serviceKey) return reply(503, { error: 'User management is not configured. Ask the project administrator to configure the Edge Function.' })

  const callerClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } })
  const { data: authData, error: authError } = await callerClient.auth.getUser()
  if (authError || !authData.user) return reply(401, { error: 'Your session has expired. Sign in again.' })
  const { data: callerProfile } = await callerClient.from('profiles').select('role,active').eq('id', authData.user.id).maybeSingle()
  if (!callerProfile?.active || callerProfile.role !== 'admin') return reply(403, { error: 'Only an active administrator can manage workspace users.' })

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return reply(400, { error: 'Send a valid JSON request.' }) }
  const service = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

  if (body.action === 'list') {
    const [{ data: profiles, error: profileError }, { data: mappings, error: mappingError }, { data: buyers, error: buyersError }] = await Promise.all([
      service.from('profiles').select('id,display_name,role,active,created_at').order('display_name'),
      service.from('buyer_user_access').select('user_id,buyer_id'),
      service.from('buyers').select('id,name,active').order('name')
    ])
    if (profileError || mappingError || buyersError) return reply(500, { error: 'Could not load workspace users.' })
    const authUsers: Array<{ id: string; email?: string }> = []
    for (let page = 1; page <= 20; page++) {
      const { data, error } = await service.auth.admin.listUsers({ page, perPage: 500 })
      if (error) return reply(502, { error: 'Could not load user sign-in details.' })
      authUsers.push(...data.users.map(user => ({ id: user.id, email: user.email })))
      if (data.users.length < 500) break
    }
    const emails = new Map(authUsers.map(user => [user.id, user.email ?? '']))
    const buyerIds = new Map<string, string>()
    for (const mapping of mappings ?? []) buyerIds.set(mapping.user_id, mapping.buyer_id)
    return reply(200, {
      users: (profiles ?? []).map(profile => ({ ...profile, email: emails.get(profile.id) ?? '', buyerId: buyerIds.get(profile.id) ?? '' })),
      buyers: buyers ?? []
    })
  }

  const role = body.role
  if (typeof role !== 'string' || !validRoles.includes(role as AppRole)) return reply(400, { error: 'Choose a valid workspace role.' })
  const displayName = typeof body.displayName === 'string' ? body.displayName.trim().slice(0, 120) : ''
  const buyerId = typeof body.buyerId === 'string' ? body.buyerId : ''
  if (!displayName) return reply(400, { error: 'Enter the user’s display name.' })
  if (role === 'buyer') {
    if (!buyerId) return reply(400, { error: 'Select the buyer account this user may access.' })
    const { data: buyer } = await service.from('buyers').select('id').eq('id', buyerId).eq('active', true).maybeSingle()
    if (!buyer) return reply(400, { error: 'Select an active buyer account.' })
  }

  if (body.action === 'create') {
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    if (!/^\S+@\S+\.\S+$/.test(email)) return reply(400, { error: 'Enter a valid email address.' })
    if (password.length < 8) return reply(400, { error: 'Set a temporary password with at least 8 characters.' })
    const { data: created, error: createError } = await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: displayName } })
    if (createError || !created.user) return reply(400, { error: createError?.message ?? 'Could not create the sign-in account.' })
    const { error: profileError } = await service.from('profiles').insert({ id: created.user.id, display_name: displayName, role, active: true })
    if (profileError) {
      await service.auth.admin.deleteUser(created.user.id)
      return reply(400, { error: `Could not create the workspace profile: ${profileError.message}` })
    }
    if (role === 'buyer') {
      const { error: mappingError } = await service.from('buyer_user_access').insert({ buyer_id: buyerId, user_id: created.user.id })
      if (mappingError) {
        await service.from('profiles').delete().eq('id', created.user.id)
        await service.auth.admin.deleteUser(created.user.id)
        return reply(400, { error: `Could not link this user to the buyer account: ${mappingError.message}` })
      }
    }
    await service.from('audit_log').insert({ actor_id: authData.user.id, action: 'user_created', entity_type: 'profile', entity_id: created.user.id, details: { email, role, buyer_id: role === 'buyer' ? buyerId : null } })
    return reply(200, { message: 'User account created.', userId: created.user.id })
  }

  if (body.action === 'update') {
    const userId = typeof body.userId === 'string' ? body.userId : ''
    if (!userId) return reply(400, { error: 'Select a user to update.' })
    if (typeof body.active !== 'boolean') return reply(400, { error: 'Choose whether this account should be active.' })
    const { data: current, error: currentError } = await service.from('profiles').select('id,display_name,role,active').eq('id', userId).maybeSingle()
    if (currentError || !current) return reply(404, { error: 'Workspace user was not found.' })
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    if (!/^\S+@\S+\.\S+$/.test(email)) return reply(400, { error: 'Enter a valid email address.' })
    const active = body.active === true
    if (userId === authData.user.id && (role !== 'admin' || !active)) return reply(400, { error: 'You cannot remove or deactivate your own administrator access.' })
    if (current.role === 'admin' && current.active && (role !== 'admin' || !active)) {
      const { count, error: countError } = await service.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'admin').eq('active', true)
      if (countError || (count ?? 0) <= 1) return reply(400, { error: 'Keep at least one active administrator in the workspace.' })
    }
    const password = typeof body.password === 'string' ? body.password : ''
    if (password && password.length < 8) return reply(400, { error: 'A temporary password must have at least 8 characters.' })
    const { data: authRecord, error: authLookupError } = await service.auth.admin.getUserById(userId)
    if (authLookupError || !authRecord.user) return reply(404, { error: 'The sign-in account was not found.' })
    const authChanges: { password?: string; email?: string; email_confirm?: boolean; ban_duration?: string } = {}
    if (password) authChanges.password = password
    if (email !== authRecord.user.email) { authChanges.email = email; authChanges.email_confirm = true }
    authChanges.ban_duration = active ? 'none' : '876000h'
    const { data: oldMappings } = await service.from('buyer_user_access').select('buyer_id').eq('user_id', userId)
    const { error: profileError } = await service.from('profiles').update({ display_name: displayName, role, active }).eq('id', userId)
    if (profileError) return reply(400, { error: `Could not update the workspace profile: ${profileError.message}` })
    const { error: mappingDeleteError } = await service.from('buyer_user_access').delete().eq('user_id', userId)
    if (mappingDeleteError) {
      await service.from('profiles').update({ display_name: current.display_name, role: current.role, active: current.active }).eq('id', userId)
      return reply(500, { error: 'Could not update buyer access. The previous user settings were restored.' })
    }
    if (role === 'buyer') {
      const { error: mappingError } = await service.from('buyer_user_access').insert({ buyer_id: buyerId, user_id: userId })
      if (mappingError) {
        await service.from('profiles').update({ display_name: current.display_name, role: current.role, active: current.active }).eq('id', userId)
        if (oldMappings?.length) await service.from('buyer_user_access').insert(oldMappings.map(mapping => ({ ...mapping, user_id: userId })))
        return reply(400, { error: `Could not link this user to the buyer account: ${mappingError.message}` })
      }
    }
    if (Object.keys(authChanges).length) {
      const { error: authUpdateError } = await service.auth.admin.updateUserById(userId, authChanges)
      if (authUpdateError) {
        await service.from('profiles').update({ display_name: current.display_name, role: current.role, active: current.active }).eq('id', userId)
        await service.from('buyer_user_access').delete().eq('user_id', userId)
        if (oldMappings?.length) await service.from('buyer_user_access').insert(oldMappings.map(mapping => ({ ...mapping, user_id: userId })))
        return reply(400, { error: `Could not update the sign-in account: ${authUpdateError.message}` })
      }
    }
    const message = !active ? 'User updated and sign-in access deactivated.' : password ? 'User updated and temporary password reset.' : email !== authRecord.user.email ? 'User updated and sign-in email changed.' : 'User updated.'
    await service.from('audit_log').insert({ actor_id: authData.user.id, action: 'user_updated', entity_type: 'profile', entity_id: userId, details: { previous_role: current.role, role, previous_active: current.active, active, email_changed: email !== authRecord.user.email, password_reset: Boolean(password), buyer_id: role === 'buyer' ? buyerId : null } })
    return reply(200, { message })
  }

  return reply(400, { error: 'Choose a supported user-management action.' })
})
