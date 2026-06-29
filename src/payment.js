/* ECPay（綠界）AIO 全方位金流：CheckMacValue 與結帳欄位。
   演算法依綠界官方文件（EncryptType=1 / SHA256）。實際對接需綠界特店帳號並通過其測試環境驗證。 */
const crypto = require('crypto');

// 綠界 .NET 風格 URL Encode（小寫）後 SHA256，回傳大寫 CheckMacValue
function ecpayCheckMac(params, hashKey, hashIV) {
  const keys = Object.keys(params)
    .filter(k => k !== 'CheckMacValue' && params[k] !== undefined && params[k] !== '')
    .sort((a, b) => {
      const la = a.toLowerCase(), lb = b.toLowerCase();
      return la < lb ? -1 : la > lb ? 1 : 0;
    });
  const query = keys.map(k => `${k}=${params[k]}`).join('&');
  const raw = `HashKey=${hashKey}&${query}&HashIV=${hashIV}`;
  const enc = encodeURIComponent(raw).toLowerCase()
    .replace(/%20/g, '+').replace(/%2d/g, '-').replace(/%5f/g, '_').replace(/%2e/g, '.')
    .replace(/%21/g, '!').replace(/%2a/g, '*').replace(/%28/g, '(').replace(/%29/g, ')');
  return crypto.createHash('sha256').update(enc).digest('hex').toUpperCase();
}

function ecpayDate(d = new Date()) {
  const z = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${z(d.getMonth() + 1)}/${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;
}

// 組出要 POST 給綠界的完整欄位（含 CheckMacValue）
function ecpayCheckoutFields(o) {
  const p = {
    MerchantID: o.merchantId,
    MerchantTradeNo: o.tradeNo,
    MerchantTradeDate: o.date || ecpayDate(),
    PaymentType: 'aio',
    TotalAmount: String(o.amount),
    TradeDesc: o.tradeDesc || '產後護理服務',
    ItemName: o.itemName || '住房費用',
    ReturnURL: o.returnURL,
    ChoosePayment: o.choosePayment || 'ALL',
    ClientBackURL: o.clientBackURL || '',
    EncryptType: '1'
  };
  p.CheckMacValue = ecpayCheckMac(p, o.hashKey, o.hashIV);
  return p;
}

function ecpayUrl(stage) {
  return stage ? 'https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5'
    : 'https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5';
}

module.exports = { ecpayCheckMac, ecpayDate, ecpayCheckoutFields, ecpayUrl };
