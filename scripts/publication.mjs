const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function compareVersions(left, right) {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

export function selectCompleteReleases(releases, targets, assetName) {
  const complete = releases.flatMap(release => {
    if (release.draft || release.prerelease || !release.tag_name?.startsWith('v')) return [];
    const version = release.tag_name.slice(1);
    if (!versionPattern.test(version)) return [];
    const assets = new Map(release.assets?.map(asset => [asset.name, asset]) ?? []);
    const required = [...targets.map(target => assetName(version, target)), `norm-language-support-v${version}.vsix`, 'SHA256SUMS'];
    if (assets.size !== release.assets?.length || release.assets.filter(asset => asset.name.endsWith('.vsix')).length !== 1) return [];
    if (required.some(name => !Number.isSafeInteger(assets.get(name)?.size) || assets.get(name).size <= 0 || !/^sha256:[a-fA-F0-9]{64}$/.test(assets.get(name)?.digest ?? ''))) return [];
    const linux = assets.get(assetName(version, 'linux-x64'));
    return [{ version, tag: release.tag_name, assetName: linux.name, assetSha256: linux.digest.slice(7).toLowerCase() }];
  }).sort((left, right) => compareVersions(right.version, left.version));
  if (complete.length < 2) throw new Error('At least two complete official releases are required');
  return complete.slice(0, 2);
}

export function planPublication(selected, published, renew = false) {
  if (!published) return { changed: true, build: selected.map(value => value.version), reuse: [] };
  if (published.packages.some(value => compareVersions(value.version, selected[0].version) > 0)) throw new Error('Refusing release downgrade');
  const existing = new Map(published.packages.map(value => [value.version, value]));
  const build = [];
  const reuse = [];
  for (const release of selected) {
    const prior = existing.get(release.version);
    if (!prior) build.push(release.version);
    else {
      if (prior.sourceCommit !== release.sourceCommit || prior.assetSha256 !== release.assetSha256) {
        throw new Error(`Published same-version source changed: ${release.version}`);
      }
      reuse.push(release.version);
    }
  }
  return { changed: build.length > 0 || renew, build, reuse };
}

export function assertSigningKeyLifetime(keyListing, now = Date.now()) {
  const signingSubkeys = keyListing.split('\n').filter(line => {
    const fields = line.split(':');
    return fields[0] === 'sub' && fields[11]?.toLowerCase().includes('s');
  });
  if (signingSubkeys.length !== 1) throw new Error('Expected one APT signing subkey');
  const expires = Number(signingSubkeys[0].split(':')[6]);
  if (!Number.isSafeInteger(expires) || expires * 1000 <= now + 30 * 24 * 60 * 60 * 1000) {
    throw new Error('APT signing subkey expires within 30 days; explicitly renew and review the public key');
  }
}
