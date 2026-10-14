/**
 * Page flow shared by the PDF layouts: a page context with margins and a
 * footer, word wrap against the injected measurer, and "items" — measured
 * blocks that can be kept together or split across pages. Pure.
 */

export const C = {
  navy: '#071e57', ink: '#253642', muted: '#748494', slate: '#405261',
  ok: '#00897b', warn: '#8a5300', bad: '#ef5350',
  amber: '#ffd180', amberBg: '#fff8e8', line: '#e5e9ec', lineStrong: '#b7c2cc', headBg: '#eef2f7',
};
export const MARGIN = 40;
export const FOOTER = 26;

// ---- page flow -------------------------------------------------------------

export function newPage(ctx, landscape) {
  ctx.page = ctx.doc.addPage({ landscape });
  ctx.y = MARGIN;
  const { page, doc } = ctx;
  const foot = page.h - 14;
  doc.text(page, MARGIN, foot, ctx.footer, { size: 7.5, color: C.muted });
  const label = `Page ${doc.pageCount}`;
  doc.text(page, page.w - MARGIN - doc.width(label, { size: 7.5 }), foot, label, { size: 7.5, color: C.muted });
}

export const limit = ctx => ctx.page.h - MARGIN - FOOTER;

/** Greedy word wrap against the measurer. A word longer than the line is placed anyway. */
export function wrap(doc, text, style, maxWidth) {
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
export function textItem(ctx, text, { size = 10, bold = false, italic = false, color = C.ink, indent = 0, before = 0, after = 0, hanging = 0, keep = false } = {}) {
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

export function bulletItem(ctx, text, opts) {
  const item = textItem(ctx, text, { ...opts, indent: opts.indent + 9, hanging: 0 });
  const draw = item.draw;
  item.draw = (c, y) => {
    c.doc.text(c.page, MARGIN + opts.indent, y + (opts.before ?? 0) + opts.size * 0.85, '•', { size: opts.size, color: C.slate });
    draw(c, y);
  };
  return item;
}

/** Two runs on one line: a bold lead and a quieter note after it. Wraps the note if needed. */
export function runsItem(ctx, lead, note, { leadSize, noteSize, noteColor, indent = 0, before = 0, after = 0, keep = false }) {
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

export function calloutItem(ctx, text) {
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

export function placeBlock(ctx, items) {
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
