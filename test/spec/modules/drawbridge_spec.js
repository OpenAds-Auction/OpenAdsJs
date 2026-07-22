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
  resetFilterPolicyReady,
  hostGdprConsentAsOrMoreRestrictive,
  gdprFederationAllowed,
  gppFederationAllowed,
  coppaFederationAllowed
} from 'modules/drawbridge.js';
import { config } from 'src/config.js';
import * as utils from 'src/utils.js';
import { getGlobal } from 'src/prebidGlobal.js';
import { gppDataHandler, gdprDataHandler } from 'src/consentHandler.js';
import { registerActivityControl } from 'src/activities/rules.js';
import { ACTIVITY_ENRICH_EIDS } from 'src/activities/activities.js';

describe('drawbridge module', () => {
  // dedicated global name; avoids colliding with the ambient window.pbjs (the Prebid under test)
  const HOST = 'drawbridgeTestHost';

  // A fake foreign Prebid instance. Its `que` runs callbacks immediately, like a loaded pbjs,
  // so tests don't need to manually flush a command queue.
  function makeHost({ eids = [], async = true, getConfig, installedModules, coppa } = {}) {
    const que = [];
    que.push = (cb) => { cb(); return 0; };
    const host = { que, getUserIdsAsEids: () => eids };
    if (async) host.getUserIdsAsync = () => Promise.resolve();
    // a real Prebid host always exposes getConfig; model that (a missing getConfig fails coppa closed)
    host.getConfig = (path) => {
      if (path === 'coppa') return coppa === true;
      return getConfig ? getConfig(path) : undefined;
    };
    if (installedModules) host.installedModules = installedModules;
    return host;
  }

  // build a getConfig that answers consentManagement (and optionally userSync.auctionDelay)
  const cmGetConfig = (cm) => (path) => (path === 'consentManagement' ? cm : undefined);

  // Point drawbridge at our fake host under the dedicated global.
  function useHost(host, extraConf = {}) {
    window[HOST] = host;
    config.setConfig({ drawbridge: { hostGlobal: HOST, ...extraConf } });
    resetResolvedHost();
  }

  beforeEach(() => {
    resetResolvedHost();
    resetHostAuctionDelayCheck();
    resetFilterPolicyReady();   // bootstrap loadFilterPolicy() leaves a real-ajax promise pending in tests
  });

  afterEach(() => {
    delete window[HOST];
    resetResolvedHost();
    resetHostAuctionDelayCheck();
    resetFilterPolicy();
    resetFilterPolicyReady();
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

    it('tolerates malformed existing EIDs (does not throw) and still merges incoming', () => {
      // existing comes from arbitrary FPD/ID modules; a null entry must not blow up the whole merge
      expect(() => mergeEids([null], [])).to.not.throw();
      const merged = mergeEids([null, a], [b]);
      expect(merged.map(e => e.source).sort()).to.deep.equal(['id5-sync.com', 'pubcid.org']);
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

  describe('gdprFederationAllowed', () => {
    // GDPR scope now comes from oajs's own gdprDataHandler (page-level, authoritative), not the host.
    // Control it by stubbing getConsentData; control enforcement via installedModules + consentManagement.
    let savedModules;
    const state = (over) => ({ eids: [], cm: undefined, installedModules: undefined, coppa: false, ...over });
    beforeEach(() => {
      savedModules = getGlobal().installedModules;
      sinon.stub(gdprDataHandler, 'getConsentData');
    });
    afterEach(() => {
      getGlobal().installedModules = savedModules;
      gdprDataHandler.getConsentData.restore();
    });

    const applies = () => gdprDataHandler.getConsentData.returns({ gdprApplies: true });
    const outOfScope = () => gdprDataHandler.getConsentData.returns({ gdprApplies: false });
    const oajsEnforce = (cm = { gdpr: {} }) => { getGlobal().installedModules = ['tcfControl']; config.setConfig({ consentManagement: cm }); };
    const oajsNoEnforce = () => { getGlobal().installedModules = []; };   // no enforcement module (and no consentManagement)

    it('blocks the leak cell: GDPR applies and neither side enforces', () => {
      applies();
      oajsNoEnforce();
      expect(gdprFederationAllowed(state())).to.be.false;
    });

    it('allows when the host enforces (tcfControl + consent), even if oajs does not', () => {
      applies();
      oajsNoEnforce();
      expect(gdprFederationAllowed(state({ installedModules: ['tcfControl'], cm: { gdpr: {} } }))).to.be.true;
    });

    it('allows when oajs enforces (downstream backstop), even if the host does not', () => {
      applies();
      oajsEnforce();
      expect(gdprFederationAllowed(state())).to.be.true;
    });

    it('allows when GDPR is out of scope, even if neither enforces', () => {
      outOfScope();
      oajsNoEnforce();
      expect(gdprFederationAllowed(state())).to.be.true;
    });

    it('allows when oajs has no resolved GDPR consent (getConsentData null → not in scope)', () => {
      gdprDataHandler.getConsentData.returns(null);
      oajsNoEnforce();
      expect(gdprFederationAllowed(state())).to.be.true;
    });

    it('requires tcfControl to be loaded — a consentManagement.gdpr key alone is not "enforces"', () => {
      // oajs has consentManagement.gdpr but NO tcfControl module → not enforcing → leak cell
      applies();
      getGlobal().installedModules = [];
      config.setConfig({ consentManagement: { gdpr: {} } });
      expect(gdprFederationAllowed(state())).to.be.false;
    });

    it('when both enforce, blocks a host that is less restrictive than oajs', () => {
      applies();
      oajsEnforce({ gdpr: { rules: [{ purpose: 'storage', enforcePurpose: true, enforceVendor: true }] } });
      const s = state({ installedModules: ['tcfControl'], cm: { gdpr: { rules: [{ purpose: 'storage', enforcePurpose: false, enforceVendor: false }] } } });
      expect(gdprFederationAllowed(s)).to.be.false;
    });

    it('when both enforce and the host is as restrictive, allows', () => {
      applies();
      oajsEnforce({ gdpr: { rules: [{ purpose: 'storage', enforcePurpose: true, enforceVendor: true }] } });
      const s = state({ installedModules: ['tcfControl'], cm: { gdpr: { rules: [{ purpose: 'storage', enforcePurpose: true, enforceVendor: true }] } } });
      expect(gdprFederationAllowed(s)).to.be.true;
    });
  });

  describe('host auctionDelay adoption (first drawbridgeHook call)', () => {
    // capture the delay budget the hook actually uses (passed to mkDelay), without config write-back
    let capturedDelay;
    const runHook = () => {
      capturedDelay = undefined;
      return drawbridgeHook(sinon.spy(), {}, { mkDelay: (ms) => { capturedDelay = ms; return new Promise(() => {}); } });
    };

    it("adopts the host's userSync.auctionDelay on first call", () => {
      useHost(makeHost({ getConfig: (path) => (path === 'userSync.auctionDelay' ? 1500 : undefined) }));
      return runHook().then(() => {
        expect(capturedDelay).to.equal(1500);
        expect(config.getConfig('drawbridge').auctionDelay).to.be.undefined; // not written back to config
      });
    });

    it('lets an explicitly-configured auctionDelay win over the host value', () => {
      useHost(makeHost({ getConfig: (path) => (path === 'userSync.auctionDelay' ? 1500 : undefined) }), { auctionDelay: 250 });
      return runHook().then(() => {
        expect(capturedDelay).to.equal(250);
      });
    });

    it('falls back to DEFAULT_AUCTION_DELAY when neither config nor host provide one', () => {
      useHost(makeHost({ getConfig: () => undefined }));
      return runHook().then(() => {
        expect(capturedDelay).to.equal(500);
      });
    });

    it('resolves the host delay only on the first call, not subsequent ones', () => {
      const host = makeHost({ getConfig: (path) => (path === 'userSync.auctionDelay' ? 1500 : undefined) });
      useHost(host);
      return runHook().then(() => {
        expect(capturedDelay).to.equal(1500);
        host.getConfig = (path) => (path === 'userSync.auctionDelay' ? 3000 : undefined);
        return runHook().then(() => {
          expect(capturedDelay).to.equal(1500); // cached from the first call
        });
      });
    });
  });

  describe('readHostState', () => {
    it('resolves to empty state when no host instance exists', () => {
      config.setConfig({ drawbridge: { hostGlobal: 'noSuchHost' } });
      resetResolvedHost();
      return readHostState().then(state => expect(state).to.deep.equal({ eids: [], cm: undefined, installedModules: undefined, coppa: false }));
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

    it('readHostState tolerates a host getConfig that throws (cm undefined, eids still read) and fails closed on coppa', () => {
      const eids = [{ source: 'x', uids: [{ id: '1' }] }];
      useHost(makeHost({ eids, getConfig: () => { throw new Error('not ready'); } }));
      return readHostState().then(state => {
        expect(state.cm).to.be.undefined;
        expect(state.eids).to.deep.equal(eids);
        expect(state.coppa).to.be.true;   // fail closed: a throwing getConfig is treated as child-directed
      });
    });

    it('treats a host with no getConfig as coppa-unset (not child-directed)', () => {
      // a missing getConfig is a technical gap, not a COPPA declaration → coppa false (like unset).
      // only a getConfig that throws fails closed (see the throwing-getConfig test above).
      const que = []; que.push = (cb) => { cb(); return 0; };
      window[HOST] = { que, getUserIdsAsEids: () => [{ source: 'x', uids: [{ id: '1' }] }] };
      config.setConfig({ drawbridge: { hostGlobal: HOST } });
      resetResolvedHost();
      return readHostState().then(state => {
        expect(state.cm).to.be.undefined;
        expect(state.coppa).to.be.false;
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

    describe('_pbjsGlobals discovery', () => {
      let savedRegistry;
      const REG = 'drawbridgeForeign';
      beforeEach(() => { savedRegistry = window._pbjsGlobals; });
      afterEach(() => {
        window._pbjsGlobals = savedRegistry;
        delete window[REG];
      });

      it('discovers a foreign host named in the _pbjsGlobals registry', () => {
        const eids = [{ source: 'id5-sync.com', uids: [{ id: 'AAA' }] }];
        window[REG] = makeHost({ eids });
        window._pbjsGlobals = [REG];                              // registry lists the foreign global's name
        config.setConfig({ drawbridge: { hostGlobal: '_pbjsGlobals' } });
        resetResolvedHost();
        return readHostState().then(state => expect(state.eids).to.deep.equal(eids));
      });

      it('excludes oajs\'s own instance from _pbjsGlobals (no self-federation)', () => {
        window[REG] = getGlobal();                               // a registry name pointing at oajs itself
        window._pbjsGlobals = [REG];
        config.setConfig({ drawbridge: { hostGlobal: '_pbjsGlobals' } });
        resetResolvedHost();
        return readHostState().then(state => expect(state).to.deep.equal({ eids: [], cm: undefined, installedModules: undefined, coppa: false }));
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

    it('waits for loadFilterPolicy to finish before federating', () => {
      let successCb;
      // start a policy fetch that stays pending until we invoke its success callback
      loadFilterPolicy('https://cdn.example.com/x', { ajaxFn: (url, cbs) => { successCb = cbs.success; } });
      useHost(makeHost({ eids: [{ source: 'id5-sync.com', inserter: 'x.com', mm: 3, uids: [{ id: 'AAA', atype: 1 }] }] }));
      const options = {};
      // deadline never fires, so only the policy fetch settling can unblock federation
      const p = drawbridgeHook(sinon.spy(), options, { mkDelay: neverDelay });
      return Promise.resolve().then(() => {
        expect(options.ortb2Fragments).to.be.undefined;                        // still waiting on the fetch
        successCb('{"requireSource":true,"requireAtype":false}');              // fetch settles
        return p;
      }).then(() => {
        expect(options.ortb2Fragments.global.user.ext.eids.map(e => e.source)).to.deep.equal(['id5-sync.com']);
      });
    });

    it('proceeds when the policy fetch outlasts the auction-delay budget (deadline wins)', () => {
      loadFilterPolicy('https://cdn.example.com/x', { ajaxFn: () => { /* never calls back */ } });
      useHost(makeHost({ eids: [{ source: 'id5-sync.com', inserter: 'x.com', mm: 3, uids: [{ id: 'AAA', atype: 1 }] }] }));
      const options = {};
      // deadline resolves immediately → federation proceeds with the bundled default policy
      return drawbridgeHook(sinon.spy(), options, { mkDelay: () => Promise.resolve() }).then(() => {
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

    it('skips federation in the leak cell (GDPR applies, neither side enforces)', () => {
      // GDPR in scope (oajs's authoritative signal) but neither side enforces → no backstop → skip
      const savedModules = getGlobal().installedModules;
      getGlobal().installedModules = [];
      const gdprStub = sinon.stub(gdprDataHandler, 'getConsentData').returns({ gdprApplies: true });
      const host = makeHost({ eids: [{ source: 'id5-sync.com', inserter: 'x.com', mm: 3, uids: [{ id: 'AAA', atype: 1 }] }] });
      useHost(host);
      const options = {};
      const next = sinon.spy();
      return drawbridgeHook(next, options, { mkDelay: neverDelay }).then(() => {
        getGlobal().installedModules = savedModules;
        gdprStub.restore();
        expect(next.calledOnceWith(options)).to.be.true;
        expect(options.ortb2Fragments).to.be.undefined;
      }, (e) => { getGlobal().installedModules = savedModules; gdprStub.restore(); throw e; });
    });

    it('skips federation (calls next) when COPPA is in effect', () => {
      const host = makeHost({
        eids: [{ source: 'id5-sync.com', inserter: 'x.com', mm: 3, uids: [{ id: 'AAA', atype: 1 }] }],
        coppa: true
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

    describe('US privacy (GPP) leak cell', () => {
      // oajs installedModules signals oajs-side enforcement; gppDataHandler signals what __gpp reported
      let savedModules;
      const usEid = [{ source: 'id5-sync.com', inserter: 'x.com', mm: 3, uids: [{ id: 'AAA', atype: 1 }] }];
      beforeEach(() => {
        savedModules = getGlobal().installedModules;
        sinon.stub(gppDataHandler, 'getConsentData');
      });
      afterEach(() => {
        getGlobal().installedModules = savedModules;
        gppDataHandler.getConsentData.restore();
      });
      const gppInScope = () => gppDataHandler.getConsentData.returns({ applicableSections: [7] });

      it('blocks federation when a US GPP section applies and neither side enforces', () => {
        gppInScope();
        getGlobal().installedModules = [];                       // oajs: no gpp enforcer
        useHost(makeHost({ eids: usEid }));                      // host: no gpp enforcer either
        const options = {};
        return drawbridgeHook(sinon.spy(), options, { mkDelay: neverDelay }).then(() => {
          expect(options.ortb2Fragments).to.be.undefined;
        });
      });

      it('allows federation when oajs enforces GPP', () => {
        gppInScope();
        getGlobal().installedModules = ['gppControl_usnat'];
        config.setConfig({ consentManagement: { gpp: {} } });
        useHost(makeHost({ eids: usEid }));
        const options = {};
        return drawbridgeHook(sinon.spy(), options, { mkDelay: neverDelay }).then(() => {
          expect(options.ortb2Fragments.global.user.ext.eids.map(e => e.source)).to.deep.equal(['id5-sync.com']);
        });
      });

      it('allows federation when the host enforces GPP', () => {
        gppInScope();
        getGlobal().installedModules = [];                       // oajs does not
        useHost(makeHost({ eids: usEid, installedModules: ['gppControl_usnat'], getConfig: cmGetConfig({ gpp: {} }) }));
        const options = {};
        return drawbridgeHook(sinon.spy(), options, { mkDelay: neverDelay }).then(() => {
          expect(options.ortb2Fragments.global.user.ext.eids.map(e => e.source)).to.deep.equal(['id5-sync.com']);
        });
      });

      it('does not block when no US GPP section is in scope (EU-only section 2)', () => {
        gppDataHandler.getConsentData.returns({ applicableSections: [2] });
        getGlobal().installedModules = [];
        useHost(makeHost({ eids: usEid }));
        const options = {};
        return drawbridgeHook(sinon.spy(), options, { mkDelay: neverDelay }).then(() => {
          expect(options.ortb2Fragments.global.user.ext.eids.map(e => e.source)).to.deep.equal(['id5-sync.com']);
        });
      });
    });
  });

  describe('gppFederationAllowed', () => {
    let savedModules;
    const state = (over) => ({ eids: [], cm: undefined, installedModules: undefined, coppa: false, ...over });
    beforeEach(() => {
      savedModules = getGlobal().installedModules;
      sinon.stub(gppDataHandler, 'getConsentData');
    });
    afterEach(() => {
      getGlobal().installedModules = savedModules;
      gppDataHandler.getConsentData.restore();
    });

    it('allows when no GPP consent data is available (nothing read __gpp)', () => {
      gppDataHandler.getConsentData.returns(null);
      getGlobal().installedModules = [];
      expect(gppFederationAllowed(state())).to.be.true;
    });

    it('allows when only an EU (non-US) GPP section applies', () => {
      gppDataHandler.getConsentData.returns({ applicableSections: [2] });
      getGlobal().installedModules = [];
      expect(gppFederationAllowed(state())).to.be.true;
    });

    it('blocks the leak cell: a US section applies and neither side enforces', () => {
      gppDataHandler.getConsentData.returns({ applicableSections: [8] });
      getGlobal().installedModules = [];
      expect(gppFederationAllowed(state())).to.be.false;
    });

    it('allows when oajs enforces (module + consentManagement.gpp)', () => {
      gppDataHandler.getConsentData.returns({ applicableSections: [7] });
      getGlobal().installedModules = ['gppControl_usnat'];
      config.setConfig({ consentManagement: { gpp: {} } });
      expect(gppFederationAllowed(state())).to.be.true;
    });

    it('does not treat a loaded module without a gpp config as enforcing', () => {
      gppDataHandler.getConsentData.returns({ applicableSections: [7] });
      getGlobal().installedModules = ['gppControl_usnat'];
      config.setConfig({ consentManagement: { gdpr: {} } });   // gpp not configured → not armed
      expect(gppFederationAllowed(state())).to.be.false;
    });

    it('allows when the host enforces, even if oajs does not', () => {
      gppDataHandler.getConsentData.returns({ applicableSections: [7] });
      getGlobal().installedModules = [];
      expect(gppFederationAllowed(state({ installedModules: ['gppControl_usstates'], cm: { gpp: {} } }))).to.be.true;
    });
  });

  describe('coppaFederationAllowed', () => {
    const state = (over) => ({ eids: [], cm: undefined, installedModules: undefined, coppa: false, ...over });
    afterEach(() => { config.setConfig({ coppa: false }); });

    it('allows when neither the host nor oajs flags COPPA', () => {
      config.setConfig({ coppa: false });
      expect(coppaFederationAllowed(state({ coppa: false }))).to.be.true;
    });

    it('blocks when the host flags COPPA (even if oajs does not)', () => {
      config.setConfig({ coppa: false });
      expect(coppaFederationAllowed(state({ coppa: true }))).to.be.false;
    });

    it('blocks when oajs flags COPPA (even if the host does not)', () => {
      config.setConfig({ coppa: true });
      expect(coppaFederationAllowed(state({ coppa: false }))).to.be.false;
    });

    it('allows when host and oajs agree that COPPA applies (both true)', () => {
      // agreement model: both declare child-directed → oajs request carries regs.coppa=1, so federating
      // (flagged) is consistent with oajs sending its own EIDs — federation is allowed
      config.setConfig({ coppa: true });
      expect(coppaFederationAllowed(state({ coppa: true }))).to.be.true;
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
