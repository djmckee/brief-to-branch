export const meta = {
  name: 'branch-review-workflow',
  description: 'Review every changed file in parallel with a clean context each, then one integration pass that checks the contracts between files',
  whenToUse: 'Launched by the /branch-review skill with the classified file list. Not for ad hoc reviews.',
  phases: [
    { title: 'File review', detail: 'one branch-review-file agent per changed file, parallel, retried once' },
    { title: 'Integration review', detail: 'waits for every file review, then one agent over all of them' },
  ],
}

// args: { slug, base, head, files: [{path,status,kind,language,added,deleted}], deleted: [], skipped: [{path,reason}], specPath?, ticketsPath?, repoCardPath? }
const { slug, base, head, files = [], deleted = [], skipped = [], specPath, ticketsPath, repoCardPath } = args || {}

if (!base || !head || !Array.isArray(files)) {
  throw new Error('branch-review: args must include base, head and a files array')
}
if (files.length === 0) {
  log('No reviewable files')
  return { slug, base, head, fileReviews: [], integration: null, blocked: [] }
}

const FINDING = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['major', 'security', 'minor', 'test-gap', 'integration'] },
    file: { type: 'string' },
    line: { type: 'integer' },
    endLine: { type: 'integer' },
    category: { type: 'string' },
    summary: { type: 'string' },
    detail: { type: 'string' },
    evidence: { type: 'string' },
    suggestedFix: { type: 'string' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    relatedFiles: { type: 'array', items: { type: 'string' } },
    supersedes: { type: 'array', items: { type: 'string' } },
  },
  required: ['type', 'file', 'summary', 'evidence', 'confidence'],
}

const FILE_REVIEW = {
  type: 'object',
  properties: {
    file: { type: 'string' },
    summary: { type: 'string' },
    findings: { type: 'array', items: FINDING },
    contract: {
      type: 'object',
      properties: {
        exports: { type: 'array', items: { type: 'string' } },
        expects: { type: 'array', items: { type: 'string' } },
        callers: { type: 'array', items: { type: 'string' } },
        assumptions: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  required: ['file', 'summary', 'findings', 'contract'],
}

const INTEGRATION = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    findings: { type: 'array', items: FINDING },
    missingChanges: {
      type: 'array',
      items: {
        type: 'object',
        properties: { path: { type: 'string' }, reason: { type: 'string' } },
        required: ['path', 'reason'],
      },
    },
  },
  required: ['summary', 'findings', 'missingChanges'],
}

const context = [
  specPath ? `Spec: ${specPath}` : 'Spec: none (ad hoc branch)',
  ticketsPath ? `Tickets: ${ticketsPath}` : null,
  repoCardPath ? `Repo card: ${repoCardPath}` : null,
].filter(Boolean).join('\n')

function filePrompt(f, attempt) {
  return [
    `Review the changes to one file on branch "${slug}".`,
    `File: ${f.path}  status: ${f.status}  kind: ${f.kind}  language: ${f.language || 'unknown'}  +${f.added == null ? '?' : f.added}/-${f.deleted == null ? '?' : f.deleted}`,
    `Base: ${base}`,
    `Head: ${head}`,
    context,
    attempt > 1 ? `This is attempt ${attempt}; the previous one returned nothing. Keep it focused and return structured output.` : '',
    'Return findings with line-level evidence, and the contract summary for the integration reviewer.',
  ].filter(Boolean).join('\n')
}

async function reviewFile(f) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const r = await agent(filePrompt(f, attempt), {
      agentType: 'branch-review-file',
      label: `branch-review-file · ${f.path}`,
      phase: 'File review',
      schema: FILE_REVIEW,
    })
    if (r) return { ...r, file: f.path }
    log(`No result for ${f.path} on attempt ${attempt}`)
  }
  return null
}

phase('File review')
log(`Reviewing ${files.length} file(s) in parallel; ${skipped.length} skipped by the caller`)

// Barrier on purpose: the integration pass needs every file review before it can start.
const reviews = await parallel(files.map(f => () => reviewFile(f)))

const blocked = files.filter((f, i) => !reviews[i]).map(f => f.path)
if (blocked.length) {
  log(`Blocked: ${blocked.length} file(s) returned nothing after a retry: ${blocked.join(', ')}. Not publishing a partial review.`)
  return { slug, base, head, fileReviews: reviews.filter(Boolean), integration: null, blocked }
}

const totalFindings = reviews.reduce((n, r) => n + (r.findings ? r.findings.length : 0), 0)
log(`File review done: ${totalFindings} finding(s) across ${reviews.length} file(s)`)

phase('Integration review')
const integrationPrompt = [
  `Integration review of branch "${slug}". Base ${base}, head ${head}.`,
  context,
  `Reviewed files: ${files.map(f => `${f.path} (${f.status}, ${f.kind})`).join(', ')}`,
  deleted.length ? `Deleted files: ${deleted.join(', ')}` : 'Deleted files: none',
  skipped.length ? `Skipped by the caller: ${skipped.map(s => `${s.path} (${s.reason})`).join(', ')}` : '',
  'File reviews (summary, findings, contract), as JSON:',
  JSON.stringify(reviews, null, 1),
  'Check the contracts between files. Do not repeat file-level findings; everything you return should need two or more files to explain.',
].filter(Boolean).join('\n')

let integration = null
for (let attempt = 1; attempt <= 2 && !integration; attempt++) {
  integration = await agent(integrationPrompt, {
    agentType: 'branch-review-integration',
    label: 'branch-review-integration',
    phase: 'Integration review',
    schema: INTEGRATION,
  })
  if (!integration) log(`Integration reviewer returned nothing on attempt ${attempt}`)
}

if (!integration) {
  log('Blocked: the integration review failed twice. Not publishing a partial review.')
  return { slug, base, head, fileReviews: reviews, integration: null, blocked: ['(integration review)'] }
}

log(`Integration review done: ${integration.findings.length} finding(s), ${integration.missingChanges.length} missing change(s)`)
return { slug, base, head, fileReviews: reviews, integration, blocked: [] }
