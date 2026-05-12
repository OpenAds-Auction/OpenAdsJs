import {deepSetValue, mergeDeep} from '../../../src/utils.js';
import {config} from '../../../src/config.js';
import {getGlobal} from '../../../src/prebidGlobal.js';

export function setRequestExtPrebid(ortbRequest, bidderRequest) {
  deepSetValue(
    ortbRequest,
    'ext.openads',
    mergeDeep(
      {
        auctiontimestamp: bidderRequest.auctionStart,
        targeting: {
          includewinners: true,
          includebidderkeys: false
        }
      },
      ortbRequest.ext?.openads,
    )
  );
  if (config.getConfig('debug')) {
    ortbRequest.ext.openads.debug = true;
  }
}

export function setRequestExtPrebidsChannel(ortbRequest) {
  deepSetValue(ortbRequest, 'ext.openads.channel', Object.assign({
    name: 'oajs',
    version: getGlobal().oaVersion
  }, ortbRequest.ext?.openads?.channel));
}
