"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeEnhancedFocusScore = computeEnhancedFocusScore;
exports.computeFocusScore = computeFocusScore;
exports.isCategoryFocused = isCategoryFocused;
const types_1 = require("@shared/types");
function isHourInPeakWindow(hour, peakWindow) {
    if (peakWindow.peakStart === peakWindow.peakEnd)
        return true;
    if (peakWindow.peakStart < peakWindow.peakEnd) {
        return hour >= peakWindow.peakStart && hour < peakWindow.peakEnd;
    }
    return hour >= peakWindow.peakStart || hour < peakWindow.peakEnd;
}
function computeEnhancedFocusScore(params) {
    const effectiveFocusedSeconds = params.focusedSeconds + (params.websiteFocusCreditSeconds ?? 0);
    if (params.totalSeconds < 60)
        return 0;
    const focusRatio = effectiveFocusedSeconds / params.totalSeconds;
    const focusedSessions = params.sessions.filter((session) => session.isFocused);
    const avgSessionMin = focusedSessions.length > 0
        ? focusedSessions.reduce((sum, session) => sum + session.durationSeconds, 0) / focusedSessions.length / 60
        : 0;
    const consistencyBonus = Math.min(avgSessionMin / 30, 1) * 10;
    const hasFlowState = focusedSessions.some((session) => session.durationSeconds >= 75 * 60);
    const flowBonus = hasFlowState ? 5 : 0;
    const peakBonus = params.peakHours !== undefined && params.currentHour !== undefined &&
        isHourInPeakWindow(params.currentHour, params.peakHours)
        ? 5
        : 0;
    // Raw switch frequency is descriptive telemetry, not direct evidence that focus was broken.
    const raw = (focusRatio * 100) + consistencyBonus + flowBonus + peakBonus;
    return Math.min(Math.round(raw), 100);
}
function computeFocusScore(params) {
    return computeEnhancedFocusScore({
        ...params,
        sessions: params.sessions ?? [],
    });
}
function isCategoryFocused(category) {
    return types_1.FOCUSED_CATEGORIES.includes(category);
}
