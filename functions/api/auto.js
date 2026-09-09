// Authenticated bridge: WordPress credentials stay in Cloudflare D1.
const enc = new TextEncoder();
const hex = x => Array.from(new Uint8Array(x), b => b.toString(16).padStart(2, '0')).join('');
const hash = s => crypto.subtle.digest('SHA-256', enc.encode(s)).then(hex);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const json = (x, status=200) => new Response(JSON.stringify(x), {status, headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const mode = env => ['draft','publish'].includes(env.AUTO_MODE) ? env.AUTO_MODE : 'off';
const limit = env => Math.min(3, Math.max(1, Number.parseInt(env.AUTO_MAX_DAILY,10)||2));
const day = () => new Date(Date.now()+7*3600000).toISOString().slice(0,10);
export async function readBody(request, maximum=4500000) {
  const reader=request.body?.getReader(); if(!reader)throw Error('body');
  const chunks=[]; let length=0;
  while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>maximum){await reader.cancel();throw Error('body');}chunks.push(value);}
  const all=new Uint8Array(length); let offset=0;for(const c of chunks){all.set(c,offset);offset+=c.length;}
  return new TextDecoder().decode(all);
}
async function init(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS agent_auto_jobs (
    id TEXT PRIMARY KEY, source_url TEXT NOT NULL, day TEXT NOT NULL,
    mode TEXT NOT NULL, state TEXT NOT NULL, created TEXT NOT NULL,
    media_id TEXT, post_id TEXT, post_url TEXT, article TEXT, note TEXT
  )`).run();
}
async function connection(env) {
  const row=await env.AGENT_DB.prepare("SELECT ciphertext,iv,site_id FROM agent_connection WHERE provider='wordpress'").first();
  if(!row || !/^\d+$/.test(row.site_id))throw Error('wp_connection');
  const bytes=s=>Uint8Array.from(s.match(/../g)||[], x=>parseInt(x,16));
  const raw=await crypto.subtle.digest('SHA-256',enc.encode('akuruna-wordpress-token-v1:'+env.AGENT_ADMIN_KEY));
  const key=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['decrypt']);
  const bearer=new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(row.iv)},key,bytes(row.ciphertext)));
  return {site:row.site_id,bearer};
}
async function wp(conn,path,options={}) {
  const r=await fetch('https://public-api.wordpress.com/rest/v1.1/sites/'+conn.site+path,{
    ...options, headers:{Authorization:'Bearer '+conn.bearer,...options.headers}, signal:AbortSignal.timeout(45000)
  });
  if(!r.ok)throw Error('wordpress_'+r.status);
  return r.json();
}
async function connections(conn) {
  const data=await wp(conn,'/publicize-connections/');
  return (data.connections||[]).map(c=>({id:c.ID, service:c.service, label:c.label, display_name:c.display_name||'', status:c.status||'', expires:c.expires||''}));
}
export function validateArticle(a) {
  if(!a || typeof a!=='object')throw Error('article');
  for(const [field,max] of [['title',160],['headline',110],['excerpt',500],['caption',1800]]){
    if(typeof a[field]!=='string'||!a[field].trim()||Array.from(a[field]).length>max)throw Error('article');
  }
  if(!Array.isArray(a.paragraphs)||a.paragraphs.length<1||a.paragraphs.length>8||a.paragraphs.some(p=>typeof p!=='string'||!p.trim()||p.length>1800))throw Error('article');
  if(typeof a.review_notes!=='string'||a.review_notes.length>2000||typeof a.approved!=='boolean')throw Error('article');
  return a;
}
function sourceURL(value) {
  const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.href.length>1400)throw Error('source');
  u.hash=''; for(const k of [...u.searchParams.keys()])if(k.startsWith('utm_'))u.searchParams.delete(k);
  return u.href;
}
export async function onRequest({request,env}) {
  if(request.method!=='POST')return json({error:'POST required'},405);
  if(!env.AUTO_RUN_KEY||env.AUTO_RUN_KEY.length<32||!env.AGENT_DB||!env.AGENT_ADMIN_KEY)return json({error:'auto_not_configured'},503);
  const supplied=request.headers.get('Authorization')||'';
  if(supplied.length>600||await hash(supplied)!==await hash('Bearer '+env.AUTO_RUN_KEY))return json({error:'unauthorized'},401);
  let id, phase;
  try {
    const b=JSON.parse(await readBody(request));const db=env.AGENT_DB;await init(db);
    if(b.action==='inspect'){
      const conn=await connection(env);
      const recent=await db.prepare('SELECT id,source_url,state,mode,post_id,post_url,created,note FROM agent_auto_jobs ORDER BY created DESC LIMIT 10').all();
      return json({mode:mode(env),daily_limit:limit(env),site:conn.site,instagram_service:env.AUTO_INSTAGRAM_SERVICE||'',connections:await connections(conn),jobs:recent.results});
    }
    if(b.action==='status'){
      if(!/^[a-f0-9]{64}$/.test(b.id||''))return json({error:'invalid_id'},400);
      const job=await db.prepare('SELECT id,state,mode,post_id,post_url,note FROM agent_auto_jobs WHERE id=?').bind(b.id).first();
      return json({job});
    }
    if(mode(env)==='off')return json({error:'automation_paused'},409);
    if(b.action==='reserve'){
      const url=sourceURL(b.source_url);const conn=await connection(env);
      id=await hash(conn.site+'\n'+url);
      const old=await db.prepare('SELECT id,state,post_id,post_url FROM agent_auto_jobs WHERE id=?').bind(id).first();
      if(old)return json({reserved:false,job:old});
      const selectedMode=b.draft===true?'draft':mode(env);
      if(selectedMode==='publish'){
        const service=env.AUTO_INSTAGRAM_SERVICE||'';
        const matching=(await connections(conn)).filter(c=>c.service===service);
        if(!/instagram/i.test(service)||matching.length!==1)return json({error:'configure_exactly_one_instagram_connection'},409);
      }
      const row=await db.prepare(`INSERT OR IGNORE INTO agent_auto_jobs (id,source_url,day,mode,state,created)
        SELECT ?,?,?,?,'reserved',? WHERE (SELECT COUNT(*) FROM agent_auto_jobs WHERE day=?)<? RETURNING id,mode`)
        .bind(id,url,day(),selectedMode,new Date().toISOString(),day(),limit(env)).first();
      return row?json({reserved:true,...row}):json({error:'daily_limit_or_duplicate'},429);
    }
    if(!/^[a-f0-9]{64}$/.test(b.id||''))return json({error:'invalid_id'},400);
    id=b.id;const job=await db.prepare('SELECT * FROM agent_auto_jobs WHERE id=?').bind(id).first();
    if(!job)return json({error:'job_missing'},404);
    if(b.action==='skip'){
      await db.prepare("UPDATE agent_auto_jobs SET state='skipped',note=? WHERE id=? AND state='reserved'")
        .bind(String(b.reason||'Pemeriksaan tidak lolos').slice(0,500),id).run();return json({ok:true});
    }
    if(b.action==='upload'){
      if(typeof b.jpeg!=='string'||b.jpeg.length>4000000||!/^\/[9]j\//.test(b.jpeg))return json({error:'invalid_jpeg'},400);
      const bytes=Uint8Array.from(atob(b.jpeg),x=>x.charCodeAt(0));
      if(bytes.length<1000||bytes[0]!==255||bytes[1]!==216||bytes[2]!==255)return json({error:'invalid_jpeg'},400);
      const conn=await connection(env);
      const claimed=await db.prepare("UPDATE agent_auto_jobs SET state='uploading' WHERE id=? AND state='reserved' RETURNING id").bind(id).first();
      if(!claimed)return json({error:'already_started',state:job.state},409);
      phase='upload';
      const form=new FormData();form.append('media[]',new Blob([bytes],{type:'image/jpeg'}),'akuruna-'+id.slice(0,12)+'.jpg');
      form.append('attrs[0][caption]','Ilustrasi AI · Akuruna Media');
      const result=await wp(conn,'/media/new',{method:'POST',body:form});
      const media=result.media?.[0];if(!media?.ID)throw Error('media_result');
      await db.prepare("UPDATE agent_auto_jobs SET state='illustrated',media_id=? WHERE id=?").bind(String(media.ID),id).run();
      return json({ok:true,media_id:media.ID});
    }
    if(b.action==='save'){
      const a=validateArticle(b.article);const conn=await connection(env);
      const publishing=job.mode==='publish'&&mode(env)==='publish'&&a.approved;
      const service=env.AUTO_INSTAGRAM_SERVICE||'';
      if(publishing){
        if(!/instagram/i.test(service)||(await connections(conn)).filter(c=>c.service===service).length!==1)return json({error:'instagram_connection_changed'},409);
      }
      const claimed=await db.prepare("UPDATE agent_auto_jobs SET state='saving',article=? WHERE id=? AND state='illustrated' RETURNING id")
        .bind(JSON.stringify(a),id).first();
      if(!claimed)return json({error:'already_started',state:job.state},409);
      phase='save';
      const content=a.paragraphs.map(p=>'<p>'+esc(p)+'</p>').join('')+
        '<p>Sumber: <a href="'+esc(job.source_url)+'" rel="nofollow noreferrer">'+esc(new URL(job.source_url).hostname)+'</a></p><p><small>Ilustrasi dibuat dengan AI.</small></p>';
      const fields=new URLSearchParams({title:a.title,slug:'akuruna-auto-'+id.slice(0,20),content,excerpt:a.excerpt,
        status:publishing?'publish':'draft',featured_image:job.media_id,publicize:'false'});
      if(publishing){fields.delete('publicize');fields.append('publicize[]',service);fields.set('publicize_message',a.caption);}
      const post=await wp(conn,'/posts/new',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:fields});
      if(!post.ID||post.status!==(publishing?'publish':'draft'))throw Error('post_result');
      const state=publishing?'published_wp':'draft';
      const note=publishing?'Permintaan berbagi dikirim ke Jetpack. Pengiriman Instagram belum dikonfirmasi.':a.review_notes;
      await db.prepare('UPDATE agent_auto_jobs SET state=?,post_id=?,post_url=?,note=? WHERE id=?')
        .bind(state,String(post.ID),post.URL||'',note,id).run();
      return json({state,post_id:post.ID,post_url:post.URL||'',instagram:publishing?'requested_not_verified':'not_requested'});
    }
    return json({error:'unknown_action'},400);
  } catch(e) {
    if(phase&&id){try{await env.AGENT_DB.prepare('UPDATE agent_auto_jobs SET state=?,note=? WHERE id=?')
      .bind(phase+'_uncertain','Periksa WordPress sebelum tindakan ulang; tidak diulang otomatis.',id).run();}catch{}}
    return json({error:phase?'result_uncertain':'request_failed',phase:phase||'validation',id:id||null},502);
  }
}
