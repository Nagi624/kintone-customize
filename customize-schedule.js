/*
 * スケジュール(app34) カスタマイズ  PC/スマホ両対応
 *
 * - 「カレンダー」一覧(#sched-root): FullCalendar(MIT版)で 月・週・日・リスト表示。表示メンバーを切り替え可。
 *   空き枠をドラッグ → 新規作成画面へ(日時・参加者を自動入力)、予定のドラッグ/リサイズで日時変更。
 * - 「メンバー週表示」一覧(#sched-group-root): メンバー(app35で管理)×7日の横並び表示。スマホは日別表示。
 * - 入力画面: 開始を動かすと終了も同じ長さでずらす、終日、案件を選ぶと顧客も自動取得、終了<開始のチェック。
 * - 非公開の予定は作成者・参加者しか見られない(レコードのアクセス権)。代わりに同じ時間帯の
 *   「予定あり」レコード(元予定No=元のレコード番号)を自動で作り・更新・削除し、他の人にはそれだけが見える。
 *
 * 依存: FullCalendar 6(index.global.min.js)と日本語ロケールを、このファイルより先に読み込むこと。
 */
(function () {
  'use strict';

  var APP_ID = 34;
  var MEMBER_APP_ID = 35;
  var DEAL_APP_ID = 19;
  var PREFILL_KEY = 'sched-prefill-34';
  var HOLIDAY_URL = 'https://holidays-jp.github.io/api/v1/date.json';
  var GROUPS = ['営業部', '総務部', '経理部', '経営統括部'];
  var TYPE_COLORS = {
    '訪問': '#2563eb', '外出': '#0891b2', '会議': '#7c3aed', '社内作業': '#64748b',
    '直行': '#ea580c', '直帰': '#ea580c', '直行直帰': '#ea580c', '休暇': '#dc2626',
    'その他': '#16a34a', '予定あり': '#9ca3af'
  };
  var WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

  var IS_MOBILE = false;
  function detectEnv(event) { IS_MOBILE = event.type.indexOf('mobile.') === 0; }
  function recApi() { return IS_MOBILE ? kintone.mobile.app.record : kintone.app.record; }

  function fv(obj, code, fallback) {
    return obj && obj[code] && obj[code].value !== undefined && obj[code].value !== null ? obj[code].value : fallback;
  }

  // ---------- 日付ユーティリティ ----------
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function toKintoneDT(d) { return d.toISOString().replace(/\.\d{3}Z$/, 'Z'); }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function hm(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes()); }
  function startOfWeek(d) { var s = startOfDay(d); return addDays(s, -((s.getDay() + 6) % 7)); } // 月曜始まり

  // ---------- データ取得 ----------
  function fetchAll(app, query, fields) {
    var out = [];
    function page(offset) {
      return kintone.api(kintone.api.url('/k/v1/records', true), 'GET', {
        app: app, query: query + ' limit 500 offset ' + offset, fields: fields
      }).then(function (resp) {
        out = out.concat(resp.records);
        return resp.records.length === 500 ? page(offset + 500) : out;
      });
    }
    return page(0);
  }

  var EVENT_FIELDS = ['$id', '件名', '種類', '終日', '開始日時', '終了日時', '参加者', '場所', '会社名', '案件名', '公開区分', '元予定No',
    '出欠', '実施状況', '繰り返しID', 'ネタ会社名', '案件No', '顧客No', 'ネタNo'];

  // 範囲[start, end)に重なる予定。自分が元の非公開予定を見られる場合、その「予定あり」は除く
  function fetchEvents(start, end) {
    var q = '開始日時 < "' + toKintoneDT(end) + '" and 終了日時 > "' + toKintoneDT(start) + '" order by 開始日時 asc';
    return fetchAll(APP_ID, q, EVENT_FIELDS).then(function (recs) {
      var ids = {};
      recs.forEach(function (r) { ids[fv(r, '$id', '')] = true; });
      return recs.filter(function (r) {
        var orig = fv(r, '元予定No', '');
        return !(orig && ids[orig]);
      });
    });
  }

  var membersCache = null;
  function fetchMembers() {
    if (membersCache) return kintone.Promise.resolve(membersCache);
    return fetchAll(MEMBER_APP_ID, '表示 in ("表示する") order by 表示順 asc', ['メンバー', '表示グループ'])
      .then(function (recs) {
        membersCache = [];
        recs.forEach(function (r) {
          var u = fv(r, 'メンバー', [])[0];
          if (u) membersCache.push({ code: u.code, name: u.name, groups: fv(r, '表示グループ', []) });
        });
        return membersCache;
      })
      .catch(function () {
        // 表示メンバー設定(35)を見られない人は、前後60日の予定の参加者からメンバーを作る(部署分け・並び順なし)
        var now = new Date();
        return fetchEvents(addDays(now, -60), addDays(now, 60)).then(function (recs) {
          var seen = {};
          membersCache = [];
          recs.forEach(function (r) {
            fv(r, '参加者', []).forEach(function (u) {
              if (seen[u.code]) return;
              seen[u.code] = true;
              membersCache.push({ code: u.code, name: u.name, groups: [] });
            });
          });
          membersCache.sort(function (a, b) { return a.name.localeCompare(b.name, 'ja'); });
          return membersCache;
        }).catch(function () { membersCache = []; return membersCache; });
      });
  }

  var holidaysCache = null;
  function fetchHolidays() {
    if (holidaysCache) return kintone.Promise.resolve(holidaysCache);
    return new kintone.Promise(function (resolve) {
      fetch(HOLIDAY_URL).then(function (r) { return r.json(); })
        .then(function (j) { holidaysCache = j; resolve(j); })
        .catch(function () { holidaysCache = {}; resolve({}); });
    });
  }

  function isCompanion(r) { return !!fv(r, '元予定No', ''); }
  function isAllDay(r) { return fv(r, '終日', []).indexOf('終日') >= 0; }
  function typeOf(r) { return isCompanion(r) ? '予定あり' : fv(r, '種類', 'その他'); }
  function participantCodes(r) { return fv(r, '参加者', []).map(function (u) { return u.code; }); }
  // 訪問先の会社名(顧客になっていない会社はネタリストの会社名)
  function companyOf(r) { return fv(r, '会社名', '') || fv(r, 'ネタ会社名', ''); }

  // 出欠表からその人の回答を取り出す(行が無ければ null)
  function answerOf(r, code) {
    var rows = fv(r, '出欠', []);
    for (var i = 0; i < rows.length; i++) {
      var u = fv(rows[i].value, '出欠_参加者', [])[0];
      if (u && u.code === code) return fv(rows[i].value, '出欠_回答', '未回答');
    }
    return null;
  }

  // 完了・中止・繰り返しの印を件名の前に付ける
  function decorate(r, title) {
    if (isCompanion(r)) return title;
    var st = fv(r, '実施状況', '予定');
    if (fv(r, '繰り返しID', '')) title = '↻' + title;
    if (st === '完了') title = '✓' + title;
    if (st === '中止') title = '[中止]' + title;
    return title;
  }

  // 1人分の予定表で、その人が辞退/未回答の予定や中止の予定を見分けられるようにするクラス
  function stateClasses(r, code) {
    if (isCompanion(r)) return [];
    if (fv(r, '実施状況', '予定') === '中止') return ['sched-declined'];
    var a = code ? answerOf(r, code) : null;
    if (a === '辞退') return ['sched-declined'];
    if (a === '未回答') return ['sched-pending'];
    return [];
  }

  // ---------- 画面遷移 ----------
  function openRecord(id) {
    location.href = IS_MOBILE ? '/k/m/' + APP_ID + '/show?record=' + id : '/k/' + APP_ID + '/show#record=' + id;
  }
  function openCreate(prefill) {
    try { sessionStorage.setItem(PREFILL_KEY, JSON.stringify(prefill)); } catch (e) { /* 自動入力なしで開く */ }
    location.href = IS_MOBILE ? '/k/m/' + APP_ID + '/edit' : '/k/' + APP_ID + '/edit';
  }

  // ---------- 非公開予定の「予定あり」レコード ----------
  function findCompanion(id) {
    return kintone.api(kintone.api.url('/k/v1/records', true), 'GET', {
      app: APP_ID, query: '元予定No = "' + id + '" limit 1', fields: ['$id']
    }).then(function (resp) { return resp.records[0] ? resp.records[0].$id.value : null; });
  }

  function syncCompanion(id, rec) {
    var isPrivate = fv(rec, '公開区分', '公開') === '非公開' && !isCompanion(rec);
    return findCompanion(id).then(function (compId) {
      if (!isPrivate) {
        if (!compId) return null;
        return kintone.api(kintone.api.url('/k/v1/records', true), 'DELETE', { app: APP_ID, ids: [compId] });
      }
      var body = companionBody(id, rec);
      if (compId) return kintone.api(kintone.api.url('/k/v1/record', true), 'PUT', { app: APP_ID, id: compId, record: body });
      return kintone.api(kintone.api.url('/k/v1/record', true), 'POST', { app: APP_ID, record: body });
    });
  }

  // 「予定あり」レコードの中身(時間と参加者だけ。件名・内容・顧客などは写さない)
  function companionBody(id, rec) {
    return {
      件名: { value: '予定あり' }, 種類: { value: 'その他' },
      開始日時: { value: fv(rec, '開始日時', null) }, 終了日時: { value: fv(rec, '終了日時', null) },
      終日: { value: fv(rec, '終日', []) },
      参加者: { value: fv(rec, '参加者', []).map(function (u) { return { code: u.code }; }) },
      公開区分: { value: '公開' }, 元予定No: { value: String(id) },
      リマインダー: { value: [] }, 繰り返し: { value: 'なし' }
    };
  }

  function deleteCompanion(id) {
    return findCompanion(id).then(function (compId) {
      if (!compId) return null;
      return kintone.api(kintone.api.url('/k/v1/records', true), 'DELETE', { app: APP_ID, ids: [compId] });
    });
  }

  // ---------- スタイル ----------
  function injectStyle() {
    if (document.getElementById('sched-style')) return;
    var css = [
      '.sched-wrap{padding:8px 16px 16px;font-size:14px;background:#fff}',
      '.sched-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:4px 0 10px}',
      '.sched-bar button,.sched-bar select{padding:6px 12px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;cursor:pointer;font-size:14px}',
      '.sched-bar button.primary{background:#2563eb;color:#fff;border-color:#2563eb}',
      '.sched-bar .title{font-weight:bold;font-size:16px;margin:0 8px}',
      '.sched-legend{display:flex;flex-wrap:wrap;gap:10px;font-size:12px;color:#475569;margin-top:8px}',
      '.sched-legend span:before{content:"";display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px;background:var(--c)}',
      '.sched-grid{border-collapse:collapse;width:100%;table-layout:fixed}',
      '.sched-grid th,.sched-grid td{border:1px solid #e2e8f0;vertical-align:top;padding:3px}',
      '.sched-grid th{background:#f8fafc;font-weight:normal;font-size:13px;padding:6px 3px}',
      '.sched-grid th.member{width:110px;text-align:left;padding-left:8px}',
      '.sched-grid td.member{background:#f8fafc;font-weight:bold;padding:8px}',
      '.sched-grid .sat{color:#2563eb}.sched-grid .sun,.sched-grid .hol{color:#dc2626}',
      '.sched-grid td.today,.sched-grid th.today{background:#fffbeb}',
      '.sched-grid td.day{height:64px;cursor:pointer}.sched-grid td.day:hover{background:#f1f5f9}',
      '.sched-chip{display:block;border-left:4px solid var(--c);background:#f8fafc;border-radius:3px;padding:2px 4px;margin:0 0 3px;font-size:12px;line-height:1.35;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.sched-chip:hover{background:#e0e7ff}',
      '.sched-chip .t{color:#475569;margin-right:4px}',
      '.sched-hname{font-size:11px;display:block}',
      '.fc .fc-day-sat .fc-col-header-cell-cushion,.fc .fc-day-sat .fc-daygrid-day-number{color:#2563eb}',
      '.fc .fc-day-sun .fc-col-header-cell-cushion,.fc .fc-day-sun .fc-daygrid-day-number,.fc .sched-holiday .fc-daygrid-day-number,.fc .sched-holiday .fc-col-header-cell-cushion{color:#dc2626}',
      '.fc .fc-event{cursor:pointer}',
      '.sched-declined{opacity:.45;text-decoration:line-through}',
      '.fc .sched-pending{background-image:repeating-linear-gradient(45deg,rgba(255,255,255,.4) 0 5px,transparent 5px 10px)}',
      '.sched-chip.sched-pending{border-left-style:dashed}',
      '.sched-actions{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:6px 0}',
      '.sched-actions button{padding:6px 12px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;cursor:pointer;font-size:13px}',
      '.sched-actions button.on{background:#1e293b;color:#fff;border-color:#1e293b}',
      '.sched-actions button.primary{background:#2563eb;color:#fff;border-color:#2563eb}',
      '.sched-actions .lbl{font-size:13px;color:#475569}',
      '.sched-modal-bg{position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:10000;display:flex;align-items:center;justify-content:center;padding:12px}',
      '.sched-modal{background:#fff;border-radius:8px;padding:16px;width:100%;max-width:880px;max-height:94vh;overflow:auto;font-size:14px;box-shadow:0 10px 30px rgba(0,0,0,.25)}',
      '.sched-modal h3{margin:0 0 10px;font-size:16px}',
      '.sched-modal label{display:block;margin:8px 0 4px;color:#475569;font-size:13px}',
      '.sched-modal select{width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:6px;font-size:14px}',
      '.sched-modal .btns{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;margin-top:14px}',
      '.sched-modal .btns button{padding:8px 14px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;cursor:pointer;font-size:14px}',
      '.sched-modal .btns button.primary{background:#2563eb;color:#fff;border-color:#2563eb}',
      '.sched-route-map{height:420px;border:1px solid #e2e8f0;border-radius:6px}',
      '.sched-route-list{margin:10px 0 0;padding:0;list-style:none;font-size:13px}',
      '.sched-route-list li{padding:4px 0;border-bottom:1px solid #f1f5f9}',
      '.sched-route-list .who{font-weight:bold;margin-top:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
      '.sched-route-list a{color:#2563eb}',
      '.sched-pin{width:24px;height:24px;border-radius:50%;color:#fff;font-weight:bold;font-size:12px;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)}',
      '.sched-m .sched-route-map{height:300px}',
      // Outlook風レイアウト(左: ミニカレンダー+メンバー、右: 人ごとの予定表を横並び)
      '.sched-ol{display:flex;gap:12px;align-items:flex-start}',
      '.sched-side{width:230px;flex:0 0 230px;border-right:1px solid #e2e8f0;padding-right:10px}',
      '.sched-main{flex:1;min-width:0}',
      '.sched-mini{margin-bottom:10px;font-size:12px}',
      '.sched-mini .mh{display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;font-weight:bold}',
      '.sched-mini .mh button{border:none;background:none;cursor:pointer;font-size:14px;padding:0 6px}',
      '.sched-mini table{width:100%;border-collapse:collapse;text-align:center}',
      '.sched-mini th{font-weight:normal;color:#64748b;padding:2px 0}',
      '.sched-mini td{padding:3px 0;cursor:pointer;border-radius:3px}',
      '.sched-mini td:hover{background:#e0e7ff}',
      '.sched-mini td.out{color:#cbd5e1}.sched-mini td.sun,.sched-mini td.hol{color:#dc2626}.sched-mini td.sat{color:#2563eb}',
      '.sched-mini td.inrange{background:#dbeafe}',
      '.sched-mini td.today{background:#2563eb;color:#fff;font-weight:bold}',
      '.sched-people h4{margin:10px 0 4px;font-size:13px;cursor:pointer;user-select:none}',
      '.sched-people label{display:flex;align-items:center;gap:6px;padding:3px 6px;border-radius:4px;cursor:pointer;font-size:13px}',
      '.sched-people label.on{background:var(--c-bg)}',
      '.sched-people label i{display:inline-block;width:10px;height:10px;border-radius:2px;background:var(--c)}',
      '.sched-views{display:inline-flex;border:1px solid #cbd5e1;border-radius:6px;overflow:hidden}',
      '.sched-bar .sched-views button{border:none;border-radius:0;border-right:1px solid #cbd5e1}',
      '.sched-bar .sched-views button:last-child{border-right:none}',
      '.sched-bar .sched-views button.on{background:#1e293b;color:#fff}',
      '.sched-panels{display:flex;gap:8px;overflow-x:auto}',
      '.sched-panel{flex:1;min-width:360px;border:1px solid #e2e8f0;border-radius:4px}',
      '.sched-panel .ph{display:flex;justify-content:space-between;align-items:center;padding:4px 8px;background:var(--c-bg);border-bottom:2px solid var(--c);font-size:13px}',
      '.sched-panel .ph button{border:none;background:none;cursor:pointer;font-size:14px;color:#475569}',
      '.sched-panel .fc{font-size:12px}',
      // スマホ画面(sched-m)と狭い画面は縦積みにする
      '.sched-m.sched-wrap{padding:8px}.sched-m .sched-grid th.member{width:72px}.sched-m .sched-ol{display:block}.sched-m .sched-side{width:auto;border:none;padding:0}.sched-m .sched-panels{flex-direction:column}.sched-m .sched-panel{min-width:0}.sched-m .sched-bar button{padding:6px 9px}',
      '@media (max-width:700px){.sched-wrap{padding:8px}.sched-grid th.member{width:72px}.sched-ol{display:block}.sched-side{width:auto;border:none;padding:0}.sched-panels{flex-direction:column}.sched-panel{min-width:0}}'
    ].join('\n');
    var s = document.createElement('style');
    s.id = 'sched-style';
    s.textContent = css;
    document.head.appendChild(s);
  }

  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'style') e.style.cssText = attrs[k];
      else if (k === 'className') e.className = attrs[k];
      else e.setAttribute(k, attrs[k]);
    });
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function legend() {
    var box = el('div', { className: 'sched-legend' });
    Object.keys(TYPE_COLORS).forEach(function (k) {
      var s = el('span', { style: '--c:' + TYPE_COLORS[k] }, k);
      box.appendChild(s);
    });
    return box;
  }

  // ---------- カレンダー表示(Outlook風: 左にミニカレンダーとメンバー、右に人ごとの予定表を横並び) ----------
  var PERSON_COLORS = ['#3b82f6', '#84cc16', '#f59e0b', '#ec4899', '#14b8a6', '#8b5cf6', '#ef4444', '#0ea5e9'];
  var VIEW_DEFS = [
    { key: 'day', label: '日', fc: 'timeGridDay' },
    { key: 'workweek', label: '稼働日', fc: 'timeGridWeek', hiddenDays: [0, 6] },
    { key: 'week', label: '週', fc: 'timeGridWeek' },
    { key: 'month', label: '月', fc: 'dayGridMonth' },
    { key: 'year', label: '年', fc: 'multiMonthYear' }
  ];
  var STATE_KEY = 'sched34-view-state';
  var calState = null;
  var calInstances = [];
  var eventCache = {};

  function viewDef(key) { return VIEW_DEFS.filter(function (v) { return v.key === key; })[0] || VIEW_DEFS[2]; }

  function loadState(me) {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(STATE_KEY) || 'null'); } catch (e) { saved = null; }
    return {
      view: saved && saved.view ? saved.view : (IS_MOBILE ? 'day' : 'week'),
      checked: saved && saved.checked && saved.checked.length ? saved.checked : [me.code],
      date: new Date(),
      miniMonth: new Date()
    };
  }
  function saveState() {
    try { localStorage.setItem(STATE_KEY, JSON.stringify({ view: calState.view, checked: calState.checked })); } catch (e) { /* 保存できなくても動く */ }
  }

  // 同じ期間の予定は1回だけ取得して、横並びの予定表で使い回す
  function cachedEvents(start, end) {
    var k = start.getTime() + '|' + end.getTime();
    if (!eventCache[k]) {
      eventCache[k] = fetchEvents(start, end);
      eventCache[k].catch(function () { delete eventCache[k]; });
    }
    return eventCache[k];
  }

  function toFcEvents(recs, codes, showNames) {
    var evs = [];
    recs.forEach(function (r) {
      var pc = participantCodes(r);
      if (!pc.some(function (c) { return codes.indexOf(c) >= 0; })) return;
      var allDay = isAllDay(r);
      var s = new Date(fv(r, '開始日時', ''));
      var e = new Date(fv(r, '終了日時', ''));
      var title = isCompanion(r) ? '予定あり' : fv(r, '件名', '');
      if (!isCompanion(r) && fv(r, '公開区分', '') === '非公開') title = '🔒' + title;
      if (!isCompanion(r) && companyOf(r)) title += ' / ' + companyOf(r);
      title = decorate(r, title);
      if (showNames) title = '[' + fv(r, '参加者', []).map(function (u) { return u.name; }).join('・') + '] ' + title;
      evs.push({
        id: fv(r, '$id', ''), title: title, allDay: allDay,
        classNames: stateClasses(r, codes.length === 1 ? codes[0] : null),
        start: allDay ? ymd(s) : s, end: allDay ? ymd(addDays(e, 1)) : e,
        backgroundColor: TYPE_COLORS[typeOf(r)], borderColor: TYPE_COLORS[typeOf(r)],
        editable: !isCompanion(r), extendedProps: { rec: r }
      });
    });
    return evs;
  }

  function renderCalendar(root) {
    if (typeof FullCalendar === 'undefined') {
      root.textContent = 'カレンダー部品(FullCalendar)を読み込めませんでした。ページを再読み込みしてください。';
      return;
    }
    destroyInstances();
    eventCache = {};
    root.innerHTML = '';
    var me = kintone.getLoginUser();
    if (!calState) calState = loadState(me);

    var wrap = el('div', { className: 'sched-wrap' + (IS_MOBILE ? ' sched-m' : '') });
    var layout = el('div', { className: 'sched-ol' });
    var side = el('div', { className: 'sched-side' });
    var main = el('div', { className: 'sched-main' });
    layout.appendChild(side);
    layout.appendChild(main);
    wrap.appendChild(layout);
    root.appendChild(wrap);

    // 上部のツールバー
    var bar = el('div', { className: 'sched-bar' });
    var todayBtn = el('button', {}, '今日');
    var prevBtn = el('button', {}, '＜');
    var nextBtn = el('button', {}, '＞');
    var title = el('span', { className: 'title' });
    var views = el('span', { className: 'sched-views' });
    var newBtn = el('button', { className: 'primary' }, '＋ 新しい予定');
    VIEW_DEFS.forEach(function (v) {
      var b = el('button', { 'data-view': v.key }, v.label);
      b.addEventListener('click', function () { calState.view = v.key; saveState(); drawPanels(); });
      views.appendChild(b);
    });
    var routeBtn = el('button', { title: '表示中の日(週・月表示では今日)の訪問先を地図に表示' }, '🗺 訪問ルート');
    [todayBtn, prevBtn, nextBtn, title, views, newBtn, routeBtn].forEach(function (x) { bar.appendChild(x); });
    var panels = el('div', { className: 'sched-panels' });
    main.appendChild(bar);
    main.appendChild(panels);
    main.appendChild(legend());

    var miniBox = el('div');
    var peopleBox = el('div', { className: 'sched-people' });
    if (IS_MOBILE) {
      // スマホは画面が狭いので、ミニカレンダーとメンバーを折りたたむ
      var det = el('details');
      det.appendChild(el('summary', { style: 'padding:6px 0;font-weight:bold;cursor:pointer' }, '日付・表示する人を選ぶ'));
      det.appendChild(miniBox);
      det.appendChild(peopleBox);
      side.appendChild(det);
    } else {
      side.appendChild(miniBox);
      side.appendChild(peopleBox);
    }

    var members = [];
    var holidays = {};

    function colorOf(code) {
      var i = members.map(function (m) { return m.code; }).indexOf(code);
      return PERSON_COLORS[(i < 0 ? 0 : i) % PERSON_COLORS.length];
    }
    function nameOf(code) {
      var m = members.filter(function (x) { return x.code === code; })[0];
      return m ? m.name : code;
    }

    function drawPeople() {
      peopleBox.innerHTML = '';
      var sections = [{ name: '自分の予定表', list: members.filter(function (m) { return m.code === me.code; }) }];
      GROUPS.forEach(function (g) {
        sections.push({ name: g, list: members.filter(function (m) { return m.groups.indexOf(g) >= 0; }) });
      });
      // 部署が分からない人(表示メンバー設定を見られない場合など)
      sections.push({ name: 'メンバー', list: members.filter(function (m) { return !m.groups.length && m.code !== me.code; }) });
      sections.forEach(function (sec) {
        if (!sec.list.length) return;
        var h = el('h4', { title: 'クリックでこのグループ全員の表示を切り替え' }, '▾ ' + sec.name);
        h.addEventListener('click', function () {
          var codes = sec.list.map(function (m) { return m.code; });
          var allOn = codes.every(function (c) { return calState.checked.indexOf(c) >= 0; });
          calState.checked = allOn
            ? calState.checked.filter(function (c) { return codes.indexOf(c) < 0; })
            : calState.checked.concat(codes.filter(function (c) { return calState.checked.indexOf(c) < 0; }));
          if (!calState.checked.length) calState.checked = [me.code];
          saveState(); drawPeople(); drawPanels();
        });
        peopleBox.appendChild(h);
        sec.list.forEach(function (m) {
          var on = calState.checked.indexOf(m.code) >= 0;
          var c = colorOf(m.code);
          var lb = el('label', { className: on ? 'on' : '', style: '--c:' + c + ';--c-bg:' + c + '22' });
          var cb = el('input', { type: 'checkbox' });
          cb.checked = on;
          cb.addEventListener('change', function () {
            if (cb.checked) { if (calState.checked.indexOf(m.code) < 0) calState.checked.push(m.code); }
            else calState.checked = calState.checked.filter(function (x) { return x !== m.code; });
            if (!calState.checked.length) calState.checked = [me.code];
            saveState(); drawPeople(); drawPanels();
          });
          lb.appendChild(cb);
          lb.appendChild(el('i'));
          lb.appendChild(document.createTextNode(m.name));
          peopleBox.appendChild(lb);
        });
      });
    }

    function drawMini() {
      miniBox.innerHTML = '';
      var range = calInstances[0] ? calInstances[0].view : null;
      var highlight = range && (calState.view === 'day' || calState.view === 'workweek' || calState.view === 'week');
      for (var k = 0; k < 2; k++) {
        var base = new Date(calState.miniMonth.getFullYear(), calState.miniMonth.getMonth() + k, 1);
        var box = el('div', { className: 'sched-mini' });
        var head = el('div', { className: 'mh' });
        var pv = el('button', {}, k === 0 ? '‹' : '');
        var nx = el('button', {}, k === 0 ? '›' : '');
        head.appendChild(pv);
        head.appendChild(el('span', {}, base.getFullYear() + '年 ' + (base.getMonth() + 1) + '月'));
        head.appendChild(nx);
        if (k === 0) {
          pv.addEventListener('click', function () { calState.miniMonth = new Date(calState.miniMonth.getFullYear(), calState.miniMonth.getMonth() - 1, 1); drawMini(); });
          nx.addEventListener('click', function () { calState.miniMonth = new Date(calState.miniMonth.getFullYear(), calState.miniMonth.getMonth() + 1, 1); drawMini(); });
        }
        box.appendChild(head);
        var t = el('table');
        var hr = el('tr');
        WEEKDAYS.forEach(function (w) { hr.appendChild(el('th', {}, w)); });
        t.appendChild(hr);
        var d = addDays(base, -base.getDay());
        for (var row = 0; row < 6; row++) {
          var tr = el('tr');
          for (var col = 0; col < 7; col++) {
            tr.appendChild(miniCell(d, base, range, highlight));
            d = addDays(d, 1);
          }
          t.appendChild(tr);
        }
        box.appendChild(t);
        miniBox.appendChild(box);
      }
    }

    function miniCell(day, base, range, highlight) {
      var cls = [];
      if (day.getMonth() !== base.getMonth()) cls.push('out');
      if (day.getDay() === 0) cls.push('sun');
      if (day.getDay() === 6) cls.push('sat');
      if (holidays[ymd(day)]) cls.push('hol');
      if (highlight && day >= range.activeStart && day < range.activeEnd) cls.push('inrange');
      if (ymd(day) === ymd(new Date())) cls.push('today');
      var td = el('td', { className: cls.join(' '), title: holidays[ymd(day)] || '' }, String(day.getDate()));
      td.addEventListener('click', function () {
        calState.date = day;
        calInstances.forEach(function (c) { c.gotoDate(day); });
        afterNavigate();
      });
      return td;
    }

    function afterNavigate() {
      if (!calInstances.length) return;
      title.textContent = calInstances[0].view.title;
      calState.date = calInstances[0].getDate();
      calState.miniMonth = new Date(calState.date.getFullYear(), calState.date.getMonth(), 1);
      drawMini();
    }

    function fcOptions(codes, showNames) {
      var def = viewDef(calState.view);
      var timeGrid = def.fc.indexOf('timeGrid') === 0;
      var multi = calState.checked.length > 1 && calState.view !== 'year';
      return {
        locale: 'ja', initialView: def.fc, initialDate: calState.date, headerToolbar: false,
        hiddenDays: def.hiddenDays || [], firstDay: 0,
        height: def.fc === 'multiMonthYear' || IS_MOBILE ? 'auto' : Math.max(520, window.innerHeight - 250),
        multiMonthMaxColumns: IS_MOBILE ? 1 : 4,
        slotMinTime: '07:00:00', slotMaxTime: '22:00:00', scrollTime: '08:00:00', slotDuration: '00:30:00',
        allDayText: '終日',
        businessHours: { daysOfWeek: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '17:00' },
        nowIndicator: true, dayMaxEvents: true, navLinks: true,
        navLinkDayClick: function (date) { calState.view = 'day'; calState.date = date; saveState(); drawPanels(); },
        selectable: true, selectMirror: true, editable: true,
        eventTimeFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
        dayHeaderContent: timeGrid ? function (arg) {
          var d = arg.date;
          var hol = holidays[ymd(d)];
          var color = hol || d.getDay() === 0 ? '#dc2626' : d.getDay() === 6 ? '#2563eb' : '#334155';
          var html = '<div style="color:' + color + '">' + (multi ? '' : (d.getMonth() + 1) + '/') + d.getDate() + '日(' + WEEKDAYS[d.getDay()] + ')</div>';
          if (hol) html += '<div class="sched-hname" style="color:#dc2626">' + hol.replace(/[<>&"]/g, '') + '</div>';
          return { html: html };
        } : undefined,
        dayCellClassNames: function (arg) { return holidays[ymd(arg.date)] ? ['sched-holiday'] : []; },
        dayCellContent: function (arg) { return arg.dayNumberText.replace('日', ''); },
        events: function (info, success, failure) {
          cachedEvents(info.start, info.end).then(function (recs) {
            var evs = toFcEvents(recs, codes, showNames);
            Object.keys(holidays).forEach(function (d) {
              evs.push({ start: d, allDay: true, display: 'background', backgroundColor: '#fee2e2' });
            });
            success(evs);
          }).catch(function (err) { failure(err); });
        },
        eventClick: function (info) { if (info.event.id) openRecord(info.event.id); },
        select: function (info) {
          var end = info.allDay ? addDays(info.end, -1) : info.end;
          var u = codes.length === 1 ? { code: codes[0], name: nameOf(codes[0]) } : { code: me.code, name: me.name };
          openCreate({
            start: toKintoneDT(info.start),
            end: toKintoneDT(info.allDay ? new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59) : end),
            allDay: info.allDay, user: u
          });
        },
        eventDrop: function (info) { saveMoved(info); },
        eventResize: function (info) { saveMoved(info); }
      };
    }

    function drawPanels() {
      destroyInstances();
      panels.innerHTML = '';
      Array.prototype.forEach.call(views.children, function (b) {
        b.className = b.getAttribute('data-view') === calState.view ? 'on' : '';
      });
      // 年表示は横に並べると読めないので、選んだ人の予定を1つにまとめて名前付きで表示する
      var groups = calState.view === 'year'
        ? [{ codes: calState.checked, label: calState.checked.map(nameOf).join('・'), color: '#64748b', names: calState.checked.length > 1 }]
        : calState.checked.map(function (c) { return { codes: [c], label: nameOf(c), color: colorOf(c), names: false }; });
      groups.forEach(function (g) {
        var p = el('div', { className: 'sched-panel', style: '--c:' + g.color + ';--c-bg:' + g.color + '22' });
        var ph = el('div', { className: 'ph' });
        ph.appendChild(el('span', {}, g.label));
        if (g.codes.length === 1 && calState.checked.length > 1) {
          var x = el('button', { title: '閉じる' }, '×');
          x.addEventListener('click', function () {
            calState.checked = calState.checked.filter(function (c) { return c !== g.codes[0]; });
            saveState(); drawPeople(); drawPanels();
          });
          ph.appendChild(x);
        }
        p.appendChild(ph);
        var calEl = el('div');
        p.appendChild(calEl);
        panels.appendChild(p);
        var cal = new FullCalendar.Calendar(calEl, fcOptions(g.codes, g.names));
        cal.render();
        calInstances.push(cal);
      });
      afterNavigate();
    }

    todayBtn.addEventListener('click', function () { calInstances.forEach(function (c) { c.today(); }); afterNavigate(); });
    prevBtn.addEventListener('click', function () { calInstances.forEach(function (c) { c.prev(); }); afterNavigate(); });
    nextBtn.addEventListener('click', function () { calInstances.forEach(function (c) { c.next(); }); afterNavigate(); });
    routeBtn.addEventListener('click', function () {
      var day = calState.view === 'day' ? calState.date : new Date();
      showRoute(startOfDay(day), calState.checked.map(function (c) { return { code: c, name: nameOf(c), color: colorOf(c) }; }));
    });
    newBtn.addEventListener('click', function () {
      var s = new Date(calState.date.getTime()); s.setHours(new Date().getHours() + 1, 0, 0, 0);
      openCreate({ start: toKintoneDT(s), end: toKintoneDT(new Date(s.getTime() + 3600000)), allDay: false, user: { code: me.code, name: me.name } });
    });

    kintone.Promise.all([fetchMembers(), fetchHolidays()]).then(function (res) {
      members = res[0].slice();
      holidays = res[1];
      if (!members.some(function (m) { return m.code === me.code; })) members.unshift({ code: me.code, name: me.name, groups: [] });
      var known = members.map(function (m) { return m.code; });
      calState.checked = calState.checked.filter(function (c) { return known.indexOf(c) >= 0; });
      if (!calState.checked.length) calState.checked = [me.code];
      drawPeople();
      drawPanels();
    });
  }

  function destroyInstances() {
    calInstances.forEach(function (c) { c.destroy(); });
    calInstances = [];
  }

  function refetchAll() {
    eventCache = {};
    calInstances.forEach(function (c) { c.refetchEvents(); });
  }

  // ドラッグ・リサイズで変わった日時を保存する(権限がなければ元に戻す)
  function saveMoved(info) {
    var ev = info.event;
    var rec = ev.extendedProps.rec;
    var start, end;
    if (ev.allDay) {
      start = startOfDay(ev.start);
      var lastDay = ev.end ? addDays(ev.end, -1) : start;
      end = new Date(lastDay.getFullYear(), lastDay.getMonth(), lastDay.getDate(), 23, 59);
    } else {
      start = ev.start;
      end = ev.end || new Date(ev.start.getTime() + 3600000);
    }
    var body = {
      開始日時: { value: toKintoneDT(start) }, 終了日時: { value: toKintoneDT(end) },
      終日: { value: ev.allDay ? ['終日'] : [] }
    };
    kintone.api(kintone.api.url('/k/v1/record', true), 'PUT', { app: APP_ID, id: ev.id, record: body })
      .then(function () {
        if (fv(rec, '公開区分', '') !== '非公開') return null;
        var merged = Object.assign({}, rec, body);
        return syncCompanion(ev.id, merged);
      })
      .then(function () {
        var me = kintone.getLoginUser().code;
        var others = participantCodes(rec).filter(function (c) { return c !== me; });
        var merged = Object.assign({}, rec, body);
        return postComment(ev.id, '予定の日時が変更されました。\n件名: ' + fv(rec, '件名', '') + '\n日時: ' + whenText(merged), others);
      })
      .then(function () { return syncDeals([fv(rec, '案件No', '')]).catch(function () { return null; }); })
      .then(function () { refetchAll(); })
      .catch(function (err) {
        info.revert();
        alert('日時を変更できませんでした。' + (err && err.message ? '\n' + err.message : ''));
      });
  }

  // ---------- メンバー週表示 ----------
  var groupState = { weekStart: null, day: null, group: '' };

  function renderGroup(root) {
    root.innerHTML = '';
    var wrap = el('div', { className: 'sched-wrap' + (IS_MOBILE ? ' sched-m' : '') });
    var bar = el('div', { className: 'sched-bar' });
    var prev = el('button', {}, IS_MOBILE ? '◀ 前日' : '◀ 前週');
    var today = el('button', {}, '今日');
    var next = el('button', {}, IS_MOBILE ? '翌日 ▶' : '翌週 ▶');
    var title = el('span', { className: 'title' });
    var sel = el('select');
    sel.appendChild(el('option', { value: '' }, '全員'));
    GROUPS.forEach(function (g) { sel.appendChild(el('option', { value: g }, g)); });
    sel.value = groupState.group;
    [prev, today, next, title, sel].forEach(function (x) { bar.appendChild(x); });
    var body = el('div', { style: 'overflow-x:auto' });
    wrap.appendChild(bar);
    wrap.appendChild(body);
    wrap.appendChild(legend());
    root.appendChild(wrap);

    if (!groupState.weekStart) groupState.weekStart = startOfWeek(new Date());
    if (!groupState.day) groupState.day = startOfDay(new Date());
    var step = IS_MOBILE ? 1 : 7;

    function draw() {
      var days = [];
      var first = IS_MOBILE ? groupState.day : groupState.weekStart;
      for (var i = 0; i < step; i++) days.push(addDays(first, i));
      var last = days[days.length - 1];
      title.textContent = IS_MOBILE
        ? (first.getMonth() + 1) + '月' + first.getDate() + '日(' + WEEKDAYS[first.getDay()] + ')'
        : first.getFullYear() + '年' + (first.getMonth() + 1) + '月' + first.getDate() + '日 〜 ' + (last.getMonth() + 1) + '月' + last.getDate() + '日';
      body.textContent = '読み込み中…';
      kintone.Promise.all([fetchMembers(), fetchHolidays(), fetchEvents(first, addDays(last, 1))]).then(function (res) {
        var members = res[0].filter(function (m) { return !groupState.group || m.groups.indexOf(groupState.group) >= 0; });
        var holidays = res[1];
        var recs = res[2];
        body.innerHTML = '';
        if (!members.length) {
          body.textContent = '表示するメンバーがいません。「スケジュール表示メンバー設定」アプリで登録してください。';
          return;
        }
        var todayStr = ymd(new Date());
        var table = el('table', { className: 'sched-grid' });
        var thead = el('tr');
        thead.appendChild(el('th', { className: 'member' }, '名前'));
        days.forEach(function (d) {
          var cls = (d.getDay() === 6 ? 'sat' : d.getDay() === 0 ? 'sun' : '') + (holidays[ymd(d)] ? ' hol' : '') + (ymd(d) === todayStr ? ' today' : '');
          var th = el('th', { className: cls }, (d.getMonth() + 1) + '/' + d.getDate() + '(' + WEEKDAYS[d.getDay()] + ')');
          if (holidays[ymd(d)]) th.appendChild(el('span', { className: 'sched-hname' }, holidays[ymd(d)]));
          thead.appendChild(th);
        });
        table.appendChild(thead);

        members.forEach(function (m) {
          var tr = el('tr');
          tr.appendChild(el('td', { className: 'member' }, m.name));
          days.forEach(function (d) {
            var dayStart = d;
            var dayEnd = addDays(d, 1);
            var td = el('td', { className: 'day' + (ymd(d) === todayStr ? ' today' : '') });
            recs.filter(function (r) {
              if (participantCodes(r).indexOf(m.code) < 0) return false;
              var s = new Date(fv(r, '開始日時', ''));
              var e = new Date(fv(r, '終了日時', ''));
              return s < dayEnd && e > dayStart;
            }).sort(function (a, b) {
              return (isAllDay(b) - isAllDay(a)) || (new Date(fv(a, '開始日時', '')) - new Date(fv(b, '開始日時', '')));
            }).forEach(function (r) {
              var s = new Date(fv(r, '開始日時', ''));
              var label = isAllDay(r) ? '終日' : (s >= dayStart ? hm(s) : '(続き)');
              var name = decorate(r, isCompanion(r) ? '予定あり' : (fv(r, '公開区分', '') === '非公開' ? '🔒' : '') + fv(r, '件名', ''));
              var extra = !isCompanion(r) && companyOf(r) ? ' / ' + companyOf(r) : '';
              var chip = el('span', { className: ['sched-chip'].concat(stateClasses(r, m.code)).join(' '), style: '--c:' + TYPE_COLORS[typeOf(r)], title: label + ' ' + name + extra });
              chip.appendChild(el('span', { className: 't' }, label));
              chip.appendChild(document.createTextNode(name + extra));
              chip.addEventListener('click', function (ev) { ev.stopPropagation(); openRecord(fv(r, '$id', '')); });
              td.appendChild(chip);
            });
            td.addEventListener('click', function () {
              var s = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9, 0);
              openCreate({ start: toKintoneDT(s), end: toKintoneDT(new Date(s.getTime() + 3600000)), allDay: false, user: { code: m.code, name: m.name } });
            });
            tr.appendChild(td);
          });
          table.appendChild(tr);
        });
        body.appendChild(table);
      }).catch(function (err) {
        body.textContent = '予定を読み込めませんでした。' + (err && err.message ? err.message : '');
      });
    }

    prev.addEventListener('click', function () {
      if (IS_MOBILE) groupState.day = addDays(groupState.day, -1); else groupState.weekStart = addDays(groupState.weekStart, -7);
      draw();
    });
    next.addEventListener('click', function () {
      if (IS_MOBILE) groupState.day = addDays(groupState.day, 1); else groupState.weekStart = addDays(groupState.weekStart, 7);
      draw();
    });
    today.addEventListener('click', function () {
      groupState.weekStart = startOfWeek(new Date());
      groupState.day = startOfDay(new Date());
      draw();
    });
    sel.addEventListener('change', function () { groupState.group = sel.value; draw(); });
    draw();
  }

  // ---------- 一覧画面 ----------
  kintone.events.on(['app.record.index.show', 'mobile.app.record.index.show'], function (event) {
    detectEnv(event);
    injectStyle();
    var calRoot = document.getElementById('sched-root');
    var groupRoot = document.getElementById('sched-group-root');
    var old = document.getElementById('sched-mobile-root');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    // スマホはカスタマイズ形式の一覧を表示しないため、空の一覧「カレンダー(スマホ)」のヘッダーに描画する
    if (!calRoot && !groupRoot && event.viewName === MOBILE_VIEW_NAME) {
      var space = IS_MOBILE ? kintone.mobile.app.getHeaderSpaceElement() : kintone.app.getHeaderSpaceElement();
      if (space) renderMobileTabs(space);
      return event;
    }
    if (calRoot) renderCalendar(calRoot);
    if (groupRoot) renderGroup(groupRoot);
    return event;
  });

  var MOBILE_VIEW_NAME = 'カレンダー(スマホ)';
  var MOBILE_TAB_KEY = 'sched34-mobile-tab';

  function renderMobileTabs(space) {
    var holder = el('div', { id: 'sched-mobile-root' });
    var bar = el('div', { className: 'sched-bar', style: 'margin:8px 8px 0' });
    var tabs = el('span', { className: 'sched-views', style: 'display:flex;width:100%' });
    bar.appendChild(tabs);
    var body = el('div');
    var tab = 'cal';
    try { tab = localStorage.getItem(MOBILE_TAB_KEY) || 'cal'; } catch (e) { tab = 'cal'; }
    [['cal', 'カレンダー'], ['group', 'メンバー']].forEach(function (t) {
      var b = el('button', { className: t[0] === tab ? 'on' : '', style: 'flex:1' }, t[1]);
      b.addEventListener('click', function () {
        try { localStorage.setItem(MOBILE_TAB_KEY, t[0]); } catch (e) { /* 保存できなくても動く */ }
        holder.parentNode.removeChild(holder);
        renderMobileTabs(space);
      });
      tabs.appendChild(b);
    });
    holder.appendChild(bar);
    holder.appendChild(body);
    space.appendChild(holder);
    if (tab === 'group') renderGroup(body); else renderCalendar(body);
  }

  // ---------- 入力画面 ----------
  var ACTIVITY_APP_ID = 17;
  var MAX_OCCURRENCES = 200;
  var duration = 3600000;
  var prevState = null;      // 編集前の参加者・日時(招待/変更の通知に使う)
  var seriesScope = 'this';  // 繰り返し予定の編集を「今後すべて」に反映するか

  function setShown(code, shown) {
    if (IS_MOBILE) kintone.mobile.app.record.setFieldShown(code, shown);
    else kintone.app.record.setFieldShown(code, shown);
  }

  function api(path, method, params) { return kintone.api(kintone.api.url(path, true), method, params); }

  function disableAttendanceRows(r) {
    fv(r, '出欠', []).forEach(function (row) {
      ['出欠_参加者', '出欠_回答', '出欠_コメント'].forEach(function (c) { if (row.value[c]) row.value[c].disabled = true; });
    });
  }

  kintone.events.on(['app.record.create.show', 'mobile.app.record.create.show'], function (event) {
    detectEnv(event);
    var r = event.record;
    // 再利用(コピー)で作るときに、自動で入る欄を持ち越さない
    r.元予定No.value = '';
    r.繰り返しID.value = '';
    r.活動履歴No.value = '';
    r.実施状況.value = '予定';
    var raw = null;
    try { raw = sessionStorage.getItem(PREFILL_KEY); sessionStorage.removeItem(PREFILL_KEY); } catch (e) { raw = null; }
    if (raw) {
      var p = JSON.parse(raw);
      r.開始日時.value = p.start;
      r.終了日時.value = p.end;
      r.終日.value = p.allDay ? ['終日'] : [];
      if (p.user && p.user.code) r.参加者.value = [{ code: p.user.code, name: p.user.name }];
      if (p.title) r.件名.value = p.title;
      if (p.type) r.種類.value = p.type;
      if (p.custNo || p.dealNo || p.netaNo) {
        // ルックアップの取得は表示が終わってから行う
        setTimeout(function () {
          var cur = recApi().get();
          [['顧客No', p.custNo], ['案件No', p.dealNo], ['ネタNo', p.netaNo]].forEach(function (f) {
            if (!f[1]) return;
            cur.record[f[0]].value = String(f[1]);
            cur.record[f[0]].lookup = true;
          });
          recApi().set(cur);
        }, 0);
      }
    } else if (!r.開始日時.value) {
      var s = new Date(); s.setMinutes(0, 0, 0); s.setHours(s.getHours() + 1);
      r.開始日時.value = toKintoneDT(s);
      r.終了日時.value = toKintoneDT(new Date(s.getTime() + 3600000));
    }
    rememberDuration(r);
    prevState = null;
    ['元予定No', '繰り返しID', '活動履歴No', '出欠'].forEach(function (c) { setShown(c, false); });
    r.元予定No.disabled = true;
    r.繰り返しID.disabled = true;
    r.活動履歴No.disabled = true;
    return event;
  });

  kintone.events.on(['app.record.edit.show', 'mobile.app.record.edit.show'], function (event) {
    detectEnv(event);
    var r = event.record;
    rememberDuration(r);
    prevState = {
      dealNo: fv(r, '案件No', ''), codes: participantCodes(r), start: fv(r, '開始日時', ''), end: fv(r, '終了日時', ''), status: fv(r, '実施状況', '予定')
    };
    setShown('元予定No', !!fv(r, '元予定No', ''));
    setShown('繰り返しID', false);
    ['元予定No', '繰り返しID', '活動履歴No', '繰り返し', '繰り返し終了日'].forEach(function (c) { r[c].disabled = true; });
    disableAttendanceRows(r);
    return event;
  });

  kintone.events.on(['app.record.detail.show', 'mobile.app.record.detail.show'], function (event) {
    detectEnv(event);
    injectStyle();
    var r = event.record;
    setShown('元予定No', !!fv(r, '元予定No', ''));
    setShown('繰り返しID', false);
    setShown('活動履歴No', !!fv(r, '活動履歴No', ''));
    if (fv(r, '繰り返し', 'なし') === 'なし') { setShown('繰り返し', false); setShown('繰り返し終了日', false); }
    drawDetailActions(event);
    return event;
  });

  function rememberDuration(r) {
    var s = Date.parse(fv(r, '開始日時', ''));
    var e = Date.parse(fv(r, '終了日時', ''));
    if (!isNaN(s) && !isNaN(e) && e > s) duration = e - s;
  }

  // 開始を動かしたら、終了も同じ長さを保ってずらす(Outlookと同じ動き)
  kintone.events.on(['app.record.create.change.開始日時', 'app.record.edit.change.開始日時',
    'mobile.app.record.create.change.開始日時', 'mobile.app.record.edit.change.開始日時'], function (event) {
    detectEnv(event);
    var r = event.record;
    var s = Date.parse(fv(r, '開始日時', ''));
    if (!isNaN(s)) r.終了日時.value = toKintoneDT(new Date(s + duration));
    return event;
  });

  kintone.events.on(['app.record.create.change.終了日時', 'app.record.edit.change.終了日時',
    'mobile.app.record.create.change.終了日時', 'mobile.app.record.edit.change.終了日時'], function (event) {
    detectEnv(event);
    rememberDuration(event.record);
    return event;
  });

  // 終日にしたら 0:00〜23:59 にそろえる
  kintone.events.on(['app.record.create.change.終日', 'app.record.edit.change.終日',
    'mobile.app.record.create.change.終日', 'mobile.app.record.edit.change.終日'], function (event) {
    detectEnv(event);
    var r = event.record;
    if (!isAllDay(r)) return event;
    var s = new Date(fv(r, '開始日時', '') || Date.now());
    var e = new Date(fv(r, '終了日時', '') || s);
    if (e < s) e = s;
    r.開始日時.value = toKintoneDT(new Date(s.getFullYear(), s.getMonth(), s.getDate(), 0, 0));
    r.終了日時.value = toKintoneDT(new Date(e.getFullYear(), e.getMonth(), e.getDate(), 23, 59));
    rememberDuration(r);
    return event;
  });

  // 案件を選んだら、その案件の顧客も自動で取得する(1つの欄を2つのルックアップのコピー先にできないためJSで連鎖)
  kintone.events.on(['app.record.create.change.案件No', 'app.record.edit.change.案件No',
    'mobile.app.record.create.change.案件No', 'mobile.app.record.edit.change.案件No'], function (event) {
    detectEnv(event);
    var dealNo = fv(event.record, '案件No', '');
    if (!dealNo) return event;
    api('/k/v1/record', 'GET', { app: DEAL_APP_ID, id: dealNo }).then(function (resp) {
      var custNo = fv(resp.record, '顧客No_', '');
      if (!custNo) return;
      var cur = recApi().get();
      if (fv(cur.record, '顧客No', '') === String(custNo)) return;
      cur.record.顧客No.value = String(custNo);
      cur.record.顧客No.lookup = true;
      recApi().set(cur);
    }).catch(function () { /* 顧客は手で選べるので無視 */ });
    return event;
  });

  // 参加者に合わせて出欠表の行をそろえる(既存の回答は残す。主催者=作成者は最初から「承諾」)
  function syncAttendance(r, organizerCode, fresh) {
    var byCode = {};
    // 新規作成(再利用を含む)では、コピー元の回答を持ち越さない
    (fresh ? [] : fv(r, '出欠', [])).forEach(function (row) {
      var u = fv(row.value, '出欠_参加者', [])[0];
      if (u) byCode[u.code] = row;
    });
    r.出欠.value = fv(r, '参加者', []).map(function (u) {
      if (byCode[u.code]) return byCode[u.code];
      return { value: {
        出欠_参加者: { type: 'USER_SELECT', value: [{ code: u.code, name: u.name }] },
        出欠_回答: { type: 'DROP_DOWN', value: u.code === organizerCode ? '承諾' : '未回答' },
        出欠_コメント: { type: 'SINGLE_LINE_TEXT', value: '' }
      } };
    });
  }

  kintone.events.on(['app.record.create.submit', 'app.record.edit.submit',
    'mobile.app.record.create.submit', 'mobile.app.record.edit.submit'], function (event) {
    detectEnv(event);
    var r = event.record;
    var isCreate = event.type.indexOf('create') >= 0;
    var s = Date.parse(fv(r, '開始日時', ''));
    var e = Date.parse(fv(r, '終了日時', ''));
    if (!isNaN(s) && !isNaN(e) && e < s) {
      r.終了日時.error = '終了は開始より後の日時にしてください';
      event.error = '終了日時を確認してください';
      return event;
    }
    if (isCreate && fv(r, '繰り返し', 'なし') !== 'なし') {
      var endDay = fv(r, '繰り返し終了日', '');
      if (!endDay) {
        r.繰り返し終了日.error = '繰り返す場合は終了日を入れてください';
        event.error = '繰り返しの終了日を入れてください';
        return event;
      }
      if (endDay <= ymd(new Date(s))) {
        r.繰り返し終了日.error = '開始日より後の日付にしてください';
        event.error = '繰り返しの終了日を確認してください';
        return event;
      }
      r.繰り返しID.value = 'R' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    }
    var organizer = isCreate ? kintone.getLoginUser().code : (fv(r, '作成者', {}).code || kintone.getLoginUser().code);
    syncAttendance(r, organizer, isCreate);
    seriesScope = 'this';
    if (!isCreate && fv(r, '繰り返しID', '') && !isCompanion(r)) {
      seriesScope = confirm('この予定は繰り返し予定です。\n\nOK: この回と、これより後の回すべてに変更を反映する\nキャンセル: この回だけ変更する') ? 'future' : 'this';
    }
    return event;
  });

  kintone.events.on(['app.record.create.submit.success', 'app.record.edit.submit.success',
    'mobile.app.record.create.submit.success', 'mobile.app.record.edit.submit.success'], function (event) {
    detectEnv(event);
    var r = event.record;
    if (isCompanion(r)) return event;
    var isCreate = event.type.indexOf('create') >= 0;
    var id = event.recordId || fv(r, '$id', '');
    var notes = [];
    return syncCompanion(id, r)
      .catch(function () { notes.push('非公開予定の「予定あり」表示を更新できませんでした。'); })
      .then(function () {
        if (isCreate && fv(r, '繰り返しID', '')) return createSeries(id, r).then(function (n) { if (n.msg) notes.push(n.msg); });
        if (!isCreate && seriesScope === 'future') return updateFutureSeries(id, r).then(function (n) { if (n) notes.push('これより後の' + n + '件にも反映しました。'); });
        return null;
      })
      .catch(function (err) { notes.push('繰り返し予定の作成・更新でエラーが出ました。' + (err && err.message ? err.message : '')); })
      .then(function () {
        var deals = [fv(r, '案件No', '')];
        if (prevState && prevState.dealNo && deals.indexOf(prevState.dealNo) < 0) deals.push(prevState.dealNo);
        return syncDeals(deals);
      })
      .catch(function () { notes.push('案件の次回商談日を更新できませんでした。'); })
      .then(function () { return notifyParticipants(id, r, isCreate); })
      .catch(function () { notes.push('参加者への通知(コメント)を送れませんでした。'); })
      .then(function () {
        if (notes.length) alert('予定を保存しました。\n' + notes.join('\n'));
        return event;
      });
  });

  // ---------- 繰り返し ----------
  function occurrenceDates(r, holidays) {
    var rule = fv(r, '繰り返し', 'なし');
    var s = new Date(fv(r, '開始日時', ''));
    var parts = fv(r, '繰り返し終了日', '').split('-');
    var limit = new Date(+parts[0], +parts[1] - 1, +parts[2], 23, 59, 59);
    var out = [];
    for (var i = 1; i < 2000 && out.length < MAX_OCCURRENCES; i++) {
      var d;
      if (rule === '毎日' || rule === '毎日(平日のみ)') d = addDays(s, i);
      else if (rule === '毎週') d = addDays(s, 7 * i);
      else if (rule === '隔週') d = addDays(s, 14 * i);
      else if (rule === '毎月(同じ日)') {
        d = new Date(s.getFullYear(), s.getMonth() + i, s.getDate(), s.getHours(), s.getMinutes());
        if (d.getDate() !== s.getDate()) continue; // 31日などが無い月は飛ばす
      } else break;
      if (d > limit) break;
      if (rule === '毎日(平日のみ)' && (d.getDay() === 0 || d.getDay() === 6 || holidays[ymd(d)])) continue;
      out.push(d);
    }
    return out;
  }

  function attendanceForApi(rows) {
    return rows.map(function (row) {
      var v = row.value;
      var out = { value: {
        出欠_参加者: { value: fv(v, '出欠_参加者', []).map(function (u) { return { code: u.code }; }) },
        出欠_回答: { value: fv(v, '出欠_回答', '未回答') },
        出欠_コメント: { value: fv(v, '出欠_コメント', '') }
      } };
      if (row.id) out.id = row.id;
      return out;
    });
  }

  // 繰り返しの各回にコピーする内容(日時以外)
  function sharedFields(r) {
    return {
      件名: { value: fv(r, '件名', '') }, 種類: { value: fv(r, '種類', 'その他') }, 終日: { value: fv(r, '終日', []) },
      参加者: { value: fv(r, '参加者', []).map(function (u) { return { code: u.code }; }) },
      場所: { value: fv(r, '場所', '') }, 顧客No: { value: fv(r, '顧客No', '') }, 案件No: { value: fv(r, '案件No', '') },
      内容: { value: fv(r, '内容', '') }, 公開区分: { value: fv(r, '公開区分', '公開') }, ネタNo: { value: fv(r, 'ネタNo', '') }, 先方担当者No: { value: fv(r, '先方担当者No', '') },
      リマインダー: { value: fv(r, 'リマインダー', []) }
    };
  }

  function chunks(arr, n) { var out = []; for (var i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; }

  function createSeries(id, r) {
    return fetchHolidays().then(function (holidays) {
      var dates = occurrenceDates(r, holidays);
      var s = new Date(fv(r, '開始日時', ''));
      var e = new Date(fv(r, '終了日時', ''));
      var shared = sharedFields(r);
      var recs = dates.map(function (d) {
        var delta = d.getTime() - s.getTime();
        var rec = Object.assign({}, shared, {
          開始日時: { value: toKintoneDT(d) }, 終了日時: { value: toKintoneDT(new Date(e.getTime() + delta)) },
          繰り返し: { value: fv(r, '繰り返し', 'なし') }, 繰り返し終了日: { value: fv(r, '繰り返し終了日', '') },
          繰り返しID: { value: fv(r, '繰り返しID', '') }, 実施状況: { value: '予定' },
          出欠: { value: attendanceForApi(fv(r, '出欠', [])).map(function (row) { return { value: row.value }; }) }
        });
        if (!rec.顧客No.value) delete rec.顧客No;
        if (!rec.案件No.value) delete rec.案件No;
        if (!rec.ネタNo.value) delete rec.ネタNo;
        if (!rec.先方担当者No.value) delete rec.先方担当者No;
        return rec;
      });
      var newIds = [];
      return chunks(recs, 100).reduce(function (p, part) {
        return p.then(function () {
          return api('/k/v1/records', 'POST', { app: APP_ID, records: part }).then(function (resp) { newIds = newIds.concat(resp.ids); });
        });
      }, kintone.Promise.resolve()).then(function () {
        if (fv(r, '公開区分', '公開') !== '非公開') return null;
        var comps = newIds.map(function (nid, i) { return companionBody(nid, { 開始日時: recs[i].開始日時, 終了日時: recs[i].終了日時, 終日: recs[i].終日, 参加者: { value: fv(r, '参加者', []) }, 公開区分: { value: '非公開' } }); });
        return chunks(comps, 100).reduce(function (p, part) {
          return p.then(function () { return api('/k/v1/records', 'POST', { app: APP_ID, records: part }); });
        }, kintone.Promise.resolve());
      }).then(function () {
        var msg = '繰り返しで、この後に' + newIds.length + '件の予定を作りました。';
        if (newIds.length >= MAX_OCCURRENCES) msg += '(一度に作れるのは' + MAX_OCCURRENCES + '件までです。続きは終了日を延ばして別に登録してください)';
        return { msg: msg };
      });
    });
  }

  // 同じ繰り返しの、この回より後の予定を取得する
  function futureOccurrences(r, fields) {
    var q = '繰り返しID = "' + fv(r, '繰り返しID', '') + '" and 元予定No = "" and 開始日時 > "' + fv(r, '開始日時', '') + '" order by 開始日時 asc';
    return fetchAll(APP_ID, q, fields);
  }

  function updateFutureSeries(id, r) {
    var s = new Date(fv(r, '開始日時', ''));
    var dur = new Date(fv(r, '終了日時', '')).getTime() - s.getTime();
    var shared = sharedFields(r);
    var srcRows = fv(r, '出欠', []);
    return futureOccurrences(r, ['$id', '開始日時', '出欠']).then(function (occs) {
      var updates = occs.filter(function (o) { return fv(o, '$id', '') !== String(id); }).map(function (o) {
        var od = new Date(fv(o, '開始日時', ''));
        // 日付はその回のまま、時刻だけこの回に合わせる
        var ns = new Date(od.getFullYear(), od.getMonth(), od.getDate(), s.getHours(), s.getMinutes());
        // 出欠: その回で回答済みの人は回答を残し、新しい参加者は未回答で追加
        var old = {};
        fv(o, '出欠', []).forEach(function (row) { var u = fv(row.value, '出欠_参加者', [])[0]; if (u) old[u.code] = row; });
        var rows = srcRows.map(function (row) {
          var u = fv(row.value, '出欠_参加者', [])[0];
          return u && old[u.code] ? old[u.code] : { value: row.value };
        });
        var rec = Object.assign({}, shared, {
          開始日時: { value: toKintoneDT(ns) }, 終了日時: { value: toKintoneDT(new Date(ns.getTime() + dur)) },
          出欠: { value: attendanceForApi(rows).map(function (x) { return { value: x.value }; }) }
        });
        if (!rec.顧客No.value) rec.顧客No = { value: '' };
        if (!rec.案件No.value) rec.案件No = { value: '' };
        if (!rec.ネタNo.value) rec.ネタNo = { value: '' };
        if (!rec.先方担当者No.value) rec.先方担当者No = { value: '' };
        return { id: fv(o, '$id', ''), record: rec };
      });
      return chunks(updates, 100).reduce(function (p, part) {
        return p.then(function () { return api('/k/v1/records', 'PUT', { app: APP_ID, records: part }); });
      }, kintone.Promise.resolve()).then(function () {
        return updates.reduce(function (p, u) {
          return p.then(function () { return syncCompanion(u.id, Object.assign({}, u.record, { 参加者: { value: fv(r, '参加者', []) } })); });
        }, kintone.Promise.resolve());
      }).then(function () { return updates.length; });
    });
  }

  // ---------- 案件管理(19)の次回商談日・初回商談日をスケジュールに合わせる ----------
  // 次回商談日 = その案件の、これから先の「予定」(中止・完了・休暇を除く)で一番早い開始日時
  // 初回商談日 = 空のときだけ、その案件の訪問(中止を除く)で一番早い日付を入れる
  function syncDeals(dealNos, excludeId) {
    var uniq = [];
    dealNos.forEach(function (d) { if (d && uniq.indexOf(String(d)) < 0) uniq.push(String(d)); });
    return uniq.reduce(function (p, no) { return p.then(function () { return syncDeal(no, excludeId); }); }, kintone.Promise.resolve());
  }

  function syncDeal(no, excludeId) {
    var ex = excludeId ? ' and $id != ' + excludeId : '';
    var base = '案件No = "' + no + '" and 元予定No = ""' + ex;
    var nextQ = base + ' and 実施状況 in ("予定") and 種類 not in ("休暇") and 開始日時 >= NOW() order by 開始日時 asc limit 1';
    var firstQ = base + ' and 種類 in ("訪問") and 実施状況 not in ("中止") order by 開始日時 asc limit 1';
    return kintone.Promise.all([
      api('/k/v1/records', 'GET', { app: APP_ID, query: nextQ, fields: ['開始日時'] }),
      api('/k/v1/records', 'GET', { app: APP_ID, query: firstQ, fields: ['開始日時'] }),
      api('/k/v1/record', 'GET', { app: DEAL_APP_ID, id: no })
    ]).then(function (res) {
      var deal = res[2].record;
      var upd = {};
      var next = res[0].records[0] ? fv(res[0].records[0], '開始日時', '') : '';
      if (next && next !== fv(deal, '次回商談日', '')) upd.次回商談日 = { value: next };
      var first = res[1].records[0] ? ymd(new Date(fv(res[1].records[0], '開始日時', ''))) : '';
      if (first && !fv(deal, '初回商談日', '')) upd.初回商談日 = { value: first };
      if (!Object.keys(upd).length) return null;
      return api('/k/v1/record', 'PUT', { app: DEAL_APP_ID, id: no, record: upd });
    });
  }

  // ---------- 参加者への通知(レコードのコメントで@メンションする) ----------
  function whenText(r) {
    var s = new Date(fv(r, '開始日時', ''));
    var e = new Date(fv(r, '終了日時', ''));
    var d = (s.getMonth() + 1) + '/' + s.getDate() + '(' + WEEKDAYS[s.getDay()] + ')';
    if (isAllDay(r)) return d + ' 終日' + (ymd(s) !== ymd(e) ? '〜' + (e.getMonth() + 1) + '/' + e.getDate() : '');
    return d + ' ' + hm(s) + '〜' + (ymd(s) !== ymd(e) ? (e.getMonth() + 1) + '/' + e.getDate() + ' ' : '') + hm(e);
  }

  function postComment(id, text, codes) {
    if (!codes.length) return kintone.Promise.resolve();
    return api('/k/v1/record/comment', 'POST', {
      app: APP_ID, record: id,
      comment: { text: text, mentions: codes.map(function (c) { return { code: c, type: 'USER' }; }) }
    });
  }

  function notifyParticipants(id, r, isCreate) {
    var me = kintone.getLoginUser().code;
    var others = participantCodes(r).filter(function (c) { return c !== me; });
    if (!others.length) return kintone.Promise.resolve();
    var info = '件名: ' + fv(r, '件名', '') + '\n日時: ' + whenText(r) +
      (fv(r, '場所', '') ? '\n場所: ' + fv(r, '場所', '') : '') +
      (fv(r, '繰り返しID', '') && isCreate ? '\n繰り返し: ' + fv(r, '繰り返し', '') + '(' + fv(r, '繰り返し終了日', '') + 'まで)' : '');
    if (isCreate) {
      return postComment(id, '予定に招待しました。\n' + info + '\n\n予定を開いて「出欠」のボタンから回答してください。', others);
    }
    if (!prevState) return kintone.Promise.resolve();
    var added = others.filter(function (c) { return prevState.codes.indexOf(c) < 0; });
    var stayed = others.filter(function (c) { return prevState.codes.indexOf(c) >= 0; });
    var p = postComment(id, '予定に招待しました。\n' + info + '\n\n予定を開いて「出欠」のボタンから回答してください。', added);
    var st = fv(r, '実施状況', '予定');
    if (st === '中止' && prevState.status !== '中止') {
      return p.then(function () { return postComment(id, 'この予定は中止になりました。\n' + info, stayed); });
    }
    if (prevState.start !== fv(r, '開始日時', '') || prevState.end !== fv(r, '終了日時', '')) {
      return p.then(function () {
        return postComment(id, '予定の日時が変更されました。\n' + info + (seriesScope === 'future' ? '\n(これより後の繰り返しも同じ時刻に変更)' : ''), stayed);
      });
    }
    return p;
  }

  // ---------- 詳細画面のボタン(出欠の回答・訪問完了→活動履歴) ----------
  function headerSpace() {
    return IS_MOBILE ? kintone.mobile.app.getHeaderSpaceElement() : kintone.app.record.getHeaderMenuSpaceElement();
  }

  function drawDetailActions(event) {
    var old = document.getElementById('sched-detail-actions');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var r = event.record;
    if (isCompanion(r)) return;
    var space = headerSpace();
    if (!space) return;
    var box = el('div', { id: 'sched-detail-actions', className: 'sched-actions', style: IS_MOBILE ? 'padding:0 12px' : '' });
    var id = event.recordId || fv(r, '$id', '');
    var me = kintone.getLoginUser();

    var mine = answerOf(r, me.code);
    if (mine !== null) {
      box.appendChild(el('span', { className: 'lbl' }, '出欠:'));
      ['承諾', '仮承諾', '辞退'].forEach(function (a) {
        var b = el('button', { className: mine === a ? 'on' : '' }, a);
        b.addEventListener('click', function () { answer(id, r, a); });
        box.appendChild(b);
      });
    }

    if (fv(r, '種類', '') === '訪問' || fv(r, '種類', '') === '外出') {
      var actNo = fv(r, '活動履歴No', '');
      var ab = el('button', { className: 'primary' }, actNo ? '活動履歴を開く' : '訪問完了 → 活動履歴を作成');
      ab.addEventListener('click', function () {
        if (actNo) { location.href = IS_MOBILE ? '/k/m/' + ACTIVITY_APP_ID + '/show?record=' + actNo : '/k/' + ACTIVITY_APP_ID + '/show#record=' + actNo; return; }
        createActivity(id, r);
      });
      box.appendChild(ab);
    }
    if (companyOf(r) || fv(r, '場所', '')) {
      var mb = el('button', {}, '📍 地図で開く');
      mb.addEventListener('click', function () {
        visitPlaces([r]).then(function (places) {
          var pl = places[fv(r, '$id', '')] || {};
          var q = pl.lat ? pl.lat + ',' + pl.lng : (pl.address || fv(r, '場所', '') || companyOf(r));
          window.open('https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q), '_blank');
        });
      });
      box.appendChild(mb);
    }
    var del = el('button', { style: 'color:#b91c1c;border-color:#fca5a5' }, '🗑 削除');
    del.addEventListener('click', function () { deleteFromButton(id, r); });
    box.appendChild(del);
    if (box.children.length) space.appendChild(box);
  }

  function answer(id, r, value) {
    var comment = prompt('「' + value + '」で回答します。主催者へのひとこと(空欄でも可):', '');
    if (comment === null) return;
    var me = kintone.getLoginUser();
    var applyFuture = fv(r, '繰り返しID', '') ? confirm('この後の繰り返し予定にも同じ回答をしますか？\n\nOK: この後もすべて「' + value + '」\nキャンセル: この回だけ') : false;

    function updateOne(recId) {
      return api('/k/v1/record', 'GET', { app: APP_ID, id: recId }).then(function (resp) {
        var rows = fv(resp.record, '出欠', []);
        rows.forEach(function (row) {
          var u = fv(row.value, '出欠_参加者', [])[0];
          if (u && u.code === me.code) {
            row.value.出欠_回答.value = value;
            row.value.出欠_コメント.value = comment;
          }
        });
        return api('/k/v1/record', 'PUT', { app: APP_ID, id: recId, record: { 出欠: { value: attendanceForApi(rows) } } });
      });
    }

    var p = updateOne(id);
    if (applyFuture) {
      p = p.then(function () { return futureOccurrences(r, ['$id']); }).then(function (occs) {
        return occs.reduce(function (q, o) { return q.then(function () { return updateOne(fv(o, '$id', '')); }); }, kintone.Promise.resolve());
      });
    }
    p.then(function () {
      var organizer = fv(r, '作成者', {}).code;
      if (!organizer || organizer === me.code) return null;
      return postComment(id, me.name + 'さんが「' + value + '」と回答しました。' + (applyFuture ? '(この後の繰り返しも同じ)' : '') + (comment ? '\n' + comment : ''), [organizer]);
    }).then(function () { location.reload(); })
      .catch(function (err) { alert('回答を保存できませんでした。' + (err && err.message ? '\n' + err.message : '')); });
  }

  // 訪問の予定から活動履歴(app17)を作り、予定を「完了」にして、活動履歴の編集画面を開く
  function createActivity(id, r) {
    var dealNo = fv(r, '案件No', '');
    var ask = dealNo ? askDealUpdate(dealNo) : kintone.Promise.resolve(
      confirm('この予定を「完了」にして、活動履歴を作成します。よろしいですか？\n(作成後、活動履歴の画面で報告内容を書いてください)') ? {} : null);
    ask.then(function (choice) {
      if (!choice) return;
      var upd = {};
      if (choice.phase) upd.商談フェーズ = { value: choice.phase };
      if (choice.kakudo) upd.確度 = { value: choice.kakudo };
      var p = Object.keys(upd).length ? api('/k/v1/record', 'PUT', { app: DEAL_APP_ID, id: dealNo, record: upd }) : kintone.Promise.resolve();
      p.then(function () { doCreateActivity(id, r); }).catch(function (err) {
        alert('案件の更新に失敗しました。' + (err && err.message ? '\n' + err.message : ''));
      });
    });
  }

  // 案件の商談フェーズ・確度を選ぶ画面。OKなら {phase, kakudo}、キャンセルなら null
  function askDealUpdate(dealNo) {
    return kintone.Promise.all([
      api('/k/v1/record', 'GET', { app: DEAL_APP_ID, id: dealNo }),
      api('/k/v1/app/form/fields', 'GET', { app: DEAL_APP_ID })
    ]).then(function (res) {
      var deal = res[0].record;
      var props = res[1].properties;
      function optionsOf(code) {
        var o = props[code] && props[code].options ? props[code].options : {};
        return Object.keys(o).sort(function (a, b) { return o[a].index - o[b].index; });
      }
      return new kintone.Promise(function (resolve) {
        var bg = el('div', { className: 'sched-modal-bg' });
        var m = el('div', { className: 'sched-modal', style: 'max-width:420px' });
        m.appendChild(el('h3', {}, '訪問完了 → 活動履歴を作成'));
        m.appendChild(el('div', {}, '案件「' + fv(deal, '案件名', '') + '」(' + fv(deal, '会社名', '') + ')の状況も更新できます。'));
        function sel(code, label) {
          m.appendChild(el('label', {}, label));
          var s = el('select');
          optionsOf(code).forEach(function (v) { var o = el('option', { value: v }, v); if (v === fv(deal, code, '')) o.selected = true; s.appendChild(o); });
          m.appendChild(s);
          return s;
        }
        var phase = sel('商談フェーズ', '商談フェーズ');
        var kakudo = sel('確度', '確度');
        var btns = el('div', { className: 'btns' });
        var cancel = el('button', {}, 'キャンセル');
        var ok = el('button', { className: 'primary' }, '完了にして活動履歴を作成');
        btns.appendChild(cancel);
        btns.appendChild(ok);
        m.appendChild(btns);
        bg.appendChild(m);
        document.body.appendChild(bg);
        function close(v) { document.body.removeChild(bg); resolve(v); }
        cancel.addEventListener('click', function () { close(null); });
        ok.addEventListener('click', function () {
          close({ phase: phase.value !== fv(deal, '商談フェーズ', '') ? phase.value : '', kakudo: kakudo.value !== fv(deal, '確度', '') ? kakudo.value : '' });
        });
      });
    });
  }

  function doCreateActivity(id, r) {
    var me = kintone.getLoginUser();
    var custNo = fv(r, '顧客No', '');
    var kindP;
    if (fv(r, '種類', '') !== '訪問' || !custNo) kindP = kintone.Promise.resolve('その他');
    else {
      kindP = api('/k/v1/records', 'GET', {
        app: ACTIVITY_APP_ID, fields: ['$id'],
        query: '顧客No = "' + custNo + '" and 対応種別 in ("商談（初回）", "商談（2回目以降）") limit 1'
      }).then(function (resp) { return resp.records.length ? '商談（2回目以降）' : '商談（初回）'; });
    }
    kindP.then(function (kind) {
      // 予定の内容のうち、自動で入れた裏方の文言は報告に写さない
      var body = fv(r, '内容', '').replace(/\(案件管理の次回商談日から自動作成\)/g, '').trim();
      // 件名は「種類: 会社名」の短い形にする(予定の件名は「商談: 会社名 / 案件名」のように長いことがあるため)
      var title = companyOf(r) ? fv(r, '種類', '訪問') + ': ' + companyOf(r) : fv(r, '件名', '');
      var rec = {
        タイトル: { value: title },
        対応日付: { value: ymd(new Date(fv(r, '開始日時', ''))) },
        対応者: { value: [{ code: me.code }] },
        対応種別: { value: kind },
        内容: { value: (!fv(r, '会社名', '') && fv(r, 'ネタ会社名', '') ? '訪問先: ' + fv(r, 'ネタ会社名', '') + '(ネタNo.' + fv(r, 'ネタNo', '') + '、顧客未登録)\n' : '') +
          (body ? body + '\n\n' : '') + '(スケジュールNo.' + id + ' から作成)' }
      };
      if (fv(r, '会社名', '')) rec.会社名 = { value: fv(r, '会社名', '') };
      if (fv(r, '案件名', '')) rec.案件名 = { value: fv(r, '案件名', '') };
      return api('/k/v1/record', 'POST', { app: ACTIVITY_APP_ID, record: rec });
    }).then(function (resp) {
      var actId = resp.id;
      return api('/k/v1/record', 'PUT', { app: APP_ID, id: id, record: { 実施状況: { value: '完了' }, 活動履歴No: { value: String(actId) } } })
        .then(function () { return syncDeals([fv(r, '案件No', '')]).catch(function () { return null; }); })
        .then(function () { return actId; });
    }).then(function (actId) {
      location.href = IS_MOBILE ? '/k/m/' + ACTIVITY_APP_ID + '/show?record=' + actId : '/k/' + ACTIVITY_APP_ID + '/show#record=' + actId + '&mode=edit';
    }).catch(function (err) {
      alert('活動履歴を作成できませんでした。' + (err && err.message ? '\n' + err.message : ''));
    });
  }

  // ---------- 訪問先の場所と訪問ルート地図 ----------
  var CUSTOMER_APP_ID = 18;
  var LEAD_APP_ID = 29;

  // 予定ごとの {lat, lng, address}。顧客は顧客管理、ネタはネタリストの緯度経度・住所を使う
  function visitPlaces(recs) {
    var custNos = [], netaNos = [];
    recs.forEach(function (r) {
      if (fv(r, '顧客No', '')) custNos.push(fv(r, '顧客No', ''));
      else if (fv(r, 'ネタNo', '')) netaNos.push(fv(r, 'ネタNo', ''));
    });
    var cq = custNos.length ? fetchAll(CUSTOMER_APP_ID, '顧客No in (' + custNos.join(',') + ')', ['顧客No', '緯度', '経度', '都道府県', '住所', '建物名']) : kintone.Promise.resolve([]);
    var nq = netaNos.length ? fetchAll(LEAD_APP_ID, 'レコード番号 in (' + netaNos.join(',') + ')', ['レコード番号', '緯度', '経度', '都道府県', '市区町村', '丁目番地等']) : kintone.Promise.resolve([]);
    return kintone.Promise.all([cq, nq]).then(function (res) {
      var cust = {}, neta = {};
      res[0].forEach(function (c) { cust[fv(c, '顧客No', '')] = { lat: fv(c, '緯度', ''), lng: fv(c, '経度', ''), address: fv(c, '都道府県', '') + fv(c, '住所', '') + fv(c, '建物名', '') }; });
      res[1].forEach(function (n) { neta[fv(n, 'レコード番号', '')] = { lat: fv(n, '緯度', ''), lng: fv(n, '経度', ''), address: fv(n, '都道府県', '') + fv(n, '市区町村', '') + fv(n, '丁目番地等', '') }; });
      var out = {};
      recs.forEach(function (r) {
        var pl = fv(r, '顧客No', '') ? cust[fv(r, '顧客No', '')] : (fv(r, 'ネタNo', '') ? neta[fv(r, 'ネタNo', '')] : null);
        out[fv(r, '$id', '')] = pl || { lat: '', lng: '', address: '' };
      });
      return out;
    }).catch(function () { return {}; });
  }

  var leafletLoading = null;
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

  // その日の訪問・外出(中止を除く)を、人ごとに時間順の番号付きで地図に出す
  function showRoute(day, people) {
    var bg = el('div', { className: 'sched-modal-bg' });
    var m = el('div', { className: 'sched-modal' + (IS_MOBILE ? ' sched-m' : '') });
    var head = el('div', { style: 'display:flex;justify-content:space-between;align-items:center' });
    head.appendChild(el('h3', {}, (day.getMonth() + 1) + '/' + day.getDate() + '(' + WEEKDAYS[day.getDay()] + ') の訪問ルート'));
    var x = el('button', { style: 'border:none;background:none;font-size:20px;cursor:pointer' }, '×');
    head.appendChild(x);
    m.appendChild(head);
    var mapEl = el('div', { className: 'sched-route-map' });
    var list = el('div', { className: 'sched-route-list' }, '読み込み中…');
    m.appendChild(mapEl);
    m.appendChild(list);
    bg.appendChild(m);
    document.body.appendChild(bg);
    x.addEventListener('click', function () { document.body.removeChild(bg); });
    bg.addEventListener('click', function (e) { if (e.target === bg) document.body.removeChild(bg); });

    var codes = people.map(function (p) { return p.code; });
    kintone.Promise.all([loadLeaflet(), fetchEvents(day, addDays(day, 1))]).then(function (res) {
      var recs = res[1].filter(function (r) {
        return !isCompanion(r) && (fv(r, '種類', '') === '訪問' || fv(r, '種類', '') === '外出') && fv(r, '実施状況', '予定') !== '中止' &&
          participantCodes(r).some(function (c) { return codes.indexOf(c) >= 0; });
      });
      return visitPlaces(recs).then(function (places) { return { recs: recs, places: places }; });
    }).then(function (d) {
      list.innerHTML = '';
      var map = L.map(mapEl).setView([43.0621, 141.3544], 11);
      L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png', {
        maxZoom: 18, attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">国土地理院</a>'
      }).addTo(map);
      var bounds = [];
      if (!d.recs.length) list.textContent = 'この日の訪問・外出の予定はありません。';
      people.forEach(function (p) {
        var mine = d.recs.filter(function (r) { return participantCodes(r).indexOf(p.code) >= 0; })
          .sort(function (a, b) { return new Date(fv(a, '開始日時', '')) - new Date(fv(b, '開始日時', '')); });
        if (!mine.length) return;
        var who = el('div', { className: 'who' });
        who.appendChild(el('span', { style: 'color:' + p.color }, '● ' + p.name + '(' + mine.length + '件)'));
        list.appendChild(who);
        var line = [], stops = [];
        var used = {};  // 同じ場所に複数回行くとピンが重なるので、2つ目以降を少しずらす
        var ul = el('ul', { style: 'margin:0;padding:0;list-style:none' });
        mine.forEach(function (r, i) {
          var pl = d.places[fv(r, '$id', '')] || {};
          var s = new Date(fv(r, '開始日時', ''));
          var li = el('li');
          li.appendChild(el('b', {}, (i + 1) + '. '));
          li.appendChild(document.createTextNode((isAllDay(r) ? '終日' : hm(s)) + ' ' + (companyOf(r) || fv(r, '件名', '')) + ' '));
          if (pl.lat && pl.lng) {
            var ll = [Number(pl.lat), Number(pl.lng)];
            line.push(ll); bounds.push(ll); stops.push(pl.lat + ',' + pl.lng);
            var key = pl.lat + ',' + pl.lng;
            var n = used[key] = (used[key] || 0) + 1;
            var pin = n === 1 ? ll : [ll[0] - 0.00025 * (n - 1), ll[1] + 0.00035 * (n - 1)];
            var icon = L.divIcon({ className: '', html: '<div class="sched-pin" style="background:' + p.color + '">' + (i + 1) + '</div>', iconSize: [24, 24], iconAnchor: [12, 12] });
            L.marker(pin, { icon: icon }).addTo(map).bindPopup((i + 1) + '. ' + hm(s) + ' ' + (companyOf(r) || '').replace(/[<>&"]/g, ''));
          } else {
            li.appendChild(el('span', { style: 'color:#dc2626' }, '(位置情報なし)'));
            if (pl.address) stops.push(pl.address);
          }
          ul.appendChild(li);
        });
        if (line.length > 1) L.polyline(line, { color: p.color, weight: 3, opacity: .7 }).addTo(map);
        if (stops.length) {
          // Googleマップの経路案内(出発地は現在地)
          var url = 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(stops[stops.length - 1]) +
            (stops.length > 1 ? '&waypoints=' + encodeURIComponent(stops.slice(0, -1).join('|')) : '') + '&travelmode=driving';
          var a = el('a', { href: url, target: '_blank' }, 'Googleマップで経路を開く');
          who.appendChild(a);
        }
        list.appendChild(ul);
      });
      if (bounds.length) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
      setTimeout(function () { map.invalidateSize(); }, 50);
    }).catch(function (err) {
      list.textContent = '地図を表示できませんでした。' + (err && err.message ? err.message : '');
    });
  }

  // ---------- 削除 ----------
  var SERIES_DELETE_MSG = 'この予定は繰り返し予定です。\n\nOK: この後の繰り返しもまとめて削除する\nキャンセル: この回だけ削除する';

  // この予定と一緒に消すレコード: その「予定あり」、(withFuture なら)この後の繰り返しとその「予定あり」
  function relatedIds(id, r, withFuture) {
    var p = withFuture ? futureOccurrences(r, ['$id']).then(function (occs) {
      return occs.map(function (o) { return fv(o, '$id', ''); }).filter(function (x) { return x !== String(id); });
    }) : kintone.Promise.resolve([]);
    return p.then(function (future) {
      var origs = [String(id)].concat(future);
      return fetchAll(APP_ID, '元予定No in (' + origs.join(',') + ')', ['$id']).then(function (comps) {
        return { future: future, comps: comps.map(function (c) { return fv(c, '$id', ''); }) };
      });
    });
  }

  function deleteIds(ids) {
    return chunks(ids, 100).reduce(function (q, part) {
      return q.then(function () { return api('/k/v1/records', 'DELETE', { app: APP_ID, ids: part }); });
    }, kintone.Promise.resolve());
  }

  // 詳細画面の「削除」ボタン
  function deleteFromButton(id, r) {
    var withFuture = false;
    if (fv(r, '繰り返しID', '')) withFuture = confirm(SERIES_DELETE_MSG);
    else if (!confirm('この予定「' + fv(r, '件名', '') + '」を削除します。よろしいですか？')) return;
    relatedIds(id, r, withFuture).then(function (rel) {
      return deleteIds([String(id)].concat(rel.future, rel.comps));
    }).then(function () {
      return syncDeals([fv(r, '案件No', '')]).catch(function () { return null; });
    }).then(function () {
      location.href = IS_MOBILE ? '/k/m/' + APP_ID + '/' : '/k/' + APP_ID + '/';
    }).catch(function (err) {
      alert('削除できませんでした。' + (err && err.message ? '\n' + err.message : ''));
    });
  }

  // kintone標準の削除(「…」メニュー・一覧の×)でも、一緒に消すべきレコードを消す
  kintone.events.on(['app.record.detail.delete.submit', 'app.record.index.delete.submit',
    'mobile.app.record.detail.delete.submit'], function (event) {
    var r = event.record;
    if (isCompanion(r)) return event;
    var id = fv(r, '$id', '') || event.recordId;
    var withFuture = !!fv(r, '繰り返しID', '') && event.type.indexOf('index') < 0 && confirm(SERIES_DELETE_MSG);
    return relatedIds(id, r, withFuture).then(function (rel) {
      return deleteIds(rel.future.concat(rel.comps));
    }).then(function () {
      return syncDeals([fv(r, '案件No', '')], id).catch(function () { return null; });
    }).then(function () { return event; }).catch(function () { return event; });
  });
})();
