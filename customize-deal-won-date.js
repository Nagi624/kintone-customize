/*
 * 案件管理(app19) 受注日の自動入力  PC/スマホ両対応(2026-10-24)
 *
 * 商談フェーズを「受注」にしたら、受注日が空のときだけ今日(日本時間)を入れる(初期値)。
 * 入った日付は手で直せる。同じ画面で受注から別のフェーズに戻したら、自動で入れた受注日は消す。
 *
 * 2026-10-25(P1 日付の正常化): 朝6時前でも前日にしない(受注日は実際に受注した日。会社の日付ルール)。
 *   自動で入れたときは画面の上に「何日を受注日にしたか」を出し、違えば利用者が直す。
 *   日付は共通部品 customize-business-date.js(window.TaimeiDate)で日本時間に揃える(同じアプリに登録が必要)。
 *   受注日は実際に受注した日(受注予定日は将来を含む見込みの日付で、別の欄)。保存するとき:
 *   - 受注日が未来の日付なら保存しない
 *   - 受注にするのに受注日が空なら保存しない(以前は今日を入れて保存していた)。
 *     開いたときにすでに受注で受注日が空だった案件(古い案件)は、受注日を決めるまで止めない・入れない
 *
 * 受注日は、営業日報32の自動取り込み(その日の受注)に使う。以前は更新日時で判定しており、
 * 受注した案件を後日直すと受注した日の日報から拾えなくなっていた。
 * 顧客管理の作業パネルから受注にしたときは customize-customer-hub.js の setWonDate が入れる。
 */
(function () {
  'use strict';

  var NOTE_ID = 'deal-won-date-note';

  function fv(obj, code, fallback) {
    return obj && obj[code] && obj[code].value !== undefined && obj[code].value !== null ? obj[code].value : fallback;
  }
  function TD() {
    if (!window.TaimeiDate) throw new Error('customize-business-date.js が読み込まれていません');
    return window.TaimeiDate;
  }

  // 自動で入れた受注日を画面の上に示す(一覧の直接編集では出さない)。date が空なら消す
  function showNote(event, date) {
    var old = document.getElementById(NOTE_ID);
    if (old && old.parentNode) old.parentNode.removeChild(old);
    if (!date || event.type.indexOf('index.') >= 0) return;
    var mobile = event.type.indexOf('mobile.') === 0;
    var space = mobile ? kintone.mobile.app.getHeaderSpaceElement() : kintone.app.record.getHeaderMenuSpaceElement();
    if (!space) return;
    var n = document.createElement('div');
    n.id = NOTE_ID;
    n.style.cssText = 'margin:8px 12px;padding:8px 12px;border-left:4px solid #b45309;background:#fffbeb;color:#78350f;font-size:13px';
    n.textContent = '受注日に ' + (date === TD().today() ? '今日 ' : '') + TD().label(date) +
      ' を入れました。実際に受注した日が違う場合は、受注日を直してください。';
    space.appendChild(n);
  }

  var MSG_EMPTY = '受注日を入力してください(実際に受注した日)';
  var MSG_FUTURE = '受注日に未来の日付は入れられません(実際に受注した日を入れてください)';

  // この画面で自動で入れた受注日(受注から戻したときに消すため)
  var autoSet = null;
  // 開いたときにすでに受注だったか(受注日が空の古い案件を、保存のたびに止めないため)
  var wonAtOpen = false;

  kintone.events.on(['app.record.create.show', 'app.record.edit.show',
    'mobile.app.record.create.show', 'mobile.app.record.edit.show', 'app.record.index.edit.show'], function (event) {
    autoSet = null;
    wonAtOpen = event.type.indexOf('create.') < 0 && fv(event.record, '商談フェーズ', '') === '受注';
    showNote(event, null);
    return event;
  });

  // 受注日の欄の下に出すエラー(保存の前に気づけるように)。問題なければ消す
  function check(r, onSubmit) {
    var f = r['受注日'];
    if (!f) return null;
    var v = fv(r, '受注日', '');
    var msg = null;
    if (v && v > TD().today()) msg = MSG_FUTURE;
    else if (!v && fv(r, '商談フェーズ', '') === '受注' && !wonAtOpen && onSubmit) msg = MSG_EMPTY;
    f.error = msg;
    return msg;
  }

  kintone.events.on(['app.record.create.change.受注日', 'app.record.edit.change.受注日',
    'mobile.app.record.create.change.受注日', 'mobile.app.record.edit.change.受注日',
    'app.record.index.edit.change.受注日'], function (event) {
    check(event.record, false);
    return event;
  });

  kintone.events.on(['app.record.create.change.商談フェーズ', 'app.record.edit.change.商談フェーズ',
    'mobile.app.record.create.change.商談フェーズ', 'mobile.app.record.edit.change.商談フェーズ',
    'app.record.index.edit.change.商談フェーズ'], function (event) {
    var r = event.record;
    if (!r['受注日']) return event;
    if (fv(r, '商談フェーズ', '') === '受注') {
      if (!fv(r, '受注日', '')) {
        autoSet = TD().today();
        r['受注日'].value = autoSet;
        showNote(event, autoSet);
      }
    } else if (autoSet && fv(r, '受注日', '') === autoSet) {
      r['受注日'].value = null;
      autoSet = null;
      showNote(event, null);
    }
    check(r, false);
    return event;
  });

  kintone.events.on(['app.record.create.submit', 'app.record.edit.submit',
    'mobile.app.record.create.submit', 'mobile.app.record.edit.submit',
    'app.record.index.edit.submit'], function (event) {
    var msg = check(event.record, true);
    if (msg) event.error = msg;
    return event;
  });
})();
