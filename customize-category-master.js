/*
 * 分類マスタ30: キー(大分類/中分類)を自動で入れる  PC/スマホ両対応(2026-10-28)
 *
 * 顧客管理18・ネタリスト29のルックアップ「中分類選択」はこのキーで引く(customize-category-filter.js)。
 * 手入力だと打ち間違いで取得に失敗するため、大分類・中分類から作って入れ、キーの欄は編集できなくする。
 */
(function () {
  'use strict';

  function fv(obj, code, fallback) {
    return obj && obj[code] && obj[code].value !== undefined && obj[code].value !== null ? obj[code].value : fallback;
  }
  function fill(event) {
    var major = String(fv(event.record, '大分類', '')).trim();
    var minor = String(fv(event.record, '中分類', '')).trim();
    event.record.キー.value = major && minor ? major + '/' + minor : '';
    event.record.キー.disabled = true;
    return event;
  }

  var types = [];
  ['app.record.', 'mobile.app.record.'].forEach(function (p) {
    types.push(p + 'create.show', p + 'edit.show', p + 'create.change.大分類', p + 'edit.change.大分類',
      p + 'create.change.中分類', p + 'edit.change.中分類', p + 'create.submit', p + 'edit.submit');
  });
  kintone.events.on(types, fill);
})();
