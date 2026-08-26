'use strict'

/**
 * Ingest: one named source becomes rows in one canonical shape.
 *
 * Two sources exist, a CSV file and a Notion page or database, and everything
 * downstream reads the same shape for both. Each row keeps the source's own
 * columns untouched under `source`, because the writeback promises to speak
 * the source's language, and a mapping that renamed the original columns
 * would have nothing to write back to.
 *
 * NOTHING IS INVENTED TO COMPLETE A ROW. The canonical fields carry only what
 * the mapping found, and every filled field is stamped with where it came
 * from in `fieldSources`. A blank stays blank and says so.
 */

/**
 * The canonical fields, the one list everything downstream shares.
 *
 * These are the write contract's from-the-list fields plus the two company
 * columns the matching step reads. Persona and owner are deliberately not
 * here: neither ever comes from a list column, one comes from the personas
 * artifact and one from routing or explicit confirmation.
 */
const FIELDS = [
  'firstName', 'lastName', 'email', 'phone', 'title',
  'city', 'state', 'country', 'linkedinUrl',
  'company', 'companyDomain'
]

/**
 * How a source header finds its canonical field.
 *
 * Matching is on the header lowercased with everything but letters and digits
 * removed, so `First Name`, `first_name` and `FIRSTNAME` are one header. The
 * lists carry the spellings lead lists actually use. A header matching
 * nothing is reported as unmapped rather than dropped silently, and the
 * person corrects the mapping in conversation before anything else runs.
 */
const HEADER_SYNONYMS = {
  firstName: ['firstname', 'first', 'givenname'],
  lastName: ['lastname', 'last', 'surname', 'familyname'],
  email: ['email', 'emailaddress', 'workemail', 'businessemail'],
  phone: ['phone', 'phonenumber', 'mobile', 'mobilephone', 'directdial', 'telephone'],
  title: ['title', 'jobtitle', 'role', 'position'],
  city: ['city', 'mailingcity', 'town'],
  state: ['state', 'mailingstate', 'province'],
  country: ['country', 'mailingcountry'],
  linkedinUrl: ['linkedin', 'linkedinurl', 'linkedinprofile'],
  company: ['company', 'companyname', 'account', 'accountname', 'organisation', 'organization', 'employer'],
  companyDomain: ['domain', 'companydomain', 'website', 'companywebsite']
}

const foldHeader = header => String(header).toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * A CSV file, parsed whole.
 *
 * Quoted fields, doubled quotes inside them, commas and newlines inside
 * quotes, CRLF endings, and a UTF-8 BOM, which the reference pipeline
 * specifically parsed for (`utf-8-sig`) because exported lists routinely
 * carry one and an unstripped BOM turns the first header into a stranger.
 *
 * A ragged row is reported, not guessed at. Padding it invents blanks in
 * whichever columns happen to sit at the end, and truncating it throws data
 * away, so neither happens silently.
 */
function parseCsv (text) {
  let body = String(text)
  if (body.charCodeAt(0) === 0xFEFF) body = body.slice(1)

  const records = []
  let record = []
  let cell = ''
  let inQuotes = false
  let justClosed = false
  let line = 1
  let i = 0

  // MALFORMED QUOTING IS REFUSED, NOT REPAIRED. A quote opening mid-cell
  // (`ab"cd"`) and text following a closing quote (`"a"x`) both used to
  // parse silently with the quotes dropped, which is a parser quietly
  // rewriting data. Excel and every exporter that quotes at all produce
  // neither, so meeting one means the file is mangled, and a mangled file
  // is fixed or re-exported rather than guessed at.
  while (i < body.length) {
    const ch = body[i]
    if (inQuotes) {
      if (ch === '"') {
        if (body[i + 1] === '"') { cell += '"'; i += 2; continue }
        inQuotes = false; justClosed = true; i += 1; continue
      }
      if (ch === '\n') line += 1
      cell += ch; i += 1; continue
    }
    if (justClosed && ch !== ',' && ch !== '\n' && ch !== '\r') {
      throw new Error(
        `Line ${line}: there is text after a closing quote (…"${ch}…). A quoted cell ends at its quote, so this file is ` +
        'malformed, and parsing on would silently rewrite it. Fix the file, or export it again.'
      )
    }
    if (ch === '"') {
      if (cell !== '') {
        throw new Error(
          `Line ${line}: a quote opens in the middle of a cell (after "${cell}"). A quoted cell starts at its quote, so this ` +
          'file is malformed, and parsing on would silently drop the quote. Fix the file, or export it again.'
        )
      }
      inQuotes = true; i += 1; continue
    }
    if (ch === ',') { record.push(cell); cell = ''; justClosed = false; i += 1; continue }
    if (ch === '\r' && body[i + 1] === '\n') { record.push(cell); records.push(record); record = []; cell = ''; justClosed = false; line += 1; i += 2; continue }
    if (ch === '\n' || ch === '\r') { record.push(cell); records.push(record); record = []; cell = ''; justClosed = false; line += 1; i += 1; continue }
    cell += ch; i += 1
  }
  if (inQuotes) {
    throw new Error('The file ends inside a quoted field. This is a truncated or mangled CSV, and half a list must not import as a whole one.')
  }
  if (cell !== '' || record.length) { record.push(cell); records.push(record) }

  // A trailing newline leaves one empty record; an entirely blank line inside
  // the file is skipped the same way rather than becoming an all-blank row.
  // A line holding only `""` lands here too and is skipped as blank: an
  // empty quoted cell alone on a line carries nothing a row could be built
  // from, and this sentence is here so the choice is a choice, not an
  // accident.
  return records.filter(r => !(r.length === 1 && r[0] === ''))
}

/**
 * Headers checked before any row is read.
 *
 * A duplicate header is refused because two columns with one name collapse
 * into one field, and whichever the code kept would silently shadow the
 * other. An empty header is refused because its cells would have no name to
 * be written back under.
 */
function headerProblems (headers) {
  const out = []
  const seen = new Map()
  headers.forEach((header, index) => {
    const name = String(header).trim()
    if (!name) {
      out.push(`Column ${index + 1} has an empty header. Every column needs a name, or its values cannot be reported or written back.`)
      return
    }
    if (seen.has(name)) {
      out.push(`"${name}" is the header of two columns. Two columns with one name collapse into one field, losing whichever the code did not keep.`)
    }
    seen.set(name, index)
  })
  return out
}

/**
 * The proposed mapping from source headers to canonical fields.
 *
 * Proposed, not decided: the skill shows it, with the unmapped columns named,
 * and the person confirms or corrects it before ingest runs with it. Two
 * source headers proposing the same canonical field is an ambiguity, and
 * ambiguities are presented rather than ranked.
 */
function proposeMapping (headers) {
  const mapping = {}
  const unmapped = []
  const ambiguous = {}

  for (const header of headers) {
    const folded = foldHeader(header)
    const field = FIELDS.find(name =>
      foldHeader(name) === folded || (HEADER_SYNONYMS[name] || []).includes(folded)
    )
    if (!field) { unmapped.push(header); continue }
    if (Object.values(mapping).includes(field)) {
      const first = Object.keys(mapping).find(h => mapping[h] === field)
      ambiguous[field] = (ambiguous[field] || [first]).concat(header)
      continue
    }
    mapping[header] = field
  }

  return { mapping, unmapped, ambiguous }
}

/** A confirmed mapping, checked before it is used. */
function mappingProblems (headers, mapping) {
  const out = []
  const used = new Map()
  for (const [header, field] of Object.entries(mapping || {})) {
    if (!headers.includes(header)) {
      out.push(`The mapping names a column "${header}" and the source has no such column.`)
    }
    if (!FIELDS.includes(field)) {
      out.push(`The mapping sends "${header}" to "${field}", which is not a field this plugin carries. Known: ${FIELDS.join(', ')}.`)
    }
    if (used.has(field)) {
      out.push(`Both "${used.get(field)}" and "${header}" map to ${field}. One field cannot come from two columns.`)
    }
    used.set(field, header)
  }
  return out
}

/**
 * A phone number normalised the way the reference normalised one: digits,
 * with a leading `+` kept when the source had one. The original spelling
 * stays on `source` untouched.
 */
function normalisePhone (value) {
  const raw = String(value).trim()
  if (!raw) return ''
  const digits = raw.replace(/[^0-9]/g, '')
  if (!digits) return ''
  return (raw.startsWith('+') ? '+' : '') + digits
}

/**
 * An email trimmed and lowercased.
 *
 * Lowercased whole, deliberately: the dedupe key is the email, HubSpot
 * enforces uniqueness on it case-insensitively, and a matching that treated
 * `Ada@example.com` and `ada@example.com` as two people would plan a create
 * the portal will refuse. Whether an address is valid is not judged here at
 * all: the portal's own validation is stricter than anything this could
 * check locally (measured 2026-08-25, it refused a syntactically clean
 * address on its domain), so a refusal at push time is expected, reported,
 * and never guessed at in advance.
 */
const normaliseEmail = value => String(value).trim().toLowerCase()

/**
 * Rows in the canonical shape, from a confirmed mapping.
 *
 * `index` is the 1-based data row number in the source, so every report can
 * name a row the way the person's own file numbers it. `source` is the row
 * exactly as it came. `fields` holds only what the mapping found, normalised,
 * and `fieldSources` stamps every filled field with `list`, which is what the
 * gate later reads: a value with no source is refused.
 */
function toRows (headers, records, mapping) {
  return records.map((record, at) => {
    const source = {}
    headers.forEach((header, column) => { source[String(header).trim()] = record[column] === undefined ? '' : record[column] })

    const fields = {}
    const fieldSources = {}
    for (const [header, field] of Object.entries(mapping)) {
      const raw = source[String(header).trim()]
      let value = raw === undefined || raw === null ? '' : String(raw).trim()
      if (field === 'phone') value = normalisePhone(value)
      if (field === 'email') value = normaliseEmail(value)
      if (value === '') continue
      fields[field] = value
      fieldSources[field] = 'list'
    }

    return { index: at + 1, source, fields, fieldSources }
  })
}

/**
 * The whole ingest for a CSV, one call.
 *
 * With no confirmed mapping it stops at the proposal, because running on with
 * a guessed mapping is how a column of phone numbers lands in a city field.
 * `ragged` rows are named by number and the ingest refuses while any exist:
 * the scope gate's rule, refuse rather than narrow, applied to rows.
 */
function ingestCsv (text, confirmedMapping) {
  const records = parseCsv(text)
  if (!records.length) {
    throw new Error('The file has no rows at all, not even a header. There is nothing to import and nothing to report.')
  }
  const headers = records[0].map(h => String(h).trim())
  const wrongHeaders = headerProblems(headers)
  if (wrongHeaders.length) {
    throw new Error(`The header row cannot be used as it is:\n  ${wrongHeaders.join('\n  ')}`)
  }

  const body = records.slice(1)
  const ragged = body
    .map((record, at) => (record.length === headers.length ? null : { row: at + 1, cells: record.length }))
    .filter(Boolean)
  if (ragged.length) {
    throw new Error(
      'These rows do not have one cell per header, and padding or truncating them would invent or discard data:\n  ' +
      ragged.map(r => `row ${r.row}: ${r.cells} cells against ${headers.length} headers`).join('\n  ') +
      '\nFix the file, or export it again.'
    )
  }

  const proposal = proposeMapping(headers)
  if (!confirmedMapping) {
    return { decided: false, headers, rowCount: body.length, proposal }
  }

  const wrongMapping = mappingProblems(headers, confirmedMapping)
  if (wrongMapping.length) {
    throw new Error(`The confirmed mapping cannot be used as it is:\n  ${wrongMapping.join('\n  ')}`)
  }

  const mappedHeaders = Object.keys(confirmedMapping)
  return {
    decided: true,
    headers,
    unmapped: headers.filter(h => !mappedHeaders.includes(h)),
    rows: toRows(headers, body, confirmedMapping)
  }
}

/**
 * Notion rows, already fetched by the skill through the connected client,
 * arrive as an array of `{pageId, columns}` and go through the same mapping
 * as a CSV. `pageId` is kept on the row because the writeback needs to find
 * the source row again, and a writeback that matched rows by content would
 * write to whichever row happened to look similar.
 */
function ingestNotionRows (entries, confirmedMapping) {
  if (!Array.isArray(entries)) {
    throw new Error('Notion ingest needs an array of {pageId, columns} entries, saved as the source was fetched.')
  }
  const bad = entries
    .map((entry, at) => (!entry || typeof entry.pageId !== 'string' || !entry.pageId.trim() ||
      !entry.columns || typeof entry.columns !== 'object' || Array.isArray(entry.columns)
      ? at + 1 : null))
    .filter(Boolean)
  if (bad.length) {
    throw new Error(
      `Entries ${bad.join(', ')} are not {pageId, columns} objects. Without a pageId the writeback cannot find ` +
      'the source row again, so the shape is refused rather than imported without one.'
    )
  }

  const headers = [...new Set(entries.flatMap(entry => Object.keys(entry.columns).map(h => String(h).trim())))]
  const proposal = proposeMapping(headers)
  if (!confirmedMapping) {
    return { decided: false, headers, rowCount: entries.length, proposal }
  }
  const wrongMapping = mappingProblems(headers, confirmedMapping)
  if (wrongMapping.length) {
    throw new Error(`The confirmed mapping cannot be used as it is:\n  ${wrongMapping.join('\n  ')}`)
  }

  const records = entries.map(entry => headers.map(header => {
    const key = Object.keys(entry.columns).find(k => String(k).trim() === header)
    return key === undefined ? '' : entry.columns[key]
  }))
  const rows = toRows(headers, records, confirmedMapping)
  rows.forEach((row, at) => { row.notionPageId = entries[at].pageId })

  return {
    decided: true,
    headers,
    unmapped: headers.filter(h => !Object.keys(confirmedMapping).includes(h)),
    rows
  }
}

module.exports = {
  FIELDS,
  HEADER_SYNONYMS,
  foldHeader,
  parseCsv,
  headerProblems,
  proposeMapping,
  mappingProblems,
  normalisePhone,
  normaliseEmail,
  toRows,
  ingestCsv,
  ingestNotionRows
}
