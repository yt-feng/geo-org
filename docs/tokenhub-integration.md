# TokenHub integration contract

Checked on 2026-10-18 against TokenHub's official documentation, public
marketplace examples, and the signed-in API-key setup dialog. No account
credentials, redemption codes, or API keys belong in this document.

## ECO-GEO client integration

Client applications use an administrator-owned **ECO-GEO API key** with
`Authorization: Bearer YOUR_ECO_GEO_API_KEY` at `https://api.eco-geo.org`.
The TokenHub key stays encrypted in the gateway's provider configuration.
The following gateway operations are available:

| Operation | ECO-GEO method and path |
| --- | --- |
| Combined model and pricing catalog | `GET /api/tokenhub/v1/models` |
| Chat completions | `POST /api/tokenhub/v1/chat/completions` |
| Generate an image | `POST /api/tokenhub/v3/images/generations` |
| Create a video task | `POST /api/tokenhub/v3/contents/generations/tasks` |
| List this ECO-GEO user's video tasks | `GET /api/tokenhub/v3/contents/generations/tasks` |
| Query or cancel this user's task | `GET` / `DELETE /api/tokenhub/v3/contents/generations/tasks/{id}` |

The nine-model reference on 2026-10-18 contains four chat versions
(`glm-5-3-flash-260828`, `glm-5-2-260617`,
`deepseek-v4-pro-ga-260813`, `deepseek-v4-flash-ga-260731`), one image version
(`dola-seedream-5-0-pro-260628`), and four video versions
(`dreamina-seedance-2-0-260128`, `dreamina-seedance-2-0-fast-260128`,
`dreamina-seedance-2-0-mini-260615`, `dreamina-seedance-2-5-260628`).
Use the full version ID in the `model` field of the matching operation.

The authenticated `/tokenhub` workbench reads the combined live catalog from
the server, groups every recognized model by its endpoint type, and builds
cURL examples against the ECO-GEO routes above. A link such as
`/tokenhub?model=dreamina-seedance-2-5-260628&category=video` only selects the
model; it does not submit a request. Full JSON and custom IDs remain available.
The public `/models` page distinguishes TokenHub from APIMart and sends each
model to the corresponding workbench. Its TokenHub cards are a dated reference;
the authenticated live catalog remains authoritative for new model discoveries.

Catalog coverage, credential validation, relay implementation, and successful
model inference are separate states. If pricing discovery fails, the workbench
shows the authenticated model API's partial list and the source failure; it
does not invent media entries. Public-pricing-only entries explicitly retain
unverified account access. Unknown endpoint types stay visible in the catalog
without being labeled as a supported adapter.

## Endpoints and authentication

The upstream origin is `https://ai-tokenhub.ai`. Requests use
`Authorization: Bearer <TokenHub API key>` and JSON unless streaming.

| Operation | Upstream method and path | Evidence |
| --- | --- | --- |
| List models / validate supplied key | `GET /api/v1/models` | [Models reference](https://docs.ai-tokenhub.ai/en/api-reference/models) and live read-only checks |
| Chat completions | `POST /api/v1/chat/completions` | [Chat reference](https://docs.ai-tokenhub.ai/en/api-reference/chat) |
| Responses | `POST /api/v1/responses` | [Responses reference](https://docs.ai-tokenhub.ai/en/api-reference/images) |
| Embeddings | `POST /api/v1/embeddings` | [Embeddings reference](https://docs.ai-tokenhub.ai/en/api-reference/embeddings) |
| Image generation | `POST /api/v3/images/generations` | Current [marketplace](https://ai-tokenhub.ai/en/models) integration examples |
| Create video task | `POST /api/v3/contents/generations/tasks` | Marketplace examples and signed-in API-key setup example |
| Query video task | `GET /api/v3/contents/generations/tasks/{id}` | Marketplace examples |
| Cancel / delete video task | `DELETE /api/v3/contents/generations/tasks/{id}` | Marketplace examples and [operation semantics](https://docs.ai-tokenhub.ai/en/api-guides/Delete-video-generation-task) |

**Version discrepancy:** The current marketplace and signed-in key setup use
`/api/v3` for media. The [video creation reference](https://docs.ai-tokenhub.ai/en/api-guides/Create-video-generation-task)
and [query reference](https://docs.ai-tokenhub.ai/en/api-guides/Query-video-generation-task)
still show `/api/v2`. The [image reference](https://docs.ai-tokenhub.ai/en/api-guides/image-generation-api)
even shows the direct Volcengine origin. Use the current TokenHub `/api/v3`
examples; do not send the TokenHub key to the direct provider. An unauthenticated
GET received 401 on both video versions, which alone does not establish that
both versions have identical behavior. A signed-in key then received a JSON
404 saying the video generation task was not found from the `.ai` `/api/v3`
task route for a deliberately nonexistent ID. This confirms the current `.ai`
route accepts that key without creating or charging for a task. The marketplace
modal heading still displayed a `.com` URL, but its actual cURL integration
example used `.ai`; follow the latter. Do not retry a media creation request
automatically using another API version.

`GET /api/v1/models` is public when the Authorization header is omitted, but an
explicit invalid Bearer key returned 401 `InvalidCredentials` in the read-only
check. Verification must therefore always include the submitted key and require
a successful, valid model-list response. An anonymous 200 is not key validation.
No inference request is needed for this check.

The live model-list envelope is `{ "object": "list", "data": [...] }`. Observed
model fields include `id`, `owned_by`, `modelType`, `created`, `updated`, and
`iconSlug`. The reference also describes `name`, `provider`, `context_length`,
and `capabilities`; these should be treated as optional. The model API returned
four chat models, while the signed-in [marketplace](https://ai-tokenhub.ai/en/models)
displayed nine models, including media models. The API model count therefore
must not be presented as the total number of accessible marketplace models.

## Model identifiers

Use exact identifiers returned by the account's catalogue or its integration
example. The signed-in Seedance 2.0 marketplace integration example explicitly
used `dreamina-seedance-2-0-260128`, matching the public homepage. Other visible
media models included `dreamina-seedance-2-0-fast-260128`,
`dreamina-seedance-2-0-mini-260615`, `dreamina-seedance-2-5-260628`, and
`dola-seedream-5-0-pro-260628`. A generic API-key setup example separately used
`doubao-seedance-2-5-260628`; it is not evidence that the `doubao` and `dreamina`
names are interchangeable aliases. Prefer the chosen model's own marketplace
integration example over the generic setup example. The user's older
`doubao-seedance-2-0` name must not be silently rewritten into another model.

## Video requests

The Seedance 2.0 reference documents this request structure:

```json
{
  "model": "MODEL_ID_FROM_TOKENHUB",
  "content": [{ "type": "text", "text": "A calm coastline at sunrise" }],
  "resolution": "720p",
  "ratio": "16:9",
  "duration": 5,
  "generate_audio": true,
  "watermark": false,
  "return_last_frame": false
}
```

Additional `content` entries use:

| Type | Nested data | Role |
| --- | --- | --- |
| `image_url` | `image_url: { url }` | `first_frame`, `last_frame`, or `reference_image` |
| `video_url` | `video_url: { url }` | `reference_video` |
| `audio_url` | `audio_url: { url }` | `reference_audio` |

The documented Seedance 2.0 constraints are:

- First-frame / first-and-last-frame mode cannot be mixed with reference mode.
- Reference mode permits up to 9 images, 3 videos, and 3 audio inputs. Audio
  requires at least one image or video. Reference video and audio totals are
  each limited to 15 seconds; individual clips are 2–15 seconds.
- `resolution`: `480p`, `720p`, `1080p`; the fast model does not support 1080p.
- `ratio`: `16:9`, `4:3`, `1:1`, `3:4`, `9:16`, `21:9`, or `adaptive`.
- `duration`: integer 4–15, or `-1` for automatic duration. Default 5. The older
  1.0 models have different ranges. Do not assume this table covers every 2.5
  variant without that model's own confirmation.
- `seed`: integer -1 through 2147483647; default -1.
- `generate_audio`: default true; `watermark` and `return_last_frame`: default
  false.
- `execution_expires_after`: default 172800 seconds; recommended range
  3600–259200. `priority`: integer 0–9, default 0.
- Upstream accepts media URLs and certain Base64 / `asset://` inputs. The
  upstream request limit is 64 MB. ECO-GEO can impose a smaller request limit
  and a more limited input surface; report that limit rather than silently
  truncating input.

The creation response always needs a usable `id`. A published example also
contains `upstreamTaskId`, `status: "submitted"`, `model`, and ISO `createdAt`.
Preserve the returned task ID; never derive it from a model or a prompt.

The query reference lists `queued`, `running`, `cancelled`, `succeeded`,
`failed`, and `expired`, with `content.video_url` and optional
`content.last_frame_url`. It also describes `error`, `usage.completion_tokens`,
`usage.total_tokens`, and Unix-second `created_at` / `updated_at`. Treat
`submitted` as pending when encountered. Output URLs are documented as valid
for 24 hours, and task records as retained for seven days. Do not describe a
temporary URL as permanent storage.

The workbench omits `return_last_frame` from its default video request because
support is not confirmed for every listed version. A caller may opt in through
the full JSON editor after checking the selected model's documentation; the
preview still displays a last-frame URL if the upstream returns one.

DELETE cancels a queued task. It deletes the record of succeeded, failed, or
expired tasks. Running and already-cancelled tasks cannot be deleted according
to the reference. Query and deletion must remain scoped to the ECO-GEO user who
created the task, because the shared upstream key can access multiple users'
tasks.

## Images and text

The current marketplace image example sends `model`, `prompt`, `size: "2K"`,
and `watermark: false`; its SDK example also sets `response_format: "url"`.
The image reference describes optional `image` URL(s), group generation with
`sequential_image_generation` and `sequential_image_generation_options`,
`stream`, and model-dependent output formats. Results contain `data[].url` or
`data[].b64_json`, optional `data[].size` / `data[].error`, and usage counts.
Supported sizes and group-generation limits depend on the chosen model.
The 2026-10-18 Seedream 5.0 Pro audit returned `InvalidParameter10508` for
`sequential_image_generation`; omit that field from the default request,
including an explicit `disabled` value. The workbench's default image request
uses only the model, prompt, size, watermark, and URL response format.

Chat uses `model`, `messages`, optional `temperature`, `max_tokens`, `stream`,
and `stop`; non-streaming output is OpenAI-compatible `choices` and `usage`.
Responses uses `model` and `input`, with optional tools and generation options.
Forward only the supported operation and headers; do not accept arbitrary
upstream URLs from clients.

## Prices and account state

The public marketplace's `GET /api/pricing` returned `currencyCode: "USD"` and
model deployment prices. This is a marketplace endpoint observed in its client,
not a documented API-key balance endpoint. Public prices and model visibility
may differ from a particular account's enabled deployments.

The signed-in marketplace displayed the following prices on 2026-10-18:

| Model / configuration | Observed price |
| --- | --- |
| Seedance 2.0, 480p, no reference video | USD 7 per million output tokens |
| `dola-seedream-5-0-pro-260628` | USD 0.09 per successfully generated image |

These are dated observations for the inspected configuration, not constants
for every model, resolution, channel, or future request. They are recorded for
verification and must not be hardcoded as current product prices. In particular,
do not calculate a fixed per-video price from duration alone.

The [Seedance billing guide](https://docs.ai-tokenhub.ai/en/api-guides/Dreamina-Seedance-2.0-Billing-Instructions)
says only successfully generated videos are charged. It describes token usage
as `(input video seconds + output seconds) × output width × output height × fps
/ 1024`, subject to minimum usage for reference-video inputs. Reconciliation
uses returned `usage.completion_tokens`. The billing guide itself does not
publish a fixed numeric USD rate. Do not hardcode a video price or infer remaining credit
from a model-list response. Account credit, key spending limits, successful
credential validation, and actual generation success are separate states.
