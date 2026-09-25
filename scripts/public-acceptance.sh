#!/bin/bash
set -euo pipefail

site="$1"
current="$2"
previous="$3"
source_file=/etc/apt/sources.list.d/normlang.sources
keyring=/usr/share/keyrings/normlang-archive-keyring.asc

test "$(id -u)" -eq 0
test "$(dpkg --print-architecture)" = amd64
[[ "$site" == https://* ]]
[[ "$current" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
[[ "$previous" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
test ! -e "$source_file"
test ! -e "$keyring"
! id normapt-public >/dev/null 2>&1
! dpkg-query -W -f='${Status}' normlang 2>/dev/null | grep -q 'install ok installed'

cleanup() {
  result=$?
  set +e
  if [[ "${installed:-}" == yes ]]; then apt-get remove -y normlang; fi
  if [[ "${keyring_installed:-}" == yes ]]; then apt-get remove -y normlang-archive-keyring; fi
  if [[ "${user_created:-}" == yes ]]; then userdel -r normapt-public; fi
  if [[ "${source_created:-}" == yes ]]; then rm -f "$source_file"; fi
  if [[ "${key_created:-}" == yes ]]; then rm -f "$keyring"; fi
  exit "$result"
}
trap cleanup EXIT

curl --fail --silent --show-error "$site/normlang-archive-keyring.asc" -o "$keyring"
key_created=yes
cmp "$keyring" normlang-archive-keyring.asc
printf 'Types: deb\nURIs: %s\nSuites: stable\nComponents: main\nArchitectures: amd64\nSigned-By: %s\n' "$site" "$keyring" > "$source_file"
source_created=yes
source_digest="$(sha256sum "$source_file")"
apt-get update
apt-get install -y normlang-archive-keyring
keyring_installed=yes
dpkg-query -S "$keyring" | grep -F 'normlang-archive-keyring:'
cmp "$keyring" normlang-archive-keyring.asc
useradd --create-home --shell /bin/sh normapt-public
user_created=yes
install -d -o normapt-public -g normapt-public /home/normapt-public/project
install -m 644 -o normapt-public -g normapt-public norm-tooling/cli/compiler/scripts/fixtures/hello.norm /home/normapt-public/project/hello.norm

installed=yes
apt-get install -y "normlang=$previous"
runuser -u normapt-public -- norm --version | grep -Fx "norm $previous"
apt-get update
apt-get upgrade -y
runuser -u normapt-public -- norm --version | grep -Fx "norm $current"
runuser -u normapt-public -- sh -c 'cd /home/normapt-public/project && norm run hello.norm' | grep -Fx 'Hello from Norm'
test "$(dpkg-query -W -f='${Version}' normlang)" = "$current"
cmp "$keyring" normlang-archive-keyring.asc
test "$(sha256sum "$source_file")" = "$source_digest"
apt-get remove -y normlang
installed=no
test ! -e /usr/bin/norm
test ! -e /usr/lib/normlang
test -f /home/normapt-public/project/hello.norm
test -e "$keyring"
