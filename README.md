# BurnAlias

BurnAlias is a self-hosted alias management app for external email forwarding providers. It does not run an email server. Providers remain the source of truth for email routing.

## MVP stack

- Backend: Node.js + Express + TypeScript
- Frontend: React + Vite + TypeScript
- Database: SQLite
- Provider integration: abstract interface with a mock provider

## Development

```bash
corepack enable
yarn install
yarn auth:generate
```

`yarn auth:generate` is interactive. It waits for a hidden password and then asks you to confirm it before printing the Argon2id hash.

Set auth env vars in your shell before running the app:

```bash
$env:BURN_USER="admin"
$env:BURN_PASSWORD_HASH="<paste generated argon2id hash>"
$env:FORWARD_ADDRESSES="me@example.com,work@example.com"
yarn dev
```

- API: `http://localhost:3001`
- Web UI: `http://localhost:5173`
- Unauthenticated users only see the landing/login screen

Run the backend auth security tests with:

```bash
yarn test:server
```

## Environment

```bash
BURN_USER=admin
BURN_PASSWORD_HASH=$argon2id$v=19$...
BURN_SESSION_SECRET=optional-extra-secret
BURN_LOGIN_RATE_LIMIT_WINDOW_MS=900000
BURN_LOGIN_RATE_LIMIT_MAX_ATTEMPTS=5
PORT=3001
DATABASE_PATH=./burnalias.db
MOCK_PROVIDER_DOMAIN=burnalias.test
EXPIRATION_CHECK_INTERVAL_MS=60000
FORWARD_ADDRESSES=me@example.com,work@example.com
```

## Docker

```bash
docker build -t burnalias .
docker run --rm -it burnalias auth-generate
docker run -p 3001:3001 -e BURN_USER=admin -e BURN_PASSWORD_HASH='$argon2id$v=19$...' burnalias
```
