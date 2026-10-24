/** Customer-facing contracts only. No service credentials or purchase prices. */
export function selectedOpenApi(baseUrl: string) {
  const response = (description: string) => ({ description, content: { "application/json": { schema: { type: "object", additionalProperties: true } } } });
  const parameters = [
    { name: "Idempotency-Key", in: "header", required: true, schema: { type: "string", minLength: 8, maxLength: 128 }, example: "unique_selected_request_001", description: "每次新请求使用唯一编号。内容相同的重试沿用原编号，避免重复提交。" },
    { name: "X-Tokvilo-Max-Reserve-Microusd", in: "header", required: false, schema: { type: "integer", minimum: 1 }, description: "本次允许的最大预留金额，可填写工作台报价返回的 reservedMicrousd；1 美元等于 1000000 micro-USD。" },
  ];
  const responses = { "200": response("生成结果、实际用量与 tokvilo_billing。status=settled 表示已结算；等待核对时请保留原请求编号。"), "400": response("请求参数无效。"), "401": response("请登录或使用有效的 tokvilo API Key。"), "402": response("余额不足。"), "409": response("请求编号冲突或最新报价超过确认上限。"), "422": response("模型尚未适配此接口。"), "429": response("请求过于频繁。"), "502": response("结果或用量尚待核对，请保留原请求编号。"), "503": response("该模型服务暂未开通或报价暂不可用。") };
  return { openapi: "3.0.3", info: { title: "tokvilo 精选 API", version: "1.0.0", description: "使用 tokvilo API Key 与账户余额调用精选模型。模型 ID 与其他服务可能相同，请使用本服务地址；仅 billingReady=true 的模型可调用。价格目录为 /api/pricing 中 provider=selected 的条目。" },
    servers: [{ url: baseUrl.replace(/\/+$/, "") }], security: [{ TokviloBearer: [] }],
    components: { securitySchemes: { TokviloBearer: { type: "http", scheme: "bearer", bearerFormat: "tokvilo API Key" } } },
    paths: {
      "/api/selected/v1/chat/completions": { post: { summary: "tokvilo 精选文本对话", tags: ["tokvilo 精选 · 文本"], parameters,
        description: "支持纯文本完整响应。每次只返回一个结果，stream 必须为 false。消息最多 100 条，总内容不超过 32 KB。必须指定 max_tokens 或 max_completion_tokens（只能选一个），范围 1–4096。工具调用、多模态输入和流式响应暂未开放。先预留余额，再按返回的实际用量结算并退回差额。",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["model", "messages"], oneOf: [{ required: ["max_tokens"] }, { required: ["max_completion_tokens"] }], additionalProperties: false, properties: {
          model: { type: "string" }, messages: { type: "array", minItems: 1, maxItems: 100, items: { type: "object", required: ["role", "content"], additionalProperties: false, properties: { role: { type: "string", enum: ["system", "user", "assistant"] }, content: { type: "string", minLength: 1 } } } },
          max_tokens: { type: "integer", minimum: 1, maximum: 4096 }, max_completion_tokens: { type: "integer", minimum: 1, maximum: 4096 }, stream: { type: "boolean", enum: [false] }, n: { type: "integer", enum: [1] }, temperature: { type: "number", minimum: 0, maximum: 2 }, top_p: { type: "number", minimum: 0, maximum: 1 },
        } }, example: { model: "gpt-6.1-sol", messages: [{ role: "user", content: "请用一句话介绍 tokvilo。" }], max_tokens: 1024, stream: false } } } }, responses,
      } },
      "/api/selected/v1/images/generations": { post: { summary: "tokvilo 精选图片生成", tags: ["tokvilo 精选 · 图像"], parameters,
        description: "当前适配 gpt-image-2：每次生成 1 张 1024x1024 图像，结果仅支持 HTTPS 图片链接（response_format=url）。该模型仍需在价格目录中显示 billingReady=true 才能调用。其他图片型号可查看价格，接口开通状态独立显示。",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["model", "prompt"], additionalProperties: false, properties: { model: { type: "string", enum: ["gpt-image-2"] }, prompt: { type: "string", minLength: 1, maxLength: 4000 }, n: { type: "integer", enum: [1] }, size: { type: "string", enum: ["1024x1024"] }, response_format: { type: "string", enum: ["url"] } } }, example: { model: "gpt-image-2", prompt: "清晨山间的小屋，水彩风格。", size: "1024x1024", n: 1 } } } }, responses,
      } },
    },
  };
}
