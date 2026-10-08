import React from 'react'
import { PageHeader, Tabs } from './UI'
import ReviewPage from './ReviewPage'
import ProposedChangesPage from './ProposedChangesPage'

/**
 * Everything waiting on a decision, in one place: new listings to approve,
 * and changes the portal wants to make to what already exists. Two separate
 * workflows underneath — one job from your point of view.
 */
export default function ApprovalsPage({ tab = 'listings', onTab, listingCount, changeCount, reviewProps, changesProps }) {
  const active = tab === 'changes' ? 'changes' : 'listings'
  return (
    <div>
      <PageHeader
        eyebrow="Listings / decisions"
        title="Approvals"
        description="Everything waiting for your decision. New listings need approving before they can be ordered; changes to existing products are never applied until you approve them."
        meta={`${listingCount + changeCount} waiting`}
      />
      <Tabs
        value={active}
        onChange={onTab}
        items={[
          { id: 'listings', label: 'New listings', count: listingCount },
          { id: 'changes', label: 'Changes', count: changeCount },
        ]}
      />
      {active === 'listings'
        ? <ReviewPage {...reviewProps} embedded />
        : <ProposedChangesPage {...changesProps} embedded />}
    </div>
  )
}
