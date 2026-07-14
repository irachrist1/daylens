# Security Policy

Daylens is a local-first desktop application. Your activity data stays on your
machine in a local SQLite database, and AI provider API keys are stored in the
operating system keychain (via keytar), never in the repository or in plain
files. We take the security of that data seriously.

## Supported versions

Security fixes are released against the latest published version. Please update
to the most recent release before reporting an issue.

| Version                | Supported |
| ---------------------- | --------- |
| Latest release (1.0.x) | Yes       |
| Older releases         | No        |

## Reporting a vulnerability

Please do not open a public issue for security vulnerabilities.

Report privately through GitHub's built-in flow:

1. Go to the repository's **Security** tab.
2. Choose **Report a vulnerability** to open a private security advisory.
3. Include a description, reproduction steps, affected version, and impact.

If you cannot use the GitHub flow, email the maintainer at
**ctonny111@gmail.com** with the same details.

## What to expect

- An acknowledgement within a few days.
- An initial assessment of severity and scope.
- Coordinated disclosure once a fix is available. We will credit you in the
  release notes unless you prefer to remain anonymous.

## Scope

In scope:

- The Daylens desktop application (main process, renderer, preload).
- The local data model and how activity data is captured, stored, and exported.
- Handling of AI provider credentials and outbound requests.

Out of scope:

- Vulnerabilities in third-party AI providers themselves.
- Issues that require a compromised local OS account, which already has full
  access to the local database.
