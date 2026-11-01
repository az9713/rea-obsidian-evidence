import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
await mkdir('releases', { recursive: true });
function crc32(bytes) { let c = 0xffffffff; for (const b of bytes) { c ^= b; for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return (c ^ 0xffffffff) >>> 0; }
async function zip(entries, out) {
  const chunks = [], directory = []; let offset = 0;
  for (const [name, file] of entries) {
    if (name.includes('..') || name.startsWith('/') || name.includes('\\')) throw Error('Unsafe ZIP entry');
    const data = await readFile(file), encoded = Buffer.from(name, 'utf8'), crc = crc32(data);
    const local = Buffer.alloc(30);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt16LE(33,12);local.writeUInt32LE(crc,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(encoded.length,26);
    chunks.push(local,encoded,data);
    const central = Buffer.alloc(46);central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x800,8);central.writeUInt16LE(33,14);central.writeUInt32LE(crc,16);central.writeUInt32LE(data.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(encoded.length,28);central.writeUInt32LE(offset,42);directory.push(central,encoded);offset += local.length+encoded.length+data.length;
  }
  const centralSize=directory.reduce((n,b)=>n+b.length,0), end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(centralSize,12);end.writeUInt32LE(offset,16);
  await writeFile(out,Buffer.concat([...chunks,...directory,end]));
}
const plugin = ['main.js','manifest.json','styles.css','LICENSE','README.md','THIRD_PARTY_NOTICES.md'].map(n=>[`evidence-anchor/${n}`,n]);
plugin.push(['evidence-anchor/INSTALL.html','docs/README.html'], ['evidence-anchor/site.css','docs/site.css'], ['evidence-anchor/verification.json','docs/verification.json']);
const pluginZip=`releases/evidence-anchor-${manifest.version}.zip`;await zip(plugin,pluginZip);
const vault=[];
async function walk(base,dir){for(const e of await readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isSymbolicLink())continue;if(e.isDirectory())await walk(base,p);else if(e.isFile())vault.push([`evidence-anchor-demo/${path.relative(base,p).replaceAll('\\','/')}`,p]);}}
await walk('fixtures/demo-vault','fixtures/demo-vault');
const vaultZip=`releases/evidence-anchor-demo-vault-${manifest.version}.zip`;await zip(vault,vaultZip);
await writeFile('releases/SHA256SUMS.txt',(await Promise.all([pluginZip,vaultZip].map(async f=>`${createHash('sha256').update(await readFile(f)).digest('hex')}  ${path.basename(f)}`))).join('\n')+'\n');
await writeFile('releases/verification.json',await readFile('docs/verification.json'));
await writeFile('releases/browser-verification.json',await readFile('docs/browser-verification.json'));
console.log(`Created ${pluginZip} and ${vaultZip}; SHA256SUMS.txt written.`);
