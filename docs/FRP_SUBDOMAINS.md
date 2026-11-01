# FRP join domains

Each server has an optional Join name, separate from its display name and game startup variables. With gateway domain `njimgang.org`, entering `friends` requests `play.friends.njimgang.org`. The join address includes the selected FRP route's public port. An unset or empty field creates no DNS record.

An administrator configures managed DNS under Proxy gateways / Server join domains:

1. Save an enabled global Cloudflare integration with the zone ID and a zone-scoped DNS-edit token. Zone Read is needed to validate the selected domain.
2. Choose the integration and enter `njimgang.org` as the domain. Saving checks zone membership without creating a DNS record.
3. Set a Join name on an individual server dashboard. Names use letters, numbers and hyphens and are unique by full hostname.

The panel creates individual DNS-only A, AAAA or CNAME records pointing to the FRP gateway. No wildcard is needed. Remove any previously configured wildcard separately if unset names must not resolve; the panel does not delete unrelated operator records. Generic game clients still need the public port. SRV records are not included.

Clearing the field persists removal intent before calling Cloudflare. Renaming retires the previous record. Server deletion, including force deletion, waits for managed DNS cleanup to be confirmed. If Cloudflare is unavailable, deletion reports the failure and keeps the server and cleanup intent for retry.

A background reconciler retries every 30 seconds and processes bounded batches. It also retires records whose server or primary FRP route disappeared, or whose configured gateway domain changed. DNS removal can take longer during provider failures or DNS caching. Server downtime or suspension alone does not remove a chosen name.

Jobs live in the existing settings table independently of server foreign keys. They keep encrypted credential snapshots and an ownership comment for recovery after interrupted requests. Reconciliation only mutates records with that job's ownership comment at the exact hostname. A successful create with a lost response is recovered by listing the owned record, avoiding duplicate creation. Unrelated records are never overwritten or deleted. Names awaiting cleanup remain reserved. Rotating an integration token within the same zone refreshes pending jobs; removing or changing the integration's zone retains the old encrypted snapshot for cleanup.

Reading requires allocation.read; editing and retrying require allocation.update. Gateway DNS configuration is admin-only. Public responses do not expose credential snapshots or ownership markers. Changes are audited. No schema migration is required.

Verification in this checkout: focused Go tests cover name/target validation, DNS matching, provider creation, updates, unknown create outcomes, cleanup failures, idempotent retries and preservation of unrelated records. PostgreSQL reservation/deletion tests require TEST_DATABASE_URL and skip when absent. TypeScript checking passes. Live provider operations, server deletion and external game connections still need configured credentials and a deployed panel.
