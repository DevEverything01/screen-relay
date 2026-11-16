import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { confirm, isCancel, select } from '@clack/prompts';
import { BACKENDS, loadConfig } from '../config.js';
import { interactive } from '../mode.js';
import { count, duration, emit, Failure, nextStep, printWarning, quote, receipt, row } from '../output.js';
import { theme } from '../theme.js';
import { engineDirectory, isLinux, LAUNCHER_DIR, requireHost, run, which, type HostArgs } from './common.js';
import { detectFamily, groupPackages, installCommand, packagesFor, provides } from './packages.js';
import { compiledBackends, findEngine, requestedBackend, sessionNeeds } from './supervisor.js';

type Backend = (typeof BACKENDS)[number];
type Args = HostArgs & Record<string, any>;
type Request = { backends: Backend[]; display?: string; desktop?: string; keyboardLayout?: string };
type Plan = { state: 'ready' | 'needs-build' | 'needs-packages'; backends: Backend[]; build: boolean };

const SOURCE = resolve(LAUNCHER_DIR, '..', '..');
const BREW_PACKAGES = ['pkgconf', 'x264', 'libwebsockets'];
const OPTIONAL_APT = ['glycin-loaders', 'gdk-pixbuf-bin'];

/** Whether make and every library the engine links are present for these backends. */
function buildable(backends: Backend[]): boolean {
  return existsSync(join(SOURCE, 'Makefile')) && run(['make', '-s', '-C', SOURCE, `BACKENDS=${backends.join(' ')}`, 'deps']).status === 0;
}

/** Decides what this machine still needs before it can run the requested backends. */
export function planSetup(request: Request): Plan {
  const compiled = compiledBackends();
  const build = request.backends.some((backend) => !compiled.includes(backend));
  const backends = BACKENDS.filter((backend) => compiled.includes(backend) || request.backends.includes(backend));
  const programs = request.backends.flatMap((backend) => sessionNeeds(backend, request).missing)
    .filter((program) => provides(program === 'swaymsg' ? 'sway' : program));
  const packages = programs.length > 0 || (build && !buildable(backends));
  return { state: packages ? 'needs-packages' : build ? 'needs-build' : 'ready', backends, build };
}

/** Runs one shell command with its output on stderr and reports how long it took; a step that is not required only warns when it fails. */
async function step(title: string, done: string, command: string, args: Args, required = true): Promise<void> {
  const style = theme(args);
  const started = Date.now();
  process.stderr.write(`${style.strong(title)}\n${style.muted(`  ${command}`)}\n`);
  const code = await new Promise<number | null>((resolveExit, reject) => {
    const child = spawn('sh', ['-c', command], { stdio: ['inherit', 2, 2], signal: args.signal });
    child.once('error', reject);
    child.once('exit', resolveExit);
  });
  if (code !== 0) {
    if (required) throw new Failure('missing_dependency', `${title} failed`, 'Fix the error above, then run `screen-relay install` again.');
    printWarning(`${title} reported errors; continuing`, args);
    return;
  }
  process.stderr.write(`${style.success ? `${style.success} ` : ''}${done} (${duration((Date.now() - started) / 1000)})\n`);
}

/** The sudo prefix for package commands: none as root, a prompting sudo at a terminal, otherwise passwordless sudo. */
function elevation(prompt: boolean): string {
  if (process.getuid?.() === 0) return '';
  if (!which('sudo')) throw new Failure('forbidden', 'Installing system packages needs root or sudo', 'Run this as root.');
  if (prompt) return 'sudo ';
  if (run(['sudo', '-n', 'true']).status !== 0) {
    throw new Failure('forbidden', 'Installing system packages needs root or passwordless sudo', 'Run this as root, or at a terminal where sudo can ask for your password.');
  }
  return 'sudo -n ';
}

/** Names the package manager and packages for this machine, and returns the work that installs them. */
function packageWork(request: Request, backends: Backend[], args: Args): { manager: string; packages: string[]; run: () => Promise<void> } {
  if (process.platform === 'darwin') {
    if (!which('brew')) {
      throw new Failure('missing_dependency', 'Homebrew is not installed', `Install it from https://brew.sh, or install ${BREW_PACKAGES.join(', ')} yourself. Then run screen-relay install again.`);
    }
    return { manager: 'brew', packages: BREW_PACKAGES, run: () => step('Installing Homebrew packages', 'Installed Homebrew packages', `brew install ${BREW_PACKAGES.join(' ')}`, args) };
  }
  let osRelease = '';
  try { osRelease = readFileSync('/etc/os-release', 'utf8'); } catch {}
  const family = detectFamily(osRelease);
  if (!family) {
    throw new Failure('unsupported_platform', 'Automatic setup supports Debian, Ubuntu, Fedora, Arch Linux, and Alpine',
      'Install the build tools and libraries yourself, then run screen-relay install again to build the engine. screen-relay doctor lists what is missing.');
  }
  const xfce = backends.includes('x11') && sessionNeeds('x11', request).desktop === 'xfce';
  const groups = ['core', ...backends, ...(xfce ? ['xfce'] : [])];
  const packages = groupPackages(family, groups, family === 'apt' ? OPTIONAL_APT : []);
  const x264 = packagesFor(family, ['x264-dev'])[0];
  const install = async () => {
    const elevate = elevation(interactive(args));
    const available = (name: string) => /Candidate: [^ (]/.test(run(['apt-cache', 'policy', name], { env: { ...process.env, LC_ALL: 'C' } }).stdout ?? '');
    if (family === 'apt') {
      await step('Updating package lists', 'Updated package lists', `${elevate}apt-get update`, args, false);
      if (/^ID(_LIKE)?=.*ubuntu/m.test(osRelease) && !available(x264)) {
        const sources = '/etc/apt/sources.list.d/ubuntu.sources';
        if (!existsSync(sources)) throw new Failure('missing_dependency', `${x264} is not available`, 'Enable the Ubuntu universe component, then run `screen-relay install` again.');
        await step('Enabling the Ubuntu universe component', 'Enabled the Ubuntu universe component',
          `${elevate}sed -i '/^Components:/{/universe/!s/$/ universe/}' ${sources} && ${elevate}apt-get update`, args);
        if (!available(x264)) throw new Failure('missing_dependency', `Cannot install ${x264} after enabling Ubuntu universe`, 'Check the apt sources on this machine.');
      }
      if (xfce) packages.push(...packagesFor('apt', OPTIONAL_APT).filter((name) => run(['apt-cache', 'show', name]).status === 0));
    }
    if (family === 'dnf') {
      const query = run(['sh', '-c', `${elevate}dnf -q repoquery --available ${x264}`]);
      if (query.status !== 0) throw new Failure('missing_dependency', 'dnf could not query its repositories', 'Fix the repository configuration or network, then run `screen-relay install` again.');
      if (!query.stdout.trim()) {
        throw new Failure('missing_dependency', 'x264 needs RPM Fusion Free on Fedora',
          `Enable it with ${elevate}dnf -y install https://download1.rpmfusion.org/free/fedora/rpmfusion-free-release-$(rpm -E %fedora).noarch.rpm and run screen-relay install again.`);
      }
    }
    await step('Installing system packages', 'Installed system packages', installCommand(family, packages, family === 'apt' ? `${elevate}env DEBIAN_FRONTEND=noninteractive ` : elevate), args);
  };
  return { manager: { apt: 'apt-get', dnf: 'dnf', pacman: 'pacman', apk: 'apk' }[family], packages, run: install };
}

/** Builds the engine from the source in this install and replaces any earlier build. */
async function buildEngine(backends: Backend[], args: Args): Promise<void> {
  if (!existsSync(join(SOURCE, 'src', 'engine'))) {
    throw new Failure('missing_dependency', 'The engine source is missing from this install', 'Reinstall it with `npm install -g screen-relay`.');
  }
  const target = engineDirectory();
  const scratch = `${target}.build`;
  rmSync(scratch, { recursive: true, force: true });
  mkdirSync(join(scratch, 'src'), { recursive: true });
  cpSync(join(SOURCE, 'Makefile'), join(scratch, 'Makefile'));
  cpSync(join(SOURCE, 'src', 'engine'), join(scratch, 'src', 'engine'), { recursive: true });
  await step(`Building the engine (${backends.join(', ')})`, 'Built the engine', `make -C ${quote(scratch)} BACKENDS=${quote(backends.join(' '))} relay-engine`, args);
  for (const entry of readdirSync(dirname(target))) {
    if (join(dirname(target), entry) !== scratch) rmSync(join(dirname(target), entry), { recursive: true, force: true });
  }
  renameSync(scratch, target);
}

async function answer<T>(prompt: Promise<T | symbol>): Promise<T> {
  const value = await prompt;
  if (isCancel(value)) throw new Failure('canceled', 'Setup canceled.');
  return value as T;
}

/** Installs what the plan says is missing, asking first when packages need installing. */
async function applySetup(request: Request, plan: Plan, args: Args): Promise<void> {
  const names = request.backends.join(' and ');
  if (plan.state === 'needs-packages') {
    if (!args.yes && !interactive(args)) {
      const flag = process.platform === 'darwin' ? '' : ` --backend ${request.backends.length > 1 ? 'all' : request.backends[0]}`;
      throw new Failure('missing_input', `Setting up the ${names} backend installs system packages`, `Run \`screen-relay install${flag} --yes\` to allow it.`);
    }
    const work = packageWork(request, plan.backends, args);
    if (!args.yes) {
      process.stderr.write(`Setting up the ${names} backend installs ${count(work.packages.length, 'package')} with ${work.manager}, then builds the engine:\n  ${work.packages.join(' ')}\n`);
      if (!await answer(confirm({ message: 'Install them now?', output: process.stderr, signal: args.signal }))) throw new Failure('canceled', 'Setup canceled.');
    }
    await work.run();
  }
  if (plan.build) await buildEngine(plan.backends, args);
  if (planSetup(request).state !== 'ready') {
    throw new Failure('missing_dependency', `This machine is still missing what the ${names} backend needs`, 'Run `screen-relay doctor` to see what is missing.');
  }
}

/** Sets the machine up before a session starts and returns the arguments a prompt chose, for a detached child to repeat. */
export async function ensureSetup(args: Args): Promise<string[]> {
  const extra: string[] = [];
  const requested = requestedBackend(args.backend, args.display);
  let backends: Backend[] = requested ? [requested] : [];
  if (!requested) {
    const compiled = compiledBackends();
    if (compiled.length) backends = [compiled.includes('x11') ? 'x11' : 'wayland'];
    else if (!interactive(args)) backends = ['x11'];
    else {
      const running = process.env.WAYLAND_DISPLAY || process.env.DISPLAY;
      const attach = running ? await answer(select({
        message: `A desktop is already running here (${running}). What should screen-relay stream?`,
        options: [{ value: false, label: 'A new virtual desktop' }, { value: true, label: `The running desktop (${running})` }],
        output: process.stderr, signal: args.signal,
      })) : false;
      if (attach && running) {
        args.display = running;
        extra.push('--display', running);
        backends = [requestedBackend(undefined, running) ?? 'x11'];
      } else {
        backends = await answer<Backend[]>(select<Backend[]>({
          message: 'Which backend should this machine use?',
          options: [
            { value: ['x11'], label: 'X11 with the XFCE desktop', hint: 'default' },
            { value: ['wayland'], label: 'Wayland with sway' },
            { value: ['x11', 'wayland'], label: 'Both' },
          ],
          output: process.stderr, signal: args.signal,
        }));
      }
    }
  }
  const request: Request = { backends, display: args.display, desktop: args.desktop, keyboardLayout: args.keyboardLayout };
  const plan = planSetup(request);
  if (plan.state !== 'ready') await applySetup(request, plan, args);
  return extra;
}

export async function cmdInstall(args: Args): Promise<number> {
  requireHost();
  const [settings, , present] = loadConfig(typeof args.config === 'string' && args.config ? args.config : undefined);
  const chosen = args.backend ?? settings.backend;
  if (chosen === 'all' && !isLinux()) throw new Failure('invalid_input', '--backend all is only supported on Linux', 'Use --backend macos on macOS.');
  const backends: Backend[] = chosen === 'all' ? ['x11', 'wayland'] : [requestedBackend(chosen) ?? 'x11'];
  const request: Request = { backends, desktop: args.desktop ?? (present.has('desktop') ? settings.desktop : undefined) };
  const plan = planSetup(request);
  if (plan.state !== 'ready') await applySetup(request, plan, args);
  const install = { backends: compiledBackends(), engine: findEngine() };
  const label = plan.state === 'ready' ? 'Unchanged' : 'Installed';
  emit(args, { install, outcome: label.toLowerCase() }, [
    receipt(label, install.backends.join(', '), args),
    row('Engine', install.engine, args),
    nextStep('Start a session', 'screen-relay up -d', args),
  ].join('\n'), {});
  return 0;
}
