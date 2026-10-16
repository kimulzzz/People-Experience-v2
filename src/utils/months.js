// src/utils/months.js
// English month names for every month filter / label in the UI. The internal value of a month stays
// the zero-padded number ('01'..'12', sent to the API); only the display text comes from here.
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// '03' / 3 / '3' -> 'March' ('' when the value is not a month 1..12)
export const monthName = (m) => MONTH_NAMES[Number(m) - 1] || '';
export const monthShort = (m) => MONTH_SHORT[Number(m) - 1] || '';
