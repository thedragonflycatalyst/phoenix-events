// Reads a flyer photo on the phone with Google ML Kit (free, offline) and turns it into event fields.
import { recognizeText } from '@infinitered/react-native-mlkit-text-recognition';
import { parsePoster, type PosterGuess } from './parse';

export async function readPoster(imageUri: string): Promise<PosterGuess> {
  const result = await recognizeText(imageUri);
  // ML Kit groups text into blocks of lines; keep lines in reading order with their on-image height
  const lines = result.blocks
    .flatMap((b) => b.lines)
    .map((l) => ({ text: l.text, height: Math.max(0, l.frame.bottom - l.frame.top), top: l.frame.top }))
    .sort((a, b) => a.top - b.top);
  const text = lines.map((l) => l.text).join('\n') || result.text;
  return parsePoster(text, lines);
}
