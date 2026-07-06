# DARA — Supabase Auth email templates

Branded HTML for every Supabase Auth email (navy `#1B2A4A` / gold `#B8952A`, table-based for
broad email-client support). These are the **source of truth**; Supabase's hosted dashboard does
**not** read this folder, so each one must be **pasted into the dashboard by hand** to take effect.

## How to apply

Supabase Dashboard → **Authentication → Email Templates** → pick the template → paste the file's
contents into the HTML body → **Save**. Re-paste whenever a file here changes.

> `supabase/config.toml` only affects the local dev stack, not production. Pasting into the hosted
> dashboard is what matters for prod.

## Authentication templates

| Dashboard template | File | Link flow | Key variables |
|---|---|---|---|
| Invite user | `invite.html` | `/auth/confirm?...&type=invite` | `.TokenHash` `.Email` `.SiteURL` |
| Confirm sign up | `confirmation.html` | `/auth/confirm?...&type=signup` | `.TokenHash` `.Email` `.SiteURL` |
| Magic Link | `magic-link.html` | `/auth/confirm?...&type=magiclink` + `.Token` code | `.TokenHash` `.Token` `.Email` `.SiteURL` |
| Change Email Address | `email-change.html` | `/auth/confirm?...&type=email_change` | `.TokenHash` `.Email` `.NewEmail` `.SiteURL` |
| Reset Password | `recovery.html` | `/auth/confirm?...&type=recovery&next=/app/account/profile` + `.Token` code | `.TokenHash` `.Token` `.Email` `.SiteURL` |
| Reauthentication | `reauthentication.html` | **code only, no link** | `.Token` |

All link-based templates target our own **`/auth/confirm`** route (server-side `verifyOtp` on
`token_hash`) — the same flow that fixed invites. Do **not** revert them to `{{ .ConfirmationURL }}`,
which uses Supabase's implicit `#access_token` fragment flow that our routes can't read.

**Reset Password note:** the link carries `&next=/app/account/profile` so the user lands on the
account profile page after verifying, where the "Set password" panel lets them choose a new one.

## Security notification templates

Informational only — no action link required to complete anything. Each carries a "Review account
security" button to `/app/account/security`. Kept to `{{ .SiteURL }}` only for safe rendering across
Supabase's notification variable set.

| Dashboard template | File |
|---|---|
| Password changed | `security-password-changed.html` |
| Email address changed | `security-email-changed.html` |
| Phone number changed | `security-phone-changed.html` |
| Sign-in method linked | `security-identity-linked.html` |
| Sign-in method removed | `security-identity-removed.html` |
| MFA method added | `security-mfa-added.html` |
| MFA method removed | `security-mfa-removed.html` |

## Prerequisite for the links to work

Supabase **Auth → URL Configuration**: Site URL = `https://dara.crucibleinsight.com` (bare origin,
no path) and Redirect URLs include `https://dara.crucibleinsight.com/**`. `{{ .SiteURL }}` resolves
to Site URL, so a path there would break every `{{ .SiteURL }}/auth/confirm` link.
