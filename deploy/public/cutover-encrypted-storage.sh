#!/usr/bin/env bash
# Only the NEW isolated review host; never run on custom-app hosts.
set -euo pipefail
phase="${1:-check}"
test "$(hostname)" = agsu-public-web
test "$(curl --fail --silent http://169.254.169.254/metadata/v1/id)" = 607746803
device=/dev/disk/by-id/scsi-0DO_Volume_agsu-public-secure
mountpoint=/mnt/agsu-public-secure
test "$(blkid -s UUID -o value "$device")" = 2a60676d-c49c-4bd1-bd88-be326425fd57
case "$phase" in
  prepare)
    install -d -m 0700 "$mountpoint"
    if ! mountpoint -q "$mountpoint"; then mount "$device" "$mountpoint"; fi
    test "$(findmnt -n -o UUID --target "$mountpoint")" = 2a60676d-c49c-4bd1-bd88-be326425fd57
    install -d -m 0700 "$mountpoint"/{app,docker,containerd,caddy,logs}
    printf 'Encrypted volume mounted. Services unchanged.\n'
    ;;
  cutover)
    # Caller must coordinate the brief NEW-app maintenance window first.
    test -f /run/agsu-storage-maintenance-authorized
    mountpoint -q "$mountpoint"
    test "$(findmnt -n -o UUID --target "$mountpoint")" = 2a60676d-c49c-4bd1-bd88-be326425fd57
    test ! -e /opt/.agsu-public-unencrypted-precutover
    test ! -e /var/lib/.docker-agsu-unencrypted-precutover
    test ! -e /var/lib/.containerd-agsu-unencrypted-precutover
    test ! -e /var/lib/.caddy-agsu-unencrypted-precutover
    test ! -e /var/.logs-agsu-unencrypted-precutover
    # Quiet ingress, stop only this host's six app services, then engines.
    systemctl stop caddy
    docker compose -f /opt/agsu-public/compose.yml --env-file /opt/agsu-public/public.env stop --timeout 30
    systemctl stop docker.service docker.socket containerd.service rsyslog.service syslog.socket
    # Override Ubuntu's later-sorted vendor syslog.conf as well.
    install -D -m 0644 /run/agsu-encryption/journald-volatile.conf /etc/systemd/journald.conf.d/zz-agsu-volatile.conf
    systemctl restart systemd-journald
    cp -a /opt/agsu-public/. "$mountpoint/app/"
    cp -a /var/lib/docker/. "$mountpoint/docker/"
    cp -a /var/lib/containerd/. "$mountpoint/containerd/"
    cp -a /var/lib/caddy/. "$mountpoint/caddy/"
    cp -a /var/log/. "$mountpoint/logs/"
    for pair in /opt/agsu-public:app /var/lib/docker:docker /var/lib/containerd:containerd /var/lib/caddy:caddy /var/log:logs; do
      original="${pair%:*}"; destination="$mountpoint/${pair#*:}"
      chown --reference="$original" "$destination"
      chmod --reference="$original" "$destination"
    done
    mv /opt/agsu-public /opt/.agsu-public-unencrypted-precutover
    mv /var/lib/docker /var/lib/.docker-agsu-unencrypted-precutover
    mv /var/lib/containerd /var/lib/.containerd-agsu-unencrypted-precutover
    mv /var/lib/caddy /var/lib/.caddy-agsu-unencrypted-precutover
    mv /var/log /var/.logs-agsu-unencrypted-precutover
    install -d /opt/agsu-public /var/lib/docker /var/lib/containerd /var/lib/caddy /var/log
    install -m 0644 /run/agsu-encryption/encrypted-host.fstab /etc/fstab
    install -D -m 0644 /run/agsu-encryption/encrypted-docker.json /etc/docker/daemon.json
    install -D -m 0644 /run/agsu-encryption/encrypted-docker.conf /etc/systemd/system/docker.service.d/agsu-encrypted.conf
    install -D -m 0644 /run/agsu-encryption/encrypted-containerd.conf /etc/systemd/system/containerd.service.d/agsu-encrypted.conf
    install -D -m 0644 /run/agsu-encryption/encrypted-caddy.conf /etc/systemd/system/caddy.service.d/agsu-encrypted.conf
    systemctl daemon-reload
    mount /opt/agsu-public
    mount /var/lib/docker
    mount /var/lib/containerd
    mount /var/lib/caddy
    mount /var/log
    # New log defaults apply only when containers are recreated. Existing
    # persisted stdout is already on the encrypted bind mount.
    systemctl start containerd docker syslog.socket rsyslog
    docker compose -f /opt/agsu-public/compose.yml --env-file /opt/agsu-public/public.env up -d --force-recreate
    systemctl start caddy
    printf 'Cutover complete. Verify health, then explicitly purge retired plaintext copies.\n'
    ;;
  check)
    for target in / /mnt/agsu-public-secure /opt/agsu-public /var/lib/docker /var/lib/containerd /var/lib/caddy /var/log; do
      findmnt -n -o SOURCE,TARGET,FSTYPE --target "$target"
    done
    docker info --format '{{.DockerRootDir}} {{.LoggingDriver}}'
    docker inspect auto-gang-sheet-public-web-1 --format '{{json .HostConfig.LogConfig}}'
    systemctl is-active docker containerd caddy rsyslog
    curl --fail --silent --show-error https://auto-gang-sheet.actualscope.com/health
    ;;
  purge)
    # Exact retired paths on NEW host, after healthy encrypted deployment only.
    test -f /run/agsu-storage-maintenance-authorized
    curl --fail --silent https://auto-gang-sheet.actualscope.com/health >/dev/null
    for live in /opt/agsu-public /var/lib/docker /var/lib/containerd /var/lib/caddy /var/log; do
      test "$(findmnt -n -o UUID --target "$live")" = 2a60676d-c49c-4bd1-bd88-be326425fd57
    done
    for retired in /opt/.agsu-public-unencrypted-precutover /var/lib/.docker-agsu-unencrypted-precutover /var/lib/.containerd-agsu-unencrypted-precutover /var/lib/.caddy-agsu-unencrypted-precutover /var/.logs-agsu-unencrypted-precutover; do
      test -d "$retired"
      test "$(readlink -f "$retired")" = "$retired"
      test "$(findmnt -n -o UUID --target "$retired")" != 2a60676d-c49c-4bd1-bd88-be326425fd57
      rm -rf --one-file-system -- "$retired"
    done
    fstrim / || true
    printf 'Retired plaintext copies logically deleted; SSD/provider physical sanitization not proven. Rotate pre-cutover credentials.\n'
    ;;
  *) printf 'Expected prepare, cutover, check or purge\n' >&2; exit 2 ;;
esac
