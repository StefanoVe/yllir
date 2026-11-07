// Mechanical comparison of audit facts. Produces candidates for a judge; never
// verdicts. A difference may be a change over time or a point of view, so the
// judge decides. Pure functions only: no file access.

import { foldForm } from '../../../../../scripts/lib/fold.mjs';

const SINGLE_VALUED_FAMILIES = new Set(['date', 'number', 'origin', 'status']);
const LOCATION_ATTRIBUTE = 'location.current';
const CHILD_OF = 'relation.child-of';
const PARENT_OF = 'relation.parent-of';

/**
 * Normalized form of a value, as a string, for the given attribute.
 * For location.current the result is the sorted set of parts joined with ','.
 * @param {string} attribute
 * @param {string} value
 * @returns {string}
 */
export function norm(attribute, value) {
  const text = String(value);
  if (attribute.startsWith('number.')) {
    const trimmed = text.trim();
    const n = Number(trimmed);
    return trimmed !== '' && Number.isFinite(n) ? String(n) : foldForm(text);
  }
  if (attribute.startsWith('date.')) {
    const match = /-?\d+/.exec(text);
    return match !== null ? String(Number(match[0])) : foldForm(text);
  }
  if (attribute === LOCATION_ATTRIBUTE) {
    return locationSet(text).join(',');
  }
  return foldForm(text);
}

/** Sorted, distinct folded parts of a location value. Empty when there are none. */
function locationSet(value) {
  const parts = value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map((part) => foldForm(part))
    .filter((part) => part !== '');
  return [...new Set(parts)].sort(compareText);
}

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function placeOf(fact) {
  return JSON.stringify([fact.document, fact.line]);
}

function isHypothesis(fact) {
  return fact.source_type === 'hypothesis';
}

function groupBy(list, keyOf) {
  const groups = new Map();
  for (const item of list) {
    const key = keyOf(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

function sortFacts(facts) {
  return facts.slice().sort((x, y) => {
    return (
      compareText(String(x.document), String(y.document)) ||
      Number(x.line) - Number(y.line) ||
      compareText(String(x.id), String(y.id))
    );
  });
}

function sortCandidates(candidates) {
  return candidates
    .slice()
    .sort(
      (x, y) =>
        compareText(x.subject, y.subject) ||
        compareText(x.attribute, y.attribute) ||
        compareText(x.kind, y.kind),
    );
}

function valueMismatches(facts) {
  const singleValued = facts.filter((fact) => SINGLE_VALUED_FAMILIES.has(fact.attribute.split('.')[0]));
  const groups = groupBy(singleValued, (fact) => JSON.stringify([fact.subject, fact.attribute]));
  const candidates = [];
  for (const group of groups.values()) {
    const values = [...new Set(group.map((fact) => norm(fact.attribute, fact.value)))].sort(compareText);
    const places = new Set(group.map(placeOf));
    if (values.length >= 2 && places.size >= 2) {
      candidates.push({
        kind: 'value-mismatch',
        subject: group[0].subject,
        attribute: group[0].attribute,
        values,
        facts: group,
      });
    }
  }
  return candidates;
}

function locationConflicts(facts) {
  const located = facts.filter(
    (fact) => fact.attribute === LOCATION_ATTRIBUTE && locationSet(String(fact.value)).length > 0,
  );
  const groups = groupBy(located, (fact) => fact.subject);
  const candidates = [];
  for (const group of groups.values()) {
    const sets = group.map((fact) => new Set(locationSet(String(fact.value))));
    let conflict = false;
    for (let i = 0; i < group.length && !conflict; i++) {
      for (let j = i + 1; j < group.length && !conflict; j++) {
        if (placeOf(group[i]) === placeOf(group[j])) continue;
        const disjoint = [...sets[i]].every((part) => !sets[j].has(part));
        if (disjoint) conflict = true;
      }
    }
    if (conflict) {
      const values = [...new Set(group.map((fact) => locationSet(String(fact.value)).join(',')))].sort(compareText);
      candidates.push({
        kind: 'location-conflict',
        subject: group[0].subject,
        attribute: LOCATION_ATTRIBUTE,
        values,
        facts: group,
      });
    }
  }
  return candidates;
}

function relationConflicts(facts) {
  // Each parent-child fact becomes one directed edge parent -> child.
  const edges = new Map();
  for (const fact of facts) {
    if (fact.attribute !== CHILD_OF && fact.attribute !== PARENT_OF) continue;
    const subject = String(fact.subject);
    const other = String(fact.value).trim();
    if (other === '' || other === subject) continue;
    const [parent, child] = fact.attribute === CHILD_OF ? [other, subject] : [subject, other];
    const key = JSON.stringify([parent, child]);
    if (!edges.has(key)) edges.set(key, { parent, child, facts: [] });
    edges.get(key).facts.push(fact);
  }

  const candidates = [];
  for (const edge of edges.values()) {
    const [a, b] = edge.parent < edge.child ? [edge.parent, edge.child] : [edge.child, edge.parent];
    if (a !== edge.parent) continue; // handled once, from the edge that runs A -> B
    const reverse = edges.get(JSON.stringify([edge.child, edge.parent]));
    if (reverse === undefined) continue;
    const facts = [...new Set([...edge.facts, ...reverse.facts])];
    candidates.push({
      kind: 'relation-conflict',
      subject: a,
      attribute: PARENT_OF,
      values: [`${a}→${b}`, `${b}→${a}`],
      facts,
    });
  }
  return candidates;
}

/**
 * Compares facts and lists candidates for the judge.
 * @param {Array<object>} facts facts as produced by the validator
 * @param {Array<{subject: string, attribute: string, values: string[], reason?: string}>} [exclusions]
 * @returns {{ candidates: object[], excluded: object[], hypotheses: object[], stats: object }}
 */
export function compareFacts(facts, exclusions = []) {
  if (!Array.isArray(facts)) {
    throw new TypeError('compareFacts expects an array of facts');
  }
  const hypotheses = facts.filter(isHypothesis);
  const compared = facts.filter((fact) => !isHypothesis(fact));

  const found = [
    ...valueMismatches(compared),
    ...locationConflicts(compared),
    ...relationConflicts(compared),
  ].map((candidate) => ({ ...candidate, facts: sortFacts(candidate.facts) }));

  const normalizedExclusions = exclusions.map((exclusion) => ({
    subject: exclusion.subject,
    attribute: exclusion.attribute,
    values: new Set(exclusion.values.map((value) => norm(exclusion.attribute, String(value)))),
    reason: exclusion.reason ?? '',
  }));

  const kept = [];
  const excluded = [];
  for (const candidate of sortCandidates(found)) {
    const index = normalizedExclusions.findIndex(
      (exclusion) =>
        exclusion.subject === candidate.subject &&
        exclusion.attribute === candidate.attribute &&
        candidate.values.every((value) => exclusion.values.has(norm(candidate.attribute, value))),
    );
    if (index === -1) {
      kept.push(candidate);
    } else {
      excluded.push({ ...candidate, exclusion: index, reason: normalizedExclusions[index].reason });
    }
  }

  const candidates = kept.map((candidate, i) => ({
    cid: `C${String(i + 1).padStart(3, '0')}`,
    kind: candidate.kind,
    subject: candidate.subject,
    attribute: candidate.attribute,
    values: candidate.values,
    facts: candidate.facts,
  }));

  return {
    candidates,
    excluded,
    hypotheses,
    stats: {
      facts: facts.length,
      compared: compared.length,
      candidates: candidates.length,
      excluded: excluded.length,
      hypotheses: hypotheses.length,
    },
  };
}

/**
 * Reads the optional `audit.exclusions` list of a parsed campaign.yaml.
 * A missing section means no exclusions. A malformed one throws.
 * @param {object} config parsed campaign.yaml
 * @returns {Array<{subject: string, attribute: string, values: string[], reason: string}>}
 */
export function exclusionsFromConfig(config) {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('campaign.yaml must be a mapping');
  }
  if (config.audit === undefined) return [];
  if (config.audit === null || typeof config.audit !== 'object' || Array.isArray(config.audit)) {
    throw new Error('audit must be a mapping');
  }
  const list = config.audit.exclusions;
  if (list === undefined) return [];
  if (!Array.isArray(list)) {
    throw new Error('audit.exclusions must be a list');
  }
  return list.map((item, i) => {
    const where = `audit.exclusions[${i}]`;
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`${where} must be a mapping`);
    }
    if (typeof item.subject !== 'string' || typeof item.attribute !== 'string') {
      throw new Error(`${where} needs string subject and attribute`);
    }
    if (!Array.isArray(item.values) || item.values.some((v) => typeof v !== 'string' && typeof v !== 'number')) {
      throw new Error(`${where}.values must be a list of strings`);
    }
    return {
      subject: item.subject,
      attribute: item.attribute,
      values: item.values.map(String),
      reason: item.reason === undefined || item.reason === null ? '' : String(item.reason),
    };
  });
}
