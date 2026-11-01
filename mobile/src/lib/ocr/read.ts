// Reads a flyer photo on the phone with Google ML Kit (free, offline) and turns it into event fields.
import { recognizeText } from '@infinitered/react-native-mlkit-text-recognition';
import { parsePoster, type PosterGuess } from './parse';

export async function readPoster(imageUri: string): Promise<PosterGuess> {
  const result = await recognizeText(imageUri);
  // ML Kit groups text into blocks of lines; keep lines in reading order with their on-image height
  const lines = result.blocks
    .flatMap((b) => b.lines)
    .map((l) => ({ text: l.text, height: Math.max(0, l.frame.bottom - l.frame.top), top: l.frame.top, left: l.frame.left, width: Math.max(0, l.frame.right - l.frame.left) }))
    .sort((a, b) => a.top - b.top);
  const text = lines.map((l) => l.text).join('\n') || result.text;
  return parsePoster(text, lines);
}

/** Shrinks a photo to a 1600px long edge JPEG: sharp enough to read, small enough to upload. */
export async function shrinkPhoto(uri: string, width?: number, height?: number): Promise<string> {
  const { manipulateAsync, SaveFormat } = await import('expo-image-manipulator');
  const w = width ?? 0, h = height ?? 0;
  const resize = w >= h ? { width: Math.min(1600, w || 1600) } : { height: Math.min(1600, h || 1600) };
  return (await manipulateAsync(uri, [{ resize }], { compress: 0.82, format: SaveFormat.JPEG })).uri;
}
