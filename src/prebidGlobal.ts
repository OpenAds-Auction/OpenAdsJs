import { getGlobalVarName, shouldDefineGlobal } from "./buildOptions.ts";

interface Command {
  (): any;
}

interface CommandQueue extends Omit<Command[], 'push'> {
  push(cmd: Command): void;
}

export interface PrebidJS {
  /**
   * Command queue. Use cmd.push(function F() { ... }) to queue F until Prebid has loaded.
   */
  cmd: CommandQueue,
  /**
   * Alias of `cmd`
   */
  que: CommandQueue
  /**
   * Names of all installed modules.
   */
  installedModules: string[]
}

// if the global already exists in global document scope, use it, if not, create the object
const scope: any = !shouldDefineGlobal() ? {} : window;
const global: PrebidJS = scope[getGlobalVarName()] = scope[getGlobalVarName()] || {};
global.cmd = global.cmd || [];
global.que = global.que || [];
global.installedModules = global.installedModules || []

/**
 * Keep this instance's name last in window._pbjsGlobals.
 *
 * Consumers that fall back to the registry (e.g. GPT Secure Signals when it collects user IDs from "the
 * first Prebid") take the first entry that looks like Prebid. oajs only federates other IDs into its bid
 * requests and does not own them, so its getUserIdsAsEids() is a subset of a host's. We therefore want any
 * host instance listed ahead of us, whichever bundle ran first.
 *
 * Every Prebid bundle registers with `_pbjsGlobals.push(name)`, so we wrap `push` on the shared array and
 * move our own name back to the end after each push. Only `push` is covered: splice/index writes or
 * replacing the array drop the ordering (and the wrapper, in the latter case).
 */
function moveToEnd(registry: string[], name: string): void {
  const i = registry.lastIndexOf(name);
  if (i !== -1 && i !== registry.length - 1) {
    registry.splice(i, 1);
    Array.prototype.push.call(registry, name); // bypass our own wrapper
  }
}

function keepLast(registry: any, name: string): void {
  const marker = Symbol.for(`oajs.keepLast.${name}`); // wrap at most once per name
  if (registry[marker]) return;
  try {
    const originalPush = registry.push;
    // non-enumerable own property so for...in / Object.keys on the registry don't see a "push" entry
    Object.defineProperty(registry, 'push', {
      configurable: true,
      writable: true,
      enumerable: false,
      value: function (this: string[], ...names: string[]): number {
        originalPush.apply(this, names);
        moveToEnd(this, name);
        return this.length;
      }
    });
    registry[marker] = true;
  } catch (e) {
    // frozen / non-extensible registry: leave it as is
  }
}

// create a pbjs global pointer
if (scope === window) {
  scope._pbjsGlobals = scope._pbjsGlobals || [];
  scope._pbjsGlobals.push(getGlobalVarName());
  keepLast(scope._pbjsGlobals, getGlobalVarName());
}

export function getGlobal() {
  return global;
}

export function registerModule(name: string) {
  global.installedModules.push(name);
}
