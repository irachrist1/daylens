"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const queries_1 = require("../src/main/db/queries");
const schema_1 = require("../src/main/db/schema");
const insightsQueryRouter_1 = require("../src/main/lib/insightsQueryRouter");
const ANCHOR_DATE = new Date('2026-04-06T15:30:00');
function timestamp(time) {
    return new Date(`2026-04-06T${time}:00`).getTime();
}
function insertSession(db, params) {
    const startTime = timestamp(params.start);
    const endTime = timestamp(params.end);
    const session = {
        bundleId: params.bundleId,
        appName: params.appName,
        windowTitle: params.title,
        startTime,
        endTime,
        durationSeconds: Math.round((endTime - startTime) / 1000),
        category: params.category,
        isFocused: params.category === 'development' || params.category === 'research' || params.category === 'writing',
    };
    (0, queries_1.insertAppSession)(db, session);
}
function seedBenchmarkData(db) {
    db.exec(schema_1.SCHEMA_SQL);
    insertSession(db, {
        bundleId: 'Code.exe',
        appName: 'Visual Studio Code',
        title: 'ASYV onboarding export - Visual Studio Code',
        category: 'development',
        start: '09:00',
        end: '09:50',
    });
    insertSession(db, {
        bundleId: 'OUTLOOK.EXE',
        appName: 'Microsoft Outlook',
        title: 'ASYV kickoff notes - Outlook',
        category: 'email',
        start: '09:50',
        end: '10:05',
    });
    insertSession(db, {
        bundleId: 'EXCEL.EXE',
        appName: 'Microsoft Excel',
        title: 'ASYV budget model.xlsx - Excel',
        category: 'productivity',
        start: '10:05',
        end: '10:35',
    });
    insertSession(db, {
        bundleId: 'WindowsTerminal.exe',
        appName: 'Windows Terminal',
        title: 'pnpm test --filter asyv-export',
        category: 'development',
        start: '10:35',
        end: '10:50',
    });
    insertSession(db, {
        bundleId: 'chrome.exe',
        appName: 'Google Chrome',
        title: 'ASYV dashboard localhost - Google Chrome',
        category: 'browsing',
        start: '10:50',
        end: '11:10',
    });
    insertSession(db, {
        bundleId: 'chrome.exe',
        appName: 'Google Chrome',
        title: 'Reddit - Google Chrome',
        category: 'entertainment',
        start: '13:00',
        end: '13:30',
    });
    insertSession(db, {
        bundleId: 'Code.exe',
        appName: 'Visual Studio Code',
        title: 'Internal tooling cleanup - Visual Studio Code',
        category: 'development',
        start: '14:00',
        end: '14:40',
    });
    (0, queries_1.insertWebsiteVisit)(db, {
        domain: 'asyv.example.com',
        pageTitle: 'ASYV dashboard',
        url: 'https://asyv.example.com/dashboard',
        visitTime: timestamp('10:52'),
        visitTimeUs: BigInt(timestamp('10:52')) * 1000n,
        durationSec: 8 * 60,
        browserBundleId: 'chrome.exe',
        source: 'history',
    });
    (0, queries_1.insertWebsiteVisit)(db, {
        domain: 'localhost:3000',
        pageTitle: 'ASYV export preview',
        url: 'http://localhost:3000/asyv-export',
        visitTime: timestamp('11:00'),
        visitTimeUs: BigInt(timestamp('11:00')) * 1000n,
        durationSec: 10 * 60,
        browserBundleId: 'chrome.exe',
        source: 'history',
    });
    (0, queries_1.insertWebsiteVisit)(db, {
        domain: 'reddit.com',
        pageTitle: 'r/programming',
        url: 'https://reddit.com/r/programming',
        visitTime: timestamp('13:05'),
        visitTimeUs: BigInt(timestamp('13:05')) * 1000n,
        durationSec: 15 * 60,
        browserBundleId: 'chrome.exe',
        source: 'history',
    });
}
async function ask(db, question, previousContext) {
    const result = await (0, insightsQueryRouter_1.routeInsightsQuestion)(question, ANCHOR_DATE, previousContext, db);
    strict_1.default.ok(result, `Expected a routed answer for: ${question}`);
    return { answer: result.answer, resolvedContext: result.resolvedContext };
}
async function main() {
    const db = new better_sqlite3_1.default(':memory:');
    seedBenchmarkData(db);
    const checks = [
        {
            name: 'Client-level cumulative attribution',
            question: 'How many hours have I spent on ASYV today?',
            assertResult: (answer) => {
                strict_1.default.match(answer, /2h 10m/i);
                strict_1.default.match(answer, /outlook|excel|localhost|terminal|vs code/i);
            },
        },
        {
            name: 'Title evidence enumeration',
            question: 'Which ASYV titles matched today?',
            assertResult: (answer) => {
                strict_1.default.match(answer, /ASYV kickoff notes/i);
                strict_1.default.match(answer, /ASYV budget model\.xlsx/i);
                strict_1.default.match(answer, /ASYV dashboard/i);
            },
        },
        {
            name: 'App breakdown follow-up',
            question: 'Break ASYV down by app today.',
            assertResult: (answer) => {
                strict_1.default.match(answer, /ASYV by app/i);
                strict_1.default.match(answer, /Visual Studio Code|VS Code/i);
                strict_1.default.match(answer, /Outlook/i);
                strict_1.default.match(answer, /Excel/i);
                strict_1.default.match(answer, /Chrome/i);
            },
        },
        {
            name: 'Scoped native-app attribution',
            question: 'How much ASYV time was in Outlook today?',
            assertResult: (answer) => {
                strict_1.default.match(answer, /15m/i);
                strict_1.default.match(answer, /ASYV/i);
            },
        },
        {
            name: 'Exact time lookup for workspace chat follow-up',
            question: 'What was I doing today at 10:58 am?',
            assertResult: (answer) => {
                strict_1.default.match(answer, /10:58/i);
                strict_1.default.match(answer, /asyv\.example\.com|localhost:3000|google chrome/i);
            },
        },
    ];
    let previousContext = null;
    for (const check of checks) {
        const { answer, resolvedContext } = await ask(db, check.question, previousContext);
        check.assertResult(answer);
        previousContext = resolvedContext;
        console.log(`PASS ${check.name}`);
        console.log(answer);
        console.log('');
    }
    console.log(`PASS ${checks.length} AI workspace benchmark checks`);
}
void main().catch((error) => {
    console.error('FAIL benchmark run');
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
});
