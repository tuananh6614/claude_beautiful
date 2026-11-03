<div align="center">

# Claude Beautiful

**A live sky behind Claude Code.**
Type `/troi` and the background becomes the real sky over Hanoi: real time, real weather.
Sun, storms, rainbows and moonlit nights, right behind your chat.

![Clawd types /troi and the sky washes in](media/demo.gif)

</div>

## What you get

- **A living WebGL sky** behind the chat at about 60 fps: clouds drift, rain falls, lightning flashes, a rainbow comes out after the rain, and the moon shows its real phase.
- **Real time, real weather.** The sun and the moon are placed for Hanoi; the weather comes from [Open-Meteo](https://open-meteo.com).
- **Glass UI.** Your questions and Claude's answers sit on frosted glass, so text stays readable on any sky. Tool and progress rows stay bare, so they read apart from the answers.
- **Light and dark follow the sky.** The app turns dark at night and light again in the morning.
- **A quota band** above the prompt: your plan, the 5-hour and 7-day limits with the time left, and how full the context is.
- **A soft chime** when a turn longer than 15 seconds finishes.

| Storm | Rainbow | Night |
|---|---|---|
| ![Storm](media/storm.jpg) | ![Rainbow](media/rainbow.jpg) | ![Night](media/night.jpg) |

## Install

For the Code tab of the Claude desktop app. You need the `claude` command (Claude Code CLI).

1. Add the marketplace and install the plugin:

   ```bash
   claude plugin marketplace add tuananh6614/claude_beautiful
   claude plugin install honu@claude_theme
   ```

2. Turn on DevTools once: **Help → Troubleshooting → Enable Developer Mode**.
3. In a Code session, type `/troi` and press Enter. The sky script is now in your clipboard.
4. Press **Ctrl+Alt+I** (or **Ctrl+Shift+I**; **Cmd+Option+I** on macOS), open the **Console** tab, press **Ctrl+V**, then **Enter**.
   The first time, the Console blocks pasting: type `allow pasting`, press Enter, then paste again.

The sky stays until the app reloads. After you restart the app, run `/troi` and paste again.

## Use

| Command | What it does |
|---|---|
| `/xem` | Watch a whole day and every kind of weather in about 2.5 minutes |
| `Alt+T` | Open the picker: change the background or turn it off |
| `/quota` | Show or hide the quota band; `/quota am` turns the chime on or off |
| `/quota goi <name>` | Put your plan's name on the band, up to 10 characters, such as `Pro`, `Max` or `Ultra`. Until you set it, the band says `Claude` |

## In the browser (experimental)

`honu/pixel-troi.user.js` is also a userscript for `https://claude.ai/*`. It should run under Tampermonkey or Violentmonkey, but it has not been fully tested on the web yet.

## Good to know

- The sky is always Hanoi's: its time zone and its weather, wherever you are.
- The only network request is the weather from Open-Meteo, made only while the sky is on screen. Settings stay in your browser's localStorage. Nothing is collected.
- Measured on one machine (RTX 5050 laptop): 59 fps, about 0.7 ms of GPU time per frame.
- Tested in the Windows desktop app. macOS should work but has not been tested.
- Fan-made. Not affiliated with Anthropic.

## Uninstall

```bash
claude plugin uninstall honu@claude_theme
```

Restart the app and the sky is gone.

## Credits

- Built on [Pixel Chat Themes](https://github.com/aqua2409z/pixel-chat-themes) by aqua2409z (MIT).
- Weather by [Open-Meteo](https://open-meteo.com).
- Clawd is Anthropic's mascot; the pixel Clawd in the demo is fan art.

## License

[MIT](LICENSE)

If you like it, a ⭐ helps other people find it.
