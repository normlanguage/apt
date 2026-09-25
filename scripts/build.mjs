import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options });
  if (result.error || result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${result.error?.message ?? result.stderr}`);
  return result.stdout;
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

if (process.argv.length !== 7) throw new Error('Usage: build.mjs <Norm-tooling-directory> <input-directory> <output-directory> <signing-fingerprint> <pinned-public-key>');
const tooling = resolve(process.argv[2]);
const input = resolve(process.argv[3]);
const output = resolve(process.argv[4]);
const fingerprint = process.argv[5];
const pinnedKey = resolve(process.argv[6]);
const plan = JSON.parse(readFileSync(join(input, 'plan.json'), 'utf8'));
if (plan.schemaVersion !== 2 || !plan.changed || plan.selected.length !== 2 || !/^[a-fA-F0-9]{40}$/.test(fingerprint)) throw new Error('Invalid APT publication plan');
const keyringConfig = readFileSync('keyring.json');
const keyringIdentity = JSON.parse(keyringConfig.toString());
if (`${keyringIdentity.packageVersion}-${keyringIdentity.packageRelease}` !== plan.releaseIdentity || createHash('sha256').update(keyringConfig).update(readFileSync(pinnedKey)).digest('hex') !== plan.releaseContentSha256) throw new Error('APT keyring content differs from publication plan');
const actualFingerprint = run('gpg', ['--with-colons', '--list-secret-keys', fingerprint]).split('\n').find(line => line.startsWith('fpr:'))?.split(':')[9];
if (actualFingerprint !== fingerprint) throw new Error('APT signing key identity mismatch');
const exportedKey = run('gpg', ['--batch', '--armor', '--export', fingerprint]);
if (exportedKey.trim() !== readFileSync(pinnedKey, 'utf8').trim()) throw new Error('APT signing key differs from pinned public key');
const packages = join(output, 'packages');
mkdirSync(packages, { recursive: true });
const packageRecords = [];
for (const value of plan.selected) {
  const name = `normlang_${value.version}_amd64.deb`;
  const destination = join(packages, name);
  if (plan.build.includes(value.version)) {
    run('node', [join(tooling, 'cli/compiler/scripts/apt-repository.mjs'), 'package', value.version, join(input, 'assets', value.version), packages]);
  } else if (plan.reuse.includes(value.version)) {
    copyFileSync(join(input, 'packages', name), destination);
  } else throw new Error(`Unplanned APT version: ${value.version}`);
  if (run('dpkg-deb', ['--field', destination, 'Version']).trim() !== value.version) throw new Error(`Debian package version mismatch: ${value.version}`);
  const hash = sha256(destination);
  const prior = plan.reuse.includes(value.version) ? JSON.parse(readFileSync(join(input, 'live', 'publication.json'), 'utf8')).packages.find(item => item.version === value.version) : null;
  if (prior && prior.sha256 !== hash) throw new Error(`Published same-version package changed: ${value.version}`);
  packageRecords.push({ version: value.version, sourceCommit: value.sourceCommit, assetSha256: value.assetSha256, sha256: hash, toolingCommit: prior?.toolingCommit ?? (prior ? JSON.parse(readFileSync(join(input, 'live', 'publication.json'), 'utf8')).toolingCommit : plan.toolingCommit) });
}
const keyringName = `normlang-archive-keyring_${plan.releaseIdentity}_all.deb`;
const keyringPath = join(packages, keyringName);
const published = existsSync(join(input, 'live', 'publication.json')) ? JSON.parse(readFileSync(join(input, 'live', 'publication.json'), 'utf8')) : null;
const priorPublication = plan.releaseChanged ? null : published;
if (plan.releaseChanged) run('node', [join(tooling, 'cli/compiler/scripts/apt-repository.mjs'), 'keyring', plan.releaseIdentity, pinnedKey, packages]);
else copyFileSync(join(input, 'packages', keyringName), keyringPath);
if (run('dpkg-deb', ['--field', keyringPath, 'Version']).trim() !== plan.releaseIdentity || run('dpkg-deb', ['--field', keyringPath, 'Package']).trim() !== 'normlang-archive-keyring') throw new Error('APT keyring package identity mismatch');
const keyringHash = sha256(keyringPath);
if (priorPublication?.releasePackage?.sha256 !== undefined && priorPublication.releasePackage.sha256 !== keyringHash) throw new Error('Published same-version keyring package changed');
const [keyringVersion, keyringRelease] = plan.releaseIdentity.split('-');
const releasePackage = { identity: plan.releaseIdentity, version: keyringVersion, release: keyringRelease, releaseContentSha256: plan.releaseContentSha256, sha256: keyringHash, toolingCommit: priorPublication?.releasePackage?.toolingCommit ?? plan.toolingCommit };
const repository = join(output, 'apt-repository');
run('node', [join(tooling, 'cli/compiler/scripts/apt-repository.mjs'), 'repository', packages, repository, fingerprint]);
const oldPackages = join(output, 'old-packages');
mkdirSync(oldPackages);
copyFileSync(join(packages, `normlang_${plan.selected[1].version}_amd64.deb`), join(oldPackages, `normlang_${plan.selected[1].version}_amd64.deb`));
const oldKeyringName = published?.releasePackage ? `normlang-archive-keyring_${published.releasePackage.identity}_all.deb` : keyringName;
copyFileSync(published?.releasePackage ? join(input, 'packages', oldKeyringName) : keyringPath, join(oldPackages, oldKeyringName));
run('node', [join(tooling, 'cli/compiler/scripts/apt-repository.mjs'), 'repository', oldPackages, join(output, 'apt-repository-old'), fingerprint]);
const record = join(repository, 'publication.json');
writeFileSync(record, JSON.stringify({ schemaVersion: 2, toolingCommit: plan.toolingCommit, packages: packageRecords, releasePackage }, null, 2) + '\n');
run('gpg', ['--batch', '--yes', '--local-user', fingerprint, '--armor', '--detach-sign', '--output', `${record}.asc`, record]);
console.log(JSON.stringify({ versions: packageRecords.map(item => item.version), hashes: packageRecords.map(item => item.sha256) }));
