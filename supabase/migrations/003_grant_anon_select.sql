-- spots_in_bbox uses LANGUAGE sql (caller's rights), so anon needs SELECT
-- on the underlying tables in addition to EXECUTE on the function.
GRANT SELECT ON public.parking_spots TO anon, authenticated;
GRANT SELECT ON public.cities TO anon, authenticated;
