import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { parseHTML } from 'linkedom';

// A real DOM implementation plus an explicit public-API mock. This is NOT an Obsidian host.
function harness(saved=null, initial={'source.md':'a'.repeat(100)+'The result is 42.'+'z'.repeat(100)}) {
  const {document,window}=parseHTML('<html><body></body></html>');
  const proto=window.HTMLElement.prototype;
  Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this.querySelector('option[selected]')?.getAttribute('value')??this.querySelector('option')?.getAttribute('value')??'';},set(value){for(const option of this.querySelectorAll('option')){if(option.getAttribute('value')===value)option.setAttribute('selected','');else option.removeAttribute('selected');}}});
  proto.empty=function(){this.replaceChildren();};proto.addClass=function(...c){this.classList.add(...c);};proto.setText=function(t){this.textContent=t;};
  proto.createEl=function(tag,options={}){const el=document.createElement(tag);if(options.text!==undefined)el.textContent=options.text;if(options.cls)el.className=options.cls;if(options.value)el.value=options.value;for(const [k,v]of Object.entries(options.attr??{}))el.setAttribute(k,v);this.appendChild(el);return el;};
  proto.createDiv=function(o={}){return this.createEl('div',o);};proto.createSpan=function(o={}){return this.createEl('span',o);};
  class TFile{constructor(path,text){this.path=path;this.stat={size:Buffer.byteLength(text)};}}
  const files=new Map(Object.entries(initial).map(([p,t])=>[p,{file:new TFile(p,t),text:t}]));const handlers=new Map();const notices=[],saves=[],modals=[];let active='source.md';const leaves=[];const views=new Map();
  const app={vault:{getName:()=> 'Synthetic demo',getFiles:()=>[...files.values()].map(x=>x.file),getAbstractFileByPath:p=>files.get(p)?.file??null,read:async f=>{if(!files.has(f.path))throw Error('missing');return files.get(f.path).text;},on:(e,fn)=>{const list=handlers.get(e)??[];list.push(fn);handlers.set(e,list);return{e,fn};}},workspace:{getLeavesOfType:type=>leaves.filter(x=>x.type===type),getRightLeaf:()=>newLeaf(),revealLeaf:async()=>{},onLayoutReady:fn=>{app.layout=fn;},getActiveFile:()=>files.get(active)?.file??null,getLeaf:()=>({openFile:async f=>{active=f.path;}}),getActiveViewOfType:()=>null}};
  function newLeaf(){const leaf={type:null,view:null,setViewState:async({type})=>{leaf.type=type;leaf.view=views.get(type)(leaf);leaves.push(leaf);await leaf.view.onOpen();}};return leaf;}
  class Plugin{constructor(){this.app=app;this.commands=[];}async loadData(){return structuredClone(saved);}async saveData(data){saves.push(structuredClone(data));}registerView(t,fn){views.set(t,fn);}addStatusBarItem(){return document.body.createDiv();}addRibbonIcon(){}addCommand(c){this.commands.push(c);}registerObsidianProtocolHandler(){}registerEvent(){}register(){} }
  class ItemView{constructor(leaf){this.leaf=leaf;this.contentEl=document.body.createDiv();}}
  class Modal{constructor(){this.contentEl=document.body.createDiv();modals.push(this);}open(){this.onOpen();}close(){this.onClose();}}
  class Notice{constructor(text){notices.push(text);}}
  const sandbox={module:{exports:{}},exports:{},require:name=>{if(name==='obsidian')return{Plugin,ItemView,Modal,Notice,TFile,MarkdownView:class{}};throw Error(`Unexpected external module ${name}`);},crypto:webcrypto,TextEncoder,structuredClone,setTimeout,clearTimeout,console,navigator:{clipboard:{writeText:async()=>{}}}};
  sandbox.exports=sandbox.module.exports;vm.createContext(sandbox);
  return {files,handlers,notices,saves,modals,document,app,sandbox,emit:(e,...a)=>{for(const fn of handlers.get(e)??[])fn(...a);},setActive:p=>{active=p;}};
}
async function loaded(saved,files){const h=harness(saved,files);vm.runInContext(await readFile('main.js','utf8'),h.sandbox);h.plugin=new h.sandbox.module.exports.default();await h.plugin.onload();return h;}
function editorFor(text,selection='The result is 42.') {return{getValue:()=>text,getSelection:()=>selection,getCursor:()=>({line:0,ch:text.indexOf(selection)}),posToOffset:pos=>pos.ch};}
async function captured(){const h=await loaded();const file=h.files.get('source.md');await h.plugin.captureSelection(editorFor(file.text),{file:file.file});return h;}

test('compiled plugin registers commands and renders an in-app panel through public API mocks',async()=>{
  const h=await captured();try{
    assert.equal(h.plugin.commands.length,3);assert.equal(h.plugin.store.anchors.length,1);assert.match(h.document.body.textContent,/Evidence anchors/);assert.match(h.document.body.textContent,/verified/);assert.ok(h.saves.length>0);
    assert.equal(h.plugin.assessments.get(h.plugin.store.anchors[0].id).status,'verified');
  }finally{h.plugin.onunload();}
});
test('unsaved editor and PDF capture refuse without modifying notes or store',async()=>{
  const h=await loaded();try{
    const file=h.files.get('source.md');await h.plugin.captureSelection(editorFor(file.text+'unsaved'),{file:file.file});
    await h.plugin.captureSelection(editorFor('pdf'),{file:{path:'paper.pdf'}});
    assert.equal(h.plugin.store.anchors.length,0);assert.equal(h.saves.length,0);assert.ok(h.notices.some(n=>n.includes('Save the note')));assert.ok(h.notices.some(n=>n.includes('PDF')));
  }finally{h.plugin.onunload();}
});
test('rename event preserves anchor identity; source modification never silently revalidates',async()=>{
  const h=await captured();try{
    const id=h.plugin.store.anchors[0].id;const entry=h.files.get('source.md');h.files.delete('source.md');entry.file.path='renamed.md';h.files.set('renamed.md',entry);h.emit('rename',entry.file,'source.md');await h.plugin.scan();
    assert.equal(h.plugin.store.anchors[0].id,id);assert.equal(h.plugin.store.anchors[0].sourcePath,'renamed.md');assert.equal(h.plugin.assessments.get(id).status,'verified');
    entry.text+=' changed outside quote context';entry.file.stat.size=Buffer.byteLength(entry.text);h.emit('modify',entry.file);assert.equal(h.plugin.assessments.get(id).status,'unavailable');await h.plugin.scan();
    assert.equal(h.plugin.assessments.get(id).status,'stale');assert.equal(h.plugin.store.anchors[0].revisions.length,1);
    await h.plugin.verify(id);assert.equal(h.plugin.assessments.get(id).status,'verified');assert.equal(h.plugin.store.anchors[0].revisions.length,2);
  }finally{h.plugin.onunload();}
});
test('fresh read prevents revalidation against a source changed after the displayed check',async()=>{
  const h=await captured();try{
    const id=h.plugin.store.anchors[0].id,entry=h.files.get('source.md');entry.text+='one';await h.plugin.scan();assert.equal(h.plugin.assessments.get(id).canRevalidate,true);
    entry.text+='two';await h.plugin.verify(id);assert.equal(h.plugin.store.anchors[0].revisions.length,1);assert.ok(h.notices.some(n=>n.includes('changed since')));
  }finally{h.plugin.onunload();}
});
test('bad persisted data locks writes instead of silently discarding the original',async()=>{
  const h=await loaded({schema:9,anchors:[]});try{
    assert.equal(h.plugin.locked,true);h.emit('rename',{path:'new.md'},'source.md');await h.plugin.persist();assert.equal(h.saves.length,0);assert.match(h.document.body.textContent,/storage locked/i);
  }finally{h.plugin.onunload();}
});
test('delete with identical copies gives ambiguous state and disabled revalidation button',async()=>{
  const h=await captured();try{
    const source=h.files.get('source.md'),id=h.plugin.store.anchors[0].id;h.files.delete('source.md');
    for(const path of ['copy1.md','copy2.md']){const file=new source.file.constructor(path,source.text);h.files.set(path,{file,text:source.text});}
    h.emit('delete',source.file);await h.plugin.scan();assert.equal(h.plugin.assessments.get(id).status,'ambiguous');
    const button=[...h.document.querySelectorAll('button')].find(b=>b.textContent==='Revalidate exact match');assert.equal(button.disabled,true);
  }finally{h.plugin.onunload();}
});
test('quotes are rendered as text, never interpreted as HTML',async()=>{
  const text='<img src=x onerror="attack()">';const h=await loaded(null,{'source.md':text});try{
    await h.plugin.captureSelection(editorFor(text,text),{file:h.files.get('source.md').file});assert.equal(h.document.querySelector('img'),null);assert.ok(h.document.body.textContent.includes(text));
  }finally{h.plugin.onunload();}
});
test('oversized/unreadable source yields unavailable with explicit partial scan, not missing',async()=>{
  const h=await captured();try{
    const id=h.plugin.store.anchors[0].id;h.files.get('source.md').file.stat.size=3*1024*1024;await h.plugin.scan();
    assert.equal(h.plugin.assessments.get(id).status,'unavailable');assert.match(h.plugin.scanSummary,/Partial coverage/);
  }finally{h.plugin.onunload();}
});
test('source reassociation requires modal confirmation, records the choice and never edits source notes',async()=>{
  const h=await captured();try{
    const original=h.files.get('source.md'),id=h.plugin.store.anchors[0].id;
    const copy=new original.file.constructor('chosen.md',original.text);h.files.set(copy.path,{file:copy,text:original.text});h.setActive(copy.path);
    h.plugin.chooseActive(id);const modal=h.modals.at(-1);
    assert.match(modal.contentEl.textContent,/explicit source choice/);assert.equal(h.plugin.store.anchors[0].sourcePath,'source.md');
    await [...modal.contentEl.querySelectorAll('button')].find(b=>b.textContent==='Confirm chosen source').onclick();
    assert.equal(h.plugin.store.anchors[0].sourcePath,'chosen.md');assert.equal(h.plugin.store.anchors[0].revisions.at(-1).action,'rebind');
    assert.equal(h.files.get('source.md').text,original.text);assert.equal(h.files.get('chosen.md').text,original.text);
  }finally{h.plugin.onunload();}
});
test('explicit source choice enforces file-size bounds even outside a scan',async()=>{
  const h=await captured();try{
    const id=h.plugin.store.anchors[0].id,entry=h.files.get('source.md');entry.file.stat.size=3*1024*1024;
    await h.plugin.bindToFile(id,entry.file);assert.equal(h.plugin.store.anchors[0].revisions.length,1);assert.ok(h.notices.some(n=>n.includes('2 MiB')));
    entry.file.stat.size=1;entry.text='x'.repeat(2*1024*1024+1);
    await h.plugin.bindToFile(id,entry.file);assert.equal(h.plugin.store.anchors[0].revisions.length,1);
  }finally{h.plugin.onunload();}
});
