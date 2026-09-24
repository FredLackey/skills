# Fixed Easy Reader preset

These settings are carried forward from the established Easy Reader research.
They are the preset, not sample values or adjustable recommendations. There is
no monitor-size or model requirement.

| Setting | Fixed choice |
|---|---|
| Font | JetBrains Mono NL Nerd Font |
| Weight | Medium (500), with normal bold emphasis |
| Theme | Dracula, standard variant |
| Size | 18 points in native terminals; 18 pixels in VS Code |
| Ligatures | Off; NL font variant, plus explicit suppression where supplied |
| Terminal line spacing | 1.0/default |
| Editor line height | 1.5 in VS Code |
| Letter spacing | Default: 1.0 horizontal multiplier or 0 added pixels |
| Cursor | Filled block, steady; guide off and boost 0 in iTerm2 |
| Padding | 0 in Ghostty; preserve each supplied application's profile |
| Contrast | iTerm2 0.2; Ghostty 1.1; VS Code 7 |
| iTerm2 thin strokes | 2 (Retina-only option) |
| macOS smoothing | `CGFontRenderingFontSmoothingDisabled = NO` |
| Titlebar | iTerm2 Minimal; Ghostty transparent; Terminal dark appearance; VS Code custom |

The contrast values use different application scales; do not convert one into
another. A VS Code minimum ratio of 7 is a rendering setting, not a guarantee
that every element of every application meets an accessibility standard.
The smoothing script sets the documented preference used by the research;
its rendering effect is OS-dependent and does not promise subpixel rendering.

## Exact configuration files

- [iterm-profile.json](iterm-profile.json): complete original dynamic profile,
  including both font names, colors, cursor, spacing, and scrollback settings.
- [ghostty.conf](ghostty.conf): complete original Ghostty include, including
  shell cursor integration, padding, color space, and macOS titlebar.
- [macos-terminal-profile.json](macos-terminal-profile.json): complete original
  Terminal.app profile, font and archived color inputs. Swift generates the
  native `.terminal` file from this data.
- [vscode-settings.json](vscode-settings.json): complete original VS Code
  settings payload, including editor, terminal, theme, custom titlebar,
  scrollback, GPU mode, and Option-as-Meta.
- [vscode-extensions.txt](vscode-extensions.txt): the original extension list.

The numeric size is intentionally retained across applications despite their
different units. Font-family and PostScript names intentionally differ between
applications. Theme palettes also retain the original application-specific
values; do not normalize them to a different Dracula palette.

- [preset.env](preset.env): fixed installation packages and titlebar modes.
