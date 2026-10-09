\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() <> 'public_app' OR current_user <> 'agsu_app'
     OR has_schema_privilege(current_user, 'public', 'CREATE')
     OR has_database_privilege(current_user, current_database(), 'CREATE')
     OR has_database_privilege(current_user, current_database(), 'TEMP')
     OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user
                AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls))
     OR current_setting('statement_timeout') <> '30s' THEN
    RAISE EXCEPTION 'Runtime role isolation/timeout failed';
  END IF;
END $$;
SELECT current_database(), current_user, current_setting('statement_timeout') AS statement_timeout,
       has_schema_privilege(current_user, 'public', 'CREATE') AS runtime_schema_create,
       has_database_privilege(current_user, current_database(), 'CREATE') AS runtime_database_create;
SELECT ssl, version FROM pg_stat_ssl WHERE pid = pg_backend_pid();
