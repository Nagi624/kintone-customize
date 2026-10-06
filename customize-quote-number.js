/**
 * 見積書管理アプリ用 見積書番号の自動採番カスタマイズ
 * - 新規作成画面を開いた時点で、見積書番号が空なら自動的に
 *   「Q-YYYYMM-NNN」(当月の連番、3桁ゼロ埋め)を採番してセットする
 * - 既存の値がある場合(コピー作成時など)は上書きしない
 * - 保存直前にも再度空チェックを行い、万一未採番のまま保存されそうな場合は採番し直す
 *   (画面を開いたまま長時間放置した場合の月またぎ対策・保険)
 * - 案件管理の「見積書を作成」ボタンから開いたときは、案件No.を入れて自動で取得する
 */
(function () {
  "use strict";

  var FIELD_CODE = "見積書番号";

  // PCではkintone.app、スマホではkintone.mobile.appからアプリIDを取る
  function event_app_id() {
    try { var id = kintone.app.getId(); if (id) return id; } catch (e) { /* スマホ */ }
    return kintone.mobile.app.getId();
  }

  function pad(num, len) {
    var s = String(num);
    while (s.length < len) s = "0" + s;
    return s;
  }

  function monthPrefix(date) {
    var y = date.getFullYear();
    var m = pad(date.getMonth() + 1, 2);
    return "Q-" + y + m + "-";
  }

  // 当月分の既存見積書番号の中から最大の連番を探し、次の番号を返す
  function generateNextNumber() {
    var prefix = monthPrefix(new Date());
    return kintone
      .api(kintone.api.url("/k/v1/records", true), "GET", {
        app: event_app_id(),
        query:
          FIELD_CODE + ' like "' + prefix + '" order by ' + FIELD_CODE + " desc limit 1",
        fields: [FIELD_CODE],
      })
      .then(function (resp) {
        var maxSeq = 0;
        if (resp.records.length > 0) {
          var lastValue = resp.records[0][FIELD_CODE].value || "";
          var match = lastValue.match(/(\d{3})$/);
          if (match) maxSeq = parseInt(match[1], 10);
        }
        return prefix + pad(maxSeq + 1, 3);
      });
  }

  kintone.events.on(["app.record.create.show", "mobile.app.record.create.show"], function (event) {
    if (event.record[FIELD_CODE].value) {
      return event; // 既に値がある場合は上書きしない
    }
    return generateNextNumber().then(function (newNumber) {
      event.record[FIELD_CODE].value = newNumber;
      return event;
    });
  });

  // 案件管理の「見積書を作成」ボタンから開いたとき、案件No.を入れて取得する(customize-schedule-links.js が渡す)
  kintone.events.on(["app.record.create.show", "mobile.app.record.create.show"], function (event) {
    var raw = null;
    try { raw = sessionStorage.getItem("quote-prefill-16"); sessionStorage.removeItem("quote-prefill-16"); } catch (e) { raw = null; }
    if (!raw) return event;
    var dealNo = JSON.parse(raw).dealNo;
    if (!dealNo) return event;
    var isMobile = event.type.indexOf("mobile.") === 0;
    // ルックアップの取得は表示が終わってから行う
    setTimeout(function () {
      var api = isMobile ? kintone.mobile.app.record : kintone.app.record;
      var cur = api.get();
      cur.record["案件No"].value = String(dealNo);
      cur.record["案件No"].lookup = true;
      api.set(cur);
    }, 0);
    return event;
  });

  kintone.events.on(["app.record.create.submit", "mobile.app.record.create.submit"], function (event) {
    if (event.record[FIELD_CODE].value) {
      return event; // 表示時に採番済みならそのまま
    }
    // 表示時点で何らかの理由により未採番だった場合の保険
    return generateNextNumber().then(function (newNumber) {
      event.record[FIELD_CODE].value = newNumber;
      return event;
    });
  });
})();
