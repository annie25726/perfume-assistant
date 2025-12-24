# HuggingFace 模型建議（中文/繁體優先）

你現在用的是 HuggingFace Router 的 `chat/completions` 介面（`HF_MODEL`）。
建議選「指令微調（Instruct/Chat）」且中文能力強的模型，會大幅降低英文亂入與引用亂寫的機率。

## 推薦清單（由穩定到省資源）

1) **Qwen2.5 Instruct（中文很強、指令遵循佳）**
- 例：`Qwen/Qwen2.5-7B-Instruct`、`Qwen/Qwen2.5-1.5B-Instruct`
- 適合：一般客服、知識問答、RAG 搭配
- 設定：`HF_MODEL=Qwen/Qwen2.5-7B-Instruct`

2) **GLM-4-9B-Chat（中文對話強、長文能力好）**
- 例：`zai-org/glm-4-9b-chat` / `zai-org/glm-4-9b-chat-hf`
- 適合：多輪對話、較長上下文、推理題
- 設定：`HF_MODEL=zai-org/glm-4-9b-chat`

3) **Yi-1.5 Chat（中文/英文均衡，體感順）**
- 例：`01-ai/Yi-1.5-9B-Chat`
- 適合：通用聊天、客服問答
- 設定：`HF_MODEL=01-ai/Yi-1.5-9B-Chat`

## .env 建議

```env
HF_API_TOKEN=hf_xxx
HF_MODEL=Qwen/Qwen2.5-7B-Instruct
HF_TEMPERATURE=0.3
HF_MAX_TOKENS=512

# 英文比例門檻（超過就會：先 retry 一次，再 fallback ChatGPT）
EN_RATIO_THRESHOLD=0.18

# Debug：回傳 raw/cleaned 與 fallback 資訊（前端可展開）
DEBUG_OUTPUT=1
```

> 如果你希望「嚴格只輸出中文」，可開：
> `KEEP_CHINESE_ONLY=1`
