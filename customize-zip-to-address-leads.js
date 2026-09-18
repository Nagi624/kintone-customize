/**
 * 見込み客リストアプリ用 郵便番号→住所自動入力カスタマイズ
 * - 「郵便番号」欄に7桁の数字を入力すると、zipcloud API(無料)で
 *   「都道府県」「市区町村」「丁目番地等」を自動セットする
 * - 郵便番号自体も「123-4567」形式に自動整形(ハイフンあり/なし両対応)
 * - 住所→郵便番号の逆引きは表記ゆれの問題で非対応方針(顧客管理と同じ)
 * - このスクリプトはUI要素を追加しない純粋なデータ変更イベントのため、
 *   PC・モバイル両方のcustomize.jsonに登録するだけで両対応になる
 *   (モバイルはFILEアップロードが読み込まれないため、GitHub+jsDelivr経由で登録すること)
 */
(function () {
  "use strict";

  var ZIP_FIELD = "郵便番号";
  var PREF_FIELD = "都道府県";
  var CITY_FIELD = "市区町村";
  var STREET_FIELD = "丁目番地等";

  var CHANGE_EVENTS = [
    "app.record.create.change." + ZIP_FIELD,
    "app.record.edit.change." + ZIP_FIELD,
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
          var current = kintone.app.record.get();
          current.record[PREF_FIELD].value = result.address1;
          current.record[CITY_FIELD].value = result.address2;
          current.record[STREET_FIELD].value = result.address3;
          kintone.app.record.set(current);
        })
        .catch(function (error) {
          console.error("郵便番号検索でエラーが発生しました:", error);
        });
    }

    return event;
  });
})();
