"use strict";

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const CONFIG_DIR = path.join(__dirname, "..", "config");

function loadSources() {
  const raw = yaml.load(fs.readFileSync(path.join(CONFIG_DIR, "sources.yaml"), "utf8"));
  return raw.sources || [];
}

// The shared list of projects (config/projects.json, a copy of marin-data's projects/projects.json). Each
// project with a "mentions" entry is watched by its own monitor in the Projects group, matching the phrases
// listed there. The id is "project-" plus the project's id.
function loadProjectMonitors() {
  const file = path.join(CONFIG_DIR, "projects.json");
  if (!fs.existsSync(file)) {
    throw new Error("config/projects.json is missing. It is copied from marin-data: python3 ../marin-data/scripts/sync_copies.py .");
  }
  const { projects } = JSON.parse(fs.readFileSync(file, "utf8"));
  return projects
    .filter((project) => project.mentions)
    .map((project) => ({
      id: `project-${project.id}`,
      name: project.name,
      group: "Projects",
      facet: "project",
      include: project.mentions.include,
      ...(project.mentions.exclude && project.mentions.exclude.length ? { exclude: project.mentions.exclude } : {}),
    }));
}

// Which monitors are about a place (config/places.json, a copy of marin-data's organizations/places.json),
// by monitor id. kind is district, municipality or community.
function loadPlaces() {
  const file = path.join(CONFIG_DIR, "places.json");
  if (!fs.existsSync(file)) {
    throw new Error("config/places.json is missing. It is copied from marin-data: python3 ../marin-data/scripts/sync_copies.py .");
  }
  const { places } = JSON.parse(fs.readFileSync(file, "utf8"));
  return new Map(places.map((p) => [p.monitorId, { kind: p.kind, governmentLevel: p.governmentLevel, ...(p.districts ? { districts: p.districts } : {}) }]));
}

// Which monitors are about a person (config/people.json, a copy of marin-data's organizations/people.json),
// by monitor id: the seat they hold and the district it represents, when there is one.
function loadPeople() {
  const file = path.join(CONFIG_DIR, "people.json");
  if (!fs.existsSync(file)) {
    throw new Error("config/people.json is missing. It is copied from marin-data: python3 ../marin-data/scripts/sync_copies.py .");
  }
  const { people } = JSON.parse(fs.readFileSync(file, "utf8"));
  return new Map(people.map((p) => [p.monitorId, { ...(p.role ? { role: p.role } : {}), ...(p.district ? { district: p.district } : {}) }]));
}

// What marin-data says about each monitor it describes, by monitor id: the group the sidebar puts it in, the facet
// (the schema type, such as Place or Organization) the group belongs to, the name it is shown by, and, for a
// division, the monitor of its department. The group is the plural name of the record's kind and the facet is the
// kind's facet (marin-data's place-kinds.json, copied into places.json).
function loadDataFor() {
  const read = (name) => JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, name), "utf8"));
  const { kinds, places, facilities } = read("places.json");
  const kindOf = new Map(kinds.map((k) => [k.key, k]));
  const found = new Map();
  const add = (row) => {
    const kind = kindOf.get(row.kind);
    if (!kind) throw new Error(`"${row.monitorId}" has the kind "${row.kind}", which place-kinds.json does not list.`);
    found.set(row.monitorId, { group: kind.plural, facet: kind.facet, name: row.label, ...(row.parentMonitor ? { parent: row.parentMonitor } : {}) });
  };
  [...places, ...facilities, ...read("events.json").events, ...read("people.json").people, ...read("organizations.json").monitors,
    ...read("services.json").services, ...read("topics.json").topics].forEach(add);
  return found;
}

// The facets in the order filters show them, each with its groups (the plural names of its kinds) in order.
function loadFacets() {
  const { kinds, facets } = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, "places.json"), "utf8"));
  return facets.map((facet) => ({ key: facet.key, label: facet.label, groups: kinds.filter((k) => k.facet === facet.key).map((k) => k.plural) }));
}

// A monitor that marin-data describes gets its group and its name from there. monitors.yaml leaves both out for
// it, and the build stops if either one is written there and disagrees. fromData is the map from loadDataFor().
function groupMonitors(rawMonitors, fromData) {
  return rawMonitors.map((monitor) => {
    const data = fromData.get(monitor.id);
    if (!data) return monitor;
    for (const field of ["group", "name"]) {
      if (monitor[field] && monitor[field] !== data[field]) {
        throw new Error(`Monitor "${monitor.id}" has the ${field} "${monitor[field]}" in monitors.yaml, but marin-data says "${data[field]}". Remove its ${field} line from monitors.yaml.`);
      }
    }
    return { ...monitor, group: data.group, name: data.name, facet: data.facet, ...(data.parent ? { parent: data.parent } : {}) };
  });
}

// A place, facility, event or person that marin-data describes is watched by its name, its other names and its
// search hints (config/places.json, events.json and people.json; see marin-data's place_lib.py). Each hint says how
// to look for a name: beside the word Marin (needsContext), as a whole word (insideWords), with a hashtag
// (hashtags), or as a different record's name (confusableNames, which are left out). A phrase may join words
// with " & ", and then every word must be there. A short abbreviation (D3, VMA) is watched only when it needs
// context, so it cannot match everything. config/match-options.yaml holds what only Marin Mentions needs.
function loadDataMonitors() {
  const read = (name) => fs.readFileSync(path.join(CONFIG_DIR, name), "utf8");
  const { places, facilities } = JSON.parse(read("places.json"));
  const rows = [
    ...places,
    ...facilities,
    ...JSON.parse(read("events.json")).events,
    ...JSON.parse(read("people.json")).people,
    ...JSON.parse(read("organizations.json")).monitors,
    ...JSON.parse(read("services.json")).services,
    ...JSON.parse(read("topics.json")).topics,
  ];
  return monitorsFromRows(rows, yaml.load(read("match-options.yaml")) || {});
}

const ABBREVIATION = /^[A-Z0-9]{2,4}$/;

// One name or phrase as a match entry, following its hints.
function entryFor(phrase, hints) {
  const terms = phrase.split(" & ").map((term) => (hints.insideWords.has(phrase) ? `word:${term}` : term));
  if (hints.needsContext.has(phrase)) return ["word:Marin", ...terms];
  return terms.length > 1 ? terms : terms[0];
}

const dedupe = (entries) => entries.filter((entry, i) => entries.findIndex((other) => JSON.stringify(other) === JSON.stringify(entry)) === i);

function monitorsFromRows(rows, options = {}) {
  const ids = new Set(rows.map((row) => row.monitorId));
  for (const id of Object.keys(options)) {
    if (!ids.has(id)) throw new Error(`config/match-options.yaml: "${id}" is not a place, facility, event or person in marin-data.`);
  }
  return rows.map((row) => {
    const include = [];
    const own = {
      needsContext: new Set(row.needsContext || []),
      insideWords: new Set(row.insideWords || []),
    };
    const addNames = (names, hints) => {
      // A short abbreviation (D3, CDA) is watched only when it needs context, so it is not watched here.
      const watched = names.filter((name) => !(ABBREVIATION.test(name) && !hints.needsContext.has(name)));
      // A name that contains another watched name of the same record adds nothing ("Town of Fairfax" holds "Fairfax"),
      // unless the shorter one needs the word Marin and the longer one does not ("IATSE Local 16" next to "IATSE").
      const holds = (longer, shorter) => shorter.length < longer.length && longer.toLowerCase().includes(shorter.toLowerCase()) &&
        (!hints.needsContext.has(shorter) || hints.needsContext.has(longer));
      for (const name of watched) {
        if (watched.some((other) => other !== name && holds(name, other))) continue;
        include.push(entryFor(name, hints));
      }
    };
    addNames([...(row.searchName === false ? [] : [row.name]), ...(row.alternateNames || [])], own);
    for (const phrase of row.searchPhrases || []) include.push(entryFor(phrase, own));
    // The people who hold a district's seat are watched by name.
    for (const person of row.people || []) include.push(person);
    for (const part of row.parts || []) {
      addNames([part.name, ...(part.alternateNames || [])], { needsContext: new Set(part.needsContext || []), insideWords: new Set(part.insideWords || []) });
    }
    for (const tag of row.hashtags || []) include.push(tag);
    const monitor = { id: row.monitorId, include: dedupe(include), ...(options[row.monitorId] || {}) };
    if (row.confusableNames && row.confusableNames.length) monitor.exclude = row.confusableNames;
    return monitor;
  });
}

function loadMonitors() {
  const raw = yaml.load(fs.readFileSync(path.join(CONFIG_DIR, "monitors.yaml"), "utf8"));
  const fromData = loadDataFor();
  const own = groupMonitors(raw.monitors || [], fromData);
  const monitors = [...own, ...groupMonitors(loadDataMonitors(), fromData), ...loadProjectMonitors()];
  const seen = new Set();
  for (const monitor of monitors) {
    if (seen.has(monitor.id)) throw new Error(`Two monitors have the id "${monitor.id}". A project monitor's id is "project-" plus the project's id.`);
    seen.add(monitor.id);
  }
  return monitors;
}

// Optional: context rules for loose sources (see config/context.yaml). A missing
// file means no extra rules.
function loadContext() {
  const file = path.join(CONFIG_DIR, "context.yaml");
  if (!fs.existsSync(file)) return null;
  return yaml.load(fs.readFileSync(file, "utf8")) || null;
}

// Optional: title phrases to leave out (config/exclude.yaml). A missing file means none.
function loadExcludedTitles() {
  const file = path.join(CONFIG_DIR, "exclude.yaml");
  if (!fs.existsSync(file)) return [];
  const raw = yaml.load(fs.readFileSync(file, "utf8")) || {};
  return raw.excludeTitles || [];
}

module.exports = { loadSources, loadMonitors, loadProjectMonitors, loadPlaces, loadPeople, loadDataMonitors, monitorsFromRows, loadDataFor, loadFacets, groupMonitors, loadContext, loadExcludedTitles };
