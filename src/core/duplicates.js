/**
 * Statements that recur across streams under different ids, and the members
 * who have one copy ticked but not another. A leader who verified "I can
 * explain the buddy system" for Bushcraft can tick it for Aquatics too, and
 * this is the list of where that applies. Pure, no I/O.
 *
 * "Ticked" means Terrain has the statement verified, or the stage is
 * submitted or awarded. "Missing" is only counted in stages the member has
 * in progress: a stream they have never started would otherwise list every
 * statement they have ticked anywhere.
 */

import { streamRank, templateKey } from './report.js';
import { sameWording } from './outstanding.js';

const byPlace = (a, b) => streamRank(a.stream) - streamRank(b.stream) || a.stage - b.stage;
const place = ({ stream, stage }) => ({ stream, stage });

function statementsFor(templates, cell) {
  return templates.get(templateKey(cell.stream, cell.stage, cell.version ?? undefined))
    ?? templates.get(templateKey(cell.stream, cell.stage, undefined))
    ?? [...templates].find(([k]) => k.startsWith(`${cell.stream}/${cell.stage}/`))?.[1]
    ?? [];
}

/**
 * @param {Array<{ name, cells }>} report  from buildReport()
 * @param {{ templates: Map, streams: string[], stages: number[] }} options  as given to buildOutstandingReport()
 * @returns {{ total, wordings: Array<{ label, places, members: Array<{ name, ticked, missing }> }> }}
 */
export function buildDuplicates(report, { templates = new Map(), streams = [], stages = [] } = {}) {
  // wording -> { label, places: Set<"stream/stage">, perMember: Map<name, { ticked: Set, missing: Set }> }
  const wordings = new Map();
  const noteWording = (label, verifiable) => {
    if (verifiable === false) return null;
    const key = sameWording(label);
    if (!wordings.has(key)) wordings.set(key, { label, places: new Map(), perMember: new Map() });
    return wordings.get(key);
  };
  const addPlace = (w, stream, stage) => w.places.set(`${stream}/${stage}`, { stream: stream, stage: Number(stage) });

  for (const stream of streams) {
    for (const stage of stages) {
      const template = statementsFor(templates, { stream, stage });
      for (const s of template) { const w = noteWording(s.label, s.verifiable); if (w) addPlace(w, stream, stage); }
    }
  }

  for (const member of report) {
    for (const cell of member.cells) {
      if (cell.state === 'unknown') continue;
      const missing = new Set(cell.missing.map(m => m.id));
      for (const s of statementsFor(templates, cell)) {
        const w = noteWording(s.label, s.verifiable);
        if (!w) continue;
        addPlace(w, cell.stream, cell.stage);
        if (!w.perMember.has(member.name)) w.perMember.set(member.name, { ticked: new Map(), missing: new Map() });
        const entry = w.perMember.get(member.name);
        const done = cell.state !== 'in_progress' || !missing.has(s.id);
        (done ? entry.ticked : entry.missing).set(`${cell.stream}/${cell.stage}`, place(cell));
      }
    }
  }

  return {
    total: report.length,
    wordings: [...wordings.values()]
      .filter(w => w.places.size > 1)
      .map(w => ({
        label: w.label,
        places: [...w.places.values()].sort(byPlace),
        members: [...w.perMember]
          .filter(([, e]) => e.ticked.size && e.missing.size)
          .map(([name, e]) => ({ name, ticked: [...e.ticked.values()].sort(byPlace), missing: [...e.missing.values()].sort(byPlace) }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .filter(w => w.members.length)
      .sort((a, b) => byPlace(a.places[0], b.places[0]) || a.label.localeCompare(b.label)),
  };
}
