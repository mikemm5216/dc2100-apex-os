-- =========================================================
-- COUNTRY + PERSON DUAL-VIDEO SIGNAL PACKS
--
-- A signal item is always ONE specific video. This migration
-- adds the two SMALL tables needed to persist the two new
-- single-video Hook roles that don't already have a home:
--
--   country_event_video_signals -- the one video matched to a
--   CURRENT country_news_signals event (a country identity
--   video already lives on `signals.resolved_country_id` and
--   needs no new table).
--
--   person_direct_video_signals -- the one video where a
--   person is DIRECTLY mentioned (title / channel), as
--   opposed to a merely-associated vehicle video (which
--   already lives on `signals` + `vehicle_person_links` and
--   needs no new table either).
--
-- Both tables are upsert caches: the API recomputes the
-- current best match on read and upserts it here so the
-- resolved Hook video and its evidence are durable and
-- auditable. They reference existing rows only -- no video
-- metadata is duplicated. The migration runner wraps this
-- file in a transaction, so no BEGIN / COMMIT here.
-- =========================================================

CREATE TABLE IF NOT EXISTS country_event_video_signals (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  country_news_signal_id BIGINT NOT NULL
    REFERENCES country_news_signals(id)
    ON DELETE CASCADE,

  country_id BIGINT NOT NULL
    REFERENCES countries(id)
    ON DELETE CASCADE,

  signal_id BIGINT NOT NULL
    REFERENCES signals(id)
    ON DELETE CASCADE,

  matched_country_term TEXT,
  matched_event_term TEXT,

  views_per_hour_at_match NUMERIC(18, 4),

  relevance_evidence JSONB NOT NULL DEFAULT '{}'::jsonb,

  resolver_version TEXT NOT NULL
    DEFAULT 'country-event-video-rules-v1',

  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT country_event_video_signals_unique
    UNIQUE (country_news_signal_id, signal_id),

  CONSTRAINT country_event_video_signals_evidence_is_object
    CHECK (jsonb_typeof(relevance_evidence) = 'object')
);

CREATE INDEX IF NOT EXISTS
  idx_country_event_video_signals_country
  ON country_event_video_signals(country_id);

CREATE INDEX IF NOT EXISTS
  idx_country_event_video_signals_signal
  ON country_event_video_signals(signal_id);

CREATE TABLE IF NOT EXISTS person_direct_video_signals (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  person_id BIGINT NOT NULL
    REFERENCES people(id)
    ON DELETE CASCADE,

  signal_id BIGINT NOT NULL
    REFERENCES signals(id)
    ON DELETE CASCADE,

  matched_alias TEXT NOT NULL,

  direct_mention_field TEXT NOT NULL,

  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,

  resolver_version TEXT NOT NULL
    DEFAULT 'person-direct-video-rules-v1',

  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT person_direct_video_signals_unique
    UNIQUE (person_id, signal_id),

  CONSTRAINT person_direct_video_signals_field_valid
    CHECK (
      direct_mention_field IN (
        'TITLE',
        'CHANNEL_TITLE'
      )
    ),

  CONSTRAINT person_direct_video_signals_evidence_is_object
    CHECK (jsonb_typeof(evidence) = 'object')
);

CREATE INDEX IF NOT EXISTS
  idx_person_direct_video_signals_person
  ON person_direct_video_signals(person_id);

CREATE INDEX IF NOT EXISTS
  idx_person_direct_video_signals_signal
  ON person_direct_video_signals(signal_id);
