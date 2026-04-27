// Canvas metrics. Anything that needs to be a fixed pixel coordinate
// across multiple files lives here so layout maths stays in one place.

export const W = 1024;
export const H = 640;

export const WALL_BOTTOM = 232; // y where wall ends and floor begins

export const STATION_W = 140;
export const STATION_PLINTH_Y = 200;
export const STATION_PLINTH_H = 16;
// Approximate top y where each station's item starts. Individual stations
// differ by a few pixels (Monolith: 38, others ~38–50), but the active-
// pulse overlay sits at itemTop-6 so a single shared value is close
// enough — the pulse hugs the item baseline rather than the item itself.
export const STATION_ITEM_TOP = 38;

export const DESK_W = 152;
export const DESK_H = 72;

// Floor band — desks distribute within these x bounds.
export const FLOOR_LEFT = 80;
export const FLOOR_RIGHT = 944;
export const FLOOR_BAND_W = FLOOR_RIGHT - FLOOR_LEFT;

// Desk row y-coordinates.
export const BACK_ROW_Y = 270;
export const FRONT_ROW_Y = 480;

// Station band on the back wall — sits between the window (left bookend)
// and the plant shelf (right bookend).
export const STATION_BAND_LEFT = 176;
export const STATION_BAND_RIGHT = 824;
export const STATION_BAND_W = STATION_BAND_RIGHT - STATION_BAND_LEFT;

// Desks come in two rows; cap back row so 7-agent teams don't end up with
// a call-centre wall of identical desks.
export const MAX_BACK_ROW = 4;

// Character sprite size. Head sits centred over the desk top; legs hide
// behind the desk body so the figure reads as "at desk."
export const CHAR_W = 24;
export const CHAR_H = 40;

// Floor y where a sprite stands when using a back-wall station. Below
// the plinth bottom (y=216), with the head in floor space — so the
// figure doesn't visually merge into the station's plinth.
export const STATION_ACCESS_Y = 286;
