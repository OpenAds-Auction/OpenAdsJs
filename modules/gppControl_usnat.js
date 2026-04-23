import { config } from '../src/config.js';
import { getRules, setupRules } from '../libraries/mspa/activityControls.js';
import { US_NAT_SID } from '../libraries/mspa/usSections.js';

let unregister = null;

config.getConfig('consentManagement', (cfg) => {
  if (cfg?.consentManagement?.gpp != null) {
    if (unregister != null) unregister();
    unregister = setupRules('usnat', [US_NAT_SID], getRules(cfg.consentManagement.gpp.mspa?.restrictActivities));
  }
})
