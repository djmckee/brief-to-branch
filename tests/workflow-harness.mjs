// Stubbed-agent harness for the four workflow scripts in .claude/workflows/.
// It fakes agent(), parallel() and pipeline() with the semantics the Workflow tool documents,
// then drives each script through its main paths: retry, blocked ticket, failed file review,
// disputed verdict, batch that skips a finding, dirty worktree.
//
// Run from the repo root (needs Node 18+):
//   node tests/workflow-harness.mjs .claude/workflows /tmp/wf-harness
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const DIR = process.argv[2], TMP = process.argv[3]
mkdirSync(TMP, { recursive: true })
let failures = 0
const check = (name, cond, detail) => { console.log(`${cond ? '  ok  ' : '  FAIL'} ${name}${cond ? '' : '  ' + (detail ?? '')}`); if (!cond) failures++ }

async function load(name) {
  const src = readFileSync(`${DIR}/${name}.js`, 'utf8').replace(/^export const meta/m, 'const meta')
  const out = `${TMP}/run-${name}.mjs`
  writeFileSync(out, `export default async function run(args, {agent, parallel, pipeline, log, phase}) {\n${src}\n}\n`)
  return (await import(pathToFileURL(out).href + `?t=${Date.now()}`)).default
}

// Documented semantics: parallel is a barrier, a throwing thunk resolves to null.
// pipeline runs each item through the stages independently; a throwing stage drops the item to null.
function hooks(stub) {
  const calls = [], logs = []
  return {
    calls, logs,
    log: m => logs.push(m), phase: () => {},
    parallel: thunks => Promise.all(thunks.map(t => Promise.resolve().then(t).catch(() => null))),
    pipeline: (items, ...stages) => Promise.all(items.map(async (item, i) => {
      let v = item
      try { for (const s of stages) v = await s(v, item, i) } catch { return null }
      return v
    })),
    agent: async (prompt, opts = {}) => { calls.push({ prompt, opts }); return stub(prompt, opts, calls) },
  }
}

console.log('implement.js')
{
  const run = await load('implement')
  const tickets = [{ id: '01', title: 'a' }, { id: '02', title: 'b' }, { id: '03', title: 'c' }]
  const args = { slug: 's', branch: 'feature/s', repoCardPath: 'r', specPath: 'p', statePath: 'st', tickets, maxAttempts: 2 }

  // ticket 02 blocked once, then done on the retry
  let seen02 = 0
  let h = hooks((prompt, opts) => {
    const id = opts.label.split('· ')[1]
    if (id === '02' && seen02++ === 0) return { id, status: 'blocked', summary: 'x', blockedReason: 'migration conflict' }
    return { id, status: 'done', summary: 'ok', commit: 'abc' + id }
  })
  let r = await run(args, h)
  check('retry then done: 3 done, nothing blocked', r.done.length === 3 && r.blocked === null && r.remaining.length === 0, JSON.stringify(r))
  check('retry prompt carries the previous blocker', h.calls.some(c => c.opts.label.endsWith('02') && c.prompt.includes('migration conflict')))
  check('sequential: 02 only starts after 01 returned', h.calls.findIndex(c => c.opts.label.endsWith('02')) === 1)
  check('agentType implement-ticket', h.calls.every(c => c.opts.agentType === 'implement-ticket'))

  // ticket 02 blocked twice: stop, 03 never attempted
  h = hooks((p, opts) => { const id = opts.label.split('· ')[1]; return id === '02' ? { id, status: 'blocked', summary: 'x', blockedReason: 'no' } : { id, status: 'done', summary: 'ok', commit: 'c' } })
  r = await run(args, h)
  check('blocked twice: done=[01], blocked=02, remaining=[03]', r.done.length === 1 && r.blocked?.id === '02' && r.blocked.attempts === 2 && r.remaining.join() === '03', JSON.stringify(r))
  check('03 never launched', !h.calls.some(c => c.opts.label.endsWith('03')))

  // agent returns null (skipped): treated as blocked with a reason
  h = hooks(() => null)
  r = await run(args, h)
  check('null result: blocked with "agent returned no result"', r.blocked?.id === '01' && r.blocked.reason === 'agent returned no result')
  r = await run({ ...args, tickets: [] }, hooks(() => null))
  check('empty tickets: no agents, empty result', r.done.length === 0 && r.blocked === null)
}

console.log('branch-review.js')
{
  const run = await load('branch-review')
  const files = ['a.py', 'b.ts', 'c.tsx'].map(p => ({ path: p, status: 'M', kind: 'source', language: 'x', added: 1, deleted: 0 }))
  const args = { slug: 's', base: 'B', head: 'H', files, deleted: ['old.py'], skipped: [{ path: 'lock', reason: 'lockfile' }], specPath: 'spec' }
  const review = p => ({ file: p, summary: 's', findings: [{ type: 'major', file: p, line: 1, summary: 'f', evidence: 'e', confidence: 'high' }], contract: { exports: [], expects: [], callers: [], assumptions: [] } })

  // b.ts fails once then succeeds; integration runs once
  let bFail = 0
  let h = hooks((prompt, opts) => {
    if (opts.agentType === 'branch-review-integration') return { summary: 'i', findings: [], missingChanges: [{ path: 'x', reason: 'y' }] }
    const p = opts.label.split('· ')[1]
    if (p === 'b.ts' && bFail++ === 0) return null
    return review(p)
  })
  let r = await run(args, h)
  check('retry on null file review, nothing blocked', r.blocked.length === 0 && r.fileReviews.length === 3 && r.integration?.missingChanges.length === 1, JSON.stringify(r.blocked))
  check('b.ts reviewed twice, others once', h.calls.filter(c => c.opts.label.endsWith('b.ts')).length === 2 && h.calls.filter(c => c.opts.label.endsWith('a.py')).length === 1)
  const integ = h.calls.find(c => c.opts.agentType === 'branch-review-integration')
  check('integration runs after all file reviews and sees them', h.calls.indexOf(integ) === h.calls.length - 1 && integ.prompt.includes('old.py') && integ.prompt.includes('"file": "c.tsx"'))

  // b.ts fails twice: blocked, integration never launched
  h = hooks((prompt, opts) => opts.label.endsWith('b.ts') ? null : (opts.agentType === 'branch-review-integration' ? { summary: '', findings: [], missingChanges: [] } : review(opts.label.split('· ')[1])))
  r = await run(args, h)
  check('file blocked after retry: blocked=[b.ts], integration null', r.blocked.join() === 'b.ts' && r.integration === null && r.fileReviews.length === 2)
  check('integration not launched when blocked', !h.calls.some(c => c.opts.agentType === 'branch-review-integration'))

  // integration fails twice: blocked marker, not published
  h = hooks((prompt, opts) => opts.agentType === 'branch-review-integration' ? null : review(opts.label.split('· ')[1]))
  r = await run(args, h)
  check('integration failed twice: blocked=["(integration review)"]', r.blocked.join() === '(integration review)' && h.calls.filter(c => c.opts.agentType === 'branch-review-integration').length === 2)
}

console.log('branch-review-verify.js')
{
  const run = await load('branch-review-verify')
  const mk = (id, type) => ({ id, type, file: 'f', line: 1, summary: id })
  const findings = [mk('F001', 'major'), mk('F002', 'security'), mk('F003', 'integration'),
    ...[4, 5, 6, 7, 8, 9, 10].map(n => mk(`F0${String(n).padStart(2, '0')}`, 'minor')), mk('F011', 'test-gap'), mk('F012', 'weird')]
  const args = { slug: 's', base: 'B', head: 'H', findings, batchSize: 5 }
  const h = hooks((prompt, opts) => {
    const blind = prompt.startsWith('BLIND SECOND OPINION')
    if (opts.agentType === 'verify-finding') {
      const f = JSON.parse(prompt.slice(prompt.indexOf('{')))
      if (f.id === 'F001') return { id: f.id, verdict: 'confirmed', confidence: 'high', reason: 'real' }
      if (f.id === 'F002') return blind ? { id: f.id, verdict: 'confirmed', confidence: 'medium', reason: 'blind says yes', fix: 'escape it' } : { id: f.id, verdict: 'rejected', confidence: 'low', reason: 'first says no' }
      if (f.id === 'F003') return { id: f.id, verdict: 'rejected', confidence: 'high', reason: 'guarded upstream' }
      if (f.id === 'F012') return null
    }
    if (opts.agentType === 'verify-minors') {
      const batch = JSON.parse(prompt.slice(prompt.indexOf('[')))
      return { verdicts: batch.filter(f => f.id !== 'F005').map(f => ({ id: f.id, verdict: 'confirmed', confidence: 'high', reason: 'r' })) } // skips F005
    }
    if (opts.agentType === 'verify-tests') return { verdicts: [{ id: 'F011', verdict: 'rejected', confidence: 'high', reason: 'covered by e2e' }] }
    return null
  })
  const r = await run(args, h)
  const v = Object.fromEntries(r.verdicts.map(x => [x.id, x]))
  check('all 12 findings have a verdict', r.verdicts.length === 12 && r.missing.length === 0, `${r.verdicts.length} ${r.missing}`)
  check('F001 confirmed, no second opinion', v.F001.verdict === 'confirmed' && !h.calls.some(c => c.opts.label === 'blind second opinion · F001'))
  const blind = h.calls.find(c => c.opts.label === 'blind second opinion · F002')
  check('F002 rejected then blind-confirmed: disputed, blind ran at xhigh', v.F002.verdict === 'disputed' && v.F002.secondOpinion === 'blind says yes' && blind?.opts.effort === 'xhigh' && blind.prompt.startsWith('BLIND'))
  check('F003 rejected twice: rejected with second opinion noted', v.F003.verdict === 'rejected' && v.F003.secondOpinion === 'guarded upstream' && h.calls.some(c => c.opts.label === 'blind second opinion · F003'))
  check('7 minors in batches of 5 -> 2 verify-minors agents', h.calls.filter(c => c.opts.agentType === 'verify-minors').length === 2)
  check('minor skipped by its batch -> unverified', v.F005.verdict === 'unverified' && v.F004.verdict === 'confirmed')
  check('test-gap routed to verify-tests', v.F011.verdict === 'rejected' && h.calls.filter(c => c.opts.agentType === 'verify-tests').length === 1)
  check('unknown type treated as serious; null verifier -> unverified', v.F012.verdict === 'unverified' && h.logs.some(l => l.includes('Unknown finding types')))
  check('verify-finding agents are all agentType verify-finding', h.calls.filter(c => c.opts.label.startsWith('verify-finding')).every(c => c.opts.agentType === 'verify-finding'))
}

console.log('branch-review-repair.js')
{
  const run = await load('branch-review-repair')
  const findings = [
    { id: 'F010', type: 'minor', file: 'a.py' },
    { id: 'F001', type: 'security', file: 'b.ts', relatedFiles: ['c.ts'] },
    { id: 'F002', type: 'major', file: 'a.py' },
    { id: 'F003', type: 'test-gap', file: 'c.ts', relatedFiles: ['b.ts'] },
  ]
  const args = { slug: 's', branch: 'feature/s', head: 'H', findings, reviewPath: 'rv' }

  // all groups succeed
  let h = hooks((prompt, opts) => { const g = JSON.parse(prompt.slice(prompt.indexOf('['), prompt.lastIndexOf(']') + 1)); return { group: 'x', status: 'done', results: g.map(f => ({ id: f.id, status: 'fixed', commit: 'c' })) } })
  let r = await run(args, h)
  check('grouped by file set: 2 groups', r.groups.length === 2, JSON.stringify(r.groups))
  check('security group first, findings ordered by severity inside', r.groups[0].files.join() === 'b.ts,c.ts' && r.groups[0].findings.join() === 'F001,F003' && r.groups[1].findings.join() === 'F002,F010', JSON.stringify(r.groups))
  check('sequential: 2 agents, all done', h.calls.length === 2 && r.stopped === null && r.remaining.length === 0)
  check('prompt tells the agent to locate by content and names the review file', h.calls[0].prompt.includes('locate code by content') && h.calls[0].prompt.includes('rv'))

  // first group reports a dirty worktree: stop, nothing else launched
  h = hooks(() => ({ group: 'x', status: 'dirty-worktree', reason: 'M foo.py', results: [] }))
  r = await run(args, h)
  check('dirty worktree stops the run after one agent', h.calls.length === 1 && r.stopped?.group === 'group-1' && r.stopped.reason === 'M foo.py' && r.remaining.length === 2, JSON.stringify(r.stopped))
  r = await run({ ...args, findings: [] }, hooks(() => null))
  check('no findings: no agents', r.groups.length === 0 && r.stopped === null)
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed')
process.exit(failures ? 1 : 0)
