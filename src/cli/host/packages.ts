import table from '../../../packages.tsv';

export type Family = 'apt' | 'dnf' | 'pacman' | 'apk';

const families = new Map<string, Family>([
  ['debian', 'apt'],
  ['ubuntu', 'apt'],
  ['fedora', 'dnf'],
  ['arch', 'pacman'],
  ['alpine', 'apk'],
]);

const columns: Record<Family, number> = { apt: 2, dnf: 3, pacman: 4, apk: 5 };

const rows = table
  .split('\n')
  .filter((line) => line !== '' && !line.startsWith('#'))
  .map((line) => line.split('\t'));

function osReleaseWords(osRelease: string, key: string): string[] {
  const line = osRelease.split('\n').find((row) => row.startsWith(`${key}=`));
  return line === undefined ? [] : line.slice(key.length + 1).replace(/^["']|["']$/g, '').split(' ').filter(Boolean);
}

/** Family from os-release text: ID first, then each ID_LIKE word. Returns undefined for an unsupported distro. */
export function detectFamily(osRelease: string): Family | undefined {
  for (const id of [...osReleaseWords(osRelease, 'ID'), ...osReleaseWords(osRelease, 'ID_LIKE')]) {
    const family = families.get(id);
    if (family !== undefined) return family;
  }
  return undefined;
}

/** Distro package names for the logical names, in table order, deduplicated. Throws on an unknown name. */
export function packagesFor(family: Family, names: string[]): string[] {
  const logical = rows.map((row) => row[1]);
  const unknown = names.find((name) => !logical.includes(name));
  if (unknown !== undefined) throw new Error(`unknown package name: ${unknown}`);
  const packages = new Set<string>();
  for (const row of rows.filter((entry) => names.includes(entry[1]))) {
    for (const cell of row[columns[family]].split(' ')) {
      if (cell !== '-') packages.add(cell);
    }
  }
  return [...packages];
}

/** The non-interactive install command to paste, with prefix '' or 'sudo '. */
export function installCommand(family: Family, packages: string[], prefix: string): string {
  const list = packages.join(' ');
  switch (family) {
    case 'apt': return `${prefix}apt-get install -y --no-install-recommends ${list}`;
    case 'dnf': return `${prefix}dnf -y install --setopt=install_weak_deps=False ${list}`;
    case 'pacman': return `${prefix}pacman -Syu --needed --noconfirm ${list}`;
    case 'apk': return `${prefix}apk add --no-cache ${list}`;
  }
}
