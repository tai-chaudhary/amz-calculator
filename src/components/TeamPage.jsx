import React, { useState, useMemo } from 'react'
import { LOCKABLE, ROLES, roleLabel, canAccess, pageLabel } from '../lib/access'
import { PageHeader, Icon, StatusBadge, Modal, Drawer, EmptyState, SearchInput } from './UI'

const randomPassword = () => {
  const words = ['amber', 'harbour', 'copper', 'lantern', 'meadow', 'pebble', 'quartz', 'willow', 'anchor', 'cobalt']
  const pick = () => words[Math.floor(Math.random() * words.length)]
  return `${pick()}-${pick()}-${Math.floor(1000 + Math.random() * 9000)}`
}

/**
 * Who can use the portal, and which sections each person sees. Roles tick the
 * checklist for you; every box can then be changed by hand.
 */
export default function TeamPage({ profiles, me, onCreate, onUpdate, onSetPassword }) {
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(null)
  const [search, setSearch] = useState('')

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return [...profiles]
      .filter(p => !q || [p.display_name, p.email, p.role].some(v => String(v || '').toLowerCase().includes(q)))
      .sort((a, b) => (b.active !== false) - (a.active !== false) ||
        (a.role === 'admin' ? -1 : 1) - (b.role === 'admin' ? -1 : 1) ||
        String(a.display_name || '').localeCompare(String(b.display_name || '')))
  }, [profiles, search])

  const edited = editing ? profiles.find(p => p.id === editing.id) || editing : null

  return (
    <div>
      <PageHeader
        eyebrow="Tools / people"
        title="Team & Access"
        description="Everyone who can sign in, and which sections of the portal each of them can open. Anything not ticked is hidden from their menu and blocked if they follow a link to it."
        meta={`${profiles.filter(p => p.active !== false).length} active · ${profiles.filter(p => p.active === false).length} turned off`}
        actions={<button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}><Icon name="plus" size={14} /> Add someone</button>}
      />

      <div className="flex justify-between gap-3 flex-wrap mb-4">
        <SearchInput value={search} onChange={e => setSearch(e.target.value)} placeholder="Name, email or role" className="w-full sm:w-72" />
        <div className="text-xs text-ink/50 self-center">New sections are locked for everyone until you tick them here.</div>
      </div>

      {rows.length === 0 ? <EmptyState icon="user" title="Nobody matches that" /> : (
        <div className="space-y-3">
          {rows.map(p => {
            const inactive = p.active === false
            const granted = p.role === 'admin' ? LOCKABLE.map(x => x.id) : (p.permissions || [])
            return (
              <div key={p.id} className={`card ${inactive ? 'opacity-60' : ''}`}>
                <div className="flex items-start gap-4 flex-wrap">
                  <div className="w-10 h-10 rounded-full bg-royal-500 text-white flex items-center justify-center text-sm font-semibold flex-shrink-0">
                    {String(p.display_name || p.email || '?').charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-ink">{p.display_name || p.email}</span>
                      {p.id === me?.id && <StatusBadge tone="brand">You</StatusBadge>}
                      <StatusBadge tone={p.role === 'admin' ? 'live' : 'quiet'}>{roleLabel(p.role)}</StatusBadge>
                      {inactive && <StatusBadge tone="alert">Turned off</StatusBadge>}
                    </div>
                    <div className="text-xs text-ink/50 mt-0.5">{p.email}</div>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {p.role === 'admin' ? (
                        <span className="text-xs text-gain font-medium">Every section, including cost settings and this page</span>
                      ) : granted.length === 0 ? (
                        <span className="text-xs text-warn font-medium">No sections yet — they’ll see the dashboard only</span>
                      ) : LOCKABLE.filter(x => granted.includes(x.id)).map(x => (
                        <span key={x.id} className="link-chip" title={x.label}><Icon name={x.icon} size={12} />{x.label}</span>
                      ))}
                    </div>
                  </div>
                  <button className="btn btn-secondary btn-sm" onClick={() => setEditing(p)}>
                    <Icon name="edit" size={14} /> Manage
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {adding && <AddPerson onClose={() => setAdding(false)} onCreate={onCreate} />}
      {edited && <ManagePerson p={edited} me={me} onClose={() => setEditing(null)} onUpdate={onUpdate} onSetPassword={onSetPassword} />}
    </div>
  )
}

/** Role picker plus the checklist — choosing a role ticks the boxes for you. */
function AccessPicker({ role, permissions, onRole, onPermissions, disabled }) {
  const all = LOCKABLE.map(x => x.id)
  const toggle = (id) => onPermissions(permissions.includes(id) ? permissions.filter(x => x !== id) : [...permissions, id])
  return (
    <div>
      <div className="label">Role</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
        {Object.entries(ROLES).map(([key, r]) => (
          <button key={key} type="button" disabled={disabled}
            className={`text-left p-3 rounded-lg border transition-colors ${role === key ? 'border-royal-400 bg-royal-50' : 'border-rule bg-white hover:border-royal-200'}`}
            onClick={() => { onRole(key); onPermissions(r.pages()) }}>
            <div className="text-sm font-semibold text-ink">{r.label}</div>
            <div className="text-xs text-ink/55 mt-0.5">{r.description}</div>
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="label mb-0">Sections they can open</div>
        {role !== 'admin' && (
          <div className="flex gap-2">
            <button type="button" className="btn btn-secondary btn-xs" onClick={() => onPermissions(all)}>Tick all</button>
            <button type="button" className="btn btn-secondary btn-xs" onClick={() => onPermissions([])}>Clear</button>
          </div>
        )}
      </div>

      {role === 'admin' ? (
        <div className="panel-notice text-sm">Admins can open everything, including Cost Settings and Team &amp; Access. The checklist doesn’t apply.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {LOCKABLE.map(x => (
            <label key={x.id} className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${permissions.includes(x.id) ? 'border-royal-300 bg-royal-50/60' : 'border-rule bg-white hover:border-royal-200'}`}>
              <input type="checkbox" className="w-4 h-4 accent-royal-500" checked={permissions.includes(x.id)} onChange={() => toggle(x.id)} />
              <Icon name={x.icon} size={15} className="text-ink/45" />
              <span className="text-sm text-ink">{x.label}</span>
            </label>
          ))}
        </div>
      )}
      <div className="text-xs text-ink/50 mt-2">The dashboard is always available — everything on it links to sections, and locked ones stay hidden.</div>
    </div>
  )
}

function AddPerson({ onClose, onCreate }) {
  const [form, setForm] = useState({ displayName: '', email: '', password: randomPassword(), role: 'member', permissions: [] })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [created, setCreated] = useState(null)
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  const submit = async () => {
    setBusy(true); setError('')
    try {
      await onCreate(form)
      setCreated({ email: form.email.trim().toLowerCase(), password: form.password })
    } catch (e) { setError(e?.message || 'Could not create this person') }
    setBusy(false)
  }

  if (created) {
    return (
      <Modal title="Account created" description="No email is sent. Pass these details on yourself, and ask them to change the password after signing in." onClose={onClose}>
        <div className="p-4 rounded-card bg-paper border border-rule text-sm space-y-2">
          <div className="flex justify-between gap-3"><span className="text-ink/60">Email</span><b className="text-ink">{created.email}</b></div>
          <div className="flex justify-between gap-3"><span className="text-ink/60">Starting password</span><b className="text-ink font-mono">{created.password}</b></div>
        </div>
        <div className="flex gap-2 mt-4">
          <button className="btn btn-secondary flex-1" onClick={() => navigator.clipboard?.writeText(`${created.email} / ${created.password}`)}>
            <Icon name="save" size={15} /> Copy both
          </button>
          <button className="btn btn-primary flex-1" onClick={onClose}>Done</button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title="Add someone" description="They can sign in straight away with the starting password. No email is sent." onClose={onClose} maxWidth="max-w-2xl">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        <div><label className="label" htmlFor="tp-name">Name</label>
          <input id="tp-name" className="input" value={form.displayName} onChange={set('displayName')} placeholder="e.g. Ahmed" autoFocus /></div>
        <div><label className="label" htmlFor="tp-email">Email they’ll sign in with</label>
          <input id="tp-email" className="input" type="email" value={form.email} onChange={set('email')} placeholder="name@homey.co.uk" /></div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="tp-pass">Starting password</label>
          <div className="flex gap-2">
            <input id="tp-pass" className="input font-mono" value={form.password} onChange={set('password')} />
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setForm(f => ({ ...f, password: randomPassword() }))}>New one</button>
          </div>
        </div>
      </div>

      <AccessPicker role={form.role} permissions={form.permissions}
        onRole={(role) => setForm(f => ({ ...f, role }))}
        onPermissions={(permissions) => setForm(f => ({ ...f, permissions }))} />

      {error && <div className="text-sm text-loss mt-3">{error}</div>}
      <div className="flex gap-2 mt-5">
        <button className="btn btn-secondary flex-1" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn btn-primary flex-1" onClick={submit}
          disabled={busy || !form.email.trim() || form.password.length < 10}>
          {busy ? 'Creating…' : 'Create account'}
        </button>
      </div>
    </Modal>
  )
}

function ManagePerson({ p, me, onClose, onUpdate, onSetPassword }) {
  const [form, setForm] = useState({
    displayName: p.display_name || '', role: p.role || 'member',
    permissions: Array.isArray(p.permissions) ? p.permissions : [],
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [passwordSet, setPasswordSet] = useState(false)
  const isMe = p.id === me?.id
  const dirty = form.displayName !== (p.display_name || '') || form.role !== (p.role || 'member') ||
    JSON.stringify([...form.permissions].sort()) !== JSON.stringify([...(p.permissions || [])].sort())

  const run = async (fn) => { setBusy(true); setError(''); try { await fn() } catch (e) { setError(e?.message || 'That didn’t work') } setBusy(false) }

  return (
    <Drawer title={p.display_name || p.email} description={p.email} onClose={onClose} width="max-w-2xl"
      footer={
        <div className="flex gap-2 flex-wrap justify-between">
          <button className="btn btn-secondary btn-sm" disabled={busy || isMe}
            title={isMe ? 'You can’t turn off your own access' : ''}
            onClick={() => run(() => onUpdate(p.id, { active: p.active === false }))}>
            <Icon name={p.active === false ? 'play' : 'pause'} size={14} /> {p.active === false ? 'Turn access back on' : 'Turn off access'}
          </button>
          <div className="flex gap-2">
            <button className="btn btn-secondary btn-sm" onClick={onClose}>Close</button>
            <button className="btn btn-primary btn-sm" disabled={busy || !dirty}
              onClick={() => run(async () => { await onUpdate(p.id, form); })}>
              {busy ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
            </button>
          </div>
        </div>
      }>
      {p.active === false && <div className="panel-notice mb-4 text-sm">This account is turned off. They can’t sign in or see any data until it’s turned back on.</div>}

      <div className="mb-4">
        <label className="label" htmlFor="mp-name">Name</label>
        <input id="mp-name" className="input" value={form.displayName} onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))} />
      </div>

      <AccessPicker role={form.role} permissions={form.permissions}
        onRole={(role) => setForm(f => ({ ...f, role }))}
        onPermissions={(permissions) => setForm(f => ({ ...f, permissions }))} />

      <div className="mt-6 pt-4 border-t border-rule">
        <div className="text-sm font-semibold text-ink mb-2">Set a new password</div>
        <p className="text-xs text-ink/55 mb-2">No email is sent — pass the new password on yourself.</p>
        <div className="flex gap-2 flex-wrap">
          <input className="input font-mono flex-1 min-w-[220px]" value={newPassword} onChange={e => { setNewPassword(e.target.value); setPasswordSet(false) }} placeholder="At least 10 characters" />
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setNewPassword(randomPassword()); setPasswordSet(false) }}>Suggest one</button>
          <button className="btn btn-secondary btn-sm" disabled={busy || newPassword.length < 10}
            onClick={() => run(async () => { await onSetPassword(p.id, newPassword); setPasswordSet(true) })}>
            {passwordSet ? 'Password set' : 'Set password'}
          </button>
        </div>
      </div>

      {error && <div className="text-sm text-loss mt-4">{error}</div>}
    </Drawer>
  )
}
