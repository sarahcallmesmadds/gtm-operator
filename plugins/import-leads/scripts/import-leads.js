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
 *   node import-leads.js free-mail <rows.json>
 *   node import-leads.js events <rows.json>
 *   node import-leads.js dedupe-queries <rows.json>
 *   node import-leads.js dedupe <rows.json> <responses.json>
 *   node import-leads.js company-queries <rows.json>
 *   node import-leads.js list-queries <grid.json> <campaigns.json> <assignments.json>   (hubspot)
 *   node import-leads.js list-judge <names.json> <responses.json>                        (hubspot)
 *   node import-leads.js campaign-queries <campaigns.json>                               (salesforce)
 *   node import-leads.js campaign-judge <campaigns.json> <responses.json>                (salesforce)
 *   node import-leads.js status-queries <campaign-decisions.json>                        (salesforce)
 *   node import-leads.js status-judge <campaign-decisions.json> <responses.json>         (salesforce)
 *   node import-leads.js flag-query [userId]                                             (salesforce)
 *   node import-leads.js flag-judge <response.json>                                      (salesforce)
 *   node import-leads.js mailing-fields-probe <orgAlias>                                 (salesforce, first run: no config yet)
 *   node import-leads.js mailing-fields-judge <response.json>                            (salesforce, first run: no config yet)
 *   node import-leads.js lead-contact-queries                                            (salesforce)
 *   node import-leads.js lead-contact-judge <contact-count.json> <lead-count.json>       (salesforce)
 *   node import-leads.js plan <inputs.json>
 *   node import-leads.js push <plan.json>
 *   node import-leads.js judge-push <requests.json> <responses.json>
 *   node import-leads.js readbacks <plan.json> <pushed-ids.json>
 *   node import-leads.js prove <plan.json> <pushed-ids.json> <readbacks.json>
 *   node import-leads.js writeback <plan.json> <pushed-ids.json> [instance-url]
 *   node import-leads.js check-standing
 *   node import-leads.js probe-judge <response.json>
 *   node import-leads.js org-judge <response.json>                                       (salesforce)
 *   node import-leads.js validate-rules <required.json> [grid.json] [personas.json]
 */

const fs = require('fs')
const path = require('path')

const config = require(path.join(__dirname, 'config'))
const ingest = require(path.join(__dirname, 'ingest'))
const rules = require(path.join(__dirname, 'rules'))
const plan = require(path.join(__dirname, 'plan'))
const hubspot = require(path.join(__dirname, 'hubspot'))
const salesforce = require(path.join(__dirname, 'salesforce'))

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

/** The CRM half config names: same surface, one store per install. */
const backendFor = result => (result.crm === 'salesforce' ? salesforce : hubspot)

/** A command that belongs to the other backend refuses with the real route. */
function requireCrm (result, wanted, command, instead) {
  if (result.crm !== wanted) {
    console.error(
      `${command} is the ${wanted} route and this config says ${result.crm}. ` +
      `On ${result.crm}, ${instead}.`
    )
    process.exit(1)
  }
}

/**
 * How a spec becomes a CLI call, said once for every note that emits specs.
 */
const SEND_NOTE = {
  hubspot:
    'Send each request with the Service Key as the bearer header, read from the file config names. Save each response whole.',
  salesforce:
    'Send each spec with the sf CLI: a query spec is `sf data query --target-org <targetOrg> --query <soql> --json`; a ' +
    'rest spec is `sf api request rest <path> --method <method> --body @<file> --target-org <targetOrg>` with the body ' +
    'written to a file first (no --body flag when the spec carries none); a cli spec is `sf <args...> --target-org ' +
    '<targetOrg> --json`. The credential lives in the CLI keychain; nothing key-shaped is read or printed. Save each ' +
    'response whole, exactly as the CLI printed it.'
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
    if (!answersFile) {
      throw new Error(
        'config-draft needs the answers file: the crm (absent means hubspot), then per backend its identifiers ' +
        '(portalId and serviceKeyPath on hubspot; orgAlias and any recordTypeIds on salesforce), aliasMapPath, and any ' +
        'property corrections.'
      )
    }
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
    // A replaced personal address is an identity too: a contact stored
    // under it is otherwise an unseen duplicate, because the store
    // accepts a second record when the emails differ.
    const emails = []
    for (const row of rows) {
      if (row.fields && row.fields.email) emails.push(row.fields.email)
      if (row.replacedEmail) emails.push(row.replacedEmail)
    }
    console.log(JSON.stringify({
      requests: backendFor(result).searchRequests(result.config, emails),
      withoutEmail: rows.filter(row => !(row.fields && row.fields.email)).map(row => row.index),
      note:
        SEND_NOTE[result.crm] + ' Pass the responses, in order, to dedupe. ' +
        'Rows without an email cannot be checked and come back as such. ' +
        'Rows whose personal address was replaced are searched under both addresses, and a match under the replaced one ' +
        'comes back presented for the person.'
    }, null, 2))
  },

  dedupe (rowsFile, responsesFile) {
    if (!rowsFile || !responsesFile) throw new Error('dedupe needs the rows and the saved search responses.')
    const result = configOrExit()
    const existing = backendFor(result).searchResults(result.config, readJson(responsesFile))
    const verdicts = plan.dedupeVerdicts(readJson(rowsFile), existing)
    console.log(JSON.stringify(Object.assign({ searchIncomplete: existing.incomplete }, verdicts), null, 2))
  },

  'company-queries' (rowsFile) {
    if (!rowsFile) throw new Error('company-queries needs the rows, after aliases.')
    const result = configOrExit()
    const rows = readJson(rowsFile)
    const companies = new Map()
    const byCompany = new Map()
    for (const row of rows) {
      const name = row.fields && row.fields.company
      if (!name) continue
      if (!companies.has(name)) {
        companies.set(name, { name, domain: null, domainSource: null, rows: [] })
        byCompany.set(name, [])
      }
      const entry = companies.get(name)
      entry.rows.push(row.index)
      byCompany.get(name).push(row)
      if (!entry.domain && row.fields.companyDomain) {
        entry.domain = row.fields.companyDomain
        entry.domainSource = 'column'
      }
    }
    // A list with no domain column still gets a domain lookup where the
    // rows' own work emails agree on one. Sarah's rule of 2026-08-26, after
    // the live run proved name search misses what a domain search finds.
    for (const entry of companies.values()) {
      if (entry.domain) continue
      const derived = rules.deriveCompanyDomain(byCompany.get(entry.name))
      if (derived) {
        entry.domain = derived.domain
        entry.domainSource = `derived from ${derived.fromEmails} work email${derived.fromEmails === 1 ? '' : 's'}`
      }
    }
    console.log(JSON.stringify({
      companies: [...companies.values()],
      requests: backendFor(result).companySearchRequests(result.config, [...companies.values()]),
      note:
        'Send each and show the candidates with their evidence, including where each search domain came from. The match ' +
        'is the person\'s decision; the alias map holds the answers already settled so they are not re-asked. A domain hit ' +
        'carrying no name, or a name that disagrees, is presented too: it may be the portal\'s own auto-created company, ' +
        'and adopting it or creating beside it is the person\'s call. Rows without a company are handled at the gate, not here.'
    }, null, 2))
  },

  'free-mail' (rowsFile) {
    if (!rowsFile) throw new Error('free-mail needs the ingested rows.')
    const flagged = rules.freeMailRows(readJson(rowsFile))
    console.log(JSON.stringify({
      rows: flagged,
      note: flagged.length
        ? 'Personal addresses, presented for the person\'s call: removed, or enriched to find the work email. Offer ' +
          'whatever enrichment the session actually has connected. A found work email is shown, never silently swapped: ' +
          'the fill-blanks rule protects the source\'s own email, so replacement is the person\'s decision every time.'
        : 'No personal addresses detected. The detector knows the common consumer providers; one it does not know passes through, so this is an absence of flags, not a guarantee.'
    }, null, 2))
  },

  'list-queries' (gridFile, campaignsFile, assignmentsFile) {
    if (!gridFile || !campaignsFile || !assignmentsFile) {
      throw new Error('list-queries needs the grid, the campaigns and the assignments: the lists to look up are the ones the grid realises from them.')
    }
    requireCrm(configOrExit(), 'hubspot', 'list-queries', 'the grid maps onto native member statuses: run campaign-queries, then status-queries')
    const grid = readJson(gridFile)
    const campaigns = readJson(campaignsFile)
    const assignments = readJson(assignmentsFile)
    const wrong = rules.gridProblems(grid).concat(rules.assignmentProblems(grid, campaigns, assignments))
    if (wrong.length) {
      console.error(`The lists cannot be realised from this:\n  ${wrong.join('\n  ')}`)
      process.exit(1)
    }
    const names = [...new Set(assignments.map(a => rules.listName(grid, a.campaign, a.status)))].sort()
    console.log(JSON.stringify({
      names,
      requests: hubspot.listLookupRequests(names),
      note:
        'Send each lookup, save each response whole, and pass the names and the responses, in this same order, to list-judge. ' +
        'Matched or planned for creation means the portal was asked, not assumed.'
    }, null, 2))
  },

  'list-judge' (namesFile, responsesFile) {
    if (!namesFile || !responsesFile) throw new Error('list-judge needs the names and the saved responses, in the same order.')
    requireCrm(configOrExit(), 'hubspot', 'list-judge', 'the grid maps onto native member statuses: run campaign-judge, then status-judge')
    const names = readJson(namesFile)
    const responses = readJson(responsesFile)
    if (!Array.isArray(names) || !Array.isArray(responses) || names.length !== responses.length) {
      throw new Error('The names and responses do not line up one to one. Pass the names array list-queries printed and one saved response per name, in order.')
    }
    const decisions = {}
    const unknown = []
    names.forEach((name, at) => {
      // The name binds the answer to its question where the response
      // carries one, the same rule campaign-judge holds on the other
      // backend, so reversed saved files surface as questions.
      const judged = hubspot.judgeListLookup(responses[at], name)
      decisions[name] = judged
      if (judged.outcome === 'unknown') unknown.push({ name, why: judged.why })
    })
    console.log(JSON.stringify({ listDecisions: decisions, unknown }, null, 2))
    if (unknown.length) {
      console.error('Some lookups came back in shapes this does not recognise. Those are questions, not creates: look at the saved responses before planning.')
      process.exit(1)
    }
  },

  'campaign-queries' (campaignsFile) {
    if (!campaignsFile) throw new Error('campaign-queries needs the campaigns the person decided after the multi-event check.')
    const result = configOrExit()
    requireCrm(result, 'salesforce', 'campaign-queries', 'the grid realises as status lists: run list-queries')
    const campaigns = readJson(campaignsFile)
    console.log(JSON.stringify({
      requests: salesforce.campaignLookupRequests(result.config, campaigns),
      note:
        SEND_NOTE.salesforce + ' Pass the campaigns and the responses, in this same order, to campaign-judge. ' +
        'Matched or planned for creation means the org was asked, not assumed.'
    }, null, 2))
  },

  'campaign-judge' (campaignsFile, responsesFile) {
    if (!campaignsFile || !responsesFile) throw new Error('campaign-judge needs the campaigns and the saved responses, in the same order.')
    requireCrm(configOrExit(), 'salesforce', 'campaign-judge', 'the grid realises as status lists: run list-judge')
    const campaigns = readJson(campaignsFile)
    const responses = readJson(responsesFile)
    if (!Array.isArray(campaigns) || !Array.isArray(responses) || campaigns.length !== responses.length) {
      throw new Error('The campaigns and responses do not line up one to one. Pass the campaigns campaign-queries was given and one saved response per campaign, in order.')
    }
    const decisions = {}
    const unknown = []
    campaigns.forEach((campaign, at) => {
      // The judge binds the answer to its question by the name the row
      // carries, so two saved files passed in the wrong order surface as
      // questions instead of filing each campaign's id under the other.
      const judged = salesforce.judgeCampaignLookup(responses[at], campaign.name)
      decisions[campaign.name] = judged
      if (judged.outcome === 'unknown') unknown.push({ name: campaign.name, why: judged.why })
    })
    console.log(JSON.stringify({ campaignDecisions: decisions, unknown }, null, 2))
    if (unknown.length) {
      console.error('Some lookups came back in shapes this does not recognise, or found more than one campaign with the name. Those are questions, not creates: look at the saved responses before planning.')
      process.exit(1)
    }
  },

  'status-queries' (decisionsFile) {
    if (!decisionsFile) throw new Error('status-queries needs the judged campaign decisions from campaign-judge.')
    const result = configOrExit()
    requireCrm(result, 'salesforce', 'status-queries', 'lists carry no member status: this step does not exist there')
    const decisions = readJson(decisionsFile)
    const source = decisions.campaignDecisions || decisions
    const requests = salesforce.statusReadRequests(result.config, source)
    console.log(JSON.stringify({
      requests,
      note: requests.length
        ? SEND_NOTE.salesforce + ' Pass the same decisions and the responses, in this same order, to status-judge.'
        : 'No campaign was judged as existing, so there are no status rows to read: every campaign is a create, and a fresh campaign carries Sent and Responded (measured 2026-08-25).'
    }, null, 2))
  },

  'status-judge' (decisionsFile, responsesFile) {
    if (!decisionsFile || !responsesFile) throw new Error('status-judge needs the judged campaign decisions and the saved responses, in the same order status-queries emitted them.')
    requireCrm(configOrExit(), 'salesforce', 'status-judge', 'lists carry no member status: this step does not exist there')
    const decisions = readJson(decisionsFile)
    const source = decisions.campaignDecisions || decisions
    const responses = readJson(responsesFile)
    const existing = Object.entries(source).filter(([, d]) => d && d.outcome === 'exists').map(([name]) => name)
    if (!Array.isArray(responses) || existing.length !== responses.length) {
      throw new Error('The responses do not line up one to one with the campaigns judged as existing. Save one response per status read, in the order status-queries emitted them.')
    }
    const campaignStatuses = {}
    const refused = []
    existing.forEach((name, at) => {
      // The judge binds each answer to its campaign by the CampaignId the
      // rows carry, the same rule campaign-judge holds by Name, so two
      // saved files passed in the wrong order surface as questions instead
      // of crediting each campaign with the other's statuses.
      const judged = salesforce.judgeStatusRead(responses[at], source[name].campaignId)
      if (judged.ok) campaignStatuses[name] = { labels: judged.labels, maxSortOrder: judged.maxSortOrder }
      else refused.push({ name, why: judged.why })
    })
    console.log(JSON.stringify({ campaignStatuses, refused }, null, 2))
    if (refused.length) {
      console.error('Some status reads came back in shapes this does not recognise. Those are questions, not creates: look at the saved responses before planning.')
      process.exit(1)
    }
  },

  'flag-query' (userId) {
    const result = configOrExit()
    requireCrm(result, 'salesforce', 'flag-query', 'there is no Marketing User flag: this step does not exist there')
    console.log(JSON.stringify({
      request: salesforce.flagRequest(result.config, userId || null),
      note: userId
        ? SEND_NOTE.salesforce + ' Pass the saved response to flag-judge.'
        : SEND_NOTE.salesforce + ' This first request is the whoami; flag-judge reads the user id out of its response, and flag-query runs again with that id to read the flag itself.'
    }, null, 2))
  },

  'flag-judge' (responseFile) {
    if (!responseFile) throw new Error('flag-judge needs the saved response, from either flag-query step.')
    requireCrm(configOrExit(), 'salesforce', 'flag-judge', 'there is no Marketing User flag: this step does not exist there')
    const judged = salesforce.judgeFlag(readJson(responseFile))
    console.log(JSON.stringify(judged, null, 2))
    if (!judged.ok) process.exit(1)
  },

  // The two first-run commands deliberately require no config: they run
  // while the config draft is being gathered, before the file exists,
  // which is the whole point of asking the org which mailing fields it
  // carries. But a config that already exists and names hubspot is a
  // different situation, refused by name like every other cross-backend
  // command: there is nothing to probe on that backend, and the wrong-org
  // probe was round 2's routing finding.
  'mailing-fields-probe' (orgAlias) {
    const existing = config.read()
    if (existing.ok && existing.crm === 'hubspot') {
      console.error('mailing-fields-probe is the salesforce route and this install\'s config says hubspot. On hubspot the property names are the portal\'s own and there is nothing to probe: correct them in conversation at the draft.')
      process.exit(1)
    }
    if (!orgAlias) {
      throw new Error(
        'mailing-fields-probe needs the org alias the sf CLI holds the credential under. It runs on a salesforce ' +
        'first run, before config exists, so the alias comes from the answers being gathered.'
      )
    }
    console.log(JSON.stringify({
      request: salesforce.mailingFieldsProbeRequest(orgAlias),
      note:
        SEND_NOTE.salesforce + ' Pass the saved response to mailing-fields-judge: it answers which state and country ' +
        'field names the config draft should offer, because a picklist org refuses the plain fields and a plain org ' +
        'does not have the code fields (measured 2026-08-26).'
    }, null, 2))
  },

  'mailing-fields-judge' (responseFile) {
    const existing = config.read()
    if (existing.ok && existing.crm === 'hubspot') {
      console.error('mailing-fields-judge is the salesforce route and this install\'s config says hubspot. On hubspot the property names are the portal\'s own and there is nothing to probe: correct them in conversation at the draft.')
      process.exit(1)
    }
    if (!responseFile) throw new Error('mailing-fields-judge needs the saved probe response.')
    const judged = salesforce.judgeMailingFieldsProbe(readJson(responseFile))
    console.log(JSON.stringify(judged, null, 2))
    if (!judged.ok) process.exit(1)
  },

  'lead-contact-queries' () {
    const result = configOrExit()
    requireCrm(result, 'salesforce', 'lead-contact-queries', 'no HubSpot Lead surface is measured, so the confirmation is asked in conversation, without counts')
    console.log(JSON.stringify({
      requests: salesforce.leadContactCountRequests(result.config),
      note:
        SEND_NOTE.salesforce + ' Pass the two saved responses, contacts first, to lead-contact-judge. The counts are ' +
        'the evidence for the scope confirmation: this import creates Contacts with their companies, and an org that ' +
        'works in Leads deserves to see that named before anything maps into the CRM.'
    }, null, 2))
  },

  'lead-contact-judge' (contactFile, leadFile) {
    if (!contactFile || !leadFile) throw new Error('lead-contact-judge needs the two saved count responses, contacts first, leads second.')
    requireCrm(configOrExit(), 'salesforce', 'lead-contact-judge', 'no HubSpot Lead surface is measured, so the confirmation is asked in conversation, without counts')
    const judged = salesforce.judgeLeadContactCounts(readJson(contactFile), readJson(leadFile))
    console.log(JSON.stringify(judged, null, 2))
    if (!judged.ok) process.exit(1)
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
    console.log(JSON.stringify(backendFor(result).pushRequests(result.config, readJson(planFile)), null, 2))
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
    const result = configOrExit()
    console.log(JSON.stringify(requests.map((request, at) => ({
      label: request.label,
      judged: backendFor(result).judgeResponse(request, responses[at])
    })), null, 2))
  },

  readbacks (planFile, pushedIdsFile) {
    if (!planFile || !pushedIdsFile) {
      throw new Error(
        'readbacks needs the plan and the pushed ids ({contacts: {"<row>": id}, companies or accounts: {"<name>": id}, ' +
        'lists or campaigns: {"<name>": id}}).'
      )
    }
    const result = configOrExit()
    console.log(JSON.stringify({
      requests: backendFor(result).readbackRequests(result.config, readJson(planFile), readJson(pushedIdsFile)),
      note: 'Fetch every one. An id is a locator, not a proof: prove compares what comes back against the plan, field by field.'
    }, null, 2))
  },

  prove (planFile, pushedIdsFile, readbacksFile) {
    if (!planFile || !pushedIdsFile || !readbacksFile) throw new Error('prove needs the plan, the pushed ids and the saved read-backs.')
    const result = configOrExit()
    const proof = backendFor(result).prove(result.config, readJson(planFile), readJson(pushedIdsFile), readJson(readbacksFile))
    console.log(JSON.stringify(proof, null, 2))
    if (proof.problems.length) {
      console.error('This push did not fully land. Say exactly which writes are proved and which are not, and never report success with a problem on this list.')
      process.exit(1)
    }
  },

  writeback (planFile, pushedIdsFile, instanceUrl) {
    if (!planFile || !pushedIdsFile) throw new Error('writeback needs the plan and the pushed ids.')
    const result = configOrExit()
    const approved = readJson(planFile)
    const pushedIds = readJson(pushedIdsFile)
    if (!approved.writeback || approved.writeback.kind !== 'notion') {
      console.log(JSON.stringify({ entries: [], note: 'The source is not Notion, so there is no writeback. A CSV source is never modified.' }, null, 2))
      return
    }
    if (result.crm === 'salesforce' && !instanceUrl) {
      throw new Error(
        'A Salesforce writeback needs the instance url as the third argument, taken from the org display answer, ' +
        'because config holds no url to build a record link from. Nothing is guessed.'
      )
    }
    const recordUrlFor = id => {
      if (result.crm === 'salesforce') {
        return `${String(instanceUrl).replace(/\/+$/, '')}/lightning/r/Contact/${id}/view`
      }
      return `https://app.hubspot.com/contacts/${result.config.portalId}/record/0-1/${id}`
    }
    const entries = approved.contacts.creates
      .filter(create => create.row.notionPageId)
      .map(create => ({
        pageId: create.row.notionPageId,
        recordUrl: (pushedIds.contacts || {})[create.index]
          ? recordUrlFor(pushedIds.contacts[create.index])
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
        'The record URL shape is rebuilt (from the portal id on HubSpot, from the instance url on Salesforce) and has not been measured: confirm the first one opens before writing the rest.'
      ]
    }, null, 2))
  },

  'check-standing' () {
    const result = config.read()
    if (!result.ok) {
      console.log(JSON.stringify({ config: { ok: false, message: result.message } }, null, 2))
      process.exit(result.missing ? 2 : 1)
    }

    const standing = { config: { ok: true, path: result.path, crm: result.crm } }

    if (result.crm === 'salesforce') {
      standing.config.orgAlias = result.config.orgAlias
      // Nothing key-shaped exists on this backend: the credential lives in
      // the CLI keychain under the alias, and resolving the alias is the
      // check.
      standing.orgDisplay = {
        request: salesforce.orgDisplayRequest(result.config),
        note: 'Send this read-only spec and pass the saved response to org-judge. Nothing about the alias is claimed until it answers Connected.'
      }
      standing.marketingUserFlag = {
        note:
          'Campaign creation is refused while the user record\'s Marketing User flag is off (measured 2026-08-25). Read ' +
          'it with flag-query and flag-judge and call it out when it is off; naming it is the whole of check\'s job here, ' +
          'and the measured one-call fix travels in run\'s plan as its own named line.'
      }
    } else {
      standing.config.portalId = result.config.portalId
      // Existence and size only. The key's contents are never read into any
      // output, here or anywhere.
      if (!fs.existsSync(result.serviceKeyPath)) {
        standing.serviceKey = { ok: false, why: `Config names the key at ${result.serviceKeyPath} and there is no file there.` }
      } else if (!fs.statSync(result.serviceKeyPath).size) {
        standing.serviceKey = { ok: false, why: `The key file at ${result.serviceKeyPath} is empty.` }
      } else {
        standing.serviceKey = { ok: true, path: result.serviceKeyPath }
      }
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
      request: backendFor(result).probeRequest(result.config),
      note: result.crm === 'salesforce'
        ? 'Send this read-only spec with the sf CLI and pass the saved response to probe-judge. Nothing about the connection is claimed until it answers.'
        : 'Send this read-only request with the bearer and pass the saved response to probe-judge. Nothing about the connection is claimed until it answers.'
    }
    standing.artifacts = {
      note:
        'The required-fields rule and the member-status grid live in Process, which this script cannot reach: read them ' +
        'through the connected client and validate what was read with validate-rules. The report has to keep two answers ' +
        'apart: when the Process library itself cannot be reached (the foundation is not installed, or nothing is connected), ' +
        'the artifacts are UNREACHABLE, and the rest of this standing report still stands on its own; when the library is ' +
        'reachable and an artifact is not in it, that artifact is MISSING, named, with `process:new` as the place it gets ' +
        'written. The personas and routing artifacts are optional either way.'
    }
    standing.autoCompanyCreation = result.crm === 'salesforce'
      ? 'No account auto-creation was observed on Salesforce and none is designed for; whether an org\'s own automation ' +
        'creates accounts is unmeasured rather than known absent, so it is named here rather than checked or dismissed.'
      : 'Standing risk: the portal may auto-create a company from an email domain and take the primary association (measured ' +
        '2026-08-25). The setting is not exposed by the documented API surface (measured 2026-08-26), so this is named rather than checked, permanently.'

    console.log(JSON.stringify(standing, null, 2))
  },

  'probe-judge' (responseFile) {
    if (!responseFile) throw new Error('probe-judge needs the saved probe response.')
    const result = configOrExit()
    console.log(JSON.stringify(backendFor(result).judgeProbe(readJson(responseFile)), null, 2))
  },

  'org-judge' (responseFile) {
    if (!responseFile) throw new Error('org-judge needs the saved org display response.')
    requireCrm(configOrExit(), 'salesforce', 'org-judge', 'the connection check is the probe and the key file')
    const judged = salesforce.judgeOrgDisplay(readJson(responseFile))
    console.log(JSON.stringify(judged, null, 2))
    if (!judged.ok) process.exit(1)
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
