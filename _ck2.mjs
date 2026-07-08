import pg from 'pg';
const url = process.env.DIRECT_URL;
async function q(label, sql){
  const c = new pg.Client({connectionString: url});
  try { await c.connect(); const r = await c.query(sql); console.log(label, JSON.stringify(r.rows)); }
  catch(e){ console.log(label, 'ERR', e.message); }
  finally { try{await c.end()}catch{} }
}
await q('rls_enabled', "select relrowsecurity, relforcerowsecurity from pg_class where relname='dara_ai_usage_log'");
await q('policies', "select polname, cmd, roles::regrole[] , pg_get_expr(polqual, polrelid) as using, pg_get_expr(polwithcheck, polrelid) as withcheck from pg_policy p where polrelid='dara_ai_usage_log'::regclass");
await q('admin_bypassrls', "select rolname, rolbypassrls from pg_roles where rolname in ('dara_admin','dara_app','postgres','service_role')");
await q('recent_jobs', "select status, count(*)::int n, max(created_at) latest from dara_jobs where created_at > now() - interval '2 hours' group by status");
await q('any_recent_ai_jobs', "select id, type, status, created_at, updated_at from dara_jobs order by created_at desc limit 8");
