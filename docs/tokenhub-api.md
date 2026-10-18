# ECO-GEO TokenHub API

TokenHub 的业务调用统一使用 `https://api.eco-geo.org/api/tokenhub`，与原有数据 API 的 `/api/v1` 路由并存。使用管理员账户创建的 ECO-GEO API Key，格式为 `Authorization: Bearer eco_live_...`；上游 TokenHub Key 由服务端读取加密配置，不进入客户端请求。业务配置与限额 $5 的七天核验专用密钥分开。

管理员可在 [统一 API 文档](https://api.eco-geo.org/dashboard/docs?provider=tokenhub) 查看完整参数和可复制示例，也可下载 [TokenHub OpenAPI JSON](https://api.eco-geo.org/api/private/tokenhub-openapi)。本地规范不依赖 TokenHub 或数据接口文档服务实时可用；统一页面独立读取两个来源，任一失败都会保留另一来源并显示缺失提示。文档下载要求管理员登录会话，模型调用也可使用管理员 ECO-GEO API Key。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/tokenhub/v1/models` | 合并文本、图片、视频的实时模型目录 |
| POST | `/api/tokenhub/v1/chat/completions` | 完整 JSON 文本对话，`stream: false` |
| POST | `/api/tokenhub/v3/images/generations` | 图片生成 |
| POST | `/api/tokenhub/v3/contents/generations/tasks` | 创建视频任务，需要 `Idempotency-Key` |
| GET | `/api/tokenhub/v3/contents/generations/tasks` | 当前 ECO-GEO 账户最近 50 项本地视频任务 |
| GET | `/api/tokenhub/v3/contents/generations/tasks/{task_id}` | 查询本账户在本站创建的视频任务 |
| DELETE | `/api/tokenhub/v3/contents/generations/tasks/{task_id}` | 请求取消或删除本账户任务 |

模型参考快照在 [`lib/tokenhub-model-reference.ts`](../lib/tokenhub-model-reference.ts)，当前包含四个文字模型、一个图片模型及四个视频模型，全部九个 ID 均出现在相应操作的模型枚举中。它不是可用性白名单。运行时以 `/api/tokenhub/v1/models` 为准，并检查：

- `catalog.complete` 与 `catalog.sources`：价格市场不可读时明确返回部分目录。
- `data[].modelType`、`endpoint`、`taskEndpoint`：选择对应的文字、图片或视频接口。
- `integrationStatus: ready`：现有调用适配可处理该模型协议；不表示已经完成一次实际生成。
- `accountAccess: unverified_public_catalog`：模型来自公开市场，账户权限尚未由调用结果确认。
- `integrationStatus: catalog_only`：新模型已发现，暂未提供经过验证的调用适配。

OpenAI 兼容客户端仅将文本 `base_url` 设置为 `https://api.eco-geo.org/api/tokenhub/v1`。图片、视频沿用上表专属 v3 路径，不能拼成文本客户端的 `/v1/images/generations`。

```sh
curl --request POST \
  --url 'https://api.eco-geo.org/api/tokenhub/v1/chat/completions' \
  --header 'Authorization: Bearer eco_live_your_api_key' \
  --header 'Content-Type: application/json' \
  --data-raw '{"model":"deepseek-v4-flash-ga-260731","messages":[{"role":"user","content":"请用一句话介绍自己。"}],"max_tokens":8192,"stream":false}'
```

视频创建示例中，每个新任务必须替换 `replace_with_unique_request_id`；同一次任务重试沿用原编号和原请求体。服务端会返回已经保存的回执，或在结果未知时返回 409，不能通过更换编号来重复生成。

```sh
curl --request POST \
  --url 'https://api.eco-geo.org/api/tokenhub/v3/contents/generations/tasks' \
  --header 'Authorization: Bearer eco_live_your_api_key' \
  --header 'Content-Type: application/json' \
  --header 'Idempotency-Key: replace_with_unique_request_id' \
  --data-raw '{"model":"dreamina-seedance-2-0-fast-260128","content":[{"type":"text","text":"白桌上的蓝色球缓慢向右滚动，一个连续固定镜头。"}],"duration":4,"resolution":"480p","ratio":"16:9","generate_audio":false,"watermark":false}'
```

保存返回的 `id`，再调用查询接口。任务创建成功不等于生成完成；媒体质量和模型身份也不能由 HTTP 成功状态推断。取消或删除任务不保证退费。图片和文字请求当前没有视频任务的本地幂等回执机制，发生超时后先核对上游请求记录。

接口不接受查询参数，POST 使用 JSON，当前流式响应不受支持。浏览器会话写操作须来自本站；ECO-GEO API Key 调用不依赖浏览器 Cookie。请求体、模型参数及上游模型支持范围共同决定实际结果。
