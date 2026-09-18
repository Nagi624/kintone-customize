/**
 * 見込み客リストアプリ用 「顧客管理へ登録」ボタン
 * - レコード詳細画面のボタンをクリックすると、基本情報(会社名・住所・電話番号・
 *   業種・大分類・中分類・緯度経度・出典URL→Webサイト)を自動入力した状態で顧客管理(app18)に
 *   新規レコードをAPI経由で直接作成する(基本情報の再入力・再確認は不要)
 *   ※ 大分類・中分類は顧客管理側も同じ選択肢セットのため、マッピングなしでそのままコピーする
 * - 「顧客ランク」(必須項目)は営業側の主観判断が必要なため、仮に最低ランク「D」で
 *   作成し、作成直後に開くレコード画面でその場で修正してもらう運用
 * - 顧客管理への登録に成功したら、見込み客リスト側の元レコードは削除する
 *   (コピーではなく「移動」として扱う)
 * - 誤操作防止のため、作成前に確認ダイアログを一度挟む(削除される旨も明記)
 * - PC・スマートフォンブラウザ両対応
 */
(function () {
  "use strict";

  var CUSTOMER_APP_ID = "18";
  var DEFAULT_CUSTOMER_RANK = "D";

  var LEAD_APP_ID = (function () {
    try {
      var idFromApp = kintone.app.getId();
      if (idFromApp) return idFromApp;
    } catch (e) {
      // ignore
    }
    try {
      var idFromMobile = kintone.mobile.app.getId();
      if (idFromMobile) return idFromMobile;
    } catch (e) {
      // ignore
    }
    return null;
  })();

  var CATEGORY_TO_GYOSHU = {
    "医療・健康・介護": "サービス業",
    "住まい": "不動産業",
    "旅行・宿泊": "サービス業",
    "グルメ": "卸売業、小売業、飲食店",
    "美容・ファッション": "サービス業",
    "自動車・バイク": "卸売業、小売業、飲食店",
    "暮らし": "その他",
    "ショッピング": "卸売業、小売業、飲食店",
    "ペット": "サービス業",
    "趣味": "その他",
    "教育・習い事": "サービス業",
    "公共機関・団体": "公務",
    "レジャー・スポーツ": "サービス業",
    "冠婚葬祭・イベント": "サービス業",
    "交通": "運輸・通信業",
    "その他": "その他",
  };

  function fv(record, code, fallback) {
    return record && record[code] && record[code].value != null ? record[code].value : fallback !== undefined ? fallback : "";
  }

  function buildCustomerRecord(record) {
    var majorCategory = fv(record, "大分類", "");
    var minorCategory = fv(record, "中分類", "");
    var gyoshu = CATEGORY_TO_GYOSHU[majorCategory] || "";
    var address = fv(record, "市区町村", "") + fv(record, "丁目番地等", "");
    var status = fv(record, "確認ステータス", "");
    var memo = fv(record, "業種確認メモ", "");

    var out = {
      "会社名": { value: fv(record, "会社名", "") },
      "顧客ランク": { value: DEFAULT_CUSTOMER_RANK },
      "顧客情報メモ欄": {
        value:
          "見込み客リストより自動登録(顧客ランクは仮置きのD。登録内容を確認・修正してください)\n" +
          "元カテゴリ: " + majorCategory + (minorCategory && minorCategory !== "-" ? " / " + minorCategory : "") +
          " / 確認ステータス: " + status + " / 業種確認メモ: " + memo,
      },
    };

    var optional = {
      "郵便番号": fv(record, "郵便番号", ""),
      "都道府県": fv(record, "都道府県", ""),
      "住所": address,
      "電話番号": fv(record, "電話番号", ""),
      "業種": gyoshu,
      "大分類": majorCategory,
      "中分類": minorCategory,
      "Webサイト": fv(record, "出典URL", ""),
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
        "登録に成功すると、見込み客リスト側のこのレコードは削除されます(コピーではなく移動)。\n\n" +
        "よろしいですか？"
      );
      if (!confirmed) return;

      btn.disabled = true;
      btn.textContent = "登録中...";
      var leadId = getLeadRecordId(record);

      createCustomerRecord(record)
        .then(function (resp) {
          var customerId = resp.id;
          if (!leadId) {
            console.warn("見込み客リストのレコードIDが取得できなかったため、元レコードの削除はスキップしました。");
            return { customerId: customerId, deleted: false };
          }
          return deleteLeadRecord(leadId)
            .then(function () {
              return { customerId: customerId, deleted: true };
            })
            .catch(function (delErr) {
              console.error("顧客管理への登録は成功しましたが、見込み客リストの元レコード削除に失敗しました:", delErr);
              alert("顧客管理への登録は完了しましたが、見込み客リスト側の元レコード削除に失敗しました。手動で削除してください。");
              return { customerId: customerId, deleted: false };
            });
        })
        .then(function (result) {
          var url = location.protocol + "//" + location.host + "/k/" + CUSTOMER_APP_ID + "/show#record=" + result.customerId;
          if (result.deleted) {
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
      typeof kintone.mobile.app.record === "undefined" ||
      typeof kintone.mobile.app.record.getHeaderMenuSpaceElement !== "function") {
      return false;
    }
    var space = kintone.mobile.app.record.getHeaderMenuSpaceElement();
    if (!space) return false;

    var btn = makeButton();
    btn.style.width = "100%";
    btn.style.marginRight = "0";
    btn.style.marginBottom = "6px";
    btn.style.padding = "10px 14px";
    wireButton(btn, r
