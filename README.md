# Group Expense Splitting MVP

This workspace contains a browser-based Coachella expense tracker with a shared backend, plus the underlying domain module.

## What it supports

- Use a single shared `Coachella` group
- Add and remove members
- Shared server-backed state for everyone who opens the same deployed app URL
- Preserve historical transactions when a member becomes inactive
- Create, edit, and delete transactions
- Split a transaction evenly across:
  - all active group members
  - selected members only
- Store all money as integer cents
- Distribute rounding cents deterministically so shares always sum to the full amount
- Compute per-group net balances
- Generate simplified settlement suggestions that match debtors to creditors

## Files

- `src/expense-groups.js`: domain logic and stateful in-memory service
- `index.html`: browser entry point for the Coachella app
- `web/app.js`: browser UI and API client
- `web/styles.css`: app styling
- `server.js`: static server plus JSON API and file-backed storage
- `Dockerfile`: containerized deployment option
- `test/expense-groups.test.js`: runnable regression tests

## Run locally

```bash
npm start
```

Then open:

```text
http://localhost:3000
```

Server data is written to:

```text
./data/state.json
```

You can override that path with the `DATA_FILE` environment variable.

## Deploy publicly

This app is designed to deploy as a plain Node web service. It does not require a build step.

Recommended option: Railway

1. Create a new Railway service from this folder or repo.
2. Set the start command to `npm start` if Railway does not detect it automatically.
3. Attach a persistent volume and mount it at `/app/data`.
4. Deploy and use the generated Railway URL.

Alternative option: Render

1. Create a Node web service.
2. Build command: `npm install`
3. Start command: `npm start`
4. Attach a persistent disk and mount it at `/opt/render/project/src/data`
5. Deploy and use the generated Render URL.

## Run tests

```bash
npm test
```

## Example

```js
const { GroupExpenseService } = require("./src/expense-groups");

const service = new GroupExpenseService();

service.createGroup({ id: "trip", name: "Trip" });
service.addMember("trip", { id: "alice", name: "Alice" });
service.addMember("trip", { id: "bob", name: "Bob" });

const snapshot = service.createTransaction("trip", {
  id: "txn-1",
  description: "Hotel",
  totalAmountCents: 12000,
  payerMemberId: "alice",
  transactionDate: "2026-04-16",
  split: { type: "EVEN_ALL_ACTIVE_MEMBERS" }
});

console.log(snapshot.balancesByMemberId);
console.log(snapshot.settlementSuggestions);
```
