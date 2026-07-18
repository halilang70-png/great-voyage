# clipdrop

P2P 剪贴板同步工具 — 在手机和电脑之间即时同步文字和图片。

🔗 **[在线体验](https://great-voyage.pages.dev)**

## 特性

- ⚡ **P2P 即时同步** — 基于 VDO.Ninja SDK WebRTC DataChannel，零服务器延迟
- 🔄 **自动降级** — P2P 不通时自动切换 HTTP 中转，手动点接收同步
- 📝 **Markdown 渲染** — 支持粗体/斜体/标题/列表/引用/代码块
- 🎨 **代码高亮** — 自动检测代码片段并着色
- 🔗 **URL 检测** — 链接可点击，hover 显示预览卡片
- 📱 **QR 码分享** — 扫码加入房间，无需手动输入房间名
- 🔊 **声音提醒** — Web Audio API 合成音效，无需音频文件
- 📋 **自动复制** — 可选开启，收到文字自动复制到剪贴板
- 💾 **历史持久化** — localStorage 保存消息，刷新不丢失
- 🖼️ **图片传输** — 粘贴或拖拽发送图片（仅 P2P 模式）
- 🌙 **深色主题** — 默认暗色 UI，对眼睛友好

## 架构

```
手机 A  ←── WebRTC P2P ──→  手机 B
  │                            │
  └── HTTP POST ──→ KV ──→ 手动拉取 ──┘
            (fallback 降级时)
```

1. **主路径**: 两个设备通过 VDO.Ninja SDK 建立 WebRTC 连接，DataChannel 直传
2. **降级路径**: P2P 超时（6秒）后切换到 Cloudflare KV 存储，接收端手动点"接收"按钮拉取

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | SvelteKit 5 + TypeScript |
| P2P | VDO.Ninja SDK (WebRTC) |
| 后端 | Cloudflare Workers (Pages Functions) |
| 存储 | Cloudflare KV (免费额度) |
| 音效 | Web Audio API (纯代码合成) |
| QR | api.qrserver.com |

## 本地开发

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 类型检查
npm run check

# 构建
npm run build
```

## 部署到 Cloudflare Pages

### 1. 创建 KV Namespace

```bash
npx wrangler kv namespace create SYNC
```

将返回的 ID 填入 `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "SYNC"
id = "你的KV_NAMESPACE_ID"
```

### 2. 部署

**方式 A — Dashboard 连接 GitHub:**

1. Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git
2. 选择仓库
3. Build command: `npm run build`
4. Build output: `.svelte-kit/output/client`
5. Settings → Functions → KV namespace bindings → 添加 `SYNC`

**方式 B — 命令行:**

```bash
npx wrangler pages deploy .svelte-kit/output/client
```

## 免费额度

| 服务 | 免费额度 |
|------|---------|
| Workers 请求 | 10 万次/天 |
| KV 读取 | 10 万次/天 |
| KV 写入 | 1,000 次/天 |
| KV 存储 | 1 GB |
| VDO.Ninja | 无限制 |
| SvelteKit | 无限制 |

## License

MIT
