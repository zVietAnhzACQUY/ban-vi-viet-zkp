import assert from 'node:assert/strict';
import { mkdirSync, existsSync, appendFileSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { powersOfTau, zKey, curves } from 'snarkjs';
import { checkToolchain, configs, paths, sha, readJson, json } from './common.mjs';

checkToolchain();
const tests=readJson('artifacts/evidence/witness-tests.json');
assert.equal(tests.status,'PASS'); assert.equal(tests.buildSha256,sha('artifacts/evidence/build.json'));
for(const c of configs) {
  const expected=tests.circuits.find(x=>x.dir===c.dir);
  assert.equal(sha(paths(c).r1cs),expected.r1csSha256);
  assert.equal(sha(`circuits/${c.dir}/${c.name}.circom`),expected.sourceSha256);
}
const owner=process.argv.includes('--owner-contribution');
if(owner) {
  assert(process.stdin.isTTY,'Run owner contribution yourself in an interactive terminal');
  const {createInterface}=await import('node:readline/promises');
  const rl=createInterface({input:process.stdin,output:process.stdout});
  const answer=await rl.question('Ban truc tiep thuc hien contribution tren may nay? Go TOI: '); rl.close();
  assert.equal(answer,'TOI','Owner confirmation required');
}
const stage=owner?'owner':'development';
const dir=`.work/setup/${stage}`;
assert(!existsSync(`${dir}/complete.json`),'Setup already completed; do not overwrite');
mkdirSync(dir,{recursive:true}); mkdirSync('artifacts/evidence',{recursive:true});
const logPath=`artifacts/evidence/setup-${stage}.log`;
assert(!existsSync(logPath),'Partial setup exists. Inspect it before retrying; no implicit overwrite');
const logger=Object.fromEntries(['debug','info','warn','error'].map(level=>[level,(...parts)=>appendFileSync(logPath,`${level}: ${parts.join(' ')}\n`)]));
const entropy=()=>randomBytes(64).toString('hex'); // never written or printed
const report={createdAt:new Date().toISOString(),stage,status:owner?'OWNER_CONTRIBUTED':'DEVELOPMENT_ONLY_PENDING_OWNER',curve:'bn128',power:11,contributions:[],artifacts:[]};
let ptau;
if(!owner) {
  const curve=await curves.getCurveFromName('bn128');
  console.log('Creating development Powers of Tau bn128 power 11...');
  await powersOfTau.newAccumulator(curve,11,`${dir}/pot_0000.ptau`,logger);
  const hash=await powersOfTau.contribute(`${dir}/pot_0000.ptau`,`${dir}/pot_0001.ptau`,'automated development phase1',entropy(),logger);
  report.contributions.push({phase:1,hash:Buffer.from(hash).toString('hex')});
  assert(await powersOfTau.verify(`${dir}/pot_0001.ptau`,logger));
  ptau=`${dir}/pot_final.ptau`;
  await powersOfTau.preparePhase2(`${dir}/pot_0001.ptau`,ptau,logger);
  assert(await powersOfTau.verify(ptau,logger));
} else {
  const prior=readJson('artifacts/evidence/setup-development.json');
  ptau=prior.ptau.path; assert.equal(sha(ptau),prior.ptau.sha256);
}
report.ptau={path:ptau,sha256:sha(ptau)};
for(const c of configs) {
  console.log(`Phase 2 ${c.type}: ${stage} contribution and verification...`);
  let input;
  if(!owner) {
    input=`${dir}/${c.dir}_0000.zkey`;
    assert.notEqual(await zKey.newZKey(paths(c).r1cs,ptau,input,logger),-1);
  } else {
    const prior=readJson('artifacts/evidence/setup-development.json').artifacts.find(a=>a.type===c.type);
    input=prior.zkey.path; assert.equal(sha(input),prior.zkey.sha256);
  }
  const output=`${dir}/${c.dir}_contributed.zkey`;
  const hash=await zKey.contribute(input,output,owner?'owner single-party demo':'automated development phase2',entropy(),logger);
  assert(await zKey.verifyFromR1cs(paths(c).r1cs,ptau,output,logger));
  const vkPath=`artifacts/${stage}/${c.dir}.verification_key.json`;
  json(vkPath,await zKey.exportVerificationKey(output));
  report.contributions.push({phase:2,type:c.type,hash:Buffer.from(hash).toString('hex')});
  report.artifacts.push({type:c.type,zkey:{path:output,sha256:sha(output)},verificationKey:{path:vkPath,sha256:sha(vkPath)},r1cs:{path:paths(c).r1cs,sha256:sha(paths(c).r1cs)}});
}
report.transcript={path:logPath,sha256:sha(logPath)};
json(`artifacts/evidence/setup-${stage}.json`,report); json(`${dir}/complete.json`,{status:report.status});
console.log(`${stage} setup verified; ${owner?'run proof-tests --owner next':'owner contribution still required'}.`);
process.exit(0);
