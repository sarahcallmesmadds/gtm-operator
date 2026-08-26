'use strict'

/**
 * The private config of the import-leads plugin.
 *
 * `~/.claude/import-leads.config.json`, this plugin's own file. It is not the
 * foundation's config: `setup` writes that one and this plugin never reads it.
 * This file holds identifiers only. The portal, the property-name map, where
 * the Service Key lives (never the key itself), and the path to the company
 * alias map. Everything that is judgment lives in Process artifacts instead,
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
  optional: ['linkedinUrl', 'persona', 'leadSource']
}

const COMPANY_PROPERTIES = {
  required: ['name', 'website'],
  optional: []
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

  if (typeof config.portalId !== 'string' || !/^\d+$/.test(config.portalId)) {
    out.push('portalId has to be the portal id as a string of digits, the number HubSpot shows in the account menu.')
  }

  for (const [field, why] of [
    ['serviceKeyPath', 'where the Service Key lives. The key itself never enters this file.'],
    ['aliasMapPath', 'the user-owned company alias map file.']
  ]) {
    if (!resolvePath(config[field])) {
      out.push(`${field} is missing or empty. It names ${why}`)
    }
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
        `There is no config at ${CONFIG_PATH}. This is a first run: gather the portal id, the property names, ` +
        'where the Service Key lives and the alias-map path, show what will be recorded, and write the file on an explicit yes. ' +
        'Search for what can be found rather than asking anyone to type what could be looked up.'
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
    throw new Error('draft needs an object of answers: portalId, serviceKeyPath, aliasMapPath, and any property-name corrections.')
  }
  const properties = {
    contact: Object.assign({}, DEFAULT_PROPERTY_NAMES.contact, (answers.properties && answers.properties.contact) || {}),
    company: Object.assign({}, DEFAULT_PROPERTY_NAMES.company, (answers.properties && answers.properties.company) || {})
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
    portalId: answers.portalId === undefined ? undefined : String(answers.portalId),
    serviceKeyPath: answers.serviceKeyPath,
    aliasMapPath: answers.aliasMapPath,
    properties
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
  if (fs.existsSync(CONFIG_PATH)) {
    throw new Error(
      `${CONFIG_PATH} already exists, and this plugin writes its config once. ` +
      'If it is wrong, fix it by hand or move it aside deliberately. Nothing here replaces it.'
    )
  }
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(candidate, null, 2) + '\n')
  return { path: CONFIG_PATH }
}

module.exports = {
  CONFIG_VERSION,
  CONFIG_PATH,
  CONTACT_PROPERTIES,
  COMPANY_PROPERTIES,
  DEFAULT_PROPERTY_NAMES,
  resolvePath,
  problems,
  read,
  draft,
  write
}
