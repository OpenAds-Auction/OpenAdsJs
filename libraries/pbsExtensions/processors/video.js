import {VIDEO} from '../../../src/mediaTypes.js';

export function setBidResponseVideoCache(bidResponse, bid) {
  if (bidResponse.mediaType === VIDEO) {
    // try to get cache values from 'response.ext.openads.cache'
    // else try 'bid.ext.openads.targeting' as fallback
    let {cacheId: videoCacheKey, url: vastUrl} = bid?.ext?.openads?.cache?.vastXml ?? {};
    if (!videoCacheKey || !vastUrl) {
      const {oa_uuid: uuid, oa_cache_host: cacheHost, oa_cache_path: cachePath} = bid?.ext?.openads?.targeting ?? {};
      if (uuid && cacheHost && cachePath) {
        videoCacheKey = uuid;
        vastUrl = `https://${cacheHost}${cachePath}?uuid=${uuid}`;
      }
    }
    if (videoCacheKey && vastUrl) {
      Object.assign(bidResponse, {
        videoCacheKey,
        vastUrl
      })
    }
  }
}
