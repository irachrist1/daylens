# Daylens Benchmark

Read this before building or changing anything in the insights, AI workspace, tracking, export, or timeline pipeline.

This document defines the benchmark the product is actually judged against.

## The Only Benchmark That Matters

Daylens succeeds only if a user can ask a real work question at any point from the Insights page or the AI Workspace page, and the system can answer it accurately from recorded evidence.

Example:

`How many hours have I spent on ASYV?`

To answer that correctly, Daylens must be able to:

1. Resolve `ASYV` as a real work entity, such as a client.
2. Find all activity that may relate to that client across the timeline.
3. Include native app work, not just website summaries.
4. Attribute Outlook time only when the actual email, thread, title, or message context shows it was about ASYV.
5. Attribute Excel time only when the workbook, title, or surrounding evidence shows it was about ASYV.
6. Attribute browser time only when the page title, URL, or context shows it was about ASYV.
7. Combine those sources into one cumulative, defensible answer.
8. Explain that answer from evidence, not from vague summarization.

## What Does Not Count

Daylens does not pass the benchmark if it only gives generic summaries like:

- "You spent five minutes on YouTube."
- "You were mostly browsing."
- "Here is what you did today."

That may be mildly useful, but it is not the product goal.

## The Product Goal

The real target is that a user can ask complex business questions like:

`Analyze the last 30 days and export the clientele list and how much time I spent on each one.`

A correct system should be able to:

- identify clients and work entities across apps, files, emails, websites, page titles, and window titles
- calculate time per client accurately enough to trust
- support useful follow-up questions that stay grounded in evidence
- export the result into something usable like Udo timesheets
- do this reliably enough that the end user believes the answer

## What Every Agent Must Check Before Building

Before implementing anything in this area, check whether the change moves the product closer to or farther from this benchmark.

Ask:

1. Does this help Daylens answer client-level questions from evidence?
2. Does this preserve or improve attribution across Outlook, Excel, browser tabs, and native window titles?
3. Does this improve export-grade time accounting?
4. Does this create concrete, useful follow-up questions, or just generic prompts?
5. Does this help the user get a trustworthy answer, or does it only make the UI look smarter?

If the change improves presentation but does not improve answer correctness, attribution, exportability, or evidence quality, it is not solving the core problem.

## Standard For Success

The only real standard is:

`Does it work?`

Not:

- how advanced the stack is
- how clever the prompt is
- how polished the UI is
- how much effort went into the implementation

If Daylens cannot accurately answer client-level time questions and produce useful exportable outputs, it has not met the benchmark.
