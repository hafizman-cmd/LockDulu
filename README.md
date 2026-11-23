# LockDulu

LockDulu is a mobile-first PWA for Malaysian bundle and vintage drops. Each listing represents one garment. Guests can reserve it for ten minutes, pay a seller’s static DuitNow QR, and submit a screenshot for manual review.

## First run

Use Node.js 22.18 or newer and a Turso database dedicated to LockDulu.

1. Fill in `TURSO_DATABASE_URL` with your database's `libsql://` URL and `TURSO_AUTH_TOKEN` with its database token. Use a token with write access. The Turso CLI can retrieve these with `turso db show <database> --url` and `turso db tokens create <database>`. If `.env` is missing, copy `.env.example` and also set a unique seed password of at least 12 characters and a random `SESSION_SECRET` of at least 32 characters. Keep `.env` private.
2. Run these commands from the project directory.

   ```sh
   npm ci
   npm run db:migrate
   npm run db:seed
   npm run dev
   ```

3. Open `http://localhost:3000/kedaibundle.kl` for the seeded storefront, `/dashboard` to sign in as `kedaibundle.kl`, or `/locker` to track guest orders. The seed contains eight garments and a sample QR with no payment destination. Replace the QR and set the seller’s WhatsApp number before sharing a live storefront.

The migration command applies and records SQL migrations on the database selected by `TURSO_DATABASE_URL`. For a local database, set `TURSO_DATABASE_URL="file:./prisma/lockdulu.db"` and leave the token blank. The Turso schema starts a fresh database. Existing PostgreSQL records require a separate data transfer.

The seed preserves existing orders, inventory changes, and settings when rerun. The seller password comes from `SEED_SELLER_PASSWORD` when the seed first creates the account. Update `Seller.whatsappNumber` in the database for the live seller. Create upcoming drops with a `scheduledAt` timestamp and `UPCOMING` status. The app opens a due drop on the next catalog fetch or lock attempt.

## Checkout and fulfillment

- Turso arbitrates locks with a conditional write. Expired holds release during reads or when another buyer tries to lock the item. Receipt submission clears the timer and claims the garment within the same transaction as the order status change.
- The server calculates the exact total from a quote captured at reservation time. Ship Now includes the quoted shipping fee. Hold Box charges the garment amount and lets the buyer request dispatch, with the seller arranging combined shipping.
- Rejecting a receipt releases its garment and retains the rejected order. The app keeps the unique garment-to-order link only for a current reservation or a completed sale.
- The Hold Box uses the checkout phone number plus a private browser token. Buyers should open it in the browser used to place the order. Keep that browser data until the parcel ships.
- Garment and QR uploads are saved under `public/uploads/`. Receipt files are encrypted on disk and returned through the authenticated seller receipt route. The storage adapter is in `lib/storage.ts`.

## Production

Run `npm run typecheck`, `npm run build`, and `npm start`. The service worker registers in the production build. Use HTTPS for installation and seller sessions. Set `APP_ORIGIN` to the public HTTPS origin when proxying the app, and use a persistent local upload volume or swap the storage adapter for shared object storage before scaling across instances. Keep the receipt encryption secret with your backups. Rotating it requires preserving a way to decrypt existing receipts.

The offline shell explains how to reconnect. Availability and payments require a network connection so the app can check live inventory and order state.
