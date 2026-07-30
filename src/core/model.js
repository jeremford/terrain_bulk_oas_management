/** Shaping the API responses into the rows the grid renders. */

export const LOCKED_STATUSES = ['pending_review', 'finalised', 'awarded'];

/** The signed-in leader's own member id, needed for submit-on-behalf. */
export function selfFromProfiles(profiles) {
  return profiles?.profiles?.[0]?.member?.id ?? null;
}

/**
 * The /profiles payload is undocumented, so walk it for anything unit-shaped
 * rather than assuming a schema.
 */
export function unitsFromProfiles(profiles) {
  const found = new Map();

  (function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);

    for (const [key, value] of Object.entries(node)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        if (/^unit$/i.test(key) && value.id) found.set(value.id, value.name ?? value.id);
      }
      walk(value);
    }
  })(profiles);

  return [...found].map(([id, name]) => ({ id, name }));
}

/**
 * Observed on the wire: leaders have `unit.duty` of "adult_leader", and/or sit
 * in a patrol named like "Cub Leaders" — sometimes only one of the two (their
 * patrol duty is just "member", so patrol duty says nothing about adulthood).
 */
function isLeaderEntry(raw) {
  if (raw.unit?.duty === 'adult_leader') return true;
  return /leaders/i.test(raw.patrol?.name ?? '');
}

function normaliseRosterEntry(raw) {
  const id = raw.id ?? raw.member_id;
  if (!id) return null;
  return {
    memberId: id,
    name: [raw.first_name, raw.last_name].filter(Boolean).join(' ') || raw.name || String(id).slice(0, 8),
    detail: [raw.member_number, raw.status, raw.unit?.duty ?? raw.role].filter(Boolean).join(' · '),
    isLeader: isLeaderEntry(raw),
  };
}

function normaliseAchievement(raw) {
  const memberId = raw.member?.id ?? raw.member_id;
  if (!memberId) return null;
  const ach = raw.achievement ?? raw;
  return [memberId, {
    achievementId: ach.id ?? null,
    status: ach.status ?? 'draft_review',
    version: ach.version,
    answers: ach.answers ?? {},
    lastUpdated: ach.last_updated ?? null,
    uploads: ach.uploads ?? [],
    name: raw.member ? `${raw.member.first_name} ${raw.member.last_name}` : null,
  }];
}

/**
 * Left-joins existing achievement records onto the unit roster, so members who
 * have not started the stage still appear as rows.
 */
export function buildMemberRows({ roster = [], achievements = [], templateVersion }) {
  const records = new Map(
    (achievements ?? []).map(normaliseAchievement).filter(Boolean)
  );

  const base = roster.length
    ? roster.map(normaliseRosterEntry).filter(Boolean)
    : [...records].map(([memberId, rec]) => ({ memberId, name: rec.name ?? memberId, detail: '' }));

  return base
    .map(member => {
      const rec = records.get(member.memberId) ?? {};
      return {
        ...member,
        name: member.name || rec.name || member.memberId,
        isLeader: member.isLeader ?? false,
        achievementId: rec.achievementId ?? null,
        status: rec.status ?? 'not started',
        version: rec.version ?? templateVersion,
        answers: rec.answers ?? {},
        lastUpdated: rec.lastUpdated ?? null,
        uploads: rec.uploads ?? [],
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function isLocked(member) {
  return LOCKED_STATUSES.includes(member.status);
}

/**
 * "Complete" for filtering purposes: the record is locked (pending review,
 * finalised or awarded), or every statement in the template is already
 * verified — nothing left to tick either way.
 */
export function isComplete(member, statements) {
  if (isLocked(member)) return true;
  return statements.length > 0 && statements.every(s => member.answers[s.id] === true);
}
