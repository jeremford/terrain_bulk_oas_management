/**
 * Inverts the grid: for each statement, which members still need it. Feeds
 * the "outstanding by statement" PDF a leader takes to a night of activities.
 * Pure, no I/O.
 *
 * A member counts as done with a statement when Terrain has it verified, or
 * when their record is locked (pending review, finalised, awarded): the grid
 * shows a dash there because nothing can be ticked, so there is nothing to
 * chase. Statements nobody needs are left out entirely.
 */

import { isLocked } from './model.js';

/**
 * @param {Array<{name, status, answers}>} members  rows as shown in the grid
 * @param {Array<{id, label, group}>} statements     from parseStatements()
 * @returns {{ total, outstanding, groups: Array<{ title, statements: Array<{ id, label, names: string[] }> }> }}
 */
export function buildOutstanding(members, statements) {
  const open = members.filter(m => !isLocked(m));
  const outstanding = new Set();
  const groups = [];
  let group = null;

  for (const statement of statements) {
    const names = open
      .filter(m => m.answers?.[statement.id] !== true)
      .map(m => { outstanding.add(m); return m.name; })
      .sort((a, b) => a.localeCompare(b));
    if (!names.length) continue;

    const title = statement.group ?? '';
    if (!group || group.title !== title) {
      group = { title, statements: [] };
      groups.push(group);
    }
    group.statements.push({ id: statement.id, label: statement.label, names });
  }

  return { total: members.length, outstanding: outstanding.size, groups };
}
