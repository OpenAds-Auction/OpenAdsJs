import { getGlobal } from './prebidGlobal.js';

const oajs = getGlobal();

oajs.que.push(function () {
  const installed = oajs.installedModules;

  if (installed.includes('humansecurityRtdProvider')) {
    oajs.mergeConfig({
      realTimeData: {
        dataProviders: [{ name: 'humansecurity', params: { verbose: true } }]
      }
    });
  }
});
