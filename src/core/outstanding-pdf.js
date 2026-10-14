/**
 * Lays the "outstanding by statement" list out as a portrait PDF: each
 * statement that someone still needs, with the names underneath. Pure apart
 * from the injected text measurer.
 */

import { PdfWriter } from './pdf.js';
import { C, MARGIN, newPage, textItem, runsItem, placeBlock } from './pdf-layout.js';
import { titleCase } from './report.js';

export async function outstandingToPdf(data, { unitName, stream, stage, generatedAt, measure }) {
  const subject = `${titleCase(stream)} Stage ${stage}`;
  const generated = generatedAt.toLocaleString();
  const doc = new PdfWriter({ measure, title: `OAS outstanding — ${subject} — ${unitName}` });
  const ctx = { doc, page: null, y: 0, footer: `OAS outstanding — ${subject} · ${unitName} · ${generated}` };

  newPage(ctx, false);
  doc.text(ctx.page, MARGIN, ctx.y + 14, `${subject} — outstanding by statement`, { size: 16, bold: true, color: C.navy });
  doc.text(ctx.page, MARGIN, ctx.y + 28, `${unitName} · ${generated}`, { size: 8.5, color: C.muted });
  ctx.y += 36;

  const summary = data.groups.length
    ? `${data.outstanding} of ${data.total} members have something outstanding. Members with a tick, or whose record is pending review or awarded, are left off.`
    : `Nothing outstanding: all ${data.total} members have every statement ticked or their record is already submitted.`;
  placeBlock(ctx, [textItem(ctx, summary, { size: 9, color: C.muted, after: 6 })]);

  for (const group of data.groups) {
    const items = [];
    if (group.title) items.push(textItem(ctx, group.title.toUpperCase(), { size: 8, bold: true, color: C.muted, before: 8, after: 2, keep: true }));
    group.statements.forEach((s, i) => {
      const n = s.names.length;
      // Statement and its names stay together; the group heading sticks to the first statement.
      items.push(textItem(ctx, s.label, { size: 10, bold: true, color: C.ink, before: i ? 6 : 2, after: 1, keep: true }));
      items.push(runsItem(ctx, `${n} to go`, s.names.join(' · '),
        { leadSize: 8.5, noteSize: 9.5, noteColor: C.slate, indent: 10, after: 2 }));
    });
    placeBlock(ctx, items);
  }

  return doc.toBytes();
}
