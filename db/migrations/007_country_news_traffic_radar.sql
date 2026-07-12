-- =========================================================
-- COUNTRY NEWS TRAFFIC RADAR
-- Task 3.3D
--
-- Country-level news signals discovered from public news
-- feed metadata. Traffic evidence is a coverage-and-recency
-- proxy: publisher article view counts are not available
-- and are never claimed. The migration runner wraps this
-- file in a transaction, so no BEGIN / COMMIT here.
-- =========================================================

-- =========================================================
-- 1. COUNTRY NEWS RUNS
-- =========================================================

CREATE TABLE IF NOT EXISTS country_news_runs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  status TEXT NOT NULL DEFAULT 'QUEUED',

  request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,

  country_count INTEGER NOT NULL DEFAULT 0,
  completed_country_count INTEGER NOT NULL DEFAULT 0,
  failed_country_count INTEGER NOT NULL DEFAULT 0,

  query_count INTEGER NOT NULL DEFAULT 0,
  succeeded_query_count INTEGER NOT NULL DEFAULT 0,

  item_count INTEGER NOT NULL DEFAULT 0,
  mention_inserted_count INTEGER NOT NULL DEFAULT 0,
  mention_updated_count INTEGER NOT NULL DEFAULT 0,
  cluster_inserted_count INTEGER NOT NULL DEFAULT 0,
  cluster_updated_count INTEGER NOT NULL DEFAULT 0,

  error_message TEXT,

  locked_by TEXT,
  locked_at TIMESTAMPTZ,

  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT country_news_runs_status_valid
    CHECK (
      status IN (
        'QUEUED',
        'RUNNING',
        'COMPLETED',
        'FAILED',
        'CANCELLED'
      )
    ),

  CONSTRAINT country_news_runs_counts_nonnegative
    CHECK (
      country_count >= 0 AND
      completed_country_count >= 0 AND
      failed_country_count >= 0 AND
      query_count >= 0 AND
      succeeded_query_count >= 0 AND
      item_count >= 0 AND
      mention_inserted_count >= 0 AND
      mention_updated_count >= 0 AND
      cluster_inserted_count >= 0 AND
      cluster_updated_count >= 0
    ),

  CONSTRAINT country_news_runs_request_payload_is_object
    CHECK (jsonb_typeof(request_payload) = 'object'),

  CONSTRAINT country_news_runs_summary_is_object
    CHECK (jsonb_typeof(summary) = 'object')
);

-- =========================================================
-- 2. COUNTRY NEWS SIGNALS (story clusters)
-- =========================================================

CREATE TABLE IF NOT EXISTS country_news_signals (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  country_id BIGINT NOT NULL
    REFERENCES countries(id)
    ON DELETE CASCADE,

  story_hash TEXT NOT NULL,

  canonical_title TEXT NOT NULL,
  title TEXT NOT NULL,
  representative_url TEXT NOT NULL,
  representative_source TEXT,
  representative_domain TEXT,

  category TEXT NOT NULL DEFAULT 'OTHER',
  category_confidence NUMERIC(5, 4),
  category_evidence JSONB NOT NULL DEFAULT '{}'::jsonb,

  country_match_method TEXT NOT NULL DEFAULT 'QUERY_CONTEXT',
  country_confidence NUMERIC(5, 4),
  country_evidence JSONB NOT NULL DEFAULT '{}'::jsonb,

  traffic_tier TEXT NOT NULL DEFAULT 'LOW_SIGNAL',
  traffic_score NUMERIC(6, 2) NOT NULL DEFAULT 0,
  mention_count INTEGER NOT NULL DEFAULT 0,
  publisher_count INTEGER NOT NULL DEFAULT 0,
  query_count INTEGER NOT NULL DEFAULT 0,
  feed_rank_score NUMERIC(6, 2),
  age_hours NUMERIC(18, 2),

  transformation_tier TEXT NOT NULL DEFAULT 'LOW',
  transformation_potential NUMERIC(6, 2) NOT NULL DEFAULT 0,

  conflict_archetypes JSONB NOT NULL DEFAULT '[]'::jsonb,
  keywords JSONB NOT NULL DEFAULT '[]'::jsonb,

  published_at TIMESTAMPTZ,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  provider TEXT NOT NULL,
  resolver_version TEXT NOT NULL,
  raw_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT country_news_signals_country_story_unique
    UNIQUE (country_id, story_hash),

  CONSTRAINT country_news_signals_category_valid
    CHECK (
      category IN (
        'POLITICS_POLICY',
        'ENERGY',
        'WAR_SECURITY',
        'SANCTIONS_TRADE',
        'RESOURCES',
        'SEMICONDUCTORS_AI',
        'ECONOMY',
        'DISASTER_CLIMATE',
        'INFRASTRUCTURE',
        'INTERNATIONAL_RELATIONS',
        'CULTURE_SOCIETY',
        'OTHER'
      )
    ),

  CONSTRAINT country_news_signals_traffic_tier_valid
    CHECK (
      traffic_tier IN (
        'BREAKOUT',
        'ACTIVE',
        'WATCH',
        'LOW_SIGNAL'
      )
    ),

  CONSTRAINT country_news_signals_transformation_tier_valid
    CHECK (
      transformation_tier IN (
        'HIGH',
        'MEDIUM',
        'LOW'
      )
    ),

  CONSTRAINT country_news_signals_match_method_valid
    CHECK (
      country_match_method IN (
        'TITLE_ALIAS',
        'SNIPPET_ALIAS',
        'QUERY_CONTEXT'
      )
    ),

  CONSTRAINT country_news_signals_category_confidence_range
    CHECK (
      category_confidence IS NULL OR
      (
        category_confidence >= 0.0000 AND
        category_confidence <= 1.0000
      )
    ),

  CONSTRAINT country_news_signals_country_confidence_range
    CHECK (
      country_confidence IS NULL OR
      (
        country_confidence >= 0.0000 AND
        country_confidence <= 1.0000
      )
    ),

  CONSTRAINT country_news_signals_traffic_score_range
    CHECK (
      traffic_score >= 0 AND
      traffic_score <= 100
    ),

  CONSTRAINT country_news_signals_transformation_range
    CHECK (
      transformation_potential >= 0 AND
      transformation_potential <= 100
    ),

  CONSTRAINT country_news_signals_feed_rank_score_range
    CHECK (
      feed_rank_score IS NULL OR
      (
        feed_rank_score >= 0 AND
        feed_rank_score <= 100
      )
    ),

  CONSTRAINT country_news_signals_counts_nonnegative
    CHECK (
      mention_count >= 0 AND
      publisher_count >= 0 AND
      query_count >= 0
    ),

  CONSTRAINT country_news_signals_age_hours_nonnegative
    CHECK (
      age_hours IS NULL OR
      age_hours >= 0
    ),

  CONSTRAINT country_news_signals_conflict_archetypes_is_array
    CHECK (jsonb_typeof(conflict_archetypes) = 'array'),

  CONSTRAINT country_news_signals_keywords_is_array
    CHECK (jsonb_typeof(keywords) = 'array'),

  CONSTRAINT country_news_signals_category_evidence_is_object
    CHECK (jsonb_typeof(category_evidence) = 'object'),

  CONSTRAINT country_news_signals_country_evidence_is_object
    CHECK (jsonb_typeof(country_evidence) = 'object'),

  CONSTRAINT country_news_signals_raw_metadata_is_object
    CHECK (jsonb_typeof(raw_metadata) = 'object')
);

-- =========================================================
-- 3. COUNTRY NEWS MENTIONS (individual feed appearances)
-- =========================================================

CREATE TABLE IF NOT EXISTS country_news_mentions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  news_signal_id BIGINT NOT NULL
    REFERENCES country_news_signals(id)
    ON DELETE CASCADE,

  country_id BIGINT NOT NULL
    REFERENCES countries(id)
    ON DELETE CASCADE,

  external_key TEXT NOT NULL UNIQUE,

  query_key TEXT NOT NULL,
  query_text TEXT NOT NULL,
  feed_rank INTEGER,

  title TEXT NOT NULL,
  normalized_title TEXT NOT NULL,
  url TEXT NOT NULL,
  guid TEXT,

  source_name TEXT,
  source_url TEXT,
  publisher_domain TEXT,

  published_at TIMESTAMPTZ,
  snippet TEXT,

  raw_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT country_news_mentions_feed_rank_nonnegative
    CHECK (
      feed_rank IS NULL OR
      feed_rank >= 0
    ),

  CONSTRAINT country_news_mentions_snippet_capped
    CHECK (
      snippet IS NULL OR
      char_length(snippet) <= 500
    ),

  CONSTRAINT country_news_mentions_raw_metadata_is_object
    CHECK (jsonb_typeof(raw_metadata) = 'object')
);

-- =========================================================
-- INDEXES
-- =========================================================

CREATE INDEX IF NOT EXISTS idx_country_news_runs_status_created
  ON country_news_runs(status, created_at);

CREATE INDEX IF NOT EXISTS idx_country_news_signals_country_traffic
  ON country_news_signals(country_id, traffic_score DESC);

CREATE INDEX IF NOT EXISTS idx_country_news_signals_tier_traffic
  ON country_news_signals(traffic_tier, traffic_score DESC);

CREATE INDEX IF NOT EXISTS idx_country_news_signals_category_traffic
  ON country_news_signals(category, traffic_score DESC);

CREATE INDEX IF NOT EXISTS idx_country_news_signals_transformation
  ON country_news_signals(
    transformation_tier,
    transformation_potential DESC
  );

CREATE INDEX IF NOT EXISTS idx_country_news_signals_published_at
  ON country_news_signals(published_at DESC);

CREATE INDEX IF NOT EXISTS idx_country_news_signals_last_seen_at
  ON country_news_signals(last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_country_news_mentions_signal
  ON country_news_mentions(news_signal_id);

CREATE INDEX IF NOT EXISTS idx_country_news_mentions_publisher_domain
  ON country_news_mentions(publisher_domain);
