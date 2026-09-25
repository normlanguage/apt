import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options });
  if (result.error || result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${result.error?.message ?? result.stderr}`);
  return result.stdout;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function download(url, path, allowMissing = false) {
  const response = await fetch(url);
  if (allowMissing && response.status === 404) return false;
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  writeFileSync(path, Buffer.from(await response.arrayBuffer()));
  return true;
}

function releasePackageIndex(releaseText, packages) {
  const section = /^SHA256:\s*\n((?: .+\n)+)/m.exec(releaseText)?.[1];
  if (!section) throw new Error('Signed Release omits SHA256 checksums');
  const line = section.split('\n').map(value => /^ ([a-fA-F0-9]{64})\s+(\d+)\s+(.+)$/.exec(value)).find(value => value?.[3] === 'main/binary-amd64/Packages');
  if (!line || Number(line[2]) !== packages.length || line[1].toLowerCase() !== sha256(packages)) throw new Error('Signed Packages checksum mismatch');
  const entries = packages.toString('utf8').trim().split(/\n\n+/).map(paragraph => {
    const fields = new Map(paragraph.split('\n').map(value => /^([^:]+):\s*(.*)$/.exec(value)).filter(Boolean).map(value => [value[1], value[2]]));
    if (fields.get('Package') !== 'normlang' || fields.get('Architecture') !== 'amd64') throw new Error('Unexpected package in Norm APT index');
    const version = fields.get('Version');
    const filename = fields.get('Filename');
    if (filename !== `pool/main/n/normlang/normlang_${version}_amd64.deb` || !/^[a-fA-F0-9]{64}$/.test(fields.get('SHA256') ?? '')) throw new Error('Invalid Norm APT package index');
    return [version, { filename, sha256: fields.get('SHA256').toLowerCase() }];
  });
  const index = new Map(entries);
  if (index.size !== entries.length) throw new Error('Duplicate Norm APT package version');
  return index;
}

async function main() {
  if (process.argv.length !== 6) throw new Error('Usage: prepare.mjs <Norm-tooling-directory> <site-url> <output-directory> <tooling-commit>');
  const tooling = resolve(process.argv[2]);
  const site = process.argv[3].replace(/\/$/, '');
  const output = resolve(process.argv[4]);
  const toolingCommit = process.argv[5];
  const renew = process.env.APT_RENEW_SIGNING_KEY === 'true';
  const bootstrap = process.env.APT_BOOTSTRAP === 'true';
  if (!/^https:\/\//.test(site) || !/^[a-fA-F0-9]{40}$/.test(toolingCommit)) throw new Error('Invalid publication identity');
  const { assertSigningKeyLifetime, downloadAttestedReleaseAsset, officialReleaseSources, planPublication } = await import(pathToFileURL(join(tooling, 'cli/compiler/scripts/release-publication.mjs')).href);
  mkdirSync(output, { recursive: true });
  const publicKey = resolve('normlang-archive-keyring.asc');
  const keyListing = run('gpg', ['--show-keys', '--with-colons', publicKey]);
  const fingerprint = keyListing.split('\n').find(line => line.startsWith('fpr:'))?.split(':')[9];
  if (!/^[a-fA-F0-9]{40}$/.test(fingerprint ?? '')) throw new Error('Invalid pinned APT public key');
  assertSigningKeyLifetime(keyListing);
  const selected = officialReleaseSources(tooling);

  let published = null;
  const live = join(output, 'live');
  mkdirSync(live);
  if (await download(`${site}/normlang-archive-keyring.asc`, join(live, 'key.asc'), true)) {
    if (bootstrap) throw new Error('APT site already exists; bootstrap is not allowed');
    const liveFingerprint = run('gpg', ['--show-keys', '--with-colons', join(live, 'key.asc')]).split('\n').find(line => line.startsWith('fpr:'))?.split(':')[9];
    if (liveFingerprint !== fingerprint) throw new Error('Live APT signing fingerprint differs from pinned key');
    await Promise.all(['dists/stable/InRelease', 'dists/stable/main/binary-amd64/Packages', 'publication.json', 'publication.json.asc'].map(async (name, index) => {
      const names = ['InRelease', 'Packages', 'publication.json', 'publication.json.asc'];
      await download(`${site}/${name}`, join(live, names[index]));
    }));
    run('gpg', ['--dearmor', '--output', join(live, 'keyring.gpg'), join(live, 'key.asc')]);
    run('gpgv', ['--keyring', join(live, 'keyring.gpg'), '--output', join(live, 'Release'), join(live, 'InRelease')]);
    run('gpgv', ['--keyring', join(live, 'keyring.gpg'), join(live, 'publication.json.asc'), join(live, 'publication.json')]);
    const index = releasePackageIndex(readFileSync(join(live, 'Release'), 'utf8'), readFileSync(join(live, 'Packages')));
    published = JSON.parse(readFileSync(join(live, 'publication.json'), 'utf8'));
    if (published.schemaVersion !== 1 || !Array.isArray(published.packages) || published.packages.length < 1 || published.packages.length > 2 || published.packages.length !== index.size) throw new Error('Invalid published package record');
    for (const value of published.packages) {
      if (index.get(value.version)?.sha256 !== value.sha256) throw new Error(`Published package identity mismatch: ${value.version}`);
    }
    if (!readFileSync(join(live, 'key.asc')).equals(readFileSync(publicKey)) && !renew) throw new Error('Live APT signing key changed without explicit renewal');
  } else {
    if (renew) throw new Error('Cannot renew an unpublished APT repository');
    if (!bootstrap) throw new Error('APT site missing; initial publication requires explicit bootstrap');
    const deployments = JSON.parse(run('gh', ['api', 'repos/normlanguage/apt/deployments?environment=github-pages&per_page=1']));
    if (deployments.length > 0) throw new Error('Published APT site is missing; refusing bootstrap reset');
  }

  const plan = planPublication(selected, published, renew);
  writeFileSync(join(output, 'plan.json'), JSON.stringify({ schemaVersion: 1, toolingCommit, selected, ...plan }, null, 2) + '\n');
  if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `changed=${plan.changed}\n`, { flag: 'a' });
  if (!plan.changed) {
    console.log(JSON.stringify({ changed: false, selected: selected.map(value => value.version) }));
    return;
  }
  const packages = join(output, 'packages');
  mkdirSync(packages);
  if (published) {
    const index = releasePackageIndex(readFileSync(join(live, 'Release'), 'utf8'), readFileSync(join(live, 'Packages')));
    for (const version of plan.reuse) {
      const value = index.get(version);
      if (!value) throw new Error(`Published package missing: ${version}`);
      const path = join(packages, `normlang_${version}_amd64.deb`);
      await download(`${site}/${value.filename}`, path);
      if (sha256(readFileSync(path)) !== value.sha256) throw new Error(`Live package checksum mismatch: ${version}`);
    }
  }
  for (const version of plan.build) {
    const value = selected.find(item => item.version === version);
    const directory = join(output, 'assets', version);
    downloadAttestedReleaseAsset(value, directory);
  }
  console.log(JSON.stringify({ changed: plan.changed, selected: selected.map(value => value.version), build: plan.build, reuse: plan.reuse }));
}

await main();
