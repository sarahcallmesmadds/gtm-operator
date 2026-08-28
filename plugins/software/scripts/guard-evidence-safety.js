#!/usr/bin/env node
'use strict'

/**
 * Skill-scoped PreToolUse guard for software:evaluate.
 *
 * It prints categories and decisions only. A matched credential value never
 * reaches stdout or stderr.
 */

const { categoriesIn, fingerprint, isRecord, timestamp } = require('./decision-evidence')
const fs = require('fs')
const os = require('os')
const path = require('path')
const evaluate = require('./evaluate')
const { acceptedScopeProblem } = evaluate
const config = require('./vendor/config-read')
const softwareSchema = require('./vendor/software-schema')
const { pointerFileFor } = require('./evaluation-run')
const { pageIdentity } = require('./vendor/page-id')

const MUTATION = /(?:^|[_-])(?:send|post|create|update|delete|remove|archive|label|move|react|approve|pay|transfer|sign|void|cancel|modify|edit|write|draft)(?:[_-]|$)/i
const CONNECTOR_SOURCES = {
  box: 'box',
  'google-drive': 'google-drive',
  gmail: 'gmail',
  slack: 'slack',
  ramp: 'ramp',
  quickbooks: 'quickbooks',
  docusign: 'docusign',
  'google-calendar': 'google-calendar',
  granola: 'granola',
  gong: 'gong'
}

function stringsIn (value, found = []) {
  if (typeof value === 'string') found.push(value)
  else if (Array.isArray(value)) value.forEach(one => stringsIn(one, found))
  else if (isRecord(value)) Object.values(value).forEach(one => stringsIn(one, found))
  return found
}

function keyedStrings (value, pattern, found = []) {
  if (Array.isArray(value)) value.forEach(one => keyedStrings(one, pattern, found))
  else if (isRecord(value)) {
    for (const [key, one] of Object.entries(value)) {
      if (pattern.test(key)) stringsIn(one, found)
      else keyedStrings(one, pattern, found)
    }
  }
  return found
}

function webDomains (toolInput) {
  const found = new Set(keyedStrings(toolInput, /domain|url/i).map(one => one.toLowerCase()))
  for (const value of stringsIn(toolInput)) {
    for (const match of value.matchAll(/\bsite:([a-z0-9.-]+)\b/gi)) found.add(match[1].toLowerCase())
    for (const match of value.matchAll(/https?:\/\/[^\s"'<>]+/gi)) {
      try { found.add(new URL(match[0]).hostname.toLowerCase()) } catch (_) {}
    }
  }
  return [...found].map(one => {
    try { return new URL(one).hostname.toLowerCase() } catch (_) { return one.replace(/^site:/i, '').replace(/^\.+|\.+$/g, '') }
  }).filter(Boolean)
}

function positiveWebSearchDomains (toolInput) {
  const found = new Set()
  for (const value of stringsIn(toolInput)) {
    for (const match of value.matchAll(/(?:^|[\s(])site:([a-z0-9.-]+)\b/gi)) found.add(match[1].toLowerCase())
  }
  return [...found]
}

function dateFieldPolicy (source, toolName) {
  const method = String(toolName || '').split('__').pop()
  if (source === 'gmail' || ['vendor-web', 'independent-web'].includes(source)) {
    return { lowerKeys: [], upperKeys: [], allowQuerySyntax: true }
  }
  if (source === 'slack') {
    if (/^slack_search_public_and_private$/i.test(method)) {
      return { lowerKeys: ['after'], upperKeys: ['before'], allowQuerySyntax: false, allowSlackTimestamps: true }
    }
    if (/^search_messages_and_files$/i.test(method)) {
      return { lowerKeys: [], upperKeys: [], allowQuerySyntax: true }
    }
    return { lowerKeys: ['oldest'], upperKeys: ['latest'], allowQuerySyntax: false, allowSlackTimestamps: true }
  }
  if (source === 'google-calendar') return { lowerKeys: ['startTime'], upperKeys: ['endTime'], allowQuerySyntax: false }
  if (['box', 'google-drive'].includes(source)) return { lowerKeys: [], upperKeys: [], allowQuerySyntax: true }
  if (['ramp', 'quickbooks', 'docusign'].includes(source)) {
    return { lowerKeys: ['from', 'date_from', 'start_date'], upperKeys: ['to', 'date_to', 'end_date'], allowQuerySyntax: false }
  }
  if (['granola', 'gong'].includes(source)) {
    return { lowerKeys: ['from', 'start', 'date_from', 'start_date'], upperKeys: ['to', 'end', 'date_to', 'end_date'], allowQuerySyntax: false }
  }
  return { lowerKeys: [], upperKeys: [], allowQuerySyntax: false, toolName }
}

function datePredicates (toolInput, policy = {}) {
  const lower = []
  const upper = []
  const all = []
  let negated = false
  const lowerKeys = new Set((policy.lowerKeys || []).map(key => key.toLowerCase()))
  const upperKeys = new Set((policy.upperKeys || []).map(key => key.toLowerCase()))
  const datesIn = (value, key = '') => {
    if (typeof value !== 'string') return []
    const found = [...value.matchAll(/\b\d{4}-\d{2}-\d{2}(?!\d)/g)].map(match => match[0])
    const dateKey = lowerKeys.has(key.toLowerCase()) || upperKeys.has(key.toLowerCase())
    if (policy.allowSlackTimestamps === true && dateKey && /^\d{9,}(?:\.\d+)?$/.test(value.trim())) {
      const parsed = new Date(Number(value.trim()) * 1000)
      if (!Number.isNaN(parsed.getTime())) found.push(parsed.toISOString().slice(0, 10))
    }
    return found
  }
  const visit = (value, key = '') => {
    if (typeof value === 'string') {
      const foundDates = datesIn(value, key)
      all.push(...foundDates)
      if (lowerKeys.has(key.toLowerCase())) lower.push(...foundDates)
      if (upperKeys.has(key.toLowerCase())) upper.push(...foundDates)
      if (policy.allowQuerySyntax === true) {
        for (const match of value.matchAll(/(?:^|[\s(])(-?)(after|from|before|to):\s*(\d{4}-\d{2}-\d{2})(?!\d)/gi)) {
          if (match[1]) negated = true
          if (/^(?:after|from)$/i.test(match[2])) lower.push(match[3])
          else upper.push(match[3])
        }
        for (const match of value.matchAll(/(>=|<=)\s*['"]?(\d{4}-\d{2}-\d{2})(?!\d)/g)) {
          if (match[1] === '>=') lower.push(match[2])
          else upper.push(match[2])
        }
      }
    } else if (Array.isArray(value)) value.forEach(one => visit(one, key))
    else if (isRecord(value)) for (const [childKey, one] of Object.entries(value)) visit(one, childKey)
  }
  visit(toolInput)
  return { lower, upper, all, negated }
}

function nextDay (value) {
  const parsed = Date.parse(`${value}T00:00:00Z`)
  return Number.isNaN(parsed) ? null : new Date(parsed + 86400000).toISOString().slice(0, 10)
}

function dateBoundaryProblem (toolInput, range, source, toolName = '') {
  const parsed = datePredicates(toolInput, dateFieldPolicy(source, toolName))
  const expectedUpper = source === 'gmail' ? nextDay(range.to) : range.to
  if (parsed.negated) return 'The read negates an accepted date predicate.'
  if (!parsed.lower.length || parsed.lower.some(value => value !== range.from) ||
      !parsed.upper.length || parsed.upper.some(value => value !== expectedUpper)) {
    return 'The read does not use the accepted dates as its exact lower and upper predicates.'
  }
  if (parsed.all.some(value => value !== range.from && value !== expectedUpper)) {
    return 'The read includes a competing date outside the accepted from/to boundary.'
  }
  return null
}

function locatorSet (source, toolInput, approved) {
  const values = stringsIn(toolInput)
  if (source === 'slack') {
    const found = new Set(keyedStrings(toolInput, /channel|direct.?message|conversation/i))
    for (const value of values) for (const match of value.matchAll(/\bin:([^\s)]+)/gi)) found.add(match[1].replace(/^['"]|['"]$/g, ''))
    return [...found]
  }
  if (['google-calendar', 'granola'].includes(source)) {
    const keyed = keyedStrings(toolInput, /meeting|event/i)
    return [...new Set([...keyed, ...values.filter(one => approved.includes(one))])]
  }
  if (source === 'gong') {
    const keyed = keyedStrings(toolInput, /call/i)
    return [...new Set([...keyed, ...values.filter(one => approved.includes(one))])]
  }
  if (['vendor-web', 'independent-web'].includes(source)) return webDomains(toolInput)
  if (['box', 'google-drive'].includes(source)) {
    const found = new Set(keyedStrings(toolInput, /folder/i))
    if (source === 'google-drive') {
      for (const value of values) for (const match of value.matchAll(/\bparentId\s*=\s*'([^']+)'/gi)) found.add(match[1])
    }
    return [...found]
  }
  if (['ramp', 'quickbooks', 'docusign'].includes(source)) return keyedStrings(toolInput, /account/i)
  return []
}

function googleDriveNegationProblem (toolInput) {
  const negatedBoundary = /\bnot\s*(?:\(\s*)?(?:parentId|modifiedTime)\b|(?:parentId|modifiedTime)\s*!=/i
  if (stringsIn(toolInput).some(value => negatedBoundary.test(value))) {
    return 'The google-drive read negates an accepted folder or date predicate.'
  }
  return null
}

function locatorSetProblem (source, found, approved) {
  if (!found.length) return `The ${source} read does not name an accepted locator.`
  const allowed = value => approved.includes(value)
  if (found.some(value => !allowed(value))) return `The ${source} read includes a locator outside the accepted boundary.`
  return null
}

function slackLocatorProblem (toolName, toolInput, boundary) {
  const approvedChannels = Array.isArray(boundary.channels) ? boundary.channels : []
  const approvedDirectMessages = Array.isArray(boundary.directMessages) ? boundary.directMessages : []
  if (stringsIn(toolInput).some(value => /(?:^|[\s(])-in:[^\s)]+/i.test(value))) {
    return 'The slack read uses a negated locator, which is not an accepted positive channel or direct-message boundary.'
  }
  const channels = new Set(keyedStrings(toolInput, /channel/i))
  const directMessages = new Set(keyedStrings(toolInput, /direct.?message|conversation/i))
  for (const value of stringsIn(toolInput)) {
    for (const match of value.matchAll(/\bin:([^\s)]+)/gi)) {
      const locator = match[1].replace(/^['"]|['"]$/g, '')
      if (approvedDirectMessages.includes(locator)) directMessages.add(locator)
      else channels.add(locator)
    }
  }
  if (!channels.size && !directMessages.size) return 'The slack read does not name an accepted channel or direct-message conversation.'
  if ([...channels].some(value => !approvedChannels.includes(value))) return 'The slack read includes a channel outside the accepted channel boundary.'
  if ([...directMessages].some(value => !approvedDirectMessages.includes(value))) return 'The slack read includes a direct-message conversation outside the accepted direct-message boundary.'
  if (/(?:^|_)read_channel$/i.test(toolName.split('__').pop()) && directMessages.size) return 'A Slack channel read cannot use a direct-message locator.'
  return null
}

function scopeDocument (input, supplied) {
  if (isRecord(supplied)) return supplied.scope ? supplied : { scope: supplied }
  const cwd = typeof input.cwd === 'string' && path.isAbsolute(input.cwd) ? input.cwd : process.cwd()
  let file = process.env.SOFTWARE_EVALUATE_SCOPE_FILE
  try {
    if (!file) file = fs.readFileSync(pointerFileFor(cwd), 'utf8').trim()
    if (!path.isAbsolute(file)) return null
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    const document = parsed && parsed.scope ? parsed : { scope: parsed }
    return { ...document, scopeFile: file }
  } catch (_) {
    return null
  }
}

function activeRunDirectory (input, supplied) {
  let scopeFile = isRecord(supplied) && typeof supplied.scopeFile === 'string' ? supplied.scopeFile : null
  if (!scopeFile && isRecord(supplied) && typeof supplied.runDir === 'string') scopeFile = path.join(supplied.runDir, 'read-scope.json')
  const cwd = typeof input.cwd === 'string' && path.isAbsolute(input.cwd) ? input.cwd : process.cwd()
  try {
    if (!scopeFile) scopeFile = process.env.SOFTWARE_EVALUATE_SCOPE_FILE || fs.readFileSync(pointerFileFor(cwd), 'utf8').trim()
  } catch (_) { return null }
  if (!path.isAbsolute(scopeFile) || path.basename(scopeFile) !== 'read-scope.json') return null
  const runDir = path.dirname(path.resolve(scopeFile))
  return path.dirname(runDir) === path.resolve(os.tmpdir()) && path.basename(runDir).startsWith('gtm-software-evaluate-') ? runDir : null
}

function privateWriteProblem (input, toolInput, supplied) {
  const runDir = activeRunDirectory(input, supplied)
  const target = typeof toolInput.file_path === 'string' && path.isAbsolute(toolInput.file_path) ? path.resolve(toolInput.file_path) : null
  if (!runDir || !target) return 'Write was refused because it does not name an absolute path inside the active private evaluation run directory.'
  const relative = path.relative(runDir, target)
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return 'Write was refused because evaluation artifacts must stay inside the active private evaluation run directory.'
  }
  if (['connector-read-authorizations.json', 'notion-survey-authorizations.json', 'notion-survey-sequence.json'].includes(path.basename(target))) {
    return 'Write was refused because that private evaluation artifact is owned by the read-scope guard.'
  }
  return null
}

function privateRunFile (runDir, file) {
  if (!runDir || typeof file !== 'string' || !path.isAbsolute(file)) return null
  const target = path.resolve(file)
  const relative = path.relative(runDir, target)
  return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative) ? target : null
}

function installedSurveyPlan (input, document) {
  const runDir = activeRunDirectory(input, document)
  const planFile = privateRunFile(runDir, document && document.surveyPlanFile)
  if (!planFile) return null
  try {
    const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'))
    if (!isRecord(plan) || plan.scopeId !== document.scope.scopeId ||
        plan.softwareDataSourceUrl !== (document.softwareDataSourceUrl || document.softwareDataSourceId) || !isRecord(plan.queries)) return null
    const context = isRecord(document.surveyContext) && typeof document.surveyContext.property === 'function'
      ? document.surveyContext
      : config.contextFor('software', softwareSchema.IDENTITY)
    if (!context.ok) return null
    const canonical = evaluate.surveyPlan({ surveyRunId: plan.surveyRunId }, document.scope, context)
    if (fingerprint(plan) !== fingerprint(canonical)) return null
    return plan
  } catch (_) { return null }
}

function resultIdsIn (value, source) {
  const found = new Set()
  const idField = source === 'gmail'
    ? /^(?:id|messageId|message_id|threadId|thread_id)$/
    : /^(?:id|fileId|file_id)$/
  const resultCollection = source === 'gmail'
    ? /^(?:messages|threads|results|items)$/i
    : /^(?:files|results|items)$/i

  const collectResult = result => {
    if (!isRecord(result)) return
    for (const [key, one] of Object.entries(result)) {
      if (idField.test(key) && typeof one === 'string' && one.trim()) found.add(one.trim())
    }
  }
  const visit = (current, directResults = false) => {
    if (Array.isArray(current)) {
      current.forEach(directResults ? collectResult : one => visit(one, false))
      return
    }
    if (!isRecord(current)) return
    if (current.type === 'text' && typeof current.text === 'string') {
      const trimmed = current.text.trim()
      if (/^[\[{]/.test(trimmed)) {
        try {
          const parsed = JSON.parse(trimmed)
          if (Array.isArray(parsed)) visit(parsed, true)
          else visit(parsed, false)
        } catch (_) {}
      }
    }
    for (const [key, one] of Object.entries(current)) {
      if (resultCollection.test(key) && Array.isArray(one)) {
        if (source === 'gmail' && key.toLowerCase() === 'threads') {
          one.forEach(thread => {
            collectResult(thread)
            if (isRecord(thread) && Array.isArray(thread.messages)) thread.messages.forEach(collectResult)
          })
        } else one.forEach(collectResult)
      }
      else if (key !== 'text' && (Array.isArray(one) || isRecord(one))) visit(one)
    }
  }
  visit(value)
  return [...found]
}

function connectorAuthorizationFile (runDir) {
  return runDir && path.join(runDir, 'connector-read-authorizations.json')
}

function notionAuthorizationFile (runDir) {
  return runDir && path.join(runDir, 'notion-survey-authorizations.json')
}

function authorizedResultIds (input, document, source) {
  const runDir = activeRunDirectory(input, document)
  const file = connectorAuthorizationFile(runDir)
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
    const entry = saved && saved.sources && saved.sources[source]
    if (saved.scopeId !== document.scope.scopeId || !isRecord(entry) ||
        entry.boundaryFingerprint !== fingerprint(document.scope.sourceBoundaries[source]) || !Array.isArray(entry.resultIds)) return []
    return entry.resultIds.filter(one => typeof one === 'string' && one)
  } catch (_) { return [] }
}

function recordConnectorSearch (input, supplied) {
  const document = scopeDocument(input, supplied)
  if (!document || acceptedScopeProblem(document.scope)) return false
  const values = stringsIn(input.tool_input)
  const source = sourceFor(input.tool_name, values, document)
  const method = input.tool_name.split('__').pop()
  const recordsResults = (['box', 'google-drive'].includes(source) && /search_files$/i.test(method)) ||
    (source === 'gmail' && /^(?:search|list)_threads$/i.test(method))
  if (!recordsResults || callBoundaryProblem(input.tool_name, input.tool_input, document)) return false
  const runDir = activeRunDirectory(input, document)
  if (!runDir || responseHasError(input.tool_response)) return false
  const resultIds = resultIdsIn(input.tool_response, source)
  const file = connectorAuthorizationFile(runDir)
  return withFileLock(file, () => {
    let saved = { contract: 'software-evaluation-connector-authorizations/v1', scopeId: document.scope.scopeId, sources: {} }
    try {
      const existing = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (existing.scopeId === document.scope.scopeId && isRecord(existing.sources)) saved = existing
    } catch (_) {}
    const previous = saved.sources[source]
    const boundaryFingerprint = fingerprint(document.scope.sourceBoundaries[source])
    const previousIds = isRecord(previous) && previous.boundaryFingerprint === boundaryFingerprint && Array.isArray(previous.resultIds)
      ? previous.resultIds
      : []
    saved.sources[source] = {
      boundaryFingerprint,
      resultIds: [...new Set([...previousIds, ...resultIds])].sort()
    }
    const temporary = `${file}.${process.pid}.tmp`
    fs.writeFileSync(temporary, `${JSON.stringify(saved)}\n`, { mode: 0o600 })
    fs.renameSync(temporary, file)
    return true
  })
}

function responseEnvelopes (value, found = new Map()) {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (/^[\[{]/.test(trimmed)) {
      try { responseEnvelopes(JSON.parse(trimmed), found) } catch (_) {}
    }
  } else if (Array.isArray(value)) {
    value.forEach(one => responseEnvelopes(one, found))
  } else if (isRecord(value)) {
    if (Array.isArray(value.results) && typeof value.has_more === 'boolean') found.set(fingerprint(value), value)
    for (const one of Object.values(value)) responseEnvelopes(one, found)
  }
  return [...found.values()]
}

function notionSequenceFile (runDir) {
  return runDir && path.join(runDir, 'notion-survey-sequence.json')
}

function waitForLock (milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)
}

function withFileLock (file, action) {
  if (!file || typeof action !== 'function') return false
  const lockDirectory = `${file}.lock`
  const deadline = Date.now() + 5000
  while (true) {
    try {
      fs.mkdirSync(lockDirectory, { mode: 0o700 })
      break
    } catch (error) {
      if (!error || error.code !== 'EEXIST') return false
      try {
        const age = Date.now() - fs.statSync(lockDirectory).mtimeMs
        if (age > 5 * 60 * 1000) {
          fs.rmSync(lockDirectory, { recursive: true, force: true })
          continue
        }
      } catch (_) {}
      if (Date.now() >= deadline) return false
      waitForLock(10)
    }
  }
  try {
    return action()
  } finally {
    try { fs.rmdirSync(lockDirectory) } catch (_) {}
  }
}

function withNotionSequenceLock (input, document, action) {
  return withFileLock(notionSequenceFile(activeRunDirectory(input, document)), action)
}

function readNotionSequence (input, document, plan) {
  const file = notionSequenceFile(activeRunDirectory(input, document))
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (saved.contract !== 'software-evaluation-survey-events/v1' || saved.scopeId !== document.scope.scopeId ||
        saved.surveyRunId !== plan.surveyRunId || saved.planFingerprint !== fingerprint(plan) ||
        !Array.isArray(saved.phases) || !Array.isArray(saved.fetches)) return null
    return saved
  } catch (_) { return null }
}

function writeNotionSequenceUnlocked (input, document, sequence) {
  const file = notionSequenceFile(activeRunDirectory(input, document))
  if (!file) return false
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(sequence)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, file)
  return true
}

function responseHasError (value) {
  if (Array.isArray(value)) return value.some(responseHasError)
  if (!isRecord(value)) return false
  if (value.isError === true || value.is_error === true || value.type === 'error') return true
  if (Object.prototype.hasOwnProperty.call(value, 'error') && value.error) return true
  return Object.values(value).some(responseHasError)
}

function propertiesInPageText (value) {
  if (typeof value !== 'string') return null
  const match = value.match(/<properties>\s*([\s\S]*?)\s*<\/properties>/)
  if (!match) return null
  try {
    const parsed = JSON.parse(match[1])
    return isRecord(parsed) ? parsed : null
  } catch (_) {
    return null
  }
}

function pageArtifactBinding (page) {
  if (!isRecord(page)) return null
  const identity = pageIdentity(page.url || page.id)
  const body = typeof page.body === 'string' ? page.body : typeof page.text === 'string' ? page.text : null
  if (!identity || body === null) return null
  const properties = isRecord(page.properties) ? page.properties : propertiesInPageText(body)
  const lastEditedTime = timestamp(page.last_edited_time || page.lastEditedTime)
  return { pageIdentity: identity, lastEditedTime: lastEditedTime || null, properties: properties || null, body }
}

function notionFetchArtifact (response, expectedIdentity) {
  if (!expectedIdentity || responseHasError(response)) return null
  const found = new Map()
  const visit = value => {
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (/^[\[{]/.test(trimmed)) {
        try { visit(JSON.parse(trimmed)) } catch (_) {}
      }
      return
    }
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    if (!isRecord(value)) return
    const binding = pageArtifactBinding(value)
    if (binding && binding.pageIdentity === expectedIdentity && (!isRecord(value.metadata) || value.metadata.type === 'page')) {
      found.set(fingerprint(binding, 'notion-fetch-artifact'), { binding, page: value })
    }
    Object.values(value).forEach(visit)
  }
  visit(response)
  if (found.size !== 1) return null
  const captured = [...found.values()][0]
  const page = captured.page
  return {
    url: page.url || page.id,
    last_edited_time: captured.binding.lastEditedTime,
    properties: captured.binding.properties,
    body: captured.binding.body,
    artifactFingerprint: fingerprint(captured.binding, 'notion-fetch-artifact')
  }
}

function requestCursorIn (toolInput) {
  const values = keyedStrings(toolInput, /^(?:cursor|start_cursor|next_cursor)$/i).filter(Boolean)
  return values.length === 1 ? values[0] : values.length ? false : null
}

function exactQueryIn (toolInput) {
  const queries = keyedStrings(toolInput, /^query$/i)
  return queries.length === 1 ? queries[0] : null
}

function sequenceQueryExecution (plan, query) {
  if (query === plan.queries.details.sql) return 'software-details'
  if (query === plan.queries.manifest.sql) return 'manifest'
  return null
}

function continuationProblem (phase, cursor) {
  if (!phase) return cursor === null ? null : 'The survey execution begins at a continuation instead of its initial request.'
  if (phase.complete) return 'The survey execution already completed.'
  if (cursor === false || cursor !== phase.nextCursor) return 'The survey continuation does not use the exact cursor returned by the preceding response.'
  return null
}

function notionSequenceBoundaryProblem (toolName, toolInput, document) {
  const plan = installedSurveyPlan({ tool_name: toolName, tool_input: toolInput, cwd: document.cwd }, document)
  if (!plan) return 'The Notion read has no canonical private survey plan.'
  const sequence = readNotionSequence({ tool_name: toolName, tool_input: toolInput, cwd: document.cwd }, document, plan)
  if (/notion[-_]fetch$/.test(toolName)) {
    const current = sequence && sequence.phases[sequence.phases.length - 1]
    if (!current || sequence.phases.length !== 2 || current.execution !== 'software-details' || current.complete !== true) {
      return 'Related Notion pages may be fetched only after the before manifest and complete Software details phases.'
    }
    return null
  }
  const execution = sequenceQueryExecution(plan, exactQueryIn(toolInput))
  const cursor = requestCursorIn(toolInput)
  if (!execution || cursor === false) return 'The Notion query is not one exact survey execution with at most one continuation cursor.'
  const current = sequence && sequence.phases[sequence.phases.length - 1]
  if (execution === 'software-details') {
    if (!sequence || sequence.phases.length === 0) return 'Software details cannot run before the captured before manifest.'
    if (current.execution === 'manifest-before' && current.complete === true && sequence.phases.length === 1) return continuationProblem(null, cursor)
    if (current.execution === 'software-details' && sequence.phases.length === 2) return continuationProblem(current, cursor)
    return 'Software details are outside their captured survey position.'
  }
  if (!sequence) return continuationProblem(null, cursor)
  if (current.execution === 'manifest-before' && sequence.phases.length === 1) return continuationProblem(current, cursor)
  if (current.execution === 'related-process-pages' && current.complete === true && sequence.phases.length === 4) return continuationProblem(null, cursor)
  if (current.execution === 'manifest-after' && sequence.phases.length === 5) return continuationProblem(current, cursor)
  return 'The manifest query is outside its captured before/after survey position.'
}

function normalizedPostEnvelope (input) {
  if (responseHasError(input.tool_response)) return null
  const envelopes = responseEnvelopes(input.tool_response)
  const cursor = requestCursorIn(input.tool_input)
  if (envelopes.length !== 1 || cursor === false) return null
  const envelope = { ...envelopes[0] }
  if (cursor) envelope.request_cursor = cursor
  else delete envelope.request_cursor
  return envelope
}

function recordNotionSurveyEvent (input, supplied) {
  const document = scopeDocument(input, supplied)
  if (!document || acceptedScopeProblem(document.scope) || !/^mcp__.*__notion[-_](?:fetch|query[-_]data[-_]sources)$/.test(input.tool_name)) return false
  const plan = installedSurveyPlan(input, document)
  if (!plan || callBoundaryProblem(input.tool_name, input.tool_input, document)) return false
  if (/notion[-_]fetch$/.test(input.tool_name)) {
    const requested = [...new Set(stringsIn(input.tool_input).map(pageIdentity).filter(Boolean))]
    const captured = requested.length === 1 ? notionFetchArtifact(input.tool_response, requested[0]) : null
    if (!captured) return false
    return withNotionSequenceLock(input, document, () => {
      const sequence = readNotionSequence(input, document, plan)
      if (!sequence) return false
      sequence.fetches.push({
        pageIdentity: requested[0],
        responseFingerprint: fingerprint(input.tool_response, 'notion-fetch-response'),
        artifactFingerprint: captured.artifactFingerprint
      })
      return writeNotionSequenceUnlocked(input, document, sequence)
    })
  }
  const query = exactQueryIn(input.tool_input)
  const kind = sequenceQueryExecution(plan, query)
  const envelope = normalizedPostEnvelope(input)
  if (!kind || !envelope) return false
  return withNotionSequenceLock(input, document, () => {
    let sequence = readNotionSequence(input, document, plan)
    if (!sequence) {
      sequence = {
        contract: 'software-evaluation-survey-events/v1',
        scopeId: document.scope.scopeId,
        surveyRunId: plan.surveyRunId,
        planFingerprint: fingerprint(plan),
        phases: [],
        fetches: []
      }
    }
    let phase = sequence.phases[sequence.phases.length - 1]
    let execution
    if (kind === 'software-details') execution = 'software-details'
    else if (!sequence.phases.length || (phase && phase.execution === 'manifest-before')) execution = 'manifest-before'
    else execution = 'manifest-after'
    if (!phase || phase.execution !== execution) {
      const expected = plan.executions.find(one => one.name === execution)
      phase = { execution, query, queryFingerprint: expected.queryFingerprint, envelopes: [], complete: false, nextCursor: null }
      sequence.phases.push(phase)
    }
    phase.envelopes.push(envelope)
    phase.complete = envelope.has_more === false
    phase.nextCursor = envelope.has_more === true ? envelope.next_cursor : null
    if (phase.complete) {
      phase.artifactFingerprint = evaluate.surveyExecutionFingerprint({
        surveyRunId: plan.surveyRunId,
        execution,
        query,
        queryFingerprint: phase.queryFingerprint,
        envelopes: phase.envelopes
      })
    }
    return writeNotionSequenceUnlocked(input, document, sequence)
  })
}

function recordNotionSurvey (input, supplied) {
  const document = scopeDocument(input, supplied)
  if (!document || acceptedScopeProblem(document.scope) || !/notion[-_]query[-_]data[-_]sources$/i.test(input.tool_name)) return false
  const plan = installedSurveyPlan(input, document)
  if (!plan || callBoundaryProblem(input.tool_name, input.tool_input, document)) return false
  const queries = keyedStrings(input.tool_input, /^query$/i)
  if (queries.length !== 1 || queries[0] !== plan.queries.details.sql) return false
  const envelopes = responseEnvelopes(input.tool_response)
  if (envelopes.length !== 1) return false
  const cursorValues = keyedStrings(input.tool_input, /^(?:cursor|start_cursor|next_cursor)$/i).filter(Boolean)
  if (cursorValues.length > 1) return false
  const requestCursor = cursorValues[0] || null
  const envelope = { ...envelopes[0] }
  if (requestCursor) envelope.request_cursor = requestCursor
  else delete envelope.request_cursor

  const runDir = activeRunDirectory(input, document)
  const file = notionAuthorizationFile(runDir)
  if (!file) return false
  const planFingerprint = fingerprint(plan)
  let saved = null
  try {
    const existing = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (existing.scopeId === document.scope.scopeId && existing.planFingerprint === planFingerprint && isRecord(existing.details)) saved = existing
  } catch (_) {}
  if (!saved || !requestCursor) {
    saved = {
      contract: 'software-evaluation-notion-authorizations/v1',
      scopeId: document.scope.scopeId,
      planFingerprint,
      details: {
        surveyRunId: plan.surveyRunId,
        execution: 'software-details',
        query: plan.queries.details.sql,
        queryFingerprint: plan.queries.details.fingerprint,
        envelopes: []
      }
    }
  }
  const prior = saved.details.envelopes[saved.details.envelopes.length - 1]
  if (requestCursor && (!prior || prior.has_more !== true || prior.next_cursor !== requestCursor)) return false
  saved.details.envelopes.push(envelope)
  const temporary = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(saved)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, file)
  return true
}

function surveyRelatedIdentityGroups (input, document) {
  const runDir = activeRunDirectory(input, document)
  const authorizationFile = notionAuthorizationFile(runDir)
  if (!authorizationFile) return null
  try {
    const plan = installedSurveyPlan(input, document)
    const captured = JSON.parse(fs.readFileSync(authorizationFile, 'utf8'))
    if (!plan) return null
    if (captured.scopeId !== document.scope.scopeId || captured.planFingerprint !== fingerprint(plan) || !isRecord(captured.details)) return null
    const execution = Array.isArray(plan.executions) ? plan.executions.find(one => one.name === 'software-details') : null
    if (!execution || !isRecord(plan.queries) || !isRecord(plan.queries.details)) return null
    const read = evaluate.artifactRows(captured.details, {
      ...execution,
      surveyRunId: plan.surveyRunId,
      sql: plan.queries.details.sql,
      dataSourceId: plan.softwareDataSourceId
    })
    if (read.problems.length) return null
    const nameColumn = plan.columns && plan.columns.Name
    const integrationsColumn = plan.columns && plan.columns['Integrates with']
    const artifactsColumn = plan.columns && plan.columns.Artifacts
    if (![nameColumn, integrationsColumn, artifactsColumn].every(column => typeof column === 'string')) return null
    const named = name => read.rows.filter(row => isRecord(row) && typeof row[nameColumn] === 'string' && row[nameColumn].trim().toLowerCase() === name.toLowerCase())
    const candidateRows = named(document.scope.candidate.name)
    if (document.scope.candidate.directoryState === 'net-new' ? candidateRows.length !== 0 : candidateRows.length !== 1) return null
    const targetRows = document.scope.candidate.targetType === 'replacement'
      ? named(document.scope.candidate.replacementTool)
      : []
    if (document.scope.candidate.targetType === 'replacement' && targetRows.length !== 1) return null
    const rowByIdentity = new Map()
    for (const row of read.rows) {
      const identity = isRecord(row) ? pageIdentity(row.url) : null
      if (!identity || rowByIdentity.has(identity) || evaluate.relationMalformed(row[integrationsColumn]) || evaluate.relationIncomplete(row[integrationsColumn]) || evaluate.relationCount(row[integrationsColumn]) >= evaluate.NOTION_RELATION_CAP) return null
      rowByIdentity.set(identity, row)
    }
    const affected = new Map()
    const roots = [...candidateRows, ...targetRows]
    if (document.scope.candidate.directoryState === 'net-new') {
      for (const [identity, row] of rowByIdentity) affected.set(identity, row)
    }
    for (const row of roots) affected.set(pageIdentity(row.url), row)
    for (const target of roots) {
      const targetIdentity = pageIdentity(target.url)
      for (const ref of evaluate.relationUrls(target[integrationsColumn])) {
        const identity = pageIdentity(ref)
        const related = identity && rowByIdentity.get(identity)
        if (!related) return null
        affected.set(identity, related)
      }
      for (const [identity, row] of rowByIdentity) {
        if (identity !== targetIdentity && evaluate.relationUrls(row[integrationsColumn]).some(ref => pageIdentity(ref) === targetIdentity)) affected.set(identity, row)
      }
    }
    const software = new Set()
    const artifacts = new Set()
    for (const [softwareId, row] of affected) {
      software.add(softwareId)
      if (evaluate.relationMalformed(row[artifactsColumn]) || evaluate.relationIncomplete(row[artifactsColumn]) || evaluate.relationCount(row[artifactsColumn]) >= evaluate.NOTION_RELATION_CAP) return null
      for (const ref of evaluate.relationUrls(row[artifactsColumn])) {
        const id = pageIdentity(ref)
        if (!id) return null
        artifacts.add(id)
      }
    }
    return { software, artifacts, all: new Set([...software, ...artifacts]) }
  } catch (_) {
    return null
  }
}

function surveyPageIdentities (input, document) {
  const groups = surveyRelatedIdentityGroups(input, document)
  return groups && groups.all
}

function sameIdentitySet (actual, expected) {
  return actual.length === expected.size && new Set(actual).size === actual.length && actual.every(identity => expected.has(identity))
}

function attestRelatedReadSequence (input, scope, plan, artifactInput, supplied) {
  const document = scopeDocument(input, supplied)
  const problems = []
  if (!document || acceptedScopeProblem(document.scope) || document.scope.scopeId !== (scope && scope.scopeId)) {
    return { ok: false, problems: ['Related-read sequence attestation requires the unchanged scope installed for this private run.'] }
  }
  const installed = installedSurveyPlan(input, document)
  if (!installed || fingerprint(installed) !== fingerprint(plan)) {
    return { ok: false, problems: ['Related-read sequence attestation requires the exact installed canonical survey plan.'] }
  }
  const groups = surveyRelatedIdentityGroups(input, document)
  if (!groups) problems.push('The completed hook-captured Software survey could not derive the exact related page sets.')
  if (!isRecord(artifactInput) || artifactInput.scopeId !== scope.scopeId || artifactInput.surveyRunId !== plan.surveyRunId ||
      !Array.isArray(artifactInput.softwareBodies) || !Array.isArray(artifactInput.pages)) {
    problems.push('Related page artifacts must carry scopeId, surveyRunId, softwareBodies, and pages for this run.')
  }
  const identities = list => Array.isArray(list) ? list.map(one => pageIdentity(one && (one.url || one.id))).filter(Boolean) : []
  const softwareIds = identities(artifactInput && artifactInput.softwareBodies)
  const artifactIds = identities(artifactInput && artifactInput.pages)
  if (groups && !sameIdentitySet(softwareIds, groups.software)) problems.push('softwareBodies does not exactly equal the affected Software identities derived from the captured details query.')
  if (groups && !sameIdentitySet(artifactIds, groups.artifacts)) problems.push('pages does not exactly equal the related Process identities derived from the captured details query.')
  if (problems.length) return { ok: false, problems }
  const locked = withNotionSequenceLock(input, document, () => {
    const lockedProblems = []
    const sequence = readNotionSequence(input, document, plan)
    const current = sequence && sequence.phases[sequence.phases.length - 1]
    if (!sequence || sequence.phases.length !== 2 || !current || current.execution !== 'software-details' || current.complete !== true) {
      lockedProblems.push('Related reads must be attested immediately after the captured before-manifest and complete Software-details phases.')
    }
    if (sequence) {
      const fetched = sequence.fetches.map(one => one.pageIdentity)
      if (fetched.length !== groups.all.size || !sameIdentitySet(fetched, groups.all)) {
        lockedProblems.push('The hook did not capture exactly one successful Notion fetch for every and only the required related page identity.')
      }
      let processReadsStarted = false
      for (const identity of fetched) {
        if (groups.artifacts.has(identity)) processReadsStarted = true
        else if (!groups.software.has(identity) || processReadsStarted) lockedProblems.push('The hook-captured page reads did not execute affected Software bodies before related Process pages.')
      }
      const suppliedByIdentity = new Map()
      for (const page of [...artifactInput.softwareBodies, ...artifactInput.pages]) {
        const binding = pageArtifactBinding(page)
        if (!binding || suppliedByIdentity.has(binding.pageIdentity)) {
          lockedProblems.push('Every related page artifact must have one unique identity and the exact captured body, properties, and source timestamp.')
          continue
        }
        suppliedByIdentity.set(binding.pageIdentity, fingerprint(binding, 'notion-fetch-artifact'))
      }
      for (const fetch of sequence.fetches) {
        if (!fetch.artifactFingerprint || suppliedByIdentity.get(fetch.pageIdentity) !== fetch.artifactFingerprint) {
          lockedProblems.push(`Related page artifact ${fetch.pageIdentity} does not match the successful hook-captured Notion response.`)
        }
      }
    }
    const attestation = evaluate.relatedReadAttestation(scope, plan, artifactInput)
    if (!attestation.ok) lockedProblems.push(...attestation.problems)
    if (lockedProblems.length) return { ok: false, problems: [...new Set(lockedProblems)] }
    for (const execution of attestation.precedingExecutions) {
      sequence.phases.push({
        execution: execution.execution,
        artifactFingerprint: execution.artifactFingerprint,
        complete: true
      })
    }
    if (!writeNotionSequenceUnlocked(input, document, sequence)) return { ok: false, problems: ['The hook-owned survey sequence could not be persisted.'] }
    return attestation
  })
  return locked || { ok: false, problems: ['The hook-owned survey sequence lock could not be acquired.'] }
}

function trustedSurveySequenceAttestation (input, scope, plan, before, detailed, after, supplied) {
  const document = scopeDocument(input, supplied)
  if (!document || acceptedScopeProblem(document.scope) || document.scope.scopeId !== (scope && scope.scopeId)) return { ok: false, problems: ['Directory proof has no unchanged installed scope.'] }
  const installed = installedSurveyPlan(input, document)
  if (!installed || fingerprint(installed) !== fingerprint(plan)) return { ok: false, problems: ['Directory proof has no matching canonical installed survey plan.'] }
  const sequence = readNotionSequence(input, document, plan)
  const names = ['manifest-before', 'software-details', 'affected-software-bodies', 'related-process-pages', 'manifest-after']
  if (!sequence || sequence.phases.length !== names.length || sequence.phases.some((phase, index) => phase.execution !== names[index] || phase.complete !== true)) {
    return { ok: false, problems: ['The hook-owned survey sequence did not capture all five phases in order.'] }
  }
  const expected = evaluate.surveySequenceAttestation(scope, plan, before, detailed, after)
  for (const [index, execution] of expected.executions.entries()) {
    if (!execution.artifactFingerprint || sequence.phases[index].artifactFingerprint !== execution.artifactFingerprint) {
      return { ok: false, problems: [`Saved ${execution.name} does not match the artifact captured by its hook-owned survey phase.`] }
    }
  }
  return { ok: true, problems: [], ...expected }
}

function sourceFor (toolName, values, document) {
  const connector = toolName.match(/^mcp__plugin_software_(box|google-drive|gmail|slack|ramp|quickbooks|docusign|google-calendar|granola|gong)__/)
  if (connector) return CONNECTOR_SOURCES[connector[1]]
  if (/^mcp__.*__notion[-_](?:fetch|query[-_]data[-_]sources)$/.test(toolName)) return 'software-directory'
  if (toolName === 'WebSearch' || toolName === 'WebFetch') {
    return 'web'
  }
  return null
}

function callBoundaryProblem (toolName, toolInput, document) {
  const scope = document.scope
  const values = stringsIn(toolInput)
  let source = sourceFor(toolName, values, document)
  if (!source) return null
  if (source === 'web') {
    const domains = webDomains(toolInput)
    source = ['vendor-web', 'independent-web'].find(kind => {
      const approved = scope.sourceBoundaries[kind] && scope.sourceBoundaries[kind].domains
      return Array.isArray(approved) && domains.length && domains.every(domain => approved.includes(domain))
    })
    if (!source) return 'The web read includes no approved domain or includes a domain outside the accepted boundary.'
    if (toolName === 'WebSearch') {
      const approved = scope.sourceBoundaries[source].domains
      const positive = positiveWebSearchDomains(toolInput)
      if (!positive.length || positive.some(domain => !approved.includes(domain))) {
        return 'WebSearch must carry an explicit positive site: restriction to an accepted domain.'
      }
    }
  }
  const boundary = scope.sourceBoundaries[source]
  if (!isRecord(boundary)) return `The ${source} connector is outside the accepted evaluation scope.`
  if (source === 'gmail' && values.some(value => /[{}]/.test(value))) {
    return 'The gmail read uses brace disjunction syntax that can separate the accepted date predicates into independent branches.'
  }
  if (['slack', 'box', 'google-drive', 'gmail', 'vendor-web', 'independent-web'].includes(source) && values.some(value => /\bOR\b|\|/i.test(value))) {
    return `The ${source} read uses disjunctive query syntax that could escape an accepted locator. Run one separately bounded read per branch.`
  }
  if (source === 'google-drive') {
    const problem = googleDriveNegationProblem(toolInput)
    if (problem) return problem
  }

  const method = toolName.split('__').pop()
  const resultFollowUp = (['box', 'google-drive'].includes(source) && /(?:read|download)_file_content$/i.test(method)) ||
    (source === 'gmail' && /^(?:get_message|get_thread)$/i.test(method))
  if (resultFollowUp) {
    const requested = keyedStrings(toolInput, source === 'gmail'
      ? /^(?:id|messageId|message_id|threadId|thread_id)$/i
      : /^(?:id|fileId|file_id)$/i)
    const authorized = authorizedResultIds({ tool_name: toolName, tool_input: toolInput, cwd: document.cwd }, document, source)
    if (requested.length !== 1 || !authorized.includes(requested[0])) {
      return source === 'gmail'
        ? 'The gmail detail read does not name one message or thread returned by its accepted date-bounded search.'
        : `The ${source} content read does not name one file returned by its accepted bounded search.`
    }
    return null
  }

  const approvedLocators = source === 'slack'
    ? [...(boundary.channels || []), ...(boundary.directMessages || [])]
    : ['google-calendar', 'granola'].includes(source)
        ? boundary.meetings || []
        : source === 'gong'
            ? boundary.calls || []
            : ['vendor-web', 'independent-web'].includes(source)
                ? []
                : boundary.folder ? [boundary.folder] : boundary.account ? [boundary.account] : []
  if (source === 'slack') {
    const problem = slackLocatorProblem(toolName, toolInput, boundary)
    if (problem) return problem
  } else if (approvedLocators.length) {
    const problem = locatorSetProblem(source, locatorSet(source, toolInput, approvedLocators), approvedLocators)
    if (problem) return problem
  }
  const exactIdFollowUp = ['google-calendar', 'granola', 'gong'].includes(source) && /(?:get|read|fetch|transcript)/i.test(method) && !/(?:search|list|query)/i.test(method)
  const exactWebFetch = ['vendor-web', 'independent-web'].includes(source) && toolName === 'WebFetch'
  if (boundary.dateRange && !exactIdFollowUp && !exactWebFetch) {
    const problem = dateBoundaryProblem(toolInput, boundary.dateRange, source, toolName)
    if (problem) return `The ${source} read is outside its accepted date boundary. ${problem}`
  }

  if (source === 'software-directory') {
    if (/query[-_]data[-_]sources$/.test(toolName)) {
      const approvedDataSource = document.softwareDataSourceUrl || document.softwareDataSourceId
      const dataSources = Array.isArray(toolInput.data_sources)
        ? toolInput.data_sources
        : isRecord(toolInput.data) ? toolInput.data.data_source_urls : null
      if (typeof approvedDataSource !== 'string' || !approvedDataSource || !Array.isArray(dataSources) || dataSources.length !== 1 || dataSources[0] !== approvedDataSource) {
        return 'The Notion query does not name the config-resolved Software data source recorded in the read scope.'
      }
    } else {
      const surveyed = surveyPageIdentities({ tool_name: toolName, tool_input: toolInput, cwd: document.cwd }, document)
      const listed = Array.isArray(document.notionPageIds) ? document.notionPageIds.map(pageIdentity).filter(Boolean) : []
      const requested = values.map(pageIdentity).filter(Boolean)
      if (!surveyed || !listed.length || listed.length !== document.notionPageIds.length || listed.some(id => !surveyed.has(id)) ||
          !requested.length || requested.some(id => !listed.includes(id))) {
        return 'The Notion page read does not name a page authorized from the completed Software survey artifacts.'
      }
    }
    const sequenceProblem = notionSequenceBoundaryProblem(toolName, toolInput, document)
    if (sequenceProblem) return sequenceProblem
  }
  return null
}

function decision (input, suppliedScopeDocument) {
  if (!isRecord(input) || typeof input.tool_name !== 'string' || !isRecord(input.tool_input)) {
    return { allow: false, reason: 'Malformed PreToolUse input was refused before any tool ran.' }
  }
  const toolName = input.tool_name
  const toolInput = input.tool_input
  if (input.hook_event_name === 'PostToolUse') {
    const responseCategories = categoriesIn(input.tool_response)
    if (responseCategories.length) {
      return { allow: false, hookEventName: 'PostToolUse', reason: `Credential-shaped external response was refused before private persistence (${responseCategories.join(', ')}). No matched value was printed.` }
    }
    const notionRead = /^mcp__.*__notion[-_](?:fetch|query[-_]data[-_]sources)$/.test(toolName)
    if (notionRead) {
      const document = scopeDocument(input, suppliedScopeDocument)
      const plan = document && installedSurveyPlan(input, document)
      const detailsQuery = plan && exactQueryIn(toolInput) === plan.queries.details.sql
      if (detailsQuery && !recordNotionSurvey(input, suppliedScopeDocument)) {
        return { allow: false, hookEventName: 'PostToolUse', reason: 'The complete Software response could not be captured for scope-bound page authorization.' }
      }
      if (!recordNotionSurveyEvent(input, suppliedScopeDocument)) {
        return { allow: false, hookEventName: 'PostToolUse', reason: 'The Notion read could not be recorded in the hook-owned five-phase survey sequence.' }
      }
    }
    recordConnectorSearch(input, suppliedScopeDocument)
    return { allow: true }
  }
  const pluginExternal = /^mcp__plugin_software_(?:box|google-drive|gmail|slack|ramp|quickbooks|docusign|google-calendar|granola|gong)__/.test(toolName)

  if (pluginExternal && MUTATION.test(toolName.split('__').pop())) {
    return { allow: false, reason: 'software:evaluate uses external evidence connectors for search and read only.' }
  }

  const guardedRead = pluginExternal || /^mcp__.*__notion[-_](?:fetch|query[-_]data[-_]sources)$/.test(toolName) || toolName === 'WebSearch' || toolName === 'WebFetch'
  if (guardedRead) {
    const categories = categoriesIn(toolInput)
    if (categories.length) {
      return { allow: false, reason: `Credential-shaped external-read input was refused (${categories.join(', ')}). Use an already connected source or a scrubbed export.` }
    }
  }

  if (guardedRead) {
    const document = scopeDocument(input, suppliedScopeDocument)
    const scopeProblem = !document || acceptedScopeProblem(document.scope)
    if (scopeProblem) return { allow: false, reason: 'External evidence read was refused because no unchanged accepted evaluation scope was installed for this working directory.' }
    const boundaryProblem = callBoundaryProblem(toolName, toolInput, document)
    if (boundaryProblem) return { allow: false, reason: boundaryProblem }
  }

  if (toolName === 'Write') {
    const categories = categoriesIn(toolInput.content === undefined ? toolInput : toolInput.content)
    if (categories.length) {
      return { allow: false, reason: `Credential-shaped Write content was refused (${categories.join(', ')}). No matched value was printed.` }
    }
    const writeProblem = privateWriteProblem(input, toolInput, suppliedScopeDocument)
    if (writeProblem) return { allow: false, reason: writeProblem }
  }
  return { allow: true }
}

function hookOutput (result) {
  if (result.allow) return {}
  if (result.hookEventName === 'PostToolUse') {
    return { decision: 'block', reason: result.reason }
  }
  return {
    hookSpecificOutput: {
      hookEventName: result.hookEventName || 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: result.reason
    }
  }
}

if (require.main === module) {
  let raw = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', chunk => { raw += chunk })
  process.stdin.on('end', () => {
    let parsed
    try { parsed = JSON.parse(raw) } catch (_) { parsed = null }
    process.stdout.write(`${JSON.stringify(hookOutput(decision(parsed)))}\n`)
  })
}

module.exports = { MUTATION, stringsIn, keyedStrings, webDomains, positiveWebSearchDomains, dateFieldPolicy, datePredicates, nextDay, dateBoundaryProblem, locatorSet, googleDriveNegationProblem, slackLocatorProblem, resultIdsIn, responseEnvelopes, activeRunDirectory, privateWriteProblem, installedSurveyPlan, authorizedResultIds, recordConnectorSearch, withFileLock, notionFetchArtifact, pageArtifactBinding, recordNotionSurvey, recordNotionSurveyEvent, surveyRelatedIdentityGroups, surveyPageIdentities, notionSequenceBoundaryProblem, attestRelatedReadSequence, trustedSurveySequenceAttestation, callBoundaryProblem, decision, hookOutput }
