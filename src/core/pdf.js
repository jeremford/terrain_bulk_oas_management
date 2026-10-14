/**
 * A minimal PDF writer. Pure, dependency-free.
 *
 * Why this exists: printing the report through the browser produced multi-
 * megabyte files (Chrome emits the macOS system font as Type 3 glyph outlines
 * plus a full accessibility tree, and the macOS print path can rasterise).
 * A text-only PDF using the standard Helvetica family needs no embedded fonts
 * and comes out at a few hundred kilobytes for a whole unit.
 *
 * Supports: multiple pages of any size, text in Helvetica regular/bold/
 * oblique, a check mark via ZapfDingbats, filled rectangles, lines, and
 * deflated content streams. WinAnsi encoding, so Latin-1 text renders and
 * anything else becomes "?". That covers names in an Australian roster.
 *
 * Text width is delegated to an injected `measure` so the browser can use a
 * canvas (Arial and Helvetica are metric-compatible); tests inject a stub.
 */

const FONTS = {
  regular: 'Helvetica',
  bold: 'Helvetica-Bold',
  italic: 'Helvetica-Oblique',
  bolditalic: 'Helvetica-BoldOblique',
  dingbats: 'ZapfDingbats',
};
const FONT_IDS = Object.fromEntries(Object.keys(FONTS).map((k, i) => [k, `F${i + 1}`]));

export const CHECK = '✓';
const CHECK_WIDTH = 0.755;   // ZapfDingbats a19 advance, per 1pt of size

/** Characters outside Latin-1 that WinAnsi does have, at their WinAnsi code. */
const WINANSI = { '•': 0x95, '–': 0x96, '—': 0x97, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '…': 0x85, '€': 0x80 };

function encodeLatin(str) {
  let out = '';
  for (const ch of str) {
    let code = ch.codePointAt(0);
    if (WINANSI[ch] !== undefined) code = WINANSI[ch];
    else if (code > 0xff) code = 0x3f;   // "?"
    if (code === 0x5c || code === 0x28 || code === 0x29) out += '\\' + String.fromCharCode(code);
    else if (code < 0x20 || code > 0x7e) out += '\\' + code.toString(8).padStart(3, '0');
    else out += String.fromCharCode(code);
  }
  return out;
}

/** Info-dictionary strings use PDFDocEncoding, not WinAnsi; UTF-16BE with a BOM sidesteps that. */
function encodeUtf16(str) {
  let hex = 'FEFF';
  for (const ch of str) {
    const code = ch.codePointAt(0);
    if (code > 0xffff) { hex += '003F'; continue; }
    hex += code.toString(16).padStart(4, '0').toUpperCase();
  }
  return `<${hex}>`;
}

const fontKey = ({ bold, italic }) => bold && italic ? 'bolditalic' : bold ? 'bold' : italic ? 'italic' : 'regular';

function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => (v / 255).toFixed(3)).join(' ');
}

async function deflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export const A4 = { w: 595.28, h: 841.89 };

export class PdfWriter {
  #pages = [];
  #measure;
  #title;

  /**
   * @param {object} opts
   * @param {(text: string, style: {bold?: boolean, italic?: boolean, size: number}) => number} [opts.measure]
   *        width of `text` in points. Defaults to a rough average-width estimate.
   * @param {string} [opts.title]
   */
  constructor({ measure, title = '' } = {}) {
    this.#measure = measure ?? ((text, { size }) => text.length * size * 0.5);
    this.#title = title;
  }

  get pageCount() { return this.#pages.length; }

  addPage({ landscape = false } = {}) {
    const page = { w: landscape ? A4.h : A4.w, h: landscape ? A4.w : A4.h, ops: [], links: [] };
    this.#pages.push(page);
    return page;
  }

  /** Width of `text` as it will be drawn, including any check marks. */
  width(text, style) {
    let w = 0;
    for (const part of text.split(CHECK)) w += part ? this.#measure(part, style) : 0;
    w += (text.split(CHECK).length - 1) * CHECK_WIDTH * style.size;
    return w;
  }

  /** Draws text with its baseline at `y` points from the top of the page. */
  text(page, x, y, text, { size = 10, bold = false, italic = false, color = '#000000' } = {}) {
    const style = { size, bold, italic };
    const font = FONT_IDS[fontKey(style)];
    const parts = text.split(CHECK);
    let cx = x;
    const ops = [`BT ${rgb(color)} rg`];
    parts.forEach((part, i) => {
      if (part) {
        ops.push(`/${font} ${size} Tf 1 0 0 1 ${cx.toFixed(2)} ${(page.h - y).toFixed(2)} Tm (${encodeLatin(part)}) Tj`);
        cx += this.#measure(part, style);
      }
      if (i < parts.length - 1) {
        ops.push(`/${FONT_IDS.dingbats} ${size} Tf 1 0 0 1 ${cx.toFixed(2)} ${(page.h - y).toFixed(2)} Tm (3) Tj`);
        cx += CHECK_WIDTH * size;
      }
    });
    ops.push('ET');
    page.ops.push(ops.join(' '));
    return cx - x;
  }

  /** Filled rectangle; (x, y) is the top-left corner in from-top coordinates. */
  rect(page, x, y, w, h, { fill = '#000000' } = {}) {
    page.ops.push(`${rgb(fill)} rg ${x.toFixed(2)} ${(page.h - y - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
  }

  /**
   * Clickable area jumping to a spot in the document. `target` is resolved at
   * serialisation, so it can be filled in after the link is drawn: the summary
   * table links forward to sections that have not been laid out yet.
   * @param {{ page?: object, y?: number }} target  destination page and from-top y
   */
  link(page, x, y, w, h, target) {
    page.links.push({ x, y, w, h, target });
  }

  line(page, x1, y1, x2, y2, { color = '#000000', width = 0.5 } = {}) {
    page.ops.push(`${rgb(color)} RG ${width} w ${x1.toFixed(2)} ${(page.h - y1).toFixed(2)} m ${x2.toFixed(2)} ${(page.h - y2).toFixed(2)} l S`);
  }

  /** Serialises the document. */
  async toBytes() {
    const enc = new TextEncoder();
    const chunks = [];
    const offsets = [];
    let length = 0;
    const push = part => {
      const bytes = typeof part === 'string' ? enc.encode(part) : part;
      chunks.push(bytes);
      length += bytes.length;
    };
    const obj = (id, body) => {
      offsets[id] = length;
      push(`${id} 0 obj\n`);
      if (typeof body === 'string') push(body);
      else {
        push(`<< ${body.dict} /Length ${body.stream.length} >>\nstream\n`);
        push(body.stream);
        push('\nendstream');
      }
      push('\nendobj\n');
    };

    // Object numbering: 1 catalog, 2 pages, 3 info, then fonts, then page+content
    // pairs, then one object per link annotation (indirect, as viewers expect).
    const fontKeys = Object.keys(FONTS);
    const firstFont = 4;
    const firstPage = firstFont + fontKeys.length;
    const firstAnnot = firstPage + this.#pages.length * 2;
    const pageId = i => firstPage + i * 2;

    const annots = [];   // { id, page, link }
    this.#pages.forEach((page, i) => {
      for (const link of page.links) {
        if (!link.target.page || !this.#pages.includes(link.target.page)) continue;
        annots.push({ id: firstAnnot + annots.length, pageIndex: i, link });
      }
    });
    const total = firstAnnot + annots.length - 1;

    push('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
    const kids = this.#pages.map((_, i) => `${pageId(i)} 0 R`).join(' ');
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, `<< /Type /Pages /Count ${this.#pages.length} /Kids [${kids}] >>`);
    obj(3, `<< /Title ${encodeUtf16(this.#title)} /Producer (terrain-approvals) >>`);

    const fontRefs = fontKeys.map((k, i) => `/${FONT_IDS[k]} ${firstFont + i} 0 R`).join(' ');
    fontKeys.forEach((k, i) => {
      const encoding = k === 'dingbats' ? '' : ' /Encoding /WinAnsiEncoding';
      obj(firstFont + i, `<< /Type /Font /Subtype /Type1 /BaseFont /${FONTS[k]}${encoding} >>`);
    });

    for (let i = 0; i < this.#pages.length; i++) {
      const page = this.#pages[i];
      const content = await deflate(enc.encode(page.ops.join('\n')));
      const refs = annots.filter(a => a.pageIndex === i).map(a => `${a.id} 0 R`);
      obj(pageId(i), `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.w} ${page.h}] ` +
        `/Resources << /Font << ${fontRefs} >> >> /Contents ${pageId(i) + 1} 0 R` +
        (refs.length ? ` /Annots [${refs.join(' ')}]` : '') + ' >>');
      obj(pageId(i) + 1, { dict: '/Filter /FlateDecode', stream: content });
    }

    for (const { id, pageIndex, link } of annots) {
      const page = this.#pages[pageIndex];
      const dest = this.#pages.indexOf(link.target.page);
      const top = (link.target.page.h - (link.target.y ?? 0)).toFixed(2);
      const rect = [link.x, page.h - link.y - link.h, link.x + link.w, page.h - link.y].map(v => v.toFixed(2)).join(' ');
      obj(id, `<< /Type /Annot /Subtype /Link /Rect [${rect}] /Border [0 0 0] /Dest [${pageId(dest)} 0 R /XYZ null ${top} null] >>`);
    }

    const xref = length;
    push(`xref\n0 ${total + 1}\n0000000000 65535 f \n`);
    for (let id = 1; id <= total; id++) push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
    push(`trailer\n<< /Size ${total + 1} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

    const out = new Uint8Array(length);
    let at = 0;
    for (const c of chunks) { out.set(c, at); at += c.length; }
    return out;
  }
}
