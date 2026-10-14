/**
 * Lays the progress report out as a PDF: summary table on landscape pages,
 * then one portrait section per member, with the same wording as the HTML
 * version. Pure apart from the injected text measurer.
 */

import { PdfWriter, CHECK } from './pdf.js';
import {
  summaryColumns, summaryCell, describeCallout, describeStageNote, describeStage,
  titleCase, SUMMARY_LEGEND,
} from './report.js';

const C = {
  navy: '#071e57', ink: '#253642', muted: '#748494', slate: '#405261',
  ok: '#00897b', warn: '#8a5300', bad: '#ef5350',
  amber: '#ffd180', amberBg: '#fff8e8', line: '#e5e9ec', lineStrong: '#b7c2cc', headBg: '#eef2f7',
};
const MARGIN = 40;
const FOOTER = 26;

// ---- page flow -------------------------------------------------------------

function newPage(ctx, landscape) {
  ctx.page = ctx.doc.addPage({ landscape });
  ctx.y = MARGIN;
  const { page, doc } = ctx;
  const foot = page.h - 14;
  doc.text(page, MARGIN, foot, `OAS progress — ${ctx.unitName} · ${ctx.generated}`, { size: 7.5, color: C.muted });
  const label = `Page ${doc.pageCount}`;
  doc.text(page, page.w - MARGIN - doc.width(label, { size: 7.5 }), foot, label, { size: 7.5, color: C.muted });
}

const limit = ctx => ctx.page.h - MARGIN - FOOTER;

/** Greedy word wrap against the measurer. A word longer than the line is placed anyway. */
function wrap(doc, text, style, maxWidth) {
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && doc.width(candidate, style) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Block items: { h, draw(ctx, y), keep? }. A member is built as a list of
 * items so it can be measured, kept together where it fits, and split at
 * item boundaries where it does not.
 */
function textItem(ctx, text, { size = 10, bold = false, italic = false, color = C.ink, indent = 0, before = 0, after = 0, hanging = 0, keep = false } = {}) {
  const style = { size, bold, italic };
  const width = ctx.page.w - 2 * MARGIN - indent - hanging;
  const lines = wrap(ctx.doc, text, style, width);
  const lineH = size * 1.32;
  return {
    h: before + lines.length * lineH + after,
    keep,
    draw(c, y) {
      lines.forEach((line, i) => {
        const x = MARGIN + indent + (i === 0 ? 0 : hanging);
        c.doc.text(c.page, x, y + before + size * 0.85 + i * lineH, line, { ...style, color });
      });
    },
  };
}

function bulletItem(ctx, text, opts) {
  const item = textItem(ctx, text, { ...opts, indent: opts.indent + 9, hanging: 0 });
  const draw = item.draw;
  item.draw = (c, y) => {
    c.doc.text(c.page, MARGIN + opts.indent, y + (opts.before ?? 0) + opts.size * 0.85, '•', { size: opts.size, color: C.slate });
    draw(c, y);
  };
  return item;
}

/** Two runs on one line: a bold lead and a quieter note after it. Wraps the note if needed. */
function runsItem(ctx, lead, note, { leadSize, noteSize, noteColor, indent = 0, before = 0, after = 0, keep = false }) {
  const leadStyle = { size: leadSize, bold: true };
  const noteStyle = { size: noteSize };
  const leadW = ctx.doc.width(lead, leadStyle);
  const gap = 7;
  const noteX = indent + leadW + gap;
  const noteLines = note ? wrap(ctx.doc, note, noteStyle, ctx.page.w - 2 * MARGIN - noteX) : [];
  const lineH = leadSize * 1.32;
  const noteH = noteSize * 1.25;
  const h = before + Math.max(lineH, noteLines.length * noteH + (leadSize - noteSize)) + after;
  return {
    h, keep,
    draw(c, y) {
      const base = y + before + leadSize * 0.85;
      c.doc.text(c.page, MARGIN + indent, base, lead, { ...leadStyle, color: C.ink });
      noteLines.forEach((line, i) => c.doc.text(c.page, MARGIN + noteX, base + i * noteH, line, { ...noteStyle, color: noteColor }));
    },
  };
}

function calloutItem(ctx, text) {
  const size = 10;
  const pad = 6;
  const style = { size, bold: true };
  const lines = wrap(ctx.doc, text, style, ctx.page.w - 2 * MARGIN - pad * 2 - 4);
  const lineH = size * 1.32;
  const boxH = lines.length * lineH + pad * 1.2;
  return {
    h: boxH + 5,
    draw(c, y) {
      const w = c.page.w - 2 * MARGIN;
      c.doc.rect(c.page, MARGIN, y, w, boxH, { fill: C.amberBg });
      c.doc.rect(c.page, MARGIN, y, 3, boxH, { fill: C.amber });
      lines.forEach((line, i) => c.doc.text(c.page, MARGIN + pad + 4, y + pad * 0.6 + size * 0.85 + i * lineH, line, { ...style, color: C.ink }));
    },
  };
}

function placeBlock(ctx, items) {
  const total = items.reduce((s, i) => s + i.h, 0);
  const full = limit(ctx) - MARGIN;
  if (ctx.y + total > limit(ctx) && total <= full) newPage(ctx, false);

  items.forEach((item, i) => {
    const withNext = item.h + (item.keep ? (items[i + 1]?.h ?? 0) : 0);
    if (ctx.y + withNext > limit(ctx) && ctx.y > MARGIN) newPage(ctx, false);
    item.draw(ctx, ctx.y);
    ctx.y += item.h;
  });
}

// ---- sections --------------------------------------------------------------

function stateColor(state) {
  if (state === 'complete' || state === 'submitted') return C.ok;
  if (state === 'unknown') return C.warn;
  return C.slate;
}

function memberBlock(ctx, member) {
  const items = [];

  // The heading is where the summary table's link lands, and it links back.
  const heading = textItem(ctx, member.name, { size: 13, bold: true, color: C.navy, before: 8, after: 3, keep: true });
  const draw = heading.draw;
  heading.draw = (c, y) => {
    const target = ctx.targets.get(member.memberId);
    target.page = c.page;
    target.y = Math.max(0, y - 4);
    c.doc.link(c.page, MARGIN, y + 6, c.doc.width(member.name, { size: 13, bold: true }), 16, ctx.summaryTarget);
    draw(c, y);
  };
  items.push(heading);

  for (const c of member.callouts) items.push(calloutItem(ctx, describeCallout(c)));

  const awarded = member.awarded.map(a => `${titleCase(a.stream)} ${a.stage}`);
  items.push(textItem(ctx, awarded.length ? `Awarded: ${awarded.join(', ')}` : 'Nothing awarded yet.', { size: 9.5, color: C.ok, after: 2 }));
  if (member.submitted.length) {
    items.push(textItem(ctx, `Submitted, awaiting approval: ${member.submitted.map(a => `${titleCase(a.stream)} ${a.stage}`).join(', ')}`, { size: 9.5, color: C.ok, after: 2 }));
  }

  if (!member.streams.length) {
    items.push(textItem(ctx, 'No stages in progress.', { size: 9.5, color: C.muted, italic: true, after: 4 }));
    return items;
  }

  for (const stream of member.streams) {
    items.push(runsItem(ctx, titleCase(stream.stream), stream.stages.map(describeStage).join(' · '),
      { leadSize: 11, noteSize: 8.5, noteColor: C.muted, indent: 6, before: 6, after: 2, keep: true }));

    for (const stage of stream.stages) {
      if (stage.state === 'awarded') continue;
      items.push(runsItem(ctx, `Stage ${stage.stage}`, describeStageNote(stage),
        { leadSize: 10, noteSize: 9, noteColor: stateColor(stage.state), indent: 16, before: 3, after: 1, keep: stage.missing.length > 0 }));

      let lastGroup = null;
      for (const m of stage.missing) {
        if (m.group && m.group !== lastGroup) {
          items.push(textItem(ctx, m.group.toUpperCase(), { size: 7.5, color: C.muted, indent: 26, before: 3, after: 1, keep: true }));
          lastGroup = m.group;
        }
        items.push(bulletItem(ctx, m.label, { size: 9.5, indent: 26, after: 0.5 }));
      }
    }
  }
  items[items.length - 1].h += 4;
  return items;
}

function drawSummary(ctx, report, stageFilter) {
  const { doc } = ctx;
  const { streams, stages } = summaryColumns(report, stageFilter);
  const nameW = 120;
  const cols = streams.length * stages.length;
  const colW = cols ? Math.min(30, (ctx.page.w - 2 * MARGIN - nameW) / cols) : 0;
  const tableW = nameW + colW * cols;
  const rowH = 14;
  const mark = { size: 7.5 };

  const header = () => {
    const { page } = ctx;
    const y = ctx.y;
    doc.rect(page, MARGIN, y, tableW, rowH * 2, { fill: C.headBg });
    doc.text(page, MARGIN + 4, y + rowH + 4, 'Member', { size: 8, bold: true, color: C.ink });
    streams.forEach((stream, i) => {
      const x = MARGIN + nameW + i * stages.length * colW;
      const label = titleCase(stream);
      const w = stages.length * colW;
      doc.text(page, x + (w - doc.width(label, { size: 8, bold: true })) / 2, y + 10, label, { size: 8, bold: true, color: C.ink });
      stages.forEach((stage, j) => {
        const sx = x + j * colW;
        const s = String(stage);
        doc.text(page, sx + (colW - doc.width(s, { size: 7 })) / 2, y + rowH + 10, s, { size: 7, color: C.muted });
      });
    });
    doc.line(page, MARGIN, y + rowH * 2, MARGIN + tableW, y + rowH * 2, { color: C.lineStrong });
    ctx.y += rowH * 2;
  };

  header();
  for (const member of report) {
    if (ctx.y + rowH > limit(ctx)) { newPage(ctx, true); header(); }
    const { page } = ctx;
    const y = ctx.y;
    const byKey = new Map(member.cells.map(c => [`${c.stream}/${c.stage}`, c]));

    doc.text(page, MARGIN + 4, y + 10, member.name, { size: 8, color: C.navy });
    doc.link(page, MARGIN, y, nameW, rowH, ctx.targets.get(member.memberId));
    streams.forEach((stream, i) => {
      stages.forEach((stage, j) => {
        const cell = summaryCell(byKey.get(`${stream}/${stage}`));
        if (!cell) return;
        const x = MARGIN + nameW + (i * stages.length + j) * colW;
        if (cell.kind === 'complete') doc.rect(page, x, y, colW, rowH, { fill: C.amberBg });
        const style = {
          ...mark,
          bold: cell.kind === 'awarded' || cell.kind === 'complete',
          italic: cell.kind === 'logbook',
          color: { awarded: C.ok, complete: C.warn, logbook: C.slate, open: C.ink, unknown: C.bad }[cell.kind],
        };
        doc.text(page, x + (colW - doc.width(cell.mark, style)) / 2, y + 10, cell.mark, style);
      });
    });
    doc.line(page, MARGIN, y + rowH, MARGIN + tableW, y + rowH, { color: C.line });
    ctx.y += rowH;
  }

  // Vertical rules between stream groups, drawn per page would be cleaner but
  // the horizontal rules already separate rows; a single rule after the names
  // keeps it readable without overdrawing.
  ctx.y += 6;
  const legend = textItem(ctx, SUMMARY_LEGEND, { size: 7.5, color: C.muted });
  if (ctx.y + legend.h > limit(ctx)) newPage(ctx, true);
  legend.draw(ctx, ctx.y);
  ctx.y += legend.h;
}

/**
 * @param {object[]} report      from buildReport()
 * @param {{ unitName: string, generatedAt: Date, stages?: number[], measure?: Function }} opts
 * @returns {Promise<Uint8Array>}
 */
export async function reportToPdf(report, { unitName, generatedAt, stages, measure }) {
  const doc = new PdfWriter({ measure, title: `OAS progress — ${unitName}` });
  const ctx = {
    doc, page: null, y: 0, unitName, generated: generatedAt.toLocaleString(),
    // Link targets: one per member, filled in when the section is drawn.
    targets: new Map(report.map(m => [m.memberId, {}])),
    summaryTarget: {},
  };

  newPage(ctx, true);
  ctx.summaryTarget.page = ctx.page;
  ctx.summaryTarget.y = 0;
  doc.text(ctx.page, MARGIN, ctx.y + 14, `OAS progress — ${unitName}`, { size: 16, bold: true, color: C.navy });
  const withWork = report.filter(m => m.streams.length).length;
  doc.text(ctx.page, MARGIN, ctx.y + 28,
    `${ctx.generated} · ${report.length} members, ${withWork} with stages in progress · from the member records on Terrain at that moment`,
    { size: 8.5, color: C.muted });
  ctx.y += 40;
  drawSummary(ctx, report, stages);

  // One member per page, so a section can be handed over or filed on its own.
  for (const member of report) {
    newPage(ctx, false);
    placeBlock(ctx, memberBlock(ctx, member));
  }

  return doc.toBytes();
}
