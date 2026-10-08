import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

export const readJson = path => JSON.parse(readFileSync(path,'utf8'));
export const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
export const json = (path, value) => { mkdirSync(path.slice(0,path.lastIndexOf('/')),{recursive:true}); writeFileSync(path,JSON.stringify(value,null,2)+'\n'); };
export const configs = [
  {name:'age_eligibility',dir:'age',type:'AGE',signals:['commitment','cutoffDay','requestHash','nullifier']},
  {name:'lot_origin',dir:'lot',type:'LOT',signals:['commitment','publicAllowedCode','lotCodeHash']},
];
export function checkToolchain() {
  const pin = readJson('artifacts/toolchain.json');
  assert.equal(process.versions.node,pin.node,'Use pinned Node version');
  assert.equal(sha('package-lock.json'),pin.lockfileSha256,'Lockfile changed; review pin');
  assert.equal(sha('circuits/vectors/golden.json'),pin.goldenSha256,'Golden changed; review pin');
  for (const [name,value] of Object.entries(pin.dependencies)) assert.equal(readJson(`node_modules/${name}/package.json`).version,value.version);
  return pin;
}
export function run(binary,args) {
  const result = spawnSync(binary,args,{encoding:'utf8',windowsHide:true,maxBuffer:32*1024*1024});
  if(result.error) throw result.error;
  if(result.status !== 0) throw new Error(`${binary} ${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`);
  return result.stdout+result.stderr;
}
export function paths(c, unchecked=false) {
  const base=`.work/${unchecked?'unchecked':'build'}/${c.dir}`;
  return {base,r1cs:`${base}/${c.name}.r1cs`,wasm:`${base}/${c.name}_js/${c.name}.wasm`,sym:`${base}/${c.name}.sym`};
}
