// Reports: the report data model, templates, dates, validation, and the
// operations the builder uses to change a report. No DOM access, so it runs
// in the browser (window.ReportsCore) and in Node tests (require).
//
// A report is plain data. Everything shown, copied, or downloaded is rendered
// from it (see render.js); the data, not generated HTML, is the source of truth.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ReportsCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SCHEMA_VERSION = '1.0';
  const TIME_ZONE = 'America/Los_Angeles';
  const SECTION_TYPES = ['release-coverage', 'coverage-list', 'manual-table', 'text', 'highlights'];
  const SECTION_TYPE_LABELS = {
    'release-coverage': 'News releases with coverage',
    'coverage-list': 'Coverage list',
    'manual-table': 'Table you fill in',
    text: 'Text',
    highlights: 'Highlights',
  };
  const LIMITS = { sections: 40, items: 500, coverage: 200, short: 300, long: 5000, json: 4000000 };
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
    'October', 'November', 'December'];
  const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  // --- text and links ---

  function cleanText(value, max) {
    return String(value == null ? '' : value)
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
      .replace(/\r\n?/g, '\n')
      .trim()
      .slice(0, max || LIMITS.short);
  }

  // Only web and email links are kept. Anything else (javascript:, data:, file:) becomes empty.
  function safeUrl(value) {
    const text = cleanText(value, 2000);
    if (!text) return '';
    try {
      const url = new URL(text);
      return ['http:', 'https:', 'mailto:'].indexOf(url.protocol) >= 0 ? text : '';
    } catch (error) {
      return '';
    }
  }

  // --- dates (ISO strings; no local-time surprises) ---

  function isIsoDate(text) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text || '')) return false;
    const p = text.split('-').map(Number);
    const d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    return d.getUTCFullYear() === p[0] && d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2];
  }

  function parts(iso) {
    const p = iso.split('-').map(Number);
    return { y: p[0], m: p[1], d: p[2] };
  }

  function addDays(iso, n) {
    const p = parts(iso);
    const d = new Date(Date.UTC(p.y, p.m - 1, p.d + n));
    return d.toISOString().slice(0, 10);
  }

  // The Pacific-time calendar day of a timestamp, because reports are about County days.
  // A post at 5 pm Pacific on Oct 6 is Oct 7 in UTC and still belongs to Oct 6.
  function pacificDate(timestamp) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return '';
    const fields = {};
    new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(date).forEach((part) => { fields[part.type] = part.value; });
    return fields.year + '-' + fields.month + '-' + fields.day;
  }

  function weekday(iso) {
    const p = parts(iso);
    return WEEKDAYS[new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()];
  }

  // "Sep 30, 2026"
  function formatDate(iso) {
    if (!isIsoDate(iso)) return iso || '';
    const p = parts(iso);
    return MONTHS[p.m - 1].slice(0, 3) + ' ' + p.d + ', ' + p.y;
  }

  // "Wednesday, September 30, through Tuesday, October 6" (years only when the period crosses years)
  function formatPeriod(start, end) {
    if (!isIsoDate(start) || !isIsoDate(end)) return '';
    const a = parts(start);
    const b = parts(end);
    const withYear = a.y !== b.y;
    const one = (iso, p) => weekday(iso) + ', ' + MONTHS[p.m - 1] + ' ' + p.d + (withYear ? ', ' + p.y : '');
    return start === end ? one(start, a) : one(start, a) + ', through ' + one(end, b);
  }

  const PERIOD_PRESETS = [
    { id: 'last-7', label: 'Last 7 days' },
    { id: 'last-14', label: 'Last 14 days' },
    { id: 'last-30', label: 'Last 30 days' },
    { id: 'this-month', label: 'This month' },
    { id: 'last-month', label: 'Last month' },
    { id: 'custom', label: 'Custom' },
  ];

  function periodFor(preset, todayIso) {
    const t = parts(todayIso);
    if (preset === 'last-7') return { start: addDays(todayIso, -6), end: todayIso };
    if (preset === 'last-14') return { start: addDays(todayIso, -13), end: todayIso };
    if (preset === 'last-30') return { start: addDays(todayIso, -29), end: todayIso };
    if (preset === 'this-month') return { start: todayIso.slice(0, 8) + '01', end: todayIso };
    if (preset === 'last-month') {
      const first = new Date(Date.UTC(t.y, t.m - 2, 1)).toISOString().slice(0, 10);
      const last = new Date(Date.UTC(t.y, t.m - 1, 0)).toISOString().slice(0, 10);
      return { start: first, end: last };
    }
    return null;
  }

  function inPeriod(iso, period) {
    return Boolean(iso) && iso >= period.start && iso <= period.end;
  }

  // --- ids ---

  let counter = 0;
  function uid(prefix) {
    counter += 1;
    return (prefix || 'u') + Date.now().toString(36) + counter.toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // --- items ---

  // A copy of what a Mentions item showed, so the report still renders after the item leaves the data.
  function snapshotFromMention(item, monitorNames) {
    const names = (item.matchedMonitors || []).map((id) => (monitorNames && monitorNames[id]) || id);
    return {
      uid: uid('c'),
      kind: 'coverage',
      origin: 'mentions',
      itemId: String(item.id || ''),
      date: pacificDate(item.publishedAt),
      headline: cleanText(item.title || (item.text || '').slice(0, 160) || item.source),
      source: cleanText(item.source),
      url: safeUrl(item.url),
      sourceUrl: safeUrl(item.sourceUrl),
      contentType: cleanText(item.sourceType, 40),
      monitors: names.map((n) => cleanText(n, 120)).slice(0, 20),
      notes: '',
    };
  }

  function manualCoverage(fields) {
    return {
      uid: uid('c'),
      kind: 'coverage',
      origin: 'manual',
      itemId: '',
      date: isIsoDate(fields.date) ? fields.date : '',
      headline: cleanText(fields.headline),
      source: cleanText(fields.source),
      url: safeUrl(fields.url),
      sourceUrl: '',
      contentType: '',
      monitors: [],
      notes: cleanText(fields.notes, LIMITS.long),
    };
  }

  function newRelease(fields) {
    return {
      uid: uid('r'),
      kind: 'release',
      origin: fields.origin === 'mentions' ? 'mentions' : 'manual',
      itemId: cleanText(fields.itemId, 80),
      date: isIsoDate(fields.date) ? fields.date : '',
      department: cleanText(fields.department),
      title: cleanText(fields.title),
      url: safeUrl(fields.url),
      coverage: [],
    };
  }

  function newRow(fields) {
    return {
      uid: uid('w'),
      kind: 'row',
      when: cleanText(fields.when, 80),
      department: cleanText(fields.department),
      topic: cleanText(fields.topic),
      description: cleanText(fields.description, LIMITS.long),
      url: safeUrl(fields.url),
    };
  }

  // --- templates ---

  function section(id, title, type, extra) {
    return Object.assign({ id: id, title: title, type: type, enabled: true, intro: '', items: [] }, extra || {});
  }

  const TEMPLATES = [
    {
      id: 'media-coverage',
      label: 'Media coverage report',
      description: 'News releases and the coverage they led to, other coverage, opinion pieces, and upcoming opportunities.',
      title: 'Marin Media Coverage and Outreach Report',
      organization: 'County of Marin',
      sections: () => [
        section('news-releases', 'County-Issued News Releases and Resulting Coverage', 'release-coverage'),
        section('older-releases', 'Recent Coverage Resulting From Older News Releases', 'release-coverage'),
        section('other-coverage', 'Other Coverage Not Prompted by County Outreach', 'coverage-list'),
        section('opinion', 'Opinion Pieces About County-Related Work / Priorities', 'coverage-list'),
        section('upcoming', 'Upcoming Opportunities / Planned News Releases', 'manual-table'),
      ],
      footer: 'Know of an upcoming news opportunity or great story to tell?\n\nPlease reach out to PIO@marincounty.gov with details.',
      footerBold: true,
    },
    {
      id: 'custom',
      label: 'Custom report',
      description: 'Start with a title and a date range, then add the sections you want.',
      title: 'Media Report',
      organization: 'County of Marin',
      sections: () => [],
      footer: '',
      footerBold: false,
    },
  ];

  function templateById(id) {
    return TEMPLATES.filter((t) => t.id === id)[0] || TEMPLATES[0];
  }

  function createReport(templateId, todayIso) {
    const template = templateById(templateId);
    const period = periodFor('last-7', todayIso);
    return {
      schemaVersion: SCHEMA_VERSION,
      id: uid('report-'),
      type: template.id,
      title: template.title,
      organization: template.organization,
      preparedBy: '',
      description: '',
      periodPreset: 'last-7',
      period: period,
      sections: template.sections(),
      unplaced: [],
      footer: template.footer,
      footerBold: template.footerBold,
    };
  }

  // --- validation ---

  function normalizeCoverage(raw) {
    return {
      uid: cleanText(raw.uid, 60) || uid('c'),
      kind: 'coverage',
      origin: raw.origin === 'mentions' ? 'mentions' : 'manual',
      itemId: cleanText(raw.itemId, 80),
      date: isIsoDate(raw.date) ? raw.date : '',
      headline: cleanText(raw.headline),
      source: cleanText(raw.source),
      url: safeUrl(raw.url),
      sourceUrl: safeUrl(raw.sourceUrl),
      contentType: cleanText(raw.contentType, 40),
      monitors: Array.isArray(raw.monitors) ? raw.monitors.slice(0, 20).map((m) => cleanText(m, 120)) : [],
      notes: cleanText(raw.notes, LIMITS.long),
    };
  }

  function normalizeSection(raw, path, errors) {
    if (!raw || typeof raw !== 'object') {
      errors.push(path + ' is not a section.');
      return null;
    }
    if (SECTION_TYPES.indexOf(raw.type) < 0) {
      errors.push(path + ' has an unknown section type "' + cleanText(raw.type, 40) + '".');
      return null;
    }
    const out = section(cleanText(raw.id, 60) || uid('s'), cleanText(raw.title), raw.type, {
      enabled: raw.enabled !== false,
      intro: cleanText(raw.intro, LIMITS.long),
    });
    const items = Array.isArray(raw.items) ? raw.items : [];
    if (items.length > LIMITS.items) errors.push(path + ' has too many items (the limit is ' + LIMITS.items + ').');
    items.slice(0, LIMITS.items).forEach((item) => {
      if (!item || typeof item !== 'object') return;
      if (raw.type === 'release-coverage') {
        const release = newRelease(item);
        release.uid = cleanText(item.uid, 60) || release.uid;
        if (Array.isArray(item.coverage)) {
          if (item.coverage.length > LIMITS.coverage) errors.push(path + ' has a release with too many coverage items.');
          release.coverage = item.coverage.slice(0, LIMITS.coverage).filter((c) => c && typeof c === 'object').map(normalizeCoverage);
        }
        out.items.push(release);
      } else if (raw.type === 'manual-table') {
        const row = newRow(item);
        row.uid = cleanText(item.uid, 60) || row.uid;
        out.items.push(row);
      } else if (raw.type === 'text') {
        // Text sections keep their words in `intro`.
      } else {
        out.items.push(normalizeCoverage(item));
      }
    });
    return out;
  }

  // Checks and cleans a report from a file or a saved draft. Returns { ok, errors, report }.
  // Unknown fields are dropped, text is trimmed and length-limited, and links other than
  // http, https and mailto are removed.
  function validateReport(input) {
    const errors = [];
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return { ok: false, errors: ['This file does not contain a report.'], report: null };
    }
    const version = String(input.schemaVersion || '');
    if (!version) errors.push('This file has no report version, so it may not be a Marin Mentions report.');
    else if (version.split('.')[0] !== SCHEMA_VERSION.split('.')[0]) {
      errors.push('This report uses version ' + cleanText(version, 20) + ', but this page reads version ' + SCHEMA_VERSION.split('.')[0] + '.x.');
    }
    if (!input.period || !isIsoDate(input.period.start) || !isIsoDate(input.period.end)) {
      errors.push('The reporting period needs a start and end date in YYYY-MM-DD form.');
    } else if (input.period.start > input.period.end) {
      errors.push('The reporting period starts after it ends.');
    }
    if (!Array.isArray(input.sections)) errors.push('The report has no list of sections.');
    else if (input.sections.length > LIMITS.sections) errors.push('The report has too many sections (the limit is ' + LIMITS.sections + ').');
    if (errors.length) return { ok: false, errors: errors, report: null };

    const sections = [];
    input.sections.forEach((raw, index) => {
      const normalized = normalizeSection(raw, 'Section ' + (index + 1), errors);
      if (normalized) sections.push(normalized);
    });
    const unplaced = Array.isArray(input.unplaced) ? input.unplaced.slice(0, LIMITS.items).filter((c) => c && typeof c === 'object').map(normalizeCoverage) : [];
    if (errors.length) return { ok: false, errors: errors, report: null };
    const template = templateById(input.type);
    return {
      ok: true,
      errors: [],
      report: {
        schemaVersion: SCHEMA_VERSION,
        id: cleanText(input.id, 80) || uid('report-'),
        type: TEMPLATES.some((t) => t.id === input.type) ? input.type : template.id,
        title: cleanText(input.title) || 'Untitled report',
        organization: cleanText(input.organization),
        preparedBy: cleanText(input.preparedBy),
        description: cleanText(input.description, LIMITS.long),
        periodPreset: PERIOD_PRESETS.some((p) => p.id === input.periodPreset) ? input.periodPreset : 'custom',
        period: { start: input.period.start, end: input.period.end },
        sections: sections,
        unplaced: unplaced,
        footer: cleanText(input.footer, LIMITS.long),
        footerBold: Boolean(input.footerBold),
      },
    };
  }

  function toJson(report) {
    return JSON.stringify(report, null, 2);
  }

  function parseJson(text) {
    if (typeof text !== 'string' || text.length > LIMITS.json) {
      return { ok: false, errors: ['This file is too large to be a report.'], report: null };
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch (error) {
      return { ok: false, errors: ['This file is not valid JSON, so it cannot be read as a report.'], report: null };
    }
    return validateReport(data);
  }

  // --- changing a report (each returns a changed copy) ---

  function clone(report) {
    return JSON.parse(JSON.stringify(report));
  }

  function findSection(report, id) {
    return report.sections.filter((s) => s.id === id)[0] || null;
  }

  // Where an item lives: { list, index, owner } or null.
  function locate(report, itemUid) {
    const lists = [{ list: report.unplaced, owner: 'unplaced' }];
    report.sections.forEach((s) => {
      lists.push({ list: s.items, owner: s.id });
      s.items.forEach((item) => {
        if (item.kind === 'release') lists.push({ list: item.coverage, owner: s.id + '/' + item.uid });
      });
    });
    for (let i = 0; i < lists.length; i++) {
      const index = lists[i].list.findIndex((item) => item.uid === itemUid);
      if (index >= 0) return { list: lists[i].list, index: index, owner: lists[i].owner };
    }
    return null;
  }

  function hasMentionsItem(report, itemId) {
    if (!itemId) return false;
    let found = false;
    const check = (item) => { if (item.itemId === itemId) found = true; };
    report.unplaced.forEach(check);
    report.sections.forEach((s) => s.items.forEach((item) => {
      check(item);
      if (item.kind === 'release') item.coverage.forEach(check);
    }));
    return found;
  }

  function addUnplaced(report, snapshot) {
    const next = clone(report);
    if (snapshot.itemId && hasMentionsItem(next, snapshot.itemId)) return next;
    next.unplaced.push(snapshot);
    return next;
  }

  function addToSection(report, sectionId, item) {
    const next = clone(report);
    const target = findSection(next, sectionId);
    if (target) target.items.push(item);
    return next;
  }

  // Move an existing item (from the pool, another section, or a release) to a section.
  // For a release section, pass the release's uid to attach coverage to it.
  function placeItem(report, itemUid, sectionId, releaseUid) {
    const next = clone(report);
    const from = locate(next, itemUid);
    const target = findSection(next, sectionId);
    if (!from || !target) return next;
    const item = from.list[from.index];
    if (item.kind === 'release') {
      if (target.type !== 'release-coverage') return next;
      from.list.splice(from.index, 1);
      target.items.push(item);
      return next;
    }
    if (item.kind !== 'coverage') return next;
    if (target.type === 'release-coverage') {
      const release = target.items.filter((r) => r.uid === releaseUid)[0];
      if (!release) return next;
      from.list.splice(from.index, 1);
      release.coverage.push(item);
    } else if (target.type === 'coverage-list' || target.type === 'highlights') {
      from.list.splice(from.index, 1);
      target.items.push(item);
    }
    return next;
  }

  function unplaceItem(report, itemUid) {
    const next = clone(report);
    const from = locate(next, itemUid);
    if (!from || from.owner === 'unplaced') return next;
    const item = from.list[from.index];
    if (item.kind === 'coverage') {
      from.list.splice(from.index, 1);
      next.unplaced.push(item);
    }
    return next;
  }

  function removeItem(report, itemUid) {
    const next = clone(report);
    const from = locate(next, itemUid);
    if (!from) return next;
    const item = from.list[from.index];
    from.list.splice(from.index, 1);
    // Coverage under a removed release goes back to the pool rather than disappearing.
    if (item.kind === 'release') next.unplaced.push.apply(next.unplaced, item.coverage);
    return next;
  }

  function moveItemBy(report, itemUid, delta) {
    const next = clone(report);
    const from = locate(next, itemUid);
    if (!from) return next;
    const to = from.index + delta;
    if (to < 0 || to >= from.list.length) return next;
    const item = from.list.splice(from.index, 1)[0];
    from.list.splice(to, 0, item);
    return next;
  }

  function updateItem(report, itemUid, fields) {
    const next = clone(report);
    const from = locate(next, itemUid);
    if (!from) return next;
    const item = from.list[from.index];
    const text = (key, max) => { if (key in fields) item[key] = cleanText(fields[key], max); };
    if (item.kind === 'coverage') {
      text('headline'); text('source'); text('notes', LIMITS.long);
      if ('url' in fields) item.url = safeUrl(fields.url);
      if ('date' in fields) item.date = isIsoDate(fields.date) ? fields.date : '';
    } else if (item.kind === 'release') {
      text('department'); text('title');
      if ('url' in fields) item.url = safeUrl(fields.url);
      if ('date' in fields) item.date = isIsoDate(fields.date) ? fields.date : '';
    } else if (item.kind === 'row') {
      text('when', 80); text('department'); text('topic'); text('description', LIMITS.long);
      if ('url' in fields) item.url = safeUrl(fields.url);
    }
    return next;
  }

  function moveSectionBy(report, sectionId, delta) {
    const next = clone(report);
    const from = next.sections.findIndex((s) => s.id === sectionId);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= next.sections.length) return next;
    const moved = next.sections.splice(from, 1)[0];
    next.sections.splice(to, 0, moved);
    return next;
  }

  function updateSection(report, sectionId, fields) {
    const next = clone(report);
    const target = findSection(next, sectionId);
    if (!target) return next;
    if ('title' in fields) target.title = cleanText(fields.title);
    if ('intro' in fields) target.intro = cleanText(fields.intro, LIMITS.long);
    if ('enabled' in fields) target.enabled = Boolean(fields.enabled);
    return next;
  }

  function addSection(report, type, title) {
    const next = clone(report);
    if (SECTION_TYPES.indexOf(type) < 0 || next.sections.length >= LIMITS.sections) return next;
    next.sections.push(section(uid('s'), cleanText(title) || SECTION_TYPE_LABELS[type], type));
    return next;
  }

  // Deleting a section keeps its coverage: it goes back to the pool of unplaced items.
  function deleteSection(report, sectionId) {
    const next = clone(report);
    const index = next.sections.findIndex((s) => s.id === sectionId);
    if (index < 0) return next;
    const removed = next.sections.splice(index, 1)[0];
    removed.items.forEach((item) => {
      if (item.kind === 'coverage') next.unplaced.push(item);
      if (item.kind === 'release') next.unplaced.push.apply(next.unplaced, item.coverage);
    });
    return next;
  }

  function updateDetails(report, fields) {
    const next = clone(report);
    ['title', 'organization', 'preparedBy'].forEach((key) => { if (key in fields) next[key] = cleanText(fields[key]); });
    if ('description' in fields) next.description = cleanText(fields.description, LIMITS.long);
    if ('footer' in fields) next.footer = cleanText(fields.footer, LIMITS.long);
    if ('periodPreset' in fields && PERIOD_PRESETS.some((p) => p.id === fields.periodPreset)) next.periodPreset = fields.periodPreset;
    if ('period' in fields && fields.period && isIsoDate(fields.period.start) && isIsoDate(fields.period.end)) {
      next.period = { start: fields.period.start, end: fields.period.end };
    }
    return next;
  }

  // The section a County release belongs in by default: this period, or an older one.
  function releaseSectionFor(report, releaseDate) {
    const releaseSections = report.sections.filter((s) => s.type === 'release-coverage');
    if (!releaseSections.length) return null;
    const current = releaseSections.filter((s) => s.id === 'news-releases')[0] || releaseSections[0];
    const older = releaseSections.filter((s) => s.id === 'older-releases')[0];
    return older && !inPeriod(releaseDate, report.period) ? older : current;
  }

  return {
    SCHEMA_VERSION, TIME_ZONE, SECTION_TYPES, SECTION_TYPE_LABELS, TEMPLATES, PERIOD_PRESETS, LIMITS,
    cleanText, safeUrl, isIsoDate, addDays, pacificDate, formatDate, formatPeriod, periodFor, inPeriod, weekday,
    uid, snapshotFromMention, manualCoverage, newRelease, newRow, templateById, createReport,
    validateReport, parseJson, toJson, clone, findSection, locate, hasMentionsItem,
    addUnplaced, addToSection, placeItem, unplaceItem, removeItem, moveItemBy, updateItem,
    moveSectionBy, updateSection, addSection, deleteSection, updateDetails, releaseSectionFor,
  };
});
