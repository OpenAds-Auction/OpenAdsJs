const expect = require('chai').expect;
const {setupTest, testPageURL} = require('../../../helpers/testing-utils.js');

const TEST_PAGE_URL = testPageURL('banner.html?pbjs_debug=true');
const SYNC_PAGE_URL = testPageURL('banner_sync.html?pbjs_debug=true');
const CREATIVE_IFRAME_ID = 'google_ads_iframe_/19968336/header-bid-tag-0_0';
const CREATIVE_IFRAME_CSS_SELECTOR = 'iframe[id="' + CREATIVE_IFRAME_ID + '"]';

const EXPECTED_TARGETING_KEYS = {
  'oa_format': 'banner',
  'oa_pb': '0.50',
  'oa_bidder': 'appnexus',
  'oa_format_appnexus': 'banner',
  'oa_pb_appnexus': '0.50',
  'oa_bidder_appnexus': 'appnexus'
};

Object.entries({
  'synchronously': SYNC_PAGE_URL,
  'asynchronously': TEST_PAGE_URL,
}).forEach(([t, testPage]) => {
  setupTest({
    url: testPage,
    waitFor: CREATIVE_IFRAME_CSS_SELECTOR,
    expectGAMCreative: true
  }, `Prebid.js Banner Ad Unit Test (loading ${t})`, function () {
    it('should load the targeting keys with correct values', async function () {
      const result = await browser.execute(function () {
        return window.oajs.getAdserverTargeting('div-gpt-ad-1460505748561-1');
      });
      const targetingKeys = result['div-gpt-ad-1460505748561-1'];

      expect(targetingKeys).to.include(EXPECTED_TARGETING_KEYS);
      expect(targetingKeys.oa_adid).to.be.a('string');
      expect(targetingKeys.oa_adid_appnexus).to.be.a('string');
      expect(targetingKeys.oa_size).to.satisfy((size) => size === '300x250' || '300x600');
    });
  });
});
