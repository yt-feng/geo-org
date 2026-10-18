# APIMart credential storage and verification

The administrator settings form encrypts APIMart credentials with the existing
provider-specific AES-GCM context. It attempts a read-only `/v1/balance` request
before saving. A successful, valid balance response saves the key with a
verification timestamp, including when the balance is zero.

APIMart may instead return HTTP 402 for balance or model discovery. On an explicit
key save, HTTP 402 permits encrypted persistence but does not verify the key.
The existing non-null `verified_at` column stores an empty string; status responses
normalize this to `verifiedAt: null`. The save response contains `quota: null` and
the fixed message:

> 密钥已加密保存，APIMart 返回余额不足（HTTP 402）；请补充余额后重新验证。

The settings page renders “已保存·待验证” without the verified green state. A later
successful connection test records the server's verification timestamp. Explicit
connection tests and model reads return HTTP 402 with a balance-specific message
until the provider permits the request; they do not guess balances or parse
provider error text for credentials.

Authentication failures, malformed responses, redirects, network errors and other
upstream failures still leave any previously saved key unchanged. No raw provider
error body is included in the saved warning or API error response.
