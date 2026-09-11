// Fixed screen geometry. 100x40, never reflowed — main.js scales the whole
// grid to fit the viewport with a CSS transform instead of resizing it.
export const COLS = 100;
export const ROWS = 40;

export const LEFT_X = 1, LEFT_W = 25;
export const SEP1_X = 26;
export const MID_X = 27, MID_W = 45;
export const SEP2_X = 72;
export const RIGHT_X = 73, RIGHT_W = 26;

export const ROW_TOP = 0;
export const ROW_TITLE = 1;
export const ROW_HDR_SEP = 2;
export const BODY_Y = 3;
export const BODY_H = 30; // rows 3..32
export const ROW_FOOT_SEP = 33;
export const ROW_SEQ = 34;
export const ROW_SEQ_SEP = 35;
export const ROW_METER = 36;
export const ROW_METER_SEP = 37;
export const ROW_CMD = 38;
export const ROW_BOTTOM = 39;
