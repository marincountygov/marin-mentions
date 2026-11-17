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

module.exports = { loadSources, loadMonitors, loadProjectMonitors, loadContext };
