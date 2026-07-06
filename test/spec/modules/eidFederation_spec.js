import {
  mergeEids,
  filterProvenancedEids,
  readHostEids,
  federateEidsHook,
  prewarmHost,
  resetHostAuctionDelayCheck,
  validateConfig
} from 'modules/eidFederation.js';
import { config } from 'src/config.js';
import * as utils from 'src/utils.js';

describe('eidFederation module', () => {
  const HOST = 'pbjs';

  // build a fake foreign Prebid instance with a drainable command queue
  function makeHost({ eids = [], async = true } = {}) {
    const host = {
      que: [],
      getUserIdsAsEids: () => eids,
    };
    if (async) {
      host.getUserIdsAsync = () => Promise.resolve();
    }
    host.flush = () => {
      const cbs = host.que.splice(0);
      cbs.forEach(cb => cb());
    };
    return host;
  }

  afterEach(() => {
    delete window[HOST];
    config.setConfig({ eidFederation: {} });
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
  });

  describe('filterProvenancedEids', () => {
    it('keeps EIDs that have inserter AND mm AND a uid atype', () => {
      const eids = [{ source: 's', inserter: 'x.com', mm: 3, uids: [{ id: '1', atype: 1 }] }];
      expect(filterProvenancedEids(eids)).to.deep.equal(eids);
    });

    it('drops EIDs missing inserter', () => {
      const eids = [{ source: 's', mm: 3, uids: [{ id: '1', atype: 1 }] }];
      expect(filterProvenancedEids(eids)).to.deep.equal([]);
    });

    it('drops EIDs missing mm', () => {
      const eids = [{ source: 's', inserter: 'x.com', uids: [{ id: '1', atype: 1 }] }];
      expect(filterProvenancedEids(eids)).to.deep.equal([]);
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

    it('filters a mixed list, keeping only fully-provenanced EIDs', () => {
      const keep = { source: 'a', inserter: 'x.com', mm: 3, uids: [{ id: '1', atype: 1 }] };
      const dropNoMm = { source: 'b', inserter: 'x.com', uids: [{ id: '2', atype: 3 }] };
      const dropNoAtype = { source: 'c', inserter: 'x.com', mm: 1, uids: [{ id: '3' }] };
      expect(filterProvenancedEids([keep, dropNoMm, dropNoAtype])).to.deep.equal([keep]);
    });

    it('treats mm of 0 and atype of 0 as set', () => {
      const eids = [{ source: 's', inserter: 'x.com', mm: 0, uids: [{ id: '1', atype: 0 }] }];
      expect(filterProvenancedEids(eids)).to.deep.equal(eids);
    });

    it('handles empty / malformed input', () => {
      expect(filterProvenancedEids()).to.deep.equal([]);
      expect(filterProvenancedEids([null, undefined])).to.deep.equal([]);
    });
  });

  describe('validateConfig', () => {
    it('logs an error when hostGlobal is not a string', () => {
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

    it('does not log for valid types', () => {
      const spy = sinon.spy(utils, 'logError');
      validateConfig({ hostGlobal: 'pbjs', auctionDelay: 300, enabled: false });
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

    it('runs on setConfig for the eidFederation topic', () => {
      const spy = sinon.spy(utils, 'logError');
      config.setConfig({ eidFederation: { auctionDelay: 'nope' } });
      spy.restore();
      expect(spy.called).to.be.true;
    });
  });

  describe('host auctionDelay adoption (first federateEidsHook call)', () => {
    // dedicated global name so tests don't collide with the ambient `window.pbjs`
    const TEST_HOST = 'eidFedTestHost';
    beforeEach(() => resetHostAuctionDelayCheck());
    afterEach(() => { delete window[TEST_HOST]; });

    function runHook() {
      const done = federateEidsHook(sinon.spy(), {}, { mkDelay: () => new Promise(() => {}) });
      if (window[TEST_HOST] && Array.isArray(window[TEST_HOST].que)) {
        window[TEST_HOST].que.splice(0).forEach(cb => cb());
      }
      return done;
    }

    it("adopts the host's userSync.auctionDelay into eidFederation config on first call", () => {
      window[TEST_HOST] = { que: [], getConfig: (path) => (path === 'userSync.auctionDelay' ? 1500 : undefined) };
      config.setConfig({ eidFederation: { hostGlobal: TEST_HOST } });
      return runHook().then(() => {
        expect(config.getConfig('eidFederation').auctionDelay).to.equal(1500);
      });
    });

    it('does not overwrite an explicitly-configured auctionDelay, even if the host exposes one', () => {
      window[TEST_HOST] = { que: [], getConfig: (path) => (path === 'userSync.auctionDelay' ? 1500 : undefined) };
      config.setConfig({ eidFederation: { hostGlobal: TEST_HOST, auctionDelay: 250 } });
      return runHook().then(() => {
        expect(config.getConfig('eidFederation').auctionDelay).to.equal(250);
      });
    });

    it('writes DEFAULT_AUCTION_DELAY back to config when neither config nor host provide one', () => {
      window[TEST_HOST] = { que: [], getConfig: () => undefined };
      config.setConfig({ eidFederation: { hostGlobal: TEST_HOST } });
      return runHook().then(() => {
        expect(config.getConfig('eidFederation').auctionDelay).to.equal(500);
      });
    });

    it('only adopts on the first call, not subsequent ones', () => {
      window[TEST_HOST] = { que: [], getConfig: (path) => (path === 'userSync.auctionDelay' ? 1500 : undefined) };
      config.setConfig({ eidFederation: { hostGlobal: TEST_HOST } });
      return runHook().then(() => {
        expect(config.getConfig('eidFederation').auctionDelay).to.equal(1500);
        // host now reports a different value; a second call must NOT re-adopt it
        window[TEST_HOST].getConfig = (path) => (path === 'userSync.auctionDelay' ? 3000 : undefined);
        return runHook().then(() => {
          expect(config.getConfig('eidFederation').auctionDelay).to.equal(1500);
        });
      });
    });
  });

  describe('readHostEids', () => {
    it('resolves to [] when no host instance exists', () => {
      return readHostEids({ hostGlobal: HOST }).then(eids => {
        expect(eids).to.deep.equal([]);
      });
    });

    it('logs (info) when no host instance can be acquired', () => {
      const logInfoSpy = sinon.spy(utils, 'logInfo');
      return readHostEids({ hostGlobal: 'definitelyNotAHost' }).then(() => {
        const messages = logInfoSpy.getCalls().map(c => c.args[0]);
        logInfoSpy.restore();
        expect(messages.some(m => /no host instance found at window\.definitelyNotAHost/.test(m))).to.be.true;
      });
    });

    it('reads host EIDs after getUserIdsAsync resolves', () => {
      const eids = [{ source: 'id5-sync.com', uids: [{ id: 'AAA' }] }];
      const host = makeHost({ eids });
      window[HOST] = host;
      const p = readHostEids({ hostGlobal: HOST });
      host.flush();
      return p.then(result => expect(result).to.deep.equal(eids));
    });

    it('falls back to a synchronous read when getUserIdsAsync is absent', () => {
      const eids = [{ source: 'pubcid.org', uids: [{ id: 'BBB' }] }];
      const host = makeHost({ eids, async: false });
      window[HOST] = host;
      const p = readHostEids({ hostGlobal: HOST });
      host.flush();
      return p.then(result => expect(result).to.deep.equal(eids));
    });
  });

  describe('federateEidsHook', () => {
    it('merges host EIDs into ortb2Fragments.global.user.ext.eids and calls next', () => {
      const hostEids = [{ source: 'id5-sync.com', inserter: 'x.com', mm: 3, uids: [{ id: 'AAA', atype: 1 }] }];
      const host = makeHost({ eids: hostEids });
      window[HOST] = host;

      const options = {
        ortb2Fragments: { global: { user: { ext: { eids: [{ source: 'pubcid.org', uids: [{ id: 'BBB' }] }] } } } }
      };
      const next = sinon.spy();
      // never let the budget win the race
      const neverDelay = () => new Promise(() => {});

      const done = federateEidsHook(next, options, { mkDelay: neverDelay });
      host.flush();
      return done.then(() => {
        const result = options.ortb2Fragments.global.user.ext.eids;
        expect(result.map(e => e.source).sort()).to.deep.equal(['id5-sync.com', 'pubcid.org']);
        expect(next.calledOnceWith(options)).to.be.true;
        // only the synced (host) EID is tagged with ext.federatedFrom; OpenAds' own EID is not
        const bySource = Object.fromEntries(result.map(e => [e.source, e]));
        expect(bySource['id5-sync.com'].ext.federatedFrom).to.equal('pbjs');
        expect(bySource['pubcid.org'].ext?.federatedFrom).to.be.undefined;
      });
    });

    it('logs (info) the retrieved and syncing EID sets', () => {
      const keep = { source: 'id5-sync.com', inserter: 'x.com', mm: 3, uids: [{ id: 'AAA', atype: 1 }] };
      const drop = { source: 'pubcid.org', uids: [{ id: 'BBB' }] };
      const host = makeHost({ eids: [keep, drop] });
      window[HOST] = host;
      const logInfoSpy = sinon.spy(utils, 'logInfo');

      const done = federateEidsHook(sinon.spy(), {}, { mkDelay: () => new Promise(() => {}) });
      host.flush();
      return done.then(() => {
        const messages = logInfoSpy.getCalls().map(c => c.args[0]);
        logInfoSpy.restore();
        expect(messages.some(m => /retrieved 2 EID/.test(m))).to.be.true;
        expect(messages.some(m => /syncing 1 EID/.test(m))).to.be.true;
      });
    });

    it('logs (info) when 0 EIDs are received from the host', () => {
      const host = makeHost({ eids: [] });
      window[HOST] = host;
      const logInfoSpy = sinon.spy(utils, 'logInfo');

      const done = federateEidsHook(sinon.spy(), {}, { mkDelay: () => new Promise(() => {}) });
      host.flush();
      return done.then(() => {
        const messages = logInfoSpy.getCalls().map(c => c.args[0]);
        logInfoSpy.restore();
        expect(messages.some(m => /received 0 EID/.test(m))).to.be.true;
      });
    });

    it('does not merge host EIDs that lack inserter, mm, and uid atype', () => {
      const hostEids = [{ source: 'id5-sync.com', uids: [{ id: 'AAA' }] }]; // no provenance
      const host = makeHost({ eids: hostEids });
      window[HOST] = host;

      const options = {};
      const next = sinon.spy();
      const done = federateEidsHook(next, options, { mkDelay: () => new Promise(() => {}) });
      host.flush();
      return done.then(() => {
        expect(next.calledOnceWith(options)).to.be.true;
        expect(options.ortb2Fragments?.global?.user?.ext?.eids).to.be.undefined;
      });
    });

    it('proceeds (calls next) without host EIDs when the budget elapses first', () => {
      // host present but never resolves getUserIdsAsync
      const host = { que: [], getUserIdsAsEids: () => [{ source: 'x', uids: [{ id: '1' }] }], getUserIdsAsync: () => new Promise(() => {}) };
      window[HOST] = host;

      const options = {};
      const next = sinon.spy();
      const immediateTimeout = () => Promise.resolve();

      const done = federateEidsHook(next, options, { mkDelay: immediateTimeout });
      host.que.splice(0).forEach(cb => cb());
      return done.then(() => {
        expect(next.calledOnceWith(options)).to.be.true;
        expect(options.ortb2Fragments?.global?.user?.ext?.eids).to.be.undefined;
      });
    });

    it('calls next even when no host instance is present', () => {
      const options = {};
      const next = sinon.spy();
      return federateEidsHook(next, options, { mkDelay: () => new Promise(() => {}) }).then(() => {
        expect(next.calledOnceWith(options)).to.be.true;
      });
    });

    it('is enabled by default: it still reads host EIDs when `enabled` is omitted', () => {
      const hostEids = [{ source: 'id5-sync.com', inserter: 'x.com', mm: 3, uids: [{ id: 'AAA', atype: 1 }] }];
      const host = makeHost({ eids: hostEids });
      window[HOST] = host;

      const options = {};
      const done = federateEidsHook(sinon.spy(), options, { mkDelay: () => new Promise(() => {}) });
      host.flush();
      return done.then(() => {
        expect(options.ortb2Fragments.global.user.ext.eids.map(e => e.source)).to.deep.equal(['id5-sync.com']);
      });
    });

    it('skips reading the host entirely and calls next immediately when enabled is false', () => {
      const hostEids = [{ source: 'id5-sync.com', inserter: 'x.com', mm: 3, uids: [{ id: 'AAA', atype: 1 }] }];
      const host = makeHost({ eids: hostEids });
      window[HOST] = host;
      config.setConfig({ eidFederation: { enabled: false } });

      const options = {};
      const next = sinon.spy();
      // if the hook tried to read the host, it would hang forever on this delay/queue never being flushed
      const done = federateEidsHook(next, options, { mkDelay: () => new Promise(() => {}) });
      return done.then(() => {
        expect(next.calledOnceWith(options)).to.be.true;
        expect(options.ortb2Fragments).to.be.undefined;
        expect(host.que).to.have.length(0);
      });
    });
  });

  describe('prewarmHost', () => {
    it('queues a getUserIdsAsync call on the host', () => {
      const host = makeHost();
      const spy = sinon.spy(host, 'getUserIdsAsync');
      window[HOST] = host;
      prewarmHost({ hostGlobal: HOST });
      host.flush();
      expect(spy.called).to.be.true;
    });

    it('is a no-op when no host instance is present', () => {
      expect(() => prewarmHost({ hostGlobal: HOST })).to.not.throw();
    });
  });
});
