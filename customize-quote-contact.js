/*
 * 見積書管理(app16)カスタマイズ: 先方担当者の取得+手入力
 * - 「先方担当者を選ぶ」(担当者No、担当者管理app20へのルックアップ)で担当者を取得すると、
 *   その担当者の部署・お名前を「部署名」「先方担当者」にセットする
 * - 部署名・先方担当者は通常の文字列フィールドなので、取得後の修正や、リストに無い人の手入力もできる
 *   (ルックアップのコピー先は手入力不可になるため、コピーはルックアップではなくJSで行う)
 * - 見積書の会社名と担当者の顧客名が違う場合は、反映前に確認する
 */
(function () {
  'use strict';

  var CONTACT_APP_ID = 20;
  var DEPT = '文字列__1行__0';
  var PERSON = '文字列__1行__1';

  // PC/スマホでレコード操作APIが違うため、イベントの種類から判定して切り替える
  var IS_MOBILE = false;
  function recApi() { return IS_MOBILE ? kintone.mobile.app.record : kintone.app.record; }
  function detectEnv(event) { IS_MOBILE = event.type.indexOf('mobile.') === 0; }

  function fv(obj, code, fallback) {
    return obj && obj[code] && obj[code].value !== undefined && obj[code].value !== null ? obj[code].value : fallback;
  }

  function fillContact(contactNo) {
    kintone.api(kintone.api.url('/k/v1/record', true), 'GET', {
      app: CONTACT_APP_ID,
      id: contactNo
    }).then(function (resp) {
      var c = resp.record;
      var current = recApi().get();
      var company = fv(current.record, '会社名', '');
      var contactCompany = fv(c, '顧客名', '');
      if (company && contactCompany && company !== contactCompany &&
          !window.confirm('選んだ担当者は「' + contactCompany + '」の方です。\n見積書の会社名「' + company + '」と違いますが、反映しますか？')) {
        return;
      }
      current.record[DEPT].value = fv(c, '部署', '');
      current.record[PERSON].value = fv(c, 'お名前', '');
      recApi().set(current);
    }).catch(function (e) {
      console.error('担当者管理からの取得に失敗しました', e);
    });
  }

  kintone.events.on(['app.record.create.change.担当者No', 'app.record.edit.change.担当者No',
    'mobile.app.record.create.change.担当者No', 'mobile.app.record.edit.change.担当者No'], function (event) {
    detectEnv(event);
    var contactNo = fv(event.record, '担当者No', '');
    if (contactNo) setTimeout(function () { fillContact(contactNo); }, 0);
    return event;
  });
})();
