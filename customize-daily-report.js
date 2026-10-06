/*
 * 営業日報(app32)カスタマイズ
 * 作成/編集画面の上部に「今日の活動を自動取り込み」ボタンを置き、日報の「日付」「報告者」をもとに
 * 以下の3アプリから、その日にその人が入力した情報を「今日の活動」明細に追加する。
 *
 * 1. 活動履歴(app17): 対応者=報告者 かつ 対応日付=日付
 *    対応種別 電話→架電 / 商談(初回・2回目以降)→訪問 / それ以外→その他
 * 2. 案件管理(app19): 作成者 or 更新者=報告者 かつ 更新日時がその日
 *    商談フェーズ 受注→受注(金額=売上) / その日新規登録→見込み / それ以外→その他
 *    受注は、別の日報で同じ案件の受注を報告済みなら「その他」にして二重計上しない
 * 3. ネタリスト(app29):
 *    a. 架電履歴の行のうち 日付=日付 かつ 担当=報告者
 *       結果 獲得→アポ獲得 / ネタ→見込み / それ以外→架電
 *    b. その日に報告者が新規登録したネタ(aで出たものを除く)。6件以上なら1行にまとめる
 * 4. スケジュール(app34): 参加者=報告者 かつ 開始がその日 の 訪問・外出
 *    訪問(中止以外)の件数を開始時刻で午前/午後に数え、訪問件数欄に入れる(手入力の方が多ければそのまま)
 *    明細は 訪問→訪問 / 中止・外出→その他。予定から活動履歴を作成済みなら、その活動履歴の行で取り込むので予定の行は作らない
 *    翌営業日(土日を除く)の予定を「明日の目標」に下書きとして追記する(【翌営業日の予定】の見出しがあれば追記しない)
 *
 * スマホの一覧: 全列150px固定で日付と報告者だけで画面が埋まるため、列幅を中身に合わせて詰める
 *
 * 二重取り込み防止: 内容の先頭に [履歴No.X] [案件No.X] [ネタNo.X-行ID] [ネタ新規] [予定No.X] の印を付け、既にある印はスキップする
 */
(function () {
  'use strict';

  var APP = { activity: 17, deal: 19, lead: 29, schedule: 34 };
  var TABLE = '活動明細';
  var BUTTON_ID = 'daily-report-import-button';
  var NEW_LEAD_DETAIL_LIMIT = 5;

  // PC/スマホでレコード操作APIが違うため、イベントの種類から判定して切り替える
  var IS_MOBILE = false;
  function recApi() { return IS_MOBILE ? kintone.mobile.app.record : kintone.app.record; }
  function detectEnv(event) { IS_MOBILE = event.type.indexOf('mobile.') === 0; }

  function fv(obj, code, fallback) {
    return obj && obj[code] && obj[code].value !== undefined && obj[code].value !== null ? obj[code].value : fallback;
  }

  function getAll(app, query) {
    return kintone.api(kintone.api.url('/k/v1/records', true), 'GET', {
      app: app,
      query: query + ' limit 500'
    }).then(function (resp) { return resp.records; });
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function nextDay(dateStr) {
    var p = dateStr.split('-');
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]) + 1);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  // DATETIME(UTC文字列)が、日本時間でその日かどうか
  function isOnDate(iso, dateStr) {
    if (!iso) return false;
    var d = new Date(iso);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) === dateStr;
  }

  function shorten(s, len) {
    s = (s || '').replace(/\s+/g, ' ').trim();
    return s.length > len ? s.slice(0, len) + '…' : s;
  }

  function makeRow(opt) {
    return {
      value: {
        '時間帯': { type: 'DROP_DOWN', value: opt.time || null },
        '区分': { type: 'DROP_DOWN', value: opt.kubun },
        '明細_会社名': { type: 'SINGLE_LINE_TEXT', value: opt.company || '' },
        '明細_案件No': { type: 'NUMBER', value: opt.dealNo || '', lookup: !!opt.dealNo },
        '明細_案件名': { type: 'SINGLE_LINE_TEXT', value: '' },
        '金額': { type: 'NUMBER', value: opt.amount || '' },
        '内容': { type: 'SINGLE_LINE_TEXT', value: opt.memo },
        '受注フラグ': { type: 'CALC', value: '' },
        '受注金額': { type: 'CALC', value: '' }
      }
    };
  }

  function isBlankRow(row) {
    return !fv(row.value, '明細_会社名', '') && !fv(row.value, '内容', '') && !fv(row.value, '明細_案件No', '');
  }

  // ---- 1. 活動履歴 ----
  function fromActivities(codes, date) {
    var q = '対応者 in (' + codes + ') and 対応日付 = "' + date + '" order by レコード番号 asc';
    return getAll(APP.activity, q).then(function (recs) {
      return recs.map(function (a) {
        var t = fv(a, '対応種別', '');
        var kubun = t === '電話' ? '架電' : (t.indexOf('商談') === 0 ? '訪問' : 'その他');
        var memo = fv(a, 'タイトル', '');
        var body = fv(a, '内容', '');
        if (body) memo += (memo ? '：' : '') + body;
        var fromSched = body.match(/スケジュールNo\.(\d+) から作成/);
        return {
          mark: '[履歴No.' + a.$id.value + ']',
          alt: fromSched ? '[予定No.' + fromSched[1] + ']' : null,
          row: { kubun: kubun, company: fv(a, '会社名', ''), dealNo: fv(a, '案件No', ''),
            memo: '[履歴No.' + a.$id.value + '] 活動履歴(' + t + ') ' + shorten(memo, 180) }
        };
      });
    });
  }

  // ---- 2. 案件管理 ----
  function alreadyReportedWon(dealNo, selfId) {
    var q = '内容 like "案件No.' + dealNo + ' 受注"' + (selfId ? ' and $id != ' + selfId : '');
    return getAll(IS_MOBILE ? kintone.mobile.app.getId() : kintone.app.getId(), q).then(function (recs) { return recs.length > 0; });
  }

  function fromDeals(codes, date, selfId) {
    var q = '(作成者 in (' + codes + ') or 更新者 in (' + codes + ')) and 更新日時 >= "' + date +
      'T00:00:00+09:00" and 更新日時 < "' + nextDay(date) + 'T00:00:00+09:00" order by 案件No_ asc';
    return getAll(APP.deal, q).then(function (recs) {
      return Promise.all(recs.map(function (d) {
        var no = fv(d, '案件No_', '');
        var phase = fv(d, '商談フェーズ', '');
        var isNew = isOnDate(fv(d, '作成日時', ''), date);
        var detail = (isNew ? '新規登録' : '更新') + ' フェーズ:' + (phase || '-') +
          (fv(d, '提案商品', '') ? ' 商品:' + fv(d, '提案商品', '') : '');
        var base = { company: fv(d, '会社名', ''), dealNo: no };
        if (phase === '受注') {
          return alreadyReportedWon(no, selfId).then(function (reported) {
            if (reported) {
              base.kubun = 'その他';
              base.memo = '[案件No.' + no + '] ' + detail + '(受注は別の日報で報告済み)';
            } else {
              base.kubun = '受注';
              base.amount = fv(d, '売上', '');
              base.memo = '[案件No.' + no + ' 受注] ' + detail;
            }
            return { mark: '[案件No.' + no + (base.kubun === '受注' ? ' 受注]' : ']'), alt: '[案件No.' + no + ' 受注]', row: base };
          });
        }
        base.kubun = isNew ? '見込み' : 'その他';
        base.memo = '[案件No.' + no + '] ' + detail;
        return { mark: '[案件No.' + no + ']', alt: '[案件No.' + no + ' 受注]', row: base };
      }));
    });
  }

  // ---- 3. ネタリスト ----
  function fromLeads(userCodes, codes, date) {
    var callQ = '履歴日付 >= "' + date + '" and 履歴日付 <= "' + date + '" and 履歴担当 in (' + codes + ')';
    var newQ = '作成者 in (' + codes + ') and 作成日時 >= "' + date + 'T00:00:00+09:00" and 作成日時 < "' +
      nextDay(date) + 'T00:00:00+09:00" order by レコード番号 asc';
    return Promise.all([getAll(APP.lead, callQ), getAll(APP.lead, newQ)]).then(function (res) {
      var items = [];
      var called = {};
      res[0].forEach(function (l) {
        fv(l, '架電履歴', []).forEach(function (r) {
          var v = r.value;
          if (fv(v, '履歴日付', '') !== date) return;
          var mine = fv(v, '履歴担当', []).some(function (u) { return userCodes.indexOf(u.code) !== -1; });
          if (!mine) return;
          called[l.$id.value] = true;
          var result = fv(v, '履歴結果', '');
          var kubun = result === '獲得' ? 'アポ獲得' : (result === 'ネタ' ? '見込み' : '架電');
          var mark = '[ネタNo.' + l.$id.value + '-' + r.id + ']';
          items.push({ mark: mark, row: { kubun: kubun, company: fv(l, '会社名', ''),
            memo: mark + ' ネタリスト架電 結果:' + (result || '-') + (fv(v, '履歴メモ', '') ? ' ' + shorten(fv(v, '履歴メモ', ''), 120) : '') } });
        });
      });
      var newLeads = res[1].filter(function (l) { return !called[l.$id.value]; });
      if (newLeads.length > NEW_LEAD_DETAIL_LIMIT) {
        var names = newLeads.slice(0, 3).map(function (l) { return fv(l, '会社名', ''); }).join('、');
        items.push({ mark: '[ネタ新規]', row: { kubun: 'その他', company: '',
          memo: '[ネタ新規] ネタリスト新規登録 ' + newLeads.length + '件(' + names + ' ほか)' } });
      } else {
        newLeads.forEach(function (l) {
          var mark = '[ネタNo.' + l.$id.value + ']';
          items.push({ mark: mark, row: { kubun: 'その他', company: fv(l, '会社名', ''),
            memo: mark + ' ネタリスト新規登録' + (fv(l, '業種確認メモ', '') ? ' ' + shorten(fv(l, '業種確認メモ', ''), 60) : '') } });
        });
      }
      return items;
    });
  }

  // ---- 4. スケジュール ----
  var WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
  function hm(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function dayRangeQuery(codes, date) {
    return '参加者 in (' + codes + ') and 元予定No = "" and 開始日時 >= "' + date + 'T00:00:00+09:00" and 開始日時 < "' +
      nextDay(date) + 'T00:00:00+09:00"';
  }
  function nextBusinessDay(date) {
    var d = nextDay(date);
    for (var i = 0; i < 7; i++) {
      var p = d.split('-');
      var w = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])).getDay();
      if (w !== 0 && w !== 6) return d;
      d = nextDay(d);
    }
    return d;
  }

  // スケジュールを見られない人(公開前など)でも、ほかの取り込みは続けられるよう失敗は空扱いにする
  function fromSchedule(codes, date) {
    var q = dayRangeQuery(codes, date) + ' and 種類 in ("訪問", "外出") order by 開始日時 asc';
    var tomorrow = nextBusinessDay(date);
    var tq = dayRangeQuery(codes, tomorrow) + ' order by 開始日時 asc';
    return Promise.all([getAll(APP.schedule, q), getAll(APP.schedule, tq)]).then(function (res) {
      var out = { items: [], am: 0, pm: 0, plan: '', ok: true };
      res[0].forEach(function (r) {
        var s = new Date(fv(r, '開始日時', ''));
        var time = s.getHours() < 12 ? '午前' : '午後';
        var st = fv(r, '実施状況', '予定');
        var visit = fv(r, '種類', '') === '訪問' && st !== '中止';
        if (visit) { if (time === '午前') out.am++; else out.pm++; }
        if (fv(r, '活動履歴No', '')) return; // 活動履歴の行で取り込む
        var id = r.$id.value;
        var mark = '[予定No.' + id + ']';
        out.items.push({ mark: mark, row: {
          kubun: visit ? '訪問' : 'その他', time: time,
          company: fv(r, '会社名', '') || fv(r, 'ネタ会社名', ''), dealNo: fv(r, '案件No', ''),
          memo: mark + ' 予定(' + fv(r, '種類', '') + (st !== '予定' ? '・' + st : '') + ') ' + hm(s) + ' ' +
            shorten(fv(r, '件名', '') + (fv(r, '内容', '') ? '：' + fv(r, '内容', '') : ''), 150)
        } });
      });
      var p = tomorrow.split('-');
      var td = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
      var lines = res[1].filter(function (r) { return fv(r, '実施状況', '予定') !== '中止'; }).map(function (r) {
        var s = new Date(fv(r, '開始日時', ''));
        var allDay = fv(r, '終日', []).indexOf('終日') >= 0;
        var company = fv(r, '会社名', '') || fv(r, 'ネタ会社名', '');
        return '・' + (allDay ? '終日' : hm(s)) + ' ' + fv(r, '種類', '') + ' ' + fv(r, '件名', '') + (company ? '(' + company + ')' : '');
      });
      if (lines.length) out.plan = '【翌営業日の予定 ' + (td.getMonth() + 1) + '/' + td.getDate() + '(' + WEEKDAYS[td.getDay()] + ')】\n' + lines.join('\n');
      return out;
    }).catch(function (e) {
      console.warn('スケジュールを取り込めませんでした', e);
      return { items: [], am: 0, pm: 0, plan: '', ok: false };
    });
  }

  function importAll() {
    var rec = recApi().get().record;
    var date = fv(rec, '日付', '');
    var users = fv(rec, '報告者', []);
    if (!date || !users.length) {
      window.alert('日付と報告者を入力してから押してください。');
      return;
    }
    var userCodes = users.map(function (u) { return u.code; });
    var codes = userCodes.map(function (c) { return '"' + c + '"'; }).join(',');
    var selfId = recApi().getId();

    Promise.all([
      fromActivities(codes, date),
      fromDeals(codes, date, selfId),
      fromLeads(userCodes, codes, date),
      fromSchedule(codes, date)
    ]).then(function (all) {
      var sched = all[3];
      var res = [all[0], all[1], all[2], sched.items];
      var latest = recApi().get();
      var rows = fv(latest.record, TABLE, []).filter(function (r) { return !isBlankRow(r); });
      var existing = rows.map(function (r) { return fv(r.value, '内容', ''); }).join('\n');
      var counts = [0, 0, 0, 0];
      res.forEach(function (items, i) {
        items.forEach(function (it) {
          if (existing.indexOf(it.mark) !== -1 || (it.alt && existing.indexOf(it.alt) !== -1)) return;
          rows.push(makeRow(it.row));
          existing += '\n' + it.mark;
          counts[i]++;
        });
      });
      var total = counts[0] + counts[1] + counts[2] + counts[3];
      // 訪問件数: スケジュールの数が手入力より多いときだけ上書き
      var visitChanged = false;
      [['訪問_午前', sched.am], ['訪問_午後', sched.pm]].forEach(function (v) {
        var cur = Number(fv(latest.record, v[0], 0)) || 0;
        if (v[1] > cur) { latest.record[v[0]].value = String(v[1]); visitChanged = true; }
      });
      var goal = fv(latest.record, '明日の目標', '');
      var planAdded = false;
      if (sched.plan && goal.indexOf('【翌営業日の予定') < 0) {
        latest.record['明日の目標'].value = (goal ? goal + '\n\n' : '') + sched.plan;
        planAdded = true;
      }
      if (!total && !visitChanged && !planAdded) {
        window.alert('取り込める新しい情報はありませんでした。\n(活動履歴・案件管理・ネタリスト・スケジュールに、この日・この報告者の入力が無いか、すべて取り込み済みです)' +
          (sched.ok ? '' : '\n※スケジュールは閲覧権限が無いため取り込めませんでした'));
        return;
      }
      latest.record[TABLE].value = rows;
      recApi().set(latest);
      window.alert('取り込みました:\n活動履歴 ' + counts[0] + '件 / 案件管理 ' + counts[1] + '件 / ネタリスト ' + counts[2] +
        '件 / スケジュール ' + counts[3] + '件' +
        (visitChanged ? '\n訪問件数を予定から入れました(午前' + sched.am + '・午後' + sched.pm + ')' : '') +
        (planAdded ? '\n翌営業日の予定を「明日の目標」に追記しました' : '') +
        (sched.ok ? '' : '\n※スケジュールは閲覧権限が無いため取り込めませんでした') +
        '\n\n時間帯・区分・金額を確認し、上の「今日の数字」も見直してから保存してください。');
    }).catch(function (e) {
      console.error(e);
      window.alert('取り込みに失敗しました。時間をおいて再度お試しください。');
    });
  }

  kintone.events.on(['app.record.create.show', 'app.record.edit.show',
    'mobile.app.record.create.show', 'mobile.app.record.edit.show'], function (event) {
    detectEnv(event);
    // スマホは画面遷移しても前のボタンが残ることがあるため作り直す
    var old = document.getElementById(BUTTON_ID);
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var space = IS_MOBILE ? kintone.mobile.app.getHeaderSpaceElement() : kintone.app.record.getHeaderMenuSpaceElement();
    if (space) {
      var btn = document.createElement('button');
      btn.id = BUTTON_ID;
      btn.type = 'button';
      btn.textContent = '今日の活動を自動取り込み（活動履歴・案件・ネタリスト・予定）';
      btn.style.cssText = 'margin:8px 12px;padding:6px 14px;border:1px solid #3498db;background:#fff;color:#3498db;border-radius:4px;cursor:pointer;font-size:14px;' +
        (IS_MOBILE ? 'display:block;width:calc(100% - 24px);padding:10px 14px;' : '');
      btn.addEventListener('click', importAll);
      space.appendChild(btn);
    }
    return event;
  });

  // ---------- スマホの一覧: 列幅を中身に合わせて詰める ----------
  // スマホ(ブラウザ)の一覧は全列が150px固定で、日付と報告者だけで画面が埋まるため。
  // 利用者が列の境目をドラッグして変えた幅は尊重し、150pxのままの列だけを変える。
  var MOBILE_COL_WIDTH = {
    '日付': 88, '報告者': 104,
    '訪問件数（午前）': 58, '訪問件数（午後）': 58, '訪問件数（合計）': 58, 'アポ件数': 58, '見込み件数': 58, '受注件数': 58,
    '受注金額（合計）': 92, '今日の課題': 180, '明日の目標': 180
  };
  var MOBILE_COL_DEFAULT = 64; // 上に無い列(後から一覧に足した列など)
  var MOBILE_COL_KINTONE_DEFAULT = '150px';

  function fitMobileListColumns() {
    var table = document.querySelector('.gaia-mobile-v2-app-index-recordlist-table');
    if (!table) return;
    var cols = table.querySelectorAll('col');
    var ths = table.querySelectorAll('th.gaia-mobile-v2-app-index-recordlist-table-headercell');
    var shrink = 0; // 狭くした分だけ表全体の幅も縮める(縮めないと残りの列が広がる)
    for (var i = 0; i < ths.length; i++) {
      var th = ths[i];
      var label = th.querySelector('.gaia-mobile-v2-app-index-recordlist-table-headercell-label');
      if (!label || th.style.width !== MOBILE_COL_KINTONE_DEFAULT) continue;
      var w = MOBILE_COL_WIDTH[label.textContent.trim()] || MOBILE_COL_DEFAULT;
      th.style.width = w + 'px';
      var wrap = th.querySelector('.gaia-mobile-v2-app-index-recordlist-table-headercell-wrapper');
      if (wrap) wrap.style.width = w + 'px';
      if (cols[i]) cols[i].style.width = w + 'px';
      shrink += parseFloat(MOBILE_COL_KINTONE_DEFAULT) - w;
    }
    if (!shrink) return;
    var tw = parseFloat(table.style.width);
    if (tw) table.style.width = (tw - shrink) + 'px';
  }

  function addMobileListStyle() {
    if (document.getElementById('daily-report-mobile-list-style')) return;
    var st = document.createElement('style');
    st.id = 'daily-report-mobile-list-style';
    // 狭くした列の見出し(「訪問件数（午前）」など)は2行に折り返して全部見せる
    st.textContent = '.gaia-mobile-v2-app-index-recordlist-table-headercell-label{white-space:normal;line-height:1.25;word-break:break-all;}';
    document.head.appendChild(st);
  }

  var mobileListObserver = null;
  function watchMobileList() {
    addMobileListStyle();
    fitMobileListColumns();
    if (mobileListObserver) mobileListObserver.disconnect();
    // ページ送り・並べ替えで表が描き直されても幅を当て直す
    mobileListObserver = new MutationObserver(function () { fitMobileListColumns(); });
    mobileListObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
  }

  kintone.events.on('mobile.app.record.index.show', function (event) {
    watchMobileList();
    return event;
  });
})();
