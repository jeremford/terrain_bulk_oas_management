/**
 * Turns grid selections into the exact HTTP requests that would be sent.
 *
 * Nothing here performs I/O. The plan is rendered for review first, which is
 * the point: you see every request before anything is written.
 */

export function todayAU(date = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

/**
 * Terrain replaces the whole answers map on write, so we start from what is
 * already stored and add to it. Existing verifications are preserved.
 */
export function mergeAnswers({ existing, statements, verifier, date }) {
  const answers = structuredClone(existing ?? {});

  for (const statement of statements) {
    answers[statement.id] = true;
    if (statement.verifiable) {
      answers[`${statement.id}_verifierType`] = 'member';
      answers[`${statement.id}_verifierName`] = verifier.name;
      answers[`${statement.id}_verifierContact`] = verifier.contact;
      answers[`${statement.id}_verifiedDate`] = date;
    }
  }

  if (!('file_uploader' in answers)) answers.file_uploader = [];
  return answers;
}

export function buildDocument({ member, statements, verifier, context, templateVersion, date }) {
  const { stream, stage, section } = context;
  const doc = {
    achievement_meta: { stage: Number(stage), stream, branch: stream },
    achievement_type: 'outdoor_adventure_skill',
    template: `oas/${stream}/${stage}`,
    // Existing records keep their pinned version; new ones take the current template.
    version: member.achievementId ? member.version : templateVersion,
    section,
    answers: mergeAnswers({ existing: member.answers, statements, verifier, date }),
    uploads: member.uploads ?? [],
  };
  // Echoed back on update - looks like optimistic concurrency, so preserve it.
  if (member.achievementId && member.lastUpdated) doc.last_updated = member.lastUpdated;
  return doc;
}

/**
 * @param {Map<member, statement[]>} selections
 * @returns {Array} one entry per member with changes
 */
export function buildPlan({ selections, verifier, context, templateVersion, date = todayAU() }) {
  const plan = [];

  for (const [member, statements] of selections) {
    if (!statements.length) continue;
    const document = buildDocument({ member, statements, verifier, context, templateVersion, date });
    const isUpdate = Boolean(member.achievementId);

    plan.push({
      member,
      statements,
      method: isUpdate ? 'PUT' : 'POST',
      path: isUpdate
        ? `/members/${member.memberId}/achievements/${member.achievementId}`
        : `/members/${member.memberId}/achievements`,
      document,
    });
  }
  return plan;
}

/**
 * Fully-verified records still in draft_review have nothing left to tick, so a
 * save pass can never reach them. When "also submit" is on they get their own
 * submit-only entries — no document write, just the submit-on-behalf.
 */
export function submitOnlyEntries({ members, statements, selections }) {
  return members
    .filter(m => m.status === 'draft_review' && m.achievementId)
    .filter(m => !(selections.get(m)?.length))   // already being saved -> submitted there
    .filter(m => statements.length > 0 && statements.every(s => m.answers[s.id] === true))
    .map(member => ({
      member,
      statements: [],
      submitOnly: true,
      method: 'POST',
      path: `/members/${member.memberId}/achievements/${member.achievementId}/submit-on-behalf`,
    }));
}

export function describePlan(plan, { alsoSubmit, unitId, submittedBy }) {
  if (!plan.length) return 'Nothing ticked - no requests would be sent.';

  return plan
    .map(entry => {
      if (entry.submitOnly) {
        return [
          `${entry.method} ${entry.path} ${JSON.stringify({ type: 'review', unit_id: unitId, submitted_by: submittedBy })}`,
          `  member  : ${entry.member.name}  (${entry.member.status}, already fully verified — submit only)`,
          `  wrapped : assume-profiles(${entry.member.memberId}) ... revoke-assumed-profiles`,
        ].join('\n');
      }
      const lines = [
        `${entry.method} ${entry.path}`,
        `  member  : ${entry.member.name}  (${entry.member.status})`,
        `  ticking : ${entry.statements.map(s => s.label).join('\n            ')}`,
        `  body    : ${JSON.stringify(entry.document, null, 2).split('\n').join('\n            ')}`,
      ];
      if (alsoSubmit) {
        // For new records the id only exists once the POST above returns.
        const target = entry.member.achievementId ?? '{id-from-create-response}';
        lines.push(`  then    : POST /members/${entry.member.memberId}/achievements/${target}/submit-on-behalf ` +
                   JSON.stringify({ type: 'review', unit_id: unitId, submitted_by: submittedBy }));
      }
      lines.push(`  wrapped : assume-profiles(${entry.member.memberId}) ... revoke-assumed-profiles`);
      return lines.join('\n');
    })
    .join(`\n\n${'-'.repeat(92)}\n\n`);
}
