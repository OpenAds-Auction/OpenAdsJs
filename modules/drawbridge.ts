import { config } from '../src/config.js';
import { startAuction, addApiMethod, type StartAuctionOptions } from '../src/prebid.js';
import { getGlobal } from '../src/prebidGlobal.js';
import { PbPromise, delay } from '../src/utils/promise.js';
import { deepClone, deepSetValue, isArray, isNumber, isPlainObject, logError, logWarn, logInfo } from '../src/utils.js';
import { ACTIVITY_ENRICH_EIDS } from '../src/activities/activities.js';
import { isActivityAllowed } from '../src/activities/rules.js';
import { activityParams } from '../src/activities/activityParams.js';
import { MODULE_TYPE_PREBID } from '../src/activities/modules.js';
import { allConsent } from '../src/consentHandler.js';
import { ajax } from '../src/ajax.js';
import type { ORTBRequest } from '../src/types/ortb/request.d.ts';

type Eid = ORTBRequest['user']['eids'][number];

const MODULE_NAME = 'drawbridge';
const HOOK_PRIORITY = 10;
// page-wide registry of Prebid global names (window._pbjsGlobals); used as a discovery candidate
const PBJS_GLOBALS_REGISTRY = '_pbjsGlobals';
const DEFAULT_HOST_GLOBAL = ['pbjs', PBJS_GLOBALS_REGISTRY];
const DEFAULT_AUCTION_DELAY_IN_MS = 500;
const FILTER_POLICY_URL = 'https://openads-cdn.adsrvr.org/drawbridge/config/v1/filterpolicy.json';
const DEFAULT_FILTER_POLICY: FilterPolicy = {
  requireSource: true,
  requireInserter: false,
  requireMatcher: false,
  requireMm: false,
  requireAtype: true
};

// The auctionDelay resolved from the host's userSync.auctionDelay (or the default), computed once on
// the first auction. Module-local — we don't write inferred state back into the publisher config.
// `undefined` means "not resolved yet".
let resolvedHostAuctionDelay: number | undefined;
let activeFilterPolicy: FilterPolicy = DEFAULT_FILTER_POLICY;

// --- Test-only resets ---
export function resetHostAuctionDelayCheck(): void {
  resolvedHostAuctionDelay = undefined;
}

export function resetFilterPolicy(): void {
  activeFilterPolicy = DEFAULT_FILTER_POLICY;
}

export function resetResolvedHost(): void {
  resolvedHost = null;
}

interface HostInstance {
  que?: unknown[];
  cmd?: unknown[];
  installedModules?: string[];
  getUserIdsAsEids?: () => Eid[];
  getUserIdsAsync?: () => Promise<unknown>;
  getConfig?: (path: string) => unknown;
  getConsentMetadata?: () => any;
}

/**
 * these parameters can be swapped at runtime via the CDN-hosted JSON policy.
 */
export interface FilterPolicy {
  /** Require eid.source. */
  requireSource?: boolean;
  /** Require eid.inserter. */
  requireInserter?: boolean;
  /** Require eid.matcher. */
  requireMatcher?: boolean;
  /** Require eid.mm. */
  requireMm?: boolean;
  /** Require at least one uid with an atype. */
  requireAtype?: boolean;
  /** If set, only keep EIDs whose source (lowercased) is in this list. */
  allowedSources?: string[];
}

export interface DrawbridgeConfig {
  /**
   * Global variable name(s) of the foreign Prebid instance to read EIDs from. May be a single name
   * or a candidate list — the first that resolves to a live instance is used.
   * Defaults to ['pbjs', '_pbjsGlobals'].
   */
  hostGlobal?: string | string[];
  /**
   * Max time (ms) to wait for the host on the first auction. If omitted, the host instance's own
   * `userSync.auctionDelay` is used, then DEFAULT_AUCTION_DELAY_IN_MS.
   */
  auctionDelay?: number;
  /**
   * Whether module runs at all. Defaults to true; set to false to disable.
   */
  enabled?: boolean;
}

declare module '../src/config' {
  interface Config {
    drawbridge?: DrawbridgeConfig;
  }
}

function getConf(): DrawbridgeConfig {
  return (config.getConfig(MODULE_NAME) || {}) as DrawbridgeConfig;
}

config.setDefaults({ drawbridge: { hostGlobal: DEFAULT_HOST_GLOBAL, enabled: true } });
config.getConfig(MODULE_NAME, (cfg: any) => validateConfig(cfg?.[MODULE_NAME]));

export function validateConfig(cfg: DrawbridgeConfig = {}): void {
  if (cfg.hostGlobal != null &&
      !(typeof cfg.hostGlobal === 'string' ||
        (isArray(cfg.hostGlobal) && cfg.hostGlobal.every((name) => typeof name === 'string')))) {
    logError(`${MODULE_NAME}: config.hostGlobal must be a string or array of strings, got ${typeof cfg.hostGlobal}`);
  }
  if (cfg.auctionDelay != null && !isNumber(cfg.auctionDelay)) {
    logError(`${MODULE_NAME}: config.auctionDelay must be a number, got ${typeof cfg.auctionDelay}`);
  }
  if (cfg.enabled != null && typeof cfg.enabled !== 'boolean') {
    logError(`${MODULE_NAME}: config.enabled must be a boolean, got ${typeof cfg.enabled}`);
  }
}

/** Read-only view of the current filter policy. Returns a clone so callers cannot mutate the active policy. */
export function getFilterPolicy(): FilterPolicy {
  return deepClone(activeFilterPolicy);
}

/**
 * Fetch a version-controlled JSON filter policy and make it the active policy.
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
      activeFilterPolicy = policy;
      logInfo(`${MODULE_NAME}: loaded filter policy from ${url}`, policy);
    },
    error: (err: any) => {
      logError(`${MODULE_NAME}: could not load filter policy from ${url}; keeping default`, err);
    }
  }, undefined, { method: 'GET', withCredentials: false });
}

declare module '../src/prebidGlobal' {
  interface PrebidJS {
    /** Read-only view of drawbridge's current EID filter policy (a clone; mutating it has no effect). */
    getDrawbridgeFilterPolicy?: () => FilterPolicy;
  }
}

export function validateFilterPolicy(policy: any): policy is FilterPolicy {
  if (!isPlainObject(policy)) {
    logError(`${MODULE_NAME}: filterPolicy must be an object, got ${typeof policy}`);
    return false;
  }
  let valid = true;
  (['requireSource', 'requireInserter', 'requireMatcher', 'requireMm', 'requireAtype'] as const).forEach(key => {
    if (policy[key] != null && typeof policy[key] !== 'boolean') {
      logError(`${MODULE_NAME}: filterPolicy.${key} must be a boolean, got ${typeof policy[key]}`);
      valid = false;
    }
  });
  if (policy.allowedSources != null) {
    if (!isArray(policy.allowedSources) || !policy.allowedSources.every((s: unknown) => typeof s === 'string')) {
      logError(`${MODULE_NAME}: filterPolicy.allowedSources must be an array of strings`);
      valid = false;
    } else {
      policy.allowedSources = policy.allowedSources.map((s: string) => s.toLowerCase());
    }
  }
  return valid;
}

function eidSources(eids: Eid[]): string[] {
  return (isArray(eids) ? eids : []).map(eid => eid && eid.source).filter(Boolean) as string[];
}

function getHost(hostGlobal: string): HostInstance | null {
  let host = (window as any)[hostGlobal];
  // some globals expose an array of instances; use the first
  if (isArray(host)) {
    host = host[0];
  }
  // never federate from our own instance (e.g. oajs's own name showing up via _pbjsGlobals)
  if (host === getGlobal()) return null;
  // a Prebid global always exposes a `que`/`cmd` command queue
  return (host && (isArray(host.que) || isArray(host.cmd))) ? (host as HostInstance) : null;
}

/**
 * Configured candidate host globals, normalized to an array. The special `_pbjsGlobals` entry is the
 * page-wide registry of Prebid global NAMES (see src/prebidGlobal); it is expanded into those names so
 * a foreign Prebid at any global name can be discovered. Our own instance is excluded by getHost.
 */
function candidateHostGlobals(): string[] {
  const configured = getConf().hostGlobal;
  const list = isArray(configured) ? configured
    : typeof configured === 'string' ? [configured]
      : DEFAULT_HOST_GLOBAL;
  const out: string[] = [];
  for (const name of list) {
    if (name === PBJS_GLOBALS_REGISTRY) {
      const registered = (window as any)[PBJS_GLOBALS_REGISTRY];
      if (isArray(registered)) out.push(...registered.filter((n: unknown): n is string => typeof n === 'string'));
    } else {
      out.push(name);
    }
  }
  return [...new Set(out)];   // de-dup while preserving order
}

// Once we've found a live host, cache it
let resolvedHost: { host: HostInstance; hostGlobal: string } | null = null;

/**
 * Resolve the foreign host as { host, hostGlobal } — the first candidate global that is a live
 * instance and cache it when found.
 */
function resolveHost(): { host: HostInstance; hostGlobal: string } | null {
  if (resolvedHost) return resolvedHost;
  for (const hostGlobal of candidateHostGlobals()) {
    const host = getHost(hostGlobal);
    if (host) {
      resolvedHost = { host, hostGlobal };
      return resolvedHost;
    }
  }
  return null;
}

function getHostAuctionDelay(): number | undefined {
  const host = resolveHost()?.host;
  if (!host || typeof host.getConfig !== 'function') return undefined;
  try {
    const hostDelay = host.getConfig('userSync.auctionDelay');
    return isNumber(hostDelay) ? hostDelay : undefined;
  } catch (e) {
    return undefined;
  }
}

export interface HostState {
  eids: Eid[];
  /** The host's `consentManagement` config, read from inside its command queue. */
  cm: any;
  /** The host's installedModules list — used to detect whether it loaded the tcfControl enforcement module. */
  installedModules: any;
  /** Whether the host's CMP reports GDPR as in-scope for this user (getConsentMetadata().gdpr.gdprApplies). */
  gdprApplies: boolean;
}

/**
 * Deferred read of the host's state (EIDs + consentManagement) from inside its command queue, so we
 * observe the host AFTER it has drained its queue (config set, userId init done). Reading both in the
 * same callback avoids a TOCTOU: a bare `window.pbjs = window.pbjs || {que:[]}` stub passes the
 * liveness check long before the publisher's queued setConfig runs, so a synchronous consent read
 * would judge a not-yet-initialized host. The EID snapshot and the consent basis therefore come from
 * one consistent, post-init observation.
 */
export function readHostState(): Promise<HostState> {
  return new PbPromise<HostState>(resolve => {
    const resolved = resolveHost();
    if (!resolved) {
      logInfo(`${MODULE_NAME}: no host instance found at window.[${candidateHostGlobals().join(', ')}]`);
      resolve({ eids: [], cm: undefined, installedModules: undefined, gdprApplies: false });
      return;
    }
    const { host } = resolved;
    const queue = (isArray(host.que) ? host.que : host.cmd) as unknown[];
    queue.push(() => {
      let cm: any;
      try {
        cm = typeof host.getConfig === 'function' ? host.getConfig('consentManagement') : undefined;
      } catch (e) {
        cm = undefined;
      }
      let gdprApplies = false;
      try {
        gdprApplies = typeof host.getConsentMetadata === 'function' && host.getConsentMetadata()?.gdpr?.gdprApplies === true;
      } catch (e) {
        gdprApplies = false;
      }
      let eids: Eid[] = [];
      try {
        eids = typeof host.getUserIdsAsEids === 'function' ? (host.getUserIdsAsEids() || []) : [];
      } catch (e) {
        logWarn(`${MODULE_NAME}: failed reading host EIDs`, e);
      }
      resolve({ eids, cm, installedModules: host.installedModules, gdprApplies });
    });
  });
}

export function filterProvenancedEids(eids: Eid[] = [], policy: FilterPolicy = activeFilterPolicy): Eid[] {
  return (isArray(eids) ? eids : []).filter(eid => {
    if (!eid) return false;
    if (policy.requireSource && !eid.source) return false;
    if (policy.requireInserter && eid.inserter == null) return false;
    if (policy.requireMatcher && eid.matcher == null) return false;
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
  const out = (isArray(existing) ? existing : []).filter(Boolean).map(e => ({ ...e, uids: isArray(e.uids) ? [...e.uids] : [] }));
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

/**
 * If a publisher/CMP has denied enrichEids for oajs, federated IDs must not sneak past it.
 */
function canEnrichEids(): boolean {
  /**
   * This governs all cases of gpp (and more), as in dont sync unwanted EIDs
   *
   * host allow | own allow       = host sets eids and drawbridgeHook runs/syncs
   * host disallow | own allow    = host does not set eids and drawbridgeHook runs, but nothing gets synced
   * host allow | own disallow    = host sets eids and drawbridgeHook doesn't run
   * host disallow | own disallow = host does not set eids and drawbridgeHook doesn't run
   */
  return isActivityAllowed(ACTIVITY_ENRICH_EIDS, activityParams(MODULE_TYPE_PREBID, MODULE_NAME));
}

/**
 * Describe an instance's GDPR setup from its consentManagement config: whether GDPR is configured,
 * and the gdpr.rules array (if any). Handles both the nested (gdpr/usp/gpp) and legacy flat formats.
 */
function gdprStorageSource(cm: any): { configured: boolean; rules: any } {
  if (cm == null) return { configured: false, rules: undefined };
  if (cm.gdpr != null) return { configured: true, rules: cm.gdpr.rules };                 // nested with gdpr
  if (cm.usp != null || cm.gpp != null) return { configured: false, rules: undefined };    // nested, no gdpr
  return { configured: true, rules: undefined };                                           // legacy flat → GDPR, default rules
}

/**
 * The effective purpose:'storage' rule (the one that governs enrichEids), normalized to concrete
 * values, matching how tcfControl actually reads a rule:
 *  - no 'storage' rule present → Prebid falls back to the built-in default, which enforces both
 *    purpose and vendor (setEnforcementConfig: `rules[name] ?? opts.default`).
 *  - a 'storage' rule present → Prebid uses it AS-IS; it does NOT merge per-field defaults, and
 *    validateRules treats an omitted `enforcePurpose`/`enforceVendor` as NOT enforced
 *    (`!rule.enforcePurpose` / `rule.enforceVendor &&`). So an omitted flag means false, not true.
 * If multiple 'storage' rules exist, the last one wins.
 */
function effectiveStorageRule(rules: any): { enforcePurpose: boolean; enforceVendor: boolean; vendorExceptions: string[]; softVendorExceptions: string[] } {
  let rule: any;
  if (isArray(rules)) {
    for (const r of rules) {
      if (r?.purpose === 'storage') rule = r;   // last with this purpose takes effect
    }
  }
  if (rule == null) {
    // no storage rule → Prebid's built-in default (fully strict)
    return { enforcePurpose: true, enforceVendor: true, vendorExceptions: [], softVendorExceptions: [] };
  }
  // storage rule present → used as-is; an omitted enforce flag is NOT enforcement
  return {
    enforcePurpose: !!rule.enforcePurpose,
    enforceVendor: !!rule.enforceVendor,
    vendorExceptions: [...(rule.vendorExceptions ?? [])].sort(),
    softVendorExceptions: [...(rule.softVendorExceptions ?? [])].sort()
  };
}

/**
 * True if the foreign host's GDPR enforcement is at least as restrictive as oajs's for the
 * purpose:'storage' rule (which gates enrichEids). `hostCm` is the host's already-read
 * `consentManagement` config (read deferred, from inside the host's command queue — see readHostState):
 *  - host configured, oajs not   → true  (host is stricter)
 *  - host not configured, oajs is → false (host is looser)
 *  - neither configured → true (equivalent)
 *  - both configured → true if the host enforces enforcePurpose/enforceVendor wherever oajs does (the
 *    host may enforce more, never less) and the host's vendorExceptions (and softVendorExceptions) are a
 *    subset of oajs's aka the host exempts no vendor that oajs enforces
 */
export function hostGdprConsentAsOrMoreRestrictive(hostCm: any): boolean {
  const own = gdprStorageSource(config.getConfig('consentManagement'));
  const hostSrc = gdprStorageSource(hostCm);

  if (hostSrc.configured && !own.configured) return true;
  if (!hostSrc.configured && own.configured) return false;
  if (!hostSrc.configured && !own.configured) return true;

  const hostRule = effectiveStorageRule(hostSrc.rules);
  const ownRule = effectiveStorageRule(own.rules);
  // enforce=true is stricter than false; the host must enforce wherever oajs does (>=), but may enforce more
  const atLeastAsStrict = (host: boolean, own: boolean) => host >= own;
  return atLeastAsStrict(hostRule.enforcePurpose, ownRule.enforcePurpose) &&
    atLeastAsStrict(hostRule.enforceVendor, ownRule.enforceVendor) &&
    hostRule.vendorExceptions.every(v => ownRule.vendorExceptions.includes(v)) &&
    hostRule.softVendorExceptions.every(v => ownRule.softVendorExceptions.includes(v));
}

/**
 * Whether an instance actually ENFORCES GDPR: the tcfControl enforcement module is loaded AND a
 * consentManagement.gdpr config exists to arm it.
 */
function enforcesGdpr(installedModules: any, cm: any): boolean {
  return isArray(installedModules) && installedModules.includes('tcfControl') && gdprStorageSource(cm).configured;
}

export function gdprFederationAllowed(state: HostState): boolean {
  const hostEnforces = enforcesGdpr(state.installedModules, state.cm);
  const oajsEnforces = enforcesGdpr((getGlobal() as any).installedModules, config.getConfig('consentManagement'));

  if (state.gdprApplies && !hostEnforces && !oajsEnforces) return false;
  if (hostEnforces && oajsEnforces && !hostGdprConsentAsOrMoreRestrictive(state.cm)) return false;
  return true;
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
  /**
   * On the first auction only, resolve the host's userSync.auctionDelay (else the default) into
   * module-local state. Done here (not at load) to give the foreign prebid the most time to finish
   * setup / config before we read its delay. A publisher-set auctionDelay always takes precedence.
   */
  if (resolvedHostAuctionDelay === undefined) {
    const hostDelay = getHostAuctionDelay();
    resolvedHostAuctionDelay = isNumber(hostDelay) ? hostDelay : DEFAULT_AUCTION_DELAY_IN_MS;
  }

  const auctionDelay = isNumber(conf.auctionDelay) ? conf.auctionDelay : resolvedHostAuctionDelay;

  // Single shared deadline for the whole hook
  const deadline = mkDelay(auctionDelay);

  /**
   * Gate on OUR consent first. allConsent.promise resolves once every configured framework
   * (gdpr / usp / gpp) has reported — important because mayEnrichEids() evaluates GPP rules too,
   * not just GDPR. Disabled frameworks resolve immediately. Race the shared deadline so a silent
   * CMP can't stall the auction.
   * Note no check for host consent to be ready. If its not ready no EIDs will be set and nothing will get sync
   */
  const consentReady = PbPromise.race([allConsent.promise, deadline.then(() => null)]);

  return consentReady.then(() => {
    if (!canEnrichEids()) {
      logInfo(`${MODULE_NAME}: enrichEids not permitted; skipping federation`);
      return;                                  // ← inject nothing
    }

    const resolved = resolveHost();
    const hostGlobal = resolved?.hostGlobal ?? candidateHostGlobals()[0];

    // Read the host's EIDs AND its consentManagement together, deferred through its command queue, so
    // the consent verdict is made against a fully-initialized host
    return PbPromise.race<HostState>([
      readHostState(),
      deadline.then(() => ({ eids: [], cm: undefined, installedModules: undefined, gdprApplies: false } as HostState))
    ]).then(state => {
      if (resolved && !gdprFederationAllowed(state)) {
        logWarn(`${MODULE_NAME}: GDPR federation not permitted for this host/consent state; skipping federation`);
        return;
      }
      const retrieved = isArray(state.eids) ? state.eids : [];
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
    });
  }).catch(e => {
    logWarn(`${MODULE_NAME}: federation failed; proceeding without host EIDs`, e);
  }).then(() => {
    next(options);
  });
}

/**
 * Pre-warm the host: kick off foreign host's ID resolution as early as possible to give drawbridge the best chances to retrieve eids on the first auction
 */
export function prewarmHost(): void {
  const resolved = resolveHost();
  if (!resolved) {
    logInfo(`${MODULE_NAME}: no host instance found at window.[${candidateHostGlobals().join(', ')}] during prewarmHost`);
    return;
  }

  const { host, hostGlobal } = resolved;
  logInfo(`${MODULE_NAME}: Host instance found at window.${hostGlobal} during prewarmHost`);
  const queue = (isArray(host.que) ? host.que : host.cmd) as unknown[];
  queue.push(() => {
    if (typeof host.getUserIdsAsync === 'function') {
      host.getUserIdsAsync().catch(() => null);
    }
  });
}

startAuction.before((next: (o: StartAuctionOptions) => void, options?: StartAuctionOptions) => {
  drawbridgeHook(next, options as StartAuctionOptions);
}, HOOK_PRIORITY);

addApiMethod('getDrawbridgeFilterPolicy', getFilterPolicy, false);
loadFilterPolicy();
prewarmHost();
