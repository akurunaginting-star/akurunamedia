import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {onRequest,validateArticle} from '../functions/api/auto.js';

function database(){
  const sqlite=new DatabaseSync(':memory:');
  return {prepare(sql){let args=[];return {bind(...a){args=a;return this;},async first(){return sqlite.prepare(sql).get(...args)||null;},async all(){return {results:sqlite.prepare(sql).all(...args)};},async run(){return sqlite.prepare(sql).run(...args);}};}};
}
const secret='test-secret-'.repeat(4);
async function environment(mode='draft'){
  const db=database();await db.prepare('CREATE TABLE agent_connection(provider TEXT,ciphertext TEXT,iv TEXT,site_id TEXT)').run();
  const bytes=new TextEncoder();const raw=await crypto.subtle.digest('SHA-256',bytes.encode('akuruna-wordpress-token-v1:'+secret));
  const key=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt']);const iv=crypto.getRandomValues(new Uint8Array(12));
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,bytes.encode('test-wp-token'));
  await db.prepare('INSERT INTO agent_connection VALUES (?,?,?,?)').bind('wordpress',Buffer.from(ciphertext).toString('hex'),Buffer.from(iv).toString('hex'),'256267459').run();
  return {AGENT_DB:db,AGENT_ADMIN_KEY:secret,AUTO_RUN_KEY:secret,AUTO_MODE:mode,AUTO_MAX_DAILY:'2',AUTO_INSTAGRAM_SERVICE:'instagram-business'};
}
let posts=[],uploads=0,fail='',multiple=false;
globalThis.fetch=async(url,options)=>{
  assert.equal(options.headers.Authorization,'Bearer test-wp-token');
  if(url.endsWith('/publicize-connections/'))return Response.json({connections:[{ID:7,service:'instagram-business',label:'Instagram'},...(multiple?[{ID:8,service:'instagram-business'}]:[]),{ID:9,service:'facebook'}]});
  if(url.endsWith('/media/new')){uploads++;assert(options.body.get('media[]'));if(fail==='upload')throw Error('timeout');return Response.json({media:[{ID:55}]});}
  if(url.endsWith('/posts/new')){posts.push(Object.fromEntries(options.body));if(fail==='save')throw Error('timeout');return Response.json({ID:90,status:options.body.get('status'),URL:'https://example.wordpress.com/article'});}
  throw Error('unexpected endpoint');
};
async function call(env,body,auth=secret){
  const response=await onRequest({env,request:new Request('https://akurunamedia.id/api/auto',{method:'POST',headers:{Authorization:'Bearer '+auth},body:JSON.stringify(body)})});
  return {status:response.status,...await response.json()};
}
const article={title:'Judul <aman>',headline:'Bitcoin dan Ekonomi',excerpt:'Ringkasan',caption:'Caption lengkap tersendiri',paragraphs:['Isi <script>alert(1)</script>'],approved:true,review_notes:'Lolos pemeriksaan sumber'};
const jpeg=Buffer.concat([Buffer.from([255,216,255]),Buffer.alloc(1100)]).toString('base64');
async function reserve(env,n=1){return call(env,{action:'reserve',source_url:'https://www.coindesk.com/news/'+n});}
async function upload(env,id){return call(env,{action:'upload',id,jpeg});}

let env=await environment();
assert.equal((await call(env,{action:'inspect'},'wrong')).status,401);
env.AUTO_MODE='off';assert.equal((await reserve(env)).status,409);assert.equal((await call(env,{action:'inspect'})).mode,'off');env.AUTO_MODE='draft';
const first=await reserve(env);assert.equal(first.reserved,true);assert.equal((await reserve(env)).reserved,false);
assert.equal((await upload(env,first.id)).ok,true);assert.equal((await upload(env,first.id)).status,409);
let result=await call(env,{action:'save',id:first.id,article});assert.equal(result.state,'draft');assert.equal(posts.at(-1).publicize,'false');assert(!posts.at(-1).content.includes('<script>'));
assert.equal((await call(env,{action:'save',id:first.id,article})).status,409);
await reserve(env,2);assert.equal((await reserve(env,3)).status,429);

env=await environment('publish');multiple=true;assert.equal((await reserve(env)).error,'configure_exactly_one_instagram_connection');multiple=false;
const publish=await reserve(env);await upload(env,publish.id);
result=await call(env,{action:'save',id:publish.id,article});assert.equal(result.state,'published_wp');assert.equal(result.instagram,'requested_not_verified');
assert.equal(posts.at(-1)['publicize[]'],'instagram-business');assert.equal(posts.at(-1).publicize_message,article.caption);assert.equal(posts.at(-1).featured_image,'55');
assert.equal(posts.at(-1).publicize,undefined);

env=await environment();const draft=await reserve(env);await upload(env,draft.id);env.AUTO_MODE='publish';
assert.equal((await call(env,{action:'save',id:draft.id,article})).state,'draft'); // never escalate reserved draft
env=await environment('publish');const paused=await reserve(env);env.AUTO_MODE='off';assert.equal((await upload(env,paused.id)).error,'automation_paused');

env=await environment('publish');const uncertain=await reserve(env);await upload(env,uncertain.id);fail='save';
const before=posts.length;assert.equal((await call(env,{action:'save',id:uncertain.id,article})).error,'result_uncertain');
assert.equal((await call(env,{action:'save',id:uncertain.id,article})).status,409);assert.equal(posts.length,before+1);
assert.equal((await call(env,{action:'status',id:uncertain.id})).job.state,'save_uncertain');fail='';
env=await environment();const media=await reserve(env);fail='upload';assert.equal((await upload(env,media.id)).error,'result_uncertain');fail='';
const uploadCount=uploads;assert.equal((await upload(env,media.id)).status,409);assert.equal(uploads,uploadCount);
assert.throws(()=>validateArticle({...article,caption:'a'.repeat(1801)}));
console.log('PASS: auth, pause, encrypted token, URL dedup, daily cap, upload once, explicit draft, Instagram-only request, caption, escaping, no mode escalation, uncertain-result no retries.');
