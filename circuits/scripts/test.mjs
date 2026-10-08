import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createPublicKey, verify, createHash } from 'node:crypto';
import { buildPoseidon, buildPoseidonReference } from 'circomlibjs';
import { wtns } from 'snarkjs';
import { WitnessCalculatorBuilder } from 'circom_runtime';
import { checkToolchain, readJson, json, sha, configs, paths } from './common.mjs';

checkToolchain();
const golden=readJson('circuits/vectors/golden.json');
const build=readJson('artifacts/evidence/build.json');
const report={createdAt:new Date().toISOString(),buildSha256:sha('artifacts/evidence/build.json'),goldenSha256:sha('circuits/vectors/golden.json'),cases:[],circuits:[]};
const pass=(id,detail)=>{report.cases.push({id,result:'PASS',detail}); console.log(`PASS ${id}`);};
// snarkjs 0.7.6's negative check path calls logger.warn unconditionally.
const logger={info(){},debug(){},warn(){},error(){}};
const poseidon=await buildPoseidon(), reference=await buildPoseidonReference();
const P=values=>{
  const result=poseidon.F.toString(poseidon(values.map(BigInt)));
  assert.equal(result,reference.F.toString(reference(values.map(BigInt)))); return result;
};
assert.equal(P([1,39714,11,22]),golden.age.commitment);
assert.equal(P([3,22,33]),golden.age.nullifier);
assert.equal(P([2,1,44,55,66]),golden.lot.commitment);
assert.equal(P(golden.requestInputs),golden.integrationRequestHash);
pass('golden-poseidon-3-4-5-6','Saved golden vs reference and WASM');
assert.equal(sha('circuits/tests/request_hash_vector.circom'),build.requestVector.sourceSha256);
assert.equal(sha('.work/build/request-vector/request_hash_vector.r1cs'),build.requestVector.r1csSha256);
assert.equal(sha('.work/build/request-vector/request_hash_vector_js/request_hash_vector.wasm'),build.requestVector.wasmSha256);
mkdirSync('.work/tests',{recursive:true});
await wtns.calculate({values:golden.requestInputs,expected:golden.integrationRequestHash},'.work/build/request-vector/request_hash_vector_js/request_hash_vector.wasm','.work/tests/request-vector.wtns');
assert(await wtns.check('.work/build/request-vector/request_hash_vector.r1cs','.work/tests/request-vector.wtns',logger));
pass('request-poseidon6-circom','Arity 6 golden matches Circom constraints; test harness has no trusted setup');
for(const [tag,v] of Object.entries(golden.hashes)) {
  const digest=createHash('sha256').update(Buffer.from(v.bytes,'hex')).digest('hex');
  assert.equal(digest,v.sha256); assert.equal((BigInt('0x'+digest)%BigInt(golden.field)).toString(),v.field);
  pass(`golden-h2f-${tag}`,'Saved byte preimage/digest/field');
}
const publicKey=createPublicKey({key:Buffer.from(golden.signatureTest.publicKeySpki,'base64url'),type:'spki',format:'der'});
for(const [type,v] of Object.entries(golden.signatureTest.signatures)) {
  const bytes=Buffer.from(v.messageHex,'hex'), signature=Buffer.from(v.signature,'base64url');
  assert(verify(null,bytes,publicKey,signature));
  for(let i=0;i<bytes.length;i++) { const b=Buffer.from(bytes); b[i]^=1; assert(!verify(null,b,publicKey,signature)); }
  const bad=Buffer.from(signature); bad[0]^=1; assert(!verify(null,bytes,publicKey,bad));
  pass(`signature-${type}`,`Positive and ${bytes.length} message-byte mutations plus signature mutation`);
}
const day=s=>{
  assert.match(s,/^\d{4}-\d{2}-\d{2}$/);
  const date=new Date(s+'T00:00:00Z'); assert(!Number.isNaN(date.valueOf())); assert.equal(date.toISOString().slice(0,10),s);
  const index=(date-Date.UTC(1900,0,1))/86400000; assert(index>=0&&index<=73413); return index;
};
const cutoff=(today,age)=>{
  day(today); assert(Number.isInteger(age)&&age>=1&&age<=120);
  const [year,month,date]=today.split('-').map(Number), y=year-age;
  const last=new Date(Date.UTC(y,month,0)).getUTCDate();
  return day(`${y}-${String(month).padStart(2,'0')}-${String(Math.min(date,last)).padStart(2,'0')}`);
};
for(const invalid of ['1900-02-29','2100-02-29','2026-02-30','1899-12-31','2101-01-01']) assert.throws(()=>day(invalid));
pass('A13-date-validation','Invalid calendar dates/out of supported domain rejected');
const dateCases=[
 ['A7','2022-02-27',18,'2004-02-29',false,38042],
 ['A8','2022-02-28',18,'2004-02-29',false,38043],
 ['A9a','2022-02-28',18,'2004-02-28',true,38043],
 ['A9b','2022-02-28',18,'2004-03-01',false,38043],
 ['A10a','2022-03-01',18,'2004-02-29',true,38045],
 ['A10b','2022-03-01',18,'2004-03-01',true,38045],
 ...['2024-02-28','2024-02-29','2024-03-01'].flatMap((t,i)=>[
   [`A11-${i}-feb`,t,18,'2006-02-28',true,i===2?38775:38774],
   [`A11-${i}-mar`,t,18,'2006-03-01',i===2,i===2?38775:38774]]),
 ['A12a','2024-02-28',20,'2004-02-29',false,38043],
 ['A12b','2024-02-29',20,'2004-02-29',true,38044],
];
for(const [id,t,age,dob,expected,cut] of dateCases) {assert.equal(cutoff(t,age),cut);assert.equal(day(dob)<=cut,expected);}
assert.equal(day('2004-02-29')<=cutoff(new Date('2022-02-28T23:59:59Z').toISOString().slice(0,10),18),false);
assert.equal(day('2004-02-29')<=cutoff(new Date('2022-03-01T00:00:00Z').toISOString().slice(0,10),18),true);
pass('UTC-boundary-and-cutoff','Date policy checked independently of circuit');
const ageInput=(dob,cut)=>({...golden.age,dobDay:String(dob),cutoffDay:String(cut),commitment:P([1,dob,11,22])});
const cases={age:[
 ['A0',golden.age,true], ['A1',ageInput(39715,39714),false],['A2',ageInput(39713,39714),true],
 ['A3',ageInput(0,0),true],['A4',ageInput(73413,73413),true],
 ['A5-dob',ageInput(73414,73413),false],['A5-cutoff',ageInput(73413,73414),false],
 ['A6-negative-field',ageInput(BigInt(golden.field)-1n,39714),false],['A6-cutoff-bits',ageInput(39714,131072),false],
 ...dateCases.map(([id,t,a,dob,expected])=>[id,ageInput(day(dob),cutoff(t,a)),expected]),
 ...['dobDay','salt','holderSecret','commitment','nullifier','requestHash','cutoffDay'].map(k=>[
  `A-mutate-${k}`,{...golden.age,[k]:String(BigInt(golden.age[k])+(k==='dobDay'||k==='cutoffDay'?-1n:1n))},false]),
 ['A-new-request-valid-statement',{...golden.age,requestHash:'34',nullifier:P([3,22,34])},true],
 ['A-new-cutoff-valid-statement',{...golden.age,cutoffDay:'39715'},true],
],lot:[
 ['B0',golden.lot,true],
 ['B1',{...golden.lot,originCode:'2',commitment:P([2,2,44,55,66])},false],
 ['B2',{...golden.lot,privateLotCodeHash:'67',commitment:P([2,1,44,55,67])},false],
 ...Object.keys(golden.lot).map(k=>[`B-mutate-${k}`,{...golden.lot,[k]:String(BigInt(golden.lot[k])+1n)},false]),
 ['B6-policy-outside-circuit',{...golden.lot,originCode:'2',publicAllowedCode:'2',commitment:P([2,2,44,55,66])},true],
 ['B-integration-hashes',{...golden.lot,supplierIdHash:golden.hashes.supplier.field,privateLotCodeHash:golden.hashes.lot.field,lotCodeHash:golden.hashes.lot.field,commitment:golden.bindings.lotCommitment},true],
]};
mkdirSync('.work/tests',{recursive:true});
for(const c of configs) {
  const p=paths(c), compiled=build.circuits.find(x=>x.dir===c.dir);
  const calculator=await WitnessCalculatorBuilder(readFileSync(p.wasm));
  assert.equal(sha(`circuits/${c.dir}/${c.name}.circom`),compiled.sourceSha256);
  assert.equal(sha(p.r1cs),compiled.r1csSha256); assert.equal(sha(p.wasm),compiled.wasmSha256);
  const observed=readFileSync(p.sym,'utf8').trim().split(/\r?\n/).map(l=>l.split(',')).filter(a=>+a[1]>=1&&+a[1]<=c.signals.length).sort((a,b)=>+a[1]-+b[1]).map(a=>a[3].replace('main.',''));
  assert.deepEqual(observed,c.signals); report.circuits.push({...compiled,observedPublicSignals:observed});
  for(const [id,input,expected] of cases[c.dir]) {
    const file=`.work/tests/${id}.wtns`;
    let generated=false, error;
    try { const bytes=await calculator.calculateWTNSBin(input); writeFileSync(file,bytes); generated=true; } catch(e) {error=e;}
    if(expected) {
      if(!generated) throw error; assert(await wtns.check(p.r1cs,file,logger),id);
      const witness=await wtns.exportJson(file);
      assert.deepEqual(witness.slice(1,1+c.signals.length).map(String),c.signals.map(k=>input[k]));
      pass(id,'Witness generated; snarkjs R1CS check PASS; public values/order match');
    } else {
      if(generated) assert.equal(await wtns.check(p.r1cs,file,logger),false,`${id}: invalid witness accepted`);
      else assert.match(error.message,/Assert Failed|Error in template/,'Unexpected infrastructure failure is not a negative test pass');
      pass(id,generated?'R1CS rejected generated witness':'Witness generation rejected invalid input');
    }
  }
  // Bypass all WASM asserts: edit the binary witness directly, then check R1CS.
  const base=readFileSync(`.work/tests/${c.dir==='age'?'A0':'B0'}.wtns`);
  let pos=12, dataOffset;
  for(let i=0;i<base.readUInt32LE(8);i++) {
    const type=base.readUInt32LE(pos), size=Number(base.readBigUInt64LE(pos+4));
    if(type===2) dataOffset=pos+12; pos+=12+size;
  }
  assert(dataOffset);
  const symbols=readFileSync(p.sym,'utf8').trim().split(/\r?\n/).map(l=>l.split(','));
  const selected=symbols.filter(a=>+a[1]>0 && (/^main\.[^.]+$/.test(a[3]) || /main\.dobRange\.out\[0\]|main\.cutoffRange\.out\[0\]/.test(a[3])));
  selected.push(symbols.find(a=>+a[1]>0 && a[3].startsWith('main.credential.') && !a[3].includes('inputs')));
  for(const symbol of selected.filter(Boolean)) {
    const tampered=Buffer.from(base), offset=dataOffset+Number(symbol[1])*32;
    const old=BigInt('0x'+Buffer.from(tampered.subarray(offset,offset+32)).reverse().toString('hex'));
    Buffer.from(((old+1n)%BigInt(golden.field)).toString(16).padStart(64,'0'),'hex').reverse().copy(tampered,offset);
    const target=`.work/tests/${c.dir}-tampered-${symbol[1]}.wtns`; writeFileSync(target,tampered);
    assert.equal(await wtns.check(p.r1cs,target,logger),false,`R1CS accepted altered ${symbol[3]}`);
    pass(`${c.dir}-raw-witness-${symbol[3]}`,'Binary witness modified directly; R1CS rejected without using generator assertions');
  }
}
report.total=report.cases.length; report.status='PASS';
json('artifacts/evidence/witness-tests.json',report);
console.log(`PASS ${report.total} checks. No setup/proof is implied by this report.`);
process.exit(0);
