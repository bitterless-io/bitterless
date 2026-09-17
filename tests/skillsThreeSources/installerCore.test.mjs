import test from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { createRequire, Module } from 'node:module'
import { fileURLToPath } from 'node:url'
import * as childProcess from 'node:child_process'
const here = dirname(fileURLToPath(import.meta.url))
const dependencyRoot = join(here, '../..')
const require = createRequire(join(dependencyRoot, 'package.json'))
const ts = require('typescript'), AdmZip = require('adm-zip'), tar = require('tar')
function load(file, overrides = {}) {
  const path = join(dependencyRoot, 'src/main/maestro/skills', file), mod = new Module(path)
  mod.filename = path; mod.paths = [join(dependencyRoot, 'node_modules')]
  mod.require = name => name in overrides ? overrides[name] : require(name)
  return fs.readFile(path, 'utf8').then(source => { mod._compile(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, path); return mod.exports })
}
const { SkillInstaller, SkillInstallError, parseSkillInstallInput } = await load('skillInstaller.ts')
const skill = (name, text='Fixture') => `---\nname: ${name}\ndescription: Fixture standard skill\n---\n${text}\n`
const sha1 = '1'.repeat(40), sha2 = '2'.repeat(40)
function zip(files) { const archive = new AdmZip(); for (const [path, text] of Object.entries(files)) archive.addFile('repo/' + path, Buffer.from(text)); return archive.toBuffer() }
const fixtures = {
  'package.json': JSON.stringify({ name:'fixture-package', pi:{ skills:['skills/**'] }, dependencies:{ test:'1' } }),
  'skills/a/SKILL.md': skill('alpha'), 'skills/a/scripts/run.ts': 'import "../../../lib/support.js"',
  'skills/b/SKILL.md': skill('beta'), 'lib/support.js':'export const value = 1', 'assets/picture.bin': Buffer.from([0, 1, 2])
}
function fixtureFetch(initial=fixtures) {
  let files=initial, commit=sha1, calls=0
  return {
    fetch: async (input, init) => {
      assert.equal(init.redirect, 'manual'); calls++
      const url = String(input)
      if (url === 'https://api.github.com/repos/owner/repo') return Response.json({default_branch:'main'})
      if (url.includes('/commits/')) return Response.json({sha:commit})
      if (url.includes('/zipball/')) return new Response(zip(files))
      return new Response('',{status:404})
    },
    set(next, sha=sha2) { files=next; commit=sha }, get calls(){return calls}
  }
}
async function setup(t, extras={}) {
  const base=await fs.mkdtemp(join(tmpdir(),'skill-core-')); t.after(()=>fs.rm(base,{recursive:true,force:true}))
  const network=fixtureFetch(), options={authoringRoot:join(base,'skills'),stateRoot:join(base,'state'),fetch:network.fetch,...extras}
  return {base,network,options,core:new SkillInstaller(options)}
}
async function rejection(promise,code) { await assert.rejects(promise,e=>{assert.equal(e.code,code,e.stack);return true}) }

test('known CLI syntax parses without executing it; scope and unknown shell semantics are explicit',()=>{
  for(const input of ['npx skills add owner/repo --skill alpha --agent codex --copy -y','bunx --bun skills@1.6.0 add owner/repo -s alpha','yarn dlx skills add owner/repo -s alpha']) {
    const parsed=parseSkillInstallInput(input); assert.equal(parsed.input.source,'owner/repo'); assert.deepEqual(parsed.input.skills,['alpha'])
  }
  assert.equal(parseSkillInstallInput('npx -y skills add owner/repo --global').requestedScope,'shared')
  assert.equal(parseSkillInstallInput('bun x skills add owner/repo --list').listOnly,true)
  for(const input of ['npx skills add owner/repo; rm x','npx skills add $(whoami)','npx evil add owner/repo','npx skills add owner/repo --unsupported']) assert.throws(()=>parseSkillInstallInput(input),{code:'unsupported-command'})
})
test('inspect, select, install, restart, list, update and remove retain package layout and ownership',async t=>{
  const {core,network,options}=await setup(t)
  const preview=await core.inspect('npx skills add owner/repo --skill alpha')
  assert.deepEqual(preview.candidates.map(x=>x.name),['alpha','beta'])
  const installed=await core.install({inspectionId:preview.id})
  assert.equal(await fs.readFile(join(installed.destination,'lib/support.js'),'utf8'),'export const value = 1')
  assert.equal(await fs.readFile(join(installed.destination,'skills/a/scripts/run.ts'),'utf8'),'import "../../../lib/support.js"')
  await assert.rejects(fs.stat(join(installed.destination,'skills/b/SKILL.md')),{code:'ENOENT'})
  assert.equal((await new SkillInstaller(options).list())[0].status,'installed')
  await rejection(core.install({inspectionId:preview.id}),'already-installed')
  network.set({...fixtures,'lib/support.js':'export const value = 2'})
  const updated=await core.update(installed.id)
  assert.equal(updated.source.resolvedCommit,sha2)
  assert.equal(updated.destination,installed.destination)
  await core.remove(updated.id); assert.deepEqual(await core.list(),[])
  await assert.rejects(fs.stat(installed.destination),{code:'ENOENT'})
})
test('multi-skill selection and duplicate names require explicit disambiguation',async t=>{
  const {core,network}=await setup(t)
  const preview=await core.inspect('owner/repo')
  await rejection(core.install({inspectionId:preview.id}),'selection-required')
  network.set({...fixtures,'skills/b/SKILL.md':skill('alpha')})
  const duplicates=await core.inspect('owner/repo')
  await rejection(core.install({inspectionId:duplicates.id,skills:['alpha']}),'ambiguous-skill')
  assert.equal((await core.install({inspectionId:duplicates.id,skills:['skills/b']})).skills[0].path,'skills/b')
})
test('local edits block update/remove and unknown ids cannot remove data',async t=>{
  const {core}=await setup(t), preview=await core.inspect('owner/repo')
  const installed=await core.install({inspectionId:preview.id,skills:['alpha']})
  await fs.writeFile(join(installed.destination,'skills/a/SKILL.md'),'user edited')
  assert.equal((await core.list())[0].status,'modified')
  await rejection(core.update(installed.id),'local-conflict'); await rejection(core.remove(installed.id),'local-conflict')
  assert.equal(await fs.readFile(join(installed.destination,'skills/a/SKILL.md'),'utf8'),'user edited')
  await rejection(core.remove('f'.repeat(36)),'not-owned')
})
test('scope state is isolated and guards can revoke before publication without half package',async t=>{
  let deny=false
  const {core,options,base}=await setup(t,{guard:()=>{if(deny)throw new SkillInstallError('scope-revoked','Scope revoked.')}})
  const preview=await core.inspect('owner/repo'); deny=true
  await rejection(core.install({inspectionId:preview.id,skills:['alpha']}),'scope-revoked'); deny=false
  assert.deepEqual(await core.list(),[])
  await rejection(new SkillInstaller({...options,authoringRoot:join(base,'different')}).list(),'scope-mismatch')
  assert.equal((await fs.readdir(options.authoringRoot)).length,0)
})
test('cancellation and download limits do not publish or retain partial inspections',async t=>{
  const {core,options}=await setup(t,{limits:{downloadBytes:100}})
  await rejection(core.inspect('owner/repo'),'limit')
  assert.deepEqual(await fs.readdir(join(options.stateRoot,'inspections')),[])
  const cancelled=new AbortController();cancelled.abort()
  await rejection(core.inspect('owner/repo',{signal:cancelled.signal}),'cancelled')
  assert.deepEqual(await core.list(),[])
})
test('same source commit with regenerated archives yields stable tree digest',async t=>{
  const {core,network}=await setup(t), preview=await core.inspect('owner/repo')
  const before=await core.install({inspectionId:preview.id,skills:['alpha']})
  network.set({...fixtures},sha1)
  const after=await core.update(before.id)
  assert.equal(after.digest,before.digest)
})
test('mutations serialize across instances with no lost ledger',async t=>{
  const {core,options,network}=await setup(t); let release, entered
  const began=new Promise(r=>entered=r), blocker=new Promise(r=>release=r)
  const pending=new SkillInstaller({...options,fetch:async(...args)=>{entered();await blocker;return network.fetch(...args)}}).inspect('owner/repo')
  await began
  await rejection(core.list(),'busy')
  release(); const preview=await pending
  await core.install({inspectionId:preview.id,skills:['alpha']})
  assert.equal((await core.list()).length,1)
})
test('interrupted precommit update restores original package and ledger on restart',async t=>{
  const {core,options}=await setup(t), preview=await core.inspect('owner/repo'), installed=await core.install({inspectionId:preview.id,skills:['alpha']})
  const ledger=JSON.parse(await fs.readFile(join(options.stateRoot,'installed.json'),'utf8'))
  const backup=join(options.authoringRoot,'.skill-backup-'+installed.id)
  await fs.rename(installed.destination,backup);await fs.mkdir(installed.destination);await fs.writeFile(join(installed.destination,'partial'),'bad')
  await fs.writeFile(join(options.stateRoot,'transaction.json'),JSON.stringify({id:installed.id,operation:'update',previous:ledger,next:{...ledger,installations:[]}}))
  assert.equal((await new SkillInstaller(options).list())[0].status,'installed')
  assert.equal(await fs.readFile(join(installed.destination,'skills/a/SKILL.md'),'utf8'),skill('alpha'))
})
test('npm metadata resolves range, verifies integrity, safely unpacks and preserves root',async t=>{
  const {base,options}=await setup(t), payload=join(base,'payload');await fs.mkdir(payload)
  await fs.writeFile(join(payload,'SKILL.md'),skill('npm-skill'));await fs.writeFile(join(payload,'package.json'),JSON.stringify({name:'fixture',version:'1.2.0'}))
  const chunks=[];for await(const chunk of tar.c({gzip:true,cwd:base},['payload']))chunks.push(chunk)
  const bytes=Buffer.concat(chunks), integrity='sha512-'+createHash('sha512').update(bytes).digest('base64')
  const metadata={name:'fixture','dist-tags':{latest:'1.2.0'},versions:{'1.2.0':{name:'fixture',version:'1.2.0',dist:{tarball:'https://registry.npmjs.org/fixture.tgz',integrity}}}}
  const fetch=async url=>url.endsWith('.tgz')?new Response(bytes):Response.json(metadata)
  const core=new SkillInstaller({...options,fetch})
  const preview=await core.inspect('npm:fixture@^1.0.0')
  assert.equal(preview.source.version,'1.2.0');assert.equal(preview.source.integrity,integrity)
  const installed=await core.install({inspectionId:preview.id});assert.equal(installed.skills[0].name,'npm-skill')
  metadata.versions['1.2.0'].dist.integrity='sha512-'+Buffer.alloc(64).toString('base64')
  await rejection(core.inspect('npm:fixture'),'integrity')
})
test('source URL credentials and archive symlinks are rejected before publication',async t=>{
  const {core,options}=await setup(t)
  await rejection(core.inspect('https://token:password@github.com/owner/repo'),'invalid-source')
  await rejection(core.inspect('https://github.com/owner/repo?token=secret'),'invalid-source')
  const archive=new AdmZip();archive.addFile('repo/SKILL.md',Buffer.from(skill('bad')))
  archive.getEntries()[0].attr=(0o120777<<16)>>>0
  const network=fixtureFetch()
  const bad=new SkillInstaller({...options,fetch:async(url,init)=>url.includes('/zipball/')?new Response(archive.toBuffer()):network.fetch(url,init)})
  await rejection(bad.inspect('owner/repo'),'unsafe-path')
})
test('generic HTTPS Git source uses injected transport and exact commit without subprocess',async t=>{
  const {options}=await setup(t);let called=false
  const core=new SkillInstaller({...options,git:async request=>{called=true;assert.equal(request.url,'https://git.example.test/team/skills.git');await fs.mkdir(request.destination);await fs.writeFile(join(request.destination,'SKILL.md'),skill('git-skill'));return{commit:sha1}}})
  const result=await core.inspect({source:'https://git.example.test/team/skills.git',ref:'v1'})
  assert.equal(called,true);assert.equal(result.source.resolvedCommit,sha1)
  assert.equal((await core.install({inspectionId:result.id})).skills[0].name,'git-skill')
})
test('known command path works with empty PATH and forbidden child-process API',async t=>{
  const {core}=await setup(t), previous=process.env.PATH
  const subprocess=require('node:child_process'), originals={}
  for(const key of ['exec','execSync','execFile','execFileSync','spawn','spawnSync']){originals[key]=subprocess[key];subprocess[key]=()=>{throw Error('subprocess forbidden')}}
  process.env.PATH=''
  try{const preview=await core.inspect('npx skills add owner/repo --skill alpha');await core.install({inspectionId:preview.id});assert.equal((await core.list()).length,1)}
  finally{process.env.PATH=previous;Object.assign(subprocess,originals)}
})

test('real isomorphic-git adapter clones an in-memory smart HTTPS Git fixture without system git',async t=>{
  const cwRequire=require
  const git=cwRequire('isomorphic-git'),nativeFs=cwRequire('node:fs'),{base}=await setup(t)
  const server=join(base,'server');await fs.mkdir(server);await git.init({fs:nativeFs,dir:server,defaultBranch:'main'})
  await fs.writeFile(join(server,'SKILL.md'),skill('real-git'))
  await git.add({fs:nativeFs,dir:server,filepath:'SKILL.md'})
  const commit=await git.commit({fs:nativeFs,dir:server,message:'fixture',author:{name:'Fixture',email:'fixture@example.test'}})
  const commitObject=await git.readCommit({fs:nativeFs,dir:server,oid:commit}),tree=commitObject.commit.tree
  const entries=await git.readTree({fs:nativeFs,dir:server,oid:tree})
  const {packfile}=await git.packObjects({fs:nativeFs,dir:server,oids:[commit,tree,...entries.tree.map(x=>x.oid)],write:false})
  const pkt=value=>{const body=Buffer.isBuffer(value)?value:Buffer.from(value);return Buffer.concat([Buffer.from((body.length+4).toString(16).padStart(4,'0')),body])}
  const advertise=Buffer.concat([pkt('# service=git-upload-pack\n'),Buffer.from('0000'),pkt(`${commit} HEAD\0multi_ack side-band-64k shallow no-progress ofs-delta symref=HEAD:refs/heads/main\n`),pkt(`${commit} refs/heads/main\n`),Buffer.from('0000')])
  const fetch=async(url,init)=>{
    assert.equal(new URL(url).hostname,'git.fixture.test')
    if(url.includes('info/refs'))return new Response(advertise,{headers:{'content-type':'application/x-git-upload-pack-advertisement'}})
    const packets=[pkt(`shallow ${commit}\n`),Buffer.from('0000'),pkt('NAK\n')]
    for(let i=0;i<packfile.length;i+=60000)packets.push(pkt(Buffer.concat([Buffer.from([1]),Buffer.from(packfile.subarray(i,i+60000))])))
    packets.push(Buffer.from('0000'));return new Response(Buffer.concat(packets),{headers:{'content-type':'application/x-git-upload-pack-result'}})
  }
  const {createGitSourceFetcher}=await load('skillInstallerGit.ts',{'isomorphic-git':git,'./skillInstaller':{SkillInstallError}})
  const options={authoringRoot:join(base,'actual-skills'),stateRoot:join(base,'actual-state'),git:createGitSourceFetcher({fetch})}
  const previous=process.env.PATH;process.env.PATH=''
  try {
    const core=new SkillInstaller(options),preview=await core.inspect({source:'https://git.fixture.test/team/skills.git',ref:'main'})
    assert.equal(preview.source.resolvedCommit,commit)
    const installed=await core.install({inspectionId:preview.id});assert.equal(installed.skills[0].name,'real-git')
  } finally {process.env.PATH=previous}
})

test('commit-time scope revocation rolls back both initial publication and update',async t=>{
  let calls=0,denyAt=Infinity
  const {core,network,options}=await setup(t,{guard:()=>{if(++calls===denyAt)throw new SkillInstallError('scope-revoked','Scope revoked.')}})
  const preview=await core.inspect('owner/repo');calls=0;denyAt=3
  await rejection(core.install({inspectionId:preview.id,skills:['alpha']}),'scope-revoked')
  denyAt=Infinity;assert.deepEqual(await core.list(),[])
  const installed=await core.install({inspectionId:preview.id,skills:['alpha']})
  network.set({...fixtures,'lib/support.js':'next'})
  calls=0;denyAt=5
  await rejection(core.update(installed.id),'scope-revoked')
  denyAt=Infinity;assert.equal((await core.list())[0].digest,installed.digest)
  assert.equal(await fs.readFile(join(installed.destination,'lib/support.js'),'utf8'),'export const value = 1')
  assert.equal((await fs.readdir(options.authoringRoot)).length,1)
})
test('npm legacy shasum is verified and no checksum is refused',async t=>{
  const {base,options}=await setup(t),payload=join(base,'legacy');await fs.mkdir(payload);await fs.writeFile(join(payload,'SKILL.md'),skill('legacy'))
  const chunks=[];for await(const chunk of tar.c({gzip:true,cwd:base},['legacy']))chunks.push(chunk)
  const bytes=Buffer.concat(chunks),dist={tarball:'https://registry.npmjs.org/legacy.tgz',shasum:createHash('sha1').update(bytes).digest('hex')}
  const core=new SkillInstaller({...options,fetch:async url=>url.endsWith('.tgz')?new Response(bytes):Response.json({'dist-tags':{latest:'1.0.0'},versions:{'1.0.0':{name:'legacy',version:'1.0.0',dist}}})})
  assert.match((await core.inspect('npm:legacy')).source.integrity,/^sha1-/)
  delete dist.shasum;await rejection(core.inspect('npm:legacy'),'integrity')
})
test('tar links and aggregate expanded limits are refused',async t=>{
  const {base,options}=await setup(t),payload=join(base,'unsafe');await fs.mkdir(payload);await fs.writeFile(join(payload,'SKILL.md'),skill('unsafe'));await fs.symlink('SKILL.md',join(payload,'alias'))
  const chunks=[];for await(const chunk of tar.c({gzip:true,cwd:base},['unsafe']))chunks.push(chunk)
  const bytes=Buffer.concat(chunks),integrity='sha512-'+createHash('sha512').update(bytes).digest('base64')
  const core=new SkillInstaller({...options,fetch:async url=>url.endsWith('.tgz')?new Response(bytes):Response.json({'dist-tags':{latest:'1.0.0'},versions:{'1.0.0':{name:'unsafe',version:'1.0.0',dist:{tarball:'https://registry.npmjs.org/unsafe.tgz',integrity}}}})})
  await rejection(core.inspect('npm:unsafe'),'unsafe-path')
  const network=fixtureFetch({...fixtures,'assets/large':Buffer.alloc(1000)})
  await rejection(new SkillInstaller({...options,fetch:network.fetch,limits:{unpackedBytes:900}}).inspect('owner/repo'),'limit')
})
test('replaced root is detected before mutation and other root data remains untouched',async t=>{
  const {core,options,base}=await setup(t),preview=await core.inspect('owner/repo')
  await fs.rename(options.authoringRoot,join(base,'old-root'));await fs.mkdir(options.authoringRoot);await fs.writeFile(join(options.authoringRoot,'mine'),'keep')
  await rejection(core.install({inspectionId:preview.id,skills:['alpha']}),'scope-mismatch')
  assert.equal(await fs.readFile(join(options.authoringRoot,'mine'),'utf8'),'keep')
})

test('CLI source shorthand follows skill selector and fragment-ref semantics',()=>{
  const selected=parseSkillInstallInput('npx skills add owner/repo@alpha#release')
  assert.equal(selected.input.source,'owner/repo');assert.equal(selected.input.ref,'release');assert.deepEqual(selected.input.skills,['alpha'])
  const nested=parseSkillInstallInput('owner/repo/skills/alpha#v1')
  assert.equal(nested.input.path,'skills/alpha');assert.equal(nested.input.ref,'v1')
})
test('persisted inspection exposes approval detail and declined update preserves files',async t=>{
  const {core,network,options}=await setup(t),preview=await core.inspect('owner/repo')
  assert.equal((await new SkillInstaller(options).getInspection(preview.id)).source.resolvedCommit,sha1)
  const installed=await core.install({inspectionId:preview.id,skills:['alpha']});network.set({...fixtures,'lib/support.js':'next'})
  await rejection(core.update(installed.id,{confirm:async(previous,next)=>{assert.equal(previous.source.resolvedCommit,sha1);assert.equal(next.source.resolvedCommit,sha2);return false}}),'denied')
  assert.equal((await core.list())[0].digest,installed.digest)
})
test('native loader parent and child selection conflict is explicit',async t=>{
  const {core,network}=await setup(t);network.set({'SKILL.md':skill('parent'),'child/SKILL.md':skill('child')})
  const preview=await core.inspect('owner/repo')
  await rejection(core.install({inspectionId:preview.id,skills:['*']}),'overlapping-skills')
  const installed=await core.install({inspectionId:preview.id,skills:['child']})
  await assert.rejects(fs.stat(join(installed.destination,'SKILL.md')),{code:'ENOENT'})
  assert.equal(installed.skills[0].path,'child')
})
