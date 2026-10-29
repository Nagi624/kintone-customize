/*
 * 営業日報(app32)詳細画面: 「🗺 架電・訪問マップ」ボタン(2026-10-29)
 * その日報の報告者・日付の活動履歴(app17)を、顧客管理(app18)の緯度経度で地図に出す。
 *   架電=赤、訪問(商談 初回/2回目以降)=青、番号は行動順。ピンを押すと会社名・住所・分類・結果メモ。
 * 座標の再取得はしない(18に緯度経度がない会社は「座標なし」として一覧の下に名前だけ出す)。
 * PC/スマホ両対応。Leafletは押したときだけ読み込む。背景は国土地理院タイル(OSM公式はkintone上で403)。
 */
(function () {
  'use strict';

  var APP_HIST = 17;
  var APP_CUST = 18;
  // 活動履歴17に「訪問」の種別はなく、訪問は商談(初回/2回目以降)として記録される
  var KINDS = { '架電': '架電', '商談（初回）': '訪問', '商談（2回目以降）': '訪問' };
  var COLORS = { '架電': '#d33', '訪問': '#1e6fd9' };
  var BTN_ID = 'daily-map-button';
  var IS_MOBILE = false;
  var leafletLoading = null;

  function fv(obj, code, fallback) {
    return obj && obj[code] && obj[code].value !== undefined && obj[code].value !== null ? obj[code].value : fallback;
  }

  function el(tag, props, text) {
    var e = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) { e[k] = props[k]; });
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function esc(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function loadLeaflet() {
    if (window.L) return kintone.Promise.resolve();
    if (leafletLoading) return leafletLoading;
    leafletLoading = new kintone.Promise(function (resolve, reject) {
      var css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css';
      document.head.appendChild(css);
      var js = document.createElement('script');
      js.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js';
      js.onload = function () { resolve(); };
      js.onerror = function () { leafletLoading = null; reject(new Error('地図部品を読み込めませんでした')); };
      document.head.appendChild(js);
    });
    return leafletLoading;
  }

  function getRecords(app, query, fields) {
    return kintone.api(kintone.api.url('/k/v1/records', true), 'GET', { app: app, query: query, fields: fields })
      .then(function (resp) { return resp.records; });
  }

  // 報告者・日付の架電/訪問を行動順に取り、顧客の座標を付ける
  function loadPoints(date, userCodes) {
    var kinds = Object.keys(KINDS).map(function (k) { return '"' + k + '"'; }).join(',');
    var users = userCodes.map(function (c) { return '"' + c.replace(/"/g, '\\"') + '"'; }).join(',');
    var q = '対応日付 = "' + date + '" and 対応者 in (' + users + ') and 対応種別 in (' + kinds + ') order by $id asc limit 500';
    return getRecords(APP_HIST, q, ['$id', '対応種別', '顧客No', '会社名', '内容']).then(function (hist) {
      var ids = [];
      hist.forEach(function (h) {
        var no = fv(h, '顧客No', '');
        if (no && ids.indexOf(no) < 0) ids.push(no);
      });
      var custReq = ids.length
        ? getRecords(APP_CUST, '$id in (' + ids.join(',') + ') limit 500', ['$id', '住所', '緯度', '経度', '大分類', '中分類', 'GoogleマップURL'])
        : kintone.Promise.resolve([]);
      return custReq.then(function (custs) {
        var byId = {};
        custs.forEach(function (c) { byId[fv(c, '$id', '')] = c; });
        return hist.map(function (h, i) {
          var c = byId[fv(h, '顧客No', '')];
          return {
            n: i + 1, kind: KINDS[fv(h, '対応種別', '')] || '架電', name: fv(h, '会社名', ''), memo: fv(h, '内容', ''),
            addr: fv(c, '住所', ''), cat: [fv(c, '大分類', ''), fv(c, '中分類', '')].filter(Boolean).join(' > '),
            url: fv(c, 'GoogleマップURL', ''), lat: parseFloat(fv(c, '緯度', '')), lng: parseFloat(fv(c, '経度', ''))
          };
        });
      });
    });
  }

  function addStyle() {
    if (document.getElementById('daily-map-style')) return;
    var s = el('style', { id: 'daily-map-style' });
    s.textContent =
      '.dmap-bg{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:10000;display:flex;align-items:center;justify-content:center}' +
      '.dmap{background:#fff;border-radius:8px;width:min(960px,94vw);height:min(720px,88vh);display:flex;flex-direction:column;padding:12px;box-sizing:border-box}' +
      '.dmap.dmap-m{width:100vw;height:100vh;border-radius:0}' +
      '.dmap h3{margin:0;font-size:16px}.dmap-head{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px}' +
      '.dmap-close{border:1px solid #ccc;background:#f7f7f7;border-radius:4px;padding:6px 14px;font-size:14px;cursor:pointer}' +
      '.dmap-map{flex:1;min-height:200px;border:1px solid #ddd}' +
      '.dmap-note{font-size:12px;color:#555;margin-top:6px}' +
      '.dmap-pin{color:#fff;border-radius:50%;width:22px;height:22px;line-height:22px;text-align:center;font-size:11px;font-weight:bold;border:2px solid #fff;box-shadow:0 0 2px rgba(0,0,0,.5)}' +
      '.dmap-legend span{display:inline-block;width:10px;height:10px;border-radius:50%;margin:0 4px 0 10px;vertical-align:middle}';
    document.head.appendChild(s);
  }

  function showMap(record) {
    var date = fv(record, '日付', '');
    var users = fv(record, '報告者', []);
    var who = users.length ? users[0].name : '';
    addStyle();
    var bg = el('div', { className: 'dmap-bg' });
    var box = el('div', { className: 'dmap' + (IS_MOBILE ? ' dmap-m' : '') });
    var head = el('div', { className: 'dmap-head' });
    var title = el('h3', {}, who + ' ' + date + ' の架電・訪問');
    var close = el('button', { className: 'dmap-close', type: 'button' }, '閉じる');
    var mapDiv = el('div', { className: 'dmap-map' });
    var note = el('div', { className: 'dmap-note' }, '読み込み中…');
    head.appendChild(title);
    head.appendChild(close);
    box.appendChild(head);
    box.appendChild(mapDiv);
    box.appendChild(note);
    bg.appendChild(box);
    document.body.appendChild(bg);
    close.addEventListener('click', function () { document.body.removeChild(bg); });
    bg.addEventListener('click', function (e) { if (e.target === bg) document.body.removeChild(bg); });

    if (!date || !users.length) {
      note.textContent = '日付と報告者が入っていないため表示できません。';
      return;
    }
    kintone.Promise.all([loadLeaflet(), loadPoints(date, users.map(function (u) { return u.code; }))]).then(function (res) {
      var pts = res[1];
      var onMap = pts.filter(function (p) { return !isNaN(p.lat) && !isNaN(p.lng); });
      var missing = pts.filter(function (p) { return isNaN(p.lat) || isNaN(p.lng); });
      var count = { '架電': 0, '訪問': 0 };
      pts.forEach(function (p) { count[p.kind]++; });
      note.innerHTML = '<span class="dmap-legend"><span style="background:' + COLORS['架電'] + '"></span>架電 ' + count['架電'] +
        '件<span style="background:' + COLORS['訪問'] + '"></span>訪問 ' + count['訪問'] + '件</span>(番号は行動順)' +
        (missing.length ? '<br>座標なしで地図に出ていない先: ' + missing.map(function (p) { return p.n + '. ' + esc(p.name); }).join('、') : '');
      if (!pts.length) {
        note.textContent = 'この日の架電・訪問の記録(活動履歴)はありません。';
        return;
      }
      var map = window.L.map(mapDiv);
      window.L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png', {
        maxZoom: 18, attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">国土地理院</a>'
      }).addTo(map);
      var group = window.L.featureGroup().addTo(map);
      onMap.forEach(function (p) {
        var icon = window.L.divIcon({ className: '', iconSize: [26, 26],
          html: '<div class="dmap-pin" style="background:' + COLORS[p.kind] + '">' + p.n + '</div>' });
        window.L.marker([p.lat, p.lng], { icon: icon }).bindPopup(
          '<b>' + p.n + '. [' + p.kind + '] ' + esc(p.name) + '</b><br>' + esc(p.addr) +
          (p.cat ? '<br><small>' + esc(p.cat) + '</small>' : '') + (p.memo ? '<br>' + esc(p.memo) : '') +
          (p.url ? '<br><a target="_blank" href="' + esc(p.url) + '">Googleマップで開く</a>' : '')
        ).addTo(group);
      });
      if (onMap.length) map.fitBounds(group.getBounds().pad(0.1));
      else map.setView([43.0621, 141.3544], 12);  // 座標が1件もないときは札幌駅周辺
    }).catch(function (err) {
      note.textContent = '地図を表示できませんでした: ' + (err && err.message ? err.message : err);
    });
  }

  kintone.events.on(['app.record.detail.show', 'mobile.app.record.detail.show'], function (event) {
    IS_MOBILE = event.type.indexOf('mobile.') === 0;
    var old = document.getElementById(BTN_ID);
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var space = IS_MOBILE ? kintone.mobile.app.getHeaderSpaceElement() : kintone.app.record.getHeaderMenuSpaceElement();
    if (!space) return event;
    var record = event.record;
    var btn = el('button', { id: BTN_ID, type: 'button' }, '🗺 架電・訪問マップ');
    btn.style.cssText = IS_MOBILE
      ? 'display:block;width:calc(100% - 24px);margin:8px 12px;padding:10px 14px;font-size:15px;'
      : 'margin-left:8px;padding:6px 14px;font-size:14px;cursor:pointer;';
    btn.addEventListener('click', function () { showMap(record); });
    space.appendChild(btn);
    return event;
  });
})();
