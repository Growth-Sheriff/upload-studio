





UPDATE shops
SET storage_provider = 'local'
WHERE storage_provider != 'local' OR storage_provider IS NULL;



UPDATE shops
SET storage_config_json = '{"_deprecated": true, "_migratedAt": "' || NOW() || '"}'::jsonb
WHERE storage_config_json IS NOT NULL
  AND storage_config_json != '{}'::jsonb
  AND storage_config_json->>'_deprecated' IS NULL;


DO $$
DECLARE
  non_local_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO non_local_count
  FROM shops
  WHERE storage_provider != 'local';

  IF non_local_count > 0 THEN
    RAISE EXCEPTION 'Migration failed: % shops still not using local storage', non_local_count;
  END IF;

  RAISE NOTICE 'Migration successful: All shops now use local storage';
END $$;
