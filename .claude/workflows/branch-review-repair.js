export const meta = {
  name: 'branch-review-repair-workflow',
  description: 'Fix confirmed review findings one file group at a time, one tested commit per finding, stopping if the worktree is not clean',
  whenToUse: 'Launched by the /branch-review-verify skill after verdicts are recorded. Needs a clean worktree.',
  phases: [
    { title: 'Repair', detail: 'sequential, one branch-review-repair agent per file group, one commit per finding' },
  ],
}

// args: { slug, branch, head, findings: [...confirmed findings with verdicts...], reviewPath?, specPath?, repoCardPath? }
const { slug, branch, head, findings = [], reviewPath, specPath, repoCardPath } = args || {}

if (!branch || !Array.isArray(findings)) throw new Error('branch-review-repair: args must include branch and a findings array')
if (findings.length === 0) {
  log('No confirmed findings to repair')
  return { slug, branch, groups: [], results: [], stopped: null, remaining: [] }
}

// Group by the set of files a finding touches, so no two agents ever edit the same file.
// Groups run in sequence anyway; grouping keeps related fixes together and gives each agent the full picture of a file.
const TYPE_ORDER = { security: 0, major: 1, integration: 2, minor: 3, 'test-gap': 4 }
const rank = t => (t in TYPE_ORDER ? TYPE_ORDER[t] : 9)

const byKey = new Map()
for (const f of findings) {
  const touched = [f.file, ...(f.relatedFiles || [])].filter(Boolean)
  const key = [...new Set(touched)].sort().join('|')
  if (!byKey.has(key)) byKey.set(key, { files: key.split('|'), findings: [] })
  byKey.get(key).findings.push(f)
}

const groups = [...byKey.values()]
for (const g of groups) g.findings.sort((a, b) => rank(a.type) - rank(b.type))
groups.sort((a, b) => rank(a.findings[0].type) - rank(b.findings[0].type))
groups.forEach((g, i) => { g.id = `group-${i + 1}` })

const REPAIR = {
  type: 'object',
  properties: {
    group: { type: 'string' },
    status: { type: 'string', enum: ['done', 'dirty-worktree', 'aborted'] },
    reason: { type: 'string' },
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          status: { type: 'string', enum: ['fixed', 'skipped'] },
          commit: { type: 'string' },
          files: { type: 'array', items: { type: 'string' } },
          test: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['id', 'status'],
      },
    },
  },
  required: ['group', 'status', 'results'],
}

function repairPrompt(g, i) {
  return [
    `Repair ${g.findings.length} confirmed finding(s) in ${g.id} (${i + 1}/${groups.length}) on branch ${branch} of feature "${slug}".`,
    `Files in this group: ${g.files.join(', ')}`,
    `Review head when the findings were written: ${head}. Lines may have moved since; locate code by content.`,
    reviewPath ? `Review file to update: ${reviewPath}` : null,
    specPath ? `Spec: ${specPath}` : 'Spec: none',
    repoCardPath ? `Repo card: ${repoCardPath}` : null,
    'Findings with verdicts (JSON):',
    JSON.stringify(g.findings, null, 2),
    'One tested commit per finding. Check the worktree is clean before you start, and leave it clean.',
  ].filter(Boolean).join('\n')
}

phase('Repair')
log(`${findings.length} finding(s) in ${groups.length} file group(s), running one group at a time`)

const results = []
let stopped = null

for (let i = 0; i < groups.length; i++) {
  const g = groups[i]
  log(`${g.id}: ${g.files.join(', ')} (${g.findings.length} finding(s))`)
  const r = await agent(repairPrompt(g, i), {
    agentType: 'branch-review-repair',
    label: `branch-review-repair · ${g.id}`,
    phase: 'Repair',
    schema: REPAIR,
  })

  if (!r) {
    stopped = { group: g.id, reason: 'agent returned nothing; worktree state unknown, check git status before rerunning' }
    break
  }
  results.push({ ...r, group: g.id })
  if (r.status !== 'done') {
    stopped = { group: g.id, reason: r.reason || r.status }
    break
  }
  const fixed = r.results.filter(x => x.status === 'fixed').length
  log(`${g.id}: ${fixed} fixed, ${r.results.length - fixed} skipped`)
}

const doneIds = new Set(results.filter(r => r.status === 'done').map(r => r.group))
const summarise = g => ({ id: g.id, files: g.files, findings: g.findings.map(f => f.id) })
const remaining = groups.filter(g => !doneIds.has(g.id)).map(summarise)

if (stopped) log(`Stopped at ${stopped.group}: ${stopped.reason}. ${remaining.length} group(s) not repaired.`)
else log('All groups repaired')

return { slug, branch, groups: groups.map(summarise), results, stopped, remaining }
