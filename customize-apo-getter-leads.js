/*
 * ネタリスト(app29)カスタマイズ: アポ獲得者の自動入力
 * - 架電履歴の行で「結果」を「獲得」にしたとき、「アポ獲得者」が空なら、その行の「担当」を入れる
 *   (担当が空ならログインユーザー)
 * - すでにアポ獲得者が入っているときは上書きしない(手で選び直した内容を尊重する)
 * - 保存時にも同じ判定をする(行をコピーして貼った場合など、changeイベントが来ないときの保険)
 * - 保存時、架電履歴の「担当」が空の行は保存した人を入れる(2026-10-11、営業道場の段位で「誰の架電か」を数えるため)。
 *   日付が今日より前の行は、一括取り込みした過去の記録なので触らない(別の人の架電にしてしまわないため)
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

  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }

  function fillTanto(record) {
    var me = kintone.getLoginUser().code, t = today();
    fv(record, TABLE, []).forEach(function (row) {
      var v = row.value;
      if (!v['履歴担当'] || fv(v, '履歴担当', []).length) return;
      var d = fv(v, '履歴日付', '');
      if (d && d < t) return;
      v['履歴担当'].value = [{ code: me }];
    });
  }

  kintone.events.on(['app.record.create.submit', 'app.record.edit.submit',
    'mobile.app.record.create.submit', 'mobile.app.record.edit.submit'], function (event) {
    fillTanto(event.record);
    var won = fv(event.record, TABLE, []).filter(function (r) { return fv(r.value, '履歴結果', '') === '獲得'; });
    if (won.length) fillIfEmpty(event.record, won[won.length - 1]);
    return event;
  });
})();
