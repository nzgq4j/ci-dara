import fs from 'fs';
const env = Object.fromEntries(
  fs.readFileSync('.env.local','utf8').split(/\r?\n/).filter(l=>l && !l.startsWith('#') && l.includes('='))
    .map(l=>{ const i=l.indexOf('='); return [l.slice(0,i), l.slice(i+1).replace(/^["']|["']$/g,'')]; })
);
const key = env.PLATFORM_ANTHROPIC_KEY;
const t0 = Date.now();
const ctrl = new AbortController();
const timer = setTimeout(()=>ctrl.abort(), 260000);
try {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method:'POST',
    headers:{'content-type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01'},
    signal: ctrl.signal,
    body: JSON.stringify({
      model:'claude-sonnet-4-6', max_tokens:16000,
      messages:[{role:'user',content:'Output a JSON array of 400 objects, each {"n": <index>, "name":"Requirement <index>", "description":"A detailed two-sentence description of a government solicitation compliance requirement number <index> with specific FAR citations and submission instructions."}. Output ONLY the JSON array, all 400 items, no prose.'}]
    })
  });
  const data = await res.json().catch(()=>({}));
  console.log(`HTTP ${res.status} in ${((Date.now()-t0)/1000).toFixed(1)}s  out_tokens=${data?.usage?.output_tokens}  stop=${data?.stop_reason}`);
} catch(e){ console.log(`threw in ${((Date.now()-t0)/1000).toFixed(1)}s :: ${e.name} ${e.message}`); }
finally { clearTimeout(timer); }
