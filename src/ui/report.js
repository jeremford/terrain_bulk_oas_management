/**
 * Renders the OAS progress report as a printable document, and serialises it
 * to a standalone HTML file. Data only ever enters the DOM via textContent, so
 * the serialised copy is safe without any manual escaping.
 */

import { describeStage, describeCallout, describeStageNote, summaryColumns, summaryCell, titleCase as title, SUMMARY_LEGEND } from '../core/report.js';
import { el } from './dom.js';

function renderStage(stage) {
  const box = el('div', `stage ${stage.state}`);
  const head = el('div', 'stage-head');
  head.appendChild(el('strong', null, `Stage ${stage.stage}`));

  head.appendChild(el('span', 'stage-note', describeStageNote(stage)));
  box.appendChild(head);

  if (stage.missing.length) {
    const ul = el('ul', 'missing');
    let lastGroup = null;
    for (const m of stage.missing) {
      if (m.group && m.group !== lastGroup) {
        ul.appendChild(el('li', 'group', m.group));
        lastGroup = m.group;
      }
      ul.appendChild(el('li', null, m.label));
    }
    box.appendChild(ul);
  }
  return box;
}

/** Names down the side, a column per stream split into stages, one mark per cell. */
function renderSummary(report, stageFilter) {
  const { streams, stages } = summaryColumns(report, stageFilter);
  const wrap = el('div', 'summary-scroll');
  const table = el('table', 'summary');

  const top = el('tr');
  const corner = el('th', 'name', 'Member');
  corner.rowSpan = 2;
  top.appendChild(corner);
  for (const stream of streams) {
    const th = el('th', 'stream', title(stream));
    th.colSpan = stages.length;
    top.appendChild(th);
  }
  table.appendChild(top);

  const sub = el('tr');
  for (const _ of streams) for (const stage of stages) sub.appendChild(el('th', 'stage', String(stage)));
  table.appendChild(sub);

  for (const member of report) {
    const tr = el('tr');
    const name = el('td', 'name');
    const link = el('a', null, member.name);
    link.href = `#member-${member.memberId}`;
    name.appendChild(link);
    tr.appendChild(name);

    const byKey = new Map(member.cells.map(c => [`${c.stream}/${c.stage}`, c]));
    for (const stream of streams) {
      for (const stage of stages) {
        const cell = summaryCell(byKey.get(`${stream}/${stage}`));
        const td = el('td', cell ? `mark ${cell.kind}` : 'mark empty', cell?.mark ?? '');
        if (cell?.kind === 'complete') td.title = 'fully verified, not yet awarded';
        if (cell?.kind === 'logbook') td.title = 'only the logbook checkbox is left';
        tr.appendChild(td);
      }
    }
    table.appendChild(tr);
  }

  wrap.appendChild(table);
  const legend = el('p', 'quiet legend', SUMMARY_LEGEND);
  const box = el('div', 'summary-box');
  box.appendChild(wrap);
  box.appendChild(legend);
  return box;
}

function renderMember(member) {
  const section = el('section', 'member');
  section.id = `member-${member.memberId}`;
  section.appendChild(el('h3', null, member.name));

  for (const c of member.callouts) section.appendChild(el('p', 'callout', describeCallout(c)));

  const awarded = member.awarded.map(a => `${title(a.stream)} ${a.stage}`);
  section.appendChild(el('p', 'awarded', awarded.length ? `Awarded: ${awarded.join(', ')}` : 'Nothing awarded yet.'));
  if (member.submitted.length) {
    section.appendChild(el('p', 'awarded', `Submitted, awaiting approval: ${member.submitted.map(a => `${title(a.stream)} ${a.stage}`).join(', ')}`));
  }

  if (!member.streams.length) {
    section.appendChild(el('p', 'quiet', 'No stages in progress.'));
    return section;
  }

  for (const stream of member.streams) {
    const block = el('div', 'stream');
    const h4 = el('h4', null, title(stream.stream));
    h4.appendChild(el('span', 'chain', stream.stages.map(describeStage).join(' · ')));
    block.appendChild(h4);
    for (const stage of stream.stages) {
      if (stage.state === 'awarded') continue;
      block.appendChild(renderStage(stage));
    }
    section.appendChild(block);
  }
  return section;
}

/**
 * @param {HTMLElement} host
 * @param {object[]} report      from buildReport()
 * @param {{ unitName: string, generatedAt: Date, stages?: number[] }} meta
 *        stages: the stage columns to show; defaults to what the data needs
 */
export function renderReport(host, report, { unitName, generatedAt, stages }) {
  host.replaceChildren();
  const article = el('article', 'report');

  const header = el('header');
  header.appendChild(el('h2', null, `OAS progress — ${unitName}`));
  const withWork = report.filter(m => m.streams.length).length;
  header.appendChild(el('p', 'quiet',
    `${generatedAt.toLocaleString()} · ${report.length} members, ${withWork} with stages in progress · ` +
    'from the member records on Terrain at that moment'));
  article.appendChild(header);

  article.appendChild(renderSummary(report, stages));
  for (const member of report) article.appendChild(renderMember(member));
  host.appendChild(article);
  return article;
}

/** Collects every same-origin stylesheet rule so the saved file looks the same. */
function collectCss() {
  return [...document.styleSheets].flatMap(sheet => {
    try { return [...sheet.cssRules].map(r => r.cssText); } catch { return []; }
  }).join('\n');
}

/** A self-contained HTML file of the report, for emailing or filing. */
export function reportAsHtml(article, { unitName }) {
  const doc = document.implementation.createHTMLDocument(`OAS progress — ${unitName}`);
  doc.documentElement.lang = 'en';
  const meta = doc.createElement('meta');
  meta.setAttribute('charset', 'utf-8');
  doc.head.prepend(meta);
  const style = doc.createElement('style');
  style.textContent = collectCss();
  doc.head.appendChild(style);
  doc.body.className = 'report-only';
  doc.body.appendChild(doc.importNode(article, true));
  return '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
}

/**
 * Text widths for the PDF, from a canvas. Arial and Helvetica share metrics,
 * so whichever the platform has gives widths that match the PDF viewer.
 */
export function canvasMeasurer() {
  const ctx = document.createElement('canvas').getContext('2d');
  return (text, { size, bold, italic }) => {
    ctx.font = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${size}px Helvetica, Arial, sans-serif`;
    return ctx.measureText(text).width;
  };
}
