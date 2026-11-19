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
    throw new Error("config/projects.json is missing. It is copied from marin-data: python3 scripts/sync-projects.py");
  }
  const { projects } = JSON.parse(fs.readFileSync(file, "utf8"));
  return projects
    .filter((project) => project.mentions)
    .map((project) => ({
      id: `project-${project.id}`,
      name: project.name,
      group: "Projects",
      include: project.mentions.include,
      ...(project.mentions.exclude && project.mentions.exclude.length ? { exclude: project.mentions.exclude } : {}),
    }));
}

// Which monitors are about a place (config/places.json, a copy of marin-data's organizations/places.json),
// by monitor id. kind is district, municipality or community.
function loadPlaces() {
  const file = path.join(CONFIG_DIR, "places.json");
  if (!fs.existsSync(file)) {
    throw new Error("config/places.json is missing. It is copied from marin-data: python3 scripts/sync-places.py");
  }
  const { places } = JSON.parse(fs.readFileSync(file, "utf8"));
  return new Map(places.map((p) => [p.monitorId, { kind: p.kind, governmentLevel: p.governmentLevel, ...(p.districts ? { districts: p.districts } : {}) }]));
}

// Which monitors are about a person (config/people.json, a copy of marin-data's organizations/people.json),
// by monitor id: the seat they hold and the district it represents, when there is one.
function loadPeople() {
  const file = path.join(CONFIG_DIR, "people.json");
  if (!fs.existsSync(file)) {
    throw new Error("config/people.json is missing. It is copied from marin-data: python3 scripts/sync-people.py");
  }
  const { people } = JSON.parse(fs.readFileSync(file, "utf8"));
  return new Map(people.map((p) => [p.monitorId, { ...(p.role ? { role: p.role } : {}), ...(p.district ? { district: p.district } : {}) }]));
}

// What marin-data says about each monitor it describes, by monitor id: the group the sidebar puts it in and the
// name it is shown by. The group is the plural name of its kind (organizations/place-kinds.json, copied into
// places.json): a district is in Districts, a city or town in Cities and towns, a community in Communities, a
// facility in Facilities and an event in Events. A person is in People.
function loadDataFor() {
  const read = (name) => JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, name), "utf8"));
  const { kinds, places, facilities } = read("places.json");
  const plural = new Map(kinds.map((k) => [k.key, k.plural]));
  const found = new Map();
  const add = (row, kind) => {
    if (!plural.has(kind)) throw new Error(`config/places.json: "${row.monitorId}" has the kind "${kind}", which place-kinds.json does not list.`);
    found.set(row.monitorId, { group: plural.get(kind), name: row.label });
  };
  places.forEach((p) => add(p, p.kind));
  facilities.forEach((f) => add(f, f.kind));
  read("events.json").events.forEach((e) => add(e, e.kind));
  read("people.json").people.forEach((p) => found.set(p.monitorId, { group: "People", name: p.label }));
  return found;
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
    return { ...monitor, group: data.group, name: data.name };
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
      // A name that contains another name of the same record adds nothing ("Town of Fairfax" holds "Fairfax").
      const kept = names.filter((name, i) => !names.some((other, j) => j !== i && other.length < name.length && name.toLowerCase().includes(other.toLowerCase())));
      for (const name of kept) {
        if (ABBREVIATION.test(name) && !hints.needsContext.has(name)) continue;
        include.push(entryFor(name, hints));
      }
    };
    addNames([row.name, ...(row.alternateNames || [])], own);
    for (const phrase of row.searchPhrases || []) include.push(entryFor(phrase, own));
    // The people who hold a district's seat are watched by name.
    for (const person of row.people || []) include.push(person);
    for (const part of row.parts || []) {
      addNames([part.name, ...(part.alternateNames || [])], { needsContext: new Set(part.needsContext || []), insideWords: new Set(part.insideWords || []) });
    }
    for (const tag of row.hashtags || []) include.push(tag);
    const monitor = { id: row.monitorId, include, ...(options[row.monitorId] || {}) };
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

module.exports = { loadSources, loadMonitors, loadProjectMonitors, loadPlaces, loadPeople, loadDataMonitors, monitorsFromRows, loadDataFor, groupMonitors, loadContext, loadExcludedTitles };
