import { expect } from 'chai';
import { hasVendorPurposeConsent, setDefaultPurposeDeclaration, DEFAULT_PURPOSE_DECLARATION } from '../../../../libraries/consentManagement/consentUtils.js';

describe('consentUtils', function () {
  const HOST_GVLID = '52';

  beforeEach(function () {
    // defaultPurposeDeclaration is module-level state normally set by tcfControl's
    // setEnforcementConfig; set it explicitly so this test doesn't depend on that
    // module having run first, which isn't guaranteed across chunked test runs.
    setDefaultPurposeDeclaration(DEFAULT_PURPOSE_DECLARATION);
  });

  function mockConsent({ purposeConsent = true, vendorConsent = true, restriction, gdprApplies = true } = {}) {
    const consent = {
      gdprApplies,
      vendorData: {
        purpose: {
          consents: { 1: purposeConsent }
        },
        vendor: {
          consents: { [HOST_GVLID]: vendorConsent }
        }
      }
    };
    if (restriction != null) {
      consent.vendorData.publisher = {
        restrictions: {
          1: { [HOST_GVLID]: restriction }
        }
      };
    }
    return consent;
  }

  describe('hasVendorPurposeConsent', function () {
    it('returns true when purpose and vendor consent are granted', function () {
      expect(hasVendorPurposeConsent(mockConsent(), 1, HOST_GVLID)).to.be.true;
    });

    it('returns false when publisher restriction blocks consent for the host vendor', function () {
      expect(hasVendorPurposeConsent(mockConsent({ restriction: 0 }), 1, HOST_GVLID)).to.be.false;
      expect(hasVendorPurposeConsent(mockConsent({ restriction: 2 }), 1, HOST_GVLID)).to.be.false;
    });

    it('returns true when gdpr does not apply', function () {
      expect(hasVendorPurposeConsent(mockConsent({ gdprApplies: false, vendorConsent: false }), 1, HOST_GVLID)).to.be.true;
    });
  });
});
