import { cmdClick, cmdInput, cmdKey, cmdMove, cmdScreenshot, cmdScroll, cmdType } from './client.js';
import { BACKENDS } from './config.js';
import { cmdDoctor } from './host/doctor.js';
import { cmdDown, cmdLogs, cmdRun, cmdStatus, cmdUp, COMPONENTS } from './host/session_commands.js';
import type { Failure } from './output.js';
import { cmdSkills, unknownAction } from './skills.js';

export type Args = Record<string, unknown> & { command: string; json: boolean; name: string; signal?: AbortSignal };
export type Parameter = {
  name: string;
  summary: string;
  type: 'string' | 'boolean' | 'number';
  short?: string;
  valueHint?: string;
  default?: string | number | boolean;
  acceptedValues?: readonly string[];
  repeat?: 'last' | 'collect';
  required?: boolean;
  brackets?: boolean;
  missingReason?: string;
  environment?: string;
  deferredDefault?: boolean;
  validate?: (value: unknown) => boolean;
};
export type Subcommand = { name: string; summary: string; examples: { description: string; command: string }[] };
export type RunsOn = 'vm' | 'client' | 'anywhere';
export type Command = {
  summary: string;
  group: 'Session' | 'Control' | 'Machine';
  runsOn: RunsOn;
  arguments: Parameter[];
  options: Parameter[];
  examples: { description: string; command: string }[];
  notes: string[];
  resultSchema: Record<string, unknown>;
  separator?: string;
  usageTail?: string;
  subcommands?: Subcommand[];
  validate?: (args: Args) => string | Failure | undefined;
  run?: (args: Args) => number | Promise<number>;
};

export const globalOptions: Parameter[] = [
  { name: 'help', short: 'h', type: 'boolean', summary: 'Show help' },
  { name: 'version', short: 'v', type: 'boolean', summary: 'Print the version' },
  { name: 'json', type: 'boolean', summary: 'Print JSON' },
  { name: 'no-color', type: 'boolean', summary: 'Disable color', default: false },
  { name: 'name', type: 'string', valueHint: '<NAME>', summary: 'Select the session', default: 'default', validate: (value) => /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,63}$/.test(String(value)) },
];
const timeout: Parameter = { name: 'timeout', type: 'number', valueHint: '<DURATION>', summary: 'Wait this many seconds', default: 10, validate: (value) => Number(value) > 0 };
const configOption: Parameter = { name: 'config', type: 'string', valueHint: '<FILE>', summary: 'Load the YAML config', environment: 'RELAY_CONFIG' };
const client: Parameter[] = [
  { name: 'url', type: 'string', valueHint: '<URL>', summary: 'Use this engine origin', environment: 'RELAY_URL' },
  { name: 'token-file', type: 'string', valueHint: '<FILE>', summary: 'Read the token from this file', environment: 'RELAY_TOKEN_FILE' },
  timeout,
];
const coordinates: Parameter[] = ['x', 'y'].map((name) => ({ name, summary: 'Fraction of the screen from 0 to 1', type: 'number', valueHint: `<${name}>`, required: true, validate: (value) => Number(value) >= 0 && Number(value) <= 1 }));
const inputResult = { input: { events: 'number' }, outcome: 'sent' };
const stdin: Parameter = { name: 'stdin', type: 'boolean', summary: 'Read the argument from stdin' };
const textSource = (key: string) => (args: Args): string | undefined => Boolean(args.stdin) === (args[key] !== undefined) ? 'Give the argument or --stdin, not both or neither' : undefined;
const example = (description: string, command: string) => [{ description, command }];
const coordinateNotes = ['Coordinates are fractions of the screen from 0 to 1.'];

export const commands: Record<string, Command> = {
  up: {
    summary: 'Start a display, desktop and engine', group: 'Session', runsOn: 'vm', arguments: [],
    options: [
      { name: 'detach', short: 'd', type: 'boolean', summary: 'Run in the background', default: false },
      configOption,
      { name: 'port', type: 'number', valueHint: '<PORT>', summary: 'Listen on this port', environment: 'RELAY_PORT', default: 8080, deferredDefault: true, validate: (value) => Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 65535 },
      { name: 'desktop', type: 'string', valueHint: '<COMMAND>', summary: 'Start xfce, none, or a desktop command; defaults to xfce on x11, foot on wayland, or none when attaching', environment: 'RELAY_DESKTOP' },
      { name: 'display', type: 'string', valueHint: '<DISPLAY>', summary: 'Attach to an existing X display' },
      { name: 'backend', type: 'string', valueHint: '<BACKEND>', summary: 'Use the x11 or wayland backend; defaults to x11 when the engine has it', environment: 'RELAY_BACKEND', acceptedValues: BACKENDS },
      { name: 'output', type: 'string', valueHint: '<NAME>', summary: 'Select this Wayland output when attaching' },
      { name: 'public', type: 'string', valueHint: '<URL>', summary: 'Advertise this HTTPS origin', environment: 'RELAY_PUBLIC', validate: (value) => /^https:\/\/[^/?#@\\\s]+$/.test(String(value)) },
      { name: 'tls-cert', type: 'string', valueHint: '<FILE>', summary: 'Serve TLS with this certificate', environment: 'RELAY_TLS_CERT' },
      { name: 'tls-key', type: 'string', valueHint: '<FILE>', summary: 'Read the TLS private key', environment: 'RELAY_TLS_KEY' },
      { name: 'bind', type: 'string', valueHint: '<ADDRESS>', summary: 'Listen on this address', environment: 'RELAY_BIND', default: '127.0.0.1', deferredDefault: true },
      { ...timeout, default: 30 },
    ],
    examples: example('Start a session in the background', 'relay up -d'),
    notes: ['Without --detach, Ctrl+C stops the session.', '--display uses the existing display size and defaults to no desktop.', 'Flags override config values. RELAY_CONFIG selects the config file.', 'Config-only settings and their variables: display.resolution (RELAY_RESOLUTION), stream.fps (RELAY_FPS), stream.bitrate.* (RELAY_BITRATE_MIN, RELAY_BITRATE_START, RELAY_BITRATE_MAX), keyboard.layout (RELAY_KEYBOARD_LAYOUT).'],
    resultSchema: { session: 'object', outcome: 'started' },
    run: cmdUp,
  },
  down: { summary: 'Stop a session', group: 'Session', runsOn: 'vm', arguments: [], options: [], examples: example('Stop the default session', 'relay down'), notes: ['Safe to repeat.'], resultSchema: { session: 'object', outcome: ['stopped', 'unchanged'] }, run: cmdDown },
  status: { summary: 'Show the session or remote engine state', group: 'Session', runsOn: 'client', arguments: [], options: [...client, { name: 'show-token', type: 'boolean', summary: 'Include the session token' }], examples: example('Inspect the default session', 'relay status'), notes: [], resultSchema: { session: 'object' }, run: cmdStatus },
  logs: { summary: 'Print component logs', group: 'Session', runsOn: 'vm', arguments: [{ name: 'component', type: 'string', valueHint: 'component', summary: 'Select a component log', acceptedValues: COMPONENTS }], options: [{ name: 'follow', short: 'f', type: 'boolean', summary: 'Keep printing new lines' }], examples: example('Follow engine logs', 'relay logs engine --follow'), notes: ['Prints the last 200 lines. --follow cannot be combined with --json.', 'Keys inside logs are the names of the available component logs.'], resultSchema: { logs: { '[component]': 'string' } }, validate: (args) => args.follow && args.json ? '--follow cannot be combined with --json' : undefined, run: cmdLogs },
  run: {
    summary: 'Start an app on the session desktop', group: 'Session', runsOn: 'vm', separator: '--',
    arguments: [
      { name: 'app', type: 'string', valueHint: '<app>', summary: 'App to start', required: true, missingReason: 'missing_command' },
      { name: 'args', type: 'string', valueHint: '[args]', brackets: false, repeat: 'collect', summary: 'Arguments passed to the app' },
    ],
    options: [{ name: 'restart', type: 'boolean', summary: 'Restart the app after it exits' }],
    examples: example('Start an editor', 'relay run -- mousepad notes.txt'),
    notes: ['Returns the app pid. Read app output with relay logs apps.', 'Use -- before the app to pass its flags unchanged.'],
    resultSchema: { app: { pid: 'number', command: 'string[]' }, outcome: 'started' },
    run: cmdRun,
  },
  doctor: { summary: 'Check this machine and show fixes', group: 'Machine', runsOn: 'vm', arguments: [], options: [configOption], examples: example('Check host dependencies', 'relay doctor'), notes: [], resultSchema: { checks: 'array', summary: 'object' }, run: cmdDoctor },
  screenshot: { summary: 'Save a PNG of the screen', group: 'Control', runsOn: 'client', arguments: [{ name: 'file', type: 'string', valueHint: 'file', summary: 'Destination path, or - for PNG stdout', default: 'screen.png' }], options: client, examples: example('Save the current screen', 'relay screenshot screen.png'), notes: ['Use - to write PNG bytes to stdout. This cannot be combined with --json.'], resultSchema: { screenshot: { path: 'string', width: 'number', height: 'number', bytes: 'number' }, outcome: 'saved' }, validate: (args) => args.file === '-' && args.json ? 'PNG stdout cannot be combined with --json' : undefined, run: cmdScreenshot },
  click: { summary: 'Click at screen coordinates', group: 'Control', runsOn: 'client', arguments: coordinates, options: [...client, { name: 'button', type: 'string', valueHint: '<BUTTON>', summary: 'Select the mouse button', default: 'left', acceptedValues: ['left', 'middle', 'right'] }], examples: example('Click the center', 'relay click 0.5 0.5'), notes: coordinateNotes, resultSchema: inputResult, run: cmdClick },
  move: { summary: 'Move the pointer to screen coordinates', group: 'Control', runsOn: 'client', arguments: coordinates, options: client, examples: example('Move to the center', 'relay move 0.5 0.5'), notes: coordinateNotes, resultSchema: inputResult, run: cmdMove },
  scroll: { summary: 'Scroll at screen coordinates', group: 'Control', runsOn: 'client', arguments: coordinates, options: [...client, ...['dx', 'dy'].map((name): Parameter => ({ name, type: 'number', valueHint: '<NUMBER>', summary: `${name === 'dx' ? 'Horizontal' : 'Vertical'} wheel notches`, default: 0, validate: (value) => Number.isInteger(value) }))], examples: example('Scroll down at the center', 'relay scroll 0.5 0.5 --dy 3'), notes: [...coordinateNotes, 'Positive dy scrolls down; positive dx scrolls right.'], resultSchema: inputResult, validate: (args) => !args.dx && !args.dy ? 'Give a nonzero --dx or --dy' : undefined, run: cmdScroll },
  key: { summary: 'Press key combinations', group: 'Control', runsOn: 'client', arguments: [{ name: 'combos', type: 'string', valueHint: '<combo>', summary: 'Key combinations to press in order', required: true, repeat: 'collect' }], options: client, examples: example('Focus the address bar', 'relay key ctrl+l'), notes: ['Keys are physical. cmd and meta are aliases of super.'], resultSchema: inputResult, run: cmdKey },
  type: { summary: 'Type text using the remote keyboard layout', group: 'Control', runsOn: 'client', arguments: [{ name: 'text', type: 'string', valueHint: '<text>', brackets: false, summary: 'Text to type' }], options: [...client, stdin], examples: example('Type a greeting', 'relay type "Hello"'), notes: [], resultSchema: inputResult, validate: textSource('text'), run: cmdType },
  input: { summary: 'Send a JSON array of input events', group: 'Control', runsOn: 'client', arguments: [{ name: 'events', type: 'string', valueHint: '<json>', brackets: false, summary: 'SDK input events' }], options: [...client, stdin], examples: example('Send raw key events', 'relay input \'[{"type":"keyDown","key":4},{"type":"keyUp","key":4}]\''), notes: ['Accepts 1 to 256 events.'], resultSchema: inputResult, validate: textSource('events'), run: cmdInput },
  skills: {
    summary: 'Read the agent skills shipped with this CLI', group: 'Machine', runsOn: 'anywhere', usageTail: '<command> [name]',
    arguments: [
      { name: 'action', type: 'string', valueHint: '<command>', summary: 'List, get or path', default: 'list', acceptedValues: ['list', 'get', 'path'] },
      { name: 'skill', type: 'string', valueHint: '<name>', summary: 'Skill name' },
    ],
    options: [{ name: 'full', type: 'boolean', summary: 'Append the skill references' }],
    subcommands: [
      { name: 'list', summary: 'List the skills shipped with this CLI', examples: example('List the skills', 'relay skills list') },
      { name: 'get', summary: 'Print one skill workflow', examples: example('Read the core workflow', 'relay skills get core') },
      { name: 'path', summary: 'Print the skills directory', examples: example('Print the skill directory', 'relay skills path') },
    ],
    examples: [
      { description: 'List the skills', command: 'relay skills list' },
      { description: 'Read the core workflow', command: 'relay skills get core' },
      { description: 'Print the skill directory', command: 'relay skills path' },
    ],
    notes: ['Skills ship with the CLI, so their instructions match the installed version.', 'get --full appends the references and templates.'],
    resultSchema: { skills: 'array', skill: { name: 'string', content: 'string' }, path: 'string' },
    validate: (args) => args.action !== undefined && !['list', 'get', 'path'].includes(String(args.action)) ? unknownAction(String(args.action))
      : args.action === 'get' && args.skill === undefined ? 'Name the skill to get'
      : args.action === 'list' && args.skill !== undefined ? 'relay skills list takes no skill name'
      : args.full && args.action !== 'get' ? '--full only applies to relay skills get' : undefined,
    run: cmdSkills,
  },
  help: { summary: 'Show command help', group: 'Machine', runsOn: 'anywhere', arguments: [{ name: 'topic', type: 'string', valueHint: 'command', summary: 'Command to describe' }], options: [{ name: 'all', type: 'boolean', summary: 'Describe every command' }], examples: example('Read click help', 'relay help click'), notes: [], resultSchema: { path: 'string', summary: 'string', arguments: 'array', options: 'array', examples: 'array', resultSchema: 'object' } },
};
