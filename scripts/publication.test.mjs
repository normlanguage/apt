import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSigningKeyLifetime, planPublication, selectCompleteReleases } from './publication.mjs';

const assetName = (version, target) => target === 'win32-x64' ? 'norm.exe' : `norm-v${version}-${target === 'darwin-arm64' ? 'macos-arm64' : 'linux-x64'}.tar.gz`;
const release = (version, missing = []) => ({
  tag_name: `v${version}`,
  draft: false,
  prerelease: false,
  assets: ['norm.exe', `norm-v${version}-linux-x64.tar.gz`, `norm-v${version}-macos-arm64.tar.gz`, `norm-language-support-v${version}.vsix`, 'SHA256SUMS']
    .filter(name => !missing.includes(name)).map(name => ({ name, size: 1, digest: `sha256:${'a'.repeat(64)}` })),
});

test('selects the latest two complete official releases by semantic version', () => {
  const releases = [release('0.23.2'), release('0.24.1', ['SHA256SUMS']), release('0.24.0'), { ...release('9.0.0'), prerelease: true }, release('0.9.0')];
  assert.deepEqual(selectCompleteReleases(releases, ['win32-x64', 'linux-x64', 'darwin-arm64'], assetName).map(value => value.version), ['0.24.0', '0.23.2']);
  assert.throws(() => selectCompleteReleases([release('0.24.0')], ['linux-x64'], assetName), /two complete/i);
  const empty = release('0.25.0');
  empty.assets[0].size = 0;
  const corrupt = release('0.26.0');
  corrupt.assets[3].digest = null;
  const duplicateVsix = release('0.27.0');
  duplicateVsix.assets.push({ name: 'extra.vsix', size: 1, digest: `sha256:${'a'.repeat(64)}` });
  assert.deepEqual(selectCompleteReleases([empty, corrupt, duplicateVsix, release('0.24.0'), release('0.23.2')], ['win32-x64', 'linux-x64', 'darwin-arm64'], assetName).map(value => value.version), ['0.24.0', '0.23.2']);
});

test('reuses unchanged published bytes and refuses a same-version source change', () => {
  const latest = { version: '0.24.0', sourceCommit: 'a'.repeat(40), assetSha256: 'b'.repeat(64) };
  const older = { version: '0.23.2', sourceCommit: 'c'.repeat(40), assetSha256: 'd'.repeat(64) };
  const published = { toolingCommit: 'e'.repeat(40), packages: [{ ...older, sha256: 'f'.repeat(64) }] };
  assert.deepEqual(planPublication([latest, older], published), { changed: true, build: ['0.24.0'], reuse: ['0.23.2'] });
  const complete = { ...published, packages: [{ ...latest, sha256: '1'.repeat(64) }, ...published.packages] };
  assert.deepEqual(planPublication([latest, older], complete), { changed: false, build: [], reuse: ['0.24.0', '0.23.2'] });
  assert.deepEqual(planPublication([latest, older], complete, true), { changed: true, build: [], reuse: ['0.24.0', '0.23.2'] });
  assert.throws(() => planPublication([{ ...latest, assetSha256: '2'.repeat(64) }, older], complete), /same-version/i);
});

test('requires a signing subkey with more than 30 days of validity', () => {
  const key = expires => `pub:::::::::::c:\nsub::::::${expires}:::::s:`;
  const now = Date.UTC(2026, 8, 25);
  assert.doesNotThrow(() => assertSigningKeyLifetime(key(Math.floor(now / 1000) + 31 * 86400), now));
  assert.throws(() => assertSigningKeyLifetime(key(Math.floor(now / 1000) + 30 * 86400), now), /renew/i);
  assert.throws(() => assertSigningKeyLifetime('pub:::::::::::c:', now), /one APT signing subkey/i);
});
