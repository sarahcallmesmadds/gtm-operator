'use strict'

/**
 * The command layer. This file decides what to send and what an answer
 * means; the skill sends the requests and drives the conversation. That is
 * the marketplace's one convention, and the split matters here for a second
 * reason: the Service Key stays in the file config names, attached by the
 * skill at send time, and never passes through this code.
 *
 * Everything before `push` plans. `push` emits exactly what the approved
 * plan names, `judge-push` reads what came back, `prove` compares the
 * read-backs field by field, and `writeback` speaks to a Notion source only.
 *
 *   node import-leads.js config-show
 *   node import-leads.js config-draft <answers.json>
 *   node import-leads.js config-write <draft.json>
 *   node import-leads.js ingest <source.csv> [mapping.json]
 *   node import-leads.js ingest-notion <entries.json> [mapping.json]
 *   node import-leads.js aliases <rows.json>
 *   node import-leads.js personas <rows.json> <personas.json>
 *   node import-leads.js gate <rows.json> <required.json>
 *   node import-leads.js events <rows.json>
 *   node import-leads.js dedupe-queries <rows.json>
 *   node import-leads.js dedupe <rows.json> <responses.json>
 *   node import-leads.js company-queries <rows.json>
 *   node import-leads.js plan <inputs.json>
 *   node import-leads.js push <plan.json>
 *   node import-leads.js judge-push <requests.json> <responses.json>
 *   node import-leads.js readbacks <plan.json> <pushed-ids.json>
 *   node import-leads.js prove <plan.json> <pushed-ids.json> <readbacks.json>
 *   node import-leads.js writeback <plan.json> <pushed-ids.json>
 *   node import-leads.js check-standing
 *   node import-leads.js probe-judge <response.json>
 *   node import-leads.js validate-rules <required.json> [grid.json] [personas.json]
 */

const fs = require('fs')
const path = require('path')

const config = require(path.join(__dirname, 'config'))
const ingest = require(path.join(__dirname, 'ingest'))
const rules = require(path.join(__dirname, 'rules'))
const plan = require(path.join(__dirname, 'plan'))
const hubspot = require(path.join(__dirname, 'hubspot'))

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'))

/** The config, or the refusal printed and a non-zero exit. */
function configOrExit () {
  const result = config.read()
  if (!result.ok) {
    console.error(result.message)
    process.exit(result.missing ? 2 : 1)
  }
  return result
}

/**
 * Writeback batches carry ten entries each, the reference's own rate-limit
 * batching, carried over rather than re-derived.
 */
const WRITEBACK_BATCH = 10

const commands = {
  'config-show' () {
    const result = configOrExit()
    console.log(JSON.stringify({ path: result.path, config: result.config }, null, 2))
  },

  'config-draft' (answersFile) {
    if (!answersFile) throw new Error('config-draft needs the answers file: portalId, serviceKeyPath, aliasMapPath, and any property corrections.')
    console.log(JSON.stringify({
      draft: config.draft(readJson(answersFile)),
      note: 'Show this whole file and write it only on an explicit yes, with config-write. It is written once.'
    }, null, 2))
  },

  'config-write' (draftFile) {
    if (!draftFile) throw new Error('config-write needs the confirmed draft file.')
    const written = config.write(readJson(draftFile))
    console.log(JSON.stringify({ written: written.path }, null, 2))
  },

  ingest (sourceFile, mappingFile) {
    if (!sourceFile) throw new Error('ingest needs the one named CSV file. The scope gate refuses rather than narrows: no source, no read.')
    const text = fs.readFileSync(sourceFile, 'utf8')
    const result = ingest.ingestCsv(text, mappingFile ? readJson(mappingFile) : null)
    console.log(JSON.stringify(result, null, 2))
    if (!result.decided) {
      console.error('The mapping above is proposed, not decided. Show it, with the unmapped columns, and run ingest again with the confirmed mapping.')
      process.exit(3)
    }
  },

  'ingest-notion' (entriesFile, mappingFile) {
    if (!entriesFile) throw new Error('ingest-notion needs the fetched {pageId, columns} entries, saved as they came.')
    const result = ingest.ingestNotionRows(readJson(entriesFile), mappingFile ? readJson(mappingFile) : null)
    console.log(JSON.stringify(result, null, 2))
    if (!result.decided) {
      console.error('The mapping above is proposed, not decided. Show it, with the unmapped columns, and run ingest-notion again with the confirmed mapping.')
      process.exit(3)
    }
  },

  aliases (rowsFile) {
    if (!rowsFile) throw new Error('aliases needs the ingested rows.')
    const result = configOrExit()
    if (!fs.existsSync(result.aliasMapPath)) {
      console.error(
        `Config names the alias map at ${result.aliasMapPath} and there is no file there. ` +
        'The map is user-owned: create it (even empty, {"aliases": {}}), or fix the path in config by hand.'
      )
      process.exit(1)
    }
    console.log(JSON.stringify(rules.applyAliases(readJson(rowsFile), readJson(result.aliasMapPath)), null, 2))
  },

  personas (rowsFile, personasFile) {
    if (!rowsFile || !personasFile) {
      throw new Error(
        'personas needs the rows and the personas artifact. When the org has no personas artifact this step is skipped ' +
        'without complaint, and skipping means not running this command, not running it with an invented artifact.'
      )
    }
    console.log(JSON.stringify(rules.applyPersonas(readJson(rowsFile), readJson(personasFile)), null, 2))
  },

  gate (rowsFile, requiredFile) {
    if (!rowsFile || !requiredFile) {
      throw new Error(
        'gate needs the rows and the required-fields rule from the Process artifact. A missing artifact is named, not ' +
        'worked around: if it does not exist, `process:new` is where it gets written.'
      )
    }
    console.log(JSON.stringify(plan.gate(readJson(rowsFile), readJson(requiredFile)), null, 2))
  },

  events (rowsFile) {
    if (!rowsFile) throw new Error('events needs the ingested rows. The multi-event check is mandatory before campaign setup.')
    console.log(JSON.stringify(plan.eventSignals(readJson(rowsFile)), null, 2))
  },

  'dedupe-queries' (rowsFile) {
    if (!rowsFile) throw new Error('dedupe-queries needs the rows.')
    const result = configOrExit()
    const rows = readJson(rowsFile)
    const emails = rows.map(row => row.fields && row.fields.email).filter(Boolean)
    console.log(JSON.stringify({
      requests: hubspot.searchRequests(result.config, emails),
      withoutEmail: rows.filter(row => !(row.fields && row.fields.email)).map(row => row.index),
      note: 'Send each request with the Service Key as the bearer header, read from the file config names. Save each response whole, in order, and pass the array to dedupe. Rows without an email cannot be checked and come back as such.'
    }, null, 2))
  },

  dedupe (rowsFile, responsesFile) {
    if (!rowsFile || !responsesFile) throw new Error('dedupe needs the rows and the saved search responses.')
    const result = configOrExit()
    const existing = hubspot.searchResults(result.config, readJson(responsesFile))
    const verdicts = plan.dedupeVerdicts(readJson(rowsFile), existing)
    console.log(JSON.stringify(Object.assign({ searchIncomplete: existing.incomplete }, verdicts), null, 2))
  },

  'company-queries' (rowsFile) {
    if (!rowsFile) throw new Error('company-queries needs the rows, after aliases.')
    const result = configOrExit()
    const rows = readJson(rowsFile)
    const companies = new Map()
    for (const row of rows) {
      const name = row.fields && row.fields.company
      if (!name) continue
      if (!companies.has(name)) companies.set(name, { name, domain: null, rows: [] })
      const entry = companies.get(name)
      entry.rows.push(row.index)
      if (!entry.domain && row.fields.companyDomain) entry.domain = row.fields.companyDomain
    }
    console.log(JSON.stringify({
      companies: [...companies.values()],
      requests: hubspot.companySearchRequests(result.config, [...companies.values()]),
      note: 'Send each and show the candidates with their evidence. The match is the person\'s decision; the alias map holds the answers already settled so they are not re-asked. Rows without a company are handled at the gate, not here.'
    }, null, 2))
  },

  plan (inputsFile) {
    if (!inputsFile) throw new Error('plan needs the inputs file holding every decided step. The command refuses anything undecided by name.')
    const result = configOrExit()
    const input = Object.assign({}, readJson(inputsFile), { config: result.config })
    const assembled = plan.assemble(input)
    if (!assembled.ok) {
      console.error(`The plan cannot be assembled yet:\n  ${assembled.problems.join('\n  ')}`)
      process.exit(1)
    }
    console.log(JSON.stringify(assembled.plan, null, 2))
  },

  push (planFile) {
    if (!planFile) throw new Error('push needs the approved plan. It emits exactly what the plan names and nothing else.')
    const result = configOrExit()
    console.log(JSON.stringify(hubspot.pushRequests(result.config, readJson(planFile)), null, 2))
  },

  'judge-push' (requestsFile, responsesFile) {
    if (!requestsFile || !responsesFile) {
      throw new Error('judge-push needs the emitted requests and the saved responses, in the same order, one response per request sent.')
    }
    const emitted = readJson(requestsFile)
    const requests = Array.isArray(emitted) ? emitted : emitted.requests
    const responses = readJson(responsesFile)
    if (!Array.isArray(requests) || !Array.isArray(responses) || requests.length !== responses.length) {
      throw new Error(
        'The requests and responses do not line up one to one. Save one response per request, in order, and use null for ' +
        'a request that was not sent: a report over a partial push has to say which parts ran.'
      )
    }
    console.log(JSON.stringify(requests.map((request, at) => ({
      label: request.label,
      judged: hubspot.judgeResponse(request, responses[at])
    })), null, 2))
  },

  readbacks (planFile, pushedIdsFile) {
    if (!planFile || !pushedIdsFile) throw new Error('readbacks needs the plan and the pushed ids ({contacts: {"<row>": id}, companies: {"<name>": id}, lists: {"<name>": id}}).')
    const result = configOrExit()
    console.log(JSON.stringify({
      requests: hubspot.readbackRequests(result.config, readJson(planFile), readJson(pushedIdsFile)),
      note: 'Fetch every one. An id is a locator, not a proof: prove compares what comes back against the plan, field by field.'
    }, null, 2))
  },

  prove (planFile, pushedIdsFile, readbacksFile) {
    if (!planFile || !pushedIdsFile || !readbacksFile) throw new Error('prove needs the plan, the pushed ids and the saved read-backs.')
    const result = configOrExit()
    const proof = hubspot.prove(result.config, readJson(planFile), readJson(pushedIdsFile), readJson(readbacksFile))
    console.log(JSON.stringify(proof, null, 2))
    if (proof.problems.length) {
      console.error('This push did not fully land. Say exactly which writes are proved and which are not, and never report success with a problem on this list.')
      process.exit(1)
    }
  },

  writeback (planFile, pushedIdsFile) {
    if (!planFile || !pushedIdsFile) throw new Error('writeback needs the plan and the pushed ids.')
    const result = configOrExit()
    const approved = readJson(planFile)
    const pushedIds = readJson(pushedIdsFile)
    if (!approved.writeback || approved.writeback.kind !== 'notion') {
      console.log(JSON.stringify({ entries: [], note: 'The source is not Notion, so there is no writeback. A CSV source is never modified.' }, null, 2))
      return
    }
    const entries = approved.contacts.creates
      .filter(create => create.row.notionPageId)
      .map(create => ({
        pageId: create.row.notionPageId,
        recordUrl: (pushedIds.contacts || {})[create.index]
          ? `https://app.hubspot.com/contacts/${result.config.portalId}/record/0-1/${pushedIds.contacts[create.index]}`
          : null,
        email: create.row.fields.email || null
      }))
    const batches = []
    for (let at = 0; at < entries.length; at += WRITEBACK_BATCH) {
      batches.push(entries.slice(at, at + WRITEBACK_BATCH))
    }
    console.log(JSON.stringify({
      batches,
      rules: [
        'Link the created record on its source row using recordUrl. A row with recordUrl null has no proved record and gets no link.',
        'Fill email on the source row only if that field is blank right now: check at write time, because the row may have changed since ingest. Never overwrite a value already there.',
        'A writeback failure is reported and never fails the run. The CRM is the system of record.',
        'The record URL shape is rebuilt from the portal id and the contact id, and has not been measured: confirm the first one opens before writing the rest.'
      ]
    }, null, 2))
  },

  'check-standing' () {
    const result = config.read()
    if (!result.ok) {
      console.log(JSON.stringify({ config: { ok: false, message: result.message } }, null, 2))
      process.exit(result.missing ? 2 : 1)
    }

    const standing = { config: { ok: true, path: result.path, portalId: result.config.portalId } }

    // Existence and size only. The key's contents are never read into any
    // output, here or anywhere.
    if (!fs.existsSync(result.serviceKeyPath)) {
      standing.serviceKey = { ok: false, why: `Config names the key at ${result.serviceKeyPath} and there is no file there.` }
    } else if (!fs.statSync(result.serviceKeyPath).size) {
      standing.serviceKey = { ok: false, why: `The key file at ${result.serviceKeyPath} is empty.` }
    } else {
      standing.serviceKey = { ok: true, path: result.serviceKeyPath }
    }

    if (!fs.existsSync(result.aliasMapPath)) {
      standing.aliasMap = { ok: false, why: `Config names the alias map at ${result.aliasMapPath} and there is no file there. Create it, even empty: {"aliases": {}}.` }
    } else {
      try {
        const wrong = rules.aliasMapProblems(readJson(result.aliasMapPath))
        standing.aliasMap = wrong.length ? { ok: false, why: wrong } : { ok: true, path: result.aliasMapPath }
      } catch (error) {
        standing.aliasMap = { ok: false, why: `${result.aliasMapPath} is not valid JSON: ${error.message}` }
      }
    }

    standing.probe = {
      request: hubspot.probeRequest(result.config),
      note: 'Send this read-only request with the bearer and pass the saved response to probe-judge. Nothing about the connection is claimed until it answers.'
    }
    standing.artifacts = {
      note:
        'The required-fields rule and the member-status grid live in Process and are checked by reading them there; the personas ' +
        'and routing artifacts are optional. A missing required artifact is named, and `process:new` is where it gets written. ' +
        'Validate what was read with validate-rules.'
    }
    standing.autoCompanyCreation =
      'Standing risk: the portal may auto-create a company from an email domain and take the primary association (measured ' +
      '2026-08-25). Whether the setting can be read from the API is unmeasured, so this is named rather than checked.'

    console.log(JSON.stringify(standing, null, 2))
  },

  'probe-judge' (responseFile) {
    if (!responseFile) throw new Error('probe-judge needs the saved probe response.')
    console.log(JSON.stringify(hubspot.judgeProbe(readJson(responseFile)), null, 2))
  },

  'validate-rules' (requiredFile, gridFile, personasFile) {
    if (!requiredFile) throw new Error('validate-rules needs at least the required-fields rule.')
    const report = { requiredFields: rules.requiredFieldsProblems(readJson(requiredFile)) }
    if (gridFile) report.grid = rules.gridProblems(readJson(gridFile))
    if (personasFile) report.personas = rules.personasProblems(readJson(personasFile))
    console.log(JSON.stringify(report, null, 2))
    if (Object.values(report).some(problems => problems.length)) process.exit(1)
  }
}

if (require.main === module) {
  const [command, ...args] = process.argv.slice(2)
  if (!command || !commands[command]) {
    console.error(`Unknown command ${command ? `"${command}"` : ''}. One of: ${Object.keys(commands).join(', ')}`)
    process.exit(1)
  }
  try {
    commands[command](...args)
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}

module.exports = { commands, WRITEBACK_BATCH }
