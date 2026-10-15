/**
 * Lays the "outstanding by statement" lists out as portrait PDFs: each
 * statement that someone still needs, with the names underneath. One layout
 * serves the single-stage list from the grid and the multi-stage list from
 * the progress report. Pure apart from the injected text measurer.
 */

import { PdfWriter } from './pdf.js';
import { C, MARGIN, newPage, textItem, runsItem, placeBlock } from './pdf-layout.js';
import { titleCase } from './report.js';

const LEFT_OFF = 'Members with a tick, or whose record is pending review or awarded, are left off.';

function drawTitle(ctx, heading, sub) {
  ctx.doc.text(ctx.page, MARGIN, ctx.y + 14, heading, { size: 16, bold: true, color: C.navy });
  ctx.doc.text(ctx.page, MARGIN, ctx.y + 28, sub, { size: 8.5, color: C.muted });
  ctx.y += 36;
}

/** The statements of one stage, each kept together with its names; the group heading sticks to its first statement. */
function groupItems(ctx, groups) {
  const items = [];
  for (const group of groups) {
    if (group.title) items.push(textItem(ctx, group.title.toUpperCase(), { size: 8, bold: true, color: C.muted, before: 8, after: 2, keep: true }));
    group.statements.forEach((s, i) => {
      items.push(textItem(ctx, s.label, { size: 10, bold: true, color: C.ink, before: i ? 6 : 2, after: 1, keep: true }));
      items.push(s.names.length
        ? runsItem(ctx, `${s.names.length} to go`, s.names.join(' · '), { leadSize: 8.5, noteSize: 9.5, noteColor: C.slate, indent: 10, after: 2 })
        : textItem(ctx, 'only those not started', { size: 8.5, italic: true, color: C.muted, indent: 10, after: 2 }));
    });
  }
  return items;
}

/** From the grid: one stream and stage. */
export async function outstandingToPdf(data, { unitName, stream, stage, generatedAt, measure }) {
  const subject = `${titleCase(stream)} Stage ${stage}`;
  const generated = generatedAt.toLocaleString();
  const doc = new PdfWriter({ measure, title: `OAS outstanding — ${subject} — ${unitName}` });
  const ctx = { doc, page: null, y: 0, footer: `OAS outstanding — ${subject} · ${unitName} · ${generated}` };

  newPage(ctx, false);
  drawTitle(ctx, `${subject} — outstanding by statement`, `${unitName} · ${generated}`);
  const summary = data.groups.length
    ? `${data.outstanding} of ${data.total} members have something outstanding. ${LEFT_OFF}`
    : `Nothing outstanding: all ${data.total} members have every statement ticked or their record is already submitted.`;
  placeBlock(ctx, [textItem(ctx, summary, { size: 9, color: C.muted, after: 6 })]);
  for (const group of data.groups) placeBlock(ctx, groupItems(ctx, [group]));

  return doc.toBytes();
}

const prevStream = (data, stage) => data.stages[data.stages.indexOf(stage) - 1]?.stream;

/** From the progress report: every selected stream and stage with something outstanding. */
export async function outstandingReportToPdf(data, { unitName, generatedAt, measure }) {
  const generated = generatedAt.toLocaleString();
  const doc = new PdfWriter({ measure, title: `OAS outstanding — ${unitName}` });
  const ctx = { doc, page: null, y: 0, footer: `OAS outstanding — ${unitName} · ${generated}` };

  newPage(ctx, false);
  drawTitle(ctx, 'Outstanding by statement', `${unitName} · ${generated} · ${data.total} members`);
  const summary = data.stages.length
    ? `${data.stages.length} stage${data.stages.length === 1 ? '' : 's'} in stream order, each listing every statement. ${LEFT_OFF} Members with no record for a stage are listed once as not started: they need all of it.`
    : 'Nothing outstanding in the selected streams and stages.';
  placeBlock(ctx, [textItem(ctx, summary, { size: 9, color: C.muted, after: 4 })]);

  // Each stream starts on a new page, so one stream's pages can be handed to
  // the leader running that activity.
  let stream = null;
  for (const stage of data.stages) {
    if (stream && stage.stream !== stream) newPage(ctx, false);
    stream = stage.stream;
    const items = [runsItem(ctx, `${titleCase(stage.stream)} Stage ${stage.stage}`,
      `${stage.outstanding} in progress with something outstanding · ${stage.notStarted.length} not started`,
      { leadSize: 13, noteSize: 9, noteColor: C.muted, before: stage === data.stages[0] || stage.stream !== prevStream(data, stage) ? 2 : 14, after: 2, keep: true })];
    const heading = items[0];
    const draw = heading.draw;
    heading.draw = (c, y) => { draw(c, y); c.doc.line(c.page, MARGIN, y + heading.h - 1, c.page.w - MARGIN, y + heading.h - 1, { color: C.lineStrong }); };
    items.push(...groupItems(ctx, stage.groups));
    if (stage.notStarted.length) {
      items.push(runsItem(ctx, `Not started (${stage.notStarted.length})`, stage.notStarted.join(' · '),
        { leadSize: 8.5, noteSize: 9, noteColor: C.muted, indent: 10, before: 8, after: 2 }));
    }
    placeBlock(ctx, items);
  }

  return doc.toBytes();
}
