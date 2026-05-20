export function getCurrencyFromBidderRequest(bidderRequest) {
  return bidderRequest?.ortb2?.ext?.openads?.adServerCurrency;
}
