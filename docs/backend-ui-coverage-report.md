# Backend vs UI Coverage Report (Strict)

Date: 2026-04-17
Scope: Auth, home/search, favorites, product details, chat, sell flow, my ads, public profile, report/block/rate, account settings.

## 1) Screen-by-screen matrix

| UI Flow / Screen | Backend Contract Needed | Status | Gap Type | Priority |
|---|---|---|---|---|
| Login / Register / OTP / Reset | OTP auth, token refresh/logout, password reset | Supported | None | P2 |
| Home + Search listing cards | `GET /search/products` with filters/sort, seller rate, image data | Supported | None | P2 |
| Favorites list + heart toggle | persistent favorite relation + add/remove/list + card flag | Supported | Implemented | P0 |
| Product details | product detail + `is_favorite` for authed user | Supported | Implemented | P0 |
| Product details → chat start with ad context | create/get conversation with optional product context | Supported | Implemented | P0 |
| Chat list (all/buy/sell tabs) | conversation metadata + filter by buy/sell + unread count | Supported | Implemented | P0 |
| Chat thread | list/send/read messages with block enforcement | Supported | Implemented | P0 |
| User options (report/block/rate) | report, block/unblock, rating endpoints | Supported | Implemented | P0 |
| Public user profile | public profile summary + active user ads | Supported | Implemented | P0 |
| Sell form | product create/update fields including negotiable + preferred contact | Supported | Implemented | P0 |
| My Ads tabs (`active/sold/hidden`) | my-products with status filter (`available/sold/archived`) | Supported | Explicitly mapped | P0 |
| Account/profile edit + password + contacts | `/me` profile/password/contacts endpoints | Supported | None | P2 |
| Language preference | local client setting only | Supported by design | Out of backend scope | P2 |

## 2) Implemented gaps and API specs

### Favorites
- Data model: `user_favorites(user_id, product_id, created_at, PK(user_id, product_id))`.
- Endpoints:
  - `POST /favorites/:productId` → add favorite.
  - `DELETE /favorites/:productId` → remove favorite.
  - `GET /favorites?sortBy=price|created&sortDir=asc|desc&limit&offset` → paginated favorite listings.
- Product responses now include `is_favorite` for authenticated user contexts.

### Public User Profile
- Endpoint: `GET /users/:id?limit&offset` (optional auth).
- Response contains:
  - user summary: `id, name, member_since, ads_count, rate, avatar_url`.
  - relationship flags (if authenticated): `blocked_by_me`, `blocked_me`.
  - active listings array for the target user.
- Hard-hide behavior: if block exists in either direction, endpoint returns `404`.

### Chat Coverage Upgrades (per user pair)
- Conversation model keeps one thread per pair and now supports optional `product_id` context.
- Updated endpoints:
  - `POST /chat/conversations` accepts optional `productId`.
  - `GET /chat/conversations?scope=all|buy|sell` returns metadata:
    - peer user (`peer_user_id`, `peer_name`, `peer_avatar_url`)
    - last message preview/time
    - `unread_count`
    - optional product summary (`product_name`, `product_price`, `product_image_object_key`)
  - `GET /chat/conversations/:id` returns one metadata-rich conversation.
- Block enforcement is applied in conversation creation and message access actions.

### User Block (hard)
- Data model: `user_blocks(blocker_id, blocked_id, created_at, PK(blocker_id, blocked_id))`.
- Endpoints:
  - `POST /blocks/:userId`
  - `DELETE /blocks/:userId`
  - `GET /blocks`
- Enforcement:
  - blocked users cannot open conversations or exchange/read messages.
  - blocked users are hidden from interaction/profile and chat list surfaces.

### Sell Form Parity
- `products` now stores:
  - `is_negotiable BOOLEAN`
  - `preferred_contact_method TEXT CHECK IN ('phone','chat','both')`
- Create/update DTOs accept:
  - `isNegotiable?: boolean`
  - `preferredContactMethod?: 'phone'|'chat'|'both'`
- Product responses include:
  - `is_negotiable`
  - `preferred_contact_method`

### My Ads status mapping
- Existing status remains canonical: `available`, `sold`, `archived`.
- UI hidden tab maps to `archived` via `GET /my/products?status=archived`.

## 3) Database and migration notes
- New migration: `db/migrations/0010_favorites_blocks_chat_product_context.sql`
  - Adds `products.is_negotiable`, `products.preferred_contact_method`.
  - Adds `conversations.product_id`.
  - Adds `user_favorites` table.
  - Adds `user_blocks` table.
  - Rebuilds `product_listing_view` to include new product fields.
- `db/schema.sql` updated to match migration for clean installs.

## 4) Validation and tests
- Added/updated service coverage for new behavior:
  - `src/favorites/favorites.service.spec.ts`
  - `src/blocks/blocks.service.spec.ts`
  - `src/chat/chat.service.spec.ts` updated for new dependencies.
- Verification run:
  - `npm run build` ✅
  - `npm test` ✅
  - `npm run lint` ✅

## 5) Already-covered surfaces (unchanged)
- OTP registration/login/reset.
- Category retrieval.
- Product CRUD + status + search filters.
- Ratings + reports.
- File upload intent flow.
- Self profile/password/contacts.
- Language remains client-side only.
