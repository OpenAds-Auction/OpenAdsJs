import {deepSetValue} from '../../../src/utils.js';

export function setRequestExtPrebidPageViewIds(ortbRequest, bidderRequest) {
  deepSetValue(
    ortbRequest,
    `ext.openads.page_view_ids.${bidderRequest.bidderCode}`,
    bidderRequest.pageViewId
  );
}
