# X Bot Cleaner

A Chrome extension to manually identify and bulk remove bot followers from your X (Twitter) account while preserving legitimate followers.

## Features

- **Manual Bot Detection**: Mark followers as "Real" or "Bot" with a single click
- **Persistent Storage**: Your classifications are saved locally and persist across sessions
- **Hide Bots**: Toggle visibility of bot-marked accounts to focus on real followers
- **Bulk Removal**: Remove all bot-marked followers with one click
- **Safe Operation**: Only removes accounts you've explicitly marked as bots
- **Rate Limit Protection**: Automatic delays between removals to avoid API restrictions
- **Real-time Metrics**: Track coverage, trusted followers, and flagged bots
- **Dynamic UI**: Automatically detects follower pages and injects control buttons
- **Cross-device Sync**: Uses Chrome's sync storage (when enabled) to sync classifications across devices

## How It Works

1. Navigate to your X/Twitter followers page (`https://x.com/[username]/followers`)
2. The extension automatically detects the followers page and injects "Real" and "Bot" buttons next to each follower
3. Click "Bot" on suspicious accounts (they'll be highlighted in red)
4. Click "Real" on legitimate followers (they'll be highlighted in green)
5. Use the control panel to:
   - View statistics (trusted followers, flagged bots, coverage percentage)
   - Hide/show bots in the follower list
   - Remove all marked bots at once with progress tracking

## Installation

### From Source

1. Clone this repository:
   ```bash
   git clone https://github.com/yourusername/x-bot-cleaner.git
   cd x-bot-cleaner
   ```

2. Install dependencies:
   ```bash
   # Using Bun (recommended)
   bun install
   
   # Or using npm
   npm install
   ```

3. Build the extension:
   ```bash
   bun build
   # or
   npm run build
   ```

4. Load the extension in Chrome:
   - Open Chrome and navigate to `chrome://extensions`
   - Enable "Developer mode" (toggle in top right)
   - Click "Load unpacked"
   - Select the `build` directory from this project

5. Visit your X/Twitter followers page (`https://x.com/[username]/followers`)

## Development

### Available Scripts

- `bun dev` - Start development server with Hot Module Replacement (HMR)
- `bun build` - Build for production
- `bun build:watch` - Build and watch for changes
- `bun lint` - Run ESLint
- `bun lint:fix` - Fix ESLint issues
- `bun prettier` - Format code with Prettier

### Project Structure

```
├── src/
│   ├── components/        # React components
│   │   ├── layout/        # Layout components
│   │   └── views/         # Main view components
│   ├── context/           # React contexts (VisibilityContext)
│   ├── hooks/             # Custom React hooks
│   ├── lib/               # Core libraries and utilities
│   ├── pages/             # Extension entry points
│   │   ├── background/    # Background service worker
│   │   ├── content/       # Content scripts and UI injection
│   │   │   └── followers/ # Follower detection and removal logic
│   │   └── popup/         # Extension popup page
│   ├── shared/            # Shared components and utilities
│   │   ├── hooks/         # Shared React hooks
│   │   └── storages/      # Chrome storage abstractions
│   ├── styles/            # Global styles and SCSS
│   └── types/             # TypeScript type definitions
├── public/                # Static assets and icons
├── utils/                 # Build tools and utilities
└── build/                 # Build output directory
```

## Storage

The extension uses Chrome's local storage to save:

- `realFollowers`: Array of usernames marked as legitimate followers
- `botFollowers`: Array of usernames marked as bots
- `preferences`: User preferences including the `hideRealOnPage` filter state
- `lastSweepAt`: Timestamp of the last bulk removal operation

Your data never leaves your browser and is stored locally. If Chrome sync is enabled, classifications will sync across your devices.

## Privacy

- **No External Servers**: No data is sent to external servers
- **Local Processing**: All processing happens locally in your browser
- **Explicit Actions Only**: Only interacts with X/Twitter when you explicitly trigger bot removal
- **No Tracking**: The extension does not track your activity or collect analytics

## Technical Details

### Detection & Injection

- Uses `data-testid="UserCell"` selector to identify follower elements on X/Twitter
- Injects custom buttons using `MutationObserver` to handle dynamically loaded content
- Automatically processes new followers as they scroll into view

### Removal Process

- Looks for "More" button (`aria-label="More"`) on each follower cell
- Finds "Remove this follower" menu item text
- Clicks through the removal confirmation dialog
- Implements configurable delays (default: 1800ms) between removals to respect rate limits
- Provides real-time progress updates during bulk removal

### UI Features

- **Control Panel**: Floating panel that appears on follower pages
- **Status Indicators**: Visual highlighting (green for real, red for bots)
- **Metrics Dashboard**: Shows trusted count, flagged count, and coverage percentage
- **Progress Tracking**: Real-time progress bar during bulk removal operations

### Browser Compatibility

- **Chrome/Chromium**: Fully supported (Manifest V3)
- **Firefox**: Build available with `bun build:firefox` (requires Manifest V2 conversion)

## Build & Deployment

### Automated Build Script

The project includes a `build.sh` script that automatically builds and packages the extension:

```bash
bash build.sh
```

This will:
1. Detect and use the appropriate package manager (Bun or npm)
2. Install dependencies if needed
3. Extract version from `package.json`
4. Build the extension for production
5. Create a timestamped zip file: `build-[version]-[date].zip`

### Requirements

- `jq` for JSON parsing (`brew install jq` on macOS)
- Zip utility (built-in on macOS/Linux)
- Bun or npm

## Troubleshooting

### Extension Not Working

1. Ensure you're on a followers page (`https://x.com/[username]/followers`)
2. Check that the extension is enabled in `chrome://extensions`
3. Refresh the X/Twitter page after installing the extension
4. Check the browser console for any error messages

### Buttons Not Appearing

- The extension only works on follower pages
- Make sure you're logged into X/Twitter
- Try scrolling down to load more followers (buttons are injected dynamically)

### Removal Not Working

- Ensure you've marked accounts as "Bot" first
- Check that you have permission to remove followers from your account
- The extension respects X/Twitter's rate limits - if removals fail, wait a few minutes and try again

## Disclaimer

This extension automates interactions with X/Twitter's interface. Use responsibly and in accordance with X/Twitter's Terms of Service. The authors are not responsible for any account restrictions that may result from using this tool.

**Important Notes:**
- Always review accounts before marking them as bots
- The extension only removes accounts you explicitly mark
- Bulk removal operations cannot be undone
- Use at your own risk

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

### Core Technologies

- [Vite](https://vitejs.dev/) - Next generation frontend tooling
- [React](https://reactjs.org/) - A JavaScript library for building user interfaces
- [TypeScript](https://www.typescriptlang.org/) - JavaScript with syntax for types
- [TailwindCSS](https://tailwindcss.com/) - A utility-first CSS framework
- [Framer Motion](https://www.framer.com/motion/) - Production-ready motion library
- [Iconsax React](https://iconsax.io/) - Beautiful icon library

### Inspiration

This project was inspired by the need for better follower management tools on X/Twitter. Built with modern web technologies for a smooth user experience.
