const expect = require('chai').expect;
const { setupTest, testPageURL } = require('../../../helpers/testing-utils.js');

const TEST_PAGE_URL = testPageURL('native.html?pbjs_debug=true');
const CREATIVE_IFRAME_CSS_SELECTOR = 'iframe[id="google_ads_iframe_/92296675/prebid_native_example_1_0"]';

const EXPECTED_TARGETING_KEYS = {
  oa_pb_appnexus: '10.00',
  oa_format: 'native',
  oa_size: '0x0',
  oa_bidder_appnexus: 'appnexus',
  oa_pb: '10.00',
  oa_bidder: 'appnexus',
  oa_format_appnexus: 'native',
  oa_size_appnexus: '0x0'
};

setupTest({
  url: TEST_PAGE_URL,
  waitFor: CREATIVE_IFRAME_CSS_SELECTOR,
  expectGAMCreative: true,
  nestedIframe: false
}, 'Prebid.js Native Ad Unit Test', function () {
  it('should load the targeting keys with correct values', async function () {
    const result = await browser.execute(function () {
      return window.oajs.getAdserverTargeting('/92296675/prebid_native_example_2');
    });

    const targetingKeys = result['/92296675/prebid_native_example_2'];
    expect(targetingKeys).to.include(EXPECTED_TARGETING_KEYS);
  });
});
