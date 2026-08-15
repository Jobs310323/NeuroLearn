import { sql } from './_sql';

/**
 * Сравнение регрессий по версиям промпта (`PROMPT_VERSIONS` в `src/lib/ai/provider.ts`).
 * Инкремент версии агента при любой смысловой правке его промпта — иначе
 * этот отчёт молча смешивает старое и новое поведение в одной строке.
 */

type FailureRow = {
  agent: string;
  operation: string;
  prompt_version: string;
  schema_failed: string;
  provider_failed: string;
  succeeded: string;
  schema_failed_pct: string | null;
};

type LatencyRow = {
  agent: string;
  prompt_version: string;
  median_latency_ms: string | null;
  avg_cost_usd: string | null;
  avg_tokens_out: string | null;
};

async function main() {
  const failures = (await sql(
    `select
       agent, operation, prompt_version,
       count(*) filter (where status = 'schema_failed') as schema_failed,
       count(*) filter (where status = 'provider_failed') as provider_failed,
       count(*) filter (where status = 'succeeded') as succeeded,
       round(100.0 * count(*) filter (where status = 'schema_failed') / nullif(count(*), 0), 1) as schema_failed_pct
     from ai_generations
     where created_at >= now() - interval '30 days'
     group by agent, operation, prompt_version
     order by agent, operation, prompt_version`,
  )) as FailureRow[];

  console.log('\n=== Доля schema_failed по версиям промпта (30 дней) ===');
  console.table(
    failures.map((r) => ({
      agent: r.agent,
      operation: r.operation,
      version: r.prompt_version,
      succeeded: r.succeeded,
      schema_failed: r.schema_failed,
      provider_failed: r.provider_failed,
      'schema_failed_%': r.schema_failed_pct ?? '—',
    })),
  );

  const latency = (await sql(
    `select
       agent, prompt_version,
       percentile_cont(0.5) within group (order by latency_ms) as median_latency_ms,
       avg(cost_usd) as avg_cost_usd,
       avg(tokens_out) as avg_tokens_out
     from ai_generations
     where status = 'succeeded'
     group by agent, prompt_version
     order by agent, prompt_version`,
  )) as LatencyRow[];

  console.log('\n=== Латентность и стоимость по версиям промпта (не должны незаметно вырасти) ===');
  console.table(
    latency.map((r) => ({
      agent: r.agent,
      version: r.prompt_version,
      median_latency_ms: r.median_latency_ms ? Math.round(Number(r.median_latency_ms)) : '—',
      avg_cost_usd: r.avg_cost_usd ? Number(r.avg_cost_usd).toFixed(5) : '—',
      avg_tokens_out: r.avg_tokens_out ? Math.round(Number(r.avg_tokens_out)) : '—',
    })),
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
