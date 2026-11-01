import { useColorScheme } from 'react-native';

// "Color returns at night": midnight plum / lilac-white grounds, one jewel tone per pillar.
const light = {
  bg: '#f4f1f7', surface: '#ffffff', raise: '#faf8fc', ink: '#1b1622', muted: '#6a6176', line: '#e3dce9', soft: '#eee8f3',
  night: '#120e17', focus: '#7357ee', danger: '#c42b20', good: '#1f9a5c', onAccent: '#ffffff',
  cat: { environmental: '#1f9a5c', community: '#d99412', wellness: '#ef5a26', mental: '#7357ee', arts: '#e23d8a', other: '#7c7489' },
};
const dark: typeof light = {
  bg: '#120e17', surface: '#1c1623', raise: '#251e2e', ink: '#f6f1f9', muted: '#aa9fb7', line: '#31293b', soft: '#231c2b',
  night: '#120e17', focus: '#a68dff', danger: '#ff8378', good: '#3fd98f', onAccent: '#120e17',
  cat: { environmental: '#3fd98f', community: '#ffc04a', wellness: '#ff7a4d', mental: '#a68dff', arts: '#ff63ad', other: '#a69cb2' },
};
export type Palette = typeof light;
export type Cat = keyof Palette['cat'];

export function usePalette(): Palette & { scheme: 'light' | 'dark' } {
  const s = useColorScheme() === 'dark' ? 'dark' : 'light';
  return { ...(s === 'dark' ? dark : light), scheme: s };
}

// Poster colors are the same in both modes so a flyer looks the same everywhere.
export const POSTER: Record<Cat, [string, string, string]> = {
  environmental: ['#5fd49a', '#1f8a52', '#0f3a26'],
  community: ['#ffd27a', '#d18a0c', '#4a2f06'],
  wellness: ['#ff9a72', '#e2501f', '#4a170a'],
  mental: ['#b9a6ff', '#6a4fe0', '#24174f'],
  arts: ['#ff8fc4', '#d63181', '#4a0f2c'],
  other: ['#c9c1d4', '#6f6680', '#26212d'],
};

export const F = {
  display: 'BricolageGrotesque_800ExtraBold',
  displayBold: 'BricolageGrotesque_700Bold',
  body: 'AtkinsonHyperlegible_400Regular',
  bodyBold: 'AtkinsonHyperlegible_700Bold',
};

export const R = { lg: 22, md: 16, sm: 11, pill: 999 };
