import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import dictionary from 'dictionary-en'

interface NSpell {
  correct: (word: string) => boolean
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const nspell = require('nspell') as (dict: { aff: Buffer; dic: Buffer }) => NSpell

let checker: NSpell | null = null

function getChecker(): NSpell {
  if (!checker) {
    checker = nspell({
      aff: Buffer.from(dictionary.aff),
      dic: Buffer.from(dictionary.dic),
    })
  }
  return checker
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { words: string[] }
    const spell = getChecker()
    const misspelled = body.words.filter(w => {
      if (!w || w.length < 3) return false
      if (/\d/.test(w)) return false
      if (w === w.toUpperCase()) return false
      return !spell.correct(w)
    })
    return NextResponse.json({ misspelled })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
