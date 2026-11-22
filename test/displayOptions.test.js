import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addressWithDisplayOption, displayOptionsFromSearch } from '../src/ui/displayOptions.js';

test('display options are on for missing parameters and the exact value 1', () => {
  for (const search of ['', '?circuit=club', '?curbs=1&curve-markers=1&sector-feedback=1']) {
    assert.deepEqual(displayOptionsFromSearch(search), { curbs: true, curveMarkers: true, sectorFeedback: true }, search);
  }
  for (const value of ['', '0', 'true', '01', '+1', '1+']) {
    const search = `?curbs=${value}&curve-markers=${value}&sector-feedback=${value}`;
    assert.deepEqual(displayOptionsFromSearch(search), { curbs: false, curveMarkers: false, sectorFeedback: false }, search);
  }
});

test('each display option reads its own first value', () => {
  assert.deepEqual(displayOptionsFromSearch('?curbs=0&curbs=1&curve-markers=1&curve-markers=0&sector-feedback=0&sector-feedback=1'), {
    curbs: false,
    curveMarkers: true,
    sectorFeedback: false,
  });
  assert.deepEqual(displayOptionsFromSearch('?curbs=1&curve-markers=0'), {
    curbs: true,
    curveMarkers: false,
    sectorFeedback: true,
  });
});

test('writing a display option preserves the path, fragment and other parameters', () => {
  const address = 'https://example.test/openslotcars/?circuit=club&tag=a&tag=b&curbs=1&curbs=0&curve-markers=0&curve-markers=1#track';
  assert.equal(addressWithDisplayOption(address, 'curbs', false),
    'https://example.test/openslotcars/?circuit=club&tag=a&tag=b&curbs=0&curve-markers=0&curve-markers=1#track');
  assert.equal(addressWithDisplayOption(address, 'curveMarkers', true),
    'https://example.test/openslotcars/?circuit=club&tag=a&tag=b&curbs=1&curbs=0&curve-markers=1#track');
  const hidden = addressWithDisplayOption(address, 'sectorFeedback', false);
  assert.equal(hidden,
    'https://example.test/openslotcars/?circuit=club&tag=a&tag=b&curbs=1&curbs=0&curve-markers=0&curve-markers=1&sector-feedback=0#track');
  assert.equal(displayOptionsFromSearch(new URL(hidden).search).sectorFeedback, false);
  const shown = addressWithDisplayOption(hidden, 'sectorFeedback', true);
  assert.equal(displayOptionsFromSearch(new URL(shown).search).sectorFeedback, true);
});
