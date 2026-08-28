'use strict'

/**
 * software:evaluate's executable contract.
 *
 * Run: node tests/software-evaluate.test.js
 */

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const evaluateCore = require('../plugins/software/scripts/evaluate')
const evaluate = {
  ...evaluateCore,
  directoryProof (scope, plan, before, detailed, after, context, sequence) {
    return evaluateCore.directoryProof(
      scope, plan, before, detailed, after, context,
      sequence || evaluateCore.surveySequenceAttestation(scope, plan, before, detailed, after)
    )
  }
}
const evidenceContract = require('../plugins/software/scripts/decision-evidence')
const guard = require('../plugins/software/scripts/guard-evidence-safety')
const softwareCommand = require('../plugins/software/scripts/software')
const softwareSchema = require('../plugins/software/scripts/vendor/software-schema')
const processSchema = require('../plugins/software/scripts/vendor/process-schema')
const { pointerFileFor } = require('../plugins/software/scripts/evaluation-run')

let failures = 0
const check = (name, fn) => {
  try {
    fn()
    console.log(`  ok    ${name}`)
  } catch (err) {
    failures++
    console.log(`  FAIL  ${name}`)
    console.log(`        ${err.stack.split('\n').join('\n        ')}`)
  }
}
const clone = value => JSON.parse(JSON.stringify(value))

const TODAY = '2026-08-28'
const RANGE = { from: '2026-01-01', to: TODAY }
const ALTERNATIVE_NAME = 'Named Alternative'
const ALTERNATIVE_ID = `alternative:${ALTERNATIVE_NAME}`

function requestFor (stage = 'research', overrides = {}) {
  return {
    asOf: TODAY,
    candidate: 'Acme Evaluate',
    vendor: 'Acme',
    targetType: 'net-new',
    candidateDirectoryState: 'net-new',
    stage,
    problem: 'The team cannot complete the named workflow reliably.',
    useCases: ['Complete the named workflow against live test data.'],
    successCriteria: ['The live workflow meets its named accuracy target.'],
    priorities: ['fit'],
    sourceBoundaries: {
      'software-directory': { dataSource: 'config-resolved' },
      'user-statement': { people: ['Decision owner', 'Implementation owner', 'Technical owner', 'Budget owner'] },
      'signed-terms': { provider: 'docusign' },
      docusign: { account: 'Test account', dateRange: { ...RANGE } },
      'product-telemetry': { dateRange: { ...RANGE } },
      'technical-spike': { dateRange: { ...RANGE } },
      'vendor-web': { domains: ['vendor.example'], dateRange: { ...RANGE } },
      ramp: { account: 'Test account', dateRange: { ...RANGE } }
    },
    ...overrides
  }
}

function acceptedScope (stage = 'research', overrides = {}) {
  const result = evaluate.evaluateScope(requestFor(stage, overrides))
  assert.strictEqual(result.ok, true, result.problems && result.problems.join('\n'))
  return result
}

const missingPocResult = (scope, completionStep = 'Run the remaining accepted test case.') => ({
  criterion: scope.successCriteria[0],
  completionStep
})

const context = { ok: true, dataSourceId: 'software-data-source', property: logical => logical }
const processNames = {
  properties: { Type: 'Type', 'Last checked for accuracy': 'Last checked for accuracy' },
  values: { Type: Object.fromEntries(processSchema.TYPES.map(type => [type, type])) }
}
const processPageProperties = (type = 'Technical Reference', checked = '2026-08-20') => ({
  Type: { type: 'select', select: { name: type } },
  'Last checked for accuracy': { type: 'date', date: { start: checked, end: null } }
})
const dependenciesFor = (scope, proof, artifacts, names = processNames) => evaluate.dependencies(scope, proof, artifacts, names)

function rowFor (plan, url, values = {}) {
  const row = Object.fromEntries(plan.expectedColumns.map(column => [column, null]))
  row.url = url
  row.createdTime = '2026-08-01T12:00:00.000Z'
  const lastReviewed = plan.columns && plan.columns['Last reviewed']
  if (lastReviewed && typeof lastReviewed === 'object') {
    row[lastReviewed.start] = TODAY
    row[lastReviewed.end] = null
    row[lastReviewed.isDatetime] = false
  }
  return { ...row, ...values }
}

const notionUrl = (hex, label = 'Page') => `https://www.notion.so/${label}-${hex.repeat(32)}`

function execution (plan, name, rows, options = {}) {
  const expected = plan.executions.find(one => one.name === name)
  const query = name === 'software-details' ? plan.queries.details.sql : name.startsWith('manifest-') ? plan.queries.manifest.sql : undefined
  return {
    surveyRunId: plan.surveyRunId,
    execution: name,
    queryFingerprint: expected.queryFingerprint,
    ...(query ? { query } : {}),
    envelopes: [{ results: rows, has_more: false, next_cursor: null }],
    ...options
  }
}

function manifestRow (plan, row, values = {}) {
  const manifest = { url: row.url, createdTime: row.createdTime }
  for (const column of plan.manifestRevisionColumns) {
    if (column !== 'createdTime') manifest[column] = row[column]
  }
  return { ...manifest, ...values }
}

function attestRelatedReads (plan, after, softwareBodies = [], pages = []) {
  after.precedingExecutions = [
    ['affected-software-bodies', softwareBodies],
    ['related-process-pages', pages]
  ].map(([name, fetchedPages]) => ({
    surveyRunId: plan.surveyRunId,
    execution: name,
    queryFingerprint: plan.executions.find(one => one.name === name).queryFingerprint,
    artifactFingerprint: evaluate.relatedReadFingerprint(plan, name, fetchedPages)
  }))
  return after
}

function proofFixture (scope, rows = [], related = {}) {
  const plan = evaluate.surveyPlan({ surveyRunId: 'survey-fixture' }, scope, context)
  const revisions = rows.map(row => manifestRow(plan, row))
  const before = execution(plan, 'manifest-before', revisions)
  const details = execution(plan, 'software-details', rows)
  const after = attestRelatedReads(plan, execution(plan, 'manifest-after', clone(revisions)), related.softwareBodies || [], related.pages || [])
  return { plan, before, details, after }
}

function completeDependencies (scope, rows = [], pages = []) {
  const softwareBodies = rows.map(row => ({ url: row.url, last_edited_time: `${TODAY}T12:00:00-04:00`, body: 'What It Does For Us: fetched test body.' }))
  const fixture = proofFixture(scope, rows, { softwareBodies, pages })
  const proof = evaluate.directoryProof(scope, fixture.plan, fixture.before, fixture.details, fixture.after, context)
  assert.strictEqual(proof.ok, true, proof.problems && proof.problems.join('\n'))
  const dependencies = dependenciesFor(scope, proof, {
    scopeId: scope.scopeId,
    surveyRunId: proof.surveyRunId,
    softwareBodies,
    pages
  })
  assert.strictEqual(dependencies.ok, true, dependencies.problems && dependencies.problems.join('\n'))
  return { ...fixture, proof, dependencies }
}

function baseRecords () {
  const records = [
    { id: 'need', sourceKind: 'user-statement', locator: `user:Decision owner:${TODAY}`, observedAt: TODAY, claim: 'The workflow problem is real and materially unmet.', classification: 'user-statement', criterion: 'business-need', stance: 'supports', scope: {} },
    { id: 'success', sourceKind: 'product-telemetry', locator: 'export:poc-results.csv', observedAt: TODAY, claim: 'The named success criterion passed on live test data.', classification: 'observed-fact', criterion: 'success-criterion', stance: 'supports', scope: {} },
    { id: 'overlap', sourceKind: 'software-directory', locator: 'notion:software:whole-directory', observedAt: TODAY, claim: 'Current-stack overlap was resolved.', classification: 'observed-fact', criterion: 'overlap', stance: 'supports', scope: {} },
    { id: 'implementation', sourceKind: 'user-statement', locator: `user:Implementation owner:${TODAY}`, observedAt: TODAY, claim: 'Implementation work and ownership are understood.', classification: 'user-statement', criterion: 'implementation', stance: 'supports', scope: {} },
    { id: 'migration', sourceKind: 'user-statement', locator: `user:Implementation owner:migration:${TODAY}`, observedAt: TODAY, claim: 'Migration and rollback work are understood.', classification: 'user-statement', criterion: 'migration', stance: 'supports', scope: {} },
    { id: 'security', sourceKind: 'signed-terms', locator: 'contract:security-addendum', observedAt: TODAY, claim: 'Material security and data risks are addressed.', classification: 'observed-fact', criterion: 'security', stance: 'supports', scope: { provider: 'docusign', account: 'Test account' } },
    { id: 'price', sourceKind: 'signed-terms', locator: 'contract:order-form', observedAt: TODAY, claim: 'The current annual price is verified.', classification: 'observed-fact', criterion: 'price', stance: 'supports', scope: { provider: 'docusign', account: 'Test account' }, value: { kind: 'money', amount: 12000, currency: 'USD', period: 'annual', verified: true } },
    { id: 'terms', sourceKind: 'signed-terms', locator: 'contract:order-form:terms', observedAt: TODAY, claim: 'The material terms are verified.', classification: 'observed-fact', criterion: 'terms', stance: 'supports', scope: { provider: 'docusign', account: 'Test account' }, value: { kind: 'material-terms', verified: true } },
    { id: 'spike', sourceKind: 'technical-spike', locator: 'spike:run-42', observedAt: TODAY, claim: 'The internal path worked in a technical spike.', classification: 'observed-fact', criterion: 'technical-spike', stance: 'supports', scope: {} },
    { id: 'behaviors', sourceKind: 'user-statement', locator: 'user:Technical owner:operations', observedAt: TODAY, claim: 'Always-on, integration, data, security, reliability, and support behavior is understood.', classification: 'user-statement', criterion: 'operating-behavior', stance: 'supports', scope: {} },
    { id: 'build-cost', sourceKind: 'technical-spike', locator: 'spike:cost-model', observedAt: TODAY, claim: 'Build and maintenance cost is verified.', classification: 'observed-fact', criterion: 'build-cost', stance: 'supports', scope: {}, value: { kind: 'money', amount: 9000, currency: 'USD', period: 'annual', verified: true } },
    { id: 'technical-owner', sourceKind: 'user-statement', locator: 'user:Technical owner:accountability', observedAt: TODAY, claim: 'A named technical owner can operate the build.', classification: 'user-statement', criterion: 'technical-owner', stance: 'supports', scope: {} },
    { id: 'maintainability', sourceKind: 'technical-spike', locator: 'spike:maintenance-review', observedAt: TODAY, claim: 'The build is maintainable without an unacknowledged key-person dependency.', classification: 'observed-fact', criterion: 'maintainability', stance: 'supports', scope: {} },
    { id: 'hard-stop', sourceKind: 'user-statement', locator: 'user:Decision owner:blocker', observedAt: TODAY, claim: 'A material blocker cannot be resolved.', classification: 'user-statement', criterion: 'hard-stop', stance: 'supports', scope: {} },
    { id: 'deferral', sourceKind: 'user-statement', locator: 'user:Decision owner:deferral', observedAt: TODAY, claim: 'The owner constraint blocks the current decision window.', classification: 'user-statement', criterion: 'deferral', stance: 'supports', scope: {} },
    { id: 'accountable-choice', sourceKind: 'user-statement', locator: 'user:Budget owner:choice', observedAt: TODAY, claim: 'The accountable owner chose the candidate and accepted its exit-cost downside.', classification: 'user-statement', criterion: 'accountable-choice', stance: 'supports', scope: {}, value: { kind: 'accountable-choice', optionId: 'candidate', by: 'Budget owner', date: TODAY, acceptedDownside: 'Higher exit cost', verified: true } },
    { id: 'data-gap', sourceKind: 'user-statement', locator: 'user:Decision owner:data-gap', observedAt: TODAY, claim: 'Decision-critical gaps are reported from the accepted source coverage.', classification: 'user-statement', criterion: 'data-gap', stance: 'context', scope: {} },
    { id: 'coverage', sourceKind: 'user-statement', locator: 'user:Decision owner:coverage', observedAt: TODAY, claim: 'The report accounts for every source in the accepted read scope.', classification: 'user-statement', criterion: 'coverage', stance: 'context', scope: {} }
  ]
  const bindOption = (record, optionId) => {
    record.value = { ...(record.value || { kind: 'option-evidence' }), optionId, verified: true }
  }
  for (const id of ['success', 'overlap', 'implementation', 'migration', 'security', 'price', 'terms']) {
    bindOption(records.find(one => one.id === id), 'candidate')
  }
  records.find(one => one.id === 'success').value.successCriterion = 'The live workflow meets its named accuracy target.'
  const duplicateFor = (optionId, ids, evidencePrefix = optionId) => {
    for (const id of ids) {
      const source = records.find(one => one.id === id)
      const copy = clone(source)
      copy.id = `${evidencePrefix}-${id}`
      copy.locator = `${source.locator}:${evidencePrefix}`
      bindOption(copy, optionId)
      records.push(copy)
    }
  }
  duplicateFor(ALTERNATIVE_ID, ['success', 'overlap', 'implementation', 'migration', 'security', 'price', 'terms'], 'alternative')
  duplicateFor('build', ['success', 'overlap', 'implementation', 'migration', 'security'])
  for (const id of ['spike', 'behaviors', 'build-cost', 'technical-owner', 'maintainability']) {
    bindOption(records.find(one => one.id === id), 'build')
  }
  const metricsByOption = [
    ['candidate', 'candidate', { cost: 4, fit: 5, risk: 4, implementation: 4, exit: 3 }],
    [ALTERNATIVE_ID, 'alternative', { cost: 3, fit: 4, risk: 4, implementation: 4, exit: 4 }],
    ['build', 'build', { cost: 5, fit: 4, risk: 3, implementation: 3, exit: 5 }]
  ]
  for (const [optionId, evidencePrefix, metrics] of metricsByOption) {
    for (const [metric, score] of Object.entries(metrics)) {
      records.push({
        id: `metric-${evidencePrefix}-${metric}`,
        sourceKind: 'technical-spike',
        locator: `normalization:${optionId}:${metric}:${TODAY}`,
        observedAt: TODAY,
        claim: `${optionId} ${metric} was normalized on the shared higher-is-better scale.`,
        classification: 'observed-fact',
        criterion: `decision-metric:${metric}`,
        stance: 'supports',
        scope: {},
        value: { kind: 'normalized-score', optionId, metric, score, direction: 'higher-is-better', verified: true }
      })
    }
  }
  return records
}

function evidenceFor (scope, records = baseRecords(), coverageOverrides = {}) {
  const coverage = Object.keys(scope.sourceBoundaries).map(sourceKind => ({
    sourceKind,
    status: 'searched',
    boundary: clone(scope.sourceBoundaries[sourceKind]),
    ...coverageOverrides[sourceKind]
  }))
  const scoped = records.map(record => {
    const recordScope = { ...(record.scope || {}) }
    const boundary = scope.sourceBoundaries[record.sourceKind] || {}
    if (boundary.dataSource !== undefined && recordScope.dataSource === undefined) recordScope.dataSource = boundary.dataSource
    if (record.sourceKind === 'user-statement' && recordScope.person === undefined) {
      recordScope.person = (boundary.people || []).find(person => record.locator.startsWith(`user:${person}:`))
    }
    return { ...record, scope: recordScope }
  })
  return { scopeId: scope.scopeId, records: scoped, coverage }
}

function evidenceWithMissingCandidatePocResults (scope) {
  return evidenceFor(scope, baseRecords().filter(record => record.id !== 'success'))
}

function recordsWithMetrics (byOption) {
  return baseRecords().map(record => {
    if (!record.value || record.value.kind !== 'normalized-score') return record
    const metrics = byOption[record.value.optionId] || (record.value.optionId === ALTERNATIVE_ID ? byOption.alternative : null)
    if (!metrics) return record
    return { ...record, value: { ...record.value, score: metrics[record.value.metric] } }
  })
}

function candidateOption (overrides = {}) {
  return {
    id: 'candidate',
    type: 'candidate',
    name: 'Acme Evaluate',
    gates: {
      businessNeed: ['need'], success: ['success'], overlap: ['overlap'], implementation: ['implementation'],
      migration: ['migration'], security: ['security'], noMaterialGaps: true, price: ['price'], terms: ['terms']
    },
    metrics: { cost: 4, fit: 5, risk: 4, implementation: 4, exit: 3 },
    metricEvidence: { cost: ['metric-candidate-cost'], fit: ['metric-candidate-fit'], risk: ['metric-candidate-risk'], implementation: ['metric-candidate-implementation'], exit: ['metric-candidate-exit'] },
    ...overrides
  }
}

function alternativeOption (overrides = {}) {
  const name = Object.prototype.hasOwnProperty.call(overrides, 'name') ? overrides.name : ALTERNATIVE_NAME
  return candidateOption({
    id: `alternative:${name}`, type: 'alternative', name,
    gates: {
      businessNeed: ['need'], success: ['alternative-success'], overlap: ['alternative-overlap'], implementation: ['alternative-implementation'],
      migration: ['alternative-migration'], security: ['alternative-security'], noMaterialGaps: true, price: ['alternative-price'], terms: ['alternative-terms']
    },
    metrics: { cost: 3, fit: 4, risk: 4, implementation: 4, exit: 4 },
    metricEvidence: { cost: ['metric-alternative-cost'], fit: ['metric-alternative-fit'], risk: ['metric-alternative-risk'], implementation: ['metric-alternative-implementation'], exit: ['metric-alternative-exit'] },
    ...overrides
  })
}

function buildOption (overrides = {}) {
  const common = candidateOption().gates
  const { price, terms, ...withoutBuy } = common
  return {
    id: 'build',
    type: 'build',
    name: 'Internal build',
    gates: {
      ...withoutBuy,
      success: ['build-success'],
      overlap: ['build-overlap'],
      implementation: ['build-implementation'],
      migration: ['build-migration'],
      security: ['build-security'],
      technicalSpike: ['spike'],
      operatingBehaviors: ['behaviors'],
      buildCost: ['build-cost'],
      technicalOwner: ['technical-owner'],
      maintainability: ['maintainability']
    },
    metrics: { cost: 5, fit: 4, risk: 3, implementation: 3, exit: 5 },
    metricEvidence: { cost: ['metric-build-cost'], fit: ['metric-build-fit'], risk: ['metric-build-risk'], implementation: ['metric-build-implementation'], exit: ['metric-build-exit'] },
    ...overrides
  }
}

function assess (scope, dependencies, request = {}, evidence = evidenceFor(scope)) {
  const boundEvidence = clone(evidence)
  for (const record of boundEvidence.records.filter(one => one.sourceKind === 'software-directory' && (!one.value || one.value.directoryProofId === undefined))) {
    record.value = {
      ...(record.value || {}),
      kind: 'software-directory-proof',
      directoryProofId: dependencies.directoryProofId,
      dependenciesId: dependencies.dependenciesId,
      surveyRunId: dependencies.surveyRunId,
      verified: true
    }
  }
  const validated = evidenceContract.validateEvidence(scope, boundEvidence)
  assert.strictEqual(validated.ok, true, validated.problems && validated.problems.join('\n'))
  return evaluate.assessment({
    scopeId: scope.scopeId,
    dependenciesId: dependencies.dependenciesId,
    evidenceId: validated.evidenceId,
    facts: {},
    options: [],
    ...request
  }, scope, dependencies, boundEvidence)
}

const reportSectionClaims = {
  'Recommendation and confidence': ['need'],
  'Problem and use cases': ['need'],
  'What the evidence proved': ['success'],
  'Current stack and overlap': ['overlap'],
  Alternatives: ['metric-alternative-fit'],
  'Cost and total ownership picture': ['price'],
  'Implementation, migration, security, and governance': ['implementation'],
  'Decision roles and required approvals': ['accountable-choice'],
  'Conditions for the next gate': ['success'],
  'Data gaps': ['data-gap'],
  'Coverage and sources': ['coverage']
}

function reportDraft (assessment, confidence = 'High') {
  const requiredEvidenceIds = Array.isArray(assessment.requiredEvidenceIds) ? assessment.requiredEvidenceIds : []
  const ids = [...new Set(['need', 'price', ...Object.values(reportSectionClaims).flat(), ...requiredEvidenceIds])]
  const claims = ids.map(id => {
    const record = assessment.evidenceIndex[id]
    const claim = { id: `${id}-claim`, claim: record.claim, criterion: record.criterion, stance: record.stance, evidenceIds: [id] }
    if (record.value) claim.valueKind = record.value.kind
    return claim
  })
  const claimIdFor = evidenceId => `${evidenceId}-claim`
  return {
    assessmentId: assessment.assessmentId,
    evaluationContext: clone(assessment.evaluationContext),
    stageCeiling: assessment.stageCeiling,
    recommendation: assessment.recommendation,
    reason: assessment.reason,
    nextStep: clone(assessment.nextStep),
    optionResults: clone(assessment.optionResults),
    selectedOption: clone(assessment.selectedOption),
    confidence,
    sectionOrder: [...evaluate.REPORT_SECTIONS],
    sections: Object.fromEntries(Object.entries(reportSectionClaims).map(([name, evidenceIds]) => [
      name,
      [...new Set([...evidenceIds, ...(name === 'What the evidence proved' ? requiredEvidenceIds : [])])].map(claimIdFor)
    ])),
    claims,
    coverage: clone(assessment.coverage),
    dataGaps: clone(assessment.dataGaps)
  }
}

console.log('\nsoftware:evaluate\n')

check('scope accepts every exact stage and keeps POC states distinct', () => {
  for (const stage of evaluate.STAGES) {
    const scope = acceptedScope(stage)
    assert.strictEqual(scope.stage, stage)
  }
})

check('scope refuses invalid stages, dates, empty use cases, and same-name replacements', () => {
  for (const patch of [
    { stage: 'trial' },
    { asOf: '2026-02-30' },
    { useCases: [] },
    { targetType: 'replacement', replacementTool: 'Acme Evaluate' },
    { targetType: 'existing', candidateDirectoryState: 'net-new' },
    { targetType: 'net-new', candidateDirectoryState: 'existing' }
  ]) assert.strictEqual(evaluate.evaluateScope(requestFor('research', patch)).ok, false)
})

check('scope refuses malformed or silently empty known blockers', () => {
  for (const knownBlockers of ['A blocker', [null], [''], ['One blocker', '']]) {
    const result = evaluate.evaluateScope(requestFor('research', { knownBlockers }))
    assert.strictEqual(result.ok, false)
    assert.match(result.problems.join(' '), /knownBlockers/)
  }
  assert.deepStrictEqual(acceptedScope('research', { knownBlockers: ['A named blocker'] }).knownBlockers, ['A named blocker'])
})

check('tie priorities are validated and bound into the accepted scope', () => {
  for (const priorities of ['fit', [''], ['fit', 'fit'], ['revenue']]) {
    const result = evaluate.evaluateScope(requestFor('research', { priorities }))
    assert.strictEqual(result.ok, false)
    assert.match(result.problems.join(' '), /priorities/)
  }
  const scope = acceptedScope('final decision', { priorities: ['risk', 'fit'] })
  assert.deepStrictEqual(scope.priorities, ['risk', 'fit'])
  const { dependencies } = completeDependencies(scope)
  const result = assess(scope, dependencies, { options: [candidateOption(), alternativeOption()], priorities: ['fit'] })
  assert.strictEqual(result.ok, false)
  assert.match(result.problems.join(' '), /priorities.*accepted in scope/)
})

check('common-word product names require disambiguation before search', () => {
  const refused = evaluate.evaluateScope(requestFor('research', { candidate: 'Clay', searchQualifier: '' }))
  assert.strictEqual(refused.ok, false)
  assert.match(refused.problems.join(' '), /common-word name/)
  assert.strictEqual(evaluate.evaluateScope(requestFor('research', { candidate: 'Clay', searchQualifier: 'Clay data enrichment platform' })).ok, true)
})

check('scope refuses unbounded mail, files, finance, Slack, and web reads', () => {
  const cases = [
    { gmail: { mailbox: 'other@example.com', dateRange: { ...RANGE } } },
    { gmail: { dateRange: { ...RANGE } } },
    { 'google-drive': { dateRange: { ...RANGE } } },
    { ramp: { dateRange: { ...RANGE } } },
    { slack: { channels: [], allDirectMessages: true, directMessages: [], dateRange: { ...RANGE } } },
    { slack: { channels: [], directMessages: [], dateRange: { ...RANGE } } },
    { slack: { channels: [], directMessages: ['all'], dateRange: { ...RANGE } } },
    { slack: { channels: [], directMessages: ['all DMs'], dateRange: { ...RANGE } } },
    { slack: { channels: [], directMessages: ['all my direct messages'], dateRange: { ...RANGE } } },
    { slack: { channels: [''], directMessages: [], dateRange: { ...RANGE } } },
    { slack: { channels: ['same-locator'], directMessages: ['same-locator'], dateRange: { ...RANGE } } },
    { 'google-calendar': { dateRange: { ...RANGE } } },
    { granola: { dateRange: { ...RANGE } } },
    { gong: { dateRange: { ...RANGE } } },
    { 'vendor-web': { domains: [], dateRange: { ...RANGE } } }
  ]
  for (const sourceBoundaries of cases) {
    const result = evaluate.evaluateScope(requestFor('research', { sourceBoundaries }))
    assert.strictEqual(result.ok, false)
  }
})

check('web boundaries accept only canonical hostnames and authorize exact hosts', () => {
  for (const domain of ['https://vendor.example/path', 'not a domain', 'com', 'vendor', '-vendor.example', 'vendor.example/path', '127.0.0.1']) {
    const result = evaluate.evaluateScope(requestFor('research', {
      sourceBoundaries: { 'software-directory': {}, 'vendor-web': { domains: [domain], dateRange: { ...RANGE } } }
    }))
    assert.strictEqual(result.ok, false, domain)
  }
  const scope = acceptedScope('research', {
    sourceBoundaries: { 'software-directory': {}, 'vendor-web': { domains: ['Vendor.Example'], dateRange: { ...RANGE } } }
  })
  assert.deepStrictEqual(scope.sourceBoundaries['vendor-web'].domains, ['vendor.example'])
  const document = { scope, softwareDataSourceUrl: 'notion://software-source', notionPageIds: [] }
  assert.strictEqual(guard.decision({ tool_name: 'WebSearch', tool_input: { query: `site:vendor.example after:${RANGE.from} before:${RANGE.to}` } }, document).allow, true)
  assert.strictEqual(guard.decision({ tool_name: 'WebSearch', tool_input: { query: `site:docs.vendor.example after:${RANGE.from} before:${RANGE.to}` } }, document).allow, false)
  const subdomainEvidence = evidenceFor(scope, [{
    id: 'subdomain', sourceKind: 'vendor-web', locator: 'https://docs.vendor.example/claim', observedAt: TODAY,
    claim: 'A claim from an unapproved host.', classification: 'vendor-claim', criterion: 'context', stance: 'context',
    scope: { url: 'https://docs.vendor.example/claim' }
  }])
  assert.strictEqual(evidenceContract.validateEvidence(scope, subdomainEvidence).ok, false)
})

check('user exports require and enforce one exact approved artifact locator', () => {
  const missing = evaluate.evaluateScope(requestFor('research', {
    sourceBoundaries: { 'software-directory': {}, 'user-export': { dateRange: { ...RANGE } } }
  }))
  assert.strictEqual(missing.ok, false)

  const artifact = path.join(os.tmpdir(), 'approved-evaluation.csv')
  const scope = acceptedScope('research', {
    sourceBoundaries: { 'software-directory': {}, 'user-export': { artifact, dateRange: { ...RANGE } } }
  })
  const record = { id: 'export-fact', sourceKind: 'user-export', locator: artifact, observedAt: TODAY, claim: 'The exact export contains the fact.', classification: 'observed-fact', criterion: 'context', stance: 'context', scope: {} }
  assert.strictEqual(evidenceContract.validateEvidence(scope, evidenceFor(scope, [record])).ok, true)
  record.locator = path.join(os.tmpdir(), 'unapproved.csv')
  const refused = evidenceContract.validateEvidence(scope, evidenceFor(scope, [record]))
  assert.strictEqual(refused.ok, false)
  assert.match(refused.problems.join('\n'), /exact approved artifact/)
})

check('scope canonicalizes date bounds and refuses invalid explicit freshness limits', () => {
  const canonical = acceptedScope('research', {
    sourceBoundaries: { ramp: { account: 'A', dateRange: { from: ' 2026-01-01', to: '2026-08-28 ' } } }
  })
  assert.deepStrictEqual(canonical.sourceBoundaries.ramp.dateRange, RANGE)
  for (const artifactMaxAgeDays of ['30', 0, -1, 1.5]) {
    assert.strictEqual(evaluate.evaluateScope(requestFor('research', { artifactMaxAgeDays })).ok, false)
  }
  assert.strictEqual(acceptedScope('research', { artifactMaxAgeDays: 30 }).artifactMaxAgeDays, 30)
})

check('scope rejects blank entries in every approved locator list', () => {
  const cases = [
    { 'google-calendar': { meetings: ['meeting-1', ''], dateRange: { ...RANGE } } },
    { granola: { meetings: ['meeting-1', ''], dateRange: { ...RANGE } } },
    { gong: { calls: ['call-1', ''], dateRange: { ...RANGE } } },
    { 'vendor-web': { domains: ['vendor.example', ''], dateRange: { ...RANGE } } },
    { 'user-statement': { people: ['Decision owner', ''] } }
  ]
  for (const sourceBoundaries of cases) {
    assert.strictEqual(evaluate.evaluateScope(requestFor('research', { sourceBoundaries: { 'software-directory': {}, ...sourceBoundaries } })).ok, false)
  }
})

check('scope canonicalizes the Software directory boundary and refuses conflicting locators', () => {
  const canonical = acceptedScope('research', { sourceBoundaries: { 'software-directory': {} } })
  assert.deepStrictEqual(canonical.sourceBoundaries['software-directory'], { dataSource: 'config-resolved' })
  for (const boundary of [{ dataSource: 'another-source' }, { dataSource: 'config-resolved', query: 'partial' }, 'config-resolved']) {
    const result = evaluate.evaluateScope(requestFor('research', { sourceBoundaries: { 'software-directory': boundary } }))
    assert.strictEqual(result.ok, false)
  }
})

check('survey binds ordered queries to one scope, data source, run, and fingerprints', () => {
  const scope = acceptedScope()
  const plan = evaluate.surveyPlan({ surveyRunId: 'run-1' }, scope, context)
  assert.strictEqual(plan.surveyRunId, 'run-1')
  assert.strictEqual(plan.scopeId, scope.scopeId)
  assert.strictEqual(plan.softwareDataSourceId, context.dataSourceId)
  assert.deepStrictEqual(plan.executions.map(one => one.name), ['manifest-before', 'software-details', 'affected-software-bodies', 'related-process-pages', 'manifest-after'])
  assert.strictEqual(plan.executions[0].queryFingerprint, plan.executions[4].queryFingerprint)
  assert.notStrictEqual(plan.queries.manifest.fingerprint, plan.queries.details.fingerprint)
  assert.deepStrictEqual(Object.keys(plan.columns).filter(name => name !== 'url').sort(), softwareSchema.IDENTITY_PROPERTIES.filter(name => name !== 'Created time').sort())
})

check('downstream assessment refuses a scope changed after acceptance', () => {
  const scope = acceptedScope('research')
  const { dependencies } = completeDependencies(scope)
  const changed = clone(scope)
  changed.stage = 'final decision'
  assert.throws(() => evaluate.surveyPlan({ surveyRunId: 'changed' }, changed, context), /changed after evaluate-scope/)
  const result = evaluate.assessment({}, changed, dependencies, {})
  assert.strictEqual(result.ok, false)
  assert.match(result.problems.join(' '), /changed after evaluate-scope/)
})

check('directory proof rebuilds and refuses a reduced or altered survey plan', () => {
  const scope = acceptedScope()
  const fixture = proofFixture(scope, [])
  const reduced = clone(fixture.plan)
  reduced.expectedColumns = ['createdTime', 'url']
  reduced.manifestRevisionColumns = ['createdTime']
  reduced.columns = { url: 'url' }
  assert.strictEqual(evaluate.directoryProof(scope, reduced, fixture.before, fixture.details, fixture.after, context).ok, false)
  assert.strictEqual(evaluate.directoryProof(scope, fixture.plan, fixture.before, fixture.details, fixture.after).ok, false)
})

check('directory proof accepts complete stable bookends and embeds validated rows', () => {
  const scope = acceptedScope()
  const fixture = proofFixture(scope, [])
  assert.strictEqual(evaluateCore.directoryProof(scope, fixture.plan, fixture.before, fixture.details, fixture.after, context).ok, false)
  const sequence = evaluate.surveySequenceAttestation(scope, fixture.plan, fixture.before, fixture.details, fixture.after)
  const changedSequence = clone(sequence)
  changedSequence.sequenceId = 'survey-sequence:' + '0'.repeat(64)
  assert.strictEqual(evaluateCore.directoryProof(scope, fixture.plan, fixture.before, fixture.details, fixture.after, context, changedSequence).ok, false)
  const changedDetails = clone(fixture.details)
  changedDetails.envelopes[0].transport_note = 'not in the captured response'
  assert.strictEqual(evaluateCore.directoryProof(scope, fixture.plan, fixture.before, changedDetails, fixture.after, context, sequence).ok, false)
  const proof = evaluateCore.directoryProof(scope, fixture.plan, fixture.before, fixture.details, fixture.after, context, sequence)
  assert.strictEqual(proof.ok, true)
  assert.strictEqual(proof.count, 0)
  assert.match(proof.surveySequenceId, /^survey-sequence:/)
  assert.match(proof.proofId, /^directory-proof:/)
})

check('directory proof binds both related page reads inside the manifest bookends', () => {
  const scope = acceptedScope()
  const fixture = proofFixture(scope, [])
  const missing = clone(fixture.after)
  delete missing.precedingExecutions
  assert.strictEqual(evaluate.directoryProof(scope, fixture.plan, fixture.before, fixture.details, missing, context).ok, false)

  const extra = clone(fixture.after)
  extra.precedingExecutions.push({ execution: 'unplanned-read', surveyRunId: fixture.plan.surveyRunId, queryFingerprint: 'query:extra', artifactFingerprint: 'related-read:' + '1'.repeat(64) })
  assert.strictEqual(evaluate.directoryProof(scope, fixture.plan, fixture.before, fixture.details, extra, context).ok, false)

  const changed = clone(fixture.after)
  changed.precedingExecutions[0].artifactFingerprint = 'related-read:' + '0'.repeat(64)
  const proof = evaluate.directoryProof(scope, fixture.plan, fixture.before, fixture.details, changed, context)
  assert.strictEqual(proof.ok, true)
  const deps = dependenciesFor(scope, proof, { scopeId: scope.scopeId, surveyRunId: proof.surveyRunId, softwareBodies: [], pages: [] })
  assert.strictEqual(deps.ok, false)
  assert.match(deps.problems.join(' '), /not the exact page-read artifact attested/)
})

check('fixed attestation command produces both related-read fingerprints without arbitrary Node', () => {
  const scope = acceptedScope()
  const fixture = proofFixture(scope, [])
  const artifactPages = { scopeId: scope.scopeId, surveyRunId: fixture.plan.surveyRunId, softwareBodies: [], pages: [] }
  const direct = evaluate.relatedReadAttestation(scope, fixture.plan, artifactPages)
  assert.strictEqual(direct.ok, true, direct.problems && direct.problems.join('\n'))
  assert.deepStrictEqual(direct.precedingExecutions, fixture.after.precedingExecutions)
  assert.strictEqual(evaluate.relatedReadAttestation(scope, fixture.plan, { ...artifactPages, surveyRunId: 'other' }).ok, false)

  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'software-attestation-'))
  const write = (name, value) => {
    const file = path.join(runDir, name)
    fs.writeFileSync(file, JSON.stringify(value))
    return file
  }
  const output = []
  const originalLog = console.log
  const originalAttest = guard.attestRelatedReadSequence
  try {
    guard.attestRelatedReadSequence = (input, accepted, plan, artifacts) => evaluate.relatedReadAttestation(accepted, plan, artifacts)
    console.log = value => output.push(String(value))
    softwareCommand.commands['evaluate-attest-related'](write('scope.json', scope), write('plan.json', fixture.plan), write('pages.json', artifactPages))
    assert.deepStrictEqual(JSON.parse(output.join('')).precedingExecutions, fixture.after.precedingExecutions)
  } finally {
    guard.attestRelatedReadSequence = originalAttest
    console.log = originalLog
    fs.rmSync(runDir, { recursive: true, force: true })
  }
})

check('directory proof refuses unconsumed continuation and truncation', () => {
  const scope = acceptedScope()
  const fixture = proofFixture(scope, [])
  const continuation = clone(fixture.before)
  continuation.envelopes[0] = { results: [], has_more: true, next_cursor: 'next' }
  assert.strictEqual(evaluate.directoryProof(scope, fixture.plan, continuation, fixture.details, fixture.after, context).ok, false)
  const truncated = clone(fixture.details)
  truncated.envelopes[0].truncated = true
  assert.strictEqual(evaluate.directoryProof(scope, fixture.plan, fixture.before, truncated, fixture.after, context).ok, false)
  const tailOnly = clone(fixture.after)
  tailOnly.envelopes[0].request_cursor = 'earlier-page-cursor'
  assert.strictEqual(evaluate.directoryProof(scope, fixture.plan, fixture.before, fixture.details, tailOnly, context).ok, false)
})

check('directory proof refuses error-bearing response envelopes even when they contain result-shaped data', () => {
  const scope = acceptedScope()
  const fixture = proofFixture(scope, [])
  fixture.before.envelopes[0].isError = true
  fixture.before.envelopes[0].error = 'connector failed after returning stale result-shaped content'
  const result = evaluate.directoryProof(scope, fixture.plan, fixture.before, fixture.details, fixture.after, context)
  assert.strictEqual(result.ok, false)
  assert.match(result.problems.join(' '), /reports an error/)
})

check('directory proof refuses missing completion signals and query fingerprints', () => {
  const scope = acceptedScope()
  const fixture = proofFixture(scope, [])
  delete fixture.details.envelopes[0].has_more
  assert.strictEqual(evaluate.directoryProof(scope, fixture.plan, fixture.before, fixture.details, fixture.after, context).ok, false)
  const fixture2 = proofFixture(scope, [])
  fixture2.after.queryFingerprint = 'query:wrong'
  assert.strictEqual(evaluate.directoryProof(scope, fixture2.plan, fixture2.before, fixture2.details, fixture2.after, context).ok, false)

  const fixture3 = proofFixture(scope, [])
  fixture3.details.query += ' WHERE 1 = 0'
  fixture3.details.queryFingerprint = evidenceContract.fingerprint({ dataSourceId: fixture3.plan.softwareDataSourceId, sql: fixture3.details.query }, 'query')
  const filtered = evaluate.directoryProof(scope, fixture3.plan, fixture3.before, fixture3.details, fixture3.after, context)
  assert.strictEqual(filtered.ok, false)
  assert.match(filtered.problems.join(' '), /exact SQL|actual request SQL/)
})

check('directory proof refuses manifest mismatch, duplicate URLs, and omitted expected columns', () => {
  const scope = acceptedScope()
  const fixture = proofFixture(scope, [])
  fixture.before.envelopes[0].results.push(manifestRow(fixture.plan, rowFor(fixture.plan, notionUrl('c', 'Missing'))))
  const mismatched = evaluate.directoryProof(scope, fixture.plan, fixture.before, fixture.details, fixture.after, context)
  assert.strictEqual(mismatched.ok, false)
  assert.match(mismatched.problems.join('\n'), /does not equal independently fetched manifest length/)
  assert.match(mismatched.problems.join('\n'), /before manifest and detailed rows/)
  assert.match(mismatched.problems.join('\n'), /bookended manifests/)

  const plan = evaluate.surveyPlan({ surveyRunId: 'dup' }, scope, context)
  const one = rowFor(plan, notionUrl('a'))
  const details = execution(plan, 'software-details', [one, clone(one)])
  const manifests = [manifestRow(plan, one)]
  const duplicateAfter = attestRelatedReads(plan, execution(plan, 'manifest-after', manifests))
  assert.strictEqual(evaluate.directoryProof(scope, plan, execution(plan, 'manifest-before', manifests), details, duplicateAfter, context).ok, false)

  const fixture3 = proofFixture(scope, [rowFor(evaluate.surveyPlan({ surveyRunId: 'temp' }, scope, context), notionUrl('b'))])
  delete fixture3.details.envelopes[0].results[0].Name
  assert.strictEqual(evaluate.directoryProof(scope, fixture3.plan, fixture3.before, fixture3.details, fixture3.after, context).ok, false)
})

check('same-count page replacement and relation edit revisions invalidate the survey', () => {
  const scope = acceptedScope()
  const plan = evaluate.surveyPlan({ surveyRunId: 'changes' }, scope, context)
  const a = rowFor(plan, notionUrl('a'))
  const b = rowFor(plan, notionUrl('b'))
  const before = execution(plan, 'manifest-before', [
    manifestRow(plan, a),
    manifestRow(plan, b)
  ])
  const details = execution(plan, 'software-details', [a, b])
  const replacement = attestRelatedReads(plan, execution(plan, 'manifest-after', [
    manifestRow(plan, a),
    manifestRow(plan, { ...b, url: notionUrl('c') })
  ]))
  assert.strictEqual(evaluate.directoryProof(scope, plan, before, details, replacement, context).ok, false)
  const relationEdit = attestRelatedReads(plan, execution(plan, 'manifest-after', [
    manifestRow(plan, a, { 'Integrates with': notionUrl('d', 'Dependency') }),
    manifestRow(plan, b)
  ]))
  assert.strictEqual(evaluate.directoryProof(scope, plan, before, details, relationEdit, context).ok, false)
})

check('detailed values must match the bookended field revision', () => {
  const scope = acceptedScope()
  const plan = evaluate.surveyPlan({ surveyRunId: 'detail-mismatch' }, scope, context)
  const row = rowFor(plan, notionUrl('a'), { 'Integrates with': [] })
  const fixture = proofFixture(scope, [row])
  fixture.details.envelopes[0].results[0]['Integrates with'] = [notionUrl('b')]
  const result = evaluate.directoryProof(scope, fixture.plan, fixture.before, fixture.details, fixture.after, context)
  assert.strictEqual(result.ok, false)
  assert.match(result.problems.join('\n'), /do not match the bookended field revision/)
})

check('directory proof refuses a missing stable revision and a different scope', () => {
  const scope = acceptedScope()
  const plan = evaluate.surveyPlan({ surveyRunId: 'revision' }, scope, context)
  const row = rowFor(plan, notionUrl('a'))
  const manifest = [manifestRow(plan, row)]
  const missingColumn = plan.manifestRevisionColumns.find(column => column !== 'createdTime')
  delete manifest[0][missingColumn]
  row[missingColumn] = undefined
  const missingAfter = attestRelatedReads(plan, execution(plan, 'manifest-after', manifest))
  assert.strictEqual(evaluate.directoryProof(scope, plan, execution(plan, 'manifest-before', manifest), execution(plan, 'software-details', [row]), missingAfter, context).ok, false)
  const other = acceptedScope('demo')
  const fixture = proofFixture(scope, [])
  assert.strictEqual(evaluate.directoryProof(other, fixture.plan, fixture.before, fixture.details, fixture.after, context).ok, false)
})

check('net-new absence passes, while missing existing and replacement rows fail', () => {
  const netNew = acceptedScope()
  const netNewComplete = completeDependencies(netNew)
  assert.strictEqual(netNewComplete.dependencies.ok, true)
  assert.strictEqual(dependenciesFor(netNew, netNewComplete.proof, {
    scopeId: netNew.scopeId, surveyRunId: netNewComplete.proof.surveyRunId, pages: []
  }).ok, false)
  const existing = acceptedScope('research', { targetType: 'existing', candidateDirectoryState: 'existing' })
  const existingFixture = proofFixture(existing, [])
  const existingProof = evaluate.directoryProof(existing, existingFixture.plan, existingFixture.before, existingFixture.details, existingFixture.after, context)
  assert.strictEqual(dependenciesFor(existing, existingProof, { scopeId: existing.scopeId, surveyRunId: existingProof.surveyRunId, softwareBodies: [], pages: [] }).ok, false)
  const replacement = acceptedScope('research', { targetType: 'replacement', replacementTool: 'Legacy Tool' })
  const replacementFixture = proofFixture(replacement, [])
  const replacementProof = evaluate.directoryProof(replacement, replacementFixture.plan, replacementFixture.before, replacementFixture.details, replacementFixture.after, context)
  assert.strictEqual(dependenciesFor(replacement, replacementProof, { scopeId: replacement.scopeId, surveyRunId: replacementProof.surveyRunId, softwareBodies: [], pages: [] }).ok, false)
})

check('net-new evaluations fetch the whole current stack and every directly related artifact for overlap', () => {
  const scope = acceptedScope()
  const plan = evaluate.surveyPlan({ surveyRunId: 'net-new-overlap' }, scope, context)
  const artifactUrl = notionUrl('e', 'Current-Stack-Artifact')
  const current = rowFor(plan, notionUrl('d', 'Current-Stack'), { Name: 'Current Stack Tool', 'Integrates with': [], Artifacts: [artifactUrl] })
  const page = {
    url: artifactUrl,
    properties: processPageProperties(),
    last_edited_time: `${TODAY}T12:00:00-04:00`,
    body: 'Current-stack scope and overlap detail.'
  }
  const complete = completeDependencies(scope, [current], [page])
  assert.deepStrictEqual(complete.dependencies.affectedRows[0].reasons, ['current-stack-overlap'])
  const missing = dependenciesFor(scope, complete.proof, {
    scopeId: scope.scopeId,
    surveyRunId: complete.proof.surveyRunId,
    softwareBodies: [],
    pages: []
  })
  assert.strictEqual(missing.ok, false)
  assert.match(missing.problems.join(' '), /was not fetched with its page body|was not fetched/)
})

function replacementFixture ({ pagePatch = {}, rowPatch = {}, softwareBodyPatch = {}, softwareBodiesTransform, pagesTransform } = {}) {
  const scope = acceptedScope('POC complete', { targetType: 'replacement', replacementTool: 'Legacy Tool' })
  const plan = evaluate.surveyPlan({ surveyRunId: 'replacement' }, scope, context)
  const targetUrl = notionUrl('a', 'Legacy')
  const reverseUrl = notionUrl('b', 'Reverse')
  const artifactUrl = notionUrl('c', 'Technical-Reference')
  const rows = [
    rowFor(plan, targetUrl, { Name: 'Legacy Tool', 'Integrates with': [], Artifacts: [artifactUrl], ...rowPatch }),
    rowFor(plan, reverseUrl, { Name: 'Reverse Dependent', 'Integrates with': [targetUrl], Artifacts: [], ...rowPatch })
  ]
  const page = { url: artifactUrl, properties: processPageProperties(), last_edited_time: '2026-08-20T00:00:00Z', body: 'Wiring and teardown steps.', ...pagePatch }
  let softwareBodies = [targetUrl, reverseUrl].map(url => ({ url, last_edited_time: `${TODAY}T12:00:00-04:00`, body: 'What It Does For Us: fetched consequence.', ...softwareBodyPatch }))
  if (typeof softwareBodiesTransform === 'function') softwareBodies = softwareBodiesTransform(softwareBodies)
  let pages = [page]
  if (typeof pagesTransform === 'function') pages = pagesTransform(pages)
  const fixture = proofFixture(scope, rows, { softwareBodies, pages })
  const proof = evaluate.directoryProof(scope, fixture.plan, fixture.before, fixture.details, fixture.after, context)
  return { scope, ...fixture, proof, targetUrl, reverseUrl, artifactUrl, page: pages[0] || page, pages, softwareBodies }
}

check('dependencies find reverse-only rows even when the target relation is empty', () => {
  const fixture = replacementFixture()
  const result = dependenciesFor(fixture.scope, fixture.proof, { scopeId: fixture.scope.scopeId, surveyRunId: fixture.proof.surveyRunId, softwareBodies: fixture.softwareBodies, pages: [fixture.page] })
  assert.strictEqual(result.ok, true, result.problems && result.problems.join('\n'))
  assert.deepStrictEqual(result.outbound, [])
  assert.deepStrictEqual(result.reverseOnly, [fixture.reverseUrl])
  assert.deepStrictEqual(result.expectedArtifactUrls, [fixture.artifactUrl])
  assert.match(result.artifactPages[0].body, /Wiring/)
})

check('dependencies use config-resolved review dates when Notion page fetches omit edit timestamps', () => {
  const fixture = replacementFixture({
    rowPatch: {
      'date:Last reviewed:start': TODAY,
      'date:Last reviewed:end': null,
      'date:Last reviewed:is_datetime': false
    },
    softwareBodyPatch: { last_edited_time: undefined },
    pagePatch: {
      last_edited_time: undefined,
      properties: {
        Type: { type: 'select', select: { name: 'Technical Reference' } },
        'Last checked for accuracy': { type: 'date', date: { start: '2026-08-20', end: null } }
      }
    }
  })
  const result = dependenciesFor(fixture.scope, fixture.proof, {
    scopeId: fixture.scope.scopeId,
    surveyRunId: fixture.proof.surveyRunId,
    softwareBodies: fixture.softwareBodies,
    pages: fixture.pages
  })
  assert.strictEqual(result.ok, true, result.problems && result.problems.join('\n'))
  assert.strictEqual(result.softwareBodies.every(page => page.sourceDateKind === 'directory-last-reviewed'), true)
  assert.strictEqual(result.artifactPages[0].sourceDateKind, 'process-last-checked')
  assert.strictEqual(result.artifactPages[0].sourceDate, '2026-08-20')

  const flattened = replacementFixture({
    pagePatch: {
      last_edited_time: undefined,
      properties: {
        Type: 'Technical Reference',
        'date:Last checked for accuracy:start': '2026-08-20',
        'date:Last checked for accuracy:is_datetime': 0
      }
    }
  })
  const flattenedResult = dependenciesFor(flattened.scope, flattened.proof, {
    scopeId: flattened.scope.scopeId,
    surveyRunId: flattened.proof.surveyRunId,
    softwareBodies: flattened.softwareBodies,
    pages: flattened.pages
  })
  assert.strictEqual(flattenedResult.ok, true, flattenedResult.problems && flattenedResult.problems.join('\n'))
  assert.strictEqual(flattenedResult.artifactPages[0].sourceDateKind, 'process-last-checked')
  assert.strictEqual(flattenedResult.artifactPages[0].sourceDate, '2026-08-20')

  const missing = replacementFixture({
    rowPatch: { 'date:Last reviewed:start': null },
    softwareBodyPatch: { last_edited_time: undefined },
    pagePatch: {
      last_edited_time: undefined,
      properties: { Type: { type: 'select', select: { name: 'Technical Reference' } } }
    }
  })
  assert.strictEqual(dependenciesFor(missing.scope, missing.proof, {
    scopeId: missing.scope.scopeId,
    surveyRunId: missing.proof.surveyRunId,
    softwareBodies: missing.softwareBodies,
    pages: missing.pages
  }).ok, false)
})

check('generic page edits cannot refresh authoritative Software or Process freshness', () => {
  const fixture = replacementFixture({
    rowPatch: { 'date:Last reviewed:start': '2024-01-01' },
    softwareBodyPatch: { last_edited_time: `${TODAY}T12:00:00-04:00` },
    pagePatch: {
      last_edited_time: `${TODAY}T12:00:00-04:00`,
      properties: processPageProperties('Technical Reference', '2024-01-01')
    }
  })
  const result = dependenciesFor(fixture.scope, fixture.proof, {
    scopeId: fixture.scope.scopeId,
    surveyRunId: fixture.proof.surveyRunId,
    softwareBodies: fixture.softwareBodies,
    pages: fixture.pages
  })
  assert.strictEqual(result.ok, false)
  assert.match(result.problems.join(' '), /Software body .*too stale/)
  assert.match(result.problems.join(' '), /Process artifacts are too stale/)
})

check('dependency validation requires the configured Process freshness property even with no related artifacts', () => {
  const scope = acceptedScope()
  const fixture = completeDependencies(scope)
  const incompleteProcessNames = clone(processNames)
  delete incompleteProcessNames.properties['Last checked for accuracy']
  const result = dependenciesFor(scope, fixture.proof, {
    scopeId: scope.scopeId,
    surveyRunId: fixture.proof.surveyRunId,
    softwareBodies: [],
    pages: []
  }, incompleteProcessNames)
  assert.strictEqual(result.ok, false)
  assert.match(result.problems.join(' '), /complete config-resolved Process Type, Last checked for accuracy/)
})

check('dependencies refuse Software relations at Notion\'s measured 100-item cap', () => {
  const scope = acceptedScope('POC complete', { targetType: 'replacement', replacementTool: 'Legacy Tool' })
  const capped = Array.from({ length: 100 }, (_, index) => `https://www.notion.so/Related-${index.toString(16).padStart(32, '0')}`)
  const targetUrl = notionUrl('a', 'Legacy')
  const body = [{ url: targetUrl, last_edited_time: `${TODAY}T12:00:00-04:00`, body: 'Fetched body.' }]
  for (const [field, value] of [['Integrates with', capped], ['Artifacts', JSON.stringify(capped)]]) {
    const plan = evaluate.surveyPlan({ surveyRunId: `capped-${field}` }, scope, context)
    const row = rowFor(plan, targetUrl, { Name: 'Legacy Tool', 'Integrates with': [], Artifacts: [], [field]: value })
    const fixture = proofFixture(scope, [row], { softwareBodies: body, pages: [] })
    const proof = evaluate.directoryProof(scope, fixture.plan, fixture.before, fixture.details, fixture.after, context)
    const result = dependenciesFor(scope, proof, { scopeId: scope.scopeId, surveyRunId: proof.surveyRunId, softwareBodies: body, pages: [] })
    assert.strictEqual(result.ok, false)
    assert.match(result.problems.join(' '), /100-item .* relation cap/)
  }
})

check('dependencies refuse paginated relation payloads before claiming complete coverage', () => {
  const scope = acceptedScope('POC complete', { targetType: 'replacement', replacementTool: 'Legacy Tool' })
  const targetUrl = notionUrl('a', 'Legacy')
  const body = [{ url: targetUrl, last_edited_time: `${TODAY}T12:00:00-04:00`, body: 'Fetched body.' }]
  for (const field of ['Integrates with', 'Artifacts']) {
    const plan = evaluate.surveyPlan({ surveyRunId: `paginated-${field}` }, scope, context)
    const row = rowFor(plan, targetUrl, {
      Name: 'Legacy Tool',
      'Integrates with': [],
      Artifacts: [],
      [field]: { results: [], has_more: true, next_cursor: 'next-page' }
    })
    const fixture = proofFixture(scope, [row], { softwareBodies: body, pages: [] })
    const proof = evaluate.directoryProof(scope, fixture.plan, fixture.before, fixture.details, fixture.after, context)
    const result = dependenciesFor(scope, proof, { scopeId: scope.scopeId, surveyRunId: proof.surveyRunId, softwareBodies: body, pages: [] })
    assert.strictEqual(result.ok, false)
    assert.match(result.problems.join(' '), /incomplete .* relation payload/)
  }
})

check('dependencies refuse any relation entry without a stable page identity', () => {
  const scope = acceptedScope('POC complete', { targetType: 'replacement', replacementTool: 'Legacy Tool' })
  const targetUrl = notionUrl('a', 'Legacy')
  const relatedUrl = notionUrl('b', 'Related')
  const bodies = [
    { url: targetUrl, last_edited_time: `${TODAY}T12:00:00-04:00`, body: 'Fetched body.' },
    { url: relatedUrl, last_edited_time: `${TODAY}T12:00:00-04:00`, body: 'Fetched related body.' }
  ]
  for (const field of ['Integrates with', 'Artifacts']) {
    const plan = evaluate.surveyPlan({ surveyRunId: `malformed-${field}` }, scope, context)
    const row = rowFor(plan, targetUrl, {
      Name: 'Legacy Tool',
      'Integrates with': [],
      Artifacts: [],
      [field]: [relatedUrl, { name: 'missing page identity' }]
    })
    const fixture = proofFixture(scope, [row], { softwareBodies: bodies, pages: [] })
    const proof = evaluate.directoryProof(scope, fixture.plan, fixture.before, fixture.details, fixture.after, context)
    const result = dependenciesFor(scope, proof, { scopeId: scope.scopeId, surveyRunId: proof.surveyRunId, softwareBodies: bodies, pages: [] })
    assert.strictEqual(result.ok, false)
    assert.match(result.problems.join(' '), /unidentifiable .* relation entry/)
  }
})

check('relation validation rejects opaque nonempty scalar and object payloads', () => {
  for (const malformed of ['opaque relation entry', { name: 'opaque relation entry' }, 42, true]) {
    assert.strictEqual(evaluate.relationMalformed(malformed), true, JSON.stringify(malformed))
  }
  for (const valid of [null, '', notionUrl('a', 'Related'), { id: 'a'.repeat(32) }]) {
    assert.strictEqual(evaluate.relationMalformed(valid), false, JSON.stringify(valid))
  }
})

check('existing candidates traverse both relation directions using canonical page identity', () => {
  const scope = acceptedScope('POC complete', { targetType: 'existing', candidateDirectoryState: 'existing' })
  const plan = evaluate.surveyPlan({ surveyRunId: 'existing-relations' }, scope, context)
  const candidateUrl = notionUrl('a', 'Acme-Evaluate')
  const outboundUrl = notionUrl('b', 'Outbound')
  const reverseUrl = notionUrl('c', 'Reverse')
  const alternateCandidateUrl = `https://app.notion.com/p/${'a'.repeat(8)}-${'a'.repeat(4)}-${'a'.repeat(4)}-${'a'.repeat(4)}-${'a'.repeat(12)}?pvs=4`
  const rows = [
    rowFor(plan, candidateUrl, { Name: 'Acme Evaluate', 'Integrates with': [outboundUrl], Artifacts: [] }),
    rowFor(plan, outboundUrl, { Name: 'Outbound', 'Integrates with': [], Artifacts: [] }),
    rowFor(plan, reverseUrl, { Name: 'Reverse', 'Integrates with': [alternateCandidateUrl], Artifacts: [] })
  ]
  const { dependencies } = completeDependencies(scope, rows)
  assert.deepStrictEqual(dependencies.outbound, [outboundUrl])
  assert.deepStrictEqual(dependencies.reverseOnly, [reverseUrl])
})

check('bare and dashed Notion relation ids remain in dependency and artifact coverage', () => {
  const scope = acceptedScope('POC complete', { targetType: 'replacement', replacementTool: 'Legacy Tool' })
  const plan = evaluate.surveyPlan({ surveyRunId: 'bare-relations' }, scope, context)
  const targetId = 'a'.repeat(32)
  const reverseId = 'b'.repeat(32)
  const artifactId = 'c'.repeat(32)
  const dashedTarget = `${targetId.slice(0, 8)}-${targetId.slice(8, 12)}-${targetId.slice(12, 16)}-${targetId.slice(16, 20)}-${targetId.slice(20)}`
  const targetUrl = notionUrl('a', 'Legacy')
  const reverseUrl = notionUrl('b', 'Reverse')
  const artifactUrl = notionUrl('c', 'Technical-Reference')
  const rows = [
    rowFor(plan, targetUrl, { Name: 'Legacy Tool', 'Integrates with': [reverseId], Artifacts: [artifactId] }),
    rowFor(plan, reverseUrl, { Name: 'Reverse Dependent', 'Integrates with': [dashedTarget], Artifacts: [] })
  ]
  const softwareBodies = rows.map(row => ({ url: row.url, last_edited_time: `${TODAY}T12:00:00-04:00`, body: 'Fetched body.' }))
  const pages = [{ url: artifactUrl, properties: processPageProperties(), last_edited_time: `${TODAY}T12:00:00-04:00`, body: 'Fetched artifact.' }]
  const fixture = proofFixture(scope, rows, { softwareBodies, pages })
  const proof = evaluate.directoryProof(scope, fixture.plan, fixture.before, fixture.details, fixture.after, context)
  const result = dependenciesFor(scope, proof, { scopeId: scope.scopeId, surveyRunId: proof.surveyRunId, softwareBodies, pages })
  assert.strictEqual(result.ok, true, result.problems && result.problems.join(' '))
  assert.deepStrictEqual(result.outbound, [reverseUrl])
  assert.deepStrictEqual(result.reverseOnly, [reverseUrl])
  assert.deepStrictEqual(result.expectedArtifactUrls, [artifactId])
})

check('dependencies refuse missing, unrelated, unreadable, stale, or bodyless artifacts', () => {
  const resultFor = fixture => dependenciesFor(fixture.scope, fixture.proof, {
    scopeId: fixture.scope.scopeId,
    surveyRunId: fixture.proof.surveyRunId,
    softwareBodies: fixture.softwareBodies,
    pages: fixture.pages
  })
  assert.strictEqual(resultFor(replacementFixture({ pagesTransform: () => [] })).ok, false)
  assert.strictEqual(resultFor(replacementFixture({ pagesTransform: pages => [...pages, { ...pages[0], url: notionUrl('d', 'Unrelated') }] })).ok, false)
  assert.strictEqual(resultFor(replacementFixture({ pagePatch: { unavailable: true } })).ok, false)
  assert.strictEqual(resultFor(replacementFixture({ pagePatch: { properties: processPageProperties('Technical Reference', '2024-01-01') } })).ok, false)
  assert.strictEqual(resultFor(replacementFixture({ pagePatch: { properties: processPageProperties('Technical Reference', '2026-08-29') } })).ok, false)
  assert.strictEqual(resultFor(replacementFixture({ pagePatch: { body: '' } })).ok, false)
  assert.strictEqual(resultFor(replacementFixture({ pagePatch: { properties: { ...processPageProperties(), Type: {} } } })).ok, false)
  const propertyFixture = replacementFixture({ pagePatch: { properties: {
    'Artifact kind': { type: 'select', select: { name: 'System note' } },
    'Last checked for accuracy': { type: 'date', date: { start: '2026-08-20', end: null } }
  } } })
  const renamedProcessNames = clone(processNames)
  renamedProcessNames.properties.Type = 'Artifact kind'
  renamedProcessNames.values.Type['Technical Reference'] = 'System note'
  const propertyType = dependenciesFor(propertyFixture.scope, propertyFixture.proof, {
    scopeId: propertyFixture.scope.scopeId,
    surveyRunId: propertyFixture.proof.surveyRunId,
    softwareBodies: propertyFixture.softwareBodies,
    pages: [propertyFixture.page]
  }, renamedProcessNames)
  assert.strictEqual(propertyType.ok, true)
  assert.strictEqual(propertyType.artifactPages[0].type, 'Technical Reference')
  const incompleteProcessNames = clone(renamedProcessNames)
  delete incompleteProcessNames.properties['Last checked for accuracy']
  assert.strictEqual(dependenciesFor(propertyFixture.scope, propertyFixture.proof, {
    scopeId: propertyFixture.scope.scopeId,
    surveyRunId: propertyFixture.proof.surveyRunId,
    softwareBodies: propertyFixture.softwareBodies,
    pages: [propertyFixture.page]
  }, incompleteProcessNames).ok, false)
  assert.strictEqual(resultFor(replacementFixture({ pagePatch: { properties: processPageProperties('page') } })).ok, false)
  assert.strictEqual(resultFor(replacementFixture({ pagePatch: { properties: processPageProperties('Invented Type') } })).ok, false)
  assert.strictEqual(evaluate.dependencies(propertyFixture.scope, propertyFixture.proof, {
    scopeId: propertyFixture.scope.scopeId,
    surveyRunId: propertyFixture.proof.surveyRunId,
    softwareBodies: propertyFixture.softwareBodies,
    pages: [propertyFixture.page]
  }).ok, false)
})

check('dependencies require every affected Software body and every outbound row', () => {
  const fixture = replacementFixture()
  const base = { scopeId: fixture.scope.scopeId, surveyRunId: fixture.proof.surveyRunId, pages: [fixture.page] }
  const resultFor = one => dependenciesFor(one.scope, one.proof, {
    scopeId: one.scope.scopeId,
    surveyRunId: one.proof.surveyRunId,
    softwareBodies: one.softwareBodies,
    pages: one.pages
  })
  assert.strictEqual(resultFor(replacementFixture({ softwareBodiesTransform: bodies => bodies.slice(0, 1) })).ok, false)
  assert.strictEqual(resultFor(replacementFixture({ softwareBodiesTransform: bodies => bodies.map(one => ({ url: one.url, last_edited_time: one.last_edited_time })) })).ok, false)
  assert.strictEqual(resultFor(replacementFixture({ softwareBodyPatch: { readable: false } })).ok, false)
  assert.strictEqual(resultFor(replacementFixture({ softwareBodyPatch: { body: null } })).ok, false)
  assert.strictEqual(resultFor(replacementFixture({ rowPatch: { 'date:Last reviewed:start': '2026-08-29' } })).ok, false)

  const staleFixture = replacementFixture({ rowPatch: { 'date:Last reviewed:start': '2024-01-01' } })
  const stale = resultFor(staleFixture)
  assert.strictEqual(stale.ok, false)
  assert.match(stale.problems.join(' '), /too stale to prove the current directory state/)

  const brokenProof = clone(fixture.proof)
  brokenProof.limitation = 'Changed after proof.'
  const changedProof = dependenciesFor(fixture.scope, brokenProof, { ...base, softwareBodies: fixture.softwareBodies })
  assert.strictEqual(changedProof.ok, false)
  assert.match(changedProof.problems.join(' '), /directory proof changed/)

  const unresolvedPlan = evaluate.surveyPlan({ surveyRunId: 'unresolved-outbound' }, fixture.scope, context)
  const unresolvedRows = [
    rowFor(unresolvedPlan, fixture.targetUrl, { Name: 'Legacy Tool', 'Integrates with': [notionUrl('d', 'Missing-Outbound')], Artifacts: [fixture.artifactUrl] }),
    rowFor(unresolvedPlan, fixture.reverseUrl, { Name: 'Reverse Dependent', 'Integrates with': [fixture.targetUrl], Artifacts: [] })
  ]
  const unresolvedBodies = unresolvedRows.map(row => ({ url: row.url, last_edited_time: `${TODAY}T12:00:00-04:00`, body: 'Fetched body.' }))
  const unresolvedFixture = proofFixture(fixture.scope, unresolvedRows, { softwareBodies: unresolvedBodies, pages: [fixture.page] })
  const unresolvedProof = evaluate.directoryProof(fixture.scope, unresolvedFixture.plan, unresolvedFixture.before, unresolvedFixture.details, unresolvedFixture.after, context)
  assert.strictEqual(dependenciesFor(fixture.scope, unresolvedProof, { ...base, surveyRunId: unresolvedProof.surveyRunId, softwareBodies: unresolvedBodies }).ok, false)
})

check('dependencies refuse scope and survey binding mismatches', () => {
  const fixture = replacementFixture()
  assert.strictEqual(dependenciesFor(fixture.scope, fixture.proof, { scopeId: 'scope:wrong', surveyRunId: fixture.proof.surveyRunId, softwareBodies: fixture.softwareBodies, pages: [fixture.page] }).ok, false)
  assert.strictEqual(dependenciesFor(fixture.scope, fixture.proof, { scopeId: fixture.scope.scopeId, surveyRunId: 'wrong', softwareBodies: fixture.softwareBodies, pages: [fixture.page] }).ok, false)
})

check('assessment refuses a dependency inventory changed after validation', () => {
  const scope = acceptedScope('research')
  const { dependencies } = completeDependencies(scope)
  const changed = clone(dependencies)
  changed.affectedRows.push({ url: notionUrl('f', 'Injected'), name: 'Injected', reasons: ['candidate-or-target'] })
  const result = assess(scope, changed)
  assert.strictEqual(result.ok, false)
  assert.match(result.problems.join(' '), /dependency inventory changed/)
})

check('evidence keeps unknown separate from unavailable and not searched', () => {
  const scope = acceptedScope()
  const input = evidenceFor(scope, baseRecords(), {
    'vendor-web': { status: 'unavailable', reason: 'Connector unavailable' },
    ramp: { status: 'not-searched' }
  })
  input.records = input.records.filter(record => !['vendor-web', 'ramp'].includes(record.sourceKind))
  const result = evidenceContract.validateEvidence(scope, input)
  assert.strictEqual(result.ok, true, result.problems.join('\n'))
  assert.strictEqual(result.coverage.find(one => one.sourceKind === 'vendor-web').status, 'unavailable')
  assert.strictEqual(result.coverage.find(one => one.sourceKind === 'ramp').status, 'not-searched')
})

check('assessment reports Software directory coverage as searched after the mandatory survey', () => {
  const scope = acceptedScope()
  const { dependencies } = completeDependencies(scope)
  const evidence = evidenceFor(scope, baseRecords().filter(record => record.sourceKind !== 'software-directory'), {
    'software-directory': { status: 'not-searched' }
  })
  const validated = evidenceContract.validateEvidence(scope, evidence)
  assert.strictEqual(validated.ok, true, validated.problems.join('\n'))
  const result = evaluate.assessment({
    scopeId: scope.scopeId,
    dependenciesId: dependencies.dependenciesId,
    evidenceId: validated.evidenceId
  }, scope, dependencies, evidence)
  assert.strictEqual(result.ok, false)
  assert.match(result.problems.join(' '), /Software-directory coverage must be searched/)
})

check('coverage exactly preserves the approved source set and boundaries', () => {
  const scope = acceptedScope()
  const extra = evidenceFor(scope)
  extra.coverage.push({ sourceKind: 'gmail', status: 'searched', boundary: { mailbox: 'own', dateRange: { ...RANGE } } })
  assert.strictEqual(evidenceContract.validateEvidence(scope, extra).ok, false)

  const changed = evidenceFor(scope)
  changed.coverage[0].boundary = { dataSource: 'different' }
  assert.strictEqual(evidenceContract.validateEvidence(scope, changed).ok, false)

  const missing = evidenceFor(scope)
  delete missing.coverage[0].boundary
  assert.strictEqual(evidenceContract.validateEvidence(scope, missing).ok, false)
})

check('evidence refuses invalid source locators, dates, and credential-shaped content', () => {
  const scope = acceptedScope()
  for (const mutate of [
    record => { record.locator = '' },
    record => { record.observedAt = '2026-02-30' },
    record => { record.claim = 'credential api_key=abcdefghijk' }
  ]) {
    const records = baseRecords()
    mutate(records[0])
    assert.strictEqual(evidenceContract.validateEvidence(scope, evidenceFor(scope, records)).ok, false)
  }
  const secret = 'api_key=abcdefghijklmno'
  const records = baseRecords()
  records[0].claim = secret
  const refused = evidenceContract.validateEvidence(scope, evidenceFor(scope, records))
  assert.strictEqual(refused.ok, false)
  assert.deepStrictEqual(refused.records, [])
  assert.deepStrictEqual(refused.coverage, [])
  assert.doesNotMatch(JSON.stringify(refused), new RegExp(secret))
})

check('evidence cannot postdate the evaluation asOf day', () => {
  const scope = acceptedScope()
  for (const future of ['2026-08-29', 'Sat, 29 Aug 2026 00:00:00 GMT']) {
    const records = baseRecords()
    records[0].observedAt = future
    const refused = evidenceContract.validateEvidence(scope, evidenceFor(scope, records))
    assert.strictEqual(refused.ok, false)
    assert.match(refused.problems.join('\n'), /after the evaluation's asOf day/)
  }
  const sameLocalDay = baseRecords()
  sameLocalDay[0].observedAt = '2026-08-28T23:30:00-04:00'
  assert.strictEqual(evidenceContract.validateEvidence(scope, evidenceFor(scope, sameLocalDay)).ok, true)
})

check('credential scan recognizes standard provider key and token shapes', () => {
  const shaped = [
    ['sk_live_1234567890abcdef', 'api-key'],
    ['rk_live_1234567890abcdef', 'api-key'],
    ['ghp_1234567890abcdef1234567890abcdef1234', 'api-key'],
    ['sk-proj-1234567890abcdef', 'api-key'],
    ['AIza12345678901234567890123456789012345', 'api-key'],
    ['xoxb-1234567890-abcdefghij', 'token']
  ]
  for (const [secret, category] of shaped) assert.ok(evidenceContract.categoriesIn(secret).includes(category), secret.split(/[-_]/)[0])
})

check('account, folder, channel, DM, meeting, call, mailbox, and date bounds are enforced', () => {
  const cases = [
    ['ramp', { account: 'Allowed', dateRange: { ...RANGE } }, { account: 'Other' }],
    ['google-drive', { folder: 'Allowed', dateRange: { ...RANGE } }, { folder: 'Other' }],
    ['slack', { channels: ['#allowed'], directMessages: ['A'], dateRange: { ...RANGE } }, { channel: '#other' }],
    ['slack', { channels: ['#allowed'], directMessages: ['A'], dateRange: { ...RANGE } }, { directMessage: 'B' }],
    ['google-calendar', { meetings: ['meet-1'], dateRange: { ...RANGE } }, { meeting: 'meet-2' }],
    ['gong', { calls: ['call-1'], dateRange: { ...RANGE } }, { call: 'call-2' }],
    ['gmail', { mailbox: 'own', dateRange: { ...RANGE } }, { mailbox: 'other' }],
    ['ramp', { account: 'Allowed', dateRange: { ...RANGE } }, { account: 'Allowed' }, '2025-12-31']
  ]
  for (const [sourceKind, boundary, recordScope, observedAt = TODAY] of cases) {
    const scope = acceptedScope('research', { sourceBoundaries: { 'software-directory': {}, [sourceKind]: boundary } })
    const record = { id: 'outside', sourceKind, locator: `${sourceKind}:outside`, observedAt, claim: 'Out-of-scope claim.', classification: 'observed-fact', criterion: 'context', stance: 'context', scope: recordScope }
    const input = evidenceFor(scope, [record])
    const validated = evidenceContract.validateEvidence(scope, input)
    assert.strictEqual(validated.ok, false, sourceKind)
    const deps = completeDependencies(scope).dependencies
    const assessed = evaluate.assessment({ scopeId: scope.scopeId, dependenciesId: deps.dependenciesId, evidenceId: null }, scope, deps, input)
    assert.strictEqual(assessed.ok, false, `${sourceKind} assessment should revalidate boundaries`)
  }
})

check('evidence must carry approved locators and vendor web stays a vendor claim', () => {
  const accountScope = acceptedScope('research', { sourceBoundaries: { 'software-directory': {}, ramp: { account: 'Approved', dateRange: { ...RANGE } } } })
  const accountEvidence = evidenceFor(accountScope, [{ id: 'missing-account', sourceKind: 'ramp', locator: 'ramp:payment:1', observedAt: TODAY, claim: 'A payment exists.', classification: 'observed-fact', criterion: 'price', stance: 'supports', scope: {} }])
  const accountResult = evidenceContract.validateEvidence(accountScope, accountEvidence)
  assert.strictEqual(accountResult.ok, false)
  assert.match(accountResult.problems.join('\n'), /omits its approved account locator/)

  const vendorScope = acceptedScope('research', { sourceBoundaries: { 'software-directory': {}, 'vendor-web': { domains: ['vendor.example'], dateRange: { ...RANGE } } } })
  const vendorEvidence = evidenceFor(vendorScope, [{ id: 'mislabeled', sourceKind: 'vendor-web', locator: 'https://vendor.example/claims', observedAt: TODAY, claim: 'The vendor says it works.', classification: 'observed-fact', criterion: 'success-criterion', stance: 'supports', scope: { url: 'https://vendor.example/claims' } }])
  const vendorResult = evidenceContract.validateEvidence(vendorScope, vendorEvidence)
  assert.strictEqual(vendorResult.ok, false)
  assert.match(vendorResult.problems.join('\n'), /must stay classified as a vendor-claim/)

  const mismatchedLocator = evidenceFor(vendorScope, [{
    id: 'wrong-web-locator', sourceKind: 'vendor-web', locator: 'https://outside.example/claim', observedAt: TODAY,
    claim: 'The vendor published a claim.', classification: 'vendor-claim', criterion: 'context', stance: 'context',
    scope: { url: 'https://vendor.example/claim' }
  }])
  const locatorResult = evidenceContract.validateEvidence(vendorScope, mismatchedLocator)
  assert.strictEqual(locatorResult.ok, false)
  assert.match(locatorResult.problems.join(' '), /locator does not exactly match/)
})

check('source-matrix limits keep metadata and unsupported sources out of terminal gates', () => {
  const meeting = '11111111-1111-4111-8111-111111111111'
  const calendarScope = acceptedScope('final decision', { sourceBoundaries: {
    'software-directory': {},
    'google-calendar': { meetings: [meeting], dateRange: { ...RANGE } }
  } })
  const calendarEvidence = evidenceFor(calendarScope, [{
    id: 'calendar-success', sourceKind: 'google-calendar', locator: `calendar:${meeting}`, observedAt: TODAY,
    claim: 'A meeting existed.', classification: 'observed-fact', criterion: 'success-criterion', stance: 'supports',
    scope: { meeting }, value: { kind: 'option-evidence', optionId: 'candidate', successCriterion: calendarScope.successCriteria[0], verified: true }
  }])
  const calendarResult = evidenceContract.validateEvidence(calendarScope, calendarEvidence)
  assert.strictEqual(calendarResult.ok, false)
  assert.match(calendarResult.problems.join(' '), /Calendar metadata cannot prove a decision gate/)

  const labeledCalendarClaim = clone(calendarEvidence)
  labeledCalendarClaim.records[0].classification = 'vendor-claim'
  const labeledCalendarResult = evidenceContract.validateEvidence(calendarScope, labeledCalendarClaim)
  assert.strictEqual(labeledCalendarResult.ok, false)
  assert.match(labeledCalendarResult.problems.join(' '), /Calendar metadata cannot prove a decision gate/)

  const scope = acceptedScope('final decision')
  const records = baseRecords()
  const unsupportedPrice = records.find(one => one.id === 'need')
  unsupportedPrice.criterion = 'price'
  unsupportedPrice.value = { kind: 'money', amount: 1, currency: 'USD', period: 'annual', optionId: 'candidate', verified: true }
  const priceResult = evidenceContract.validateEvidence(scope, evidenceFor(scope, records))
  assert.strictEqual(priceResult.ok, false)
  assert.match(priceResult.problems.join(' '), /user-statement cannot prove verified current price/)

  unsupportedPrice.classification = 'vendor-claim'
  const relabeledPriceResult = evidenceContract.validateEvidence(scope, evidenceFor(scope, records))
  assert.strictEqual(relabeledPriceResult.ok, false)
  assert.match(relabeledPriceResult.problems.join(' '), /user-statement cannot prove verified current price/)
})

check('gate qualifiers must be satisfied by the same criterion-matching record', () => {
  const mixed = {
    vendorSuccess: { criterion: 'success-criterion', stance: 'supports', classification: 'vendor-claim' },
    unrelatedInternal: { criterion: 'business-need', stance: 'supports', classification: 'observed-fact', value: { kind: 'money', verified: true } },
    qualitativePrice: { criterion: 'price', stance: 'supports', classification: 'observed-fact' }
  }
  assert.strictEqual(evaluate.refsPass(['vendorSuccess', 'unrelatedInternal'], 'success-criterion', mixed, { beyondVendor: true }), false)
  assert.strictEqual(evaluate.refsPass(['qualitativePrice', 'unrelatedInternal'], 'price', mixed, { valueKind: 'money' }), false)
  assert.strictEqual(evaluate.refsPass(['unrelatedInternal'], 'business-need', mixed, { verified: true }), true)
  mixed.unrelatedInternal.value.verified = false
  assert.strictEqual(evaluate.refsPass(['unrelatedInternal'], 'business-need', mixed, { verified: true }), false)
})

check('signed terms and finance disagreement remains a dated conflict', () => {
  const scope = acceptedScope()
  const records = baseRecords().concat({
    id: 'finance-price', sourceKind: 'ramp', locator: 'ramp:payment:42', observedAt: '2026-08-21',
    claim: 'Observed payment differs from the signed annual amount.', classification: 'observed-fact',
    criterion: 'price', stance: 'contradicts', scope: { account: 'Test account' },
    value: { kind: 'money', amount: 10000, currency: 'USD', period: 'annual', optionId: 'candidate', verified: true }
  })
  const result = evidenceContract.validateEvidence(scope, evidenceFor(scope, records))
  assert.strictEqual(result.ok, true)
  assert.strictEqual(result.conflicts.length, 1)
  assert.deepStrictEqual(result.conflicts[0].records.map(one => one.observedAt).sort(), ['2026-08-21', TODAY])
})

check('success evidence conflicts only within the same named criterion', () => {
  const scope = acceptedScope('POC running', {
    successCriteria: ['Accuracy target', 'Latency target']
  })
  const success = {
    id: 'accuracy-pass', sourceKind: 'product-telemetry', locator: 'export:poc-results.csv', observedAt: TODAY,
    claim: 'Accuracy passed.', classification: 'observed-fact', criterion: 'success-criterion', stance: 'supports', scope: {},
    value: { kind: 'option-evidence', optionId: 'candidate', successCriterion: 'Accuracy target', verified: true }
  }
  const different = {
    ...success, id: 'latency-fail', claim: 'Latency failed.', stance: 'contradicts',
    value: { ...success.value, successCriterion: 'Latency target' }
  }
  let result = evidenceContract.validateEvidence(scope, evidenceFor(scope, [success, different]))
  assert.strictEqual(result.ok, true, result.problems.join('\n'))
  assert.strictEqual(result.conflicts.length, 0)
  const same = { ...different, value: { ...different.value, successCriterion: 'Accuracy target' } }
  result = evidenceContract.validateEvidence(scope, evidenceFor(scope, [success, same]))
  assert.strictEqual(result.ok, true, result.problems.join('\n'))
  assert.strictEqual(result.conflicts.length, 1)
  assert.strictEqual(result.conflicts[0].successCriterion, 'Accuracy target')
  for (const successCriterion of [undefined, 'Misspelled target']) {
    const unbound = clone(different)
    if (successCriterion === undefined) delete unbound.value.successCriterion
    else unbound.value.successCriterion = successCriterion
    const refused = evidenceContract.validateEvidence(scope, evidenceFor(scope, [success, unbound]))
    assert.strictEqual(refused.ok, false)
    assert.match(refused.problems.join(' '), /successCriterion accepted in scope/)
  }
})

check('global evidence conflicts cannot be split by stray option metadata', () => {
  const scope = acceptedScope('final decision')
  const { dependencies } = completeDependencies(scope)
  const records = baseRecords().concat({
    id: 'hard-stop-disputed', sourceKind: 'user-statement', locator: 'user:Decision owner:blocker-dispute', observedAt: TODAY,
    claim: 'The material blocker can be resolved.', classification: 'user-statement', criterion: 'hard-stop', stance: 'contradicts', scope: {},
    value: { kind: 'option-evidence', optionId: 'candidate', verified: true }
  })
  const evidence = evidenceFor(scope, records)
  const validated = evidenceContract.validateEvidence(scope, evidence)
  assert.strictEqual(validated.ok, true, validated.problems.join('\n'))
  assert.strictEqual(validated.conflicts.some(conflict => conflict.criterion === 'hard-stop'), true)
  const result = assess(scope, dependencies, {
    facts: { hardStop: { kind: 'material-blocker', reason: 'The blocker is terminal.', evidenceIds: ['hard-stop'] } }
  }, evidence)
  assert.strictEqual(result.recommendation, 'Insufficient evidence')
})

check('blocker-resolution conflicts are grouped by the exact accepted blocker', () => {
  const scope = acceptedScope('final decision', { knownBlockers: ['Blocker A', 'Blocker B'] })
  const resolution = (id, blocker, stance) => ({
    id, sourceKind: 'user-statement', locator: `user:Decision owner:${id}`, observedAt: TODAY,
    claim: `${blocker} ${stance}.`, classification: 'user-statement', criterion: 'blocker-resolution', stance,
    scope: {}, value: { kind: 'blocker-resolution', optionId: 'candidate', blocker, resolved: stance === 'supports', verified: true }
  })
  let validated = evidenceContract.validateEvidence(scope, evidenceFor(scope, baseRecords().concat([
    resolution('blocker-a-support', 'Blocker A', 'supports'),
    resolution('blocker-b-contradict', 'Blocker B', 'contradicts')
  ])))
  assert.strictEqual(validated.ok, true, validated.problems.join('\n'))
  assert.strictEqual(validated.conflicts.some(one => one.criterion === 'blocker-resolution'), false)

  validated = evidenceContract.validateEvidence(scope, evidenceFor(scope, baseRecords().concat([
    resolution('blocker-b-support', 'Blocker B', 'supports'),
    resolution('blocker-b-contradict', 'Blocker B', 'contradicts')
  ])))
  assert.strictEqual(validated.ok, true, validated.problems.join('\n'))
  const conflict = validated.conflicts.find(one => one.criterion === 'blocker-resolution')
  assert.strictEqual(conflict.blocker, 'Blocker B')
})

check('signed terms retain their approved connector locator and searched provider coverage', () => {
  assert.strictEqual(evaluate.evaluateScope(requestFor('research', {
    sourceBoundaries: { 'software-directory': {}, 'signed-terms': { provider: 'docusign' } }
  })).ok, false)
  assert.strictEqual(evaluate.evaluateScope(requestFor('research', {
    sourceBoundaries: { 'software-directory': {}, 'signed-terms': { dateRange: { ...RANGE } } }
  })).ok, false)
  const scope = acceptedScope()
  assert.deepStrictEqual(scope.sourceBoundaries['signed-terms'], {
    provider: 'docusign', account: 'Test account', dateRange: { ...RANGE }
  })
  const outside = baseRecords()
  outside.find(one => one.id === 'terms').scope.account = 'Outside account'
  let result = evidenceContract.validateEvidence(scope, evidenceFor(scope, outside))
  assert.strictEqual(result.ok, false)
  assert.match(result.problems.join(' '), /outside the approved source boundary/)
  result = evidenceContract.validateEvidence(scope, evidenceFor(scope, baseRecords(), {
    docusign: { status: 'not-searched' }
  }))
  assert.strictEqual(result.ok, false)
  assert.match(result.problems.join(' '), /not backed by searched coverage/)
})

check('option-specific contradictions cannot hide by omitting their option binding', () => {
  const scope = acceptedScope()
  const records = baseRecords().concat({
    id: 'unbound-finance-price', sourceKind: 'ramp', locator: 'ramp:payment:unbound', observedAt: TODAY,
    claim: 'Observed payment contradicts the candidate price.', classification: 'observed-fact',
    criterion: 'price', stance: 'contradicts', scope: { account: 'Test account' },
    value: { kind: 'money', amount: 1, currency: 'USD', period: 'annual', verified: true }
  })
  const result = evidenceContract.validateEvidence(scope, evidenceFor(scope, records))
  assert.strictEqual(result.ok, false)
  assert.match(result.problems.join(' '), /without naming the affected optionId/)

  const metricRecords = baseRecords().concat({
    id: 'unbound-cost-conflict', sourceKind: 'technical-spike', locator: 'normalization:cost:conflict', observedAt: TODAY,
    claim: 'The normalized cost score is disputed.', classification: 'observed-fact',
    criterion: 'decision-metric:cost', stance: 'contradicts', scope: {},
    value: { kind: 'normalized-score', metric: 'cost', score: 1, direction: 'higher-is-better', verified: true }
  })
  const metricResult = evidenceContract.validateEvidence(scope, evidenceFor(scope, metricRecords))
  assert.strictEqual(metricResult.ok, false)
  assert.match(metricResult.problems.join(' '), /without naming the affected optionId/)
})

check('vendor claims stay labeled and cannot become internal success proof', () => {
  const scope = acceptedScope('POC complete')
  const { dependencies } = completeDependencies(scope)
  const records = baseRecords().filter(one => one.id !== 'success').concat({
    id: 'success', sourceKind: 'vendor-web', locator: 'https://vendor.example/case-study', observedAt: TODAY,
    claim: 'The vendor says the criterion succeeds.', classification: 'vendor-claim', criterion: 'success-criterion', stance: 'supports', scope: { url: 'https://vendor.example/case-study' },
    value: { kind: 'option-evidence', optionId: 'candidate', successCriterion: 'The live workflow meets its named accuracy target.', verified: true }
  })
  const result = assess(scope, dependencies, { options: [candidateOption()] }, evidenceFor(scope, records))
  assert.strictEqual(result.recommendation, 'Insufficient evidence')
  assert.match(result.optionResults[0].reasons.join(' '), /success-criterion/)
})

check('unknown pricing stays unknown and blocks Buy rather than being estimated', () => {
  const scope = acceptedScope('POC complete')
  const { dependencies } = completeDependencies(scope)
  const option = candidateOption()
  option.gates.price = []
  const result = assess(scope, dependencies, { options: [option] })
  assert.strictEqual(result.recommendation, 'Insufficient evidence')
  assert.match(result.optionResults[0].reasons.join(' '), /price is not verified/)
})

check('a price claim without a verified money value cannot satisfy the Buy gate', () => {
  const scope = acceptedScope('POC complete')
  const { dependencies } = completeDependencies(scope)
  const records = baseRecords()
  const price = records.find(one => one.id === 'price')
  delete price.value
  const result = assess(scope, dependencies, { options: [candidateOption()] }, evidenceFor(scope, records))
  assert.strictEqual(result.recommendation, 'Insufficient evidence')
  assert.match(result.optionResults[0].reasons.join(' '), /price is not verified/)
})

check('the terminal overlap gate requires current software-directory evidence', () => {
  const scope = acceptedScope('POC complete')
  const { dependencies } = completeDependencies(scope)
  const records = baseRecords()
  const overlap = records.find(one => one.id === 'overlap')
  overlap.sourceKind = 'user-statement'
  overlap.locator = 'user:Decision owner:overlap'
  overlap.scope = { person: 'Decision owner' }
  const result = assess(scope, dependencies, { options: [candidateOption()] }, evidenceFor(scope, records))
  assert.strictEqual(result.recommendation, 'Insufficient evidence')
  assert.match(result.optionResults[0].reasons.join(' '), /overlap gate/)
})

check('research and demo stages cannot return Buy despite terminal-quality evidence', () => {
  for (const stage of ['research', 'demo']) {
    const scope = acceptedScope(stage)
    const { dependencies } = completeDependencies(scope)
    const result = assess(scope, dependencies, {
      facts: { pocPlan: { owner: 'Decision owner', from: '2026-09-01', to: '2026-09-15', handsOnUncertainty: true, noHardBlocker: true } },
      options: [candidateOption()]
    })
    assert.strictEqual(result.recommendation, 'Run POC')
    assert.ok(!evaluate.TERMINAL.includes(result.recommendation))
  }
})

check('POC planned, running, incomplete, and complete have distinct outcomes within their ceilings', () => {
  const planned = acceptedScope('POC planned')
  let deps = completeDependencies(planned).dependencies
  assert.strictEqual(assess(planned, deps, { facts: { pocPlan: { owner: 'Owner', from: '2026-09-01', to: '2026-09-15', handsOnUncertainty: true, noHardBlocker: true } } }).recommendation, 'Run POC')
  for (const stage of ['POC running', 'POC incomplete']) {
    const scope = acceptedScope(stage)
    deps = completeDependencies(scope).dependencies
    assert.strictEqual(assess(scope, deps, { facts: { pocMissingCriteria: [missingPocResult(scope)] } }, evidenceWithMissingCandidatePocResults(scope)).recommendation, 'Complete POC')
  }
  const complete = acceptedScope('POC complete')
  deps = completeDependencies(complete).dependencies
  assert.strictEqual(assess(complete, deps, { options: [candidateOption()] }).recommendation, 'Buy candidate')
})

check('every Buy common gate is mandatory', () => {
  const scope = acceptedScope('final decision')
  const { dependencies } = completeDependencies(scope)
  for (const field of ['businessNeed', 'success', 'overlap', 'implementation', 'migration', 'security', 'price', 'terms']) {
    const option = candidateOption()
    option.gates[field] = []
    const result = assess(scope, dependencies, { options: [option] })
    assert.strictEqual(result.recommendation, 'Insufficient evidence', field)
  }
  const option = candidateOption()
  option.gates.noMaterialGaps = false
  assert.strictEqual(assess(scope, dependencies, { options: [option] }).recommendation, 'Insufficient evidence')
})

check('unverified vendor implementation, migration, and security claims cannot pass terminal gates', () => {
  const scope = acceptedScope('final decision')
  const { dependencies } = completeDependencies(scope)
  const records = baseRecords()
  for (const id of ['implementation', 'migration', 'security']) {
    const record = records.find(one => one.id === id)
    record.sourceKind = 'vendor-web'
    record.locator = 'https://vendor.example/claims'
    record.classification = 'vendor-claim'
    record.scope = { url: record.locator }
    record.value = { kind: 'option-evidence', optionId: 'candidate', verified: false }
  }
  const result = assess(scope, dependencies, { options: [candidateOption()] }, evidenceFor(scope, records))
  assert.strictEqual(result.recommendation, 'Insufficient evidence')
  for (const criterion of ['implementation', 'migration', 'security']) {
    assert.match(result.optionResults[0].reasons.join(' '), new RegExp(`${criterion} gate is not evidenced`))
  }
})

check('terminal success requires separate evidence for every named success criterion', () => {
  const first = 'The live workflow meets its named accuracy target.'
  const second = 'The live workflow meets its named latency target.'
  const scope = acceptedScope('final decision', { successCriteria: [first, second] })
  const { dependencies } = completeDependencies(scope)
  const option = candidateOption({ gates: { ...candidateOption().gates, success: ['success', 'success-latency'] } })
  const missing = assess(scope, dependencies, { options: [option] })
  assert.strictEqual(missing.recommendation, 'Insufficient evidence')
  assert.match(missing.optionResults[0].reasons.join(' '), /every named success criterion/)

  const records = baseRecords().concat({
    id: 'success-latency', sourceKind: 'product-telemetry', locator: 'export:poc-latency.csv', observedAt: TODAY,
    claim: 'The latency criterion passed on live test data.', classification: 'observed-fact',
    criterion: 'success-criterion', stance: 'supports', scope: {},
    value: { kind: 'option-evidence', optionId: 'candidate', successCriterion: second, verified: true }
  })
  assert.strictEqual(assess(scope, dependencies, { options: [option] }, evidenceFor(scope, records)).recommendation, 'Buy candidate')
})

check('solution evidence without a real unmet business need blocks every Buy and Build outcome', () => {
  const scope = acceptedScope('final decision')
  const { dependencies } = completeDependencies(scope)
  for (const option of [candidateOption(), alternativeOption(), buildOption()]) {
    option.gates.businessNeed = []
    const result = assess(scope, dependencies, { options: [option] })
    assert.strictEqual(result.recommendation, 'Insufficient evidence', option.type)
  }
})

check('accepted known blockers require one non-vendor option-bound resolution each', () => {
  const blocker = 'Pending security approval'
  const scope = acceptedScope('final decision', { knownBlockers: [blocker] })
  const { dependencies } = completeDependencies(scope)
  const unresolved = assess(scope, dependencies, { options: [candidateOption()] })
  assert.strictEqual(unresolved.recommendation, 'Insufficient evidence')
  assert.match(unresolved.optionResults[0].reasons.join(' '), /known blockers/)

  const records = baseRecords().concat({
    id: 'blocker-resolution', sourceKind: 'user-statement', locator: 'user:Decision owner:blocker-resolution', observedAt: TODAY,
    claim: 'The pending security approval was completed.', classification: 'user-statement',
    criterion: 'blocker-resolution', stance: 'supports', scope: {},
    value: { kind: 'blocker-resolution', optionId: 'candidate', blocker, resolved: true, verified: true }
  })
  const option = candidateOption({ gates: { ...candidateOption().gates, blockerResolutions: ['blocker-resolution'] } })
  assert.strictEqual(assess(scope, dependencies, { options: [option] }, evidenceFor(scope, records)).recommendation, 'Buy candidate')
})

check('Build requires the full spike, operations, cost, owner, and maintainability gate', () => {
  const scope = acceptedScope('final decision')
  const { dependencies } = completeDependencies(scope)
  for (const field of ['technicalSpike', 'operatingBehaviors', 'buildCost', 'technicalOwner', 'maintainability']) {
    const option = buildOption()
    option.gates[field] = []
    assert.strictEqual(assess(scope, dependencies, { options: [option] }).recommendation, 'Insufficient evidence', field)
  }

  const records = baseRecords()
  const owner = records.find(one => one.id === 'technical-owner')
  owner.sourceKind = 'vendor-web'
  owner.locator = 'https://vendor.example/build-owner'
  owner.classification = 'vendor-claim'
  owner.scope = { url: 'https://vendor.example/build-owner' }
  const vendorOwner = assess(scope, dependencies, { options: [buildOption()] }, evidenceFor(scope, records))
  assert.strictEqual(vendorOwner.recommendation, 'Insufficient evidence')
  assert.match(vendorOwner.optionResults[0].reasons.join(' '), /beyond vendor claims/)

  for (const [id, reason] of [
    ['spike', /technical spike/],
    ['behaviors', /always-on/],
    ['technical-owner', /technical owner/],
    ['maintainability', /maintainability/]
  ]) {
    const unverified = baseRecords()
    const record = unverified.find(one => one.id === id)
    record.sourceKind = 'vendor-web'
    record.locator = `https://vendor.example/${id}`
    record.classification = 'vendor-claim'
    record.scope = { url: record.locator }
    record.value = { kind: 'option-evidence', optionId: 'build', verified: false }
    const result = assess(scope, dependencies, { options: [buildOption()] }, evidenceFor(scope, unverified))
    assert.strictEqual(result.recommendation, 'Insufficient evidence', id)
    assert.match(result.optionResults[0].reasons.join(' '), reason)
  }

  for (const [id, reason] of [
    ['spike', /technical spike/],
    ['behaviors', /always-on/],
    ['technical-owner', /technical owner/],
    ['maintainability', /maintainability/]
  ]) {
    const unverified = baseRecords()
    const record = unverified.find(one => one.id === id)
    record.value = { ...record.value, verified: false }
    const result = assess(scope, dependencies, { options: [buildOption()] }, evidenceFor(scope, unverified))
    assert.strictEqual(result.recommendation, 'Insufficient evidence', id)
    assert.match(result.optionResults[0].reasons.join(' '), reason)
  }
})

check('Buy candidate, Buy named alternative, and Build remain distinct outcomes', () => {
  const scope = acceptedScope('final decision')
  const { dependencies } = completeDependencies(scope)
  assert.strictEqual(assess(scope, dependencies, { options: [candidateOption()] }).recommendation, 'Buy candidate')
  assert.strictEqual(assess(scope, dependencies, { options: [alternativeOption()] }).recommendation, 'Buy named alternative')
  assert.strictEqual(assess(scope, dependencies, { options: [buildOption()] }).recommendation, 'Build')
})

check('terminal options require a non-empty evidence-binding id', () => {
  const scope = acceptedScope('final decision')
  const { dependencies } = completeDependencies(scope)
  for (const id of ['', undefined]) {
    const result = assess(scope, dependencies, { options: [candidateOption({ id })] })
    assert.strictEqual(result.recommendation, 'Insufficient evidence')
    assert.match(result.optionResults[0].reasons.join(' '), /option id is required/)
  }
})

check('terminal options cannot repeat an evidence-binding id', () => {
  const scope = acceptedScope('final decision')
  const { dependencies } = completeDependencies(scope)
  const result = assess(scope, dependencies, { options: [candidateOption(), alternativeOption({ id: 'candidate' })] })
  assert.strictEqual(result.ok, false)
  assert.match(result.problems.join(' '), /repeat id/)
})

check('terminal candidate and alternative identities stay bound to the accepted scope', () => {
  const scope = acceptedScope('final decision')
  const { dependencies } = completeDependencies(scope)
  for (const option of [
    candidateOption({ id: 'other-candidate' }),
    candidateOption({ name: 'Different Product' }),
    alternativeOption({ name: scope.candidate.name }),
    alternativeOption({ id: 'candidate' }),
    alternativeOption({ id: ALTERNATIVE_ID, name: 'Renamed Alternative' }),
    buildOption({ id: ALTERNATIVE_ID }),
    buildOption({ name: 'Renamed build' })
  ]) {
    const result = assess(scope, dependencies, { options: [option] })
    assert.strictEqual(result.ok, false)
    assert.match(result.problems.join(' '), /candidate|alternative|build/i)
  }
  assert.strictEqual(assess(scope, dependencies, { options: [candidateOption()] }).ok, true)
})

check('material terms require verified structured signed-terms evidence', () => {
  const scope = acceptedScope('final decision')
  const { dependencies } = completeDependencies(scope)
  for (const mutate of [
    record => { record.value.verified = false },
    record => { record.value.kind = 'option-evidence' }
  ]) {
    const records = baseRecords()
    mutate(records.find(one => one.id === 'terms'))
    const result = assess(scope, dependencies, { options: [candidateOption()] }, evidenceFor(scope, records))
    assert.strictEqual(result.recommendation, 'Insufficient evidence')
    assert.match(result.optionResults[0].reasons.join(' '), /material terms/)
  }
  const records = baseRecords()
  const terms = records.find(one => one.id === 'terms')
  terms.sourceKind = 'vendor-web'
  terms.locator = 'https://vendor.example/terms'
  terms.classification = 'vendor-claim'
  terms.scope = { url: 'https://vendor.example/terms' }
  const rejected = evidenceContract.validateEvidence(scope, evidenceFor(scope, records))
  assert.strictEqual(rejected.ok, false)
  assert.match(rejected.problems.join(' '), /cannot prove material signed terms/)
})

check('terminal options cannot reuse another option\'s evidence', () => {
  const scope = acceptedScope('final decision')
  const { dependencies } = completeDependencies(scope)
  const borrowed = alternativeOption({ gates: { ...candidateOption().gates } })
  const result = assess(scope, dependencies, { options: [borrowed] })
  assert.strictEqual(result.recommendation, 'Insufficient evidence')
  assert.ok(result.optionResults[0].reasons.length > 0)

  const wrongPriceOnly = alternativeOption({ gates: { ...alternativeOption().gates, price: ['price'] } })
  const wrongPriceResult = assess(scope, dependencies, { options: [wrongPriceOnly] })
  assert.strictEqual(wrongPriceResult.recommendation, 'Insufficient evidence')
  assert.match(wrongPriceResult.optionResults[0].reasons.join(' '), /price is not verified/)
})

check('Stop, Defer, Continue research, Run POC, Complete POC, and Insufficient evidence are mutually represented', () => {
  let scope = acceptedScope('final decision')
  let deps = completeDependencies(scope).dependencies
  assert.strictEqual(assess(scope, deps, { facts: { hardStop: { kind: 'material-blocker', reason: 'The blocker is terminal.', evidenceIds: ['hard-stop'] } }, options: [candidateOption()] }).recommendation, 'Stop')

  scope = acceptedScope('research')
  deps = completeDependencies(scope).dependencies
  const deferred = assess(scope, deps, { facts: { deferral: { constraint: 'No owner capacity', trigger: 'an owner is assigned', revisitDate: '2026-10-01', evidenceIds: ['deferral'] }, businessNeedEvidenceIds: ['need'] } })
  assert.strictEqual(deferred.recommendation, 'Defer')
  assert.deepStrictEqual(deferred.nextStep, { kind: 'defer', constraint: 'No owner capacity', trigger: 'an owner is assigned', revisitDate: '2026-10-01' })
  const research = assess(scope, deps, { facts: { researchGaps: [{ gap: 'Current terms', boundedNextStep: 'Read the named agreement' }] } })
  assert.strictEqual(research.recommendation, 'Continue research')
  assert.deepStrictEqual(research.nextStep, { kind: 'continue-research', gaps: [{ gap: 'Current terms', boundedNextStep: 'Read the named agreement' }] })
  const poc = assess(scope, deps, { facts: { pocPlan: { owner: 'Owner', from: '2026-09-01', to: '2026-09-15', handsOnUncertainty: true, noHardBlocker: true } } })
  assert.strictEqual(poc.recommendation, 'Run POC')
  assert.deepStrictEqual(poc.nextStep, { kind: 'run-poc', plan: { owner: 'Owner', from: '2026-09-01', to: '2026-09-15', handsOnUncertainty: true, noHardBlocker: true } })

  scope = acceptedScope('POC incomplete')
  deps = completeDependencies(scope).dependencies
  const completion = assess(scope, deps, { facts: { pocMissingCriteria: [missingPocResult(scope)] } }, evidenceWithMissingCandidatePocResults(scope))
  assert.strictEqual(completion.recommendation, 'Complete POC')
  assert.deepStrictEqual(completion.nextStep, { kind: 'complete-poc', missingCriteria: [missingPocResult(scope)] })

  scope = acceptedScope('final decision')
  deps = completeDependencies(scope).dependencies
  assert.strictEqual(assess(scope, deps).recommendation, 'Insufficient evidence')
})

check('precedence favors hard stops, then active POC completion, then bounded research over deferral', () => {
  let scope = acceptedScope('final decision')
  let deps = completeDependencies(scope).dependencies
  assert.strictEqual(assess(scope, deps, {
    facts: {
      hardStop: { kind: 'current-stack-meets', reason: 'Current stack meets the need.', evidenceIds: ['hard-stop'] },
      researchGaps: [{ gap: 'More docs', boundedNextStep: 'Read them' }]
    },
    options: [candidateOption()]
  }).recommendation, 'Stop')

  scope = acceptedScope('POC running')
  deps = completeDependencies(scope).dependencies
  assert.strictEqual(assess(scope, deps, { facts: { pocMissingCriteria: [missingPocResult(scope)], researchGaps: [{ gap: 'other', boundedNextStep: 'read' }] } }, evidenceWithMissingCandidatePocResults(scope)).recommendation, 'Complete POC')

  scope = acceptedScope('research')
  deps = completeDependencies(scope).dependencies
  assert.strictEqual(assess(scope, deps, { facts: {
    researchGaps: [{ gap: 'terms', boundedNextStep: 'read agreement' }],
    deferral: { constraint: 'No owner', trigger: 'owner assigned', revisitDate: '2026-10-01', evidenceIds: ['deferral'] },
    businessNeedEvidenceIds: ['need']
  } }).recommendation, 'Continue research')
})

check('candidate-versus-build and candidate-versus-alternative ties stay insufficient', () => {
  const scope = acceptedScope('final decision')
  const { dependencies } = completeDependencies(scope)
  assert.strictEqual(assess(scope, dependencies, { options: [candidateOption(), buildOption()], priorities: ['fit'] }).recommendation, 'Insufficient evidence')
  assert.strictEqual(assess(scope, dependencies, { options: [candidateOption(), alternativeOption()], priorities: ['fit'] }).recommendation, 'Insufficient evidence')
})

check('an unresolved terminal tie cannot fall through to research or POC advice', () => {
  const scope = acceptedScope('final decision')
  const { dependencies } = completeDependencies(scope)
  const result = assess(scope, dependencies, {
    options: [candidateOption(), buildOption()],
    priorities: ['fit'],
    facts: {
      researchGaps: [{ gap: 'More detail', boundedNextStep: 'Read the named source' }],
      pocPlan: { owner: 'Owner', from: '2026-09-01', to: '2026-09-15', handsOnUncertainty: true, noHardBlocker: true }
    }
  })
  assert.strictEqual(result.recommendation, 'Insufficient evidence')
  assert.match(result.reason, /More than one terminal-positive option passed/)
})

check('strict dominance on an explicit priority resolves a terminal tie', () => {
  const scope = acceptedScope('final decision')
  const { dependencies } = completeDependencies(scope)
  const winner = candidateOption({ metrics: { cost: 5, fit: 5, risk: 5, implementation: 5, exit: 5 } })
  const loser = alternativeOption({ metrics: { cost: 4, fit: 4, risk: 4, implementation: 4, exit: 4 } })
  const evidence = evidenceFor(scope, recordsWithMetrics({ candidate: winner.metrics, alternative: loser.metrics }))
  const result = assess(scope, dependencies, {
    options: [winner, loser],
    priorities: ['fit'],
    accountableChoice: {
      optionId: 'candidate',
      by: 'Budget owner',
      date: TODAY,
      acceptedDownside: 'Higher exit cost',
      evidenceIds: ['missing-choice']
    }
  }, evidence)
  assert.strictEqual(result.recommendation, 'Buy candidate')
  assert.strictEqual(result.requiredEvidenceIds.includes('missing-choice'), false)
})

check('dominance refuses boolean evidence and co-dominant options', () => {
  const scope = acceptedScope('final decision')
  const { dependencies } = completeDependencies(scope)
  const unsupportedMetrics = { cost: 5, fit: 5, risk: 5, implementation: 5, exit: 5 }
  const supportedLoserMetrics = { cost: 4, fit: 4, risk: 4, implementation: 4, exit: 4 }
  const unsupported = candidateOption({ metrics: unsupportedMetrics, metricEvidence: { cost: true, fit: true, risk: true, implementation: true, exit: true } })
  const supportedLoser = alternativeOption({ metrics: supportedLoserMetrics })
  const unsupportedEvidence = evidenceFor(scope, recordsWithMetrics({ candidate: unsupportedMetrics, alternative: supportedLoserMetrics }))
  assert.strictEqual(assess(scope, dependencies, { options: [unsupported, supportedLoser], priorities: ['fit'] }, unsupportedEvidence).recommendation, 'Insufficient evidence')

  const tied = { cost: 5, fit: 5, risk: 5, implementation: 5, exit: 5 }
  const lower = { cost: 4, fit: 4, risk: 4, implementation: 4, exit: 4 }
  const candidate = candidateOption({ metrics: tied })
  const alternative = alternativeOption({ metrics: tied })
  const build = buildOption({ metrics: lower })
  const evidence = evidenceFor(scope, recordsWithMetrics({ candidate: tied, alternative: tied, build: lower }))
  const result = assess(scope, dependencies, { options: [candidate, alternative, build], priorities: ['fit'] }, evidence)
  assert.strictEqual(result.recommendation, 'Insufficient evidence')
})

check('a dated accountable choice with an accepted downside resolves a terminal tie', () => {
  const scope = acceptedScope('final decision')
  const { dependencies } = completeDependencies(scope)
  const result = assess(scope, dependencies, {
    options: [candidateOption(), buildOption()],
    priorities: ['fit'],
    accountableChoice: { optionId: 'candidate', by: 'Budget owner', date: TODAY, acceptedDownside: 'Higher exit cost', evidenceIds: ['accountable-choice'] }
  })
  assert.strictEqual(result.recommendation, 'Buy candidate')
  assert.strictEqual(result.requiredEvidenceIds.includes('accountable-choice'), true)
})

check('an accountable choice must match one dated user statement in every decision field', () => {
  const scope = acceptedScope('final decision')
  const { dependencies } = completeDependencies(scope)
  const choice = { optionId: 'candidate', by: 'Budget owner', date: TODAY, acceptedDownside: 'Higher exit cost', evidenceIds: ['accountable-choice'] }
  for (const mutate of [
    record => { record.sourceKind = 'technical-spike'; record.locator = 'spike:choice'; record.scope = { person: 'Budget owner' } },
    record => { record.classification = 'vendor-claim' },
    record => { record.scope = { person: 'Technical owner' } },
    record => { record.value.by = 'Technical owner' },
    record => { record.observedAt = '2026-08-26' },
    record => { record.value.date = '2026-08-26' },
    record => { record.value.optionId = 'build' },
    record => { record.value.acceptedDownside = 'A different downside' },
    record => { record.value.kind = 'other' },
    record => { record.value.verified = false }
  ]) {
    const records = baseRecords()
    mutate(records.find(one => one.id === 'accountable-choice'))
    const result = assess(scope, dependencies, { options: [candidateOption(), buildOption()], priorities: ['fit'], accountableChoice: choice }, evidenceFor(scope, records))
    assert.strictEqual(result.recommendation, 'Insufficient evidence')
  }
})

check('software-directory evidence is bound to the current proof and dependencies', () => {
  const scope = acceptedScope('final decision')
  const { dependencies } = completeDependencies(scope)
  const current = {
    kind: 'software-directory-proof', directoryProofId: dependencies.directoryProofId,
    dependenciesId: dependencies.dependenciesId, surveyRunId: dependencies.surveyRunId, verified: true
  }
  for (const patch of [
    { kind: 'other' },
    { directoryProofId: 'directory-proof:stale' },
    { dependenciesId: 'dependencies:stale' },
    { surveyRunId: 'survey:stale' },
    { verified: false }
  ]) {
    const stale = evidenceFor(scope)
    stale.records.find(one => one.sourceKind === 'software-directory').value = { ...current, ...patch }
    const validated = evidenceContract.validateEvidence(scope, stale)
    assert.strictEqual(validated.ok, true)
    const result = evaluate.assessment({
      scopeId: scope.scopeId,
      dependenciesId: dependencies.dependenciesId,
      evidenceId: validated.evidenceId,
      options: [candidateOption()]
    }, scope, dependencies, stale)
    assert.strictEqual(result.ok, false)
    assert.match(result.problems.join('\n'), /not bound to the current directory proof/)
  }
})

check('material evidence conflicts force Insufficient evidence and remain visible', () => {
  const scope = acceptedScope('final decision')
  const { dependencies } = completeDependencies(scope)
  const records = baseRecords().concat({
    id: 'finance-price', sourceKind: 'ramp', locator: 'ramp:payment', observedAt: TODAY,
    claim: 'Finance observed a conflicting amount.', classification: 'observed-fact', criterion: 'price', stance: 'contradicts', scope: { account: 'Test account' },
    value: { kind: 'money', amount: 10000, currency: 'USD', period: 'annual', optionId: 'candidate', verified: true }
  })
  const result = assess(scope, dependencies, { options: [candidateOption()] }, evidenceFor(scope, records))
  assert.strictEqual(result.recommendation, 'Insufficient evidence')
  assert.strictEqual(result.conflicts.length, 1)
})

check('an unrelated conflict does not override a fully evidenced hard stop', () => {
  const scope = acceptedScope('final decision')
  const { dependencies } = completeDependencies(scope)
  const records = baseRecords().concat({
    id: 'finance-price', sourceKind: 'ramp', locator: 'ramp:payment', observedAt: TODAY,
    claim: 'Finance observed a conflicting amount.', classification: 'observed-fact', criterion: 'price', stance: 'contradicts', scope: { account: 'Test account' },
    value: { kind: 'money', amount: 10000, currency: 'USD', period: 'annual', optionId: 'candidate', verified: true }
  })
  const result = assess(scope, dependencies, {
    facts: { hardStop: { kind: 'material-blocker', reason: 'The blocker is terminal.', evidenceIds: ['hard-stop'] } },
    options: [candidateOption()]
  }, evidenceFor(scope, records))
  assert.strictEqual(result.recommendation, 'Stop')
  assert.strictEqual(result.conflicts.length, 1)
})

check('past POC and deferral dates cannot become current next-step recommendations', () => {
  const scope = acceptedScope('research')
  const { dependencies } = completeDependencies(scope)
  assert.strictEqual(assess(scope, dependencies, { facts: { pocPlan: { owner: 'Owner', from: '2026-01-01', to: '2026-01-15', handsOnUncertainty: true, noHardBlocker: true } } }).recommendation, 'Insufficient evidence')
  assert.strictEqual(assess(scope, dependencies, { facts: { deferral: { constraint: 'No owner', trigger: 'owner assigned', revisitDate: '2026-01-15', evidenceIds: ['deferral'] }, businessNeedEvidenceIds: ['need'] } }).recommendation, 'Insufficient evidence')
})

check('Run POC refuses a plan that ends after the required decision date', () => {
  const scope = acceptedScope('research', { requiredDecisionDate: '2026-09-10' })
  const { dependencies } = completeDependencies(scope)
  const result = assess(scope, dependencies, { facts: {
    pocPlan: { owner: 'Owner', from: '2026-09-01', to: '2026-09-15', handsOnUncertainty: true, noHardBlocker: true }
  } })
  assert.strictEqual(result.recommendation, 'Insufficient evidence')
  assert.match(result.reason, /after the required decision date/)
  assert.strictEqual(assess(scope, dependencies, { facts: {
    pocPlan: { owner: 'Owner', from: '2026-09-01', to: '2026-09-10', handsOnUncertainty: true, noHardBlocker: true }
  } }).recommendation, 'Run POC')
})

check('Complete POC binds every missing success criterion to a completion step', () => {
  const scope = acceptedScope('POC incomplete')
  const { dependencies } = completeDependencies(scope)
  const missingEvidence = evidenceWithMissingCandidatePocResults(scope)
  for (const pocMissingCriteria of [
    [null],
    [{}],
    [{ criterion: scope.successCriteria[0] }],
    [{ criterion: 'An unaccepted criterion.', completionStep: 'Test it.' }],
    [missingPocResult(scope), missingPocResult(scope, 'Repeat it.')]
  ]) {
    assert.strictEqual(assess(scope, dependencies, { facts: { pocMissingCriteria } }, missingEvidence).recommendation, 'Insufficient evidence')
  }
  assert.strictEqual(assess(scope, dependencies, { facts: { pocMissingCriteria: [missingPocResult(scope)] } }).recommendation, 'Insufficient evidence')
  const result = assess(scope, dependencies, { facts: { pocMissingCriteria: [missingPocResult(scope)] } }, missingEvidence)
  assert.strictEqual(result.recommendation, 'Complete POC')
  assert.match(result.reason, /Run the remaining accepted test case/)

  const twoCriteria = acceptedScope('POC incomplete', { successCriteria: [scope.successCriteria[0], 'The second accepted live result passes.'] })
  const twoDependencies = completeDependencies(twoCriteria).dependencies
  const twoMissingEvidence = evidenceWithMissingCandidatePocResults(twoCriteria)
  assert.strictEqual(assess(twoCriteria, twoDependencies, { facts: { pocMissingCriteria: [missingPocResult(twoCriteria)] } }, twoMissingEvidence).recommendation, 'Insufficient evidence')
  const everyGap = [missingPocResult(twoCriteria), { criterion: twoCriteria.successCriteria[1], completionStep: 'Run the second accepted live case.' }]
  assert.strictEqual(assess(twoCriteria, twoDependencies, { facts: { pocMissingCriteria: everyGap } }, twoMissingEvidence).recommendation, 'Complete POC')
  for (const stage of ['POC running', 'POC incomplete']) {
    const activeScope = acceptedScope(stage)
    const activeDependencies = completeDependencies(activeScope).dependencies
    const result = assess(activeScope, activeDependencies, { facts: {
      pocPlan: { owner: 'Owner', from: '2026-09-01', to: '2026-09-15', handsOnUncertainty: true, noHardBlocker: true }
    } })
    assert.strictEqual(result.recommendation, 'Insufficient evidence')
    assert.match(result.reason, /already underway or incomplete/)
  }
})

check('checked reports preserve assessed coverage gaps in the Data gaps section', () => {
  const scope = acceptedScope('final decision')
  const { dependencies } = completeDependencies(scope)
  const evidence = evidenceFor(scope, baseRecords(), { ramp: { status: 'not-searched' } })
  const assessment = assess(scope, dependencies, { options: [candidateOption()] }, evidence)
  assert.strictEqual(assessment.dataGaps.length, 1)
  const draft = reportDraft(assessment)
  const checked = evaluate.checkReport(draft, assessment)
  assert.strictEqual(checked.ok, true, checked.problems && checked.problems.join('\n'))
  assert.deepStrictEqual(checked.dataGaps, assessment.dataGaps)
  assert.deepStrictEqual(checked.sections['Data gaps'][0], { coverageGap: assessment.dataGaps[0] })
  delete draft.dataGaps
  assert.strictEqual(evaluate.checkReport(draft, assessment).ok, false)
})

check('checked reports preserve accepted context and bounded next-step details', () => {
  const scope = acceptedScope('research', {
    currentWorkflow: 'The team manually reconciles the workflow each Friday.',
    requiredDecisionDate: '2026-10-15'
  })
  const { dependencies } = completeDependencies(scope)
  const assessment = assess(scope, dependencies, { facts: {
    researchGaps: [{ gap: 'Current security terms', boundedNextStep: 'Read the named security addendum.' }]
  } })
  const draft = reportDraft(assessment)
  const checked = evaluate.checkReport(draft, assessment)
  assert.strictEqual(checked.ok, true, checked.problems && checked.problems.join('\n'))
  assert.strictEqual(checked.evaluationContext.candidate.name, 'Acme Evaluate')
  assert.strictEqual(checked.evaluationContext.problem, scope.problem)
  assert.deepStrictEqual(checked.evaluationContext.useCases, scope.useCases)
  assert.deepStrictEqual(checked.nextStep, {
    kind: 'continue-research',
    gaps: [{ gap: 'Current security terms', boundedNextStep: 'Read the named security addendum.' }]
  })
  assert.deepStrictEqual(checked.sections['Problem and use cases'][0], { evaluationContext: assessment.evaluationContext })
  assert.deepStrictEqual(checked.sections['Conditions for the next gate'][0], { nextStep: assessment.nextStep })
  const changedContext = clone(draft)
  changedContext.evaluationContext.problem = 'A different problem.'
  assert.strictEqual(evaluate.checkReport(changedContext, assessment).ok, false)
  const changedNextStep = clone(draft)
  changedNextStep.nextStep.gaps[0].boundedNextStep = 'Do something else.'
  assert.strictEqual(evaluate.checkReport(changedNextStep, assessment).ok, false)
  const changedAssessmentContext = clone(assessment)
  changedAssessmentContext.evaluationContext.problem = 'A different accepted problem.'
  const matchingContextDraft = clone(draft)
  matchingContextDraft.evaluationContext = clone(changedAssessmentContext.evaluationContext)
  assert.match(evaluate.checkReport(matchingContextDraft, changedAssessmentContext).problems.join(' '), /assessment changed/)
  const changedAssessmentNextStep = clone(assessment)
  changedAssessmentNextStep.nextStep.gaps[0].boundedNextStep = 'A tampered bounded step.'
  const matchingNextStepDraft = clone(draft)
  matchingNextStepDraft.nextStep = clone(changedAssessmentNextStep.nextStep)
  assert.match(evaluate.checkReport(matchingNextStepDraft, changedAssessmentNextStep).problems.join(' '), /assessment changed/)
})

check('data-gap claims can explain the required section whose subject is missing', () => {
  const scope = acceptedScope('final decision')
  const { dependencies } = completeDependencies(scope)
  const assessment = assess(scope, dependencies)
  const draft = reportDraft(assessment)
  for (const section of [
    'Alternatives',
    'Cost and total ownership picture',
    'Implementation, migration, security, and governance',
    'Decision roles and required approvals',
    'Conditions for the next gate'
  ]) draft.sections[section] = ['data-gap-claim']
  assert.strictEqual(evaluate.checkReport(draft, assessment).ok, true)
  draft.sections['Coverage and sources'] = ['data-gap-claim']
  assert.strictEqual(evaluate.checkReport(draft, assessment).ok, false)
})

check('report checker enforces recommendation, section order, source ledger, and coverage', () => {
  const scope = acceptedScope('final decision')
  const { dependencies } = completeDependencies(scope)
  const assessment = assess(scope, dependencies, { options: [candidateOption()] })
  const draft = reportDraft(assessment)
  assert.strictEqual(evaluate.checkReport(draft, assessment).ok, true)
  const changedAssessment = clone(assessment)
  changedAssessment.recommendation = 'Build'
  const matchingChangedDraft = clone(draft)
  matchingChangedDraft.recommendation = 'Build'
  const refusedChangedAssessment = evaluate.checkReport(matchingChangedDraft, changedAssessment)
  assert.strictEqual(refusedChangedAssessment.ok, false)
  assert.match(refusedChangedAssessment.problems.join(' '), /assessment changed/)
  for (const mutate of [
    copy => { copy.recommendation = 'Build' },
    copy => { copy.reason = 'Invented reason.' },
    copy => { copy.evaluationContext.problem = 'Invented problem.' },
    copy => { copy.nextStep = { kind: 'invented' } },
    copy => { copy.optionResults = [] },
    copy => { copy.stageCeiling = 'Run POC' },
    copy => { copy.selectedOption = { id: 'alternative', name: 'Wrong', type: 'alternative' } },
    copy => { copy.sectionOrder.reverse() },
    copy => { copy.claims = [] },
    copy => { delete copy.claims[0].id },
    copy => { copy.claims[1].id = copy.claims[0].id },
    copy => { copy.claims[0].evidenceIds = [] },
    copy => { copy.claims[0].evidenceIds = ['need', 'hard-stop'] },
    copy => { copy.claims[0].claim = 'The price is $1M.' },
    copy => { delete copy.claims[0].criterion },
    copy => { copy.claims[0].criterion = 'price' },
    copy => { copy.claims.find(claim => claim.id === 'implementation-claim').criterion = 'security' },
    copy => { copy.claims[0].stance = 'maybe' },
    copy => { copy.claims[0].stance = 'contradicts' },
    copy => { delete copy.claims[1].valueKind },
    copy => { copy.claims[1].valueKind = 'normalized-score' },
    copy => { copy.claims[1].evidenceIds = ['hard-stop'] },
    copy => { copy.coverage.pop() },
    copy => { copy.coverage[0].reason = 'Invented coverage detail' },
    copy => { copy.sections.Alternatives = ['need-claim'] },
    copy => { copy.sections['Data gaps'] = 'need-claim' },
    copy => { copy.sections['Data gaps'] = ['not-in-ledger'] },
    copy => { copy.sections['Data gaps'] = [] },
    copy => { copy.claims[0].commentary = 'Uncited assertion beside a valid claim.' },
    copy => { copy.claims[0].properties = { Name: 'Create-shaped payload' } }
  ]) {
    const broken = clone(draft)
    mutate(broken)
    assert.strictEqual(evaluate.checkReport(broken, assessment).ok, false)
  }
})

check('checked terminal reports present every evidence record that made the selected option eligible', () => {
  const scope = acceptedScope('final decision')
  const { dependencies } = completeDependencies(scope)
  const assessment = assess(scope, dependencies, { options: [candidateOption()] })
  assert.strictEqual(assessment.recommendation, 'Buy candidate')
  for (const id of ['migration', 'security', 'terms']) assert.ok(assessment.optionResults[0].gateEvidenceIds.includes(id), id)
  for (const id of ['migration', 'security', 'terms']) assert.ok(assessment.requiredEvidenceIds.includes(id), id)
  const draft = reportDraft(assessment)
  assert.strictEqual(evaluate.checkReport(draft, assessment).ok, true)
  const malformedProjection = clone(draft)
  malformedProjection.claims.find(claim => claim.id === 'coverage-claim').evidenceIds = []
  assert.strictEqual(evaluate.checkReport(malformedProjection, assessment).ok, false)
  for (const evidenceId of ['migration', 'security', 'terms']) {
    const omitted = clone(draft)
    for (const name of Object.keys(omitted.sections)) {
      omitted.sections[name] = omitted.sections[name].filter(claimId => claimId !== `${evidenceId}-claim`)
    }
    const result = evaluate.checkReport(omitted, assessment)
    assert.strictEqual(result.ok, false, evidenceId)
    assert.match(result.problems.join(' '), new RegExp(`required decision evidence "${evidenceId}"`))
  }
})

check('checked reports preserve labeled unverified vendor claims', () => {
  const scope = acceptedScope('final decision')
  const { dependencies } = completeDependencies(scope)
  const records = baseRecords().concat({
    id: 'vendor-feature', sourceKind: 'vendor-web', locator: 'https://vendor.example/features', observedAt: TODAY,
    claim: 'The vendor says its product supports the named integration.', classification: 'vendor-claim',
    criterion: 'success-criterion', stance: 'supports', scope: { url: 'https://vendor.example/features' },
    value: { kind: 'option-evidence', optionId: 'candidate', successCriterion: scope.successCriteria[0], verified: false }
  })
  const assessment = assess(scope, dependencies, { options: [candidateOption()] }, evidenceFor(scope, records))
  const draft = reportDraft(assessment)
  draft.claims.push({
    id: 'vendor-feature-claim',
    claim: records.at(-1).claim,
    criterion: 'success-criterion',
    stance: 'supports',
    evidenceIds: ['vendor-feature'],
    valueKind: 'option-evidence'
  })
  draft.sections['What the evidence proved'].push('vendor-feature-claim')
  const checked = evaluate.checkReport(draft, assessment)
  assert.strictEqual(checked.ok, true, checked.problems && checked.problems.join('\n'))
  assert.strictEqual(checked.evidenceIndex['vendor-feature'].value.verified, false)
})

check('checked command shapes contain no create or update payload', () => {
  const scope = acceptedScope('final decision')
  const { dependencies } = completeDependencies(scope)
  const assessment = assess(scope, dependencies, { options: [candidateOption()] })
  const draft = reportDraft(assessment)
  const output = evaluate.checkReport(draft, assessment)
  assert.strictEqual(output.ok, true)
  assert.strictEqual(output.stageCeiling, assessment.stageCeiling)
  assert.strictEqual(output.reason, assessment.reason)
  assert.deepStrictEqual(output.optionResults, assessment.optionResults)
  assert.deepStrictEqual(output.requiredEvidenceIds, assessment.requiredEvidenceIds)
  assert.deepStrictEqual(output.selectedOption, assessment.selectedOption)
  assert.strictEqual(output.sections['Recommendation and confidence'][0].claim, 'The workflow problem is real and materially unmet.')
  assert.strictEqual(output.evidenceIndex.need.sourceKind, 'user-statement')
  assert.strictEqual(output.evidenceIndex.need.locator, `user:Decision owner:${TODAY}`)
  assert.strictEqual(output.evidenceIndex.need.observedAt, TODAY)
  assert.strictEqual(Array.isArray(output.claims), true)
  assert.deepStrictEqual(Object.keys(output.claims[0]).sort(), ['claim', 'criterion', 'evidenceIds', 'id', 'stance'])
  assert.ok(!Object.prototype.hasOwnProperty.call(output, 'parent'))
  assert.ok(!Object.prototype.hasOwnProperty.call(output, 'properties'))
  assert.doesNotMatch(JSON.stringify(output), /notion-(?:create|update)/i)
})

check('checked reports preserve every assessed conflict even when the draft omits it', () => {
  const scope = acceptedScope('final decision')
  const { dependencies } = completeDependencies(scope)
  const records = baseRecords().concat({
    id: 'finance-price', sourceKind: 'ramp', locator: 'ramp:payment', observedAt: TODAY,
    claim: 'Finance observed a conflicting amount.', classification: 'observed-fact', criterion: 'price', stance: 'contradicts', scope: { account: 'Test account' },
    value: { kind: 'money', amount: 10000, currency: 'USD', period: 'annual', optionId: 'candidate', verified: true }
  })
  const assessment = assess(scope, dependencies, { options: [candidateOption()] }, evidenceFor(scope, records))
  assert.strictEqual(assessment.conflicts.length, 1)
  const draft = reportDraft(assessment, 'Low')
  const checked = evaluate.checkReport(draft, assessment)
  assert.strictEqual(checked.ok, true)
  assert.deepStrictEqual(checked.conflicts, assessment.conflicts)
  assert.deepStrictEqual(checked.conflicts[0].records.map(one => one.id).sort(), ['finance-price', 'price'])
})

check('hook allows reads and blocks every mutation family', () => {
  const slackScope = acceptedScope('research', { sourceBoundaries: {
    'software-directory': {},
    slack: { channels: ['#approved'], directMessages: ['dm-approved'], dateRange: { ...RANGE } }
  } })
  const rampScope = acceptedScope('research', { sourceBoundaries: {
    'software-directory': {},
    ramp: { account: 'approved', dateRange: { ...RANGE } },
    quickbooks: { account: 'approved', dateRange: { ...RANGE } }
  } })
  const docusignScope = acceptedScope('research', { sourceBoundaries: {
    'software-directory': {},
    docusign: { account: 'approved', dateRange: { ...RANGE } }
  } })
  const gmailScope = acceptedScope('research', { sourceBoundaries: {
    'software-directory': {},
    gmail: { mailbox: 'own', dateRange: { ...RANGE } }
  } })
  const gmailBefore = guard.nextDay(RANGE.to)
  const slackFrom = String(Date.parse(`${RANGE.from}T00:00:00Z`) / 1000)
  const slackTo = String(Date.parse(`${RANGE.to}T23:59:59Z`) / 1000)
  assert.strictEqual(guard.decision({ tool_name: 'mcp__plugin_software_slack__search_messages', tool_input: { query: 'tool in:#approved', oldest: RANGE.from, latest: RANGE.to } }, slackScope).allow, true)
  assert.strictEqual(guard.decision({ tool_name: 'mcp__plugin_software_slack__search_messages', tool_input: { query: `tool in:#approved after:${RANGE.from} before:${RANGE.to}` } }, slackScope).allow, false)
  assert.strictEqual(guard.decision({ tool_name: 'mcp__plugin_software_slack__slack_search_public_and_private', tool_input: { query: 'tool in:#approved', after: slackFrom, before: slackTo } }, slackScope).allow, true)
  assert.strictEqual(guard.decision({ tool_name: 'mcp__plugin_software_slack__slack_search_public_and_private', tool_input: { query: 'tool in:#approved', oldest: slackFrom, latest: slackTo } }, slackScope).allow, false)
  assert.strictEqual(guard.decision({ tool_name: 'mcp__plugin_software_slack__search_messages_and_files', tool_input: { query: `tool in:#approved after:${RANGE.from} before:${RANGE.to}` } }, slackScope).allow, true)
  assert.strictEqual(guard.decision({ tool_name: 'mcp__plugin_software_slack__search_messages', tool_input: { query: 'tool in:#approved OR in:#private', oldest: RANGE.from, latest: RANGE.to } }, slackScope).allow, false)
  assert.strictEqual(guard.decision({ tool_name: 'mcp__plugin_software_slack__search_messages', tool_input: { query: 'tool in:#approved OR outage', oldest: RANGE.from, latest: RANGE.to } }, slackScope).allow, false)
  assert.strictEqual(guard.decision({ tool_name: 'mcp__plugin_software_slack__search_messages', tool_input: { query: 'tool -in:#approved', oldest: RANGE.from, latest: RANGE.to } }, slackScope).allow, false)
  assert.strictEqual(guard.decision({ tool_name: 'mcp__plugin_software_slack__search_messages', tool_input: { query: 'tool (-in:dm-approved)', oldest: RANGE.from, latest: RANGE.to } }, slackScope).allow, false)
  assert.strictEqual(guard.decision({ tool_name: 'mcp__plugin_software_ramp__get_payment', tool_input: { id: 'payment-1', account: 'approved', from: RANGE.from, to: RANGE.to } }, rampScope).allow, true)
  assert.strictEqual(guard.decision({ tool_name: 'mcp__plugin_software_quickbooks__list_payments', tool_input: { account: 'approved', from: RANGE.from, to: RANGE.to } }, rampScope).allow, true)
  assert.strictEqual(guard.decision({ tool_name: 'mcp__plugin_software_slack__search_messages', tool_input: { query: `tool in:#wrong after:${RANGE.from} before:${RANGE.to}` } }, slackScope).allow, false)
  assert.strictEqual(guard.decision({ tool_name: 'mcp__plugin_software_slack__read_channel', tool_input: { direct_message: '#approved', from: RANGE.from, to: RANGE.to } }, slackScope).allow, false)
  assert.strictEqual(guard.decision({ tool_name: 'mcp__plugin_software_slack__read_channel', tool_input: { channel: 'dm-approved', from: RANGE.from, to: RANGE.to } }, slackScope).allow, false)
  assert.strictEqual(guard.decision({ tool_name: 'mcp__plugin_software_slack__slack_read_channel', tool_input: { channel: '#approved', oldest: slackFrom, latest: slackTo } }, slackScope).allow, true)
  assert.strictEqual(guard.decision({ tool_name: 'mcp__plugin_software_slack__slack_read_thread', tool_input: { direct_message: 'dm-approved', oldest: slackFrom, latest: slackTo } }, slackScope).allow, true)
  assert.strictEqual(guard.decision({ tool_name: 'mcp__plugin_software_slack__slack_read_thread', tool_input: { direct_message: 'dm-approved', oldest: String(Date.parse('2025-12-31T23:59:59Z') / 1000), latest: slackTo } }, slackScope).allow, false)
  assert.strictEqual(guard.decision({ tool_name: 'mcp__plugin_software_ramp__get_payment', tool_input: { id: 'payment-1', account: 'approved' } }, rampScope).allow, false)
  assert.strictEqual(guard.decision({ tool_name: 'mcp__plugin_software_ramp__get_payment', tool_input: { id: 'payment-1', account: 'approved', from: RANGE.from, to: RANGE.to } }).allow, false)
  assert.strictEqual(guard.decision({ tool_name: 'mcp__plugin_software_gmail__search_threads', tool_input: { query: `tool after:${RANGE.from} before:${gmailBefore}` } }, gmailScope).allow, true)
  assert.strictEqual(guard.decision({ tool_name: 'mcp__plugin_software_gmail__search_threads', tool_input: { query: `tool after:${RANGE.from} before:${RANGE.to}` } }, gmailScope).allow, false)
  assert.strictEqual(guard.decision({ tool_name: 'mcp__plugin_software_gmail__search_threads', tool_input: { query: `tool after:${RANGE.from} before:${gmailBefore} OR before:2020-01-01` } }, gmailScope).allow, false)
  assert.strictEqual(guard.decision({ tool_name: 'mcp__plugin_software_gmail__search_threads', tool_input: { query: `{ after:${RANGE.from} before:${gmailBefore} from:vendor@example.com }` } }, gmailScope).allow, false)
  assert.strictEqual(guard.decision({ tool_name: 'mcp__plugin_software_gmail__search_threads', tool_input: { query: `tool after:${RANGE.from} before:${gmailBefore} after:2020-01-01` } }, gmailScope).allow, false)
  assert.strictEqual(guard.decision({ tool_name: 'mcp__plugin_software_gmail__search_threads', tool_input: { query: `tool after:${RANGE.from} before:${gmailBefore} observed:2020-01-01` } }, gmailScope).allow, false)
  assert.strictEqual(guard.decision({ tool_name: 'mcp__plugin_software_gmail__search_threads', tool_input: { query: `tool -after:${RANGE.from} before:${gmailBefore}` } }, gmailScope).allow, false)
  assert.strictEqual(guard.decision({ tool_name: 'mcp__plugin_software_gmail__search_threads', tool_input: { query: `tool before:${gmailBefore}` } }, gmailScope).allow, false)
  assert.strictEqual(guard.decision({ tool_name: 'mcp__plugin_software_gmail__search_threads', tool_input: { query: `tool after:${RANGE.from}` } }, gmailScope).allow, false)
  assert.strictEqual(guard.decision({ tool_name: 'mcp__plugin_software_gmail__search_threads', tool_input: { query: `tool ${RANGE.from} ${gmailBefore}` } }, gmailScope).allow, false)
  assert.strictEqual(guard.decision({ tool_name: 'mcp__plugin_software_docusign__get-and-update-envelope', tool_input: { account: 'approved', from: RANGE.from, to: RANGE.to } }, docusignScope).allow, false)
  for (const method of ['send_message', 'post_message', 'create_page', 'update_record', 'delete_file', 'approve_bill', 'pay_bill', 'transfer_money', 'sign_envelope', 'void_envelope', 'cancel_event']) {
    assert.strictEqual(guard.decision({ tool_name: `mcp__plugin_software_slack__${method}`, tool_input: { channel: '#approved', from: RANGE.from, to: RANGE.to } }, slackScope).allow, false, method)
  }
})

check('hook refuses malformed input and credential-shaped connector input without echoing it', () => {
  assert.strictEqual(guard.decision(null).allow, false)
  const secret = 'sk-live_abcdefghijklmno'
  const gmailScope = acceptedScope('research', { sourceBoundaries: {
    'software-directory': {},
    gmail: { mailbox: 'own', dateRange: { ...RANGE } }
  } })
  const result = guard.decision({ tool_name: 'mcp__plugin_software_gmail__search_threads', tool_input: { query: `${secret} after:${RANGE.from} before:${guard.nextDay(RANGE.to)}` } }, gmailScope)
  assert.strictEqual(result.allow, false)
  assert.doesNotMatch(JSON.stringify(result), new RegExp(secret))
  for (const toolName of [
    'WebSearch',
    'WebFetch',
    'mcp__plugin_software_box__read_file_content',
    'mcp__plugin_software_google-drive__read_file_content',
    'mcp__plugin_software_gmail__get_thread',
    'mcp__plugin_software_slack__read_thread',
    'mcp__plugin_software_ramp__get_payment',
    'mcp__plugin_software_quickbooks__list_payments',
    'mcp__plugin_software_docusign__get_envelope',
    'mcp__plugin_software_google-calendar__get_event',
    'mcp__plugin_software_granola__get_meeting_transcript',
    'mcp__plugin_software_gong__get_call'
  ]) {
    const post = guard.decision({ tool_name: toolName, tool_input: {}, hook_event_name: 'PostToolUse', tool_response: { text: secret } })
    assert.strictEqual(post.allow, false, toolName)
    assert.doesNotMatch(JSON.stringify(post), new RegExp(secret))
  }
})

check('hook emits event-correct denial output', () => {
  const reason = 'The bounded read could not be recorded.'
  assert.deepStrictEqual(guard.hookOutput({ allow: false, reason }), {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason
    }
  })
  assert.deepStrictEqual(guard.hookOutput({ allow: false, hookEventName: 'PostToolUse', reason }), {
    decision: 'block',
    reason
  })
  assert.deepStrictEqual(guard.hookOutput({ allow: true }), {})
})

check('hook-owned file updates serialize concurrent writers', () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtm-software-evaluate-'))
  const file = path.join(runDir, 'concurrent-sequence.json')
  const worker = path.join(__dirname, 'fixtures', 'software-evaluate-lock-worker.js')
  const values = ['alpha', 'bravo', 'charlie', 'delta']
  try {
    fs.writeFileSync(file, '{"values":[]}\n', { mode: 0o600 })
    const quote = value => `'${value.replace(/'/g, `'\\''`)}'`
    const commands = values.map(value => `${quote(process.execPath)} ${quote(worker)} ${quote(file)} ${quote(value)} &`).join('\n')
    execFileSync('/bin/sh', ['-c', `${commands}\nwait`], { stdio: 'pipe' })
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).values.sort(), values.sort())
    assert.strictEqual(fs.existsSync(`${file}.lock`), false)
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true })
  }
})

check('Box and Google Drive content reads require an id returned by the accepted bounded search', () => {
  const scope = acceptedScope('research', { sourceBoundaries: {
    'software-directory': {},
    box: { folder: 'folder-123', dateRange: { ...RANGE } },
    'google-drive': { folder: 'folder-123', dateRange: { ...RANGE } }
  } })
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtm-software-evaluate-'))
  const document = { scope, runDir, scopeFile: path.join(runDir, 'read-scope.json') }
  try {
    for (const [connector, toolInput] of [
      ['box', { folder_id: 'folder-123', query: `Acme from:${RANGE.from} to:${RANGE.to}` }],
      ['google-drive', { query: `parentId = 'folder-123' and modifiedTime >= '${RANGE.from}T00:00:00-04:00' and modifiedTime <= '${RANGE.to}T23:59:59-04:00'` }]
    ]) {
      const search = { tool_name: `mcp__plugin_software_${connector}__search_files`, tool_input: toolInput }
      assert.strictEqual(guard.decision(search, document).allow, true)
      assert.strictEqual(guard.decision({ ...search, tool_input: { ...toolInput, query: `${toolInput.query} OR outside` } }, document).allow, false)
      if (connector === 'google-drive') {
        assert.strictEqual(guard.decision({ ...search, tool_input: { query: `not parentId = 'folder-123' and modifiedTime >= '${RANGE.from}T00:00:00Z' and modifiedTime <= '${RANGE.to}T23:59:59Z'` } }, document).allow, false)
        assert.strictEqual(guard.decision({ ...search, tool_input: { query: `not (parentId = 'folder-123') and modifiedTime >= '${RANGE.from}T00:00:00Z' and modifiedTime <= '${RANGE.to}T23:59:59Z'` } }, document).allow, false)
        assert.strictEqual(guard.decision({ ...search, tool_input: { query: `parentId = 'folder-123' and not modifiedTime >= '${RANGE.from}T00:00:00Z' and modifiedTime <= '${RANGE.to}T23:59:59Z'` } }, document).allow, false)
      }
      const fileId = `${connector}-returned-file`
      assert.strictEqual(guard.decision({
        ...search,
        hook_event_name: 'PostToolUse',
        tool_response: {
          metadata: { id: 'transport-metadata-injection' },
          files: [{
            id: fileId,
            name: '{"files":[{"id":"filename-injection"}]} Private contract name must not be persisted',
            owner: { id: 'nested-owner-injection' }
          }]
        }
      }, document).allow, true)
      const earlierFileId = `${connector}-earlier-file`
      assert.strictEqual(guard.decision({
        ...search,
        hook_event_name: 'PostToolUse',
        tool_response: { files: [{ id: earlierFileId }] }
      }, document).allow, true)
      const read = { tool_name: `mcp__plugin_software_${connector}__read_file_content`, tool_input: { fileId } }
      assert.strictEqual(guard.decision(read, document).allow, true)
      assert.strictEqual(guard.decision({ ...read, tool_input: { fileId: earlierFileId } }, document).allow, true)
      assert.strictEqual(guard.decision({ ...read, tool_input: { fileId: 'nested-owner-injection' } }, document).allow, false)
      assert.strictEqual(guard.decision({ ...read, tool_input: { fileId: 'transport-metadata-injection' } }, document).allow, false)
      assert.strictEqual(guard.decision({ ...read, tool_input: { fileId: 'filename-injection' } }, document).allow, false)
      assert.strictEqual(guard.decision({ ...read, tool_input: { fileId: `${connector}-not-returned` } }, document).allow, false)
      const erroredFileId = `${connector}-errored-result`
      assert.strictEqual(guard.decision({
        ...search,
        hook_event_name: 'PostToolUse',
        tool_response: { isError: true, error: 'search failed', files: [{ id: erroredFileId }] }
      }, document).allow, true)
      assert.strictEqual(guard.decision({ ...read, tool_input: { fileId: erroredFileId } }, document).allow, false)
    }
    const authorizationFile = path.join(runDir, 'connector-read-authorizations.json')
    assert.strictEqual(fs.statSync(authorizationFile).mode & 0o777, 0o600)
    const authorization = fs.readFileSync(authorizationFile, 'utf8')
    assert.doesNotMatch(authorization, /Private contract name/)
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true })
  }
})

check('Gmail detail reads require one id returned by an accepted date-bounded search', () => {
  const scope = acceptedScope('research', { sourceBoundaries: {
    'software-directory': {},
    gmail: { mailbox: 'own', dateRange: { ...RANGE } }
  } })
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtm-software-evaluate-'))
  const document = { scope, runDir, scopeFile: path.join(runDir, 'read-scope.json') }
  const search = {
    tool_name: 'mcp__plugin_software_gmail__search_threads',
    tool_input: { query: `Acme after:${RANGE.from} before:${guard.nextDay(RANGE.to)}` }
  }
  try {
    assert.strictEqual(guard.decision(search, document).allow, true)
    assert.strictEqual(guard.decision({
      ...search,
      hook_event_name: 'PostToolUse',
      tool_response: { messages: [{
        id: 'returned-message',
        threadId: 'returned-thread',
        owner: { id: 'nested-owner-injection' },
        snippet: '{"threads":[{"id":"snippet-injection"}]}'
      }] }
    }, document).allow, true)
    assert.strictEqual(guard.decision({ tool_name: 'mcp__plugin_software_gmail__get_message', tool_input: { message_id: 'returned-message' } }, document).allow, true)
    assert.strictEqual(guard.decision({ tool_name: 'mcp__plugin_software_gmail__get_thread', tool_input: { threadId: 'returned-thread' } }, document).allow, true)
    assert.strictEqual(guard.decision({ tool_name: 'mcp__plugin_software_gmail__get_thread', tool_input: { threadId: 'nested-owner-injection' } }, document).allow, false)
    assert.strictEqual(guard.decision({ tool_name: 'mcp__plugin_software_gmail__get_thread', tool_input: { threadId: 'snippet-injection' } }, document).allow, false)
    assert.strictEqual(guard.decision({ tool_name: 'mcp__plugin_software_gmail__get_message', tool_input: { message_id: 'not-returned' } }, document).allow, false)
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true })
  }
})

check('hook-derived net-new page authorization covers the whole current stack', () => {
  const scope = acceptedScope()
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtm-software-evaluate-'))
  try {
    const plan = evaluate.surveyPlan({ surveyRunId: 'net-new-hook-overlap' }, scope, context)
    const firstUrl = notionUrl('1', 'Current-One')
    const secondUrl = notionUrl('2', 'Current-Two')
    const artifactUrl = notionUrl('3', 'Current-Artifact')
    const rows = [
      rowFor(plan, firstUrl, { Name: 'Current One', 'Integrates with': [], Artifacts: [artifactUrl] }),
      rowFor(plan, secondUrl, { Name: 'Current Two', 'Integrates with': [], Artifacts: [] })
    ]
    const surveyPlanFile = path.join(runDir, 'survey-plan.json')
    fs.writeFileSync(surveyPlanFile, JSON.stringify(plan))
    fs.writeFileSync(path.join(runDir, 'notion-survey-authorizations.json'), JSON.stringify({
      scopeId: scope.scopeId,
      planFingerprint: evidenceContract.fingerprint(plan),
      details: execution(plan, 'software-details', rows)
    }))
    const document = {
      scope,
      runDir,
      scopeFile: path.join(runDir, 'read-scope.json'),
      surveyContext: context,
      softwareDataSourceUrl: plan.softwareDataSourceUrl,
      surveyPlanFile
    }
    const groups = guard.surveyRelatedIdentityGroups({}, document)
    const identity = url => url.replace(/.*-/, '')
    assert.deepStrictEqual([...groups.software].sort(), [firstUrl, secondUrl].map(identity).sort())
    assert.deepStrictEqual([...groups.artifacts], [identity(artifactUrl)])
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true })
  }
})

check('hook binds Notion and web reads to the installed accepted scope', () => {
  const scope = acceptedScope('research', { targetType: 'existing', candidateDirectoryState: 'existing', sourceBoundaries: {
    'software-directory': {},
    'vendor-web': { domains: ['vendor.example'], dateRange: { ...RANGE } }
  } })
  const document = { scope, softwareDataSourceUrl: 'notion://software-source', notionPageIds: [] }
  assert.strictEqual(guard.decision({ tool_name: 'mcp__codex_apps__notion_query_data_sources', tool_input: { data: { data_source_urls: ['notion://software-source'], query: 'SELECT *' } } }, document).allow, false)
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtm-software-evaluate-'))
  try {
    const plan = evaluate.surveyPlan({ surveyRunId: 'guard-survey' }, scope, context)
    const approved = notionUrl('7', 'Acme-Evaluate')
    const artifact = notionUrl('8', 'Approved-Artifact')
    const outside = notionUrl('9', 'Outside-Survey')
    const unrelated = notionUrl('6', 'Unrelated-Software')
    const unrelatedArtifact = notionUrl('5', 'Unrelated-Artifact')
    const rows = [
      rowFor(plan, approved, { Name: 'Acme Evaluate', Artifacts: [artifact] }),
      rowFor(plan, unrelated, { Name: 'Unrelated Software', Artifacts: [unrelatedArtifact] })
    ]
    const manifestRows = rows.map(row => manifestRow(plan, row))
    const before = execution(plan, 'manifest-before', manifestRows)
    const details = execution(plan, 'software-details', rows)
    const surveyPlanFile = path.join(runDir, 'survey-plan.json')
    const softwareDetailsFile = path.join(runDir, 'software-details.json')
    fs.writeFileSync(surveyPlanFile, JSON.stringify(plan))
    fs.writeFileSync(softwareDetailsFile, JSON.stringify(details))
    const surveyedDocument = {
      scope,
      runDir,
      surveyContext: context,
      softwareDataSourceUrl: plan.softwareDataSourceUrl,
      surveyPlanFile,
      softwareDetailsFile,
      notionPageIds: [approved, artifact]
    }
    const manifestQuery = { tool_name: 'mcp__codex_apps__notion_query_data_sources', tool_input: { data_sources: [plan.softwareDataSourceUrl], query: plan.queries.manifest.sql } }
    const detailsQuery = { tool_name: 'mcp__codex_apps__notion_query_data_sources', tool_input: { data_sources: [plan.softwareDataSourceUrl], query: plan.queries.details.sql } }
    assert.strictEqual(guard.decision({ ...manifestQuery, tool_input: { ...manifestQuery.tool_input, data_sources: [plan.softwareDataSourceUrl, plan.softwareDataSourceUrl] } }, surveyedDocument).allow, false)
    assert.strictEqual(guard.decision({ ...manifestQuery, tool_input: { ...manifestQuery.tool_input, query: 'SELECT * FROM other LIMIT 1' } }, surveyedDocument).allow, false)
    const noncanonicalPlan = clone(plan)
    noncanonicalPlan.queries.details.sql += ' LIMIT 1'
    fs.writeFileSync(surveyPlanFile, JSON.stringify(noncanonicalPlan))
    assert.strictEqual(guard.installedSurveyPlan(manifestQuery, surveyedDocument), null)
    fs.writeFileSync(surveyPlanFile, JSON.stringify(plan))
    assert.strictEqual(guard.decision(manifestQuery, surveyedDocument).allow, true)
    assert.strictEqual(guard.decision(detailsQuery, surveyedDocument).allow, false)
    const secretResponse = clone(before.envelopes[0])
    secretResponse.results[0].Description = 'api_key=abcdefghijklmno'
    const secretPost = guard.decision({ ...manifestQuery, hook_event_name: 'PostToolUse', tool_response: secretResponse }, surveyedDocument)
    assert.strictEqual(secretPost.allow, false)
    assert.doesNotMatch(JSON.stringify(secretPost), /abcdefghijklmno/)
    assert.strictEqual(fs.existsSync(path.join(runDir, 'notion-survey-sequence.json')), false)
    const erroredManifestResponse = {
      isError: true,
      error: 'connector failure',
      content: [{ type: 'text', text: JSON.stringify(before.envelopes[0]) }]
    }
    assert.strictEqual(guard.decision({ ...manifestQuery, hook_event_name: 'PostToolUse', tool_response: erroredManifestResponse }, surveyedDocument).allow, false)
    assert.strictEqual(fs.existsSync(path.join(runDir, 'notion-survey-sequence.json')), false)
    assert.strictEqual(guard.decision({ ...manifestQuery, hook_event_name: 'PostToolUse', tool_response: before.envelopes[0] }, surveyedDocument).allow, true)
    assert.strictEqual(guard.decision(detailsQuery, surveyedDocument).allow, true)
    assert.strictEqual(guard.decision({ tool_name: 'mcp__codex_apps__notion_fetch', tool_input: { id: approved } }, surveyedDocument).allow, false)
    assert.strictEqual(guard.decision({ ...detailsQuery, hook_event_name: 'PostToolUse', tool_response: details.envelopes[0] }, surveyedDocument).allow, true)
    assert.strictEqual(guard.decision(manifestQuery, surveyedDocument).allow, false)
    assert.strictEqual(guard.decision({ tool_name: 'mcp__codex_apps__notion_query_data_sources', tool_input: { data_sources: ['notion://other-source'], query: plan.queries.manifest.sql } }, surveyedDocument).allow, false)
    assert.strictEqual(guard.decision({ tool_name: 'mcp__codex_apps__notion_query_data_sources', tool_input: { data_sources: [plan.softwareDataSourceUrl, 'notion://other-source'], query: plan.queries.manifest.sql } }, surveyedDocument).allow, false)
    assert.strictEqual(guard.decision({ tool_name: 'mcp__codex_apps__notion_query_data_sources', tool_input: { data_sources: [plan.softwareDataSourceUrl], query: 'SELECT * FROM other LIMIT 1' } }, surveyedDocument).allow, false)
    assert.strictEqual(guard.decision({ tool_name: 'mcp__codex_apps__notion_query_data_sources', tool_input: { data_sources: [plan.softwareDataSourceUrl], query: `${plan.queries.manifest.sql} -- widened` } }, surveyedDocument).allow, false)
    const approvedFetch = { tool_name: 'mcp__codex_apps__notion_fetch', tool_input: { id: approved } }
    const artifactFetch = { tool_name: 'mcp__codex_apps__notion_fetch', tool_input: { id: artifact } }
    const softwareBody = `Here is the result of "view" for the Page with URL ${approved} as of ${TODAY}T12:00:00-04:00:\n<page url="${approved}">\n<properties>\n{"Name":"Acme Evaluate"}\n</properties>\n<content>\nFetched Software body.\n</content>\n</page>`
    const softwareResponse = { metadata: { type: 'page' }, url: approved, text: softwareBody }
    const processProperties = { Type: { type: 'select', select: { name: 'Technical Reference' } } }
    const processResponse = { metadata: { type: 'page' }, url: artifact, last_edited_time: `${TODAY}T12:00:00-04:00`, properties: processProperties, body: 'Fetched Process body.' }
    const softwareCapture = guard.notionFetchArtifact([{ type: 'text', text: JSON.stringify(softwareResponse) }], approved.replace(/.*-/, ''))
    assert.strictEqual(softwareCapture.last_edited_time, null, 'Notion retrieval time must not be promoted to source edit time')
    assert.strictEqual(guard.decision(approvedFetch, surveyedDocument).allow, true)
    assert.strictEqual(guard.decision({ ...approvedFetch, hook_event_name: 'PostToolUse', tool_response: { isError: true, error: 'not found', url: approved, last_edited_time: `${TODAY}T12:00:00-04:00`, body: 'Error payload must not count as a page.' } }, surveyedDocument).allow, false)
    assert.strictEqual(guard.decision({ ...approvedFetch, hook_event_name: 'PostToolUse', tool_response: { url: outside, last_edited_time: `${TODAY}T12:00:00-04:00`, body: 'Wrong page.' } }, surveyedDocument).allow, false)
    assert.strictEqual(guard.decision({ ...approvedFetch, hook_event_name: 'PostToolUse', tool_response: [{ type: 'text', text: JSON.stringify(softwareResponse) }] }, surveyedDocument).allow, true)
    assert.strictEqual(guard.decision(artifactFetch, surveyedDocument).allow, true)
    assert.strictEqual(guard.decision({ ...artifactFetch, hook_event_name: 'PostToolUse', tool_response: processResponse }, surveyedDocument).allow, true)
    surveyedDocument.notionPageIds.push(unrelated)
    assert.strictEqual(guard.decision({ tool_name: 'mcp__codex_apps__notion_fetch', tool_input: { id: unrelated } }, surveyedDocument).allow, false)
    surveyedDocument.notionPageIds.pop()
    surveyedDocument.notionPageIds.push(unrelatedArtifact)
    assert.strictEqual(guard.decision({ tool_name: 'mcp__codex_apps__notion_fetch', tool_input: { id: unrelatedArtifact } }, surveyedDocument).allow, false)
    surveyedDocument.notionPageIds.pop()
    assert.strictEqual(guard.decision({ tool_name: 'mcp__codex_apps__notion_fetch', tool_input: { id: outside } }, surveyedDocument).allow, false)
    surveyedDocument.notionPageIds.push(outside)
    assert.strictEqual(guard.decision({ tool_name: 'mcp__codex_apps__notion_fetch', tool_input: { id: outside } }, surveyedDocument).allow, false)
    surveyedDocument.notionPageIds.pop()
    const injected = clone(details)
    injected.envelopes[0].results[0].Artifacts = [outside]
    fs.writeFileSync(softwareDetailsFile, JSON.stringify(injected))
    surveyedDocument.notionPageIds.push(outside)
    assert.strictEqual(guard.decision({ tool_name: 'mcp__codex_apps__notion_fetch', tool_input: { id: outside } }, surveyedDocument).allow, false)
    surveyedDocument.notionPageIds.pop()
    assert.strictEqual(guard.decision({ tool_name: 'mcp__codex_apps__notion_fetch', tool_input: { id: approved } }, surveyedDocument).allow, true)

    const authorizationFile = path.join(runDir, 'notion-survey-authorizations.json')
    assert.strictEqual(fs.statSync(authorizationFile).mode & 0o777, 0o600)
    const sequenceFile = path.join(runDir, 'notion-survey-sequence.json')
    assert.strictEqual(fs.statSync(sequenceFile).mode & 0o777, 0o600)
    assert.strictEqual(guard.decision({ tool_name: 'Write', tool_input: { file_path: authorizationFile, content: JSON.stringify(injected) } }, surveyedDocument).allow, false)
    assert.strictEqual(guard.decision({ tool_name: 'Write', tool_input: { file_path: sequenceFile, content: '{}' } }, surveyedDocument).allow, false)
    assert.strictEqual(guard.decision({ tool_name: 'Write', tool_input: { file_path: path.join(runDir, 'connector-read-authorizations.json'), content: '{}' } }, surveyedDocument).allow, false)

    const artifactPages = {
      scopeId: scope.scopeId,
      surveyRunId: plan.surveyRunId,
      softwareBodies: [{ url: approved, properties: { Name: 'Acme Evaluate' }, body: softwareBody }],
      pages: [{ url: artifact, last_edited_time: `${TODAY}T12:00:00-04:00`, properties: processProperties, body: 'Fetched Process body.' }]
    }
    assert.strictEqual(guard.attestRelatedReadSequence({ cwd: process.cwd() }, scope, plan, { ...artifactPages, softwareBodies: [] }, surveyedDocument).ok, false)
    assert.strictEqual(guard.attestRelatedReadSequence({ cwd: process.cwd() }, scope, plan, { ...artifactPages, pages: [] }, surveyedDocument).ok, false)
    assert.strictEqual(guard.attestRelatedReadSequence({ cwd: process.cwd() }, scope, plan, { ...artifactPages, softwareBodies: [...artifactPages.softwareBodies, { url: outside, last_edited_time: `${TODAY}T12:00:00-04:00`, body: 'Unrelated Software body.' }] }, surveyedDocument).ok, false)
    assert.strictEqual(guard.attestRelatedReadSequence({ cwd: process.cwd() }, scope, plan, { ...artifactPages, pages: [...artifactPages.pages, { url: outside, last_edited_time: `${TODAY}T12:00:00-04:00`, body: 'Unrelated Process body.' }] }, surveyedDocument).ok, false)
    assert.strictEqual(guard.attestRelatedReadSequence({ cwd: process.cwd() }, scope, plan, { ...artifactPages, softwareBodies: [{ ...artifactPages.softwareBodies[0], body: 'Invented body.' }] }, surveyedDocument).ok, false)
    assert.strictEqual(guard.attestRelatedReadSequence({ cwd: process.cwd() }, scope, plan, { ...artifactPages, pages: [{ ...artifactPages.pages[0], last_edited_time: '2026-08-27T12:00:00-04:00' }] }, surveyedDocument).ok, false)
    assert.strictEqual(guard.attestRelatedReadSequence({ cwd: process.cwd() }, scope, plan, { ...artifactPages, pages: [{ ...artifactPages.pages[0], properties: { Type: { type: 'select', select: { name: 'Strategy Decision' } } } }] }, surveyedDocument).ok, false)
    const capturedOrder = JSON.parse(fs.readFileSync(sequenceFile, 'utf8'))
    assert.strictEqual(capturedOrder.fetches.every(fetch => /^notion-fetch-artifact:[a-f0-9]{64}$/.test(fetch.artifactFingerprint)), true)
    const missingFetch = clone(capturedOrder)
    missingFetch.fetches.pop()
    fs.writeFileSync(sequenceFile, JSON.stringify(missingFetch))
    assert.strictEqual(guard.attestRelatedReadSequence({ cwd: process.cwd() }, scope, plan, artifactPages, surveyedDocument).ok, false)
    const wrongOrder = clone(capturedOrder)
    wrongOrder.fetches.reverse()
    fs.writeFileSync(sequenceFile, JSON.stringify(wrongOrder))
    assert.strictEqual(guard.attestRelatedReadSequence({ cwd: process.cwd() }, scope, plan, artifactPages, surveyedDocument).ok, false)
    const duplicateFetch = clone(capturedOrder)
    duplicateFetch.fetches.push(clone(duplicateFetch.fetches[duplicateFetch.fetches.length - 1]))
    fs.writeFileSync(sequenceFile, JSON.stringify(duplicateFetch))
    assert.strictEqual(guard.attestRelatedReadSequence({ cwd: process.cwd() }, scope, plan, artifactPages, surveyedDocument).ok, false)
    fs.writeFileSync(sequenceFile, JSON.stringify(capturedOrder))
    const related = guard.attestRelatedReadSequence({ cwd: process.cwd() }, scope, plan, artifactPages, surveyedDocument)
    assert.strictEqual(related.ok, true, related.problems && related.problems.join('\n'))
    const after = execution(plan, 'manifest-after', clone(manifestRows))
    after.precedingExecutions = related.precedingExecutions
    assert.strictEqual(guard.trustedSurveySequenceAttestation({ cwd: process.cwd() }, scope, plan, before, details, after, surveyedDocument).ok, false)
    assert.strictEqual(guard.decision(manifestQuery, surveyedDocument).allow, true)
    assert.strictEqual(guard.decision({ ...manifestQuery, hook_event_name: 'PostToolUse', tool_response: after.envelopes[0] }, surveyedDocument).allow, true)
    const trustedSequence = guard.trustedSurveySequenceAttestation({ cwd: process.cwd() }, scope, plan, before, details, after, surveyedDocument)
    assert.strictEqual(trustedSequence.ok, true, trustedSequence.problems && trustedSequence.problems.join('\n'))
    const changedBefore = clone(before)
    changedBefore.envelopes[0].transport_note = 'not hook captured'
    assert.strictEqual(guard.trustedSurveySequenceAttestation({ cwd: process.cwd() }, scope, plan, changedBefore, details, after, surveyedDocument).ok, false)
    assert.strictEqual(evaluateCore.directoryProof(scope, plan, before, details, after, context, trustedSequence).ok, true)

    const changedPlan = clone(plan)
    changedPlan.queries.details.sql += ' LIMIT 1'
    fs.writeFileSync(surveyPlanFile, JSON.stringify(changedPlan))
    assert.strictEqual(guard.decision(detailsQuery, surveyedDocument).allow, false)
    const changedDetailsQuery = { ...detailsQuery, tool_input: { ...detailsQuery.tool_input, query: changedPlan.queries.details.sql } }
    assert.strictEqual(guard.decision(changedDetailsQuery, surveyedDocument).allow, false)
    fs.writeFileSync(surveyPlanFile, JSON.stringify(plan))
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true })
  }
  assert.strictEqual(guard.decision({ tool_name: 'WebSearch', tool_input: { query: `site:vendor.example after:${RANGE.from} before:${RANGE.to}` } }, document).allow, true)
  assert.strictEqual(guard.decision({ tool_name: 'WebSearch', tool_input: { query: `site:other.example after:${RANGE.from} before:${RANGE.to}` } }, document).allow, false)
  assert.strictEqual(guard.decision({ tool_name: 'WebSearch', tool_input: { query: `site:vendor.example OR site:other.example after:${RANGE.from} before:${RANGE.to}` } }, document).allow, false)
  assert.strictEqual(guard.decision({ tool_name: 'WebSearch', tool_input: { query: `site:vendor.example OR pricing after:${RANGE.from} before:${RANGE.to}` } }, document).allow, false)
  assert.strictEqual(guard.decision({ tool_name: 'WebSearch', tool_input: { query: `-site:vendor.example after:${RANGE.from} before:${RANGE.to}` } }, document).allow, false)
  assert.strictEqual(guard.decision({ tool_name: 'WebSearch', tool_input: { query: `review https://vendor.example after:${RANGE.from} before:${RANGE.to}` } }, document).allow, false)
  assert.strictEqual(guard.decision({ tool_name: 'WebFetch', tool_input: { url: 'https://vendor.example/pricing' } }, document).allow, true)
  assert.strictEqual(guard.decision({ tool_name: 'WebFetch', tool_input: { url: 'https://docs.vendor.example/pricing' } }, document).allow, false)
  assert.strictEqual(guard.decision({ tool_name: 'WebFetch', tool_input: { url: 'https://other.example/pricing' } }, document).allow, false)
  const secretWeb = guard.decision({ tool_name: 'WebSearch', tool_input: { query: `site:vendor.example sk-live_abcdefghijklmno after:${RANGE.from} before:${RANGE.to}` } }, document)
  assert.strictEqual(secretWeb.allow, false)
  assert.doesNotMatch(JSON.stringify(secretWeb), /sk-live_abcdefghijklmno/)
  const secretNotion = guard.decision({ tool_name: 'mcp__codex_apps__notion_query_data_sources', tool_input: { data_sources: ['notion://software-source'], query: 'SELECT * -- api_key=abcdefghijklmno' } }, document)
  assert.strictEqual(secretNotion.allow, false)
  assert.doesNotMatch(JSON.stringify(secretNotion), /abcdefghijklmno/)

  const meeting = '11111111-1111-4111-8111-111111111111'
  const meetingScope = acceptedScope('research', { sourceBoundaries: {
    'software-directory': {},
    granola: { meetings: [meeting], dateRange: { ...RANGE } }
  } })
  assert.strictEqual(guard.decision({ tool_name: 'mcp__plugin_software_granola__get_meeting_transcript', tool_input: { meeting_id: meeting } }, meetingScope).allow, true)
  assert.strictEqual(guard.decision({ tool_name: 'mcp__plugin_software_granola__get_meeting_transcript', tool_input: { meeting_id: '22222222-2222-4222-8222-222222222222' } }, meetingScope).allow, false)
})

check('hook accepts only connector-enforced Slack and Calendar date fields', () => {
  const meeting = '11111111-1111-4111-8111-111111111111'
  const calendarScope = acceptedScope('research', { sourceBoundaries: {
    'software-directory': {},
    'google-calendar': { meetings: [meeting], dateRange: { ...RANGE } }
  } })
  const toolName = 'mcp__plugin_software_google-calendar__list_events'
  assert.strictEqual(guard.decision({
    tool_name: toolName,
    tool_input: {
      meeting_id: meeting,
      startTime: `${RANGE.from}T00:00:00-04:00`,
      endTime: `${RANGE.to}T23:59:59-04:00`
    }
  }, calendarScope).allow, true)
  assert.strictEqual(guard.decision({
    tool_name: toolName,
    tool_input: { meeting_id: meeting, query: `after:${RANGE.from} before:${RANGE.to}` }
  }, calendarScope).allow, false)
  assert.strictEqual(guard.decision({
    tool_name: toolName,
    tool_input: { meeting_id: meeting, from: RANGE.from, to: RANGE.to }
  }, calendarScope).allow, false)
})

check('hook allows safe Write and blocks secret-bearing Write before file creation', () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtm-software-evaluate-'))
  try {
    const document = { runDir }
    assert.strictEqual(guard.decision({ tool_name: 'Write', tool_input: { file_path: path.join(runDir, 'safe.json'), content: '{"safe":true}' } }, document).allow, true)
    assert.strictEqual(guard.decision({ tool_name: 'Write', tool_input: { file_path: path.join(os.tmpdir(), 'outside.json'), content: '{"safe":true}' } }, document).allow, false)
    assert.strictEqual(guard.decision({ tool_name: 'Write', tool_input: { file_path: 'relative.json', content: '{"safe":true}' } }, document).allow, false)
    const secret = 'api_key=abcdefghijklmno'
    const result = guard.decision({ tool_name: 'Write', tool_input: { file_path: path.join(runDir, 'no.json'), content: secret } }, document)
    assert.strictEqual(result.allow, false)
    assert.doesNotMatch(JSON.stringify(result), new RegExp(secret))
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true })
  }
})

check('evaluation run artifacts stay in a private temporary directory and clean as one unit', () => {
  const logs = []
  const originalLog = console.log
  let started
  let siblingRunDir
  let pointerLockCalls = 0
  const pointerWriteFlags = []
  const originalWithFileLock = guard.withFileLock
  const originalWriteFileSync = fs.writeFileSync
  guard.withFileLock = (file, action) => {
    if (file === pointerFileFor(process.cwd())) pointerLockCalls++
    return originalWithFileLock(file, action)
  }
  fs.writeFileSync = (file, ...args) => {
    if (file === pointerFileFor(process.cwd())) {
      const options = args[1]
      pointerWriteFlags.push(options && options.flag)
    }
    return originalWriteFileSync(file, ...args)
  }
  console.log = value => logs.push(value)
  try {
    softwareCommand.commands['evaluate-run-start']()
    started = JSON.parse(logs.pop())
    assert.strictEqual(path.dirname(started.runDir), path.resolve(os.tmpdir()))
    assert.ok(path.basename(started.runDir).startsWith('gtm-software-evaluate-'))
    assert.strictEqual(fs.statSync(started.runDir).mode & 0o777, 0o700)
    assert.strictEqual(started.pointerFile, pointerFileFor(process.cwd()))
    assert.strictEqual(path.dirname(started.pointerFile), path.resolve(os.tmpdir()))
    assert.strictEqual(fs.statSync(started.pointerFile).mode & 0o777, 0o600)
    assert.strictEqual(fs.readFileSync(started.pointerFile, 'utf8').trim(), started.scopeFile)
    assert.strictEqual(fs.existsSync(path.join(process.cwd(), '.software-evaluate-read-scope')), false)
    fs.writeFileSync(path.join(started.runDir, 'evidence.json'), '{"private":true}')
    assert.throws(
      () => softwareCommand.commands['evaluate-run-start'](),
      /software:evaluate run is already active/
    )
    assert.strictEqual(fs.readFileSync(path.join(started.runDir, 'evidence.json'), 'utf8'), '{"private":true}')
    assert.strictEqual(fs.readFileSync(started.pointerFile, 'utf8').trim(), started.scopeFile)
    siblingRunDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtm-software-evaluate-'))
    const siblingSentinel = path.join(siblingRunDir, 'must-remain.txt')
    fs.writeFileSync(siblingSentinel, 'owned by another run')
    assert.throws(
      () => softwareCommand.commands['evaluate-run-cleanup'](siblingRunDir),
      /does not own the active software:evaluate scope pointer/
    )
    assert.strictEqual(fs.readFileSync(siblingSentinel, 'utf8'), 'owned by another run')
    softwareCommand.commands['evaluate-run-cleanup'](started.runDir)
    assert.strictEqual(fs.existsSync(started.runDir), false)
    assert.strictEqual(fs.existsSync(started.pointerFile), false)
    assert.strictEqual(pointerLockCalls, 4)
    assert.deepStrictEqual(pointerWriteFlags, ['wx'])
    const skillText = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'software', 'skills', 'evaluate', 'SKILL.md'), 'utf8')
    assert.match(skillText, /hold the same private pointer lock/)
    assert.match(skillText, /packaged search uses its `after` and `before` Unix-timestamp fields/)
    assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8'), /\.software-evaluate-read-scope/)
  } finally {
    for (const entry of logs) {
      try {
        const unexpected = JSON.parse(entry)
        if (unexpected.runDir && path.basename(unexpected.runDir).startsWith('gtm-software-evaluate-') && path.dirname(unexpected.runDir) === path.resolve(os.tmpdir())) {
          fs.rmSync(unexpected.runDir, { recursive: true, force: true })
        }
      } catch (_) {}
    }
    if (started && fs.existsSync(started.runDir)) {
      try { softwareCommand.commands['evaluate-run-cleanup'](started.runDir) } catch (_) {
        fs.rmSync(started.runDir, { recursive: true, force: true })
        fs.rmSync(started.pointerFile, { force: true })
      }
    }
    if (siblingRunDir) fs.rmSync(siblingRunDir, { recursive: true, force: true })
    fs.writeFileSync = originalWriteFileSync
    guard.withFileLock = originalWithFileLock
    console.log = originalLog
  }
})

check('evaluate-reference exposes exactly the shipped operative decision model', () => {
  const output = []
  const originalWrite = process.stdout.write
  try {
    process.stdout.write = chunk => { output.push(String(chunk)); return true }
    softwareCommand.commands['evaluate-reference']()
  } finally {
    process.stdout.write = originalWrite
  }
  const expected = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'software', 'skills', 'evaluate', 'references', 'decision-model.md'), 'utf8')
  assert.strictEqual(output.join(''), expected)
})

check('export scan reports only clean or categories and never the matched value', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'software-evaluate-'))
  const safe = path.join(dir, 'safe.txt')
  const unsafe = path.join(dir, 'unsafe.txt')
  fs.writeFileSync(safe, 'scrubbed usage export')
  const secret = 'bearer abcdefghijklmnopqrstuvwxyz'
  fs.writeFileSync(unsafe, secret)
  assert.strictEqual(evidenceContract.scanFile(safe).clean, true)
  const result = evidenceContract.scanFile(unsafe)
  assert.strictEqual(result.clean, false)
  assert.ok(result.categories.includes('bearer-token'))
  assert.doesNotMatch(JSON.stringify(result), new RegExp(secret))
  fs.rmSync(dir, { recursive: true, force: true })
})

check('a clean user export can be read only through its exact scope-bound scan path', () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'software-evaluate-export-'))
  const artifact = path.join(runDir, 'approved.csv')
  const other = path.join(runDir, 'other.csv')
  const scopeFile = path.join(runDir, 'scope.json')
  fs.writeFileSync(artifact, 'metric,value\naccuracy,0.99\n')
  fs.writeFileSync(other, 'metric,value\naccuracy,0.01\n')
  const scope = acceptedScope('research', {
    sourceBoundaries: { 'software-directory': {}, 'user-export': { artifact, dateRange: { ...RANGE } } }
  })
  fs.writeFileSync(scopeFile, JSON.stringify(scope))
  const output = []
  const originalWrite = process.stdout.write
  try {
    process.stdout.write = chunk => { output.push(String(chunk)); return true }
    softwareCommand.commands['read-scanned-evidence-file'](scopeFile, artifact)
    assert.strictEqual(output.join(''), 'metric,value\naccuracy,0.99\n')
    assert.throws(() => softwareCommand.commands['read-scanned-evidence-file'](scopeFile, other), /exact absolute user-export artifact/)
    const secret = 'api_key=abcdefghijklmno'
    fs.writeFileSync(artifact, secret)
    const refused = evidenceContract.readScannedFile(artifact)
    assert.strictEqual(refused.clean, false)
    assert.strictEqual(Object.prototype.hasOwnProperty.call(refused, 'content'), false)
    assert.doesNotMatch(JSON.stringify(refused), new RegExp(secret))
  } finally {
    process.stdout.write = originalWrite
    fs.rmSync(runDir, { recursive: true, force: true })
  }
})

console.log(failures ? `\n${failures} failed.\n` : '\nAll checks passed.\n')
process.exit(failures ? 1 : 0)
