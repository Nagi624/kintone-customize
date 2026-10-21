/*
 * 活動履歴(app17)を確認用にする  PC/スマホ両対応(2026-10-17)
 *
 * 活動履歴は直接入力しない。記録は次の画面のボタンから自動で入る:
 *   架電 = 顧客管理の「📞 架電を記録」 / 訪問 = 顧客管理・ネタリストの「🚶 訪問を記録」、スケジュールの「✅ 訪問完了」
 * - 編集・削除はアプリのアクセス権で止める(一般は追加のみ可。追加はほかのアプリのボタンがREST APIで書き込むのに必要)
 * - そのため追加の画面はこのJSで止める: 新規作成の画面を開いたら案内を出して一覧へ戻す。保存もエラーにする(念のため)
 * - 一覧(PC)の「＋」ボタンを隠し、一覧・詳細の上に「確認用です」の案内を出す
 */
(function () {
  'use strict';

  var APP_ID = 17;
  var NOTE = '活動履歴は確認用です。架電は顧客管理の「📞 架電を記録」、訪問は顧客管理・ネタリストの「🚶 訪問を記録」かスケジュールの「✅ 訪問完了」から自動で記録されます。';
  var IS_MOBILE = false;

  // 誤りを直す管理者(アクセス権でも編集できるのはアプリ管理者だけ)
  var ADMINS = ['taimei.sol@gmail.com'];

  function isMine(event) { return Number(event.appId) === APP_ID; }
  function isAdmin() { return ADMINS.indexOf(kintone.getLoginUser().code) >= 0; }

  function injectStyle() {
    if (document.getElementById('act-ro-style')) return;
    var s = document.createElement('style');
    s.id = 'act-ro-style';
    // PCの一覧・詳細の「＋」(レコードを追加)・「複製」を隠す
    s.textContent = '.gaia-argoui-app-menu-add,.gaia-argoui-app-menu-copy{display:none !important}';
    document.head.appendChild(s);
  }

  function showNote() {
    var old = document.getElementById('act-ro-note');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var space = IS_MOBILE ? kintone.mobile.app.getHeaderSpaceElement()
      : (kintone.app.record.getHeaderMenuSpaceElement ? kintone.app.record.getHeaderMenuSpaceElement() : null) || kintone.app.getHeaderMenuSpaceElement();
    if (!space) return;
    var d = document.createElement('div');
    d.id = 'act-ro-note';
    d.textContent = '🔒 ' + NOTE;
    d.style.cssText = 'margin:6px ' + (IS_MOBILE ? '12px' : '0') + ';padding:8px 12px;border:1px solid #cbd5e1;background:#f8fafc;color:#334155;border-radius:6px;font-size:13px;line-height:1.5';
    space.appendChild(d);
  }

  kintone.events.on(['app.record.index.show', 'mobile.app.record.index.show'], function (event) {
    if (!isMine(event)) return event;
    IS_MOBILE = event.type.indexOf('mobile.') === 0;
    injectStyle();
    var old = document.getElementById('act-ro-note');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var space = IS_MOBILE ? kintone.mobile.app.getHeaderSpaceElement() : kintone.app.getHeaderMenuSpaceElement();
    if (space) {
      var d = document.createElement('div');
      d.id = 'act-ro-note';
      d.textContent = '🔒 ' + NOTE;
      d.style.cssText = 'margin:6px ' + (IS_MOBILE ? '12px' : '0') + ';padding:8px 12px;border:1px solid #cbd5e1;background:#f8fafc;color:#334155;border-radius:6px;font-size:13px;line-height:1.5';
      space.appendChild(d);
    }
    return event;
  });

  kintone.events.on(['app.record.detail.show', 'mobile.app.record.detail.show'], function (event) {
    if (!isMine(event)) return event;
    IS_MOBILE = event.type.indexOf('mobile.') === 0;
    injectStyle();
    showNote();
    return event;
  });

  // 新規作成の画面: 案内を出して一覧へ戻す(作成・編集とも、入力欄は触れないようにしておく)
  kintone.events.on(['app.record.create.show', 'mobile.app.record.create.show',
    'app.record.edit.show', 'mobile.app.record.edit.show'], function (event) {
    if (!isMine(event)) return event;
    IS_MOBILE = event.type.indexOf('mobile.') === 0;
    if (event.type.indexOf('edit') >= 0 && isAdmin()) return event; // 管理者は誤りを直せる
    Object.keys(event.record).forEach(function (code) { if (event.record[code]) event.record[code].disabled = true; });
    var editing = event.type.indexOf('edit') >= 0;
    setTimeout(function () {
      alert(NOTE + (editing ? '\n(記録を直す必要があるときは、管理者に依頼してください)' : ''));
      var id = event.recordId;
      location.href = editing && id
        ? (IS_MOBILE ? '/k/m/' + APP_ID + '/show?record=' + id : '/k/' + APP_ID + '/show#record=' + id)
        : (IS_MOBILE ? '/k/m/' + APP_ID + '/' : '/k/' + APP_ID + '/');
    }, 0);
    return event;
  });

  kintone.events.on(['app.record.create.submit', 'mobile.app.record.create.submit',
    'app.record.edit.submit', 'mobile.app.record.edit.submit', 'app.record.index.edit.submit'], function (event) {
    if (!isMine(event)) return event;
    if (event.type.indexOf('edit') >= 0 && isAdmin()) return event;
    event.error = NOTE;
    return event;
  });
})();
