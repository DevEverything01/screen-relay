export interface Options { url?: string; timeout?: number; token?: string }
export type Input =
  | { type: 'keyDown' | 'keyUp'; key: number }
  | { type: 'pointerMove'; x: number; y: number }
  | { type: 'buttonDown' | 'buttonUp'; button: 1 | 2 | 3; x: number; y: number }
  | { type: 'wheel'; axis: 'vertical' | 'horizontal'; delta: number; x: number; y: number }
  | { type: 'releaseAll' };
export class NativeStreamError extends Error { constructor(code: string, message: string); code: string }
export interface Capabilities {
  version: number; backend: string; width: number; height: number;
  input: { keyboard: boolean; pointer: boolean; buttons: boolean; wheel: boolean };
  snapshot: string; control: string; wayland: boolean; max_input_pending: number;
  cursor: boolean; audio: boolean; clipboard: boolean; resize: boolean; ime: boolean;
}
export interface Session {
  surface: { width: number; height: number };
  capabilities(): Promise<Capabilities>;
  status(): Promise<Record<string, unknown>>;
  snapshot(path?: string): Promise<Uint8Array>;
  input(event: Input): Promise<void>;
  close(): void;
}
export function connect(options?: Options): Promise<Session>;
export function capabilities(options?: Options): Promise<Capabilities>;
export function status(options?: Options): Promise<Record<string, unknown>>;
export function snapshot(options?: Options, path?: string): Promise<Uint8Array>;
