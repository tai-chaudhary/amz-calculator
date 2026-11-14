// Creating people and changing their access needs a privileged key, which must
// never reach a browser. This runs on Supabase's servers and does the work only
// when the caller is signed in and an admin.
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
})

/** The signed-in caller, but only if they're an active admin. */
async function callerAdmin(req: Request) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token) return null
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data?.user) return null
  const { data: profile } = await admin.from('profiles').select('id, role, active, display_name').eq('id', data.user.id).maybeSingle()
  if (!profile || profile.role !== 'admin' || profile.active === false) return null
  return profile
}

const clean = (v: unknown) => String(v ?? '').trim()

async function activeAdminCount() {
  const { count } = await admin.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'admin').eq('active', true)
  return count || 0
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
  const me = await callerAdmin(req)
  if (!me) return json({ error: 'Only an admin can manage people' }, 403)

  const body = await req.json().catch(() => ({}))
  const action = clean(body.action)

  try {
    if (action === 'create') {
      const email = clean(body.email).toLowerCase()
      const password = String(body.password ?? '')
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'That email doesn’t look right' }, 400)
      if (password.length < 10) return json({ error: 'Use a starting password of at least 10 characters' }, 400)

      // Created already confirmed: no email is ever sent, as agreed
      const { data, error } = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
        user_metadata: { display_name: clean(body.displayName) || email.split('@')[0] },
      })
      if (error) return json({ error: error.message.includes('already') ? 'Someone already uses that email' : error.message }, 400)

      const role = ['admin', 'manager', 'hunter', 'accounts', 'member'].includes(clean(body.role)) ? clean(body.role) : 'member'
      const { data: profile, error: pErr } = await admin.from('profiles').upsert({
        id: data.user!.id, email, display_name: clean(body.displayName) || email.split('@')[0],
        role, permissions: Array.isArray(body.permissions) ? body.permissions : [], active: true, created_by: me.id,
      }, { onConflict: 'id' }).select().single()
      if (pErr) return json({ error: pErr.message }, 400)
      return json({ profile })
    }

    if (action === 'update') {
      const id = clean(body.id)
      if (!id) return json({ error: 'Which person?' }, 400)
      const patch: Record<string, unknown> = {}
      if (body.displayName !== undefined) patch.display_name = clean(body.displayName)
      if (body.role !== undefined) patch.role = ['admin', 'manager', 'hunter', 'accounts', 'member'].includes(clean(body.role)) ? clean(body.role) : 'member'
      if (body.permissions !== undefined) patch.permissions = Array.isArray(body.permissions) ? body.permissions : []
      if (body.active !== undefined) patch.active = !!body.active

      // An admin can't lock themselves out, and the last admin stays an admin
      if (id === me.id && (patch.role !== undefined && patch.role !== 'admin' || patch.active === false)) {
        return json({ error: 'You can’t remove your own admin access — ask another admin to do it' }, 400)
      }
      if ((patch.role !== undefined && patch.role !== 'admin') || patch.active === false) {
        const { data: target } = await admin.from('profiles').select('role, active').eq('id', id).maybeSingle()
        if (target?.role === 'admin' && target?.active && await activeAdminCount() <= 1) {
          return json({ error: 'This is the only admin left — make someone else an admin first' }, 400)
        }
      }
      const { data: profile, error } = await admin.from('profiles').update(patch).eq('id', id).select().single()
      if (error) return json({ error: error.message }, 400)
      return json({ profile })
    }

    if (action === 'password') {
      const id = clean(body.id)
      const password = String(body.password ?? '')
      if (password.length < 10) return json({ error: 'Use a password of at least 10 characters' }, 400)
      const { error } = await admin.auth.admin.updateUserById(id, { password })
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    return json({ error: `Unknown action "${action}"` }, 400)
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500)
  }
})
