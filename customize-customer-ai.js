/*
 * お客様AI(顧客管理18・案件管理19・活動履歴17・ネタリスト29 の詳細/一覧、PC・スマホ)
 * 設計: アプリ作成\kintone管理\お客様AI\2026-11-09-design.md
 *
 * 画面左下の「🔍 お客様AI」で、今開いている会社について「前回の対応」「担当者」「案件の状況」などを答える。
 * - よく使う質問のボタンは、この画面だけで答える(AIを使わない)。
 * - 自由な質問は、質問文だけを GAS(Gemini)に送って「探し方」に変えてもらい、記録はこの画面が本人の権限で読む。
 *   お客様の記録は外へ送らない。件数はこのJSが数える(AIに数えさせない)。
 * - 日付は日本時間(business-date スキル)。週は月曜始まり。
 * PREVIEW_USERS に人を並べると、その人だけに表示する(null で全員)。
 */
(function () {
  'use strict';

  var GAS_URL = 'https://script.google.com/macros/s/AKfycbz5SNjMW-f5KOiYAXmfXNlfTiqv8nB-PURoOaB9GsMAxb7ps4qbzqoAxqziTpBlZZOANQ/exec';  // お客様AI(GAS、taimei.sol)。空なら自由な質問の欄を出さず、ボタンだけ
  var PREVIEW_USERS = ['taimei.sol@gmail.com'];
  var FEEDBACK_APP = 55;  // 「違った」の保存先アプリ番号(お客様AI 改善メモ)。null なら「違った」ボタンを出さない
  var APP = { activity: 17, customer: 18, deal: 19, contact: 20, lead: 29, schedule: 34 };
  var DAY = 86400000;

  // ================= 探す・数える(画面に依存しない。Node のテストでも読む) =================
  var CA = (function () {
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    function ymd(d) { return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
    // 日本時間の今日 'YYYY-MM-DD'(端末の時計のタイムゾーンに依存しない)
    function today(nowMs) { return ymd(new Date(nowMs + 9 * 3600000)); }
    function parse(s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); return Date.UTC(+m[1], +m[2] - 1, +m[3]); }
    function addDays(s, n) { return ymd(new Date(parse(s) + n * DAY)); }
    function monthEnd(y, m) { return ymd(new Date(Date.UTC(y, m, 0))); }  // m は 1〜12
    function md(s) { return s ? +s.slice(5, 7) + '/' + +s.slice(8, 10) : ''; }

    // 期間 → {from, to, label}(両端を含む日付)。type=none は null
    function period(p, todayStr) {
      var t = (p && p.type) || 'none';
      var y = +todayStr.slice(0, 4), m = +todayStr.slice(5, 7);
      var dow = (new Date(parse(todayStr)).getUTCDay() + 6) % 7;  // 月曜=0
      var mon = addDays(todayStr, -dow);
      var r;
      if (t === 'today') r = { from: todayStr, to: todayStr, label: '今日' };
      else if (t === 'yesterday') { var yd = addDays(todayStr, -1); r = { from: yd, to: yd, label: '昨日' }; }
      else if (t === 'this_week') r = { from: mon, to: addDays(mon, 6), label: '今週' };
      else if (t === 'last_week') r = { from: addDays(mon, -7), to: addDays(mon, -1), label: '先週' };
      else if (t === 'this_month') r = { from: todayStr.slice(0, 8) + '01', to: monthEnd(y, m), label: '今月' };
      else if (t === 'last_month') {
        var ly = m === 1 ? y - 1 : y, lm = m === 1 ? 12 : m - 1;
        r = { from: ly + '-' + pad(lm) + '-01', to: monthEnd(ly, lm), label: '先月' };
      } else if (t === 'month') {
        var mm = /^(\d{4})?-(\d{2})$/.exec((p && p.month) || '');
        if (!mm) return null;
        var mo = +mm[2], yr = mm[1] ? +mm[1] : (mo > m ? y - 1 : y);  // 年が無く、今月より先の月は去年
        r = { from: yr + '-' + mm[2] + '-01', to: monthEnd(yr, mo), label: yr + '年' + mo + '月' };
      } else if (t === 'last_n_days') {
        var n = Math.max(1, Math.min(90, Math.floor(+p.days) || 0));
        r = { from: addDays(todayStr, -(n - 1)), to: todayStr, label: '直近' + n + '日' };
      } else return null;
      r.label += '(' + md(r.from) + (r.from === r.to ? '' : '〜' + md(r.to)) + ')';
      return r;
    }

    // kintone のクエリに入れる文字(" と \ は落とす)
    function q(s) { return '"' + String(s == null ? '' : s).replace(/["\\]/g, '').slice(0, 60) + '"'; }

    // よく使う質問のボタン → 探し方(AIを使わない)
    var PRESETS = [
      { id: 'last_contact', label: '前回の対応', company: true },
      { id: 'history', label: 'これまでの経緯', company: true },
      { id: 'contacts', label: '担当者・連絡先', company: true },
      { id: 'deals', label: '案件の状況', company: true },
      { id: 'next_action', label: '次の予定', company: true },
      { id: 'before_call', label: '電話・訪問の前に', company: true },
      { id: 'refusals', label: '断られた理由', company: true },
      { id: 'my_counts', label: '今月の自分の件数', company: false },
      { id: 'team_counts', label: '今月のチームの件数', company: false },
      { id: 'follow_up', label: '今日連絡する先', company: false },
      { id: 'call_list', label: '架電した先を絞る', company: false },
    ];
    function presetPlan(id) {
      var pr = PRESETS.filter(function (x) { return x.id === id; })[0];
      if (!pr) return null;
      var cl = id === 'call_list';
      return {
        intent: id, target: pr.company ? 'current' : 'none', companyKeyword: '',
        period: cl ? { type: 'last_n_days', month: '', days: 7 } : { type: id === 'my_counts' || id === 'team_counts' ? 'this_month' : 'none', month: '', days: 0 },
        filters: { kind: cl ? '架電' : '', result: '', results: [], progress: '', area: '', category: '' },
        who: id === 'my_counts' || cl ? 'me' : 'all',
      };
    }
    // 探し方の形をそろえる(古いGASの result 1つ → results)
    function normPlan(plan) {
      var p = JSON.parse(JSON.stringify(plan || {}));
      p.period = p.period || { type: 'none', month: '', days: 0 };
      var f = p.filters = p.filters || {};
      ['kind', 'result', 'progress', 'area', 'category'].forEach(function (k) { if (typeof f[k] !== 'string') f[k] = ''; });
      if (!Array.isArray(f.results)) f.results = [];
      if (f.result && f.results.indexOf(f.result) < 0) f.results.unshift(f.result);
      f.result = f.results[0] || '';
      p.who = p.who === 'me' ? 'me' : 'all';
      if (p.intent === 'find_company' && f.results.length) { p.intent = 'call_list'; f.progress = ''; }  // 電話の結果が付いた会社探し = 架電した先
      return p;
    }
    var COMPANY_INTENTS = ['last_contact', 'history', 'contacts', 'deals', 'next_action', 'before_call', 'refusals'];
    // 質問の言葉から、近いボタンを選ぶ(AIが読み取れなかったとき)
    var HINTS = [
      [/前回|最後|この前|直近の対応/, 'last_contact'], [/経緯|流れ|今まで|これまで/, 'history'],
      [/担当|決裁|連絡先|誰に|電話番号/, 'contacts'], [/案件|見積|受注|確度|商談の状況/, 'deals'],
      [/次|予定|いつ/, 'next_action'], [/前に|準備|どんな/, 'before_call'], [/断|失注|ブロック|理由/, 'refusals'],
      [/かけた|架電した|電話した|訪問した|行った|不在|コールのみ|一覧|リスト|店/, 'call_list'],
      [/チーム|全体|みんな|全員/, 'team_counts'], [/件数|何件|数/, 'my_counts'], [/今日|連絡する|期限|忘れ/, 'follow_up'],
    ];
    function suggest(text, hasCompany) {
      var out = [];
      HINTS.forEach(function (h) {
        if (out.length >= 3 || !h[0].test(String(text || '')) || out.indexOf(h[1]) >= 0) return;
        if (!hasCompany && COMPANY_INTENTS.indexOf(h[1]) >= 0) return;
        out.push(h[1]);
      });
      var fill = hasCompany ? ['last_contact', 'before_call', 'history'] : ['call_list', 'follow_up', 'my_counts'];
      fill.forEach(function (id) { if (out.length < 3 && out.indexOf(id) < 0) out.push(id); });
      return out;
    }

    // ---- 会社名のゆれ(株式会社の有無・全角半角・ひらがなカタカナ・空白) ----
    var CORP = /株式会社|有限会社|合同会社|合資会社|合名会社|一般社団法人|一般財団法人|医療法人社団|医療法人|社会福祉法人|NPO法人|\(株\)|\(有\)|\(同\)|㈱|㈲|様$|さん$|御中$/g;
    function toHalf(s) { return String(s || '').replace(/[！-～]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); }).replace(/　/g, ' '); }
    function toFull(s) { return String(s || '').replace(/[!-~]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) + 0xFEE0); }); }
    function kata(s) { return String(s || '').replace(/[ぁ-ゖ]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) + 0x60); }); }
    function hira(s) { return String(s || '').replace(/[ァ-ヶ]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0x60); }); }
    function baseName(s) { return toHalf(s).replace(CORP, '').replace(/\s+/g, ' ').trim(); }
    // 比べる・まとめるための形(記号・空白を落とし、ひらがな・小文字に)
    function normName(s) { return hira(baseName(s).replace(/[\s・･.,、。'"’\-‐－―~〜!?]/g, '')).toLowerCase(); }
    // kintone の「like」に入れる書き方の候補
    function nameVariants(s) {
      var b = baseName(s), out = [];
      [b, b.replace(/ /g, ''), toFull(b), kata(b), hira(b)].forEach(function (x) { x = x.slice(0, 30); if (x && out.indexOf(x) < 0) out.push(x); });
      return out.slice(0, 5);
    }
    // 見つからないときに使う短い切れ端(単語・先頭3文字・末尾3文字)
    function nameParts(s) {
      var b = baseName(s), out = [];
      var add = function (x) { if (x && x.length >= 2 && out.indexOf(x) < 0) out.push(x); };
      b.split(/[ ・･]+/).forEach(add);
      var j = b.replace(/[ ・･]+/g, '');
      if (j.length >= 4) { add(j.slice(0, 3)); add(j.slice(-3)); add(kata(j.slice(0, 3))); add(toFull(j.slice(0, 3))); }
      return out.slice(0, 6);
    }
    function grams(s) { var o = {}; for (var i = 0; i < s.length - 1; i++) o[s.substr(i, 2)] = (o[s.substr(i, 2)] || 0) + 1; return o; }
    // 名前の近さ 0〜1
    function similar(a, b) {
      a = normName(a); b = normName(b);
      if (!a || !b) return 0;
      if (a === b) return 1;
      if (a.indexOf(b) >= 0 || b.indexOf(a) >= 0) return 0.6 + 0.4 * Math.min(a.length, b.length) / Math.max(a.length, b.length);
      if (a.length < 2 || b.length < 2) return 0;
      var ga = grams(a), gb = grams(b), n = 0;
      Object.keys(ga).forEach(function (k) { if (gb[k]) n += Math.min(ga[k], gb[k]); });
      return 2 * n / (a.length - 1 + b.length - 1);
    }
    var INTENT_LABEL = {
      last_contact: '前回の対応', history: 'これまでの経緯', contacts: '担当者・連絡先', deals: '案件の状況',
      next_action: '次の予定', before_call: '電話・訪問の前に知っておくこと', refusals: '断られた理由',
      my_counts: '自分の件数', team_counts: 'チームの件数', find_company: '会社・店を探す', follow_up: '今日連絡する先',
      call_list: '架電・訪問した先', unknown: '',
    };

    // ---- 記録を共通の形に ----
    function v(r, c) { var f = r && r[c]; return f && f.value != null ? f.value : ''; }
    function users(r, c) { var a = v(r, c); return Array.isArray(a) ? a.map(function (u) { return u.name; }).join('・') : ''; }
    var THIN = { 'コールのみ': 1, '担当不在': 1, '不通・不在': 1, '架電済み': 1 };
    // 活動履歴17 → 1件
    function fromActivity(r) {
      return {
        date: v(r, '対応日付'), time: String(v(r, '対応時刻')).slice(0, 5), kind: v(r, '対応種別'),
        result: v(r, 'コール業務'), who: users(r, '対応者'), text: v(r, '内容'), deal: v(r, '案件名'),
        app: APP.activity, id: v(r, '$id'), src: '活動履歴',
      };
    }
    // ネタリスト29 の架電履歴の1行 → 1件
    function fromLeadRow(row, leadId) {
      var x = row.value || {};
      return {
        date: v(x, '履歴日付'), time: String(v(x, '履歴時刻')).slice(0, 5), kind: v(x, '履歴種別') || '架電',
        result: v(x, '履歴結果'), who: users(x, '履歴担当'), text: v(x, '履歴メモ'), deal: '',
        app: APP.lead, id: leadId, src: 'ネタリスト',
      };
    }
    function isThin(it) {
      var t = String(it.text || '').trim();
      return it.kind === '架電' && THIN[it.result] && (!t || t === it.result);
    }
    // 新しい順。同じ日・時刻・種別・結果は1件に(ネタリストと活動履歴の両方に入った同じ架電)
    function mergeItems(lists) {
      var all = [].concat.apply([], lists), seen = {}, out = [];
      all.sort(function (a, b) { return (b.date + b.time).localeCompare(a.date + a.time); });
      all.forEach(function (it) {
        var k = [it.date, it.time, it.kind, it.result].join('|');
        if (it.time && seen[k]) return;
        seen[k] = 1;
        out.push(it);
      });
      return out;
    }
    // 中身の無い架電(コールのみ・不在)が続くところを1行にまとめる
    function collapse(items) {
      var out = [];
      items.forEach(function (it) {
        var last = out[out.length - 1];
        if (isThin(it) && last && last.group) { last.n++; last.from = it.date; return; }
        if (isThin(it)) { out.push({ group: true, n: 1, from: it.date, to: it.date, sample: it }); return; }
        out.push(it);
      });
      return out;
    }

    // ---- 件数 ----
    var KIND_ORDER = ['架電', '商談（初回）', '商談（2回目以降）', 'メール', 'その他'];
    var RESULT_ORDER = ['アポ獲得', 'ネタ', 'コールのみ', '担当不在', '受付ブロック', '失注'];
    var LEAD_RESULT = { '獲得': 'アポ獲得', 'ネタ': 'ネタ', '架電済み': 'コールのみ', '不通・不在': '担当不在', '受付ブロック': '受付ブロック', '失注': '失注' };
    // acts: 活動履歴17の記録、leads: ネタリスト29の記録(架電履歴つき)、range: {from,to}、me: ログインユーザーのコード(自分だけのとき)
    function countUp(acts, leads, range, me) {
      var c = { kinds: {}, results: {}, people: {}, leadCalls: 0, leadVisits: 0, leadResults: {} };
      function person(name) { return c.people[name] || (c.people[name] = { calls: 0, apo: 0, visits: 0 }); }
      acts.forEach(function (r) {
        var d = v(r, '対応日付');
        if (d < range.from || d > range.to) return;
        var who = v(r, '対応者') || [];
        if (me && !who.some(function (u) { return u.code === me; })) return;
        var k = v(r, '対応種別') || 'その他';
        c.kinds[k] = (c.kinds[k] || 0) + 1;
        var res = v(r, 'コール業務');
        if (k === '架電' && res) c.results[res] = (c.results[res] || 0) + 1;
        (who.length ? who : [{ name: '(対応者なし)' }]).forEach(function (u) {
          var p = person(u.name);
          if (k === '架電') p.calls++;
          if (res === 'アポ獲得') p.apo++;
          if (k.indexOf('商談') === 0) p.visits++;
        });
      });
      leads.forEach(function (r) {
        (v(r, '架電履歴') || []).forEach(function (row) {
          var x = row.value || {};
          var d = v(x, '履歴日付');
          if (d < range.from || d > range.to) return;
          var who = v(x, '履歴担当') || [];
          if (me && !who.some(function (u) { return u.code === me; })) return;
          var visit = v(x, '履歴種別') === '飛び込み';
          if (visit) c.leadVisits++; else c.leadCalls++;
          var res = LEAD_RESULT[v(x, '履歴結果')] || '';
          if (res) c.leadResults[res] = (c.leadResults[res] || 0) + 1;
          (who.length ? who : [{ name: '(担当なし)' }]).forEach(function (u) {
            var p = person(u.name);
            if (!visit) p.calls++;
            if (res === 'アポ獲得') p.apo++;
          });
        });
      });
      return c;
    }
    // 質問への答えの1行目(例「今月のアポ獲得: 5件」)
    function headline(c, f) {
      var calls = (c.kinds['架電'] || 0) + c.leadCalls;
      var visits = (c.kinds['商談（初回）'] || 0) + (c.kinds['商談（2回目以降）'] || 0);
      var rs = f.results && f.results.length ? f.results : f.result ? [f.result] : [];
      if (rs.length) return [rs.join('・'), rs.reduce(function (n, r) { return n + (c.results[r] || 0) + (c.leadResults[r] || 0); }, 0)];
      if (f.kind === '商談') return ['商談(訪問)', visits];
      if (f.kind === '架電') return ['架電', calls];
      if (f.kind) return [f.kind, c.kinds[f.kind] || 0];
      return ['架電', calls, 'アポ獲得', (c.results['アポ獲得'] || 0) + (c.leadResults['アポ獲得'] || 0), '商談(訪問)', visits];
    }

    // ---- 架電・訪問した先(call_list) ----
    // 活動履歴17の「対応種別」の条件
    function kindCond(kind) {
      if (kind === '架電') return ' and 対応種別 in ("架電")';
      if (kind === '商談') return ' and 対応種別 in ("商談（初回）", "商談（2回目以降）")';
      return kind ? ' and 対応種別 in (' + q(kind) + ')' : '';
    }
    function kindOk(kind, f) {  // kind: 17の対応種別、またはネタリストの「架電」「飛び込み」
      if (!f) return true;
      if (f === '架電') return kind === '架電';
      if (f === '商談') return kind.indexOf('商談') === 0 || kind === '飛び込み';
      return kind === f;
    }
    // 期間に対応した会社ごとにまとめる。結果の条件は「期間中の最後の対応」で見る
    function callList(acts, leads, range, f, me) {
      f = f || {};
      var rows = {}, list = [];
      function add(e) {
        var key = normName(e.companyName) || (e.customerNo ? 'c' + e.customerNo : 'l' + e.leadNo);
        var r = rows[key];
        if (!r) { r = rows[key] = { key: key, companyName: e.companyName, customerNo: '', leadNo: '', n: 0, last: null, who: [] }; list.push(r); }
        if (e.customerNo && !r.customerNo) r.customerNo = e.customerNo;
        if (e.leadNo && !r.leadNo) r.leadNo = e.leadNo;
        r.n++;
        e.who.forEach(function (w) { if (r.who.indexOf(w) < 0) r.who.push(w); });
        if (!r.last || (e.date + e.time) > (r.last.date + r.last.time)) r.last = e;
      }
      acts.forEach(function (a) {
        var d = v(a, '対応日付'), k = v(a, '対応種別') || 'その他', who = v(a, '対応者') || [];
        if (d < range.from || d > range.to || !kindOk(k, f.kind)) return;
        if (me && !who.some(function (u) { return u.code === me; })) return;
        add({ date: d, time: String(v(a, '対応時刻')).slice(0, 5), kind: k, result: v(a, 'コール業務'), who: who.map(function (u) { return u.name; }),
          companyName: v(a, '会社名'), customerNo: v(a, '顧客No'), leadNo: '', text: v(a, '内容'), app: APP.activity, id: v(a, '$id') });
      });
      leads.forEach(function (l) {
        (v(l, '架電履歴') || []).forEach(function (row) {
          var x = row.value || {}, d = v(x, '履歴日付'), k = v(x, '履歴種別') === '飛び込み' ? '飛び込み' : '架電', who = v(x, '履歴担当') || [];
          if (d < range.from || d > range.to || !kindOk(k, f.kind)) return;
          if (me && !who.some(function (u) { return u.code === me; })) return;
          add({ date: d, time: String(v(x, '履歴時刻')).slice(0, 5), kind: k, result: LEAD_RESULT[v(x, '履歴結果')] || v(x, '履歴結果'), who: who.map(function (u) { return u.name; }),
            companyName: v(l, '会社名'), customerNo: '', leadNo: v(l, '$id'), text: v(x, '履歴メモ'), app: APP.lead, id: v(l, '$id') });
        });
      });
      var want = f.results && f.results.length ? f.results : f.result ? [f.result] : [];
      return list.filter(function (r) { return !want.length || want.indexOf(r.last.result) >= 0; })
        .sort(function (a, b) { return (b.last.date + b.last.time).localeCompare(a.last.date + a.last.time); });
    }
    // 地域・業種の条件(顧客18・ネタ29の住所・業種・会社名で見る)
    function placeOk(info, f) {
      if (!f.area && !f.category) return true;
      if (!info) return false;
      var addr = toHalf(info.addr), cat = normName(info.cat + ' ' + info.name);
      return (!f.area || addr.indexOf(toHalf(f.area)) >= 0) && (!f.category || cat.indexOf(normName(f.category)) >= 0);
    }

    // ---- 会社を探す(find_company)のクエリ ----
    function findQueries(f) {
      var leadC = [], custC = [];
      if (f.area) { leadC.push('(市区町村 like ' + q(f.area) + ' or 丁目番地等 like ' + q(f.area) + ')'); custC.push('住所 like ' + q(f.area)); }
      if (f.category) {
        leadC.push('(中分類 like ' + q(f.category) + ' or G_業種 like ' + q(f.category) + ' or 会社名 like ' + q(f.category) + ')');
        custC.push('(中分類 like ' + q(f.category) + ' or 業種メモ like ' + q(f.category) + ' or 会社名 like ' + q(f.category) + ')');
      }
      if (f.progress === '未着手') leadC.push('進捗状況 not in ("架電済み", "失注")');
      else if (f.progress) leadC.push('進捗状況 in (' + q(f.progress) + ')');
      leadC.push('確認ステータス not in ("廃業・閉店", "移転")');
      return {
        lead: leadC.join(' and ') + ' order by 架電スコア desc, レコード番号 desc',
        customer: f.progress ? null : custC.join(' and ') + ' order by 顧客No desc',
        ok: !!(f.area || f.category),
      };
    }

    return {
      today: today, addDays: addDays, period: period, q: q, PRESETS: PRESETS, presetPlan: presetPlan, INTENT_LABEL: INTENT_LABEL,
      v: v, users: users, fromActivity: fromActivity, fromLeadRow: fromLeadRow, mergeItems: mergeItems, collapse: collapse, isThin: isThin,
      KIND_ORDER: KIND_ORDER, RESULT_ORDER: RESULT_ORDER, countUp: countUp, headline: headline, findQueries: findQueries, md: md,
      normPlan: normPlan, suggest: suggest, COMPANY_INTENTS: COMPANY_INTENTS, normName: normName, nameVariants: nameVariants, nameParts: nameParts,
      similar: similar, toHalf: toHalf, kindCond: kindCond, callList: callList, placeOk: placeOk,
    };
  })();

  // ================= 記録を読む(本人の権限) =================
  // deps: { get(app, query, fields) → Promise<records(最大500)>, getAll(app, query, fields, max) → Promise<records>, todayStr, me }
  function makeAnswer(plan, ctx, deps) {
    var Q = CA.q, P = Promise;
    plan = CA.normPlan(plan);
    var hasCompany = !!(ctx.customerNo || ctx.leadNo || ctx.companyName);

    function activities(limit) {
      var jobs = [];
      if (ctx.customerNo) jobs.push(deps.get(APP.activity, '顧客No = ' + ctx.customerNo + ' order by 対応日付 desc, 対応時刻 desc limit ' + limit));
      else if (ctx.companyName) jobs.push(deps.get(APP.activity, '会社名 = ' + Q(ctx.companyName) + ' order by 対応日付 desc, 対応時刻 desc limit ' + limit));
      else jobs.push(P.resolve([]));
      jobs.push(ctx.leadNo ? deps.get(APP.lead, '$id = ' + ctx.leadNo + ' limit 1', ['$id', '架電履歴']) : P.resolve([]));
      return P.all(jobs).then(function (rs) {
        var a = rs[0].map(CA.fromActivity);
        var l = rs[1].length ? (CA.v(rs[1][0], '架電履歴') || []).map(function (row) { return CA.fromLeadRow(row, ctx.leadNo); }) : [];
        return CA.mergeItems([a, l]);
      });
    }
    function deals() {
      if (!ctx.customerNo) return P.resolve([]);
      return deps.get(APP.deal, '顧客No_ = ' + ctx.customerNo + ' order by 案件No_ desc limit 20');
    }
    function schedules() {
      var from = deps.todayStr + 'T00:00:00+09:00';
      var cond = ctx.customerNo ? '顧客No = ' + ctx.customerNo : ctx.leadNo ? 'ネタNo = ' + ctx.leadNo : null;
      if (!cond) return P.resolve([]);
      return deps.get(APP.schedule, cond + ' and 開始日時 >= ' + Q(from) + ' and 元予定No = "" and 実施状況 in ("予定") order by 開始日時 asc limit 10');
    }
    function customer() { return ctx.customerNo ? deps.get(APP.customer, '$id = ' + ctx.customerNo + ' limit 1').then(function (r) { return r[0] || null; }) : P.resolve(null); }
    function lead() { return ctx.leadNo ? deps.get(APP.lead, '$id = ' + ctx.leadNo + ' limit 1').then(function (r) { return r[0] || null; }) : P.resolve(null); }

    var need = { last_contact: 1, history: 1, contacts: 1, deals: 1, next_action: 1, before_call: 1, refusals: 1 };
    var view = { title: CA.INTENT_LABEL[plan.intent] || '', company: need[plan.intent] ? ctx.companyName || '' : '', sections: [], notes: [] };
    if (need[plan.intent] && !hasCompany) {
      view.notes.push('会社の画面(顧客管理・案件・活動履歴・ネタリスト)を開いてから聞くか、質問に会社名を入れてください。');
      return P.resolve(view);
    }

    switch (plan.intent) {
      case 'last_contact':
        return activities(20).then(function (items) {
          var real = items.filter(function (it) { return !CA.isThin(it); });
          var shown = items.slice(0, 1).concat(real.filter(function (it) { return it !== items[0]; }).slice(0, 2));
          view.sections.push({ type: 'items', items: shown, empty: 'この会社の対応の記録はまだありません。' });
          if (items.length) view.notes.push('記録は全部で' + items.length + '件' + (items.length >= 20 ? '以上' : '') + '。「これまでの経緯」で全部見られます。');
          return view;
        });
      case 'history':
        return activities(200).then(function (items) {
          view.sections.push({ type: 'items', items: CA.collapse(items).slice(0, 40), empty: 'この会社の対応の記録はまだありません。' });
          return view;
        });
      case 'refusals':
        return P.all([activities(200), deals()]).then(function (rs) {
          var bad = rs[0].filter(function (it) { return it.result === '失注' || it.result === '受付ブロック'; });
          var lost = rs[1].filter(function (d) { return CA.v(d, '商談フェーズ') === '失注' || CA.v(d, '商談フェーズ') === '保留/中止'; });
          view.sections.push({ type: 'items', items: bad, empty: '「失注」「受付ブロック」の記録はありません。' });
          if (lost.length) view.sections.push({ type: 'deals', heading: '失注・保留の案件', items: lost });
          return view;
        });
      case 'contacts':
        return P.all([
          ctx.customerNo ? deps.get(APP.contact, '顧客No_ = ' + ctx.customerNo + ' order by 担当者No_ desc limit 30') : P.resolve([]),
          customer(), lead(),
        ]).then(function (rs) {
          var people = rs[0].slice().sort(function (a, b) { return (CA.v(b, '決裁権') === 'あり') - (CA.v(a, '決裁権') === 'あり'); });
          view.sections.push({ type: 'contacts', items: people, customer: rs[1], lead: rs[2] });
          return view;
        });
      case 'deals':
        return deals().then(function (ds) {
          view.sections.push({ type: 'deals', items: ds, empty: ctx.customerNo ? 'この会社の案件はまだありません。' : 'まだ顧客管理に登録されていない会社です(案件はありません)。' });
          return view;
        });
      case 'next_action':
        return P.all([schedules(), customer(), lead(), deals()]).then(function (rs) {
          var rows = [];
          rs[0].forEach(function (s) { rows.push({ at: CA.v(s, '開始日時'), label: '予定: ' + CA.v(s, '種類') + ' ' + CA.v(s, '件名'), who: CA.users(s, '参加者'), app: APP.schedule, id: CA.v(s, '$id') }); });
          if (rs[1] && CA.v(rs[1], '次回連絡日')) rows.push({ date: CA.v(rs[1], '次回連絡日'), label: '次回連絡日(顧客管理)', app: APP.customer, id: ctx.customerNo });
          if (rs[2] && CA.v(rs[2], '次回架電予定日')) rows.push({ date: CA.v(rs[2], '次回架電予定日'), label: '次回架電予定日(ネタリスト)', app: APP.lead, id: ctx.leadNo });
          var at = {};
          rs[0].forEach(function (s) { at[Date.parse(CA.v(s, '開始日時'))] = 1; });
          rs[3].forEach(function (d) {
            var ph = CA.v(d, '商談フェーズ');
            if (at[Date.parse(CA.v(d, '次回商談日'))]) return;  // 予定に入っている商談と同じ
            if (CA.v(d, '次回商談日') && ph !== '受注' && ph !== '失注') rows.push({ at: CA.v(d, '次回商談日'), label: '次回商談日: ' + CA.v(d, '案件名'), who: CA.users(d, '主担当'), app: APP.deal, id: CA.v(d, '$id') });
          });
          view.sections.push({ type: 'dates', items: rows, empty: '次の予定・次回連絡日は入っていません。' });
          return view;
        });
      case 'before_call':
        return P.all([customer(), lead(), activities(20), deals(), schedules()]).then(function (rs) {
          view.sections.push({ type: 'profile', customer: rs[0], lead: rs[1] });
          var items = rs[2];
          var real = items.filter(function (it) { return !CA.isThin(it); }).slice(0, 3);
          view.sections.push({ type: 'items', heading: '最近の対応', items: real, empty: '中身のある対応の記録はまだありません。', count: items.length });
          var open = rs[3].filter(function (d) { var p = CA.v(d, '商談フェーズ'); return p !== '受注' && p !== '失注' && p !== '保留/中止'; });
          var won = rs[3].filter(function (d) { return CA.v(d, '商談フェーズ') === '受注'; });
          if (open.length) view.sections.push({ type: 'deals', heading: '進行中の案件', items: open });
          if (won.length) view.sections.push({ type: 'deals', heading: '受注済み(今のお客様)', items: won });
          if (rs[4].length) view.sections.push({ type: 'dates', heading: '入っている予定', items: rs[4].map(function (s) { return { at: CA.v(s, '開始日時'), label: CA.v(s, '種類') + ' ' + CA.v(s, '件名'), who: CA.users(s, '参加者'), app: APP.schedule, id: CA.v(s, '$id') }; }) });
          return view;
        });
      case 'my_counts':
      case 'team_counts': {
        var range = CA.period(plan.period.type === 'none' ? { type: 'this_month' } : plan.period, deps.todayStr);
        if (!range) range = CA.period({ type: 'this_month' }, deps.todayStr);
        var me = plan.intent === 'my_counts' ? deps.me.code : null;
        var who = me ? ' and 対応者 in (LOGINUSER())' : '';
        view.title = (me ? '自分' : 'チーム') + 'の件数 ' + range.label;
        return P.all([
          deps.getAll(APP.activity, '対応日付 >= ' + Q(range.from) + ' and 対応日付 <= ' + Q(range.to) + who, ['対応日付', '対応種別', 'コール業務', '対応者'], 5000),
          deps.getAll(APP.lead, '履歴日付 >= ' + Q(range.from) + ' and 履歴日付 <= ' + Q(range.to), ['架電履歴'], 3000),
        ]).then(function (rs) {
          var c = CA.countUp(rs[0], rs[1], range, me);
          view.sections.push({ type: 'counts', counts: c, head: CA.headline(c, plan.filters), team: !me });
          view.notes.push('顧客管理から記録した対応(活動履歴)とネタリストの架電履歴を合わせて数えています。');
          return view;
        });
      }
      case 'find_company': {
        var fq = CA.findQueries(plan.filters);
        if (!fq.ok) { view.notes.push('地域(例: 中央区)か業種(例: 美容室)を入れて聞いてください。'); return P.resolve(view); }
        view.title = '会社・店を探す ' + [plan.filters.area, plan.filters.category, plan.filters.progress === '未着手' ? 'まだ架電していない' : plan.filters.progress].filter(Boolean).join('・');
        return P.all([
          deps.get(APP.lead, fq.lead + ' limit 20', null, true),
          fq.customer ? deps.get(APP.customer, fq.customer + ' limit 20', null, true) : P.resolve(null),
        ]).then(function (rs) {
          view.sections.push({ type: 'leads', items: rs[0], total: rs[0].totalCount, listQuery: fq.lead });
          if (rs[1]) view.sections.push({ type: 'customers', items: rs[1], total: rs[1].totalCount, listQuery: fq.customer });
          return view;
        });
      }
      case 'follow_up': {
        // 今日の分 → 直近30日の期限切れ(新しい順)。日付の欄の「<=」は空欄も拾うので下限を付ける
        var t = deps.todayStr, tm = CA.addDays(t, 1), back = CA.addDays(t, -30);
        view.title = '今日連絡する先(' + CA.md(t) + '・全員分)';
        return P.all([
          deps.get(APP.customer, '次回連絡日 = ' + Q(t) + ' order by 顧客No desc limit 30', null, true),
          deps.get(APP.lead, '次回架電予定日 = ' + Q(t) + ' and 進捗状況 not in ("失注") order by レコード番号 desc limit 30', null, true),
          deps.get(APP.deal, '次回商談日 >= ' + Q(t + 'T00:00:00+09:00') + ' and 次回商談日 < ' + Q(tm + 'T00:00:00+09:00') + ' order by 次回商談日 asc limit 30'),
          deps.get(APP.customer, '次回連絡日 >= ' + Q(back) + ' and 次回連絡日 < ' + Q(t) + ' order by 次回連絡日 desc limit 500', ['$id', '会社名', '次回連絡日']),
          deps.get(APP.lead, '次回架電予定日 >= ' + Q(back) + ' and 次回架電予定日 < ' + Q(t) + ' and 進捗状況 not in ("失注") order by 次回架電予定日 desc limit 500', ['$id', '会社名', '次回架電予定日', '架電日']),
        ]).then(function (rs) {
          // 次回連絡日の当日以降に活動履歴がある会社は「連絡済み」(次回連絡日を直し忘れただけ)
          if (!rs[0].length && !rs[3].length) return [rs, {}];
          return deps.getAll(APP.activity, '対応日付 >= ' + Q(back), ['顧客No', '対応日付'], 5000).then(function (acts) {
            var last = {};
            acts.forEach(function (a) { var n = CA.v(a, '顧客No'), d = CA.v(a, '対応日付'); if (n && (!last[n] || last[n] < d)) last[n] = d; });
            return [rs, last];
          });
        }).then(function (x) {
          var rs = x[0], lastAct = x[1], done = 0;
          var notDone = function (r, dateField) {
            var ok = !(lastAct[CA.v(r, '$id')] && lastAct[CA.v(r, '$id')] >= CA.v(r, dateField));
            if (!ok) done++;
            return ok;
          };
          var notDoneLead = function (r) {
            var ok = !(CA.v(r, '架電日') && CA.v(r, '架電日') >= CA.v(r, '次回架電予定日'));
            if (!ok) done++;
            return ok;
          };
          rs[0] = rs[0].filter(function (r) { return notDone(r, '次回連絡日'); });
          rs[1] = rs[1].filter(notDoneLead);
          rs[3] = rs[3].filter(function (r) { return notDone(r, '次回連絡日'); });
          rs[4] = rs[4].filter(notDoneLead);
          var today = [], late = [];
          rs[2].forEach(function (r) { today.push({ at: CA.v(r, '次回商談日'), label: CA.v(r, '案件名') + '(次回商談)', who: CA.users(r, '主担当'), app: APP.deal, id: CA.v(r, '$id') }); });
          rs[0].forEach(function (r) { today.push({ date: t, label: CA.v(r, '会社名') + '(次回連絡日)', app: APP.customer, id: CA.v(r, '$id') }); });
          rs[1].forEach(function (r) { today.push({ date: t, label: CA.v(r, '会社名') + '(ネタ・次回架電予定日)', app: APP.lead, id: CA.v(r, '$id') }); });
          rs[3].forEach(function (r) { late.push({ date: CA.v(r, '次回連絡日'), label: CA.v(r, '会社名') + '(次回連絡日)', app: APP.customer, id: CA.v(r, '$id'), late: true }); });
          rs[4].forEach(function (r) { late.push({ date: CA.v(r, '次回架電予定日'), label: CA.v(r, '会社名') + '(ネタ・次回架電予定日)', app: APP.lead, id: CA.v(r, '$id'), late: true }); });
          late.sort(function (a, b) { return b.date.localeCompare(a.date); });
          view.sections.push({ type: 'dates', heading: '今日', items: today, empty: '今日が次回連絡日・次回架電予定日の会社、今日の商談はありません。' });
          var lateTotal = late.length;
          view.sections.push({ type: 'dates', heading: '期限切れ(直近30日・' + lateTotal + '件)', items: late.slice(0, 30), empty: 'ありません。' });
          if (done) view.notes.push('次回連絡日のあとに連絡した記録がある' + done + '件は「連絡済み」として外しました(次回連絡日の直し忘れ)。');
          if (lateTotal > 30) view.notes.push('期限切れは新しい順に30件だけ出しています。全部は顧客管理の一覧を「次回連絡日」で並べて見てください。');
          return view;
        });
      }
      case 'call_list': {
        var f = plan.filters;
        var crange = CA.period(plan.period.type === 'none' ? { type: 'last_n_days', days: 7 } : plan.period, deps.todayStr) || CA.period({ type: 'last_n_days', days: 7 }, deps.todayStr);
        var cme = plan.who === 'me' ? deps.me.code : null;
        var leadKinds = !f.kind || f.kind === '架電' || f.kind === '商談';
        view.title = (f.kind === '商談' ? '訪問' : f.kind || '架電・訪問') + 'した先 ' + crange.label + (cme ? '・自分' : '・全員') +
          (f.results.length ? '・最後が' + f.results.join('か') : '') + (f.area ? '・' + f.area : '') + (f.category ? '・' + f.category : '');
        return P.all([
          deps.getAll(APP.activity, '対応日付 >= ' + Q(crange.from) + ' and 対応日付 <= ' + Q(crange.to) + CA.kindCond(f.kind) + (cme ? ' and 対応者 in (LOGINUSER())' : ''),
            ['$id', '顧客No', '会社名', '対応日付', '対応時刻', '対応種別', 'コール業務', '対応者', '内容'], 5000),
          leadKinds ? deps.getAll(APP.lead, '履歴日付 >= ' + Q(crange.from) + ' and 履歴日付 <= ' + Q(crange.to), ['$id', '会社名', '電話番号', '市区町村', '丁目番地等', '中分類', 'G_業種', '架電履歴'], 3000) : P.resolve([]),
        ]).then(function (rs) {
          var rows = CA.callList(rs[0], rs[1], crange, f, cme);
          var leadInfo = {};
          rs[1].forEach(function (l) {
            leadInfo[CA.v(l, '$id')] = { name: CA.v(l, '会社名'), addr: CA.v(l, '市区町村') + CA.v(l, '丁目番地等'), cat: CA.v(l, '中分類') + ' ' + CA.v(l, 'G_業種'), phone: CA.v(l, '電話番号') };
          });
          // 顧客18の住所・業種・電話(100件ずつ)
          var ids = [];
          rows.forEach(function (r) { if (r.customerNo && /^\d+$/.test(r.customerNo) && ids.indexOf(r.customerNo) < 0) ids.push(r.customerNo); });
          var jobs = [];
          for (var i = 0; i < ids.length && i < 1000; i += 100) {
            jobs.push(deps.get(APP.customer, '$id in (' + ids.slice(i, i + 100).join(', ') + ') limit 100', ['$id', '会社名', '住所', '中分類', '業種メモ', '電話番号']));
          }
          return P.all(jobs).then(function (cs) {
            var custInfo = {};
            [].concat.apply([], cs).forEach(function (c) {
              custInfo[CA.v(c, '$id')] = { name: CA.v(c, '会社名'), addr: CA.v(c, '住所'), cat: CA.v(c, '中分類') + ' ' + CA.v(c, '業種メモ'), phone: CA.v(c, '電話番号') };
            });
            rows = rows.filter(function (r) {
              var ci = custInfo[r.customerNo], li = leadInfo[r.leadNo];
              r.info = ci || li || null;
              return CA.placeOk(ci, f) || CA.placeOk(li, f);
            });
            view.sections.push({ type: 'calls', items: rows.slice(0, 100), total: rows.length });
            view.notes.push('同じ会社への対応は1行にまとめ、期間中の最後の対応を出しています' + (f.results.length ? '(結果の条件も最後の対応で見ています)' : '') + '。');
            if (rows.length > 100) view.notes.push('新しい順に100件だけ出しています。期間や条件を絞ってください。');
            return view;
          });
        });
      }
      default:
        view.suggest = true;
        view.notes.push('この質問にはまだ答えられません。近いものを下に出しました。押すか、「前回どうだった?」「ここ10日で不在だった店」のように聞き直してください。');
        return P.resolve(view);
    }
  }

  // 会社名で探す(target=keyword)→ 候補。表記ゆれをそろえて探し、無ければ切れ端で探して近い順に3件(maybe)
  function findCompanies(keyword, deps) {
    function cond(words) { return '(' + words.map(function (w) { return '会社名 like ' + CA.q(w); }).join(' or ') + ')'; }
    function look(words, limit) {
      if (!words.length) return Promise.resolve([[], []]);
      return Promise.all([
        deps.get(APP.customer, cond(words) + ' order by 顧客No desc limit ' + limit, ['$id', '会社名', '住所']),
        deps.get(APP.lead, cond(words) + ' order by レコード番号 desc limit ' + limit, ['$id', '会社名', '市区町村', '丁目番地等']),
      ]);
    }
    function shape(rs) {
      var out = rs[0].map(function (r) { return { customerNo: CA.v(r, '$id'), companyName: CA.v(r, '会社名'), sub: '顧客 ' + CA.v(r, '住所') }; });
      var names = {};
      out.forEach(function (c) { names[CA.normName(c.companyName)] = 1; });
      rs[1].forEach(function (r) {
        if (names[CA.normName(CA.v(r, '会社名'))]) return;  // 顧客になっているネタは顧客のほうに出す
        out.push({ leadNo: CA.v(r, '$id'), companyName: CA.v(r, '会社名'), sub: 'ネタ ' + CA.v(r, '市区町村') + CA.v(r, '丁目番地等') });
      });
      return out;
    }
    return look(CA.nameVariants(keyword), 10).then(function (rs) {
      var out = shape(rs);
      if (out.length) {
        // 名前がぴったり同じものが1件だけなら、それに決める
        var exact = out.filter(function (c) { return CA.normName(c.companyName) === CA.normName(keyword); });
        return exact.length === 1 ? exact : out;
      }
      return look(CA.nameParts(keyword), 100).then(function (rs2) {
        return shape(rs2).map(function (c) { c.score = CA.similar(keyword, c.companyName); return c; })
          .filter(function (c) { return c.score >= 0.35; })
          .sort(function (a, b) { return b.score - a.score; })
          .slice(0, 3)
          .map(function (c) { c.maybe = c.score < 1; return c; })
          .filter(function (c, i, all) { return !(all[0] && !all[0].maybe && (!all[1] || all[1].maybe)) || i === 0; });  // 記号を除いて同じ名前が1件だけなら、それに決める
      });
    });
  }

  if (typeof module !== 'undefined' && module.exports) {  // Node のテスト
    module.exports = { CA: CA, makeAnswer: makeAnswer, findCompanies: findCompanies, APP: APP };
    return;
  }

  // ================= 画面 =================
  var MOBILE = /^\/k\/m\//.test(location.pathname);
  var ME = kintone.getLoginUser();
  if (PREVIEW_USERS && PREVIEW_USERS.indexOf(ME.code) < 0) return;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var TGT = MOBILE ? '' : 'target="_blank"';  // スマホは同じ画面のまま移動する
  function recUrl(app, id) { return location.origin + (MOBILE ? '/k/m/' + app + '/show?record=' + id : '/k/' + app + '/show#record=' + id); }
  function listUrl(app, query) { return location.origin + (MOBILE ? '/k/m/' + app + '/' : '/k/' + app + '/') + '?query=' + encodeURIComponent(query.replace(/ order by .*$/, '')); }
  function dt(iso) {  // DATETIME → 日本時間 'M/D HH:MM'
    if (!iso) return '';
    var d = new Date(Date.parse(iso) + 9 * 3600000);
    return (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + ' ' + ('0' + d.getUTCHours()).slice(-2) + ':' + ('0' + d.getUTCMinutes()).slice(-2);
  }
  function cut(s, n) { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s; }
  function tel(s) { return s ? '<a href="tel:' + esc(String(s).replace(/[^\d+]/g, '')) + '">' + esc(s) + '</a>' : ''; }

  function get(app, query, fields, withTotal) {
    var p = { app: app, query: query };
    if (fields) p.fields = fields;
    if (withTotal) p.totalCount = true;
    return kintone.api(kintone.api.url('/k/v1/records', true), 'GET', p).then(function (r) {
      var recs = r.records;
      recs.totalCount = r.totalCount != null ? Number(r.totalCount) : null;
      return recs;
    });
  }
  function getAll(app, query, fields, max) {
    var out = [];
    function next(offset) {
      return get(app, query + ' limit 500 offset ' + offset, fields).then(function (rs) {
        out = out.concat(rs);
        return rs.length === 500 && out.length < max ? next(offset + 500) : out;
      });
    }
    return next(0);
  }
  var DEPS = function () { return { get: get, getAll: getAll, todayStr: CA.today(Date.now()), me: ME }; };

  // ---- 今開いている画面から会社を決める ----
  function contextFrom(appId, rec) {
    var v = CA.v;
    if (!rec) return { screen: 'list' };
    if (appId === APP.customer) return { screen: 'customer', customerNo: v(rec, '$id'), companyName: v(rec, '会社名'), phone: v(rec, '電話番号') };
    if (appId === APP.deal) return { screen: 'deal', customerNo: v(rec, '顧客No_'), companyName: v(rec, '会社名') };
    if (appId === APP.activity) return { screen: 'activity', customerNo: v(rec, '顧客No'), companyName: v(rec, '会社名') };
    if (appId === APP.lead) return { screen: 'lead', leadNo: v(rec, '$id'), companyName: v(rec, '会社名'), phone: v(rec, '電話番号') };
    return { screen: 'list' };
  }
  // 顧客とネタの対応を補う(ネタの画面なら同じ会社の顧客を、顧客の画面なら同じ会社のネタを探す)
  function complete(ctx) {
    var jobs = [];
    if (!ctx.customerNo && ctx.companyName) {
      jobs.push(get(APP.customer, '会社名 = ' + CA.q(ctx.companyName) + ' limit 1', ['$id']).then(function (r) { if (r[0]) ctx.customerNo = CA.v(r[0], '$id'); }));
    }
    if (!ctx.leadNo && (ctx.companyName || ctx.phone)) {
      var cond = ctx.phone ? '電話番号 = ' + CA.q(ctx.phone) : '会社名 = ' + CA.q(ctx.companyName);
      jobs.push(get(APP.lead, cond + ' order by レコード番号 desc limit 1', ['$id']).then(function (r) { if (r[0]) ctx.leadNo = CA.v(r[0], '$id'); }));
    }
    return Promise.all(jobs).then(function () { return ctx; }, function () { return ctx; });
  }

  // ---- 表示 ----
  function itemHtml(it) {
    if (it.group) {
      return '<div class="cai-item cai-thin">' + esc(CA.md(it.from)) + (it.from !== it.to ? '〜' + esc(CA.md(it.to)) : '') +
        ' 架電のみ(' + esc(it.sample.result) + 'など)×' + it.n + '回</div>';
    }
    return '<div class="cai-item"><div class="cai-h"><b>' + esc(CA.md(it.date)) + (it.time ? ' ' + esc(it.time) : '') + '</b> ' +
      esc(it.kind) + (it.result ? ' <span class="cai-tag">' + esc(it.result) + '</span>' : '') +
      (it.who ? ' <span class="cai-sub">' + esc(it.who) + '</span>' : '') +
      ' <a href="' + recUrl(it.app, it.id) + '" ' + TGT + '>開く</a></div>' +
      (it.text && it.text !== it.result ? '<div class="cai-t">' + esc(cut(it.text, 300)) + '</div>' : '') +
      (it.deal ? '<div class="cai-sub">案件: ' + esc(it.deal) + '</div>' : '') + '</div>';
  }
  function dealHtml(d) {
    var v = CA.v;
    var line = [v(d, '提案商品'), v(d, '商談フェーズ'), v(d, '確度') && '確度' + v(d, '確度'),
      v(d, '売上') && '¥' + Number(v(d, '売上')).toLocaleString(), v(d, '受注予定日') && '受注予定 ' + CA.md(v(d, '受注予定日')),
      v(d, '受注日') && '受注 ' + CA.md(v(d, '受注日')), v(d, '次回商談日') && '次回商談 ' + dt(v(d, '次回商談日'))].filter(Boolean).join(' / ');
    return '<div class="cai-item"><div class="cai-h"><b>' + esc(v(d, '案件名')) + '</b> <a href="' + recUrl(APP.deal, v(d, '$id')) + '" ' + TGT + '>開く</a></div>' +
      '<div>' + esc(line) + '</div>' + (CA.users(d, '主担当') ? '<div class="cai-sub">主担当: ' + esc(CA.users(d, '主担当')) + '</div>' : '') +
      (v(d, '詳細') ? '<div class="cai-t">' + esc(cut(v(d, '詳細'), 200)) + '</div>' : '') + '</div>';
  }
  function kv(label, val, raw) { return val ? '<tr><th>' + esc(label) + '</th><td>' + (raw ? val : esc(val)) + '</td></tr>' : ''; }
  function sectionHtml(s) {
    var v = CA.v, h = s.heading ? '<div class="cai-sec">' + esc(s.heading) + (s.count != null ? '(記録' + s.count + '件中)' : '') + '</div>' : '';
    if (s.type === 'items') return h + (s.items.length ? s.items.map(itemHtml).join('') : '<div class="cai-empty">' + esc(s.empty) + '</div>');
    if (s.type === 'deals') return h + (s.items.length ? s.items.map(dealHtml).join('') : '<div class="cai-empty">' + esc(s.empty || '') + '</div>');
    if (s.type === 'dates') {
      return h + (s.items.length ? s.items.map(function (r) {
        return '<div class="cai-item' + (r.late ? ' cai-late' : '') + '"><b>' + esc(r.at ? dt(r.at) : CA.md(r.date)) + '</b> ' + esc(r.label) +
          (r.late ? ' <span class="cai-tag">期限切れ</span>' : '') + (r.who ? ' <span class="cai-sub">' + esc(r.who) + '</span>' : '') +
          ' <a href="' + recUrl(r.app, r.id) + '" ' + TGT + '>開く</a></div>';
      }).join('') : '<div class="cai-empty">' + esc(s.empty) + '</div>');
    }
    if (s.type === 'contacts') {
      var out = s.items.map(function (p) {
        return '<div class="cai-item"><div class="cai-h"><b>' + esc(v(p, 'お名前')) + '</b> ' + esc([v(p, '部署'), v(p, '役職')].filter(Boolean).join(' ')) +
          (v(p, '決裁権') === 'あり' ? ' <span class="cai-tag">決裁権あり</span>' : '') + ' <a href="' + recUrl(APP.contact, v(p, '$id')) + '" ' + TGT + '>開く</a></div>' +
          '<div>' + [tel(v(p, '電話番号')), v(p, '携帯番号') ? '携帯 ' + tel(v(p, '携帯番号')) : '', v(p, 'メールアドレス') ? esc(v(p, 'メールアドレス')) : ''].filter(Boolean).join(' / ') + '</div>' +
          (v(p, '備考') ? '<div class="cai-t">' + esc(cut(v(p, '備考'), 150)) + '</div>' : '') + '</div>';
      }).join('');
      if (s.lead && v(s.lead, '担当者氏名')) out += '<div class="cai-item"><b>' + esc(v(s.lead, '担当者氏名')) + '</b> ' + esc(v(s.lead, '担当者役職')) + ' <span class="cai-sub">(ネタリスト)</span><div>' + tel(v(s.lead, '担当者携帯電話')) + '</div></div>';
      var main = s.customer ? v(s.customer, '電話番号') : s.lead ? v(s.lead, '電話番号') : '';
      if (main) out += '<div class="cai-item">代表電話: ' + tel(main) + '</div>';
      return out || '<div class="cai-empty">担当者の登録はまだありません(名刺を登録すると出ます)。</div>';
    }
    if (s.type === 'profile') {
      var c = s.customer, l = s.lead, rows = '';
      if (c) {
        rows += kv('ランク', v(c, '顧客ランク')) + kv('業種', [v(c, '大分類'), v(c, '中分類'), v(c, '業種メモ')].filter(Boolean).join(' / ')) +
          kv('営業時間', v(c, '営業時間')) + kv('定休日', v(c, '定休日')) + kv('住所', v(c, '住所')) + kv('電話', tel(v(c, '電話番号')), true) +
          kv('メモ', cut(v(c, '顧客情報メモ欄'), 300));
      }
      if (l) {
        rows += (c ? '' : kv('業種', [v(l, '大分類'), v(l, '中分類'), v(l, 'G_業種')].filter(Boolean).join(' / ')) + kv('営業時間', v(l, '営業時間') || cut(v(l, 'G_営業時間'), 120)) +
          kv('定休日', v(l, '定休日')) + kv('電話', tel(v(l, '電話番号')), true)) +
          kv('電話のおすすめ時間', v(l, '架電おすすめ時間')) +
          kv('Googleの口コミ', v(l, 'G_評価') ? '★' + v(l, 'G_評価') + '(' + (v(l, 'G_口コミ件数') || 0) + '件)' + (v(l, 'G_近隣順位') ? ' 近隣' + v(l, 'G_近隣順位') : '') : '') +
          kv('話のきっかけ', cut(v(l, '話のきっかけ'), 300)) + kv('AIの見立て', cut(v(l, 'AI_営業サマリー'), 300)) + kv('進捗', v(l, '進捗状況')) +
          (c ? '' : kv('メモ', cut(v(l, 'メモ'), 300)));
      }
      return '<table class="cai-kv">' + rows + '</table>';
    }
    if (s.type === 'counts') {
      var k = s.counts, hd = s.head, line = [];
      for (var i = 0; i < hd.length; i += 2) line.push(esc(hd[i]) + ' <b class="cai-big">' + hd[i + 1] + '</b>件');
      var useLead = k.leadCalls + k.leadVisits > 0;
      var row = function (label, a, b) { return '<tr><td>' + esc(label) + '</td><td>' + a + '</td>' + (useLead ? '<td>' + b + '</td>' : '') + '</tr>'; };
      var html = '<div class="cai-head">' + line.join(' / ') + '</div><table class="cai-tbl"><tr><th>種類</th><th>' + (useLead ? '活動履歴' : '件数') + '</th>' + (useLead ? '<th>ネタリスト</th>' : '') + '</tr>';
      html += row('架電', k.kinds['架電'] || 0, k.leadCalls);
      CA.RESULT_ORDER.forEach(function (r) { html += row('　うち ' + r, k.results[r] || 0, k.leadResults[r] || 0); });
      html += row('商談(初回)', k.kinds['商談（初回）'] || 0, '-') + row('商談(2回目以降)', k.kinds['商談（2回目以降）'] || 0, '-');
      if (useLead) html += row('飛び込み', '-', k.leadVisits);
      html += row('メール', k.kinds['メール'] || 0, '-') + '</table>';
      if (s.team) {
        var names = Object.keys(k.people).sort(function (a, b) { return k.people[b].apo - k.people[a].apo || k.people[b].calls - k.people[a].calls; });
        if (names.length) {
          html += '<div class="cai-sec">人ごと</div><table class="cai-tbl"><tr><th></th><th>架電</th><th>アポ</th><th>商談</th></tr>' +
            names.map(function (n) { var p = k.people[n]; return '<tr><td>' + esc(n) + '</td><td>' + p.calls + '</td><td>' + p.apo + '</td><td>' + p.visits + '</td></tr>'; }).join('') + '</table>';
        }
      }
      return html;
    }
    if (s.type === 'calls') {
      return '<div class="cai-sec">' + s.total + '件' + (s.total > s.items.length ? '(新しい順に' + s.items.length + '件)' : '') + '</div>' +
        (s.items.length ? s.items.map(function (r) {
          var e = r.last, info = r.info || {};
          var app = r.customerNo ? APP.customer : r.leadNo ? APP.lead : e.app, id = r.customerNo || r.leadNo || e.id;
          return '<div class="cai-item"><div class="cai-h"><b>' + esc(r.companyName) + '</b>' + (e.result ? ' <span class="cai-tag">' + esc(e.result) + '</span>' : '') +
            ' <a href="' + recUrl(app, id) + '" ' + TGT + '>開く</a></div>' +
            '<div class="cai-sub">最後 ' + esc(CA.md(e.date)) + (e.time ? ' ' + esc(e.time) : '') + ' ' + esc(e.kind) + (r.n > 1 ? '・期間中' + r.n + '回' : '') +
            (r.who.length ? '・' + esc(r.who.join('・')) : '') + '</div>' +
            (info.addr || info.phone ? '<div class="cai-sub">' + esc(cut(info.addr, 40)) + ' ' + tel(info.phone) + '</div>' : '') +
            (e.text && e.text !== e.result ? '<div class="cai-t">' + esc(cut(e.text, 120)) + '</div>' : '') + '</div>';
        }).join('') : '<div class="cai-empty">当てはまる対応はありません。上の条件を変えてみてください。</div>');
    }
    if (s.type === 'leads' || s.type === 'customers') {
      var isLead = s.type === 'leads', app = isLead ? APP.lead : APP.customer;
      var head = '<div class="cai-sec">' + (isLead ? 'ネタリスト' : '顧客管理') + ' ' + (s.total || 0) + '件' + ((s.total || 0) > s.items.length ? '(上位' + s.items.length + '件を表示・' : '(') +
        '<a href="' + listUrl(app, s.listQuery) + '" ' + TGT + '>一覧で見る</a>)</div>';
      return head + (s.items.length ? s.items.map(function (r) {
        return '<div class="cai-item"><b>' + esc(v(r, '会社名')) + '</b> <span class="cai-sub">' + esc(isLead ? v(r, '市区町村') + ' ' + (v(r, '中分類') || v(r, 'G_業種')) + ' ' + (v(r, '進捗状況') || '未着手') : v(r, '住所') + ' ' + v(r, '中分類')) +
          '</span> ' + (isLead && v(r, '電話番号') ? tel(v(r, '電話番号')) + ' ' : '') + '<a href="' + recUrl(app, v(r, '$id')) + '" ' + TGT + '>開く</a></div>';
      }).join('') : '<div class="cai-empty">当てはまるものはありません。</div>');
    }
    return '';
  }
  function viewHtml(view) {
    return '<div class="cai-title">' + esc(view.title) + (view.company ? ' <span class="cai-sub">' + esc(view.company) + '</span>' : '') + '</div>' +
      view.sections.map(sectionHtml).join('') + view.notes.map(function (n) { return '<div class="cai-note">' + esc(n) + '</div>'; }).join('') +
      (view.suggestIds ? sugHtml(view.suggestIds) : '');
  }
  function sugHtml(ids) {
    return '<div class="cai-sug">' + ids.map(function (id) {
      var pr = CA.PRESETS.filter(function (x) { return x.id === id; })[0];
      return '<button type="button" data-sug="' + esc(id) + '">' + esc(pr ? pr.label : CA.INTENT_LABEL[id]) + '</button>';
    }).join('') + '</div>';
  }
  function wireSug(out) {
    Array.prototype.forEach.call(out.querySelectorAll('button[data-sug]'), function (b) {
      b.onclick = function () { state.aiQuestion = null; state.picked = null; run(CA.presetPlan(b.getAttribute('data-sug')), out); };
    });
  }

  // ---- パネル ----
  var STYLE = [
    '#cai-btn{position:fixed;left:16px;bottom:16px;z-index:9001;padding:9px 14px;border-radius:22px;border:none;background:#0f766e;color:#fff;font-size:14px;box-shadow:0 2px 8px rgba(0,0,0,.25);cursor:pointer}',
    '#cai-btn.m{left:8px;bottom:120px}',
    '#cai-panel{position:fixed;left:0;top:0;bottom:0;width:440px;max-width:100vw;z-index:10001;background:#fff;box-shadow:2px 0 14px rgba(0,0,0,.25);display:flex;flex-direction:column;font-size:13px;color:#1e293b}',
    '#cai-panel.m{right:0;width:auto;font-size:15px}',
    '#cai-panel,#cai-panel *{box-sizing:border-box}#cai-panel .cai-out{overflow-wrap:anywhere}.cai-ask input{min-width:0}',
    '.cai-top{display:flex;align-items:center;gap:8px;padding:10px 12px;background:#0f766e;color:#fff}',
    '.cai-top b{flex:1}.cai-top button{background:none;border:none;color:#fff;font-size:20px;cursor:pointer}',
    '.cai-ctx{padding:6px 12px;background:#f0fdfa;color:#134e4a;font-size:12px}',
    '.cai-chips{display:flex;flex-wrap:wrap;gap:6px;padding:8px 12px;border-bottom:1px solid #e2e8f0}',
    '.cai-chips button{padding:5px 10px;border-radius:14px;border:1px solid #0f766e;background:#fff;color:#0f766e;cursor:pointer;font-size:12px}',
    '#cai-panel.m .cai-chips button{font-size:14px;padding:7px 12px}',
    '.cai-ask{display:flex;gap:6px;padding:8px 12px;border-bottom:1px solid #e2e8f0}',
    '.cai-ask input{flex:1;padding:7px 8px;border:1px solid #cbd5e1;border-radius:4px;font-size:inherit}',
    '.cai-ask button{padding:7px 12px;border:none;border-radius:4px;background:#0f766e;color:#fff;cursor:pointer}',
    '.cai-hint{padding:0 12px 6px;color:#64748b;font-size:11px}',
    '.cai-out{flex:1;overflow:auto;padding:10px 12px}',
    '.cai-title{font-weight:bold;font-size:15px;margin-bottom:8px}',
    '.cai-sec{font-weight:bold;margin:12px 0 4px;color:#0f766e}',
    '.cai-item{border-bottom:1px solid #f1f5f9;padding:6px 0}',
    '.cai-thin{color:#64748b}.cai-late b{color:#b91c1c}',
    '.cai-t{white-space:pre-wrap;margin-top:2px}',
    '.cai-sub{color:#64748b;font-size:12px}',
    '.cai-tag{display:inline-block;padding:0 6px;border-radius:8px;background:#e2e8f0;font-size:11px}',
    '.cai-empty,.cai-note{color:#64748b;margin:8px 0}',
    '.cai-kv{border-collapse:collapse;width:100%}.cai-kv th{text-align:left;white-space:nowrap;color:#64748b;font-weight:normal;padding:3px 8px 3px 0;vertical-align:top}.cai-kv td{padding:3px 0;white-space:pre-wrap}',
    '.cai-tbl{border-collapse:collapse;margin:6px 0}.cai-tbl th,.cai-tbl td{border:1px solid #e2e8f0;padding:3px 8px;text-align:right}.cai-tbl td:first-child{text-align:left}',
    '.cai-head{margin:6px 0}.cai-big{font-size:18px;color:#0f766e}',
    '.cai-foot{padding:6px 12px;color:#94a3b8;font-size:11px;border-top:1px solid #e2e8f0}',
    '.cai-bar{padding:4px 12px;border-bottom:1px solid #e2e8f0;background:#f8fafc;font-size:12px}',
    '.cai-bar summary{cursor:pointer;color:#0f766e;padding:2px 0}',
    '#cai-panel.m .cai-bar{font-size:14px}',
    '.cai-row{display:flex;flex-wrap:wrap;align-items:center;gap:4px 6px;margin:4px 0}',
    '.cai-row>span{color:#64748b}',
    '.cai-row select,.cai-row input[type=text],.cai-row input[type=number]{padding:3px 4px;border:1px solid #cbd5e1;border-radius:4px;font-size:inherit;max-width:100%;background:#fff}',
    '.cai-row input[type=number]{width:56px}.cai-row input[type=text]{width:96px}',
    '.cai-res label{display:inline-flex;align-items:center;gap:2px;margin-right:4px;white-space:nowrap}',
    '.cai-row button{padding:3px 8px;border:1px solid #cbd5e1;border-radius:4px;background:#fff;cursor:pointer;font-size:inherit}',
    '.cai-fb{display:flex;gap:4px;width:100%}.cai-row .cai-fb input[type=text]{flex:1;width:auto}',
    '.cai-sug{margin:8px 0;display:flex;flex-wrap:wrap;gap:6px}',
    '.cai-sug button{padding:5px 10px;border-radius:14px;border:1px solid #0f766e;background:#fff;color:#0f766e;cursor:pointer;font-size:inherit}',
  ].join('\n');

  var state = { ctx: null, appId: null, plan: null, picked: null, aiQuestion: null, aiPlan: null };

  // ---- 条件の欄(AIの読み取りを見せて、その場で直せるようにする) ----
  var PERIOD_OPTS = [['today', '今日'], ['yesterday', '昨日'], ['this_week', '今週'], ['last_week', '先週'], ['this_month', '今月'], ['last_month', '先月'], ['last_n_days', '直近○日']];
  var INTENT_OPTS = ['call_list', 'my_counts', 'team_counts', 'follow_up', 'find_company', 'last_contact', 'history', 'contacts', 'deals', 'next_action', 'before_call', 'refusals'];
  function sel(k, opts, cur) {
    return '<select data-k="' + k + '">' + opts.map(function (o) {
      return '<option value="' + esc(o[0]) + '"' + (o[0] === cur ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
    }).join('') + '</select>';
  }
  function renderBar(bar, plan, out) {
    var it = plan.intent, f = plan.filters;
    if (it === 'unknown') { bar.innerHTML = ''; bar.style.display = 'none'; return; }
    bar.style.display = '';
    var counts = it === 'my_counts' || it === 'team_counts', listy = counts || it === 'call_list';
    var h = '<div class="cai-row"><span>読み取り</span>' + sel('intent', INTENT_OPTS.map(function (i) { return [i, CA.INTENT_LABEL[i]]; }), it) + '</div>';
    if (listy) {
      var pt = plan.period.type === 'none' ? (it === 'call_list' ? 'last_n_days' : 'this_month') : plan.period.type;
      var po = PERIOD_OPTS.slice();
      if (pt === 'month') { var mr = CA.period(plan.period, CA.today(Date.now())); po.unshift(['month', mr ? mr.label.replace(/\(.*$/, '') : '指定の月']); }
      h += '<div class="cai-row"><span>期間</span>' + sel('period', po, pt) +
        (pt === 'last_n_days' ? '<input type="number" data-k="days" min="1" max="90" value="' + (plan.period.days || 7) + '">日' : '') + '</div>';
      h += '<div class="cai-row"><span>人</span>' + sel('who', [['me', '自分'], ['all', '全員']], it === 'my_counts' ? 'me' : it === 'team_counts' ? 'all' : plan.who) +
        '<span>種類</span>' + sel('kind', [['', '全部'], ['架電', '架電'], ['商談', '訪問(商談)'], ['メール', 'メール']], f.kind) + '</div>';
      h += '<div class="cai-row cai-res"><span>結果</span>' + CA.RESULT_ORDER.map(function (r) {
        return '<label><input type="checkbox" data-r="' + esc(r) + '"' + (f.results.indexOf(r) >= 0 ? ' checked' : '') + '>' + esc(r) + '</label>';
      }).join('') + '</div>';
    }
    if (it === 'call_list' || it === 'find_company') {
      h += '<div class="cai-row"><span>地域</span><input type="text" data-k="area" maxlength="10" value="' + esc(f.area) + '" placeholder="例 中央区">' +
        '<span>業種</span><input type="text" data-k="category" maxlength="15" value="' + esc(f.category) + '" placeholder="例 美容室"></div>';
    }
    if (it === 'find_company') h += '<div class="cai-row"><span>進捗</span>' + sel('progress', [['', '指定なし'], ['未着手', 'まだ架電していない'], ['架電済み', '架電済み'], ['失注', '失注']], f.progress) + '</div>';
    if (state.aiQuestion) {
      h += '<div class="cai-row"><span>AIに聞いた文:「' + esc(cut(state.aiQuestion, 40)) + '」</span>' + (FEEDBACK_APP ? '<button type="button" class="cai-ng">👎 違った</button>' : '') + '</div>';
    }
    var open = !MOBILE || listy || it === 'find_company';
    bar.innerHTML = '<details' + (open ? ' open' : '') + '><summary>条件(違っていたらここで直せます)</summary>' + h + '</details>';
    function g(k) { return bar.querySelector('[data-k="' + k + '"]'); }
    function readPlan(changed) {
      var p = CA.normPlan(state.plan);
      var ni = g('intent').value;
      if (ni !== p.intent) {  // 種類を変えたら、その種類の初めの条件に寄せる
        if (ni === 'my_counts') p.who = 'me';
        if (ni === 'team_counts') p.who = 'all';
        if (ni === 'call_list' && !p.filters.kind) p.filters.kind = '架電';
        p.intent = ni;
        p.target = CA.COMPANY_INTENTS.indexOf(ni) >= 0 ? 'current' : 'none';
        return p;
      }
      if (g('period')) {
        var t = g('period').value, dv = g('days') ? Math.floor(+g('days').value) : 7;
        p.period = { type: t, month: t === 'month' ? p.period.month : '', days: t === 'last_n_days' ? Math.max(1, Math.min(90, dv || 7)) : 0 };
      }
      if (g('who')) {
        p.who = g('who').value;
        if (p.intent === 'my_counts' || p.intent === 'team_counts') p.intent = p.who === 'me' ? 'my_counts' : 'team_counts';
      }
      if (g('kind')) p.filters.kind = g('kind').value;
      if (bar.querySelector('[data-r]')) {
        p.filters.results = Array.prototype.filter.call(bar.querySelectorAll('[data-r]'), function (c) { return c.checked; }).map(function (c) { return c.getAttribute('data-r'); });
        p.filters.result = p.filters.results[0] || '';
      }
      if (g('area')) p.filters.area = g('area').value.trim().slice(0, 10);
      if (g('category')) p.filters.category = g('category').value.trim().slice(0, 15);
      if (g('progress')) p.filters.progress = g('progress').value;
      return p;
    }
    Array.prototype.forEach.call(bar.querySelectorAll('select,input'), function (el) {
      el.onchange = function () {
        var np = readPlan(el);
        run(np, out, CA.COMPANY_INTENTS.indexOf(np.intent) >= 0 ? state.picked : null, { keepAi: true });
      };
    });
    var ng = bar.querySelector('.cai-ng');
    if (ng) ng.onclick = function () { showFeedback(ng.parentNode); };
  }
  // 「違った」: 質問の文・AIの読み取り・直した条件を社内の kintone(改善メモ)に残す。AIには送らない
  function showFeedback(row) {
    if (row.querySelector('.cai-fb')) return;
    var box = document.createElement('span');
    box.className = 'cai-fb';
    box.innerHTML = '<input type="text" maxlength="200" placeholder="どう違った?(空でも送れます)"><button type="button">送る</button>';
    row.appendChild(box);
    var input = box.querySelector('input');
    box.querySelector('button').onclick = function () {
      kintone.api(kintone.api.url('/k/v1/record', true), 'POST', {
        app: FEEDBACK_APP,
        record: {
          質問: { value: String(state.aiQuestion || '').slice(0, 200) },
          AI読み取り: { value: JSON.stringify(state.aiPlan || {}) },
          直した条件: { value: JSON.stringify(state.plan || {}) },
          画面: { value: ((state.ctx && state.ctx.screen) || 'list') + ' app' + state.appId + (MOBILE ? ' スマホ' : ' PC') },
          一言: { value: input.value.slice(0, 200) },
        },
      }).then(function () { box.innerHTML = ' 送りました。直すときの参考にします。'; },
        function () { box.innerHTML = ' 送れませんでした。'; });
    };
    input.focus();
  }

  function ensureStyle() {
    if (document.getElementById('cai-style')) return;
    var st = document.createElement('style');
    st.id = 'cai-style';
    st.textContent = STYLE;
    document.head.appendChild(st);
  }
  function showButton(appId, rec) {
    ensureStyle();
    state.appId = appId;
    state.ctx = contextFrom(appId, rec);
    var b = document.getElementById('cai-btn');
    if (!b) {
      b = document.createElement('button');
      b.id = 'cai-btn';
      b.type = 'button';
      b.textContent = '🔍 お客様AI';
      if (MOBILE) b.className = 'm';
      b.onclick = openPanel;
      document.body.appendChild(b);
    }
    var p = document.getElementById('cai-panel');
    if (p) p.parentNode.removeChild(p);
  }

  function openPanel() {
    var old = document.getElementById('cai-panel');
    if (old) { old.parentNode.removeChild(old); return; }
    var ctx = state.ctx || { screen: 'list' };
    var p = document.createElement('div');
    p.id = 'cai-panel';
    if (MOBILE) p.className = 'm';
    var company = !!ctx.companyName;
    p.innerHTML = '<div class="cai-top"><b>🔍 お客様AI</b><button type="button" title="閉じる">×</button></div>' +
      '<div class="cai-ctx">' + (company ? '今開いている会社: <b>' + esc(ctx.companyName) + '</b>' : '会社を開いていません(件数・会社探しの質問ができます)') + '</div>' +
      '<div class="cai-chips">' + CA.PRESETS.filter(function (x) { return company || !x.company; }).map(function (x) {
        return '<button type="button" data-id="' + x.id + '">' + esc(x.label) + '</button>';
      }).join('') + '</div>' +
      (GAS_URL ? '<div class="cai-ask"><input type="text" maxlength="200" placeholder="' + (company ? '例: 前回どうだった? 決裁者は?' : '例: ここ10日で不在かコールのみだった店') + '"><button type="button">聞く</button></div>' +
        '<div class="cai-hint">' + (company ? '会社名や人の名前は入れなくて大丈夫です(今開いている会社について答えます)。' : '答えのあと、上に出る「条件」で期間・人・結果・地域を直せます。') + '</div>' : '') +
      '<div class="cai-bar" style="display:none"></div>' +
      '<div class="cai-out"></div>' +
      '<div class="cai-foot">' + (GAS_URL ? 'AI(Gemini)に送るのは質問の文だけです。お客様の記録は送りません。' : 'この画面の中だけで記録を探しています(AIは使っていません)。') + ' 見られる範囲はあなたの権限どおりです。</div>';
    document.body.appendChild(p);
    var out = p.querySelector('.cai-out');
    p.querySelector('.cai-top button').onclick = function () { p.parentNode.removeChild(p); };
    Array.prototype.forEach.call(p.querySelectorAll('.cai-chips button'), function (b) {
      b.onclick = function () { state.aiQuestion = null; state.picked = null; run(CA.presetPlan(b.getAttribute('data-id')), out); };
    });
    var input = p.querySelector('.cai-ask input');
    if (input) {
      var ask = function () {
        var text = input.value.trim();
        if (text) askAi(text, out);
      };
      p.querySelector('.cai-ask button').onclick = ask;
      input.onkeydown = function (e) { if (e.key === 'Enter' && !e.isComposing) ask(); };
      if (!MOBILE) input.focus();
    }
  }

  function busy(out, msg) { out.innerHTML = '<div class="cai-note">' + esc(msg) + '</div>'; }

  function run(plan, out, ctxOverride) {
    busy(out, '探しています…');
    plan = CA.normPlan(plan);
    state.plan = plan;
    var bar = out.parentNode.querySelector('.cai-bar');
    if (bar) renderBar(bar, plan, out);
    var base = ctxOverride || state.ctx || { screen: 'list' };
    var ctx = {};
    Object.keys(base).forEach(function (k) { ctx[k] = base[k]; });
    var deps = DEPS();
    var start = plan.target === 'keyword' && plan.companyKeyword
      ? findCompanies(plan.companyKeyword, deps).then(function (cands) {
        if (cands.length === 1 && !cands[0].maybe) {
          state.picked = { screen: 'list', customerNo: cands[0].customerNo, leadNo: cands[0].leadNo, companyName: cands[0].companyName };
          return Object.assign(ctx, cands[0], { screen: 'list' });
        }
        out.innerHTML = '<div class="cai-title">「' + esc(plan.companyKeyword) + '」</div>' +
          (cands.length ? '<div class="cai-note">' + (cands[0].maybe ? 'その名前では見つかりませんでした。もしかして:' : 'どの会社ですか?') + '</div>' + cands.map(function (c, i) {
            return '<div class="cai-item"><a href="#" data-i="' + i + '">' + esc(c.companyName) + '</a> <span class="cai-sub">' + esc(c.sub) + '</span></div>';
          }).join('') : '<div class="cai-empty">その名前の会社は顧客管理にもネタリストにも見つかりませんでした。</div>');
        Array.prototype.forEach.call(out.querySelectorAll('a[data-i]'), function (a) {
          a.onclick = function (e) {
            e.preventDefault();
            var c = cands[+a.getAttribute('data-i')];
            state.picked = { screen: 'list', customerNo: c.customerNo, leadNo: c.leadNo, companyName: c.companyName };
            run(Object.assign({}, plan, { target: 'current', companyKeyword: '' }), out, state.picked);
          };
        });
        return null;
      })
      : Promise.resolve(ctx);
    start.then(function (c) {
      if (!c) return null;
      return complete(c).then(function (c2) { return makeAnswer(plan, c2, deps).then(function (view) { return [view, c2]; }); }).then(function (x) {
        var view = x[0];
        if (view.suggest) view.suggestIds = CA.suggest(state.aiQuestion, !!x[1].companyName);
        out.innerHTML = viewHtml(view);
        wireSug(out);
      });
    }).catch(function (err) {
      console.error('お客様AI', err);
      busy(out, '記録を読めませんでした。少し待ってからもう一度押してください。');
    });
  }

  function askAi(text, out) {
    busy(out, '質問を読み取っています…');
    state.aiQuestion = text.slice(0, 200);
    state.aiPlan = null;
    state.picked = null;
    var bar0 = out.parentNode.querySelector('.cai-bar');
    if (bar0) { bar0.innerHTML = ''; bar0.style.display = 'none'; }
    var company = !!(state.ctx && state.ctx.companyName);
    var fail = function (msg) {
      out.innerHTML = '<div class="cai-note">' + esc(msg) + '</div><div class="cai-note">近いもの:</div>' + sugHtml(CA.suggest(text, company));
      wireSug(out);
    };
    var q = text.replace(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g, '(メール)')
      .replace(/(?:\+81[\s\-]?)?0\d{1,4}[\s\-()（）]?\d{1,4}[\s\-()（）]?\d{3,4}/g, '(電話番号)').slice(0, 200);
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 25000);
    fetch(GAS_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ q: q, screen: (state.ctx && state.ctx.screen) || 'list' }), signal: ctl ? ctl.signal : undefined })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        clearTimeout(timer);
        if (res && res.ok && res.plan) {
          state.aiPlan = res.plan;
          return run(res.plan, out);
        }
        fail(res && res.reason === 'limit' ? '今日はAIへの質問の上限に達しました。ボタンは使えます。' : 'AIが混み合っています。ボタンを使うか、少し待ってからもう一度聞いてください。');
      })
      .catch(function () {
        clearTimeout(timer);
        fail('AIにつながりませんでした。ボタンは使えます。');
      });
  }

  var DETAIL = ['app.record.detail.show', 'mobile.app.record.detail.show'];
  var INDEX = ['app.record.index.show', 'mobile.app.record.index.show'];
  function appId() { return Number(MOBILE ? kintone.mobile.app.getId() : kintone.app.getId()); }
  kintone.events.on(DETAIL, function (event) { showButton(appId(), event.record); return event; });
  kintone.events.on(INDEX, function (event) { showButton(appId(), null); return event; });
})();
