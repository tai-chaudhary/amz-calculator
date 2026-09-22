// Every <Component> a file renders must be imported or defined in that file
const fs = require('fs'), path = require('path')
const dir = process.argv[2]
let bad = 0
for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.jsx'))) {
  const src = fs.readFileSync(path.join(dir, f), 'utf8')
  const used = new Set([...src.matchAll(/<([A-Z][A-Za-z0-9]*)[\s/>]/g)].map(m => m[1]))
  const imported = new Set([...src.matchAll(/import\s+(?:(\w+)\s*,?\s*)?(?:\{([^}]*)\})?\s*from/g)]
    .flatMap(m => [m[1], ...(m[2] || '').split(',').map(s => s.trim().split(/\s+as\s+/).pop())]).filter(Boolean))
  const local = new Set([...src.matchAll(/(?:function|const|let|class)\s+([A-Z][A-Za-z0-9]*)/g)].map(m => m[1]))
  for (const name of used) if (!imported.has(name) && !local.has(name) && name !== 'React') { console.log(`${f}: <${name}> is used but never imported or defined`); bad++ }
}
console.log(bad ? `${bad} problem(s)` : '✓ every component used is imported or defined')
process.exitCode = bad ? 1 : 0
