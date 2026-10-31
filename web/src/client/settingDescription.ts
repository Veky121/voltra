export function settingDescription(description: string | undefined): string {
  const text = (description || '').replace(/\s+/g, ' ').trim();
  const sentence = text.split(/(?<=[.!?])\s/)[0] || '';
  if (sentence.length <= 160) return sentence;
  const clause = sentence.split(/[;:]/)[0];
  if (clause.length <= 160) return clause + '.';
  return sentence.slice(0, 157).replace(/\s+\S*$/, '') + '?';
}
