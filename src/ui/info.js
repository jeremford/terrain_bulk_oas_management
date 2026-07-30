/**
 * The info popup behind each column header.
 *
 * Mirrors what Terrain shows behind its own info icon: the full statement plus
 * the assessment guidance from the template's `dialog_text`.
 */

let dialog = null;

function ensureDialog() {
  if (dialog) return dialog;

  dialog = document.createElement('dialog');
  dialog.className = 'info-dialog';
  dialog.innerHTML = `
    <p class="info-group"></p>
    <h3 class="info-title"></h3>
    <p class="info-body"></p>
    <form method="dialog"><button class="secondary">Close</button></form>
  `;
  // Clicking the backdrop closes it.
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
  });
  document.body.appendChild(dialog);
  return dialog;
}

export function showStatementInfo(statement) {
  const node = ensureDialog();

  const group = node.querySelector('.info-group');
  group.textContent = statement.group ?? '';
  group.hidden = !statement.group;

  node.querySelector('.info-title').textContent = statement.label;

  const body = node.querySelector('.info-body');
  const hasGuidance = Boolean(statement.dialogText);
  body.textContent = hasGuidance
    ? statement.dialogText
    : 'The template carries no further guidance for this statement.';
  body.classList.toggle('muted', !hasGuidance);

  node.showModal();
}
