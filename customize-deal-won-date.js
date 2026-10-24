/*
 * 案件管理(app19) 受注日の自動入力  PC/スマホ両対応(2026-10-24)
 *
 * 商談フェーズを「受注」にしたら、受注日が空のときだけ今日(日本時間。朝6時前は前日)を入れる。
 * 入った日付は手で直せる。同じ画面で受注から別のフェーズに戻したら、自動で入れた受注日は消す。
 * 保存時にも、受注で受注日が空なら入れる(一覧の直接編集・入れ忘れ対策)。
 *
 * 受注日は、営業日報32の自動取り込み(その日の受注)に使う。以前は更新日時で判定しており、
 * 受注した案件を後日直すと受注した日の日報から拾えなくなっていた。
 * 顧客管理の作業パネルから受注にしたときは customize-customer-hub.js の setWonDate が入れる。
 */
(function () {
  'use strict';

  // この時刻より前は前日の続きとして扱う(日報・各記録ボタンと同じ)
  var DAY_START_HOUR = 6;
  var JST_OFFSET = 9 * 60 * 60 * 1000;

  function fv(obj, code, fallback) {
    return obj && obj[code] && obj[code].value !== undefined && obj[code].value !== null ? obj[code].value : fallback;
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  // 日本時間の日付(端末のタイムゾーンに関係なく)
  function jstDate(ms) {
    var d = new Date(ms + JST_OFFSET);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }
  function workDay() {
    var now = Date.now();
    var hour = new Date(now + JST_OFFSET).getUTCHours();
    return jstDate(hour < DAY_START_HOUR ? now - 24 * 60 * 60 * 1000 : now);
  }

  // この画面で自動で入れた受注日(受注から戻したときに消すため)
  var autoSet = null;

  kintone.events.on(['app.record.create.show', 'app.record.edit.show',
    'mobile.app.record.create.show', 'mobile.app.record.edit.show', 'app.record.index.edit.show'], function (event) {
    autoSet = null;
    return event;
  });

  kintone.events.on(['app.record.create.change.商談フェーズ', 'app.record.edit.change.商談フェーズ',
    'mobile.app.record.create.change.商談フェーズ', 'mobile.app.record.edit.change.商談フェーズ',
    'app.record.index.edit.change.商談フェーズ'], function (event) {
    var r = event.record;
    if (!r['受注日']) return event;
    if (fv(r, '商談フェーズ', '') === '受注') {
      if (!fv(r, '受注日', '')) { autoSet = workDay(); r['受注日'].value = autoSet; }
    } else if (autoSet && fv(r, '受注日', '') === autoSet) {
      r['受注日'].value = null;
      autoSet = null;
    }
    return event;
  });

  kintone.events.on(['app.record.create.submit', 'app.record.edit.submit',
    'mobile.app.record.create.submit', 'mobile.app.record.edit.submit',
    'app.record.index.edit.submit'], function (event) {
    var r = event.record;
    if (r['受注日'] && fv(r, '商談フェーズ', '') === '受注' && !fv(r, '受注日', '')) r['受注日'].value = workDay();
    return event;
  });
})();
