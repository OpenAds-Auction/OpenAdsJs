import { setImpBidParams } from '../../../../libraries/pbsExtensions/processors/params.js';

describe('pbjs -> ortb bid params to imp[].ext.openads.BIDDER', () => {
  function setParams(bidRequest = {}) {
    const imp = {};
    setImpBidParams(imp, bidRequest)
    return imp;
  }

  it('sets params in ext.openads.bidder.BIDDER', () => {
    expect(setParams({ bidder: 'mockBidder', params: { a: 'param' } })).to.eql({
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
    expect(setParams({ bidder: 'mockBidder' })).to.eql({});
  });
});
