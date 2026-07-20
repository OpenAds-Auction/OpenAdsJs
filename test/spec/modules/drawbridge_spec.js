import {
  mergeEids,
  filterProvenancedEids,
  readHostState,
  drawbridgeHook,
  prewarmHost,
  resetHostAuctionDelayCheck,
  resetResolvedHost,
  validateConfig,
  validateFilterPolicy,
  loadFilterPolicy,
  getFilterPolicy,
  resetFilterPolicy,
  hostGdprConsentAsOrMoreRestrictive
} from 'modules/drawbridge.js';
import { config } from 'src/config.js';
import * as utils from 'src/utils.js';
import { registerActivityControl } from 'src/activities/rules.js';
import { ACTIVITY_ENRICH_EIDS } from 'src/activities/activities.js';

describe('drawbridge module', () => {
  // dedicated global name; avoids colliding with the ambient window.pbjs (the Prebid under test)
  const HOST = 'drawbridgeTestHost';

  // A fake foreign Prebid instance. Its `que` runs callbacks immediately, like a loaded pbjs,
  // so tests don't need to manually flush a command queue.
  function makeHost({ eids = [], async = true, getConfig } = {}) {
    const que = [];
    que.push = (cb) => { cb(); return 0; };
    const host = { que, getUserIdsAsEids: () => eids };
    if (async) host.getUserIdsAsync = () => Promise.resolve();
    if (getConfig) host.getConfig = getConfig;
    return host;
  }

  // Point drawbridge at our fake host under the dedicated global.
  function useHost(host, extraConf = {}) {
    window[HOST] = host;
    config.setConfig({ drawbridge: { hostGlobal: HOST, ...extraConf } });
    resetResolvedHost();
  }

  beforeEach(() => {
    resetResolvedHost();
    resetHostAuctionDelayCheck();
  });

  afterEach(() => {
    delete window[HOST];
    resetResolvedHost();
    resetHostAuctionDelayCheck();
    resetFilterPolicy();
    config.setConfig({ drawbridge: {} });
    config.resetConfig();
  });

  describe('mergeEids', () => {
    const a = { source: 'id5-sync.com', uids: [{ id: 'AAA', atype: 1 }] };
    const b = { source: 'pubcid.org', uids: [{ id: 'BBB', atype: 1 }] };

    it('appends EIDs from sources not already present', () => {
      const merged = mergeEids([a], [b]);
      expect(merged.map(e => e.source).sort()).to.deep.equal(['id5-sync.com', 'pubcid.org']);
    });

    it('skips a source OpenAds already has an EID for (case-insensitive source), leaving it untouched', () => {
      const incoming = { source: 'ID5-SYNC.COM', uids: [{ id: 'AAA' }, { id: 'CCC' }] };
      const merged = mergeEids([a], [incoming]);
      expect(merged).to.have.length(1);
      expect(merged[0].uids.map(u => u.id)).to.deep.equal(['AAA']);
    });

    it('skips malformed incoming EIDs', () => {
      const merged = mergeEids([], [null, { source: 'x' }, { uids: [] }, b]);
      expect(merged.map(e => e.source)).to.deep.equal(['pubcid.org']);
    });

    it('does not mutate its inputs and handles empty input', () => {
      const existing = [{ source: 'a', uids: [{ id: '1' }] }];
      mergeEids(existing, [{ source: 'a', uids: [{ id: '2' }] }, { source: 'b', uids: [{ id: '3' }] }]);
      expect(existing).to.have.length(1);
      expect(existing[0].uids.map(u => u.id)).to.deep.equal(['1']);
      expect(mergeEids()).to.deep.equal([]);
    });
  });

  describe('filterProvenancedEids', () => {
    it('keeps EIDs that have inserter AND mm AND a uid atype', () => {
      const eids = [{ source: 's', inserter: 'x.com', mm: 3, uids: [{ id: '1', atype: 1 }] }];
      expect(filterProvenancedEids(eids)).to.deep.equal(eids);
    });

    it('default policy keeps EIDs with source + uid atype even without inserter/matcher/mm', () => {
      const eids = [{ source: 's', uids: [{ id: '1', atype: 1 }] }];
      expect(filterProvenancedEids(eids)).to.deep.equal(eids);
    });

    it('drops EIDs missing inserter when requireInserter policy is set', () => {
      const eids = [{ source: 's', mm: 3, uids: [{ id: '1', atype: 1 }] }];
      expect(filterProvenancedEids(eids, { requireInserter: true })).to.deep.equal([]);
    });

    it('drops EIDs missing matcher when requireMatcher policy is set', () => {
      const eids = [{ source: 's', inserter: 'x.com', mm: 3, uids: [{ id: '1', atype: 1 }] }];
      expect(filterProvenancedEids(eids, { requireMatcher: true })).to.deep.equal([]);
    });

    it('keeps EIDs with a matcher when requireMatcher policy is set', () => {
      const eids = [{ source: 's', matcher: 'm.com', uids: [{ id: '1', atype: 1 }] }];
      expect(filterProvenancedEids(eids, { requireMatcher: true })).to.deep.equal(eids);
    });

    it('drops EIDs missing mm when requireMm policy is set', () => {
      const eids = [{ source: 's', inserter: 'x.com', uids: [{ id: '1', atype: 1 }] }];
      expect(filterProvenancedEids(eids, { requireMm: true })).to.deep.equal([]);
    });

    it('drops EIDs where no uid has an atype', () => {
      const eids = [{ source: 's', inserter: 'x.com', mm: 3, uids: [{ id: '1' }] }];
      expect(filterProvenancedEids(eids)).to.deep.equal([]);
    });

    it('drops EIDs missing source', () => {
      const eids = [{ inserter: 'x.com', mm: 3, uids: [{ id: '1', atype: 1 }] }];
      expect(filterProvenancedEids(eids)).to.deep.equal([]);
    });

    it('drops EIDs with none of inserter, mm, or uid atype', () => {
      const eids = [{ source: 's', uids: [{ id: '1' }] }];
      expect(filterProvenancedEids(eids)).to.deep.equal([]);
    });

    it('filters a mixed list against a full policy, keeping only fully-provenanced EIDs', () => {
      const fullPolicy = { requireSource: true, requireInserter: true, requireMm: true, requireAtype: true };
      const keep = { source: 'a', inserter: 'x.com', mm: 3, uids: [{ id: '1', atype: 1 }] };
      const dropNoMm = { source: 'b', inserter: 'x.com', uids: [{ id: '2', atype: 3 }] };
      const dropNoAtype = { source: 'c', inserter: 'x.com', mm: 1, uids: [{ id: '3' }] };
      expect(filterProvenancedEids([keep, dropNoMm, dropNoAtype], fullPolicy)).to.deep.equal([keep]);
    });

    it('treats mm of 0 and atype of 0 as set', () => {
      const eids = [{ source: 's', inserter: 'x.com', mm: 0, uids: [{ id: '1', atype: 0 }] }];
      expect(filterProvenancedEids(eids)).to.deep.equal(eids);
    });

    it('handles empty / malformed input', () => {
      expect(filterProvenancedEids()).to.deep.equal([]);
      expect(filterProvenancedEids([null, undefined])).to.deep.equal([]);
    });

    it('applies a relaxed policy passed explicitly (only source required)', () => {
      const eids = [{ source: 's', uids: [{ id: '1' }] }];
      expect(filterProvenancedEids(eids, { requireSource: true })).to.deep.equal(eids);
    });

    it('honors an allowedSources list in the policy', () => {
      const eids = [{ source: 'a', uids: [{ id: '1' }] }, { source: 'b', uids: [{ id: '2' }] }];
      expect(filterProvenancedEids(eids, { allowedSources: ['a'] }).map(e => e.source)).to.deep.equal(['a']);
    });

    it('matches allowedSources case-insensitively against eid.source', () => {
      const eids = [{ source: 'ID5-SYNC.COM', uids: [{ id: '1' }] }];
      expect(filterProvenancedEids(eids, { allowedSources: ['id5-sync.com'] }).map(e => e.source)).to.deep.equal(['ID5-SYNC.COM']);
    });

    it('uses the active filter policy (bundled default) when no policy arg is passed', () => {
      // default requires source + a uid atype
      expect(filterProvenancedEids([{ source: 's', uids: [{ id: '1' }] }])).to.deep.equal([]);       // no atype → dropped
      const kept = [{ source: 's', uids: [{ id: '1', atype: 1 }] }];
      expect(filterProvenancedEids(kept)).to.deep.equal(kept);
    });

    it('is not affected by a publisher setting drawbridge.filterPolicy in config', () => {
      // filterPolicy is no longer a config field; a stray config value must NOT change filtering
      config.setConfig({ drawbridge: { filterPolicy: { requireSource: false, requireAtype: false } } });
      const eids = [{ source: 's', uids: [{ id: '1' }] }]; // no atype → still dropped by the active default
      expect(filterProvenancedEids(eids)).to.deep.equal([]);
    });
  });

  describe('getFilterPolicy', () => {
    it('returns the bundled default before any policy is loaded', () => {
      expect(getFilterPolicy()).to.deep.equal({
        requireSource: true, requireInserter: false, requireMatcher: false, requireMm: false, requireAtype: true
      });
    });

    it('returns a clone — mutating the result does not change the active policy', () => {
      const p = getFilterPolicy();
      p.requireAtype = false;
      p.allowedSources = ['x'];
      expect(getFilterPolicy().requireAtype).to.equal(true);
      expect(getFilterPolicy().allowedSources).to.be.undefined;
    });

    it('reflects a policy loaded from the CDN', () => {
      loadFilterPolicy('https://cdn.example.com/x', { ajaxFn: (url, cbs) => cbs.success('{"requireAtype":false}') });
      expect(getFilterPolicy()).to.deep.equal({ requireAtype: false });
    });

    it('lowercases allowedSources loaded from the CDN', () => {
      loadFilterPolicy('https://cdn.example.com/x', { ajaxFn: (url, cbs) => cbs.success('{"allowedSources":["ID5-SYNC.COM","PubCID.org"]}') });
      expect(getFilterPolicy().allowedSources).to.deep.equal(['id5-sync.com', 'pubcid.org']);
    });
  });

  describe('loadFilterPolicy', () => {
    it('defaults to the production CDN policy URL', () => {
      let requestedUrl;
      loadFilterPolicy(undefined, { ajaxFn: (url) => { requestedUrl = url; } });
      expect(requestedUrl).to.equal('https://openads-cdn.adsrvr.org/drawbridge/config/v1/filterpolicy.json');
    });

    it('fetches a JSON policy and makes it the active policy', () => {
      const ajaxFn = (url, cbs) => cbs.success('{"requireInserter":false,"requireMm":false,"requireAtype":false}');
      loadFilterPolicy('https://cdn.example.com/policy.json', { ajaxFn });
      expect(getFilterPolicy()).to.deep.equal({
        requireInserter: false, requireMm: false, requireAtype: false
      });
    });

    it('keeps the default (logs error) on unparseable JSON', () => {
      const spy = sinon.spy(utils, 'logError');
      loadFilterPolicy('https://cdn.example.com/x', { ajaxFn: (url, cbs) => cbs.success('not-json{') });
      spy.restore();
      expect(spy.called).to.be.true;
      expect(getFilterPolicy().requireAtype).to.equal(true); // still the bundled default
    });

    it('keeps the default (logs error) when the policy is not an object', () => {
      const spy = sinon.spy(utils, 'logError');
      loadFilterPolicy('https://cdn.example.com/x', { ajaxFn: (url, cbs) => cbs.success('[1,2,3]') });
      spy.restore();
      expect(spy.called).to.be.true;
      expect(getFilterPolicy().requireAtype).to.equal(true);
    });

    it('keeps the default (logs error) on network error', () => {
      const spy = sinon.spy(utils, 'logError');
      loadFilterPolicy('https://cdn.example.com/x', { ajaxFn: (url, cbs) => cbs.error('boom') });
      spy.restore();
      expect(spy.called).to.be.true;
    });

    it('rejects a fetched policy with an invalid field type (keeps default)', () => {
      const spy = sinon.spy(utils, 'logError');
      loadFilterPolicy('https://cdn.example.com/x', { ajaxFn: (url, cbs) => cbs.success('{"requireInserter":"yes"}') });
      spy.restore();
      expect(spy.called).to.be.true;
      expect(getFilterPolicy().requireAtype).to.equal(true);
    });
  });

  describe('validateFilterPolicy', () => {
    it('returns true for a valid policy', () => {
      expect(validateFilterPolicy({ requireSource: true, requireAtype: false, allowedSources: ['a'] })).to.be.true;
    });

    it('returns true for an empty policy', () => {
      expect(validateFilterPolicy({})).to.be.true;
    });

    it('returns false and logs for a non-object', () => {
      const spy = sinon.spy(utils, 'logError');
      const result = validateFilterPolicy('nope');
      spy.restore();
      expect(result).to.be.false;
      expect(spy.called).to.be.true;
    });

    it('returns false for a non-boolean require flag', () => {
      expect(validateFilterPolicy({ requireMm: 1 })).to.be.false;
    });

    it('returns false for a non-boolean requireMatcher flag', () => {
      expect(validateFilterPolicy({ requireMatcher: 'yes' })).to.be.false;
    });

    it('returns true for a valid requireMatcher flag', () => {
      expect(validateFilterPolicy({ requireMatcher: true })).to.be.true;
    });

    it('returns false for allowedSources with non-string elements', () => {
      expect(validateFilterPolicy({ allowedSources: ['a', 5] })).to.be.false;
    });

    it('lowercases allowedSources in place when valid', () => {
      const policy = { allowedSources: ['ID5-SYNC.COM', 'PubCID.org'] };
      expect(validateFilterPolicy(policy)).to.be.true;
      expect(policy.allowedSources).to.deep.equal(['id5-sync.com', 'pubcid.org']);
    });

    it('does not lowercase (or mutate) an invalid allowedSources', () => {
      const policy = { allowedSources: ['A', 5] };
      expect(validateFilterPolicy(policy)).to.be.false;
      expect(policy.allowedSources).to.deep.equal(['A', 5]); // left untouched
    });
  });

  describe('validateConfig', () => {
    it('logs an error when hostGlobal is not a string or array of strings', () => {
      const spy = sinon.spy(utils, 'logError');
      validateConfig({ hostGlobal: 123 });
      spy.restore();
      expect(spy.called).to.be.true;
    });

    it('logs an error when auctionDelay is not a number', () => {
      const spy = sinon.spy(utils, 'logError');
      validateConfig({ auctionDelay: 'soon' });
      spy.restore();
      expect(spy.called).to.be.true;
    });

    it('logs an error when enabled is not a boolean', () => {
      const spy = sinon.spy(utils, 'logError');
      validateConfig({ enabled: 'yes' });
      spy.restore();
      expect(spy.called).to.be.true;
    });

    it('does not log for valid types (string or array hostGlobal)', () => {
      const spy = sinon.spy(utils, 'logError');
      validateConfig({ hostGlobal: 'pbjs', auctionDelay: 300, enabled: false });
      validateConfig({ hostGlobal: ['pbjs', '_pbjsGlobals'] });
      spy.restore();
      expect(spy.called).to.be.false;
    });

    it('does not log when fields are omitted', () => {
      const spy = sinon.spy(utils, 'logError');
      validateConfig({});
      validateConfig();
      spy.restore();
      expect(spy.called).to.be.false;
    });

    it('runs on setConfig for the drawbridge topic', () => {
      const spy = sinon.spy(utils, 'logError');
      config.setConfig({ drawbridge: { auctionDelay: 'nope' } });
      spy.restore();
      expect(spy.called).to.be.true;
    });
  });

  describe('hostGdprConsentAsOrMoreRestrictive', () => {
    // the function now takes the host's already-read consentManagement value directly (read deferred in
    // readHostState), so this helper is just an identity/label for the host-side consentManagement.
    const cmHost = (cm) => cm;

    it('returns true when the host has GDPR configured but oajs does not', () => {
      expect(hostGdprConsentAsOrMoreRestrictive(cmHost({ gdpr: {} }))).to.be.true;
    });

    it('returns false when oajs has GDPR configured but the host does not', () => {
      config.setConfig({ consentManagement: { gdpr: {} } });
      expect(hostGdprConsentAsOrMoreRestrictive(cmHost(undefined))).to.be.false;
    });

    it('returns true when neither is configured', () => {
      expect(hostGdprConsentAsOrMoreRestrictive(cmHost(undefined))).to.be.true;
    });

    it('returns true when both have the same effective storage rule', () => {
      config.setConfig({ consentManagement: { gdpr: { rules: [{ purpose: 'storage', enforcePurpose: true, enforceVendor: true }] } } });
      const host = cmHost({ gdpr: { rules: [{ purpose: 'storage', enforcePurpose: true, enforceVendor: true }] } });
      expect(hostGdprConsentAsOrMoreRestrictive(host)).to.be.true;
    });

    it('returns false when the host enforces less than oajs', () => {
      config.setConfig({ consentManagement: { gdpr: { rules: [{ purpose: 'storage', enforceVendor: true }] } } });
      const host = cmHost({ gdpr: { rules: [{ purpose: 'storage', enforceVendor: false }] } });
      expect(hostGdprConsentAsOrMoreRestrictive(host)).to.be.false;
    });

    it('returns true when the host enforces more than oajs', () => {
      // oajs enforces neither; host enforces both → host is stricter → federation allowed
      config.setConfig({ consentManagement: { gdpr: { rules: [{ purpose: 'storage', enforcePurpose: false, enforceVendor: false }] } } });
      const host = cmHost({ gdpr: { rules: [{ purpose: 'storage', enforcePurpose: true, enforceVendor: true }] } });
      expect(hostGdprConsentAsOrMoreRestrictive(host)).to.be.true;
    });

    it('treats a bare storage rule as NOT enforcing (host bare rule is looser than an enforcing oajs)', () => {
      // oajs fully enforces storage
      config.setConfig({ consentManagement: { gdpr: { rules: [{ purpose: 'storage', enforcePurpose: true, enforceVendor: true }] } } });
      // host has a storage rule but omits the enforce flags → Prebid enforces nothing for it
      const host = cmHost({ gdpr: { rules: [{ purpose: 'storage' }] } });
      expect(hostGdprConsentAsOrMoreRestrictive(host)).to.be.false;
    });

    it('treats a partial storage rule (enforcePurpose only) as not enforcing vendor', () => {
      // oajs enforces purpose + vendor; host enforces purpose but omits enforceVendor → vendor not enforced → looser
      config.setConfig({ consentManagement: { gdpr: { rules: [{ purpose: 'storage', enforcePurpose: true, enforceVendor: true }] } } });
      const host = cmHost({ gdpr: { rules: [{ purpose: 'storage', enforcePurpose: true }] } });
      expect(hostGdprConsentAsOrMoreRestrictive(host)).to.be.false;
    });

    it('treats bare storage rules on both sides consistently (both non-enforcing → equivalent)', () => {
      config.setConfig({ consentManagement: { gdpr: { rules: [{ purpose: 'storage' }] } } });
      const host = cmHost({ gdpr: { rules: [{ purpose: 'storage' }] } });
      expect(hostGdprConsentAsOrMoreRestrictive(host)).to.be.true;
    });

    it('treats an absent storage rule as the strict Prebid default', () => {
      // oajs has a bare (non-enforcing) storage rule; host has rules but NO storage rule → default strict → stricter
      config.setConfig({ consentManagement: { gdpr: { rules: [{ purpose: 'storage' }] } } });
      const host = cmHost({ gdpr: { rules: [{ purpose: 'basicAds', enforcePurpose: true }] } });
      expect(hostGdprConsentAsOrMoreRestrictive(host)).to.be.true;
    });

    it('treats the legacy flat format as the default storage rule', () => {
      // oajs: nested with no rules → default storage rule; host: flat format → default storage rule
      config.setConfig({ consentManagement: { gdpr: {} } });
      const host = cmHost({ cmpApi: 'iab', timeout: 1000 });
      expect(hostGdprConsentAsOrMoreRestrictive(host)).to.be.true;
    });

    it('uses the last storage rule when several are present', () => {
      config.setConfig({ consentManagement: { gdpr: { rules: [{ purpose: 'storage', enforceVendor: false }] } } });
      const host = cmHost({ gdpr: { rules: [
        { purpose: 'storage', enforceVendor: true },
        { purpose: 'storage', enforceVendor: false }   // last wins → matches oajs
      ] } });
      expect(hostGdprConsentAsOrMoreRestrictive(host)).to.be.true;
    });

    it('compares vendorExceptions order-insensitively (equal → true)', () => {
      config.setConfig({ consentManagement: { gdpr: { rules: [{ purpose: 'storage', vendorExceptions: ['a', 'b'] }] } } });
      const host = cmHost({ gdpr: { rules: [{ purpose: 'storage', vendorExceptions: ['b', 'a'] }] } });
      expect(hostGdprConsentAsOrMoreRestrictive(host)).to.be.true;
    });

    it('returns true when host vendorExceptions are a subset of oajs\'s', () => {
      config.setConfig({ consentManagement: { gdpr: { rules: [{ purpose: 'storage', vendorExceptions: ['a', 'b'] }] } } });
      const host = cmHost({ gdpr: { rules: [{ purpose: 'storage', vendorExceptions: ['a'] }] } });
      expect(hostGdprConsentAsOrMoreRestrictive(host)).to.be.true;
    });

    it('returns false when host exempts a vendor oajs enforces', () => {
      config.setConfig({ consentManagement: { gdpr: { rules: [{ purpose: 'storage', vendorExceptions: ['a'] }] } } });
      const host = cmHost({ gdpr: { rules: [{ purpose: 'storage', vendorExceptions: ['a', 'b'] }] } });
      expect(hostGdprConsentAsOrMoreRestrictive(host)).to.be.false;
    });

    it('returns false when host softVendorExceptions are not a subset of oajs\'s', () => {
      config.setConfig({ consentManagement: { gdpr: { rules: [{ purpose: 'storage', softVendorExceptions: ['a'] }] } } });
      const host = cmHost({ gdpr: { rules: [{ purpose: 'storage', softVendorExceptions: ['a', 'b'] }] } });
      expect(hostGdprConsentAsOrMoreRestrictive(host)).to.be.false;
    });

    it('treats a nested config with only usp/gpp (no gdpr) as GDPR-unconfigured', () => {
      // host has usp but no gdpr → not GDPR-configured; oajs also unconfigured → true
      expect(hostGdprConsentAsOrMoreRestrictive(cmHost({ usp: {} }))).to.be.true;
    });

    it('treats an undefined host consentManagement as unconfigured', () => {
      config.setConfig({ consentManagement: { gdpr: {} } });   // oajs configured
      expect(hostGdprConsentAsOrMoreRestrictive(undefined)).to.be.false; // host unconfigured, oajs configured
    });
  });

  describe('host auctionDelay adoption (first drawbridgeHook call)', () => {
    const runHook = () => drawbridgeHook(sinon.spy(), {}, { mkDelay: () => new Promise(() => {}) });

    it("adopts the host's userSync.auctionDelay on first call", () => {
      useHost(makeHost({ getConfig: (path) => (path === 'userSync.auctionDelay' ? 1500 : undefined) }));
      return runHook().then(() => {
        expect(config.getConfig('drawbridge').auctionDelay).to.equal(1500);
      });
    });

    it('does not overwrite an explicitly-configured auctionDelay, even if the host exposes one', () => {
      useHost(makeHost({ getConfig: (path) => (path === 'userSync.auctionDelay' ? 1500 : undefined) }), { auctionDelay: 250 });
      return runHook().then(() => {
        expect(config.getConfig('drawbridge').auctionDelay).to.equal(250);
      });
    });

    it('writes DEFAULT_AUCTION_DELAY back to config when neither config nor host provide one', () => {
      useHost(makeHost({ getConfig: () => undefined }));
      return runHook().then(() => {
        expect(config.getConfig('drawbridge').auctionDelay).to.equal(500);
      });
    });

    it('only adopts on the first call, not subsequent ones', () => {
      const host = makeHost({ getConfig: (path) => (path === 'userSync.auctionDelay' ? 1500 : undefined) });
      useHost(host);
      return runHook().then(() => {
        expect(config.getConfig('drawbridge').auctionDelay).to.equal(1500);
        host.getConfig = (path) => (path === 'userSync.auctionDelay' ? 3000 : undefined);
        return runHook().then(() => {
          expect(config.getConfig('drawbridge').auctionDelay).to.equal(1500);
        });
      });
    });
  });

  describe('readHostState', () => {
    it('resolves to empty state when no host instance exists', () => {
      config.setConfig({ drawbridge: { hostGlobal: 'noSuchHost' } });
      resetResolvedHost();
      return readHostState().then(state => expect(state).to.deep.equal({ eids: [], cm: undefined }));
    });

    it('logs (info) when no host instance can be acquired', () => {
      config.setConfig({ drawbridge: { hostGlobal: 'noSuchHost' } });
      resetResolvedHost();
      const logInfoSpy = sinon.spy(utils, 'logInfo');
      return readHostState().then(() => {
        const messages = logInfoSpy.getCalls().map(c => c.args[0]);
        logInfoSpy.restore();
        expect(messages.some(m => /no host instance found/.test(m))).to.be.true;
      });
    });

    it('reads host EIDs via getUserIdsAsEids', () => {
      const eids = [{ source: 'id5-sync.com', uids: [{ id: 'AAA' }] }];
      useHost(makeHost({ eids }));
      return readHostState().then(state => expect(state.eids).to.deep.equal(eids));
    });

    it('readHostState returns both the EIDs and the host consentManagement', () => {
      const eids = [{ source: 'id5-sync.com', uids: [{ id: 'AAA' }] }];
      useHost(makeHost({ eids, getConfig: (p) => (p === 'consentManagement' ? { gdpr: { rules: [] } } : undefined) }));
      return readHostState().then(state => {
        expect(state.eids).to.deep.equal(eids);
        expect(state.cm).to.deep.equal({ gdpr: { rules: [] } });
      });
    });

    it('readHostState tolerates a host getConfig that throws (cm undefined, eids still read)', () => {
      const eids = [{ source: 'x', uids: [{ id: '1' }] }];
      useHost(makeHost({ eids, getConfig: () => { throw new Error('not ready'); } }));
      return readHostState().then(state => {
        expect(state.cm).to.be.undefined;
        expect(state.eids).to.deep.equal(eids);
      });
    });

    it('reads consentManagement from INSIDE the command queue (deferred), not synchronously (C3/TOCTOU)', () => {
      const pending = [];
      const que = [];
      que.push = (cb) => { pending.push(cb); return 0; };   // capture, do not auto-run
      let getConfigCalls = 0;
      const host = {
        que,
        getUserIdsAsEids: () => [{ source: 'id5-sync.com', uids: [{ id: 'AAA' }] }],
        getConfig: (path) => { getConfigCalls++; return path === 'consentManagement' ? { gdpr: {} } : undefined; }
      };
      window[HOST] = host;
      config.setConfig({ drawbridge: { hostGlobal: HOST } });
      resetResolvedHost();

      const p = readHostState();
      // the host hasn't drained its queue yet → nothing read
      expect(getConfigCalls).to.equal(0);
      expect(pending).to.have.length(1);
      // host initializes and drains its queue → now we read
      pending.forEach(cb => cb());
      return p.then(state => {
        expect(getConfigCalls).to.be.greaterThan(0);
        expect(state.cm).to.deep.equal({ gdpr: {} });
        expect(state.eids.map(e => e.source)).to.deep.equal(['id5-sync.com']);
      });
    });
  });

  describe('host resolution (getHost / resolveHost)', () => {
    it('unwraps an array-valued host global (uses the first instance)', () => {
      const eids = [{ source: 'id5-sync.com', uids: [{ id: 'AAA' }] }];
      window[HOST] = [makeHost({ eids })];   // global is an array of instances
      config.setConfig({ drawbridge: { hostGlobal: HOST } });
      resetResolvedHost();
      return readHostState().then(state => expect(state.eids).to.deep.equal(eids));
    });

    it('resolves the first live candidate from a hostGlobal list', () => {
      const eids = [{ source: 'pubcid.org', uids: [{ id: 'BBB' }] }];
      window[HOST] = makeHost({ eids });
      config.setConfig({ drawbridge: { hostGlobal: ['noSuchHost', HOST] } });  // first dead, second live
      resetResolvedHost();
      return readHostState().then(state => expect(state.eids).to.deep.equal(eids));
    });

    it('memoizes the resolved host until resetResolvedHost is called', () => {
      window[HOST] = makeHost({ eids: [{ source: 'a', uids: [{ id: '1' }] }] });
      config.setConfig({ drawbridge: { hostGlobal: HOST } });
      resetResolvedHost();
      return readHostState().then(s1 => {
        expect(s1.eids.map(e => e.source)).to.deep.equal(['a']);
        window[HOST] = makeHost({ eids: [{ source: 'b', uids: [{ id: '2' }] }] });   // swap the instance
        return readHostState().then(s2 => {
          expect(s2.eids.map(e => e.source)).to.deep.equal(['a']);   // still the cached (first) host
          resetResolvedHost();
          return readHostState().then(s3 => {
            expect(s3.eids.map(e => e.source)).to.deep.equal(['b']); // re-resolved after reset
          });
        });
      });
    });
  });

  describe('drawbridgeHook', () => {
    const neverDelay = () => new Promise(() => {});

    it('merges host EIDs into ortb2Fragments.global.user.ext.eids and calls next', () => {
      const hostEids = [{ source: 'id5-sync.com', inserter: 'x.com', mm: 3, uids: [{ id: 'AAA', atype: 1 }] }];
      useHost(makeHost({ eids: hostEids }));
      const options = { ortb2Fragments: { global: { user: { ext: { eids: [{ source: 'pubcid.org', uids: [{ id: 'BBB' }] }] } } } } };
      const next = sinon.spy();
      return drawbridgeHook(next, options, { mkDelay: neverDelay }).then(() => {
        const result = options.ortb2Fragments.global.user.ext.eids;
        expect(result.map(e => e.source).sort()).to.deep.equal(['id5-sync.com', 'pubcid.org']);
        expect(next.calledOnceWith(options)).to.be.true;
        // only the synced (host) EID is tagged with ext.federatedFrom; OpenAds' own EID is not
        const bySource = Object.fromEntries(result.map(e => [e.source, e]));
        expect(bySource['id5-sync.com'].ext.federatedFrom).to.equal(HOST);
        expect(bySource['pubcid.org'].ext?.federatedFrom).to.be.undefined;
      });
    });

    it('logs (info) the retrieved and syncing EID sets', () => {
      const keep = { source: 'id5-sync.com', inserter: 'x.com', mm: 3, uids: [{ id: 'AAA', atype: 1 }] };
      const drop = { source: 'pubcid.org', uids: [{ id: 'BBB' }] };
      useHost(makeHost({ eids: [keep, drop] }));
      const logInfoSpy = sinon.spy(utils, 'logInfo');
      return drawbridgeHook(sinon.spy(), {}, { mkDelay: neverDelay }).then(() => {
        const messages = logInfoSpy.getCalls().map(c => c.args[0]);
        logInfoSpy.restore();
        expect(messages.some(m => /retrieved 2 EID/.test(m))).to.be.true;
        expect(messages.some(m => /syncing 1 EID/.test(m))).to.be.true;
      });
    });

    it('logs (info) when 0 EIDs are received from the host', () => {
      useHost(makeHost({ eids: [] }));
      const logInfoSpy = sinon.spy(utils, 'logInfo');
      return drawbridgeHook(sinon.spy(), {}, { mkDelay: neverDelay }).then(() => {
        const messages = logInfoSpy.getCalls().map(c => c.args[0]);
        logInfoSpy.restore();
        expect(messages.some(m => /received 0 EID/.test(m))).to.be.true;
      });
    });

    it('does not merge host EIDs that lack provenance', () => {
      useHost(makeHost({ eids: [{ source: 'id5-sync.com', uids: [{ id: 'AAA' }] }] }));
      const options = {};
      const next = sinon.spy();
      return drawbridgeHook(next, options, { mkDelay: neverDelay }).then(() => {
        expect(next.calledOnceWith(options)).to.be.true;
        expect(options.ortb2Fragments?.global?.user?.ext?.eids).to.be.undefined;
      });
    });

    it('proceeds (calls next) without host EIDs when the budget elapses first', () => {
      // a host whose command queue never flushes (e.g. foreign Prebid not yet loaded), so readHostState
      // never resolves and the deadline wins the race
      const host = { que: [], getUserIdsAsEids: () => [{ source: 'x', inserter: 'y', mm: 1, uids: [{ id: '1', atype: 1 }] }] };
      useHost(host);
      const options = {};
      const next = sinon.spy();
      return drawbridgeHook(next, options, { mkDelay: () => Promise.resolve() }).then(() => {
        expect(next.calledOnceWith(options)).to.be.true;
        expect(options.ortb2Fragments?.global?.user?.ext?.eids).to.be.undefined;
      });
    });

    it('calls next even when no host instance is present', () => {
      config.setConfig({ drawbridge: { hostGlobal: 'noSuchHost' } });
      resetResolvedHost();
      const options = {};
      const next = sinon.spy();
      return drawbridgeHook(next, options, { mkDelay: neverDelay }).then(() => {
        expect(next.calledOnceWith(options)).to.be.true;
      });
    });

    it('is enabled by default: still reads host EIDs when `enabled` is omitted', () => {
      const hostEids = [{ source: 'id5-sync.com', inserter: 'x.com', mm: 3, uids: [{ id: 'AAA', atype: 1 }] }];
      useHost(makeHost({ eids: hostEids }));
      const options = {};
      return drawbridgeHook(sinon.spy(), options, { mkDelay: neverDelay }).then(() => {
        expect(options.ortb2Fragments.global.user.ext.eids.map(e => e.source)).to.deep.equal(['id5-sync.com']);
      });
    });

    it('skips federation and calls next immediately when enabled is false', () => {
      const host = makeHost({ eids: [{ source: 'id5-sync.com', inserter: 'x.com', mm: 3, uids: [{ id: 'AAA', atype: 1 }] }] });
      const eidsSpy = sinon.spy(host, 'getUserIdsAsEids');
      useHost(host, { enabled: false });
      const options = {};
      const next = sinon.spy();
      return drawbridgeHook(next, options, { mkDelay: neverDelay }).then(() => {
        expect(next.calledOnceWith(options)).to.be.true;
        expect(options.ortb2Fragments).to.be.undefined;
        expect(eidsSpy.called).to.be.false;
      });
    });

    it('skips federation (calls next) when enrichEids activity is denied', () => {
      const unreg = registerActivityControl(ACTIVITY_ENRICH_EIDS, 'drawbridge-test-deny', () => ({ allow: false }));
      useHost(makeHost({ eids: [{ source: 'id5-sync.com', inserter: 'x.com', mm: 3, uids: [{ id: 'AAA', atype: 1 }] }] }));
      const options = {};
      const next = sinon.spy();
      return drawbridgeHook(next, options, { mkDelay: neverDelay }).then(() => {
        unreg();
        expect(next.calledOnceWith(options)).to.be.true;
        expect(options.ortb2Fragments).to.be.undefined;   // nothing federated
      }).catch((e) => { unreg(); throw e; });
    });

    it('skips federation when host GDPR is less restrictive than oajs', () => {
      config.setConfig({ consentManagement: { gdpr: {} } });   // oajs configured
      const host = makeHost({
        eids: [{ source: 'id5-sync.com', inserter: 'x.com', mm: 3, uids: [{ id: 'AAA', atype: 1 }] }],
        getConfig: () => undefined                              // host NOT consent-configured
      });
      useHost(host);
      const options = {};
      const next = sinon.spy();
      return drawbridgeHook(next, options, { mkDelay: neverDelay }).then(() => {
        expect(next.calledOnceWith(options)).to.be.true;
        expect(options.ortb2Fragments).to.be.undefined;
      });
    });

    it('does not overwrite an existing OpenAds EID for the same source', () => {
      const host = makeHost({ eids: [{ source: 'id5-sync.com', inserter: 'x.com', mm: 3, uids: [{ id: 'HOST', atype: 1 }] }] });
      useHost(host);
      const options = { ortb2Fragments: { global: { user: { ext: { eids: [{ source: 'id5-sync.com', uids: [{ id: 'OWN' }] }] } } } } };
      return drawbridgeHook(sinon.spy(), options, { mkDelay: neverDelay }).then(() => {
        const eids = options.ortb2Fragments.global.user.ext.eids;
        expect(eids).to.have.length(1);
        expect(eids[0].uids.map(u => u.id)).to.deep.equal(['OWN']);   // OpenAds' own wins; host dropped
      });
    });
  });

  describe('prewarmHost', () => {
    it('queues a getUserIdsAsync call on the host', () => {
      const host = makeHost();
      const spy = sinon.spy(host, 'getUserIdsAsync');
      useHost(host);
      prewarmHost();
      expect(spy.called).to.be.true;
    });

    it('is a no-op when no host instance is present', () => {
      config.setConfig({ drawbridge: { hostGlobal: 'noSuchHost' } });
      resetResolvedHost();
      expect(() => prewarmHost()).to.not.throw();
    });

    it('does not throw when the host has no getUserIdsAsync', () => {
      useHost(makeHost({ async: false }));
      expect(() => prewarmHost()).to.not.throw();
    });
  });
});
