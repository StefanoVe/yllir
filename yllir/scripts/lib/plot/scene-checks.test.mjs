import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkScene } from './scene-checks.mjs';

const IT_OK = `<!-- yllir
id: scena-benvenuto
session: sessione-1
depends_on: []
-->

## Il benvenuto

Sibilla chiede un'offerta.

### Prova: Carisma (Persuasione) CD 13

Chi parla con Sibilla tira.

#### Successo

Il gruppo ottiene un consiglio sulla strada per il bosco.

#### Fallimento

Il gruppo riceve soltanto un invito a tornare il giorno dopo.
`;

const EN_OK = `---
id: scene-welcome
---

## Welcome

Sibilla asks for an offer.

### Check: Charisma (Persuasion) DC 13

Whoever talks to Sibilla rolls.

#### Success

The group gets advice about the road to the forest.

#### Failure

The group only gets an invitation to come back the next day.
`;

function codes(markdown, lang = 'it', options) {
  return checkScene(markdown, lang, options).map((entry) => entry.code);
}

function only(markdown, lang, code) {
  const errors = checkScene(markdown, lang);
  assert.ok(errors.some((entry) => entry.code === code), JSON.stringify(errors));
  return errors.find((entry) => entry.code === code);
}

test('a correct Italian scene has no errors', () => {
  assert.deepEqual(checkScene(IT_OK, 'it'), []);
});

test('a correct English scene has no errors', () => {
  assert.deepEqual(checkScene(EN_OK, 'en'), []);
});

test('an unknown language is checked with the English labels', () => {
  assert.deepEqual(checkScene(EN_OK, 'fr'), []);
  assert.ok(codes(IT_OK, 'fr').includes('check-heading-form'));
});

test('a ### heading that is not a check reports check-heading-form', () => {
  const error = only('### Ricordi\n\nTesto.\n', 'it', 'check-heading-form');
  assert.equal(error.line, 1);
  assert.ok(error.message.startsWith('### is only for checks: write "### Prova: <check>"'), error.message);
  const en = only('### Notes\n\nText.\n', 'en', 'check-heading-form');
  assert.ok(en.message.includes('write "### Check: <check>"'), en.message);
});

test('a check heading with nothing after the colon reports check-missing-value', () => {
  const error = only('### Prova:   \n\nTesto.\n', 'it', 'check-missing-value');
  assert.equal(error.line, 1);
});

test('a check without its outcomes reports check-missing-outcome', () => {
  const missingFailure = IT_OK.replace('#### Fallimento', '#### Altro');
  assert.ok(codes(missingFailure).includes('check-missing-outcome'));
  const reversed = `### Prova: Destrezza CD 12\n\n#### Fallimento\n\nNo.\n\n#### Successo\n\nSì.\n`;
  assert.ok(codes(reversed).includes('check-missing-outcome'));
});

test('a repeated or unknown #### heading inside a check reports check-outcome-heading', () => {
  const extra = IT_OK.replace('#### Fallimento', '#### Forse\n\nAltro.\n\n#### Fallimento');
  assert.ok(codes(extra).includes('check-outcome-heading'));
  const duplicate = IT_OK.replace('#### Fallimento', '#### Successo\n\nDue volte.\n\n#### Fallimento');
  assert.ok(codes(duplicate).includes('check-outcome-heading'));
});

test('an outcome heading with no text reports check-empty-outcome', () => {
  const empty = IT_OK.replace('Il gruppo ottiene un consiglio sulla strada per il bosco.', '');
  const error = only(empty, 'it', 'check-empty-outcome');
  assert.equal(error.line, 15);
});

test('an outcome heading outside a check reports check-outcome-outside', () => {
  const outside = `## Scena\n\n#### Successo\n\nTesto.\n`;
  const error = only(outside, 'it', 'check-outcome-outside');
  assert.equal(error.line, 3);
});

test('an outcome written as a list item reports check-legacy-outcomes, with both list forms', () => {
  const bold = IT_OK.replace('#### Successo\n\nIl gruppo', '- **Successo:** Il gruppo');
  assert.ok(codes(bold).includes('check-legacy-outcomes'));
  const plain = `### Check: Wisdom (Insight) DC 12\n\n- Failure: nothing.\n\n#### Success\n\nYes.\n\n#### Failure\n\nNo.\n`;
  assert.ok(codes(plain, 'en').includes('check-legacy-outcomes'));
  const boldColon = `### Check: Wisdom (Insight) DC 12\n\n* **Failure:** nothing.\n\n#### Success\n\nYes.\n\n#### Failure\n\nNo.\n`;
  assert.ok(codes(boldColon, 'en').includes('check-legacy-outcomes'));
});

test('a check asked for in prose outside a check reports check-outside-heading', () => {
  const prose = `Sibilla chiede una prova di Carisma.\n\n${IT_OK}`;
  const error = only(prose, 'it', 'check-outside-heading');
  assert.equal(error.line, 1);
  const english = `The guard makes a Strength check.\n\n${EN_OK}`;
  assert.ok(codes(english, 'en').includes('check-outside-heading'));
  const saving = `Everyone makes a saving throw.\n\n${EN_OK}`;
  assert.ok(codes(saving, 'en').includes('check-outside-heading'));
});

test('a sentence that mentions a trial without asking for a check does not trigger', () => {
  const text = `Il giudice vuole mettere alla prova di nuovo la fede del gruppo.\n\n${IT_OK}`;
  assert.deepEqual(checkScene(text, 'it'), []);
});

test('quote lines are checked too, but a check heading block is not', () => {
  const quote = `> Il gruppo fa una prova di Carisma.\n\n${IT_OK}`;
  assert.ok(codes(quote).includes('check-outside-heading'));
});

test('fenced code blocks never trigger a rule', () => {
  const fenced = `Testo.\n\n\`\`\`\n### Ricordi\n- **Successo:** nulla\nUna prova di Carisma CD 13\n#### Successo\n\`\`\`\n`;
  assert.deepEqual(checkScene(fenced, 'it'), []);
});

test('the master-only block never triggers a rule', () => {
  const withMaster = `${IT_OK}\n<!-- master -->\n## Master\n\n### Ricordi\n\nUna prova di Carisma CD 13.\n\n- **Successo:** nulla\n`;
  assert.deepEqual(checkScene(withMaster, 'it'), []);
});

test('a file with no public body has no errors', () => {
  assert.deepEqual(checkScene('', 'it'), []);
  assert.deepEqual(checkScene('---\nid: x\n---\n', 'it'), []);
  assert.deepEqual(checkScene('<!-- master -->\n### Ricordi\n', 'it'), []);
});

test('line numbers count the metadata block and the body from line 1 of the full file', () => {
  const text = `---\nid: x\n---\n\n### Ricordi\n`;
  assert.equal(only(text, 'it', 'check-heading-form').line, 5);
  const crlf = `---\r\nid: x\r\n---\r\n\r\n### Ricordi\r\n`;
  assert.equal(only(crlf, 'it', 'check-heading-form').line, 5);
});

test('checkValue errors are forwarded with the line of the check heading', () => {
  const calls = [];
  const checkValue = (value, lang) => {
    calls.push([value, lang]);
    return value === 'Persuasione CD 13' ? [{ code: 'bad-check', message: 'not a check' }] : [];
  };
  const bad = IT_OK.replace('Carisma (Persuasione) CD 13', 'Persuasione CD 13');
  const errors = checkScene(bad, 'it', { checkValue });
  assert.deepEqual(errors.map((e) => [e.code, e.line, e.message]), [['bad-check', 11, 'not a check']]);
  assert.deepEqual(calls, [['Persuasione CD 13', 'it']]);
  assert.deepEqual(checkScene(IT_OK, 'it', { checkValue }), []);
});

test('checkValue is not called for an empty check value', () => {
  let called = false;
  checkScene('### Prova:\n\nTesto.\n', 'it', { checkValue: () => { called = true; return []; } });
  assert.equal(called, false);
});
