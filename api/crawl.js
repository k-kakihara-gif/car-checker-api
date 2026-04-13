// api/crawl.js
// カーセンサーを巡回して価格を収集するクローラー
// Vercel Cron Job で毎日1回実行される

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// =============================
// 設定
// =============================
const CONFIG = {
  // 巡回するカーセンサーの検索URL一覧（自分が調べたい車種を追加）
  searchUrls: [
    "https://www.carsensor.net/usedcar/search.php?STID=CS210610&SORT=2&YMIN=2004&YMAX=2004&KW=%E3%82%B5%E3%82%AF%E3%82%B7%E3%83%BC%E3%83%89%20%E3%83%AF%E3%82%B4%E3%83%B3",
  ],
  // リクエスト間隔（ミリ秒）サーバー負荷対策
  intervalMs: 4000,
  // 1URLあたりの最大取得件数
  maxPerUrl: 20,
};

// =============================
// 指定ミリ秒待機
// =============================
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =============================
// カーセンサーのHTMLから車両情報を抽出（本体価格を取得）
// =============================
function parseCarsensorHtml(html) {
  const cars = [];
  const detailPattern = /href="[^"]*\/usedcar\/detail\/([A-Z0-9\-]+)[^"]*"/g;

  const ids = new Set();
  let idMatch;
  while ((idMatch = detailPattern.exec(html)) !== null) {
    ids.add({ id: idMatch[1], pos: idMatch.index });
  }

  idArray.forEach(({ id, pos }) => {
    const nearby = html.slice(pos, pos + 3000);

    let price = null;

    // パターン1: 「車両本体価格」の後の価格
    const bodyMatch = nearby.match(/(?:車両本体価格|本体価格)[^0-9]*([\d,]+\.?\d*)\s*万円/);
    if (bodyMatch) {
      price = parseFloat(bodyMatch[1].replace(",", ""));
    }

    // パターン2: 2番目の価格（1つ目=支払総額、2つ目=本体価格）
    if (!price) {
      const allPrices = [...nearby.matchAll(/([\d,]+\.?\d*)\s*万円/g)];
      if (allPrices.length >= 2) {
        price = parseFloat(allPrices[1][1].replace(",", ""));
      } else if (allPrices.length === 1) {
        price = parseFloat(allPrices[0][1].replace(",", ""));
      }
    }

    if (price && price >= 1 && price <= 10000) {
      cars.push({ car_id: "CS-" + id, price });
    }
  });

  return cars.slice(0, CONFIG.maxPerUrl);
}

// =============================
// 1つのURLを巡回して車両情報を取得
// =============================
async function crawlUrl(url) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "ja,en;q=0.9",
        Accept: "text/html,application/xhtml+xml",
      },
    });

    if (!res.ok) {
      console.warn(`[クローラー] HTTPエラー: ${res.status} ${url}`);
      return [];
    }

    const html = await res.text();
    const cars = parseCarsensorHtml(html);
    console.log(`[クローラー] ${url} → ${cars.length}件取得`);
    return cars;
  } catch (e) {
    console.error(`[クローラー] 取得失敗: ${url}`, e.message);
    return [];
  }
}

// =============================
// DBに価格を保存（今日分は更新）
// =============================
async function saveToDb(car_id, price) {
  const today = new Date().toISOString().split("T")[0];

  const { data: existing } = await supabase
    .from("car_prices")
    .select("id")
    .eq("car_id", car_id)
    .gte("recorded_at", `${today}T00:00:00`)
    .lte("recorded_at", `${today}T23:59:59`)
    .limit(1);

  if (existing && existing.length > 0) {
    await supabase
      .from("car_prices")
      .update({ price })
      .eq("id", existing[0].id);
  } else {
    await supabase
      .from("car_prices")
      .insert({ car_id, price, site: "carsensor" });
  }
}

// =============================
// メイン処理
// =============================
export default async function handler(req, res) {
  // Cronからのリクエストのみ許可
  const authHeader = req.headers["authorization"];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  console.log("[クローラー] 開始:", new Date().toISOString());

  let totalSaved = 0;
  const errors = [];

  for (const url of CONFIG.searchUrls) {
    const cars = await crawlUrl(url);

    for (const car of cars) {
      try {
        await saveToDb(car.car_id, car.price);
        totalSaved++;
        console.log(`[クローラー] 保存: ${car.car_id} = ${car.price}万円`);
      } catch (e) {
        errors.push(`${car.car_id}: ${e.message}`);
      }
      // サーバー負荷対策：1件ごとに待機
      await sleep(CONFIG.intervalMs);
    }

    // URL間も待機
    await sleep(CONFIG.intervalMs);
  }

  console.log(`[クローラー] 完了: ${totalSaved}件保存, エラー${errors.length}件`);

  return res.status(200).json({
    status: "done",
    saved: totalSaved,
    errors,
    timestamp: new Date().toISOString(),
  });
}
