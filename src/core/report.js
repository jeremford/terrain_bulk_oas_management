/**
 * OAS progress report: per member, per stream, per stage, what is still missing.
 *
 * Pure. Takes the roster, each member's OAS records and the parsed templates,
 * and returns a structure the UI renders. The question it answers for a leader
 * is "what does this young person still need before we can award the next
 * stage", so the emphasis is on missing statements and on complete stages that
 * are held up by an unfinished lower stage.
 */

import { buildMemberRows } from './model.js';

/** Same order the app's stream picker uses: the three core streams first. */
export const STREAM_ORDER = [
  'bushcraft', 'bushwalking', 'camping', 'alpine', 'aquatics',
  'boating', 'cycling', 'paddling', 'vertical',
];

export const templateKey = (stream, stage, version) => `${stream}/${stage}/${version ?? 'latest'}`;

const streamRank = s => {
  const i = STREAM_ORDER.indexOf(s);
  return i === -1 ? STREAM_ORDER.length : i;
};

/**
 * Lifts the per-member achievements response into { stream, stage, version,
 * status, answers, achievementId }. Tolerates both the bare record and the
 * { achievement: … } wrapper the unit endpoint uses.
 */
export function normaliseRecords(raw) {
  const list = raw?.results ?? raw ?? [];
  return list
    .map(r => {
      const ach = r.achievement ?? r;
      const meta = ach.achievement_meta ?? {};
      if (!meta.stream || meta.stage === undefined) return null;
      return {
        stream: meta.stream,
        stage: Number(meta.stage),
        version: ach.version,
        status: ach.status ?? 'draft_review',
        answers: ach.answers ?? {},
        achievementId: ach.id ?? null,
      };
    })
    .filter(Boolean);
}

/**
 * One stage of one stream for one member.
 *
 * state is one of:
 *   awarded      Terrain has awarded it
 *   submitted    pending_review or finalised — out of the unit's hands
 *   complete     every statement verified but still a draft
 *   in_progress  a draft with statements outstanding
 *   unknown      no template could be matched, so nothing can be said
 */
export function stageProgress(record, statements) {
  const base = {
    stream: record.stream,
    stage: record.stage,
    version: record.version ?? null,
    status: record.status,
    achievementId: record.achievementId,
  };

  if (record.status === 'awarded') return { ...base, state: 'awarded', total: 0, done: 0, missing: [], logbookOnly: false };

  if (!statements) return { ...base, state: 'unknown', total: 0, done: 0, missing: [], logbookOnly: false };

  const missing = statements
    .filter(s => record.answers[s.id] !== true)
    .map(({ id, label, group, verifiable }) => ({ id, label, group, verifiable: verifiable !== false }));
  const total = statements.length;
  const done = total - missing.length;
  // The only non-verifiable statement in the syllabus is "my logbook is up to
  // date", which the young person does themselves. If that is all that is left,
  // no leader attestation is outstanding.
  const logbookOnly = missing.length > 0 && missing.every(m => !m.verifiable);

  let state;
  if (record.status === 'pending_review' || record.status === 'finalised') state = 'submitted';
  else if (total > 0 && missing.length === 0) state = 'complete';
  else state = 'in_progress';

  return { ...base, state, total, done, missing, logbookOnly };
}

const settled = s => s.state === 'awarded' || s.state === 'submitted';

/**
 * Stages are awarded in order, so a complete stage 3 waits on an unfinished
 * stage 2. Marks each settled-or-complete stage with the lowest in-progress
 * stage below it, if any.
 */
function markBlocked(stages) {
  let lowestOpen = null;
  for (const s of stages) {
    if (s.state === 'in_progress' || s.state === 'unknown') {
      if (lowestOpen === null) lowestOpen = s.stage;
      s.blockedBy = null;
    } else {
      s.blockedBy = lowestOpen;
    }
  }
  return stages;
}

/**
 * Something a leader can act on quickly: the lowest open stage in a stream,
 * when it is nearly done or when finishing it would release higher stages.
 */
function callout(stream, stages) {
  const open = stages.find(s => s.state === 'in_progress');
  if (!open) return null;
  const releases = stages.filter(s => s.stage > open.stage && (s.state === 'complete' || s.state === 'submitted'));
  const nearly = open.missing.length <= 3;
  if (!nearly && !releases.length) return null;
  return {
    stream,
    stage: open.stage,
    remaining: open.missing.length,
    logbookOnly: open.logbookOnly,
    releases: releases.map(s => s.stage),
  };
}

/**
 * @param {object}   opts
 * @param {object[]} opts.roster       raw /units/{id}/members entries
 * @param {Map}      opts.records      memberId -> raw achievements response
 * @param {Map}      opts.templates    templateKey -> parsed statements
 * @param {boolean}  [opts.includeLeaders=false]
 * @param {{ streams?: Iterable<string>, stages?: Iterable<number> }} [opts.include]
 *        restricts the report to these streams and stages; omit either for all
 */
export function buildReport({ roster, records, templates, includeLeaders = false, include = {} }) {
  const members = buildMemberRows({ roster, achievements: [], templateVersion: null })
    .filter(m => includeLeaders || !m.isLeader);
  const wanted = recordFilter(include);

  return members.map(member => {
    const byStream = new Map();
    for (const rec of normaliseRecords(records.get(member.memberId)).filter(wanted)) {
      const statements = templates.get(templateKey(rec.stream, rec.stage, rec.version))
        ?? templates.get(templateKey(rec.stream, rec.stage, undefined))
        ?? null;
      if (!byStream.has(rec.stream)) byStream.set(rec.stream, []);
      byStream.get(rec.stream).push(stageProgress(rec, statements));
    }

    const streams = [...byStream]
      .sort(([a], [b]) => streamRank(a) - streamRank(b) || a.localeCompare(b))
      .map(([stream, stages]) => {
        stages.sort((a, b) => a.stage - b.stage);
        markBlocked(stages);
        return { stream, stages, callout: callout(stream, stages) };
      });

    const pick = state => streams.flatMap(s => s.stages.filter(st => st.state === state).map(st => ({ stream: s.stream, stage: st.stage })));
    const awarded = pick('awarded');
    const submitted = pick('submitted');
    const callouts = streams.map(s => s.callout).filter(Boolean);
    const open = streams.filter(s => s.stages.some(st => !settled(st)));
    // Every stage, settled or not, for the summary table.
    const cells = streams.flatMap(s => s.stages);

    return { memberId: member.memberId, name: member.name, awarded, submitted, callouts, streams: open, cells };
  });
}

export const titleCase = s => s.charAt(0).toUpperCase() + s.slice(1);
const listWords = xs => xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`;

/** One sentence for a callout, e.g. "Bushcraft 2: 1 statement to go, then stages 2 and 3 can be awarded." */
export function describeCallout(c) {
  const steps = c.logbookOnly ? 'only the logbook is left' : `${c.remaining} statement${c.remaining === 1 ? '' : 's'} to go`;
  if (!c.releases.length) return `${titleCase(c.stream)} ${c.stage}: ${steps}.`;
  const stages = listWords([c.stage, ...c.releases].map(String));
  return `${titleCase(c.stream)} ${c.stage}: ${steps}, then stage${c.releases.length ? 's' : ''} ${stages} can be awarded.`;
}

/** The note beside a stage heading in the detail, e.g. "11 of 12 verified". */
export function describeStageNote(stage) {
  switch (stage.state) {
    case 'in_progress': return `${stage.done} of ${stage.total} verified`;
    case 'complete': return stage.blockedBy
      ? `all ${stage.total} verified · waiting on stage ${stage.blockedBy}`
      : `all ${stage.total} verified · draft, not yet submitted`;
    case 'submitted': return `submitted · ${stage.status.replace('_', ' ')}`;
    case 'awarded': return 'awarded';
    default: return `template ${stage.version ?? 'latest'} not found — cannot list statements`;
  }
}

export const SUMMARY_LEGEND =
  '✓ awarded · ✓ (amber) fully verified, not yet awarded · remaining / total · log: only the logbook is left · blank: not started';

/** Human form of a stage for the summary line, e.g. "2 · 1 to go". */
export function describeStage(s) {
  switch (s.state) {
    case 'awarded': return `${s.stage} awarded`;
    case 'submitted': return `${s.stage} submitted`;
    case 'complete': return s.blockedBy ? `${s.stage} complete, waiting on ${s.blockedBy}` : `${s.stage} complete, not submitted`;
    case 'in_progress': return `${s.stage} · ${s.missing.length} to go`;
    default: return `${s.stage} · template not found`;
  }
}

/** Predicate over normalised records for the stream/stage selection. */
export function recordFilter({ streams, stages } = {}) {
  const streamSet = streams ? new Set(streams) : null;
  const stageSet = stages ? new Set([...stages].map(Number)) : null;
  return rec => (!streamSet || streamSet.has(rec.stream)) && (!stageSet || stageSet.has(rec.stage));
}

/**
 * Column layout for the summary table: the streams anyone in the unit has a
 * record in, in app order, and the chosen stages. With no explicit stages,
 * 1 to at least 3, higher if any record goes further (e.g. a Scout's stage 4).
 */
export function summaryColumns(report, stages) {
  const streams = new Set();
  let maxStage = 3;
  for (const m of report) {
    for (const c of m.cells) {
      streams.add(c.stream);
      if (c.stage > maxStage) maxStage = c.stage;
    }
  }
  return {
    streams: [...streams].sort((a, b) => streamRank(a) - streamRank(b) || a.localeCompare(b)),
    stages: stages
      ? [...new Set([...stages].map(Number))].sort((a, b) => a - b)
      : Array.from({ length: maxStage }, (_, i) => i + 1),
  };
}

/**
 * What goes in one summary cell. `mark` is the short text; `kind` drives styling.
 *   { kind: 'awarded',   mark: '✓' }
 *   { kind: 'complete',  mark: '✓' }        verified in full, not yet awarded
 *   { kind: 'logbook',   mark: 'log' }      only the logbook checkbox is left
 *   { kind: 'open',      mark: '3 / 12' }   remaining / total
 *   { kind: 'unknown',   mark: '?' }
 *   null                                    no record
 */
export function summaryCell(stage) {
  if (!stage) return null;
  switch (stage.state) {
    case 'awarded': return { kind: 'awarded', mark: '✓' };
    case 'submitted':
    case 'complete': return { kind: 'complete', mark: '✓' };
    case 'in_progress': return stage.logbookOnly
      ? { kind: 'logbook', mark: 'log' }
      : { kind: 'open', mark: `${stage.missing.length} / ${stage.total}` };
    default: return { kind: 'unknown', mark: '?' };
  }
}
