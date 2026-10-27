export const meta = {
  name: 'implement-workflow',
  description: 'Implement each pending ticket in order: one implement-ticket agent per ticket, one tested commit each, stop at the first ticket that stays blocked',
  whenToUse: 'Launched by the /implement skill once tickets.json exists and feature/<slug> is checked out. Not for ad hoc tasks.',
  phases: [
    { title: 'Implement', detail: 'sequential, one agent per ticket, retry once at xhigh effort on blocked, stop on a second block' },
  ],
}

// args: { slug, branch, repoCardPath, specPath, statePath, tickets: [...full ticket objects...], maxAttempts }
const { slug, branch, repoCardPath, specPath, statePath, tickets = [], maxAttempts = 2 } = args || {}

if (!slug || !branch || !Array.isArray(tickets)) {
  throw new Error('implement: args must include slug, branch and a tickets array')
}
if (tickets.length === 0) {
  log('No pending tickets, nothing to do')
  return { slug, branch, done: [], blocked: null, remaining: [] }
}

const RESULT = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    status: { type: 'string', enum: ['done', 'blocked'] },
    commit: { type: 'string', description: 'short sha of the one commit made; empty if blocked' },
    summary: { type: 'string' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    testsRun: { type: 'array', items: { type: 'string' } },
    blockedReason: { type: 'string' },
  },
  required: ['id', 'status', 'summary'],
}

function ticketPrompt(t, attempt, previousBlocker) {
  const lines = [
    `Implement ticket ${t.id} of feature "${slug}" on branch ${branch}.`,
    `Repo card: ${repoCardPath}`,
    `Spec: ${specPath}`,
    `State file to update when you finish: ${statePath}`,
    'Ticket (JSON):',
    JSON.stringify(t, null, 2),
    'Finish with exactly one commit, or leave the branch exactly as you found it and report blocked.',
  ]
  if (previousBlocker) {
    lines.push(
      '',
      `This is attempt ${attempt}. The previous attempt was blocked:`,
      previousBlocker,
      `Check git stash list for a stash named "blocked ${slug} ${t.id}" before deciding whether to reuse or drop that work.`,
      'Do not repeat the same approach without a reason.',
    )
  }
  return lines.join('\n')
}

phase('Implement')
const done = []
let blocked = null

for (let i = 0; i < tickets.length; i++) {
  const t = tickets[i]
  let result = null
  let lastReason = null

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    log(`Ticket ${t.id} "${t.title}" (${i + 1}/${tickets.length}), attempt ${attempt}${attempt > 1 ? ' at xhigh effort' : ''}`)
    // The first attempt ran at the agent's pinned effort and was blocked; the retry gets more thinking.
    result = await agent(ticketPrompt(t, attempt, lastReason), {
      agentType: 'implement-ticket',
      label: `implement-ticket · ${t.id}`,
      phase: 'Implement',
      ...(attempt > 1 ? { effort: 'xhigh' } : {}),
      schema: RESULT,
    })
    if (result && result.status === 'done') break
    lastReason = result ? (result.blockedReason || 'blocked without a reason') : 'agent returned no result'
    log(`Ticket ${t.id} blocked on attempt ${attempt}: ${lastReason}`)
  }

  if (result && result.status === 'done') {
    done.push(result)
    log(`Ticket ${t.id} done in ${result.commit || '(no sha reported)'}`)
    continue
  }

  blocked = { id: t.id, title: t.title, reason: lastReason, attempts: maxAttempts }
  log(`Stopping: ticket ${t.id} still blocked after ${maxAttempts} attempts. Later tickets may depend on it.`)
  break
}

const remaining = tickets.slice(done.length + (blocked ? 1 : 0)).map(t => t.id)
if (remaining.length) log(`Not attempted: ${remaining.join(', ')}`)

return { slug, branch, done, blocked, remaining }
