/**
 * Lays the duplicates list out as a portrait PDF: each recurring statement,
 * then one line per member saying where it is ticked and where it is not.
 * Pure apart from the injected text measurer.
 */

import { PdfWriter, CHECK } from './pdf.js';
import { C, MARGIN, newPage, textItem, runsItem, placeBlock } from './pdf-layout.js';
import { titleCase } from './report.js';

const placeLabel = p => `${titleCase(p.stream)} ${p.stage}`;

export async function duplicatesToPdf(data, { unitName, generatedAt, measure }) {
  const generated = generatedAt.toLocaleString();
  const doc = new PdfWriter({ measure, title: `OAS duplicated statements — ${unitName}` });
  const ctx = { doc, page: null, y: 0, footer: `OAS duplicated statements — ${unitName} · ${generated}` };

  newPage(ctx, false);
  doc.text(ctx.page, MARGIN, ctx.y + 14, 'Duplicated statements — ticked in one stream, not another', { size: 16, bold: true, color: C.navy });
  doc.text(ctx.page, MARGIN, ctx.y + 28, `${unitName} · ${generated} · ${data.total} members`, { size: 8.5, color: C.muted });
  ctx.y += 36;

  const summary = data.wordings.length
    ? `${data.wordings.length} statement${data.wordings.length === 1 ? '' : 's'} worded the same in more than one selected stream or stage, where a member has it ticked in one and not another. Only stages the member has in progress count as not ticked.`
    : 'No member has a recurring statement ticked in one selected stream and not another.';
  placeBlock(ctx, [textItem(ctx, summary, { size: 9, color: C.muted, after: 6 })]);

  for (const w of data.wordings) {
    const items = [
      textItem(ctx, w.label, { size: 10.5, bold: true, color: C.ink, before: 10, after: 1, keep: true }),
      textItem(ctx, `In ${w.places.map(placeLabel).join(', ')}`, { size: 8, italic: true, color: C.muted, after: 3, keep: true }),
    ];
    for (const m of w.members) {
      items.push(runsItem(ctx, m.name,
        `${CHECK} ${m.ticked.map(placeLabel).join(', ')} · to tick: ${m.missing.map(placeLabel).join(', ')}`,
        { leadSize: 9.5, noteSize: 9, noteColor: C.slate, indent: 10, after: 1.5 }));
    }
    placeBlock(ctx, items, { whole: false });
  }

  return doc.toBytes();
}
