// 金流 CheckMacValue 單元測試（不需啟動伺服器）
const { test } = require('node:test');
const assert = require('node:assert');
const { ecpayCheckMac, ecpayCheckoutFields, ecpayUrl } = require('../src/payment');

const KEY = '5294y06JbISpM5x9', IV = 'v77hoKGq4kWxNNIS';
const sample = {
  MerchantID: '2000132', MerchantTradeNo: 'Test1234', MerchantTradeDate: '2026/06/29 12:00:00',
  PaymentType: 'aio', TotalAmount: '3000', TradeDesc: 'care', ItemName: 'room', ReturnURL: 'https://x.tw/cb', ChoosePayment: 'ALL'
};

test('CheckMacValue 為 64 碼大寫十六進位', () => {
  const mac = ecpayCheckMac(sample, KEY, IV);
  assert.match(mac, /^[0-9A-F]{64}$/);
});

test('相同輸入結果一致（確定性）', () => {
  assert.strictEqual(ecpayCheckMac(sample, KEY, IV), ecpayCheckMac({ ...sample }, KEY, IV));
});

test('參數順序不影響結果（內部排序）', () => {
  const reordered = {};
  Object.keys(sample).reverse().forEach(k => { reordered[k] = sample[k]; });
  assert.strictEqual(ecpayCheckMac(sample, KEY, IV), ecpayCheckMac(reordered, KEY, IV));
});

test('竄改金額會改變 CheckMacValue', () => {
  const tampered = { ...sample, TotalAmount: '1' };
  assert.notStrictEqual(ecpayCheckMac(sample, KEY, IV), ecpayCheckMac(tampered, KEY, IV));
});

test('checkout 欄位含 CheckMacValue 且可被重新驗證', () => {
  const f = ecpayCheckoutFields({ merchantId: '2000132', hashKey: KEY, hashIV: IV, tradeNo: 'T1', amount: 3000, returnURL: 'https://x.tw/cb' });
  const mac = f.CheckMacValue;
  assert.strictEqual(ecpayCheckMac(f, KEY, IV), mac);
});

test('環境網址切換', () => {
  assert.match(ecpayUrl(true), /payment-stage\.ecpay/);
  assert.match(ecpayUrl(false), /^https:\/\/payment\.ecpay/);
});
