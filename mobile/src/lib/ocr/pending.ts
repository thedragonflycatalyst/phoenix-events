// Hands a flyer from the live scanner to the Add screen without reading it twice.
import type { PosterGuess } from './parse';

export type Scan = { uri: string; guess: PosterGuess };
let pending: Scan | null = null;
export const setPendingScan = (s: Scan | null) => { pending = s; };
export const takePendingScan = () => { const s = pending; pending = null; return s; };

/** True when the flyer has enough to be an event: a name and a date. */
export const looksLikeEvent = (g: PosterGuess) => !!g.start && g.title.replace(/[^A-Za-z]/g, '').length >= 3;
