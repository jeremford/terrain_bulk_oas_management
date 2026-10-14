/** Renders the member x statement grid and reads selections back out. */

import { isLocked } from '../core/model.js';
import { showStatementInfo } from './info.js';
import { el } from './dom.js';

function headerCell(statement) {
  const th = el('th', 'stmt');

  const label = el('span', 'label');
  label.textContent = statement.label;
  label.title = statement.label;
  th.appendChild(label);

  const info = el('button', 'info');
  info.type = 'button';
  info.textContent = 'i';
  info.title = 'Full statement and assessment guidance';
  info.setAttribute('aria-label', `Details for: ${statement.label}`);
  info.addEventListener('click', () => showStatementInfo(statement));
  th.appendChild(info);

  return th;
}

/** Ticks every remaining box in the row, or clears them all if none are left. */
function rowTickButton(row) {
  const button = el('button', 'tickrow');
  button.type = 'button';
  button.textContent = 'all';
  button.title = 'Tick every remaining box in this row — you are attesting each one. Click again to clear.';
  button.addEventListener('click', () => {
    const boxes = [...row.querySelectorAll('input[type=checkbox]')];
    const allTicked = boxes.every(box => box.checked);
    for (const box of boxes) box.checked = !allTicked;
  });
  return button;
}

/** Fully-verified drafts have no boxes left, so they get an explicit submit toggle. */
function submitToggle(memberIndex) {
  const label = el('label', 'submitrow');
  label.title = 'Everything is verified but the record is still a draft — tick to submit it for review';
  const box = el('input');
  box.type = 'checkbox';
  box.dataset.submit = String(memberIndex);
  label.appendChild(box);
  label.appendChild(document.createTextNode(' submit'));
  return label;
}

export function renderGrid(table, members, statements) {
  table.replaceChildren();

  const header = el('tr');
  header.appendChild(el('th'));
  for (const statement of statements) header.appendChild(headerCell(statement));
  header.appendChild(el('th'));
  table.appendChild(header);

  members.forEach((member, memberIndex) => {
    const row = el('tr');

    const nameCell = el('td', 'name');
    nameCell.textContent = member.name;
    const detail = el('div', 'detail');
    detail.textContent = member.detail ? `${member.status} · ${member.detail}` : member.status;
    nameCell.appendChild(detail);
    row.appendChild(nameCell);

    statements.forEach((statement, statementIndex) => {
      const cell = el('td', 'cell');
      const alreadyDone = member.answers[statement.id] === true;

      if (alreadyDone) {
        const mark = el('span', 'done');
        mark.textContent = '✓';
        const who = member.answers[`${statement.id}_verifierName`];
        if (who) mark.title = `verified by ${who}`;
        cell.appendChild(mark);
      } else if (isLocked(member)) {
        const mark = el('span', 'locked');
        mark.textContent = '–';
        mark.title = `record is ${member.status}`;
        cell.appendChild(mark);
      } else {
        const box = el('input');
        box.type = 'checkbox';
        box.dataset.member = String(memberIndex);
        box.dataset.statement = String(statementIndex);
        cell.appendChild(box);
      }
      row.appendChild(cell);
    });

    const tickCell = el('td', 'rowtick');
    const tickable = !isLocked(member) && statements.some(s => member.answers[s.id] !== true);
    const submitReady = member.status === 'draft_review' && member.achievementId
      && statements.length > 0 && statements.every(s => member.answers[s.id] === true);
    if (tickable) tickCell.appendChild(rowTickButton(row));
    else if (submitReady) tickCell.appendChild(submitToggle(memberIndex));
    row.appendChild(tickCell);

    table.appendChild(row);
  });
}

/** @returns {Map<member, statement[]>} */
export function readSelections(table, members, statements) {
  const selections = new Map();
  for (const box of table.querySelectorAll('input[data-statement]:checked')) {
    const member = members[Number(box.dataset.member)];
    const statement = statements[Number(box.dataset.statement)];
    if (!selections.has(member)) selections.set(member, []);
    selections.get(member).push(statement);
  }
  return selections;
}

/** Members whose row-level "submit" toggle is ticked. */
export function readSubmitRequests(table, members) {
  return [...table.querySelectorAll('input[data-submit]:checked')]
    .map(box => members[Number(box.dataset.submit)]);
}
