/**
 * 名刺読み取りボックスアプリ用 「担当者管理へ登録」「ネタリストへ登録」ボタン
 *
 * 運用方針: 顧客管理(18)には会社名・住所・電話番号・FAX・Webサイトなど最低限の情報のみを登録し、
 * 役職・部署・携帯電話・メールアドレスなど個人に紐づく詳細情報は担当者管理(20)側で管理する。
 * (この方針はアプリのレイアウト上部にもLABELで表示している)
 *
 * 「担当者管理へ登録」ボタン:
 *   - 会社名で顧客管理(18)を検索し、既存なければ最低限の情報で新規作成する
 *   - 担当者管理(20)に、氏名(姓・名に分割)・役職・部署・電話番号・携帯番号・メールアドレスを登録し、
 *     顧客名(ルックアップ)で顧客管理の該当レコードと自動的に紐づける
 *
 * 「ネタリストへ登録」ボタン:
 *   - ネタリスト(29)に、会社名・住所・電話番号を登録し、氏名・役職・携帯電話等はメモ欄にまとめる
 *   - ネタリストは会社単位のアプリで担当者ごとの項目を持たないため、個人情報はメモへの記載に留める
 *
 * 【名刺画像について】kintoneのファイル添付(fileKey)は一度レコードに紐づけると他のレコードへ
 * 使い回せない(GAIA_BL01エラーで判明)ため、登録先レコードへ画像を複製することはしていない。
 * 元画像は名刺読み取りボックス側のレコードに残したまま保持する(下記の通り削除せず「確認済み」に
 * ステータス変更するだけなので、会社名・氏名で検索すれば元画像はいつでも参照できる)。
 *
 * どちらのボタンも、登録に成功したら名刺読み取りボックス側の元レコードは削除せず、
 * 読み取りステータスを「確認済み」に更新するだけにする(画像の参照元として残すため)。
 * 誤操作防止のため、実行前に確認ダイアログを挟む。
 * PC・スマートフォンブラウザ両対応。
 */
(function () {
  "use strict";

  var MEISHI_APP_ID = "31";
  var CUSTOMER_APP_ID = "18";
  var TANTOSHA_APP_ID = "20";
  var LEAD_APP_ID = "29";
  var IS_MOBILE = false;
  var DEFAULT_CUSTOMER_RANK = "D";

  function fv(record, code, fallback) {
    return record && record[code] && record[code].value != null ? record[code].value : fallback !== undefined ? fallback : "";
  }

  function escapeQueryValue(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function splitName(fullName) {
    var trimmed = (fullName || "").trim();
    if (!trimmed) return { sei: "", mei: "" };
    var parts = trimmed.split(/[\s　]+/);
    if (parts.length === 1) return { sei: parts[0], mei: "" };
    return { sei: parts[0], mei: parts.slice(1).join(" ") };
  }

  var PREFS = [
    "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県", "茨城県", "栃木県", "群馬県",
    "埼玉県", "千葉県", "東京都", "神奈川県", "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県",
    "岐阜県", "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県",
    "鳥取県", "島根県", "岡山県", "広島県", "山口県", "徳島県", "香川県", "愛媛県", "高知県", "福岡県",
    "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
  ];

  // 顧客管理(18)は「都道府県」(DROP_DOWN)と「住所」が別フィールドのため、
  // 名刺読み取りボックスの単一「住所」文字列から都道府県を分離する(2026-09-24修正、作業サマリー.mdトラブルシューティング#30参照)
  function splitPref(addr) {
    for (var i = 0; i < PREFS.length; i++) {
      if ((addr || "").indexOf(PREFS[i]) === 0) {
        return { pref: PREFS[i], rest: addr.slice(PREFS[i].length) };
      }
    }
    return null;
  }

  function buildMeishiRecordUrl(record) {
    var id = getMeishiRecordId(record);
    if (!id) return "";
    return location.protocol + "//" + location.host + "/k/" + MEISHI_APP_ID + "/show#record=" + id;
  }

  function buildMiscMemo(record, extraLines) {
    var lines = (extraLines || []).slice();
    var others = fv(record, "その他情報", "");
    if (others) lines.push(others);
    return lines.join("\n");
  }

  function findCustomerByName(companyName) {
    var query = '会社名 = "' + escapeQueryValue(companyName) + '" limit 1';
    return kintone.api(kintone.api.url("/k/v1/records", true), "GET", {
      app: CUSTOMER_APP_ID,
      query: query,
      fields: ["会社名"],
    }).then(function (resp) {
      return resp.records.length > 0;
    });
  }

  function createMinimalCustomer(record) {
    var addrSplit = splitPref(fv(record, "住所", ""));
    var body = {
      app: CUSTOMER_APP_ID,
      record: {
        "会社名": { value: fv(record, "会社名", "") },
        "顧客ランク": { value: DEFAULT_CUSTOMER_RANK },
        "住所": { value: addrSplit ? addrSplit.rest : fv(record, "住所", "") },
        "電話番号": { value: fv(record, "電話番号", "") },
        "FAX": { value: fv(record, "FAX", "") },
        "Webサイト": { value: fv(record, "Webサイト", "") },
        "顧客情報メモ欄": { value: "名刺読み取りボックスより自動登録(顧客ランクは仮置きのD。登録内容を確認・修正してください)" },
      },
    };
    if (addrSplit) {
      body.record["都道府県"] = { value: addrSplit.pref };
    }
    return kintone.api(kintone.api.url("/k/v1/record", true), "POST", body);
  }

  function ensureCustomerExists(record) {
    var companyName = fv(record, "会社名", "");
    if (!companyName) return Promise.resolve();
    return findCustomerByName(companyName).then(function (exists) {
      if (exists) return;
      return createMinimalCustomer(record);
    });
  }

  function createTantoshaRecord(record) {
    var name = splitName(fv(record, "氏名", ""));
    var body = {
      app: TANTOSHA_APP_ID,
      record: {
        "姓": { value: name.sei },
        "名": { value: name.mei },
        "役職": { value: fv(record, "役職", "") },
        "部署": { value: fv(record, "部署", "") },
        "電話番号": { value: fv(record, "電話番号", "") },
        "携帯番号": { value: fv(record, "携帯電話", "") },
        "メールアドレス": { value: fv(record, "メールアドレス", "") },
        "顧客名": { value: fv(record, "会社名", "") },
        "決裁権": { value: "なし" },
        "備考": { value: buildMiscMemo(record, ["名刺読み取りボックスより自動登録"]) },
        "名刺画像リンク": { value: buildMeishiRecordUrl(record) },
      },
    };
    return kintone.api(kintone.api.url("/k/v1/record", true), "POST", body);
  }

  function createLeadRecord(record) {
    var role = fv(record, "役職", "");
    var dept = fv(record, "部署", "");
    var roleWithDept = dept && role ? dept + " " + role : dept || role;

    var body = {
      app: LEAD_APP_ID,
      record: {
        "会社名": { value: fv(record, "会社名", "") },
        "電話番号": { value: fv(record, "電話番号", "") },
        "丁目番地等": { value: fv(record, "住所", "") },
        "Webサイト": { value: fv(record, "Webサイト", "") },
        "進捗状況": { value: "未着手" },
        "担当者氏名": { value: fv(record, "氏名", "") },
        "担当者役職": { value: roleWithDept },
        "担当者携帯電話": { value: fv(record, "携帯電話", "") },
        "担当者メール": { value: fv(record, "メールアドレス", "") },
        "元名刺リンク": { value: buildMeishiRecordUrl(record) },
        "メモ": { value: buildMiscMemo(record, ["名刺読み取りボックスより自動登録"]) },
      },
    };
    Object.keys(body.record).forEach(function (key) {
      if (!body.record[key].value) delete body.record[key];
    });
    return kintone.api(kintone.api.url("/k/v1/record", true), "POST", body);
  }

  function getMeishiRecordId(record) {
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

  function markMeishiConfirmed(recordId) {
    return kintone.api(kintone.api.url("/k/v1/record", true), "PUT", {
      app: MEISHI_APP_ID,
      id: recordId,
      record: { "読み取りステータス": { value: "確認済み" } },
    });
  }

  function makeButton(label, color) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    btn.className = "meishi-action-btn";
    btn.style.cssText =
      "margin-right:8px;padding:6px 14px;border-radius:4px;border:1px solid " + color + ";" +
      "background:" + color + ";color:#fff;cursor:pointer;font-size:13px;";
    return btn;
  }

  function runRegistration(btn, record, opts) {
    var companyName = fv(record, "会社名", "(会社名未入力)");
    var confirmed = window.confirm(
      opts.confirmMessage.replace("{company}", companyName) +
      "\n\n登録に成功すると、名刺読み取りボックス側のこのレコードは「確認済み」に更新されます(削除はされません。元画像はこの記録に残ります)。\n\nよろしいですか？"
    );
    if (!confirmed) return;

    btn.disabled = true;
    var originalLabel = btn.textContent;
    btn.textContent = "登録中...";
    var recordId = getMeishiRecordId(record);

    opts.createTarget(record)
      .then(function (resp) {
        var targetId = resp.id;
        if (!recordId) {
          console.warn("名刺読み取りボックスのレコードIDが取得できなかったため、ステータス更新はスキップしました。");
          return { targetId: targetId, updated: false };
        }
        return markMeishiConfirmed(recordId)
          .then(function () {
            return { targetId: targetId, updated: true };
          })
          .catch(function (updErr) {
            console.error("登録は成功しましたが、名刺読み取りボックスのステータス更新に失敗しました:", updErr);
            alert("登録は完了しましたが、名刺読み取りボックス側のステータス更新に失敗しました。手動で「確認済み」に変更してください。");
            return { targetId: targetId, updated: false };
          });
      })
      .then(function (result) {
        if (IS_MOBILE) {
          location.href = location.protocol + "//" + location.host + "/k/m/" + opts.targetAppId + "/show?record=" + result.targetId;
        } else {
          window.open(location.protocol + "//" + location.host + "/k/" + opts.targetAppId + "/show#record=" + result.targetId, "_blank", "noopener");
        }
      })
      .catch(function (err) {
        console.error("登録に失敗しました:", err);
        alert("登録に失敗しました: " + (err && err.message ? err.message : "詳細はコンソールを確認してください"));
      })
      .finally(function () {
        btn.disabled = false;
        btn.textContent = originalLabel;
      });
  }

  function wireTantoshaButton(btn, record) {
    btn.addEventListener("click", function () {
      runRegistration(btn, record, {
        confirmMessage: "「{company}」の担当者として担当者管理へ登録します。\n会社が顧客管理に無い場合は、最低限の情報(会社名・住所・電話番号等)で顧客管理にも新規作成します。",
        targetAppId: TANTOSHA_APP_ID,
        createTarget: function (record) {
          return ensureCustomerExists(record).then(function () {
            return createTantoshaRecord(record);
          });
        },
      });
    });
  }

  function wireLeadButton(btn, record) {
    btn.addEventListener("click", function () {
      runRegistration(btn, record, {
        confirmMessage: "「{company}」をネタリストへ新規登録します。氏名・役職等はメモ欄にまとめて記載されます。",
        targetAppId: LEAD_APP_ID,
        createTarget: createLeadRecord,
      });
    });
  }

  function makeButtons(record) {
    var tantoshaBtn = makeButton("担当者管理へ登録", "#43a047");
    var leadBtn = makeButton("ネタリストへ登録", "#1e88e5");
    wireTantoshaButton(tantoshaBtn, record);
    wireLeadButton(leadBtn, record);
    return [tantoshaBtn, leadBtn];
  }

  function setupDesktop(record) {
    if (typeof kintone.app === "undefined" || typeof kintone.app.record === "undefined" ||
      typeof kintone.app.record.getHeaderMenuSpaceElement !== "function") {
      return false;
    }
    var space = kintone.app.record.getHeaderMenuSpaceElement();
    if (!space) return false;
    makeButtons(record).forEach(function (btn) { space.appendChild(btn); });
    return true;
  }

  function setupMobile(record) {
    if (typeof kintone.mobile === "undefined" || typeof kintone.mobile.app === "undefined" ||
      typeof kintone.mobile.app.getHeaderSpaceElement !== "function") {
      return false;
    }
    var space = kintone.mobile.app.getHeaderSpaceElement();
    if (!space) return false;
    makeButtons(record).forEach(function (btn) {
      btn.style.width = "100%";
      btn.style.marginRight = "0";
      btn.style.marginBottom = "6px";
      btn.style.padding = "10px 14px";
      space.appendChild(btn);
    });
    return true;
  }

  // 写真・PDFを添付しただけのレコード(読み取り待ち)と、名刺ごとのレコードに分けた後の元レコード(分割済み)は
  // 会社名などが入っていないため、登録ボタンの代わりに案内を出す(2026-10-09、process_meishi_kintone.pyの自動読み取りに合わせて追加)
  var NOTICE_BY_STATUS = {
    "読み取り待ち": "この名刺はまだ読み取られていません。数分で自動で読み取られ、名刺1枚ごとのレコードに分かれます。",
    "読み取り中": "この名刺を読み取っています。数分後に一覧の「確認待ち」に名刺1枚ごとのレコードが届きます(この画面は閉じて構いません)。",
    "分割済み": "このレコードの名刺は、1枚ごとの別レコードに分けて登録しました(その他情報のレコード番号を参照)。それぞれのレコードから登録してください。",
  };

  function showNotice(text) {
    var space = IS_MOBILE ? kintone.mobile.app.getHeaderSpaceElement() : kintone.app.record.getHeaderMenuSpaceElement();
    if (!space) return;
    var note = document.createElement("div");
    note.className = "meishi-action-btn";
    note.textContent = text;
    note.style.cssText = "display:inline-block;padding:6px 10px;margin:" + (IS_MOBILE ? "8px 12px" : "0") +
      ";border-left:4px solid #e0a800;background:#fff8e1;font-size:13px;line-height:1.6;";
    space.appendChild(note);
  }

  function trySetup(fn, record) {
    try {
      return !!fn(record);
    } catch (e) {
      console.warn("名刺読み取りボックスのボタン設置に失敗しました(別方式を試します):", e);
      return false;
    }
  }

  function attachButtons(event) {
    IS_MOBILE = event.type.indexOf("mobile.") === 0;
    // スマホは画面遷移しても前のボタンが残ることがあるため、毎回作り直して今のレコードに紐付ける
    var olds = document.querySelectorAll(".meishi-action-btn");
    for (var i = 0; i < olds.length; i++) olds[i].parentNode.removeChild(olds[i]);
    var notice = NOTICE_BY_STATUS[fv(event.record, "読み取りステータス", "")];
    if (notice) {
      try { showNotice(notice); } catch (e) { console.warn("案内の表示に失敗しました:", e); }
      return event;
    }
    trySetup(IS_MOBILE ? setupMobile : setupDesktop, event.record);
    return event;
  }

  kintone.events.on(["app.record.detail.show", "mobile.app.record.detail.show"], attachButtons);
})();
