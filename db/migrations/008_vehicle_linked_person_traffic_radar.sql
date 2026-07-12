-- =========================================================
-- VEHICLE-LINKED PERSON TRAFFIC RADAR
-- Task 3.3E
--
-- Public automotive figures anchored to active vehicle
-- Shorts. Vehicle attention uses real YouTube Short views;
-- news coverage is a coverage-and-recency PROXY (publisher
-- article view counts are not available and are never
-- claimed). The composite person traffic score is clearly
-- labeled COMPOSITE. The migration runner wraps this file
-- in a transaction, so no BEGIN / COMMIT here.
-- =========================================================

-- =========================================================
-- 1. PEOPLE (canonical public person registry)
-- =========================================================

CREATE TABLE IF NOT EXISTS people (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  slug TEXT NOT NULL UNIQUE,
  canonical_name TEXT NOT NULL,

  country_id BIGINT
    REFERENCES countries(id)
    ON DELETE SET NULL,

  role_category TEXT NOT NULL DEFAULT 'OTHER',

  aliases JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  catalog_version TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT people_role_category_valid
    CHECK (
      role_category IN (
        'FOUNDER_EXECUTIVE',
        'DRIVER_RACER',
        'ENGINEER_DESIGNER',
        'BUILDER_TUNER',
        'CREATOR_MEDIA',
        'COLLECTOR_OWNER',
        'HISTORICAL_FIGURE',
        'OTHER'
      )
    ),

  CONSTRAINT people_aliases_is_array
    CHECK (jsonb_typeof(aliases) = 'array'),

  CONSTRAINT people_metadata_is_object
    CHECK (jsonb_typeof(metadata) = 'object')
);

-- =========================================================
-- 2. VEHICLE PERSON LINKS
-- =========================================================

CREATE TABLE IF NOT EXISTS vehicle_person_links (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  person_id BIGINT NOT NULL
    REFERENCES people(id)
    ON DELETE CASCADE,

  vehicle_id BIGINT
    REFERENCES vehicles(id)
    ON DELETE SET NULL,

  vehicle_brand TEXT,
  vehicle_series TEXT,
  vehicle_model TEXT,

  relation_type TEXT NOT NULL DEFAULT 'OTHER',
  link_confidence NUMERIC(5, 4),
  link_method TEXT NOT NULL DEFAULT 'CATALOG',
  link_evidence JSONB NOT NULL DEFAULT '{}'::jsonb,

  locked BOOLEAN NOT NULL DEFAULT FALSE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT vehicle_person_links_relation_valid
    CHECK (
      relation_type IN (
        'FOUNDER',
        'EXECUTIVE',
        'DRIVER',
        'RACING_DRIVER',
        'DESIGNER',
        'ENGINEER',
        'BUILDER',
        'TUNER',
        'CREATOR',
        'OWNER',
        'HISTORICAL',
        'OTHER'
      )
    ),

  CONSTRAINT vehicle_person_links_method_valid
    CHECK (
      link_method IN (
        'CATALOG',
        'DIRECT_MENTION',
        'MODEL_ASSOCIATION',
        'BRAND_ASSOCIATION',
        'MANUAL'
      )
    ),

  CONSTRAINT vehicle_person_links_confidence_range
    CHECK (
      link_confidence IS NULL OR
      (
        link_confidence >= 0.0000 AND
        link_confidence <= 1.0000
      )
    ),

  CONSTRAINT vehicle_person_links_evidence_is_object
    CHECK (jsonb_typeof(link_evidence) = 'object')
);

-- Duplicate protection: one link per person + vehicle
-- context + relation type. NULL context columns collapse
-- to '' so NULLs cannot bypass uniqueness.
CREATE UNIQUE INDEX IF NOT EXISTS
  idx_vehicle_person_links_identity
  ON vehicle_person_links (
    person_id,
    COALESCE(vehicle_brand, ''),
    COALESCE(vehicle_series, ''),
    COALESCE(vehicle_model, ''),
    relation_type
  );

-- =========================================================
-- 3. PERSON RADAR RUNS
-- =========================================================

CREATE TABLE IF NOT EXISTS person_radar_runs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  status TEXT NOT NULL DEFAULT 'QUEUED',

  request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,

  person_count INTEGER NOT NULL DEFAULT 0,
  completed_person_count INTEGER NOT NULL DEFAULT 0,
  failed_person_count INTEGER NOT NULL DEFAULT 0,

  query_count INTEGER NOT NULL DEFAULT 0,
  succeeded_query_count INTEGER NOT NULL DEFAULT 0,
  item_count INTEGER NOT NULL DEFAULT 0,

  mention_inserted_count INTEGER NOT NULL DEFAULT 0,
  mention_updated_count INTEGER NOT NULL DEFAULT 0,

  signal_inserted_count INTEGER NOT NULL DEFAULT 0,
  signal_updated_count INTEGER NOT NULL DEFAULT 0,

  locked_by TEXT,
  locked_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT person_radar_runs_status_valid
    CHECK (
      status IN (
        'QUEUED',
        'RUNNING',
        'COMPLETED',
        'FAILED',
        'CANCELLED'
      )
    ),

  CONSTRAINT person_radar_runs_counts_nonnegative
    CHECK (
      person_count >= 0 AND
      completed_person_count >= 0 AND
      failed_person_count >= 0 AND
      query_count >= 0 AND
      succeeded_query_count >= 0 AND
      item_count >= 0 AND
      mention_inserted_count >= 0 AND
      mention_updated_count >= 0 AND
      signal_inserted_count >= 0 AND
      signal_updated_count >= 0
    ),

  CONSTRAINT person_radar_runs_request_payload_is_object
    CHECK (jsonb_typeof(request_payload) = 'object'),

  CONSTRAINT person_radar_runs_summary_is_object
    CHECK (jsonb_typeof(summary) = 'object')
);

-- =========================================================
-- 4. PERSON TRAFFIC SIGNALS (one rolling record / person)
-- =========================================================

CREATE TABLE IF NOT EXISTS person_traffic_signals (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  person_id BIGINT NOT NULL
    REFERENCES people(id)
    ON DELETE CASCADE,

  traffic_tier TEXT NOT NULL DEFAULT 'LOW_SIGNAL',
  traffic_score NUMERIC(6, 2) NOT NULL DEFAULT 0,

  vehicle_attention_score NUMERIC(6, 2)
    NOT NULL DEFAULT 0,
  news_coverage_score NUMERIC(6, 2)
    NOT NULL DEFAULT 0,

  vehicle_signal_count INTEGER NOT NULL DEFAULT 0,
  qualified_vehicle_signal_count INTEGER
    NOT NULL DEFAULT 0,
  direct_vehicle_mention_count INTEGER
    NOT NULL DEFAULT 0,
  vehicle_views_total BIGINT NOT NULL DEFAULT 0,
  vehicle_views_max BIGINT NOT NULL DEFAULT 0,

  news_mention_count INTEGER NOT NULL DEFAULT 0,
  publisher_count INTEGER NOT NULL DEFAULT 0,
  query_count INTEGER NOT NULL DEFAULT 0,
  feed_rank_score NUMERIC(6, 2),
  age_hours NUMERIC(18, 2),

  attention_archetypes JSONB NOT NULL
    DEFAULT '[]'::jsonb,
  transformation_tier TEXT NOT NULL DEFAULT 'LOW',
  transformation_potential NUMERIC(6, 2)
    NOT NULL DEFAULT 0,

  representative_headline TEXT,
  representative_url TEXT,
  representative_source TEXT,
  representative_domain TEXT,

  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  provider TEXT NOT NULL,
  resolver_version TEXT NOT NULL,
  raw_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT person_traffic_signals_person_unique
    UNIQUE (person_id),

  CONSTRAINT person_traffic_signals_tier_valid
    CHECK (
      traffic_tier IN (
        'BREAKOUT',
        'ACTIVE',
        'WATCH',
        'LOW_SIGNAL'
      )
    ),

  CONSTRAINT person_traffic_signals_transformation_valid
    CHECK (
      transformation_tier IN (
        'HIGH',
        'MEDIUM',
        'LOW'
      )
    ),

  CONSTRAINT person_traffic_signals_scores_range
    CHECK (
      traffic_score >= 0 AND traffic_score <= 100 AND
      vehicle_attention_score >= 0 AND
      vehicle_attention_score <= 100 AND
      news_coverage_score >= 0 AND
      news_coverage_score <= 100 AND
      transformation_potential >= 0 AND
      transformation_potential <= 100
    ),

  CONSTRAINT person_traffic_signals_feed_rank_range
    CHECK (
      feed_rank_score IS NULL OR
      (
        feed_rank_score >= 0 AND
        feed_rank_score <= 100
      )
    ),

  CONSTRAINT person_traffic_signals_counts_nonnegative
    CHECK (
      vehicle_signal_count >= 0 AND
      qualified_vehicle_signal_count >= 0 AND
      direct_vehicle_mention_count >= 0 AND
      vehicle_views_total >= 0 AND
      vehicle_views_max >= 0 AND
      news_mention_count >= 0 AND
      publisher_count >= 0 AND
      query_count >= 0
    ),

  CONSTRAINT person_traffic_signals_age_nonnegative
    CHECK (
      age_hours IS NULL OR
      age_hours >= 0
    ),

  CONSTRAINT person_traffic_signals_archetypes_is_array
    CHECK (jsonb_typeof(attention_archetypes) = 'array'),

  CONSTRAINT person_traffic_signals_metadata_is_object
    CHECK (jsonb_typeof(raw_metadata) = 'object')
);

-- =========================================================
-- 5. PERSON TRAFFIC MENTIONS
-- =========================================================

CREATE TABLE IF NOT EXISTS person_traffic_mentions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  person_traffic_signal_id BIGINT NOT NULL
    REFERENCES person_traffic_signals(id)
    ON DELETE CASCADE,

  person_id BIGINT NOT NULL
    REFERENCES people(id)
    ON DELETE CASCADE,

  external_key TEXT NOT NULL,

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

  person_match_method TEXT NOT NULL
    DEFAULT 'QUERY_CONTEXT',
  person_confidence NUMERIC(5, 4),

  raw_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- The same article may legitimately mention two
  -- different people, so uniqueness is per person.
  CONSTRAINT person_traffic_mentions_person_key_unique
    UNIQUE (person_id, external_key),

  CONSTRAINT person_traffic_mentions_match_valid
    CHECK (
      person_match_method IN (
        'TITLE_ALIAS',
        'SNIPPET_ALIAS',
        'QUERY_CONTEXT'
      )
    ),

  CONSTRAINT person_traffic_mentions_confidence_range
    CHECK (
      person_confidence IS NULL OR
      (
        person_confidence >= 0.0000 AND
        person_confidence <= 1.0000
      )
    ),

  CONSTRAINT person_traffic_mentions_rank_nonnegative
    CHECK (
      feed_rank IS NULL OR
      feed_rank >= 0
    ),

  CONSTRAINT person_traffic_mentions_snippet_capped
    CHECK (
      snippet IS NULL OR
      char_length(snippet) <= 500
    ),

  CONSTRAINT person_traffic_mentions_metadata_is_object
    CHECK (jsonb_typeof(raw_metadata) = 'object')
);

-- =========================================================
-- INDEXES
-- =========================================================

CREATE INDEX IF NOT EXISTS idx_people_active_name
  ON people(active, canonical_name);

CREATE INDEX IF NOT EXISTS idx_people_role_category
  ON people(role_category);

CREATE INDEX IF NOT EXISTS idx_vehicle_person_links_person
  ON vehicle_person_links(person_id);

CREATE INDEX IF NOT EXISTS idx_vehicle_person_links_brand
  ON vehicle_person_links(vehicle_brand)
  WHERE vehicle_brand IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vehicle_person_links_model
  ON vehicle_person_links(vehicle_model)
  WHERE vehicle_model IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vehicle_person_links_vehicle
  ON vehicle_person_links(vehicle_id)
  WHERE vehicle_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_person_traffic_signals_score
  ON person_traffic_signals(traffic_score DESC);

CREATE INDEX IF NOT EXISTS idx_person_traffic_signals_tier
  ON person_traffic_signals(
    traffic_tier,
    traffic_score DESC
  );

CREATE INDEX IF NOT EXISTS
  idx_person_traffic_signals_transformation
  ON person_traffic_signals(
    transformation_tier,
    transformation_potential DESC
  );

CREATE INDEX IF NOT EXISTS
  idx_person_traffic_signals_last_seen
  ON person_traffic_signals(last_seen_at DESC);

CREATE INDEX IF NOT EXISTS
  idx_person_traffic_mentions_person
  ON person_traffic_mentions(person_id);

CREATE INDEX IF NOT EXISTS
  idx_person_traffic_mentions_signal
  ON person_traffic_mentions(person_traffic_signal_id);

CREATE INDEX IF NOT EXISTS
  idx_person_traffic_mentions_publisher
  ON person_traffic_mentions(publisher_domain);

CREATE INDEX IF NOT EXISTS
  idx_person_traffic_mentions_published
  ON person_traffic_mentions(published_at DESC);

CREATE INDEX IF NOT EXISTS idx_person_radar_runs_status
  ON person_radar_runs(status, created_at);
