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
  return new Map(places.map((p) => [p.monitorId, { kind: p.kind, governmentLevel: p.governmentLevel }]));
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

function loadMonitors() {
  const raw = yaml.load(fs.readFileSync(path.join(CONFIG_DIR, "monitors.yaml"), "utf8"));
  const monitors = [...(raw.monitors || []), ...loadProjectMonitors()];
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

module.exports = { loadSources, loadMonitors, loadProjectMonitors, loadPlaces, loadPeople, loadContext, loadExcludedTitles };
