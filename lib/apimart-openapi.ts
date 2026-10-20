const BASE = "/api/apimart";
const auth = "使用当前账户的 tokvilo API Key；上游密钥由服务端保存。调用前预留钱包余额，完成后按上游价格 × 1.20 结算并退回差额。金额单位为 micro-USD（1 USD = 1,000,000 micro-USD）。";
const response = (description: string) => ({ description, content: { "application/json": { schema: { type: "object", additionalProperties: true } } } });
const errors = { "400": response("请求参数无效。"), "401": response("请登录或提供有效 API Key。"), "402": response("钱包余额不足。"), "403": response("账户已停用或浏览器请求不是同源请求。"), "409": response("请求编号冲突，或之前的请求结果等待确认。"), "422": response("模型或参数尚无可用报价。"), "429": response("请求限流。"), "502": response("上游结果或用量尚未确认，保留原请求编号。"), "503": response("服务、密钥或实时价格暂不可用。") };
const idempotency = [{ name: "Idempotency-Key", in: "header", required: true, schema: { type: "string", pattern: "^[A-Za-z0-9_-]{8,128}$" }, example: "replace_with_unique_request_id", description: "每次新请求使用唯一编号；重试保持相同编号与内容，不会再次发起同一付费请求。" }];
const body = (schema: unknown, example: unknown) => ({ required: true, content: { "application/json": { schema, example } } });

export function apimartOpenApi(baseUrl: string) {
  return {
    openapi: "3.0.3", info: { title: "tokvilo APIMart API", version: "1.0.0", description: auth },
    servers: [{ url: baseUrl.replace(/\/+$/, "") }], security: [{ TokviloBearer: [] }],
    components: { securitySchemes: { TokviloBearer: { type: "http", scheme: "bearer", bearerFormat: "tokvilo API Key" } } },
    paths: {
      [BASE + "/v1/models"]: { get: { summary: "查询 APIMart 模型与实时价格", tags: ["APIMart · 模型"], description: "返回上游密钥可访问的模型与 tokvilo 报价。pricing 为 null 的模型尚未开通付费调用。公开价格目录为 GET /api/pricing。", responses: { "200": response("模型目录，包含 pricing 和 pricing_observed_at。"), ...errors } } },
      [BASE + "/v1/chat/completions"]: { post: {
        summary: "APIMart 文本对话", tags: ["APIMart · 文本"], parameters: idempotency,
        description: `${auth} 当前支持已标价的标准单档纯文本模型。stream 必须为 false；暂不支持工具、多模态输入、分档或附加计费。max_tokens（或兼容别名 max_completion_tokens）只能选一个，范围 1–4096，默认 1024。费用依据返回 usage，包含已公布缓存费率的缓存读取。`,
        requestBody: body({ type: "object", required: ["model", "messages"], additionalProperties: false, properties: {
          model: { type: "string" }, messages: { type: "array", minItems: 1, maxItems: 100, items: { type: "object", required: ["role", "content"], properties: { role: { type: "string", enum: ["system", "user", "assistant"] }, content: { type: "string" } }, additionalProperties: false } },
          stream: { type: "boolean", enum: [false] }, max_completion_tokens: { type: "integer", minimum: 1, maximum: 4096 }, max_tokens: { type: "integer", minimum: 1, maximum: 4096 }, temperature: { type: "number", minimum: 0, maximum: 2 }, top_p: { type: "number", minimum: 0, maximum: 1 },
        } }, { model: "gpt-5", messages: [{ role: "user", content: "请用一句话介绍自己。" }], stream: false, max_tokens: 1024 }),
        responses: { "200": response("上游 JSON 和 tokvilo_billing；status=settled 时 chargedMicrousd 为最终费用，awaiting_reconciliation 表示尚待核对。"), ...errors },
      } },
      [BASE + "/v1/images/generations"]: { post: {
        summary: "创建 APIMart 图片任务", tags: ["APIMart · 图片"], parameters: idempotency,
        description: `${auth} 每次生成一张图片。当前支持已有固定张价、无额外材料计费的模型；价格以 resolution 为准，未指定时使用该模型 default 价格。请求成功只表示任务受理，使用返回的 data[0].task_id 查询。完成后依据任务 cost 加价 20% 结算，失败任务退回预留。后台会自动查询已创建任务，无需一直打开工作台。`,
        requestBody: body({ type: "object", required: ["model", "prompt"], additionalProperties: false, properties: {
          model: { type: "string" }, prompt: { type: "string", minLength: 1, maxLength: 10000 }, n: { type: "integer", enum: [1] },
          resolution: { type: "string", example: "2k" }, size: { type: "string", example: "1:1" }, image_urls: { type: "array", maxItems: 10, items: { type: "string", format: "uri" } },
        } }, { model: "gpt-image-2", prompt: "晨光中的山间小屋，水彩画风格。", n: 1, resolution: "2k", size: "1:1" }),
        responses: { "200": response("任务编号与预留金额。"), ...errors },
      } },
      [BASE + "/v1/tasks"]: { get: { summary: "列出当前账户的 APIMart 图片任务", tags: ["APIMart · 图片"], description: "返回当前账户在本站创建的最近 50 个任务。任务列表不会创建生成请求。", responses: { "200": response("任务 ID、模型、状态和时间。"), ...errors } } },
      [BASE + "/v1/tasks/{task_id}"]: { get: { summary: "查询 APIMart 图片结果", tags: ["APIMart · 图片"], description: "只允许查询属于当前账户的任务。completed 后查看 data.result.images 和 tokvilo_billing；媒体 URL 可能有过期时间。重复查询不会重复扣款。",
        parameters: [{ name: "task_id", in: "path", required: true, schema: { type: "string", pattern: "^[A-Za-z0-9_-]{1,160}$" }, example: "task_id_from_create_response" }],
        responses: { "200": response("任务状态、结果与最终结算。"), "404": response("此账户没有对应任务。"), ...errors },
      } },
    },
  };
}
