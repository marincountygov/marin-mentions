"use strict";

// Run with: npm test
// The monitor-to-organization mapping comes from marin-data (config/organizations.json, a copy).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { loadMonitors } = require("../build/config.js");

const links = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "config", "organizations.json"), "utf8"));
const monitors = loadMonitors();
const ids = new Set(monitors.map((m) => m.id));
const linked = new Set(links.monitors.map((m) => m.monitorId));
const notOrgs = new Set(links.notOrganizations.map((m) => m.monitorId));
const ORG_GROUPS = new Set(["Departments", "Divisions", "Legislature", "Courts", "Offices", "Authorities"]);

test("every organization link names a monitor that exists", () => {
  const missing = [...linked].filter((id) => !ids.has(id));
  assert.deepEqual(missing, [], `in marin-data but not in monitors.yaml: ${missing}`);
});

test("every monitor listed as not an organization exists", () => {
  const missing = [...notOrgs].filter((id) => !ids.has(id));
  assert.deepEqual(missing, [], `listed in marin-data but not in monitors.yaml: ${missing}`);
});

test("every organization monitor is linked to an organization or listed as not one", () => {
  const loose = monitors.filter((m) => ORG_GROUPS.has(m.group) && !linked.has(m.id) && !notOrgs.has(m.id)).map((m) => m.id);
  assert.deepEqual(loose, [], `add an organization in marin-data, or list as not an organization: ${loose}`);
});
