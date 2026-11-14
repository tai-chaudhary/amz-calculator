import React from 'react'
import { PageHeader } from './UI'
import LaunchBoard from './LaunchBoard'
import { useLaunch } from '../lib/launch'

/**
 * Launch (v2.74.0): approved listings until they're live — its own page after Approvals, because it's the work that
 * follows the decision (ordering, chasing deliveries, pushing live), often done by whoever orders stock.
 */
export default function LaunchPage(props) {
  const { rows } = useLaunch()
  const c = (rows || []).reduce((m, r) => ({ ...m, [r.stage]: (m[r.stage] || 0) + 1 }), {})
  return (
    <div className="page-shell">
      <PageHeader
        eyebrow="Listings / launch"
        title="Launch"
        description="Approved listings until they go live. Where each one is — needs ordering, ordered, arriving, or ready to go live — is worked out from stock on hand, purchase orders and Goods In."
        meta={rows ? <><span>{rows.length} approved, not live</span><span>{c.ready || 0} ready to go live</span><span>{c.needs_order || 0} need ordering</span></> : null}
      />
      <LaunchBoard {...props} />
    </div>
  )
}
