// Reports: the report builder inside the Reports toggle of the Latest tab.
// Stages: Details, Coverage, Organize, Report. The report itself is plain data
// (core.js); everything shown or copied comes from render.js. This file only builds
// the screens, keeps a draft in this browser, and talks to app.js through `host`.
(function () {
  'use strict';

  const Core = window.ReportsCore;
  const Render = window.ReportsRender;
  if (!Core || !Render) return;

  const DRAFT_KEY = 'marinMentions.reportDraft.v1';
  const STAGES = [
    { id: 'details', label: 'Details' },
    { id: 'coverage', label: 'Coverage' },
    { id: 'organize', label: 'Organize' },
    { id: 'report', label: 'Report' },
  ];
  const ROW_LIMIT = 150;

  const ui = {
    host: null,
    root: null,
    report: null,
    stage: 'details',
    errors: [],
    flash: {}, // key of a control -> message shown next to it
    showAllRows: false,
    contentType: 'news-video',
    saveWarning: '',
    lastFocusKey: null,
  };

  // --- small helpers ---

  function h(tag, attrs, children) {
    const node = document.createElement(tag);
    Object.keys(attrs || {}).forEach((key) => {
      const value = attrs[key];
      if (value === false || value == null) return;
      if (key === 'text') node.textContent = value;
      else node.setAttribute(key, value === true ? '' : value);
    });
    [].concat(children || []).forEach((child) => { if (child != null) node.append(child); });
    return node;
  }

  function todayIso() { return Core.pacificDate(new Date()); }

  function announce(message) {
    if (ui.host && ui.host.announce) ui.host.announce(message);
  }

  function button(label, key, handler, extra) {
    const attrs = Object.assign({ type: 'button', class: 'secondary mm-copy-button', 'data-key': key }, extra || {});
    const b = h('button', attrs, [label]);
    b.addEventListener('click', handler);
    return b;
  }

  function field(label, control, help) {
    const id = 'rp-' + Math.random().toString(36).slice(2, 8);
    control.id = id;
    const wrap = h('div', { class: 'mm-rp-field' }, [h('label', { for: id, text: label }), control]);
    if (help) {
      const p = h('p', { class: 'app-help-text', id: id + '-help', text: help });
      control.setAttribute('aria-describedby', id + '-help');
      wrap.append(p);
    }
    return wrap;
  }

  function input(type, value, onInput, attrs) {
    const el = h('input', Object.assign({ type: type }, attrs || {}));
    el.value = value || '';
    el.addEventListener('input', () => onInput(el.value));
    return el;
  }

  function textarea(value, onInput, rows) {
    const el = h('textarea', { rows: rows || 3 });
    el.value = value || '';
    el.addEventListener('input', () => onInput(el.value));
    return el;
  }

  function selectOf(options, value, onChange) {
    const el = h('select');
    options.forEach((o) => {
      const opt = h('option', { value: o.value, text: o.label });
      if (o.value === value) opt.selected = true;
      el.append(opt);
    });
    el.addEventListener('change', () => onChange(el.value));
    return el;
  }

  function status(key) {
    return h('p', { class: 'app-help-text mm-rp-status', role: 'status', 'data-status-for': key, text: ui.flash[key] || '' });
  }

  function say(key, message) {
    ui.flash = {};
    ui.flash[key] = message;
    const el = ui.root.querySelector('[data-status-for="' + key + '"]');
    if (el) el.textContent = message;
    announce(message);
  }

  // --- draft ---

  let saveTimer = 0;
  function writeDraft() {
    if (!ui.report) return;
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ savedAt: new Date().toISOString(), report: ui.report }));
      ui.saveWarning = '';
    } catch (error) {
      ui.saveWarning = 'This browser would not save a draft. Download the report file to keep your work.';
      const el = ui.root && ui.root.querySelector('[data-save-warning]');
      if (el) el.textContent = ui.saveWarning;
    }
  }

  function saveDraft() {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => { saveTimer = 0; writeDraft(); }, 300);
  }

  // Write a pending draft right away, for example when the page is closed or reloaded.
  function flushDraft() {
    if (!saveTimer) return;
    window.clearTimeout(saveTimer);
    saveTimer = 0;
    writeDraft();
  }
  window.addEventListener('pagehide', flushDraft);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushDraft(); });

  function loadDraft() {
    try {
      const raw = window.localStorage.getItem(DRAFT_KEY);
      if (!raw) return null;
      const saved = JSON.parse(raw);
      const result = Core.validateReport(saved.report);
      return result.ok ? { report: result.report, savedAt: saved.savedAt } : null;
    } catch (error) {
      return null;
    }
  }

  function clearDraft() {
    try { window.localStorage.removeItem(DRAFT_KEY); } catch (error) { /* nothing to clear */ }
  }

  function setReport(next, focusKey) {
    ui.report = next;
    saveDraft();
    render(focusKey);
  }

  // Changes that should not redraw the screen (typing in a field).
  function quietChange(next) {
    ui.report = next;
    saveDraft();
  }

  // --- dialogs ---

  function openForm(config) {
    const dialog = h('dialog', { class: 'mm-rp-dialog', 'aria-labelledby': 'rp-dialog-title' });
    const form = h('form', { method: 'dialog' });
    const inputs = {};
    form.append(h('h3', { id: 'rp-dialog-title', text: config.title }));
    config.fields.forEach((f) => {
      const control = f.type === 'textarea' ? h('textarea', { rows: 3 }) : h('input', { type: f.type || 'text' });
      if (f.required) control.required = true;
      control.value = f.value || '';
      inputs[f.name] = control;
      form.append(field(f.label, control, f.help));
    });
    const error = h('p', { class: 'app-error', role: 'alert' });
    const submit = h('button', { type: 'submit', text: config.submitLabel || 'Save' });
    const cancel = h('button', { type: 'button', class: 'secondary', text: 'Cancel' });
    cancel.addEventListener('click', () => dialog.close());
    form.append(error, h('div', { class: 'mm-rp-actions' }, [submit, cancel]));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const values = {};
      Object.keys(inputs).forEach((name) => { values[name] = inputs[name].value; });
      const problem = config.validate ? config.validate(values) : '';
      if (problem) {
        error.textContent = problem;
        return;
      }
      dialog.close();
      config.onSubmit(values);
    });
    dialog.addEventListener('close', () => {
      dialog.remove();
      if (config.returnFocusKey) focusKey(config.returnFocusKey);
    });
    dialog.append(h('article', {}, form));
    document.body.append(dialog);
    dialog.showModal();
    const first = form.querySelector('input,textarea');
    if (first) first.focus();
  }

  function dateProblem(value, label) {
    return value && !Core.isIsoDate(value) ? label + ' must be a date.' : '';
  }

  function coverageForm(returnFocusKey, onSubmit, existing) {
    openForm({
      title: existing ? 'Edit coverage' : 'Add coverage by hand',
      returnFocusKey: returnFocusKey,
      fields: [
        { name: 'date', label: 'Date', type: 'date', value: existing ? existing.date : '' },
        { name: 'headline', label: 'Headline', required: true, value: existing ? existing.headline : '' },
        { name: 'source', label: 'Publication', value: existing ? existing.source : '' },
        { name: 'url', label: 'Link (web address)', type: 'url', value: existing ? existing.url : '', help: 'Only web and email links are kept.' },
        { name: 'notes', label: 'Notes (optional)', type: 'textarea', value: existing ? existing.notes : '' },
      ],
      validate: (v) => !v.headline.trim() ? 'Enter a headline.' : dateProblem(v.date, 'Date'),
      onSubmit: onSubmit,
    });
  }

  function releaseForm(returnFocusKey, onSubmit, existing) {
    openForm({
      title: existing ? 'Edit news release' : 'Add a news release',
      returnFocusKey: returnFocusKey,
      fields: [
        { name: 'date', label: 'Release date', type: 'date', value: existing ? existing.date : '' },
        { name: 'department', label: 'Department', value: existing ? existing.department : '' },
        { name: 'title', label: 'Release title', required: true, value: existing ? existing.title : '' },
        { name: 'url', label: 'Link (web address)', type: 'url', value: existing ? existing.url : '' },
      ],
      validate: (v) => !v.title.trim() ? 'Enter a release title.' : dateProblem(v.date, 'Release date'),
      onSubmit: onSubmit,
    });
  }

  function rowForm(returnFocusKey, onSubmit, existing) {
    openForm({
      title: existing ? 'Edit row' : 'Add a row',
      returnFocusKey: returnFocusKey,
      fields: [
        { name: 'when', label: 'Tentative date', value: existing ? existing.when : '', help: 'For example "Oct 14" or "Week of Oct 20".' },
        { name: 'department', label: 'Department', value: existing ? existing.department : '' },
        { name: 'topic', label: 'Topic', required: true, value: existing ? existing.topic : '' },
        { name: 'description', label: 'Details (optional)', type: 'textarea', value: existing ? existing.description : '' },
        { name: 'url', label: 'Link (optional)', type: 'url', value: existing ? existing.url : '' },
      ],
      validate: (v) => !v.topic.trim() ? 'Enter a topic.' : '',
      onSubmit: onSubmit,
    });
  }

  function editItem(item, key) {
    if (item.kind === 'coverage') coverageForm(key, (v) => setReport(Core.updateItem(ui.report, item.uid, v), key), item);
    else if (item.kind === 'release') releaseForm(key, (v) => setReport(Core.updateItem(ui.report, item.uid, v), key), item);
    else rowForm(key, (v) => setReport(Core.updateItem(ui.report, item.uid, v), key), item);
  }

  // --- focus ---

  function focusKey(key) {
    const el = ui.root && ui.root.querySelector('[data-key="' + key + '"]');
    if (el) { el.focus(); return true; }
    return false;
  }

  function currentKey() {
    const active = document.activeElement;
    return active && ui.root && ui.root.contains(active) ? active.getAttribute('data-key') : null;
  }

  // --- screens ---

  function stageNav() {
    const list = h('ol', { class: 'mm-rp-stages', 'aria-label': 'Report steps' });
    STAGES.forEach((s, i) => {
      const b = h('button', { type: 'button', class: 'mm-tab', 'data-key': 'stage-' + s.id, 'aria-current': ui.stage === s.id ? 'step' : false }, [(i + 1) + '. ' + s.label]);
      b.addEventListener('click', () => { ui.stage = s.id; ui.flash = {}; render('stage-heading'); });
      list.append(h('li', {}, b));
    });
    return list;
  }

  function startScreen() {
    const root = h('div', {});
    root.append(h('h3', { id: 'rp-heading', tabindex: '-1', 'data-key': 'stage-heading', text: 'Create a report' }));
    if (ui.errors.length) {
      root.append(h('div', { class: 'app-error', role: 'alert' }, [h('p', { text: 'That file could not be opened:' }),
        h('ul', {}, ui.errors.map((e) => h('li', { text: e })))]));
    }
    const grid = h('div', { class: 'mm-rp-templates' });
    Core.TEMPLATES.forEach((t) => {
      const card = h('div', { class: 'app-card' }, [h('h4', { text: t.label }), h('p', { text: t.description })]);
      card.append(button('Create ' + t.label.toLowerCase(), 'create-' + t.id, () => {
        ui.errors = [];
        ui.report = Core.createReport(t.id, todayIso());
        ui.stage = 'details';
        saveDraft();
        render('stage-heading');
      }));
      grid.append(card);
    });
    root.append(grid);
    const draft = loadDraft();
    if (draft) {
      const saved = new Date(draft.savedAt);
      const box = h('div', { class: 'app-card' }, [h('h4', { text: 'Continue your saved draft' }),
        h('p', { text: draft.report.title + ' (saved ' + saved.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ')' }),
        h('p', { class: 'app-help-text', text: 'Drafts are kept only in this browser on this device.' })]);
      box.append(h('div', { class: 'mm-rp-actions' }, [
        button('Continue', 'continue-draft', () => { ui.report = draft.report; ui.stage = 'organize'; render('stage-heading'); }, { 'aria-label': 'Continue your saved draft' }),
        button('Discard', 'discard-draft', () => { clearDraft(); render('create-media-coverage'); }, { 'aria-label': 'Discard your saved draft' }),
      ]));
      root.append(box);
    }
    root.append(importControl());
    return root;
  }

  function importControl() {
    const file = h('input', { type: 'file', accept: '.json,application/json' });
    file.addEventListener('change', () => {
      const chosen = file.files && file.files[0];
      if (!chosen) return;
      const reader = new FileReader();
      reader.onload = () => {
        const result = Core.parseJson(String(reader.result || ''));
        if (!result.ok) {
          ui.errors = result.errors;
          ui.report = null;
          render('stage-heading');
          return;
        }
        ui.errors = [];
        ui.report = result.report;
        ui.stage = 'organize';
        saveDraft();
        render('stage-heading');
        announce('Report opened.');
      };
      reader.onerror = () => { ui.errors = ['The file could not be read.']; render('stage-heading'); };
      reader.readAsText(chosen);
    });
    return h('div', { class: 'app-card' }, [h('h4', { text: 'Open a saved report' }),
      field('Report file (.json)', file, 'Use a file you downloaded from Reports with "Download report file".')]);
  }

  // Details
  function detailsScreen() {
    const r = ui.report;
    const root = h('div', {});
    root.append(h('h3', { id: 'rp-heading', tabindex: '-1', 'data-key': 'stage-heading', text: 'Report details' }));
    root.append(field('Report title', input('text', r.title, (v) => quietChange(Core.updateDetails(ui.report, { title: v })))));
    root.append(field('Organization', input('text', r.organization, (v) => quietChange(Core.updateDetails(ui.report, { organization: v })))));
    root.append(field('Prepared by (optional)', input('text', r.preparedBy, (v) => quietChange(Core.updateDetails(ui.report, { preparedBy: v })))));
    root.append(field('Description (optional)', textarea(r.description, (v) => quietChange(Core.updateDetails(ui.report, { description: v }))),
      'Shown under the report title.'));

    const preset = selectOf(Core.PERIOD_PRESETS.map((p) => ({ value: p.id, label: p.label })), r.periodPreset, (value) => {
      const period = Core.periodFor(value, todayIso());
      setReport(Core.updateDetails(ui.report, period ? { periodPreset: value, period: period } : { periodPreset: 'custom' }), 'period-preset');
    });
    preset.setAttribute('data-key', 'period-preset');
    root.append(field('Reporting period', preset));
    const start = input('date', r.period.start, () => {});
    const end = input('date', r.period.end, () => {});
    const apply = () => {
      if (Core.isIsoDate(start.value) && Core.isIsoDate(end.value) && start.value <= end.value) {
        setReport(Core.updateDetails(ui.report, { periodPreset: 'custom', period: { start: start.value, end: end.value } }), 'period-start');
      } else {
        say('period', 'Enter a start date that is on or before the end date.');
      }
    };
    start.setAttribute('data-key', 'period-start');
    end.setAttribute('data-key', 'period-end');
    start.addEventListener('change', apply);
    end.addEventListener('change', apply);
    root.append(h('div', { class: 'mm-rp-dates' }, [field('Start date', start), field('End date', end)]));
    root.append(status('period'));
    root.append(h('p', { class: 'mm-rp-period' }, [h('strong', { text: 'Reporting period: ' }), Core.formatPeriod(r.period.start, r.period.end)]));
    root.append(field('Closing note (optional)', textarea(r.footer, (v) => quietChange(Core.updateDetails(ui.report, { footer: v })), 4),
      'Shown at the end of the report. Leave blank for none.'));
    root.append(h('div', { class: 'mm-rp-actions' }, [button('Next: choose coverage', 'next-coverage', () => { ui.stage = 'coverage'; render('stage-heading'); })]));
    return root;
  }

  // Coverage
  function inReport(itemId) { return Core.hasMentionsItem(ui.report, itemId); }

  function coverageScreen() {
    const r = ui.report;
    const host = ui.host;
    const root = h('div', {});
    root.append(h('h3', { id: 'rp-heading', tabindex: '-1', 'data-key': 'stage-heading', text: 'Choose coverage' }));
    root.append(h('p', {}, ['Showing items from ', h('strong', { text: Core.formatPeriod(r.period.start, r.period.end) }),
      '. Use the search and filters on the left to narrow the list. The Time filter is not used here; the report dates are.']));
    root.append(button('Change dates', 'change-dates', () => { ui.stage = 'details'; render('stage-heading'); }));

    // County releases in the period
    const releases = host.releases(r.period).filter((item) => !inReport(String(item.id)));
    root.append(h('h4', { text: 'County news releases in this period' }));
    if (!releases.length) root.append(h('p', { class: 'app-help-text', text: 'No new County releases found for these dates, or all have been added.' }));
    else {
      const table = h('table', {}, [h('thead', {}, h('tr', {}, ['Date', 'Release', 'Source', 'Add'].map((t) => h('th', { scope: 'col', text: t })))), h('tbody')]);
      releases.slice(0, 40).forEach((item) => {
        const snap = Core.snapshotFromMention(item, host.monitorNames());
        const add = button('Add as release', 'add-release-' + item.id, () => {
          const release = Core.newRelease({ origin: 'mentions', itemId: String(item.id), date: snap.date, department: snap.source, title: snap.headline, url: snap.url });
          const target = Core.releaseSectionFor(ui.report, snap.date);
          if (!target) { say('releases', 'Add a "News releases with coverage" section in Organize first.'); return; }
          setReport(Core.addToSection(ui.report, target.id, release), 'add-release-next');
          say('releases', 'Added "' + snap.headline + '" to ' + target.title + '.');
        }, { 'aria-label': 'Add as release: ' + snap.headline });
        table.lastChild.append(h('tr', {}, [h('td', { text: Core.formatDate(snap.date) }), h('td', { text: snap.headline }), h('td', { text: snap.source }), h('td', {}, add)]));
      });
      root.append(table);
    }
    root.append(h('div', { class: 'mm-rp-actions' }, [button('Add a news release by hand', 'add-release-hand', () => {
      releaseForm('add-release-hand', (v) => {
        const release = Core.newRelease(v);
        const target = Core.releaseSectionFor(ui.report, release.date) || null;
        if (!target) { say('releases', 'Add a "News releases with coverage" section in Organize first.'); return; }
        setReport(Core.addToSection(ui.report, target.id, release), 'add-release-hand');
      });
    })]), status('releases'));

    // Coverage candidates
    root.append(h('h4', { text: 'Coverage' }));
    const typeSelect = selectOf([
      { value: 'news-video', label: 'News and video' }, { value: 'all', label: 'All types, including social' },
      { value: 'news', label: 'News only' }, { value: 'video', label: 'Video only' }, { value: 'social', label: 'Social only' },
    ], ui.contentType, (value) => { ui.contentType = value; ui.showAllRows = false; render('content-type'); });
    typeSelect.setAttribute('data-key', 'content-type');
    root.append(field('Type of coverage', typeSelect));
    const rows = host.candidates(r.period, ui.contentType);
    const selectedCount = rows.filter((item) => inReport(String(item.id))).length;
    root.append(h('p', { 'aria-live': 'polite', text: rows.length + ' item' + (rows.length === 1 ? '' : 's') + ' match. ' + selectedCount + ' selected.' }));
    root.append(h('div', { class: 'mm-rp-actions' }, [
      button('Select all shown', 'select-all-shown', () => {
        let next = ui.report;
        rows.forEach((item) => { if (!Core.hasMentionsItem(next, String(item.id))) next = Core.addUnplaced(next, Core.snapshotFromMention(item, host.monitorNames())); });
        setReport(next, 'select-all-shown');
        say('select', 'Selected ' + rows.length + ' items.');
      }),
      button('Clear all shown', 'clear-all-shown', () => {
        let next = ui.report;
        rows.forEach((item) => {
          const found = findByItemId(next, String(item.id));
          if (found) next = Core.removeItem(next, found.uid);
        });
        setReport(next, 'clear-all-shown');
        say('select', 'Cleared the shown items.');
      }),
      button('Add coverage by hand', 'add-coverage-hand', () => coverageForm('add-coverage-hand', (v) => setReport(Core.addUnplaced(ui.report, Core.manualCoverage(v)), 'add-coverage-hand'))),
    ]), status('select'));
    const clips = host.clipped();
    if (clips.length) {
      root.append(button('Add the ' + clips.length + ' item' + (clips.length === 1 ? '' : 's') + ' I selected in the list', 'use-clips', () => {
        let next = ui.report;
        clips.forEach((clip) => {
          const snap = Core.snapshotFromMention(clip.item, host.monitorNames());
          if (!Core.hasMentionsItem(next, snap.itemId)) next = Core.addUnplaced(next, snap);
          if (clip.release) {
            let relUid = findByItemId(next, String(clip.release.id));
            if (!relUid) {
              const rs = Core.snapshotFromMention(clip.release, host.monitorNames());
              const release = Core.newRelease({ origin: 'mentions', itemId: String(clip.release.id), date: rs.date, department: rs.source, title: rs.headline, url: rs.url });
              const target = Core.releaseSectionFor(next, rs.date);
              if (target) { next = Core.addToSection(next, target.id, release); relUid = release; }
            }
            const placed = findByItemId(next, snap.itemId);
            const sectionOfRelease = relUid && next.sections.filter((s) => s.items.some((i) => i.uid === relUid.uid))[0];
            if (placed && sectionOfRelease) next = Core.placeItem(next, placed.uid, sectionOfRelease.id, relUid.uid);
          }
        });
        setReport(next, 'use-clips');
        say('select', 'Added your selections. Open Organize to place them.');
      }));
    }
    if (rows.length) {
      const shown = ui.showAllRows ? rows : rows.slice(0, ROW_LIMIT);
      const table = h('table', {}, [h('thead', {}, h('tr', {}, ['Select', 'Date', 'Headline', 'Source', 'Type'].map((t) => h('th', { scope: 'col', text: t })))), h('tbody')]);
      shown.forEach((item) => {
        const snap = Core.snapshotFromMention(item, host.monitorNames());
        const box = h('input', { type: 'checkbox', 'data-key': 'pick-' + item.id, 'aria-label': 'Select: ' + snap.headline + ', ' + Core.formatDate(snap.date) });
        box.checked = inReport(String(item.id));
        box.addEventListener('change', () => {
          if (box.checked) setReport(Core.addUnplaced(ui.report, snap), 'pick-' + item.id);
          else {
            const found = findByItemId(ui.report, String(item.id));
            if (found) setReport(Core.removeItem(ui.report, found.uid), 'pick-' + item.id);
          }
        });
        table.lastChild.append(h('tr', {}, [h('td', {}, box), h('td', { text: Core.formatDate(snap.date) }), h('td', { text: snap.headline }), h('td', { text: snap.source }), h('td', { text: snap.contentType })]));
      });
      root.append(h('div', { class: 'mm-rp-scroll', tabindex: '0', role: 'region', 'aria-label': 'Coverage that matches' }, table));
      if (rows.length > shown.length) root.append(button('Show all ' + rows.length, 'show-all-rows', () => { ui.showAllRows = true; render('show-all-rows'); }));
    }
    root.append(h('div', { class: 'mm-rp-actions' }, [button('Next: organize', 'next-organize', () => { ui.stage = 'organize'; render('stage-heading'); })]));
    return root;
  }

  function findByItemId(report, itemId) {
    let found = null;
    const check = (item) => { if (item.itemId === itemId) found = item; };
    report.unplaced.forEach(check);
    report.sections.forEach((s) => s.items.forEach((item) => { check(item); if (item.kind === 'release') item.coverage.forEach(check); }));
    return found;
  }

  // Organize
  function itemLabel(item) {
    if (item.kind === 'release') return [item.date ? Core.formatDate(item.date) : '', item.title].filter(Boolean).join(' – ');
    if (item.kind === 'row') return [item.when, item.topic].filter(Boolean).join(' – ');
    return [item.date ? Core.formatDate(item.date) : '', item.headline, item.source].filter(Boolean).join(' – ');
  }

  function destinationOptions(report) {
    const options = [{ value: '', label: 'Place in…' }];
    report.sections.forEach((s) => {
      if (s.type === 'coverage-list' || s.type === 'highlights') options.push({ value: s.id + '|', label: s.title });
      if (s.type === 'release-coverage') s.items.forEach((rel) => options.push({ value: s.id + '|' + rel.uid, label: 'Coverage of: ' + (rel.title || 'release') }));
    });
    return options;
  }

  function itemRow(item, key, opts) {
    const li = h('li', { class: 'mm-rp-item' });
    li.append(h('span', { class: 'mm-rp-item__text', text: itemLabel(item) || 'Untitled' }));
    const label = itemLabel(item) || 'item';
    const controls = h('span', { class: 'mm-rp-item__controls' });
    controls.append(button('Edit', key + '-edit', () => editItem(item, key + '-edit'), { 'aria-label': 'Edit: ' + label }));
    if (!opts.pool) {
      controls.append(button('Move up', key + '-up', () => setReport(Core.moveItemBy(ui.report, item.uid, -1), key + '-up'), { 'aria-label': 'Move up: ' + label }));
      controls.append(button('Move down', key + '-down', () => setReport(Core.moveItemBy(ui.report, item.uid, 1), key + '-down'), { 'aria-label': 'Move down: ' + label }));
    }
    if (item.kind === 'coverage') {
      const dest = selectOf(destinationOptions(ui.report), '', (value) => {
        if (!value) return;
        const parts = value.split('|');
        setReport(Core.placeItem(ui.report, item.uid, parts[0], parts[1] || undefined), 'organize-heading');
        announce('Moved.');
      });
      dest.setAttribute('aria-label', 'Move to a section: ' + label);
      controls.append(dest);
      if (!opts.pool) controls.append(button('Take out of section', key + '-unplace', () => setReport(Core.unplaceItem(ui.report, item.uid), 'organize-heading'), { 'aria-label': 'Take out of section: ' + label }));
    }
    controls.append(button('Remove', key + '-remove', () => setReport(Core.removeItem(ui.report, item.uid), 'organize-heading'), { 'aria-label': 'Remove: ' + label }));
    li.append(controls);
    if (item.kind === 'release') {
      const inner = h('ul', { class: 'mm-rp-nested', 'aria-label': 'Coverage of ' + (item.title || 'this release') });
      item.coverage.forEach((c, i) => inner.append(itemRow(c, key + '-c' + i, {})));
      if (!item.coverage.length) inner.append(h('li', { class: 'app-help-text', text: 'No coverage yet. Place coverage here with "Place in…".' }));
      li.append(inner);
    }
    return li;
  }

  function sectionBlock(section, index, total) {
    const key = 'sec-' + section.id;
    const wrap = h('section', { class: 'app-card mm-rp-section', 'aria-labelledby': key + '-title' });
    wrap.append(h('h4', { id: key + '-title', text: section.title }));
    const top = h('div', { class: 'mm-rp-section__top' });
    const title = input('text', section.title, (v) => quietChange(Core.updateSection(ui.report, section.id, { title: v })));
    title.setAttribute('data-key', key + '-rename');
    title.addEventListener('change', () => render(key + '-rename'));
    top.append(field('Section title', title));
    const show = h('input', { type: 'checkbox', 'data-key': key + '-show' });
    show.checked = section.enabled;
    show.addEventListener('change', () => setReport(Core.updateSection(ui.report, section.id, { enabled: show.checked }), key + '-show'));
    top.append(h('div', { class: 'mm-rp-field' }, [h('label', {}, [show, ' Show in report'])]));
    wrap.append(top);
    wrap.append(h('div', { class: 'mm-rp-actions' }, [
      button('Move section up', key + '-sup', () => setReport(Core.moveSectionBy(ui.report, section.id, -1), key + '-sup'), { 'aria-label': 'Move section up: ' + section.title, disabled: index === 0 }),
      button('Move section down', key + '-sdown', () => setReport(Core.moveSectionBy(ui.report, section.id, 1), key + '-sdown'), { 'aria-label': 'Move section down: ' + section.title, disabled: index === total - 1 }),
      button('Delete section', key + '-delete', () => setReport(Core.deleteSection(ui.report, section.id), 'organize-heading'), { 'aria-label': 'Delete section: ' + section.title }),
    ]));
    wrap.append(field(section.type === 'text' ? 'Text' : 'Text above the section (optional)', textarea(section.intro, (v) => quietChange(Core.updateSection(ui.report, section.id, { intro: v })), section.type === 'text' ? 5 : 2)));
    if (section.type !== 'text') {
      const list = h('ol', { class: 'mm-rp-items', 'aria-label': section.title });
      section.items.forEach((item, i) => list.append(itemRow(item, key + '-i' + i, {})));
      if (!section.items.length) list.append(h('li', { class: 'app-help-text', text: 'Nothing here yet.' }));
      wrap.append(list);
      const addRow = h('div', { class: 'mm-rp-actions' });
      if (section.type === 'release-coverage') addRow.append(button('Add a news release', key + '-add', () => releaseForm(key + '-add', (v) => setReport(Core.addToSection(ui.report, section.id, Core.newRelease(v)), key + '-add'))));
      else if (section.type === 'manual-table') addRow.append(button('Add a row', key + '-add', () => rowForm(key + '-add', (v) => setReport(Core.addToSection(ui.report, section.id, Core.newRow(v)), key + '-add'))));
      else addRow.append(button('Add coverage by hand', key + '-add', () => coverageForm(key + '-add', (v) => setReport(Core.addToSection(ui.report, section.id, Core.manualCoverage(v)), key + '-add'))));
      wrap.append(addRow);
    }
    return wrap;
  }

  function organizeScreen() {
    const r = ui.report;
    const root = h('div', {});
    root.append(h('h3', { id: 'rp-heading', tabindex: '-1', 'data-key': 'organize-heading', text: 'Organize the report' }));
    root.append(h('p', { text: 'Place coverage in sections, put things in order, and edit what shows. Everything has buttons for moving, so nothing needs dragging.' }));
    const pool = h('section', { class: 'app-card', 'aria-labelledby': 'pool-title' });
    pool.append(h('h4', { id: 'pool-title', text: 'Not yet placed (' + r.unplaced.length + ')' }));
    pool.append(h('p', { class: 'app-help-text', text: 'These items are not in the report until you place them in a section.' }));
    const list = h('ul', { class: 'mm-rp-items', 'aria-label': 'Items not yet placed' });
    r.unplaced.forEach((item, i) => list.append(itemRow(item, 'pool-' + i, { pool: true })));
    if (!r.unplaced.length) list.append(h('li', { class: 'app-help-text', text: 'Nothing waiting. Choose coverage on the Coverage step.' }));
    pool.append(list);
    root.append(pool);
    r.sections.forEach((s, i) => root.append(sectionBlock(s, i, r.sections.length)));
    // Add a section
    let newType = 'coverage-list';
    let newTitle = '';
    const type = selectOf(Core.SECTION_TYPES.map((t) => ({ value: t, label: Core.SECTION_TYPE_LABELS[t] })), newType, (v) => { newType = v; });
    const title = input('text', '', (v) => { newTitle = v; });
    root.append(h('div', { class: 'app-card' }, [h('h4', { text: 'Add a section' }), field('Section type', type), field('Section title', title),
      button('Add section', 'add-section', () => setReport(Core.addSection(ui.report, newType, newTitle), 'add-section'))]));
    root.append(h('div', { class: 'mm-rp-actions' }, [button('Next: report', 'next-report', () => { ui.stage = 'report'; render('stage-heading'); })]));
    return root;
  }

  // Report
  function download(filename, type, text) {
    const url = URL.createObjectURL(new Blob([text], { type: type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function fileName(ext) {
    return (ui.report.title || 'report').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() + '-' + ui.report.period.end + '.' + ext;
  }

  // Put HTML and plain text on the clipboard. The async clipboard gives Word clean markup;
  // if it is unavailable, fall back to the hidden-selection copy used elsewhere in Marin Mentions.
  async function copyHtml(html, text) {
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([new ClipboardItem({
          'text/html': new Blob(['<html><body>' + html + '</body></html>'], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        })]);
        return true;
      }
    } catch (error) { /* fall through to the other copy method */ }
    return ui.host.copyRich(html, text);
  }

  async function copyReport(key, onlySectionId) {
    const html = Render.renderReport(ui.report, { onlySectionId: onlySectionId });
    const text = Render.toPlainText(ui.report, { onlySectionId: onlySectionId });
    const ok = await copyHtml(html, text);
    say(key, ok ? (onlySectionId ? 'Section copied. Paste it into Word.' : 'Report copied. Paste it into Word.')
      : "Couldn't copy automatically. Select the text in the box below and copy it.");
  }

  function reportScreen() {
    const r = ui.report;
    const root = h('div', {});
    root.append(h('h3', { id: 'rp-heading', tabindex: '-1', 'data-key': 'stage-heading', text: 'Your report' }));
    root.append(h('div', { class: 'mm-rp-actions' }, [
      button('Copy for Word', 'copy-report', () => copyReport('copy-report')),
      button('Download HTML', 'download-html', () => { download(fileName('html'), 'text/html', Render.standaloneHtml(r)); say('copy-report', 'Downloaded the report as an HTML file.'); }),
      button('Download report file', 'download-json', () => { download(fileName('json'), 'application/json', Core.toJson(r)); say('copy-report', 'Downloaded the report file. Use it later with "Open a saved report".'); }),
      button('Close report', 'close-report', () => { ui.report = null; ui.errors = []; render('stage-heading'); }),
    ]));
    root.append(status('copy-report'));
    root.append(h('p', { class: 'app-help-text', 'data-save-warning': true, text: ui.saveWarning }));
    const doc = h('div', { class: 'mm-rp-doc', id: 'report-document' });
    doc.innerHTML = Render.renderReport(r); // every value is escaped by the renderer
    root.append(h('h4', { text: 'Report' }), doc);
    return root;
  }

  // --- main ---

  function render(focusTarget) {
    if (!ui.root) return;
    const keep = focusTarget || currentKey();
    ui.root.textContent = '';
    if (!ui.report) {
      ui.root.append(startScreen());
    } else {
      ui.root.append(stageNav());
      const screens = { details: detailsScreen, coverage: coverageScreen, organize: organizeScreen, report: reportScreen };
      ui.root.append(screens[ui.stage]());
    }
    if (keep) {
      if (!focusKey(keep)) {
        const heading = ui.root.querySelector('#rp-heading');
        if (heading && focusTarget) heading.focus();
      }
    }
  }

  function init(host) {
    if (ui.host) { ui.host = host; return; } // data refreshes keep the report being edited
    ui.host = host;
    ui.root = document.getElementById('reports-root');
    if (!ui.root) return;
    // The builder sits inside the filter form; Enter in a field must not submit it (that refreshes the data).
    ui.root.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && event.target.tagName === 'INPUT' && event.target.type !== 'checkbox' && event.target.type !== 'file') event.preventDefault();
    });
    render();
  }

  // Called when the sidebar filters or data change, so the candidate list stays current.
  function refresh() {
    if (!ui.root || !ui.host || ui.stage !== 'coverage' || !ui.report) return;
    const panel = ui.root.closest('#reports-panel');
    if (panel && panel.hidden) return;
    const keep = currentKey();
    render(keep);
  }

  // Move focus to the builder's heading when the Reports toggle is turned on.
  function focusStart() {
    const heading = ui.root && ui.root.querySelector('#rp-heading');
    if (heading) heading.focus();
  }

  window.ReportsUI = { init: init, refresh: refresh, focusStart: focusStart };
})();
