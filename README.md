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

The seed preserves existing orders, inventory changes, and settings when rerun. The seller password comes from `SEED_SELLER_PASSWORD` when the seed first creates the account. Update `Seller.whatsappNumber` in the database for the live seller. Sellers can create live or scheduled drops from dashboard Settings. The app opens a due drop on the next catalog fetch or lock attempt.

## Checkout and fulfillment

- Turso arbitrates locks with a conditional write. Expired holds release during reads or when another buyer tries to lock the item. Receipt submission clears the timer and claims the garment within the same transaction as the order status change.
- The server calculates the exact total from a quote captured at reservation time. Ship Now includes the quoted shipping fee. Hold Box charges the garment amount and lets the buyer request dispatch, with the seller arranging combined shipping.
- Rejecting a receipt releases its garment and retains the rejected order. The app keeps the unique garment-to-order link only for a current reservation or a completed sale.
- The Hold Box uses the checkout phone number plus a private browser token. Buyers should open it in the browser used to place the order. Keep that browser data until the parcel ships.
- When a Vercel Blob store is connected, uploads go to the private store. The app serves garment and QR images through its media route and serves encrypted receipts only through the authenticated seller receipt route. Local development without Blob credentials saves files in `public/uploads/`. Uploads are limited to 4 MB per image.

## Production

Run `npm run typecheck`, `npm run build`, and `npm start`. The service worker registers in the production build. Use HTTPS for installation and seller sessions. Set `APP_ORIGIN` to the public HTTPS origin when proxying the app. For Vercel, connect a private Blob store to the project and ensure `BLOB_STORE_ID` is available in the deployment environment. The Blob SDK uses Vercel's OIDC credentials automatically. A `BLOB_READ_WRITE_TOKEN` also works for local development or older store connections. Existing files in `public/uploads/` need to be transferred to the Blob store before using them on Vercel. Keep the receipt encryption secret with your backups. Rotating it requires preserving a way to decrypt existing receipts.

The offline shell explains how to reconnect. Availability and payments require a network connection so the app can check live inventory and order state.

## Seller accounts

New sellers can create a shop from `/dashboard` using their shop name, handle, WhatsApp number and a password of at least 12 characters. After signing in, they must upload their DuitNow QR and fill in the account and bank details in Settings before buyers can reserve items.

Each seller can edit their shop name and description and choose a storefront image in dashboard Settings. Shops without a custom image use the default jacket. The same shop image appears across its drops. Drops belong to the shop that created them. The seeded “The Weekend Edit” is an example for Kedai Bundle KL, and other shops can create their own drops in Settings.

Sellers are prompted to save their credentials in a password manager before creating a shop. The app has no self-service password reset.

## Admin dashboard

Set `ADMIN_PASSWORD` to a unique password of 12 to 256 characters in your private `.env` for local development. In Vercel, add `ADMIN_PASSWORD` under Project Settings → Environment Variables, paste the password directly as the value without surrounding quotation marks, and redeploy. Keep `ADMIN_PASSWORD` blank in `.env.example`. Admin sign-in also uses the existing `SESSION_SECRET`.

Restart the local server and open `/admin/dashboard`. Sign in to see platform totals and manage shops. Admin sessions expire after eight hours. Changing `ADMIN_PASSWORD` invalidates existing admin sessions once the new setting takes effect.

Confirmed orders count payments that sellers have verified. Pending receipts appear under **Payments awaiting review**. A lock expires after ten minutes if no receipt is submitted. Once a receipt is submitted, the storefront shows **Awaiting payment approval** until the seller approves it and the garment shows as **Sold out**, or rejects it and the garment becomes available again.

Run `npm run db:migrate` on the target database before deploying shop moderation. In **Manage shops**, use **Hold** to hide a storefront and its listings and make the seller dashboard read-only. **Resume** restores access. **Delete** permanently removes the storefront from the app and disables seller sign-in. The database keeps the shop's order history and reserves its handle. Hold and Delete are both blocked while any buyer garment lock is active.
