import { sql } from './_sql';

const rows = (await sql(`
  select 'users' as t, count(*)::int as n from users
  union all select 'learning_paths', count(*)::int from learning_paths
  union all select 'knowledge_nodes', count(*)::int from knowledge_nodes
  union all select 'node_edges', count(*)::int from node_edges
  union all select 'node_progress', count(*)::int from node_progress
  order by 1
`)) as { t: string; n: number }[];

console.log(rows.map((r) => `${r.t}=${r.n}`).join(' '));
