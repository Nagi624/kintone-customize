/**
 * ネタリストアプリ用 「顧客管理へ登録」ボタン
 * - レコード詳細画面のボタンをクリックすると、基本情報(会社名・住所・電話番号・
 *   大分類・中分類・緯度経度・出典URL→Webサイト・業種メモ・営業時間・定休日)を自動入力した状態で
 *   顧客管理(app18)に新規レコードをAPI経由で直接作成する(基本情報の再入力・再確認は不要)
 *   ※ 大分類・中分類は顧客管理側も同じ選択肢セットのため、マッピングなしでそのままコピーする
 * - 「顧客ランク」(必須項目)は営業側の主観判断が必要なため、仮に最低ランク「D」で
 *   作成し、作成直後に開くレコード画面でその場で修正してもらう運用
 * - ネタリストの「架電履歴」サブテーブルは、顧客管理への登録と同時に活動履歴(app17)へ
 *   1行=1レコードとして実登録する(対応種別は「電話」固定、会社名はルックアップで顧客管理と自動紐付け)。
 *   これにより顧客管理側の「活動履歴一覧」に転換前の接触履歴がそのまま表示される
 * - スケジュール(app34)でこのネタに紐づいていた予定は、新しい顧客に付け替える
 * - 顧客管理への登録に成功したら、ネタリスト側の元レコードは削除する
 *   (コピーではなく「移動」として扱う)
 * - 誤操作防止のため、作成前に確認ダイアログを一度挟む(削除される旨も明記)
 * - PC・スマートフォンブラウザ両対応
 */
(function () {
  "use strict";

  var CUSTOMER_APP_ID = "18";
  var ACTIVITY_APP_ID = "17";
  var TANTOSHA_APP_ID = "20";
  var SCHEDULE_APP_ID = "34";
  var DEFAULT_CUSTOMER_RANK = "D";
  var IS_MOBILE = false;

  // PCとスマホでレコード画面のURL形式が違う
  function recordUrl(appId, recordId) {
    var base = location.protocol + "//" + location.host;
    return IS_MOBILE ? base + "/k/m/" + appId + "/show?record=" + recordId : base + "/k/" + appId + "/show#record=" + recordId;
  }

  var LEAD_APP_ID = "29"; // ネタリスト(読み込み時点ではスマホでgetIdが取れないことがあるため固定)


  function fv(record, code, fallback) {
    return record && record[code] && record[code].value != null ? record[code].value : fallback !== undefined ? fallback : "";
  }

  function splitName(fullName) {
    var trimmed = (fullName || "").trim();
    if (!trimmed) return { sei: "", mei: "" };
    var parts = trimmed.split(/[\s　]+/);
    if (parts.length === 1) return { sei: parts[0], mei: "" };
    return { sei: parts[0], mei: parts.slice(1).join(" ") };
  }

  function createTantoshaFromLead(record) {
    var tantoshaName = fv(record, "担当者氏名", "");
    if (!tantoshaName) return Promise.resolve(null);
    var name = splitName(tantoshaName);
    var body = {
      app: TANTOSHA_APP_ID,
      record: {
        "姓": { value: name.sei },
        "名": { value: name.mei },
        "役職": { value: fv(record, "担当者役職", "") },
        "携帯番号": { value: fv(record, "担当者携帯電話", "") },
        "メールアドレス": { value: fv(record, "担当者メール", "") },
        "顧客名": { value: fv(record, "会社名", "") },
        "決裁権": { value: "なし" },
        "備考": { value: "ネタリストより自動登録(顧客ランクは仮置きのD。登録内容を確認・修正してください)" },
        "名刺画像リンク": { value: fv(record, "元名刺リンク", "") },
      },
    };
    return kintone.api(kintone.api.url("/k/v1/record", true), "POST", body);
  }

  function getCallHistoryRows(record) {
    var table = record && record["架電履歴"] && record["架電履歴"].value;
    return table || [];
  }

  function buildCustomerRecord(record) {
    var majorCategory = fv(record, "大分類", "");
    var minorCategory = fv(record, "中分類", "");
    var address = fv(record, "市区町村", "") + fv(record, "丁目番地等", "");
    var status = fv(record, "確認ステータス", "");
    var memo = fv(record, "業種確認メモ", "");
    var callHistoryRows = getCallHistoryRows(record);

    var memoLines = [
      "ネタリストより自動登録(顧客ランクは仮置きのD。登録内容を確認・修正してください)",
      "元カテゴリ: " + majorCategory + (minorCategory && minorCategory !== "-" ? " / " + minorCategory : "") +
        " / 確認ステータス: " + status + " / 業種確認メモ: " + memo,
    ];
    if (callHistoryRows.length) {
      memoLines.push("転換前の架電履歴(" + callHistoryRows.length + "件)は活動履歴タブを参照してください。");
    }

    var out = {
      "会社名": { value: fv(record, "会社名", "") },
      "顧客ランク": { value: DEFAULT_CUSTOMER_RANK },
      "顧客情報メモ欄": { value: memoLines.join("\n") },
    };

    var optional = {
      "郵便番号": fv(record, "郵便番号", ""),
      "都道府県": fv(record, "都道府県", ""),
      "住所": address,
      "電話番号": fv(record, "電話番号", ""),
      "大分類": majorCategory,
      "中分類": minorCategory,
      "Webサイト": fv(record, "出典URL", ""),
      "業種メモ": memo,
      "営業時間": fv(record, "営業時間", ""),
      "定休日": fv(record, "定休日", ""),
    };
    Object.keys(optional).forEach(function (key) {
      if (optional[key]) out[key] = { value: optional[key] };
    });

    var lat = fv(record, "緯度", "");
    var lon = fv(record, "経度", "");
    if (lat !== "") out["緯度"] = { value: lat };
    if (lon !== "") out["経度"] = { value: lon };

    return out;
  }

  function createCustomerRecord(record) {
    var body = { app: CUSTOMER_APP_ID, record: buildCustomerRecord(record) };
    return kintone.api(kintone.api.url("/k/v1/record", true), "POST", body);
  }

  function buildActivityRecord(companyName, historyRow) {
    var v = historyRow.value;
    var result = v["履歴結果"] && v["履歴結果"].value ? v["履歴結果"].value : "";
    var memo = v["履歴メモ"] && v["履歴メモ"].value ? v["履歴メモ"].value : "";
    var date = v["履歴日付"] && v["履歴日付"].value ? v["履歴日付"].value : null;
    var tanto = (v["履歴担当"] && v["履歴担当"].value) || [];

    var content = (result ? "【" + result + "】" : "") + memo;
    if (!content) content = "(ネタリストからの移行記録。詳細メモなし)";

    var rec = {
      "会社名": { value: companyName },
      "対応種別": { value: "電話" },
      "内容": { value: content },
    };
    if (date) rec["対応日付"] = { value: date };
    if (tanto.length) rec["対応者"] = { value: tanto.map(function (u) { return { code: u.code }; }) };
    return rec;
  }

  function createActivityHistoryRecords(companyName, record) {
    var rows = getCallHistoryRows(record);
    if (!rows.length) return Promise.resolve();
    var records = rows.map(function (row) { return buildActivityRecord(companyName, row); });
    return kintone.api(kintone.api.url("/k/v1/records", true), "POST", {
      app: ACTIVITY_APP_ID,
      records: records,
    });
  }

  function getLeadRecordId(record) {
    if (record && record["$id"] && record["$id"].value) {
      return record["$id"].value;
    }
    try {
      return kintone.app.record.getId();
    } catch (e) {
      // ignore
    }
    try {
      return kintone.mobile.app.record.getId();
    } catch (e) {
      // ignore
    }
    return null;
  }

  // スケジュール(app34)でこのネタに紐づいていた予定を、新しい顧客に付け替える
  // (ネタのレコードは削除されるため。見られない予定やエラーは無視して移行は続ける)
  function relinkSchedules(leadId, customerId) {
    if (!leadId) return Promise.resolve();
    return kintone.api(kintone.api.url("/k/v1/records", true), "GET", {
      app: SCHEDULE_APP_ID,
      query: 'ネタNo = "' + leadId + '" limit 500',
      fields: ["$id"],
    }).then(function (resp) {
      if (!resp.records.length) return null;
      return kintone.api(kintone.api.url("/k/v1/records", true), "PUT", {
        app: SCHEDULE_APP_ID,
        records: resp.records.map(function (r) {
          return { id: r.$id.value, record: { "顧客No": { value: String(customerId) }, "ネタNo": { value: "" }, "ネタ会社名": { value: "" } } };
        }),
      });
    }).catch(function (err) {
      console.warn("スケジュールの予定をネタから顧客へ付け替えられませんでした:", err);
    });
  }

  function deleteLeadRecord(leadId) {
    return kintone.api(kintone.api.url("/k/v1/records", true), "DELETE", {
      app: LEAD_APP_ID,
      ids: [leadId],
    });
  }

  function makeButton() {
    var btn = document.createElement("button");
    btn.id = "lead-to-customer-btn";
    btn.type = "button";
    btn.textContent = "顧客管理へ登録";
    btn.style.cssText =
      "margin-right:8px;padding:6px 14px;border-radius:4px;border:1px solid #43a047;" +
      "background:#43a047;color:#fff;cursor:pointer;font-size:13px;";
    return btn;
  }

  function wireButton(btn, record) {
    btn.addEventListener("click", function () {
      var companyName = fv(record, "会社名", "(会社名未入力)");
      var confirmed = window.confirm(
        "「" + companyName + "」を顧客管理へ登録します。\n" +
        "顧客ランクは仮に「D」で登録されます。登録後に開く画面で内容を確認・修正してください。\n\n" +
        "登録に成功すると、ネタリスト側のこのレコードは削除されます(コピーではなく移動)。\n\n" +
        "よろしいですか？"
      );
      if (!confirmed) return;

      btn.disabled = true;
      btn.textContent = "登録中...";
      var leadId = getLeadRecordId(record);

      createCustomerRecord(record)
        .then(function (resp) {
          var customerId = resp.id;
          return createActivityHistoryRecords(companyName, record)
            .catch(function (actErr) {
              console.error("顧客管理への登録は成功しましたが、架電履歴の活動履歴への転記に失敗しました:", actErr);
              alert("顧客管理への登録は完了しましたが、架電履歴の活動履歴への転記に失敗しました。必要であれば手動で活動履歴に追加してください。");
            })
            .then(function () {
              return createTantoshaFromLead(record);
            })
            .catch(function (tantoshaErr) {
              console.error("顧客管理への登録は成功しましたが、担当者管理への登録に失敗しました:", tantoshaErr);
              alert("顧客管理への登録は完了しましたが、担当者情報の担当者管理への登録に失敗しました。必要であれば手動で担当者管理に追加してください。");
            })
            .then(function () {
              return relinkSchedules(leadId, customerId);
            })
            .then(function () {
              return customerId;
            });
        })
        .then(function (customerId) {
          if (!leadId) {
            console.warn("ネタリストのレコードIDが取得できなかったため、元レコードの削除はスキップしました。");
            return { customerId: customerId, deleted: false };
          }
          return deleteLeadRecord(leadId)
            .then(function () {
              return { customerId: customerId, deleted: true };
            })
            .catch(function (delErr) {
              console.error("顧客管理への登録は成功しましたが、ネタリストの元レコード削除に失敗しました:", delErr);
              alert("顧客管理への登録は完了しましたが、ネタリスト側の元レコード削除に失敗しました。手動で削除してください。");
              return { customerId: customerId, deleted: false };
            });
        })
        .then(function (result) {
          var url = recordUrl(CUSTOMER_APP_ID, result.customerId);
          if (result.deleted || IS_MOBILE) {
            location.href = url;
          } else {
            window.open(url, "_blank", "noopener");
          }
        })
        .catch(function (err) {
          console.error("顧客管理への登録に失敗しました:", err);
          alert("登録に失敗しました: " + (err && err.message ? err.message : "詳細はコンソールを確認してください"));
        })
        .finally(function () {
          btn.disabled = false;
          btn.textContent = "顧客管理へ登録";
        });
    });
  }

  function setupDesktop(record) {
    if (typeof kintone.app === "undefined" || typeof kintone.app.record === "undefined" ||
      typeof kintone.app.record.getHeaderMenuSpaceElement !== "function") {
      return false;
    }
    var space = kintone.app.record.getHeaderMenuSpaceElement();
    if (!space) return false;

    var btn = makeButton();
    wireButton(btn, record);
    space.appendChild(btn);
    return true;
  }

  function setupMobile(record) {
    if (typeof kintone.mobile === "undefined" || typeof kintone.mobile.app === "undefined" ||
      typeof kintone.mobile.app.getHeaderSpaceElement !== "function") {
      return false;
    }
    var space = kintone.mobile.app.getHeaderSpaceElement();
    if (!space) return false;

    var btn = makeButton();
    btn.style.width = "100%";
    btn.style.marginRight = "0";
    btn.style.marginBottom = "6px";
    btn.style.padding = "10px 14px";
    wireButton(btn, record);
    space.appendChild(btn);
    return true;
  }

  function trySetup(fn, record) {
    try {
      return !!fn(record);
    } catch (e) {
      console.warn("「顧客管理へ登録」ボタンの設置に失敗しました(別方式を試します):", e);
      return false;
    }
  }

  function attachButton(event) {
    IS_MOBILE = event.type.indexOf("mobile.") === 0;
    // スマホは画面遷移しても前のボタンが残ることがあるため、毎回作り直して今のレコードに紐付ける
    var old = document.getElementById("lead-to-customer-btn");
    if (old && old.parentNode) old.parentNode.removeChild(old);
    trySetup(IS_MOBILE ? setupMobile : setupDesktop, event.record);
    return event;
  }

  kintone.events.on(["app.record.detail.show", "mobile.app.record.detail.show"], attachButton);
})();
