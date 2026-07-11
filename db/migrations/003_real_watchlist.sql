-- Additional operating markets required by the real watchlist.
INSERT INTO countries (code, name, enabled)
VALUES
  ('GB', 'United Kingdom', TRUE),
  ('AU', 'Australia', TRUE),
  ('CA', 'Canada', TRUE),
  ('NL', 'Netherlands', TRUE),
  ('IE', 'Ireland', TRUE),
  ('AE', 'United Arab Emirates', TRUE)
ON CONFLICT (code) DO UPDATE
SET
  name = EXCLUDED.name,
  enabled = TRUE;

-- Preserve development seeds for reference, but exclude them from scanning.
UPDATE sources
SET enabled = FALSE
WHERE url LIKE 'https://example.com/seed/%';

WITH source_data (
  name,
  url,
  platform,
  category,
  country_code,
  priority
) AS (
  VALUES
    -- =====================================================
    -- Automotive / YouTube watchlist: 35
    -- =====================================================
    (
      'Carwow',
      'https://www.youtube.com/@carwow',
      'YouTube',
      'Automotive Media',
      'GB',
      1
    ),
    (
      'Top Gear',
      'https://www.youtube.com/@TopGear',
      'YouTube',
      'Automotive Media',
      'GB',
      1
    ),
    (
      'Hagerty',
      'https://www.youtube.com/@Hagerty',
      'YouTube',
      'Automotive Media',
      'US',
      1
    ),
    (
      'MotorTrend',
      'https://www.youtube.com/@MotorTrendWatch',
      'YouTube',
      'Automotive Media',
      'US',
      1
    ),
    (
      'Throttle House',
      'https://www.youtube.com/@ThrottleHouse',
      'YouTube',
      'Automotive Media',
      'CA',
      1
    ),
    (
      'Doug DeMuro',
      'https://www.youtube.com/@DougDeMuro',
      'YouTube',
      'Automotive Media',
      'US',
      2
    ),
    (
      'Donut',
      'https://www.youtube.com/@donut',
      'YouTube',
      'Automotive Entertainment',
      'US',
      1
    ),
    (
      'Hoonigan',
      'https://www.youtube.com/@Hoonigan',
      'YouTube',
      'Motorsport Culture',
      'US',
      1
    ),
    (
      'Cleetus McFarland',
      'https://www.youtube.com/@CleetusM',
      'YouTube',
      'Drag Racing',
      'US',
      1
    ),
    (
      'Adam LZ',
      'https://www.youtube.com/@AdamLZ',
      'YouTube',
      'Drift Culture',
      'US',
      1
    ),
    (
      'TheSmokingTire',
      'https://www.youtube.com/@TheSmokingTire',
      'YouTube',
      'Automotive Media',
      'US',
      2
    ),
    (
      'Engineering Explained',
      'https://www.youtube.com/@EngineeringExplained',
      'YouTube',
      'Automotive Engineering',
      'US',
      2
    ),
    (
      'Savagegeese',
      'https://www.youtube.com/@savagegeese',
      'YouTube',
      'Automotive Engineering',
      'US',
      2
    ),
    (
      'Misha Charoudin',
      'https://www.youtube.com/@mgcharoudin',
      'YouTube',
      'Nurburgring',
      'DE',
      1
    ),
    (
      'AutoTopNL',
      'https://www.youtube.com/@AutoTopnl',
      'YouTube',
      'Performance Cars',
      'NL',
      1
    ),
    (
      'Nurburgring',
      'https://www.youtube.com/@nuerburgring',
      'YouTube',
      'Motorsport',
      'DE',
      2
    ),
    (
      'Porsche',
      'https://www.youtube.com/@Porsche',
      'YouTube',
      'OEM',
      'DE',
      2
    ),
    (
      'BMW M',
      'https://www.youtube.com/@BMWM',
      'YouTube',
      'OEM Performance',
      'DE',
      2
    ),
    (
      'Mercedes-AMG',
      'https://www.youtube.com/@MercedesAMG',
      'YouTube',
      'OEM Performance',
      'DE',
      2
    ),
    (
      'Audi',
      'https://www.youtube.com/@Audi',
      'YouTube',
      'OEM',
      'DE',
      3
    ),
    (
      'Toyota Gazoo Racing',
      'https://www.youtube.com/@TOYOTAGAZOORacingJP',
      'YouTube',
      'OEM Motorsport',
      'JP',
      1
    ),
    (
      'Nissan',
      'https://www.youtube.com/@Nissan',
      'YouTube',
      'OEM',
      'JP',
      2
    ),
    (
      'Honda',
      'https://www.youtube.com/@Honda',
      'YouTube',
      'OEM',
      'JP',
      2
    ),
    (
      'Subaru',
      'https://www.youtube.com/@subaru',
      'YouTube',
      'OEM',
      'JP',
      2
    ),
    (
      'Mazda',
      'https://www.youtube.com/@MazdaOfficial',
      'YouTube',
      'OEM',
      'JP',
      3
    ),
    (
      'Mitsubishi Motors',
      'https://www.youtube.com/@MitsubishiMotors',
      'YouTube',
      'OEM',
      'JP',
      3
    ),
    (
      'Lexus',
      'https://www.youtube.com/@Lexus',
      'YouTube',
      'OEM',
      'JP',
      2
    ),
    (
      'Hyundai N',
      'https://www.youtube.com/@HyundaiNWorldwide',
      'YouTube',
      'OEM Performance',
      'KR',
      1
    ),
    (
      'Kia Worldwide',
      'https://www.youtube.com/@KiaWorldwideOfficial',
      'YouTube',
      'OEM',
      'KR',
      3
    ),
    (
      'Xiaomi EV',
      'https://www.youtube.com/@xiaomiev',
      'YouTube',
      'EV Technology',
      'CN',
      1
    ),
    (
      'Tesla',
      'https://www.youtube.com/@Tesla',
      'YouTube',
      'EV Technology',
      'US',
      1
    ),
    (
      'Formula DRIFT',
      'https://www.youtube.com/@formuladrift',
      'YouTube',
      'Drift Motorsport',
      'US',
      1
    ),
    (
      'Goodwood Road and Racing',
      'https://www.youtube.com/@GoodwoodRRC',
      'YouTube',
      'Motorsport History',
      'GB',
      2
    ),
    (
      'Gumbal',
      'https://www.youtube.com/@Gumbal',
      'YouTube',
      'Performance Cars',
      'NL',
      2
    ),
    (
      'Jay Leno''s Garage',
      'https://www.youtube.com/@jaylenosgarage',
      'YouTube',
      'Automotive Culture',
      'US',
      2
    ),

    -- =====================================================
    -- News / industry watchlist: 19
    -- =====================================================
    (
      'Reuters Automotive',
      'https://www.reuters.com/business/autos-transportation/',
      'News',
      'Automotive Industry',
      'GB',
      1
    ),
    (
      'Autocar',
      'https://www.autocar.co.uk/',
      'News',
      'Automotive News',
      'GB',
      1
    ),
    (
      'Car and Driver',
      'https://www.caranddriver.com/',
      'News',
      'Automotive News',
      'US',
      1
    ),
    (
      'Road and Track',
      'https://www.roadandtrack.com/',
      'News',
      'Performance Cars',
      'US',
      2
    ),
    (
      'The Drive',
      'https://www.thedrive.com/',
      'News',
      'Automotive News',
      'US',
      1
    ),
    (
      'Jalopnik',
      'https://jalopnik.com/',
      'News',
      'Automotive Culture',
      'US',
      2
    ),
    (
      'Motor1',
      'https://www.motor1.com/',
      'News',
      'Automotive News',
      'US',
      1
    ),
    (
      'InsideEVs',
      'https://insideevs.com/',
      'News',
      'EV Technology',
      'US',
      1
    ),
    (
      'Electrek',
      'https://electrek.co/',
      'News',
      'EV Technology',
      'US',
      1
    ),
    (
      'CleanTechnica',
      'https://cleantechnica.com/',
      'News',
      'Energy Technology',
      'US',
      2
    ),
    (
      'Automotive News',
      'https://www.autonews.com/',
      'News',
      'Automotive Industry',
      'US',
      1
    ),
    (
      'Carscoops',
      'https://www.carscoops.com/',
      'News',
      'Automotive News',
      'US',
      2
    ),
    (
      'PistonHeads',
      'https://www.pistonheads.com/',
      'News',
      'Performance Cars',
      'GB',
      2
    ),
    (
      'Evo',
      'https://www.evo.co.uk/',
      'News',
      'Performance Cars',
      'GB',
      1
    ),
    (
      'Speedhunters',
      'https://www.speedhunters.com/',
      'News',
      'Tuning Culture',
      'GB',
      1
    ),
    (
      'Drive Australia',
      'https://www.drive.com.au/',
      'News',
      'Automotive News',
      'AU',
      2
    ),
    (
      'CarExpert',
      'https://www.carexpert.com.au/',
      'News',
      'Automotive News',
      'AU',
      2
    ),
    (
      'Auto Express',
      'https://www.autoexpress.co.uk/',
      'News',
      'Automotive News',
      'GB',
      2
    ),
    (
      'Racecar Engineering',
      'https://www.racecar-engineering.com/',
      'News',
      'Motorsport Engineering',
      'GB',
      1
    )
)
INSERT INTO sources (
  name,
  url,
  platform,
  category,
  country_id,
  priority,
  enabled
)
SELECT
  source_data.name,
  source_data.url,
  source_data.platform,
  source_data.category,
  countries.id,
  source_data.priority,
  TRUE
FROM source_data
JOIN countries
  ON countries.code = source_data.country_code
ON CONFLICT (url) DO UPDATE
SET
  name = EXCLUDED.name,
  platform = EXCLUDED.platform,
  category = EXCLUDED.category,
  country_id = EXCLUDED.country_id,
  priority = EXCLUDED.priority,
  enabled = TRUE;

DO $$
DECLARE
  total_count INTEGER;
  enabled_count INTEGER;
  seed_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO total_count
  FROM sources;

  SELECT COUNT(*) INTO enabled_count
  FROM sources
  WHERE enabled = TRUE;

  SELECT COUNT(*) INTO seed_count
  FROM sources
  WHERE url LIKE 'https://example.com/seed/%'
    AND enabled = FALSE;

  IF total_count <> 59 THEN
    RAISE EXCEPTION
      'Expected 59 total sources, found %',
      total_count;
  END IF;

  IF enabled_count <> 54 THEN
    RAISE EXCEPTION
      'Expected 54 enabled sources, found %',
      enabled_count;
  END IF;

  IF seed_count <> 5 THEN
    RAISE EXCEPTION
      'Expected 5 disabled seed sources, found %',
      seed_count;
  END IF;
END
$$;
