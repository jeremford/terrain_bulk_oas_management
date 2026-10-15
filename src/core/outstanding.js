/**
 * Inverts the grid and the progress report: for each statement, which members
 * still need it. Feeds the "outstanding by statement" PDFs a leader takes to a
 * night of activities. Pure, no I/O.
 *
 * A member counts as done with a statement when Terrain has it verified, or
 * when their record is locked (pending review, finalised, awarded): the grid
 * shows a dash there because nothing can be ticked, so there is nothing to
 * chase. Statements nobody needs are left out entirely.
 */

import { isLocked } from './model.js';
import { STREAM_ORDER, templateKey } from './report.js';

const byName = (a, b) => a.localeCompare(b);

/** Chunks consecutive statements by group title, keeping only those someone needs (or all, if keepEmpty). */
function groupStatements(entries, keepEmpty = false) {
  const groups = [];
  let group = null;
  for (const entry of entries) {
    if (!entry.names.length && !keepEmpty) continue;
    const title = entry.group ?? '';
    if (!group || group.title !== title) {
      group = { title, statements: [] };
      groups.push(group);
    }
    group.statements.push({ id: entry.id, label: entry.label, names: [...entry.names].sort(byName) });
  }
  return groups;
}

/**
 * From the grid: one stream and stage.
 * @param {Array<{name, status, answers}>} members  rows as shown in the grid
 * @param {Array<{id, label, group}>} statements     from parseStatements()
 * @returns {{ total, outstanding, groups: Array<{ title, statements: Array<{ id, label, names: string[] }> }> }}
 */
export function buildOutstanding(members, statements) {
  const open = members.filter(m => !isLocked(m));
  const outstanding = new Set();
  const entries = statements.map(statement => ({
    ...statement,
    names: open.filter(m => m.answers?.[statement.id] !== true).map(m => { outstanding.add(m); return m.name; }),
  }));
  return { total: members.length, outstanding: outstanding.size, groups: groupStatements(entries) };
}

/**
 * From the progress report: every selected stream and stage, with every
 * statement of it. It is printed to take to a camp, so a stage nobody has
 * started still lists its statements in full. A member with no record for a
 * stage is listed once as "not started" rather than against every statement;
 * they need all of them. A stage is dropped only when nobody needs anything,
 * or when it has no template to list and nobody is missing anything.
 *
 * Statement order follows the stage's current template. Statements only an
 * older version has (a member pinned to it) are appended in that version's
 * order, using the index stageProgress() attaches to each missing item.
 *
 * @param {Array<{ name, cells: Array<{ stream, stage, state, missing }> }>} report  from buildReport()
 * @param {{ templates?: Map<string, statements[]>, streams?: string[], stages?: number[] }} options
 *   templates keyed by templateKey(); streams and stages as selected in the report filters
 * @returns {{ total, stages: Array<{ stream, stage, outstanding, notStarted: string[], groups }> }}
 */
export function buildOutstandingReport(report, { templates = new Map(), streams = [], stages = [] } = {}) {
  const byStage = new Map();
  const stageOf = (stream, stage) => {
    const key = `${stream}/${stage}`;
    if (!byStage.has(key)) byStage.set(key, { stream, stage: Number(stage), started: new Set(), statements: new Map() });
    return byStage.get(key);
  };

  // Seed every selected stage with its template so unstarted statements show.
  for (const stream of streams) {
    for (const stage of stages) {
      const template = templates.get(templateKey(stream, stage, undefined))
        ?? [...templates].find(([k]) => k.startsWith(`${stream}/${stage}/`))?.[1];
      if (!template) continue;
      const entry = stageOf(stream, stage);
      template.forEach(({ id, label, group }, index) => entry.statements.set(id, { id, label, group, index, names: [] }));
    }
  }

  for (const member of report) {
    for (const cell of member.cells) {
      const stage = stageOf(cell.stream, cell.stage);
      stage.started.add(member.name);
      if (cell.state !== 'in_progress') continue;
      for (const m of cell.missing) {
        if (!stage.statements.has(m.id)) {
          // Not in the current template: append after it, in the member's order.
          stage.statements.set(m.id, { id: m.id, label: m.label, group: m.group, index: 1e6 + (m.index ?? 1e6), names: [] });
        }
        stage.statements.get(m.id).names.push(member.name);
      }
    }
  }

  const streamRank = s => { const i = STREAM_ORDER.indexOf(s); return i === -1 ? STREAM_ORDER.length : i; };
  const everyone = report.map(m => m.name);

  return {
    total: report.length,
    stages: [...byStage.values()]
      .sort((a, b) => streamRank(a.stream) - streamRank(b.stream) || a.stage - b.stage)
      .map(stage => {
        const notStarted = everyone.filter(n => !stage.started.has(n)).sort(byName);
        const entries = [...stage.statements.values()].sort((a, b) => a.index - b.index);
        // With someone not started, every statement is still needed by them.
        const groups = groupStatements(entries, notStarted.length > 0);
        const outstanding = new Set(entries.flatMap(e => e.names)).size;
        return { stream: stage.stream, stage: stage.stage, outstanding, notStarted, groups };
      })
      .filter(stage => stage.groups.length),
  };
}
