<script type="text/javascript">
var oajs = oajs || {};
oajs.que = oajs.que || [];

(function() {
    var oajsEl = document.createElement('script'); oajsEl.type = 'text/javascript';
    oajsEl.async = true;
    oajsEl.src = '../../../build/dev/openads.js'
    var oajsTargetEl = document.getElementsByTagName('head')[0];
    oajsTargetEl.insertBefore(oajsEl, oajsTargetEl.firstChild);
})();

oajs.que.push(function() {
    var adUnits = [{
        code: '[%%adUnitCode%%]',
        sizes: [%%sizes%%],
        bids: [%%adUnitBids%%]
    }];
    oajs.addAdUnits(adUnits);

    oajs.requestBids({
        timeout: [%%timeout%%],
        bidsBackHandler: function() {
            var iframe = document.getElementById('postbid_if_3');
            var iframeDoc = iframe.contentWindow.document;
            var params = oajs.getAdserverTargetingForAdUnitCode('[%%adUnitCode%%]');

            // If any bidders return any creatives
            var bid;
            if(params && params['hb_adid']){
                var bid;
                for(i=0; i< oajs._bidsReceived.length; i++ ) {
                  if (params['hb_adid'] === oajs._bidsReceived[i].adId) {
                    bid = oajs._bidsReceived[i];
                    break;
                  }
                }
                oajs.renderAd(iframeDoc, params['hb_adid']);
              } else {
                // If no bidder return any creatives,
                // Passback 3rd party tag in Javascript
                iframe.width = [%%size0%%];
                iframe.height = [%%size1%%];
                iframeDoc.write('[%%passbackTagHtml%%]');
            }

            var iframeResize = window.parent.document.getElementById('[%%targetId%%]');
            iframeResize.height = (bid.height) ? bid.height+'px' : '[%%size1%%]px';
            iframeResize.width = (bid.width) ? bid.width+'px' : '[%%size0%%]px';
          }
    });
});
</script>
<iframe id='postbid_if_3' FRAMEBORDER="0" SCROLLING="no" MARGINHEIGHT="0" MARGINWIDTH="0" TOPMARGIN="0" LEFTMARGIN="0" ALLOWTRANSPARENCY="true" WIDTH="0" HEIGHT="0"></iframe>
