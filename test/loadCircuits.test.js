import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCircuits } from '../src/data/loadCircuits.js';
import { OVAL, CLUB } from './helpers/circuits.js';
import { createStaticServer } from '../scripts/serve.mjs';
import { fileURLToPath } from 'node:url';

function source(files=['oval.json','club.json'], changes={}) {
  const data={'index.json':files,'math.json':{},'oval.json':OVAL,'club.json':CLUB,...changes};
  const urls=[];
  return {urls, fetchImpl:async url=>{
    urls.push(url.href);
    const file=url.pathname.split('/').at(-1);
    return {ok:true,json:async()=>structuredClone(data[file])};
  }};
}
const baseUrl=new URL('https://example.test/openslotcars/circuits/');
test('loader preserves index order when responses arrive in reverse order',async()=>{
  const input=source();
  const fetchImpl=async url=>{
    if(url.pathname.endsWith('/oval.json'))await new Promise(r=>setTimeout(r,15));
    return input.fetchImpl(url);
  };
  const catalog=await loadCircuits({baseUrl,fetchImpl});
  assert.deepEqual(catalog.circuits.map(c=>c.id),['oval','club']);
  assert.equal(catalog.byId('club').name,'Club');
  assert.ok(input.urls.every(url=>url.startsWith(baseUrl.href)));
});
for(const files of [[],['oval.json','oval.json'],['../oval.json'],['https://example.test/a.json'],['index.json'],['math.json'],['/oval.json'],['club.json'],null]) {
  test(`loader rejects invalid or incomplete index ${JSON.stringify(files)}`,async()=>{
    await assert.rejects(loadCircuits({...source(files),baseUrl}));
  });
}
test('loader rejects ids that disagree with filenames',async()=>{
  await assert.rejects(loadCircuits({...source(undefined,{'club.json':OVAL}),baseUrl}),/club.json: id/);
});
test('loader reports filename and invalid field',async()=>{
  await assert.rejects(loadCircuits({...source(undefined,{'club.json':{...CLUB,start:null}}),baseUrl}),/club.json: club.start/);
});
for(const file of ['index.json','math.json','oval.json']) for(const failure of ['http','json','network']) {
  test(`loader rejects ${failure} failure in ${file}`,async()=>{
    const input=source();
    const fetchImpl=async url=>{
      if(!url.pathname.endsWith('/'+file))return input.fetchImpl(url);
      if(failure==='network')throw Error('offline');
      return {ok:failure!=='http',status:404,json:async()=>{
        if(failure==='json')throw SyntaxError('invalid JSON');
        return file==='index.json'?['oval.json']:OVAL;
      }};
    };
    await assert.rejects(loadCircuits({baseUrl,fetchImpl}),error=>error.message.includes(file));
  });
}
test('loader resolves named constants from math.json and reports invalid constants', async () => {
  const oval = structuredClone(OVAL);
  oval.pieces.filter(p=>p.type==='curve').forEach(p=>p.angle='Math.PI');
  const input=source(['oval.json'],{'oval.json':oval,'math.json':{PI:Math.PI}});
  assert.deepEqual((await loadCircuits({...input,baseUrl})).byId('oval'),OVAL);
  await assert.rejects(loadCircuits({...source(['oval.json'],{'oval.json':oval}),baseUrl}),/oval.json:.*unknown constant Math.PI/);
  await assert.rejects(loadCircuits({...source(undefined,{'math.json':{PI:'3.14'}}),baseUrl}),/math.json.PI/);
});
test('real static HTTP server serves JSON with the expected catalog and MIME type',async t=>{
  const server=createStaticServer({root:fileURLToPath(new URL('../',import.meta.url))});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r);}));
  const baseUrl=new URL(`http://127.0.0.1:${server.address().port}/circuits/`);
  const response=await fetch(new URL('club.json',baseUrl));
  assert.match(response.headers.get('content-type'),/application\/json/);
  const catalog=await loadCircuits({baseUrl});
  assert.deepEqual(catalog.circuits.map(c=>c.id),['oval','speedway','chicane','teardrop','club']);
});
