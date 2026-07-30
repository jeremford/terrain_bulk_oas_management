/** Wiring: DOM events -> session, client, plan, apply. */

import { Session, BRANCHES } from './auth/cognito.js';
import { TerrainClient } from './api/terrain.js';
import { fetchTemplate, parseStatements } from './core/template.js';
import { unitsFromProfiles, selfFromProfiles, buildMemberRows, isComplete } from './core/model.js';
import { buildPlan, describePlan, submitOnlyEntries } from './core/plan.js';
import { renderGrid, readSelections, readSubmitRequests } from './ui/grid.js';

const $ = id => document.getElementById(id);
const RATE_LIMIT_MS = 400;   // unknown server limits - stay gentle

const session = new Session();
const client = new TerrainClient(session);

let statements = [];
let members = [];
let templateVersion = null;
let plan = [];
let selfMemberId = null;   // the signed-in leader, for submit-on-behalf

const context = () => ({
  unitId: $('unit').value,
  stream: $('stream').value,
  stage: $('stage').value.trim(),
  section: $('section').value,
});

const verifier = () => ({
  name: $('verifierName').value.trim(),
  contact: $('verifierContact').value.trim(),
});

function setStatus(node, message, kind = '') {
  node.className = `status ${kind}`;
  node.textContent = message;
}

// ---- remembered settings --------------------------------------------------
// Convenience fields only — the leader's own branch, member number and verifier
// details. Never passwords, never tokens, never youth member data.

const PREFS_KEY = 'terrain-oas-bulk-entry';
const PREF_FIELDS = ['branch', 'memberNumber', 'verifierName', 'verifierContact'];

function restorePrefs() {
  let prefs;
  try { prefs = JSON.parse(localStorage.getItem(PREFS_KEY)) ?? {}; } catch { prefs = {}; }
  for (const field of PREF_FIELDS) {
    if (typeof prefs[field] === 'string' && prefs[field]) $(field).value = prefs[field];
  }
}

function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(
      Object.fromEntries(PREF_FIELDS.map(field => [field, $(field).value.trim()]))
    ));
  } catch { /* private browsing - remembering settings is best effort */ }
}

// ---- sign in --------------------------------------------------------------

for (const branch of BRANCHES) {
  const option = document.createElement('option');
  option.value = option.textContent = branch;
  $('branch').appendChild(option);
}
$('branch').value = 'qld';
restorePrefs();

async function afterSignIn() {
  $('contextFields').disabled = false;
  setStatus($('authStatus'), `Signed in. Token valid for about ${Math.round((session.expiresAt - Date.now()) / 60000)} minutes.`, 'ok');

  const unitSelect = $('unit');
  unitSelect.replaceChildren();

  try {
    const profiles = await client.getProfiles();
    selfMemberId = selfFromProfiles(profiles);
    const units = unitsFromProfiles(profiles);
    for (const unit of units) {
      const option = document.createElement('option');
      option.value = unit.id;
      option.textContent = `${unit.name} — ${unit.id.slice(0, 8)}…`;
      unitSelect.appendChild(option);
    }
    if (!units.length) throw new Error('no units found in profile');
  } catch (err) {
    setStatus($('authStatus'), `Signed in, but unit lookup failed (${err.message}). Enter a unit ID manually.`, 'warn');
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'Enter unit ID manually…';
    unitSelect.appendChild(option);
  }

  const manual = document.createElement('option');
  manual.value = '__manual';
  manual.textContent = 'Other / paste a unit ID…';
  unitSelect.appendChild(manual);

  unitSelect.addEventListener('change', () => {
    if (unitSelect.value !== '__manual') return;
    const id = prompt('Unit ID:')?.trim();
    if (!id) { unitSelect.selectedIndex = 0; return; }
    const option = document.createElement('option');
    option.value = id;
    option.textContent = `${id.slice(0, 8)}… (manual)`;
    unitSelect.insertBefore(option, unitSelect.firstChild);
    unitSelect.value = id;
  });
}

$('signIn').addEventListener('click', async () => {
  const memberNumber = $('memberNumber').value.trim();
  const password = $('password').value;

  const missing = [];
  if (!memberNumber) missing.push('member number');
  if (!password) missing.push('password');
  if (missing.length) {
    setStatus($('authStatus'), `Enter your ${missing.join(' and ')} to sign in.`, 'err');
    (memberNumber ? $('password') : $('memberNumber')).focus();
    return;
  }

  setStatus($('authStatus'), 'Signing in…');
  try {
    await session.signIn($('branch').value, memberNumber, password);
    $('password').value = '';
    savePrefs();
    await afterSignIn();
  } catch (err) {
    setStatus($('authStatus'), err.message, 'err');
  }
});

// ---- load grid ------------------------------------------------------------

$('load').addEventListener('click', async () => {
  setStatus($('loadStatus'), 'Loading…');
  $('gridSection').hidden = true;
  savePrefs();

  try {
    const { unitId, stream, stage } = context();
    if (!unitId || unitId === '__manual') throw new Error('Choose a unit first.');

    const template = await fetchTemplate(stream, stage);
    templateVersion = template.version;
    statements = parseStatements(template);

    let roster = [];
    let rosterError = null;
    try {
      const response = await client.getUnitMembers(unitId);
      roster = response?.results ?? response ?? [];
    } catch (err) { rosterError = err.message; }

    const achievements = await client.getUnitAchievements({ unitId, stream, stage });

    members = buildMemberRows({
      roster,
      achievements: achievements?.results ?? achievements ?? [],
      templateVersion,
    });

    const beforeFilters = members.length;
    if ($('excludeLeaders').checked) members = members.filter(m => !m.isLeader);
    if ($('excludeCompleted').checked) members = members.filter(m => !isComplete(m, statements));
    const hidden = beforeFilters - members.length;

    renderGrid($('grid'), members, statements);
    $('gridNote').textContent =
      `✓ already verified (left untouched) · – record locked · ` +
      `"submit" appears on fully-verified drafts · template version ${templateVersion}`;
    $('gridSection').hidden = false;
    $('apply').disabled = true;
    $('planSection').hidden = true;

    setStatus($('loadStatus'),
      `${members.length} members` +
      (hidden ? ` (${hidden} hidden by filters)` : '') +
      ` · ${statements.length} statements` +
      (rosterError ? ` · roster lookup failed: ${rosterError}` : ''),
      rosterError ? 'warn' : 'ok');
  } catch (err) {
    setStatus($('loadStatus'), err.message, 'err');
  }
});

// ---- preview / apply ------------------------------------------------------

$('preview').addEventListener('click', () => {
  const selections = readSelections($('grid'), members, statements);
  plan = buildPlan({ selections, verifier: verifier(), context: context(), templateVersion });

  // Fully-ticked drafts have no boxes left; their row-level "submit" toggle lands here.
  plan = plan.concat(submitOnlyEntries({
    members: readSubmitRequests($('grid'), members),
    statements,
    selections,
  }));

  $('plan').textContent = describePlan(plan, {
    alsoSubmit: $('alsoSubmit').checked,
    unitId: context().unitId,
    submittedBy: selfMemberId,
  });
  $('planSection').hidden = false;
  $('apply').disabled = plan.length === 0;
});

$('apply').addEventListener('click', async () => {
  const confirmed = confirm(
    `Write or submit ${plan.length} member record(s) on Terrain?\n\n` +
    'This records you as the verifier on every ticked statement.'
  );
  if (!confirmed) return;

  $('apply').disabled = true;
  $('resultsSection').hidden = false;
  const log = $('log');
  log.replaceChildren();

  const { unitId } = context();
  const alsoSubmit = $('alsoSubmit').checked;

  for (const entry of plan) {
    const line = document.createElement('div');
    log.appendChild(line);
    const { member } = entry;

    try {
      // Writes always run under assist mode, matching the official UI.
      await client.assumeProfile(member.memberId);

      let message;
      if (entry.submitOnly) {
        if (!selfMemberId) throw new Error('your member id was not found in /profiles, not submitting');
        await client.submitAchievement(member.memberId, member.achievementId, unitId, selfMemberId);
        message = `${member.name} — submitted for review (already fully verified)`;
      } else {
        const saved = entry.method === 'PUT'
          ? await client.updateAchievement(member.memberId, member.achievementId, entry.document)
          : await client.createAchievement(member.memberId, entry.document);

        const achievementId = saved?.id ?? member.achievementId;
        message = `${member.name} — ${entry.method} ok (${achievementId})`;

        if (alsoSubmit) {
          // Guard against building a ".../achievements/null/submit-on-behalf" URL.
          if (!achievementId) throw new Error('save returned no achievement id, not submitting');
          if (!selfMemberId) throw new Error('your member id was not found in /profiles, not submitting');
          await client.submitAchievement(member.memberId, achievementId, unitId, selfMemberId);
          message += ' · submitted for review';
        }
      }
      await client.revokeAssumedProfiles();

      line.className = 'ok';
      line.textContent = `✓ ${message}`;
    } catch (err) {
      line.className = 'err';
      line.textContent = `✗ ${member.name} — ${err.message}`;
      try { await client.revokeAssumedProfiles(); } catch { /* best effort */ }
    }

    await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_MS));
  }

  const done = document.createElement('div');
  done.textContent = 'Finished. Reload the grid to see current state.';
  log.appendChild(done);
});
