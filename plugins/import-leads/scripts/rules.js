'use strict'

/**
 * The organisation's rules, validated and applied.
 *
 * The rules themselves live outside this plugin. The required-fields rule,
 * the campaign member-status grid and the optional personas artifact are
 * Process artifacts the skill reads at run time; the company alias map is a
 * user-owned file at the path config names. What lives here is the machine
 * half: the declared shape each one is handed over in, refused by name when
 * it does not hold, and the application of each rule to rows.
 *
 * A MISSING REQUIRED ARTIFACT IS NAMED, NOT WORKED AROUND. Nothing in this
 * file invents a default grid or a default required-fields rule, because a
 * rule this plugin invents is exactly the thing the design says lives in
 * Process. The skill says which artifact is missing and that `process:new`
 * is where it gets written.
 */

const ingest = require('./ingest')

// ------------------------------------------------------------ the alias map

/**
 * The alias map's shape, settled here in the build (it was Open in the
 * design): one JSON object under `aliases`, variant to canonical.
 *
 *   { "aliases": { "IBM Corp": "IBM", "I.B.M.": "IBM" } }
 *
 * A variant matches case-insensitively with runs of whitespace collapsed,
 * because those are the differences lists actually carry. Nothing looser:
 * stripping legal suffixes or punctuation is a judgment about whether two
 * names are one company, and that judgment is presented to the person, whose
 * settled answers then live in this map so they are not re-asked.
 */
const foldCompany = name => String(name).trim().replace(/\s+/g, ' ').toLowerCase()

function aliasMapProblems (map) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) {
    return ['The alias map is not an object. The shape is {"aliases": {"variant": "canonical"}}.']
  }
  if (!map.aliases || typeof map.aliases !== 'object' || Array.isArray(map.aliases)) {
    return ['The alias map has no "aliases" object. The shape is {"aliases": {"variant": "canonical"}}.']
  }
  const out = []
  const folded = new Map()
  for (const [variant, canonical] of Object.entries(map.aliases)) {
    if (typeof canonical !== 'string' || !canonical.trim()) {
      out.push(`The alias "${variant}" maps to ${JSON.stringify(canonical)}, and a canonical name has to be a non-empty string.`)
      continue
    }
    const key = foldCompany(variant)
    if (folded.has(key) && folded.get(key) !== canonical.trim()) {
      out.push(
        `"${variant}" is the same variant as an earlier alias once case and spacing are folded, and the two map to ` +
        `different canonical names ("${folded.get(key)}" and "${canonical.trim()}"). One variant, one answer.`
      )
    }
    folded.set(key, canonical.trim())
  }
  return out
}

/**
 * Company names normalised through the map. Returns the rows with `company`
 * replaced where an alias fired, each firing recorded on the row under
 * `aliasApplied`, and a summary of what fired, so the step's output can show
 * its work instead of silently renaming companies.
 */
function applyAliases (rows, map) {
  const wrong = aliasMapProblems(map)
  if (wrong.length) {
    throw new Error(`The alias map cannot be used as it is:\n  ${wrong.join('\n  ')}`)
  }
  const lookup = new Map(Object.entries(map.aliases).map(([variant, canonical]) => [foldCompany(variant), canonical.trim()]))

  const applied = []
  const out = rows.map(row => {
    const company = row.fields && row.fields.company
    if (!company) return row
    const canonical = lookup.get(foldCompany(company))
    if (canonical === undefined || canonical === company) return row
    applied.push({ index: row.index, from: company, to: canonical })
    return Object.assign({}, row, {
      fields: Object.assign({}, row.fields, { company: canonical }),
      aliasApplied: { from: company, to: canonical }
    })
  })
  return { rows: out, applied }
}

// ------------------------------------------- free-mail and derived domains

/**
 * The consumer mail providers this plugin treats as personal addresses.
 * Sarah's rule, 2026-08-26: a personal address is cleaned and removed, or
 * enriched to find the work email. THE DETECTOR ONLY PRESENTS. Removal and
 * replacement are the person's calls, made in conversation, and a found
 * work email is shown rather than written, because the fill-blanks rule
 * protects the source's own email either way. A provider missing from this
 * list is simply not flagged, and the row still passes through every other
 * step, so the cost of an omission is a missed prompt, never a wrong write.
 */
const FREE_MAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'ymail.com',
  'hotmail.com', 'hotmail.co.uk', 'outlook.com', 'live.com', 'msn.com',
  'aol.com', 'icloud.com', 'me.com', 'mac.com', 'proton.me',
  'protonmail.com', 'pm.me', 'gmx.com', 'gmx.net', 'mail.com',
  'yandex.com', 'zoho.com', 'comcast.net', 'verizon.net', 'att.net',
  'sbcglobal.net', 'cox.net'
])

/** The domain of an email, folded, or null when there is no @ to split on. */
function emailDomain (email) {
  const folded = String(email === null || email === undefined ? '' : email).trim().toLowerCase()
  const at = folded.lastIndexOf('@')
  if (at === -1 || at === folded.length - 1) return null
  return folded.slice(at + 1)
}

/**
 * The rows whose email is a personal address, for the person's call. Rows
 * with no email are a different question (the dedupe check surfaces those)
 * and are not repeated here.
 */
function freeMailRows (rows) {
  const out = []
  for (const row of rows) {
    const email = row.fields && row.fields.email
    if (!email) continue
    const domain = emailDomain(email)
    if (domain && FREE_MAIL_DOMAINS.has(domain)) {
      out.push({ index: row.index, email, domain })
    }
  }
  return out
}

/**
 * The search domain for one company, derived from its rows' work emails
 * when the list carries no domain column. Sarah's rule, 2026-08-26, after
 * the live run proved name search misses what a domain search finds: the
 * portal's own auto-created company had no name at all and only its domain.
 *
 * Exactly one distinct non-personal domain across the rows is an answer,
 * returned with the row count behind it so the step can show its work. Zero
 * or several is null, because choosing between them is a judgment about
 * which rows are right, and that stays with the person.
 */
function deriveCompanyDomain (rows) {
  const counts = new Map()
  for (const row of rows) {
    const domain = emailDomain(row.fields && row.fields.email)
    if (!domain || FREE_MAIL_DOMAINS.has(domain)) continue
    counts.set(domain, (counts.get(domain) || 0) + 1)
  }
  if (counts.size !== 1) return null
  const [domain, fromEmails] = [...counts.entries()][0]
  return { domain, fromEmails }
}

// -------------------------------------------------- the required-fields rule

/**
 * The required-fields artifact, handed over as:
 *
 *   { "required": ["title", "country"], "leadSourceValue": "Content" }
 *
 * `required` adds to the plugin's own floor and cannot subtract from it; the
 * entries are this plugin's canonical field names, and an entry naming a
 * field the plugin cannot fill is refused rather than skipped, because a rule
 * that silently cannot be enforced reads as enforced. `leadSourceValue` is
 * the value the org uses for the lead source; whether it can be written at
 * all depends on config mapping a lead-source property, and the two are
 * checked against each other in `gates`, not here, because only the caller
 * has both.
 */
function requiredFieldsProblems (rules) {
  if (!rules || typeof rules !== 'object' || Array.isArray(rules)) {
    return ['The required-fields rule is not an object. The shape is {"required": [...], "leadSourceValue": "..."}.']
  }
  const out = []
  if (!Array.isArray(rules.required)) {
    out.push('The rule has no "required" array. An org with no additions records an empty one, which is different from not saying.')
  } else {
    for (const field of rules.required) {
      if (!ingest.FIELDS.includes(field)) {
        out.push(
          `"${field}" is required by the artifact and is not a field this plugin can fill from a list. ` +
          `Known: ${ingest.FIELDS.join(', ')}. If the org needs it, that is a conversation, not a silent skip.`
        )
      }
    }
  }
  if (rules.leadSourceValue !== undefined &&
      (typeof rules.leadSourceValue !== 'string' || !rules.leadSourceValue.trim())) {
    out.push('leadSourceValue is present but empty. Leave it out entirely if the org has no lead-source value, or fill it.')
  }
  return out
}

// ------------------------------------------------------------------ the grid

/**
 * The campaign member-status grid, handed over as:
 *
 *   {
 *     "naming": "{campaign} - {status}",
 *     "types": { "Event": ["Invited", "Attended"], "Content": ["Downloaded"] }
 *   }
 *
 * `naming` is the grid artifact's own convention for list names and has to
 * use both placeholders: a template missing either one names the same list
 * for two different things, and two campaigns' members silently merge.
 * `types` says which statuses exist per campaign type. On HubSpot the grid
 * becomes one list per status per campaign (a list carries no member status
 * of its own, measured 2026-08-25); the Salesforce port reads the same grid
 * onto native member statuses, which is why the grid lives in Process and
 * not in this code.
 */
function gridProblems (grid) {
  if (!grid || typeof grid !== 'object' || Array.isArray(grid)) {
    return ['The grid is not an object. The shape is {"naming": "...", "types": {"<campaign type>": ["<status>"]}}.']
  }
  const out = []
  if (typeof grid.naming !== 'string' || !grid.naming.includes('{campaign}') || !grid.naming.includes('{status}')) {
    out.push('naming has to be a template using both {campaign} and {status}. Without both, two different lists get one name and their members merge.')
  }
  if (!grid.types || typeof grid.types !== 'object' || Array.isArray(grid.types) || !Object.keys(grid.types).length) {
    out.push('types has to map at least one campaign type to its statuses.')
  } else {
    for (const [type, statuses] of Object.entries(grid.types)) {
      if (!Array.isArray(statuses) || !statuses.length || statuses.some(s => typeof s !== 'string' || !s.trim())) {
        out.push(`types.${type} has to be a non-empty array of status names.`)
      } else if (new Set(statuses.map(s => s.trim())).size !== statuses.length) {
        out.push(`types.${type} names the same status twice.`)
      }
    }
  }
  return out
}

/** The list name the grid's convention gives one campaign and status. */
function listName (grid, campaign, status) {
  return grid.naming.split('{campaign}').join(campaign).split('{status}').join(status)
}

/**
 * Campaigns and per-row status assignments, checked against the grid.
 *
 * The assignments are made in conversation, following the grid; what is
 * checked here is that every assignment is one the grid covers. A row whose
 * campaign or status the grid does not cover is a question for the person,
 * and it comes back named rather than defaulted, because the design's rule
 * is that an uncovered row is a question, not a default.
 */
function assignmentProblems (grid, campaigns, assignments) {
  const out = []
  if (!Array.isArray(campaigns) || !campaigns.length) {
    return ['There are no campaigns. The multi-event check decides one campaign or several, and that has to happen first.']
  }
  const byName = new Map()
  for (const campaign of campaigns) {
    if (!campaign || typeof campaign.name !== 'string' || !campaign.name.trim() ||
        typeof campaign.type !== 'string' || !campaign.type.trim()) {
      out.push(`A campaign is missing its name or type: ${JSON.stringify(campaign)}.`)
      continue
    }
    if (byName.has(campaign.name)) out.push(`Two campaigns are both named "${campaign.name}".`)
    byName.set(campaign.name, campaign)
    if (!grid.types[campaign.type]) {
      out.push(
        `Campaign "${campaign.name}" has type "${campaign.type}", which the grid does not cover. ` +
        `The grid covers: ${Object.keys(grid.types).join(', ')}. An uncovered type is a question for the grid's owner, not a default.`
      )
    }
  }
  for (const assignment of assignments || []) {
    const campaign = byName.get(assignment.campaign)
    if (!campaign) {
      out.push(`Row ${assignment.index} is assigned to campaign "${assignment.campaign}", which is not one of the campaigns.`)
      continue
    }
    const statuses = grid.types[campaign.type] || []
    if (!statuses.includes(assignment.status)) {
      out.push(
        `Row ${assignment.index} is assigned status "${assignment.status}" on "${assignment.campaign}" (type ${campaign.type}), ` +
        `and the grid gives that type: ${statuses.join(', ') || 'nothing'}. An uncovered status is a question, not a default.`
      )
    }
  }
  return out
}

// ------------------------------------------------------------------ personas

/**
 * The optional personas artifact, handed over as:
 *
 *   { "personas": ["..."], "rules": [{"persona": "...", "titleContains": ["..."]}] }
 *
 * When it exists the persona step runs; when it does not, the step is skipped
 * without complaint, and neither case is decided here. Matching is by
 * case-insensitive substring on the title, which is the artifact's own
 * mapping made mechanical. A title matching no rule, or rules for more than
 * one persona, is flagged for review rather than guessed, the reference's
 * own refinement.
 */
function personasProblems (artifact) {
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
    return ['The personas artifact is not an object. The shape is {"personas": [...], "rules": [{"persona": "...", "titleContains": [...]}]}.']
  }
  const out = []
  if (!Array.isArray(artifact.personas) || !artifact.personas.length ||
      artifact.personas.some(p => typeof p !== 'string' || !p.trim())) {
    out.push('personas has to be a non-empty array of persona names.')
  }
  if (!Array.isArray(artifact.rules)) {
    out.push('rules has to be an array, even an empty one: no rules means every title is flagged for review, which is honest.')
  } else {
    for (const rule of artifact.rules) {
      if (!rule || typeof rule.persona !== 'string' ||
          !Array.isArray(rule.titleContains) || !rule.titleContains.length ||
          rule.titleContains.some(t => typeof t !== 'string' || !t.trim())) {
        out.push(`A rule is not {"persona": "...", "titleContains": ["..."]}: ${JSON.stringify(rule)}.`)
        continue
      }
      if (Array.isArray(artifact.personas) && !artifact.personas.includes(rule.persona)) {
        out.push(`A rule maps titles to "${rule.persona}", which is not in the personas list.`)
      }
    }
  }
  return out
}

/**
 * Personas matched per row. A clear single match fills the field with its
 * source named. Everything else lands in `flagged` with why, for the person:
 * no title, no matching rule, or rules pointing at two personas.
 */
function applyPersonas (rows, artifact) {
  const wrong = personasProblems(artifact)
  if (wrong.length) {
    throw new Error(`The personas artifact cannot be used as it is:\n  ${wrong.join('\n  ')}`)
  }

  const flagged = []
  const out = rows.map(row => {
    const title = (row.fields && row.fields.title) || ''
    if (!title) {
      flagged.push({ index: row.index, why: 'The row has no title, so no rule can match it. The persona is a question for the person.' })
      return row
    }
    const folded = title.toLowerCase()
    const matched = [...new Set(
      artifact.rules
        .filter(rule => rule.titleContains.some(needle => folded.includes(needle.toLowerCase())))
        .map(rule => rule.persona)
    )]
    if (matched.length === 1) {
      return Object.assign({}, row, {
        persona: matched[0],
        personaSource: 'personas-artifact'
      })
    }
    flagged.push({
      index: row.index,
      title,
      why: matched.length === 0
        ? 'No rule in the personas artifact matches this title. Flagged for review rather than guessed.'
        : `Rules match more than one persona (${matched.join(', ')}). Flagged for review rather than picked between.`
    })
    return row
  })
  return { rows: out, flagged }
}

module.exports = {
  foldCompany,
  FREE_MAIL_DOMAINS,
  emailDomain,
  freeMailRows,
  deriveCompanyDomain,
  aliasMapProblems,
  applyAliases,
  requiredFieldsProblems,
  gridProblems,
  listName,
  assignmentProblems,
  personasProblems,
  applyPersonas
}
