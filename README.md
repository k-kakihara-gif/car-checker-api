# car-checker-api

中古車チェッカー Chrome拡張機能用の価格履歴APIサーバーです。

## エンドポイント

### 価格履歴を取得
```
GET /api/prices?car_id={車のID}
```

### 価格を保存
```
POST /api/prices
Content-Type: application/json

{ "car_id": "CS-12345", "price": 62.0, "site": "carsensor" }
```

## 環境変数（Vercelに設定）

| 変数名 | 内容 |
|---|---|
| SUPABASE_URL | SupabaseのProject URL |
| SUPABASE_KEY | Supabaseの秘密の鍵 |
