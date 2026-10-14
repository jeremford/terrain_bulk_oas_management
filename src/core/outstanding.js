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
import { STREAM_ORDER } from './report.js';

const byName = (a, b) => a.localeCompare(b);

/** Chunks consecutive statements by group title, keeping only those someone needs. */
function groupStatements(entries) {
  const groups = [];
  let group = null;
  for (const entry of entries) {
    if (!entry.names.length) continue;
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
 * From the progress report: every stream and stage it covers. A member with no
 * record for a stage is "not started" rather than outstanding on every
 * statement, which keeps a stage nobody has begun from drowning the list.
 * Stages where nobody has anything outstanding are dropped.
 *
 * Statement order follows the template: each missing item carries its index in
 * the member's template, and the lowest index seen wins. Members can pin
 * different versions of a stage, so ties and new statements fall back to
 * first appearance.
 *
 * @param {Array<{ name, cells: Array<{ stream, stage, state, missing }> }>} report  from buildReport()
 * @returns {{ total, stages: Array<{ stream, stage, outstanding, notStarted: string[], groups }> }}
 */
export function buildOutstandingReport(report) {
  const stages = new Map();
  for (const member of report) {
    for (const cell of member.cells) {
      const key = `${cell.stream}/${cell.stage}`;
      if (!stages.has(key)) stages.set(key, { stream: cell.stream, stage: cell.stage, started: new Set(), statements: new Map() });
      const stage = stages.get(key);
      stage.started.add(member.name);
      if (cell.state !== 'in_progress') continue;
      for (const m of cell.missing) {
        if (!stage.statements.has(m.id)) stage.statements.set(m.id, { id: m.id, label: m.label, group: m.group, index: m.index ?? Infinity, names: [] });
        const entry = stage.statements.get(m.id);
        entry.index = Math.min(entry.index, m.index ?? Infinity);
        entry.names.push(member.name);
      }
    }
  }

  const streamRank = s => { const i = STREAM_ORDER.indexOf(s); return i === -1 ? STREAM_ORDER.length : i; };
  const everyone = report.map(m => m.name);

  return {
    total: report.length,
    stages: [...stages.values()]
      .sort((a, b) => streamRank(a.stream) - streamRank(b.stream) || a.stage - b.stage)
      .map(stage => {
        const entries = [...stage.statements.values()].sort((a, b) => a.index - b.index);   // stable: ties keep first appearance
        const groups = groupStatements(entries);
        const outstanding = new Set(entries.flatMap(e => e.names)).size;
        const notStarted = everyone.filter(n => !stage.started.has(n)).sort(byName);
        return { stream: stage.stream, stage: stage.stage, outstanding, notStarted, groups };
      })
      .filter(stage => stage.groups.length),
  };
}
