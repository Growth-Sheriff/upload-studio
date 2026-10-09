#!/usr/bin/env bash
set -euo pipefail
readonly expected_id=607746803
actual_id=$(curl --fail --silent --show-error http://169.254.169.254/metadata/v1/id)
[[ "$actual_id" == "$expected_id" && "$(hostname)" == agsu-public-web ]] || { echo 'Wrong host; SQL refused.' >&2; exit 1; }
readonly action=${1:?action}
export PGHOST=${2:?private-host}
export PGPORT=${3:?port}
export PGUSER=${4:?user}
export PGDATABASE=public_app PGSSLMODE=verify-full PGSSLROOTCERT=/opt/agsu-public/pg-ca.pem
[[ "$PGHOST" == private-agsu-public-pg-* && "$PGPORT" =~ ^[0-9]+$ ]] || { echo 'Wrong database; SQL refused.' >&2; exit 1; }
case "$action:$PGUSER" in
  setup:doadmin) readonly sql=/opt/agsu-public/postgres-roles.sql ;;
  check:agsu_app) readonly sql=/opt/agsu-public/postgres-role-check.sql ;;
  *) echo 'Unexpected SQL role or action.' >&2; exit 1 ;;
esac

# Only a short-lived root-only password file, no credential in argv or env.
umask 077
export PGPASSFILE
PGPASSFILE=$(mktemp /tmp/agsu-pgpass.XXXXXX)
cleanup() { rm --force -- "$PGPASSFILE"; }
trap cleanup EXIT
IFS= read -r pass_line
printf '%s\n' "$pass_line" > "$PGPASSFILE"
unset pass_line
psql --no-psqlrc --set ON_ERROR_STOP=1 --file "$sql"
