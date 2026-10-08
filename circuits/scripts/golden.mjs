// Public synthetic fixtures only. Never use these small numbers as real secrets.
import { buildPoseidon, buildPoseidonReference } from 'circomlibjs';
import { createHash, generateKeyPairSync, sign, verify } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import assert from 'node:assert/strict';

const target = 'circuits/vectors/golden.json';
if (existsSync(target) && !process.argv.includes('--replace')) {
  throw new Error('Golden already exists. Review differences explicitly before using --replace.');
}
const p = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const u = (n, bytes) => Buffer.from(BigInt(n).toString(16).padStart(bytes * 2, '0'), 'hex');
const s = text => Buffer.concat([u(Buffer.byteLength(text), 4), Buffer.from(text)]);
const h2f = (tag, payload) => {
  const bytes = Buffer.concat([s('BVV-H2F-v1'), s(tag), u(payload.length, 4), payload]);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return { bytes: bytes.toString('hex'), sha256, field: (BigInt('0x' + sha256) % p).toString() };
};
const poseidon = await buildPoseidon();
const reference = await buildPoseidonReference();
const P = values => {
  const result = poseidon.F.toString(poseidon(values.map(BigInt)));
  assert.equal(result, reference.F.toString(reference(values.map(BigInt))));
  return result;
};
const user = '00000000-0000-4000-8000-000000000001';
const product = '00000000-0000-4000-8000-000000000002';
const credentialId = '00000000-0000-4000-8000-000000000003';
const issuerId = '00000000-0000-4000-8000-000000000004';
const hashes = {
  user: h2f('user', s(user)), product: h2f('product', s(product)),
  lot: h2f('lot', Buffer.concat([s(product), s('LOT-DEMO-01')])),
  supplier: h2f('supplier', s('SUP-DEMO-01')),
  cart: h2f('cart', Buffer.concat([u(1, 4), s(product), u(2, 4), u(150000, 8), u(1, 1), u(18, 4)])),
};
const age = { dobDay: '39714', salt: '11', holderSecret: '22', cutoffDay: '39714', requestHash: '33',
  commitment: P([1,39714,11,22]), nullifier: P([3,22,33]) };
const lot = { originCode: '1', supplierIdHash: '44', salt: '55', privateLotCodeHash: '66',
  publicAllowedCode: '1', lotCodeHash: '66', commitment: P([2,1,44,55,66]) };
const requestInputs = ['4','77',hashes.user.field,hashes.cart.field,'39714','1'];
const integrationRequestHash = P(requestInputs);
const bindings = {
  ageCommitment: age.commitment,
  lotCommitment: P([2,1,hashes.supplier.field,55,hashes.lot.field]),
};
const prefix = domain => [s(domain),u(1,4),u(1,4),s(credentialId),s(issuerId)];
const suffix = [u(1790294400,8),u(1792886400,8),u(1,4)];
const messages = {
  AGE: Buffer.concat([...prefix('BVV-AGE-CREDENTIAL'),u(bindings.ageCommitment,32),u(hashes.user.field,32),...suffix]),
  LOT: Buffer.concat([...prefix('BVV-LOT-CREDENTIAL'),u(bindings.lotCommitment,32),u(hashes.product.field,32),u(hashes.lot.field,32),u(1,4),u(1,32),...suffix]),
};
// Ephemeral in-memory test key, discarded; only public key/signatures are saved.
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const signatures = Object.fromEntries(Object.entries(messages).map(([type, msg]) => {
  const signature = sign(null, msg, privateKey);
  assert(verify(null,msg,publicKey,signature));
  const changed = Buffer.from(msg); changed[changed.length-1] ^= 1;
  assert(!verify(null,changed,publicKey,signature));
  return [type,{ messageHex:msg.toString('hex'), signature:signature.toString('base64url') }];
}));
const golden = { fixtureOnly:true, field:p.toString(), hashes, age, lot, requestInputs, integrationRequestHash, bindings,
  signatureTest:{ publicKeySpki:publicKey.export({type:'spki',format:'der'}).toString('base64url'), signatures },
  provenance:'circomlibjs 0.1.7 buildPoseidon (WASM) cross-checked with buildPoseidonReference; SHA-256 bytes explicit. Random ephemeral signing key discarded; this is not the Issuer key.' };
mkdirSync('circuits/vectors',{recursive:true});
writeFileSync(target,JSON.stringify(golden,null,2)+'\n');
console.log('Golden fixtures saved; Poseidon reference/WASM agree at arities 3,4,5,6; signature positive/negative passed.');
process.exit(0);
