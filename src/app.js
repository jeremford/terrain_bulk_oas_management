/** Wiring: DOM events -> session, client, plan, apply. */

import { Session, BRANCHES } from './auth/cognito.js';
import { TerrainClient } from './api/terrain.js';
import { fetchTemplate, parseStatements } from './core/template.js';
import { unitsFromProfiles, selfFromProfiles, buildMemberRows, isComplete } from './core/model.js';
import { buildPlan, describePlan, submitOnlyEntries } from './core/plan.js';
import { renderGrid, readSelections, readSubmitRequests } from './ui/grid.js';
import { buildOutstanding, buildOutstandingReport } from './core/outstanding.js';
import { outstandingToPdf, outstandingReportToPdf } from './core/outstanding-pdf.js';
import { buildDuplicates } from './core/duplicates.js';
import { duplicatesToPdf } from './core/duplicates-pdf.js';
import { buildReport, normaliseRecords, recordFilter, templateKey } from './core/report.js';
import { reportToPdf } from './core/report-pdf.js';
import { renderReport, reportAsHtml, canvasMeasurer } from './ui/report.js';

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
  $('reportFields').disabled = false;
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

// ---- progress report ------------------------------------------------------

const REPORT_CONCURRENCY = 3;   // reads only, but the limits are still unknown

/** Runs fn over items with a small concurrency cap, reporting progress. */
async function mapLimited(items, fn, onProgress) {
  const results = new Array(items.length);
  let next = 0, done = 0;
  await Promise.all(Array.from({ length: Math.min(REPORT_CONCURRENCY, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
      onProgress(++done, items.length);
    }
  }));
  return results;
}

let reportArticle = null;
let reportData = null;     // { report, unitName, stages } behind the download buttons

/** A row of labelled checkboxes with all/none shortcuts. */
function renderChecks(host, values, checked) {
  host.replaceChildren();
  for (const value of values) {
    const label = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.value = String(value);
    box.checked = checked.includes(value);
    label.appendChild(box);
    label.appendChild(document.createTextNode(` ${value}`));
    host.appendChild(label);
  }
  for (const [text, on] of [['all', true], ['none', false]]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.addEventListener('click', () => {
      for (const box of host.querySelectorAll('input')) box.checked = on;
    });
    host.appendChild(button);
  }
}

const readChecks = host => [...host.querySelectorAll('input:checked')].map(box => box.value);

// Streams come from the picker above so the two lists cannot drift apart.
// OAS runs to stage 9 for the older sections; a Cub unit lives in 1 to 3.
const REPORT_STREAMS = [...$('stream').options].map(o => o.value);
const REPORT_STAGES = [1, 2, 3, 4, 5, 6, 7, 8, 9];
renderChecks($('reportStreams'), REPORT_STREAMS, REPORT_STREAMS);
renderChecks($('reportStages'), REPORT_STAGES, [1, 2, 3]);

$('buildReport').addEventListener('click', async () => {
  const status = $('reportStatus');
  $('reportSection').hidden = true;
  $('buildReport').disabled = true;

  try {
    const { unitId } = context();
    if (!unitId || unitId === '__manual') throw new Error('Choose a unit first.');
    const unitName = unitLabel();
    const includeLeaders = !$('reportExcludeLeaders').checked;
    const include = {
      streams: readChecks($('reportStreams')),
      stages: readChecks($('reportStages')).map(Number),
    };
    if (!include.streams.length || !include.stages.length) throw new Error('Tick at least one stream and one stage.');

    setStatus(status, 'Loading roster…');
    const rosterResponse = await client.getUnitMembers(unitId);
    const roster = rosterResponse?.results ?? rosterResponse ?? [];

    // Only fetch records for the members who will appear.
    const memberIds = buildReport({ roster, records: new Map(), templates: new Map(), includeLeaders })
      .map(m => m.memberId);

    const records = new Map();
    await mapLimited(memberIds, async memberId => {
      records.set(memberId, await client.getMemberAchievements(memberId));
    }, (done, total) => setStatus(status, `Loading member records… ${done} of ${total}`));

    // Each record pins its own template version; fetch each distinct one once,
    // and only for the streams and stages that will be shown.
    const keys = new Map();
    const wanted = recordFilter(include);
    for (const raw of records.values()) {
      for (const rec of normaliseRecords(raw).filter(wanted)) {
        keys.set(templateKey(rec.stream, rec.stage, rec.version), rec);
      }
    }
    // The outstanding-by-statement PDF lists every statement of every selected
    // stage, so stages no record pins need their current template too. Those
    // are best effort: a stream may simply have no template at that stage.
    const pinned = new Set([...keys.values()].map(rec => `${rec.stream}/${rec.stage}`));
    const unpinned = include.streams.flatMap(stream => include.stages
      .filter(stage => !pinned.has(`${stream}/${stage}`))
      .map(stage => ({ stream, stage, version: undefined })));
    setStatus(status, `Loading ${keys.size + unpinned.length} templates…`);
    const templates = new Map();
    const load = async (key, rec, warn) => {
      try {
        templates.set(key, parseStatements(await fetchTemplate(rec.stream, rec.stage, rec.version)));
      } catch (err) {
        if (warn) console.warn(`template ${key}: ${err.message}`);
      }
    };
    await Promise.all([
      ...[...keys].map(([key, rec]) => load(key, rec, true)),
      ...unpinned.map(rec => load(templateKey(rec.stream, rec.stage, undefined), rec, false)),
    ]);

    const report = buildReport({ roster, records, templates, includeLeaders, include });
    reportData = { report, unitName, stages: include.stages, streams: include.streams, templates };
    reportArticle = renderReport($('report'), report, { unitName, generatedAt: new Date(), stages: include.stages });
    $('reportSection').hidden = false;
    $('reportSection').scrollIntoView({ behavior: 'smooth', block: 'start' });

    const missingTemplates = [...keys.keys()].filter(key => !templates.has(key)).length;
    setStatus(status,
      `${report.length} members · ${keys.size - missingTemplates} templates` +
      (missingTemplates ? ` · ${missingTemplates} template(s) could not be loaded` : ''),
      missingTemplates ? 'warn' : 'ok');
  } catch (err) {
    setStatus(status, err.message, 'err');
  } finally {
    $('buildReport').disabled = false;
  }
});

$('printReport').addEventListener('click', () => window.print());

const slugify = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const unitLabel = () => $('unit').selectedOptions[0]?.textContent.split(' — ')[0] ?? $('unit').value;

function downloadFile(content, type, extension, prefix = `oas-progress-${slugify(reportData.unitName)}`) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${prefix}-${new Date().toISOString().slice(0, 10)}.${extension}`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// The grid inverted: per statement, who still needs it. Reflects what Terrain
// has recorded, not boxes ticked in the grid but not yet applied.
$('downloadOutstanding').addEventListener('click', async () => {
  const button = $('downloadOutstanding');
  button.disabled = true;
  try {
    const { stream, stage } = context();
    const unitName = unitLabel();
    const bytes = await outstandingToPdf(buildOutstanding(members, statements), {
      unitName, stream, stage, generatedAt: new Date(), measure: canvasMeasurer(),
    });
    downloadFile(bytes, 'application/pdf', 'pdf', `oas-outstanding-${stream}-${stage}-${slugify(unitName)}`);
    setStatus($('outstandingStatus'), '');
  } catch (err) {
    setStatus($('outstandingStatus'), `PDF failed: ${err.message}`, 'err');
  } finally {
    button.disabled = false;
  }
});

$('downloadReport').addEventListener('click', () => {
  if (!reportArticle) return;
  downloadFile(reportAsHtml(reportArticle, { unitName: reportData.unitName }), 'text/html', 'html');
});

// Generated here rather than via the print dialog: the browser's PDF of this
// page came out at tens of megabytes on macOS. Ours is text-only Helvetica.
$('downloadPdf').addEventListener('click', async () => {
  if (!reportData) return;
  const button = $('downloadPdf');
  button.disabled = true;
  try {
    const bytes = await reportToPdf(reportData.report, {
      unitName: reportData.unitName,
      generatedAt: new Date(),
      stages: reportData.stages,
      measure: canvasMeasurer(),
    });
    downloadFile(bytes, 'application/pdf', 'pdf');
  } catch (err) {
    setStatus($('reportStatus'), `PDF failed: ${err.message}`, 'err');
  } finally {
    button.disabled = false;
  }
});

// The same report turned inside out: per stage, per statement, who still needs it.
$('downloadOutstandingReport').addEventListener('click', async () => {
  if (!reportData) return;
  const button = $('downloadOutstandingReport');
  button.disabled = true;
  try {
    const data = buildOutstandingReport(reportData.report, { templates: reportData.templates, streams: reportData.streams, stages: reportData.stages });
    const bytes = await outstandingReportToPdf(data, {
      unitName: reportData.unitName, generatedAt: new Date(), measure: canvasMeasurer(),
    });
    downloadFile(bytes, 'application/pdf', 'pdf', `oas-outstanding-${slugify(reportData.unitName)}`);
  } catch (err) {
    setStatus($('reportStatus'), `PDF failed: ${err.message}`, 'err');
  } finally {
    button.disabled = false;
  }
});

// Recurring statements a member has ticked in one stream but not another.
$('downloadDuplicates').addEventListener('click', async () => {
  if (!reportData) return;
  const button = $('downloadDuplicates');
  button.disabled = true;
  try {
    const data = buildDuplicates(reportData.report, { templates: reportData.templates, streams: reportData.streams, stages: reportData.stages });
    const bytes = await duplicatesToPdf(data, { unitName: reportData.unitName, generatedAt: new Date(), measure: canvasMeasurer() });
    downloadFile(bytes, 'application/pdf', 'pdf', `oas-duplicates-${slugify(reportData.unitName)}`);
  } catch (err) {
    setStatus($('reportStatus'), `PDF failed: ${err.message}`, 'err');
  } finally {
    button.disabled = false;
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
