export type Word = {
  /** The text shown. */
  t: string
  /** How many beats it stays. */
  mult: number
  /** Starts a sentence. */
  isSentence: boolean
  /** Starts a paragraph. */
  isPara: boolean
}

export type Reader = {
  words: Word[]
  pos: number
  isPlaying: boolean
  wpm: number
}

declare module 'claude-code' {
  interface PluginState {
    rsvp: { reader: Reader }
  }
}
