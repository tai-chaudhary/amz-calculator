// Every React hook a file uses must be imported (or called as React.useX). A missing one only shows up in the
// browser as a blank page — this catches it before deploy (v2.59.0–2.60.1 shipped without useRef in App.jsx).
const fs = require('fs'), path = require('path')
const files = [path.join('src', 'App.jsx'), ...fs.readdirSync(path.join('src', 'components')).filter(f => f.endsWith('.jsx')).map(f => path.join('src', 'components', f))]
let bad = 0
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8')
  const imp = (s.match(/import React,?\s*\{([^}]*)\}\s*from 'react'/) || s.match(/import\s*\{([^}]*)\}\s*from 'react'/) || [, ''])[1]
  const have = new Set(imp.split(',').map(x => x.trim().split(/\s+as\s+/).pop()).filter(Boolean))
  const used = new Set([...s.matchAll(/(?<![.\w])(use(?:State|Effect|Ref|Memo|Callback|Reducer|Context|LayoutEffect|Id|Transition|DeferredValue))\(/g)].map(m => m[1]))
  for (const h of used) if (!have.has(h)) { console.log(`${f}: uses ${h} but doesn't import it from 'react'`); bad++ }
}
if (bad) { console.log(`${bad} problem(s)`); process.exit(1) } else console.log('✓ every hook used is imported')
