# 新北市打擊噪音車管理系統 V18 Security

## 安全重點

- 後台密碼不得寫死在程式、README、前端頁面或 GitHub。
- 後台登入只讀取 Zeabur 環境變數 `ADMIN_PASSWORD`。
- Session 簽章只讀取 `SESSION_SECRET`。
- Debug API 不輸出密碼、LINE Token 或 Secret 實際值，只顯示是否已設定。

## Zeabur 必填環境變數

```env
NODE_ENV=production
PORT=8080
PUBLIC_BASE_URL=https://newtaipeinoise.zeabur.app
DASHBOARD_URL=https://noise115.zeabur.app
FIELD_REPORT_URL=https://out115.zeabur.app
ADMIN_PASSWORD=請設定新的後台密碼
SESSION_SECRET=請設定64字元以上隨機字串
LINE_CHANNEL_ACCESS_TOKEN=請填入LINE長期Access Token
LINE_CHANNEL_SECRET=請填入LINE Channel Secret
```

## 部署後檢查

- `/healthz`
- `/admin.html`
- `/api/line/test`
- `/api/line/debug/latest`

## 後台

開啟 `/admin.html` 後輸入 Zeabur `ADMIN_PASSWORD`。系統不會顯示或回傳實際密碼。
