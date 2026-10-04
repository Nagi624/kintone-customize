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
 *
 * 二重取り込み防止: 内容の先頭に [履歴No.X] [案件No.X] [ネタNo.X-行ID] [ネタ新規] の印を付け、既にある印はスキップする
 */
(function () {
  'use strict';

  var APP = { activity: 17, deal: 19, lead: 29 };
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
        '時間帯': { type: 'DROP_DOWN', value: null },
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
        return {
          mark: '[履歴No.' + a.$id.value + ']',
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
      fromLeads(userCodes, codes, date)
    ]).then(function (res) {
      var latest = recApi().get();
      var rows = fv(latest.record, TABLE, []).filter(function (r) { return !isBlankRow(r); });
      var existing = rows.map(function (r) { return fv(r.value, '内容', ''); }).join('\n');
      var counts = [0, 0, 0];
      res.forEach(function (items, i) {
        items.forEach(function (it) {
          if (existing.indexOf(it.mark) !== -1 || (it.alt && existing.indexOf(it.alt) !== -1)) return;
          rows.push(makeRow(it.row));
          existing += '\n' + it.mark;
          counts[i]++;
        });
      });
      var total = counts[0] + counts[1] + counts[2];
      if (!total) {
        window.alert('取り込める新しい情報はありませんでした。\n(活動履歴・案件管理・ネタリストに、この日・この報告者の入力が無いか、すべて取り込み済みです)');
        return;
      }
      latest.record[TABLE].value = rows;
      recApi().set(latest);
      window.alert('取り込みました:\n活動履歴 ' + counts[0] + '件 / 案件管理 ' + counts[1] + '件 / ネタリスト ' + counts[2] +
        '件\n\n時間帯・区分・金額を確認し、上の「今日の数字」も見直してから保存してください。');
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
      btn.textContent = '今日の活動を自動取り込み（活動履歴・案件・ネタリスト）';
      btn.style.cssText = 'margin:8px 12px;padding:6px 14px;border:1px solid #3498db;background:#fff;color:#3498db;border-radius:4px;cursor:pointer;font-size:14px;' +
        (IS_MOBILE ? 'display:block;width:calc(100% - 24px);padding:10px 14px;' : '');
      btn.addEventListener('click', importAll);
      space.appendChild(btn);
    }
    return event;
  });
})();
