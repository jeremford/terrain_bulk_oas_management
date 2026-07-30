import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStatements } from '../src/core/template.js';

// Shaped like a real oas/{stream}/{stage}/latest.json response.
const template = {
  template: 'oas/bushcraft/1',
  version: 2,
  document: [{
    input_groups: [
      {
        title: 'Plan>',
        inputs: [{
          id: 'important_outdoors_trails_stick_a353dc',
          type: 'verifiable_checkbox',
          label: 'I know why it is important to stick to trails when outdoors.',
          dialog_text: 'The youth member should be able to talk about and demonstrate on walks why the trail is there.',
        }],
      },
      {
        title: 'Verify',
        inputs: [
          { id: 'logbook_up_to_date', type: 'checkbox', label: 'My logbook is up to date at the end of this stage.' },
          { id: 'file_uploader', type: 'file_uploader', label: 'Upload supporting documents' },
        ],
      },
    ],
  }],
};

test('captures the assessment guidance behind the info button', () => {
  const [first] = parseStatements(template);
  assert.match(first.dialogText, /^The youth member should be able/);
});

test('carries the group title through for context', () => {
  const [first, second] = parseStatements(template);
  assert.equal(first.group, 'Plan>');
  assert.equal(second.group, 'Verify');
});

test('marks verifiable statements apart from plain checkboxes', () => {
  const [first, second] = parseStatements(template);
  assert.equal(first.verifiable, true);
  assert.equal(second.verifiable, false);
});

test('ignores non-checkbox inputs such as the file uploader', () => {
  const ids = parseStatements(template).map(s => s.id);
  assert.deepEqual(ids, ['important_outdoors_trails_stick_a353dc', 'logbook_up_to_date']);
});

test('statements with no dialog_text get an empty string, never undefined', () => {
  const [, second] = parseStatements(template);
  assert.equal(second.dialogText, '');
});
