# 商品询价通知

非 API 商品通过 `POST /api/product-inquiries` 提交需求，不要求登录，不创建采购订单，不预留或扣减钱包余额。表单说明会在 24 小时内通过客户填写的邮箱回复。

请求为 `{ productId, email, name?, message }`，必须同源并提供 `Idempotency-Key`（8–128 位字母、数字、下划线或连字符）。相同内容重试沿用编号；修改内容后换编号。邮箱最长 254 字符，称呼最长 100 字符，需求为 1–4,000 字。每个 IP 每小时最多创建 5 条，重复回执不占新名额。

成功响应为 `{ ok: true, inquiryId, emailStatus: "sent" | "pending" }`。`pending` 表示需求已持久保存，邮件通知尚未确认发送；不得把它显示为提交失败并自动重试。`sent` 表示邮件服务已接受发送，不等同于收件人已阅读。

部署前应用 `drizzle/0015_product_inquiries.sql`。记录包含商品与价格快照、精确来源页面、客户联系方式、需求和通知状态，保留原有钱包及历史订单表。

Cloudflare 配置：

- `send_email` 绑定名：`PRODUCT_INQUIRY_EMAIL`。
- `destination_address` 固定为 `yt.feng@foxmail.com`。
- `PRODUCT_INQUIRY_FROM=orders@tokvilo.com`。
- `PRODUCT_INQUIRY_EMAIL_ENABLED=true`。
- 发送域名需要启用 Email Routing，收件地址需要验证。绑定不设置 `remote: true`，本地开发不通过远程绑定投递邮件。

此绑定使用 [Cloudflare EmailMessage / send() 接口](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/)。客户邮箱仅作为经校验的 Reply-To；邮件实际收件人固定，客户输入放入编码后的纯文本正文，不拼入发件人、收件人或主题。

需求先写入 D1，再尝试通知。既有五分钟 cron 同时检查待发送需求，每轮最多 10 条；原有审计和模型任务结算逻辑保持不变。每条记录原子占用五分钟发送窗口，最多尝试 12 次；未配置发信时保留 pending 且不消耗尝试次数。超时或失败保留待处理记录及通用错误码，不记录邮件服务返回的私密诊断。

重试使用相同 Message-ID。邮件服务已接受但数据库确认失败时，后续重试仍可能重复通知，邮件中会显示同一需求编号。达到 12 次后不再自动发送，需管理员检查 `product_inquiries` 中的待处理记录。不要把已发送状态重置后批量重发。

本地验证：`node --test tests/product-inquiries.test.mjs tests/product-inquiry-ui.test.mjs`。测试使用内存 SQLite 和模拟邮件绑定，不发送真实邮件。
