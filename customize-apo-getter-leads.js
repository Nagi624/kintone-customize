/*
 * ネタリスト(app29)カスタマイズ: アポ獲得者の自動入力
 * - 架電履歴の行で「結果」を「獲得」にしたとき、「アポ獲得者」が空なら、その行の「担当」を入れる
 *   (担当が空ならログインユーザー)
 * - すでにアポ獲得者が入っているときは上書きしない(手で選び直した内容を尊重する)
 * - 保存時にも同じ判定をする(行をコピーして貼った場合など、changeイベントが来ないときの保険)
 */
(function () {
  'use strict';

  var TABLE = '架電履歴';
  var FIELD = 'アポ獲得者';

  function fv(obj, code, fallback) {
    return obj && obj[code] && obj[code].value !== undefined && obj[code].value !== null ? obj[code].value : fallback;
  }

  function getterFromRow(row) {
    var users = fv(row.value, '履歴担当', []);
    if (users.length) return [{ code: users[0].code }];
    return [{ code: kintone.getLoginUser().code }];
  }

  function fillIfEmpty(record, row) {
    if (!record[FIELD] || fv(record, FIELD, []).length) return;
    record[FIELD].value = getterFromRow(row);
  }

  kintone.events.on(['app.record.create.change.履歴結果', 'app.record.edit.change.履歴結果',
    'mobile.app.record.create.change.履歴結果', 'mobile.app.record.edit.change.履歴結果'], function (event) {
    var row = event.changes.row;
    if (row && fv(row.value, '履歴結果', '') === '獲得') fillIfEmpty(event.record, row);
    return event;
  });

  kintone.events.on(['app.record.create.submit', 'app.record.edit.submit',
    'mobile.app.record.create.submit', 'mobile.app.record.edit.submit'], function (event) {
    var won = fv(event.record, TABLE, []).filter(function (r) { return fv(r.value, '履歴結果', '') === '獲得'; });
    if (won.length) fillIfEmpty(event.record, won[won.length - 1]);
    return event;
  });
})();
