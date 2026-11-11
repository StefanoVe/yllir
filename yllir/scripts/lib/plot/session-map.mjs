// Renders the main file of a plot session (the generated map of its events) and
// writes it into the campaign. The main file is derived: it is rebuilt from the
// files in Eventi/ and must never be edited by hand.

import fs from 'node:fs';
import path from 'node:path';
import { compareStrings } from '../subjects.mjs';
import { PROVENANCES } from '../world-graph.mjs';
import { METADATA_CLOSE, METADATA_OPEN } from '../frontmatter.mjs';

const LIST_SEPARATOR = ', ';

/** Keeps the provenance of the existing main file; anything missing or invalid becomes generated. */
function provenanceOf(session) {
  return PROVENANCES.includes(session.provenance) ? session.provenance : 'generated';
}

/** Mermaid labels are wrapped in double quotes, so inner quotes become single. */
function mermaidLabel(name) {
  return name.replace(/"/g, "'");
}

/** Relative links keep the name as text and encode only the spaces of the target. */
function linkTarget(target) {
  return target.replace(/ /g, '%20');
}

/**
 * Renders the full text of the main file of a session.
 * @param {object} session one entry of plotMap(root).sessions
 * @returns {string}
 */
export function renderSessionMap(session) {
  const events = session.events ?? [];
  const sessionDir = path.posix.dirname(session.file);
  const indexById = new Map();
  events.forEach((event, index) => indexById.set(event.id, index));

  const lines = [METADATA_OPEN, `id: ${session.id}`];
  lines.push(`depends_on: [${(session.depends_on ?? []).join(LIST_SEPARATOR)}]`);
  lines.push(`provenance: ${provenanceOf(session)}`);
  lines.push(`location: [${(session.location ?? []).join(LIST_SEPARATOR)}]`);
  if (session.arc) lines.push(`arc: "${session.arc}"`);
  lines.push('generated: true');
  lines.push(METADATA_CLOSE, '');
  lines.push('> Generated file. Do not edit by hand: it is rebuilt from the files in Eventi/.', '');

  if (events.length > 0) {
    lines.push('```mermaid', 'flowchart TD');
    events.forEach((event, index) => {
      lines.push(`  e${index + 1}["${mermaidLabel(event.name)}"]`);
    });
    events.forEach((event, index) => {
      for (const dependency of event.depends_on ?? []) {
        if (!indexById.has(dependency)) continue;
        lines.push(`  e${indexById.get(dependency) + 1} --> e${index + 1}`);
      }
    });
    lines.push('```', '');
  }

  lines.push('## Events', '');
  if (events.length === 0) {
    lines.push('- none');
  } else {
    for (const event of events) {
      const relative = path.posix.relative(sessionDir, event.file);
      lines.push(`- [${event.name}](${linkTarget(relative)})`);
    }
  }
  lines.push('');

  // Entry points: events that depend on no other event of this session.
  const entries = events.filter(
    (event) => !(event.depends_on ?? []).some((dependency) => indexById.has(dependency)),
  );
  lines.push('## Entry points', '');
  lines.push(...(entries.length === 0 ? ['- none'] : entries.map((event) => `- ${event.name}`)));
  lines.push('');

  // Exits: events that no other event of this session depends on.
  const dependedOn = new Set();
  for (const event of events) {
    for (const dependency of event.depends_on ?? []) {
      if (indexById.has(dependency)) dependedOn.add(dependency);
    }
  }
  const exits = events.filter((event) => !dependedOn.has(event.id));
  lines.push('## Exits', '');
  lines.push(...(exits.length === 0 ? ['- none'] : exits.map((event) => `- ${event.name}`)));

  return `${lines.join('\n')}\n`;
}

/**
 * Writes the main file of every session, but only where it is missing or differs
 * from the rendered text. No folders are created.
 * @param {string} root absolute path of the campaign
 * @param {object[]} sessions the sessions of plotMap(root)
 * @returns {{ written: string[], unchanged: string[] }} campaign-relative paths
 */
export function writeSessionMaps(root, sessions) {
  const written = [];
  const unchanged = [];
  const ordered = [...sessions].sort((a, b) => compareStrings(a.file, b.file));

  for (const session of ordered) {
    const text = renderSessionMap(session);
    const target = path.join(root, session.file);

    let current = null;
    try {
      current = fs.readFileSync(target, 'utf8');
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }

    if (current === text) {
      unchanged.push(session.file);
    } else {
      fs.writeFileSync(target, text);
      written.push(session.file);
    }
  }

  return { written, unchanged };
}
