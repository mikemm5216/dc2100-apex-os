-- Vehicle-Person Pair / person-country Fusion v2.
ALTER TABLE people
  ADD COLUMN IF NOT EXISTS life_status TEXT NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS life_status_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS life_status_source TEXT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='people_life_status_valid') THEN
    ALTER TABLE people ADD CONSTRAINT people_life_status_valid
      CHECK (life_status IN ('ALIVE','DECEASED','UNKNOWN'));
  END IF;
END $$;

UPDATE people SET life_status='ALIVE', life_status_verified_at=NOW(),
 life_status_source=CASE slug
  WHEN 'akio-toyoda' THEN 'https://global.toyota/en/company/profile/executives/akio_toyoda.html'
  WHEN 'lei-jun' THEN 'https://ir.mi.com/board-member-management/lei-jun'
  WHEN 'elon-musk' THEN 'https://ir.tesla.com/corporate/elon-musk'
  WHEN 'mate-rimac' THEN 'https://www.rimac-group.com/governance'
  WHEN 'christian-von-koenigsegg' THEN 'https://www.koenigsegg.com/christian-von-koenigsegg/'
  WHEN 'horacio-pagani' THEN 'https://www.pagani.com/press/pagani-automobili-at-the-goodwood-festival-of-speed-world-premiere-of-the-pagani-huayra-70-derecho/' END
WHERE slug IN ('akio-toyoda','lei-jun','elon-musk','mate-rimac','christian-von-koenigsegg','horacio-pagani');

UPDATE people SET life_status='DECEASED', life_status_verified_at=NOW(),
 life_status_source=CASE slug
  WHEN 'enzo-ferrari' THEN 'https://www.ferrari.com/en-EN/magazine/articles/remembering-enzo-the-founder-of-ferrari'
  WHEN 'ferruccio-lamborghini' THEN 'https://www.lamborghini.com/en-en/news/lamborghini-celebrates-the-105th-birthday-of-founder-ferruccio'
  WHEN 'ettore-bugatti' THEN 'https://newsroom.bugatti.com/press-releases/the-bugatti-type-10-ettore-s-first-car-how-everything-began'
  WHEN 'carroll-shelby' THEN 'https://www.shelby.com/teamshelby/en-us/Team-Shelby-Media/A-Life-Well-Lived'
  WHEN 'ken-block' THEN 'https://www.fia.com/news/fia-remembers-inspirational-ken-block'
 END
WHERE slug IN ('enzo-ferrari','ferruccio-lamborghini','ettore-bugatti','carroll-shelby','ken-block');

-- These catalog rows must be available as soon as the migration finishes;
-- production pair runs do not depend on a separate Person Radar run.
INSERT INTO people(slug,canonical_name,country_id,role_category,aliases,metadata,catalog_version,life_status,life_status_verified_at,life_status_source)
SELECT seed.slug,seed.canonical_name,c.id,seed.role_category,seed.aliases::jsonb,'{"priority":2}'::jsonb,'vehicle-person-catalog-v1','ALIVE',NOW(),seed.source
FROM (VALUES
 ('liao-chih-hsien','Liao Chih-hsien','TW','BUILDER_TUNER','["liao chih hsien","廖志賢","廖老大","賽車教父廖老大"]','https://www.cna.com.tw/news/aloc/202204060102.aspx'),
 ('justin-shearer-big-chief','Justin Shearer','US','DRIVER_RACER','["justin shearer","big chief justin shearer","big chief street outlaws"]','https://www.discovery.com/shows/street-outlaws/articles/big-chief-prepares-no-prep-kings-race-debut-trash-talk')
) seed(slug,canonical_name,country_code,role_category,aliases,source)
JOIN countries c ON c.code=seed.country_code
ON CONFLICT(slug) DO UPDATE SET canonical_name=EXCLUDED.canonical_name,country_id=EXCLUDED.country_id,
 role_category=EXCLUDED.role_category,aliases=EXCLUDED.aliases,life_status='ALIVE',
 life_status_verified_at=NOW(),life_status_source=EXCLUDED.life_status_source,updated_at=NOW();

INSERT INTO vehicle_person_links(person_id,vehicle_brand,vehicle_series,vehicle_model,relation_type,link_confidence,link_method,link_evidence)
SELECT p.id,seed.brand,seed.series,seed.model,seed.relation_type,1.0,'CATALOG',jsonb_build_object('source',seed.source,'curated_for','vehicle-person-pair-v2')
FROM (VALUES
 ('liao-chih-hsien','Audi','TT','TT RS','BUILDER','https://www.cna.com.tw/news/aloc/202204060102.aspx'),
 ('justin-shearer-big-chief','Pontiac','Firebird',NULL,'RACING_DRIVER','https://dragillustrated.com/big-chief-dishes-on-nhra-legal-shakedown-runs/'),
 ('lei-jun','Xiaomi',NULL,NULL,'FOUNDER','https://ir.mi.com/board-member-management/lei-jun'),
 ('elon-musk','Tesla',NULL,NULL,'EXECUTIVE','https://ir.tesla.com/corporate/elon-musk')
) seed(slug,brand,series,model,relation_type,source)
JOIN people p ON p.slug=seed.slug
ON CONFLICT(person_id,COALESCE(vehicle_brand,''),COALESCE(vehicle_series,''),COALESCE(vehicle_model,''),relation_type)
DO UPDATE SET link_confidence=EXCLUDED.link_confidence,link_method=EXCLUDED.link_method,
 link_evidence=EXCLUDED.link_evidence,updated_at=NOW()
WHERE vehicle_person_links.locked=FALSE;

CREATE TABLE vehicle_person_pair_runs (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 status TEXT NOT NULL DEFAULT 'QUEUED' CHECK(status IN('QUEUED','RUNNING','COMPLETED','FAILED','CANCELLED')),
 request_payload JSONB NOT NULL DEFAULT '{}', summary JSONB NOT NULL DEFAULT '{}',
 entities_attempted INTEGER NOT NULL DEFAULT 0, candidate_people_attempted INTEGER NOT NULL DEFAULT 0,
 search_queries INTEGER NOT NULL DEFAULT 0, videos_discovered INTEGER NOT NULL DEFAULT 0,
 videos_evaluated INTEGER NOT NULL DEFAULT 0, proven_pairs INTEGER NOT NULL DEFAULT 0,
 founder_fallback_pairs INTEGER NOT NULL DEFAULT 0, no_match_pairs INTEGER NOT NULL DEFAULT 0,
 errors JSONB NOT NULL DEFAULT '[]', error_message TEXT, locked_by TEXT, locked_at TIMESTAMPTZ,
 started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX idx_vehicle_person_pair_runs_active ON vehicle_person_pair_runs((1)) WHERE status IN('QUEUED','RUNNING');

CREATE TABLE vehicle_person_pair_signals (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 run_id BIGINT NOT NULL REFERENCES vehicle_person_pair_runs(id) ON DELETE CASCADE,
 vehicle_id BIGINT NOT NULL REFERENCES vehicles(id), person_id BIGINT NOT NULL REFERENCES people(id),
 vehicle_person_link_id BIGINT NOT NULL REFERENCES vehicle_person_links(id),
 person_country_id BIGINT NOT NULL REFERENCES countries(id), person_role_category TEXT NOT NULL,
 person_life_status TEXT NOT NULL, pair_status TEXT NOT NULL CHECK(pair_status IN('PROVEN_PAIR','CURATED_FOUNDER_FALLBACK','NO_MATCH')),
 pair_specificity TEXT NOT NULL CHECK(pair_specificity IN('EXACT_MODEL','SAME_SERIES','SAME_BRAND')),
 cross_country_pair BOOLEAN NOT NULL, founder_fallback BOOLEAN NOT NULL DEFAULT FALSE,
 founder_fallback_reason TEXT, vehicle_anchor_signal_id BIGINT REFERENCES signals(id),
 vehicle_anchor_video_id TEXT, vehicle_anchor_title TEXT, vehicle_anchor_url TEXT, vehicle_anchor_views BIGINT NOT NULL,
 joint_video_id TEXT, joint_video_title TEXT, joint_video_url TEXT, joint_video_views BIGINT,
 joint_video_published_at TIMESTAMPTZ, joint_video_duration_seconds INTEGER, joint_video_format TEXT,
 search_query TEXT, matched_person_alias TEXT, person_match_field TEXT,
 matched_vehicle_term TEXT, vehicle_match_field TEXT, evidence JSONB NOT NULL DEFAULT '{}',
 person_direct_video_signal_id BIGINT REFERENCES person_direct_video_signals(id), person_direct_video_id TEXT,
 person_direct_video_title TEXT, person_direct_video_url TEXT, person_direct_video_views BIGINT,
 selected BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(run_id,vehicle_id,person_id)
);
CREATE INDEX idx_pair_signals_run_selected ON vehicle_person_pair_signals(run_id,selected,pair_status);

ALTER TABLE fusion_runs ADD COLUMN IF NOT EXISTS pair_run_id BIGINT REFERENCES vehicle_person_pair_runs(id);
ALTER TABLE vehicle_fusion_candidates
 ADD COLUMN IF NOT EXISTS vehicle_person_pair_signal_id BIGINT REFERENCES vehicle_person_pair_signals(id),
 ADD COLUMN IF NOT EXISTS pair_run_id BIGINT REFERENCES vehicle_person_pair_runs(id),
 ADD COLUMN IF NOT EXISTS joint_video_id TEXT,
 ADD COLUMN IF NOT EXISTS joint_video_views BIGINT,
 ADD COLUMN IF NOT EXISTS pair_status TEXT,
 ADD COLUMN IF NOT EXISTS pair_specificity TEXT,
 ADD COLUMN IF NOT EXISTS person_country_id BIGINT REFERENCES countries(id),
 ADD COLUMN IF NOT EXISTS vehicle_country_id BIGINT REFERENCES countries(id),
 ADD COLUMN IF NOT EXISTS cross_country_pair BOOLEAN,
 ADD COLUMN IF NOT EXISTS country_binding TEXT;
