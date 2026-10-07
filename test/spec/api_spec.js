var assert = require('chai').assert;
var prebid = require('../../src/prebid.js');
const { getGlobalVarName } = require('../../src/buildOptions.js');
const { getGlobal } = require('../../src/prebidGlobal.js');

describe('Publisher API', function () {
  // var assert = chai.assert;

  describe('api of command queue', function () {
    it(`should have a global variable ${getGlobalVarName()}`, function () {
      assert.isObject(window[getGlobalVarName()]);
    });

    it(`should have a global variable ${getGlobalVarName()}.cmd as an array`, function () {
      assert.isArray(window[getGlobalVarName()].cmd);
    });

    it(`should have ${getGlobalVarName()}.cmd.push function`, function () {
      assert.isFunction(window[getGlobalVarName()].cmd.push);
    });

    it(`should have a global variable ${getGlobalVarName()}.que as an array`, function () {
      assert.isArray(window[getGlobalVarName()].que);
    });

    it(`should have ${getGlobalVarName()}.que.push function`, function () {
      assert.isFunction(window[getGlobalVarName()].que.push);
    });

    it('should have global pointer for PBJS global', function () {
      assert.isArray(window._pbjsGlobals);
    });

    describe('PBJS global pointer ordering', function () {
      const FOREIGN = '__otherPrebidGlobal';
      let registry;

      beforeEach(function () {
        registry = window._pbjsGlobals;
      });

      afterEach(function () {
        // splice is not wrapped, so this cleanup cannot re-trigger the reordering
        let i;
        while ((i = registry.indexOf(FOREIGN)) !== -1) registry.splice(i, 1);
      });

      it('should keep this instance last when another global registers afterwards', function () {
        registry.push(FOREIGN);
        assert.equal(registry[registry.length - 1], getGlobalVarName());
        assert.isBelow(registry.indexOf(FOREIGN), registry.lastIndexOf(getGlobalVarName()));
      });

      it('should keep this instance last when several globals register in one push', function () {
        registry.push(FOREIGN, FOREIGN);
        assert.equal(registry[registry.length - 1], getGlobalVarName());
      });

      it('should return the new length from push', function () {
        assert.equal(registry.push(FOREIGN), registry.length);
      });

      it('should not expose the push wrapper as an enumerable property', function () {
        assert.notInclude(Object.keys(registry), 'push');
        const keys = [];
        for (const k in registry) keys.push(k);
        assert.notInclude(keys, 'push');
      });
    });
  });

  describe('has function', function () {
    it('should have requestBids.before and .after', () => {
      assert.isFunction(getGlobal().requestBids.before);
      assert.isFunction(getGlobal().requestBids.after);
    });

    it('should have function .getAdserverTargeting', function () {
      assert.isFunction(getGlobal().getAdserverTargeting);
    });

    it('should have function .getAdserverTargetingForAdUnitCode', function () {
      assert.isFunction(getGlobal().getAdserverTargetingForAdUnitCode);
    });

    it('should have function .getBidResponses', function () {
      assert.isFunction(getGlobal().getBidResponses);
    });

    it('should have function .getNoBids', function () {
      assert.isFunction(getGlobal().getNoBids);
    });

    it('should have function .getNoBidsForAdUnitCode', function () {
      assert.isFunction(getGlobal().getNoBidsForAdUnitCode);
    });

    it('should have function .getBidResponsesForAdUnitCode', function () {
      assert.isFunction(getGlobal().getBidResponsesForAdUnitCode);
    });

    it('should have function .setTargetingForGPTAsync', function () {
      assert.isFunction(getGlobal().setTargetingForGPTAsync);
    });

    it('should have function .renderAd', function () {
      assert.isFunction(getGlobal().renderAd);
    });

    it('should have function .removeAdUnit', function () {
      assert.isFunction(getGlobal().removeAdUnit);
    });

    it('should have function .requestBids', function () {
      assert.isFunction(getGlobal().requestBids);
    });

    it('should have function .addAdUnits', function () {
      assert.isFunction(getGlobal().addAdUnits);
    });

    it('should have function .aliasBidder', function () {
      assert.isFunction(getGlobal().aliasBidder);
    });

    it('should have function .getAllWinningBids', function () {
      assert.isFunction(getGlobal().getAllWinningBids);
    });

    it('should have function .getHighestUnusedBidResponseForAdUnitCode', function () {
      assert.isFunction(getGlobal().getHighestUnusedBidResponseForAdUnitCode);
    });
  });
});
