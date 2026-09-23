/** Deployment is isolated to a new Worker and database. No production secrets in git. */
import {readFileSync,writeFileSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const dir=fileURLToPath(new URL('.',import.meta.url));
const token=process.env.CLOUDFLARE_API_TOKEN,pin=process.env.ANALYTICS_PIN,secret=process.env.ANALYTICS_SECRET;
if(!token||!pin||pin.length<4||!secret||secret.length<32)throw new Error('Set CLOUDFLARE_API_TOKEN, ANALYTICS_PIN and ANALYTICS_SECRET (32+ characters) as GitHub Actions secrets. No default password is shipped.');
const config=JSON.parse(readFileSync(dir+'wrangler.jsonc','utf8'));
const account=process.env.CLOUDFLARE_ACCOUNT_ID||config.account_id;
if(!/^[a-f0-9]{32}$/.test(account))throw new Error('Invalid account ID');
async function cf(path,init={}){
 const r=await fetch('https://api.cloudflare.com/client/v4/accounts/'+account+path,{...init,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'}});
 const d=await r.json();if(!r.ok||!d.success)throw new Error('Cloudflare API operation failed; check token permissions and account. HTTP '+r.status);return d.result;
}
const existing=await cf('/d1/database?name=eco-geo-analytics&per_page=100');
let db=existing.find(d=>d.name==='eco-geo-analytics');
if(!db)db=await cf('/d1/database',{method:'POST',body:JSON.stringify({name:'eco-geo-analytics'})});
if(!db.uuid)throw new Error('Database provisioning did not return a UUID');
config.account_id=account;config.d1_databases[0].database_id=db.uuid;
writeFileSync(dir+'wrangler.runtime.json',JSON.stringify(config,null,2));
const args=['--yes','wrangler@4.102.0'];
function wrangler(command,options={}){execFileSync('npx',[...args,...command,'--config','wrangler.runtime.json'],{cwd:dir,env:{...process.env,CLOUDFLARE_ACCOUNT_ID:account,WRANGLER_SEND_METRICS:'false'},stdio:'inherit',...options});}
try{
 wrangler(['d1','execute','eco-geo-analytics','--remote','--file','schema.sql','--yes']);
 // Worker fails closed until both secrets exist. Bulk upload uses stdin, never command args.
 wrangler(['deploy','--keep-vars']);
 wrangler(['secret','bulk'],{input:JSON.stringify({ANALYTICS_PIN:pin,ANALYTICS_SECRET:secret}),stdio:['pipe','inherit','inherit']});
 let healthy=false;
 for(let i=0;i<6;i++){
  try{const r=await fetch('https://metrics.eco-geo.org/health');const d=await r.json();healthy=r.ok&&d.ok===true&&d.service==='eco-geo-analytics';}catch{}
  if(healthy)break;await new Promise(resolve=>setTimeout(resolve,5000));
 }
 if(!healthy)throw new Error('Worker was submitted, but live health verification failed. Check custom-domain DNS and Worker deployment.');
 console.log('Verified analytics health: metrics.eco-geo.org');
}finally{rmSync(dir+'wrangler.runtime.json',{force:true});}
