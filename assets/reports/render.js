// Reports: turns a report (plain data, see core.js) into semantic HTML, plain text, or a
// standalone HTML document. The on-screen report, Copy for Word, Copy section, and Download
// HTML all use these same functions, so they cannot drift apart.
//
// All text is escaped here. Tables carry border and cellpadding attributes (not CSS) because
// Word draws table gridlines from attributes when it pastes HTML. No classes, scripts, or
// layout CSS appear in the output, so Word can restyle it freely.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else root.ReportsRender = factory(root.ReportsCore);
})(typeof self !== 'undefined' ? self : this, function (Core) {
  'use strict';

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function paragraphs(text) {
    return String(text || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  }

  // Plain text to HTML paragraphs; email addresses become mailto links.
  function textHtml(text, bold) {
    return paragraphs(text).map((p) => {
      const linked = esc(p).replace(/\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g,
        (m) => '<a href="mailto:' + m + '">' + m + '</a>').replace(/\n/g, '<br>');
      return '<p>' + (bold ? '<strong>' + linked + '</strong>' : linked) + '</p>';
    }).join('\n');
  }

  function link(url, label) {
    return url ? '<a href="' + esc(url) + '">' + esc(label) + '</a>' : esc(label);
  }

  const TABLE = '<table border="1" cellpadding="6" cellspacing="0">';

  function th(label) { return '<th scope="col">' + esc(label) + '</th>'; }

  function coverageNote(item) {
    const bits = [item.source, item.date ? Core.formatDate(item.date) : ''].filter(Boolean);
    return bits.length ? ' (' + esc(bits.join(', ')) + ')' : '';
  }

  function releaseTable(items) {
    const head = '<thead><tr>' + th('Date') + th('Department') + th('News release') + th('Resulting coverage') + '</tr></thead>';
    const rows = items.map((r) => {
      const coverage = r.coverage.length
        ? '<ul>' + r.coverage.map((c) => '<li>' + link(c.url, c.headline || c.source || 'Untitled') + coverageNote(c) +
          (c.notes ? '<br>' + esc(c.notes) : '') + '</li>').join('') + '</ul>'
        : 'No coverage added yet';
      return '<tr><td>' + esc(r.date ? Core.formatDate(r.date) : '') + '</td><td>' + esc(r.department) + '</td><td>' +
        link(r.url, r.title || 'Untitled release') + '</td><td>' + coverage + '</td></tr>';
    }).join('\n');
    return TABLE + '\n' + head + '\n<tbody>\n' + rows + '\n</tbody>\n</table>';
  }

  function coverageTable(items) {
    const head = '<thead><tr>' + th('Date') + th('Headline') + th('Publication') + '</tr></thead>';
    const rows = items.map((c) => '<tr><td>' + esc(c.date ? Core.formatDate(c.date) : '') + '</td><td>' +
      link(c.url, c.headline || 'Untitled') + (c.notes ? '<br>' + esc(c.notes) : '') + '</td><td>' + esc(c.source) + '</td></tr>').join('\n');
    return TABLE + '\n' + head + '\n<tbody>\n' + rows + '\n</tbody>\n</table>';
  }

  function rowTable(items) {
    const head = '<thead><tr>' + th('Tentative date') + th('Department') + th('Topic') + '</tr></thead>';
    const rows = items.map((r) => '<tr><td>' + esc(r.when) + '</td><td>' + esc(r.department) + '</td><td>' +
      link(r.url, r.topic || 'Untitled') + (r.description ? '<br>' + esc(r.description) : '') + '</td></tr>').join('\n');
    return TABLE + '\n' + head + '\n<tbody>\n' + rows + '\n</tbody>\n</table>';
  }

  function highlightList(items) {
    return '<ul>\n' + items.map((c) => '<li>' + link(c.url, c.headline || 'Untitled') + coverageNote(c) +
      (c.notes ? '<br>' + esc(c.notes) : '') + '</li>').join('\n') + '\n</ul>';
  }

  function sectionBody(section) {
    if (section.type === 'text') return '';
    if (!section.items.length) return '<p>Nothing to report this period.</p>';
    if (section.type === 'release-coverage') return releaseTable(section.items);
    if (section.type === 'manual-table') return rowTable(section.items);
    if (section.type === 'highlights') return highlightList(section.items);
    return coverageTable(section.items);
  }

  function sectionHtml(section) {
    const intro = textHtml(section.intro);
    return '<h2>' + esc(section.title) + '</h2>\n' + (intro ? intro + '\n' : '') + sectionBody(section);
  }

  function headerHtml(report) {
    const lines = [];
    if (report.organization) lines.push('<p>' + esc(report.organization) + '</p>');
    lines.push('<h1>' + esc(report.title) + '</h1>');
    const period = Core.formatPeriod(report.period.start, report.period.end);
    if (period) lines.push('<p><em>' + esc(period) + '</em></p>');
    if (report.preparedBy) lines.push('<p>Prepared by ' + esc(report.preparedBy) + '</p>');
    const description = textHtml(report.description);
    if (description) lines.push(description);
    return lines.join('\n');
  }

  function enabledSections(report, onlySectionId) {
    return report.sections.filter((s) => s.enabled && (!onlySectionId || s.id === onlySectionId));
  }

  // The report as HTML. With onlySectionId, just that section (no title block or footer).
  function renderReport(report, options) {
    const only = options && options.onlySectionId;
    const parts = [];
    if (!only) parts.push(headerHtml(report));
    enabledSections(report, only).forEach((s) => parts.push(sectionHtml(s)));
    if (!only && report.footer) parts.push(textHtml(report.footer, report.footerBold));
    return parts.join('\n');
  }

  // --- plain text ---

  function line(parts) { return parts.filter(Boolean).join(' | '); }

  function sectionText(section) {
    const out = [section.title.toUpperCase()];
    if (section.intro) out.push(section.intro);
    if (section.type === 'text') return out.join('\n');
    if (!section.items.length) {
      out.push('Nothing to report this period.');
      return out.join('\n');
    }
    section.items.forEach((item) => {
      if (item.kind === 'release') {
        out.push(line([item.date ? Core.formatDate(item.date) : '', item.department, item.title, item.url]));
        item.coverage.forEach((c) => out.push('  - ' + line([c.headline, c.source, c.date ? Core.formatDate(c.date) : '', c.url])));
      } else if (item.kind === 'row') {
        out.push(line([item.when, item.department, item.topic, item.description, item.url]));
      } else {
        out.push(line([item.date ? Core.formatDate(item.date) : '', item.headline, item.source, item.url]));
      }
    });
    return out.join('\n');
  }

  function toPlainText(report, options) {
    const only = options && options.onlySectionId;
    const blocks = [];
    if (!only) {
      const head = [report.organization, report.title, Core.formatPeriod(report.period.start, report.period.end)];
      if (report.preparedBy) head.push('Prepared by ' + report.preparedBy);
      if (report.description) head.push(report.description);
      blocks.push(head.filter(Boolean).join('\n'));
    }
    enabledSections(report, only).forEach((s) => blocks.push(sectionText(s)));
    if (!only && report.footer) blocks.push(report.footer);
    return blocks.join('\n\n');
  }

  // --- standalone document ---

  const STANDALONE_CSS = 'body{font-family:system-ui,Segoe UI,Arial,sans-serif;line-height:1.5;max-width:60rem;margin:2rem auto;padding:0 1rem;color:#1f1f1f}' +
    'table{border-collapse:collapse;width:100%;margin:1rem 0}th,td{border:1px solid #6b7280;padding:.5rem;text-align:left;vertical-align:top}' +
    'th{background:#f1f3f5}a{color:#0b5cad}ul{margin:0;padding-left:1.25rem}';

  function standaloneHtml(report) {
    return '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>' +
      esc(report.title) + '</title>\n<style>' + STANDALONE_CSS + '</style>\n</head>\n<body>\n<main>\n' + renderReport(report) + '\n</main>\n</body>\n</html>\n';
  }

  return { esc, renderReport, toPlainText, standaloneHtml, sectionHtml, headerHtml };
});
