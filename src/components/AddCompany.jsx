import React, { useState } from 'react'
import { DIRECTORIES, PO_CATEGORIES } from '../lib/purchases'
import { Modal, Icon } from './UI'

/**
 * Adding a company to whichever list you're looking at. The tag decides where
 * it appears and which purchase orders can be raised against it.
 */
export default function AddCompany({ scope, onClose, onSave }) {
  const dir = DIRECTORIES[scope] || DIRECTORIES.companies
  const [kind, setKind] = useState(dir.kinds[0])
  const [form, setForm] = useState({ name: '', website: '', accountRef: '', creditDays: '', notes: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  return (
    <Modal title={`New ${dir.singular.toLowerCase()}`}
      description={scope === 'suppliers' ? 'Stock and packaging suppliers. Prices and products come later, from a price list or by hand.'
        : scope === 'carriers' ? 'Their rates live in Cost Settings; this is who you pay and what you spend.'
        : 'Anyone else you pay — an agency, an accountant, a software subscription.'}
      onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-3">
        <div>
          <label className="label" htmlFor="ac-name">Name</label>
          <input id="ac-name" className="input" value={form.name} onChange={set('name')} autoFocus />
        </div>

        {dir.kinds.length > 1 && (
          <div>
            <div className="label">What do you use them for?</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {dir.kinds.map(k => (
                <button key={k} type="button" onClick={() => setKind(k)}
                  className={`p-2.5 rounded-lg border text-left transition-colors ${kind === k ? 'border-royal-400 bg-royal-50' : 'border-rule bg-white hover:border-royal-200'}`}>
                  <Icon name={PO_CATEGORIES[k].icon} size={14} className="text-royal-500" />
                  <div className="text-sm font-medium text-ink mt-1">{PO_CATEGORIES[k].label}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="ac-ref">Your account reference</label>
            <input id="ac-ref" className="input" value={form.accountRef} onChange={set('accountRef')} placeholder="optional" />
          </div>
          <div>
            <label className="label" htmlFor="ac-days">Days to pay</label>
            <input id="ac-days" type="number" className="input" value={form.creditDays} onChange={set('creditDays')} placeholder="e.g. 30" />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="ac-web">Website</label>
          <input id="ac-web" className="input" value={form.website} onChange={set('website')} placeholder="optional" />
        </div>

        {error && <div className="text-sm text-loss">{error}</div>}
        <div className="flex gap-2 pt-1">
          <button className="btn btn-secondary flex-1" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary flex-1" disabled={busy || !form.name.trim()}
            onClick={async () => {
              setBusy(true); setError('')
              try { await onSave(form, kind) } catch (e) { setError(e?.message || 'Could not add them') } finally { setBusy(false) }
            }}>
            {busy ? 'Adding…' : `Add ${dir.singular.toLowerCase()}`}
          </button>
        </div>
      </div>
    </Modal>
  )
}
