# Gemini API Proxy for Node.js

一个基于 Express 5 的 Google Gemini API 反向代理，支持流式响应、自动版本路由、连接池复用。

## 特性

- **透明代理** — 完整转发请求/响应，支持 SSE 流式输出
- **多种 Key 传递方式** — Header / Authorization Bearer / Query 参数均可
- **HTTP 连接池** — Keep-Alive 复用 TCP 连接，降低延迟
- **CORS 完整实现** — 动态 Origin 回显，支持带凭证请求
- **自动版本路由** — 检测请求体自动选择 `v1` / `v1beta`
- **超时保护** — 可配置超时时间，区分 502/504 错误
- **日志脱敏** — Debug 模式下 API Key 自动替换为 `***`

## 快速开始

```bash
npm install
node server.js
```

默认监听 `http://localhost:3000`。

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3000` | 监听端口 |
| `DEBUG` | `false` | 开启调试日志（`true` / `false`） |
| `REQUEST_TIMEOUT` | `120000` | 上游请求超时时间（毫秒） |

## API Key 传递方式

以下三种方式均支持，优先级从高到低：

```
# 1. 专用 Header
X-Goog-Api-Key: YOUR_API_KEY

# 2. Authorization Header
Authorization: Bearer YOUR_API_KEY

# 3. Query 参数
?key=YOUR_API_KEY
```

## 使用示例

```bash
# 非流式
curl http://localhost:3000/v1beta/models/gemini-2.0-flash:generateContent \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"contents":[{"parts":[{"text":"Hello"}]}]}'

# 流式 SSE
curl http://localhost:3000/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"contents":[{"parts":[{"text":"Hello"}]}]}'
```

## 路径规则

- 路径中包含 `/v1/` 或 `/v1beta/` → 直接使用对应版本
- 路径不含版本前缀 → 检测请求体，含 `systemInstruction` / `tool_config` / `tool_calls` 则用 `v1beta`，否则用 `v1beta`（默认）
- 降级到 `v1` 时，自动剔除不兼容字段

## Debug 模式

```bash
DEBUG=true node server.js
```

或对任意请求附加 `?debug=true` 返回服务器信息：

```json
{
  "debug": true,
  "method": "GET",
  "path": "/",
  "server_info": { "platform": "linux", "node_version": "v22.x.x" }
}
```