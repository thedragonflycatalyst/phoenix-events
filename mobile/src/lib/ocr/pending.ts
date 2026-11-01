// Hands a flyer from the live scanner to the Add screen without reading it twice.
import type { PosterGuess } from './parse';

export type Scan = { uri: string; guess: PosterGuess; alsoPhone?: boolean };
let pending: Scan | null = null;
export const setPendingScan = (s: Scan | null) => { pending = s; };
export const takePendingScan = () => { const s = pending; pending = null; return s; };

/** True when the flyer has enough to be an event: a name and a date. */
export const looksLikeEvent = (g: PosterGuess) => !!g.start && g.dateSure && g.title.replace(/[^A-Za-z]/g, '').length >= 3;

/** Same event in two reads in a row: name and start time agree. */
export const scanKey = (g: PosterGuess) => `${g.title.toLowerCase().replace(/[^a-z0-9]+/g, '')}|${g.start?.getTime() ?? ''}`;
