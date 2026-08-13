import { deepSetValue } from '../../../src/utils.js';

export function setRequestExtPrebidSafeRenderer(ortbRequest, bidderRequest) {
  deepSetValue(
    ortbRequest,
    `ext.openads.safeRenderer`,
    true
  );
}

export function setBidResponseSafeRenderer(bidResponse, bid) {
  const { rendererUrl } = bid.ext?.openads?.meta || {};
  if (rendererUrl) {
    bidResponse.safeRenderer = {
      url: rendererUrl,
    };
  }
}
