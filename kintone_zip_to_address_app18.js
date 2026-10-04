/**
 * 顧客管理アプリ用 郵便番号→住所自動入力カスタマイズ
 * - 「〒」欄に7桁の数字を入力すると、zipcloud API(無料)で
 *   「都道府県」(ドロップダウン)と「住所」(市区町村+町域)を自動セットする
 * - 郵便番号自体も「123-4567」形式に自動整形(ハイフンあり/なし両対応)
 */
(function () {
  "use strict";

  var ZIP_FIELD = "郵便番号";
  var PREF_FIELD = "都道府県";
  var ADDRESS_FIELD = "住所";

  var CHANGE_EVENTS = [
    "app.record.create.change." + ZIP_FIELD,
    "app.record.edit.change." + ZIP_FIELD,
    "mobile.app.record.create.change." + ZIP_FIELD,
    "mobile.app.record.edit.change." + ZIP_FIELD,
  ];

  function formatZip(value) {
    var digits = (value || "").replace(/[^0-9]/g, "").slice(0, 7);
    if (digits.length <= 3) {
      return digits;
    }
    return digits.slice(0, 3) + "-" + digits.slice(3);
  }

  kintone.events.on(CHANGE_EVENTS, function (event) {
    var record = event.record;
    // PCとスマホでレコード操作APIが違うため、イベントの種類で切り替える
    var recApi = event.type.indexOf("mobile.") === 0 ? kintone.mobile.app.record : kintone.app.record;

    var formatted = formatZip(record[ZIP_FIELD].value);
    record[ZIP_FIELD].value = formatted;

    var digits = formatted.replace(/-/g, "");
    if (digits.length === 7) {
      fetch("https://zipcloud.ibsnet.co.jp/api/search?zipcode=" + digits)
        .then(function (response) {
          return response.json();
        })
        .then(function (data) {
          if (data.status !== 200 || !data.results || data.results.length === 0) {
            console.warn("zipcloud: 該当する住所が見つかりませんでした", data);
            return;
          }
          var result = data.results[0];
          var current = recApi.get();
          if (current.record[PREF_FIELD]) {
            current.record[PREF_FIELD].value = result.address1;
          }
          if (current.record[ADDRESS_FIELD]) {
            current.record[ADDRESS_FIELD].value = result.address2 + result.address3;
          }
          recApi.set(current);
        })
        .catch(function (error) {
          console.error("郵便番号検索でエラーが発生しました:", error);
        });
    }

    return event;
  });
})();
