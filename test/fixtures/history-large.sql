-- 仅用于临时性能测试数据库：会清空 history_points，禁止在真实历史数据库上执行。
-- 3 个 provider × 20,000 点 = 60,000 点；每个 provider 覆盖约 6.94 天。
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
BEGIN IMMEDIATE;

CREATE TABLE IF NOT EXISTS history_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_key TEXT NOT NULL,
  recorded_at INTEGER NOT NULL,
  provider TEXT NOT NULL,
  kind TEXT,
  mode TEXT,
  currency TEXT,
  signature TEXT NOT NULL,
  metrics TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS history_provider_time
  ON history_points (provider_key, recorded_at, id);

DELETE FROM history_points;
DELETE FROM sqlite_sequence WHERE name = 'history_points';

WITH RECURSIVE
  providers(provider_key, provider, kind, currency) AS (
    VALUES
      ('["deepseek-official","deepseek","https://api.deepseek.com/user/balance","",["DEEPSEEK_API_KEY"]]', 'deepseek-official', 'balance', 'CNY'),
      ('["benchmark-kimi-1","kimi","https://quota.example.test/1","",["BENCHMARK_KEY"]]', 'benchmark-kimi-1', 'kimi', NULL),
      ('["benchmark-kimi-2","kimi","https://quota.example.test/2","",["BENCHMARK_KEY"]]', 'benchmark-kimi-2', 'kimi', NULL)
  ),
  series(id) AS (
    SELECT 0
    UNION ALL
    SELECT id + 1 FROM series WHERE id < 19999
  )
INSERT INTO history_points (
  provider_key, recorded_at, provider, kind, mode, currency, signature, metrics
)
SELECT
  providers.provider_key,
  (strftime('%s', 'now') - 599970 + series.id * 30) * 1000 AS recorded_at,
  providers.provider,
  providers.kind,
  NULL AS mode,
  providers.currency,
  json_array(
    providers.kind,
    NULL,
    providers.currency,
    json(
      CASE
        WHEN providers.kind = 'balance' THEN json_object(
          'amount', printf('%.2f', 80.0 + ((series.id % 240) - 120) / 100.0),
          'fiveHour', series.id % 101
        )
        ELSE json_object(
          'fiveHour', series.id % 101,
          'weekly', (series.id * 2) % 101
        )
      END
    )
  ) AS signature,
  CASE
    WHEN providers.kind = 'balance' THEN json_object(
      'amount', printf('%.2f', 80.0 + ((series.id % 240) - 120) / 100.0),
      'fiveHour', series.id % 101
    )
    ELSE json_object(
      'fiveHour', series.id % 101,
      'weekly', (series.id * 2) % 101
    )
  END AS metrics
FROM series
CROSS JOIN providers;

COMMIT;
