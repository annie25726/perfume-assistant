# Perfume Assistant

這是一個香水助理專案，包含 Node.js 伺服器與前端。

## 結構
- server/：後端 Node.js 服務
- services/：AI、學習、RAG 等服務
- web/：前端 React 程式碼
- public/：靜態檔案

## 啟動方式
1. 進入 server 目錄安裝依賴：
   ```
   cd server
   npm install
   ```
2. 啟動伺服器：
   ```
   node index.js
   ``` 

## 注意事項
- 請勿上傳 `.env`、`node_modules/`、`uploads/` 等資料夾。
- 敏感資訊請放於 `.env`，勿提交到 GitHub。
