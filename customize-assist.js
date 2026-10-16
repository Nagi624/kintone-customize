/*
 * 🧭 アシスト  顧客管理18・案件管理19・ネタリスト29  PC/スマホ両対応(2026-10-16)
 * (活動履歴17は2026-10-17に確認用(直接入力しない)にしたので対象から外した)
 *
 * アプリの使い方に慣れていない人向けに、レコードの画面右下に小窓を出して
 *   ⚠ 足りない情報(空だと困る欄と、その理由)
 *   👉 次にやること(このレコードの状況から、次に押すボタン・登録するもの)
 * を案内する。案内だけで、保存は止めない(ユーザー判断 2026-10-16)。
 * - 作成・編集画面: 入力中の値を1.5秒ごとに読み直して、足りない情報を出し直す
 * - 詳細画面: 関連アプリ(案件・見積書・請求・活動履歴・担当者)も見て、次にやることを出す
 * - オン/オフは本人だけが切り替える。設定はアシスト設定(app43)に1人1件で保存(PC・スマホ・iPadで同じ)。
 *   レコードが無い人はオン。小窓の「オフ」で消え、右下の小さな「🧭」を押すとオンに戻る。
 *   「たたむ」は見出しだけにする(このタブの間だけ覚える)。
 * - 判断のルールはアプリごとの rules の中。項目を増やすときはそこに足す。
 */
(function () {
  'use strict';

  var SETTINGS_APP_ID = 43;
  var APP = { activity: 17, customer: 18, deal: 19, lead: 29, contact: 20, quote: 16, billing: 21, schedule: 34 };
  var TARGETS = [APP.customer, APP.deal, APP.lead];
  var BOX_ID = 'assist-box';
  var CACHE_KEY = 'assist-setting';
  var FOLD_KEY = 'assist-folded';
  var ACTIVE = ['商談予定', '提案中', '内示'];

  var IS_MOBILE = false;
  var timer = null;
  var lastKey = '';
  var setting = null; // {on: bool, id: レコード番号 or ''}

  function fv(obj, code, fallback) {
    return obj && obj[code] && obj[code].value !== undefined && obj[code].value !== null ? obj[code].value : fallback;
  }
  function api(path, method, params) { return kintone.api(kintone.api.url(path, true), method, params); }
  function recApi() { return IS_MOBILE ? kintone.mobile.app.record : kintone.app.record; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function today() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function md(s) { if (!s) return ''; var d = new Date(s.length <= 10 ? s + 'T00:00:00' : s); return (d.getMonth() + 1) + '/' + d.getDate(); }
  function digits(s) { return String(s || '').replace(/\D/g, ''); }
  function esc(s) {
    return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function count(app, query) {
    return api('/k/v1/records', 'GET', { app: app, query: query + ' limit 1', fields: ['$id'], totalCount: true })
      .then(function (r) { return Number(r.totalCount); }).catch(function () { return null; }); // 見られないアプリは分からない扱い
  }
  function first(app, query, fields) {
    return api('/k/v1/records', 'GET', { app: app, query: query + ' limit 1', fields: fields })
      .then(function (r) { return r.records[0] || null; }).catch(function () { return null; });
  }

  // ---------- ルール ----------
  // sync(r, mode): 画面の値だけで分かること。mode = 'detail' | 'edit'
  // more(r, id): 詳細画面で関連アプリを見て分かること(Promise)
  // どちらも {miss: [文], next: [文]} を返す。文は esc 済みのHTML
  var rules = {};

  rules[APP.customer] = {
    sync: function (r) {
      var miss = [], next = [];
      if (!fv(r, '電話番号', '')) miss.push('<b>電話番号</b> — 「📞 電話を記録」やスマホからの発信に使います');
      if (!fv(r, '住所', '')) miss.push('<b>住所</b> — 無いと地図・飛び込みリストに出ません');
      if (!fv(r, '大分類', '')) miss.push('<b>大分類(業種)</b> — 業種別のグラフ・架電リストの学習に使います');
      if (fv(r, '顧客ランク', '') === 'D' && /仮置き|仮の/.test(fv(r, '顧客情報メモ欄', ''))) miss.push('<b>顧客ランク</b>が仮の「D」のまま — 取引の見込みに合わせて直してください');
      var nc = fv(r, '次回連絡日', '');
      if (nc && nc <= today()) next.push('次回連絡日(' + md(nc) + ')になりました。電話して「📞 電話を記録」で残しましょう');
      return { miss: miss, next: next };
    },
    more: function (r, id) {
      return Promise.all([
        first(APP.activity, '顧客No = "' + id + '" order by 対応日付 desc, $id desc', ['対応日付', 'コール業務', '対応種別']),
        api('/k/v1/records', 'GET', { app: APP.deal, query: '顧客No_ = "' + id + '" and 商談フェーズ not in ("受注", "失注", "保留/中止") limit 20', fields: ['$id', '提案商品', '次回商談日'] })
          .then(function (x) { return x.records; }).catch(function () { return null; }),
        count(APP.contact, '顧客No_ = "' + id + '"')
      ]).then(function (res) {
        var last = res[0], open = res[1], contacts = res[2], next = [];
        if (!last) next.push('やりとりの記録がまだありません。電話したら上の「📞 電話を記録」、訪問したら「🚶 訪問を記録」で残しましょう');
        if (open) {
          open.forEach(function (d) {
            if (!fv(d, '次回商談日', '')) next.push('案件「' + esc(fv(d, '提案商品', '') || 'No.' + d.$id.value) + '」の次回商談日が未定です。「💼 案件を作る・進める」で入れるとスケジュールにも入ります');
          });
          if (!open.length && last && fv(last, 'コール業務', '') === 'アポ獲得') next.push('アポ獲得の記録がありますが、進行中の案件がありません。「💼 案件を作る・進める」で案件を作りましょう');
          if (open.length && contacts === 0) next.push('先方の担当者が未登録です。名刺があれば「名刺読み取りボックス」、無ければ上の「担当者を登録する」から');
        }
        if (last && ['担当不在', 'ネタ', 'コールのみ'].indexOf(fv(last, 'コール業務', '')) >= 0 && !fv(r, '次回連絡日', '')) {
          next.push('前回の電話は「' + esc(fv(last, 'コール業務', '')) + '」でした。次回連絡日を決めておくと「📞 今日かけ直す顧客」に出ます');
        }
        return { miss: [], next: next };
      });
    }
  };

  rules[APP.deal] = {
    sync: function (r, mode) {
      var miss = [], next = [];
      var ph = fv(r, '商談フェーズ', ''), active = ACTIVE.indexOf(ph) >= 0, nx = fv(r, '次回商談日', '');
      if (!fv(r, '会社名', '')) miss.push('<b>会社名</b> — 「取得」で顧客を選んでください');
      if (!fv(r, '提案商品', '')) miss.push('<b>提案商品</b> — 案件名(会社名/提案商品)とグラフに使います');
      if (!ph) miss.push('<b>商談フェーズ</b> — 今どの段階かを選んでください');
      if (active && !nx) miss.push('<b>次回商談日</b> — 入れて保存するとスケジュールに予定が入ります');
      if (active && !fv(r, '商談担当者', []).length) miss.push('<b>商談担当者</b> — 商談に行く人(予定表に入る人)です。アポを取った人も入れるとお互い確認できます');
      if ((ph === '提案中' || ph === '内示') && !fv(r, '確度', '')) miss.push('<b>確度</b> — 着地見込みのグラフに使います');
      if (['提案中', '内示', '受注'].indexOf(ph) >= 0 && !fv(r, '受注予定日', '')) miss.push('<b>受注予定日</b> — 月度ごとの売上グラフに使います(受注したら受注した日)');
      if (['提案中', '内示', '受注'].indexOf(ph) >= 0 && !(Number(fv(r, '売上', 0)) > 0)) miss.push('<b>売上</b> — ' + (ph === '受注' ? '確定の金額を入れてください。日報・週報の受注金額になります' : '見込みの金額を入れてください'));
      if (ph && !fv(r, 'アポ獲得者', []).length) miss.push('<b>アポ獲得者</b> — アポを取った人(グラフ・営業道場の段位に使います)');
      if (ph === '受注' && !fv(r, '契約書_申込書', []).length) miss.push('<b>契約書/申込書</b>の添付');
      if (mode === 'detail') {
        if (active && nx && new Date(nx) < new Date()) next.push('次回商談日(' + md(nx) + ')を過ぎています。終わったらスケジュールの予定の「✅ 訪問完了」(顧客管理の「🚶 訪問を記録」でも同じ)、延期なら日時を直しましょう');
        if (ph === '内示') next.push('受注が決まったら商談フェーズを「受注」にして、売上を確定の金額に直しましょう');
        if (ph === '失注' && !fv(r, '詳細', '')) next.push('断られた理由を「詳細」に残しておくと、次の営業に活かせます');
      }
      return { miss: miss, next: next };
    },
    more: function (r, id) {
      var ph = fv(r, '商談フェーズ', '');
      return Promise.all([
        ph === '提案中' || ph === '内示' || ph === '受注' ? count(APP.quote, '案件No = "' + id + '"') : Promise.resolve(null),
        ph === '受注' ? count(APP.billing, '案件No = "' + id + '"') : Promise.resolve(null),
        ph === '商談予定' || ph === '提案中' ? count(APP.activity, '案件No = "' + id + '"') : Promise.resolve(null)
      ]).then(function (res) {
        var next = [];
        if (res[0] === 0) next.push('見積書がまだありません。上の「📄 見積書を作成」から作ると案件が入った状態で始められます');
        if (res[1] === 0) next.push('請求・入金管理にまだ登録がありません。経理に請求の登録を依頼しましょう(見積書番号から作れます)');
        if (res[2] === 0 && ph === '提案中') next.push('この案件の活動履歴がありません。商談の内容を残しておきましょう(予定の「✅ 訪問完了」か、顧客管理の「🚶 訪問を記録」)');
        return { miss: [], next: next };
      });
    }
  };

  rules[APP.lead] = {
    sync: function (r, mode) {
      var miss = [], next = [];
      if (digits(fv(r, '電話番号', '')).length < 9) miss.push('<b>電話番号</b> — 無いと毎朝の「📞 今日の架電リスト」に載りません');
      if (!fv(r, '市区町村', '') && !fv(r, '丁目番地等', '')) miss.push('<b>住所</b> — 地図・飛び込みリストに使います');
      if (!fv(r, '大分類', '')) miss.push('<b>大分類(業種)</b> — 架電リストの点数(業種ごとの成功率)に使います');
      var rows = fv(r, '架電履歴', []).filter(function (row) { return fv(row.value, '履歴結果', '') || fv(row.value, '履歴メモ', ''); });
      var blank = rows.filter(function (row) { return !fv(row.value, '履歴結果', ''); }).length;
      if (blank) miss.push('架電履歴に<b>結果が空の行</b>が' + blank + '行あります');
      var last = rows.length ? fv(rows[rows.length - 1].value, '履歴結果', '') : '';
      var nc = fv(r, '次回架電予定日', '');
      if (mode === 'detail') {
        if (!rows.length) next.push('電話・飛び込みをしたら、上の「📞 架電を記録」「🚶 訪問を記録」で残しましょう');
        if (last === '獲得') next.push('アポ獲得です。「📅 アポを予定に登録」のあと「顧客管理へ登録」で顧客と履歴を移しましょう');
        if (['ネタ', '不通・不在', '架電済み'].indexOf(last) >= 0 && !nc) next.push('前回は「' + esc(last) + '」でした。次回架電予定日を入れると、その日の架電リストで優先されます');
        if (nc && nc <= today() && last !== '獲得' && last !== '失注') next.push('かけ直しの日(' + md(nc) + ')になりました');
      }
      return { miss: miss, next: next };
    }
  };

  // ---------- 設定(アシスト設定 app43、1人1件) ----------
  function loadSetting() {
    if (setting) return Promise.resolve(setting);
    try {
      var c = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
      if (c) { setting = c; return Promise.resolve(setting); }
    } catch (e) { /* 読めなければ取り直す */ }
    return api('/k/v1/records', 'GET', { app: SETTINGS_APP_ID, query: '利用者 in (LOGINUSER()) order by $id asc limit 1', fields: ['$id', 'アシスト'] })
      .then(function (r) {
        var x = r.records[0];
        setting = { on: !x || fv(x, 'アシスト', 'オン') !== 'オフ', id: x ? x.$id.value : '' };
        return setting;
      }).catch(function () { setting = { on: true, id: '' }; return setting; }) // 設定を読めなくてもオンで使える
      .then(function (s) { try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(s)); } catch (e) { /* 保存できなくてよい */ } return s; });
  }

  function saveSetting(on) {
    var val = { アシスト: { value: on ? 'オン' : 'オフ' } };
    var p = setting && setting.id
      ? api('/k/v1/record', 'PUT', { app: SETTINGS_APP_ID, id: setting.id, record: val }).then(function () { return setting.id; })
      : api('/k/v1/record', 'POST', { app: SETTINGS_APP_ID, record: val }).then(function (r) { return r.id; });
    return p.then(function (id) {
      setting = { on: on, id: id };
      try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(setting)); } catch (e) { /* 保存できなくてよい */ }
    });
  }

  // ---------- 小窓 ----------
  function injectStyle() {
    if (document.getElementById('assist-style')) return;
    var s = document.createElement('style');
    s.id = 'assist-style';
    s.textContent = [
      '#assist-box{position:fixed;right:16px;bottom:16px;z-index:9000;width:340px;max-width:calc(100vw - 24px);font-size:13px;color:#1e293b;font-family:inherit}',
      '#assist-box .as-card{background:#fff;border:1px solid #c7d2fe;border-radius:10px;box-shadow:0 6px 20px rgba(30,41,59,.18);overflow:hidden}',
      '#assist-box .as-head{display:flex;align-items:center;gap:6px;padding:8px 10px;background:#eef2ff;font-weight:bold;color:#3730a3}',
      '#assist-box .as-head .as-title{flex:1}',
      '#assist-box .as-head button{border:1px solid #c7d2fe;background:#fff;color:#3730a3;border-radius:6px;padding:2px 8px;font-size:12px;cursor:pointer}',
      '#assist-box .as-body{max-height:45vh;overflow:auto;padding:4px 12px 10px}',
      '#assist-box h5{margin:8px 0 4px;font-size:12px;color:#64748b}',
      '#assist-box ul{margin:0;padding-left:18px}#assist-box li{margin:3px 0;line-height:1.5}',
      '#assist-box .as-ok{color:#166534;margin:8px 0}',
      '#assist-box .as-note{color:#94a3b8;font-size:11px;margin-top:8px}',
      '#assist-box .as-pill{border:1px solid #c7d2fe;background:#fff;color:#3730a3;border-radius:18px;padding:6px 12px;box-shadow:0 3px 10px rgba(30,41,59,.15);cursor:pointer;font-size:13px}',
      '#assist-box .as-badge{display:inline-block;min-width:18px;padding:0 5px;border-radius:9px;background:#f59e0b;color:#fff;font-size:11px;text-align:center;margin-left:4px}',
      '#assist-box.as-pillmode{text-align:right}',
      // スマホは画面下のツールバーに重ならないよう少し上に出す
      '#assist-box.as-m{left:8px;right:8px;bottom:64px;width:auto}',
      '#assist-box.as-m .as-body{max-height:38vh}'
    ].join('\n');
    document.head.appendChild(s);
  }

  function boxEl() {
    var b = document.getElementById(BOX_ID);
    if (!b) { b = document.createElement('div'); b.id = BOX_ID; document.body.appendChild(b); }
    b.className = IS_MOBILE ? 'as-m' : '';
    return b;
  }
  function pillMode(b, on) {
    if (on) b.classList.add('as-pillmode'); else b.classList.remove('as-pillmode');
  }
  function removeBox() { var b = document.getElementById(BOX_ID); if (b && b.parentNode) b.parentNode.removeChild(b); }
  function folded() { try { return sessionStorage.getItem(FOLD_KEY) === '1'; } catch (e) { return false; } }
  function setFolded(v) { try { sessionStorage.setItem(FOLD_KEY, v ? '1' : ''); } catch (e) { /* 覚えなくてよい */ } }

  var current = { miss: [], next: [], loading: false, mode: 'detail' };

  function render() {
    var b = boxEl();
    pillMode(b, (setting && !setting.on) || folded());
    if (setting && !setting.on) {
      b.innerHTML = '<button type="button" class="as-pill" title="アシストをオンにする">🧭 アシスト オフ</button>';
      b.querySelector('button').onclick = function () {
        this.disabled = true;
        saveSetting(true).then(start, function () { alert('切り替えられませんでした'); });
      };
      return;
    }
    var n = current.miss.length + current.next.length;
    if (folded()) {
      b.innerHTML = '<button type="button" class="as-pill">🧭 アシスト' + (n ? '<span class="as-badge">' + n + '</span>' : ' ✅') + '</button>';
      b.querySelector('button').onclick = function () { setFolded(false); render(); };
      return;
    }
    var h = '<div class="as-card"><div class="as-head"><span class="as-title">🧭 アシスト</span>' +
      '<button type="button" class="as-fold">たたむ</button><button type="button" class="as-off">オフ</button></div><div class="as-body">';
    if (current.miss.length) h += '<h5>⚠ 足りない情報(' + current.miss.length + ')</h5><ul><li>' + current.miss.join('</li><li>') + '</li></ul>';
    if (current.next.length) h += '<h5>👉 次にやること</h5><ul><li>' + current.next.join('</li><li>') + '</li></ul>';
    if (!n && !current.loading) h += '<div class="as-ok">✅ 足りない情報はありません。</div>';
    if (current.loading) h += '<div class="as-note">関連の記録を確認しています…</div>';
    if (current.mode === 'edit') h += '<div class="as-note">入力に合わせて変わります。空欄があっても保存はできます。</div>';
    h += '</div></div>';
    b.innerHTML = h;
    b.querySelector('.as-fold').onclick = function () { setFolded(true); render(); };
    b.querySelector('.as-off').onclick = function () {
      if (!confirm('アシストをオフにします。\n右下の「🧭 アシスト オフ」を押すと、いつでもオンに戻せます。')) return;
      saveSetting(false).then(function () { stopTimer(); render(); }, function () { alert('切り替えられませんでした'); });
    };
  }

  // ---------- 画面ごとの動き ----------
  var ctx = null; // {app, mode, id, record}

  function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }

  function evaluate(record) {
    var rule = rules[ctx.app];
    var out = rule.sync(record, ctx.mode);
    return out;
  }

  function start() {
    stopTimer();
    if (!ctx) return;
    if (!setting.on) { render(); return; }
    var rule = rules[ctx.app];
    if (ctx.mode === 'edit') {
      // 入力中の値を読み直す(文字の欄には change イベントが無いものがあるため、一定間隔で見る)
      var tick = function () {
        var rec;
        try { rec = recApi().get().record; } catch (e) { return; }
        var out = evaluate(rec);
        var key = JSON.stringify(out);
        if (key === lastKey) return;
        lastKey = key;
        current = { miss: out.miss, next: out.next, loading: false, mode: 'edit' };
        render();
      };
      lastKey = '';
      tick();
      timer = setInterval(tick, 1500);
      return;
    }
    var base = evaluate(ctx.record);
    current = { miss: base.miss, next: base.next, loading: !!rule.more, mode: 'detail' };
    render();
    if (!rule.more) return;
    var mine = ctx;
    rule.more(ctx.record, ctx.id).then(function (extra) {
      if (ctx !== mine) return;
      current = { miss: base.miss.concat(extra.miss), next: base.next.concat(extra.next), loading: false, mode: 'detail' };
      render();
    }).catch(function () {
      if (ctx !== mine) return;
      current.loading = false;
      render();
    });
  }

  function onShow(mode) {
    return function (event) {
      IS_MOBILE = event.type.indexOf('mobile.') === 0;
      var app = Number(event.appId);
      stopTimer();
      if (TARGETS.indexOf(app) < 0) { removeBox(); return event; }
      injectStyle();
      ctx = { app: app, mode: mode, id: event.recordId || '', record: event.record };
      loadSetting().then(start);
      return event;
    };
  }

  kintone.events.on(['app.record.detail.show', 'mobile.app.record.detail.show'], onShow('detail'));
  kintone.events.on(['app.record.create.show', 'app.record.edit.show', 'mobile.app.record.create.show', 'mobile.app.record.edit.show'], onShow('edit'));
  // 一覧などレコード以外の画面では消す(スマホは画面が切り替わっても前の要素が残るため)
  kintone.events.on(['app.record.index.show', 'mobile.app.record.index.show'], function (event) {
    stopTimer();
    ctx = null;
    removeBox();
    return event;
  });
  kintone.events.on(['app.record.create.submit.success', 'app.record.edit.submit.success',
    'mobile.app.record.create.submit.success', 'mobile.app.record.edit.submit.success'], function (event) {
    stopTimer();
    return event;
  });
})();
