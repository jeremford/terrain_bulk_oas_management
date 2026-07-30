/**
 * OAS templates are public JSON on the templates host and describe every
 * statement in a stage. Statement ids are always read from here, never
 * hardcoded, so new streams and stages work without code changes.
 */

import { TEMPLATES } from '../api/terrain.js';

/**
 * @param {string} stream   e.g. "bushcraft"
 * @param {number|string} stage
 * @param {number} [version] pinned template version; omit for latest
 */
export async function fetchTemplate(stream, stage, version) {
  const file = version === undefined ? 'latest' : String(version);
  const res = await fetch(`${TEMPLATES}/oas/${stream}/${stage}/${file}.json`);
  if (!res.ok) throw new Error(`Template oas/${stream}/${stage} -> ${res.status}`);
  return res.json();
}

export async function fetchStreamTree(stream) {
  const res = await fetch(`${TEMPLATES}/oas/${stream}/tree.json`);
  if (!res.ok) throw new Error(`Stream tree ${stream} -> ${res.status}`);
  return res.json();
}

/**
 * Flattens a template into the checkbox statements a leader can tick.
 *
 * `verifiable` statements additionally carry verifier name/contact/date.
 * `dialogText` is the assessment guidance Terrain shows behind its info icon.
 */
export function parseStatements(template) {
  const statements = [];
  for (const section of template.document ?? []) {
    for (const group of section.input_groups ?? []) {
      for (const input of group.inputs ?? []) {
        if (input.type === 'verifiable_checkbox' || input.type === 'checkbox') {
          statements.push({
            id: input.id,
            label: input.label,
            verifiable: input.type === 'verifiable_checkbox',
            dialogText: input.dialog_text ?? '',
            group: group.title ?? section.title ?? '',
          });
        }
      }
    }
  }
  return statements;
}
