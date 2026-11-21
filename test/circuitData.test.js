import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createCircuitCatalog, parseCircuitDefinition, buildCircuit } from '../src/core/circuits.js';
import { CIRCUITS, OVAL, CLUB, INFINITE_LOOP } from './helpers/circuits.js';
const reference = JSON.parse(await readFile(new URL('./fixtures/circuit-geometry.json', import.meta.url), 'utf8'));
const near = (a,b) => assert.ok(Math.abs(a-b) < 1e-9, `${a} != ${b}`);
test('JSON circuits preserve the geometry captured before migration', () => {
  for (const id of Object.keys(reference)) {
    const definition = CIRCUITS.find(circuit => circuit.id === id);
    const {track,lanes} = buildCircuit(definition);
    const expected = reference[definition.id];
    assert.equal(track.pieces.length,expected.ends.length);
    track.pieces.forEach((p,i) => { for (const key of ['x','y','heading']) near(p.end[key],expected.ends[i][key]); });
    for (const [name,lane] of Object.entries(lanes)) {
      near(lane.length, expected.lanes[name].length);
      [0,.17,.43,.79,.999999].forEach((f,i) => {
        const pose=lane.poseAt(f*lane.length);
        for (const key of ['x','y','heading']) near(pose[key],expected.lanes[name].poses[i][key]);
      });
    }
  }
});
test('parsing freezes a copy without freezing caller data', () => {
  const raw=structuredClone(OVAL), result=parseCircuitDefinition(raw);
  raw.pieces[0].length=99; raw.start.x=99; raw.lanes.inner=99;
  assert.equal(result.pieces[0].length,1);
  assert.equal(result.start.x,0);
  assert.equal(result.lanes.inner,.05);
  assert.ok(Object.isFrozen(result.pieces[0]));
});
const invalid = [
  ['missing name', x=>delete x.name], ['extra field',x=>x.typo=1],
  ['name whitespace',x=>x.name=' Oval '], ['invalid id',x=>x.id='../oval'],
  ['null start',x=>x.start=null], ['infinite heading',x=>x.start.heading=Infinity],
  ['string width',x=>x.trackWidth='0.2'], ['zero width',x=>x.trackWidth=0],
  ['outside lane',x=>x.lanes.inner=.1], ['same lanes',x=>x.lanes.outer=.05],
  ['empty pieces',x=>x.pieces=[]], ['unknown piece',x=>x.pieces[0].type='bend'],
  ['extra piece field',x=>x.pieces[0].radius=1], ['negative length',x=>x.pieces[0].length=-1],
  ['string length',x=>x.pieces[0].length='1'], ['null piece',x=>x.pieces[0]=null],
  ['tight curve',x=>x.pieces[1].radius=.1], ['zero angle',x=>x.pieces[1].angle=0],
  ['nonfinite angle',x=>x.pieces[1].angle=NaN], ['open track',x=>x.pieces[0].length=2],
  ['wrong direction',x=>{ x.pieces.forEach(p=>{if(p.angle)p.angle=-p.angle;}); x.lanes={inner:-.05,outer:.05}; }],
  ['finish on curve',x=>x.pieces.push(x.pieces.shift())],
];
for (const [name,change] of invalid) test(`parser rejects ${name}`,()=>{
  const raw=structuredClone(OVAL); change(raw); assert.throws(()=>parseCircuitDefinition(raw));
});
test('parser rejects nonobject definitions',()=>{for(const x of [null,[],1,'oval'])assert.throws(()=>parseCircuitDefinition(x));});
test('parser rejects a closed track whose surface exceeds its curve radii',()=>{
  const raw=structuredClone(OVAL);
  raw.pieces.filter(p=>p.type==='curve').forEach(p=>p.radius=.08);
  assert.throws(()=>parseCircuitDefinition(raw),/half the track width/);
});
test('catalog rejects duplicate and ambiguous names including id aliases',()=>{
  assert.throws(()=>createCircuitCatalog([OVAL,OVAL]),/duplicate/);
  assert.throws(()=>createCircuitCatalog([OVAL,{...CLUB,name:'oVaL'}]),/ambiguous/);
  assert.throws(()=>createCircuitCatalog([]));
});
test('the zero-turn exception must be explicit and begin with a clockwise lobe', () => {
  const raw = structuredClone(INFINITE_LOOP);
  delete raw.topology;
  assert.throws(()=>parseCircuitDefinition(raw), /direction rule/);
  assert.throws(()=>parseCircuitDefinition({...OVAL, topology:'figure-eight'}), /direction rule/);
  assert.throws(()=>parseCircuitDefinition({...OVAL, topology:'anything'}), /topology/);
  const reversed = structuredClone(INFINITE_LOOP);
  reversed.pieces.forEach(p=>{if(p.type==='curve')p.angle=-p.angle;});
  assert.throws(()=>parseCircuitDefinition(reversed), /direction rule/);
});
