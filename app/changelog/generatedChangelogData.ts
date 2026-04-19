export const generatedChangelogData = {
  generatedAt: "2026-04-19T00:00:00.000Z",
  surfaces: [
    {
      id: "mac",
      name: "macOS app",
      description:
        "The most polished desktop path today, with install and AI-surface work landed but still awaiting final human validation in key flows.",
      releases: [
        {
          id: "mac-1.0.26",
          version: "1.0.26",
          date: "2026-04-19",
          title: "Install polish, durable AI state, and recap foundations landed",
          intro: [
            "The macOS build is where the latest launch-gate work is most visible today.",
            "Menu-bar polish, onboarding refinement, persistent AI threads, artifact storage, and the new deterministic recap surface are now in the product.",
            "Those code paths are real, but several of them still need packaged-app and human validation before they should be described as fully shipped and proven.",
          ],
          sections: [
            {
              label: "What landed",
              items: [
                "Persistent AI threads and artifact storage inside the AI surface.",
                "A deterministic daily, weekly, and monthly recap card in the AI surface.",
                "macOS menu-bar, DMG, onboarding, and install-flow polish across the shell.",
              ],
            },
            {
              label: "Pending verification",
              items: [
                "The full install, permission, relaunch, and menu-bar feel still needs a real human pass.",
                "Provider-backed AI flows, streaming, exports, and recap usefulness are not yet proven end to end from a packaged app.",
                "Updater behavior still needs confirmation against a real signed and notarized release.",
              ],
            },
          ],
          linkUrl: "https://github.com/irachrist1/daylens-windows/blob/main/docs/ISSUES.md",
          linkLabel: "View validation notes",
        },
      ],
    },
    {
      id: "windows",
      name: "Windows app",
      description:
        "Part of the unified desktop product today, but still waiting on honest real-machine runtime proof.",
      releases: [
        {
          id: "windows-1.0.26",
          version: "1.0.26",
          date: "2026-04-19",
          title: "Unified product work is in place, with runtime proof still pending",
          intro: [
            "Windows now benefits from the same shared desktop source of truth as macOS and Linux.",
            "That means the product shape, timeline model, AI surface, and packaging workflow all move together in one repo.",
            "What the public site should not imply yet is that the latest Windows build has been fully validated on a real Windows machine.",
          ],
          sections: [
            {
              label: "What is true today",
              items: [
                "Windows shares the unified desktop source of truth and current launch-gate work.",
                "Packaging and release workflow surfaces can be audited from the shared repo.",
                "Shared AI, timeline, settings, and report/export work is implemented in the product codebase.",
              ],
            },
            {
              label: "Still pending",
              items: [
                "Real-machine Windows install, runtime, and validation passes.",
                "Provider-backed packaged AI flows exercised honestly on Windows.",
                "Final proof that the latest shared launch work feels correct in the native Windows environment.",
              ],
            },
          ],
          linkUrl: "https://github.com/irachrist1/daylens-windows/blob/main/docs/ISSUES.md",
          linkLabel: "View platform status",
        },
      ],
    },
    {
      id: "linux",
      name: "Linux",
      description:
        "A real part of Daylens, with shared product work and packaging in place, but not yet fully validated on real Linux machines.",
      releases: [
        {
          id: "linux-1.0.26",
          version: "1.0.26",
          date: "2026-04-19",
          title: "Linux stays in scope while validation catches up",
          intro: [
            "Linux is no longer a side idea or placeholder in the public story.",
            "The unified desktop repo now carries Linux-focused tracking fallbacks, diagnostics, and packaging targets alongside the rest of the product.",
            "The honest caveat is that X11 and Wayland runtime validation still need real-machine coverage before Linux should be marketed like a fully proven install path.",
          ],
          sections: [
            {
              label: "What landed",
              items: [
                "Linux remains part of the unified Daylens product and release story.",
                "Focused-window parity work, diagnostics surfaces, and packaging targets exist in the shared repo.",
                "Public guidance now routes Linux visitors through status rather than overconfident direct-install copy.",
              ],
            },
            {
              label: "Pending verification",
              items: [
                "Real-machine validation on both X11 and Wayland sessions.",
                "Confidence in install and runtime behavior beyond CI packaging success.",
                "End-to-end provider-backed AI proof in actual Linux environments.",
              ],
            },
          ],
          linkUrl: "https://github.com/irachrist1/daylens-windows/blob/main/docs/ISSUES.md",
          linkLabel: "View Linux validation notes",
        },
      ],
    },
    {
      id: "web",
      name: "Website",
      description:
        "The public web layer now follows the unified desktop truth instead of synthetic status filler.",
      releases: [
        {
          id: "web-0.2.3",
          version: "0.2.3",
          date: "2026-04-19",
          title: "Public status copy rewritten around the real product state",
          intro: [
            "The website now describes Daylens the way the desktop product actually exists today.",
            "That means less launch theater, fewer synthetic release notes, and a harder line between shipped work, implemented work that still needs proof, and future direction.",
            "Linux, recap, menu-bar polish, and provider-backed AI flows are now described with the same truthfulness as the canonical desktop docs.",
          ],
          sections: [
            {
              label: "What changed",
              items: [
                "Removed synthetic changelog filler and replaced it with curated product-status notes.",
                "Separated roadmap items into shipped, implemented pending verification, active work, and future ideas.",
                "Aligned landing and docs copy with the unified desktop source of truth.",
              ],
            },
            {
              label: "Claims removed",
              items: [
                "No more implying Linux is a polished finished install path.",
                "No more treating recap work as fully shipped and proven.",
                "No more presenting roadmap direction as current product reality.",
              ],
            },
          ],
          linkUrl: "https://github.com/irachrist1/daylens-windows/blob/main/docs/AGENTS.md",
          linkLabel: "View product contract",
        },
      ],
    },
  ],
} as const;
