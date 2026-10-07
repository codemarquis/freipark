-- FreiPark: seed every German city with >= 100,000 inhabitants, plus Cottbus
-- and Frankfurt (Oder) — 47 cities on top of 004's 33 (80 in total).
-- See SPEC-infra.md § Seeded Cities → Coverage rule.
--
-- List: de.wikipedia "Liste der Großstädte in Deutschland", 2025 Destatis
-- column (79 cities >= 100k; all of 004's are among them). Bremerhaven is
-- deliberately omitted: 'bremen' imports the whole Bremen state extract,
-- which already covers it.
-- Bounding boxes: each city's OSM administrative-boundary relation (id in
-- the comment), via Nominatim, rounded outward to 3 decimals.
-- Overlapping boxes are fine: the import never reassigns city_id.
--
-- After applying, import the new cities, e.g.:
--   python backend/scripts/import_osm.py --city cottbus
-- or everything: python backend/scripts/import_all.py

INSERT INTO cities (slug, name, country_code, geofabrik_url, bbox) VALUES

  -- North Rhine-Westphalia
  -- OSM relation 62564, pop. 263,703 (2025)
  ('aachen', 'Aachen', 'DE',
   'https://download.geofabrik.de/europe/germany/nordrhein-westfalen-latest.osm.pbf',
   ST_MakeEnvelope(5.974, 50.662, 6.219, 50.858, 4326)),
  -- OSM relation 173103, pop. 111,174 (2025)
  ('bergisch-gladbach', 'Bergisch Gladbach', 'DE',
   'https://download.geofabrik.de/europe/germany/nordrhein-westfalen-latest.osm.pbf',
   ST_MakeEnvelope(7.061, 50.919, 7.255, 51.027, 4326)),
  -- OSM relation 62646, pop. 331,419 (2025)
  ('bielefeld', 'Bielefeld', 'DE',
   'https://download.geofabrik.de/europe/germany/nordrhein-westfalen-latest.osm.pbf',
   ST_MakeEnvelope(8.377, 51.914, 8.664, 52.115, 4326)),
  -- OSM relation 62644, pop. 358,880 (2025)
  ('bochum', 'Bochum', 'DE',
   'https://download.geofabrik.de/europe/germany/nordrhein-westfalen-latest.osm.pbf',
   ST_MakeEnvelope(7.102, 51.410, 7.350, 51.532, 4326)),
  -- OSM relation 62634, pop. 118,482 (2025)
  ('bottrop', 'Bottrop', 'DE',
   'https://download.geofabrik.de/europe/germany/nordrhein-westfalen-latest.osm.pbf',
   ST_MakeEnvelope(6.832, 51.497, 7.000, 51.645, 4326)),
  -- OSM relation 62522, pop. 266,199 (2025)
  ('gelsenkirchen', 'Gelsenkirchen', 'DE',
   'https://download.geofabrik.de/europe/germany/nordrhein-westfalen-latest.osm.pbf',
   ST_MakeEnvelope(6.987, 51.480, 7.153, 51.632, 4326)),
  -- OSM relation 1800297, pop. 189,983 (2025)
  ('hagen', 'Hagen', 'DE',
   'https://download.geofabrik.de/europe/germany/nordrhein-westfalen-latest.osm.pbf',
   ST_MakeEnvelope(7.375, 51.264, 7.599, 51.419, 4326)),
  -- OSM relation 62499, pop. 179,108 (2025)
  ('hamm', 'Hamm', 'DE',
   'https://download.geofabrik.de/europe/germany/nordrhein-westfalen-latest.osm.pbf',
   ST_MakeEnvelope(7.674, 51.577, 7.998, 51.745, 4326)),
  -- OSM relation 62396, pop. 156,266 (2025)
  ('herne', 'Herne', 'DE',
   'https://download.geofabrik.de/europe/germany/nordrhein-westfalen-latest.osm.pbf',
   ST_MakeEnvelope(7.123, 51.503, 7.297, 51.574, 4326)),
  -- OSM relation 62748, pop. 230,738 (2025)
  ('krefeld', 'Krefeld', 'DE',
   'https://download.geofabrik.de/europe/germany/nordrhein-westfalen-latest.osm.pbf',
   ST_MakeEnvelope(6.477, 51.285, 6.707, 51.406, 4326)),
  -- OSM relation 62449, pop. 168,299 (2025)
  ('leverkusen', 'Leverkusen', 'DE',
   'https://download.geofabrik.de/europe/germany/nordrhein-westfalen-latest.osm.pbf',
   ST_MakeEnvelope(6.897, 51.011, 7.117, 51.098, 4326)),
  -- OSM relation 58623, pop. 101,298 (2025)
  ('moers', 'Moers', 'DE',
   'https://download.geofabrik.de/europe/germany/nordrhein-westfalen-latest.osm.pbf',
   ST_MakeEnvelope(6.558, 51.390, 6.679, 51.524, 4326)),
  -- OSM relation 62410, pop. 267,176 (2025)
  ('monchengladbach', 'Mönchengladbach', 'DE',
   'https://download.geofabrik.de/europe/germany/nordrhein-westfalen-latest.osm.pbf',
   ST_MakeEnvelope(6.291, 51.085, 6.537, 51.248, 4326)),
  -- OSM relation 62385, pop. 171,674 (2025)
  ('mulheim', 'Mülheim an der Ruhr', 'DE',
   'https://download.geofabrik.de/europe/germany/nordrhein-westfalen-latest.osm.pbf',
   ST_MakeEnvelope(6.806, 51.350, 6.960, 51.472, 4326)),
  -- OSM relation 163307, pop. 153,767 (2025)
  ('neuss', 'Neuss', 'DE',
   'https://download.geofabrik.de/europe/germany/nordrhein-westfalen-latest.osm.pbf',
   ST_MakeEnvelope(6.614, 51.116, 6.799, 51.236, 4326)),
  -- OSM relation 62734, pop. 213,178 (2025)
  ('oberhausen', 'Oberhausen', 'DE',
   'https://download.geofabrik.de/europe/germany/nordrhein-westfalen-latest.osm.pbf',
   ST_MakeEnvelope(6.777, 51.448, 6.931, 51.581, 4326)),
  -- OSM relation 148074, pop. 155,906 (2025)
  ('paderborn', 'Paderborn', 'DE',
   'https://download.geofabrik.de/europe/germany/nordrhein-westfalen-latest.osm.pbf',
   ST_MakeEnvelope(8.636, 51.654, 8.901, 51.801, 4326)),
  -- OSM relation 56665, pop. 114,851 (2025)
  ('recklinghausen', 'Recklinghausen', 'DE',
   'https://download.geofabrik.de/europe/germany/nordrhein-westfalen-latest.osm.pbf',
   ST_MakeEnvelope(7.134, 51.552, 7.297, 51.652, 4326)),
  -- OSM relation 62455, pop. 113,333 (2025)
  ('remscheid', 'Remscheid', 'DE',
   'https://download.geofabrik.de/europe/germany/nordrhein-westfalen-latest.osm.pbf',
   ST_MakeEnvelope(7.131, 51.142, 7.310, 51.227, 4326)),
  -- OSM relation 163256, pop. 102,450 (2025)
  ('siegen', 'Siegen', 'DE',
   'https://download.geofabrik.de/europe/germany/nordrhein-westfalen-latest.osm.pbf',
   ST_MakeEnvelope(7.921, 50.811, 8.128, 50.952, 4326)),
  -- OSM relation 62699, pop. 164,621 (2025)
  ('solingen', 'Solingen', 'DE',
   'https://download.geofabrik.de/europe/germany/nordrhein-westfalen-latest.osm.pbf',
   ST_MakeEnvelope(6.951, 51.114, 7.175, 51.221, 4326)),
  -- OSM relation 62478, pop. 357,243 (2025)
  ('wuppertal', 'Wuppertal', 'DE',
   'https://download.geofabrik.de/europe/germany/nordrhein-westfalen-latest.osm.pbf',
   ST_MakeEnvelope(7.014, 51.165, 7.314, 51.319, 4326)),

  -- Bavaria
  -- OSM relation 62403, pop. 116,450 (2025)
  ('erlangen', 'Erlangen', 'DE',
   'https://download.geofabrik.de/europe/germany/bayern-latest.osm.pbf',
   ST_MakeEnvelope(10.915, 49.532, 11.054, 49.646, 4326)),
  -- OSM relation 62374, pop. 131,344 (2025)
  ('furth', 'Fürth', 'DE',
   'https://download.geofabrik.de/europe/germany/bayern-latest.osm.pbf',
   ST_MakeEnvelope(10.893, 49.435, 11.029, 49.542, 4326)),
  -- OSM relation 62381, pop. 140,799 (2025)
  ('ingolstadt', 'Ingolstadt', 'DE',
   'https://download.geofabrik.de/europe/germany/bayern-latest.osm.pbf',
   ST_MakeEnvelope(11.255, 48.683, 11.504, 48.823, 4326)),
  -- OSM relation 62411, pop. 151,517 (2025)
  ('regensburg', 'Regensburg', 'DE',
   'https://download.geofabrik.de/europe/germany/bayern-latest.osm.pbf',
   ST_MakeEnvelope(12.029, 48.966, 12.192, 49.077, 4326)),
  -- OSM relation 62464, pop. 133,753 (2025)
  ('wurzburg', 'Würzburg', 'DE',
   'https://download.geofabrik.de/europe/germany/bayern-latest.osm.pbf',
   ST_MakeEnvelope(9.871, 49.710, 10.015, 49.846, 4326)),

  -- Baden-Württemberg
  -- OSM relation 62487, pop. 156,092 (2025)
  ('heidelberg', 'Heidelberg', 'DE',
   'https://download.geofabrik.de/europe/germany/baden-wuerttemberg-latest.osm.pbf',
   ST_MakeEnvelope(8.573, 49.352, 8.794, 49.460, 4326)),
  -- OSM relation 62751, pop. 132,516 (2025)
  ('heilbronn', 'Heilbronn', 'DE',
   'https://download.geofabrik.de/europe/germany/baden-wuerttemberg-latest.osm.pbf',
   ST_MakeEnvelope(9.044, 49.092, 9.303, 49.210, 4326)),
  -- OSM relation 62471, pop. 134,422 (2025)
  ('pforzheim', 'Pforzheim', 'DE',
   'https://download.geofabrik.de/europe/germany/baden-wuerttemberg-latest.osm.pbf',
   ST_MakeEnvelope(8.624, 48.819, 8.809, 48.930, 4326)),
  -- OSM relation 2772661, pop. 119,040 (2025)
  ('reutlingen', 'Reutlingen', 'DE',
   'https://download.geofabrik.de/europe/germany/baden-wuerttemberg-latest.osm.pbf',
   ST_MakeEnvelope(9.114, 48.412, 9.256, 48.579, 4326)),
  -- OSM relation 62495, pop. 130,288 (2025)
  ('ulm', 'Ulm', 'DE',
   'https://download.geofabrik.de/europe/germany/baden-wuerttemberg-latest.osm.pbf',
   ST_MakeEnvelope(9.842, 48.306, 10.043, 48.469, 4326)),

  -- Hesse
  -- OSM relation 62581, pop. 168,253 (2025)
  ('darmstadt', 'Darmstadt', 'DE',
   'https://download.geofabrik.de/europe/germany/hessen-latest.osm.pbf',
   ST_MakeEnvelope(8.558, 49.795, 8.750, 49.954, 4326)),
  -- OSM relation 62598, pop. 196,799 (2025)
  ('kassel', 'Kassel', 'DE',
   'https://download.geofabrik.de/europe/germany/hessen-latest.osm.pbf',
   ST_MakeEnvelope(9.351, 51.260, 9.571, 51.370, 4326)),
  -- OSM relation 62695, pop. 133,195 (2025)
  ('offenbach', 'Offenbach am Main', 'DE',
   'https://download.geofabrik.de/europe/germany/hessen-latest.osm.pbf',
   ST_MakeEnvelope(8.722, 50.046, 8.843, 50.138, 4326)),

  -- Lower Saxony
  -- OSM relation 191361, pop. 130,521 (2025)
  ('gottingen', 'Göttingen', 'DE',
   'https://download.geofabrik.de/europe/germany/niedersachsen-latest.osm.pbf',
   ST_MakeEnvelope(9.800, 51.483, 10.054, 51.591, 4326)),
  -- OSM relation 62409, pop. 177,355 (2025)
  ('oldenburg', 'Oldenburg', 'DE',
   'https://download.geofabrik.de/europe/germany/niedersachsen-latest.osm.pbf',
   ST_MakeEnvelope(8.129, 53.083, 8.313, 53.205, 4326)),
  -- OSM relation 62631, pop. 166,257 (2025)
  ('osnabruck', 'Osnabrück', 'DE',
   'https://download.geofabrik.de/europe/germany/niedersachsen-latest.osm.pbf',
   ST_MakeEnvelope(7.929, 52.218, 8.181, 52.338, 4326)),
  -- OSM relation 62659, pop. 104,433 (2025)
  ('salzgitter', 'Salzgitter', 'DE',
   'https://download.geofabrik.de/europe/germany/niedersachsen-latest.osm.pbf',
   ST_MakeEnvelope(10.230, 52.013, 10.508, 52.223, 4326)),
  -- OSM relation 62418, pop. 129,813 (2025)
  ('wolfsburg', 'Wolfsburg', 'DE',
   'https://download.geofabrik.de/europe/germany/niedersachsen-latest.osm.pbf',
   ST_MakeEnvelope(10.647, 52.315, 10.907, 52.496, 4326)),

  -- Rhineland-Palatinate
  -- OSM relation 62652, pop. 100,247 (2025)
  ('kaiserslautern', 'Kaiserslautern', 'DE',
   'https://download.geofabrik.de/europe/germany/rheinland-pfalz-latest.osm.pbf',
   ST_MakeEnvelope(7.627, 49.358, 7.871, 49.496, 4326)),
  -- OSM relation 62512, pop. 113,020 (2025)
  ('koblenz', 'Koblenz', 'DE',
   'https://download.geofabrik.de/europe/germany/rheinland-pfalz-latest.osm.pbf',
   ST_MakeEnvelope(7.478, 50.283, 7.697, 50.410, 4326)),
  -- OSM relation 62347, pop. 177,055 (2025)
  ('ludwigshafen', 'Ludwigshafen am Rhein', 'DE',
   'https://download.geofabrik.de/europe/germany/rheinland-pfalz-latest.osm.pbf',
   ST_MakeEnvelope(8.298, 49.426, 8.477, 49.549, 4326)),
  -- OSM relation 172679, pop. 105,054 (2025)
  ('trier', 'Trier', 'DE',
   'https://download.geofabrik.de/europe/germany/rheinland-pfalz-latest.osm.pbf',
   ST_MakeEnvelope(6.551, 49.698, 6.748, 49.858, 4326)),

  -- Thuringia
  -- OSM relation 62693, pop. 109,353 (2025)
  ('jena', 'Jena', 'DE',
   'https://download.geofabrik.de/europe/germany/thueringen-latest.osm.pbf',
   ST_MakeEnvelope(11.498, 50.856, 11.673, 50.989, 4326)),

  -- Brandenburg
  -- OSM relation 62430, pop. by request
  ('cottbus', 'Cottbus', 'DE',
   'https://download.geofabrik.de/europe/germany/brandenburg-latest.osm.pbf',
   ST_MakeEnvelope(14.273, 51.692, 14.502, 51.865, 4326)),
  -- OSM relation 62523, pop. by request
  ('frankfurt-oder', 'Frankfurt (Oder)', 'DE',
   'https://download.geofabrik.de/europe/germany/brandenburg-latest.osm.pbf',
   ST_MakeEnvelope(14.394, 52.252, 14.602, 52.399, 4326))

ON CONFLICT (slug) DO NOTHING;
