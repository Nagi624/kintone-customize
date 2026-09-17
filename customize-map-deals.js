/**
 * 案件管理アプリ用 地図表示カスタマイズ
 * - 一覧画面に「地図で表示」ボタンを追加
 * - 会社名で顧客管理アプリ(顧客管理)の緯度経度と紐付けて地図上にピン表示
 * - ピンの色は事業カテゴリ、形は商談フェーズを表す
 * - 事業カテゴリ・商談フェーズのチェックボックスで表示/非表示をフィルタ可能(AND条件)
 * - 「未フォロー案件のみ表示」チェックで、進行中(受注/失注/保留中止でない)かつ
 *   次回商談日が未設定または過去日の案件だけに絞り込み表示できる(フォロー漏れの可視化)
 * - ピンをクリックすると案件名・会社名・商談フェーズ・売上を表示し、
 *   案件レコードと顧客レコード両方へのリンクを出す
 *
 * 利用ライブラリ: Leaflet.js (無料・APIキー不要、CDN経由で読み込み)
 * 参照アプリID: 顧客管理=18, 商品マスタ=14 (必要に応じて下のAPP_IDを変更してください)
 * PC(デスクトップ)・スマートフォンブラウザの両方で地図を表示可能
 * (customize.jsonのdesktop/mobile両方にこのファイルを登録すること。
 *  モバイル用JSはFILEアップロードが読み込まれないため、GitHub+jsDelivr等の外部URLで登録する)
 */
(function () {
  "use strict";

  var APP_ID_DEAL = (function () {
    // PC版のAPIを優先して試し、使えない場合だけモバイル版のAPIにフォールバックする。
    // kintone.app/kintone.mobileはどちらの環境でも「存在する」ことがあり、かつ
    // 例外を投げずにundefinedを返すこともあるため、戻り値そのものも確認する。
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
  })(); // このアプリ自身のID(案件管理)
  var APP_ID_CUSTOMER = "18"; // 顧客管理
  var APP_ID_PRODUCT = "14"; // 商品マスタ

  var CATEGORY_COLOR = {
    "RIDE CAST(タクシー動画広告)": "#1e88e5",
    "MEO代行": "#43a047",
    "その他": "#fb8c00",
    "混在": "#8e24aa",
    "未設定": "#9e9e9e",
  };

  // 商談フェーズ → マーカーの形(色は事業カテゴリ側で決める)
  var PHASE_SHAPE = {
    "商談予定": "square",
    "提案中": "diamond",
    "内示": "triangle-up",
    "受注": "circle",
    "失注": "x-mark",
    "保留/中止": "cross",
  };
  var PHASE_SHAPE_LABEL = {
    circle: "●",
    square: "■",
    diamond: "◆",
    "triangle-up": "▲",
    "x-mark": "✕",
    cross: "✚",
  };

  var CLOSED_PHASES = { "受注": true, "失注": true, "保留/中止": true };

  var mapInstance = null;
  var mapData = null; // loadMapData()の結果をキャッシュ(フィルタ時に再取得しない)
  var checkedCategory = {};
  var checkedPhase = {};
  var showUnfollowedOnly = false;

  function isUnfollowed(deal) {
    if (CLOSED_PHASES[deal.__phase]) return false; // 受注/失注/保留中止は対象外
    var nextDate = fv(deal, "次回商談日", "");
    if (!nextDate) return true; // 次回商談日が未設定
    return new Date(nextDate).getTime() < Date.now(); // 過去日
  }

  // フィールドが未取得/空でも落ちないようにする安全アクセサ
  function fv(record, code, fallback) {
    return record && record[code] && record[code].value != null ? record[code].value : fallback !== undefined ? fallback : "";
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // 形状(shapeType)・色(colorHex)からLeafletのdivIconを作る
  function makeShapeIcon(shapeType, colorHex) {
    var size = 20;
    var html = "";
    switch (shapeType) {
      case "square":
        html =
          '<div style="width:14px;height:14px;background:' + colorHex + ';border:1.5px solid #333;margin:3px;"></div>';
        break;
      case "diamond":
        html =
          '<div style="width:13px;height:13px;background:' +
          colorHex +
          ';border:1.5px solid #333;margin:3px;transform:rotate(45deg);"></div>';
        break;
      case "triangle-up":
        html =
          '<div style="width:0;height:0;margin:2px 1px;' +
          "border-left:8px solid transparent;border-right:8px solid transparent;" +
          "border-bottom:15px solid " +
          colorHex +
          ';filter:drop-shadow(0 0 0.5px #333);"></div>';
        break;
      case "triangle-down":
        html =
          '<div style="width:0;height:0;margin:2px 1px;' +
          "border-left:8px solid transparent;border-right:8px solid transparent;" +
          "border-top:15px solid " +
          colorHex +
          ';filter:drop-shadow(0 0 0.5px #333);"></div>';
        break;
      case "x-mark":
        html =
          '<div style="position:relative;width:16px;height:16px;margin:2px;">' +
          '<div style="position:absolute;top:6px;left:-2px;width:20px;height:4px;background:' +
          colorHex +
          ';border:1px solid #333;transform:rotate(45deg);"></div>' +
          '<div style="position:absolute;top:6px;left:-2px;width:20px;height:4px;background:' +
          colorHex +
          ';border:1px solid #333;transform:rotate(-45deg);"></div>' +
          "</div>";
        break;
      case "cross":
        html =
          '<div style="position:relative;width:16px;height:16px;margin:2px;">' +
          '<div style="position:absolute;top:6px;left:0;width:16px;height:4px;background:' +
          colorHex +
          ';border:1px solid #333;"></div>' +
          '<div style="position:absolute;top:0;left:6px;width:4px;height:16px;background:' +
          colorHex +
          ';border:1px solid #333;"></div>' +
          "</div>";
        break;
      case "circle":
      default:
        html =
          '<div style="width:16px;height:16px;border-radius:50%;background:' +
          colorHex +
          ';border:1.5px solid #333;margin:2px;"></div>';
    }
    return L.divIcon({ html: html, className: "deal-map-shape-icon", iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
  }

  function buildFilterRow(title, keys, checkedMap, renderItem, isMobile) {
    var row = document.createElement("div");
    row.style.cssText = isMobile
      ? "font-size:14px;margin-bottom:6px;color:#444;padding:0 8px;"
      : "font-size:12px;margin-bottom:4px;color:#444;";

    var strong = document.createElement("strong");
    strong.textContent = title + "：";
    row.appendChild(strong);

    keys.forEach(function (k) {
      checkedMap[k] = true;
      var label = document.createElement("label");
      label.style.cssText = "display:inline-block;margin-right:14px;cursor:pointer;";

      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = true;
      cb.style.marginRight = "4px";
      if (isMobile) {
        cb.style.width = "16px";
        cb.style.height = "16px";
        cb.style.verticalAlign = "middle";
      }
      cb.addEventListener("change", function () {
        checkedMap[k] = cb.checked;
        applyFilterAndRender();
      });

      label.appendChild(cb);
      label.appendChild(renderItem(k));
      label.appendChild(document.createTextNode(" " + k));
      row.appendChild(label);
    });

    return row;
  }

  function buildMapContainer(isMobile) {
    var wrapper = document.createElement("div");
    wrapper.id = "deal-map-wrapper";
    wrapper.style.display = "none";
    wrapper.style.marginBottom = "12px";
    if (isMobile) {
      wrapper.style.padding = "0 4px";
    }

    var categoryRow = buildFilterRow("色=事業カテゴリ", Object.keys(CATEGORY_COLOR), checkedCategory, function (k) {
      var swatch = document.createElement("span");
      swatch.style.cssText =
        "display:inline-block;width:10px;height:10px;border-radius:50%;background:" + CATEGORY_COLOR[k] + ";vertical-align:middle;";
      return swatch;
    }, isMobile);

    var phaseRow = buildFilterRow("形=商談フェーズ", Object.keys(PHASE_SHAPE), checkedPhase, function (k) {
      var span = document.createElement("span");
      span.textContent = PHASE_SHAPE_LABEL[PHASE_SHAPE[k]];
      return span;
    }, isMobile);
    phaseRow.style.marginBottom = "8px";

    var unfollowedRow = document.createElement("div");
    unfollowedRow.style.cssText = isMobile
      ? "font-size:14px;margin-bottom:8px;padding:0 8px;"
      : "font-size:12px;margin-bottom:8px;";
    var unfollowedLabel = document.createElement("label");
    unfollowedLabel.style.cssText = "display:inline-block;cursor:pointer;color:#c62828;font-weight:bold;";
    var unfollowedCb = document.createElement("input");
    unfollowedCb.type = "checkbox";
    unfollowedCb.checked = false;
    unfollowedCb.style.marginRight = "4px";
    if (isMobile) {
      unfollowedCb.style.width = "16px";
      unfollowedCb.style.height = "16px";
      unfollowedCb.style.verticalAlign = "middle";
    }
    unfollowedCb.addEventListener("change", function () {
      showUnfollowedOnly = unfollowedCb.checked;
      applyFilterAndRender();
    });
    unfollowedLabel.appendChild(unfollowedCb);
    unfollowedLabel.appendChild(document.createTextNode("🔴 未フォロー案件のみ表示(進行中で次回商談日が未設定/過去)"));
    unfollowedRow.appendChild(unfollowedLabel);

    var mapDiv = document.createElement("div");
    mapDiv.id = "deal-map";
    mapDiv.style.width = "100%";
    mapDiv.style.height = isMobile ? "65vh" : "520px";
    mapDiv.style.border = "1px solid #ccc";
    mapDiv.style.borderRadius = "4px";

    wrapper.appendChild(categoryRow);
    wrapper.appendChild(phaseRow);
    wrapper.appendChild(unfollowedRow);
    wrapper.appendChild(mapDiv);
    return wrapper;
  }

  function fetchAll(appId, fields, query) {
    return kintone.api(kintone.api.url("/k/v1/records", true), "GET", { app: appId, fields: fields, query: query || "limit 500" });
  }

  function determineCategory(dealRecord, productCategoryByCode) {
    var rows = fv(dealRecord, "提案商品明細", []);
    var categories = [];
    rows.forEach(function (row) {
      var code = fv(row.value, "商品コード", "");
      if (code && productCategoryByCode[code]) {
        categories.push(productCategoryByCode[code]);
      }
    });

    if (categories.length === 0) {
      var legacy = fv(dealRecord, "提案商品", "");
      if (legacy && CATEGORY_COLOR[legacy]) {
        categories.push(legacy);
      }
    }

    if (categories.length === 0) return "未設定";
    var uniq = categories.filter(function (v, i, a) {
      return a.indexOf(v) === i;
    });
    return uniq.length === 1 ? uniq[0] : "混在";
  }

  function loadMapData() {
    return Promise.all([
      fetchAll(APP_ID_DEAL, ["$id", "案件名", "会社名", "商談フェーズ", "売上", "提案商品明細", "提案商品", "次回商談日"]),
      fetchAll(APP_ID_PRODUCT, ["文字列__1行_", "カテゴリ"]),
      fetchAll(APP_ID_CUSTOMER, ["$id", "会社名", "顧客No", "緯度", "経度"]),
    ]).then(function (results) {
      var deals = results[0].records;
      var products = results[1].records;
      var customers = results[2].records;

      var productCategoryByCode = {};
      products.forEach(function (p) {
        var code = fv(p, "文字列__1行_", "");
        var cat = fv(p, "カテゴリ", "");
        if (code) productCategoryByCode[code] = cat || "未設定";
      });

      var customerByName = {};
      customers.forEach(function (c) {
        var name = fv(c, "会社名", "");
        if (name) customerByName[name] = c;
      });

      // 表示に使うカテゴリ・フェーズをあらかじめ各案件に計算して持たせておく
      deals.forEach(function (deal) {
        deal.__category = determineCategory(deal, productCategoryByCode);
        deal.__phase = fv(deal, "商談フェーズ", "");
      });

      return { deals: deals, customerByName: customerByName };
    });
  }

  function applyFilterAndRender() {
    if (!mapData) return;
    var filtered = mapData.deals.filter(function (deal) {
      var catOk = checkedCategory[deal.__category] !== false;
      var phaseOk = !deal.__phase || checkedPhase[deal.__phase] !== false;
      var unfollowedOk = !showUnfollowedOnly || isUnfollowed(deal);
      return catOk && phaseOk && unfollowedOk;
    });
    renderMap(filtered, mapData.customerByName);
  }

  function renderMap(deals, customerByName) {
    if (mapInstance) {
      mapInstance.remove();
      mapInstance = null;
    }
    mapInstance = L.map("deal-map").setView([36.2048, 138.2529], 6);

    L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">地理院タイル(国土地理院)</a>',
    }).addTo(mapInstance);

    var bounds = [];
    var seenCoord = {};

    deals.forEach(function (deal) {
      var companyName = fv(deal, "会社名", "");
      var customer = companyName ? customerByName[companyName] : null;
      if (!customer) return;
      var lat = parseFloat(fv(customer, "緯度", ""));
      var lon = parseFloat(fv(customer, "経度", ""));
      if (isNaN(lat) || isNaN(lon)) return;

      var key = lat.toFixed(4) + "," + lon.toFixed(4);
      seenCoord[key] = (seenCoord[key] || 0) + 1;
      var n = seenCoord[key] - 1;
      if (n > 0) {
        var angle = (n * 137.5 * Math.PI) / 180;
        var r = 0.01 * Math.ceil(n / 1);
        lat += r * Math.cos(angle);
        lon += r * Math.sin(angle);
      }

      var color = CATEGORY_COLOR[deal.__category] || "#9e9e9e";
      var shapeType = PHASE_SHAPE[deal.__phase] || "circle";

      var marker = L.marker([lat, lon], { icon: makeShapeIcon(shapeType, color) }).addTo(mapInstance);

      var dealId = fv(deal, "$id", "");
      var dealUrl = location.protocol + "//" + location.host + "/k/" + APP_ID_DEAL + "/show#record=" + dealId;
      var customerUrl =
        location.protocol + "//" + location.host + "/k/" + APP_ID_CUSTOMER + "/show#record=" + fv(customer, "$id", "");

      var popupHtml =
        '<div style="font-size:13px;line-height:1.6">' +
        "<strong>" + escapeHtml(fv(deal, "案件名", "") || "(案件名未入力)") + "</strong><br>" +
        "会社名: " + escapeHtml(companyName || "-") + "<br>" +
        "商談フェーズ: " + escapeHtml(deal.__phase || "-") + "<br>" +
        "次回商談日: " + escapeHtml(fv(deal, "次回商談日", "") ? new Date(fv(deal, "次回商談日", "")).toLocaleString("ja-JP") : "未設定") +
        (isUnfollowed(deal) ? ' <span style="color:#c62828;font-weight:bold;">[未フォロー]</span>' : "") + "<br>" +
        "事業カテゴリ: " + escapeHtml(deal.__category) + "<br>" +
        "売上: ¥" + escapeHtml(Number(fv(deal, "売上", 0) || 0).toLocaleString()) + "<br>" +
        '<a href="' + dealUrl + '" target="_blank" rel="noopener">案件を開く &gt;</a>　' +
        '<a href="' + customerUrl + '" target="_blank" rel="noopener">顧客を開く &gt;</a>' +
        "</div>";

      marker.bindPopup(popupHtml);
      bounds.push([lat, lon]);
    });

    if (bounds.length > 0) {
      mapInstance.fitBounds(bounds, { padding: [30, 30], maxZoom: 12 });
    }
  }

  function makeToggleButton() {
    var btn = document.createElement("button");
    btn.id = "deal-map-toggle-btn";
    btn.type = "button";
    btn.textContent = "地図で表示";
    btn.style.cssText =
      "margin-right:8px;padding:6px 14px;border-radius:4px;border:1px solid #1e88e5;" +
      "background:#1e88e5;color:#fff;cursor:pointer;font-size:13px;";
    return btn;
  }

  function wireToggleButton(btn, mapWrapper) {
    var shown = false;
    btn.addEventListener("click", function () {
      shown = !shown;
      mapWrapper.style.display = shown ? "block" : "none";
      btn.textContent = shown ? "地図を閉じる" : "地図で表示";
      if (shown) {
        btn.disabled = true;
        loadMapData()
          .then(function (data) {
            mapData = data;
            applyFilterAndRender();
          })
          .catch(function (err) {
            console.error(err);
            alert("地図データの取得に失敗しました。詳細はコンソールを確認してください。");
          })
          .finally(function () {
            btn.disabled = false;
          });
      }
    });
  }

  function setupMapUiDesktop() {
    if (typeof kintone.app === "undefined" || typeof kintone.app.getHeaderMenuSpaceElement !== "function") {
      return false;
    }
    var headerSpace = kintone.app.getHeaderMenuSpaceElement();
    if (!headerSpace) return false;

    var btn = makeToggleButton();
    headerSpace.appendChild(btn);

    var mapWrapper = buildMapContainer(false);
    var listSpace = kintone.app.getHeaderSpaceElement();
    if (listSpace) {
      listSpace.parentNode.insertBefore(mapWrapper, listSpace.nextSibling);
    }

    wireToggleButton(btn, mapWrapper);
    return true;
  }

  function setupMapUiMobile() {
    if (typeof kintone.mobile === "undefined" || typeof kintone.mobile.app === "undefined" ||
      typeof kintone.mobile.app.getHeaderSpaceElement !== "function") {
      return false;
    }
    var headerSpace = kintone.mobile.app.getHeaderSpaceElement();
    if (!headerSpace) return false;

    var btn = makeToggleButton();
    btn.style.width = "100%";
    btn.style.padding = "10px 14px";
    btn.style.marginRight = "0";
    btn.style.marginBottom = "6px";

    var mapWrapper = buildMapContainer(true);

    headerSpace.appendChild(btn);
    headerSpace.appendChild(mapWrapper);

    wireToggleButton(btn, mapWrapper);
    return true;
  }

  function trySetup(fn) {
    try {
      return !!fn();
    } catch (e) {
      console.warn("地図UIのセットアップに失敗しました(別方式を試します):", e);
      return false;
    }
  }

  function attemptSetup() {
    if (document.getElementById("deal-map-toggle-btn")) {
      return true; // 既に設置済み
    }
    if (trySetup(setupMapUiDesktop)) {
      return true;
    }
    return trySetup(setupMapUiMobile);
  }

  // kintoneの"app.record.index.show"イベントに頼る方式(念のため残す。再描画時の再設置用)
  kintone.events.on("app.record.index.show", function (event) {
    attemptSetup();
    return event;
  });

  // 上記イベントが発火しない画面(スマホのモバイルブラウザ版で確認済み)向けに、
  // ページ読み込み後、ボタンの設置場所が使えるようになるまで一定間隔でリトライする
  (function pollForSetup() {
    var attempts = 0;
    var maxAttempts = 20; // 500ms x 20 = 最大10秒リトライ
    var timer = setInterval(function () {
      attempts++;
      var done = attemptSetup();
      if (done || attempts >= maxAttempts) {
        clearInterval(timer);
      }
    }, 500);

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () {
        attemptSetup();
      });
    }
  })();
})();
