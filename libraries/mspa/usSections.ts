/**
 * Canonical GPP section IDs for US privacy (MSPA). This module is intentionally SIDE-EFFECT-FREE so any
 * module can import the list without pulling in — and thereby registering — the gppControl enforcement
 * modules. Keep this the single source of truth for which GPP sections are "US privacy".
 *
 * IAB GPP Section ID registry:
 * https://github.com/InteractiveAdvertisingBureau/Global-Privacy-Platform/blob/main/Sections/Section%20Information.md#section-ids
 */

/** US National (usnat) GPP section ID. */
export const US_NAT_SID = 7;

/** US state GPP section IDs → MSPA API name. */
export const DEFAULT_SID_MAPPING: Record<number, string> = {
  8: 'usca',
  9: 'usva',
  10: 'usco',
  11: 'usut',
  12: 'usct'
};

/** All US-privacy GPP section IDs (national + states). */
export const US_GPP_SECTION_IDS: number[] = [US_NAT_SID, ...Object.keys(DEFAULT_SID_MAPPING).map(Number)];
