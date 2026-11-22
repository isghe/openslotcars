/** Versioned timing archives; blocked or full browser storage never stops driving. */
import { createLapTimer, restartLapTimer, SECTOR_COUNT } from '../core/lapTimer.js';

function duration(value) {
  return Number.isFinite(value) && value >= 0;
}

function readAttempt(value, number, sector = false) {
  if (!value || value.number !== number || !duration(value.time)
    || typeof value.valid !== 'boolean'
    || (sector && typeof value.wasBest !== 'boolean')) {
    throw new TypeError('Invalid timing attempt');
  }
  if (sector && value.lapNumber !== undefined
    && (!Number.isSafeInteger(value.lapNumber) || value.lapNumber < 1)) {
    throw new TypeError('Invalid sector lap number');
  }
  return {
    number, time: value.time, valid: value.valid,
    ...(sector ? { wasBest: value.wasBest } : {}),
    ...(sector && value.lapNumber !== undefined ? { lapNumber: value.lapNumber } : {}),
  };
}

function readRecords(values, sector) {
  if (!Array.isArray(values) || values.length !== SECTOR_COUNT) {
    throw new TypeError('Invalid sector records');
  }
  return values.map((value, index) => {
    if (value === null) return null;
    const record = readAttempt(value, index + 1, sector);
    if (!record.valid || (sector && !record.wasBest)) throw new TypeError('Invalid record');
    return record;
  });
}

function readExits(values, lap) {
  // Old invalid laps lack locations; keep that distinction from a clean lap.
  if (values === undefined || (values === null && !lap.valid)) return lap.valid ? [] : null;
  if (!Array.isArray(values) || (lap.valid && values.length > 0)) {
    throw new TypeError('Invalid lap exits');
  }
  let previousTime = 0;
  return values.map(value => {
    if (!value || !duration(value.time) || value.time > lap.time
      || value.time < previousTime || !duration(value.distance)
      || !Number.isInteger(value.sector) || value.sector < 1 || value.sector > SECTOR_COUNT) {
      throw new TypeError('Invalid exit details');
    }
    previousTime = value.time;
    return { time: value.time, distance: value.distance, sector: value.sector };
  });
}

function readArchive(raw, signature) {
  const data = JSON.parse(raw);
  if (data?.version !== 1 || data.signature !== signature || !Array.isArray(data.laps)) {
    throw new TypeError('Incompatible timing archive');
  }
  const laps = data.laps.map((value, index) => {
    const lap = readAttempt(value, index + 1);
    if (!Array.isArray(value.sectors) || value.sectors.length !== SECTOR_COUNT) {
      throw new TypeError('Invalid lap sectors');
    }
    const sectors = value.sectors.map((sector, i) => readAttempt(sector, i + 1, true));
    if (Math.abs(sectors.reduce((sum, sector) => sum + sector.time, 0) - lap.time) > 1e-7
      || (lap.valid && sectors.some(sector => !sector.valid))) {
      throw new TypeError('Inconsistent lap');
    }
    return { ...lap, sectors, exits: readExits(value.exits, lap) };
  });
  const best = laps.reduce((best, lap) => (
    lap.valid && (best === null || lap.time < best.time) ? lap : best
  ), null);
  return {
    ...createLapTimer(), laps, best,
    bestSectors: readRecords(data.bestSectors, true),
    bestSplits: readRecords(data.bestSplits, false),
  };
}

/** One circuit/configuration archive, with an in-memory fallback for this visit. */
export function createTimingStorage({ getStorage, circuitId, signature }) {
  const key = `openslotcars:timing:v1:${circuitId}`;
  let cached = null;
  return {
    load() {
      if (cached === null) {
        try {
          cached = readArchive(getStorage().getItem(key), signature);
        } catch {
          cached = createLapTimer();
        }
      }
      return restartLapTimer(cached);
    },
    save(timer) {
      if (cached?.laps === timer.laps && cached.bestSectors === timer.bestSectors
        && cached.bestSplits === timer.bestSplits) return;
      cached = restartLapTimer(timer);
      try {
        getStorage().setItem(key, JSON.stringify({
          version: 1, signature,
          laps: timer.laps, bestSectors: timer.bestSectors, bestSplits: timer.bestSplits,
        }));
      } catch {
        // Keep the in-memory archive usable even when persistence is unavailable.
      }
    },
    clear() {
      try {
        getStorage().removeItem(key);
        cached = createLapTimer();
        return true;
      } catch {
        return false;
      }
    },
  };
}
