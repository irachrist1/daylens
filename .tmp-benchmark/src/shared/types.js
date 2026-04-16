"use strict";
// ---------------------------------------------------------------------------
// Shared types — imported by both main and renderer via path alias @shared/*
// ---------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.IPC = exports.FOCUSED_CATEGORIES = void 0;
exports.FOCUSED_CATEGORIES = [
    'development',
    'research',
    'writing',
    'aiTools',
    'design',
    'productivity',
];
// IPC channel names — single source of truth
exports.IPC = {
    DB: {
        GET_TODAY: 'db:get-today',
        GET_HISTORY: 'db:get-history',
        GET_HISTORY_DAY: 'db:get-history-day',
        GET_APP_SUMMARIES: 'db:get-app-summaries',
        GET_APP_SESSIONS: 'db:get-app-sessions',
        GET_WEBSITE_SUMMARIES: 'db:get-website-summaries',
        GET_PEAK_HOURS: 'db:get-peak-hours',
        GET_WEEKLY_SUMMARY: 'db:get-weekly-summary',
        GET_APP_CHARACTER: 'db:get-app-character',
    },
    DEBUG: {
        GET_INFO: 'debug:get-info',
    },
    FOCUS: {
        START: 'focus:start',
        STOP: 'focus:stop',
        GET_ACTIVE: 'focus:get-active',
        GET_RECENT: 'focus:get-recent',
        GET_BREAK_RECOMMENDATION: 'focus:get-break-recommendation',
        SAVE_REFLECTION: 'focus:save-reflection',
        GET_DISTRACTION_COUNT: 'focus:get-distraction-count',
    },
    AI: {
        SEND_MESSAGE: 'ai:send-message',
        GET_HISTORY: 'ai:get-history',
        CLEAR_HISTORY: 'ai:clear-history',
        GENERATE_BLOCK_INSIGHT: 'ai:generate-block-insight',
        SUGGEST_APP_CATEGORY: 'ai:suggest-app-category',
        DETECT_CLI_TOOLS: 'ai:detect-cli-tools',
        TEST_CLI_TOOL: 'ai:test-cli-tool',
    },
    SETTINGS: {
        GET: 'settings:get',
        SET: 'settings:set',
        HAS_API_KEY: 'settings:has-api-key',
        SET_API_KEY: 'settings:set-api-key',
        CLEAR_API_KEY: 'settings:clear-api-key',
    },
    TRACKING: {
        GET_LIVE: 'tracking:get-live',
        GET_PROCESS_METRICS: 'tracking:get-process-metrics',
    },
    SYNC: {
        GET_STATUS: 'sync:get-status',
        LINK: 'sync:link',
        CREATE_BROWSER_LINK: 'sync:create-browser-link',
        DISCONNECT: 'sync:disconnect',
        GET_MNEMONIC: 'sync:get-mnemonic',
    },
    SHELL: {
        OPEN_EXTERNAL: 'shell:open-external',
    },
};
