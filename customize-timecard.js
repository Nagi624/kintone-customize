/*
 * タイムカード(app27)カスタマイズ
 * - 社員番号: ログインユーザーのプロフィール「社員番号」(cybozu共通管理、例: T-0001)を新規作成時に自動セットし、編集不可にする
 *   (freee人事労務の従業員番号と同じ値。freee反映時の従業員特定キー)
 * - 休憩: 通常勤務/早退は90分固定、半休/終日休/休日は0分として自動セットし、編集不可にする
 *   (勤務時間の計算式側でも同じ値を固定で使っているため、表示を揃える目的)
 * - 20日締め: 新規作成時に「前月21日〜当月20日」の全日分の明細行を自動生成する
 *   (平日=通常勤務 9:00〜17:00、土日・祝日=休日)。起算日を変えるとその日を含む締め期間で作り直す
 *   祝日は holidays-jp API から取得し、取得できなければ土日のみ休日にする
 */
(function () {
  'use strict';

  var FIXED_BREAK_MIN = 90;
  var CLOSING_DAY = 20;
  var START_TIME = '09:00';
  var END_TIME = '17:00';
  var HOLIDAY_API = 'https://holidays-jp.github.io/api/v1/date.json';

  var holidays = {};

  function fv(obj, code, fallback) {
    return obj && obj[code] && obj[code].value !== undefined ? obj[code].value : fallback;
  }

  function pad(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function ymd(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function parseYmd(s) {
    var p = s.split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }

  function breakFor(kintai) {
    return kintai === '通常勤務' || kintai === '早退' ? FIXED_BREAK_MIN : 0;
  }

  function applyBreak(record) {
    var rows = fv(record, '明細', []);
    rows.forEach(function (row) {
      if (!row.value || !row.value['休憩']) return;
      row.value['休憩'].value = String(breakFor(fv(row.value, '勤怠', '')));
      row.value['休憩'].disabled = true;
    });
  }

  function applyEmployeeNumber(record, isCreate) {
    var field = record['社員番号'];
    if (!field || field.type !== 'SINGLE_LINE_TEXT') return;
    if (isCreate || !field.value) {
      var user = kintone.getLoginUser();
      field.value = user.employeeNumber || '';
    }
    field.disabled = true;
  }

  // 基準日を含む締め期間(前月21日〜当月20日)を返す
  function closingPeriod(base) {
    var y = base.getFullYear();
    var m = base.getMonth();
    if (base.getDate() <= CLOSING_DAY) m -= 1;
    var start = new Date(y, m, CLOSING_DAY + 1);
    var end = new Date(start.getFullYear(), start.getMonth() + 1, CLOSING_DAY);
    return { start: start, end: end };
  }

  function makeRow(dateStr, isHoliday) {
    var kintai = isHoliday ? '休日' : '通常勤務';
    return {
      value: {
        '日付': { type: 'DATE', value: dateStr },
        '勤怠': { type: 'DROP_DOWN', value: kintai },
        '出勤': { type: 'TIME', value: isHoliday ? '' : START_TIME },
        '退勤': { type: 'TIME', value: isHoliday ? '' : END_TIME },
        '休憩': { type: 'NUMBER', value: String(breakFor(kintai)), disabled: true },
        '勤務時間': { type: 'CALC', value: '' },
        '残業時間': { type: 'CALC', value: '' },
        '備考': { type: 'SINGLE_LINE_TEXT', value: holidays[dateStr] || '' }
      }
    };
  }

  function buildMonth(record) {
    var baseStr = fv(record, '起算日', '') || ymd(new Date());
    var period = closingPeriod(parseYmd(baseStr));
    var rows = [];
    for (var d = new Date(period.start); d <= period.end; d.setDate(d.getDate() + 1)) {
      var s = ymd(d);
      var dow = d.getDay();
      rows.push(makeRow(s, dow === 0 || dow === 6 || !!holidays[s]));
    }
    record['明細'].value = rows;
    record['起算日'].value = ymd(period.start);
    if (record['対象月']) {
      record['対象月'].value = period.end.getFullYear() + '年' + (period.end.getMonth() + 1) + '月分（' +
        (period.start.getMonth() + 1) + '/' + period.start.getDate() + '〜' +
        (period.end.getMonth() + 1) + '/' + period.end.getDate() + '）';
      record['対象月'].disabled = true;
    }
  }

  function loadHolidays() {
    if (!window.fetch) return Promise.resolve();
    return fetch(HOLIDAY_API).then(function (res) {
      return res.ok ? res.json() : {};
    }).then(function (json) {
      holidays = json || {};
    }).catch(function () {
      holidays = {};
    });
  }

  kintone.events.on(['app.record.create.show', 'mobile.app.record.create.show'], function (event) {
    applyEmployeeNumber(event.record, true);
    return loadHolidays().then(function () {
      buildMonth(event.record);
      return event;
    });
  });

  kintone.events.on(['app.record.edit.show', 'mobile.app.record.edit.show'], function (event) {
    applyEmployeeNumber(event.record, false);
    applyBreak(event.record);
    if (event.record['対象月']) event.record['対象月'].disabled = true;
    return event;
  });

  kintone.events.on(['app.record.create.change.起算日', 'mobile.app.record.create.change.起算日'], function (event) {
    if (fv(event.record, '起算日', '')) buildMonth(event.record);
    return event;
  });

  var changeEvents = [];
  ['app.record', 'mobile.app.record'].forEach(function (p) {
    ['create', 'edit'].forEach(function (m) {
      changeEvents.push(p + '.' + m + '.change.勤怠');
      changeEvents.push(p + '.' + m + '.change.明細');
    });
  });
  kintone.events.on(changeEvents, function (event) {
    applyBreak(event.record);
    scheduleColor();
    return event;
  });

  // 勤怠セルの色分け(PCの詳細/作成/編集画面)。サブテーブル内セルの色付けAPIは無いためDOMで行う
  var KINTAI_COLORS = {
    '通常勤務': '#e3f2fd',
    '休日': '#eeeeee',
    '終日休': '#ffd6d6',
    '午前休': '#ffe7c2',
    '午後休': '#fff6bf',
    '早退': '#e8dcf7'
  };
  var colorObserver = null;
  var colorTimer = null;

  function findKintaiColumn(table) {
    var ths = table.querySelectorAll('thead th');
    for (var i = 0; i < ths.length; i++) {
      if (ths[i].textContent.trim() === '勤怠') return i;
    }
    return -1;
  }

  function colorKintai() {
    var table = document.querySelector('.subtable-gaia');
    if (!table) return;
    var col = findKintaiColumn(table);
    if (col < 0) return;
    var rec;
    try {
      rec = kintone.app.record.get().record;
    } catch (e) {
      return;
    }
    var rows = fv(rec, '明細', []);
    var trs = table.querySelectorAll('tbody > tr');
    for (var i = 0; i < trs.length; i++) {
      var td = trs[i].children[col];
      if (!td) continue;
      var kintai = rows[i] ? fv(rows[i].value, '勤怠', '') : '';
      var color = KINTAI_COLORS[kintai] || '';
      td.style.backgroundColor = color;
      var inner = td.querySelectorAll('.gaia-argoui-select, .control-value-gaia');
      for (var j = 0; j < inner.length; j++) inner[j].style.backgroundColor = color;
    }
  }

  function scheduleColor() {
    clearTimeout(colorTimer);
    colorTimer = setTimeout(colorKintai, 50);
  }

  function watchSubtable() {
    if (colorObserver) colorObserver.disconnect();
    var table = document.querySelector('.subtable-gaia');
    if (!table) return;
    // 自分のstyle変更で無限ループしないよう、attributesは監視しない
    colorObserver = new MutationObserver(scheduleColor);
    colorObserver.observe(table, { childList: true, subtree: true, characterData: true });
    scheduleColor();
  }

  kintone.events.on(['app.record.detail.show', 'app.record.create.show', 'app.record.edit.show'], function (event) {
    setTimeout(watchSubtable, 0);
    return event;
  });

  var submitEvents = ['app.record.create.submit', 'app.record.edit.submit',
    'mobile.app.record.create.submit', 'mobile.app.record.edit.submit'];
  kintone.events.on(submitEvents, function (event) {
    applyBreak(event.record);
    return event;
  });
})();
