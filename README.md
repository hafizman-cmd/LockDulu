# LockDulu

LockDulu is a mobile-first PWA for Malaysian bundle and vintage drops. Buyers reserve one-of-one garments, pay the seller by DuitNow QR, and submit a receipt for manual review.

## Local setup

Use Node.js 22.18 or newer. Copy `.env.example` to `.env` if needed and keep `.env` private.

- For local SQLite, set `TURSO_DATABASE_URL` to `file:./prisma/lockdulu.db` and leave `TURSO_AUTH_TOKEN` blank.
- For Turso, use a dedicated development database and set `TURSO_DATABASE_URL` to its `libsql://` URL and `TURSO_AUTH_TOKEN` to a token with write access. Retrieve them with `turso db show <database> --url` and `turso db tokens create <database>`.
- Set a unique `SEED_SELLER_PASSWORD` of at least 12 characters and a random `SESSION_SECRET` of at least 32 characters.

```sh
npm ci
npm run db:migrate
npm run db:seed
npm run dev
```

Open `http://localhost:3000/kedaibundle.kl` for the seeded shop, `/dashboard` to sign in as `kedaibundle.kl`, or `/locker` for My orders. To try checkout with the sample QR in local development, set `LOCKDULU_TEST_PAYMENTS=1`. The sample QR has no payment destination.

Use [AGENTS.md](AGENTS.md) for the code map and validation commands, and [docs/operations.md](docs/operations.md) for production setup, checkout, and shop administration.
