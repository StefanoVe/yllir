// Deterministic item sheet and plot metadata checks. Candidate names require
// agent judgment; this module never decides that every capitalized word is an item.
import fs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter } from '../../../../../scripts/lib/frontmatter.mjs';
import { analyzeMarkdown } from '../../../../../scripts/lib/zones.mjs';
import { foldForm } from '../../../../../scripts/lib/fold.mjs';
import { readStructure, listSheets, buildSubjectIndex, compareStrings } from '../../../../../scripts/lib/subjects.mjs';
import { parseYamlLite } from '../../../../../scripts/lib/yaml-lite.mjs';

const PLACEHOLDER = /(?:\b(?:TODO|TBD|PLACEHOLDER|to be defined|Da definire)\b|<(?![!]--)[^>]+>)/iu;

export function findItems(root, name) {
  const query = foldForm(name);
  const index = buildSubjectIndex(root);
  const matches = [];
  for (const s of index.subjects) for (const form of s.forms) {
    if (form.folded === query || (query && (form.folded.includes(query) || query.includes(form.folded)))) {
      const candidate={ id: s.id, sheet: s.sheet, form: form.text, kind: form.kind, match: form.folded === query ? 'exact' : 'partial' };
      const current=matches.find(x=>x.id===s.id);
      if (!current) matches.push(candidate);
      else if (candidate.match==='exact' && current.match!=='exact') Object.assign(current,candidate);
    }
  }
  return { matches: matches.sort((a,b) => (a.match === b.match ? compareStrings(a.id,b.id) : a.match === 'exact' ? -1 : 1)), errors: index.errors };
}

export function makeDraft(root, { name, location = '', details = '', requestedBy = [] }) {
  if (typeof name !== 'string' || !name.trim() || /[\u0000-\u001f\u007f]/u.test(name)) return { status:'FAILED', problems:['NAME must be nonempty and contain no control characters'] };
  const { structure, errors } = readStructure(root);
  if (!structure) return { status: 'FAILED', problems: errors.map(x => `campaign-config ${x.message}`) };
  const category = structure.find(x => x.type === 'objects');
  if (!category || typeof category.folder !== 'string') return { status: 'NOT_AVAILABLE', problems: ['No category of type objects is configured.'] };
  const found = findItems(root, name);
  if (found.errors.length) return { status: 'FAILED', problems: found.errors.map(x => `${x.file}: ${x.message}`) };
  const exact = found.matches.filter(x => x.match === 'exact');
  if (exact.length === 1 && isItemSheet(root,buildSubjectIndex(root).subjects.find(s=>s.id===exact[0].id)?.sheet)) return { status: 'EXISTS', exists: exact[0].id, matches: found.matches };
  if (exact.length > 0 || found.matches.some(x => x.match === 'partial')) {
    const question=found.matches.length===1 ? `Is ${name} the same as ${found.matches[0].form} (${found.matches[0].id})?` : `Which existing subject, if any, is ${name}?`;
    return { status: 'ASK', matches: found.matches, question };
  }
  const lang = mainLanguage(root);
  if (!lang) return { status:'FAILED', problems:['campaign.yaml language.main is required'] };
  const id = slug(name);
  if (!id) return { status:'FAILED', problems:['NAME cannot produce a safe subject id'] };
  const ids = new Set(buildSubjectIndex(root).subjects.map(x => x.id));
  const pendingFolder=`.campaign/state/write/draft/${category.folder.replace(/^\/+|\/+$/g,'')}`;
  for(const pending of listSheets(root,pendingFolder)) {
    try { const p=parseFrontmatter(fs.readFileSync(path.join(root,pending),'utf8')); if(p.data?.id) ids.add(String(p.data.id)); } catch {}
  }
  if (ids.has(id)) return { status: 'ASK', question: `The safe ID ${id} is already used by another subject or pending draft.` };
  const file = `${category.folder.replace(/\/$/, '')}/${id}.md`;
  if (fs.existsSync(path.join(root,file)) || fs.existsSync(path.join(root,'.campaign/state/write/draft',file))) return { status:'ASK', question:`The proposed sheet path already exists: ${file}` };
  const locations=location.trim()?location.split(',').map(x=>x.trim()):[];
  if (locations.some(x=>! /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(x))) return { status:'ASK', question:'LOCATION must contain comma-separated place ids or be empty.' };
  for(const placeId of locations){
    const place = buildSubjectIndex(root).subjects.find(s => s.id === placeId);
    if (!place || place.type !== 'places') return { status: 'ASK', question: `Location ${placeId} does not resolve to an existing place id.` };
  }
  const loc = locations.length ? `[${locations.join(', ')}]` : '[]';
  const extra = details.trim() ? `\n${details.trim()}\n` : '\n';
  const headings = lang === 'en' ? ['In brief','Description','Effects','Master','Master notes'] : ['In breve','Descrizione','Effetti','Master','Indicazioni per il master'];
  return { status: 'DRAFT', id, file, requestedBy, content: `---\nid: ${id}\ntemplate: item\nlocation: ${loc}\n---\n\n# ${name.trim()}\n\n## ${headings[0]}\n\n[Write a concise public summary.]\n\n## ${headings[1]}\n\n[Write the full public description.]${extra}\n## ${headings[2]}\n\n[Use the system adapter format, or state no game effect.]\n\n<!-- master -->\n## ${headings[3]}\n\n### ${headings[4]}\n\n<!-- /master -->\n` };
}

export function checkItemSheets(root, { files = null, base = null } = {}) {
  const { structure, errors: cfg } = readStructure(root);
  if (!structure) return { checked: [], errors: cfg.map(e => ({ code: 'campaign-config', file: e.file, message: e.message })) };
  const cats = structure.filter(x => x.type === 'objects' && typeof x.folder === 'string');
  const wanted = files?.length ? new Set(files) : null;
  const errors = [], warnings = [], checked = [];
  const scan = wanted === null ? cats.flatMap(c=>listSheets(root,c.folder)) : [...wanted];
  for (const file of scan) {
    if (base === null && wanted !== null && !cats.some(c=>file.startsWith(`${c.folder.replace(/\/$/,'')}/`))) continue;
    checked.push(file);
    let text;
    const target=path.resolve(root,base ?? '.',file);
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) { errors.push({code:'unsafe-path',file,message:'path escapes campaign root'}); continue; }
    try { text = fs.readFileSync(target, 'utf8'); } catch { errors.push({ code:'unreadable',file,message:'cannot read sheet' }); continue; }
    const parsed = parseFrontmatter(text);
    if (!parsed.data || parsed.errors.length) { errors.push({ code:'frontmatter',file,message:parsed.errors[0] ? `line ${parsed.errors[0].line}: ${parsed.errors[0].message}` : 'invalid or missing frontmatter' }); continue; }
    if (parsed.data.template !== 'item') {
      if (base !== null || parsed.data.template === 'notice') continue;
      errors.push({ code:'template',file,message:'template must be item' }); continue;
    }
    if (typeof parsed.data.id !== 'string' || !parsed.data.id) errors.push({ code:'id',file,message:'id is required' });
    if (!Array.isArray(parsed.data.location)) errors.push({ code:'location',file,message:'location must be a list of place ids (or [])' });
    const analysis = analyzeMarkdown(parsed.body, parsed.bodyStartLine);
    const lines = analysis.lines;
    for (const error of analysis.errors) errors.push({code:'markdown',file,message:`line ${error.line}: ${error.message}`});
    const headings = lines.filter(x => x.block === 'heading' && x.level === 2 && !x.inMaster).map(x => x.headingText);
    if (lines.filter(x => x.block === 'heading' && x.level === 1 && !x.inMaster).length !== 1) errors.push({code:'title',file,message:'exactly one public level-1 title is required'});
    const lang=mainLanguage(root), supported=['it','en'].includes(lang);
    if (!supported) warnings.push({code:'section-language',file,message:`required section validation unavailable for language ${lang}`});
    const brief = lang === 'en' ? 'In brief' : 'In breve';
    const description=lang==='en'?'Description':'Descrizione', effects=lang==='en'?'Effects':'Effetti';
    if (supported) {
      if (!headings.includes(brief)) errors.push({code:'legacy-brief',file,message:'missing brief section (upgrade required; never auto-edit)'});
      const ordered = [brief, description, effects];
      let pos = -1;
      for (const h of ordered) { const at = headings.indexOf(h); if (at <= pos) errors.push({code:'section-order',file,message:`required section is out of order: ${h}`}); pos = at; }
      for (const h of [...ordered,...(lang==='it'?['Origine','Ritrovamento','Testo','Valore']:['Origin','Finding','Text','Value'])]) if (headings.filter(x=>x===h).length>1) errors.push({code:'section-duplicate',file,message:`section appears more than once: ${h}`});
      if (!headings.includes(description)) errors.push({code:'section',file,message:`required section missing: ${description}`});
      if (!headings.includes(effects)) errors.push({code:'section',file,message:`required section missing: ${effects}`});
      const optional = lang==='it' ? ['Origine','Ritrovamento','Testo','Valore'] : ['Origin','Finding','Text','Value'];
      const positions=optional.filter(h=>headings.includes(h)).map(h=>headings.indexOf(h));
      if (positions.some((n,i)=>n<headings.indexOf(effects) || (i>0 && n<=positions[i-1]))) errors.push({code:'optional-order',file,message:'optional sections must follow Effects in the defined order'});
    }
    for (const h of (supported?[brief,description,effects]:[])) {
      const at=lines.findIndex(x=>x.block==='heading' && !x.inMaster && x.headingText===h);
      const next=lines.findIndex((x,i)=>i>at && x.block==='heading' && x.level<=2);
      if (at>=0 && !lines.slice(at+1,next<0?lines.length:next).some(x=>x.text.trim() && !x.inMaster)) errors.push({code:'empty-section',file,message:`required section has no content: ${h}`});
    }
    const masterOpens = (text.match(/<!-- master -->/g) || []).length;
    const masterCloses = (text.match(/<!-- \/master -->/g) || []).length;
    if (masterOpens !== 1 || masterCloses !== 1 || text.indexOf('<!-- master -->') > text.indexOf('<!-- /master -->') || !text.trimEnd().endsWith('<!-- /master -->')) errors.push({code:'master-block',file,message:'one complete master block must be the unique final content'});
    const masterHeadings = lines.filter(x => x.block === 'heading' && x.inMaster);
    const masterHeadingIndex = masterHeadings.findIndex(x => x.level === 2 && x.headingText === 'Master');
    if (masterHeadingIndex < 0 || !masterHeadings.slice(masterHeadingIndex + 1).some(x => x.level === 3)) errors.push({code:'master-heading',file,message:'master block must contain ## Master followed by at least one ### notes heading'});
    if (PLACEHOLDER.test(parsed.body)) errors.push({code:'placeholder',file,message:'unresolved placeholder remains'});
    const knownPlaces = new Set(buildSubjectIndex(root).subjects.filter(x => x.type === 'places').map(x => x.id));
    if (Array.isArray(parsed.data.location)) for (const id of parsed.data.location) if (!knownPlaces.has(String(id))) errors.push({code:'location-missing',file,message:`location does not resolve to a place: ${id}`});
    for (const image of text.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) if (!fs.existsSync(path.resolve(path.dirname(path.join(root,file)), image[1]))) errors.push({code:'image-missing',file,message:`image path does not exist: ${image[1]}`});
  }
  errors.sort((a,b) => compareStrings(a.file,b.file) || compareStrings(a.code,b.code));
  return { checked, errors, warnings };
}

export function plotItems(root, { files = null } = {}) {
  const { structure, errors: cfg } = readStructure(root);
  if (!structure) return { events:0, declared:0, errors:cfg.map(e=>({code:'campaign-config',file:e.file,message:e.message})), candidates:[] };
  const index = buildSubjectIndex(root), byId = new Map(index.subjects.filter(s=>isItemSheet(root,s.sheet)).map(s=>[s.id,s]));
  const wanted = files?.length ? new Set(files) : null, errors=[], candidates=[], seen=new Set(); let events=0, declared=0;
  let exclusions=[];
  try { const c=parseYamlLite(fs.readFileSync(path.join(root,'campaign.yaml'),'utf8')).data; exclusions=c?.audit?.exclusions ?? []; } catch { exclusions=[]; }
  if (!Array.isArray(exclusions) || exclusions.some(e=>!e || typeof e!=='object' || typeof e.subject!=='string' || typeof e.attribute!=='string')) {
    errors.push({code:'campaign-config',file:'campaign.yaml',message:'audit.exclusions must be a list of entries with subject and attribute'});
    return {events:0,declared:0,errors,candidates:[]};
  }
  for (const c of structure.filter(x=>x.type==='plot' && typeof x.folder==='string')) for (const file of listSheets(root,c.folder)) {
    if (wanted && !wanted.has(file)) continue;
    const text = fs.readFileSync(path.join(root,file),'utf8'), p=parseFrontmatter(text);
    if (!p.data || typeof p.data.session !== 'string') continue;
    events++;
    const excluded = new Set(exclusions.filter(e=>e && e.attribute==='plot.items').map(e=>String(e.subject)));
    if (Object.hasOwn(p.data,'items')) {
      if (!Array.isArray(p.data.items)) errors.push({code:'invalid-items',file,message:'items must be a list of item ids'});
      else { const seenIds=new Set(); for (const raw of p.data.items) { const id=String(raw); declared++;
        if (excluded.has(id)) continue;
        if (seenIds.has(id)) errors.push({code:'item-duplicate',file,message:`item ${id} is listed more than once`}); seenIds.add(id);
        const s=byId.get(id); if (!s) errors.push({code:'item-no-sheet',file,message:`no sheet for item ${id}`}); else if(s.type!=='objects') errors.push({code:'item-not-object',file,message:`${id} is not an item sheet`});
      }}
    }
    const lines=analyzeMarkdown(p.body,p.bodyStartLine).lines;
    for(const line of lines){ if(!['paragraph','list','table','quote','heading'].includes(line.block) || line.text.trim()==='') continue;
      const key=`${file}:${line.line}`; if(seen.has(key)) continue; seen.add(key);
      if(line.inMaster) candidates.push({file,line:line.line,master:true});
      else candidates.push({file,line:line.line,text:line.text.trim(),master:false});
    }
  }
  errors.sort((a,b)=>compareStrings(a.file,b.file)||compareStrings(a.code,b.code)); candidates.sort((a,b)=>compareStrings(a.file,b.file)||a.line-b.line||compareStrings(a.text,b.text));
  return {events,declared,errors,candidates};
}

function slug(value) { return foldForm(value).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''); }
function mainLanguage(root) { try { const d=parseYamlLite(fs.readFileSync(path.join(root,'campaign.yaml'),'utf8')).data; return d?.language?.main; } catch { return null; } }
function isItemSheet(root, sheet) { try { const p=parseFrontmatter(fs.readFileSync(path.join(root,sheet),'utf8')); return p.data?.template==='item'; } catch { return false; } }
