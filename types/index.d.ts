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

/** The reader of one reply, keyed by the message id of the reply's first block. */
export type Reader = {
  /** The reply's markdown, all of its text blocks. */
  source: string
  words: Word[]
  pos: number
  isPlaying: boolean
  /** Drawn under the reply; collapsed back to a button when false. */
  isOpen: boolean
  wpm: number
}

/** Where reading of one reply stopped. */
export type Mark = { pos: number; total: number; source: string }

declare module 'claude-code' {
  interface PluginState {
    rsvp: {
      readers: StateFamily<Reader>
      /** By reply id: read by every reply block to draw the stop mark. */
      marks: Record<string, Mark>
      /** The reply whose reader plays now, or ''. */
      active: string
    }
  }
}
