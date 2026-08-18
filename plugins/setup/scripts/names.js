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
 * Two logical names must never resolve to one Notion property. That is not a
 * rename, it is two things pointed at one, and every read through the map after
 * it would be answering about the wrong property while looking healthy. It is
 * refused at the point of recording rather than found later.
 */
function problems (names, expectedLogical) {
  const out = []
  if (!names || !names.properties) return ['no property map was given']

  for (const logical of expectedLogical) {
    if (!(logical in names.properties)) {
      out.push(`"${logical}" is not in the map. A map records every logical name, including the ones nobody changed`)
    }
  }
  for (const logical of Object.keys(names.properties)) {
    if (!expectedLogical.includes(logical)) {
      out.push(`"${logical}" is in the map and is not a property this database has`)
    }
  }

  const seen = new Map()
  for (const [logical, observed] of Object.entries(names.properties)) {
    if (seen.has(observed)) {
      out.push(`"${logical}" and "${seen.get(observed)}" both map to "${observed}". Two logical properties cannot be one Notion property`)
    }
    seen.set(observed, logical)
  }

  return out
}

module.exports = { propertyName, valueName, recorded, problems }
