// Run only by the owner after restricting the output directory ACL.
import assert from 'node:assert/strict';
import { resolve, relative, isAbsolute } from 'node:path';
import { existsSync, realpathSync, writeFileSync } from 'node:fs';
import { generateKeyPairSync, createHash } from 'node:crypto';
import { checkToolchain, json } from './common.mjs';
checkToolchain();
assert.equal(process.argv[2],'--restricted-directory');
assert(process.argv[3],'Specify private directory');
const directory=realpathSync(process.argv[3]), root=realpathSync(process.cwd());
const rel=relative(root,directory);
assert(isAbsolute(rel)||rel.startsWith('..'),'Private key directory must be outside repository');
assert(!existsSync('artifacts/issuer-public.json'),'Public keys already recorded; explicit rotation required');
for(const type of ['age','lot']) assert(!existsSync(resolve(directory,`${type}.pkcs8.pem`)),'Refusing key overwrite');
const issuers=[];
for(const type of ['AGE','LOT']) {
  const {privateKey,publicKey}=generateKeyPairSync('ed25519');
  const raw=Buffer.from(publicKey.export({format:'jwk'}).x,'base64url');
  assert.equal(raw.length,32);
  writeFileSync(resolve(directory,`${type.toLowerCase()}.pkcs8.pem`),privateKey.export({format:'pem',type:'pkcs8'}),{flag:'wx',mode:0o600});
  issuers.push({type,keyVersion:1,algorithm:'Ed25519',publicKey:raw.toString('base64url'),fingerprint:createHash('sha256').update(raw).digest('hex')});
}
json('artifacts/issuer-public.json',{createdAt:new Date().toISOString(),operator:'owner',issuers});
console.log('Public keys and fingerprints: artifacts/issuer-public.json');
console.log('Private keys saved only in the restricted local directory. Never send them to chat.');
