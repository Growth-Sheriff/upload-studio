\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'public_app' OR current_user <> 'doadmin' THEN
    RAISE EXCEPTION 'Not the new public application database/admin';
  END IF;
END $$;

-- The worker/web runtime must not be able to migrate or truncate a schema.
-- doadmin remains available only to this one-time setup, outside app env.
GRANT agsu_migrate TO doadmin;
REVOKE ALL ON DATABASE public_app FROM PUBLIC;
GRANT CONNECT ON DATABASE public_app TO agsu_migrate, agsu_app;
GRANT CREATE ON DATABASE public_app TO agsu_migrate;
ALTER SCHEMA public OWNER TO agsu_migrate;
REVOKE CREATE ON DATABASE public_app FROM agsu_migrate;
REVOKE ALL ON DATABASE public_app FROM agsu_app;
GRANT CONNECT ON DATABASE public_app TO agsu_app;
REVOKE ALL ON SCHEMA public FROM PUBLIC, agsu_app;
GRANT USAGE ON SCHEMA public TO agsu_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO agsu_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO agsu_app;
ALTER DEFAULT PRIVILEGES FOR ROLE agsu_migrate IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO agsu_app;
ALTER DEFAULT PRIVILEGES FOR ROLE agsu_migrate IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO agsu_app;
ALTER DEFAULT PRIVILEGES FOR ROLE agsu_migrate REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

ALTER ROLE agsu_app IN DATABASE public_app SET statement_timeout = '30s';
ALTER ROLE agsu_app IN DATABASE public_app SET lock_timeout = '10s';
ALTER ROLE agsu_app IN DATABASE public_app SET idle_in_transaction_session_timeout = '30s';
COMMIT;
