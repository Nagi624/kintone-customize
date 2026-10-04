/**
 * 顧客管理アプリ用 住所の全角変換カスタマイズ
 * - 「住所」欄に半角の数字・ハイフンを入力しても、自動的に全角(数字は０-９、ハイフンは－)に変換する
 * - 英字(ビル名・建物名のローマ字表記等)は変換しない(既存データの表記慣習に合わせるため)
 * - このスクリプトはUI要素を追加しない純粋なデータ変更イベントのため、
 *   PC・モバイル両方のcustomize.jsonに登録するだけで両対応になる
 *   (モバイルはFILEアップロードが読み込まれないため、GitHub+jsDelivr経由で登録すること)
 */
(function () {
  "use strict";

  var ADDRESS_FIELD = "住所";

  var CHANGE_EVENTS = [
    "app.record.create.change." + ADDRESS_FIELD,
    "app.record.edit.change." + ADDRESS_FIELD,
    "mobile.app.record.create.change." + ADDRESS_FIELD,
    "mobile.app.record.edit.change." + ADDRESS_FIELD,
  ];

  function toFullWidthNumbers(value) {
    return (value || "")
      .replace(/[0-9]/g, function (c) {
        return String.fromCharCode(c.charCodeAt(0) + 0xfee0);
      })
      .replace(/-/g, "－");
  }

  kintone.events.on(CHANGE_EVENTS, function (event) {
    var record = event.record;
    record[ADDRESS_FIELD].value = toFullWidthNumbers(record[ADDRESS_FIELD].value);
    return event;
  });
})();
