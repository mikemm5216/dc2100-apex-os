-- =========================================================
-- DC 2100 APEX OS
-- Seed Data for MVP Development
-- =========================================================


-- =========================================================
-- 1. COUNTRIES
-- =========================================================

INSERT INTO countries (code, name)
VALUES
  ('US', 'United States'),
  ('JP', 'Japan'),
  ('TW', 'Taiwan'),
  ('CN', 'China'),
  ('DE', 'Germany'),
  ('GB', 'United Kingdom')
ON CONFLICT (code) DO NOTHING;


-- =========================================================
-- 2. VEHICLES
-- =========================================================

INSERT INTO vehicles (
  code,
  name,
  manufacturer,
  country_id,
  category
)
VALUES
(
  'GTO',
  'Black Crow GTO',
  'Pontiac-inspired',
  (SELECT id FROM countries WHERE code = 'US'),
  'Muscle'
),
(
  'MUSTANG',
  'Okinawa Mustang',
  'Ford-inspired',
  (SELECT id FROM countries WHERE code = 'US'),
  'Muscle'
),
(
  'TTRS',
  'Dragon TT RS',
  'Audi-inspired',
  (SELECT id FROM countries WHERE code = 'DE'),
  'Drag Racing'
),
(
  'IMPREZA',
  'Rally Impreza',
  'Subaru-inspired',
  (SELECT id FROM countries WHERE code = 'JP'),
  'Rally'
),
(
  'SUPRA',
  'Golden Demon Supra',
  'Toyota-inspired',
  (SELECT id FROM countries WHERE code = 'JP'),
  'Street Racing'
),
(
  'SU7',
  'Dome White EV',
  'Xiaomi-inspired',
  (SELECT id FROM countries WHERE code = 'CN'),
  'EV'
),
(
  'GT3RS',
  'German Aero Monster',
  'Porsche-inspired',
  (SELECT id FROM countries WHERE code = 'DE'),
  'Track'
),
(
  'EXIGE',
  'British Lightweight Assassin',
  'Lotus-inspired',
  (SELECT id FROM countries WHERE code = 'GB'),
  'Lightweight'
)
ON CONFLICT (code) DO NOTHING;


-- =========================================================
-- 3. SOURCES
-- Synthetic development sources.
-- These are NOT production watchlist URLs.
-- =========================================================

INSERT INTO sources (
  name,
  url,
  platform,
  category,
  country_id,
  priority
)
VALUES
(
  'Seed Drag Racing Watch',
  'https://example.com/seed/drag-racing',
  'YouTube',
  'Drag Racing',
  (SELECT id FROM countries WHERE code = 'US'),
  1
),
(
  'Seed JDM Culture Watch',
  'https://example.com/seed/jdm',
  'YouTube',
  'JDM',
  (SELECT id FROM countries WHERE code = 'JP'),
  1
),
(
  'Seed Taiwan Car Culture',
  'https://example.com/seed/taiwan-cars',
  'YouTube',
  'Street Culture',
  (SELECT id FROM countries WHERE code = 'TW'),
  2
),
(
  'Seed EV Technology Watch',
  'https://example.com/seed/ev-tech',
  'News',
  'EV',
  (SELECT id FROM countries WHERE code = 'CN'),
  2
),
(
  'Seed European Track Watch',
  'https://example.com/seed/euro-track',
  'YouTube',
  'Classic Racing',
  (SELECT id FROM countries WHERE code = 'DE'),
  2
)
ON CONFLICT (url) DO NOTHING;


-- =========================================================
-- 4. SIGNALS
-- 10 synthetic viral signals
-- =========================================================

INSERT INTO signals (
  source_id,
  external_id,
  title,
  url,
  published_at,
  duration_seconds,
  views,
  views_per_day,
  age_hours,
  growth_velocity,
  raw_metrics
)
VALUES

(
  (SELECT id FROM sources WHERE name = 'Seed Drag Racing Watch'),
  'SEED-DRAG-001',
  '3000 HP V8 Drag Monster Breaks Traction',
  'https://example.com/video/seed-drag-001',
  NOW() - INTERVAL '2 days',
  34,
  5800000,
  2900000,
  48,
  95.5000,
  '{"seed": true, "hook": "instant power"}'::jsonb
),

(
  (SELECT id FROM sources WHERE name = 'Seed Drag Racing Watch'),
  'SEED-DRAG-002',
  'Heavy Muscle Car Drift Through Industrial Ruins',
  'https://example.com/video/seed-drag-002',
  NOW() - INTERVAL '4 days',
  41,
  2100000,
  525000,
  96,
  72.1000,
  '{"seed": true, "hook": "unexpected agility"}'::jsonb
),

(
  (SELECT id FROM sources WHERE name = 'Seed JDM Culture Watch'),
  'SEED-JDM-001',
  'Golden Highway Car Attempts Extreme Top Speed Run',
  'https://example.com/video/seed-jdm-001',
  NOW() - INTERVAL '1 day',
  28,
  4100000,
  4100000,
  24,
  98.8000,
  '{"seed": true, "hook": "speed challenge"}'::jsonb
),

(
  (SELECT id FROM sources WHERE name = 'Seed JDM Culture Watch'),
  'SEED-JDM-002',
  'Rally Sedan Saves Impossible Corner on Broken Road',
  'https://example.com/video/seed-jdm-002',
  NOW() - INTERVAL '3 days',
  32,
  3300000,
  1100000,
  72,
  88.3000,
  '{"seed": true, "hook": "impossible save"}'::jsonb
),

(
  (SELECT id FROM sources WHERE name = 'Seed Taiwan Car Culture'),
  'SEED-TW-001',
  'Five Cylinder AWD Launch Shocks the Crowd',
  'https://example.com/video/seed-tw-001',
  NOW() - INTERVAL '12 hours',
  19,
  1800000,
  3600000,
  12,
  99.1000,
  '{"seed": true, "hook": "violent launch"}'::jsonb
),

(
  (SELECT id FROM sources WHERE name = 'Seed Taiwan Car Culture'),
  'SEED-TW-002',
  'Mechanic Tunes Suspension Live During Mountain Run',
  'https://example.com/video/seed-tw-002',
  NOW() - INTERVAL '5 days',
  38,
  980000,
  196000,
  120,
  61.7000,
  '{"seed": true, "hook": "live engineering"}'::jsonb
),

(
  (SELECT id FROM sources WHERE name = 'Seed EV Technology Watch'),
  'SEED-EV-001',
  'Silent Electric Hypercar Launches Against Combustion Cars',
  'https://example.com/video/seed-ev-001',
  NOW() - INTERVAL '18 hours',
  24,
  6200000,
  8266667,
  18,
  99.9000,
  '{"seed": true, "hook": "silence versus noise"}'::jsonb
),

(
  (SELECT id FROM sources WHERE name = 'Seed EV Technology Watch'),
  'SEED-EV-002',
  'AI Torque Vectoring Demonstration on Damaged Road',
  'https://example.com/video/seed-ev-002',
  NOW() - INTERVAL '6 days',
  46,
  1200000,
  200000,
  144,
  66.4000,
  '{"seed": true, "hook": "technology demonstration"}'::jsonb
),

(
  (SELECT id FROM sources WHERE name = 'Seed European Track Watch'),
  'SEED-EU-001',
  'Extreme Aero Car Attacks High Speed Mountain Corner',
  'https://example.com/video/seed-eu-001',
  NOW() - INTERVAL '2 days',
  31,
  2700000,
  1350000,
  48,
  90.2000,
  '{"seed": true, "hook": "aero grip"}'::jsonb
),

(
  (SELECT id FROM sources WHERE name = 'Seed European Track Watch'),
  'SEED-EU-002',
  'Ultra Lightweight Track Car Defeats Bigger Machines',
  'https://example.com/video/seed-eu-002',
  NOW() - INTERVAL '7 days',
  37,
  1900000,
  271428,
  168,
  70.8000,
  '{"seed": true, "hook": "small beats powerful"}'::jsonb
)

ON CONFLICT (source_id, external_id) DO NOTHING;


-- =========================================================
-- 5. CONTENTS
-- 5 DC 2100 content candidates
-- Mixed statuses for Dashboard testing
-- =========================================================

INSERT INTO contents (
  content_id,
  signal_id,
  country_id,
  vehicle_id,
  title,
  status,
  priority,
  notes
)
VALUES

(
  'P0-US-GTO-001',
  (
    SELECT id FROM signals
    WHERE external_id = 'SEED-DRAG-001'
  ),
  (SELECT id FROM countries WHERE code = 'US'),
  (SELECT id FROM vehicles WHERE code = 'GTO'),
  'The Black Crow Returns',
  'DISCOVERED',
  1,
  'Seed candidate: extreme combustion power signal.'
),

(
  'P0-TW-TTRS-001',
  (
    SELECT id FROM signals
    WHERE external_id = 'SEED-TW-001'
  ),
  (SELECT id FROM countries WHERE code = 'TW'),
  (SELECT id FROM vehicles WHERE code = 'TTRS'),
  'The Five-Cylinder Dragon Awakens',
  'ANALYZED',
  1,
  'Seed candidate: Taiwan performance culture angle.'
),

(
  'P0-JP-SUPRA-001',
  (
    SELECT id FROM signals
    WHERE external_id = 'SEED-JDM-001'
  ),
  (SELECT id FROM countries WHERE code = 'JP'),
  (SELECT id FROM vehicles WHERE code = 'SUPRA'),
  'The Golden Demon Top-Speed Run',
  'RECOMMENDED',
  2,
  'Seed candidate: highway speed mythology.'
),

(
  'P0-CN-SU7-001',
  (
    SELECT id FROM signals
    WHERE external_id = 'SEED-EV-001'
  ),
  (SELECT id FROM countries WHERE code = 'CN'),
  (SELECT id FROM vehicles WHERE code = 'SU7'),
  'Silence Enters the Wasteland',
  'CEO_APPROVED',
  1,
  'Seed candidate: EV dominance versus combustion culture.'
),

(
  'P0-DE-GT3RS-001',
  (
    SELECT id FROM signals
    WHERE external_id = 'SEED-EU-001'
  ),
  (SELECT id FROM countries WHERE code = 'DE'),
  (SELECT id FROM vehicles WHERE code = 'GT3RS'),
  'The Aero Machine Attacks the Ruins',
  'PACK_READY',
  2,
  'Seed candidate: precision engineering versus broken terrain.'
)

ON CONFLICT (content_id) DO NOTHING;


-- =========================================================
-- 6. INITIAL STATUS HISTORY
-- =========================================================

INSERT INTO content_status_history (
  content_id,
  from_status,
  to_status,
  changed_by,
  reason,
  metadata
)
SELECT
  id,
  NULL,
  status,
  'seed',
  'Initial MVP seed state',
  '{"seed": true}'::jsonb
FROM contents
WHERE content_id IN (
  'P0-US-GTO-001',
  'P0-TW-TTRS-001',
  'P0-JP-SUPRA-001',
  'P0-CN-SU7-001',
  'P0-DE-GT3RS-001'
);
