export const meta = {
  name: 'branch-review-verify-workflow',
  description: 'Skeptical verdict on every open review finding, routed by type: one verifier per serious finding, batches of five for minors and test gaps, and a blind second opinion at xhigh when a serious finding is rejected',
  whenToUse: 'Launched by the /branch-review-verify skill with the open findings from review.json.',
  phases: [
    { title: 'Verify', detail: 'parallel lanes: verify-finding per major, verify-minors and verify-tests in batches, blind second opinion on rejected majors' },
  ],
}

// args: { slug, base, head, findings: [...open findings...], reviewPath?, specPath?, repoCardPath?, batchSize }
const { slug, base, head, findings = [], reviewPath, specPath, repoCardPath, batchSize = 5 } = args || {}

if (!Array.isArray(findings)) throw new Error('branch-review-verify: args.findings must be an array')
if (findings.length === 0) {
  log('No open findings')
  return { slug, verdicts: [] }
}

const SERIOUS = ['major', 'security', 'integration']
const majors = findings.filter(f => SERIOUS.includes(f.type))
const minors = findings.filter(f => f.type === 'minor')
const testGaps = findings.filter(f => f.type === 'test-gap')
const unknown = findings.filter(f => !SERIOUS.includes(f.type) && f.type !== 'minor' && f.type !== 'test-gap')
if (unknown.length) {
  log(`Unknown finding types treated as serious: ${unknown.map(f => `${f.id}:${f.type}`).join(', ')}`)
  majors.push(...unknown)
}

const VERDICT = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    verdict: { type: 'string', enum: ['confirmed', 'rejected'] },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    reason: { type: 'string' },
    reproduction: { type: 'string' },
    fix: { type: 'string' },
    revisedType: { type: 'string' },
    existingCoverage: { type: 'array', items: { type: 'string' } },
  },
  required: ['id', 'verdict', 'confidence', 'reason'],
}

const BATCH = {
  type: 'object',
  properties: { verdicts: { type: 'array', items: VERDICT } },
  required: ['verdicts'],
}

const context = [
  `Base: ${base}`,
  `Head: ${head}`,
  reviewPath ? `Review file (read-only for you): ${reviewPath}` : null,
  specPath ? `Spec: ${specPath}` : 'Spec: none',
  repoCardPath ? `Repo card: ${repoCardPath}` : null,
].filter(Boolean).join('\n')

function chunk(arr, n) {
  const out = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

function singlePrompt(f, blind) {
  return [
    blind
      ? `BLIND SECOND OPINION. Another verifier rejected this ${f.type} finding. You are not shown their reasoning. Judge from scratch; a wrong rejection here ships a real bug.`
      : `Verify this ${f.type} finding. Try to refute it. Confirm only with a reproduction or a trace you can write down.`,
    context,
    'Finding (JSON):',
    JSON.stringify(f, null, 2),
  ].join('\n')
}

function batchPrompt(kind, batch) {
  return [
    `Verify this batch of ${batch.length} ${kind} finding(s). Every finding needs a verdict.`,
    context,
    'Findings (JSON):',
    JSON.stringify(batch, null, 2),
  ].join('\n')
}

phase('Verify')
log(`${majors.length} serious finding(s) one at a time, ${minors.length} minor(s) in batches of ${batchSize}, ${testGaps.length} test gap(s) in batches of ${batchSize}`)

// Lane 1: serious findings. Each is its own chain: verify, then a blind second opinion if rejected.
// pipeline() rather than parallel(): a rejected finding moves to its second opinion without waiting for the others.
const seriousLane = pipeline(
  majors,
  f => agent(singlePrompt(f, false), {
    agentType: 'verify-finding',
    label: `verify-finding · ${f.id}`,
    phase: 'Verify',
    schema: VERDICT,
  }),
  async (v, f) => {
    if (!v) return { id: f.id, verdict: 'unverified', confidence: 'low', reason: 'verifier returned nothing' }
    if (v.verdict !== 'rejected') return { ...v, id: f.id }

    log(`${f.id} (${f.type}) rejected by the first verifier; asking for a blind second opinion at xhigh`)
    const second = await agent(singlePrompt(f, true), {
      agentType: 'verify-finding',
      label: `blind second opinion · ${f.id}`,
      phase: 'Verify',
      effort: 'xhigh',
      schema: VERDICT,
    })
    if (!second) return { ...v, id: f.id, secondOpinion: 'second opinion returned nothing' }
    if (second.verdict === 'rejected') return { ...v, id: f.id, secondOpinion: second.reason }

    log(`${f.id}: the verifiers disagree, marking it disputed`)
    return {
      id: f.id,
      verdict: 'disputed',
      confidence: second.confidence,
      reason: `First verifier rejected: ${v.reason}`,
      secondOpinion: second.reason,
      reproduction: second.reproduction || '',
      fix: second.fix || '',
      revisedType: second.revisedType || '',
    }
  },
)

// Lanes 2 and 3: batches of five. A batch that comes back short gets 'unverified' for the missing ids rather than silently dropping them.
function batchLane(kind, items, agentType) {
  const batches = chunk(items, batchSize)
  return parallel(batches.map((batch, i) => () =>
    agent(batchPrompt(kind, batch), {
      agentType,
      label: `${agentType} · batch ${i + 1}/${batches.length}`,
      phase: 'Verify',
      schema: BATCH,
    })
      .catch(() => null)
      .then(r => {
        const got = r && Array.isArray(r.verdicts) ? r.verdicts : []
        const byId = new Map(got.map(v => [v.id, v]))
        return batch.map(f => byId.get(f.id) || {
          id: f.id,
          verdict: 'unverified',
          confidence: 'low',
          reason: r ? 'batch verifier skipped this finding' : 'batch verifier returned nothing',
        })
      }),
  ))
}

const [serious, minorBatches, testBatches] = await Promise.all([
  seriousLane,
  batchLane('minor', minors, 'verify-minors'),
  batchLane('test-gap', testGaps, 'verify-tests'),
])

const verdicts = [
  ...serious.filter(Boolean),
  ...minorBatches.filter(Boolean).flat(),
  ...testBatches.filter(Boolean).flat(),
]

const count = k => verdicts.filter(v => v.verdict === k).length
log(`Verdicts: ${count('confirmed')} confirmed, ${count('rejected')} rejected, ${count('disputed')} disputed, ${count('unverified')} unverified`)
const missing = findings.filter(f => !verdicts.some(v => v.id === f.id)).map(f => f.id)
if (missing.length) log(`No verdict came back for: ${missing.join(', ')}. Treat them as unverified.`)

return { slug, verdicts, missing }
