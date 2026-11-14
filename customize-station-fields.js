/*
 * 顧客管理18・ネタリスト29 の最寄り駅の欄(手入力の扱い)  PC/スマホ両対応(kintone アプリ・Safari)(2026-11-14 設計)
 *
 * 最寄り駅・徒歩分・沿線は、毎時のクラウド処理(週報月報自動作成\station_sync.py)が緯度経度と駅マスタから入れる。
 * この画面の処理は、営業が手で直したことを「駅の決め方」に残して、毎時処理に上書きさせないためのもの。
 * - 駅をルックアップで取り直す → 駅は手入力(徒歩分は毎時処理がその駅まで計算し直す)
 * - 徒歩分を書き換える → すべて手入力(沿線は保存のときに徒歩分から決める)
 *   変更イベント(取得・入力したとき)と、保存のとき(開いたときの値と比べる)の両方で判定する
 * - 詳細画面: 「自動に戻す」ボタン、手入力のまま住所(座標)が変わったときの案内、徒歩分は推定であることと出典
 * 設計: 絞り込みバー設計_2026-11-14\設計書.md 5章
 */
(function () {
  'use strict';

  var WALK_LIMIT_MIN = 15;  // station_sync.py と同じ値
  var F = { key: '最寄り駅キー', walk: '駅まで徒歩分', along: '沿線', mode: '駅の決め方', src: '駅の元座標', lat: '緯度', lng: '経度' };
  var AUTO = '自動', STATION = '駅は手入力', ALL = 'すべて手入力';

  var SF = (function () {
    function num(v) { var s = String(v == null ? '' : v).trim(); return s === '' || isNaN(+s) ? null : +s; }
    function nextMode(prev, now) {
      var mode = prev.mode || AUTO;
      if (prev.key && !now.key) return AUTO;  // 駅を消した → 自動に戻す(毎時処理が入れ直す)
      if (num(prev.walk) !== num(now.walk)) return ALL;
      if ((prev.key || '') !== (now.key || '') && mode !== ALL) return STATION;
      return mode;
    }
    function along(walk) {
      var n = num(walk);
      if (n === null) return '未判定';
      return n <= WALK_LIMIT_MIN ? '沿線' : '沿線外';
    }
    function fv(r, code) { return r && r[code] && r[code].value != null ? String(r[code].value) : ''; }
    function addressChanged(r) {
      var mode = fv(r, F.mode) || AUTO;
      var src = fv(r, F.src);
      if (mode === AUTO || !src) return false;
      var lat = num(fv(r, F.lat)), lng = num(fv(r, F.lng));
      var cur = lat === null || lng === null ? 'none' : lat.toFixed(5) + ',' + lng.toFixed(5);
      return src.split('|')[0] !== cur;
    }
    // ネタ → 顧客に移すとき写す欄。手入力のネタだけ(自動なら顧客側でも毎時処理が座標から入れる)
    function copyForCustomer(r) {
      var mode = fv(r, F.mode);
      if (!mode || mode === AUTO) return {};
      var out = {};
      // 元座標は写さない: 顧客側の毎時処理に沿線・徒歩圏を計算させるため(レビュー指摘2)
      [F.key, F.mode, F.walk].forEach(function (c) { if (r[c]) out[c] = { value: fv(r, c) }; });
      return out;
    }
    return { nextMode: nextMode, along: along, addressChanged: addressChanged, fv: fv, copyForCustomer: copyForCustomer };
  })();

  if (typeof module !== 'undefined' && module.exports) {  // Node のテスト
    module.exports = { SF: SF };
    return;
  }

  // ================= 画面 =================
  window.TaimeiStationFields = SF;  // ネタ → 顧客(customize-lead-to-customer.js)がボタンを押したときに使う
  var APP_MAP = { 18: 18, 29: 29 };  // 実際のアプリ番号 → 18/29。試験環境に登録するときはこの行だけ書き換える
  var MOBILE = false;
  var initial = null;  // 編集画面を開いたときの値

  function R() { return MOBILE ? kintone.mobile.app.record : kintone.app.record; }
  function appId() { return Number((MOBILE ? kintone.mobile.app : kintone.app).getId()); }
  function mine() { return !!APP_MAP[appId()]; }
  function detect(event) { MOBILE = event.type.indexOf('mobile.') === 0; }
  function snap(r) { return { key: SF.fv(r, F.key), walk: SF.fv(r, F.walk), mode: SF.fv(r, F.mode) }; }

  function applyMode(r) {
    if (!initial || !r[F.mode]) return;
    var now = { key: SF.fv(r, F.key), walk: SF.fv(r, F.walk) };
    var m = SF.nextMode(initial, now);
    r[F.mode].value = m;
    if (m === ALL && r[F.along]) r[F.along].value = SF.along(now.walk);
  }

  var EDIT = ['app.record.create.show', 'app.record.edit.show', 'mobile.app.record.create.show', 'mobile.app.record.edit.show'];
  kintone.events.on(EDIT, function (event) {
    detect(event);
    if (!mine()) return event;
    initial = snap(event.record);
    // 内部用の欄は直接さわらない
    [F.src].forEach(function (c) { if (event.record[c]) event.record[c].disabled = true; });
    return event;
  });

  var CHANGE = [];
  ['app.record.create.change.', 'app.record.edit.change.', 'mobile.app.record.create.change.', 'mobile.app.record.edit.change.'].forEach(function (p) {
    CHANGE.push(p + F.key, p + F.walk);
  });
  kintone.events.on(CHANGE, function (event) {
    detect(event);
    if (!mine()) return event;
    applyMode(event.record);
    return event;
  });

  var SUBMIT = ['app.record.create.submit', 'app.record.edit.submit', 'mobile.app.record.create.submit', 'mobile.app.record.edit.submit'];
  kintone.events.on(SUBMIT, function (event) {
    detect(event);
    if (!mine()) return event;
    applyMode(event.record);  // 変更イベントが来ない環境でも、開いたときの値と比べて決める
    return event;
  });

  function el(tag, css, text) { var e = document.createElement(tag); if (css) e.style.cssText = css; if (text != null) e.textContent = text; return e; }

  var DETAIL = ['app.record.detail.show', 'mobile.app.record.detail.show'];
  kintone.events.on(DETAIL, function (event) {
    detect(event);
    if (!mine()) return event;
    var r = event.record;
    var old = document.getElementById('sf-box');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var box = el('div', 'margin:8px ' + (MOBILE ? '12px' : '0') + ';padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;background:#f8fafc;font-size:14px;line-height:1.5;color:#1f2937');
    box.id = 'sf-box';
    var walk = SF.fv(r, F.walk);
    box.appendChild(el('div', 'font-weight:bold', '🚉 ' + (SF.fv(r, '最寄り駅') || '最寄り駅なし') +
      (walk ? '　徒歩約' + walk + '分' : '') + '　' + (SF.fv(r, F.along) || '未判定')));
    box.appendChild(el('div', 'font-size:12px;color:#475569', '徒歩分は駅の出入口までの直線距離から推定した目安です。違っていたら編集で直せます。' +
      '駅: 国土数値情報(鉄道データ)国土交通省 / 出入口: © OpenStreetMap contributors'));
    var mode = SF.fv(r, F.mode) || AUTO;
    if (mode !== AUTO) {
      if (SF.addressChanged(r)) {
        box.appendChild(el('div', 'margin-top:6px;padding:6px 8px;background:#fff7ed;border:1px solid #fdba74;border-radius:6px',
          '住所が変わりましたが、駅は手で入れたままです。駅を自動に戻しますか?'));
      }
      var b = el('button', 'margin-top:8px;min-height:44px;padding:6px 14px;border:1px solid #94a3b8;border-radius:8px;background:#fff;font-size:14px;cursor:pointer',
        '駅を自動に戻す(いまは「' + mode + '」)');
      b.type = 'button';
      b.onclick = function () {
        b.disabled = true;
        // 決め方だけを自動にする(社員は内部用の元座標を書けない。決め方が変われば毎時処理が計算し直す)
        var body = { app: appId(), id: r.$id.value, record: {} };
        body.record[F.mode] = { value: AUTO };
        kintone.api(kintone.api.url('/k/v1/record', true), 'PUT', body).then(function () {
          b.textContent = '自動に戻しました。1時間以内に駅と徒歩分が入り直します';
        }).catch(function (e) {
          b.disabled = false;
          b.textContent = '戻せませんでした: ' + ((e && e.message) || '');
        });
      };
      box.appendChild(b);
    }
    var space = MOBILE ? kintone.mobile.app.getHeaderSpaceElement() : kintone.app.record.getHeaderMenuSpaceElement();
    if (space) space.appendChild(box);
    return event;
  });
})();
