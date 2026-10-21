/*
 * 週報・月報(app36)の「期間と実績を集計」ボタン(作成・編集画面)。
 * クラウドの自動作成(週報月報自動作成/main.py)と同じ数え方・同じ目標の按分にそろえている。
 *  - 実績の数え方は日報ボードと同じ: 訪問=訪問合計、
 *    架電・アポ・見込み=欄と明細の行数の大きい方、受注=受注件数。土日の実績も含め、平日/土日の内訳も出す
 *  - 目標はチーム目標(app37、対象月=暦の月。10月=10/1〜10/31。2026-10-22に月度(21日〜翌月20日)から変更)。
 *    期間に含まれる各月の目標を営業日(平日)の日数で按分して合計する。月報(1日〜月末)ならその月の目標そのもの。
 *    個人レポートはチーム目標と比べないので目標欄を空にする
 */
(function () {
  'use strict';

  var BUTTON_ID = 'weekly-monthly-aggregate-button';
  var IS_MOBILE = false;
  var DAY_MS = 24 * 60 * 60 * 1000;

  function recordApi() {
    return IS_MOBILE ? kintone.mobile.app.record : kintone.app.record;
  }

  function detectEnvironment(event) {
    IS_MOBILE = event.type.indexOf('mobile.') === 0;
  }

  function value(record, code) {
    return record && record[code] ? record[code].value : '';
  }

  function fieldValue(record, code, nextValue) {
    if (record[code]) {
      record[code].value = nextValue;
    }
  }

  function formatDate(date) {
    var year = date.getFullYear();
    var month = ('0' + (date.getMonth() + 1)).slice(-2);
    var day = ('0' + date.getDate()).slice(-2);
    return year + '-' + month + '-' + day;
  }

  function setDefaultPeriod(record, type) {
    var today = new Date();
    var anchor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    var start;
    var end;
    if (type === '月報') {
      // 先月の1日〜月末
      start = new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1);
      end = new Date(anchor.getFullYear(), anchor.getMonth(), 0);
    } else {
      var daysSinceSunday = today.getDay() || 7;
      end = new Date(today.getTime());
      end.setDate(today.getDate() - daysSinceSunday);
      start = new Date(end.getTime());
      start.setDate(end.getDate() - 6);
    }
    fieldValue(record, 'period_start', formatDate(start));
    fieldValue(record, 'period_end', formatDate(end));
  }

  function escapeQuery(valueToEscape) {
    return String(valueToEscape).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function apiGet(path, params) {
    return kintone.api(kintone.api.url(path, true), 'GET', params);
  }

  function getRecords(app, query, fields) {
    var result = [];
    function fetch(offset) {
      return apiGet('/k/v1/records.json', {
        app: app,
        query: (query ? query + ' ' : '') + 'limit 500 offset ' + offset,
        fields: fields
      }).then(function (response) {
        result = result.concat(response.records);
        if (response.records.length === 500) {
          return fetch(offset + 500);
        }
        return result;
      });
    }
    return fetch(0);
  }

  function countRecords(app, query) {
    return apiGet('/k/v1/records.json', {
      app: app,
      query: query + ' limit 1',
      totalCount: true,
      fields: ['$id']
    }).then(function (response) {
      return Number(response.totalCount);
    });
  }

  function isWeekend(dateValue) {
    if (!dateValue) {
      return false;
    }
    var weekday = new Date(dateValue.slice(0, 10) + 'T00:00:00Z').getUTCDay();
    return weekday === 0 || weekday === 6;
  }

  function sumForDayType(records, dateCode, valueCode, weekend) {
    return records.reduce(function (total, record) {
      if (isWeekend(value(record, dateCode)) !== weekend) {
        return total;
      }
      var amount = valueCode ? Number(value(record, valueCode)) : 1;
      return total + (isFinite(amount) ? amount : 0);
    }, 0);
  }

  // ---------- 日報1件の実績(日報ボードと同じ数え方) ----------
  var METRICS = ['visits', 'calls', 'appointments', 'prospects', 'orders', 'revenue'];

  function realRows(report) {
    return (value(report, '活動明細') || []).filter(function (row) {
      return value(row.value, '明細_会社名') || value(row.value, '内容') || value(row.value, '明細_案件No');
    });
  }

  function reportMetrics(report) {
    var rows = realRows(report);
    function kind(name) {
      return rows.filter(function (row) { return value(row.value, '区分') === name; }).length;
    }
    function num(code) { var n = Number(value(report, code)); return isFinite(n) ? n : 0; }
    return {
      visits: num('訪問合計'),
      calls: Math.max(num('架電件数'), kind('架電')),
      appointments: Math.max(num('アポ件数'), kind('アポ獲得')),
      prospects: Math.max(num('見込み件数'), kind('見込み')),
      orders: num('受注件数'),
      revenue: num('受注金額合計')
    };
  }

  function sumMetrics(reports) {
    var total = {};
    METRICS.forEach(function (key) { total[key] = 0; });
    reports.forEach(function (report) {
      var m = reportMetrics(report);
      METRICS.forEach(function (key) { total[key] += m[key]; });
    });
    return total;
  }

  // ---------- 月(1日〜月末)とチーム目標の按分 ----------
  var GOAL_FIELDS = [
    ['訪問目標', 'goal_visits', 0], ['架電目標', 'goal_calls', 0], ['アポ目標', 'goal_appointments', 0],
    ['受注件数目標', 'goal_orders', 1], ['受注金額目標', 'goal_revenue', 0]
  ];

  function pad2(n) { return ('0' + n).slice(-2); }
  function addDay(ymd, n) {
    var d = new Date(ymd + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function fiscalMonth(ymd) {
    var y = +ymd.slice(0, 4), m = +ymd.slice(5, 7);
    var last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return { key: y + '-' + pad2(m) + '-01', month: m, start: y + '-' + pad2(m) + '-01', end: y + '-' + pad2(m) + '-' + pad2(last) };
  }
  function weekdaysBetween(from, to) {
    var n = 0, d = from;
    while (d <= to) { if (!isWeekend(d)) n++; d = addDay(d, 1); }
    return n;
  }

  function proratedGoals(start, end) {
    var parts = [];
    var d = start;
    while (d <= end) {
      var fm = fiscalMonth(d);
      var ps = start > fm.start ? start : fm.start;
      var pe = end < fm.end ? end : fm.end;
      parts.push({ fm: fm, part: weekdaysBetween(ps, pe), whole: weekdaysBetween(fm.start, fm.end) });
      d = addDay(fm.end, 1);
    }
    return Promise.all(parts.map(function (p) {
      // チーム目標の対象月はその月の1日で入力する(その月の中の日付なら拾える)
      return getRecords(37, makeDateQuery('対象月', p.fm.start, p.fm.end),
        GOAL_FIELDS.map(function (g) { return g[0]; }))
        .then(function (recs) { return recs[0] || null; }, function () { return null; });
    })).then(function (goals) {
      var out = {};
      GOAL_FIELDS.forEach(function (g) {
        var total = 0;
        for (var i = 0; i < parts.length; i++) {
          var raw = goals[i] ? value(goals[i], g[0]) : '';
          if (raw === '' || raw === null || raw === undefined || !parts[i].whole) { total = null; break; }
          total += Number(raw) * parts[i].part / parts[i].whole;
        }
        var scale = Math.pow(10, g[2]);
        out[g[1]] = total === null ? '' : Math.round(total * scale) / scale;
      });
      out.goal_note = parts.map(function (p, i) {
        if (!goals[i]) return p.fm.month + '月の目標は未登録';
        return p.part === p.whole ? p.fm.month + '月目標' : p.fm.month + '月目標×' + p.part + '/' + p.whole + '営業日';
      }).join('＋');
      return out;
    });
  }

  function getTargetCode(record) {
    var users = value(record, 'subject_user');
    return users && users.length ? users[0].code : '';
  }

  function makeDateQuery(field, start, end) {
    return field + ' >= "' + escapeQuery(start) + '" and ' +
      field + ' <= "' + escapeQuery(end) + '"';
  }

  function countByPhase(deals) {
    var counts = {};
    deals.forEach(function (deal) {
      var phase = value(deal, '商談フェーズ') || 'フェーズ未入力';
      counts[phase] = (counts[phase] || 0) + 1;
    });
    return Object.keys(counts).sort().map(function (phase) {
      return phase + ': ' + counts[phase] + '件';
    }).join('、');
  }

  function aggregate(record) {
    var start = value(record, 'period_start');
    var end = value(record, 'period_end');
    var scope = value(record, 'scope');
    var targetCode = getTargetCode(record);

    if (!start || !end) {
      return Promise.reject(new Error('期間開始と期間終了を入力してください。'));
    }
    if (start > end) {
      return Promise.reject(new Error('期間開始は期間終了以前の日付にしてください。'));
    }
    if (scope === '個人' && !targetCode) {
      return Promise.reject(new Error('個人レポートでは対象者を選択してください。'));
    }

    var dailyQuery = makeDateQuery('日付', start, end);
    var activityQuery = makeDateQuery('対応日付', start, end);
    var dealQuery = '';
    var scheduleQuery = '種類 in ("訪問") and 実施状況 in ("予定") and ' +
      '終了日時 < NOW() and 元予定No = ""';
    var userClause;
    if (scope === '個人') {
      userClause = ' in ("' + escapeQuery(targetCode) + '")';
      dailyQuery += ' and 報告者' + userClause;
      activityQuery += ' and 対応者' + userClause;
      dealQuery = '主担当' + userClause;
      scheduleQuery += ' and 参加者' + userClause;
    }

    var today = formatDate(new Date());
    var callQuery = '次回架電予定日 != "" and 次回架電予定日 < "' +
      escapeQuery(today) + '"';

    return Promise.all([
      getRecords(32, dailyQuery, [
        '日付', '報告者', '訪問合計', '架電件数', 'アポ件数', '見込み件数', '受注件数', '受注金額合計', '活動明細'
      ]),
      getRecords(17, activityQuery, ['対応日付', '対応者', '対応種別']),
      getRecords(19, dealQuery, [
        '商談フェーズ', '主担当', '次回商談日', '受注予定日', '売上'
      ]),
      getRecords(29, callQuery, ['進捗状況', '次回架電予定日']),
      countRecords(34, scheduleQuery),
      scope === '個人' ? Promise.resolve(null) : proratedGoals(start, end)
    ]).then(function (results) {
      var reports = results[0];
      var activities = results[1];
      var deals = results[2];
      var overdueCalls = results[3].filter(function (lead) {
        return ['未着手', '架電済み'].indexOf(value(lead, '進捗状況')) !== -1;
      }).length;
      var unreportedVisits = results[4];
      var now = new Date();
      var activeDeals = deals.filter(function (deal) {
        return ['受注', '失注', '保留/中止'].indexOf(value(deal, '商談フェーズ')) === -1;
      });
      var overdueDeals = activeDeals.filter(function (deal) {
        var nextMeeting = value(deal, '次回商談日');
        return nextMeeting && new Date(nextMeeting).getTime() < now.getTime();
      });
      var noNextMeeting = activeDeals.filter(function (deal) {
        return !value(deal, '次回商談日');
      });

      var candidateLines = [];
      if (overdueDeals.length) {
        candidateLines.push('次回商談日が過ぎた進行中案件が' + overdueDeals.length +
          '件あります。状況と次の対応日を確認してください。');
      }
      if (noNextMeeting.length) {
        candidateLines.push('次回商談日が未設定の進行中案件が' + noNextMeeting.length +
          '件あります。次の接点を決める候補です。');
      }
      if (overdueCalls) {
        candidateLines.push('【全社】次回架電予定日を過ぎた未着手・架電済みリードが' +
          overdueCalls + '件あります。担当と優先順位を確認してください。');
      }
      if (unreportedVisits) {
        candidateLines.push('終了時刻を過ぎても「予定」の訪問が' + unreportedVisits +
          '件あります。完了・中止の更新漏れがないか確認してください。');
      }
      if (!reports.length) {
        candidateLines.push('対象期間の日報がありません。休暇等を確認し、実績ゼロと未提出を区別してください。');
      }
      if (!candidateLines.length) {
        candidateLines.push('自動判定した確認候補はありません。重要案件と次の接点を目視で確認してください。');
      }
      candidateLines.push('自動集計は登録済みデータを対象とします。勤務日・休暇は判定していません。');

      var goals = results[5];
      var recordToSet = recordApi().get().record;
      fieldValue(recordToSet, 'daily_reports', reports.length);
      fieldValue(recordToSet, 'activity_count', activities.length);
      var totals = sumMetrics(reports);
      METRICS.forEach(function (key) { fieldValue(recordToSet, key, totals[key]); });
      ['weekday', 'weekend'].forEach(function (dayType) {
        var weekend = dayType === 'weekend';
        var dayReports = reports.filter(function (r) { return isWeekend(value(r, '日付')) === weekend; });
        fieldValue(recordToSet, dayType + '_daily_reports', dayReports.length);
        fieldValue(recordToSet, dayType + '_activity_count',
          sumForDayType(activities, '対応日付', null, weekend));
        var part = sumMetrics(dayReports);
        METRICS.forEach(function (key) { fieldValue(recordToSet, dayType + '_' + key, part[key]); });
      });
      GOAL_FIELDS.forEach(function (g) { fieldValue(recordToSet, g[1], goals ? goals[g[1]] : ''); });
      fieldValue(recordToSet, 'goal_note', goals ? goals.goal_note : '個人レポートはチーム目標と比べません');
      fieldValue(recordToSet, 'overdue_deals', overdueDeals.length);
      fieldValue(recordToSet, 'overdue_calls', overdueCalls);
      fieldValue(recordToSet, 'unreported_visits', unreportedVisits);
      fieldValue(recordToSet, 'pipeline_summary',
        '案件状況（現在）: ' + (countByPhase(deals) || '対象案件なし') +
        '\n進行中案件: ' + activeDeals.length + '件');
      fieldValue(recordToSet, 'follow_up_candidates', candidateLines.join('\n'));
      fieldValue(recordToSet, 'aggregated_at', now.toISOString());
      recordApi().set({ record: recordToSet });
    });
  }

  function addAggregateButton(event) {
    detectEnvironment(event);
    var oldButton = document.getElementById(BUTTON_ID);
    if (oldButton && oldButton.parentNode) {
      oldButton.parentNode.removeChild(oldButton);
    }

    var space = IS_MOBILE ? kintone.mobile.app.getHeaderSpaceElement() :
      kintone.app.record.getHeaderMenuSpaceElement();
    if (!space) {
      return event;
    }

    var button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.textContent = '期間と実績を集計';
    button.style.cssText = IS_MOBILE ?
      'display:block;width:calc(100% - 24px);margin:8px 12px;padding:10px 14px;' :
      'margin:8px;padding:8px 14px;';
    button.addEventListener('click', function () {
      button.disabled = true;
      aggregate(recordApi().get().record).catch(function (error) {
        window.alert('集計に失敗しました: ' + error.message);
      }).then(function () {
        button.disabled = false;
      });
    });
    space.appendChild(button);
    return event;
  }

  var showEvents = [
    'app.record.create.show',
    'app.record.edit.show',
    'mobile.app.record.create.show',
    'mobile.app.record.edit.show'
  ];
  kintone.events.on(showEvents, function (event) {
    detectEnvironment(event);
    if (event.type.indexOf('.create.show') !== -1) {
      var type = value(event.record, 'report_type') || '週報';
      if (!value(event.record, 'period_start') || !value(event.record, 'period_end')) {
        setDefaultPeriod(event.record, type);
      }
    }
    return addAggregateButton(event);
  });

  kintone.events.on([
    'app.record.create.change.report_type',
    'mobile.app.record.create.change.report_type'
  ], function (event) {
    detectEnvironment(event);
    setDefaultPeriod(event.record, value(event.record, 'report_type'));
    return event;
  });

  kintone.events.on([
    'app.record.edit.change.report_type',
    'mobile.app.record.edit.change.report_type'
  ], function (event) {
    detectEnvironment(event);
    setDefaultPeriod(event.record, value(event.record, 'report_type'));
    return event;
  });
})();
