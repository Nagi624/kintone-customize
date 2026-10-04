/**
 * ネタリストアプリ用 住所の全角変換カスタマイズ
 * - 「市区町村」「丁目番地等」欄に半角の数字・ハイフンを入力しても、
 *   自動的に全角(数字は０-９、ハイフンは－)に変換する
 * - 英字(ビル名・建物名のローマ字表記等)は変換しない(既存データの表記慣習に合わせるため)
 * - このスクリプトはUI要素を追加しない純粋なデータ変更イベントのため、
 *   PC・モバイル両方のcustomize.jsonに登録するだけで両対応になる
 *   (モバイルはFILEアップロードが読み込まれないため、GitHub+jsDelivr経由で登録すること)
 */
(function () {
  "use strict";

  var TARGET_FIELDS = ["市区町村", "丁目番地等"];

  var CHANGE_EVENTS = TARGET_FIELDS.reduce(function (events, field) {
    events.push("app.record.create.change." + field);
    events.push("app.record.edit.change." + field);
    events.push("mobile.app.record.create.change." + field);
    events.push("mobile.app.record.edit.change." + field);
    return events;
  }, []);

  function toFullWidthNumbers(value) {
    return (value || "")
      .replace(/[0-9]/g, function (c) {
        return String.fromCharCode(c.charCodeAt(0) + 0xfee0);
      })
      .replace(/-/g, "－");
  }

  kintone.events.on(CHANGE_EVENTS, function (event) {
    var record = event.record;
    TARGET_FIELDS.forEach(function (field) {
      record[field].value = toFullWidthNumbers(record[field].value);
    });
    return event;
  });
})();
