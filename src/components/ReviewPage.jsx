import React, { useState } from 'react'
import { calcProduct, fmt, fmtSigned, pct } from '../lib/calc'
import { EmptyState, Icon, PageHeader, ProductImage, SearchInput, StatusBadge } from './UI'
import ReviewDrawer from './ReviewDrawer'
import { ListingConnections } from './Links'

export default function ReviewPage({ savedProducts, stockItems = [], settings, onApprove, onSendBack, onLoad, onSaveChanges, embedded = false }) {
  const [openId, setOpenId] = useState(null)
  const [search, setSearch] = useState('')
  const [noteFor, setNoteFor] = useState(null)
  const [noteText, setNoteText] = useState('')

  const allInReview = savedProducts.filter(row => (row.data?.reviewStatus || 'none') === 'review')
  const inReview = allInReview.filter(row => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    const p = row.data || {}
    return row.name.toLowerCase().includes(q) ||
      (p.brand || '').toLowerCase().includes(q) ||
      (p.asin || '').toLowerCase().includes(q) ||
      (p.supplierSku || '').toLowerCase().includes(q)
  })

  const handleSendBack = (row) => {
    onSendBack(row.id, noteText.trim())
    setNoteFor(null)
    setNoteText('')
  }

  return (
    <div>
      {!embedded && (
        <PageHeader
          eyebrow="Workflow / approval"
          title="Review Queue"
          description="A focused approval step before a calculated listing can move into the live catalogue."
          meta={`${allInReview.length} ${allInReview.length === 1 ? 'listing' : 'listings'} awaiting a decision`}
        />
      )}

      {allInReview.length === 0 ? (
        <div className="surface">
          <EmptyState
            icon="review"
            title="Nothing to review"
            sub="Listings sent for approval from Saved Listings or Bulk Upload will appear here."
          />
        </div>
      ) : (
        <>
          <div className="filter-bar mb-4">
            <SearchInput
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by listing, brand, ASIN or supplier SKU…"
              className="w-full sm:max-w-md"
            />
            <div className="text-xs text-ink/45 sm:ml-auto">Showing {inReview.length} of {allInReview.length}</div>
          </div>

          <div className="surface overflow-hidden">
            <div className="overflow-x-auto">
              <table className="data-table min-w-[980px]">
                <thead>
                  <tr>
                    <th>Listing</th>
                    <th>Status</th>
                    <th className="text-right">Sell</th>
                    <th className="text-right">Cost</th>
                    <th className="text-right">Profit</th>
                    <th className="text-right">Margin</th>
                    <th>Submitted</th>
                    <th className="text-right">Decision</th>
                  </tr>
                </thead>
                <tbody>
                  {inReview.map(row => {
                    const p = row.data || {}
                    const r = calcProduct(p, settings.carriers, settings.packaging, stockItems)
                    const asin = p.asin?.trim()
                    const lowMargin = r.margin < 10
                    const isBundle = parseInt(p.bundleQty) > 1
                    return (
                      <React.Fragment key={row.id}>
                        <tr className="cursor-pointer hover:bg-royal-50/40" tabIndex={0}
                          onClick={() => setOpenId(row.id)} onKeyDown={e => e.key === 'Enter' && setOpenId(row.id)}>
                          <td className="min-w-[300px]">
                            <div className="flex items-center gap-3">
                              <div className="w-12 h-12 bg-white border border-rule rounded-[5px] overflow-hidden flex-shrink-0">
                                <ProductImage asin={asin} manualImage={p.productImage} alt={row.name} className="object-contain w-full h-full p-1" placeholderSize="text-xl" />
                              </div>
                              <div className="min-w-0">
                                <div className="font-medium text-ink leading-snug truncate max-w-[270px]">{row.name}</div>
                                <ListingConnections p={p} stockItems={stockItems} className="mt-1" />
                                {p.hunter && (
                                  <div className="text-xs text-ink/50 mt-1 flex gap-2 flex-wrap">
                                    <span className="text-royal-600">From hunt{p.hunter.huntName ? `: ${p.hunter.huntName}` : ''}</span>
                                    {p.hunter.sales != null && <span>{Number(p.hunter.sales).toLocaleString()} sales/mo</span>}
                                    {p.hunter.sellers != null && <span>{p.hunter.sellers} sellers</span>}
                                    {p.hunter.amazonSelling && <span className="text-loss">Amazon sells it</span>}
                                    {p.hunter.marketPrice != null && <span>market £{Number(p.hunter.marketPrice).toFixed(2)}</span>}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                          <td>
                            <div className="flex gap-1.5 flex-wrap">
                              <StatusBadge tone="paused" dot>In review</StatusBadge>
                              {isBundle && <StatusBadge tone="brand">Bundle ×{p.bundleQty}</StatusBadge>}
                              {lowMargin && <StatusBadge tone="alert">Low margin</StatusBadge>}
                              {p.feeVerified ? <StatusBadge tone="live">Fee verified</StatusBadge> : <StatusBadge tone="paused">Fee not verified</StatusBadge>}
                            </div>
                          </td>
                          <td className="text-right tabular-nums">{fmt(r.sellPrice)}</td>
                          <td className="text-right tabular-nums text-ink/55">{fmt(r.costPrice)}</td>
                          <td className={`text-right tabular-nums font-medium ${r.netProfit >= 0 ? 'text-gain' : 'text-loss'}`}>{fmtSigned(r.netProfit)}</td>
                          <td className={`text-right tabular-nums font-medium ${r.margin >= 0 ? 'text-gain' : 'text-loss'}`}>{pct(r.margin)}</td>
                          <td className="text-xs text-ink/50 min-w-[130px]">
                            <div>{p.submittedByName || p.createdByName || '—'}</div>
                            {p.submittedAt && <div className="mt-0.5">{new Date(p.submittedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</div>}
                          </td>
                          <td className="text-right whitespace-nowrap" onClick={e => e.stopPropagation()}>
                            <button className="btn btn-primary btn-sm" onClick={() => setOpenId(row.id)}>
                              Review <Icon name="arrowRight" size={14} />
                            </button>
                            <button className="btn btn-secondary btn-sm ml-1.5" onClick={() => onApprove(row.id, row.name)} title="Approve without opening">
                              <Icon name="check" size={14} /> Approve
                            </button>
                            <button className="btn btn-secondary btn-sm ml-1.5" onClick={() => { setNoteFor(row.id); setNoteText(p.reviewNote || '') }}>
                              Send back
                            </button>
                          </td>
                        </tr>
                        {(p.reviewNote || noteFor === row.id) && (
                          <tr className="bg-paper/55">
                            <td colSpan="8" className="py-3">
                              {noteFor === row.id ? (
                                <div className="flex gap-2 items-center max-w-3xl">
                                  <input
                                    autoFocus
                                    className="input text-sm flex-1"
                                    placeholder="Reason or feedback, e.g. check shipping weight"
                                    value={noteText}
                                    onChange={e => setNoteText(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') handleSendBack(row); if (e.key === 'Escape') setNoteFor(null) }}
                                  />
                                  <button className="btn btn-primary btn-sm" onClick={() => handleSendBack(row)}>Send back</button>
                                  <button className="btn btn-secondary btn-sm" onClick={() => setNoteFor(null)}>Cancel</button>
                                </div>
                              ) : (
                                <div className="text-xs text-ink/55"><span className="font-semibold text-ink/70">Review note:</span> {p.reviewNote}</div>
                              )}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
      {openId && (() => {
        const row = allInReview.find(x => x.id === openId)
        if (!row) return null
        const i = inReview.findIndex(x => x.id === openId)
        const next = inReview[i + 1] || inReview.filter(x => x.id !== openId)[0]
        return (
          <ReviewDrawer key={row.id} row={row} settings={settings} stockItems={stockItems}
            position={i >= 0 ? { at: i + 1, of: inReview.length } : null}
            onPrev={i > 0 ? () => setOpenId(inReview[i - 1].id) : null}
            onNext={next && next.id !== openId ? () => setOpenId(next.id) : null}
            onClose={() => setOpenId(null)}
            onApprove={onApprove} onSendBack={onSendBack}
            onSaveChanges={onSaveChanges} onOpenCalculator={(r) => { setOpenId(null); onLoad(r) }} />
        )
      })()}
    </div>
  )
}
