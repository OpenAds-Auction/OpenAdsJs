import pbjs from 'src/prebid.js';
import { config } from 'src/config.js';

describe('moduleAutoConfig', function () {
  afterEach(function () {
    config.resetConfig();
    const idx = pbjs.installedModules.indexOf('humansecurityRtdProvider');
    if (idx !== -1) {
      pbjs.installedModules.splice(idx, 1);
    }
  });

  it('adds humansecurity to realTimeData.dataProviders when the module is installed', async function () {
    pbjs.installedModules.push('humansecurityRtdProvider');
    pbjs.processQueue();
    await new Promise((resolve) => pbjs.que.push(resolve));
    const rtd = config.getConfig('realTimeData');
    expect(rtd.dataProviders).to.deep.include({ name: 'humansecurity', params: { verbose: true } });
  });

  it('does not touch realTimeData when the module is not installed', async function () {
    pbjs.processQueue();
    await new Promise((resolve) => pbjs.que.push(resolve));
    const rtd = config.getConfig('realTimeData');
    expect(rtd == null || !rtd.dataProviders).to.be.true;
  });
});
