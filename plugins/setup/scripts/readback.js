'use strict'

/**
 * Turning a saved fetch into verify's evidence, mechanically.
 *
 * WHY THIS EXISTS. Step 6 used to ask for the read-back to be written into a
 * file in verify's own envelope shape, and the only route from a tool result
 * into a file runs through the model, so six schemas were re-keyed by hand:
 * roughly two hundred option values, where one slip produces a mismatch
 * indistinguishable from a real one. The 2026-08-18 fixture in this
 * repository is the disease on record: its own comment admits every property
 * `description` was silently lost in transcription. The 2026-08-23 live
 * install could not realistically complete the step at all, and that was
 * logged as the thing blocking every first install.
 *
 * WHAT CHANGED, AND WHAT HONESTLY DID NOT. The saved file is now the fetch
 * output pasted VERBATIM, and this module does the extraction: no re-keying,
 * no restructuring, no values retyped. The channel still passes through the
 * model, because nothing else connects the Notion client to the disk, and
 * that is stated rather than papered over. What this can refuse loudly: a
 * clipped save (the outer fetch wrapper loses its closing tag, or the JSON
 * stops parsing), a save that is not a data-source or database fetch at all
 * (a page fetch carrying a state blob in its content is page content, not
 * evidence), saves from more than one database handed over as one, and view
 * evidence whose own provenance names a different data source. What it
 * CANNOT see: an edit that keeps everything well-formed and self-consistent,
 * which is indistinguishable from a real fetch of a different database. That
 * is why the command prints the counts for a person to read against the
 * plan, and why the skill says to believe a mismatch only after a fresh
 * save.
 *
 * MEASURED 2026-08-25 against a live workspace, under the testing page: the
 * <data-source-state> blob is byte-identical across the create response, the
 * data-source fetch and the database fetch, its `schema` object is exactly
 * the shape `schema.inspect` compares (name, type, description, options with
 * name and color), types read back as `text` and `person` per READ_BACK_AS,
 * every state carries its `url`, and each database view arrives as one JSON
 * blob inside a <view> tag in the dialect `views.verifyView` reads, naming
 * its data source in `dataSourceUrl`. The raw captures are
 * tests/fixtures/readback-*-fetch.txt, identifiers remapped because this
 * repository is public.
 */

const STATE_OPEN = '<data-source-state>'
const STATE_CLOSE = '</data-source-state>'

/**
 * The one JSON object starting at `start` (the index of its `{`), found by
 * walking strings and braces rather than by searching for a closing tag. A
 * literal `</data-source-state>` INSIDE a JSON string is legal content, and
 * the tag-search this replaces stopped at it and refused a legitimate blob
 * as clipped. Returns null when the text ends first, which is what a clipped
 * save looks like from here.
 */
function jsonObjectAt (text, start) {
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (c === '\\') escaped = true
      else if (c === '"') inString = false
      continue
    }
    if (c === '"') { inString = true; continue }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

/**
 * What kind of fetch a saved file is, judged from its outermost structure,
 * with the whole file refused when it is not a fetch this step uses.
 *
 * A page fetch is refused OUTRIGHT, even when its content happens to carry a
 * state blob: a blob inside page content is something somebody wrote on a
 * page, not what Notion returned for a database, and treating it as evidence
 * would verify a workspace against a document. And the closing tag of the
 * outer wrapper is required, because a paste that lost its tail after a
 * complete state blob still parses — 11 properties, zero views — and used to
 * be accepted as a database that had no views.
 */
function wrapperProblem (text) {
  const at = tag => {
    const index = String(text).search(tag)
    return index === -1 ? Infinity : index
  }
  const page = at(/<page[\s>]/)
  const database = at(/<database[\s>]/)
  const dataSource = at(/<data-source[\s>]/)

  if (page < database && page < dataSource) {
    return 'this save is a page fetch, and page content is not schema evidence: a state blob written on a page is a document, not what Notion returned for a database. Fetch the data source or the database and save that output.'
  }
  if (database === Infinity && dataSource === Infinity) {
    return 'this save carries no <data-source> or <database> fetch at all. Fetch the data source or the database and save the whole output, without editing it.'
  }
  const closing = database < dataSource ? '</database>' : '</data-source>'
  if (!String(text).includes(closing)) {
    return `the ${closing === '</database>' ? 'database' : 'data-source'} fetch is missing its closing ${closing} tag, which is what a save that lost its tail looks like — including one clipped after a complete schema, which would otherwise read as a database with no views. Re-fetch and save the output whole.`
  }
  return null
}

/** Notion wraps some urls in {{...}}; provenance compares them unwrapped. */
function bareUrl (value) {
  return typeof value === 'string' ? value.replace(/^\{\{/, '').replace(/\}\}$/, '') : value
}

/**
 * Every <data-source-state> blob in the text, parsed, or a refusal that
 * names the likely cause. Every real state carries its `url`, measured, so
 * one without it is refused rather than quietly excluded from the
 * one-database check it would otherwise slip past.
 */
function extractStates (text) {
  const states = []
  const body = String(text)
  let from = 0
  while (true) {
    const open = body.indexOf(STATE_OPEN, from)
    if (open === -1) break
    const brace = body.indexOf('{', open + STATE_OPEN.length)
    if (brace === -1) {
      throw new Error(
        'A <data-source-state> tag opens and no JSON follows it, which is what a clipped save looks like. ' +
        'Re-fetch this database and save the output whole, without editing it.'
      )
    }
    const blob = jsonObjectAt(body, brace)
    if (blob === null) {
      throw new Error(
        'A <data-source-state> blob starts and never closes: the save lost its tail mid-schema. ' +
        'Re-fetch this database and save the output whole, without editing it.'
      )
    }
    let parsed
    try {
      parsed = JSON.parse(blob)
    } catch (error) {
      throw new Error(
        'A <data-source-state> blob is present and is not valid JSON: ' + error.message + '\n' +
        '  The likely cause is a damaged save rather than anything wrong in Notion. Re-fetch this database and save ' +
        'the output whole, without editing it.'
      )
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
        !parsed.schema || typeof parsed.schema !== 'object' || Array.isArray(parsed.schema)) {
      throw new Error(
        'A <data-source-state> blob parsed but carries no schema object, so there is nothing to verify in it. ' +
        'Save the fetch output whole, without editing it.'
      )
    }
    if (!Object.keys(parsed.schema).length) {
      throw new Error(
        'A <data-source-state> blob carries an empty schema. A database with no properties at all is not something ' +
        'setup creates, so this is a save problem or the wrong database. Re-fetch and save the output whole.'
      )
    }
    if (typeof parsed.url !== 'string' || !parsed.url) {
      throw new Error(
        'A <data-source-state> blob carries no data source url, and every real state does, measured. A state with no ' +
        'provenance cannot be held to the one-database rule, so it is refused rather than counted around.'
      )
    }
    states.push(parsed)
    from = brace + blob.length
  }
  if (!states.length) {
    throw new Error(
      'No <data-source-state> block was found in the saved file. The schema evidence lives inside that tag in the ' +
      'fetch output, so either this is not a data-source or database fetch, or the save lost it. Save the fetch ' +
      'output whole, without editing it.'
    )
  }
  return states
}

/** Every <view> blob in the text, parsed the same balanced way. */
function extractViews (text) {
  const views = []
  const body = String(text)
  const opener = /<view[\s>]/g
  let match
  while ((match = opener.exec(body)) !== null) {
    const tagEnd = body.indexOf('>', match.index)
    if (tagEnd === -1) break
    const brace = body.indexOf('{', tagEnd)
    if (brace === -1) {
      throw new Error('A <view> tag opens and no JSON follows it, which is what a clipped save looks like. Re-fetch the database and save the output whole.')
    }
    const blob = jsonObjectAt(body, brace)
    if (blob === null) {
      throw new Error('A <view> blob starts and never closes: the save lost its tail mid-view. Re-fetch the database and save the output whole.')
    }
    let parsed
    try {
      parsed = JSON.parse(blob)
    } catch (error) {
      throw new Error('A <view> blob is present and is not valid JSON: ' + error.message + '\n  Re-fetch the database and save the output whole, without editing it.')
    }
    views.push(parsed)
    opener.lastIndex = brace + blob.length
  }
  return views
}

/**
 * One database's evidence, extracted from one or more verbatim saves.
 *
 * Several files are accepted because the schema comes from the data-source
 * fetch and the views from the database fetch, and the database fetch
 * carries the state too. What is refused: a save whose outer wrapper is
 * missing, clipped or a page fetch; states naming different data sources in
 * one merge; a view whose own `dataSourceUrl` names a different data source
 * than the state, or none at all, because foreign view evidence would prove
 * view configuration from the wrong database; and the same view name twice
 * with different content.
 */
function extract (rawTexts) {
  const texts = Array.isArray(rawTexts) ? rawTexts : [rawTexts]
  const states = []
  const views = []
  for (const text of texts) {
    const wrapper = wrapperProblem(text)
    if (wrapper) throw new Error(wrapper)
    // extractStates throws on files with no state, but only the merged set
    // needs one. So states are collected leniently per file and the
    // requirement is checked across the merge.
    try {
      states.push(...extractStates(text))
    } catch (error) {
      if (!/No <data-source-state> block/.test(error.message)) throw error
    }
    views.push(...extractViews(text))
  }

  if (!states.length) {
    throw new Error(
      'None of the saved files carries a <data-source-state> block, so there is no schema evidence to verify. ' +
      'Fetch the data source (or the database) and save the output whole, without editing it.'
    )
  }

  const sources = [...new Set(states.map(s => bareUrl(s.url)))]
  if (sources.length > 1) {
    throw new Error(
      `The saved files carry states for ${sources.length} different data sources (${sources.join(', ')}), and one ` +
      'database key takes one. More than one database\'s saves are mixed together; save and hand over one database at a time.'
    )
  }

  // Byte-identical states are the same evidence twice (the database fetch
  // repeats the data-source fetch); a disagreement between them is real and
  // is not this module's to arbitrate.
  const rendered = [...new Set(states.map(s => JSON.stringify(s.schema)))]
  if (rendered.length > 1) {
    throw new Error(
      'Two saves of this database carry different schemas. That can be a schema edited between the two fetches, or a ' +
      'damaged save, and nothing here can say which: re-fetch once and hand over that one save.'
    )
  }

  const byName = new Map()
  for (const view of views) {
    const name = view && view.name
    if (typeof name !== 'string' || !name) continue
    // A view's own provenance has to name THIS data source. Without this, a
    // state from database A plus a pasted view from database B merged
    // cleanly, and the view half of verify was proved against the wrong
    // database — worst for the unfiltered Calendar view, which has no row
    // comparison to catch it.
    const provenance = bareUrl(view.dataSourceUrl)
    if (typeof provenance !== 'string' || !provenance) {
      throw new Error(
        `The view "${name}" carries no dataSourceUrl, and every real view blob does, measured. A view with no ` +
        'provenance cannot be held to this database, so it is refused rather than merged.'
      )
    }
    if (provenance !== sources[0]) {
      throw new Error(
        `The view "${name}" names data source ${provenance} and the schema evidence is for ${sources[0]}. ` +
        'That is another database\'s view handed over with this one\'s schema, and merging it would prove view ' +
        'configuration from the wrong database. Save and hand over one database at a time.'
      )
    }
    const seen = byName.get(name)
    if (seen && JSON.stringify(seen) !== JSON.stringify(view)) {
      throw new Error(
        `The saves carry the view "${name}" twice with different content, and nothing here can say which is live. ` +
        'Re-fetch the database once and hand over that one save.'
      )
    }
    byName.set(name, view)
  }

  const schema = states[0].schema
  const optionValues = Object.values(schema)
    .reduce((total, property) => total + ((property && property.options) || []).length, 0)

  return {
    schema,
    views: [...byName.values()],
    summary: {
      dataSource: sources[0] || null,
      properties: Object.keys(schema).length,
      optionValues,
      withDescriptions: Object.values(schema).filter(p => p && typeof p.description === 'string' && p.description).length,
      views: [...byName.keys()]
    }
  }
}

module.exports = { extract, extractStates, extractViews, wrapperProblem, jsonObjectAt }
