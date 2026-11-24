# LockDulu coding guide

LockDulu is a Next.js App Router PWA for one-of-one vintage listings, with Prisma over Turso/libSQL and manual DuitNow receipt review.

## Find the code

- Buyer storefront, item and My orders routes live in `app/`. UI lives in `components/`. Trace browser mutations through `app/api/actions/route.ts` to `lib/inventory.ts` (checkout) or `lib/seller.ts` (seller and fulfillment). Shop moderation starts in `app/admin/dashboard/` and uses `lib/admin.ts`.
- Read `prisma/schema.prisma` before changing persisted state. Trace missing images through `lib/storage.ts` and the media route. Catalog data and image bytes are stored separately.
- In AgentsRoom, use `.agentsroom/memory/INDEX.md` to find the relevant note. For setup see [README.md](README.md). For product and deployment behavior see [docs/operations.md](docs/operations.md).
- Start broad searches in `app components lib prisma tests`. Skip `generated/`, `.next/`, `node_modules/`, `public/uploads/` and `.verification/` unless the task needs them. Treat `.agentsroom/` as runtime data and read its memory by explicit path.

## Validate

- Use Node.js 22.18+ and `npm ci` on a fresh checkout. Install and dev startup generate the Prisma client.
- Run `npm run typecheck` and `node --experimental-strip-types --test "tests/*.test.*"` as appropriate. The database tests use disposable SQLite files.
- For schema or seed work, point `TURSO_DATABASE_URL` at a disposable database before running `npm run db:migrate` or `npm run db:seed`. Restart dev after applying schema changes. Use `npm run build` for production and PWA changes.
