# Cloudflare Access login

Voltra can use an existing Cloudflare Tunnel and Access application. Configure Google as the only identity provider and maintain the email allowlist in Cloudflare. Voltra does not need the Google client secret, a Cloudflare API token, or a second copy of that allowlist.

## Panel configuration

Cloudflare login is disabled by default. Set both values on the panel process to enable it:

```dotenv
PUBLIC_URL=https://dashboard.example.com
CLOUDFLARE_ACCESS_TEAM_DOMAIN=your-team.cloudflareaccess.com
CLOUDFLARE_ACCESS_AUDIENCE=the-64-character-application-AUD-tag
```

The team domain and AUD are public configuration identifiers. In Zero Trust, configure the Access application, open Additional settings, and copy Application Audience (AUD) Tag. Do not use an API token as the audience. Incomplete or invalid configuration prevents panel startup.

Complete the panel's administrator setup locally first. Its saved public address must be the HTTPS hostname, with Public access and Existing HTTPS proxy selected. `PUBLIC_URL` does not override an already saved setup address. Keep the panel bound to loopback when `cloudflared` runs on the same computer, or restrict the origin so the tunnel is its only public ingress.

Enabling these variables does not modify DNS, Access policies, the tunnel, Google OAuth, Wings, node connectors, or game services. Replacing another panel's tunnel destination is a separate deployment action. Test the replacement before switching the existing hostname.

## What login does

For public browser API requests, Voltra verifies `Cf-Access-Jwt-Assertion` using the configured team's public signing keys. It requires RS256, the exact issuer and application audience, a valid expiration/not-before/issued-at time, an application token, a nonempty subject, and the IdP-verified email. Email-only headers, service tokens and organization tokens cannot sign users in. Signing keys are cached and refreshed for rotation; verification fails closed if the necessary key is unavailable.

An approved first login creates a normal, non-administrator account with no password. Concurrent first requests create only one account. Existing non-admin accounts are linked by case-insensitive verified email when the match is unambiguous and no different Access identity is bound. Existing ownership, subuser permissions, names, nickname, and credentials stay intact. Disabled accounts remain blocked. Later logins use the issuer/subject binding rather than trusting an email header.

Voltra verifies Access on each public browser API request instead of issuing a password session that could bypass Access. An existing password-session cookie alone is not sufficient on the public hostname. Direct local recovery requires both a loopback connection and a localhost/loopback Host; it retains the ordinary panel password login. Never expose that recovery path through a tunnel Host override.

### Existing administrator accounts

Existing administrator accounts are not linked automatically. To approve linking a specific existing administrator's verified email, optionally set:

```dotenv
CLOUDFLARE_ACCESS_LINK_ADMIN_EMAILS=existing-admin@example.com
```

This only permits binding to an already existing admin account with that email. It never creates or promotes an administrator. Once bound, the account retains its existing role. Alternatively, sign into the panel locally and grant the intended account access through the existing admin tools. Keep a working local administrator password for recovery.

## Desktop and machine connections

Existing desktop device tokens, scoped API keys, node/daemon authentication and the single-use desktop pairing exchange keep their existing paths. They are evaluated before browser Access identity, and an invalid bearer credential cannot fall back to Access. Cloudflare's edge policy must permit the applicable machine paths to reach the panel's own authentication; this code does not change those policies or provide a shared service token.

Browser console WebSockets and APIs must be reachable through the tunnel. Test desktop pairing, API calls and node connectivity against the intended hostname before switching the old panel. Access login in an ordinary browser does not automatically authenticate a desktop client's native HTTP requests at Cloudflare's edge.

Cloudflare users sign out through `/cdn-cgi/access/logout`; local password users retain ordinary panel logout. User provisioning and linking are recorded in panel activity logs without storing JWTs.

## Verification before cutover

Test a whitelisted Google identity, a denied identity, a new ordinary account, an existing account, a disabled account, and the intended administrator. Confirm spoofed email headers, expired tokens, wrong audience/issuer and direct public access without Access cannot authenticate. Check sign-out, API-key scopes, desktop pairing, node traffic and console sockets. Keep the previous tunnel destination and local admin recovery available until the real login and permissions have been verified.

Cloudflare references: [JWT verification](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/), [application identity claims](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/).
