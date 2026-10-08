// Read-only verification of an existing finalized owner setup. Never loads Issuer private keys.
import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { groth16, zKey, powersOfTau } from 'snarkjs';
import { checkToolchain, configs, readJson, sha } from './common.mjs';

checkToolchain();
const root=realpathSync('.');
const local=path=>{const full=realpathSync(path),rel=relative(root,full);assert(rel && !isAbsolute(rel) && rel!=='..' && !rel.startsWith('..\\') && !rel.startsWith('../'),'Artifact must stay inside workspace');return full;};
const hashMatches=a=>assert.equal(sha(local(a.path)),a.sha256);
const summary=readJson('artifacts/evidence/owner-summary.json');
const manifest=readJson('artifacts/manifest.json');
const setup=readJson('artifacts/evidence/setup-owner.json');
const proofTests=readJson('artifacts/evidence/proof-tests-owner.json');
const witnessTests=readJson('artifacts/evidence/witness-tests.json');
const golden=readJson('circuits/vectors/golden.json');
assert.equal(summary.status,'G1_OFFLINE_VERIFIED_SINGLE_PARTY');
assert.equal(manifest.status,summary.status);
assert.equal(sha('artifacts/manifest.json'),summary.manifestSha256);
assert.deepEqual(manifest.setup,setup);
assert.deepEqual(manifest.toolchain,readJson('artifacts/toolchain.json'));
assert.equal(setup.stage,'owner');assert.equal(setup.status,'OWNER_CONTRIBUTED');
assert.equal(proofTests.setupSha256,sha('artifacts/evidence/setup-owner.json'));
assert.equal(proofTests.stage,'owner');assert.equal(proofTests.status,'PASS');
assert.equal(proofTests.total,15);assert.equal(proofTests.cases.length,15);
assert(proofTests.cases.every(c=>c.result==='PASS'));assert.equal(summary.proofChecks,15);
assert.equal(witnessTests.status,'PASS');assert.equal(witnessTests.total,71);
assert.equal(witnessTests.cases.length,71);assert(witnessTests.cases.every(c=>c.result==='PASS'));
assert.equal(witnessTests.buildSha256,sha('artifacts/evidence/build.json'));
assert.equal(witnessTests.goldenSha256,sha('circuits/vectors/golden.json'));
const fingerprints=readJson('artifacts/issuer-public.json').issuers.map(({type,keyVersion,publicKey,fingerprint})=>{
  const raw=Buffer.from(publicKey,'base64url');assert.equal(raw.length,32);
  assert.equal(createHash('sha256').update(raw).digest('hex'),fingerprint);
  return {type,keyVersion,fingerprint};
});
assert.deepEqual(fingerprints,summary.issuerFingerprints);
assert.deepEqual(fingerprints,manifest.issuerFingerprints);
hashMatches(setup.ptau);hashMatches(setup.transcript);
assert.equal(summary.setupTranscriptSha256,setup.transcript.sha256);
const logger={info(){},debug(){},warn(){},error(){}};
assert(await powersOfTau.verify(local(setup.ptau.path),logger));
for(const c of configs) {
  const artifact=manifest.circuits.find(a=>a.type===c.type);
  const tested=witnessTests.circuits.find(a=>a.type===c.type);
  const contributed=setup.artifacts.find(a=>a.type===c.type);
  assert.equal(artifact.status,manifest.status);assert.equal(artifact.version,1);
  for(const key of ['r1cs','wasm','zkey','verificationKey']) hashMatches(artifact[key]);
  for(const key of ['r1cs','zkey','verificationKey']) assert.deepEqual(artifact[key],contributed[key]);
  assert.equal(sha(`circuits/${c.dir}/${c.name}.circom`),artifact.sourceSha256);
  assert.equal(tested.sourceSha256,artifact.sourceSha256);
  assert.equal(tested.r1csSha256,artifact.r1cs.sha256);assert.equal(tested.wasmSha256,artifact.wasm.sha256);
  assert.deepEqual(artifact.publicSignals,c.signals);assert.deepEqual(tested.observedPublicSignals,c.signals);
  assert.equal(createHash('sha256').update(JSON.stringify(c.signals)).digest('hex'),artifact.signalSchemaSha256);
  assert(setup.contributions.some(x=>x.type===c.type && x.phase===2));
  assert(await zKey.verifyFromR1cs(local(artifact.r1cs.path),local(setup.ptau.path),local(artifact.zkey.path),logger));
  const vk=readJson(local(artifact.verificationKey.path));
  assert.deepEqual(await zKey.exportVerificationKey(local(artifact.zkey.path)),vk);
  const proof=readJson(`artifacts/owner/${c.dir}.proof.json`);
  assert.deepEqual(proof.publicSignals,c.signals.map(k=>golden[c.dir][k]));
  assert(await groth16.verify(vk,proof.publicSignals,proof.proof));
  for(let i=0;i<c.signals.length;i++) {
    const changed=[...proof.publicSignals];changed[i]=(BigInt(changed[i])+1n).toString();
    assert.equal(await groth16.verify(vk,changed,proof.proof),false);
  }
  const changed=structuredClone(proof.proof);changed.pi_a=['0','0','1'];
  assert.equal(await groth16.verify(vk,proof.publicSignals,changed),false);
  console.log(`PASS ${c.type}: artifact hashes, contributed zkey, exported vk, saved proof, signal/proof mutations`);
}
assert.equal(sha('artifacts/manifest.json'),summary.manifestSha256);
console.log('PASS owner summary, fingerprints, source/build/golden linkage, 71/15 recorded checks and cryptographic re-verification. No artifacts changed; no Issuer private keys read.');
process.exit(0);
