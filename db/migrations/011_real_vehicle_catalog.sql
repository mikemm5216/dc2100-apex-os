-- =========================================================
-- REAL VEHICLE CATALOG BRIDGE
-- Task 3.3F follow-up
--
-- Seeds one real vehicles row per lib/scanner/vehicle-catalog.js
-- MODEL_CATALOG entry (40 total, including the Mitsubishi
-- Triton and Hyundai Ioniq 6 N additions), keyed by the
-- canonical compact(brand + model) code that
-- lookupResolvedVehicleId() now tries first.
--
-- This migration is purely additive:
--   - it never touches the 8 existing fictional MVP rows
--     (GTO, MUSTANG, TTRS, IMPREZA, SUPRA, SU7, GT3RS, EXIGE)
--   - ON CONFLICT (code) DO NOTHING makes it idempotent
--   - it adds no countries; all catalog countryCode values
--     (JP, DE, US, IT, GB, CN, KR, FR, SE, HR) already exist
--     as of migrations 002 and 006.
-- =========================================================

INSERT INTO vehicles (
  code,
  name,
  manufacturer,
  country_id,
  category,
  enabled
)
VALUES
(
  'TOYOTAGRGT', 'GR GT', 'Toyota',
  (SELECT id FROM countries WHERE code = 'JP'),
  'Sports Car', TRUE
),
(
  'TOYOTAGRSUPRA', 'GR Supra', 'Toyota',
  (SELECT id FROM countries WHERE code = 'JP'),
  'Sports Car', TRUE
),
(
  'TOYOTAGR86', 'GR86', 'Toyota',
  (SELECT id FROM countries WHERE code = 'JP'),
  'Sports Car', TRUE
),
(
  'TOYOTAGRYARIS', 'GR Yaris', 'Toyota',
  (SELECT id FROM countries WHERE code = 'JP'),
  'Rally Car', TRUE
),
(
  'XIAOMISU7ULTRA', 'SU7 Ultra', 'Xiaomi',
  (SELECT id FROM countries WHERE code = 'CN'),
  'EV', TRUE
),
(
  'XIAOMISU7', 'SU7', 'Xiaomi',
  (SELECT id FROM countries WHERE code = 'CN'),
  'EV', TRUE
),
(
  'PORSCHE911GT3RS', '911 GT3 RS', 'Porsche',
  (SELECT id FROM countries WHERE code = 'DE'),
  'Sports Car', TRUE
),
(
  'PORSCHE911GT3', '911 GT3', 'Porsche',
  (SELECT id FROM countries WHERE code = 'DE'),
  'Sports Car', TRUE
),
(
  'PORSCHETAYCAN', 'Taycan', 'Porsche',
  (SELECT id FROM countries WHERE code = 'DE'),
  'EV', TRUE
),
(
  'FORDMUSTANG', 'Mustang', 'Ford',
  (SELECT id FROM countries WHERE code = 'US'),
  'Muscle Car', TRUE
),
(
  'BMWM2', 'M2', 'BMW',
  (SELECT id FROM countries WHERE code = 'DE'),
  'Sports Car', TRUE
),
(
  'BMWM3', 'M3', 'BMW',
  (SELECT id FROM countries WHERE code = 'DE'),
  'Sports Car', TRUE
),
(
  'BMWM4', 'M4', 'BMW',
  (SELECT id FROM countries WHERE code = 'DE'),
  'Sports Car', TRUE
),
(
  'BMWM5', 'M5', 'BMW',
  (SELECT id FROM countries WHERE code = 'DE'),
  'Sedan', TRUE
),
(
  'MERCEDESAMGAMGGT', 'AMG GT', 'Mercedes-AMG',
  (SELECT id FROM countries WHERE code = 'DE'),
  'Sports Car', TRUE
),
(
  'NISSANGTR', 'GT-R', 'Nissan',
  (SELECT id FROM countries WHERE code = 'JP'),
  'Sports Car', TRUE
),
(
  'MAZDARX7', 'RX-7', 'Mazda',
  (SELECT id FROM countries WHERE code = 'JP'),
  'Sports Car', TRUE
),
(
  'MAZDAMX5MIATA', 'MX-5 Miata', 'Mazda',
  (SELECT id FROM countries WHERE code = 'JP'),
  'Sports Car', TRUE
),
(
  'SUBARUWRXSTI', 'WRX STI', 'Subaru',
  (SELECT id FROM countries WHERE code = 'JP'),
  'Rally Car', TRUE
),
(
  'SUBARUWRX', 'WRX', 'Subaru',
  (SELECT id FROM countries WHERE code = 'JP'),
  'Sedan', TRUE
),
(
  'CHEVROLETCORVETTE', 'Corvette', 'Chevrolet',
  (SELECT id FROM countries WHERE code = 'US'),
  'Sports Car', TRUE
),
(
  'DODGECHALLENGER', 'Challenger', 'Dodge',
  (SELECT id FROM countries WHERE code = 'US'),
  'Muscle Car', TRUE
),
(
  'DODGECHARGER', 'Charger', 'Dodge',
  (SELECT id FROM countries WHERE code = 'US'),
  'Muscle Car', TRUE
),
(
  'FERRARISF90', 'SF90', 'Ferrari',
  (SELECT id FROM countries WHERE code = 'IT'),
  'Hypercar', TRUE
),
(
  'LAMBORGHINIREVUELTO', 'Revuelto', 'Lamborghini',
  (SELECT id FROM countries WHERE code = 'IT'),
  'Supercar', TRUE
),
(
  'LAMBORGHINIHURACAN', 'Huracan', 'Lamborghini',
  (SELECT id FROM countries WHERE code = 'IT'),
  'Supercar', TRUE
),
(
  'MCLAREN750S', '750S', 'McLaren',
  (SELECT id FROM countries WHERE code = 'GB'),
  'Supercar', TRUE
),
(
  'AUDIRS6', 'RS6', 'Audi',
  (SELECT id FROM countries WHERE code = 'DE'),
  'Wagon', TRUE
),
(
  'AUDITTRS', 'TT RS', 'Audi',
  (SELECT id FROM countries WHERE code = 'DE'),
  'Sports Car', TRUE
),
(
  'HONDACIVICTYPER', 'Civic Type R', 'Honda',
  (SELECT id FROM countries WHERE code = 'JP'),
  'Hatchback', TRUE
),
(
  'HONDACIVIC', 'Civic', 'Honda',
  (SELECT id FROM countries WHERE code = 'JP'),
  'Hatchback', TRUE
),
(
  'HONDANSX', 'NSX', 'Honda',
  (SELECT id FROM countries WHERE code = 'JP'),
  'Sports Car', TRUE
),
(
  'HYUNDAIIONIQ5N', 'Ioniq 5 N', 'Hyundai',
  (SELECT id FROM countries WHERE code = 'KR'),
  'EV', TRUE
),
(
  'LOTUSEXIGE', 'Exige', 'Lotus',
  (SELECT id FROM countries WHERE code = 'GB'),
  'Sports Car', TRUE
),
(
  'MITSUBISHILANCEREVOLUTION', 'Lancer Evolution', 'Mitsubishi',
  (SELECT id FROM countries WHERE code = 'JP'),
  'Rally Car', TRUE
),
(
  'RIMACNEVERA', 'Nevera', 'Rimac',
  (SELECT id FROM countries WHERE code = 'HR'),
  'Hypercar', TRUE
),
(
  'KOENIGSEGGJESKO', 'Jesko', 'Koenigsegg',
  (SELECT id FROM countries WHERE code = 'SE'),
  'Hypercar', TRUE
),
(
  'BUGATTICHIRON', 'Chiron', 'Bugatti',
  (SELECT id FROM countries WHERE code = 'FR'),
  'Hypercar', TRUE
),
(
  'MITSUBISHITRITON', 'Triton', 'Mitsubishi',
  (SELECT id FROM countries WHERE code = 'JP'),
  'Truck', TRUE
),
(
  'HYUNDAIIONIQ6N', 'Ioniq 6 N', 'Hyundai',
  (SELECT id FROM countries WHERE code = 'KR'),
  'EV', TRUE
)
ON CONFLICT (code) DO NOTHING;
