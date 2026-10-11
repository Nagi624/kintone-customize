/*
 * 週報・月報(app36)「レポートボード」(2026-10-11)
 * レコード詳細画面の上部(スペース report_board)に、日報ボードと同じ見た目でまとめて表示する。PC・スマホ両対応。
 *
 * ① 目標と実績: 訪問・架電・アポ・受注件数・受注金額のカード。チーム目標(goal_*)に対する達成率のバー、
 *    前回の同じ種類のレポート(週報なら前週、月報なら前月度)からの増減
 * ② 平日/土日: 実績の内訳を1本の棒で(会社の営業日は平日だが、土日の活動も実績に含める)
 * ③ 案件の状況: 案件状況サマリーのフェーズ別件数を横棒で
 * ④ 確認したいこと: 確認候補を項目リストで
 * ⑤ Good News: 期間中の日報明細の受注・アポ獲得・見込み(会社名と区分だけ。内容のメモは出さない)
 *
 * 値はレコードに保存済みの集計値を使う(自動作成・「期間と実績を集計」で入る)。Good Newsと前回比だけは表示時に取得する
 */
(function () {
  'use strict';

  var APP_DAILY = 32;
  var SPACE_ID = 'report_board';
  var NEWS_LIMIT = 10;
  var IS_MOBILE = false;

  var CARDS = [
    { key: 'visits', goal: 'goal_visits', rate: 'rate_visits', label: '訪問', unit: '件' },
    { key: 'calls', goal: 'goal_calls', rate: 'rate_calls', label: '架電', unit: '件' },
    { key: 'appointments', goal: 'goal_appointments', rate: 'rate_appointments', label: 'アポ獲得', unit: '件' },
    { key: 'prospects', label: '見込み', unit: '件' },
    { key: 'orders', goal: 'goal_orders', rate: 'rate_orders', label: '受注件数', unit: '件' },
    { key: 'revenue', goal: 'goal_revenue', rate: 'rate_revenue', label: '受注金額', unit: '円' }
  ];

  function esc(s) {
    return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fv(obj, code, fallback) {
    return obj && obj[code] && obj[code].value !== undefined && obj[code].value !== null && obj[code].value !== '' ? obj[code].value : fallback;
  }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function fmt(n, unit) {
    return unit === '円' ? '￥' + Math.round(n).toLocaleString('ja-JP') : (Math.round(n * 10) / 10) + unit;
  }
  function dlabel(s) {
    if (!s) return '';
    var d = new Date(s + 'T00:00:00');
    return (d.getMonth() + 1) + '/' + d.getDate() + '(' + '日月火水木金土'.charAt(d.getDay()) + ')';
  }
  function escQ(s) { return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"'); }
  function api(path, params) { return kintone.api(kintone.api.url(path, true), 'GET', params); }

  // ---------- データ取得 ----------
  function loadPrevious(rec) {
    var type = fv(rec, 'report_type', ''), scope = fv(rec, 'scope', ''), start = fv(rec, 'period_start', '');
    if (!type || !start) return Promise.resolve(null);
    var q = 'report_type in ("' + escQ(type) + '") and scope in ("' + escQ(scope) + '") and period_end < "' + escQ(start) + '"';
    var users = fv(rec, 'subject_user', []);
    if (scope === '個人' && users.length) q += ' and subject_user in ("' + escQ(users[0].code) + '")';
    var appId = IS_MOBILE ? kintone.mobile.app.getId() : kintone.app.getId();
    return api('/k/v1/records', { app: appId, query: q + ' order by period_end desc limit 1' })
      .then(function (r) { return r.records[0] || null; }, function () { return null; });
  }

  function loadNews(rec) {
    var start = fv(rec, 'period_start', ''), end = fv(rec, 'period_end', '');
    if (!start || !end) return Promise.resolve([]);
    var q = '日付 >= "' + escQ(start) + '" and 日付 <= "' + escQ(end) + '"';
    var users = fv(rec, 'subject_user', []);
    if (fv(rec, 'scope', '') === '個人' && users.length) q += ' and 報告者 in ("' + escQ(users[0].code) + '")';
    return api('/k/v1/records', { app: APP_DAILY, query: q + ' order by 日付 desc limit 500', fields: ['$id', '日付', '報告者', '活動明細'] })
      .then(function (resp) {
        var rank = { '受注': 3, 'アポ獲得': 2, '見込み': 1 };
        var items = [];
        resp.records.forEach(function (r) {
          var who = (fv(r, '報告者', [])[0] || {}).name || '';
          fv(r, '活動明細', []).forEach(function (row) {
            var kind = fv(row.value, '区分', '');
            var company = fv(row.value, '明細_会社名', '') || fv(row.value, '明細_案件名', '');
            if (!rank[kind] || !company) return;
            items.push({ date: fv(r, '日付', ''), who: who, kind: kind, rank: rank[kind], company: company, id: r.$id.value,
              amount: kind === '受注' ? num(fv(row.value, '金額', 0)) : 0 });
          });
        });
        items.sort(function (a, b) { return b.rank - a.rank || (a.date < b.date ? 1 : -1); });
        return items.slice(0, NEWS_LIMIT);
      }, function () { return []; });
  }

  // ---------- 描画 ----------
  function cardHtml(rec, prev, c) {
    var actual = num(fv(rec, c.key, 0));
    var goalRaw = c.goal ? fv(rec, c.goal, '') : '';
    var rate = goalRaw !== '' && num(goalRaw) > 0 ? actual / num(goalRaw) : null;
    var done = rate !== null && rate >= 1;
    var diff = '';
    if (prev) {
      var d = actual - num(fv(prev, c.key, 0));
      diff = d === 0 ? '<span class="rb-diff">前回と同じ</span>' :
        '<span class="rb-diff ' + (d > 0 ? 'up' : 'down') + '">' + (d > 0 ? '▲' : '▼') + ' ' + fmt(Math.abs(d), c.unit) + '</span>';
    }
    var wd = num(fv(rec, 'weekday_' + c.key, 0)), we = num(fv(rec, 'weekend_' + c.key, 0));
    var split = (wd + we) > 0 ?
      '<div class="rb-split" title="平日 ' + esc(fmt(wd, c.unit)) + ' / 土日 ' + esc(fmt(we, c.unit)) + '">' +
      '<i style="width:' + (wd / (wd + we) * 100) + '%"></i></div>' +
      '<div class="rb-split-l"><span>平日 ' + esc(fmt(wd, c.unit)) + '</span><span>土日 ' + esc(fmt(we, c.unit)) + '</span></div>' : '';
    var goal = rate === null ?
      (c.goal ? '<div class="rb-nogoal">目標なし</div>' : '') :
      '<div class="rb-goal-l"><span>目標 ' + esc(fmt(num(goalRaw), c.unit)) + '</span><em>' + Math.floor(rate * 100) + '%' + (done ? ' 達成🎉' : '') + '</em></div>' +
      '<div class="rb-bar"><i style="width:' + Math.min(100, rate * 100) + '%"></i></div>';
    return '<div class="rb-card' + (done ? ' done' : '') + '"><div class="rb-label">' + esc(c.label) + '</div>' +
      '<div class="rb-num">' + esc(fmt(actual, c.unit)) + '</div>' + diff + goal + split + '</div>';
  }

  function pipelineHtml(text) {
    var m = /:\s*(.+?)(\n|$)/.exec(text || '');
    if (!m) return '';
    var phases = m[1].split('、').map(function (p) {
      var x = /^(.+?):\s*(\d+)件$/.exec(p.trim());
      return x ? { name: x[1], n: +x[2] } : null;
    }).filter(Boolean);
    if (!phases.length) return '';
    var order = ['商談予定', '提案中', '内示', '受注', '失注', '保留/中止', 'フェーズ未入力'];
    phases.sort(function (a, b) { return order.indexOf(a.name) - order.indexOf(b.name); });
    var max = Math.max.apply(null, phases.map(function (p) { return p.n; }));
    var rest = (text.split('\n')[1] || '');
    return '<section class="rb-sec"><h3>📊 案件の状況 <small>集計時点</small></h3>' + phases.map(function (p) {
      var cls = p.name === '受注' ? ' win' : (p.name === '失注' || p.name === '保留/中止') ? ' off' : '';
      return '<div class="rb-phase' + cls + '"><span>' + esc(p.name) + '</span><div><i style="width:' + (p.n / max * 100) + '%"></i></div><b>' + p.n + '</b></div>';
    }).join('') + (rest ? '<p class="rb-note">' + esc(rest) + '</p>' : '') + '</section>';
  }

  function candidatesHtml(text) {
    var lines = (text || '').split('\n').filter(Boolean);
    if (!lines.length) return '';
    var note = lines.filter(function (l) { return l.indexOf('参考情報') !== -1 || l.indexOf('自動集計は') === 0; });
    var items = lines.filter(function (l) { return note.indexOf(l) === -1; });
    return '<section class="rb-sec"><h3>✅ 確認したいこと</h3><ul class="rb-check">' + items.map(function (l) {
      return '<li>' + esc(l) + '</li>';
    }).join('') + '</ul>' + note.map(function (l) { return '<p class="rb-note">' + esc(l) + '</p>'; }).join('') + '</section>';
  }

  function newsHtml(items) {
    if (!items.length) return '<section class="rb-sec"><h3>🎉 Good News</h3><p class="rb-muted">期間中の受注・アポ獲得・見込みはまだありません。</p></section>';
    var icon = { '受注': '🏆', 'アポ獲得': '📅', '見込み': '🌱' };
    return '<section class="rb-sec"><h3>🎉 Good News</h3><ul class="rb-news">' + items.map(function (it) {
      var url = IS_MOBILE ? '/k/m/' + APP_DAILY + '/show?record=' + it.id : '/k/' + APP_DAILY + '/show#record=' + it.id;
      return '<li>' + icon[it.kind] + ' <b>' + esc(it.company) + '</b> ' + esc(it.kind) +
        (it.amount ? ' ' + esc(fmt(it.amount, '円')) : '') +
        '<br><a href="' + url + '">' + esc(dlabel(it.date)) + ' ' + esc(it.who) + '</a></li>';
    }).join('') + '</ul></section>';
  }

  function render(el, rec, prev, news) {
    var type = fv(rec, 'report_type', '');
    var scope = fv(rec, 'scope', '');
    var who = scope === '個人' ? ((fv(rec, 'subject_user', [])[0] || {}).name || '') : '全社';
    var head = '<div class="rb-head"><span class="rb-type">' + esc(type) + '</span> <b>' + esc(dlabel(fv(rec, 'period_start', ''))) + '〜' +
      esc(dlabel(fv(rec, 'period_end', ''))) + '</b> <span class="rb-who">' + esc(who) + '</span>' +
      (prev ? '<span class="rb-prev">増減は前回(' + esc(dlabel(fv(prev, 'period_start', ''))) + '〜)との比較</span>' : '') + '</div>';
    if (!fv(rec, 'aggregated_at', '')) {
      el.innerHTML = head + '<p class="rb-muted">まだ集計されていません。編集画面の「期間と実績を集計」を押してください。</p>';
      return;
    }
    var note = fv(rec, 'goal_note', '');
    el.innerHTML = head +
      '<section class="rb-sec"><h3>🎯 目標と実績' + (note ? ' <small>' + esc(note) + '</small>' : '') + '</h3>' +
      '<div class="rb-cards">' + CARDS.map(function (c) { return cardHtml(rec, prev, c); }).join('') + '</div>' +
      '<p class="rb-note">営業日は平日で按分していますが、実績には土日の活動も含みます。帯の濃い色が平日、薄い色が土日です。</p></section>' +
      '<div class="rb-grid">' + '<div>' + pipelineHtml(fv(rec, 'pipeline_summary', '')) + candidatesHtml(fv(rec, 'follow_up_candidates', '')) + '</div>' +
      '<div>' + newsHtml(news) + '</div></div>';
  }

  function injectCss() {
    if (document.getElementById('rb-style')) return;
    var st = document.createElement('style');
    st.id = 'rb-style';
    st.textContent = [
      '.rb-root{font-size:14px;color:#333;padding:4px 0 8px;max-width:1100px}',
      '.rb-root.m{padding:8px 12px}',
      '.rb-head{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:12px;font-size:18px}',
      '.rb-type{font-size:12px;background:#3498db;color:#fff;border-radius:10px;padding:2px 10px}',
      '.rb-who{font-size:13px;color:#555}',
      '.rb-prev{font-size:11px;color:#999;margin-left:auto}',
      '.rb-sec{background:#fff;border:1px solid #e3e7eb;border-radius:10px;padding:14px;margin-bottom:14px}',
      '.rb-sec h3{margin:0 0 10px;font-size:15px}',
      '.rb-sec h3 small{font-weight:normal;font-size:12px;color:#888;margin-left:6px}',
      '.rb-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px}',
      '.rb-card{border:1px solid #e3e7eb;border-left:5px solid #3498db;border-radius:8px;padding:10px 12px;background:#fbfdff}',
      '.rb-card.done{border-left-color:#e67e22;background:#fff8ef}',
      '.rb-label{font-size:12px;color:#666}',
      '.rb-num{font-size:24px;font-weight:bold;line-height:1.3}',
      '.rb-diff{font-size:12px;color:#888}',
      '.rb-diff.up{color:#1e8449}',
      '.rb-diff.down{color:#c0392b}',
      '.rb-goal-l{display:flex;justify-content:space-between;font-size:12px;margin-top:6px;color:#666}',
      '.rb-goal-l em{font-style:normal;font-weight:bold;color:#3498db}',
      '.rb-card.done .rb-goal-l em{color:#e67e22}',
      '.rb-bar{position:relative;height:10px;background:#edf0f3;border-radius:5px;margin-top:3px}',
      '.rb-bar i{position:absolute;left:0;top:0;bottom:0;background:linear-gradient(90deg,#5dade2,#3498db);border-radius:5px}',
      '.rb-card.done .rb-bar i{background:linear-gradient(90deg,#f5b041,#e67e22)}',
      '.rb-nogoal{font-size:11px;color:#aaa;margin-top:6px}',
      '.rb-split{height:6px;background:#d6eaf8;border-radius:3px;margin-top:8px;overflow:hidden}',
      '.rb-split i{display:block;height:100%;background:#2e86c1}',
      '.rb-split-l{display:flex;justify-content:space-between;font-size:11px;color:#888;margin-top:2px}',
      '.rb-grid{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:14px;align-items:start}',
      '.rb-root.m .rb-grid{grid-template-columns:minmax(0,1fr)}',
      '.rb-phase{display:grid;grid-template-columns:110px minmax(0,1fr) 32px;align-items:center;gap:8px;margin-bottom:6px;font-size:13px}',
      '.rb-phase div{height:12px;background:#edf0f3;border-radius:6px}',
      '.rb-phase i{display:block;height:100%;background:#5dade2;border-radius:6px}',
      '.rb-phase.win i{background:#f5b041}',
      '.rb-phase.off i{background:#c8ced4}',
      '.rb-phase b{text-align:right}',
      '.rb-check{margin:0;padding-left:20px}',
      '.rb-check li{margin-bottom:6px;line-height:1.5}',
      '.rb-news{list-style:none;margin:0;padding:0}',
      '.rb-news li{border-bottom:1px dashed #e3e7eb;padding:6px 0;font-size:13px;line-height:1.5}',
      '.rb-news a{font-size:11px;color:#3498db}',
      '.rb-note{font-size:11px;color:#999;margin:6px 0 0}',
      '.rb-muted{color:#999}',
      '@media (max-width:900px){.rb-grid{grid-template-columns:minmax(0,1fr)}}'
    ].join('\n');
    document.head.appendChild(st);
  }

  kintone.events.on(['app.record.detail.show', 'mobile.app.record.detail.show'], function (event) {
    IS_MOBILE = event.type.indexOf('mobile.') === 0;
    var space = IS_MOBILE ? kintone.mobile.app.record.getSpaceElement(SPACE_ID) : kintone.app.record.getSpaceElement(SPACE_ID);
    if (!space) return event;
    injectCss();
    space.innerHTML = '';
    var el = document.createElement('div');
    el.className = 'rb-root' + (IS_MOBILE ? ' m' : '');
    el.innerHTML = '<p class="rb-muted">レポートボードを読み込み中…</p>';
    space.appendChild(el);
    var rec = event.record;
    Promise.all([loadPrevious(rec), loadNews(rec)]).then(function (res) {
      render(el, rec, res[0], res[1]);
    }, function () {
      render(el, rec, null, []);
    });
    return event;
  });
})();
