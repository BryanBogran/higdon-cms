import test from 'node:test';
import assert from 'node:assert/strict';
import { SECTIONS } from './registry.js';
import { FIELD_BY_KEY, FIELDS } from '../domain/fields.js';

/**
 * A section field is stored in matter_section_data. A matter field is stored
 * on the matter row itself, and that is where every deadline feature looks --
 * chain.js, the calendar, the dashboard countdown, the projects table.
 *
 * When a section declares a field whose key is also a matter field, those two
 * facts collide: the tab looks like it is capturing the date and is in fact
 * writing it somewhere nothing reads. That is exactly what happened with the
 * SOL on the Intake tab, and it is invisible on screen -- the value persists
 * and reloads correctly, it simply never becomes a deadline.
 *
 * GenericSection now resolves the collision by routing any such field to
 * updateMatterField. This test exists so the collision set stays a decision
 * someone makes on purpose: add a matter-keyed field to a section and this
 * fails, which is the prompt to confirm the routing is what you want.
 */

function sectionFields(section) {
  const out = [];
  for (const g of section.groups || []) out.push(...(g.fields || []));
  out.push(...(section.fields || []));
  return out;
}

function collisions() {
  const found = [];
  for (const section of Object.values(SECTIONS)) {
    for (const f of sectionFields(section)) {
      const mf = FIELD_BY_KEY[f.key];
      if (mf && mf.type !== 'yesnoDoc') {
        found.push(`${section.key}.${f.key}`);
      }
    }
  }
  return found.sort();
}

test('section fields that share a key with a matter field are known', () => {
  assert.deepEqual(collisions(), ['intake.sol']);
});

test('SOL is a matter field, so the Intake tab writes it to the matter', () => {
  const sol = FIELD_BY_KEY.sol;
  assert.ok(sol, 'sol must be a matter field');
  assert.equal(sol.type, 'date');
  assert.ok(sol.highStakes, 'a missed SOL ends the case, so it is high stakes');
});

test('every high-stakes date is reachable from Case Info', () => {
  // The three dates the chain regenerates from. If one stops being editable
  // there is no other route to it.
  const highStakes = FIELDS.filter((f) => f.highStakes).map((f) => f.key).sort();
  assert.deepEqual(highStakes, ['dco', 'sol', 'trialDate']);
  for (const key of highStakes) {
    assert.equal(FIELD_BY_KEY[key].section, 'Case Info');
  }
});

test('no section declares a field key twice', () => {
  for (const section of Object.values(SECTIONS)) {
    const keys = sectionFields(section).map((f) => f.key);
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
    assert.deepEqual(dupes, [], `${section.key} declares ${dupes.join(', ')} twice`);
  }
});
