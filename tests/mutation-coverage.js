'use strict'
/*
 * Which checks in the backfill suite are reached by at least one mutation.
 *
 * NOT A SUITE, WHICH IS WHY IT IS NOT NAMED `.test.js`. `tests/run.sh` runs
 * every `*.test.js` and this is not one: it edits source files on disk, runs the
 * backfill suite against each edit, and puts every file back. Run it by hand:
 *
 *   node tests/mutation-coverage.js
 *
 * WHAT IT IS FOR. A green suite says the checks pass. It does not say any of
 * them would fail if the thing they watch broke, and this repository has been
 * caught by that seven times on this branch alone: a check nothing reached, one
 * scoped wider than the thing it names, one stopping a step short of the
 * outcome, one proving half a pair, a fixture whose data made the assertion
 * unreachable, one defeatable by deleting the thing it watched, and one proving
 * a value moved without proving it still worked where it went. Only the first is
 * caught here, and catching it is still worth the run.
 *
 * EVERY MUTATION IS ASSERTED ONTO DISK BEFORE THE SUITE RUNS. A mutation whose
 * anchor no longer matches silently changes nothing, and a suite that passes
 * against no change reads exactly like a suite that caught it.
 *
 * SCOPED TO THE BACKFILL SUITE. A mutation reported as surviving may well be
 * caught by another suite: inverting `wantsAPerson` survives here and goes red in
 * `tests/process-audit-update.test.js`. Read a survivor as "this suite does not
 * watch it", not as "nothing does".
 */
const fs = require('fs')
const { execFileSync } = require('child_process')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const B = path.join(ROOT, 'plugins/process/scripts/backfill.js')
const A = path.join(ROOT, 'plugins/process/scripts/artifact.js')
const P = path.join(ROOT, 'plugins/process/scripts/process.js')
const T = path.join(ROOT, 'tests/process-backfill.test.js')

const M = [
  [B, "    } else if (holder.channels !== undefined && holder.channels !== null) {", "    } else if (false) {"],
  [P, "    const final = readJson(artifactFile, 'the artifact', 'fields')", "    const final = readJson(artifactFile, 'the artifact')"],
  [P, "    const rows = readJson(rowsFile, 'the rows that came back', 'list')\n    const context = contextOrExit()", "    const rows = readJson(rowsFile, 'the rows that came back')\n    const context = contextOrExit()"],
  [P, "    const proposed = readJson(file, 'the proposed artifact', 'fields')\n\n    const problems", "    const proposed = readJson(file, 'the proposed artifact')\n\n    const problems"],
  [P, "readJson(file, 'the artifact', 'fields')", "readJson(file, 'the artifact')"],
  [P, "readJson(beforeFile, 'the artifact as it is now', 'fields')", "readJson(beforeFile, 'the artifact as it is now')"],
  [P, "    const intended = readJson(updateFile, 'the update that was sent', 'fields')\n    const readback = readJson(readbackFile, 'the page as it came back', 'fields')", "    const intended = readJson(updateFile, 'the update that was sent', 'fields')\n    const readback = readJson(readbackFile, 'the page as it came back')"],
  [P, "  return String(one.Type || one.type || '').trim()", "  return String(one.Type || '').trim()"],
  [P, "  return String(one.Name || one.what || '').trim()", "  return String(one.Name || '').trim()"],
  [P, "  return `${subjectName(one)} ${one.Description || one.why || ''}`.trim()", "  return `${one.Name || ''} ${one.Description || ''}`.trim()"],
  [P, "      process.exitCode = 1\n      return\n    }\n\n    console.log(JSON.stringify({\n      columns: columnMap(context),", "      return\n    }\n\n    console.log(JSON.stringify({\n      columns: columnMap(context),"],
  [A, "        if (givenSources !== undefined && givenSources !== null && typeof givenSources !== 'string') {", "        if (false) {"],
  [P, "        (readback.properties === null || typeof readback.properties !== 'object' || Array.isArray(readback.properties))) {", "        (false)) {"],
  [P, "      typeof intended.properties === 'object' && !Array.isArray(intended.properties)", "      typeof intended.properties === 'object'"],
  [P, "    const comparedNothing = checked.length === 0", "    const comparedNothing = false"],
  [P, "      proved: problems.length === 0 && !comparedNothing,", "      proved: problems.length === 0,"],
  [B, "    if (seen.has(key)) continue", "    if (false) continue"],
  [B, "    const key = JSON.stringify([asking.question, asking.where, asking.when])", "    const key = JSON.stringify([asking.question])"],
  [B, "  const ordered = distinct.slice().sort((a, b) => {", "  const ordered = distinct.slice().reverse(); const unusedSort = ((a, b) => {"],
  [B, "    if (req[source] === undefined || req[source] === null) continue", "    if (true) continue"],
  [B, "    if (named(source)) continue\n    if (req[source] === undefined", "    if (false) continue\n    if (req[source] === undefined"],
  [B, "    if (isRecord(value)) return value", "    if (true) return value"],
  [B, "function isRecord (value) {\n  return value !== null && typeof value === 'object' && !Array.isArray(value)", "function isRecord (value) {\n  return value !== null && typeof value === 'object'"],
  [B, "    if (!isRecord(one)) {\n      add(`askings[${index}]`", "    if (false) {\n      add(`askings[${index}]`"],
  [B, "    if (!isRecord(one)) {\n      add(`found[${index}]`", "    if (false) {\n      add(`found[${index}]`"],
  [B, "  const unreadable = new Set(refusals.filter(one => one.kind === 'not-a-record').map(one => one.field))", "  const unreadable = new Set()"],
  [A, "    if (source === null || typeof source !== 'object' || Array.isArray(source)) {", "    if (false) {"],
  [P, "readJson(file, 'the scope', 'fields')", "readJson(file, 'the scope')"],
  [P, "readJson(file, 'what was found', 'list')", "readJson(file, 'what was found')"],
  [P, "readJson(candidateFile, 'the candidate', 'fields')", "readJson(candidateFile, 'the candidate')"],
  [P, "  if (expected === 'list' && !isList) {", "  if (false) {"],
  [P, "  if (expected === 'fields' && !isFields) {", "  if (false) {"],
  [P, "  if (expected === undefined) return parsed", "  if (true) return parsed"],
  [P, "  const isFields = parsed !== null && typeof parsed === 'object' && !isList", "  const isFields = parsed !== null && typeof parsed === 'object'"],
  [B, "  if (!artifact.bodyIsMap(given.body)) {", "  if (false) {"],
  [B, "  if (!artifact.bodyIsMap(given.body)) {", "  if (!artifact.bodyIsMap({ ...(given.body || {}) })) {"],
  [B, "  if (!looksLikeARow(existing)) {", "  if (false) {"],
  [B, "  if (!looksLikeARow(candidate)) {", "  if (false) {"],
  [B, "  const looksLikeARow = value => value !== null && typeof value === 'object' && !Array.isArray(value)", "  const looksLikeARow = value => value !== null && typeof value === 'object'"],
  [A, "if (sections && !bodyIsMap(row.body)) {", "if (false) {"],
  [A, "  if (value === undefined || value === null) return true\n  return typeof value === 'object' && !Array.isArray(value)", "  if (value === undefined || value === null) return true\n  return typeof value === 'object'"],
  [A, "  if (value === '[]') return []", "  if (false) return []"],
  [P, "  return !cameBackEmpty(value)", "  return cameBackEmpty(value)"],
  [B, "if (holder.dms === 'all' || holder.dms === true) {", "if (false) {"],
  [B, "      add(source, 'range-open', `${source} has no usable", "      if (false) add(source, 'range-open', `${source} has no usable"],
  [B, "if (mailbox && mailbox !== 'own') {", "if (false) {"],
  [B, "if (!SOURCES.includes(one)) {", "if (false) {"],
  [B, "if (!recorder) {", "if (false) {"],
  [B, "notReading.push(`The \"${one}\" way of looking was not chosen.`)", "void one"],
  [B, "if (!where) {\n      add(`askings[${index}]`, 'provenance-missing'", "if (false) {\n      add(`askings[${index}]`, 'provenance-missing'"],
  [B, "const REPEAT_MIN = 3", "const REPEAT_MIN = 2"],
  [B, "where: cluster.askings.map(one => ({ where: one.where, when: one.when }))", "where: cluster.askings.map(one => ({ where: one.where }))"],
  [B, "if (type && !schema.TYPES.includes(type)) {", "if (false) {"],
  [B, "if (!where) {\n      add(`found[${index}]`, 'provenance-missing'", "if (false) {\n      add(`found[${index}]`, 'provenance-missing'"],
  [B, "if (score >= REPEAT_SIMILARITY) near.push({ a: out[i].id, b: out[j].id, score })", "void score"],
  [B, "  if (!listed || (Array.isArray(given.sources) && !sources.length)) {", "  if (false) {"],
  [B, "  if (listed && !Array.isArray(given.sources)) {", "  if (false) {"],
  [B, "  const listed = given.sources !== undefined && given.sources !== null", "  const listed = true"],
  [A, "  if (row.Name !== undefined && row.Name !== null && typeof row.Name !== 'string') {", "  if (false) {"],
  [B, "  for (const field of REFUSED_ON_A_BACKFILL) {\n    // Asked through `artifact.js` rather than repeated", "  for (const field of []) {\n    // Asked through `artifact.js` rather than repeated"],
  [B, "const REFUSED_ON_A_BACKFILL = [\n  ...schema.PERSON_FIELDS,\n  ...schema.VERIFICATION_FIELDS.filter(field => !schema.PERSON_FIELDS.includes(field))\n]", "const REFUSED_ON_A_BACKFILL = [...schema.PERSON_FIELDS]"],
  [B, "body.Sources = artifact.sourcesSection(sources)", "if (!body.Sources) body.Sources = artifact.sourcesSection(sources)"],
  [B, "if (!blank(before[field])) {", "if (false) {"],
  [B, "  for (const field of REFUSED_ON_A_BACKFILL) {\n    if (artifact.askedForNothing(given[field])) continue\n    refused.push({", "  for (const field of []) {\n    if (artifact.askedForNothing(given[field])) continue\n    refused.push({"],
  [B, "const after = { url: before.url, reviewed: false }", "const after = { url: before.url, reviewed: true }"],
  [B, "if (!text(before.url)) {", "if (false) {"],
  [A, "  if (!backfilled) {\n    const stamp", "  if (true) {\n    const stamp"],
  [A, "        add(\n          field,\n          'backfill-person',", "        if (false) add(\n          field,\n          'backfill-person',"],
  [A, "if (typeof row.backfill !== 'boolean') {", "if (false) {"],
  [A, "  if (row.Description !== undefined && row.Description !== null && typeof row.Description !== 'string') {", "  if (false) {"],
  [A, "  return cameBackEmpty(value)\n}", "  return value === undefined || value === null || value === ''\n}"],
  [B, "  const badValues = filling.length", "  const badValues = false"],
  [B, "  const blank = cameBackEmpty", "  const blank = value => value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)"],
  [B, "  const identity = ['Name', 'Type'].filter(field => !text(before[field]))", "  const identity = []"],
  [P, "    backfill.READ_BY_FILL)", "    backfill.FILLABLE)"],
  [B, "const READ_BY_FILL = ['Name', 'Type', ...FILLABLE, ...REFUSED_ON_A_BACKFILL]", "const READ_BY_FILL = [...FILLABLE, ...REFUSED_ON_A_BACKFILL]"],
  [B, ").filter(one => filling.includes(one.field))", ").filter(() => false)"],
  [B, "    out.parent = given.parent\n    //", "    //"],
  [B, "    if (given.parentType !== undefined) out.parentType = given.parentType", ""],
  [P, "      [...UPDATABLE_FIELDS, ...schema.VERIFICATION_FIELDS]\n    )", "      UPDATABLE_FIELDS\n    )"],
  [A, "if (written !== expected) {", "if (false) {"],
  [P, "      ['existing', existing],\n      ['candidate', candidate]", "      ['existing', existing]"],
  [P, "    refuseRawKeys(context, [\n      ['existing', existing],", "    if (false) refuseRawKeys(context, [\n      ['existing', existing],"],
  [P, "    ], 'read as empty, so nothing is filled and this reports that there was nothing to fill',\n    backfill.READ_BY_FILL)", "    ], 'read as empty, so nothing is filled and this reports that there was nothing to fill')"],
  [P, "backfill: final.backfill === true,\n      backfillNote:", "backfill: false,\n      backfillNote:"],
  [P, "    if (final.backfill === true) {\n      for (const logical of backfill.REFUSED_ON_A_BACKFILL) {", "    if (false) {\n      for (const logical of backfill.REFUSED_ON_A_BACKFILL) {"],
  [P, "        if (cameBackEmpty(got)) {", "        if (got === undefined || got === null || got === '') {"],
  [P, "            const empty = cameBackEmpty", "            const empty = value => value === undefined || value === null || value === ''"],
  [P, "    if (problems.length) process.exitCode = 1\n  },\n\n  duplicates (file) {", "  },\n\n  duplicates (file) {"],
  [P, "        if (intended.reviewed !== true && intended.verificationBefore) {", "        if (false) {"],
  [P, "            if (empty(now)) {\n              unchecked.push(", "            if (false) {\n              unchecked.push("],
  [P, "          logical in before ? before[logical] : null", "          logical in before ? before[logical] : undefined"],
  [P, "        schema.VERIFICATION_FIELDS.map(logical => [\n          context.property(logical),", "        schema.VERIFICATION_FIELDS.filter(logical => logical in before).map(logical => [\n          context.property(logical),"],
  [B, "  if (req.topics !== undefined && req.topics !== null && !Array.isArray(req.topics)) {", "  if (false) {"],
  [B, "  const topicsMalformed = (req.topics !== undefined && req.topics !== null && !Array.isArray(req.topics)) ||\n    notNames(req.topics).length > 0", "  const topicsMalformed = false"],
  [A, "if (!suppliedSources.length) {", "if (false) {"],
  [B, "  for (const field of ['Description', 'Domain', 'Review cadence', 'Status', ...schema.MULTI_SELECT_FIELDS]) {", "  for (const field of ['Description', 'Domain', 'Review cadence', 'Status', 'Owner', ...schema.MULTI_SELECT_FIELDS]) {"],
  [B, "if (req.sources === undefined || req.sources === null) {", "if (false) {"],
  [B, "reading.slack = { channels, dms, ...window }", "reading.slack = { channels, dms: [], ...window }"],
  [B, "if (from && to && from > to) {", "if (false) {"],
  [B, "add('slack', 'channels-unset',", "if (false) add('slack', 'channels-unset',"],
  [B, "const conversational = CONVERSATION_SOURCES.some(one => named(one))", "const conversational = asked.length > 0"],
  [B, "if (!where) {\n      add('documents', 'unlocated'", "if (false) {\n      add('documents', 'unlocated'"],
  [B, "if (topics && !ways.includes('topics')) {", "if (false) {"],
  [B, "  if (ways.includes('topics') && !topics && !topicsMalformed) {", "  if (false) {"],
  [P, "    if (!out.ok) process.exitCode = 1\n  },\n\n  repeats (file) {", "  },\n\n  repeats (file) {"],
  [B, "const home = clusters.find(cluster => similarity(cluster.question, asking.question) >= threshold)", "const home = null"],
  [B, "const REPEAT_SIMILARITY_IS_MEASURED = false", "const REPEAT_SIMILARITY_IS_MEASURED = true"],
  [B, "      needs: type ? [] : ['type']", "      needs: []"],
  [P, "'RUN `duplicates` AND `judge` ON EACH CANDIDATE BEFORE OFFERING IT. That is the same check `new` uses, and '", "'Offer the candidates. '"],
  [B, "  const out = {\n    backfill: true,", "  const out = {\n    backfill: false,"],
  [B, "  const problems = artifact.problems(out, { parentType: given.parentType })", "  const problems = []"],
  [B, "    leftEmpty: [...schema.VERIFICATION_FIELDS, 'Owner'],", "    leftEmpty: [],"],
  [A, "        add(\n          field,\n          'backfill-verification',", "        if (false) add(\n          field,\n          'backfill-verification',"],
  [A, "  const backfilled = final.backfill === true", "  const backfilled = true"],
  [B, "    after[field] = given[field]\n    filling.push(field)", "    void field"],
  [P, "const refused = (out.refusals && out.refusals.length) || (out.neverFilled && out.neverFilled.length)", "const refused = (out.refusals && out.refusals.length)"],
  [P, "    const refused = (out.refusals && out.refusals.length) || (out.neverFilled && out.neverFilled.length)\n    if (refused) process.exitCode = 1", "    const refused = out.refused && out.refused.length\n    if (refused) process.exitCode = 1"],
  [B, "  refusals.push(...artifact.sourceProblems(sources))\n\n", ""],
  [B, "  const neverFilled = refused.filter(one => one.kind === 'never-filled')", "  const neverFilled = []"],
  [B, "if (conversational && !ways.length && !refusals.some(one => one.field === 'ways')) {", "if (false) {"],
  [B, "if (!conversational && ways.length) {", "if (false) {"],
  [B, "    reading: ok ? reading : {},", "    reading,"],
  [B, "    ways: ok ? ways : [],", "    ways,"],
  [B, "    topics: ok && topics ? topics : [],", "    topics: topics || [],"],
  [P, "    } else if (got !== created) {", "    } else if (false) {"],
  [P, "    const created = pageKey(createdUrl)\n    if (!created) {", "    const created = pageKey(createdUrl)\n    if (false) {"],
  [B, "      add('sources', 'not-a-name',", "      if (false) add('sources', 'not-a-name',"],
  [B, "        add('slack', 'channel-not-a-name',", "        if (false) add('slack', 'channel-not-a-name',"],
  [B, "          add('slack', 'dm-not-a-name',", "          if (false) add('slack', 'dm-not-a-name',"],
  [B, "      add('ways', 'not-a-name',", "      if (false) add('ways', 'not-a-name',"],
  [B, "    add('topics', 'not-a-name',", "    if (false) add('topics', 'not-a-name',"],
  [B, "  if (new Date(parsed).toISOString().slice(0, 10) !== value) return null", "  void parsed"],
  [B, "        add(source, 'range-not-a-day',", "        if (false) add(source, 'range-not-a-day',"]
]

const all = [...fs.readFileSync(T, 'utf8').matchAll(/^check\('((?:[^'\\]|\\.)*)'/gm)].map(m => m[1].replace(/\\'/g, "'"))
const originals = new Map()
for (const f of [B, A, P]) originals.set(f, fs.readFileSync(f, 'utf8'))
const restore = () => { for (const [f, s] of originals) fs.writeFileSync(f, s) }

const caughtBy = new Set()
let landed = 0, notLanded = 0, survived = 0
for (const [file, from, to] of M) {
  restore()
  const src = originals.get(file)
  if (src.split(from).length - 1 !== 1) { notLanded++; console.log('DID NOT LAND:', from.slice(0, 60)); continue }
  fs.writeFileSync(file, src.replace(from, to))
  if (fs.readFileSync(file, 'utf8') === src) { notLanded++; continue }
  landed++
  try {
    execFileSync('node', [T], { cwd: ROOT, encoding: 'utf8' })
    survived++
    console.log('SURVIVED:', from.slice(0, 70))
  } catch (err) {
    const out = (err.stdout || '') + (err.stderr || '')
    for (const l of out.split('\n')) if (l.startsWith('  FAIL')) caughtBy.add(l.replace('  FAIL  ', '').trim())
  }
}
restore()

const unreached = all.filter(name => !caughtBy.has(name))
console.log(`\nmutations attempted: ${M.length}, landed: ${landed}, did not land: ${notLanded}, survived: ${survived}`)
console.log(`checks in the suite: ${all.length}, reached by at least one mutation: ${all.length - unreached.length}`)
if (unreached.length) console.log('NOT REACHED:\n  ' + unreached.join('\n  '))
