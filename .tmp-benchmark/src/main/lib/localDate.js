"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.localDateString = localDateString;
exports.localDayBounds = localDayBounds;
exports.daysFromTodayLocalDateString = daysFromTodayLocalDateString;
function localDateString(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}
function localDayBounds(dateStr) {
    const [year, month, day] = dateStr.split('-').map(Number);
    const from = new Date(year, month - 1, day).getTime();
    return [from, from + 86_400_000];
}
function daysFromTodayLocalDateString(offsetDays) {
    const today = new Date();
    return localDateString(new Date(today.getFullYear(), today.getMonth(), today.getDate() + offsetDays));
}
