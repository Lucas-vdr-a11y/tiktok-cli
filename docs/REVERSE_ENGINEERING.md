# TikTok Studio — Reverse-Engineering Notes

This document records how the TikTok Studio web upload flow works, as reverse-engineered by driving the real app. Captron uses these findings to post videos through TikTok's official pipeline.

## The upload pipeline

```
1. GET  /api/v1/video/upload/auth/?aid=1988&msToken=...
       → { ak, audio_token_v5: { access_key_id, secret_acess_key, session_token, ... } }
       Returns STS-style credentials used to sign the TOS upload request.

2. POST https://tos-*.tiktokcdn-eu.com/upload/v1/tos-no1a-v-0068-no/<key>
       Authorization: SpaceKey/tiktok/0/:version:v2:<JWT>
       Content-Type: multipart/form-data
       → { code: 2000, data: { post_upload_resp: { results: [{ vid, video_meta }] } } }
       The `vid` (e.g. v24025gl0000dac...) is the uploaded video id.

3. POST /tiktok/v1/creator/content/check/create?aid=1988
       { video_id, tasks: [0] }
       → { check_ids: { CONTENT_CHECK_TASK_LITE: "<id>" } }

4. GET  /tiktok/v1/creator/content/check/?video_id=...&queries=[{"task":0,"check_id":"<id>"}]&aid=1988
       Polls until check_status reaches 2 (complete). Can take up to ~10 minutes.

5. POST /tiktok/web/project/post/v1/?app_name=tiktok_web&channel=tiktok_web&device_platform=web&tz_name=...&aid=1988&msToken=...&X-Bogus=...&X-Gnarly=...
       { post_common_info, feature_common_info_list: [{ vedit_common_info: { video_id }, privacy_setting_info, ... }] }
       → { project_id, single_post_resp_list: [{ item_id, status_code }] }
```

Steps 1–2 are handled by TikTok's own upload SDK inside the page; captron lets the page do them. Steps 3–5 are triggered by the **Post** button and the confirmation modal.

## The two-click publish

A common gotcha: clicking "Post" does **not** immediately publish. Two things can gate the actual publish:

1. **The onboarding tour** (`react-joyride__overlay`) intercepts pointer events. Captron removes it and dispatches a raw DOM click.
2. **The confirmation modal** — when the content check is still running, TikTok shows *"Continue with posting? We're still checking the video..."* with **Cancel** / **Post now** (localized: *Nu plaatsen*, *Placer maintenant*, ...). The publish only fires after clicking the confirm button.

Captron handles both automatically.

## Signatures

The publish request carries `msToken`, `X-Bogus`, and `X-Gnarly` — anti-bot signatures computed by TikTok's in-page SDK. Because captron drives the real page (not a hand-rolled HTTP client), these are generated correctly and automatically. This is the main reason the tool drives the browser rather than calling the API directly.

## Endpoints observed

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/video/upload/auth/` | Upload credentials |
| POST | `tos-*.tiktokcdn-eu.com/upload/v1/...` | Video bytes → TOS |
| POST | `/tiktok/v1/creator/content/check/create` | Start content check |
| GET | `/tiktok/v1/creator/content/check/` | Poll check status |
| POST | `/tiktok/web/project/post/v1/` | **Publish** |
| POST | `/tiktok/creator/manage/item_list/v1/` | List posts (cursor/size pagination, per-post stats + download URLs, **no signature**) |
| POST | `/tiktok/v1/creator/publish_setting/` | Publish settings |
| GET | `/tiktok/v1/analytics/insights/` | **Analytics metrics (batched, no signature)** |

## Analytics insights API

The Studio analytics dashboard hydrates from one batched endpoint:

```
GET /tiktok/v1/analytics/insights/
    ?type_requests=[{"insight_type":121,"data_date_range":7},...]
    &time_offset=<seconds from UTC>
    &is_dark_mode=false
```

- **No X-Bogus / X-Gnarly signature required** (unlike most `/tiktok/v1` APIs) — session cookies authorize the request. Captron issues it from page context (`fetch`) after loading `/tiktokstudio/analytics`.
- `data_date_range` accepts **1, 7, 28 or 60** days.
- Metric ids (mapped by probing 1–160, 2026-09): views **121**, profile views **122**, likes **123**, comments **124**, shares **125**, creator rewards **126**, traffic sources **127**, new viewers **140**, total viewers **141**, viewer active days **145**, active hours **146**, followers **160**.
- The response keys metrics by semantic name (`analytics_overview_views`, `analytics_follower_total_followers`, …) — see `RESPONSE_KEYS` in `src/analytics.js`.
- Each metric wraps its fields (`total`, `delta_change`, `percent_change`, `list`, `key_value`) as `{message: {data_source, status, timestamp}, value?}`. Status **1** = ok, **2** = no data/empty, 7/9/10 = not applicable. `src/analytics.js#unwrap` strips this envelope.

## Posts list API (`item_list`)

`POST /tiktok/creator/manage/item_list/v1/` with JSON body
`{"cursor":0,"size":50,"query":{"sort_orders":[{"field_name":"post_time","order":2}],"conditions":[],"is_recent_posts":false}}`
and headers `content-type: application/json`, `agw-js-conv: str`. **No signature needed.**

Response `{item_list, cursor, has_more, status_code}` — each item includes
`item_id, desc, create_time, duration, play_count, like_count, comment_count,
share_count, favorite_count, visibility (1=public/0=private), in_review,
is_pinned, status (102 = published/live), cover_url[], download_info.download_urls[]`.

**No signature needed.** Numeric counts are **strings** — the normalizer calls
`Number()` on them.

- Paginate via `cursor` + `has_more` (cursor advances in 50s).
- Each item fields: `item_id`, `desc`, `create_time`, `duration` (ms),
  per-post stats (`play_count`, `like_count`, `comment_count`,
  `share_count`, `favorite_count`), `visibility` (1=public/0=private),
  `in_review`, `is_pinned`, `status` (102 = published/live),
  `cover_url[]` and `download_info.download_urls[]`.
- `download_urls` are pre-signed CDN variants; the trailing `aweme/v1/play/`
  URL **403s for non-browser clients even in-page** (CORS). Reliable download
  path: load the public watch page `https://www.tiktok.com/@<handle>/video/<id>`,
  read `__UNIVERSAL_DATA_FOR_REHYDRATION__` -> `itemStruct.video.playAddr`,
  then GET that via Playwright `context.request` (shares cookie jar, no CORS)
  with `referer`. See `src/download.js`.
- Used by `captron posts` (rich listing w/ stats) and `captron download`.
  DOM scraping remains the fallback for drafts (item_list does not return them).
## Localization

TikTok Studio localizes both labels and endpoints. Captron matches on stable attributes (input names, radio values) and falls back to a table of common labels in EN/NL/ES/FR/DE/PT/ZH/JA/KO. The schedule radio is `input[name="postSchedule"][value="schedule"]`; the publish button is the button whose text is one of `Post/Plaatsen/Publicar/Publier/...`.