import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isSupabaseConfigured = Boolean(url && anonKey)
export const supabase = isSupabaseConfigured ? createClient(url!, anonKey!) : null

export async function invokeProtectedFunction<T>(name: string, body: unknown): Promise<T> {
  if (!supabase) throw new Error('Supabase is not configured. This workspace is in Preview mode.')
  const { data, error } = await supabase.functions.invoke(name, { body: body as Record<string, unknown> })
  if (error) {
    const context = (error as { context?: unknown }).context
    if (context instanceof Response) {
      const details = await context.clone().json().catch(() => null) as { error?: string } | null
      if (details?.error) throw new Error(details.error)
    }
    throw new Error(error.message)
  }
  return data as T
}
