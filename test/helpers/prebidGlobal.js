import { getGlobalVarName } from '../../src/buildOptions.js';

const globalVarName = getGlobalVarName();
const oajsGlobal = window[globalVarName] = (window[globalVarName] || {});

oajsGlobal.version = oajsGlobal.version || 'v$prebid.version$';
oajsGlobal.installedModules = (oajsGlobal.installedModules || []);
oajsGlobal.cmd = oajsGlobal.cmd || [];
oajsGlobal.que = oajsGlobal.que || [];
