/*
 * ポータルの上部に「お知らせ」(app39)の掲載中のものを出す(PC/スマホ)。
 * kintone システム管理 > JavaScript / CSSでカスタマイズ に登録する(アプリのカスタマイズではない)。
 *   PC: このファイルをアップロード / スマホ: GitHub+jsDelivrのURL(コミットSHA指定)
 * アプリ案内(お知らせ掲示板)はそのまま残し、その上にこの欄が出る。
 * 掲載ルール: 掲載日 <= 今日 かつ 今日 <= 掲載終了日(空なら掲載日+30日)。「先頭に固定」→掲載日の新しい順に最大 MAX 件。
 */
(function () {
  'use strict';

  var APP_ID = 39;
  var MAX = 5;
  var DEFAULT_DAYS = 30;
  var NEW_DAYS = 7;
  var KIND = {
    '新しい機能': { icon: '🆕', bg: '#e8f5e9', fg: '#2e7d32' },
    '変更': { icon: '🔧', bg: '#e3f2fd', fg: '#1565c0' },
    'お願い': { icon: '🙏', bg: '#fff8e1', fg: '#8a5a00' },
    '重要': { icon: '⚠️', bg: '#fdecea', fg: '#c62828' }
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fv(r, code, fb) { return r && r[code] && r[code].value !== undefined && r[code].value !== null ? r[code].value : fb; }
  function ymd(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function addDays(s, n) { var d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return ymd(d); }
  function md(s) { var p = s.split('-'); return Number(p[1]) + '/' + Number(p[2]); }
  function safeUrl(u) { return /^https?:\/\//.test(u || '') ? u : ''; }

  var CSS = [
    '.pn{font-family:"Hiragino Kaku Gothic ProN","Meiryo",sans-serif;color:#2c3e50;background:#fff;border:1px solid #dfe6ee;border-left:5px solid #2f6fb3;border-radius:10px;padding:12px 16px;margin:12px 16px;box-sizing:border-box}',
    '.pn-h{display:flex;align-items:center;gap:8px;margin-bottom:6px}.pn-h b{font-size:15px}.pn-h a{margin-left:auto;font-size:12px}',
    '.pn ul{list-style:none;margin:0;padding:0}.pn li{padding:8px 0;border-top:1px solid #eef2f7}.pn li:first-child{border-top:0}',
    '.pn-t{display:flex;flex-wrap:wrap;align-items:center;gap:6px;font-size:14px}',
    '.pn-k{font-size:11px;padding:2px 8px;border-radius:999px;font-weight:bold;white-space:nowrap}',
    '.pn-new{font-size:10px;color:#fff;background:#e74c3c;border-radius:4px;padding:1px 5px;font-weight:bold}',
    '.pn-d{font-size:12px;color:#7f8c8d}.pn-pin{font-size:12px}',
    '.pn-b{font-size:13px;color:#4a5a6a;margin:4px 0 0;white-space:pre-wrap;line-height:1.6}',
    '.pn-l{font-size:12px;margin-left:4px;white-space:nowrap}',
    '.pn-m{margin:8px}'
  ].join('\n');

  function render(space, records, mobile) {
    var old = document.getElementById('portal-news');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var today = ymd(new Date());
    var list = records.filter(function (r) {
      var from = fv(r, '掲載日', ''), to = fv(r, '掲載終了日', '') || (from ? addDays(from, DEFAULT_DAYS) : '');
      return from && from <= today && today <= to;
    });
    list.sort(function (a, b) {
      var pa = fv(a, '先頭に固定', []).length ? 1 : 0, pb = fv(b, '先頭に固定', []).length ? 1 : 0;
      if (pa !== pb) return pb - pa;
      var da = fv(a, '掲載日', ''), db = fv(b, '掲載日', '');
      if (da !== db) return da < db ? 1 : -1;
      return Number(fv(b, '$id', 0)) - Number(fv(a, '$id', 0));
    });
    if (!list.length) return;
    var appUrl = mobile ? '/k/m/' + APP_ID + '/' : '/k/' + APP_ID + '/';
    var h = '<div class="pn-h"><b>📢 お知らせ・最近の変更</b><a href="' + appUrl + '">過去のお知らせ →</a></div><ul>';
    list.slice(0, MAX).forEach(function (r) {
      var kind = fv(r, '区分', ''), k = KIND[kind] || KIND['変更'];
      var from = fv(r, '掲載日', ''), isNew = from >= addDays(today, -NEW_DAYS + 1);
      var link = safeUrl(fv(r, 'リンク', ''));
      var body = fv(r, '内容', '');
      h += '<li><div class="pn-t">'
        + (fv(r, '先頭に固定', []).length ? '<span class="pn-pin">📌</span>' : '')
        + '<span class="pn-k" style="background:' + k.bg + ';color:' + k.fg + '">' + k.icon + ' ' + esc(kind) + '</span>'
        + '<span class="pn-d">' + md(from) + '</span>'
        + (isNew ? '<span class="pn-new">NEW</span>' : '')
        + '<b>' + esc(fv(r, 'タイトル', '')) + '</b>'
        + (link ? '<a class="pn-l" href="' + esc(link) + '" target="_blank" rel="noopener">詳しく →</a>' : '')
        + '</div>' + (body ? '<div class="pn-b">' + esc(body) + '</div>' : '') + '</li>';
    });
    h += '</ul>';
    var box = document.createElement('div');
    box.id = 'portal-news';
    box.className = 'pn' + (mobile ? ' pn-m' : '');
    box.innerHTML = h;
    space.appendChild(box);
  }

  function show(mobile) {
    if (!document.getElementById('portal-news-css')) {
      var st = document.createElement('style'); st.id = 'portal-news-css'; st.textContent = CSS; document.head.appendChild(st);
    }
    var space = mobile ? kintone.mobile.portal.getContentSpaceElement() : kintone.portal.getContentSpaceElement();
    if (!space) return;
    kintone.api(kintone.api.url('/k/v1/records', true), 'GET', {
      app: APP_ID,
      query: '掲載日 <= TODAY() order by 掲載日 desc limit 100',
      fields: ['$id', '掲載日', '区分', 'タイトル', '内容', 'リンク', '掲載終了日', '先頭に固定']
    }).then(function (resp) {
      render(space, resp.records || [], mobile);
    }).catch(function (e) {
      // 見る権限が無い・通信エラーのときはポータルの表示を邪魔しない
      if (window.console) console.warn('お知らせを読み込めませんでした', e);
    });
  }

  kintone.events.on('portal.show', function (event) { show(false); return event; });
  kintone.events.on('mobile.portal.show', function (event) { show(true); return event; });
})();
