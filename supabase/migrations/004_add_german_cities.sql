-- FreiPark: seed major German cities
-- City-states (Berlin, Hamburg, Bremen) use a full city-level PBF → no bbox needed.
-- All other cities reference the Bundesland PBF; the import script runs
-- `osmium extract --bbox` to carve out just the city area before tag-filtering.
--
-- Run via: supabase db push

INSERT INTO cities (slug, name, country_code, geofabrik_url, bbox) VALUES

  -- City-states: full PBF = the city, no bbox
  ('hamburg', 'Hamburg', 'DE',
   'https://download.geofabrik.de/europe/germany/hamburg-latest.osm.pbf',
   NULL),
  ('bremen', 'Bremen', 'DE',
   'https://download.geofabrik.de/europe/germany/bremen-latest.osm.pbf',
   NULL),

  -- Bavaria
  ('munich', 'Munich', 'DE',
   'https://download.geofabrik.de/europe/germany/bayern-latest.osm.pbf',
   ST_MakeEnvelope(11.36, 48.06, 11.72, 48.25, 4326)),
  ('nuremberg', 'Nuremberg', 'DE',
   'https://download.geofabrik.de/europe/germany/bayern-latest.osm.pbf',
   ST_MakeEnvelope(10.96, 49.39, 11.17, 49.52, 4326)),
  ('augsburg', 'Augsburg', 'DE',
   'https://download.geofabrik.de/europe/germany/bayern-latest.osm.pbf',
   ST_MakeEnvelope(10.83, 48.30, 10.96, 48.43, 4326)),

  -- North Rhine-Westphalia
  ('cologne', 'Cologne', 'DE',
   'https://download.geofabrik.de/europe/germany/nordrhein-westfalen-latest.osm.pbf',
   ST_MakeEnvelope(6.77, 50.83, 7.16, 51.09, 4326)),
  ('dusseldorf', 'Düsseldorf', 'DE',
   'https://download.geofabrik.de/europe/germany/nordrhein-westfalen-latest.osm.pbf',
   ST_MakeEnvelope(6.69, 51.12, 6.90, 51.35, 4326)),
  ('dortmund', 'Dortmund', 'DE',
   'https://download.geofabrik.de/europe/germany/nordrhein-westfalen-latest.osm.pbf',
   ST_MakeEnvelope(7.30, 51.44, 7.65, 51.60, 4326)),
  ('essen', 'Essen', 'DE',
   'https://download.geofabrik.de/europe/germany/nordrhein-westfalen-latest.osm.pbf',
   ST_MakeEnvelope(6.89, 51.37, 7.14, 51.52, 4326)),
  ('duisburg', 'Duisburg', 'DE',
   'https://download.geofabrik.de/europe/germany/nordrhein-westfalen-latest.osm.pbf',
   ST_MakeEnvelope(6.64, 51.35, 6.85, 51.53, 4326)),
  ('bonn', 'Bonn', 'DE',
   'https://download.geofabrik.de/europe/germany/nordrhein-westfalen-latest.osm.pbf',
   ST_MakeEnvelope(7.01, 50.63, 7.22, 50.78, 4326)),
  ('munster', 'Münster', 'DE',
   'https://download.geofabrik.de/europe/germany/nordrhein-westfalen-latest.osm.pbf',
   ST_MakeEnvelope(7.53, 51.88, 7.74, 52.02, 4326)),

  -- Hesse
  ('frankfurt', 'Frankfurt', 'DE',
   'https://download.geofabrik.de/europe/germany/hessen-latest.osm.pbf',
   ST_MakeEnvelope(8.47, 50.01, 8.80, 50.24, 4326)),
  ('wiesbaden', 'Wiesbaden', 'DE',
   'https://download.geofabrik.de/europe/germany/hessen-latest.osm.pbf',
   ST_MakeEnvelope(8.14, 50.01, 8.34, 50.12, 4326)),

  -- Baden-Württemberg
  ('stuttgart', 'Stuttgart', 'DE',
   'https://download.geofabrik.de/europe/germany/baden-wuerttemberg-latest.osm.pbf',
   ST_MakeEnvelope(9.03, 48.69, 9.32, 48.87, 4326)),
  ('karlsruhe', 'Karlsruhe', 'DE',
   'https://download.geofabrik.de/europe/germany/baden-wuerttemberg-latest.osm.pbf',
   ST_MakeEnvelope(8.30, 48.93, 8.51, 49.08, 4326)),
  ('freiburg', 'Freiburg', 'DE',
   'https://download.geofabrik.de/europe/germany/baden-wuerttemberg-latest.osm.pbf',
   ST_MakeEnvelope(7.77, 47.94, 7.93, 48.04, 4326)),
  ('mannheim', 'Mannheim', 'DE',
   'https://download.geofabrik.de/europe/germany/baden-wuerttemberg-latest.osm.pbf',
   ST_MakeEnvelope(8.42, 49.43, 8.57, 49.56, 4326)),

  -- Saxony
  ('dresden', 'Dresden', 'DE',
   'https://download.geofabrik.de/europe/germany/sachsen-latest.osm.pbf',
   ST_MakeEnvelope(13.59, 50.97, 13.97, 51.18, 4326)),
  ('leipzig', 'Leipzig', 'DE',
   'https://download.geofabrik.de/europe/germany/sachsen-latest.osm.pbf',
   ST_MakeEnvelope(12.24, 51.24, 12.54, 51.44, 4326)),
  ('chemnitz', 'Chemnitz', 'DE',
   'https://download.geofabrik.de/europe/germany/sachsen-latest.osm.pbf',
   ST_MakeEnvelope(12.79, 50.77, 12.99, 50.87, 4326)),

  -- Lower Saxony
  ('hannover', 'Hannover', 'DE',
   'https://download.geofabrik.de/europe/germany/niedersachsen-latest.osm.pbf',
   ST_MakeEnvelope(9.62, 52.30, 9.93, 52.45, 4326)),
  ('braunschweig', 'Braunschweig', 'DE',
   'https://download.geofabrik.de/europe/germany/niedersachsen-latest.osm.pbf',
   ST_MakeEnvelope(10.44, 52.21, 10.61, 52.33, 4326)),

  -- Brandenburg
  ('potsdam', 'Potsdam', 'DE',
   'https://download.geofabrik.de/europe/germany/brandenburg-latest.osm.pbf',
   ST_MakeEnvelope(12.93, 52.34, 13.17, 52.45, 4326)),

  -- Rhineland-Palatinate
  ('mainz', 'Mainz', 'DE',
   'https://download.geofabrik.de/europe/germany/rheinland-pfalz-latest.osm.pbf',
   ST_MakeEnvelope(8.17, 49.96, 8.32, 50.04, 4326)),

  -- Saxony-Anhalt
  ('halle', 'Halle', 'DE',
   'https://download.geofabrik.de/europe/germany/sachsen-anhalt-latest.osm.pbf',
   ST_MakeEnvelope(11.90, 51.44, 12.07, 51.53, 4326)),
  ('magdeburg', 'Magdeburg', 'DE',
   'https://download.geofabrik.de/europe/germany/sachsen-anhalt-latest.osm.pbf',
   ST_MakeEnvelope(11.54, 52.06, 11.73, 52.19, 4326)),

  -- Thuringia
  ('erfurt', 'Erfurt', 'DE',
   'https://download.geofabrik.de/europe/germany/thueringen-latest.osm.pbf',
   ST_MakeEnvelope(10.94, 50.94, 11.08, 51.03, 4326)),

  -- Schleswig-Holstein
  ('kiel', 'Kiel', 'DE',
   'https://download.geofabrik.de/europe/germany/schleswig-holstein-latest.osm.pbf',
   ST_MakeEnvelope(10.07, 54.27, 10.22, 54.38, 4326)),
  ('lubeck', 'Lübeck', 'DE',
   'https://download.geofabrik.de/europe/germany/schleswig-holstein-latest.osm.pbf',
   ST_MakeEnvelope(10.63, 53.82, 10.82, 53.93, 4326)),

  -- Mecklenburg-Vorpommern
  ('rostock', 'Rostock', 'DE',
   'https://download.geofabrik.de/europe/germany/mecklenburg-vorpommern-latest.osm.pbf',
   ST_MakeEnvelope(12.02, 54.04, 12.22, 54.18, 4326)),

  -- Saarland
  ('saarbrucken', 'Saarbrücken', 'DE',
   'https://download.geofabrik.de/europe/germany/saarland-latest.osm.pbf',
   ST_MakeEnvelope(6.94, 49.19, 7.07, 49.27, 4326))

ON CONFLICT (slug) DO NOTHING;
