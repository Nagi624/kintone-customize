/*
 * 請求・入金管理(app21)カスタマイズ
 * - 「見積書番号」をルックアップで取得したら、その見積書(app16)の「案件No」を読み取り、
 *   この画面の「案件No」にセットしてルックアップを自動実行する(会社名・案件名・営業主担当・案件売上が入る)
 *   ※ kintoneは1つのフィールドを複数のルックアップのコピー先にできないため、見積書→案件の連鎖はJSで行う
 */
(function () {
  'use strict';

  var QUOTE_APP_ID = 16;

  // PC/スマホでレコード操作APIが違うため、イベントの種類から判定して切り替える
  var IS_MOBILE = false;
  function recApi() { return IS_MOBILE ? kintone.mobile.app.record : kintone.app.record; }
  function detectEnv(event) { IS_MOBILE = event.type.indexOf('mobile.') === 0; }

  function fv(obj, code, fallback) {
    return obj && obj[code] && obj[code].value !== undefined ? obj[code].value : fallback;
  }

  function fillDealFromQuote(quoteNo) {
    var query = '見積書番号 = "' + quoteNo.replace(/"/g, '\\"') + '" limit 1';
    kintone.api(kintone.api.url('/k/v1/records', true), 'GET', {
      app: QUOTE_APP_ID,
      query: query,
      fields: ['案件No']
    }).then(function (resp) {
      var dealNo = resp.records.length ? fv(resp.records[0], '案件No', '') : '';
      if (!dealNo) return;
      var current = recApi().get();
      if (fv(current.record, '案件No', '') === dealNo) return;
      current.record['案件No'].value = dealNo;
      current.record['案件No'].lookup = true;
      recApi().set(current);
    }).catch(function (e) {
      console.error('見積書から案件Noの取得に失敗しました', e);
    });
  }

  kintone.events.on(['app.record.create.change.見積書番号', 'app.record.edit.change.見積書番号',
    'mobile.app.record.create.change.見積書番号', 'mobile.app.record.edit.change.見積書番号'], function (event) {
    detectEnv(event);
    var quoteNo = fv(event.record, '見積書番号', '');
    if (quoteNo) setTimeout(function () { fillDealFromQuote(quoteNo); }, 0);
    return event;
  });
})();
