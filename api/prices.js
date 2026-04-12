// api/prices.js
// 価格の保存（POST）と取得（GET）を行うVercel Serverless Function

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  // CORSヘッダー（Chrome拡張機能からのアクセスを許可）
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // ============================================================
  // GET /api/prices?car_id=xxx
  // 指定した車の価格履歴を返す
  // ============================================================
  if (req.method === "GET") {
    const { car_id } = req.query;

    if (!car_id) {
      return res.status(400).json({ error: "car_id is required" });
    }

    const { data, error } = await supabase
      .from("car_prices")
      .select("price, recorded_at")
      .eq("car_id", car_id)
      .order("recorded_at", { ascending: true })
      .limit(90); // 最大90件（約3ヶ月分）

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({ car_id, history: data });
  }

  // ============================================================
  // POST /api/prices
  // 今日の価格を保存する（同じ車の同日データは上書き）
  // ============================================================
  if (req.method === "POST") {
    const { car_id, price, site } = req.body;

    if (!car_id || !price || !site) {
      return res.status(400).json({ error: "car_id, price, site are required" });
    }

    // 今日すでに保存済みか確認
    const today = new Date().toISOString().split("T")[0];
    const { data: existing } = await supabase
      .from("car_prices")
      .select("id")
      .eq("car_id", car_id)
      .gte("recorded_at", `${today}T00:00:00`)
      .lte("recorded_at", `${today}T23:59:59`)
      .limit(1);

    if (existing && existing.length > 0) {
      // 今日分は更新
      const { error } = await supabase
        .from("car_prices")
        .update({ price })
        .eq("id", existing[0].id);

      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ status: "updated" });
    } else {
      // 新規保存
      const { error } = await supabase
        .from("car_prices")
        .insert({ car_id, price, site });

      if (error) return res.status(500).json({ error: error.message });
      return res.status(201).json({ status: "created" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
