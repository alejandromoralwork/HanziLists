/** Strip tone marks, tone numbers, spaces, apostrophes; ü → v. */
export const normPinyin = (s: string) =>
  s
    .normalize('NFD')
    .replace(/̈/g, 'v') // ü → u + diaeresis → uv; collapse below
    .replace(/[̀-ͯ]/g, '')
    .replace(/uv/g, 'v')
    .replace(/[0-9\s'’·\-]/g, '')
    .toLowerCase()

const normEn = (s: string) =>
  s
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/^\s*(to|a|an|the)\s+/, '')
    .replace(/[^a-z0-9' ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** EN→ZH: accept the hanzi itself, or its pinyin with or without tones (any one reading). */
export function checkChinese(input: string, hanzi: string, pinyin: string): boolean {
  const t = input.trim()
  if (!t) return false
  if (t.replace(/\s/g, '') === hanzi) return true
  const n = normPinyin(t)
  return pinyin.split(/[,;/]/).some((p) => normPinyin(p) === n)
}

/** ZH→EN: accept any gloss segment (split on ; , /) ignoring "to", articles and parentheses. */
export function checkEnglish(input: string, english: string): boolean {
  const n = normEn(input)
  if (!n) return false
  return english.split(/[;,/]/).map(normEn).filter(Boolean).some((g) => g === n)
}
