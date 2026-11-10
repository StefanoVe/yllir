import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const cli=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'item-manager.mjs');
function campaign(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'yllir-item-cli-'));
  fs.writeFileSync(path.join(root,'campaign.yaml'),'language:\n  main: en\nstructure:\n  - id: objects\n    type: objects\n    folder: Objects\n  - id: plot\n    type: plot\n    folder: Plot\n');
  fs.mkdirSync(path.join(root,'Objects')); fs.mkdirSync(path.join(root,'Plot'));
  return root;
}
function run(root,...args){return spawnSync(process.execPath,[cli,root,...args],{encoding:'utf8'});}

test('CLI create emits a language-correct draft without writing campaign files',()=>{
  const root=campaign();
  try{
    const out=run(root,'create','--name','New Bell','--location','','--details','','--requested-by','','--imagination','no','--files','');
    assert.equal(out.status,0,out.stderr); const result=JSON.parse(out.stdout.slice(0,out.stdout.lastIndexOf('exit:')));
    assert.equal(result.file,'Objects/new-bell.md'); assert.match(result.content,/## In brief/);
    assert.ok(!fs.existsSync(path.join(root,'Objects','new-bell.md')));
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('empty --files scans all events and candidate output never prints master text',()=>{
  const root=campaign();
  try{
    fs.writeFileSync(path.join(root,'Plot','one.md'),'---\nsession: 1\n---\nA missing brass key appears.\n\n<!-- master -->\nOnly the master knows the key is cursed.\n<!-- /master -->\n');
    const out=run(root,'plot-items','--files','','--out','.campaign/state/plot.json');
    assert.equal(out.status,0,out.stderr); assert.match(out.stdout,/events: 1/); assert.match(out.stdout,/master-only/);
    assert.doesNotMatch(out.stdout,/cursed|Only the master/);
    assert.ok(fs.existsSync(path.join(root,'.campaign/state/plot.json')));
    assert.ok(!fs.existsSync(path.resolve(process.cwd(),'.campaign/state/plot.json')));
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('invalid CLI use exits 2 with a usage error',()=>{
  const root=campaign();
  try{
    const out=run(root,'create','--name','Only a name');
    assert.equal(out.status,2); assert.match(out.stderr,/usage: node item-manager\.mjs/);
    assert.match(out.stdout,/exit: 2/);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('draft CLI check skips non-item files from a mixed write batch',()=>{
  const root=campaign();
  try{
    const draft=path.join(root,'draft');
    for(const folder of ['Objects','People','Plot']) fs.mkdirSync(path.join(draft,folder),{recursive:true});
    fs.writeFileSync(path.join(draft,'Objects','bell.md'),'---\nid: bell\ntemplate: item\nlocation: []\n---\n\n# Bell\n\n## In brief\nA bell.\n\n## Description\nA brass bell.\n\n## Effects\nNo game effect.\n\n<!-- master -->\n## Master\n\n### Master notes\n\n<!-- /master -->\n');
    fs.writeFileSync(path.join(draft,'People','mira.md'),'---\nid: mira\ntemplate: npc\nlocation: []\n---\n\n# Mira\n');
    fs.writeFileSync(path.join(draft,'Plot','event.md'),'---\nsession: 1\n---\n\nMira finds a bell.\n');
    const out=run(root,'check','--files','Objects/bell.md,People/mira.md,Plot/event.md','--base','draft');
    assert.equal(out.status,0,out.stderr); assert.match(out.stdout,/errors: 0/);
    assert.match(out.stdout,/checked Plot\/event.md/);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
