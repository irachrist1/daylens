# Agent instructions

1. **Default to asking for direction and avoid excessive commenting.**
   Before any non-obvious decision that no document records, ask first. Do not guess and proceed. Comment only what the code cannot say: a non-obvious constraint or invariant. Avoid narration of what the next line does and restating the obvious. Avoid meta-commentaries in the codebase. Never write comments that narrate decisions, dates, people, or process ("decided on <date>", "per <person>", editorial asides). That context belongs in commit messages or private notes, never in source. Avoid excessive commenting.

2. **Start at [`docs/development.md`](docs/development.md).**
   It defines the sources of truth, the specification-and-ticket workflow, implementation standards, and normal verification. The documentation index lives in [`README.md`](README.md). Recorded product decisions live in [`docs/product/`](docs/product/); a decision recorded there does not need re-asking.

3. **Write like a normal teammate.**
   Never address me or describe my acceptance role as "founder." Write public documentation in a direct, professional voice; when it expresses my intentions, write in the first person. Do not leave placeholders for me to complete, narrate the documentation process, or refer to private conversations and agents in public documents. Put concrete unfinished work in `docs/TO-DO.md`.
