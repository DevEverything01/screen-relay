import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { after, test } from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildSync } from 'esbuild';

const root = fileURLToPath(new URL('../..', import.meta.url));
const directory = mkdtempSync(join(tmpdir(), 'relay-packages-test-'));
after(() => rmSync(directory, { recursive: true, force: true }));
const bundle = buildSync({
  entryPoints: [join(root, 'src/cli/host/packages.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  loader: { '.tsv': 'text' },
  write: false,
});
const bundlePath = join(directory, 'packages.mjs');
writeFileSync(bundlePath, bundle.outputFiles[0].contents);
const { detectFamily, packagesFor, installCommand } = await import(pathToFileURL(bundlePath).href);

const osReleases = {
  debian13: 'PRETTY_NAME="Debian GNU/Linux 13 (trixie)"\nNAME="Debian GNU/Linux"\nVERSION_ID="13"\nVERSION_CODENAME=trixie\nDEBIAN_VERSION_FULL=13.0\nID=debian\n',
  ubuntu2604: 'PRETTY_NAME="Ubuntu 26.04 LTS"\nNAME="Ubuntu"\nVERSION_ID="26.04"\nID=ubuntu\nID_LIKE=debian\n',
  fedora44: 'NAME="Fedora Linux"\nVERSION_ID=44\nID=fedora\nPRETTY_NAME="Fedora Linux 44"\n',
  alpine324: 'NAME="Alpine Linux"\nID=alpine\nVERSION_ID=3.24.0\nPRETTY_NAME="Alpine Linux v3.24"\n',
  omarchy: 'NAME="Omarchy"\nPRETTY_NAME="Omarchy"\nID=omarchy\nID_LIKE=arch\n',
  gentoo: 'NAME="Gentoo"\nID=gentoo\n',
};

test('detectFamily maps each supported distro from its os-release text', () => {
  assert.equal(detectFamily(osReleases.debian13), 'apt');
  assert.equal(detectFamily(osReleases.ubuntu2604), 'apt');
  assert.equal(detectFamily(osReleases.fedora44), 'dnf');
  assert.equal(detectFamily(osReleases.alpine324), 'apk');
  assert.equal(detectFamily(osReleases.omarchy), 'pacman');
});

test('detectFamily returns undefined for an unsupported distro', () => {
  assert.equal(detectFamily(osReleases.gentoo), undefined);
});

test('packagesFor returns the distro names for logical names in table order', () => {
  assert.deepEqual(packagesFor('dnf', ['Xvfb', 'xprop']), ['xorg-x11-server-Xvfb', 'xprop']);
});

test('packagesFor splits multi-package cells and drops duplicates', () => {
  assert.deepEqual(packagesFor('apt', ['xprop', 'xwininfo']), ['x11-utils']);
  assert.deepEqual(packagesFor('pacman', ['wayland-dev']), ['wayland', 'wayland-protocols']);
});

test('packagesFor skips cells marked unavailable', () => {
  assert.deepEqual(packagesFor('apt', ['libstdc++']), []);
});

test('packagesFor throws on an unknown logical name', () => {
  assert.throws(() => packagesFor('apt', ['no-such-package']), /unknown package name: no-such-package/);
});

test('every packages.tsv row has six non-empty fields and no repeated logical name', () => {
  const rows = readFileSync(join(root, 'packages.tsv'), 'utf8')
    .split('\n')
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => line.split('\t'));
  for (const row of rows) {
    assert.equal(row.length, 6, row.join(' | '));
    assert.ok(row.every((field) => field !== ''), row.join(' | '));
  }
  const logical = rows.map((row) => row[1]);
  assert.equal(new Set(logical).size, logical.length);
});

test('installCommand prefixes the pacman install command', () => {
  assert.equal(installCommand('pacman', ['sway'], 'sudo '), 'sudo pacman -Syu --needed --noconfirm sway');
});
