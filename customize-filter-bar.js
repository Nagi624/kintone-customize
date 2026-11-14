/*
 * 一覧の「絞り込みバー」 活動履歴17・顧客管理18・ネタリスト29  PC/スマホ両対応(kintone アプリ・Safari)(2026-11-14 設計)
 *
 * 一覧の上にボタン・選択欄を出し、押すと条件を作って、条件の無い一覧を土台に URL(?view=&query=)で開き直す。
 * - URL の条件は一覧自体の条件に「かつ」で足されるので、土台は条件の無い一覧にする(試験で判明、設計書 8-2 #11)
 * - 日付は日本時間で計算して "YYYY-MM-DD" で書く(端末の時刻に依存しない。週は月曜始まり)
 * - 17 の「結果」ボタンには、結果以外の条件で絞ったときの件数を出す
 * - バーで作った条件は端末に一時保存(sessionStorage)して、開き直したときにボタンを復元する
 * 設計: 絞り込みバー設計_2026-11-14\設計書.md
 */
(function () {
  'use strict';

  var PREVIEW_USERS = ['taimei.sol@gmail.com', 'kanoyama1123@gmail.com', 'mii-.-.-mii3160@ezweb.ne.jp'];  // 試験公開: 長家・山岸・渡邉(美穂)。全員に出すときは null
  var MAX_COUNT = 2000;
  var DAY = 86400000;

  var FB = (function () {
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    function ymd(d) { return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
    function today(nowMs) { return ymd(new Date(nowMs + 9 * 3600000)); }
    function parse(s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN; }
    function addDays(s, n) { return ymd(new Date(parse(s) + n * DAY)); }
    function monthEnd(y, m) { return ymd(new Date(Date.UTC(y, m, 0))); }

    function period(type, t, from, to) {
      var y = +t.slice(0, 4), m = +t.slice(5, 7);
      var mon = addDays(t, -((new Date(parse(t)).getUTCDay() + 6) % 7));
      if (type === 'today') return { from: t, to: t };
      if (type === 'yesterday') { var yd = addDays(t, -1); return { from: yd, to: yd }; }
      if (type === 'this_week') return { from: mon, to: addDays(mon, 6) };
      if (type === 'this_month') return { from: t.slice(0, 8) + '01', to: monthEnd(y, m) };
      if (type === 'last_month') {
        var ly = m === 1 ? y - 1 : y, lm = m === 1 ? 12 : m - 1;
        return { from: ly + '-' + pad(lm) + '-01', to: monthEnd(ly, lm) };
      }
      if (type === 'range') {
        if (isNaN(parse(from)) && isNaN(parse(to))) return null;
        return { from: isNaN(parse(from)) ? '' : from, to: isNaN(parse(to)) ? '' : to };
      }
      return null;
    }

    function escape(s) { return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/"/g, '\\"'); }
    function qs(s) { return '"' + escape(s) + '"'; }

    var PERIODS = [['today', '今日'], ['yesterday', '昨日'], ['this_week', '今週'], ['this_month', '今月'], ['last_month', '先月']];
    var WARDS = ['中央区', '北区', '東区', '白石区', '豊平区', '南区', '西区', '厚別区', '手稲区', '清田区'];
    var MAJORS = ['グルメ', '美容・ファッション', '医療・健康・介護', '暮らし', '住まい', 'ショッピング', '教育・習い事',
      'レジャー・スポーツ', '旅行・宿泊', '自動車・バイク', 'ペット', '趣味', '冠婚葬祭・イベント', '公共機関・団体', '交通', 'その他'];
    var STATION_ROWS = [
      { id: 'along', label: '沿線', kind: 'chips', field: '沿線', options: ['沿線', '沿線外', '未判定'] },
      { id: 'kinds', label: '15分以内', kind: 'chips', field: '徒歩圏の区分', options: [['地下鉄', '地下鉄'], ['JR', 'JR']] },
      { id: 'walk', label: '駅から', kind: 'max', field: '駅まで徒歩分', options: [[5, '5分以内'], [10, '10分以内'], [15, '15分以内']] },
      { id: 'station', label: '駅', kind: 'chips', field: '最寄り駅', options: [], fromStations: true }
    ];

    // アプリごとの行(上から順にバーに並ぶ)
    var CONFIG = {
      17: { base: '活動一覧（全期間）', rows: [
        { id: 'period', label: '期間', kind: 'period', field: '対応日付', options: PERIODS },
        { id: 'who', label: '担当', kind: 'user', field: '対応者' },
        { id: 'type', label: '種別', kind: 'chips', field: '対応種別', options: ['架電', '商談（初回）', '商談（2回目以降）', 'メール', 'その他'] },
        { id: 'result', label: '結果', kind: 'chips', field: 'コール業務', options: ['コールのみ', '担当不在', '受付ブロック', 'ネタ', 'アポ獲得', '失注'], count: true },
        { id: 'q', label: '検索', kind: 'search', name: '会社名' }
      ] },
      18: { base: null, rows: [
        { id: 'ward', label: '区', kind: 'chips', field: '区', options: WARDS },
        { id: 'major', label: '分類', kind: 'chips', field: '大分類', options: MAJORS, collapsed: true },
        { id: 'rank', label: 'ランク', kind: 'chips', field: '顧客ランク', options: ['S', 'A', 'B', 'C', 'D'] },
        { id: 'due', label: 'かけ直し', kind: 'due', field: '次回連絡日', options: [[true, '今日までにかけ直す']] }
      ].concat(STATION_ROWS).concat([{ id: 'q', label: '検索', kind: 'search', name: '会社名', phone: '電話番号' }]) },
      29: { base: null, rows: [
        { id: 'ward', label: '区', kind: 'chips', field: '市区町村', options: WARDS.map(function (w) { return ['札幌市' + w, w]; }) },
        { id: 'major', label: '分類', kind: 'chips', field: '大分類', options: MAJORS, collapsed: true },
        { id: 'progress', label: '進捗', kind: 'chips', field: '進捗状況', options: ['未着手', '架電済み', '失注'] },
        { id: 'prio', label: '優先度', kind: 'chips', field: 'AI_営業優先度', options: ['A', 'B', 'C', 'D'] },
        { id: 'due', label: '架電予定', kind: 'due', field: '次回架電予定日', options: [[true, '今日までに架電']] }
      ].concat(STATION_ROWS).concat([{ id: 'q', label: '検索', kind: 'search', name: '会社名', phone: '電話番号' }]) }
    };

    function optValue(o) { return Array.isArray(o) ? o[0] : o; }
    function optLabel(o) { return Array.isArray(o) ? o[1] : o; }

    function rowCond(row, v, t) {
      if (v == null || v === '' || v === false || (Array.isArray(v) && !v.length)) return '';
      if (row.kind === 'chips') return row.field + ' in (' + v.map(qs).join(', ') + ')';
      if (row.kind === 'user') return row.field + ' in (' + v.map(function (x) { return x === '__me__' ? 'LOGINUSER()' : qs(x); }).join(', ') + ')';
      if (row.kind === 'max') { var n = Math.floor(+v); return n > 0 ? row.field + ' <= ' + n : ''; }
      if (row.kind === 'due') return row.field + ' <= ' + qs(t) + ' and ' + row.field + ' != ""';
      if (row.kind === 'search') {
        // スマホ版は条件のかっこを落とす(試験で判明)ので or を使わない: 数字とハイフンだけなら電話番号、それ以外は会社名
        var s = String(v).trim();
        if (!s) return '';
        var half = s.replace(/[０-９－]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0); });
        if (row.phone && /^[0-9-]{3,}$/.test(half)) return row.phone + ' like ' + qs(half);
        return row.name + ' like ' + qs(s);
      }
      if (row.kind === 'period') {
        var p = period(v.type, t, v.from, v.to);
        if (!p) return '';
        var c = [];
        if (p.from) c.push(row.field + ' >= ' + qs(p.from));
        if (p.to) c.push(row.field + ' <= ' + qs(p.to));
        return c.join(' and ');
      }
      return '';
    }

    function buildQuery(appId, state, t, opts) {
      var cfg = CONFIG[appId], omit = opts && opts.omit;
      if (!cfg) return '';
      return cfg.rows.map(function (row) { return row.id === omit ? '' : rowCond(row, state && state[row.id], t); })
        .filter(function (s) { return s; }).join(' and ');
    }

    function norm(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
    function parseState(appId, cond, saved) {
      if (!norm(cond)) return {};
      if (saved && norm(saved.query) === norm(cond)) return saved.state;
      return null;
    }

    function countLabel(n) { return n >= MAX_COUNT ? MAX_COUNT + '+' : String(n); }

    // 条件の無い一覧のID(今の一覧に条件が無ければそのまま)。views は kintone の一覧設定({名前: {id, filterCond, type}})
    // fixedId: 本番で決めた土台の一覧(一覧の設定を読めない一般社員でも使える。レビュー指摘3)。views が読めなければ null
    function baseView(appId, views, currentId, fixedId) {
      if (!views) return String(fixedId || currentId || '');
      var list = Object.keys(views).map(function (k) { return views[k]; });
      var cur = list.filter(function (v) { return String(v.id) === String(currentId); })[0];
      if (cur && !norm(cur.filterCond) && cur.type === 'LIST') return String(cur.id);
      if (fixedId) return String(fixedId);
      var cfg = CONFIG[appId] || {};
      var named = list.filter(function (v) { return v.name === cfg.base && !norm(v.filterCond); })[0];
      if (named) return String(named.id);
      var any = list.filter(function (v) { return v.type === 'LIST' && !norm(v.filterCond); })
        .sort(function (a, b) { return (+a.index) - (+b.index); })[0];
      return any ? String(any.id) : (cur ? String(cur.id) : '');
    }

    // 日付をまたいで開き直したとき: 保存した押し方を今日で組み立て直すと、今の条件と違う(レビュー指摘4)
    function needsRefresh(appId, state, cond, t) {
      if (!state) return false;
      return norm(buildQuery(appId, state, t)) !== norm(cond);
    }

    return { needsRefresh: needsRefresh, today: today, period: period, escape: escape, buildQuery: buildQuery, parseState: parseState, countLabel: countLabel,
      baseView: baseView, CONFIG: CONFIG, optValue: optValue, optLabel: optLabel, MAX_COUNT: MAX_COUNT };
  })();

  if (typeof module !== 'undefined' && module.exports) {  // Node のテスト
    module.exports = { FB: FB };
    return;
  }

  // ================= 画面 =================
  var APP_MAP = { 17: 17, 18: 18, 29: 29 };  // 実際のアプリ番号 → 設定(FB.CONFIG の番号)。試験環境に登録するときはこの行だけ書き換える
  var ACTIVITY_APP = 17;  // 担当の候補を読む活動履歴
  var BASE_VIEW = { 17: '13311728', 18: '5520021', 29: '13312152' };  // 実際のアプリ番号 → 条件の無い一覧(活動一覧(全期間)・全顧客一覧・一覧1)。試験環境では書き換える
  var STATION_APP = 56;  // 駅マスタのアプリ番号(2026-11-14 作成。null なら駅の行は出さない)
  var MOBILE = false;
  var KEY = 'fb:';

  function api(path, params) { return kintone.api(kintone.api.url(path, true), 'GET', params); }
  function store(appId, v) {
    try {
      if (v === undefined) return JSON.parse(window.sessionStorage.getItem(KEY + appId) || 'null');
      window.sessionStorage.setItem(KEY + appId, JSON.stringify(v));
    } catch (e) { /* 使えない端末(プライベートブラウズなど)では復元しないだけ */ }
    return null;
  }
  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { if (k === 'style') e.style.cssText = attrs[k]; else e.setAttribute(k, attrs[k]); });
    if (text != null) e.textContent = text;
    return e;
  }
  function injectStyle() {
    if (document.getElementById('fb-style')) return;
    var s = el('style', { id: 'fb-style' });
    s.textContent = [
      '#fb-root{margin:6px 0;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;background:#f8fafc;color:#1f2937;font-size:14px;line-height:1.4;box-sizing:border-box;max-width:100%}',
      '#fb-root.fb-m{margin:6px 8px}',
      '#fb-root .fb-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '#fb-root .fb-sum{flex:1;min-width:0;color:#334155}',
      '#fb-root .fb-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:8px}',
      '#fb-root .fb-lab{min-width:4.5em;font-weight:bold;color:#475569}',
      '#fb-root button{min-height:44px;min-width:44px;padding:6px 12px;border:1px solid #94a3b8;border-radius:22px;background:#fff;color:#1f2937;font-size:14px;cursor:pointer;touch-action:manipulation}',
      '#fb-root button.on{background:#2563eb;border-color:#2563eb;color:#fff}',
      '#fb-root button.fb-tool{border-radius:8px;background:#e2e8f0}',
      '#fb-root select,#fb-root input{min-height:44px;font-size:16px;padding:4px 8px;border:1px solid #94a3b8;border-radius:8px;max-width:100%;box-sizing:border-box}',
      '#fb-root .fb-note{margin-top:8px;padding:6px 8px;background:#fff7ed;border:1px solid #fdba74;border-radius:6px;font-size:13px}',
      '#fb-root .fb-n{display:inline-block;margin-left:4px;padding:0 6px;border-radius:10px;background:#e2e8f0;color:#1f2937;font-size:12px}',
      '#fb-root button.on .fb-n{background:#1e40af;color:#fff}'
    ].join('');
    document.head.appendChild(s);
  }

  function listUrl(appId, viewId, query) {
    var base = (MOBILE ? '/k/m/' : '/k/') + appId + '/';
    var p = [];
    if (viewId) p.push('view=' + encodeURIComponent(viewId));
    if (query) p.push('query=' + encodeURIComponent(query));
    return base + (p.length ? '?' + p.join('&') : '');
  }

  function summary(cfg, state) {
    var parts = [];
    cfg.rows.forEach(function (row) {
      var v = state[row.id];
      if (v == null || v === '' || v === false || (Array.isArray(v) && !v.length)) return;
      if (row.kind === 'period') {
        var o = (row.options || []).filter(function (x) { return x[0] === v.type; })[0];
        parts.push(o ? o[1] : (v.from || '') + '〜' + (v.to || ''));
      } else if (row.kind === 'user') parts.push(v.map(function (x) { return x === '__me__' ? '自分' : (row.names && row.names[x]) || x; }).join('・'));
      else if (row.kind === 'max') parts.push('駅から' + v + '分以内');
      else if (row.kind === 'due') parts.push(row.options[0][1]);
      else if (row.kind === 'search') parts.push('「' + v + '」');
      else parts.push(v.map(function (x) {
        var o = (row.options || []).filter(function (op) { return String(FB.optValue(op)) === String(x); })[0];
        return o ? FB.optLabel(o) : x;
      }).join('・'));
    });
    return parts.length ? parts.join(' / ') : 'すべて';
  }

  function loadUsers(row) {
    // 担当の候補: 直近60日の活動履歴に出てくる人(本人の権限で読める範囲)
    var from = new Date(Date.now() + 9 * 3600000 - 60 * DAY).toISOString().slice(0, 10);
    return api('/k/v1/records', { app: ACTIVITY_APP, fields: ['対応者'], query: '対応日付 >= "' + from + '" order by 対応日付 desc limit 500' })
      .then(function (r) {
        var seen = {}, list = [];
        r.records.forEach(function (x) {
          (x.対応者.value || []).forEach(function (u) { if (!seen[u.code]) { seen[u.code] = 1; list.push(u); } });
        });
        row.names = {};
        list.forEach(function (u) { row.names[u.code] = u.name; });
        row.users = list;
      }).catch(function () { row.users = []; });
  }

  function loadStations(row) {
    if (!STATION_APP) { row.hidden = true; return kintone.Promise.resolve(); }
    return api('/k/v1/records', { app: STATION_APP, fields: ['駅名', '鉄道区分'], query: '使う in ("使う") order by 駅名 asc limit 500' })
      .then(function (r) {
        var seen = {};
        row.options = [];
        r.records.forEach(function (x) { var n = x.駅名.value; if (!seen[n]) { seen[n] = 1; row.options.push(n); } });
      }).catch(function () { row.hidden = true; });
  }

  function countResults(appId, cfgKey, row, state) {
    var q = FB.buildQuery(cfgKey, state, FB.today(Date.now()), { omit: row.id });
    var counts = {}, got = 0;
    function page(offset) {
      return api('/k/v1/records', { app: appId, fields: [row.field], query: (q ? q + ' ' : '') + 'limit 500 offset ' + offset })
        .then(function (r) {
          r.records.forEach(function (x) { var v = x[row.field].value || ''; counts[v] = (counts[v] || 0) + 1; });
          got += r.records.length;
          if (r.records.length === 500 && got < FB.MAX_COUNT) return page(offset + 500);
          return got >= FB.MAX_COUNT ? null : counts;
        });
    }
    return page(0).catch(function () { return undefined; });  // 読めなければ件数を出さない(0 と誤って見せない)
  }

  function render(ctx) {
    var cfg = ctx.cfg, state = ctx.state;
    var old = document.getElementById('fb-root');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var root = el('div', { id: 'fb-root', 'class': MOBILE ? 'fb-m' : '' });
    var open = !MOBILE || ctx.open;
    var head = el('div', { 'class': 'fb-head' });
    var sum = el('div', { 'class': 'fb-sum' }, '絞り込み: ' + summary(cfg, state));
    head.appendChild(sum);
    if (MOBILE) {
      var tg = el('button', { type: 'button', 'class': 'fb-tool' }, open ? '▲ 閉じる' : '▼ 絞り込み');
      tg.onclick = function () { ctx.open = !open; var sv = store(ctx.appId) || {}; sv.open = ctx.open; store(ctx.appId, sv); render(ctx); };
      head.appendChild(tg);
    }
    var clr = el('button', { type: 'button', 'class': 'fb-tool' }, '条件をクリア');
    clr.onclick = function () { go(ctx, {}); };
    head.appendChild(clr);
    root.appendChild(head);
    if (ctx.note) root.appendChild(el('div', { 'class': 'fb-note' }, ctx.note));
    if (open) {
      cfg.rows.forEach(function (row) {
        if (row.hidden) return;
        var line = el('div', { 'class': 'fb-row' });
        line.appendChild(el('span', { 'class': 'fb-lab' }, row.label));
        var v = state[row.id];
        if (row.kind === 'search') {
          var inp = el('input', { type: 'search', placeholder: row.phone ? '会社名か電話番号で探す' : '会社名で探す', value: v || '' });
          var b = el('button', { type: 'button' }, '探す');
          var run = function () { var s = Object.assign({}, state); s[row.id] = inp.value.trim(); go(ctx, s); };
          b.onclick = run;
          inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') run(); });
          line.appendChild(inp); line.appendChild(b);
        } else if (row.kind === 'period') {
          row.options.forEach(function (o) {
            var on = v && v.type === o[0];
            var bt = el('button', { type: 'button', 'class': on ? 'on' : '' }, o[1]);
            bt.onclick = function () { var s = Object.assign({}, state); s[row.id] = on ? null : { type: o[0] }; go(ctx, s); };
            line.appendChild(bt);
          });
          var f = el('input', { type: 'date', value: (v && v.type === 'range' && v.from) || '' });
          var t2 = el('input', { type: 'date', value: (v && v.type === 'range' && v.to) || '' });
          var rb = el('button', { type: 'button' }, '日付で');
          rb.onclick = function () {
            if (!f.value && !t2.value) return;  // 日付が空なら何もしない
            var s = Object.assign({}, state); s[row.id] = { type: 'range', from: f.value, to: t2.value }; go(ctx, s);
          };
          line.appendChild(f); line.appendChild(el('span', {}, '〜')); line.appendChild(t2); line.appendChild(rb);
        } else if (row.kind === 'max' || row.kind === 'due') {
          row.options.forEach(function (o) {
            var on = v === o[0];
            var bt = el('button', { type: 'button', 'class': on ? 'on' : '' }, o[1]);
            bt.onclick = function () { var s = Object.assign({}, state); s[row.id] = on ? null : o[0]; go(ctx, s); };
            line.appendChild(bt);
          });
        } else {
          var opts = row.kind === 'user'
            ? [['__me__', '自分']].concat((row.users || []).filter(function (u) { return u.code !== ctx.me; }).map(function (u) { return [u.code, u.name]; }))
            : row.options;
          var sel = v || [];
          if (opts.length > 12 || (row.collapsed && MOBILE)) {
            // 候補が多い行は選択欄(スマホの分類も)
            var se = el('select', {});
            se.appendChild(el('option', { value: '' }, '(すべて)'));
            opts.forEach(function (o) {
              var op = el('option', { value: String(FB.optValue(o)) }, FB.optLabel(o));
              if (sel.indexOf(FB.optValue(o)) >= 0) op.selected = true;
              se.appendChild(op);
            });
            se.onchange = function () { var s = Object.assign({}, state); s[row.id] = se.value ? [se.value] : []; go(ctx, s); };
            line.appendChild(se);
          } else {
            opts.forEach(function (o) {
              var val = FB.optValue(o), on = sel.indexOf(val) >= 0;
              var bt = el('button', { type: 'button', 'class': on ? 'on' : '' }, FB.optLabel(o));
              if (row.count && ctx.counts) bt.appendChild(el('span', { 'class': 'fb-n' }, FB.countLabel(ctx.counts[val] || 0)));
              bt.onclick = function () {
                var s = Object.assign({}, state);
                s[row.id] = on ? sel.filter(function (x) { return x !== val; }) : sel.concat([val]);
                go(ctx, s);
              };
              line.appendChild(bt);
            });
            if (row.kind === 'user') {
              var all = el('button', { type: 'button', 'class': sel.length ? '' : 'on' }, '全員');
              all.onclick = function () { var s = Object.assign({}, state); s[row.id] = []; go(ctx, s); };
              line.insertBefore(all, line.children[1]);
            }
            if (row.count && ctx.counts === null) line.appendChild(el('span', { 'class': 'fb-n' }, '件数は' + FB.MAX_COUNT + '件以上のため省略'));
          }
        }
        root.appendChild(line);
      });
    }
    ctx.space.appendChild(root);
  }

  function go(ctx, state) {
    var q = FB.buildQuery(ctx.cfgKey, state, FB.today(Date.now()));
    store(ctx.appId, { query: q, state: state, open: ctx.open });  // スマホでバーを開いたまま選び続けられるように
    location.href = listUrl(ctx.appId, ctx.baseView, q);
  }

  kintone.events.on(['app.record.index.show', 'mobile.app.record.index.show'], function (event) {
    MOBILE = event.type.indexOf('mobile.') === 0;
    var A = MOBILE ? kintone.mobile.app : kintone.app;
    var appId = Number(A.getId());
    var cfgKey = APP_MAP[appId];
    var cfg0 = cfgKey && FB.CONFIG[cfgKey];
    var me = kintone.getLoginUser();
    if (!cfg0 || (PREVIEW_USERS && PREVIEW_USERS.indexOf(me.code) < 0)) return event;
    var space = MOBILE ? kintone.mobile.app.getHeaderSpaceElement() : kintone.app.getHeaderSpaceElement();  // PC も一覧の上の広い場所(ボタンの帯は高さが足りず、一覧が重なって押せなくなる)
    if (!space) return event;
    injectStyle();
    var cfg = JSON.parse(JSON.stringify(cfg0));
    var cond = A.getQueryCondition() || '';
    var saved = store(appId);
    var state = FB.parseState(cfgKey, cond, saved);
    var ctx = { appId: appId, cfgKey: cfgKey, cfg: cfg, me: me.code, space: space, state: state || {}, open: !!(saved && saved.open), note: '',
      baseView: String(BASE_VIEW[appId] || event.viewId || '') };
    // 日付をまたいで開き直した(「今日」が昨日の日付のまま)なら、今日で組み立て直して開き直す
    if (FB.needsRefresh(cfgKey, state, cond, FB.today(Date.now()))) { go(ctx, state); return event; }
    if (state === null) ctx.note = '漏斗マークの絞り込みが入っています。バーのボタンを押すと、その条件は外れてバーの条件に置き換わります。';
    var jobs = [api('/k/v1/app/views', { app: appId }).then(function (r) {
      ctx.baseView = FB.baseView(cfgKey, r.views, event.viewId, BASE_VIEW[appId]);
      if (String(ctx.baseView) !== String(event.viewId) && !ctx.note) {
        var cur = Object.keys(r.views).map(function (k) { return r.views[k]; }).filter(function (x) { return String(x.id) === String(event.viewId); })[0];
        if (cur && cur.filterCond) ctx.note = 'この一覧(' + cur.name + ')は条件つきです。バーのボタンを押すと、条件の無い一覧で開きます。';
      }
    }).catch(function () { ctx.baseView = FB.baseView(cfgKey, null, event.viewId, BASE_VIEW[appId]); })];
    cfg.rows.forEach(function (row) {
      if (row.kind === 'user') jobs.push(loadUsers(row));
      if (row.fromStations) jobs.push(loadStations(row));
      if (row.count) jobs.push(countResults(appId, cfgKey, row, ctx.state).then(function (c) { ctx.counts = c; }));
    });
    render(ctx);  // まず件数なしで出し、読み終わったら描き直す
    kintone.Promise.all(jobs).then(function () { render(ctx); });
    return event;
  });
})();
