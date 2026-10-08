/*
 * 営業日報(app32)「日報ボード」
 * PCはカスタマイズ一覧「日報ボード」(<div id="dboard-root"></div>)、
 * スマホは0件の一覧「日報ボード(スマホ)」(レコード番号 = 0)のヘッダーに描画する。
 *
 * ① 今日のチーム: 直近30日に日報を出した人を1人1枚のカードで表示(訪問・架電・アポ・見込み・受注)。未提出は「まだ」とグレー
 * ② 今月のチーム目標: チーム目標(app37)の当月レコードに対する達成率。営業日ベースの「ペース」の目印付き。空欄の目標は出さない
 * ③ Good News: 直近14日の明細で区分が受注/アポ獲得/見込みの行(会社名と区分だけ。内容のメモは出さない)
 * ④ バッジ: 🔥連続提出(平日。土日は休みでも途切れない。当日未提出なら前日まで)/🏆自己ベスト(過去3件以上あるとき)/🎉初受注
 * ⑤ 👏拍手: その日報のコメント欄に一言を書き込む
 *
 * 件数の数え方: 訪問=訪問件数（合計）、架電=明細の区分「架電」の行数、アポ・見込み=欄の値と明細の行数の大きい方、受注=受注件数
 * 明細は会社名も内容も空の行(区分の初期値だけの行)を数えない
 *
 * PREVIEW_USERS に人を並べると、その人だけに表示し他の人には「準備中」と出す(null で全員に表示)
 */
(function () {
  'use strict';

  var APP_REPORT = 32;
  var APP_GOAL = 37;
  var VIEW_PC = '日報ボード';
  var VIEW_MOBILE = '日報ボード(スマホ)';
  var PREVIEW_USERS = null; // 2026-10-09 全員公開。試験公開に戻すときは ['taimei.sol@gmail.com', 'takeitomoharu.taimeis@outlook.jp']
  var MEMBER_DAYS = 30;
  var NEWS_DAYS = 14;
  var NEWS_LIMIT = 12;
  var CLAP_TEXT = '👏 ナイスファイト！';

  var IS_MOBILE = false;
  var state = { date: null, root: null, reports: null, goal: undefined, goalMonth: null };

  // ---------- 小物 ----------
  function esc(s) {
    return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fv(obj, code, fallback) {
    return obj && obj[code] && obj[code].value !== undefined && obj[code].value !== null ? obj[code].value : fallback;
  }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function pad(n) { return ('0' + n).slice(-2); }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseYmd(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(s, n) { var d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }
  function isWeekend(s) { var w = parseYmd(s).getDay(); return w === 0 || w === 6; }
  function yen(n) { return '￥' + Math.round(n).toLocaleString('ja-JP'); }
  function label(s) {
    var d = parseYmd(s);
    return (d.getMonth() + 1) + '/' + d.getDate() + '(' + '日月火水木金土'.charAt(d.getDay()) + ')';
  }

  function getAll(app, query, fields) {
    var out = [];
    function page(lastId) {
      var q = (query ? '(' + query + ') and ' : '') + '$id > ' + lastId + ' order by $id asc limit 500';
      return kintone.api(kintone.api.url('/k/v1/records', true), 'GET', { app: app, query: q, fields: fields })
        .then(function (resp) {
          out = out.concat(resp.records);
          if (resp.records.length < 500) return out;
          return page(resp.records[resp.records.length - 1].$id.value);
        });
    }
    return page(0);
  }

  // ---------- 集計 ----------
  function realRows(rec) {
    return fv(rec, '活動明細', []).filter(function (row) {
      return fv(row.value, '明細_会社名', '') || fv(row.value, '内容', '') || fv(row.value, '明細_案件No', '');
    });
  }
  function countKind(rows, kind) {
    return rows.filter(function (r) { return fv(r.value, '区分', '') === kind; }).length;
  }
  function metrics(rec) {
    var rows = realRows(rec);
    return {
      visit: num(fv(rec, '訪問合計', 0)),
      call: countKind(rows, '架電'),
      apo: Math.max(num(fv(rec, 'アポ件数', 0)), countKind(rows, 'アポ獲得')),
      lead: Math.max(num(fv(rec, '見込み件数', 0)), countKind(rows, '見込み')),
      order: num(fv(rec, '受注件数', 0)),
      amount: num(fv(rec, '受注金額合計', 0))
    };
  }
  function reporter(rec) {
    var u = fv(rec, '報告者', [])[0];
    return u ? { code: u.code, name: u.name } : null;
  }

  // 人ごとの {日付: [日報...]}(同じ日に2件あっても合算する)
  function indexByUser(reports) {
    var by = {};
    reports.forEach(function (r) {
      var u = reporter(r);
      if (!u) return;
      var d = fv(r, '日付', '');
      if (!by[u.code]) by[u.code] = { name: u.name, days: {} };
      (by[u.code].days[d] = by[u.code].days[d] || []).push(r);
    });
    return by;
  }
  function sumMetrics(recs) {
    var m = { visit: 0, call: 0, apo: 0, lead: 0, order: 0, amount: 0 };
    recs.forEach(function (r) { var x = metrics(r); Object.keys(m).forEach(function (k) { m[k] += x[k]; }); });
    return m;
  }

  function streak(days, date, today) {
    var d = date, n = 0, guard = 0;
    if (!days[d] && d === today) d = addDays(d, -1);
    while (guard++ < 400) {
      if (days[d]) n++;
      else if (!isWeekend(d)) break;
      d = addDays(d, -1);
    }
    return n;
  }

  function badges(user, date, today) {
    var out = [];
    var s = streak(user.days, date, today);
    if (s >= 2) out.push({ cls: 'fire', text: '🔥 ' + s + '日連続' });
    var todays = user.days[date];
    if (!todays) return out;
    var cur = sumMetrics(todays);
    var past = Object.keys(user.days).filter(function (d) { return d < date; });
    if (cur.order > 0 && !past.some(function (d) { return sumMetrics(user.days[d]).order > 0; })) {
      out.push({ cls: 'gold', text: '🎉 初受注！' });
    }
    if (past.length >= 3) {
      [['visit', '訪問'], ['call', '架電'], ['apo', 'アポ']].forEach(function (p) {
        var best = 0;
        past.forEach(function (d) { best = Math.max(best, sumMetrics(user.days[d])[p[0]]); });
        if (cur[p[0]] > 0 && cur[p[0]] > best) out.push({ cls: 'gold', text: '🏆 自己ベスト ' + p[1] + cur[p[0]] });
      });
    }
    return out;
  }

  function weekdaysBetween(from, to) {
    var n = 0, d = from;
    while (d <= to) { if (!isWeekend(d)) n++; d = addDays(d, 1); }
    return n;
  }

  function newsItems(reports, date) {
    var from = addDays(date, -(NEWS_DAYS - 1));
    var rank = { '受注': 3, 'アポ獲得': 2, '見込み': 1 };
    var items = [];
    reports.forEach(function (r) {
      var d = fv(r, '日付', '');
      var u = reporter(r);
      if (!u || d < from || d > date) return;
      realRows(r).forEach(function (row) {
        var kind = fv(row.value, '区分', '');
        if (!rank[kind]) return;
        items.push({
          date: d, name: u.name, kind: kind, rank: rank[kind], id: r.$id.value,
          company: fv(row.value, '明細_会社名', '') || fv(row.value, '明細_案件名', ''),
          amount: kind === '受注' ? num(fv(row.value, '金額', 0)) : 0
        });
      });
    });
    items.sort(function (a, b) { return a.date !== b.date ? (a.date < b.date ? 1 : -1) : b.rank - a.rank; });
    return items.slice(0, NEWS_LIMIT);
  }

  // ---------- データ取得 ----------
  function loadReports() {
    return getAll(APP_REPORT, '', ['$id', '日付', '報告者', '訪問合計', 'アポ件数', '見込み件数', '受注件数', '受注金額合計', '活動明細'])
      .then(function (recs) { state.reports = recs; });
  }
  function loadGoal(date) {
    var month = date.slice(0, 7);
    if (state.goalMonth === month) return Promise.resolve();
    var first = month + '-01';
    var last = ymd(new Date(+month.slice(0, 4), +month.slice(5, 7), 0));
    return kintone.api(kintone.api.url('/k/v1/records', true), 'GET', {
      app: APP_GOAL, query: '対象月 >= "' + first + '" and 対象月 <= "' + last + '" limit 1'
    }).then(function (resp) {
      state.goal = resp.records[0] || null;
      state.goalMonth = month;
    }, function () {
      // 目標アプリを見られない人は目標欄を出さない
      state.goal = null;
      state.goalMonth = month;
    });
  }
  function loadCommentCounts(ids) {
    var counts = {};
    return Promise.all(ids.map(function (id) {
      return kintone.api(kintone.api.url('/k/v1/record/comments', true), 'GET',
        { app: APP_REPORT, record: id, order: 'desc', limit: 10 })
        .then(function (resp) { counts[id] = resp.comments.length + (resp.older ? '+' : ''); },
          function () { counts[id] = 0; });
    })).then(function () { return counts; });
  }

  // ---------- 描画 ----------
  function recordUrl(id) { return IS_MOBILE ? '/k/m/' + APP_REPORT + '/show?record=' + id : '/k/' + APP_REPORT + '/show#record=' + id; }

  function goalHtml(date) {
    var g = state.goal;
    if (!g) {
      return '<section class="db-sec"><h3>🎯 今月のチーム目標</h3><p class="db-muted">今月の目標はまだ登録されていません。</p></section>';
    }
    var month = date.slice(0, 7);
    var monthRecs = state.reports.filter(function (r) { return fv(r, '日付', '').slice(0, 7) === month && fv(r, '日付', '') <= date; });
    var m = sumMetrics(monthRecs);
    var first = month + '-01';
    var last = ymd(new Date(+month.slice(0, 4), +month.slice(5, 7), 0));
    var pace = weekdaysBetween(first, date) / Math.max(1, weekdaysBetween(first, last));
    var defs = [
      ['アポ目標', 'アポ獲得', m.apo, '件'], ['受注件数目標', '受注件数', m.order, '件'], ['受注金額目標', '受注金額', m.amount, '円'],
      ['訪問目標', '訪問件数', m.visit, '件'], ['架電目標', '架電件数', m.call, '件']
    ];
    var bars = defs.filter(function (d) { return fv(g, d[0], '') !== ''; }).map(function (d) {
      var target = num(fv(g, d[0], 0));
      var rate = target > 0 ? d[2] / target : 0;
      var done = rate >= 1;
      var fmt = function (n) { return d[3] === '円' ? yen(n) : n + d[3]; };
      return '<div class="db-goal' + (done ? ' done' : '') + '">' +
        '<div class="db-goal-head"><span>' + esc(d[1]) + '</span><span><b>' + esc(fmt(d[2])) + '</b> / ' + esc(fmt(target)) +
        ' <em>' + Math.floor(rate * 100) + '%' + (done ? ' 達成🎉' : '') + '</em></span></div>' +
        '<div class="db-bar"><i style="width:' + Math.min(100, rate * 100) + '%"></i>' +
        '<s style="left:' + Math.min(100, pace * 100) + '%" title="今日までのペースの目安"></s></div></div>';
    }).join('');
    var word = fv(g, 'ひとこと', '');
    return '<section class="db-sec"><h3>🎯 ' + (+month.slice(5, 7)) + '月のチーム目標</h3>' +
      (word ? '<p class="db-word">' + esc(word) + '</p>' : '') +
      (bars || '<p class="db-muted">目標の数字が入っていません。</p>') +
      '<p class="db-note">縦線は「今日までに進んでいたい目安」(営業日ベース)</p></section>';
  }

  function cardHtml(user, code, date, today, counts) {
    var recs = user.days[date];
    var bs = badges(user, date, today).map(function (b) { return '<span class="db-badge ' + b.cls + '">' + esc(b.text) + '</span>'; }).join('');
    if (!recs) {
      return '<div class="db-card empty"><div class="db-name">' + esc(user.name) + '</div>' +
        '<div class="db-wait">まだ</div>' + (bs ? '<div class="db-badges">' + bs + '</div>' : '') + '</div>';
    }
    var m = sumMetrics(recs);
    var id = recs[0].$id.value;
    var stat = function (n, l, cls) {
      return '<div class="db-stat' + (n > 0 ? ' on ' + cls : '') + '"><b>' + n + '</b><span>' + l + '</span></div>';
    };
    var c = counts[id] || 0;
    return '<div class="db-card' + (m.order > 0 ? ' win' : m.apo > 0 ? ' apo' : '') + '">' +
      '<a class="db-name" href="' + recordUrl(id) + '">' + esc(user.name) + ' <small>日報を見る ›</small></a>' +
      '<div class="db-stats">' + stat(m.visit, '訪問', 'blue') + stat(m.call, '架電', 'blue') + stat(m.apo, 'アポ', 'green') +
      stat(m.lead, '見込み', 'green') + stat(m.order, '受注', 'gold') + '</div>' +
      (m.amount > 0 ? '<div class="db-amount">受注 ' + esc(yen(m.amount)) + '</div>' : '') +
      (bs ? '<div class="db-badges">' + bs + '</div>' : '') +
      '<div class="db-foot"><button type="button" class="db-clap" data-id="' + id + '" data-name="' + esc(user.name) + '">👏 拍手</button>' +
      '<span class="db-cmt">💬 ' + esc(c) + '</span></div></div>';
  }

  function newsHtml(date) {
    var items = newsItems(state.reports, date);
    var icon = { '受注': '🎉', 'アポ獲得': '📅', '見込み': '🌱' };
    var body = items.length ? items.map(function (it) {
      return '<li><a href="' + recordUrl(it.id) + '"><span class="db-ndate">' + esc(label(it.date)) + '</span>' +
        icon[it.kind] + ' <b>' + esc(it.name) + '</b>さんが' + (it.company ? '<b>' + esc(it.company) + '</b>で' : '') +
        '<span class="db-kind k' + it.rank + '">' + esc(it.kind) + '</span>' + (it.amount ? ' ' + esc(yen(it.amount)) : '') + '</a></li>';
    }).join('') : '<li class="db-muted">直近' + NEWS_DAYS + '日のGood Newsはまだありません。最初の1件を取りに行こう！</li>';
    return '<section class="db-sec"><h3>📣 Good News(直近' + NEWS_DAYS + '日)</h3><ul class="db-news">' + body + '</ul></section>';
  }

  function render() {
    var root = state.root;
    var today = ymd(new Date());
    var date = state.date;
    var by = indexByUser(state.reports);
    var from = addDays(date, -(MEMBER_DAYS - 1));
    var codes = Object.keys(by).filter(function (c) {
      return Object.keys(by[c].days).some(function (d) { return d >= from && d <= date; });
    });
    // 提出済み→未提出、その中は名前順
    codes.sort(function (a, b) {
      var sa = by[a].days[date] ? 0 : 1, sb = by[b].days[date] ? 0 : 1;
      return sa !== sb ? sa - sb : by[a].name.localeCompare(by[b].name, 'ja');
    });
    var submitted = codes.filter(function (c) { return by[c].days[date]; });
    var team = sumMetrics(submitted.reduce(function (a, c) { return a.concat(by[c].days[date]); }, []));
    var ids = submitted.map(function (c) { return by[c].days[date][0].$id.value; });

    root.innerHTML = '<div class="db-loading">読み込み中…</div>';
    loadCommentCounts(ids).then(function (counts) {
      root.innerHTML =
        '<div class="db-top"><button type="button" class="db-nav" data-move="-1">‹ 前の日</button>' +
        '<div class="db-date">' + esc(label(date)) + (date === today ? ' <span>今日</span>' : '') + '</div>' +
        '<button type="button" class="db-nav" data-move="1"' + (date >= today ? ' disabled' : '') + '>次の日 ›</button>' +
        (date !== today ? '<button type="button" class="db-nav" data-move="today">今日へ</button>' : '') + '</div>' +
        '<div class="db-grid">' +
        '<div class="db-main"><section class="db-sec"><h3>👥 ' + (date === today ? '今日' : esc(label(date))) + 'のチーム' +
        '<span class="db-sub">提出 ' + submitted.length + ' / ' + codes.length + '人 ・ チーム合計 訪問' + team.visit +
        ' 架電' + team.call + ' アポ' + team.apo + ' 見込み' + team.lead + ' 受注' + team.order + '</span></h3>' +
        '<div class="db-cards">' + (codes.length ? codes.map(function (c) { return cardHtml(by[c], c, date, today, counts); }).join('')
          : '<p class="db-muted">直近' + MEMBER_DAYS + '日に日報を出した人がいません。</p>') + '</div></section></div>' +
        '<div class="db-side">' + goalHtml(date) + newsHtml(date) + '</div></div>';
    });
  }

  function onClick(e) {
    var t = e.target.closest ? e.target.closest('button') : null;
    if (!t || !state.root.contains(t)) return;
    if (t.classList.contains('db-nav')) {
      var mv = t.getAttribute('data-move');
      state.date = mv === 'today' ? ymd(new Date()) : addDays(state.date, +mv);
      loadGoal(state.date).then(render);
    } else if (t.classList.contains('db-clap')) {
      var text = window.prompt(t.getAttribute('data-name') + 'さんの日報にひとこと(コメント欄に書き込みます)', CLAP_TEXT);
      if (!text) return;
      t.disabled = true;
      kintone.api(kintone.api.url('/k/v1/record/comment', true), 'POST',
        { app: APP_REPORT, record: t.getAttribute('data-id'), comment: { text: text } })
        .then(function () { t.textContent = '👏 送りました'; render(); },
          function (err) { t.disabled = false; window.alert('書き込めませんでした: ' + (err && err.message ? err.message : '')); });
    }
  }

  function injectStyle() {
    if (document.getElementById('dboard-style')) return;
    var st = document.createElement('style');
    st.id = 'dboard-style';
    st.textContent = [
      '.dboard{font-size:14px;color:#333;padding:12px 16px 24px;max-width:1280px;box-sizing:border-box}',
      '.dboard *{box-sizing:border-box}',
      '.db-top{display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap}',
      '.db-date{font-size:20px;font-weight:bold;min-width:120px;text-align:center}',
      '.db-date span{font-size:12px;background:#3498db;color:#fff;border-radius:10px;padding:2px 8px;vertical-align:middle}',
      '.db-nav{border:1px solid #c9d3dd;background:#fff;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:13px}',
      '.db-nav:disabled{opacity:.4;cursor:default}',
      '.db-grid{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:16px;align-items:start}',
      '.db-sec{background:#fff;border:1px solid #e3e7eb;border-radius:10px;padding:14px;margin-bottom:16px}',
      '.db-sec h3{margin:0 0 10px;font-size:16px}',
      '.db-sub{display:block;font-size:12px;font-weight:normal;color:#777;margin-top:4px}',
      '.db-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}',
      '.db-card{border:1px solid #e3e7eb;border-left:5px solid #3498db;border-radius:8px;padding:10px 12px;background:#fbfdff}',
      '.db-card.apo{border-left-color:#27ae60;background:#f6fcf8}',
      '.db-card.win{border-left-color:#e6a700;background:#fffbea}',
      '.db-card.empty{border-left-color:#ccc;background:#f7f7f7;color:#999}',
      '.db-name{display:block;font-weight:bold;font-size:15px;color:#333;text-decoration:none;margin-bottom:8px}',
      '.db-name small{font-weight:normal;font-size:11px;color:#3498db}',
      '.db-wait{font-size:13px;margin-bottom:4px}',
      '.db-stats{display:flex;gap:4px}',
      '.db-stat{flex:1;text-align:center;border-radius:6px;padding:4px 0;background:#f0f2f4;color:#aaa}',
      '.db-stat b{display:block;font-size:18px;line-height:1.2}',
      '.db-stat span{font-size:11px}',
      '.db-stat.on.blue{background:#e3f1fb;color:#1f6fa8}',
      '.db-stat.on.green{background:#e2f5e9;color:#1e8449}',
      '.db-stat.on.gold{background:#fff0bf;color:#9a6b00}',
      '.db-amount{margin-top:6px;font-weight:bold;color:#9a6b00}',
      '.db-badges{margin-top:8px;display:flex;flex-wrap:wrap;gap:4px}',
      '.db-badge{font-size:12px;border-radius:12px;padding:2px 8px;background:#eef1f4;color:#555}',
      '.db-badge.fire{background:#ffe9dc;color:#c0510f}',
      '.db-badge.gold{background:#fff0bf;color:#8a6000}',
      '.db-foot{margin-top:8px;display:flex;align-items:center;justify-content:space-between}',
      '.db-clap{border:1px solid #f0c36d;background:#fff8e6;border-radius:16px;padding:4px 12px;cursor:pointer;font-size:13px}',
      '.db-clap:disabled{opacity:.6}',
      '.db-cmt{font-size:12px;color:#888}',
      '.db-goal{margin-bottom:10px}',
      '.db-goal-head{display:flex;justify-content:space-between;font-size:13px;margin-bottom:3px;gap:6px}',
      '.db-goal-head em{font-style:normal;color:#3498db;font-weight:bold}',
      '.db-goal.done .db-goal-head em{color:#e67e22}',
      '.db-bar{position:relative;height:12px;background:#edf0f3;border-radius:6px}',
      '.db-bar i{position:absolute;left:0;top:0;bottom:0;background:linear-gradient(90deg,#5dade2,#3498db);border-radius:6px}',
      '.db-goal.done .db-bar i{background:linear-gradient(90deg,#f5b041,#e67e22)}',
      '.db-bar s{position:absolute;top:-3px;bottom:-3px;width:2px;background:#555;margin-left:-1px}',
      '.db-word{background:#f4f9fd;border-left:4px solid #3498db;padding:6px 10px;margin:0 0 10px;font-weight:bold}',
      '.db-note{font-size:11px;color:#999;margin:4px 0 0}',
      '.db-news{list-style:none;margin:0;padding:0}',
      '.db-news li{border-bottom:1px dashed #e3e7eb;padding:6px 0;font-size:13px;line-height:1.5}',
      '.db-news li:last-child{border-bottom:none}',
      '.db-news a{color:#333;text-decoration:none}',
      '.db-ndate{color:#999;font-size:11px;margin-right:6px}',
      '.db-kind{font-size:11px;border-radius:8px;padding:1px 6px;margin-left:4px}',
      '.db-kind.k3{background:#fff0bf;color:#8a6000}',
      '.db-kind.k2{background:#e2f5e9;color:#1e8449}',
      '.db-kind.k1{background:#e3f1fb;color:#1f6fa8}',
      '.db-muted{color:#999;font-size:13px;margin:0}',
      '.db-loading{padding:24px;color:#999}',
      '.dboard.m{padding:8px 12px 16px}',
      '.dboard.m .db-grid{grid-template-columns:minmax(0,1fr)}',
      '.dboard.m .db-cards{grid-template-columns:minmax(0,1fr)}',
      '.dboard.m .db-date{font-size:17px;min-width:0;flex:1}',
      '.dboard.m .db-nav{padding:6px 8px}'
    ].join('\n');
    document.head.appendChild(st);
  }

  function mount(container) {
    injectStyle();
    var old = document.getElementById('dboard');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var root = document.createElement('div');
    root.id = 'dboard';
    root.className = 'dboard' + (IS_MOBILE ? ' m' : '');
    container.appendChild(root);
    state.root = root;

    var me = kintone.getLoginUser();
    if (PREVIEW_USERS && PREVIEW_USERS.indexOf(me.code) < 0) {
      root.innerHTML = '<div class="db-sec"><h3>日報ボードは準備中です</h3><p class="db-muted">近日公開予定です。日報の一覧は「すべての日報」をご覧ください。</p></div>';
      return;
    }
    root.addEventListener('click', onClick);
    state.date = state.date || ymd(new Date());
    root.innerHTML = '<div class="db-loading">読み込み中…</div>';
    Promise.all([loadReports(), loadGoal(state.date)]).then(render, function (err) {
      root.innerHTML = '<p class="db-muted">読み込めませんでした: ' + esc(err && err.message ? err.message : '') + '</p>';
    });
  }

  kintone.events.on(['app.record.index.show', 'mobile.app.record.index.show'], function (event) {
    IS_MOBILE = event.type.indexOf('mobile.') === 0;
    if (!IS_MOBILE && event.viewName === VIEW_PC) {
      var el = document.getElementById('dboard-root') || kintone.app.getHeaderSpaceElement();
      if (el) mount(el);
    } else if (IS_MOBILE && event.viewName === VIEW_MOBILE) {
      var sp = kintone.mobile.app.getHeaderSpaceElement();
      if (sp) mount(sp);
    } else {
      var old = document.getElementById('dboard');
      if (old && old.parentNode) old.parentNode.removeChild(old);
    }
    return event;
  });
})();
