import pg from 'pg';
async function q(sql){
  const c = new pg.Client({connectionString: process.env.DIRECT_URL, statement_timeout: 8000, connectionTimeoutMillis: 8000});
  await c.connect(); const r = await c.query(sql); await c.end(); return r.rows;
}
for (let i=0;i<20;i++){
  try{
    const cnt = (await q("select count(*)::int n from dara_ai_usage_log"))[0].n;
    const rows = await q("select capability, provider, model, token_in, token_out, ok, created_at from dara_ai_usage_log order by created_at desc limit 4");
    console.log(`[${new Date().toISOString()}] rows=${cnt}`, JSON.stringify(rows));
    if (cnt>0) break;
  }catch(e){ console.log('poll err', e.message); }
  await new Promise(r=>setTimeout(r, 9000));
}
