# LockDulu operations

See the [README](../README.md) for local setup and the [coding guide](../AGENTS.md) for validation.

## Database and production

- `npm run db:migrate` applies and records SQL migrations on the database selected by `TURSO_DATABASE_URL`. Existing PostgreSQL records require a separate transfer to the Turso schema. The seed preserves existing orders, inventory changes, and settings. It uses `SEED_SELLER_PASSWORD` when it first creates the sample seller.
- Apply migrations to the target database before deploying schema-dependent code. Run `npm run typecheck`, `npm run build`, and `npm start`. Use HTTPS for seller sessions and PWA installation. The service worker registers in production and caches an offline shell. Availability and payments require a network connection.
- Set `APP_ORIGIN` to the public HTTPS origin behind a proxy. On Vercel, connect a private Blob store and make `BLOB_STORE_ID` available. The SDK uses Vercel OIDC credentials. `BLOB_READ_WRITE_TOKEN` also works for local development and older connections. Transfer existing `public/uploads/` assets to Blob before using them on Vercel.
- Local development without Blob uses `public/uploads/`. Garment and QR images are served through the media route. Receipts are encrypted and served through the authenticated seller receipt route. Keep `SESSION_SECRET` with your backups because receipt encryption derives its key from it. Preserve a way to decrypt existing receipts when rotating it. The browser upload limit is 4 MB.

## Checkout and fulfillment

- Each garment can be reserved by one buyer for ten minutes. A conditional database write arbitrates the lock. Reads or a new lock attempt can release expired holds. Receipt submission claims the garment and moves the order to review in the same transaction. Rejection releases the garment and preserves the order record.
- The server prepares the payable amount and delivery details from the reservation quote. Ship Now includes the quoted shipping fee, and approved orders enter the shipment queue. Older paid orders with unknown shipment dates can be reconciled separately. Hold Box charges the garment amount. Buyers select pieces from one shop for one delivery address and arrange combined shipping with the seller. Overdue pieces remain actionable.
- Copy the order reference and open **My orders** in the browser used at checkout. That browser holds a private access token. If a transfer arrives after the reservation expires or a receipt is rejected, keep the bank reference and use the order's transfer reporting or follow-up options as available. A seller-reported refund remains open until the buyer confirms the full amount arrived. Buyers can dispute a missing or partial refund and request admin help.

## Seller accounts and inventory

- Register from `/dashboard` with a shop name, handle, WhatsApp number, and a password of at least 12 characters. Save the password in a password manager. Self-service password reset is unavailable.
- Before sharing a live shop, add a real DuitNow QR and its account and bank details, and verify the WhatsApp number in **Settings → Shop profile**. Shops can edit their name, description, and storefront image. The default jacket is used when there is no shop image. Drops use their shop's image. Create live or scheduled drops in Settings. A due drop opens on a catalog fetch or lock attempt.
- **Inventory → Hide listing** prevents new reservations once any active lock ends. Buyers can still track submitted orders. Listings can be edited or deleted when eligible. Sold listings are soft-deleted so order history and fulfillment remain available. **History** shows receipt review, shipment events and merchandise revenue excluding shipping. Garment costs and expenses are outside that total.

## Admin dashboard

- Configure a unique `ADMIN_PASSWORD` of 12 to 256 characters in the local environment or in Vercel Project Settings → Environment Variables. Paste the value without surrounding quotation marks in Vercel and redeploy. Leave the example value blank. Sign-in also uses `SESSION_SECRET`. Admin sessions expire after eight hours. Changing the admin password invalidates existing sessions once the new setting takes effect.
- Open `/admin/dashboard` for platform totals, shop moderation, and buyer help requests. **Hold** hides the storefront and blocks new checkout while private order tracking, receipt review, and fulfillment stay available. **Resume** restores storefront access and catalog management.
- **Delete** removes storefront access and disables seller sign-in while preserving order history and reserving the handle. Hold and Delete are blocked during active buyer reservations. Deletion also requires resolving pending receipts, verified unshipped orders, and open transfer reports.
