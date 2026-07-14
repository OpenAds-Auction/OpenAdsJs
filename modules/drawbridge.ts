import { config } from '../src/config.js';
import { startAuction, type StartAuctionOptions } from '../src/prebid.js';
import { PbPromise, delay } from '../src/utils/promise.js';
import { deepClone, deepSetValue, isArray, isNumber, isPlainObject, logError, logWarn, logInfo } from '../src/utils.js';
import { ajax } from '../src/ajax.js';
import type { ORTBRequest } from '../src/types/ortb/request.d.ts';

type Eid = ORTBRequest['user']['eids'][number];

const MODULE_NAME = 'drawbridge';
const DEFAULT_HOST_GLOBAL = 'pbjs';
const DEFAULT_AUCTION_DELAY_IN_MS = 500;
const FILTER_POLICY_URL = 'https://openads-cdn.adsrvr.org/drawbridge/config/v1/filterpolicy.json';

// Whether we've already attempted the one-time adoption of the host's userSync.auctionDelay.
let hostAuctionDelayChecked = false;

/** Test-only: reset the one-time host-auctionDelay adoption flag. */
export function resetHostAuctionDelayCheck(): void {
  hostAuctionDelayChecked = false;
}

/**
 * these parameters can be swapped at runtime via the CDN-hosted JSON policy).
 */
export interface FilterPolicy {
  /** Require a non-empty eid.source. */
  requireSource?: boolean;
  /** Require an eid-level inserter. */
  requireInserter?: boolean;
  /** Require an eid-level mm. */
  requireMm?: boolean;
  /** Require at least one uid with an atype. */
  requireAtype?: boolean;
  /** If set, only keep EIDs whose source (lowercased) is in this list. */
  allowedSources?: string[];
}

const DEFAULT_FILTER_POLICY: FilterPolicy = {
  requireSource: true,
  requireInserter: false,
  requireMm: false,
  requireAtype: true
};

export interface DrawbridgeConfig {
  /**
   * Global variable name of the foreign Prebid instance to read EIDs from. Defaults to 'pbjs'.
   */
  hostGlobal?: string;
  /**
   * Max time (ms) to wait for the host on the first auction. If omitted, the host instance's own
   * `userSync.auctionDelay` is used, then DEFAULT_AUCTION_DELAY_IN_MS.
   */
  auctionDelay?: number;
  /**
   * Whether module runs at all. Defaults to true; set to false to disable.
   */
  enabled?: boolean;
  /**
   * Declarative EID filtering policy.
   */
  filterPolicy?: FilterPolicy;
}

declare module '../src/config' {
  interface Config {
    drawbridge?: DrawbridgeConfig;
  }
}

function getConf(): DrawbridgeConfig {
  return (config.getConfig(MODULE_NAME) || {}) as DrawbridgeConfig;
}

config.setDefaults({ drawbridge: { hostGlobal: DEFAULT_HOST_GLOBAL, enabled: true, filterPolicy: DEFAULT_FILTER_POLICY } });
config.getConfig(MODULE_NAME, (cfg: any) => validateConfig(cfg?.[MODULE_NAME]));

export function validateFilterPolicy(policy: any): policy is FilterPolicy {
  if (!isPlainObject(policy)) {
    logError(`${MODULE_NAME}: filterPolicy must be an object, got ${typeof policy}`);
    return false;
  }
  let valid = true;
  (['requireSource', 'requireInserter', 'requireMm', 'requireAtype'] as const).forEach(key => {
    if (policy[key] != null && typeof policy[key] !== 'boolean') {
      logError(`${MODULE_NAME}: filterPolicy.${key} must be a boolean, got ${typeof policy[key]}`);
      valid = false;
    }
  });
  if (policy.allowedSources != null &&
      (!isArray(policy.allowedSources) || !policy.allowedSources.every((s: unknown) => typeof s === 'string'))) {
    logError(`${MODULE_NAME}: filterPolicy.allowedSources must be an array of strings`);
    valid = false;
  }
  return valid;
}

export function validateConfig(cfg: DrawbridgeConfig = {}): void {
  if (cfg.hostGlobal != null && typeof cfg.hostGlobal !== 'string') {
    logError(`${MODULE_NAME}: config.hostGlobal must be a string, got ${typeof cfg.hostGlobal}`);
  }
  if (cfg.auctionDelay != null && !isNumber(cfg.auctionDelay)) {
    logError(`${MODULE_NAME}: config.auctionDelay must be a number, got ${typeof cfg.auctionDelay}`);
  }
  if (cfg.enabled != null && typeof cfg.enabled !== 'boolean') {
    logError(`${MODULE_NAME}: config.enabled must be a boolean, got ${typeof cfg.enabled}`);
  }
}

interface HostInstance {
  que?: unknown[];
  cmd?: unknown[];
  getUserIdsAsEids?: () => Eid[];
  getUserIdsAsync?: () => Promise<unknown>;
  getConfig?: (path: string) => unknown;
}

function eidSources(eids: Eid[]): string[] {
  return (isArray(eids) ? eids : []).map(eid => eid && eid.source).filter(Boolean) as string[];
}

function getHost(hostGlobal: string): HostInstance | null {
  const host = (window as any)[hostGlobal] as HostInstance | undefined;
  // a Prebid global always exposes a `que`/`cmd` command queue
  return (host && (isArray(host.que) || isArray(host.cmd))) ? host : null;
}

function getHostAuctionDelay(hostGlobal: string): number | undefined {
  const host = getHost(hostGlobal);
  if (!host || typeof host.getConfig !== 'function') return undefined;
  try {
    const hostDelay = host.getConfig('userSync.auctionDelay');
    return isNumber(hostDelay) ? hostDelay : undefined;
  } catch (e) {
    return undefined;
  }
}

export function readHostEids({ hostGlobal } = { hostGlobal: getConf().hostGlobal || DEFAULT_HOST_GLOBAL }): Promise<Eid[]> {
  return new PbPromise<Eid[]>(resolve => {
    const host = getHost(hostGlobal);
    if (!host) {
      logInfo(`${MODULE_NAME}: no host instance found at window.${hostGlobal}`);
      resolve([]);
      return;
    }
    const queue = (isArray(host.que) ? host.que : host.cmd) as unknown[];
    queue.push(() => {
      const collect = () => {
        try {
          resolve(typeof host.getUserIdsAsEids === 'function' ? (host.getUserIdsAsEids() || []) : []);
        } catch (e) {
          logWarn(`${MODULE_NAME}: failed reading host EIDs`, e);
          resolve([]);
        }
      };
      // getUserIdsAsync resolves only after the host finishes its initial ID resolution,
      // which is exactly what prevents the first-auction race.
      if (typeof host.getUserIdsAsync === 'function') {
        host.getUserIdsAsync().then(collect, collect);
      } else {
        collect();
      }
    });
  });
}

export function filterProvenancedEids(eids: Eid[] = [], policy: FilterPolicy = getConf().filterPolicy ?? DEFAULT_FILTER_POLICY): Eid[] {
  return (isArray(eids) ? eids : []).filter(eid => {
    if (!eid) return false;
    if (policy.requireSource && !eid.source) return false;
    if (policy.requireInserter && eid.inserter == null) return false;
    if (policy.requireMm && eid.mm == null) return false;
    if (policy.requireAtype && !(isArray(eid.uids) && eid.uids.some(uid => uid && uid.atype != null))) return false;
    if (isArray(policy.allowedSources) && !policy.allowedSources.includes((eid.source || '').toLowerCase())) return false;
    return true;
  });
}

/**
 * Add `incoming` EIDs to `existing` for any source `existing` doesn't already have. A source
 * OpenAds already has an EID for is left untouched — OpenAds' own EID always wins over a
 * federated one for that source.
 */
export function mergeEids(existing: Eid[] = [], incoming: Eid[] = []): Eid[] {
  const out = (isArray(existing) ? existing : []).map(e => ({ ...e, uids: isArray(e.uids) ? [...e.uids] : [] }));
  const sources = new Set(out.filter(e => e && e.source).map(e => e.source.toLowerCase()));

  (isArray(incoming) ? incoming : []).forEach(eid => {
    if (!eid || !eid.source || !isArray(eid.uids)) return;
    const key = eid.source.toLowerCase();
    if (sources.has(key)) return;
    out.push({ ...eid, uids: [...eid.uids] });
    sources.add(key);
  });
  return out;
}

export function drawbridgeHook(
  next: (options: StartAuctionOptions) => void,
  options: StartAuctionOptions,
  { mkDelay = delay } = {}
): Promise<void> {
  const conf = getConf();
  if (conf.enabled === false) {
    next(options);
    return PbPromise.resolve();
  }
  const hostGlobal = conf.hostGlobal || DEFAULT_HOST_GLOBAL;

  // On the first auction only, resolve auctionDelay if the publisher hasn't set one: prefer the
  // host's own userSync.auctionDelay, else DEFAULT_AUCTION_DELAY_IN_MS. Written back so subsequent reads
  // (and getConfig) see the resolved value.
  // do it here to give forgien prebid the most amount of time for setup and config seting
  if (!hostAuctionDelayChecked) {
    hostAuctionDelayChecked = true;
    if (!isNumber(conf.auctionDelay)) {
      const hostDelay = getHostAuctionDelay(hostGlobal);
      const resolved = isNumber(hostDelay) ? hostDelay : DEFAULT_AUCTION_DELAY_IN_MS;
      config.setConfig({ drawbridge: { ...conf, auctionDelay: resolved } });
    }
  }

  const auctionDelay = getConf().auctionDelay ?? DEFAULT_AUCTION_DELAY_IN_MS;

  return PbPromise.race<Eid[]>([
    readHostEids({ hostGlobal }),
    mkDelay(auctionDelay).then(() => [] as Eid[])
  ]).then(hostEids => {
    const retrieved = isArray(hostEids) ? hostEids : [];
    // tag every EID we sync from the host so downstream can tell federated IDs apart and see which instance they came from
    const eligible = filterProvenancedEids(retrieved).map(eid => {
      const clone = deepClone(eid);
      deepSetValue(clone, 'ext.federatedFrom', hostGlobal);
      return clone;
    });

    if (retrieved.length) {
      logInfo(`${MODULE_NAME}: retrieved ${retrieved.length} EID(s) from '${hostGlobal}'`, eidSources(retrieved), retrieved);
      logInfo(`${MODULE_NAME}: syncing ${eligible.length} EID(s)`, eidSources(eligible), eligible);
    } else {
      logInfo(`${MODULE_NAME}: received 0 EID(s) from '${hostGlobal}'`);
    }

    if (eligible.length) {
      const fragments = (options.ortb2Fragments = options.ortb2Fragments || {});
      const global = (fragments.global = fragments.global || {});
      const current = ((global as any).user?.ext?.eids ?? []) as Eid[];
      const merged = mergeEids(current, eligible);
      deepSetValue(global, 'user.ext.eids', merged);
    }
  }).catch(e => {
    logWarn(`${MODULE_NAME}: federation failed; proceeding without host EIDs`, e);
  }).then(() => {
    next(options);
  });
}

/**
 * Pre-warm the host: kick its ID resolution as early as possible so the first auction's
 * readiness gate usually resolves with no added latency.
 */
export function prewarmHost({ hostGlobal } = { hostGlobal: getConf().hostGlobal || DEFAULT_HOST_GLOBAL }): void {
  const host = getHost(hostGlobal);
  if (!host) {
    logInfo(`${MODULE_NAME}: no host instance found at window.${hostGlobal} during prewarmHost`);
    return;
  }

  logInfo(`${MODULE_NAME}: Host instance found at window.${hostGlobal} during prewarmHost`);
  const queue = (isArray(host.que) ? host.que : host.cmd) as unknown[];
  queue.push(() => {
    if (typeof host.getUserIdsAsync === 'function') {
      host.getUserIdsAsync().catch(() => null);
    }
  });
}

/**
 * Fetch a version-controlled JSON filter policy and apply it via setConfig. 
 * The fetched policy applies from the next auction onward. 
 * The bundled default governs any auctions that happen before it arrives.
 */
export function loadFilterPolicy(url = FILTER_POLICY_URL, { ajaxFn = ajax } = {}): void {
  if (!url) return;
  ajaxFn(url, {
    success: (response: string) => {
      let policy;
      try {
        policy = JSON.parse(response);
      } catch (e) {
        logError(`${MODULE_NAME}: could not parse filter policy from ${url}; keeping default`, e);
        return;
      }
      if (!validateFilterPolicy(policy)) {
        logError(`${MODULE_NAME}: invalid filter policy from ${url}; keeping default`, policy);
        return;
      }
      config.setConfig({ drawbridge: { ...getConf(), filterPolicy: policy } });
      logInfo(`${MODULE_NAME}: loaded filter policy from ${url}`, policy);
    },
    error: (err: any) => {
      logError(`${MODULE_NAME}: could not load filter policy from ${url}; keeping default`, err);
    }
  }, undefined, { method: 'GET', withCredentials: false });
}

startAuction.before((next: (o: StartAuctionOptions) => void, options?: StartAuctionOptions) => {
  drawbridgeHook(next, options as StartAuctionOptions);
});

prewarmHost();
loadFilterPolicy();
