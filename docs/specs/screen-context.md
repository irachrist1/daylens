# Screen-context experiment

**Status:** Ready for review.

This specification defines the opt-in experiment that tests whether sampled screen content helps Daylens understand activity that application metadata, browser context, and connectors cannot explain.

Screen context is not a default V2 feature. It ships only if the experiment demonstrates a meaningful improvement without weakening privacy, trust, battery life, or application performance.

## Product behavior

The experiment is offered separately from normal tracking. Consent explains that Daylens will briefly store sampled images locally, extract useful details, and delete each image only after the extraction is safely stored.

A persistent indicator shows when screen sampling is active. A person can pause it immediately, inspect the backlog, change exclusions, or delete every raw and derived screen-context record.

Daylens never records continuous video or meeting audio.

## Eligibility and consent

- The experiment is available only to explicit testers on macOS and Windows.
- Core tracking must already be working before screen permission is requested.
- Screen permission is requested only from the experiment setup, not during normal onboarding.
- Consent is separate from model access, sync, browser history, and connector consent.
- Enabling normal tracking never enables screen sampling.
- Revoking permission closes the experiment, deletes unprocessed frames, and leaves core tracking usable.

## Capture policy

Daylens samples only the active display and foreground context.

A frame may be captured:

- after the foreground application or window subject remains stable for at least two seconds
- after a meaningful context change that metadata cannot already explain
- at a bounded 60-second interval while the same context remains active
- when a tester explicitly requests a diagnostic sample

The experiment captures no more than one automatic frame every 30 seconds and no more than 120 frames per hour. The sampling scheduler backs off when the device is on battery, under CPU pressure, locked, idle, asleep, or running a full-screen media or presentation surface.

Sampling stops before capture when:

- tracking or screen context is paused
- the application or website is excluded
- a private browser window is active or its privacy state is unknown
- a password, authentication, payment, keychain, permission, or operating-system security surface is detected
- screen sharing or protected media prevents safe capture
- the raw backlog reaches its storage or failure limit

## Processing lifecycle

Every frame has one durable lifecycle state:

```text
captured → extracting → indexed → safe_to_delete → deleted
                    ↘ failed → quarantined → extracting
```

1. Store the frame encrypted in the local application-data directory.
2. Write a database record containing its opaque identifier, capture time, owning application, exclusion-policy version, local path, byte size, and lifecycle state.
3. Run local OCR and approved local visual extraction.
4. Normalize the result into high-sensitivity evidence linked to the foreground interval.
5. Atomically commit extracted details, provenance, and search-index work.
6. Mark the frame `safe_to_delete` only after that transaction succeeds.
7. Delete the raw file and mark the record `deleted`.

The target raw-image lifetime is under 24 hours. Successful extraction triggers deletion immediately; 24 hours is a maximum safety window, not a normal retention period.

## Extraction result

The derived record may contain:

- visible document or page title
- short OCR spans needed for retrieval
- application and window identity
- likely subject, project, client, person, or meeting references
- local bounding information needed to explain provenance
- extraction model and schema versions
- confidence and sensitivity
- a one-way frame digest for deduplication

The derived record does not contain a reconstructed image, thumbnail, full-screen transcript, or hidden accessibility content.

Screen-derived claims remain distinguishable from foreground, browser, connector, and explicitly supplied evidence. A model may interpret the extracted details, but it cannot treat them as proof of an outcome the screen did not show.

## Failure quarantine

- Extraction retries with bounded backoff up to five times within 24 hours.
- A failed frame remains encrypted and inaccessible to product surfaces.
- Quarantined frames never enter search, embeddings, model context, sync, export summaries, or PostHog.
- The backlog is capped at 100 frames or 250 MB, whichever comes first.
- Reaching the cap pauses new screen sampling and notifies the tester.
- A frame still failing after 24 hours remains quarantined until the tester chooses Retry or Delete.
- Daylens never silently deletes the only copy before extraction succeeds.
- Deleting a failed frame is explicit and records that no derived evidence survived.

## Privacy and deletion

- Raw frames never leave the device.
- Derived screen evidence is local-only during the experiment.
- Normal cloud sync, MCP, exports, and managed AI exclude it unless a later accepted specification explicitly changes that boundary.
- Application and website exclusions apply to raw files, extracted records, indexes, and cached model context.
- Adding an exclusion offers explicit deletion of prior screen-derived evidence for that source.
- Deleting a frame, source, period, or entire history removes the raw file, extraction record, search entry, embedding, derived entity links, and generated summaries that depend on it.
- Crash recovery scans for orphan files and either restores their database lifecycle record or deletes them if no valid record exists.

## PostHog measurement contract

Allowed experiment events include:

- consent enabled, paused, resumed, revoked
- capture attempted, blocked, succeeded, or failed
- extraction succeeded, failed, retried, or quarantined
- processing latency and resource buckets
- raw byte-size and backlog-count buckets
- whether derived evidence added a new retrievable fact
- whether the person corrected or deleted the interpretation
- whether an accepted evaluation answer improved with screen context enabled

No event may include an image, OCR text, title, URL, domain, application name, filename, person, project, client, evidence identifier, or exact activity timestamp.

## Evaluation

The experiment uses paired evaluations. Each target question is answered once from normal evidence and once with screen-derived evidence. Testers review which answer is more accurate, more specific, or unchanged.

The target set includes:

- untitled native documents
- work inside applications whose window titles are generic
- visual research where the useful detail is inside the page
- design and spreadsheet work
- false-context risks such as notifications, background windows, and shared screens
- excluded, private, password, payment, and permission surfaces

The experiment may ship as an opt-in feature only when:

- privacy adversarial tests produce zero captured excluded or protected surfaces
- target-question pass rate improves by at least 20% relative to metadata and connectors alone
- at least half of retained derived records add a useful detail not already present elsewhere
- correction and deletion rates do not indicate systematic misinterpretation
- median extraction completes within 15 seconds and the 95th percentile within 60 seconds
- raw storage remains inside the documented cap
- median CPU overhead remains below 5% during extraction and an eight-hour battery test shows less than 3% additional drain
- no raw or derived content appears in PostHog, logs, crash reports, or sync payloads

Failing these criteria ends the experiment without turning it into a shipped feature.

## Acceptance criteria

- Consent, capture status, pause, exclusions, backlog, Retry, and Delete are visible and testable.
- Raw deletion occurs only after an atomic derived-evidence commit or an explicit user deletion.
- Restart, crash, permission loss, disk-full, and extraction-failure paths preserve the lifecycle invariant.
- The frame scheduler respects every rate, power, idle, and privacy boundary.
- macOS and Windows pass real-machine tests with multiple displays.
- An experiment report can be produced entirely from aggregate measurements and reviewed labels without exposing captured content.

## Implementation starting point

The first ticket should build the lifecycle state machine and a fake-frame test adapter. It should prove atomic extraction and deletion, quarantine, backlog limits, and privacy gates before calling any operating-system screen API.
