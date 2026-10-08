import assert from 'node:assert/strict';
import { groth16 } from 'snarkjs';
import { checkToolchain, configs, paths, readJson, sha, json } from './common.mjs';

checkToolchain();
const owner=process.argv.includes('--owner'),stage=owner?'owner':'development';
const setup=readJson(`artifacts/evidence/setup-${stage}.json`);
assert.equal(sha(setup.transcript.path),setup.transcript.sha256);
const tests=readJson('artifacts/evidence/witness-tests.json'); assert.equal(tests.status,'PASS');
assert.equal(tests.buildSha256,sha('artifacts/evidence/build.json'));
const golden=readJson('circuits/vectors/golden.json');
const report={createdAt:new Date().toISOString(),stage,setupSha256:sha(`artifacts/evidence/setup-${stage}.json`),cases:[]};
const check=(id,detail)=>{report.cases.push({id,result:'PASS',detail});console.log(`PASS ${id}`);};
// snarkjs does not reject an incompatible signal count before accessing vk.IC.
const verifyCompatible=(vk,signals,proof)=>signals.length!==vk.nPublic || vk.IC.length!==signals.length+1
  ? Promise.resolve(false) : groth16.verify(vk,signals,proof);
const manifest={schemaVersion:1,status:owner?'OWNER_SETUP_VERIFIED_ISSUER_PENDING':'DEVELOPMENT_ONLY_PENDING_OWNER',
  curve:'bn128',protocol:'groth16',toolchain:readJson('artifacts/toolchain.json'),setup,issuerFingerprints:null,
  inputEncoding:'D02 H2F-v1; field decimal strings; Ed25519 metadata D03',
  domains:{age:'1',lot:'2',nullifier:'3',request:'4'},
  poseidon:{age:['domainAge','dobDay','salt','holderSecret'],lot:['domainLot','originCode','supplierIdHash','salt','privateLotCodeHash'],nullifier:['domainNullifier','holderSecret','requestHash'],request:['domainRequest','challengeNonceField','userIdHash','cartSnapshotHash','cutoffDay','circuitVersionField']},
  circuits:[]};
for(const c of configs) {
  const a=setup.artifacts.find(a=>a.type===c.type), ct=tests.circuits.find(a=>a.type===c.type);
  assert.equal(sha(a.zkey.path),a.zkey.sha256);assert.equal(sha(a.verificationKey.path),a.verificationKey.sha256);
  assert.equal(sha(paths(c).r1cs),ct.r1csSha256);assert.equal(sha(paths(c).r1cs),a.r1cs.sha256);
  assert.equal(sha(paths(c).wasm),ct.wasmSha256);
  assert.equal(sha(`circuits/${c.dir}/${c.name}.circom`),ct.sourceSha256);
  const vk=readJson(a.verificationKey.path);
  const proof=await groth16.prove(a.zkey.path,`.work/tests/${c.type==='AGE'?'A0':'B0'}.wtns`,undefined,{singleThread:true});
  assert.deepEqual(proof.publicSignals,c.signals.map(k=>golden[c.dir][k]));
  assert(await groth16.verify(vk,proof.publicSignals,proof.proof));
  check(`${c.type}-valid-proof`,'Real Groth16 proof verified; public signals match golden and observed symbol order');
  json(`artifacts/${stage}/${c.dir}.proof.json`,proof);
  for(let i=0;i<proof.publicSignals.length;i++) {
    const signals=[...proof.publicSignals]; signals[i]=(BigInt(signals[i])+1n).toString();
    assert.equal(await groth16.verify(vk,signals,proof.proof),false);
    check(`${c.type}-tampered-${c.signals[i]}`,'Existing proof with one changed public signal rejected');
  }
  const bad=structuredClone(proof.proof);bad.pi_a=['0','0','1'];
  assert.equal(await groth16.verify(vk,proof.publicSignals,bad),false);
  check(`${c.type}-tampered-proof`,'Modified proof rejected');
  const other=setup.artifacts.find(a=>a.type!==c.type);
  assert.equal(await verifyCompatible(readJson(other.verificationKey.path),proof.publicSignals,proof.proof),false);
  check(`${c.type}-wrong-vk`,'Other circuit verification key rejected by public schema/count guard');
  // Generate a proof from a directly corrupted witness, bypassing the generator.
  const invalid=await groth16.prove(a.zkey.path,`.work/tests/${c.dir}-tampered-1.wtns`,undefined,{singleThread:true});
  assert.equal(await groth16.verify(vk,invalid.publicSignals,invalid.proof),false);
  check(`${c.type}-invalid-witness-proof`,'Prover ran on corrupted witness; Groth16 verifier rejected');
  const {createHash}=await import('node:crypto');
  manifest.circuits.push({type:c.type,version:1,status:manifest.status,publicSignals:ct.observedPublicSignals,
    signalSchemaSha256:createHash('sha256').update(JSON.stringify(ct.observedPublicSignals)).digest('hex'),
    sourceSha256:ct.sourceSha256,r1cs:a.r1cs,wasm:{path:paths(c).wasm,sha256:ct.wasmSha256},zkey:a.zkey,verificationKey:a.verificationKey});
}
report.total=report.cases.length;report.status='PASS';
json(`artifacts/evidence/proof-tests-${stage}.json`,report);
json('artifacts/manifest.json',manifest);
console.log(`PASS ${report.total} proof checks; manifest status ${manifest.status}.`);
process.exit(0);
