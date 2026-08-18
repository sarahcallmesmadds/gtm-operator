'use strict'

/**
 * Resolving a logical name to the name a property or option actually has in
 * Notion.
 *
 * The plugin owns a vocabulary. `Strategy Decision`, `Last checked for
 * accuracy`, `Domain`. A workspace owns the names on its own properties, and
 * people rename things: the `check` spec is explicit that this plugin never
 * renames anything in Notion, and that this map exists so the plugin adapts to
 * their names rather than the other way round.
 *
 * So every lookup that used to index the read-back by the shipped name goes
 * through here instead.
 *
 * NO DEPENDENCIES ON PURPOSE. `schema.js` and `relations.js` both need this, and
 * `schema.js` reads relation property names out of `relations.js`. Putting the
 * lookups anywhere else makes that a cycle.
 *
 * THE MAP IS COMPLETE OR IT IS ABSENT. A recorded map holds every logical name,
 * including the ones nobody changed. That is what makes an empty map mean "no
 * map was ever recorded" rather than "recorded, and nothing was renamed": the
 * two need different answers, and until 2026-08-18 the config carried an empty
 * map that no code ever wrote to, so they were indistinguishable.
 */

/**
 * The Notion name for a logical property.
 *
 * With no map, the logical name is the answer. That is the correct reading for
 * a default install, and it is what every caller that predates the map relies
 * on. A caller that must not guess asks `config.namesFor` first and refuses
 * when it comes back null.
 */
function propertyName (names, logical) {
  const mapped = names && names.properties && names.properties[logical]
  return mapped || logical
}

/** The Notion name for one option of one property. */
function valueName (names, logicalProperty, logicalValue) {
  const forProperty = names && names.values && names.values[logicalProperty]
  const mapped = forProperty && forProperty[logicalValue]
  return mapped || logicalValue
}

/**
 * Whether this map says anything at all.
 *
 * A map with no properties in it is not a map. It is the shape config used to
 * carry before anything wrote to it.
 */
function recorded (names) {
  return Boolean(names && names.properties && Object.keys(names.properties).length)
}

/**
 * What is wrong with a map, as sentences.
 *
 * Two logical names must never resolve to one Notion name. That is not a
 * rename, it is two things pointed at one, and every read through the map after
 * it would be answering about the wrong thing while looking healthy. It is
 * refused at the point of recording rather than found later.
 *
 * BOTH HALVES ARE CHECKED. The first version of this checked the properties and
 * left the option values alone, which put the whole fault back one level down: a
 * values map could drop an option, invent one, or point two options at one
 * Notion name, and `verify` would then read a workspace with a missing option
 * and report it correct. A missing option is not cosmetic. A write naming an
 * option that is not there is a 400 that takes the whole page with it.
 *
 * `expected` is the identity map for this database, which is both the list of
 * logical property names and, per property, the list of logical option values.
 */
function problems (names, expected) {
  const out = []
  if (!names || !names.properties) return ['no property map was given']

  const expectedProperties = Object.keys(expected.properties || {})
  const expectedValues = expected.values || {}

  out.push(...oneToOne(names.properties, expectedProperties, 'property', 'this database has'))

  if (!names.values && Object.keys(expectedValues).length) {
    out.push('the map has no option values at all, and this database has properties with options')
    return out
  }

  for (const property of Object.keys(expectedValues)) {
    const got = (names.values || {})[property]
    if (!got) {
      out.push(`"${property}" has options and the map records none of them`)
      continue
    }
    out.push(...oneToOne(got, Object.keys(expectedValues[property]), `option of "${property}"`, `"${property}" has`))
  }

  for (const property of Object.keys(names.values || {})) {
    if (!(property in expectedValues)) {
      out.push(`the map records options for "${property}", which has no options`)
    }
  }

  return out
}

/**
 * One half of the map, checked three ways: nothing missing, nothing invented,
 * and no two logical names sharing one Notion name.
 *
 * Shared by the properties and the option values because they are the same
 * three failures, and writing them twice is how the second copy ends up
 * checking two of the three.
 */
function oneToOne (map, expectedLogical, what, belongsTo) {
  const out = []

  for (const logical of expectedLogical) {
    if (!(logical in map)) {
      out.push(`"${logical}" is not in the map. A map records every logical name, including the ones nobody changed`)
    }
  }
  for (const logical of Object.keys(map)) {
    if (!expectedLogical.includes(logical)) {
      out.push(`"${logical}" is in the map and is not a ${what} ${belongsTo}`)
    }
  }

  const seen = new Map()
  for (const [logical, observed] of Object.entries(map)) {
    if (seen.has(observed)) {
      out.push(`"${logical}" and "${seen.get(observed)}" both map to "${observed}". Two logical names cannot be one Notion name`)
    }
    seen.set(observed, logical)
  }

  return out
}

module.exports = { propertyName, valueName, recorded, problems }
