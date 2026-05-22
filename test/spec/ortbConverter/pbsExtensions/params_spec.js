import {setImpBidParams} from '../../../../libraries/pbsExtensions/processors/params.js';

describe('pbjs -> ortb bid params to imp[].ext.openads.BIDDER', () => {
  let bidderRegistry, index, adUnit;
  beforeEach(() => {
    bidderRegistry = {};
    adUnit = {code: 'mockAdUnit'};
    index = {
      getAdUnit() {
        return adUnit;
      }
    }
  });

  function setParams(bidRequest, context, deps = {}) {
    const imp = {};
    setImpBidParams(imp, bidRequest, context, Object.assign({bidderRegistry, index}, deps))
    return imp;
  }

  it('sets params in ext.openads.bidder.BIDDER', () => {
    expect(setParams({bidder: 'mockBidder', params: {a: 'param'}})).to.eql({
      ext: {
        openads: {
          bidder: {
            mockBidder: {
              a: 'param'
            }
          }
        }
      }
    })
  });

  it('has no effect if bidRequest has no params', () => {
    expect(setParams({bidder: 'mockBidder'})).to.eql({});
  });
});
