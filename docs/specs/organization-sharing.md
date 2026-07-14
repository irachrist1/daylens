# Organizational sharing

**Status:** Deferred. This work begins only after the individual desktop and web milestones succeed. The draft is kept so the privacy boundaries it commits to stay visible, but it is not in the V2 review queue and no implementation ticket derives from it.

This specification defines the first organizational capability introduced only after the individual desktop and web products succeed.

The first organizational value is reviewed project, client, time, and status summaries. It is not passive access to a person’s Timeline and is not employee monitoring.

## First customer and job

The first organizational customer is a small project-based team, consultancy, or agency whose members currently reconstruct client time and status from memory, calendars, messages, and disconnected tools.

The paid job is to reduce that manual reconstruction while keeping each person in control of what becomes organizational information.

Enterprises, workforce analytics, capacity planning, and administrative policy controls follow only after this reviewed-summary workflow proves valuable and trusted.

## Product behavior

A person can prepare a summary for a selected organization, project, client, and period. Daylens drafts it from personal organized memory, but nothing is shared until the person reviews and approves the exact content.

The organization receives a fixed approved version. Later personal corrections do not silently rewrite a previously shared report; the person can publish a new revision or revoke the old one.

## Share workflow

```text
choose scope → generate private draft → review and edit → preview recipient view
→ approve → publish encrypted package → revoke or publish revision
```

The draft remains private personal data until approval.

## Share package

An approved package may contain:

- organization, project, and client identity
- covered date range and timezone
- reviewed total time
- reviewed activity categories or work areas
- concise status narrative
- completed, active, or blocked items the person explicitly approved
- selected meetings or deliverables
- optional links already intended for the organization
- author, approval time, revision, and expiration

It does not contain:

- raw application or website activity
- personal Timeline blocks
- page titles, browser history, private links, filenames, or local paths
- screenshots or screen-derived text
- message bodies, AI threads, prompts, or answers
- excluded, deleted, or uncertain evidence
- personal and entertainment activity
- productivity, focus, distraction, ranking, or comparison scores
- hidden evidence references that an organization can expand

The person may edit the draft freely before approval. Edited wording is the shared record; Daylens does not expose what the private draft originally contained.

## Time and status rules

- Shared time comes from canonical corrected facts filtered to the approved project or client.
- The preview shows which private blocks contribute to each total, but recipients receive only the approved aggregate.
- Ambiguous attribution is excluded until the person confirms it.
- One interval cannot be double-counted inside the same share package.
- Status claims require an approved connected record, supplied statement, or explicit edit.
- Daylens never converts observed application activity into “completed” without supporting evidence.

## Organization and roles

The initial roles are:

- **Member:** creates, reviews, publishes, revises, and revokes their own packages.
- **Recipient:** views packages shared with the organization.
- **Organization administrator:** manages membership, billing, retention policy for shared packages, and access revocation.

An administrator cannot access private drafts, personal memory, raw evidence, personal AI threads, or unshared summaries.

Removing a member stops new access and follows the package retention policy already shown to that member. It does not trigger collection from their device.

## Recipient experience

The organizational web view supports:

- packages by project, client, period, and author
- approved total time and status
- revision history
- expiration and revocation state
- export of the approved package
- questions answered only from the organization’s shared packages and organization-owned sources

It does not provide live presence, screenshots, application rankings, hidden activity, or a manager view of unshared personal data.

## Encryption and transport

- The member’s client creates a minimized share package from organized facts.
- The exact recipient preview is approved before encryption and upload.
- The package is encrypted for the organization workspace.
- Server routing metadata includes organization, package identity, author identity, revision, state, and timestamps but no summary plaintext.
- Revocation publishes a tombstone and removes recipient access.
- Exports are generated from the approved package, not personal source evidence.

Organization-owned connected sources use separate credentials and permission scopes from personal connectors.

## AI behavior

AI may draft and answer questions about shared packages, but:

- private personal memory is never retrieved for an organizational question
- the organization agent receives only approved packages and organization-owned sources
- citations point to approved package sections or organization-owned records
- a missing answer cannot trigger silent access to a member’s desktop memory
- model context is inspectable by the person or organization according to the source owner

## Revisions, revocation, and deletion

- Publishing creates an immutable numbered revision.
- A new revision requires a new recipient preview and approval.
- Revocation removes normal recipient access immediately and records the event.
- Expiration removes access at the stated time.
- Deleting a personal source does not falsify a previously approved immutable package; the person is offered revoke or publish-correction actions.
- Deleting an account revokes active packages unless an explicit legal or contractual retention policy accepted at sharing time applies.
- Organization deletion removes packages, workspace keys, memberships, and organization-owned connector data subject to financial and legal retention.

## Notifications and audit

The member is notified when:

- a package is published, revised, revoked, or expires
- organization membership or retention policy changes
- an administrator exports an approved package

The audit log records package identity, actor, action, revision, and time. It does not store private draft content or raw evidence.

## Failure behavior

- Generation failure leaves the private draft editable and shares nothing.
- Approval and publish are atomic from the person’s perspective.
- Encryption or upload failure publishes nothing and retains the private draft locally.
- Revocation retries until acknowledged and visibly shows pending state.
- Membership loss blocks new publication without deleting personal drafts.
- A recipient with an expired or revoked key cannot decrypt newly downloaded packages.
- Organization AI failure leaves approved packages readable.
- Billing failure pauses new organizational publication according to the plan but never exposes or destroys personal memory.

## Acceptance criteria

- No organization can discover a member’s raw evidence, personal Timeline, AI threads, or private drafts.
- Every package matches the approved recipient preview byte-for-byte after decryption.
- Shared totals derive from canonical corrected facts and contain no double counting.
- Ambiguous, personal, entertainment, excluded, deleted, and uncertain activity is absent unless explicitly edited into the summary by the person.
- Publish, revision, export, expiration, revocation, membership removal, and organization deletion have end-to-end tests.
- Administrator permissions cannot bypass member approval.
- Organization AI uses only approved packages and organization-owned sources.
- Audit and analytics contain no private draft or source content.
- The running workflow is accepted by individual contributors and organization recipients before broader dashboards are considered.

## Implementation starting point

The first ticket should define a local `SharePackage` schema and generate a recipient-preview fixture from accepted organized facts. No server upload begins until tests prove the schema cannot contain raw evidence or personal-only fields.
