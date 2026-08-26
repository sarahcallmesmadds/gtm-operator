'use strict'

/**
 * The private config of the import-leads plugin.
 *
 * `~/.claude/import-leads.config.json`, this plugin's own file. It is not the
 * foundation's config: `setup` writes that one and this plugin never reads it.
 * This file holds identifiers only. The `crm` names the backend, and an
 * absent `crm` reads as hubspot, because every config written before the
 * field existed was written for HubSpot and nothing rewrites this file. On
 * HubSpot: the portal, the property-name map, where the Service Key lives
 * (never the key itself). On Salesforce: the org alias the `sf` CLI holds
 * the credential under (nothing key-shaped exists on that backend), the
 * field-name map in the org's own API names, and any record-type ids the
 * org routes creates through. Both name the path to the company alias map.
 * Everything that is judgment lives in Process artifacts instead,
 * and everything that is neither is asked about at the moment it matters.
 *
 * WHO WRITES IT. This plugin, once, with confirmation, on a first run with no
 * config. Nothing else writes it and this plugin does not write it twice: a
 * second write is refused by name, because silently replacing a file that
 * `run` and `check` both read is how two sessions end up importing into two
 * different portals. Changing it later is a deliberate edit by hand.
 *
 * NO CREDENTIAL EVER ENTERS THIS FILE. `serviceKeyPath` names where the key
 * lives. The key's contents are never read by anything in this module, and
 * `check` proves the file exists without printing a byte of it.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')

/**
 * Bumped when the shape below changes in a way that would make an older
 * reader wrong. The same rule as the foundation's `configVersion`: refuse a
 * file that cannot be read rather than quietly misreading one.
 */
const CONFIG_VERSION = 1

const CONFIG_PATH = process.env.IMPORT_LEADS_CONFIG ||
  path.join(os.homedir(), '.claude', 'import-leads.config.json')

/** The backends this plugin can write. One per install, named by `crm`. */
const CRMS = ['hubspot', 'salesforce']

/**
 * The backend a config names. Absent means hubspot: every config written
 * before the field existed was written for HubSpot, nothing rewrites the
 * file, and refusing them all with a version bump would break working
 * installs to record a default they already live by.
 */
const crmOf = config => (config && config.crm !== undefined ? config.crm : 'hubspot')

/**
 * The contact properties this plugin can fill, and whether the map may leave
 * them out.
 *
 * The required ones are the write contract's own floor and from-the-list
 * fields: a map that cannot say where `email` goes cannot import a list. The
 * optional ones are the org's custom properties (a LinkedIn URL property, a
 * persona property, the lead-source property), which an org maps only when it
 * has them. An optional entry that is absent means the field is not written,
 * which the write contract already allows.
 */
const CONTACT_PROPERTIES = {
  required: ['firstName', 'lastName', 'email', 'phone', 'title', 'city', 'state', 'country'],
  optional: ['linkedinUrl', 'persona', 'leadSource', 'owner']
}

const COMPANY_PROPERTIES = {
  // The write contract makes the website conditional (the decision's
  // explicit website wins, the list's domain is the automatic fallback), so
  // the mapping is optional too: an org without a website property still
  // imports, its companies created bare, and only an explicitly decided
  // website with nowhere to land is refused.
  required: ['name'],
  optional: ['website']
}

/**
 * The HubSpot default property names, offered as the draft's starting point.
 *
 * These are the portal defaults the measurement session wrote through
 * (`email`, `firstname`, `lastname`, `jobtitle` proved by read-backs on
 * 2026-08-25; the rest are the platform's standard names and are proved for a
 * given portal by that portal's own live run). A renamed or custom portal
 * corrects them in conversation before the file is written.
 */
const DEFAULT_PROPERTY_NAMES = {
  contact: {
    firstName: 'firstname',
    lastName: 'lastname',
    email: 'email',
    phone: 'phone',
    title: 'jobtitle',
    city: 'city',
    state: 'state',
    country: 'country'
  },
  company: {
    name: 'name',
    website: 'website'
  }
}

/**
 * The Salesforce standard field API names, offered as the draft's starting
 * point on that backend. The create shape (FirstName, LastName, Email,
 * Title, AccountId) is measured 2026-08-25. The state and country names
 * are deliberately absent: a picklist org refuses the plain fields'
 * values and a plain org lacks the code fields (measured 2026-08-26), so
 * neither default is right for every org, and the draft requires the
 * judged pair from the mailing-fields probe instead of defaulting either
 * way. Optional fields (a LinkedIn URL custom field, a persona custom
 * field, the lead source, the owner) have no default: an org maps them
 * deliberately or not at all.
 */
const DEFAULT_SALESFORCE_FIELD_NAMES = {
  contact: {
    firstName: 'FirstName',
    lastName: 'LastName',
    email: 'Email',
    phone: 'Phone',
    title: 'Title',
    city: 'MailingCity'
  },
  company: {
    name: 'Name',
    website: 'Website'
  }
}

/** `~` expanded, so a path in the file reads the way a person writes one. */
function resolvePath (p) {
  if (typeof p !== 'string' || !p.trim()) return null
  const trimmed = p.trim()
  if (trimmed === '~') return os.homedir()
  if (trimmed.startsWith('~/')) return path.join(os.homedir(), trimmed.slice(2))
  return trimmed
}

/**
 * Everything wrong with a config object, as a list of messages.
 *
 * A list rather than the first thing, the same shape the marketplace's other
 * validators use: a person fixing a config file should not have to run the
 * command once per problem.
 */
function problems (config) {
  const out = []
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return ['The config is not an object. The file holds one JSON object and nothing else.']
  }

  if (config.configVersion !== CONFIG_VERSION) {
    out.push(
      `configVersion is ${JSON.stringify(config.configVersion)} and this plugin reads version ${CONFIG_VERSION}. ` +
      'Refusing to guess at a shape it does not know.'
    )
  }

  const crm = crmOf(config)
  if (!CRMS.includes(crm)) {
    out.push(`crm is ${JSON.stringify(config.crm)} and this plugin writes one of: ${CRMS.join(', ')}. An absent crm reads as hubspot.`)
    return out
  }

  if (crm === 'hubspot') {
    if (typeof config.portalId !== 'string' || !/^\d+$/.test(config.portalId)) {
      out.push('portalId has to be the portal id as a string of digits, the number HubSpot shows in the account menu.')
    }
    if (!resolvePath(config.serviceKeyPath)) {
      out.push('serviceKeyPath is missing or empty. It names where the Service Key lives. The key itself never enters this file.')
    }
    // A cross-backend identifier on a config is the tell of a mis-set crm,
    // and refusing it here catches that before a run reads the wrong half.
    if (config.orgAlias !== undefined) {
      out.push('orgAlias is Salesforce\'s identifier and this config says hubspot. One backend per install: fix crm, or take the alias out.')
    }
  } else {
    if (typeof config.orgAlias !== 'string' || !config.orgAlias.trim()) {
      out.push('orgAlias is missing or empty. It names the org alias the `sf` CLI holds the credential under; the credential itself lives in the CLI keychain and never enters this file.')
    }
    if (config.portalId !== undefined) {
      out.push('portalId is HubSpot\'s identifier and this config says salesforce. One backend per install: fix crm, or take the portal out.')
    }
    if (config.serviceKeyPath !== undefined) {
      out.push('serviceKeyPath is HubSpot\'s. A Salesforce config carries nothing key-shaped, because the CLI keychain holds the credential.')
    }
    if (config.recordTypeIds !== undefined) {
      if (!config.recordTypeIds || typeof config.recordTypeIds !== 'object' || Array.isArray(config.recordTypeIds)) {
        out.push('recordTypeIds has to be an object mapping contact and account to record-type ids, or be left out.')
      } else {
        for (const [kind, id] of Object.entries(config.recordTypeIds)) {
          if (kind !== 'contact' && kind !== 'account') {
            out.push(`recordTypeIds.${kind} is not a record this plugin creates. Known: contact, account.`)
          } else if (typeof id !== 'string' || !id.trim()) {
            out.push(`recordTypeIds.${kind} has to be the record-type id as a non-empty string, or the key left out.`)
          }
        }
      }
    }
  }

  if (!resolvePath(config.aliasMapPath)) {
    out.push('aliasMapPath is missing or empty. It names the user-owned company alias map file.')
  }

  for (const [kind, spec] of [['contact', CONTACT_PROPERTIES], ['company', COMPANY_PROPERTIES]]) {
    const map = config.properties && config.properties[kind]
    if (!map || typeof map !== 'object' || Array.isArray(map)) {
      out.push(`properties.${kind} is missing. It maps this plugin's field names to the portal's property names.`)
      continue
    }
    for (const field of spec.required) {
      if (typeof map[field] !== 'string' || !map[field].trim()) {
        out.push(`properties.${kind}.${field} is missing or empty, and the write contract fills it, so the map has to say where it goes.`)
      }
    }
    for (const field of Object.keys(map)) {
      if (!spec.required.includes(field) && !spec.optional.includes(field)) {
        out.push(
          `properties.${kind}.${field} is not a field this plugin writes. ` +
          `Known: ${spec.required.concat(spec.optional).join(', ')}. ` +
          'A field the write contract does not carry is not made writable by mapping it.'
        )
      } else if (spec.optional.includes(field) && (typeof map[field] !== 'string' || !map[field].trim())) {
        // The required fields are type-checked above; an optional one is a
        // real property name or the key is left out, because a coerced
        // mapping becomes a request targeting an invented CRM field.
        out.push(`properties.${kind}.${field} has to be the property name as a non-empty string, or the key left out.`)
      }
    }
    // On Salesforce the mapped names are interpolated into SOQL as
    // identifiers, and soqlLiteral escapes values, not identifiers, so a
    // name that is not field-API-shaped could alter the query itself. The
    // gate refuses it here, where every mapped name already passes:
    // letters, digits and underscores, starting with a letter, which
    // covers every standard field and every __c custom field.
    if (crm === 'salesforce' && map) {
      for (const [field, name] of Object.entries(map)) {
        if (typeof name !== 'string' || !name.trim()) continue
        if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name.trim())) {
          out.push(
            `properties.${kind}.${field} maps ${JSON.stringify(name)}, which is not a Salesforce field API name ` +
            '(letters, digits and underscores, starting with a letter). A name outside that shape cannot go into a query as an identifier.'
          )
        }
      }
    }
    if (map) {
      const seen = new Map()
      for (const [field, name] of Object.entries(map)) {
        if (typeof name !== 'string' || !name.trim()) continue
        const key = name.trim().toLowerCase()
        if (seen.has(key)) {
          out.push(
            `properties.${kind}: "${name}" is mapped from both ${seen.get(key)} and ${field}. ` +
            'Two fields writing one property means the second silently overwrites the first.'
          )
        } else {
          seen.set(key, field)
        }
      }
    }
  }

  return out
}

/**
 * The config, read and validated, or a refusal that names the remedy.
 *
 * `ok: false` with `missing: true` is the first-run case: both skills stop
 * there, gather the answers, and offer to write the file. Any other refusal is
 * a file that exists and cannot be trusted, which is fixed by hand rather than
 * by anything here rewriting it, because it may be another session's working
 * config.
 */
function read () {
  if (!fs.existsSync(CONFIG_PATH)) {
    return {
      ok: false,
      missing: true,
      path: CONFIG_PATH,
      message:
        `There is no config at ${CONFIG_PATH}. This is a first run: gather what the backend needs (the crm; on HubSpot ` +
        'the portal id, the property names and where the Service Key lives; on Salesforce the org alias, the judged ' +
        'mailingFields pair from mailing-fields-probe, the field names and any record-type ids; and the alias-map path ' +
        'either way), show what will be recorded, and write the file on ' +
        'an explicit yes. Search for what can be found rather than asking anyone to type what could be looked up.'
    }
  }

  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  } catch (error) {
    return {
      ok: false,
      missing: false,
      path: CONFIG_PATH,
      message: `${CONFIG_PATH} is not valid JSON (${error.message}). Nothing here rewrites it: fix it or move it aside.`
    }
  }

  const wrong = problems(parsed)
  if (wrong.length) {
    return {
      ok: false,
      missing: false,
      path: CONFIG_PATH,
      message: `${CONFIG_PATH} cannot be used as it is:\n  ${wrong.join('\n  ')}\nNothing here rewrites it: fix it or move it aside.`
    }
  }

  return {
    ok: true,
    path: CONFIG_PATH,
    config: parsed,
    crm: crmOf(parsed),
    // Null on Salesforce, where nothing key-shaped exists to name.
    serviceKeyPath: resolvePath(parsed.serviceKeyPath),
    aliasMapPath: resolvePath(parsed.aliasMapPath)
  }
}

/**
 * The draft: what a first-run write would record, validated but not written.
 *
 * The skill shows this in full and asks. Property names the answers leave out
 * fall back to the portal defaults above, so the person confirms a complete
 * file rather than a diff against defaults they have not seen.
 */
function draft (answers) {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    throw new Error(
      'draft needs an object of answers: the crm (absent means hubspot), then per backend its identifiers ' +
      '(portalId and serviceKeyPath, or orgAlias with the judged mailingFields pair and any recordTypeIds), ' +
      'aliasMapPath, and any name corrections.'
    )
  }
  const crm = answers.crm === undefined ? 'hubspot' : answers.crm
  if (!CRMS.includes(crm)) {
    throw new Error(`These answers do not make a working config:\n  crm is ${JSON.stringify(crm)} and this plugin writes one of: ${CRMS.join(', ')}.`)
  }
  // A salesforce draft is not assembled without the judged mailing pair:
  // the probe is the only measured way to know which state and country
  // fields this org carries, and a draft that defaults either way is the
  // exact config the probe exists to prevent (round 3, 2026-08-26).
  const mailing = answers.mailingFields
  if (crm === 'salesforce') {
    const named = f => mailing && typeof mailing[f] === 'string' && mailing[f].trim()
    if (!named('state') || !named('country')) {
      throw new Error(
        'These answers do not make a working config:\n  mailingFields is missing or incomplete. Run ' +
        'mailing-fields-probe and mailing-fields-judge against the org and pass the judged {state, country} pair, ' +
        'because a picklist org refuses the plain fields and a plain org lacks the code fields (measured 2026-08-26). ' +
        'Neither default is right for every org, so nothing here defaults it.'
      )
    }
  }
  // The judged pair is the one home for the state and country names: a
  // properties override for either would route around the probe the draft
  // just required, so it is refused by name. A custom-field org corrects
  // mailingFields itself, which keeps the correction an explicit, named
  // decision (round 4, 2026-08-26).
  // A properties correction that is not a map cannot be read as one, and
  // it is refused by the validator's own name for it rather than crashing
  // at the override check or spreading a string's characters into the
  // draft (round 7). Silently dropping it is not an option either: it is
  // a person's correction, and losing it quietly writes a config they
  // did not describe.
  if (answers.properties !== undefined && answers.properties !== null &&
      (typeof answers.properties !== 'object' || Array.isArray(answers.properties))) {
    throw new Error(
      'These answers do not make a working config:\n  properties is not a map. It holds the contact and company ' +
      'field-name corrections, each a map of this plugin\'s field names to the portal\'s property names.'
    )
  }
  const overridesOf = kind => {
    const map = answers.properties && answers.properties[kind]
    if (map === undefined || map === null) return {}
    if (typeof map !== 'object' || Array.isArray(map)) {
      throw new Error(
        `These answers do not make a working config:\n  properties.${kind} is not a map. It maps this plugin's ` +
        'field names to the portal\'s property names.'
      )
    }
    return map
  }
  const contactOverrides = overridesOf('contact')
  if (crm === 'salesforce' && ('state' in contactOverrides || 'country' in contactOverrides)) {
    throw new Error(
      'These answers do not make a working config:\n  properties.contact.state and properties.contact.country are set ' +
      'through mailingFields on salesforce, the judged probe answer, and nowhere else. Correct mailingFields itself ' +
      'rather than overriding beside it.'
    )
  }
  const defaults = crm === 'salesforce' ? DEFAULT_SALESFORCE_FIELD_NAMES : DEFAULT_PROPERTY_NAMES
  const properties = {
    contact: Object.assign({},
      defaults.contact,
      contactOverrides,
      crm === 'salesforce' ? { state: mailing.state.trim(), country: mailing.country.trim() } : {}),
    company: Object.assign({}, defaults.company, overridesOf('company'))
  }
  // Optional properties enter the draft only when the org named them. A null
  // or empty answer means "we do not have that property", and the honest
  // record of that is the key being absent rather than mapped to nothing.
  for (const kind of ['contact', 'company']) {
    for (const [field, name] of Object.entries(properties[kind])) {
      if (name === null || name === undefined || String(name).trim() === '') delete properties[kind][field]
    }
  }

  const candidate = {
    configVersion: CONFIG_VERSION,
    aliasMapPath: answers.aliasMapPath,
    properties
  }
  if (crm === 'salesforce') {
    // The crm is recorded explicitly on this backend. A hubspot draft
    // leaves it out, so the file every existing install already has stays
    // the file a first run writes.
    candidate.crm = 'salesforce'
    candidate.orgAlias = answers.orgAlias
    if (answers.recordTypeIds !== undefined) candidate.recordTypeIds = answers.recordTypeIds
  } else {
    if (answers.crm !== undefined) candidate.crm = 'hubspot'
    candidate.portalId = answers.portalId === undefined ? undefined : String(answers.portalId)
    candidate.serviceKeyPath = answers.serviceKeyPath
  }

  const wrong = problems(candidate)
  if (wrong.length) {
    throw new Error(`These answers do not make a working config:\n  ${wrong.join('\n  ')}`)
  }
  return candidate
}

/**
 * The one write, and it happens once.
 *
 * An existing file is refused by name rather than replaced. The refusal is
 * the protection: the file may be the working config of an install this
 * session knows nothing about.
 */
function write (candidate) {
  const wrong = problems(candidate)
  if (wrong.length) {
    throw new Error(`Refusing to write a config with known problems:\n  ${wrong.join('\n  ')}`)
  }
  const refusal =
    `${CONFIG_PATH} already exists, and this plugin writes its config once. ` +
    'If it is wrong, fix it by hand or move it aside deliberately. Nothing here replaces it.'
  if (fs.existsSync(CONFIG_PATH)) throw new Error(refusal)
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
  // `wx`, not the default overwrite: the existence check above and the write
  // are two steps, and two first runs racing through the gap would have the
  // later one silently replace the earlier portal's config. Exclusive
  // creation makes the race lose loudly instead.
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(candidate, null, 2) + '\n', { flag: 'wx' })
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error(refusal)
    throw error
  }
  return { path: CONFIG_PATH }
}

module.exports = {
  CONFIG_VERSION,
  CONFIG_PATH,
  CRMS,
  crmOf,
  CONTACT_PROPERTIES,
  COMPANY_PROPERTIES,
  DEFAULT_PROPERTY_NAMES,
  DEFAULT_SALESFORCE_FIELD_NAMES,
  resolvePath,
  problems,
  read,
  draft,
  write
}
