export const JSON_MAPPING = {
  PL_CODE: 'code',
  PL_SIZE: 'sizes',
  PL_BIDS: 'bids',
  BD_BIDDER: 'bidder',
  BD_ID: 'paramsd',
  BD_PL_ID: 'placementId',
  ADSERVER_TARGETING: 'adserverTargeting',
  BD_SETTING_STANDARD: 'standard'
} as const;

export const DEBUG_MODE = 'pbjs_debug';

export const STATUS = {
  GOOD: 1
};

export const EVENTS = {
  AUCTION_INIT: 'auctionInit',
  AUCTION_TIMEOUT: 'auctionTimeout',
  AUCTION_END: 'auctionEnd',
  BID_ADJUSTMENT: 'bidAdjustment',
  BID_TIMEOUT: 'bidTimeout',
  BID_REQUESTED: 'bidRequested',
  BID_RESPONSE: 'bidResponse',
  BID_REJECTED: 'bidRejected',
  NO_BID: 'noBid',
  SEAT_NON_BID: 'seatNonBid',
  BID_WON: 'bidWon',
  BIDDER_DONE: 'bidderDone',
  BIDDER_ERROR: 'bidderError',
  SET_TARGETING: 'setTargeting',
  BEFORE_REQUEST_BIDS: 'beforeRequestBids',
  BEFORE_BIDDER_HTTP: 'beforeBidderHttp',
  REQUEST_BIDS: 'requestBids',
  ADD_AD_UNITS: 'addAdUnits',
  AD_RENDER_FAILED: 'adRenderFailed',
  AD_RENDER_SUCCEEDED: 'adRenderSucceeded',
  TCF2_ENFORCEMENT: 'tcf2Enforcement',
  AUCTION_DEBUG: 'auctionDebug',
  BID_VIEWABLE: 'bidViewable',
  STALE_RENDER: 'staleRender',
  EXPIRED_RENDER: 'expiredRender',
  BILLABLE_EVENT: 'billableEvent',
  BID_ACCEPTED: 'bidAccepted',
  RUN_PAAPI_AUCTION: 'paapiRunAuction',
  PBS_ANALYTICS: 'pbsAnalytics',
  PAAPI_BID: 'paapiBid',
  PAAPI_NO_BID: 'paapiNoBid',
  PAAPI_ERROR: 'paapiError',
  BEFORE_PBS_HTTP: 'beforePBSHttp',
  BROWSI_INIT: 'browsiInit',
  BROWSI_DATA: 'browsiData',
  BROWSER_INTERVENTION: 'browserIntervention'
} as const;

export const AD_RENDER_FAILED_REASON = {
  PREVENT_WRITING_ON_MAIN_DOCUMENT: 'preventWritingOnMainDocument',
  NO_AD: 'noAd',
  EXCEPTION: 'exception',
  CANNOT_FIND_AD: 'cannotFindAd',
  MISSING_DOC_OR_ADID: 'missingDocOrAdid'
} as const;

export const EVENT_ID_PATHS = {
  bidWon: 'adUnitCode'
} as const;

export const GRANULARITY_OPTIONS = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  AUTO: 'auto',
  DENSE: 'dense',
  CUSTOM: 'custom'
} as const;

export const TARGETING_KEYS = {
  BIDDER: 'oa_bidder',
  AD_ID: 'oa_adid',
  PRICE_BUCKET: 'oa_pb',
  SIZE: 'oa_size',
  DEAL: 'oa_deal',
  SOURCE: 'oa_source',
  FORMAT: 'oa_format',
  UUID: 'oa_uuid',
  CACHE_ID: 'oa_cache_id',
  CACHE_HOST: 'oa_cache_host',
  ADOMAIN: 'oa_adomain',
  ACAT: 'oa_acat',
  CRID: 'oa_crid',
  DSP: 'oa_dsp',
  VERSION: 'oa_ver'
} as const;

export const DEFAULT_TARGETING_KEYS = {
  BIDDER: 'oa_bidder',
  AD_ID: 'oa_adid',
  PRICE_BUCKET: 'oa_pb',
  SIZE: 'oa_size',
  DEAL: 'oa_deal',
  FORMAT: 'oa_format',
  UUID: 'oa_uuid',
  CACHE_HOST: 'oa_cache_host',
  VERSION: 'oa_ver'
};

export const NATIVE_KEYS = {
  title: 'oa_native_title',
  body: 'oa_native_body',
  body2: 'oa_native_body2',
  privacyLink: 'oa_native_privacy',
  privacyIcon: 'oa_native_privicon',
  sponsoredBy: 'oa_native_brand',
  image: 'oa_native_image',
  icon: 'oa_native_icon',
  clickUrl: 'oa_native_linkurl',
  displayUrl: 'oa_native_displayurl',
  cta: 'oa_native_cta',
  rating: 'oa_native_rating',
  address: 'oa_native_address',
  downloads: 'oa_native_downloads',
  likes: 'oa_native_likes',
  phone: 'oa_native_phone',
  price: 'oa_native_price',
  salePrice: 'oa_native_saleprice',
  rendererUrl: 'oa_renderer_url',
  adTemplate: 'oa_adTemplate'
};

export const S2S = {
  SRC: 's2s',
  DEFAULT_ENDPOINT: 'https://prebid.adnxs.com/pbs/v1/openrtb2/auction',
  SYNCED_BIDDERS_KEY: 'pbjsSyncs'
} as const;

export const BID_STATUS = {
  BID_TARGETING_SET: 'targetingSet',
  RENDERED: 'rendered',
  BID_REJECTED: 'bidRejected'
} as const;

export const REJECTION_REASON = {
  INVALID: 'Bid has missing or invalid properties',
  INVALID_REQUEST_ID: 'Invalid request ID',
  BIDDER_DISALLOWED: 'Bidder code is not allowed by allowedAlternateBidderCodes / allowUnknownBidderCodes',
  FLOOR_NOT_MET: 'Bid does not meet price floor',
  CANNOT_CONVERT_CURRENCY: 'Unable to convert currency',
  DSA_REQUIRED: 'Bid does not provide required DSA transparency info',
  DSA_MISMATCH: 'Bid indicates inappropriate DSA rendering method',
  PRICE_TOO_HIGH: 'Bid price exceeds maximum value'
};

export const PREBID_NATIVE_DATA_KEYS_TO_ORTB = {
  body: 'desc',
  body2: 'desc2',
  sponsoredBy: 'sponsored',
  cta: 'ctatext',
  rating: 'rating',
  address: 'address',
  downloads: 'downloads',
  likes: 'likes',
  phone: 'phone',
  price: 'price',
  salePrice: 'saleprice',
  displayUrl: 'displayurl'
} as const;

export const NATIVE_ASSET_TYPES = {
  sponsored: 1,
  desc: 2,
  rating: 3,
  likes: 4,
  downloads: 5,
  price: 6,
  saleprice: 7,
  phone: 8,
  address: 9,
  desc2: 10,
  displayurl: 11,
  ctatext: 12
};

export const NATIVE_IMAGE_TYPES = {
  ICON: 1,
  MAIN: 3
};

export const NATIVE_KEYS_THAT_ARE_NOT_ASSETS = [
  'privacyIcon',
  'clickUrl',
  'adTemplate',
  'rendererUrl',
  'type'
] as const;

export const MESSAGES = {
  REQUEST: 'OpenAds Request',
  RESPONSE: 'OpenAds Response',
  NATIVE: 'OpenAds Native',
  EVENT: 'OpenAds Event',
  INTERVENTION: 'OpenAds Intervention'
};

export const PB_LOCATOR = '__pb_locator__';
