export type ReviewScreen = 'reskin' | 'sprite' | 'spine'

export interface ShortcutRow {
  keys: string[]
  id: string
}

export const SHORTCUTS: Record<ReviewScreen, ShortcutRow[]> = {
  reskin: [
    { keys: ['←', '→'], id: 'navItem' },
    { keys: ['A'], id: 'approve' },
    { keys: ['X'], id: 'reject' },
    { keys: ['R'], id: 'regenNote' },
    { keys: ['Ctrl', 'Enter'], id: 'ctrlEnter' },
    { keys: ['Space'], id: 'hold' },
    { keys: ['1', '2', '3'], id: 'modes' },
    { keys: ['C'], id: 'compare' },
    { keys: ['[', ']'], id: 'slider' },
    { keys: ['Enter'], id: 'exportNext' },
    { keys: ['Esc'], id: 'escItem' },
    { keys: ['?'], id: 'help' }
  ],
  sprite: [
    { keys: ['←', '→'], id: 'navStrip' },
    { keys: ['A'], id: 'approve' },
    { keys: ['X'], id: 'reject' },
    { keys: ['R'], id: 'regen' },
    { keys: ['Space'], id: 'play' },
    { keys: [',', '.'], id: 'frame' },
    { keys: ['1–9'], id: 'version' },
    { keys: ['C'], id: 'compare' },
    { keys: ['[', ']'], id: 'slider' },
    { keys: ['?'], id: 'help' }
  ],
  spine: [
    { keys: ['←', '→'], id: 'navRegion' },
    { keys: ['A'], id: 'approve' },
    { keys: ['X'], id: 'reject' },
    { keys: ['R'], id: 'regen' },
    { keys: ['1–9'], id: 'version' },
    { keys: ['C'], id: 'compare' },
    { keys: ['[', ']'], id: 'slider' },
    { keys: ['Esc'], id: 'esc' },
    { keys: ['?'], id: 'help' }
  ]
}
