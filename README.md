# rsvp: speed-read Claude's replies

`rsvp` is a mod for Claude Code. It shows Claude's last reply one word at a time, in one fixed position. This method is RSVP (rapid serial visual presentation). Your eyes do not move across the text, so you can read faster.

The pivot letter of each word is red. It is always in the same column, below a marker.

```
────────────────┬────────────────
              perfectly
────────────────┴────────────────
█████░░░░░░░░░░░░░░░░░░░░░░░░░░░░
9/83 · 350 wpm · ▶
p: ⏸ b: ◀ n: ▶▶ s: − f: + r: ⏮
```

## Install

At the prompt of a Claude Code terminal session, type:

```
/plugin install rsvp --marketplace CandleKeepAgents/claude-rsvp
```

Type `y` to add the marketplace. Then push Enter to select the user scope.

From a shell:

```
claude plugin install rsvp --marketplace CandleKeepAgents/claude-rsvp
```

In the desktop app, `/plugin` does not operate. Click **+** next to the prompt box, then **Plugins**. Add the marketplace `CandleKeepAgents/claude-rsvp`, then add the plugin.

Mods are an early-access feature of Claude Code. We tested this mod on Claude Code 2.1.302.

## Use

There are two ways to start the reader:

- Type `/rsvp`. The reader shows Claude's last reply, including the text between tool calls.
- Click **▶ speed-read** below a reply. The reader shows that reply.

The reader opens in a pane and starts to play.

| Key | Action |
|---|---|
| `p` | Play or pause |
| `b` | Go back one sentence |
| `n` | Go forward one sentence |
| `s` | Decrease the speed by 25 words per minute |
| `f` | Increase the speed by 25 words per minute |
| `r` | Go back to the start |
| `Esc` | Close the pane |

You can also click the buttons in the pane.

## Settings

| Command | Result |
|---|---|
| `/rsvp 400` | Sets the speed to 400 words per minute and starts the reader. The range is 150 to 900. The default is 350. |
| `/rsvp auto 150` | Opens the reader automatically after each reply of 150 words or more. |
| `/rsvp auto off` | Stops the automatic reader. This is the default. |

The mod keeps your settings for all sessions.

## How it works

- The mod removes Markdown marks. A code block shows as one word, `[code]`.
- A word stays on screen for one beat (60,000 ms ÷ words per minute). A long word stays 30% longer. A comma adds 50%. The end of a sentence makes the time 2.5 times longer. The end of a paragraph makes it 3 times longer.
- The mod divides a word of more than 13 letters into parts.

## Develop

Run the mod from this folder:

```
claude --plugin-dir .
```

Validate it and run the tests:

```
claude plugin validate .
claude plugin test .
```

## License

MIT
