/*
 * 見積書管理(app16)カスタマイズ: 単価の自由入力+税抜/税込の入力方式
 * - 提案商材テーブルで「商品」をルックアップ取得すると、商品マスタの単価が「定価（マスタ）」に、
 *   価格区分(税抜/税込)が「定価区分」にコピーされる
 *   (ルックアップのコピー先は手入力できないため、単価そのものはコピー先にしていない)
 * - このJSが定価を見積書の「金額の入力方式」に合わせて換算し、「単価（自由入力）」の初期値にする
 *   例: 税込33,000円の商品を「税抜で入力」の見積書で選ぶ → 単価30,000円
 *   マイナスの定価(値引き行)は換算せずそのまま写す(金額は手で決める前提のため)
 * - 「金額の入力方式」を切り替えると、入力済みの単価を換算するか確認する
 * - 保存時、単価が空の行は換算済みの定価を単価に入れる(写し漏れの保険)
 * - 消費税・税抜金額・合計(税込)は計算フィールド側で算出(スマホでも正しく出る)
 */
(function () {
  'use strict';

  var TABLE = 'テーブル_0';
  var TAX_RATE = 0.1;

  // PC/スマホでレコード操作APIが違うため、イベントの種類から判定して切り替える
  var IS_MOBILE = false;
  function recApi() { return IS_MOBILE ? kintone.mobile.app.record : kintone.app.record; }
  function detectEnv(event) { IS_MOBILE = event.type.indexOf('mobile.') === 0; }

  function fv(obj, code, fallback) {
    return obj && obj[code] && obj[code].value !== undefined && obj[code].value !== null ? obj[code].value : fallback;
  }

  function isTaxIncludedMode(record) {
    return fv(record, '入力方式', '') === '税込で入力';
  }

  function toIncluded(n) {
    return Math.round(n * (1 + TAX_RATE));
  }

  function toExcluded(n) {
    return Math.round(n / (1 + TAX_RATE));
  }

  // 定価(マスタの区分どおり)を見積書の入力方式に合わせた単価に換算する
  function initialUnitPrice(rowValue, taxIncludedMode) {
    var listPrice = fv(rowValue, '定価', '');
    if (listPrice === '') return '';
    var n = Number(listPrice);
    if (n < 0) return String(n);
    var listIsIncluded = fv(rowValue, '定価区分', '税抜') === '税込';
    if (taxIncludedMode && !listIsIncluded) return String(toIncluded(n));
    if (!taxIncludedMode && listIsIncluded) return String(toExcluded(n));
    return String(n);
  }

  function copyListPriceAt(index) {
    var current = recApi().get();
    var rows = fv(current.record, TABLE, []);
    var row = rows[index];
    if (!row) return;
    var price = initialUnitPrice(row.value, isTaxIncludedMode(current.record));
    if (price === '') return;
    row.value['単価'].value = price;
    recApi().set(current);
  }

  kintone.events.on(['app.record.create.change.ルックアップ_0', 'app.record.edit.change.ルックアップ_0',
    'mobile.app.record.create.change.ルックアップ_0', 'mobile.app.record.edit.change.ルックアップ_0'], function (event) {
    detectEnv(event);
    var row = event.changes.row;
    if (!row || !fv(row.value, 'ルックアップ_0', '')) return event;
    var price = initialUnitPrice(row.value, isTaxIncludedMode(event.record));
    if (price !== '') {
      row.value['単価'].value = price;
      return event;
    }
    // ルックアップのコピー結果がまだイベントに反映されていない場合は、描画後に読み直して写す
    var index = fv(event.record, TABLE, []).indexOf(row);
    if (index >= 0) setTimeout(function () { copyListPriceAt(index); }, 0);
    return event;
  });

  kintone.events.on(['app.record.create.change.入力方式', 'app.record.edit.change.入力方式',
    'mobile.app.record.create.change.入力方式', 'mobile.app.record.edit.change.入力方式'], function (event) {
    var rows = fv(event.record, TABLE, []).filter(function (row) {
      return fv(row.value, '単価', '') !== '';
    });
    if (!rows.length) return event;
    var toTaxIncluded = isTaxIncludedMode(event.record);
    var msg = toTaxIncluded
      ? '入力済みの単価を税込に換算しますか？(×1.1)\n「キャンセル」なら単価はそのままです。'
      : '入力済みの単価を税抜に換算しますか？(÷1.1)\n「キャンセル」なら単価はそのままです。';
    if (!window.confirm(msg)) return event;
    rows.forEach(function (row) {
      var n = Number(row.value['単価'].value);
      row.value['単価'].value = String(toTaxIncluded ? toIncluded(n) : toExcluded(n));
    });
    return event;
  });

  kintone.events.on(['app.record.create.submit', 'app.record.edit.submit',
    'mobile.app.record.create.submit', 'mobile.app.record.edit.submit'], function (event) {
    var taxIncludedMode = isTaxIncludedMode(event.record);
    fv(event.record, TABLE, []).forEach(function (row) {
      if (fv(row.value, '単価', '') === '') {
        var price = initialUnitPrice(row.value, taxIncludedMode);
        if (price !== '') row.value['単価'].value = price;
      }
    });
    return event;
  });
})();
