import adapterManager from '../../../src/adapterManager.js';
import {config} from '../../../src/config.js';
import {deepSetValue} from '../../../src/utils.js';

export function setRequestExtPrebidAliases(ortbRequest, bidderRequest, context, {am = adapterManager} = {}) {
  if (am.aliasRegistry[bidderRequest.bidderCode]) {
    const bidder = am.bidderRegistry[bidderRequest.bidderCode];
    // adding alias only if alias source bidder exists and alias isn't configured to be standalone
    // pbs adapter
    if (!bidder || !bidder.getSpec().skipPbsAliasing) {
      // set alias
      deepSetValue(
        ortbRequest,
        `ext.openads.aliases.${bidderRequest.bidderCode}`,
        am.aliasRegistry[bidderRequest.bidderCode]
      );

      // set alias gvlids if present also
      const gvlId = config.getConfig(`gvlMapping.${bidderRequest.bidderCode}`) || bidder?.getSpec?.().gvlid;
      if (gvlId) {
        deepSetValue(
          ortbRequest,
          `ext.openads.aliasgvlids.${bidderRequest.bidderCode}`,
          gvlId
        );
      }
    }
  }
}
