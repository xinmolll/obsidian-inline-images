export const IMAGE_MOVE_TYPE = 'application/x-obsidian-inline-images-move';

export function planImageMove(text: string, range: { from: number; to: number }, destination: number) {
  if (range.from < 0 || range.to > text.length || range.from >= range.to || destination < 0 || destination > text.length) return null;
  if (destination >= range.from && destination <= range.to) return null;
  const insertion = '\n\n' + text.slice(range.from, range.to) + '\n\n';
  const changes = [
    { from: range.from, to: range.to, insert: '' },
    { from: destination, to: destination, insert: insertion },
  ].sort((a, b) => a.from - b.from);
  const cursor = destination + insertion.length - (destination > range.to ? range.to - range.from : 0);
  return { changes, cursor };
}
