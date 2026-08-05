import { config } from '../src/config.js';
import { setupRules } from '../libraries/mspa/activityControls.js';
import { US_NAT_SID } from '../libraries/mspa/usSections.js';

let setupDone = false;

config.getConfig('consentManagement', (cfg) => {
  if (cfg?.consentManagement?.gpp != null && !setupDone) {
    setupRules('usnat', [US_NAT_SID]);
    setupDone = true;
  }
})
