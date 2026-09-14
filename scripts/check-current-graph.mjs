import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {getComponentSemanticsContract} from '@aikdna/kdna-core/components';
const require=createRequire(import.meta.url),read=rel=>JSON.parse(readFileSync(new URL('../'+rel,import.meta.url)));
const pkg=read('package.json'),lock=read('package-lock.json'),binding=read('docs/current-core-read-binding.json');
assert.equal(pkg.version,binding.package.version);assert.equal(pkg.name,binding.package.name);assert.equal(lock.version,pkg.version);
assert.deepEqual(lock.packages[''].devDependencies,pkg.devDependencies);assert.deepEqual(lock.packages[''].peerDependencies,pkg.peerDependencies);
assert.equal(getComponentSemanticsContract().definition_digest,binding.definition_digest);
for(const a of binding.packages){
 const bytes=readFileSync(new URL('../vendor/'+a.file,import.meta.url)),r=lock.packages['node_modules/'+a.name];
 assert.equal(bytes.length,a.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),a.sha256);assert.equal('sha512-'+createHash('sha512').update(bytes).digest('base64'),a.integrity);
 // An entry may be sourced from the registry instead of the vendored archive, but only as one exact
 // version whose tarball URL is the canonical registry URL for that version; the byte assertions above
 // and the lock integrity below are unchanged, so the installed bytes are still pinned to a.version.
 const canonical='https://registry.npmjs.org/'+a.name+'/-/'+a.name.replace(/^@[^/]+\//u,'')+'-'+a.version+'.tgz';
 const registry=a.source==='registry';
 assert.equal(pkg.devDependencies[a.name],registry?a.version:'file:vendor/'+a.file);
 assert.equal(r.resolved,registry?canonical:'file:vendor/'+a.file);assert.equal(r.integrity,a.integrity);assert.equal(r.version,a.version);
 assert.equal(read('node_modules/'+a.name+'/package.json').version,a.version);
}
assert.deepEqual(pkg.peerDependencies,Object.fromEntries(binding.packages.slice(0,2).map(a=>[a.name,a.version])));
assert.deepEqual(Object.keys(pkg.exports),['.']);assert.deepEqual(Object.keys(require('../src/client.cjs')).sort(),['createKDNAWebClient','releaseKDNASelection','selectKDNA']);
console.log('Source vendor, lock, installed public package versions, component descriptor and public API match.');
