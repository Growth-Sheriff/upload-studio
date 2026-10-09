#!/usr/bin/env bash
set -euo pipefail

# This helper is intentionally pinned to the freshly provisioned public host.
# Never run it through a tenant SSH alias or on another DigitalOcean droplet.
readonly expected_id=607746803
readonly expected_hostname=agsu-public-web
actual_id=$(curl --fail --silent --show-error http://169.254.169.254/metadata/v1/id)
if [[ "$actual_id" != "$expected_id" || "$(hostname)" != "$expected_hostname" ]]; then
  echo 'Refusing to install packages: not the isolated public host.' >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
# The official Cloudsmith apt repository returned HTTP402 on this new host.
# Keep that failed, freshly added source out of future unattended apt updates.
if [[ -f /etc/apt/sources.list.d/caddy-stable.list ]]; then
  mv --no-clobber /etc/apt/sources.list.d/caddy-stable.list /etc/apt/sources.list.d/caddy-stable.list.disabled
fi
readonly version=2.11.7
# Digest from the official GitHub release asset, verified 2026-10-10.
readonly digest=a22b914ffd1958da42bc7ab13b7b62c6100634e0798ab594891d2d61d53ba749
package_dir=$(mktemp -d /tmp/agsu-caddy.XXXXXX)
cleanup() { rm --force -- "$package_dir/caddy.deb"; rmdir -- "$package_dir"; }
trap cleanup EXIT
curl --fail --silent --show-error --location \
  "https://github.com/caddyserver/caddy/releases/download/v${version}/caddy_${version}_linux_amd64.deb" \
  --output "$package_dir/caddy.deb"
actual_digest=$(sha256sum "$package_dir/caddy.deb")
if [[ "${actual_digest%% *}" != "$digest" ]]; then
  echo 'Official release checksum mismatch; refusing installation.' >&2
  exit 1
fi
dpkg --force-confold --install "$package_dir/caddy.deb"
caddy validate --config /etc/caddy/Caddyfile
systemctl restart caddy
caddy version
