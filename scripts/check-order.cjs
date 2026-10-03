const src = require('fs').readFileSync(process.argv[2], 'utf8').split('\n')
const decl = new Map()
src.forEach((l, i) => { const m = l.match(/^\s{2}const (\w+) = (useCallback|useMemo|useState|\[)/); if (m) decl.set(m[1], i) ;
  const s = l.match(/^\s{2}const \[(\w+), (\w+)\] = useState/); if (s) { decl.set(s[1], i); decl.set(s[2], i) } })
let bad = 0
src.forEach((l, i) => { const m = l.match(/^\s{2}\}, \[([^\]]*)\]\)/); if (!m) return
  m[1].split(',').map(x => x.trim()).filter(Boolean).forEach(dep => { const d = decl.get(dep)
    if (d !== undefined && d > i) { console.log(`line ${i + 1}: uses "${dep}" declared later at line ${d + 1}`); bad++ } }) })
console.log(bad ? `${bad} ordering problem(s)` : '✓ no callbacks use anything declared after them')
