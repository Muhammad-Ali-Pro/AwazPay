export function formatPKR(amount: number): string {
  return `PKR ${amount.toLocaleString('en-US')}`
}

const ONES = [
  '', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen',
]
const TENS = [
  '', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety',
]

function threeDigitsToWords(n: number): string {
  const parts: string[] = []
  if (n >= 100) {
    parts.push(`${ONES[Math.floor(n / 100)]} hundred`)
    n %= 100
  }
  if (n >= 20) {
    parts.push(TENS[Math.floor(n / 10)])
    n %= 10
    if (n > 0) parts.push(ONES[n])
  } else if (n > 0) {
    parts.push(ONES[n])
  }
  return parts.join(' ')
}

/** Converts a non-negative integer to spoken English words, Pakistani lakh/crore-free (thousand-based). */
export function numberToWords(value: number): string {
  const n = Math.round(Math.abs(value))
  if (n === 0) return 'zero'

  const segments: [number, string][] = [
    [1_000_000, 'million'],
    [1_000, 'thousand'],
    [1, ''],
  ]

  let remainder = n
  const parts: string[] = []
  for (const [scale, label] of segments) {
    const chunk = Math.floor(remainder / scale)
    remainder %= scale
    if (chunk > 0) {
      parts.push(label ? `${threeDigitsToWords(chunk)} ${label}` : threeDigitsToWords(chunk))
    }
  }
  return parts.join(' ').trim()
}

export function amountToSpeech(amount: number): string {
  return `${numberToWords(amount)} Pakistani Rupees`
}
