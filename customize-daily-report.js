/*
 * 営業日報(app32)カスタマイズ
 * 作成/編集画面の上部に「今日の活動を自動取り込み」ボタンを置き、日報の「日付」「報告者」をもとに
 * 以下の3アプリから、その日にその人が入力した情報を「今日の活動」明細に追加する。
 *
 * 1. 活動履歴(app17): 対応者=報告者 かつ 対応日付=日付
 *    対応種別 電話→架電 / 商談(初回・2回目以降)→訪問 / それ以外→その他
 *    (電話でコール業務=アポ獲得のときはアポ獲得。顧客管理の「📞 電話を記録」で入る、2026-10-16)
 *    予定の無い商談(顧客管理の「🚶 訪問を記録」、2026-10-17〜)は訪問件数にも数える(作成時刻で午前/午後)。
 *    予定から作った記録([スケジュールNo.X から作成])・予定の活動履歴Noに紐付いた記録は予定の側で数える
 * 2. 案件管理(app19): 作成者 or 更新者=報告者 かつ 更新日時がその日
 *    取り込むのは その日新規登録(失注以外)→見込み と 受注→受注(金額=売上) だけ(2026-10-20)。
 *    それ以外の更新(管理者の一括修正・軽い編集も拾っていた)は取り込まない。商談の中身は活動履歴・予定から入る。
 *    受注は、別の日報で同じ案件の受注を報告済みなら取り込まない(二重計上しない)
 * 3. ネタリスト(app29):
 *    a. 架電履歴の行のうち 日付=日付 かつ 担当=報告者
 *       結果 獲得→アポ獲得 / ネタ→見込み / それ以外→架電(種別が飛び込みなら訪問)
 *       飛び込みは訪問件数にも数える(時刻で午前/午後。時刻が空なら午前)
 *    b. その日に報告者が新規登録したネタ(aで出たものを除く)。6件以上なら1行にまとめる
 * 4. スケジュール(app34): 参加者=報告者 かつ 開始がその日 の 訪問・外出
 *    訪問(中止以外)の件数を開始時刻で午前/午後に数え、訪問件数欄に入れる(手入力の方が多ければそのまま)
 *    明細は 訪問→訪問 / 中止・外出→その他。予定から活動履歴を作成済みなら、その活動履歴の行で取り込むので予定の行は作らない
 *    翌営業日(土日を除く)の予定を「明日の目標」に下書きとして追記する(【翌営業日の予定】の見出しがあれば追記しない)
 *
 * 架電件数: 活動履歴の対応種別「電話」+ネタリストの種別「電話」(空も電話扱い)の行を、結果に関係なく数えて入れる
 *   (手入力の方が多ければそのまま)。明細は1社1行にまとめるため、区分「架電」の行数では電話の回数にならない(2026-10-16)
 *
 * 明細で案件No.を選んだとき、会社名が空なら案件管理の会社名を入れる
 * (ルックアップのコピー先にすると会社名を手入力できなくなり、案件の無いネタの行で困るため)
 *
 * スマホの一覧: 全列150px固定で日付と報告者だけで画面が埋まるため、列幅を中身に合わせて詰める
 *
 * 時間帯(2026-10-20): 活動履歴=作成した時刻(予定に紐付いた記録は予定の開始時刻)、案件=登録/更新の時刻、
 *   ネタリスト=架電履歴の時刻、予定=開始時刻で午前/午後を入れる(以前は活動履歴の行に時間帯が入らなかった)
 *
 * 押さなくても取り込む(2026-10-20。ボタンを押さずに保存する日が多く、記録の4割近くが日報に入っていなかったため):
 *   - 新しく日報を作る画面を開いたら、その日の分をすべて自動で取り込む(結果はボタンの下に表示)
 *   - 保存するときは、画面を開いた後(または最後に取り込んだ後)に新しく入った記録だけを足す。
 *     開いた時点の記録は足さない(利用者がわざと消した行が保存のたびに戻らないように)
 *
 * 二重取り込み防止: 内容の先頭に [履歴No.X] [案件No.X] [ネタNo.X-行ID] [ネタ新規] [予定No.X] の印を付け、既にある印はスキップする
 * 1社1行: 同じ会社(表記ゆれ・空白を無視)か同じ案件No.の行が既にあれば、新しい行は作らずその行にまとめる。
 *   内容は「既存 / 取り込み分」とつなぎ、区分は成果の大きい方(受注>アポ獲得>見込み>訪問>架電>その他)、
 *   時間帯・会社名・案件No.・受注金額は既存の行が空のときだけ入れる
 */
(function () {
  'use strict';

  var APP = { activity: 17, deal: 19, lead: 29, schedule: 34 };
  var TABLE = '活動明細';
  var BUTTON_ID = 'daily-report-import-button';
  var NEW_LEAD_DETAIL_LIMIT = 5;
  // 活動履歴を確認用にした日(2026-10-17)。これより前は活動履歴に手入力の商談があり、予定と二重に数えてしまうため数えない
  var VISIT_COUNT_FROM = '2026-10-17';

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

  // 日時(UTC文字列)を日本時間の午前/午後に
  function ampm(iso) {
    if (!iso) return null;
    return new Date(iso).getHours() < 12 ? '午前' : '午後';
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
        '明細_確度': { type: 'SINGLE_LINE_TEXT', value: '' },
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

  // ---- 1社1行にまとめる ----
  var KUBUN_RANK = ['その他', '架電', '訪問', '見込み', 'アポ獲得', '受注'];
  function kubunRank(k) { return KUBUN_RANK.indexOf(k); }

  function companyKey(s) {
    return (s || '').normalize('NFKC').replace(/[\s\/]+/g, '').toLowerCase();
  }

  function rowKeys(company, dealNo) {
    var keys = [];
    if (companyKey(company)) keys.push('c:' + companyKey(company));
    if (dealNo) keys.push('d:' + dealNo);
    return keys;
  }

  function mergeInto(row, opt) {
    var v = row.value;
    var memo = fv(v, '内容', '');
    v['内容'].value = memo ? memo + ' / ' + opt.memo : opt.memo;
    if (kubunRank(opt.kubun) > kubunRank(fv(v, '区分', ''))) v['区分'].value = opt.kubun;
    if (v['区分'].value === '受注' && !fv(v, '金額', '') && opt.amount) v['金額'].value = opt.amount;
    if (!fv(v, '時間帯', '') && opt.time) v['時間帯'].value = opt.time;
    if (!fv(v, '明細_会社名', '') && opt.company) v['明細_会社名'].value = opt.company;
    if (!fv(v, '明細_案件No', '') && opt.dealNo) {
      v['明細_案件No'].value = opt.dealNo;
      v['明細_案件No'].lookup = true;
    }
  }

  // ---- 1. 活動履歴 ----
  function fromActivities(codes, date) {
    var q = '対応者 in (' + codes + ') and 対応日付 = "' + date + '" order by レコード番号 asc';
    return getAll(APP.activity, q).then(function (recs) {
      return recs.map(function (a) {
        var t = fv(a, '対応種別', '');
        // 電話の結果(コール業務、顧客管理の「📞 電話を記録」が入れる)がアポ獲得なら区分もアポ獲得にする
        var kubun = t === '電話' ? (fv(a, 'コール業務', '') === 'アポ獲得' ? 'アポ獲得' : '架電') : (t.indexOf('商談') === 0 ? '訪問' : 'その他');
        var memo = fv(a, 'タイトル', '');
        var body = fv(a, '内容', '');
        if (body) memo += (memo ? '：' : '') + body;
        var fromSched = body.match(/スケジュールNo\.(\d+) から作成/);
        // 予定の無い訪問(顧客管理の「🚶 訪問を記録」)は、作成した時刻で午前/午後の訪問件数に数える。
        // 予定から作った記録・予定に紐付けた記録は予定の側で数えるので除く(apply で紐付けを見て外す)
        var created = new Date(fv(a, '作成日時', ''));
        var visitAt = t.indexOf('商談') === 0 && !fromSched && date >= VISIT_COUNT_FROM ? (created.getHours() < 12 ? '午前' : '午後') : null;
        return {
          mark: '[履歴No.' + a.$id.value + ']',
          alt: fromSched ? '[予定No.' + fromSched[1] + ']' : null,
          actId: String(a.$id.value), visitAt: visitAt,
          call: t === '電話',
          row: { kubun: kubun, company: fv(a, '会社名', ''), dealNo: fv(a, '案件No', ''), time: ampm(fv(a, '作成日時', '')),
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
        var base = { company: fv(d, '会社名', ''), dealNo: no, time: ampm(fv(d, isNew ? '作成日時' : '更新日時', '')) };
        if (phase === '受注') {
          return alreadyReportedWon(no, selfId).then(function (reported) {
            if (reported) return null; // 別の日報で報告済み
            base.kubun = '受注';
            base.amount = fv(d, '売上', '');
            base.memo = '[案件No.' + no + ' 受注] ' + detail;
            return { mark: '[案件No.' + no + ' 受注]', row: base };
          });
        }
        if (!isNew || phase === '失注') return null; // 新規以外の更新は取り込まない(2026-10-20)
        base.kubun = '見込み';
        base.memo = '[案件No.' + no + '] ' + detail;
        return { mark: '[案件No.' + no + ']', alt: '[案件No.' + no + ' 受注]', row: base };
      })).then(function (items) { return items.filter(Boolean); });
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
          var walk = fv(v, '履歴種別', '') === '飛び込み';
          var kubun = result === '獲得' ? 'アポ獲得' : (result === 'ネタ' ? '見込み' : (walk ? '訪問' : '架電'));
          var mark = '[ネタNo.' + l.$id.value + '-' + r.id + ']';
          var hh = fv(v, '履歴時刻', '');
          var item = { mark: mark, call: !walk, row: { kubun: kubun, company: fv(l, '会社名', ''), time: hh ? (Number(hh.split(':')[0]) < 12 ? '午前' : '午後') : null,
            memo: mark + ' ネタリスト' + (walk ? '飛び込み' : '架電') + ' 結果:' + (result || '-') + (fv(v, '履歴メモ', '') ? ' ' + shorten(fv(v, '履歴メモ', ''), 120) : '') } };
          if (walk) {
            item.walk = Number((fv(v, '履歴時刻', '') || '00').split(':')[0]) < 12 ? '午前' : '午後';
            item.row.time = item.walk;
          }
          items.push(item);
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
      var out = { items: [], am: 0, pm: 0, plan: '', ok: true, linked: [], linkedTime: {} };
      res[0].forEach(function (r) {
        var s = new Date(fv(r, '開始日時', ''));
        var time = s.getHours() < 12 ? '午前' : '午後';
        var st = fv(r, '実施状況', '予定');
        var visit = fv(r, '種類', '') === '訪問' && st !== '中止';
        if (visit) { if (time === '午前') out.am++; else out.pm++; }
        if (fv(r, '活動履歴No', '')) {
          out.linked.push(String(fv(r, '活動履歴No', '')));
          out.linkedTime[String(fv(r, '活動履歴No', ''))] = time;
        }
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
      return { items: [], am: 0, pm: 0, plan: '', ok: false, linked: [], linkedTime: {} };
    });
  }

  // 4アプリからその日の記録を集める。戻り値 {res: [活動履歴, 案件, ネタリスト, 予定の各items], sched}
  function collect(date, userCodes, selfId) {
    var codes = userCodes.map(function (c) { return '"' + c + '"'; }).join(',');
    return Promise.all([
      fromActivities(codes, date),
      fromDeals(codes, date, selfId),
      fromLeads(userCodes, codes, date),
      fromSchedule(codes, date)
    ]).then(function (all) {
      var sched = all[3];
      // 予定から作った・予定に紐付いた活動履歴は、予定の開始時刻で午前/午後
      all[0].forEach(function (it) {
        if (sched.linkedTime[it.actId]) it.row.time = sched.linkedTime[it.actId];
      });
      return { res: [all[0], all[1], all[2], sched.items], sched: sched };
    });
  }

  // 集めた記録を日報のレコードに当てはめる。only: 足してよい記録の判定(省略で全部)
  function apply(record, data, only) {
    var res = data.res, sched = data.sched;
    // 架電件数・飛び込みの訪問は、取り込み済みかに関係なく、その日の全件から数える
    var calls = 0, walkAm = 0, walkPm = 0;
    res.forEach(function (items) {
      items.forEach(function (it) {
        if (it.call) calls++;
        var w = it.walk || (it.visitAt && sched.linked.indexOf(it.actId) < 0 ? it.visitAt : null);
        if (w === '午前') walkAm++;
        if (w === '午後') walkPm++;
      });
    });
    var rows = fv(record, TABLE, []).filter(function (r) { return !isBlankRow(r); });
    var existing = rows.map(function (r) { return fv(r.value, '内容', ''); }).join('\n');
    var counts = [0, 0, 0, 0];
    var merged = 0;
    var byKey = {};
    function register(row) {
      rowKeys(fv(row.value, '明細_会社名', ''), fv(row.value, '明細_案件No', '')).forEach(function (k) {
        if (!byKey[k]) byKey[k] = row;
      });
    }
    rows.forEach(register);
    res.forEach(function (items, i) {
      items.forEach(function (it) {
        if (existing.indexOf(it.mark) !== -1 || (it.alt && existing.indexOf(it.alt) !== -1)) return;
        if (only && !only(it)) return;
        var target = null;
        rowKeys(it.row.company, it.row.dealNo).some(function (k) { target = byKey[k]; return !!target; });
        if (target) {
          mergeInto(target, it.row);
          merged++;
        } else {
          target = makeRow(it.row);
          rows.push(target);
        }
        register(target);
        existing += '\n' + it.mark;
        counts[i]++;
      });
    });
    var out = { counts: counts, total: counts[0] + counts[1] + counts[2] + counts[3], merged: merged };
    // 訪問件数(予定+飛び込み)・架電件数: 数えた方が手入力より多いときだけ上書き
    out.visit = [sched.am + walkAm, sched.pm + walkPm];
    out.visitChanged = false;
    [['訪問_午前', out.visit[0]], ['訪問_午後', out.visit[1]]].forEach(function (v) {
      var cur = Number(fv(record, v[0], 0)) || 0;
      if (v[1] > cur) { record[v[0]].value = String(v[1]); out.visitChanged = true; }
    });
    out.calls = calls;
    out.callChanged = false;
    if (record['架電件数'] && calls > (Number(fv(record, '架電件数', 0)) || 0)) {
      record['架電件数'].value = String(calls);
      out.callChanged = true;
    }
    var goal = fv(record, '明日の目標', '');
    out.planAdded = false;
    if (sched.plan && goal.indexOf('【翌営業日の予定') < 0) {
      record['明日の目標'].value = (goal ? goal + '\n\n' : '') + sched.plan;
      out.planAdded = true;
    }
    if (out.total) record[TABLE].value = rows;
    out.changed = !!(out.total || out.visitChanged || out.callChanged || out.planAdded);
    out.schedOk = sched.ok;
    return out;
  }

  // この画面で一度見た記録の印(保存時は、これ以外=画面を開いた後に入った記録だけを足す)
  var seen = null;
  function remember(data) {
    seen = seen || {};
    data.res.forEach(function (items) { items.forEach(function (it) { seen[it.mark] = true; if (it.alt) seen[it.alt] = true; }); });
  }
  function target(record) {
    var date = fv(record, '日付', '');
    var users = fv(record, '報告者', []);
    return date && users.length ? { date: date, userCodes: users.map(function (u) { return u.code; }) } : null;
  }
  function summary(o) {
    return '活動履歴 ' + o.counts[0] + '件 / 案件管理 ' + o.counts[1] + '件 / ネタリスト ' + o.counts[2] + '件 / スケジュール ' + o.counts[3] + '件' +
      (o.merged ? '\n(うち ' + o.merged + '件は、同じ会社の行にまとめました)' : '') +
      (o.visitChanged ? '\n訪問件数を予定・予定外の訪問から入れました(午前' + o.visit[0] + '・午後' + o.visit[1] + ')' : '') +
      (o.callChanged ? '\n架電件数を入れました(' + o.calls + '件)' : '') +
      (o.planAdded ? '\n翌営業日の予定を「明日の目標」に追記しました' : '') +
      (o.schedOk ? '' : '\n※スケジュールは閲覧権限が無いため取り込めませんでした');
  }
  // ボタンの下に結果を出す(自動取り込みでは確認ダイアログを出さない)
  function notice(text) {
    var btn = document.getElementById(BUTTON_ID);
    if (!btn || !btn.parentNode) return;
    var old = document.getElementById(BUTTON_ID + '-note');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var n = document.createElement('div');
    n.id = BUTTON_ID + '-note';
    n.style.cssText = 'margin:0 12px 8px;padding:6px 10px;border-left:4px solid #3498db;background:#f4f9fd;font-size:13px;white-space:pre-wrap;color:#334155';
    n.textContent = text;
    btn.parentNode.insertBefore(n, btn.nextSibling);
  }

  // ボタン(manual=true)と、新しい日報を開いたときの自動取り込み(manual=false)
  function importNow(manual) {
    var t = target(recApi().get().record);
    if (!t) {
      if (manual) window.alert('日付と報告者を入力してから押してください。');
      return;
    }
    collect(t.date, t.userCodes, recApi().getId()).then(function (data) {
      remember(data);
      var latest = recApi().get(); // 取り込み中に入力された内容を消さないよう、最新を取り直してから当てはめる
      var o = apply(latest.record, data);
      if (!o.changed) {
        if (manual) {
          window.alert('取り込める新しい情報はありませんでした。\n(活動履歴・案件管理・ネタリスト・スケジュールに、この日・この報告者の入力が無いか、すべて取り込み済みです)' +
            (o.schedOk ? '' : '\n※スケジュールは閲覧権限が無いため取り込めませんでした'));
        } else {
          notice('この日の活動(活動履歴・案件・ネタリスト・予定)はまだありません。保存するときに、それまでに入った分を自動で取り込みます。');
        }
        return;
      }
      recApi().set(latest);
      var msg = summary(o) + '\n\n時間帯・区分・金額を確認し、上の「今日の数字」も見直してから保存してください。';
      if (manual) window.alert('取り込みました:\n' + msg);
      else notice('今日の活動を自動で取り込みました:\n' + msg);
    }).catch(function (e) {
      console.error(e);
      if (manual) window.alert('取り込みに失敗しました。時間をおいて再度お試しください。');
      else notice('今日の活動の自動取り込みに失敗しました。上のボタンでもう一度取り込んでください。');
    });
  }

  // 編集画面を開いたとき: 足さずに、今ある記録の印だけ覚える(保存時に、後から入った分だけ足すため)
  function rememberOnly() {
    var t = target(recApi().get().record);
    if (!t) return;
    collect(t.date, t.userCodes, recApi().getId()).then(remember).catch(function () { /* 読めなければ保存時は何もしない(seen は空のまま) */ });
  }

  kintone.events.on(['app.record.create.show', 'app.record.edit.show',
    'mobile.app.record.create.show', 'mobile.app.record.edit.show'], function (event) {
    detectEnv(event);
    seen = null;
    // スマホは画面遷移しても前のボタンが残ることがあるため作り直す
    var old = document.getElementById(BUTTON_ID);
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var oldNote = document.getElementById(BUTTON_ID + '-note');
    if (oldNote && oldNote.parentNode) oldNote.parentNode.removeChild(oldNote);
    var space = IS_MOBILE ? kintone.mobile.app.getHeaderSpaceElement() : kintone.app.record.getHeaderMenuSpaceElement();
    if (space) {
      var btn = document.createElement('button');
      btn.id = BUTTON_ID;
      btn.type = 'button';
      btn.textContent = '今日の活動を自動取り込み（活動履歴・案件・ネタリスト・予定）';
      btn.style.cssText = 'margin:8px 12px;padding:6px 14px;border:1px solid #3498db;background:#fff;color:#3498db;border-radius:4px;cursor:pointer;font-size:14px;' +
        (IS_MOBILE ? 'display:block;width:calc(100% - 24px);padding:10px 14px;' : '');
      btn.addEventListener('click', function () { importNow(true); });
      space.appendChild(btn);
    }
    // 新しい日報は開いたら自動で取り込む。編集は印だけ覚える(表示が終わってから動かす)
    var isCreate = event.type.indexOf('create') >= 0;
    setTimeout(function () { if (isCreate) importNow(false); else rememberOnly(); }, 0);
    return event;
  });

  // 保存するとき: 画面を開いた後(最後に取り込んだ後)に新しく入った記録だけを足す。失敗しても保存は止めない
  kintone.events.on(['app.record.create.submit', 'app.record.edit.submit',
    'mobile.app.record.create.submit', 'mobile.app.record.edit.submit'], function (event) {
    detectEnv(event);
    var t = target(event.record);
    if (!t || !seen) return event; // まだ一度も記録を読めていない(読み込み失敗・すぐ保存)ときは何もしない
    return collect(t.date, t.userCodes, event.recordId || null).then(function (data) {
      apply(event.record, data, function (it) { return !seen[it.mark] && !(it.alt && seen[it.alt]); });
      return event;
    }).catch(function (e) {
      console.warn('保存時の取り込みに失敗しました(保存は続けます)', e);
      return event;
    });
  });

  // ---------- 明細の案件No. → 会社名 ----------
  // change イベントは Promise を待たないので、取得後に set し直す。
  // どの行が変わったかは追わず、案件No.があって会社名が空の行をまとめて埋める
  function fillCompanyFromDeals() {
    var rows = fv(recApi().get().record, TABLE, []);
    var nos = [];
    rows.forEach(function (r) {
      var no = fv(r.value, '明細_案件No', '');
      if (no && !fv(r.value, '明細_会社名', '') && nos.indexOf(no) === -1) nos.push(no);
    });
    if (!nos.length) return;
    getAll(APP.deal, '案件No_ in (' + nos.join(',') + ')').then(function (recs) {
      var names = {};
      recs.forEach(function (d) { names[fv(d, '案件No_', '')] = fv(d, '会社名', ''); });
      var latest = recApi().get();
      var changed = false;
      fv(latest.record, TABLE, []).forEach(function (r) {
        var name = names[fv(r.value, '明細_案件No', '')];
        if (name && !fv(r.value, '明細_会社名', '')) { r.value['明細_会社名'].value = name; changed = true; }
      });
      if (changed) recApi().set(latest);
    }).catch(function (e) { console.warn('案件の会社名を取得できませんでした', e); });
  }

  kintone.events.on(['app.record.create.change.明細_案件No', 'app.record.edit.change.明細_案件No',
    'mobile.app.record.create.change.明細_案件No', 'mobile.app.record.edit.change.明細_案件No'], function (event) {
    detectEnv(event);
    // 取得直後は値がまだ反映途中のことがあるため、イベントを返してから読む
    setTimeout(fillCompanyFromDeals, 0);
    return event;
  });

  // ---------- スマホの一覧: 列幅を中身に合わせて詰める ----------
  // スマホ(ブラウザ)の一覧は全列が150px固定で、日付と報告者だけで画面が埋まるため。
  // 利用者が列の境目をドラッグして変えた幅は尊重し、150pxのままの列だけを変える。
  var MOBILE_COL_WIDTH = {
    '日付': 88, '報告者': 104,
    '訪問件数（午前）': 58, '訪問件数（午後）': 58, '訪問件数（合計）': 58, '架電件数': 58, 'アポ件数': 58, '見込み件数': 58, '受注件数': 58,
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
