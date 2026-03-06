const expect = require('chai').expect;
const { testPageURL, setupTest } = require('../../../helpers/testing-utils.js');

const TEST_PAGE_URL = testPageURL('instream.html?pbjs_debug=true');
const ALERT_BOX_CSS_SELECTOR = 'div[id="event-window"] > p[id="statusText"]';

const EXPECTED_TARGETING_KEYS = {
  oa_format: 'video',
  oa_size: '640x480',
  oa_pb: '10.00',
  oa_bidder: 'appnexus',
  oa_format_appnexus: 'video',
  oa_size_appnexus: '640x480',
  oa_pb_appnexus: '10.00',
  oa_bidder_appnexus: 'appnexus'
};
setupTest({
  url: TEST_PAGE_URL,
  waitFor: ALERT_BOX_CSS_SELECTOR,
}, 'Prebid.js Instream Video Ad Test', function () {
  it('should load the targeting keys with correct values', async function () {
    const result = await browser.execute(function () {
      return window.top.oajs.getAdserverTargeting('video1');
    });

    const targetingKeys = result['video1'];
    expect(targetingKeys).to.include(EXPECTED_TARGETING_KEYS);
    expect(targetingKeys.oa_adid).to.be.a('string');
    expect(targetingKeys.oa_adid_appnexus).to.be.a('string');
    expect(targetingKeys.oa_uuid).to.be.a('string');
    expect(targetingKeys.oa_uuid_appnexus).to.be.a('string');
  });
});
