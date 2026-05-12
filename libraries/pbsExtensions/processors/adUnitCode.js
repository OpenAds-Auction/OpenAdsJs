import {deepSetValue} from '../../../src/utils.js';

export function setImpAdUnitCode(imp, bidRequest) {
  const adUnitCode = bidRequest.adUnitCode;

  if (adUnitCode) {
    deepSetValue(
      imp,
      `ext.openads.adunitcode`,
      adUnitCode
    );
  }
}
