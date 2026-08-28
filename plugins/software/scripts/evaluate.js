'use strict'

const path = require('path')

const {
  isRecord,
  text,
  fingerprint,
  day,
  timestamp,
  rangeProblem,
  validateEvidence,
  evidenceIndex
} = require('./decision-evidence')
const { pageIdentity } = require('./vendor/page-id')
const { IDENTITY_PROPERTIES } = require('./vendor/software-schema')
const { TYPES: PROCESS_ARTIFACT_TYPES } = require('./vendor/process-schema')

const NOTION_RELATION_CAP = 100

const STAGES = ['research', 'demo', 'POC planned', 'POC running', 'POC incomplete', 'POC complete', 'final decision']
const TARGETS = ['net-new', 'existing', 'replacement']
const DIRECTORY_STATES = ['net-new', 'existing']
const RECOMMENDATIONS = [
  'Stop',
  'Defer',
  'Continue research',
  'Run POC',
  'Complete POC',
  'Buy candidate',
  'Buy named alternative',
  'Build',
  'Insufficient evidence'
]
const TERMINAL = ['Buy candidate', 'Buy named alternative', 'Build']
const COMMON_WORD_NAMES = new Set(['default', 'clay', 'linear', 'lavender', 'notion', 'ramp'])
const SOURCE_BOUNDARIES = [
  'software-directory', 'signed-terms', 'box', 'google-drive', 'docusign', 'ramp',
  'quickbooks', 'gmail', 'slack', 'google-calendar', 'granola', 'gong',
  'vendor-web', 'independent-web', 'user-export', 'user-statement',
  'product-telemetry', 'technical-spike'
]
const DATED_SOURCES = new Set([
  'box', 'google-drive', 'docusign', 'ramp', 'quickbooks',
  'gmail', 'slack', 'google-calendar', 'granola', 'gong', 'vendor-web',
  'independent-web', 'user-export', 'product-telemetry', 'technical-spike'
])
const SIGNED_TERM_PROVIDERS = ['box', 'google-drive', 'docusign', 'user-export']
const DECISION_METRICS = ['cost', 'fit', 'risk', 'implementation', 'exit']
const BUILD_OPTION_NAME = 'Internal build'
const REPORT_SECTIONS = [
  'Recommendation and confidence',
  'Problem and use cases',
  'What the evidence proved',
  'Current stack and overlap',
  'Alternatives',
  'Cost and total ownership picture',
  'Implementation, migration, security, and governance',
  'Decision roles and required approvals',
  'Conditions for the next gate',
  'Data gaps',
  'Coverage and sources'
]
const SECTION_CRITERIA = {
  'Recommendation and confidence': criterion => ['business-need', 'hard-stop', 'deferral', 'accountable-choice'].includes(criterion),
  'Problem and use cases': criterion => ['business-need', 'context', 'success-criterion'].includes(criterion),
  'What the evidence proved': criterion => !['data-gap', 'coverage'].includes(criterion),
  'Current stack and overlap': criterion => criterion === 'overlap',
  Alternatives: criterion => ['alternative', 'overlap', 'price', 'terms', 'technical-spike'].includes(criterion) || criterion.startsWith('decision-metric:'),
  'Cost and total ownership picture': criterion => ['price', 'terms', 'build-cost', 'decision-metric:cost'].includes(criterion),
  'Implementation, migration, security, and governance': criterion => ['implementation', 'migration', 'security', 'technical-spike', 'operating-behavior', 'technical-owner', 'maintainability'].includes(criterion),
  'Decision roles and required approvals': criterion => ['accountable-choice', 'technical-owner', 'implementation'].includes(criterion),
  'Conditions for the next gate': criterion => ['success-criterion', 'hard-stop', 'deferral', 'blocker-resolution', 'technical-spike'].includes(criterion),
  'Data gaps': criterion => criterion === 'data-gap',
  'Coverage and sources': criterion => criterion === 'coverage'
}

function sectionCriterionAllowed (name, criterion) {
  if (criterion === 'data-gap') return name !== 'Coverage and sources'
  return Boolean(SECTION_CRITERIA[name] && SECTION_CRITERIA[name](criterion))
}

function listOfText (value) {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : []
}

function sameSet (left, right) {
  if (left.length !== right.length) return false
  const a = [...left].sort()
  const b = [...right].sort()
  return a.every((value, index) => value === b[index])
}

function daysBetween (from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000)
}

function hostname (value) {
  const candidate = text(value).toLowerCase()
  if (!candidate || candidate.length > 253 || !candidate.includes('.') || candidate.includes('..') || !/^[a-z0-9.-]+$/.test(candidate)) return null
  const labels = candidate.split('.')
  if (labels.some(label => !label || label.length > 63 || label.startsWith('-') || label.endsWith('-'))) return null
  if (!/[a-z]/.test(labels[labels.length - 1]) || labels[labels.length - 1].length < 2) return null
  return candidate
}

function canonicalScopeId (scope) {
  if (!isRecord(scope)) return null
  const stable = {
    contract: scope.contract,
    asOf: scope.asOf,
    candidate: scope.candidate,
    stage: scope.stage,
    problem: scope.problem,
    useCases: scope.useCases,
    successCriteria: scope.successCriteria,
    knownBlockers: scope.knownBlockers,
    priorities: scope.priorities,
    currentWorkflow: scope.currentWorkflow,
    requiredDecisionDate: scope.requiredDecisionDate,
    sourceBoundaries: scope.sourceBoundaries,
    artifactMaxAgeDays: scope.artifactMaxAgeDays
  }
  return fingerprint(stable, 'scope')
}

function acceptedScopeProblem (scope) {
  if (!isRecord(scope) || scope.ok !== true || !scope.scopeId) return 'The accepted scope is missing.'
  if (canonicalScopeId(scope) !== scope.scopeId) return 'The accepted scope changed after evaluate-scope; regenerate every downstream artifact from the new scope.'
  return null
}

function relatedReadFingerprint (plan, name, pages) {
  const expected = isRecord(plan) && Array.isArray(plan.executions)
    ? plan.executions.find(one => one.name === name)
    : null
  const normalizedPages = pages === undefined ? [] : pages
  if (!expected || !Array.isArray(normalizedPages)) return null
  return fingerprint({
    scopeId: plan.scopeId,
    surveyRunId: plan.surveyRunId,
    execution: name,
    queryFingerprint: expected.queryFingerprint,
    pages: normalizedPages
  }, 'related-read')
}

function surveyExecutionFingerprint (artifact) {
  if (!isRecord(artifact) || !Array.isArray(artifact.envelopes)) return null
  return fingerprint({
    surveyRunId: artifact.surveyRunId,
    execution: artifact.execution,
    query: artifact.query,
    queryFingerprint: artifact.queryFingerprint,
    envelopes: artifact.envelopes
  }, 'survey-execution')
}

function canonicalSurveySequenceId (sequence) {
  if (!isRecord(sequence) || sequence.contract !== 'software-survey-sequence/v1') return null
  return fingerprint({
    contract: sequence.contract,
    scopeId: sequence.scopeId,
    surveyRunId: sequence.surveyRunId,
    executions: sequence.executions
  }, 'survey-sequence')
}

function surveySequenceAttestation (scope, plan, before, detailed, after) {
  const preceding = isRecord(after) && Array.isArray(after.precedingExecutions) ? after.precedingExecutions : []
  const related = name => {
    const matches = preceding.filter(one => isRecord(one) && one.execution === name)
    return matches.length === 1 ? matches[0].artifactFingerprint : null
  }
  const executions = [
    { order: 1, name: 'manifest-before', artifactFingerprint: surveyExecutionFingerprint(before) },
    { order: 2, name: 'software-details', artifactFingerprint: surveyExecutionFingerprint(detailed) },
    { order: 3, name: 'affected-software-bodies', artifactFingerprint: related('affected-software-bodies') },
    { order: 4, name: 'related-process-pages', artifactFingerprint: related('related-process-pages') },
    { order: 5, name: 'manifest-after', artifactFingerprint: surveyExecutionFingerprint(after) }
  ]
  const stable = {
    contract: 'software-survey-sequence/v1',
    scopeId: scope && scope.scopeId,
    surveyRunId: plan && plan.surveyRunId,
    executions
  }
  return { ...stable, sequenceId: canonicalSurveySequenceId(stable) }
}

function surveySequenceProblem (sequence, scope, plan, before, detailed, after) {
  if (!isRecord(sequence) || sequence.contract !== 'software-survey-sequence/v1') return 'Directory proof requires the hook-owned five-phase survey sequence attestation.'
  if (sequence.scopeId !== scope.scopeId || sequence.surveyRunId !== plan.surveyRunId) return 'The survey sequence is bound to a different scope or survey run.'
  if (canonicalSurveySequenceId(sequence) !== sequence.sequenceId) return 'The survey sequence changed after its hook-owned attestation.'
  const expected = surveySequenceAttestation(scope, plan, before, detailed, after)
  if (fingerprint(sequence.executions) !== fingerprint(expected.executions)) return 'The saved survey artifacts do not match the five executions captured by the read-scope hook.'
  return null
}

function canonicalDirectoryProofId (proof) {
  if (!isRecord(proof) || proof.contract !== 'software-directory-proof/v1') return null
  const stable = {
    contract: proof.contract,
    scopeId: proof.scopeId,
    surveyRunId: proof.surveyRunId,
    softwareDataSourceId: proof.softwareDataSourceId,
    softwareDataSourceUrl: proof.softwareDataSourceUrl,
    queryFingerprints: proof.queryFingerprints,
    expectedColumns: proof.expectedColumns,
    count: proof.count,
    identities: proof.identities,
    revisions: proof.revisions,
    surveySequenceId: proof.surveySequenceId,
    relatedReadFingerprints: proof.relatedReadFingerprints,
    rows: proof.rows,
    limitation: proof.limitation
  }
  return fingerprint(stable, 'directory-proof')
}

function canonicalDependenciesId (deps) {
  if (!isRecord(deps) || deps.contract !== 'software-dependencies/v1') return null
  const stable = {
    contract: deps.contract,
    scopeId: deps.scopeId,
    directoryProofId: deps.directoryProofId,
    surveyRunId: deps.surveyRunId,
    candidate: deps.candidate,
    replacementTarget: deps.replacementTarget,
    affectedRows: deps.affectedRows,
    outbound: deps.outbound,
    reverseOnly: deps.reverseOnly,
    softwareBodies: deps.softwareBodies,
    expectedArtifactUrls: deps.expectedArtifactUrls,
    artifactPages: deps.artifactPages,
    stale: deps.stale,
    unavailable: deps.unavailable,
    complete: deps.complete
  }
  return fingerprint(stable, 'dependencies')
}

function canonicalAssessmentId (assessment) {
  if (!isRecord(assessment) || assessment.contract !== 'software-evaluation-assessment/v1') return null
  const stable = {
    contract: assessment.contract,
    scopeId: assessment.scopeId,
    dependenciesId: assessment.dependenciesId,
    evidenceId: assessment.evidenceId,
    evaluationContext: assessment.evaluationContext,
    stage: assessment.stage,
    stageCeiling: assessment.stageCeiling,
    recommendation: assessment.recommendation,
    reason: assessment.reason,
    nextStep: assessment.nextStep,
    selectedOption: assessment.selectedOption,
    optionResults: assessment.optionResults,
    requiredEvidenceIds: assessment.requiredEvidenceIds,
    conflicts: assessment.conflicts,
    evidenceIndex: assessment.evidenceIndex,
    coverage: assessment.coverage,
    dataGaps: assessment.dataGaps,
    requiredSections: assessment.requiredSections
  }
  return fingerprint(stable, 'assessment')
}

function evaluateScope (request) {
  const problems = []
  if (!isRecord(request)) return { ok: false, problems: ['The evaluation request is not an object.'] }
  const candidate = text(request.candidate)
  const vendor = text(request.vendor)
  const targetType = request.targetType
  const directoryState = request.candidateDirectoryState || (targetType === 'existing' ? 'existing' : 'net-new')
  const stage = request.stage
  const asOf = day(request.asOf)
  const problem = text(request.problem)
  const useCases = listOfText(request.useCases)
  const successCriteria = listOfText(request.successCriteria)
  const blockers = listOfText(request.knownBlockers)
  const priorities = listOfText(request.priorities)
  const replacementTool = text(request.replacementTool)
  const requiredDecisionDate = request.requiredDecisionDate === undefined ? null : day(request.requiredDecisionDate)
  const searchQualifier = text(request.searchQualifier)

  if (!candidate) problems.push('Name the candidate tool.')
  if (!STAGES.includes(stage)) problems.push(`Stage must be exactly one of: ${STAGES.join(', ')}.`)
  if (!TARGETS.includes(targetType)) problems.push(`targetType must be exactly one of: ${TARGETS.join(', ')}.`)
  if (!DIRECTORY_STATES.includes(directoryState)) problems.push(`candidateDirectoryState must be exactly one of: ${DIRECTORY_STATES.join(', ')}.`)
  if (['net-new', 'existing'].includes(targetType) && directoryState !== targetType) {
    problems.push(`candidateDirectoryState must be ${JSON.stringify(targetType)} when targetType is ${JSON.stringify(targetType)}.`)
  }
  if (!asOf) problems.push('asOf must be a real local calendar day in YYYY-MM-DD form.')
  if (!problem) problems.push('State the problem being evaluated.')
  if (!Array.isArray(request.useCases) || !useCases.length || useCases.length !== request.useCases.length) {
    problems.push('Provide concrete use cases as a non-empty list of text.')
  }
  if (request.successCriteria !== undefined && (!Array.isArray(request.successCriteria) || successCriteria.length !== request.successCriteria.length)) {
    problems.push('successCriteria must be a list of non-empty text when supplied.')
  }
  if (request.knownBlockers !== undefined && (!Array.isArray(request.knownBlockers) || blockers.length !== request.knownBlockers.length)) {
    problems.push('knownBlockers must be a list of non-empty text when supplied.')
  }
  if (request.priorities !== undefined && (!Array.isArray(request.priorities) || priorities.length !== request.priorities.length ||
      priorities.some(one => !DECISION_METRICS.includes(one)) || new Set(priorities).size !== priorities.length)) {
    problems.push(`priorities must be a non-repeating list drawn from: ${DECISION_METRICS.join(', ')}.`)
  }
  if (targetType === 'replacement' && !replacementTool) problems.push('A replacement evaluation must name the tool being replaced.')
  if (replacementTool && candidate && replacementTool.toLowerCase() === candidate.toLowerCase()) {
    problems.push('The candidate and replacement tool are the same name; disambiguate the intended replacement.')
  }
  if (request.requiredDecisionDate !== undefined && !requiredDecisionDate) problems.push('requiredDecisionDate must be a real YYYY-MM-DD day.')
  if ((request.commonWordName === true || COMMON_WORD_NAMES.has(candidate.toLowerCase())) && !searchQualifier) {
    problems.push('This candidate has a common-word name. Add a product category or domain in searchQualifier before searching.')
  }

  if (!isRecord(request.sourceBoundaries)) problems.push('sourceBoundaries must explicitly bound every approved source.')
  const sourceBoundaries = isRecord(request.sourceBoundaries) ? { ...request.sourceBoundaries } : {}
  const suppliedDirectoryBoundary = sourceBoundaries['software-directory']
  if (suppliedDirectoryBoundary !== undefined) {
    if (!isRecord(suppliedDirectoryBoundary)) problems.push('software-directory boundary must be an object.')
    else {
      if (suppliedDirectoryBoundary.dataSource !== undefined && suppliedDirectoryBoundary.dataSource !== 'config-resolved') {
        problems.push('software-directory can only read the config-resolved Software data source.')
      }
      if (Object.keys(suppliedDirectoryBoundary).some(key => key !== 'dataSource')) {
        problems.push('software-directory boundary only accepts the canonical dataSource locator.')
      }
    }
  }
  sourceBoundaries['software-directory'] = { dataSource: 'config-resolved' }
  for (const [source, boundary] of Object.entries(sourceBoundaries)) {
    if (!SOURCE_BOUNDARIES.includes(source)) { problems.push(`Unknown evidence source ${JSON.stringify(source)}.`); continue }
    if (!isRecord(boundary)) { problems.push(`${source} boundary must be an object.`); continue }
    if (source === 'signed-terms') {
      if (!SIGNED_TERM_PROVIDERS.includes(boundary.provider) || Object.keys(boundary).some(key => key !== 'provider')) {
        problems.push(`signed-terms must name exactly one approved provider: ${SIGNED_TERM_PROVIDERS.join(', ')}.`)
      }
      continue
    }
    if (DATED_SOURCES.has(source)) {
      const range = boundary.dateRange || ((boundary.from || boundary.to) ? boundary : null)
      const badRange = rangeProblem(range, source)
      if (badRange) problems.push(badRange)
      else boundary.dateRange = { from: day(range.from), to: day(range.to) }
    }
    if (source === 'gmail' && boundary.mailbox !== 'own') problems.push('Gmail must name the authenticated user\'s own mailbox.')
    if (source === 'slack') {
      if (!Array.isArray(boundary.channels)) problems.push('Slack must name channels, even when the list is empty.')
      if (!Array.isArray(boundary.directMessages)) problems.push('Slack must name direct-message conversations, even when the list is empty.')
      const channels = listOfText(boundary.channels)
      const directMessages = listOfText(boundary.directMessages)
      if ((Array.isArray(boundary.channels) && channels.length !== boundary.channels.length) ||
          (Array.isArray(boundary.directMessages) && directMessages.length !== boundary.directMessages.length)) {
        problems.push('Slack channel and direct-message locators must be non-empty names.')
      }
      if (!channels.length && !directMessages.length) problems.push('Slack must name at least one specific channel or direct-message conversation.')
      if (channels.some(channel => directMessages.includes(channel))) problems.push('A Slack locator cannot be approved as both a channel and a direct-message conversation.')
      if (directMessages.some(one => /^(?:\*|all(?:\s+(?:my\s+)?(?:dms?|direct\s+messages?))?)$/i.test(one)) || boundary.allDirectMessages === true) {
        problems.push('Slack cannot read all direct messages.')
      }
      if (Array.isArray(boundary.channels)) boundary.channels = channels
      if (Array.isArray(boundary.directMessages)) boundary.directMessages = directMessages
    }
    if (['box', 'google-drive'].includes(source) && !text(boundary.folder)) problems.push(`${source} must name a folder.`)
    if (['ramp', 'quickbooks', 'docusign'].includes(source) && !text(boundary.account)) problems.push(`${source} must name an account.`)
    if (['google-calendar', 'granola'].includes(source)) {
      const meetings = listOfText(boundary.meetings)
      if (!Array.isArray(boundary.meetings) || !meetings.length || meetings.length !== boundary.meetings.length) problems.push(`${source} must name only non-empty approved meetings.`)
      else boundary.meetings = meetings
    }
    if (source === 'gong') {
      const calls = listOfText(boundary.calls)
      if (!Array.isArray(boundary.calls) || !calls.length || calls.length !== boundary.calls.length) problems.push('gong must name only non-empty approved calls.')
      else boundary.calls = calls
    }
    if (source === 'user-statement') {
      const people = listOfText(boundary.people)
      if (!Array.isArray(boundary.people) || !people.length || people.length !== boundary.people.length) problems.push('user-statement must name only non-empty approved people.')
      else boundary.people = people
    }
    if (['vendor-web', 'independent-web'].includes(source)) {
      const domains = listOfText(boundary.domains).map(hostname).filter(Boolean)
      if (!Array.isArray(boundary.domains) || !domains.length || domains.length !== boundary.domains.length) problems.push(`${source} must name only non-empty approved domains.`)
      else boundary.domains = domains
    }
    if (source === 'user-export') {
      const artifact = text(boundary.artifact)
      if (!artifact || !path.isAbsolute(artifact) || path.resolve(artifact) !== artifact) problems.push('user-export must name the exact absolute artifact path.')
      else boundary.artifact = artifact
    }
  }

  if (isRecord(sourceBoundaries['signed-terms']) && SIGNED_TERM_PROVIDERS.includes(sourceBoundaries['signed-terms'].provider)) {
    const provider = sourceBoundaries['signed-terms'].provider
    const providerBoundary = sourceBoundaries[provider]
    if (!isRecord(providerBoundary)) problems.push(`signed-terms provider ${JSON.stringify(provider)} must also have its own approved source boundary.`)
    else sourceBoundaries['signed-terms'] = { provider, ...providerBoundary }
  }

  if (request.artifactMaxAgeDays !== undefined &&
      (!Number.isInteger(request.artifactMaxAgeDays) || request.artifactMaxAgeDays <= 0)) {
    problems.push('artifactMaxAgeDays must be a positive whole number when supplied.')
  }

  if (problems.length) return { ok: false, problems }
  const stable = {
    contract: 'software-evaluation-scope/v1',
    asOf,
    candidate: { name: candidate, vendor: vendor || null, targetType, directoryState, replacementTool: replacementTool || null, searchQualifier: searchQualifier || candidate },
    stage,
    problem,
    useCases,
    successCriteria,
    knownBlockers: blockers,
    priorities,
    currentWorkflow: text(request.currentWorkflow) || null,
    requiredDecisionDate,
    sourceBoundaries,
    artifactMaxAgeDays: request.artifactMaxAgeDays === undefined ? 365 : request.artifactMaxAgeDays
  }
  return { ok: true, problems: [], ...stable, scopeId: fingerprint(stable, 'scope') }
}

function surveyPlan (request, scope, context) {
  const scopeProblem = acceptedScopeProblem(scope)
  if (scopeProblem) throw new Error(`evaluate-survey requires an unchanged accepted output of evaluate-scope. ${scopeProblem}`)
  if (!isRecord(context) || !context.dataSourceId || typeof context.property !== 'function') throw new Error('evaluate-survey requires the config-resolved Software context.')
  const requestedRun = text(request && request.surveyRunId)
  const surveyRunId = requestedRun || fingerprint({ scopeId: scope.scopeId, nonce: `${Date.now()}:${process.pid}` }, 'survey')
  const logicalColumns = IDENTITY_PROPERTIES.filter(name => name !== 'Created time')
  // Notion SQL exposes date properties only through their three expanded
  // columns. It also does not expose a page last-edited column. Both details
  // were measured against the live connector on 2026-08-27; issuing the more
  // familiar property name or `last_edited_time` returns sql_invalid.
  const dateColumns = new Set(['Contract dates', 'Notice deadline', 'Last reviewed'])
  const columns = { url: 'url' }
  for (const logical of logicalColumns) {
    const physical = context.property(logical)
    columns[logical] = dateColumns.has(logical)
      ? {
          start: `date:${physical}:start`,
          end: `date:${physical}:end`,
          isDatetime: `date:${physical}:is_datetime`
        }
      : physical
  }
  const expectedColumns = ['createdTime', ...Object.values(columns).flatMap(column => isRecord(column) ? Object.values(column) : [column])]
  const selected = expectedColumns.map(column => `s."${String(column).replace(/"/g, '""')}"`)
  const softwareDataSourceUrl = String(context.dataSourceId).startsWith('collection://') ? String(context.dataSourceId) : `collection://${context.dataSourceId}`
  const quotedDataSource = `"${softwareDataSourceUrl.replace(/"/g, '""')}"`
  const detailedSql = `SELECT ${selected.join(', ')}\nFROM ${quotedDataSource} AS s`
  // With no connector revision column, a manifest revision is a fingerprint
  // of every decision-relevant field plus createdTime. Bookending that query
  // detects row replacement, relation edits, and field edits without claiming
  // the database is an atomic snapshot.
  const manifestRevisionColumns = expectedColumns.filter(column => column !== 'url')
  const manifestSql = `SELECT ${selected.join(', ')}\nFROM ${quotedDataSource} AS s\nORDER BY s.url`
  const query = (name, sql) => ({ name, sql, fingerprint: fingerprint({ dataSourceId: context.dataSourceId, sql }, 'query') })
  const manifest = query('software-identity-revision-manifest', manifestSql)
  const details = query('software-complete-details', detailedSql)
  return {
    contract: 'software-evaluation-survey/v1',
    scopeId: scope.scopeId,
    surveyRunId,
    softwareDataSourceId: context.dataSourceId,
    softwareDataSourceUrl,
    columns,
    expectedColumns,
    manifestRevisionColumns,
    queries: { manifest, details },
    executions: [
      { order: 1, name: 'manifest-before', queryFingerprint: manifest.fingerprint },
      { order: 2, name: 'software-details', queryFingerprint: details.fingerprint },
      { order: 3, name: 'affected-software-bodies', queryFingerprint: fingerprint({ scopeId: scope.scopeId, relation: 'Software bodies' }, 'query') },
      { order: 4, name: 'related-process-pages', queryFingerprint: fingerprint({ scopeId: scope.scopeId, relation: 'Artifacts' }, 'query') },
      { order: 5, name: 'manifest-after', queryFingerprint: manifest.fingerprint }
    ],
    instructions: [
      'Run the exact SQL printed in this plan against only softwareDataSourceUrl; do not add a filter, limit, view, or replacement table.',
      'Run every notion-query-data-sources retrieval until has_more is false; preserve every raw response envelope.',
      'Fetch the page body for every candidate, replacement target, and affected Software row before the after manifest.',
      'For a net-new candidate, the affected overlap set is every current Software row and every directly linked Process artifact.',
      'Fetch every related Process page, including its type and body, before the after manifest.',
      'The live Notion SQL connector has no last-edited column. Treat the fingerprint of every manifestRevisionColumns value as the stable row revision.',
      'If identity, stable field revision, or completion cannot be proved, stop rather than describe the directory as complete.'
    ]
  }
}

function artifactRows (artifact, expected) {
  const problems = []
  if (!isRecord(artifact)) return { problems: [`${expected.name} result is not an object.`], rows: [] }
  if (artifact.surveyRunId !== expected.surveyRunId) problems.push(`${expected.name} has the wrong survey-run identifier.`)
  if (artifact.execution !== expected.name) problems.push(`${expected.name} has execution ${JSON.stringify(artifact.execution)}.`)
  if (expected.sql) {
    if (artifact.query !== expected.sql) problems.push(`${expected.name} did not preserve the exact SQL that was run.`)
    const actualFingerprint = typeof artifact.query === 'string'
      ? fingerprint({ dataSourceId: expected.dataSourceId, sql: artifact.query }, 'query')
      : null
    if (actualFingerprint !== artifact.queryFingerprint) problems.push(`${expected.name} fingerprint does not match its actual request SQL.`)
  } else if (artifact.queryFingerprint !== expected.queryFingerprint) problems.push(`${expected.name} has the wrong query fingerprint.`)
  if (!Array.isArray(artifact.envelopes) || !artifact.envelopes.length) problems.push(`${expected.name} must preserve at least one raw response envelope.`)
  const rows = []
  const envelopes = Array.isArray(artifact.envelopes) ? artifact.envelopes : []
  for (const [index, envelope] of envelopes.entries()) {
    if (!isRecord(envelope) || !Array.isArray(envelope.results)) { problems.push(`${expected.name} envelope ${index} has no results list.`); continue }
    if (envelope.isError === true || envelope.is_error === true || envelope.type === 'error' ||
        (Object.prototype.hasOwnProperty.call(envelope, 'error') && envelope.error)) {
      problems.push(`${expected.name} envelope ${index} reports an error.`)
    }
    if (index === 0 && text(envelope.request_cursor)) problems.push(`${expected.name} begins at a continuation instead of the uncursored initial request.`)
    if (typeof envelope.has_more !== 'boolean') problems.push(`${expected.name} envelope ${index} has no reliable has_more completion signal.`)
    if (envelope.truncated === true) problems.push(`${expected.name} envelope ${index} reports truncation.`)
    rows.push(...envelope.results)
    if (envelope.has_more) {
      if (!text(envelope.next_cursor)) problems.push(`${expected.name} envelope ${index} has_more but has no next_cursor.`)
      const next = envelopes[index + 1]
      if (!next) problems.push(`${expected.name} left a continuation unconsumed.`)
      else if (next.request_cursor !== envelope.next_cursor) problems.push(`${expected.name} did not bind the next retrieval to the returned continuation.`)
    } else if (index !== envelopes.length - 1) {
      problems.push(`${expected.name} has an envelope after completion.`)
    }
  }
  return { problems, rows }
}

function validUrl (value) {
  try {
    const parsed = new URL(value)
    return /^https?:$/.test(parsed.protocol) ? parsed.href.replace(/\/$/, '') : null
  } catch (_) { return null }
}

function directoryProof (scope, plan, before, detailed, after, context, surveySequence) {
  const problems = []
  if (!scope || scope.ok !== true || !scope.scopeId) return { ok: false, problems: ['Directory proof requires an accepted scope.'] }
  if (!isRecord(plan) || plan.contract !== 'software-evaluation-survey/v1') return { ok: false, problems: ['Directory proof requires an evaluate-survey plan.'] }
  if (plan.scopeId !== scope.scopeId) problems.push('The survey plan is bound to a different scope.')
  if (!isRecord(context) || !context.dataSourceId || typeof context.property !== 'function') {
    problems.push('Directory proof requires the current config-resolved Software context to rebuild the survey plan.')
  } else {
    const canonicalPlan = surveyPlan({ surveyRunId: plan.surveyRunId }, scope, context)
    if (fingerprint(plan) !== fingerprint(canonicalPlan)) problems.push('The saved survey plan does not match the canonical plan rebuilt from the current config and scope.')
  }
  const expected = Object.fromEntries((plan.executions || []).map(one => {
    const query = one.name === 'software-details' ? plan.queries.details : one.name.startsWith('manifest-') ? plan.queries.manifest : null
    return [one.name, { ...one, surveyRunId: plan.surveyRunId, sql: query && query.sql, dataSourceId: plan.softwareDataSourceId }]
  }))
  for (const name of ['manifest-before', 'software-details', 'manifest-after']) {
    if (!expected[name]) problems.push(`The survey plan omitted ${name}.`)
  }
  if (problems.length) return { ok: false, problems }

  const beforeRead = artifactRows(before, expected['manifest-before'])
  const detailRead = artifactRows(detailed, expected['software-details'])
  const afterRead = artifactRows(after, expected['manifest-after'])
  problems.push(...beforeRead.problems, ...detailRead.problems, ...afterRead.problems)
  const sequenceProblem = surveySequenceProblem(surveySequence, scope, plan, before, detailed, after)
  if (sequenceProblem) problems.push(sequenceProblem)

  const relatedReadFingerprints = {}
  const preceding = isRecord(after) && Array.isArray(after.precedingExecutions) ? after.precedingExecutions : []
  if (preceding.length !== 2) problems.push('The after manifest must attest exactly the two related page-read executions that completed before it.')
  for (const name of ['affected-software-bodies', 'related-process-pages']) {
    const attestations = preceding.filter(one => isRecord(one) && one.execution === name)
    if (attestations.length !== 1) {
      problems.push(`The after manifest must attest ${name} exactly once.`)
      continue
    }
    const attestation = attestations[0]
    if (attestation.surveyRunId !== plan.surveyRunId || attestation.queryFingerprint !== expected[name].queryFingerprint ||
        !/^related-read:[a-f0-9]{64}$/.test(text(attestation.artifactFingerprint))) {
      problems.push(`The after manifest has an invalid ${name} attestation.`)
      continue
    }
    relatedReadFingerprints[name] = attestation.artifactFingerprint
  }

  const fieldRevision = (row, label, url) => {
    const revisionFields = {}
    for (const column of plan.manifestRevisionColumns || []) {
      if (!Object.prototype.hasOwnProperty.call(row, column)) problems.push(`${label} row ${url} omitted revision column ${JSON.stringify(column)}.`)
      revisionFields[column] = row[column]
    }
    const revision = (plan.manifestRevisionColumns || []).length
      ? fingerprint(revisionFields, 'directory-row-revision')
      : null
    if (!revision) problems.push(`${label} row ${url} has no stable field revision.`)
    return revision
  }
  const manifest = (rows, label) => {
    const out = new Map()
    for (const [index, row] of rows.entries()) {
      if (!isRecord(row)) { problems.push(`${label} row ${index} is not an object.`); continue }
      const url = validUrl(row.url)
      if (!url) { problems.push(`${label} row ${index} has no valid page URL.`); continue }
      const identity = pageIdentity(url)
      if (!identity) { problems.push(`${label} row ${url} has no stable Notion page identity.`); continue }
      if (out.has(identity)) { problems.push(`${label} repeats page identity ${identity}.`); continue }
      out.set(identity, { url, revision: fieldRevision(row, label, url) })
    }
    return out
  }
  const beforeMap = manifest(beforeRead.rows, 'before manifest')
  const afterMap = manifest(afterRead.rows, 'after manifest')
  const detailMap = new Map()
  for (const [index, row] of detailRead.rows.entries()) {
    if (!isRecord(row)) { problems.push(`detailed row ${index} is not an object.`); continue }
    const url = validUrl(row.url)
    if (!url) { problems.push(`detailed row ${index} has no valid page URL.`); continue }
    const identity = pageIdentity(url)
    if (!identity) { problems.push(`detailed row ${url} has no stable Notion page identity.`); continue }
    if (detailMap.has(identity)) { problems.push(`detailed rows repeat page identity ${identity}.`); continue }
    for (const column of plan.expectedColumns || []) {
      if (!Object.prototype.hasOwnProperty.call(row, column)) problems.push(`detailed row ${url} omitted expected column ${JSON.stringify(column)}.`)
    }
    detailMap.set(identity, { url, row, revision: fieldRevision(row, 'detailed', url) })
  }
  const beforeIds = [...beforeMap.keys()]
  const detailIds = [...detailMap.keys()]
  const afterIds = [...afterMap.keys()]
  if (detailIds.length !== beforeIds.length) problems.push(`Detailed row count ${detailIds.length} does not equal independently fetched manifest length ${beforeIds.length}.`)
  if (!sameSet(beforeIds, detailIds)) problems.push('The before manifest and detailed rows do not contain the same page identities.')
  if (!sameSet(beforeIds, afterIds)) problems.push('The bookended manifests do not contain the same page identities; the survey changed in flight.')
  for (const identity of beforeIds) {
    const beforeRevision = beforeMap.get(identity).revision
    const afterRevision = afterMap.get(identity) && afterMap.get(identity).revision
    const detailRevision = detailMap.get(identity) && detailMap.get(identity).revision
    if (beforeRevision !== afterRevision) problems.push(`Page ${beforeMap.get(identity).url} changed revision during the survey.`)
    if (beforeRevision !== detailRevision) problems.push(`Detailed values for ${beforeMap.get(identity).url} do not match the bookended field revision.`)
  }

  const logicalRows = detailIds.map(identity => {
    const { url, row: raw } = detailMap.get(identity)
    const logical = { url }
    for (const [logicalName, physicalName] of Object.entries(plan.columns || {})) {
      logical[logicalName] = isRecord(physicalName)
        ? Object.fromEntries(Object.entries(physicalName).map(([part, column]) => [part, raw[column]]))
        : raw[physicalName]
    }
    return logical
  })
  const stable = {
    contract: 'software-directory-proof/v1',
    scopeId: scope.scopeId,
    surveyRunId: plan.surveyRunId,
    softwareDataSourceId: plan.softwareDataSourceId,
    softwareDataSourceUrl: plan.softwareDataSourceUrl,
    queryFingerprints: {
      manifest: plan.queries.manifest.fingerprint,
      details: plan.queries.details.fingerprint
    },
    expectedColumns: plan.expectedColumns,
    count: logicalRows.length,
    identities: beforeIds.map(identity => beforeMap.get(identity).url),
    revisions: Object.fromEntries(beforeIds.map(identity => [identity, beforeMap.get(identity).revision])),
    surveySequenceId: surveySequence && surveySequence.sequenceId,
    relatedReadFingerprints,
    rows: logicalRows,
    limitation: 'This proves identity and decision-relevant field stability across the bookended survey, not an atomic database snapshot or stability of fields the connector cannot expose.'
  }
  return problems.length
    ? { ok: false, problems }
    : { ok: true, problems: [], ...stable, proofId: fingerprint(stable, 'directory-proof') }
}

function relationUrls (value) {
  const found = new Set()
  const visit = one => {
    if (typeof one === 'string') {
      const trimmed = one.trim()
      if (/^[\[{]/.test(trimmed)) {
        try { visit(JSON.parse(trimmed)); return } catch (_) {}
      }
      const direct = validUrl(one)
      if (direct) found.add(direct)
      else if (pageIdentity(one.trim())) found.add(one.trim())
      for (const match of one.matchAll(/https?:\/\/[^\s"'<>]+/g)) {
        const url = validUrl(match[0])
        if (url) found.add(url)
      }
    } else if (Array.isArray(one)) one.forEach(visit)
    else if (isRecord(one)) {
      if (one.url) visit(one.url)
      if (one.href) visit(one.href)
      if (one.id) visit(one.id)
      if (one.results) visit(one.results)
    }
  }
  visit(value)
  return [...found]
}

function relationCount (value) {
  if (typeof value === 'string' && /^[\[{]/.test(value.trim())) {
    try { return relationCount(JSON.parse(value)) } catch (_) {}
  }
  if (Array.isArray(value)) return value.length
  if (isRecord(value) && Array.isArray(value.results)) return value.results.length
  return relationUrls(value).length
}

function relationIncomplete (value) {
  if (typeof value === 'string' && /^[\[{]/.test(value.trim())) {
    try { return relationIncomplete(JSON.parse(value)) } catch (_) { return false }
  }
  return isRecord(value) && (value.has_more === true || value.hasMore === true)
}

function relationMalformed (value) {
  if (typeof value === 'string' && /^[\[{]/.test(value.trim())) {
    try { return relationMalformed(JSON.parse(value)) } catch (_) { return true }
  }
  if (value === null || value === undefined || value === '') return false
  const identities = new Set(relationUrls(value).map(pageIdentity).filter(Boolean))
  if (Array.isArray(value) || (isRecord(value) && Array.isArray(value.results))) {
    return relationCount(value) !== identities.size
  }
  if (typeof value === 'string' || isRecord(value)) return identities.size !== 1
  return true
}

function relatedReadAttestation (scope, plan, artifactInput) {
  const problems = []
  const scopeProblem = acceptedScopeProblem(scope)
  if (scopeProblem) problems.push(`Related-read attestation requires an unchanged accepted scope. ${scopeProblem}`)
  if (!isRecord(plan) || plan.scopeId !== (scope && scope.scopeId) || !text(plan.surveyRunId) || !Array.isArray(plan.executions)) {
    problems.push('Related-read attestation requires the scope-bound survey plan.')
  }
  if (!isRecord(artifactInput) || artifactInput.scopeId !== (scope && scope.scopeId) || artifactInput.surveyRunId !== (plan && plan.surveyRunId)) {
    problems.push('Related page reads must be bound to the same scope and survey run.')
  }
  if (!artifactInput || !Array.isArray(artifactInput.softwareBodies) || !Array.isArray(artifactInput.pages)) {
    problems.push('Related page reads must contain softwareBodies and pages lists, even when either is empty.')
  }
  const precedingExecutions = []
  for (const [name, field] of [['affected-software-bodies', 'softwareBodies'], ['related-process-pages', 'pages']]) {
    const matches = isRecord(plan) && Array.isArray(plan.executions) ? plan.executions.filter(one => one && one.name === name) : []
    if (matches.length !== 1 || !text(matches[0].queryFingerprint)) {
      problems.push(`The survey plan must contain exactly one ${name} execution with a query fingerprint.`)
      continue
    }
    if (!artifactInput || !Array.isArray(artifactInput[field])) continue
    precedingExecutions.push({
      surveyRunId: plan.surveyRunId,
      execution: name,
      queryFingerprint: matches[0].queryFingerprint,
      artifactFingerprint: relatedReadFingerprint(plan, name, artifactInput[field])
    })
  }
  return problems.length
    ? { ok: false, problems }
    : { ok: true, problems: [], scopeId: scope.scopeId, surveyRunId: plan.surveyRunId, precedingExecutions }
}

function processTypeFromPage (page, processNames) {
  if (!isRecord(processNames) || !isRecord(processNames.properties) || !isRecord(processNames.values) || !isRecord(processNames.values.Type)) return null
  const propertyName = text(processNames.properties.Type)
  if (!propertyName || !isRecord(page.properties)) return null
  const raw = page.properties[propertyName]
  const observed = text(raw) || (isRecord(raw) && (text(raw.name) || text(raw.value) || (isRecord(raw.select) && text(raw.select.name))))
  if (!observed) return null
  const logical = Object.entries(processNames.values.Type).find(([, actual]) => actual === observed)
  return logical ? logical[0] : null
}

function datePropertyTimestamp (value) {
  const direct = timestamp(value)
  if (direct) return direct
  if (!isRecord(value)) return null
  for (const candidate of [value.start, value.value, isRecord(value.date) && value.date.start]) {
    const parsed = timestamp(candidate)
    if (parsed) return parsed
  }
  return null
}

function configuredDatePropertyTimestamp (properties, propertyName) {
  if (!isRecord(properties) || !text(propertyName)) return null
  return datePropertyTimestamp(properties[propertyName]) ||
    datePropertyTimestamp(properties[`date:${propertyName}:start`])
}

function notionIdentity (value) {
  return pageIdentity(value)
}

function dependencies (scope, proof, artifactInput, processNames) {
  const problems = []
  const scopeProblem = acceptedScopeProblem(scope)
  if (scopeProblem) return { ok: false, problems: [`Dependencies require an unchanged accepted scope. ${scopeProblem}`] }
  if (!proof || proof.ok !== true || proof.contract !== 'software-directory-proof/v1') return { ok: false, problems: ['Dependencies require a passing directory proof.'] }
  if (canonicalDirectoryProofId(proof) !== proof.proofId) return { ok: false, problems: ['The directory proof changed after evaluate-directory-proof; regenerate dependencies from a current proof.'] }
  if (proof.scopeId !== scope.scopeId) problems.push('Directory proof is bound to a different scope.')
  if (!isRecord(artifactInput)) problems.push('artifact-pages input must be a scope-bound object.')
  if (artifactInput && artifactInput.scopeId !== scope.scopeId) problems.push('Artifact pages are bound to a different scope.')
  if (artifactInput && artifactInput.surveyRunId !== proof.surveyRunId) problems.push('Artifact pages are bound to a different survey run.')
  if (!artifactInput || !Array.isArray(artifactInput.pages)) problems.push('artifact-pages must contain a pages list, even when it is empty.')
  if (!isRecord(processNames) || !text(processNames.properties && processNames.properties.Type) ||
      !text(processNames.properties && processNames.properties['Last checked for accuracy']) ||
      !isRecord(processNames.values) || !isRecord(processNames.values.Type) ||
      PROCESS_ARTIFACT_TYPES.some(type => !text(processNames.values.Type[type]))) {
    problems.push('Dependencies require the complete config-resolved Process Type, Last checked for accuracy, and option name map.')
  }
  const relatedPlan = {
    scopeId: proof.scopeId,
    surveyRunId: proof.surveyRunId,
    executions: [
      { name: 'affected-software-bodies', queryFingerprint: fingerprint({ scopeId: proof.scopeId, relation: 'Software bodies' }, 'query') },
      { name: 'related-process-pages', queryFingerprint: fingerprint({ scopeId: proof.scopeId, relation: 'Artifacts' }, 'query') }
    ]
  }
  for (const [name, field] of [['affected-software-bodies', 'softwareBodies'], ['related-process-pages', 'pages']]) {
    const actual = relatedReadFingerprint(relatedPlan, name, artifactInput && artifactInput[field])
    if (!actual || !isRecord(proof.relatedReadFingerprints) || proof.relatedReadFingerprints[name] !== actual) {
      problems.push(`${name} is not the exact page-read artifact attested before the after manifest.`)
    }
  }

  const named = name => proof.rows.filter(row => text(row.Name).toLowerCase() === name.toLowerCase())
  const candidateRows = named(scope.candidate.name)
  if (scope.candidate.directoryState === 'net-new') {
    if (candidateRows.length) problems.push('The scope calls the candidate net-new, but the complete directory has an exact candidate row.')
  } else if (candidateRows.length !== 1) {
    problems.push(`The named existing candidate must resolve to exactly one Software row; found ${candidateRows.length}.`)
  }

  let targetRows = []
  if (scope.candidate.targetType === 'replacement') {
    targetRows = named(scope.candidate.replacementTool)
    if (targetRows.length !== 1) problems.push(`The replacement target must resolve to exactly one Software row; found ${targetRows.length}.`)
  }
  const rowByIdentity = new Map()
  for (const row of proof.rows) {
    const identity = notionIdentity(row.url)
    if (!identity) problems.push(`Software row ${JSON.stringify(row.url)} has no stable Notion page identity.`)
    else if (rowByIdentity.has(identity)) problems.push(`Software directory repeats page identity ${identity}.`)
    else rowByIdentity.set(identity, row)
  }
  const roots = [...candidateRows, ...targetRows]
  for (const row of proof.rows) {
    if (relationMalformed(row['Integrates with'])) {
      problems.push(`Software row ${row.url} has an unidentifiable Integrates with relation entry, so dependency coverage is not provably complete.`)
    } else if (relationIncomplete(row['Integrates with'])) {
      problems.push(`Software row ${row.url} has an incomplete Integrates with relation payload, so reverse dependency coverage is not provably complete.`)
    } else if (relationCount(row['Integrates with']) >= NOTION_RELATION_CAP) {
      problems.push(`Software row ${row.url} reached Notion's ${NOTION_RELATION_CAP}-item Integrates with relation cap, so reverse dependency coverage is not provably complete.`)
    }
  }
  const affected = new Map()
  if (scope.candidate.directoryState === 'net-new') {
    for (const [identity, row] of rowByIdentity) affected.set(identity, { row, reasons: ['current-stack-overlap'] })
  }
  for (const row of roots) {
    const identity = notionIdentity(row.url)
    if (identity) affected.set(identity, { row, reasons: ['candidate-or-target'] })
  }
  for (const target of roots) {
    const targetIdentity = notionIdentity(target.url)
    if (!targetIdentity) continue
    for (const outboundUrl of relationUrls(target['Integrates with'])) {
      const outboundIdentity = notionIdentity(outboundUrl)
      if (!outboundIdentity) { problems.push(`Integration relation ${JSON.stringify(outboundUrl)} has no stable Notion page identity.`); continue }
      const outbound = rowByIdentity.get(outboundIdentity)
      if (outbound) {
        const item = affected.get(outboundIdentity) || { row: outbound, reasons: [] }
        item.reasons.push('target-outbound')
        affected.set(outboundIdentity, item)
      } else problems.push(`Outbound integration ${outboundUrl} did not resolve to a row in the complete Software directory.`)
    }
    for (const row of proof.rows) {
      const rowIdentity = notionIdentity(row.url)
      if (!rowIdentity || rowIdentity === targetIdentity) continue
      if (relationUrls(row['Integrates with']).some(url => notionIdentity(url) === targetIdentity)) {
        const item = affected.get(rowIdentity) || { row, reasons: [] }
        item.reasons.push('reverse-only-dependent')
        affected.set(rowIdentity, item)
      }
    }
  }

  const expectedArtifacts = new Map()
  for (const { row } of affected.values()) {
    if (relationMalformed(row.Artifacts)) {
      problems.push(`Affected Software row ${row.url} has an unidentifiable Artifacts relation entry, so Process artifact coverage is not provably complete.`)
    } else if (relationIncomplete(row.Artifacts)) {
      problems.push(`Affected Software row ${row.url} has an incomplete Artifacts relation payload, so Process artifact coverage is not provably complete.`)
    } else if (relationCount(row.Artifacts) >= NOTION_RELATION_CAP) {
      problems.push(`Affected Software row ${row.url} reached Notion's ${NOTION_RELATION_CAP}-item Artifacts relation cap, so Process artifact coverage is not provably complete.`)
    }
    for (const url of relationUrls(row.Artifacts)) {
      const identity = notionIdentity(url)
      if (!identity) problems.push(`Artifact relation ${JSON.stringify(url)} has no stable Notion page identity.`)
      else if (!expectedArtifacts.has(identity)) expectedArtifacts.set(identity, url)
    }
  }
  const expectedSoftwareBodies = new Map([...affected.entries()].map(([identity, { row }]) => [identity, row]))
  if (!artifactInput || !Array.isArray(artifactInput.softwareBodies)) problems.push('artifact-pages must contain a softwareBodies list, even when it is empty.')
  const softwareBodies = new Map()
  for (const [index, page] of ((artifactInput && Array.isArray(artifactInput.softwareBodies)) ? artifactInput.softwareBodies : []).entries()) {
    if (!isRecord(page)) { problems.push(`Software body ${index} is not an object.`); continue }
    const url = validUrl(page.url)
    const identity = url && pageIdentity(url)
    if (!url || !identity) { problems.push(`Software body ${index} has no stable page URL.`); continue }
    if (softwareBodies.has(identity)) { problems.push(`Software bodies repeat page identity ${identity}.`); continue }
    const directoryRow = expectedSoftwareBodies.get(identity)
    const directoryLastReviewed = directoryRow && datePropertyTimestamp(directoryRow['Last reviewed'])
    const sourceDate = directoryLastReviewed
    const sourceDateKind = directoryLastReviewed ? 'directory-last-reviewed' : null
    softwareBodies.set(identity, { url, page, sourceDate, sourceDateKind })
    if (!expectedSoftwareBodies.has(identity)) problems.push(`Software body ${url} is not for an in-scope affected row.`)
    const body = page.body
    const hasBody = typeof body === 'string' ? Boolean(body.trim()) : isRecord(body) ? Object.keys(body).length > 0 : Array.isArray(body) ? body.length > 0 : false
    if (page.unavailable === true || page.readable === false) problems.push(`Software body ${url} is marked unreadable or unavailable.`)
    if (!hasBody) problems.push(`Software body ${url} has no fetched page body; consequence or wiring detail could be missed.`)
    if (!sourceDate) problems.push(`Software body ${url} has no directory Last reviewed date, so freshness cannot be judged.`)
    else {
      const editedDay = day(String(sourceDate).slice(0, 10))
      if (editedDay > scope.asOf) problems.push(`Software body ${url} was edited after the evaluation's asOf day.`)
      else if (daysBetween(editedDay, scope.asOf) > scope.artifactMaxAgeDays) problems.push(`Software body ${url} is too stale to prove the current directory state.`)
    }
  }
  for (const [identity, row] of expectedSoftwareBodies) if (!softwareBodies.has(identity)) problems.push(`Affected Software row ${row.url} was not fetched with its page body.`)
  const pages = new Map()
  for (const [index, page] of ((artifactInput && Array.isArray(artifactInput.pages)) ? artifactInput.pages : []).entries()) {
    if (!isRecord(page)) { problems.push(`artifact page ${index} is not an object.`); continue }
    const url = validUrl(page.url)
    if (!url) { problems.push(`artifact page ${index} has no valid URL.`); continue }
    const identity = pageIdentity(url)
    if (!identity) { problems.push(`artifact page ${url} has no stable Notion page identity.`); continue }
    if (pages.has(identity)) { problems.push(`artifact pages repeat page identity ${identity}.`); continue }
    pages.set(identity, { url, page })
    if (!expectedArtifacts.has(identity)) problems.push(`Artifact ${url} is not directly related to an in-scope affected Software row.`)
  }
  for (const [identity, url] of expectedArtifacts) if (!pages.has(identity)) problems.push(`Expected related Process artifact ${url} was not fetched.`)

  const stale = []
  const unavailable = []
  const artifactTypes = new Map()
  const artifactSourceDates = new Map()
  for (const { url, page } of pages.values()) {
    if (page.unavailable === true || page.readable === false) { unavailable.push(url); continue }
    const checkedProperty = text(processNames && processNames.properties && processNames.properties['Last checked for accuracy'])
    const lastChecked = configuredDatePropertyTimestamp(page.properties, checkedProperty)
    const sourceDate = lastChecked
    const sourceDateKind = lastChecked ? 'process-last-checked' : null
    artifactSourceDates.set(pageIdentity(url), { sourceDate, sourceDateKind })
    if (!sourceDate) { unavailable.push(url); problems.push(`Artifact ${url} has no config-resolved Last checked for accuracy date, so freshness cannot be judged.`); continue }
    const editedDay = day(String(sourceDate).slice(0, 10))
    if (editedDay > scope.asOf) { unavailable.push(url); problems.push(`Artifact ${url} was edited after the evaluation's asOf day.`); continue }
    if (daysBetween(editedDay, scope.asOf) > scope.artifactMaxAgeDays) stale.push(url)
    const type = processTypeFromPage(page, processNames)
    artifactTypes.set(pageIdentity(url), type || null)
    const body = page.body
    const hasBody = typeof body === 'string' ? Boolean(body.trim()) : isRecord(body) ? Object.keys(body).length > 0 : Array.isArray(body) ? body.length > 0 : false
    if (!type || !PROCESS_ARTIFACT_TYPES.includes(type)) {
      unavailable.push(url)
      problems.push(type
        ? `Process artifact ${url} has unknown Type ${JSON.stringify(type)}.`
        : `Process artifact ${url} has no config-resolved recognizable Type, so its body requirements cannot be judged.`)
    }
    if (!hasBody) {
      unavailable.push(url)
      problems.push(`Process artifact ${url} has no fetched page body; dependency, wiring, or teardown detail could be missed.`)
    }
  }
  if (stale.length) problems.push(`Related Process artifacts are too stale for dependency coverage: ${stale.join(', ')}.`)
  if (unavailable.length) problems.push(`Related Process artifacts are unreadable or incomplete: ${[...new Set(unavailable)].join(', ')}.`)

  const stable = {
    contract: 'software-dependencies/v1',
    scopeId: scope.scopeId,
    directoryProofId: proof.proofId,
    surveyRunId: proof.surveyRunId,
    candidate: candidateRows.map(row => row.url),
    replacementTarget: targetRows.map(row => row.url),
    affectedRows: [...affected.values()].map(({ row, reasons }) => ({ url: row.url, name: row.Name, reasons: [...new Set(reasons)] })),
    outbound: [...affected.values()].filter(one => one.reasons.includes('target-outbound')).map(one => one.row.url),
    reverseOnly: [...affected.values()].filter(one => one.reasons.includes('reverse-only-dependent')).map(one => one.row.url),
    softwareBodies: [...softwareBodies.values()].map(({ url, page, sourceDate, sourceDateKind }) => ({ url, sourceDate, sourceDateKind, body: page.body })),
    expectedArtifactUrls: [...expectedArtifacts.values()].sort(),
    artifactPages: [...pages.values()].map(({ url, page }) => ({ url, type: artifactTypes.get(pageIdentity(url)) || null, ...(artifactSourceDates.get(pageIdentity(url)) || { sourceDate: null, sourceDateKind: null }), body: page.body })),
    stale,
    unavailable: [...new Set(unavailable)],
    complete: problems.length === 0
  }
  return problems.length
    ? { ok: false, problems, ...stable }
    : { ok: true, problems: [], ...stable, dependenciesId: fingerprint(stable, 'dependencies') }
}

function refsPass (refs, criterion, index, { beyondVendor = false, verified = false, valueKind, sourceKind, optionId } = {}) {
  if (!Array.isArray(refs) || !refs.length) return false
  const records = refs.map(id => index[id]).filter(Boolean)
  if (records.length !== refs.length) return false
  return records.some(record =>
    (!criterion || record.criterion === criterion) &&
    record.stance === 'supports' &&
    (!sourceKind || record.sourceKind === sourceKind) &&
    (!optionId || (isRecord(record.value) && record.value.optionId === optionId)) &&
    (!beyondVendor || record.classification !== 'vendor-claim') &&
    (!verified || (isRecord(record.value) && record.value.verified === true)) &&
    (!valueKind || (record.value && record.value.kind === valueKind && record.value.verified === true)))
}

function successCriteriaPass (refs, criteria, index, optionId) {
  if (!Array.isArray(criteria) || !criteria.length || !Array.isArray(refs) || !refs.length) return false
  return criteria.every(successCriterion => refs.some(id => {
    const record = index[id]
    return record && record.criterion === 'success-criterion' && record.stance === 'supports' &&
      record.classification !== 'vendor-claim' && isRecord(record.value) && record.value.verified === true &&
      record.value.optionId === optionId && record.value.successCriterion === successCriterion
  }))
}

function blockerResolutionsPass (refs, blockers, index, optionId) {
  if (!Array.isArray(blockers) || !blockers.length) return true
  if (!Array.isArray(refs) || !refs.length) return false
  return blockers.every(blocker => refs.some(id => {
    const record = index[id]
    return record && record.criterion === 'blocker-resolution' && record.stance === 'supports' &&
      record.classification !== 'vendor-claim' && isRecord(record.value) &&
      record.value.kind === 'blocker-resolution' && record.value.verified === true &&
      record.value.optionId === optionId && record.value.blocker === blocker && record.value.resolved === true
  }))
}

function directoryEvidenceProblems (deps, evidence) {
  const problems = []
  const directoryCoverage = evidence.coverage.find(one => one.sourceKind === 'software-directory')
  if (!directoryCoverage || directoryCoverage.status !== 'searched') {
    problems.push('Software-directory coverage must be searched because assessment uses the completed directory survey and dependency inventory.')
  }
  for (const record of evidence.records.filter(one => one.sourceKind === 'software-directory')) {
    const value = record.value
    if (!isRecord(value) || value.kind !== 'software-directory-proof' || value.verified !== true ||
        value.directoryProofId !== deps.directoryProofId || value.dependenciesId !== deps.dependenciesId ||
        value.surveyRunId !== deps.surveyRunId) {
      problems.push(`Software-directory evidence ${JSON.stringify(record.id)} is not bound to the current directory proof and dependency inventory.`)
    }
  }
  return problems
}

function accountableChoicePass (choice, index) {
  if (!isRecord(choice) || !day(choice.date) || !text(choice.by) || !text(choice.acceptedDownside) || !text(choice.optionId)) return false
  if (!Array.isArray(choice.evidenceIds) || !choice.evidenceIds.length) return false
  const records = choice.evidenceIds.map(id => index[id]).filter(Boolean)
  if (records.length !== choice.evidenceIds.length) return false
  return records.some(record => {
    const value = record.value
    return record.sourceKind === 'user-statement' && record.classification === 'user-statement' &&
      record.criterion === 'accountable-choice' && record.stance === 'supports' &&
      record.scope && record.scope.person === choice.by &&
      String(record.observedAt || '').slice(0, 10) === choice.date &&
      isRecord(value) && value.kind === 'accountable-choice' && value.verified === true &&
      value.optionId === choice.optionId && value.by === choice.by && value.date === choice.date &&
      value.acceptedDownside === choice.acceptedDownside
  })
}

function terminalEligibility (option, scope, deps, index) {
  const reasons = []
  const optionId = isRecord(option) ? text(option.id) : ''
  if (!optionId) return { eligible: false, reasons: ['option id is required before terminal gates can be checked'], gateEvidenceIds: [] }
  const gates = isRecord(option.gates) ? option.gates : {}
  const gateEvidenceIds = new Set()
  for (const value of Object.values(gates)) {
    if (!Array.isArray(value)) continue
    for (const entry of value) {
      if (typeof entry === 'string' && entry) gateEvidenceIds.add(entry)
      else if (isRecord(entry) && Array.isArray(entry.evidenceIds)) {
        for (const id of entry.evidenceIds) if (typeof id === 'string' && id) gateEvidenceIds.add(id)
      }
    }
  }
  if (!scope.problem) reasons.push('problem is not explicit')
  if (!scope.useCases.length) reasons.push('use cases are not explicit')
  if (!scope.successCriteria.length) reasons.push('success criteria are not explicit')
  if (!deps.complete) reasons.push('dependency coverage is incomplete')
  const common = [
    ['businessNeed', 'business-need', true, null, false],
    ['success', 'success-criterion', true, null, true],
    ['overlap', 'overlap', false, 'software-directory', true],
    ['implementation', 'implementation', false, null, true, true],
    ['migration', 'migration', false, null, true, true],
    ['security', 'security', false, null, true, true]
  ]
  for (const [field, criterion, beyondVendor, sourceKind, bindOption, verified] of common) {
    const passed = field === 'success'
      ? successCriteriaPass(gates[field], scope.successCriteria, index, optionId)
      : refsPass(gates[field], criterion, index, { beyondVendor, verified, sourceKind, optionId: bindOption ? optionId : undefined })
    if (!passed) reasons.push(field === 'success' ? `${criterion} gate is not evidenced for every named success criterion` : `${criterion} gate is not evidenced`)
  }
  if (gates.noMaterialGaps !== true) reasons.push('material gaps are not resolved')
  if (!blockerResolutionsPass(gates.blockerResolutions, scope.knownBlockers, index, optionId)) reasons.push('known blockers are not each resolved by option-bound non-vendor evidence')

  if (option.type === 'candidate' || option.type === 'alternative') {
    if (!refsPass(gates.price, 'price', index, { valueKind: 'money', optionId })) reasons.push('price is not verified')
    if (!refsPass(gates.terms, 'terms', index, { valueKind: 'material-terms', sourceKind: 'signed-terms', optionId })) reasons.push('material terms are not verified')
    if (option.type === 'alternative' && !text(option.name)) reasons.push('the alternative is not named')
  } else if (option.type === 'build') {
    if (!refsPass(gates.technicalSpike, 'technical-spike', index, { beyondVendor: true, verified: true, optionId })) reasons.push('technical spike is not evidenced')
    if (!refsPass(gates.operatingBehaviors, 'operating-behavior', index, { beyondVendor: true, verified: true, optionId })) reasons.push('always-on, integration, data, security, reliability, and support behavior is not understood')
    if (!refsPass(gates.buildCost, 'build-cost', index, { valueKind: 'money', optionId })) reasons.push('build and maintenance cost is not verified')
    if (!refsPass(gates.technicalOwner, 'technical-owner', index, { beyondVendor: true, verified: true, optionId })) reasons.push('a technical owner is not evidenced beyond vendor claims')
    if (!refsPass(gates.maintainability, 'maintainability', index, { beyondVendor: true, verified: true, optionId })) reasons.push('maintainability is not evidenced')
  } else reasons.push('option type must be candidate, alternative, or build')
  return { eligible: reasons.length === 0, reasons, gateEvidenceIds: [...gateEvidenceIds].sort() }
}

function recommendationFor (option) {
  if (option.type === 'candidate') return 'Buy candidate'
  if (option.type === 'alternative') return 'Buy named alternative'
  return 'Build'
}

function metricEvidencePass (option, metric, index) {
  if (!isRecord(option.metricEvidence) || !Array.isArray(option.metricEvidence[metric]) || !option.metricEvidence[metric].length) return false
  const records = option.metricEvidence[metric].map(id => index[id]).filter(Boolean)
  if (records.length !== option.metricEvidence[metric].length) return false
  return records.some(record => record.criterion === `decision-metric:${metric}` && record.stance === 'supports' &&
    record.classification !== 'vendor-claim' && record.value && record.value.kind === 'normalized-score' &&
    record.value.verified === true && record.value.optionId === option.id && record.value.metric === metric &&
    record.value.direction === 'higher-is-better' && record.value.score === option.metrics[metric])
}

function dominant (options, priorities, index) {
  if (!Array.isArray(priorities) || !priorities.length || priorities.some(one => !DECISION_METRICS.includes(one))) return null
  if (!isRecord(index)) return null
  for (const candidate of options) {
    if (!isRecord(candidate.metrics) || !isRecord(candidate.metricEvidence)) continue
    if (DECISION_METRICS.some(metric => typeof candidate.metrics[metric] !== 'number' || !metricEvidencePass(candidate, metric, index))) continue
    let wins = true
    for (const other of options) {
      if (other === candidate || !isRecord(other.metrics) || !isRecord(other.metricEvidence)) { if (other !== candidate) wins = false; continue }
      if (DECISION_METRICS.some(metric => typeof other.metrics[metric] !== 'number' || !metricEvidencePass(other, metric, index) || candidate.metrics[metric] < other.metrics[metric])) wins = false
      if (!priorities.some(metric => candidate.metrics[metric] > other.metrics[metric])) wins = false
    }
    if (wins) return candidate
  }
  return null
}

function assessment (request, scope, deps, evidenceInput) {
  const problems = []
  const scopeProblem = acceptedScopeProblem(scope)
  if (scopeProblem) return { ok: false, problems: [`Assessment requires an unchanged accepted scope. ${scopeProblem}`] }
  if (!deps || deps.ok !== true || !deps.dependenciesId) return { ok: false, problems: ['Assessment requires a complete, scope-bound dependency inventory.'] }
  if (canonicalDependenciesId(deps) !== deps.dependenciesId) return { ok: false, problems: ['The dependency inventory changed after evaluate-dependencies; regenerate the assessment from a current inventory.'] }
  if (deps.scopeId !== scope.scopeId) problems.push('Dependencies are bound to a different scope.')
  if (!isRecord(request)) problems.push('Assessment request is not an object.')
  if (request && request.scopeId !== scope.scopeId) problems.push('Assessment request is bound to a different scope.')
  if (request && request.dependenciesId !== deps.dependenciesId) problems.push('Assessment request is bound to a different dependency inventory.')
  if (request && request.options !== undefined && !Array.isArray(request.options)) problems.push('Assessment options must be a list when supplied.')
  const options = request && Array.isArray(request.options) ? request.options : []
  const optionIds = new Set()
  for (const option of options) {
    const optionId = isRecord(option) ? text(option.id) : ''
    if (!optionId) continue
    if (optionIds.has(optionId)) problems.push(`Assessment options repeat id ${JSON.stringify(optionId)}.`)
    else optionIds.add(optionId)
    if (option.type === 'candidate' && (optionId !== 'candidate' || text(option.name) !== scope.candidate.name)) {
      problems.push(`The candidate option must use id "candidate" and the exact accepted candidate name ${JSON.stringify(scope.candidate.name)}.`)
    }
    if (option.type === 'alternative') {
      const name = text(option.name)
      if (!name || name.toLowerCase() === scope.candidate.name.toLowerCase()) {
        problems.push('An alternative option must name a product different from the accepted candidate.')
      } else if (optionId !== `alternative:${name}`) {
        problems.push(`Alternative option ${JSON.stringify(name)} must use its name-bound id ${JSON.stringify(`alternative:${name}`)}.`)
      }
    }
    if (option.type === 'build' && (optionId !== 'build' || text(option.name) !== BUILD_OPTION_NAME)) {
      problems.push(`The build option must use id "build" and name ${JSON.stringify(BUILD_OPTION_NAME)}.`)
    }
    if (!['candidate', 'alternative', 'build'].includes(option.type)) {
      problems.push(`Assessment option ${JSON.stringify(optionId || null)} has unsupported type ${JSON.stringify(option.type)}.`)
    }
  }
  const evidence = validateEvidence(scope, evidenceInput)
  if (!evidence.ok) problems.push(...evidence.problems)
  if (request && request.evidenceId !== evidence.evidenceId) problems.push('Assessment request is bound to different validated evidence.')
  if (request && request.priorities !== undefined && fingerprint(request.priorities) !== fingerprint(scope.priorities)) {
    problems.push('Assessment priorities do not exactly match the priorities accepted in scope.')
  }
  if (evidence.ok) problems.push(...directoryEvidenceProblems(deps, evidence))
  if (problems.length) return { ok: false, problems }

  const index = evidenceIndex(evidence)
  const facts = isRecord(request.facts) ? request.facts : {}
  let recommendation = 'Insufficient evidence'
  let reason = 'No recommendation gate passed.'
  let selectedOption = null
  let nextStep = null
  const optionResults = []
  const requiredEvidenceIds = new Set()

  const hardStopPasses = isRecord(facts.hardStop) && text(facts.hardStop.reason) &&
      ['need-not-real', 'current-stack-meets', 'material-blocker'].includes(facts.hardStop.kind) &&
      refsPass(facts.hardStop.evidenceIds, 'hard-stop', index, { beyondVendor: true }) &&
      !evidence.conflicts.some(conflict => conflict.criterion === 'hard-stop')
  if (hardStopPasses) {
    recommendation = 'Stop'
    reason = facts.hardStop.reason
    for (const id of facts.hardStop.evidenceIds) requiredEvidenceIds.add(id)
  } else if (evidence.conflicts.length) {
    reason = 'Material evidence conflicts prevent classification; both dated sources remain visible.'
  } else {
    const finalStage = ['POC complete', 'final decision'].includes(scope.stage)
    let unresolvedTerminalTie = false
    let accountableChoiceResolvedTie = false
    if (finalStage) {
      for (const option of options) optionResults.push({ ...option, ...terminalEligibility(option, scope, deps, index) })
      const eligible = optionResults.filter(one => one.eligible)
      if (eligible.length === 1) selectedOption = eligible[0]
      else if (eligible.length > 1) {
        selectedOption = dominant(eligible, scope.priorities, index)
        const choice = request.accountableChoice
        if (!selectedOption && accountableChoicePass(choice, index) && eligible.some(one => one.id === choice.optionId)) {
          selectedOption = eligible.find(one => one.id === choice.optionId)
          accountableChoiceResolvedTie = true
        }
        if (!selectedOption) {
          unresolvedTerminalTie = true
          reason = 'More than one terminal-positive option passed, but none strictly dominates on verified comparable evidence and no dated accountable choice resolves the tradeoff.'
        }
      }
      if (selectedOption) {
        recommendation = recommendationFor(selectedOption)
        reason = `Every gate passed for ${selectedOption.name || selectedOption.id}.`
        const eligible = optionResults.filter(one => one.eligible)
        for (const option of eligible) for (const id of option.gateEvidenceIds) requiredEvidenceIds.add(id)
        if (eligible.length > 1) {
          for (const option of eligible) {
            for (const ids of Object.values(isRecord(option.metricEvidence) ? option.metricEvidence : {})) {
              if (Array.isArray(ids)) for (const id of ids) if (typeof id === 'string' && id) requiredEvidenceIds.add(id)
            }
          }
          const choice = request.accountableChoice
          if (accountableChoiceResolvedTie && isRecord(choice) && choice.optionId === selectedOption.id && Array.isArray(choice.evidenceIds)) {
            for (const id of choice.evidenceIds) requiredEvidenceIds.add(id)
          }
        }
      }
    }

    if (!selectedOption && !unresolvedTerminalTie && recommendation === 'Insufficient evidence') {
      const missingPocResults = Array.isArray(facts.pocMissingCriteria)
        ? facts.pocMissingCriteria.map(item => isRecord(item) ? {
            criterion: text(item.criterion),
            completionStep: text(item.completionStep)
          } : null)
        : []
      const completeMissingPocResults = missingPocResults.length > 0 &&
        missingPocResults.length === facts.pocMissingCriteria.length &&
        missingPocResults.every(item => item && scope.successCriteria.includes(item.criterion) && item.completionStep)
      const passedPocCriteria = new Set(Object.values(index).filter(record => record &&
        record.criterion === 'success-criterion' && record.stance === 'supports' && record.classification !== 'vendor-claim' &&
        isRecord(record.value) && record.value.verified === true && record.value.optionId === 'candidate' &&
        scope.successCriteria.includes(record.value.successCriterion)).map(record => record.value.successCriterion))
      const expectedMissingPocCriteria = scope.successCriteria.filter(criterion => !passedPocCriteria.has(criterion))
      const completePocGapSet = completeMissingPocResults &&
        sameSet(missingPocResults.map(item => item.criterion), expectedMissingPocCriteria)
      const completePocPlan = isRecord(facts.pocPlan) && text(facts.pocPlan.owner) && day(facts.pocPlan.from) && day(facts.pocPlan.to) &&
        facts.pocPlan.from >= scope.asOf && facts.pocPlan.from <= facts.pocPlan.to && facts.pocPlan.handsOnUncertainty === true && facts.pocPlan.noHardBlocker === true &&
        scope.successCriteria.length
      if (['POC running', 'POC incomplete'].includes(scope.stage)) {
        if (completePocGapSet) {
          recommendation = 'Complete POC'
          reason = `The POC is missing: ${missingPocResults.map(item => `${item.criterion} — ${item.completionStep}`).join('; ')}.`
          nextStep = { kind: 'complete-poc', missingCriteria: missingPocResults }
        } else {
          reason = 'The POC is already underway or incomplete; name every missing result and its completion step before recommending Complete POC.'
        }
      } else if (completePocPlan && scope.requiredDecisionDate && facts.pocPlan.to > scope.requiredDecisionDate) {
        reason = `The POC plan ends ${facts.pocPlan.to}, after the required decision date ${scope.requiredDecisionDate}; revise the plan or decision window.`
      } else if (completePocPlan) {
        recommendation = 'Run POC'
        reason = 'The remaining critical uncertainty requires hands-on use and the POC has criteria, an owner, and a timebox.'
        nextStep = {
          kind: 'run-poc',
          plan: {
            owner: facts.pocPlan.owner,
            from: facts.pocPlan.from,
            to: facts.pocPlan.to,
            handsOnUncertainty: true,
            noHardBlocker: true
          }
        }
      } else if (Array.isArray(facts.researchGaps) && facts.researchGaps.length && facts.researchGaps.every(gap => isRecord(gap) && text(gap.gap) && text(gap.boundedNextStep))) {
        recommendation = 'Continue research'
        reason = 'Decision-critical gaps have bounded non-product research steps.'
        nextStep = {
          kind: 'continue-research',
          gaps: facts.researchGaps.map(gap => ({ gap: text(gap.gap), boundedNextStep: text(gap.boundedNextStep) }))
        }
      } else if (isRecord(facts.deferral) && text(facts.deferral.constraint) && text(facts.deferral.trigger) && day(facts.deferral.revisitDate) &&
          facts.deferral.revisitDate > scope.asOf &&
          refsPass(facts.deferral.evidenceIds, 'deferral', index, { beyondVendor: true }) && refsPass(facts.businessNeedEvidenceIds, 'business-need', index, { beyondVendor: true })) {
        recommendation = 'Defer'
        reason = `${facts.deferral.constraint}; revisit ${facts.deferral.revisitDate} when ${facts.deferral.trigger}.`
        nextStep = {
          kind: 'defer',
          constraint: text(facts.deferral.constraint),
          trigger: text(facts.deferral.trigger),
          revisitDate: facts.deferral.revisitDate
        }
        for (const id of facts.deferral.evidenceIds) requiredEvidenceIds.add(id)
        for (const id of facts.businessNeedEvidenceIds) requiredEvidenceIds.add(id)
      }
    }
  }

  const stable = {
    contract: 'software-evaluation-assessment/v1',
    scopeId: scope.scopeId,
    dependenciesId: deps.dependenciesId,
    evidenceId: evidence.evidenceId,
    evaluationContext: {
      asOf: scope.asOf,
      candidate: scope.candidate,
      problem: scope.problem,
      useCases: scope.useCases,
      successCriteria: scope.successCriteria,
      knownBlockers: scope.knownBlockers,
      priorities: scope.priorities,
      currentWorkflow: scope.currentWorkflow,
      requiredDecisionDate: scope.requiredDecisionDate
    },
    stage: scope.stage,
    stageCeiling: scope.stage === 'research' ? 'Run POC' : scope.stage === 'demo' ? 'Run POC' : ['POC planned', 'POC running', 'POC incomplete'].includes(scope.stage) ? 'Complete POC' : 'terminal-positive outcomes',
    recommendation,
    reason,
    nextStep,
    selectedOption: selectedOption ? { id: selectedOption.id, name: selectedOption.name || null, type: selectedOption.type } : null,
    optionResults: optionResults.map(one => ({ id: one.id, name: one.name || null, type: one.type, eligible: one.eligible, reasons: one.reasons, gateEvidenceIds: one.gateEvidenceIds })),
    requiredEvidenceIds: [...requiredEvidenceIds].sort(),
    conflicts: evidence.conflicts,
    evidenceIndex: index,
    coverage: evidence.coverage,
    dataGaps: evidence.coverage.filter(one => one.status !== 'searched'),
    requiredSections: REPORT_SECTIONS
  }
  return { ok: true, problems: [], ...stable, assessmentId: fingerprint(stable, 'assessment') }
}

function checkReport (draft, assessment) {
  const problems = []
  if (!isRecord(assessment) || assessment.ok !== true || !assessment.assessmentId) return { ok: false, problems: ['evaluate-check requires a passing assessment.'] }
  if (canonicalAssessmentId(assessment) !== assessment.assessmentId) return { ok: false, problems: ['The assessment changed after evaluate-assess; regenerate the checked report from a current assessment.'] }
  if (!isRecord(draft)) return { ok: false, problems: ['The report draft is not an object.'] }
  if (draft.assessmentId !== assessment.assessmentId) problems.push('The draft is bound to a different assessment.')
  if (draft.stageCeiling !== assessment.stageCeiling) problems.push('The draft stage ceiling does not match the deterministic assessment.')
  if (draft.recommendation !== assessment.recommendation) problems.push('The draft recommendation does not match the deterministic assessment.')
  if (draft.reason !== assessment.reason) problems.push('The draft reason does not match the deterministic assessment.')
  if (fingerprint(draft.evaluationContext) !== fingerprint(assessment.evaluationContext)) problems.push('The draft evaluation context does not match the accepted scope.')
  if (fingerprint(draft.nextStep === undefined ? null : draft.nextStep) !== fingerprint(assessment.nextStep)) problems.push('The draft next step does not match the deterministic assessment.')
  if (fingerprint(draft.optionResults) !== fingerprint(assessment.optionResults)) problems.push('The draft option gate results do not match the deterministic assessment.')
  if (fingerprint(draft.selectedOption === undefined ? null : draft.selectedOption) !== fingerprint(assessment.selectedOption)) {
    problems.push('The draft selected option does not exactly match the deterministic assessment.')
  }
  if (!['High', 'Medium', 'Low'].includes(draft.confidence)) problems.push('Confidence must be High, Medium, or Low.')
  if (!Array.isArray(draft.sectionOrder) || !sameSet(draft.sectionOrder, REPORT_SECTIONS) || draft.sectionOrder.some((name, index) => name !== REPORT_SECTIONS[index])) {
    problems.push('The report sections are missing, extra, or out of the required order.')
  }
  if (!isRecord(draft.sections)) problems.push('The draft has no sections object.')
  for (const name of REPORT_SECTIONS) {
    if (!draft.sections || !Array.isArray(draft.sections[name]) || !draft.sections[name].length) {
      problems.push(`Section ${JSON.stringify(name)} must list at least one claim-ledger id.`)
    }
  }
  if (!Array.isArray(draft.claims) || !draft.claims.length) problems.push('The draft must carry a non-empty claim-to-source ledger.')
  const claimIds = new Set()
  const allowedClaimFields = new Set(['id', 'claim', 'criterion', 'stance', 'evidenceIds', 'valueKind'])
  for (const [index, claim] of (Array.isArray(draft.claims) ? draft.claims : []).entries()) {
    if (!isRecord(claim) || !text(claim.claim)) { problems.push(`claims[${index}] has no claim.`); continue }
    const unsupported = Object.keys(claim).filter(key => !allowedClaimFields.has(key))
    if (unsupported.length) problems.push(`claims[${index}] contains unsupported fields: ${unsupported.sort().join(', ')}.`)
    const claimId = text(claim.id)
    if (!claimId) problems.push(`claims[${index}] has no stable id.`)
    else if (claimIds.has(claimId)) problems.push(`claims[${index}] repeats id ${JSON.stringify(claimId)}.`)
    else claimIds.add(claimId)
    const conflictClaim = claim.stance === 'conflict'
    if (!Array.isArray(claim.evidenceIds) || (conflictClaim ? claim.evidenceIds.length < 2 : claim.evidenceIds.length !== 1)) problems.push(`claims[${index}] must project ${conflictClaim ? 'both sides of the conflict' : 'exactly one source evidence record'}.`)
    else {
      const records = claim.evidenceIds.map(id => assessment.evidenceIndex[id]).filter(Boolean)
      for (const id of claim.evidenceIds) if (!assessment.evidenceIndex[id]) problems.push(`claims[${index}] cites unknown evidence ${JSON.stringify(id)}.`)
      if (records.some(record => record.criterion !== claim.criterion)) problems.push(`claims[${index}] mixes evidence from a different criterion.`)
      if (!conflictClaim && records.length === 1 && claim.claim !== records[0].claim) problems.push(`claims[${index}] must copy the cited source claim exactly.`)
      if (claim.stance === 'conflict') {
        const stances = new Set(records.map(record => record.stance))
        if (!stances.has('supports') || !stances.has('contradicts')) problems.push(`claims[${index}] does not cite both sides of its stated conflict.`)
      } else if (records.some(record => record.stance !== claim.stance)) {
        problems.push(`claims[${index}] cites evidence with a different stance.`)
      }
      const valued = records.filter(record => isRecord(record.value))
      if (valued.length && !text(claim.valueKind)) problems.push(`claims[${index}] cites structured evidence without naming its value kind.`)
      if (text(claim.valueKind) && (valued.length !== records.length || valued.some(record => record.value.kind !== claim.valueKind))) {
        problems.push(`claims[${index}] does not match the cited structured value kind.`)
      }
    }
  }
  const claimById = Object.fromEntries((Array.isArray(draft.claims) ? draft.claims : []).filter(isRecord).map(claim => [text(claim.id), claim]))
  const checkedClaims = (Array.isArray(draft.claims) ? draft.claims : []).filter(isRecord).map(claim => ({
    id: text(claim.id),
    claim: claim.claim,
    criterion: claim.criterion,
    stance: claim.stance,
    evidenceIds: Array.isArray(claim.evidenceIds) ? [...claim.evidenceIds] : [],
    ...(text(claim.valueKind) ? { valueKind: text(claim.valueKind) } : {})
  }))
  for (const name of REPORT_SECTIONS) {
    if (!draft.sections || !Array.isArray(draft.sections[name])) continue
    for (const [index, rawId] of draft.sections[name].entries()) {
      const id = text(rawId)
      if (!id || id !== rawId) problems.push(`Section ${JSON.stringify(name)} claim id at index ${index} is not canonical text.`)
      else if (!claimIds.has(id)) problems.push(`Section ${JSON.stringify(name)} cites unknown claim ${JSON.stringify(id)}.`)
      else if (!sectionCriterionAllowed(name, text(claimById[id] && claimById[id].criterion))) {
        problems.push(`Section ${JSON.stringify(name)} cites claim ${JSON.stringify(id)} with unrelated criterion ${JSON.stringify(claimById[id] && claimById[id].criterion)}.`)
      }
    }
  }
  const presentedEvidenceIds = new Set()
  for (const name of REPORT_SECTIONS) {
    for (const id of (draft.sections && Array.isArray(draft.sections[name]) ? draft.sections[name] : [])) {
      const claim = claimById[id]
      if (claim && Array.isArray(claim.evidenceIds)) for (const evidenceId of claim.evidenceIds) presentedEvidenceIds.add(evidenceId)
    }
  }
  if (!Array.isArray(assessment.requiredEvidenceIds)) problems.push('The assessment has no required evidence projection.')
  else {
    for (const evidenceId of assessment.requiredEvidenceIds) {
      if (!presentedEvidenceIds.has(evidenceId)) problems.push(`The checked report omits required decision evidence ${JSON.stringify(evidenceId)}.`)
    }
  }
  if (!Array.isArray(draft.coverage)) problems.push('The draft has no source coverage list.')
  else {
    if (fingerprint(draft.coverage) !== fingerprint(assessment.coverage)) problems.push('Draft coverage does not exactly match validated evidence coverage.')
  }
  if (!Array.isArray(draft.dataGaps) || fingerprint(draft.dataGaps) !== fingerprint(assessment.dataGaps)) {
    problems.push('Draft data gaps do not exactly match unavailable and unsearched sources in the assessment.')
  }
  const checked = {
    contract: 'software-evaluation-checked-report/v1',
    assessmentId: assessment.assessmentId,
    evaluationContext: assessment.evaluationContext,
    stageCeiling: assessment.stageCeiling,
    recommendation: assessment.recommendation,
    reason: assessment.reason,
    nextStep: assessment.nextStep,
    optionResults: assessment.optionResults,
    requiredEvidenceIds: assessment.requiredEvidenceIds,
    selectedOption: assessment.selectedOption,
    confidence: draft.confidence,
    sections: Object.fromEntries(REPORT_SECTIONS.map(name => {
      const claims = (Array.isArray(draft.sections && draft.sections[name]) ? draft.sections[name] : []).map(id => {
      const claim = claimById[id]
      return claim ? { claimId: id, claim: claim.claim, criterion: claim.criterion, stance: claim.stance, evidenceIds: claim.evidenceIds } : { claimId: id }
      })
      const context = name === 'Problem and use cases' ? [{ evaluationContext: assessment.evaluationContext }] : []
      const nextStep = name === 'Conditions for the next gate' && assessment.nextStep ? [{ nextStep: assessment.nextStep }] : []
      const coverageGaps = name === 'Data gaps' ? assessment.dataGaps.map(gap => ({ coverageGap: gap })) : []
      return [name, [...context, ...nextStep, ...coverageGaps, ...claims]]
    })),
    sectionOrder: draft.sectionOrder,
    claims: checkedClaims,
    evidenceIndex: assessment.evidenceIndex,
    coverage: assessment.coverage,
    dataGaps: assessment.dataGaps,
    conflicts: assessment.conflicts,
    checked: problems.length === 0,
    note: 'Read-only decision output. This contains no Notion create or update payload and authorizes no purchase or directory change.'
  }
  return problems.length
    ? { ok: false, problems }
    : { ok: true, problems: [], ...checked, reportId: fingerprint(checked, 'checked-report') }
}

module.exports = {
  STAGES,
  NOTION_RELATION_CAP,
  TARGETS,
  DIRECTORY_STATES,
  RECOMMENDATIONS,
  TERMINAL,
  COMMON_WORD_NAMES,
  SOURCE_BOUNDARIES,
  DECISION_METRICS,
  REPORT_SECTIONS,
  sectionCriterionAllowed,
  evaluateScope,
  acceptedScopeProblem,
  surveyPlan,
  relatedReadFingerprint,
  relatedReadAttestation,
  surveyExecutionFingerprint,
  surveySequenceAttestation,
  surveySequenceProblem,
  artifactRows,
  directoryProof,
  relationUrls,
  relationCount,
  relationIncomplete,
  relationMalformed,
  BUILD_OPTION_NAME,
  dependencies,
  refsPass,
  successCriteriaPass,
  blockerResolutionsPass,
  directoryEvidenceProblems,
  accountableChoicePass,
  terminalEligibility,
  metricEvidencePass,
  dominant,
  assessment,
  checkReport
}
