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

  var EVENT_FIELDS = ['$id', '件名', '種類', '終日', '開始日時', '終了日時', '参加者', '場所', '会社名', '案件名', '公開区分', '元予定No'];

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
      var body = {
        件名: { value: '予定あり' }, 種類: { value: 'その他' },
        開始日時: { value: fv(rec, '開始日時', null) }, 終了日時: { value: fv(rec, '終了日時', null) },
        終日: { value: fv(rec, '終日', []) },
        参加者: { value: fv(rec, '参加者', []).map(function (u) { return { code: u.code }; }) },
        公開区分: { value: '公開' }, 元予定No: { value: String(id) }
      };
      if (compId) return kintone.api(kintone.api.url('/k/v1/record', true), 'PUT', { app: APP_ID, id: compId, record: body });
      return kintone.api(kintone.api.url('/k/v1/record', true), 'POST', { app: APP_ID, record: body });
    });
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
      '@media (max-width:700px){.sched-wrap{padding:8px}.sched-grid th.member{width:80px}.sched-ol{display:block}.sched-side{width:auto;border:none;padding:0}.sched-panels{flex-direction:column}.sched-panel{min-width:0}}'
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
      if (!isCompanion(r) && fv(r, '会社名', '')) title += ' / ' + fv(r, '会社名', '');
      if (showNames) title = '[' + fv(r, '参加者', []).map(function (u) { return u.name; }).join('・') + '] ' + title;
      evs.push({
        id: fv(r, '$id', ''), title: title, allDay: allDay,
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

    var wrap = el('div', { className: 'sched-wrap' });
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
    [todayBtn, prevBtn, nextBtn, title, views, newBtn].forEach(function (x) { bar.appendChild(x); });
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
    var wrap = el('div', { className: 'sched-wrap' });
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
              var name = isCompanion(r) ? '予定あり' : (fv(r, '公開区分', '') === '非公開' ? '🔒' : '') + fv(r, '件名', '');
              var extra = !isCompanion(r) && fv(r, '会社名', '') ? ' / ' + fv(r, '会社名', '') : '';
              var chip = el('span', { className: 'sched-chip', style: '--c:' + TYPE_COLORS[typeOf(r)], title: label + ' ' + name + extra });
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
    // スマホでカスタマイズビューのHTMLが出ない場合はヘッダーに描画する
    if (IS_MOBILE && !calRoot && !groupRoot) {
      var space = kintone.mobile.app.getHeaderSpaceElement();
      var old = document.getElementById('sched-mobile-root');
      if (old && old.parentNode) old.parentNode.removeChild(old);
      if (space && (event.viewName === 'カレンダー' || event.viewName === 'メンバー週表示')) {
        var holder = el('div', { id: 'sched-mobile-root' });
        space.appendChild(holder);
        if (event.viewName === 'カレンダー') calRoot = holder; else groupRoot = holder;
      }
    }
    if (calRoot) renderCalendar(calRoot);
    if (groupRoot) renderGroup(groupRoot);
    return event;
  });

  // ---------- 入力画面 ----------
  var duration = 3600000;

  function setShown(code, shown) {
    if (IS_MOBILE) kintone.mobile.app.record.setFieldShown(code, shown);
    else kintone.app.record.setFieldShown(code, shown);
  }

  kintone.events.on(['app.record.create.show', 'mobile.app.record.create.show'], function (event) {
    detectEnv(event);
    var r = event.record;
    r.元予定No.value = ''; // 再利用で「予定あり」をコピーした場合に備えて必ず空にする
    var raw = null;
    try { raw = sessionStorage.getItem(PREFILL_KEY); sessionStorage.removeItem(PREFILL_KEY); } catch (e) { raw = null; }
    if (raw) {
      var p = JSON.parse(raw);
      r.開始日時.value = p.start;
      r.終了日時.value = p.end;
      r.終日.value = p.allDay ? ['終日'] : [];
      if (p.user && p.user.code) r.参加者.value = [{ code: p.user.code, name: p.user.name }];
    } else if (!r.開始日時.value) {
      var s = new Date(); s.setMinutes(0, 0, 0); s.setHours(s.getHours() + 1);
      r.開始日時.value = toKintoneDT(s);
      r.終了日時.value = toKintoneDT(new Date(s.getTime() + 3600000));
    }
    rememberDuration(r);
    setShown('元予定No', false);
    r.元予定No.disabled = true;
    return event;
  });

  kintone.events.on(['app.record.edit.show', 'mobile.app.record.edit.show'], function (event) {
    detectEnv(event);
    rememberDuration(event.record);
    setShown('元予定No', !!fv(event.record, '元予定No', ''));
    event.record.元予定No.disabled = true;
    return event;
  });

  kintone.events.on(['app.record.detail.show', 'mobile.app.record.detail.show'], function (event) {
    detectEnv(event);
    setShown('元予定No', !!fv(event.record, '元予定No', ''));
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
    kintone.api(kintone.api.url('/k/v1/record', true), 'GET', { app: DEAL_APP_ID, id: dealNo }).then(function (resp) {
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

  kintone.events.on(['app.record.create.submit', 'app.record.edit.submit',
    'mobile.app.record.create.submit', 'mobile.app.record.edit.submit'], function (event) {
    var r = event.record;
    var s = Date.parse(fv(r, '開始日時', ''));
    var e = Date.parse(fv(r, '終了日時', ''));
    if (!isNaN(s) && !isNaN(e) && e < s) {
      r.終了日時.error = '終了は開始より後の日時にしてください';
      event.error = '終了日時を確認してください';
    }
    return event;
  });

  kintone.events.on(['app.record.create.submit.success', 'app.record.edit.submit.success',
    'mobile.app.record.create.submit.success', 'mobile.app.record.edit.submit.success'], function (event) {
    if (isCompanion(event.record)) return event;
    var id = event.recordId || fv(event.record, '$id', '');
    return syncCompanion(id, event.record).then(function () { return event; }).catch(function (err) {
      alert('予定は保存しましたが、非公開予定の「予定あり」表示を更新できませんでした。' + (err && err.message ? '\n' + err.message : ''));
      return event;
    });
  });

  kintone.events.on(['app.record.detail.delete.submit', 'app.record.index.delete.submit',
    'mobile.app.record.detail.delete.submit'], function (event) {
    if (isCompanion(event.record)) return event;
    return deleteCompanion(fv(event.record, '$id', '')).then(function () { return event; }).catch(function () { return event; });
  });
})();
