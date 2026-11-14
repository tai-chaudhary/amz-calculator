import React from 'react'
import { Icon } from './UI'
import { pageLabel, landingPage } from '../lib/access'

/**
 * Shown when someone opens a section they haven't been given — from a link,
 * a bookmark or a typed address. Says plainly what it is and who to ask,
 * rather than failing quietly or showing an empty page.
 */
export default function NoAccess({ page, me, admins = [], onNavigate }) {
  const name = pageLabel(page)
  const noProfile = me && !me.hasProfile
  const deactivated = me && me.active === false
  return (
    <div className="max-w-xl mx-auto text-center py-20">
      <div className="w-14 h-14 rounded-full bg-warn/12 text-warn flex items-center justify-center mx-auto mb-5">
        <Icon name="alert" size={26} />
      </div>
      <h1 className="text-2xl font-semibold text-ink mb-2">
        {deactivated ? 'Your access has been turned off' : `You don’t have access to ${name}`}
      </h1>
      <p className="text-ink/60 mb-6">
        {deactivated
          ? 'Your account is still here, but it has been deactivated. An admin can turn it back on.'
          : noProfile
            ? 'Your account hasn’t been given any sections yet.'
            : `This section is locked for your account. Everything else you can use is still in the menu on the left.`}
        {admins.length > 0 && ` Ask ${admins.map(a => a.display_name || a.email).join(' or ')} if you need it.`}
      </p>
      {!deactivated && landingPage(me) && (
        <button className="btn btn-primary" onClick={() => onNavigate?.(landingPage(me))}>
          <Icon name="back" size={15} /> Back to {pageLabel(landingPage(me))}
        </button>
      )}
    </div>
  )
}
