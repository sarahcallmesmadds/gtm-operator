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
 * that is stated rather than papered over. What makes a verbatim paste
 * trustworthy where a re-keying was not: the schema arrives as ONE JSON blob
 * inside a <data-source-state> tag, so a truncated or mangled paste stops
 * being valid JSON and is REFUSED LOUDLY here, instead of arriving as a
 * plausible file with values quietly missing.
 *
 * MEASURED 2026-08-25 against a live workspace, under the testing page: the
 * <data-source-state> blob is byte-identical across the create response, the
 * data-source fetch and the database fetch, its `schema` object is exactly
 * the shape `schema.inspect` compares (name, type, description, options with
 * name and color), types read back as `text` and `person` per READ_BACK_AS,
 * and each database view arrives as one JSON blob inside a <view> tag in the
 * dialect `views.verifyView` reads. The raw captures are
 * tests/fixtures/readback-*-fetch.txt, identifiers remapped because this
 * repository is public.
 */

const STATE_TAG = /<data-source-state>\s*([\s\S]*?)\s*<\/data-source-state>/g
const VIEW_TAG = /<view [^>]*>\s*([\s\S]*?)\s*<\/view>/g

/**
 * Every <data-source-state> blob in the text, parsed, or a refusal that names
 * the likely cause. A paste that dropped the tail either loses the closing
 * tag (no match) or clips the JSON (parse failure), and both are said as a
 * save problem first, because that is the common cause and re-fetching one
 * database is the remedy.
 */
function extractStates (text) {
  const states = []
  for (const match of String(text).matchAll(STATE_TAG)) {
    let parsed
    try {
      parsed = JSON.parse(match[1])
    } catch (error) {
      throw new Error(
        'A <data-source-state> block is present and its content is not valid JSON: ' + error.message + '\n' +
        '  The likely cause is a clipped save rather than anything wrong in Notion: the state arrives as one JSON blob, ' +
        'so a paste that lost its tail stops parsing. Re-fetch this database and save the output whole, without editing it.'
      )
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
        !parsed.schema || typeof parsed.schema !== 'object' || Array.isArray(parsed.schema)) {
      throw new Error(
        'A <data-source-state> block parsed but carries no schema object, so there is nothing to verify in it. ' +
        'Save the fetch output whole, without editing it.'
      )
    }
    if (!Object.keys(parsed.schema).length) {
      throw new Error(
        'A <data-source-state> block carries an empty schema. A database with no properties at all is not something ' +
        'setup creates, so this is a save problem or the wrong database. Re-fetch and save the output whole.'
      )
    }
    states.push(parsed)
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

/** Every <view> blob in the text, parsed. A file with none returns []. */
function extractViews (text) {
  const views = []
  for (const match of String(text).matchAll(VIEW_TAG)) {
    let parsed
    try {
      parsed = JSON.parse(match[1])
    } catch (error) {
      throw new Error(
        'A <view> block is present and its content is not valid JSON: ' + error.message + '\n' +
        '  The likely cause is a clipped save. Re-fetch the database and save the output whole, without editing it.'
      )
    }
    views.push(parsed)
  }
  return views
}

/**
 * One database's evidence, extracted from one or more verbatim saves.
 *
 * Several files are accepted because the schema comes from the data-source
 * fetch and the views from the database fetch, and the database fetch
 * carries the state too. What is refused:
 *
 *   - states naming different data sources in one merge, because that is two
 *     databases' saves handed over as one, and picking either would verify
 *     the wrong database against this key;
 *   - the same view name arriving twice with different content, because
 *     nothing here can say which one is the live one.
 */
function extract (rawTexts) {
  const texts = Array.isArray(rawTexts) ? rawTexts : [rawTexts]
  const states = []
  const views = []
  for (const text of texts) {
    // extractStates throws on files with no state, but only the merged set
    // needs one: the database fetch carries both, the view half alone would
    // be a legal second file. So states are collected leniently per file and
    // the requirement is checked across the merge.
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

  const sources = [...new Set(states.map(s => s.url).filter(Boolean))]
  if (sources.length > 1) {
    throw new Error(
      `The saved files carry states for ${sources.length} different data sources (${sources.join(', ')}), and one ` +
      'database key takes one. Two databases\' saves are mixed together; save and hand over one database at a time.'
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

module.exports = { extract, extractStates, extractViews }
