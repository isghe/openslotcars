import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTimingStorage } from '../src/data/timingStorage.js';
import { createLapTimer, recordCrossing, advanceTimer, markExit } from '../src/core/lapTimer.js';
import { bestLapSectorColors } from '../src/core/timing.js';

function memory() {
  const data = new Map();
  return {
    data, writes: 0,
    getItem(key) { return data.get(key) ?? null; },
    setItem(key, value) { data.set(key, value); this.writes += 1; },
    removeItem(key) { data.delete(key); },
  };
}

function archive(storage, circuitId = 'oval', signature = 'geometry-and-rules') {
  return createTimingStorage({ getStorage: () => storage, circuitId, signature });
}

function history() {
  let timer = recordCrossing(createLapTimer(), 0);
  let time = 0;
  let distance = 0;
  for (const durations of [[5, 5, 5, 5], [7, 4, 4, 3], [3, 3, 3, 10]]) {
    if (distance === 8) timer = markExit(timer, { time: time + 0.25, distance: 8.25, laneLength: 4 });
    for (const dt of durations) {
      ({ timer } = advanceTimer(timer, {
        previousTime: time, dt, previousDistance: distance,
        distance: distance + 1, laneLength: 4,
      }));
      time += dt;
      distance += 1;
    }
  }
  // A record from an unfinished lap is retained without resuming that lap.
  return advanceTimer(timer, {
    previousTime: time, dt: 1, previousDistance: distance,
    distance: distance + 1, laneLength: 4,
  }).timer;
}

test('archives survive a new store and retain laps, records and mark history', () => {
  const storage = memory();
  const timer = history();
  archive(storage).save(timer);
  const restored = archive(storage).load();
  assert.deepEqual(restored.laps, timer.laps);
  assert.equal(restored.laps[2].valid, false);
  assert.deepEqual(restored.laps[2].exits, [{ time: 0.25, distance: 0.25, sector: 1 }]);
  assert.equal(restored.best, restored.laps[1]);
  assert.deepEqual(restored.bestSectors, timer.bestSectors);
  assert.deepEqual(restored.bestSectors.map(sector => sector.lapNumber), [4, 3, 3, 2]);
  assert.deepEqual(restored.bestSplits, timer.bestSplits);
  assert.deepEqual(bestLapSectorColors(restored), ['yellow', 'green', 'green', 'purple']);
  assert.equal(restored.lapStart, null);
  assert.equal(restored.sectorStart, null);
  assert.deepEqual(restored.currentSectors, []);
  assert.deepEqual(restored.lastSectors, Array(4).fill(null));
  const next = recordCrossing(recordCrossing(restored, 0), 30);
  assert.equal(next.laps[3].number, 4);
  assert.equal(next.laps[3].time, 30);
});

test('older sector records remain available without a known lap number', () => {
  const storage = memory();
  archive(storage).save(history());
  const [key, raw] = [...storage.data][0];
  const data = JSON.parse(raw);
  for (const lap of data.laps) for (const sector of lap.sectors) delete sector.lapNumber;
  for (const sector of data.bestSectors) delete sector.lapNumber;
  storage.data.set(key, JSON.stringify(data));
  const restored = archive(storage).load();
  assert.equal(restored.laps.length, 3);
  assert.deepEqual(restored.bestSectors.map(sector => sector.time), [1, 3, 3, 3]);
  assert.ok(restored.bestSectors.every(sector => sector.lapNumber === undefined));
});

test('older archives keep their laps without inventing exit details', () => {
  const storage = memory();
  archive(storage).save(history());
  const [key, raw] = [...storage.data][0];
  const data = JSON.parse(raw);
  for (const lap of data.laps) delete lap.exits;
  storage.data.set(key, JSON.stringify(data));
  const restored = archive(storage).load();
  assert.equal(restored.laps.length, 3);
  assert.deepEqual(restored.laps[0].exits, []);
  assert.equal(restored.laps[2].exits, null);
  archive(storage).save(restored);
  assert.equal(archive(storage).load().laps[2].exits, null);
});

test('malformed exit details are rejected', () => {
  const storage = memory();
  archive(storage).save(history());
  const [key, raw] = [...storage.data][0];
  for (const exits of [
    [{ time: -1, distance: 1, sector: 1 }],
    [{ time: 100, distance: 1, sector: 1 }],
    [{ time: 1, distance: -1, sector: 1 }],
    [{ time: 1, distance: 1, sector: 5 }],
    [{ time: 2, distance: 1, sector: 1 }, { time: 1, distance: 1, sector: 1 }],
  ]) {
    const data = JSON.parse(raw);
    data.laps[2].exits = exits;
    storage.data.set(key, JSON.stringify(data));
    assert.deepEqual(archive(storage).load(), createLapTimer());
  }
});

test('circuits are independent and clear removes only the current circuit', () => {
  const storage = memory();
  const oval = archive(storage);
  oval.save(history());
  archive(storage, 'club').save(history());
  assert.equal(oval.clear(), true);
  assert.equal(oval.load().laps.length, 0);
  assert.equal(archive(storage).load().laps.length, 0);
  assert.equal(archive(storage, 'club').load().laps.length, 3);
});

test('changed circuit geometry or physics ignores incompatible records', () => {
  const storage = memory();
  archive(storage).save(history());
  assert.deepEqual(archive(storage, 'oval', 'changed-rules').load(), createLapTimer());
});

test('missing, malformed and invalid archives start with a fresh timer', () => {
  const storage = memory();
  assert.deepEqual(archive(storage).load(), createLapTimer());
  archive(storage).save(history());
  const [key, raw] = [...storage.data][0];
  for (const corrupt of [
    () => '{',
    data => ({ ...data, version: 999 }),
    data => ({ ...data, laps: [{ ...data.laps[0], time: -1 }] }),
    data => ({ ...data, bestSectors: [] }),
    data => ({ ...data, bestSplits: [null, null, null, { number: 4, time: -1, valid: true }] }),
    data => ({ ...data, laps: [{ ...data.laps[0], sectors: [] }] }),
  ]) {
    const value = corrupt(JSON.parse(raw));
    storage.data.set(key, typeof value === 'string' ? value : JSON.stringify(value));
    assert.deepEqual(archive(storage).load(), createLapTimer());
  }
});

test('storage denial and quota errors keep racing and in-memory records usable', () => {
  const store = createTimingStorage({
    getStorage() { throw new Error('SecurityError'); }, circuitId: 'oval', signature: 'rules',
  });
  assert.deepEqual(store.load(), createLapTimer());
  const timer = history();
  store.save(timer);
  assert.deepEqual(store.load().laps, timer.laps);
  assert.equal(store.clear(), false);
  const full = archive({
    getItem: () => null,
    setItem() { throw new Error('QuotaExceededError'); },
    removeItem() {},
  });
  full.save(timer);
  assert.deepEqual(full.load().laps, timer.laps);
});

test('running frames and restarting without new records do not rewrite storage', () => {
  const storage = memory();
  const store = archive(storage);
  store.save(history());
  const restored = store.load();
  for (let i = 0; i < 100; i += 1) store.save(recordCrossing(restored, i));
  assert.equal(storage.writes, 1);
});
