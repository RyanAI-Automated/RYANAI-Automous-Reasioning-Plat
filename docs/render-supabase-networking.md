# Render API to Supabase database network access

This note covers the network allowlist for the RyanAI API service connecting to
the project's Supabase PostgreSQL database and session pooler.

## Service and project

- Render service: `ryanai-api` (`srv-dbk4giu7bikc7394a4r0`)
- Render region: Oregon
- Supabase project: `narsvpwymvlrhurqbthu`
- Supabase region: `eu-west-1`
- Database endpoint: use the exact Session Pooler hostname and credentials from
  Supabase Dashboard → Connect. The current reviewed code proposal uses
  `aws-1-eu-west-1.pooler.supabase.com:5432`; it is not enabled by this document.

## Render outbound CIDRs

The two IPv4 outbound CIDRs supplied for the **Render `ryanai-api` service in Oregon** are:

```text
74.220.48.0/24
74.220.56.0/24
```

These are the API service's **outbound source ranges**. Render assigns regional
outbound ranges to services; they are used when the API connects to external
IP-restricted destinations. They do not need to be configured as inbound rules
on the Render service and must not be placed in `DATABASE_URL`.

Render documents the service-specific location as Dashboard → `ryanai-api` →
Connect → Outbound:
https://render.com/docs/outbound-ip-addresses

## Supabase network restriction steps

1. Open the Supabase project identified above.
2. Open Database Settings → Network Restrictions.
3. Check the currently applied IPv4 and IPv6 entries before editing.
4. Append the two verified Render IPv4 CIDRs above to the existing IPv4
   allowlist. Do not replace existing entries or remove existing administrator
   and operational access ranges.
5. Save/apply the change, then retry a database connection from the API only
   during an explicitly approved deployment or diagnostic window.

Supabase applies database network restrictions to PostgreSQL and its pooler.
The CIDR allowlist is an additional network gate; it does not replace database
authentication, URL-encoded password handling, or TLS. Supabase documents that
the CIDRs supplied in an update replace the existing list unless append mode is
used:
https://supabase.com/docs/guides/platform/network-restrictions

If a direct database hostname resolves to IPv6 and the project does not have
the IPv4 add-on or the documented IPv6 migration, the corresponding IPv6
ranges must also be accounted for. Do not guess IPv6 ranges.

## Safety

- Do not broaden the allowlist to `0.0.0.0/0` as a troubleshooting shortcut.
- Do not paste the database password into GitHub, chat, SQL snippets, or this
  document.
- Do not change database credentials or apply a schema migration as part of an
  IP allowlist update.
- Recheck the Render Outbound tab after a service-region or outbound-routing
  change.
- Shared regional ranges are not exclusive to the RyanAI workspace. For an
  exclusive, fixed source IP, Render's dedicated outbound IP feature requires
  a paid Pro-or-higher workspace and an additional monthly fee; no upgrade is
  recommended or requested here.
