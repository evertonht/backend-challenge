Type: grilling
Status: resolved
Blocked by: 02

## Question

Which concurrency strategy keeps wallet updates correct across ≥3 instances and hot wallets? `README.md` §8 fixes the concurrency unit at `walletId` and forbids read→calculate→update without control, in-memory idempotency (§5.2), and global locks (§5.6).

Weigh pessimistic `SELECT … FOR UPDATE` per wallet vs optimistic locking (version) vs atomic conditional `UPDATE` (and combinations). The resolution must justify the choice and describe the exact transaction shape — lock ordering, retry/backoff on contention, and how it satisfies §8's mandatory 2×80-bet scenario (initial 100.00, two 80.00 bets in parallel → exactly one PROCESSED, one REJECTED, balance 20.00, one debit entry).

## Answer

**Pessimistic locking per wallet — `SELECT … FOR UPDATE` as the first statement of the transaction** (option a; confirmed by the user, 2026-10-30).

- **Mechanism**: inside `em.transactional()`, lock the wallet row with `LockMode.PESSIMISTIC_WRITE` *before* reading the balance, so read→validate→apply is a held critical section (§5.7 satisfied).
- **Atomicity**: the whole §11 unit — balance change + ledger entry + `WagerTransaction` status + inbox/outbox — commits under the held lock; nothing is published before commit (§5.4).
- **Mandatory scenario (§8)**: two 80-bet transactions serialize on the row; the first takes 100→20 and commits, the second reads 20 and rejects for insufficient balance. Exactly one `DEBIT` entry, no duplicate on retry.
- **Per-row, not global (§5.6)**: different wallets process fully in parallel; only same-wallet operations serialize — which is the required ordering.
- **Design rules**: lock first, keep the transaction short, no external calls inside it (SQS publish goes through the outbox), and size the connection pool so transactions waiting on a row lock cannot exhaust it.
- **`version`** is still maintained (increments on balance change, §6.2) for audit and as a future optimistic fallback, but it is not the correctness mechanism.
