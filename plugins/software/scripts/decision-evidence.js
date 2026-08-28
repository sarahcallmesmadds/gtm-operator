'use strict'

/**
 * Company-neutral evidence primitives for Software decisions.
 *
 * `software:evaluate` is the first consumer. `software:renew` may reuse this
 * module later, but renewal itself is deliberately not implemented here.
 */

const fs = require('fs')
const crypto = require('crypto')

const CLASSIFICATIONS = ['observed-fact', 'user-statement', 'vendor-claim']
const STANCES = ['supports', 'contradicts', 'context']
const COVERAGE = ['searched', 'unavailable', 'not-searched']
const OPTION_SPECIFIC_CRITERIA = new Set([
  'success-criterion', 'overlap', 'implementation', 'migration', 'security',
  'price', 'terms', 'technical-spike', 'operating-behavior', 'build-cost',
  'technical-owner', 'maintainability', 'blocker-resolution'
])
const DECISION_CRITERIA = new Set([
  ...OPTION_SPECIFIC_CRITERIA,
  'business-need', 'hard-stop', 'deferral', 'accountable-choice'
])
const PRICE_SOURCES = new Set(['signed-terms', 'ramp', 'quickbooks', 'vendor-web', 'independent-web', 'user-export'])
const SUCCESS_SOURCES = new Set(['user-statement', 'product-telemetry', 'technical-spike', 'user-export', 'slack', 'granola', 'gong'])
const BUSINESS_NEED_SOURCES = new Set(['user-statement', 'gmail', 'slack', 'granola', 'gong'])

const SOURCE_KINDS = [
  'software-directory',
  'signed-terms',
  'box',
  'google-drive',
  'docusign',
  'ramp',
  'quickbooks',
  'gmail',
  'slack',
  'google-calendar',
  'granola',
  'gong',
  'vendor-web',
  'independent-web',
  'user-export',
  'user-statement',
  'product-telemetry',
  'technical-spike'
]

const SECRET_PATTERNS = [
  ['api-key', /\b(?:(?:sk|pk|rk)(?:[-_](?:live|test|prod|proj))?[-_][A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/i],
  ['api-key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['token', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/i],
  ['api-key', /\bapi[_-]?key\s*[:=]\s*["']?[^\s"']{8,}/i],
  ['bearer-token', /\bbearer\s+[A-Za-z0-9._~+\/-]{12,}/i],
  ['token', /\b(?:access|refresh|auth)?[_-]?token\s*[:=]\s*["']?[^\s"']{8,}/i],
  ['secret', /\b(?:client[_-]?)?secret\s*[:=]\s*["']?[^\s"']{8,}/i],
  ['password', /\bpass(?:word|wd)?\s*[:=]\s*["']?[^\s"']{6,}/i],
  ['aws-access-key', /\bAKIA[0-9A-Z]{16}\b/],
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['jwt', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/]
]

function isRecord (value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function text (value) {
  return typeof value === 'string' ? value.trim() : ''
}

function canonical (value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (!isRecord(value)) return value
  const out = {}
  for (const key of Object.keys(value).sort()) out[key] = canonical(value[key])
  return out
}

function fingerprint (value, prefix = 'sha256') {
  return `${prefix}:${crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')}`
}

function day (value) {
  const candidate = text(value)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return null
  const parsed = Date.parse(`${candidate}T00:00:00Z`)
  if (Number.isNaN(parsed) || new Date(parsed).toISOString().slice(0, 10) !== candidate) return null
  return candidate
}

function timestamp (value) {
  const candidate = text(value)
  if (!candidate) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return day(candidate)
  if (/^\d{4}-\d{2}-\d{2}T/.test(candidate) && !day(candidate.slice(0, 10))) return null
  if (Number.isNaN(Date.parse(candidate))) return null
  return candidate
}

function calendarDay (value) {
  const parsed = timestamp(value)
  if (!parsed) return null
  if (/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(parsed)) return day(parsed.slice(0, 10))
  return new Date(Date.parse(parsed)).toISOString().slice(0, 10)
}

function categoriesIn (value) {
  let serialized
  try {
    serialized = typeof value === 'string' ? value : JSON.stringify(value)
  } catch (_) {
    return ['unscannable-input']
  }
  const found = new Set()
  for (const [category, pattern] of SECRET_PATTERNS) {
    if (pattern.test(serialized)) found.add(category)
  }
  return [...found].sort()
}

function scanFile (file) {
  let content
  try {
    content = fs.readFileSync(file, 'utf8')
  } catch (err) {
    return { clean: false, categories: ['unreadable-file'], message: `The export could not be scanned in place: ${err.code || 'read failed'}.` }
  }
  const categories = categoriesIn(content)
  return {
    clean: categories.length === 0,
    categories,
    message: categories.length
      ? 'The export contains credential-shaped content. Provide a scrubbed export; no source content or matched value was printed.'
      : 'The export passed the credential-shape scan in place.'
  }
}

function readScannedFile (file) {
  let content
  try {
    content = fs.readFileSync(file, 'utf8')
  } catch (err) {
    return { clean: false, categories: ['unreadable-file'], message: `The export could not be scanned in place: ${err.code || 'read failed'}.` }
  }
  const categories = categoriesIn(content)
  if (categories.length) {
    return {
      clean: false,
      categories,
      message: 'The export contains credential-shaped content. Provide a scrubbed export; no source content or matched value was printed.'
    }
  }
  return { clean: true, categories: [], message: 'The export passed the credential-shape scan in place.', content }
}

function rangeProblem (range, label) {
  if (!isRecord(range)) return `${label} has no bounded date range.`
  const from = day(range.from)
  const to = day(range.to)
  if (!from || !to) return `${label} needs real from and to days in YYYY-MM-DD form.`
  if (from > to) return `${label} starts after it ends.`
  return null
}

function locatorBoundaryProblem (record, boundary) {
  if (!isRecord(boundary)) return 'the source was not in the approved scope'
  const scope = isRecord(record.scope) ? record.scope : {}
  if (boundary.artifact !== undefined && record.locator !== boundary.artifact) {
    return `artifact ${JSON.stringify(record.locator)} is not the exact approved artifact ${JSON.stringify(boundary.artifact)}`
  }
  const exact = [
    ['provider', boundary.provider],
    ['dataSource', boundary.dataSource],
    ['account', boundary.account],
    ['folder', boundary.folder],
    ['mailbox', boundary.mailbox],
    ['meeting', boundary.meetings],
    ['call', boundary.calls],
    ['person', boundary.people]
  ]
  for (const [field, approved] of exact) {
    if (approved === undefined) continue
    if (scope[field] === undefined) return `the record omits its approved ${field} locator`
    const values = Array.isArray(approved) ? approved : [approved]
    if (!values.includes(scope[field])) return `${field} ${JSON.stringify(scope[field])} is outside the approved source boundary`
  }

  if (Array.isArray(boundary.channels) || Array.isArray(boundary.directMessages)) {
    const hasChannel = scope.channel !== undefined
    const hasDirectMessage = scope.directMessage !== undefined
    if (hasChannel === hasDirectMessage) return 'the record must name exactly one approved channel or direct-message conversation'
    if (hasChannel && !(boundary.channels || []).includes(scope.channel)) return `channel ${JSON.stringify(scope.channel)} is outside the approved source boundary`
    if (hasDirectMessage && !(boundary.directMessages || []).includes(scope.directMessage)) return `directMessage ${JSON.stringify(scope.directMessage)} is outside the approved source boundary`
  }

  if (Array.isArray(boundary.domains)) {
    if (!scope.url) return 'the record omits its approved source URL'
    let sourceUrl
    let locatorUrl
    try { sourceUrl = new URL(scope.url) } catch (_) { return 'the source URL is not valid' }
    try { locatorUrl = new URL(record.locator) } catch (_) { return 'the evidence locator is not a valid source URL' }
    if (!['http:', 'https:'].includes(sourceUrl.protocol) || !['http:', 'https:'].includes(locatorUrl.protocol)) return 'web evidence requires an HTTP or HTTPS source URL'
    if (record.locator !== scope.url) return 'the evidence locator does not exactly match its approved source URL'
    const host = locatorUrl.hostname.toLowerCase()
    if (!boundary.domains.includes(host)) {
      return `domain ${JSON.stringify(host)} is outside the approved web boundary`
    }
  }

  const range = boundary.dateRange || ((boundary.from || boundary.to) ? boundary : null)
  if (range) {
    if (!record.observedAt) return 'the record has no date to place inside the approved range'
    const observed = day(String(record.observedAt).slice(0, 10))
    if (!observed || observed < range.from || observed > range.to) {
      return `date ${JSON.stringify(record.observedAt)} is outside the approved ${range.from} to ${range.to} range`
    }
  }
  return null
}

function sourceCriterionProblem (record) {
  if (!record || record.stance === 'context') return null
  const criterion = text(record.criterion)
  if (record.sourceKind === 'google-calendar' && (DECISION_CRITERIA.has(criterion) || criterion.startsWith('decision-metric:'))) {
    return 'Google Calendar metadata cannot prove a decision gate'
  }
  if (criterion === 'price' && !PRICE_SOURCES.has(record.sourceKind)) return `${record.sourceKind} cannot prove verified current price`
  if (criterion === 'terms' && record.sourceKind !== 'signed-terms') return `${record.sourceKind} cannot prove material signed terms`
  if (record.classification === 'vendor-claim') return null
  if (criterion === 'success-criterion' && !SUCCESS_SOURCES.has(record.sourceKind)) return `${record.sourceKind} cannot prove success in the user\'s work`
  if (criterion === 'business-need' && !BUSINESS_NEED_SOURCES.has(record.sourceKind)) return `${record.sourceKind} cannot prove that the business need is materially unmet`
  return null
}

function validateEvidence (scope, given) {
  const problems = []
  if (!isRecord(given)) return { ok: false, problems: ['Evidence is not an object.'], records: [], coverage: [] }
  const credentialCategories = categoriesIn(given)
  if (credentialCategories.length) {
    return {
      ok: false,
      problems: [`Evidence contains credential-shaped content in categories: ${credentialCategories.join(', ')}. No source content or matched value was returned.`],
      scopeId: text(given.scopeId) || null,
      evidenceId: null,
      records: [],
      coverage: [],
      conflicts: []
    }
  }
  if (given.scopeId !== scope.scopeId) problems.push('Evidence is bound to a different approved scope.')
  if (!Array.isArray(given.records)) problems.push('Evidence records must be a list.')
  if (!Array.isArray(given.coverage)) problems.push('Coverage must be a list that distinguishes searched, unavailable, and not searched.')

  const records = []
  const ids = new Set()
  for (const [index, raw] of (Array.isArray(given.records) ? given.records : []).entries()) {
    if (!isRecord(raw)) { problems.push(`records[${index}] is not an object.`); continue }
    const at = `records[${index}]`
    const id = text(raw.id)
    if (!id) problems.push(`${at} has no stable id.`)
    else if (ids.has(id)) problems.push(`${at} repeats id ${JSON.stringify(id)}.`)
    else ids.add(id)
    if (!SOURCE_KINDS.includes(raw.sourceKind)) problems.push(`${at} has unknown source kind ${JSON.stringify(raw.sourceKind)}.`)
    if (!text(raw.locator)) problems.push(`${at} has no stable locator or explicit user attribution.`)
    if (!text(raw.claim)) problems.push(`${at} has no claim.`)
    if (!CLASSIFICATIONS.includes(raw.classification)) problems.push(`${at} has invalid classification ${JSON.stringify(raw.classification)}.`)
    if (raw.sourceKind === 'vendor-web' && raw.classification !== 'vendor-claim') {
      problems.push(`${at} came from vendor-web and must stay classified as a vendor-claim.`)
    }
    if (!text(raw.criterion)) problems.push(`${at} names no decision criterion.`)
    if (!STANCES.includes(raw.stance)) problems.push(`${at} has invalid stance ${JSON.stringify(raw.stance)}.`)
    const criterionProblem = sourceCriterionProblem(raw)
    if (criterionProblem) problems.push(`${at}: ${criterionProblem}.`)
    if (raw.observedAt !== undefined && !timestamp(raw.observedAt) && !day(raw.observedAt)) {
      problems.push(`${at} has an invalid observed or published date.`)
    }
    const parsedObserved = raw.observedAt === undefined ? null : timestamp(raw.observedAt)
    const observedDay = parsedObserved ? calendarDay(parsedObserved) : null
    if (observedDay && observedDay > scope.asOf) problems.push(`${at} is dated after the evaluation's asOf day.`)
    const boundary = scope.sourceBoundaries && scope.sourceBoundaries[raw.sourceKind]
    const boundaryProblem = locatorBoundaryProblem(raw, boundary)
    if (boundaryProblem) problems.push(`${at}: ${boundaryProblem}.`)

    if (raw.value !== undefined && !isRecord(raw.value)) problems.push(`${at}.value must be an object when present.`)
    if (raw.criterion === 'success-criterion' &&
        (!isRecord(raw.value) || !text(raw.value.optionId) || !scope.successCriteria.includes(text(raw.value.successCriterion)))) {
      problems.push(`${at} must bind success-criterion evidence to an optionId and one successCriterion accepted in scope.`)
    }
    if (raw.stance === 'contradicts' && (OPTION_SPECIFIC_CRITERIA.has(raw.criterion) || String(raw.criterion).startsWith('decision-metric:')) &&
        (!isRecord(raw.value) || !text(raw.value.optionId))) {
      problems.push(`${at} contradicts option-specific criterion ${JSON.stringify(raw.criterion)} without naming the affected optionId.`)
    }
    if (raw.value && raw.value.kind === 'money') {
      if (typeof raw.value.amount !== 'number' || !Number.isFinite(raw.value.amount) || raw.value.amount < 0) {
        problems.push(`${at} has an invalid money amount.`)
      }
      if (!text(raw.value.currency) || !text(raw.value.period)) problems.push(`${at} money needs currency and period.`)
    }
    records.push({ ...raw, id })
  }

  const coverage = []
  const coverageKinds = new Set()
  for (const [index, raw] of (Array.isArray(given.coverage) ? given.coverage : []).entries()) {
    if (!isRecord(raw)) { problems.push(`coverage[${index}] is not an object.`); continue }
    if (!SOURCE_KINDS.includes(raw.sourceKind)) problems.push(`coverage[${index}] has unknown source kind ${JSON.stringify(raw.sourceKind)}.`)
    if (!COVERAGE.includes(raw.status)) problems.push(`coverage[${index}] has invalid status ${JSON.stringify(raw.status)}.`)
    if (coverageKinds.has(raw.sourceKind)) problems.push(`coverage repeats ${JSON.stringify(raw.sourceKind)}.`)
    coverageKinds.add(raw.sourceKind)
    if (raw.status === 'unavailable' && !text(raw.reason)) problems.push(`coverage[${index}] must say why the source was unavailable.`)
    const approvedBoundary = scope.sourceBoundaries && scope.sourceBoundaries[raw.sourceKind]
    if (!approvedBoundary) problems.push(`coverage[${index}] names a source outside the approved scope.`)
    else if (!isRecord(raw.boundary) || fingerprint(raw.boundary) !== fingerprint(approvedBoundary)) problems.push(`coverage[${index}] does not carry the exact approved source boundary.`)
    coverage.push({ ...raw })
  }

  for (const sourceKind of Object.keys(scope.sourceBoundaries || {})) {
    if (!coverageKinds.has(sourceKind)) problems.push(`Coverage does not account for approved source ${JSON.stringify(sourceKind)}.`)
  }
  for (const record of records) {
    const covered = coverage.find(one => one.sourceKind === record.sourceKind)
    if (!covered || covered.status !== 'searched') problems.push(`Record ${JSON.stringify(record.id)} came from ${record.sourceKind}, but coverage does not say that source was searched.`)
    if (record.sourceKind === 'signed-terms') {
      const provider = scope.sourceBoundaries['signed-terms'] && scope.sourceBoundaries['signed-terms'].provider
      const providerCoverage = coverage.find(one => one.sourceKind === provider)
      if (!providerCoverage || providerCoverage.status !== 'searched') {
        problems.push(`Signed-terms record ${JSON.stringify(record.id)} is not backed by searched coverage for its approved provider ${JSON.stringify(provider)}.`)
      }
    }
  }

  const conflicts = []
  const byCriterion = new Map()
  for (const record of records) {
    if (!record.criterion || record.stance === 'context') continue
    const optionSpecific = OPTION_SPECIFIC_CRITERIA.has(record.criterion) || String(record.criterion).startsWith('decision-metric:')
    const optionId = optionSpecific && isRecord(record.value) ? text(record.value.optionId) : ''
    const successCriterion = record.criterion === 'success-criterion' && isRecord(record.value) ? text(record.value.successCriterion) : ''
    const blocker = record.criterion === 'blocker-resolution' && isRecord(record.value) ? text(record.value.blocker) : ''
    const key = JSON.stringify([record.criterion, optionId, successCriterion, blocker])
    const entries = byCriterion.get(key) || []
    entries.push(record)
    byCriterion.set(key, entries)
  }
  for (const [key, entries] of byCriterion) {
    const supporting = entries.filter(one => one.stance === 'supports')
    const contradicting = entries.filter(one => one.stance === 'contradicts')
    if (supporting.length && contradicting.length) {
      const [criterion, optionId, successCriterion, blocker] = JSON.parse(key)
      conflicts.push({
        criterion,
        optionId: optionId || null,
        successCriterion: successCriterion || null,
        blocker: blocker || null,
        unresolved: true,
        records: entries.map(one => ({ id: one.id, sourceKind: one.sourceKind, locator: one.locator, observedAt: one.observedAt || null, stance: one.stance }))
      })
    }
  }

  const evidenceId = problems.length ? null : fingerprint({ scopeId: scope.scopeId, records, coverage }, 'evidence')
  return { ok: problems.length === 0, problems, scopeId: given.scopeId, evidenceId, records, coverage, conflicts }
}

function evidenceIndex (validated) {
  return Object.fromEntries(validated.records.map(record => [record.id, {
    sourceKind: record.sourceKind,
    locator: record.locator,
    observedAt: record.observedAt || null,
    claim: record.claim,
    classification: record.classification,
    criterion: record.criterion,
    stance: record.stance,
    scope: record.scope,
    value: record.value
  }]))
}

module.exports = {
  CLASSIFICATIONS,
  STANCES,
  COVERAGE,
  OPTION_SPECIFIC_CRITERIA,
  DECISION_CRITERIA,
  SOURCE_KINDS,
  isRecord,
  text,
  canonical,
  fingerprint,
  day,
  timestamp,
  calendarDay,
  categoriesIn,
  scanFile,
  readScannedFile,
  rangeProblem,
  locatorBoundaryProblem,
  sourceCriterionProblem,
  validateEvidence,
  evidenceIndex
}
