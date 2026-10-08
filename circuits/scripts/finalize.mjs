import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { checkToolchain,readJson,sha,json } from './common.mjs';
checkToolchain();
const manifest=readJson('artifacts/manifest.json');
assert.equal(manifest.status,'OWNER_SETUP_VERIFIED_ISSUER_PENDING');
const proof=readJson('artifacts/evidence/proof-tests-owner.json');
assert.equal(proof.status,'PASS'); assert.equal(proof.stage,'owner');
assert.equal(proof.setupSha256,sha('artifacts/evidence/setup-owner.json'));
const issuers=readJson('artifacts/issuer-public.json');
assert.equal(issuers.operator,'owner');
for(const type of ['AGE','LOT']) {
  const issuer=issuers.issuers.find(x=>x.type===type);assert(issuer);
  const raw=Buffer.from(issuer.publicKey,'base64url');assert.equal(raw.length,32);
  assert.equal(createHash('sha256').update(raw).digest('hex'),issuer.fingerprint);
}
for(const c of manifest.circuits) for(const field of ['r1cs','wasm','zkey','verificationKey']) assert.equal(sha(c[field].path),c[field].sha256);
manifest.issuerFingerprints=issuers.issuers.map(({type,keyVersion,fingerprint})=>({type,keyVersion,fingerprint}));
manifest.status='G1_OFFLINE_VERIFIED_SINGLE_PARTY';
for(const c of manifest.circuits) c.status=manifest.status;
json('artifacts/manifest.json',manifest);
json('artifacts/evidence/owner-summary.json',{status:manifest.status,manifestSha256:sha('artifacts/manifest.json'),proofChecks:proof.total,issuerFingerprints:manifest.issuerFingerprints,setupTranscriptSha256:manifest.setup.transcript.sha256,limits:'Owner single-party simulated Issuer/setup. No legal or institutional trust claim.'});
console.log('Public summary to send: artifacts/evidence/owner-summary.json');
console.log('Do not send private keys, credentials, entropy or witness files.');
