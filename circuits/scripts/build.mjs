import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { checkToolchain, run, sha, configs, paths, json } from './common.mjs';
const pin=checkToolchain();
const compiler='.tools/circom.exe';
assert.equal(sha(compiler),pin.circom.sha256);
const report={createdAt:new Date().toISOString(),toolchainSha256:sha('artifacts/toolchain.json'),circuits:[]};
for(const c of configs) {
  let output='';
  for(const unchecked of [false,true]) {
    const p=paths(c,unchecked); mkdirSync(p.base,{recursive:true});
    const flags=[...pin.compilerFlags]; flags[flags.indexOf('--sanity_check')+1]=unchecked?'0':'2';
    output+=run(compiler,[`circuits/${c.dir}/${c.name}.circom`,...flags,'-l','node_modules','-o',p.base]);
  }
  const p=paths(c);
  assert.equal(sha(p.r1cs),sha(paths(c,true).r1cs),'Sanity check must not change constraints');
  report.circuits.push({...c,sourceSha256:sha(`circuits/${c.dir}/${c.name}.circom`),r1csSha256:sha(p.r1cs),wasmSha256:sha(p.wasm),symSha256:sha(p.sym)});
  mkdirSync('artifacts/evidence',{recursive:true}); writeFileSync(`artifacts/evidence/${c.dir}-compile.txt`,output);
  console.log(output);
}
mkdirSync('.work/build/request-vector',{recursive:true});
console.log(run(compiler,['circuits/tests/request_hash_vector.circom',...pin.compilerFlags,'-l','node_modules','-o','.work/build/request-vector']));
report.requestVector={sourceSha256:sha('circuits/tests/request_hash_vector.circom'),r1csSha256:sha('.work/build/request-vector/request_hash_vector.r1cs'),wasmSha256:sha('.work/build/request-vector/request_hash_vector_js/request_hash_vector.wasm')};
json('artifacts/evidence/build.json',report);
