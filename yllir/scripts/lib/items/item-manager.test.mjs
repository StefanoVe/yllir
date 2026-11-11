import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findItems, makeDraft, checkItemSheets, plotItems } from './item-manager.mjs';

function campaign(fn) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'yllir-item-'));
  fs.writeFileSync(path.join(root,'campaign.yaml'),'language:\n  main: en\nstructure:\n  - id: places\n    type: places\n    folder: Places\n  - id: people\n    type: subjects\n    folder: People\n  - id: things\n    type: objects\n    folder: Objects\n  - id: plot\n    type: plot\n    folder: Plot\n');
  for(const d of ['Places','People','Objects','Plot']) fs.mkdirSync(path.join(root,d));
  try { fn(root); } finally { fs.rmSync(root,{recursive:true,force:true}); }
}
const sheet=(id,template,title,rest='')=>`---\nid: ${id}\ntemplate: ${template}\nlocation: []\n---\n\n# ${title}\n${rest}`;

test('create checks cross-template title/alias ambiguity and safe IDs',()=>campaign(root=>{
  fs.writeFileSync(path.join(root,'People','person.md'),'---\nid: person\ntemplate: npc\nlocation: []\naliases: [Key of Silver]\n---\n\n# Silver Key\n');
  assert.equal(findItems(root,'Silver Key').matches[0].id,'person');
  assert.equal(makeDraft(root,{name:'Silver Key'}).status,'ASK');
  assert.match(makeDraft(root,{name:'Silver Key'}).question,/Is Silver Key the same as Silver Key \(person\)/);
  const draft=makeDraft(root,{name:'Old Bell',location:'',details:'A cracked brass bell.'});
  assert.equal(draft.status,'DRAFT'); assert.equal(draft.file,'Objects/old-bell.md');
  assert.match(draft.content,/template: item/); assert.ok(draft.content.endsWith('<!-- /master -->\n'));
  fs.writeFileSync(path.join(root,'Objects','lamp.md'),sheet('lamp','item','Lamp'));
  fs.writeFileSync(path.join(root,'Objects','lamp-copy.md'),sheet('lamp-copy','item','Lamp'));
  assert.equal(makeDraft(root,{name:'Lamp'}).status,'ASK','homonyms must never auto-select');
  fs.writeFileSync(path.join(root,'Objects','file-collision.md'),sheet('another','item','A Different Title'));
  assert.equal(makeDraft(root,{name:'File Collision'}).status,'ASK');
  assert.equal(makeDraft(root,{name:'Broken\n# Header'}).status,'FAILED');
  fs.mkdirSync(path.join(root,'.campaign','state','write','draft','Objects'),{recursive:true});
  fs.writeFileSync(path.join(root,'.campaign','state','write','draft','Objects','pending.md'),sheet('pending-item','item','Pending Item'));
  assert.equal(makeDraft(root,{name:'Pending Item'}).status,'ASK','pending drafts reserve IDs before write');
}));

test('checker catches legacy brief, malformed final block, placeholders and bad places',()=>campaign(root=>{
  const bad=sheet('old','item','Old Bell','\n## Description\nA bell.\n\n## Effects\nNone.\n\n<!-- master -->\n## Master\n\nTODO\n<!-- /master -->\n');
  fs.writeFileSync(path.join(root,'Objects','old.md'),bad.replace('location: []','location: [missing-place]'));
  const result=checkItemSheets(root);
  const codes=result.errors.map(x=>x.code);
  assert.ok(codes.includes('legacy-brief')); assert.ok(codes.includes('placeholder')); assert.ok(codes.includes('location-missing'));
}));

test('checker requires a master heading and notes heading inside the final master block',()=>campaign(root=>{
  const content='---\nid: item\ntemplate: item\nlocation: []\n---\n\n# Item\n\n## In brief\nA token.\n\n## Description\nA token.\n\n## Effects\nUnknown.\n\n<!-- master -->\n## Master\nPrivate notes.\n<!-- /master -->\n';
  fs.writeFileSync(path.join(root,'Objects','item.md'),content);
  assert.ok(checkItemSheets(root).errors.some(e=>e.code==='master-heading'));
}));

test('an exact alias takes precedence over a partial title on the same subject',()=>campaign(root=>{
  fs.writeFileSync(path.join(root,'Objects','alias.md'),'---\nid: alias-item\ntemplate: item\nlocation: []\naliases: [Silver Key]\n---\n\n# Silver Key Replica\n');
  const found=findItems(root,'Silver Key');
  assert.equal(found.matches.length,1); assert.equal(found.matches[0].match,'exact'); assert.equal(found.matches[0].kind,'alias');
}));

test('checker skips notices, catches malformed location safely, and validates draft base paths',()=>campaign(root=>{
  fs.writeFileSync(path.join(root,'Objects','notice.md'),sheet('notice','notice','Notice'));
  fs.writeFileSync(path.join(root,'Objects','bad.md'),sheet('bad','item','Bad','\n## Description\nA token.\n\n## Effects\nNone.\n\n<!-- master -->\n## Master\n\n<!-- /master -->\n').replace('location: []','location: {}'));
  fs.mkdirSync(path.join(root,'draft','Objects'),{recursive:true});
  fs.writeFileSync(path.join(root,'draft','Objects','item.md'),`---\nid: item\ntemplate: item\nlocation: []\n---\n\n# Item\n\n## In brief\nA small item.\n\n## Description\nA small item with a marked face.\n\n## Effects\nNo game effect.\n\n<!-- master -->\n## Master\n\n### Master notes\n\n<!-- /master -->\n`);
  const normal=checkItemSheets(root);
  assert.ok(!normal.errors.some(e=>e.file==='Objects/notice.md'));
  assert.ok(normal.errors.some(e=>e.file==='Objects/bad.md' && e.code==='location'));
  const draft=checkItemSheets(root,{files:['Objects/item.md'],base:'draft'});
  assert.deepEqual(draft.errors,[]);
  fs.mkdirSync(path.join(root,'draft','People'),{recursive:true}); fs.mkdirSync(path.join(root,'draft','Plot'),{recursive:true});
  fs.writeFileSync(path.join(root,'draft','People','npc.md'),sheet('npc','npc','NPC'));
  fs.writeFileSync(path.join(root,'draft','Plot','event.md'),sheet('event','event','Event'));
  const mixed=checkItemSheets(root,{files:['Objects/item.md','People/npc.md','Plot/event.md'],base:'draft'});
  assert.deepEqual(mixed.errors,[]);
  assert.equal(mixed.checked.length,3);
}));

test('Italian required sections pass and bad image paths are reported',()=>campaign(root=>{
  const c=path.join(root,'campaign.yaml'); fs.writeFileSync(c,fs.readFileSync(c,'utf8').replace('main: en','main: it'));
  fs.mkdirSync(path.join(root,'Objects','img'));
  fs.writeFileSync(path.join(root,'Objects','img','ok.png'),'x');
  const content='---\nid: spilla\ntemplate: item\nlocation: []\n---\n\n# Spilla\n\n## In breve\nUna spilla.\n\n## Descrizione\nUna spilla d’argento. ![dettaglio](img/ok.png)\n\n## Effetti\nNessun effetto.\n\n<!-- master -->\n## Master\n\n### Indicazioni per il master\n\n<!-- /master -->\n';
  fs.writeFileSync(path.join(root,'Objects','spilla.md'),content);
  assert.deepEqual(checkItemSheets(root).errors,[]);
  fs.writeFileSync(path.join(root,'Objects','spilla.md'),content.replace('img/ok.png','img/missing.png'));
  assert.ok(checkItemSheets(root).errors.some(e=>e.code==='image-missing'));
}));

test('plot-items validates declared ids and returns prose candidates outside master notes',()=>campaign(root=>{
  fs.writeFileSync(path.join(root,'Objects','lamp.md'),sheet('lamp','item','Lamp'));
  fs.writeFileSync(path.join(root,'People','mira.md'),sheet('mira','npc','Mira'));
  fs.writeFileSync(path.join(root,'Plot','event.md'),'---\nsession: 1\nitems: [lamp, missing]\n---\n\nMira lifts the lantern carefully.\n\n<!-- master -->\nThe secret key is hidden inside.\n<!-- /master -->\n');
  const result=plotItems(root);
  assert.equal(result.declared,2); assert.ok(result.errors.some(e=>e.code==='item-no-sheet'));
  assert.ok(result.candidates.some(c=>c.text.includes('lantern')));
  assert.ok(result.candidates.some(c=>c.text.includes('Mira lifts the lantern')),'a known character must not mask an untracked item on the same line');
  assert.ok(result.candidates.every(c=>!c.text?.includes('secret')));
  assert.ok(result.candidates.some(c=>c.master && c.line > 0));
}));

test('excluded declared id does not hide another item on the same plot line',()=>campaign(root=>{
  fs.writeFileSync(path.join(root,'campaign.yaml'),fs.readFileSync(path.join(root,'campaign.yaml'),'utf8')+'audit:\n  exclusions:\n    - subject: lamp\n      attribute: plot.items\n      values: [known] \n      reason: explicitly excluded\n      date: 2026-11-10\n');
  fs.writeFileSync(path.join(root,'Objects','lamp.md'),sheet('lamp','item','Lamp'));
  fs.writeFileSync(path.join(root,'Plot','event.md'),'---\nsession: 1\nitems: [lamp]\n---\n\nMira carries the lamp and finds a nameless key.\n');
  const result=plotItems(root);
  assert.equal(result.errors.length,0);
  assert.ok(result.candidates.some(c=>c.text?.includes('nameless key')));
}));

test('plot scan checks tables and quotes, sanitizes master candidates, and rejects malformed exclusions',()=>campaign(root=>{
  fs.writeFileSync(path.join(root,'Plot','event.md'),'---\nsession: 1\n---\n\n| Item | Note |\n| --- | --- |\n| Silver key | tarnished |\n\n> A brass token was left here.\n\n<!-- master -->\nThe hidden name is Black Star.\n<!-- /master -->\n');
  const result=plotItems(root);
  assert.ok(result.candidates.some(c=>c.text?.includes('Silver key')));
  assert.ok(result.candidates.some(c=>c.text?.includes('brass token')));
  assert.ok(result.candidates.some(c=>c.master && c.text===undefined));
  fs.writeFileSync(path.join(root,'campaign.yaml'),fs.readFileSync(path.join(root,'campaign.yaml'),'utf8')+'audit:\n  exclusions: malformed\n');
  const broken=plotItems(root);
  assert.equal(broken.errors[0].code,'campaign-config');
}));
