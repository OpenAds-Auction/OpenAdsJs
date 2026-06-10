import { setBidResponseVideoCache } from '../../../../libraries/pbsExtensions/processors/video.js';

describe('pbjs - ortb videoCacheKey based on ext.openads', () => {
  const EXT_PREBID_CACHE = {
    ext: {
      openads: {
        cache: {
          vastXml: {
            cacheId: 'id',
            url: 'url'
          }
        }
      }
    }
  };

  function setCache(bid) {
    const bidResponse = { mediaType: 'video' };
    setBidResponseVideoCache(bidResponse, bid);
    return bidResponse;
  }

  it('has no effect if mediaType is not video', () => {
    const resp = { mediaType: 'banner' };
    setBidResponseVideoCache(resp, EXT_PREBID_CACHE);
    expect(resp).to.eql({ mediaType: 'banner' });
  });

  it('sets videoCacheKey, vastUrl from ext.openads.cache.vastXml', () => {
    sinon.assert.match(setCache(EXT_PREBID_CACHE), {
      videoCacheKey: 'id',
      vastUrl: 'url'
    });
  });

  it('sets videoCacheKey, vastUrl from ext.openads.targeting', () => {
    sinon.assert.match(setCache({
      ext: {
        openads: {
          targeting: {
            oa_uuid: 'id',
            oa_cache_host: 'host',
            oa_cache_path: '/path'
          }
        }
      }
    }), {
      vastUrl: 'https://host/path?uuid=id',
      videoCacheKey: 'id'
    });
  });
});
