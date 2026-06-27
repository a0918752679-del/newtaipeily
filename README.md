# 新北市打擊噪音車管理系統 V19 NTPC Tech

本版重點：

- LINE 圖文選單改為 **NTPC**，修正先前 NTP 誤植。
- 圖文選單重新設計為科技風、立體卡片、大圖示、大字體。
- 後台密碼不寫死，僅從 Zeabur 環境變數 `ADMIN_PASSWORD` 讀取。
- 保留後台 `/admin.html`、LINE 設定頁 `/line-bot.html`、Webhook `/api/line/webhook`。
- 成果資料維持 296 場、車流 303,110 件、超標 910 件、告發 56 件、通知到檢 27 件。
- 行政區資料已調整為與總成果一致，避免單一行政區數據超過總數。

## Zeabur 必填環境變數

```env
ADMIN_PASSWORD=請設定新的後台密碼
SESSION_SECRET=請設定64字元以上隨機字串
LINE_CHANNEL_ACCESS_TOKEN=你的LINE長期Access Token
LINE_CHANNEL_SECRET=你的LINE Channel Secret
PUBLIC_BASE_URL=https://newtaipeinoise.zeabur.app
DASHBOARD_URL=https://noise115.zeabur.app
FIELD_REPORT_URL=https://out115.zeabur.app
```

## 部署後檢查

```text
https://newtaipeinoise.zeabur.app/healthz
```

應顯示：

```json
{"ok":true,"service":"newtaipei-noise-control-system-v19-ntpc-tech"}
```

## 更新 LINE 圖文選單

1. 開啟 `/admin.html`。
2. 使用 Zeabur `ADMIN_PASSWORD` 登入。
3. 按下「一鍵建立／更新 LINE 圖文選單」。
4. 重新進入 LINE 聊天室確認新圖文選單。
