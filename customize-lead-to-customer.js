/**
 * 見込み客リストアプリ用 「顧客管理へ登録」ボタン
 * - レコード詳細画面に、内容を事前入力した状態で顧客管理(app18)の新規登録画面を
 *   別タブで開くボタンを追加する(半自動移行)
 * - 顧客ランクなど営業側の判断が必要な項目はあえて空のまま(必須項目のため、
 *   保存前に必ず選択させることでチェックを効かせる)
 * - PC・スマートフォンブラウザ両対応
 */
(function () {
  "use strict";

  var CUSTOMER_APP_ID = "18";

  var CATEGORY_TO_GYOSHU = {
    "タクシー・ハイヤー": "運輸・通信業",
    "飲食業": "卸売業、小売業、飲食店",
    "サロン・美容": "サービス業",
  };

  function fv(record, code, fallback) {
    return record && record[code] && record[code].value != null ? record[code].value : fallback !== undefined ? fallback : "";
  }

  function buildCustomerAppUrl(record) {
    var category = fv(record, "業種カテゴリ", "");
    var gyoshu = CATEGORY_TO_GYOSHU[category] || "";
    var address = fv(record, "市区町村", "") + fv(record, "丁目番地等", "");
    var status = fv(record, "確認ステータス", "");
    var memo = fv(record, "業種確認メモ", "");

    var params = {
      "会社名": fv(record, "会社名", ""),
      "郵便番号": fv(record, "郵便番号", ""),
      "都道府県": fv(record, "都道府県", ""),
      "住所": address,
      "電話番号": fv(record, "電話番号", ""),
      "業種": gyoshu,
      "緯度": fv(record, "緯度", ""),
      "経度": fv(record, "経度", ""),
      "顧客情報メモ欄": "見込み客リストより移行(元業種カテゴリ: " + category + " / 確認ステータス: " + status + " / 業種確認メモ: " + memo + ")",
    };

    var query = Object.keys(params)
      .filter(function (key) {
        return params[key] !== "" && params[key] != null;
      })
      .map(function (key) {
        return encodeURIComponent(key) + "=" + encodeURIComponent(params[key]);
      })
      .join("&");

    return location.protocol + "//" + location.host + "/k/" + CUSTOMER_APP_ID + "/edit?" + query;
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

  function setupDesktop(record) {
    if (typeof kintone.app === "undefined" || typeof kintone.app.record === "undefined" ||
      typeof kintone.app.record.getHeaderMenuSpaceElement !== "function") {
      return false;
    }
    var space = kintone.app.record.getHeaderMenuSpaceElement();
    if (!space) return false;

    var btn = makeButton();
    btn.addEventListener("click", function () {
      window.open(buildCustomerAppUrl(record), "_blank", "noopener");
    });
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
    btn.addEventListener("click", function () {
      window.open(buildCustomerAppUrl(record), "_blank", "noopener");
    });
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
    if (document.getElementById("lead-to-customer-btn")) {
      return event;
    }
    if (!trySetup(setupDesktop, event.record)) {
      trySetup(setupMobile, event.record);
    }
    return event;
  }

  kintone.events.on("app.record.detail.show", attachButton);
})();
