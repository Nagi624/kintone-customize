/*
 * 中分類の候補を大分類で絞り込む  顧客管理18・ネタリスト29  PC/スマホ両対応(2026-10-27)
 *
 * 外部プラグイン(ルックアップ動的絞り込み)の置き換え。プラグインのコードは使わず、自社で書いたもの。
 * - 大分類の隣のスペース(要素ID minor_select)に「中分類」のプルダウンを出す。候補は分類マスタ30から大分類で絞って取得
 * - プルダウンで選ぶと、ルックアップ「中分類選択」にキー(大分類/中分類)を入れて取得まで行う(表示用の「中分類」に写る)
 * - 新規・編集画面ではルックアップ「中分類選択」(取得・クリア)を隠し、プルダウンだけを見せる(2026-10-28)。
 *   欄は消さない: 貼り付け登録・ネタ→顧客・重複チェック・作業パネルのJSがこの欄に書き込み、表示用「中分類」もここから写すため
 * - 大分類を変えたとき、選ばれている中分類が別の大分類のものなら空にする
 * - 保存時、中分類が大分類と合っていなければ止める(ルックアップの「取得」から別の大分類のものを選んだとき)
 */
(function () {
  'use strict';

  var MASTER_APP = 30;
  var SPACE_ID = 'minor_select';
  var MAJOR = '大分類';
  var LOOKUP = '中分類選択';

  // PC/スマホでレコード操作APIが違うため、イベントの種類から判定して切り替える
  var IS_MOBILE = false;
  function recApi() { return IS_MOBILE ? kintone.mobile.app.record : kintone.app.record; }
  function detectEnv(event) { IS_MOBILE = event.type.indexOf('mobile.') === 0; }

  function fv(obj, code, fallback) {
    return obj && obj[code] && obj[code].value !== undefined && obj[code].value !== null ? obj[code].value : fallback;
  }
  function matches(key, major) { return !key || key.indexOf(major + '/') === 0; }

  // 分類マスタ30から大分類で絞った中分類(customize-maps-paste.js の minorOptions と同じ取り方)。見られないときは空
  var cache = {};
  function minorOptions(major) {
    if (!major) return kintone.Promise.resolve([]);
    if (cache[major]) return kintone.Promise.resolve(cache[major]);
    return kintone.api(kintone.api.url('/k/v1/records', true), 'GET', { app: MASTER_APP, fields: ['キー', '中分類'],
      query: '大分類 = "' + major.replace(/"/g, '\\"') + '" order by 中分類 asc limit 500' }).then(function (r) {
      cache[major] = r.records.map(function (x) { return { key: x.キー.value, minor: x.中分類.value }; });
      return cache[major];
    }).catch(function () { return []; });
  }

  var sel = null;
  function load(major, selected) {
    if (!sel) return;
    var target = sel;
    target.innerHTML = '';
    target.appendChild(new Option(major ? '(読み込み中)' : '(先に大分類を選ぶ)', ''));
    target.disabled = !major;
    minorOptions(major).then(function (list) {
      if (target !== sel) return; // 画面が作り直された
      target.innerHTML = '';
      target.appendChild(new Option(major ? '(未選択)' : '(先に大分類を選ぶ)', ''));
      list.forEach(function (x) { target.appendChild(new Option(x.minor, x.key)); });
      target.value = list.some(function (x) { return x.key === selected; }) ? selected : '';
    });
  }

  function render(record) {
    var space = IS_MOBILE ? kintone.mobile.app.record.getSpaceElement(SPACE_ID) : kintone.app.record.getSpaceElement(SPACE_ID);
    if (!space) return;
    space.innerHTML = '';
    var wrap = document.createElement('div');
    wrap.style.cssText = IS_MOBILE ? 'padding:8px 12px;' : 'padding:4px 8px;';
    var label = document.createElement('div');
    label.textContent = '中分類';
    label.style.cssText = 'font-size:12px;color:#333;margin-bottom:4px;';
    sel = document.createElement('select');
    sel.style.cssText = IS_MOBILE ? 'width:100%;padding:8px;font-size:16px;' : 'min-width:220px;padding:4px;font-size:14px;';
    sel.addEventListener('change', function () {
      var r = recApi().get();
      r.record[LOOKUP].value = sel.value;
      r.record[LOOKUP].lookup = sel.value ? true : 'CLEAR';
      recApi().set(r);
    });
    wrap.appendChild(label);
    wrap.appendChild(sel);
    space.appendChild(wrap);
    load(fv(record, MAJOR, ''), fv(record, LOOKUP, ''));
  }

  kintone.events.on(['app.record.create.show', 'app.record.edit.show',
    'mobile.app.record.create.show', 'mobile.app.record.edit.show'], function (event) {
    detectEnv(event);
    render(event.record);
    recApi().setFieldShown(LOOKUP, false);
    return event;
  });

  // 大分類を変えたら候補を入れ直し、合わない中分類は空にする
  kintone.events.on(['app.record.create.change.' + MAJOR, 'app.record.edit.change.' + MAJOR,
    'mobile.app.record.create.change.' + MAJOR, 'mobile.app.record.edit.change.' + MAJOR], function (event) {
    detectEnv(event);
    var major = fv(event.record, MAJOR, '');
    var key = fv(event.record, LOOKUP, '');
    if (!matches(key, major)) {
      event.record[LOOKUP].value = '';
      event.record[LOOKUP].lookup = 'CLEAR';
      key = '';
    }
    load(major, key);
    return event;
  });

  // ルックアップの「取得」で選んだときも、プルダウンの表示を合わせる
  kintone.events.on(['app.record.create.change.' + LOOKUP, 'app.record.edit.change.' + LOOKUP,
    'mobile.app.record.create.change.' + LOOKUP, 'mobile.app.record.edit.change.' + LOOKUP], function (event) {
    detectEnv(event);
    if (sel) {
      var key = fv(event.record, LOOKUP, '');
      sel.value = Array.prototype.some.call(sel.options, function (o) { return o.value === key; }) ? key : '';
    }
    return event;
  });

  kintone.events.on(['app.record.create.submit', 'app.record.edit.submit', 'app.record.index.edit.submit',
    'mobile.app.record.create.submit', 'mobile.app.record.edit.submit'], function (event) {
    var major = fv(event.record, MAJOR, '');
    if (!matches(fv(event.record, LOOKUP, ''), major)) {
      // 中分類選択は画面で隠しているため、欄ではなく画面上部にエラーを出す
      event.error = major ?'大分類「' + major + '」の中分類を選んでください' : '中分類を選ぶ前に大分類を選んでください';
    }
    return event;
  });
})();
