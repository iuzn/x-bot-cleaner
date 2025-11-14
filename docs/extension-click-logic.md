# Browser Extension Click Logic and Component Architecture

Bu dokümanda, browser extension'ımızın ikonuna tıklandığında gerçekleşen tüm click logic akışı, component mimarisi, animasyonlar ve temel component iskeleti detaylı bir şekilde açıklanmaktadır.

## İçerik Tablosu

1. [Genel Mimari](#genel-mimari)
2. [Click Logic Akışı](#click-logic-akışı)
3. [Component Architecture](#component-architecture)
4. [Visibility Management](#visibility-management)
5. [Animasyon Sistemi](#animasyon-sistemi)
6. [Component Skeleton](#component-skeleton)
7. [Konfigürasyon ve Entegrasyon](#konfigürasyon-ve-entegrasyon)

## Genel Mimari

Extension'ımız iki farklı çalışma modu destekler:

1. **Content Injection Mode**: Normal web sayfalarında, extension doğrudan sayfaya inject edilir ve fixed pozisyonda görünür
2. **Popup Mode**: Yeni tab (new tab) veya inject edilemeyen sayfalarda popup olarak açılır

Her iki mod da aynı React component'leri kullanır ancak farklı rendering ve visibility logic'leri uygulanır.

## Click Logic Akışı

### 1. Extension İkonuna Tıklama

Kullanıcı extension bar'ındaki ikona tıkladığında:

```typescript
// src/pages/background/index.ts - Browser Action Click Handler
chrome.action.onClicked.addListener(async () => {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (!tab?.id) {
      console.error('No active tab found');
      return;
    }

    const isCurrentTabNewTab = isNewTab(tab.url);

    if (isCurrentTabNewTab) {
      // New tab'de popup'ı aç
      await chrome.action.openPopup();
    } else {
      // Normal tab'de inject edilmiş extension'ı aç/gizle
      await chrome.tabs.sendMessage(tab.id, {
        message: 'browser_action_clicked',
      });
    }
  } catch (error) {
    console.error('Error in browser action:', error);
  }
});
```

### 2. Sayfa Türü Kontrolü

```typescript
// New tab kontrol fonksiyonu
function isNewTab(url: string | undefined): boolean {
  if (!url) return true;
  const storeRegexPatterns = [
    /^about:newtab$/,
    /^chrome:\/\/newtab\//,
    /^https:\/\/[^/]*chromewebstore\.google\.com/,
    /^https:\/\/chrome\.google\.com\/.*webstore/,
    /^chrome:\/\/extensions\//,
  ];
  return storeRegexPatterns.some((pattern) => pattern.test(url));
}
```

### 3. Content Injection vs Popup Kararı

- **New Tab/Chrome Store/Extensions**: Popup mode
- **Normal Web Sayfaları**: Content injection mode

### 4. Content Injection Mode İşleyişi

Inject edilmiş extension'da visibility değişimi:

```typescript
// src/context/VisibilityContext.tsx - Message Listener
useEffect(() => {
  const handleBrowserAction = async (request, sender, sendResponse) => {
    if (request.message === 'browser_action_clicked') {
      try {
        const newState = !isRootVisible;
        await visibilityStorage.set(newState);
        updateVisibility(newState);
        sendResponse({ success: true });
      } catch (error) {
        console.error('Error updating visibility:', error);
        sendResponse({ success: false });
      }
    }
    return true;
  };

  chrome.runtime.onMessage.addListener(handleBrowserAction);
  return () => chrome.runtime.onMessage.removeListener(handleBrowserAction);
}, [isRootVisible]);
```

### 5. Popup Mode İşleyişi

Popup mode'da component doğrudan render edilir ve visibility her zaman `true`'dur.

### 6. Popup Action Shortcuts

When the UI is rendered inside the popup (because we are on a tab where the content script is not injected), high-impact actions behave as launchers:

1. `Capture All` and `Remove Bots` call `launchFollowersWorkspace(intent)` (defined in `src/components/views/Main.tsx`).  
   - This function writes `autoStartCapture` or `autoStartRemoval` into the corresponding chrome.storage namespaces.  
   - It also forces `visibilityStorage` to `true` so the panel is visible once the content script loads.  
   - Finally, it opens a fresh tab pointed at the cached followers page URL (the extension stores the most recent `/followers` link in `followersWorkspaceStorage`; when unavailable it falls back to `https://x.com/home`).
2. The content script detects these intents. In `handleRouteChange`, if we are not yet on the followers page, it now calls `maybeNavigateToFollowersPage()`, which reuses `ensureFollowersPageActive()` to drive the newly opened tab directly to the followers timeline.  
   - `ensureFollowersPageActive()` now awaits `triggerFollowersNavigation()`, which first tries the cached URL, then actively polls the current DOM for a profile link until it can derive `/{username}/followers`, ensuring we can still navigate correctly during the very first popup launch (before we have any stored URL).
3. Once the followers page finishes loading, the existing `checkAndStartAutoCapture()` / `checkAndStartAutoRemoval()` hooks see the pending flags, clear them, and start the requested workflow without any extra user interaction.

This flow guarantees that users who discover the extension through the popup immediately land on the correct Twitter page and watch the panel open automatically before the heavy operations begin.

## Component Architecture

### Ana Component Yapısı

```typescript
// src/components/views/Main.tsx
export default function Main() {
  const isPopup =
    typeof window !== 'undefined' && window.location.href.includes('popup');

  // Logo URL'ini chrome API ile al (content script için gerekli)
  const logoUrl = isPopup
    ? '/logo.png'
    : typeof chrome !== 'undefined' && chrome.runtime?.getURL
      ? chrome.runtime.getURL('logo.png')
      : '/logo.png';

  const { isRootVisible, toggleRootVisibility } = isPopup
    ? { isRootVisible: true, toggleRootVisibility: () => {} }
    : useVisibility();

  // Click outside to close hook'u
  useClickOutside(
    isPopup,
    isRootVisible,
    () => toggleRootVisibility(false),
    extensionId,
  );

  return (
    <>
      <div className="relative h-full">
        <div
          ref={containerRef}
          className={cn(
            isPopup && 'h-full w-full bg-white dark:bg-neutral-900',
            !isPopup && [
              'fixed right-6 top-6 z-[2147483647] h-[600px] w-[420px] rounded-2xl',
              'border border-neutral-200/50 bg-white/95 shadow-2xl shadow-neutral-900/20',
              'backdrop-blur-xl transition-all duration-500 ease-out',
              'dark:border-neutral-700/50 dark:bg-neutral-900/95 dark:shadow-neutral-900/60',
              isRootVisible
                ? 'translate-y-0 scale-100 opacity-100'
                : 'pointer-events-none -translate-y-[16px] scale-95 opacity-0',
            ],
          )}
        >
          {/* Header ve Content */}
        </div>
      </div>
    </>
  );
}
```

### Layout Component'leri

```typescript
// src/pages/content/ui/app.tsx - Content App
export default function App() {
  return (
    <VisibilityProvider>
      <RootLayout>
        <Layout>
          <Main />
        </Layout>
      </RootLayout>
    </VisibilityProvider>
  );
}

// src/pages/popup/index.tsx - Popup App
import App from '@/pages/content/ui/app';

const init = () => {
  const appContainer = document.querySelector('#app-container');
  const root = createRoot(appContainer);
  root.render(<App />);
};
```

## Visibility Management

### Visibility Context

```typescript
// src/context/VisibilityContext.tsx
interface VisibilityContextType {
  isRootVisible: boolean;
  toggleRootVisibility: (isVisible?: boolean) => void;
}

export function VisibilityProvider({ children }: { children: React.ReactNode }) {
  const [isRootVisible, setIsRootVisible] = useState(false);

  const updateVisibility = (newState: boolean) => {
    const root = document.getElementById(extensionId + '-content-view-root');
    setIsRootVisible(newState);
    if (root) {
      root.style.visibility = newState ? 'visible' : 'hidden';
    }
  };

  // Initial state ve storage listener
  useEffect(() => {
    const init = async () => {
      const state = await visibilityStorage.get();
      updateVisibility(state);
    };
    init();
  }, []);

  const toggleRootVisibility = async (isVisible?: boolean) => {
    const newState = isVisible ?? !isRootVisible;
    await visibilityStorage.set(newState);
    updateVisibility(newState);
  };

  return (
    <VisibilityContext.Provider value={{ isRootVisible, toggleRootVisibility }}>
      {children}
    </VisibilityContext.Provider>
  );
}
```

### Storage Layer

```typescript
// src/shared/storages/visibilityStorage.ts
import { BaseStorage, createStorage, StorageType } from '@src/shared/storages/base';

type VisibilityStorage = BaseStorage<boolean> & {
  toggle: () => Promise<void>;
};

export const VISIBILITY_STORAGE_KEY = 'visibility-storage-key';

const storage = createStorage<boolean>(VISIBILITY_STORAGE_KEY, true, {
  storageType: StorageType.Local,
});

const visibilityStorage: VisibilityStorage = {
  ...storage,
  toggle: async () => {
    await storage.set((current) => !current);
  },
};

export default visibilityStorage;

```

> **Not:** Varsayılan değer `true` olduğu için extension ilk yüklendiğinde panel otomatik olarak açık gelir. Kullanıcı paneli kapattığında durum chrome.storage'da saklanır ve sonraki oturumlarda aynı şekilde devam eder.

### Followers Workspace Storage

Popup actions need to know which `/followers` URL should be opened. We persist the last successful target so we can launch the correct page even when the popup is rendered on a site where the content script is inactive.

```typescript
// src/shared/storages/followersWorkspaceStorage.ts
export type FollowersWorkspaceState = {
  followersUrl: string | null;
  lastUpdatedAt: number | null;
};

const storage = createStorage<FollowersWorkspaceState>(
  'followers-workspace-state',
  { followersUrl: null, lastUpdatedAt: null },
  { storageType: StorageType.Local, liveUpdate: true },
);

async function setFollowersUrl(url: string | null) {
  await storage.set((current) => ({
    ...(current ?? defaultState),
    followersUrl: url,
    lastUpdatedAt: Date.now(),
  }));
}
```

The content script updates this store whenever it reaches the followers page (or derives a new target URL). The popup reads it in `launchFollowersWorkspace` to decide which tab URL to open.

## Animasyon Sistemi

### CSS Transition Animasyonları

Extension'ın açılış/kapanış animasyonları CSS transitions ile sağlanır:

```scss
// src/components/views/Main.tsx içindeki animasyon class'ları
!isPopup && [
  'fixed right-6 top-6 z-[2147483647] h-[600px] w-[420px] rounded-2xl',
  'border border-neutral-200/50 bg-white/95 shadow-2xl shadow-neutral-900/20',
  'backdrop-blur-xl transition-all duration-500 ease-out',
  'dark:border-neutral-700/50 dark:bg-neutral-900/95 dark:shadow-neutral-900/60',
  isRootVisible
    ? 'translate-y-0 scale-100 opacity-100'     // Görünür durum
    : 'pointer-events-none -translate-y-[16px] scale-95 opacity-0', // Gizli durum
]
```

#### Animasyon Parametreleri

| Özellik | Görünür Değer | Gizli Değer | Geçiş Süresi | Timing Function |
|---------|---------------|-------------|--------------|----------------|
| `translate-y` | `0` | `-16px` | `500ms` | `ease-out` |
| `scale` | `1` | `0.95` | `500ms` | `ease-out` |
| `opacity` | `1` | `0` | `500ms` | `ease-out` |
| `pointer-events` | `auto` | `none` | - | - |

### Additional CSS Animasyonları

Global stylesheet'te tanımlı animasyonlar:

```scss
// src/styles/globals.scss
@layer utilities {
  @keyframes slideIn {
    from {
      transform: translateY(100%);
      opacity: 0;
    }
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }

  @keyframes slideOut {
    from {
      transform: translateY(0);
      opacity: 1;
    }
    to {
      transform: translateY(100%);
      opacity: 0;
    }
  }

  .animate-slideIn {
    animation: slideIn 0.3s ease-out;
  }

  .animate-slideOut {
    animation: slideOut 0.3s ease-in;
  }

  .animate-out {
    animation: slideOut 0.3s ease-in forwards;
  }
}
```

## Component Skeleton

### Temel Component Yapısı

```typescript
// Main Component Template - src/components/views/Main.tsx
import { useVisibility } from '@/context/VisibilityContext';
import { useRef } from 'react';
import { cn } from '@/lib/utils';
import { extensionId } from '@/lib/config';
import { useClickOutside } from '@/hooks/useClickOutside';

export default function Main() {
  // Popup kontrolü
  const isPopup = typeof window !== 'undefined' &&
                  window.location.href.includes('popup');

  // Logo URL handling
  const logoUrl = isPopup
    ? '/logo.png'
    : typeof chrome !== 'undefined' && chrome.runtime?.getURL
      ? chrome.runtime.getURL('logo.png')
      : '/logo.png';

  // Visibility hook - popup için her zaman visible
  const { isRootVisible, toggleRootVisibility } = isPopup
    ? { isRootVisible: true, toggleRootVisibility: () => {} }
    : useVisibility();

  // Container ref for click outside detection
  const containerRef = useRef<HTMLDivElement>(null);

  // Click outside hook - sadece content mode için
  useClickOutside(
    isPopup,
    isRootVisible,
    () => toggleRootVisibility(false),
    extensionId,
  );

  return (
    <>
      <div className="relative h-full">
        <div
          ref={containerRef}
          className={cn(
            // Popup styling
            isPopup && 'h-full w-full bg-white dark:bg-neutral-900',

            // Content injection styling
            !isPopup && [
              // Positioning and sizing
              'fixed right-6 top-6 z-[2147483647] h-[600px] w-[420px] rounded-2xl',

              // Visual styling
              'border border-neutral-200/50 bg-white/95 shadow-2xl shadow-neutral-900/20',
              'backdrop-blur-xl transition-all duration-500 ease-out',
              'dark:border-neutral-700/50 dark:bg-neutral-900/95 dark:shadow-neutral-900/60',

              // Animation states
              isRootVisible
                ? 'translate-y-0 scale-100 opacity-100'           // Visible
                : 'pointer-events-none -translate-y-[16px] scale-95 opacity-0', // Hidden
            ],
          )}
        >
          {/* Header Section */}
          <div className="flex justify-between pr-4">
            <div className="flex items-center gap-4 py-5 pl-8">
              <img
                src={logoUrl}
                alt="Extension Logo"
                className="h-12 w-12 rounded-xl object-contain"
              />
              <div>
                <h1 className="text-xl font-semibold text-eb-700 dark:text-eb-300">
                  Extension Boilerplate
                </h1>
                <p className="text-sm text-neutral-600 dark:text-neutral-400">
                  {isPopup ? 'Popup View' : 'Content View Manager'}
                </p>
              </div>
            </div>

            {/* Close button - sadece content mode için */}
            <button
              onClick={() => !isPopup && toggleRootVisibility(false)}
              className={cn(
                'group mt-4 flex h-10 w-10 items-center justify-center rounded-full transition-colors duration-200',
                isPopup
                  ? 'invisible' // Popup'ta görünmez ama layout için var
                  : 'hover:bg-eb-100 dark:hover:bg-eb-900',
              )}
            >
              <svg
                className="text-500 h-5 w-5 transition-colors duration-200 group-hover:text-eb-700"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {/* Content Section */}
          <div className="flex h-full flex-col px-8 pb-8">
            <div className="flex flex-1 items-start justify-center pt-[32%]">
              <div className="space-y-6 text-center">
                {/* Welcome Message */}
                <div className="space-y-3">
                  <h2 className="text-2xl font-semibold text-eb-600">
                    {isPopup ? 'Extension Popup' : 'Welcome to Boilerplate'}
                  </h2>
                  <p className="leading-relaxed text-base text-neutral-600 dark:text-neutral-400">
                    {isPopup
                      ? 'This is your extension popup. Access all features from this dedicated window.'
                      : 'This is your content view extension. Manage visibility and customize your experience with this powerful boilerplate.'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
```

### Hook Implementasyonları

```typescript
// useClickOutside Hook - src/hooks/useClickOutside.ts
export function useClickOutside(
  isPopup: boolean,
  isRootVisible: boolean,
  toggleRootVisibility: () => void,
  extensionId: string,
) {
  useEffect(() => {
    if (isPopup) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (event.button !== 0) return;

      // Extension'ın root elementini bul
      const extensionRoot = document.getElementById(
        extensionId + '-content-view-root',
      );
      if (!extensionRoot || !isRootVisible) return;

      // Extension root'unun dışına tıklandıysa kapat
      if (!extensionRoot.contains(event.target as Node)) {
        toggleRootVisibility();
      }
    };

    if (isRootVisible) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isRootVisible, toggleRootVisibility, isPopup, extensionId]);
}

// useBrowserAction Hook - src/hooks/useBrowserAction.ts
export default function useBrowserAction() {
  const [actionClicked, setActionClicked] = useState(false);

  useEffect(() => {
    const handleMessage = (request: { message: string }) => {
      if (request.message === 'browser_action_clicked') {
        setActionClicked((prevState) => !prevState);
      }
    };
    chrome.runtime.onMessage.addListener(handleMessage);

    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage);
    };
  }, [actionClicked]);

  return !actionClicked;
}
```

## Konfigürasyon ve Entegrasyon

### Manifest Konfigürasyonu

```javascript
// manifest.js
const manifest = {
  manifest_version: 3,
  action: {
    default_title: 'Extension Boilerplate',
    default_icon: 'icon-48.png',
    default_popup: 'src/pages/popup/index.html',
  },
  content_scripts: [
    {
      matches: ['http://*/*', 'https://*/*', '<all_urls>'],
      js: ['src/pages/contentUI/index.js'], // Built version
      run_at: 'document_end',
    },
  ],
  web_accessible_resources: [
    {
      resources: [
        'assets/js/*.js',
        'assets/css/*.css',
        'logo.png',
      ],
      matches: ['*://*/*'],
    },
  ],
};
```

### Content Injection Kurulumu

```typescript
// src/pages/content/ui/root.tsx
const root = document.createElement('div');
root.id = extensionId + '-content-view-root';
root.style.display = 'block';
root.style.visibility = 'hidden';
document.body.append(root);

const rootIntoShadow = document.createElement('div');
rootIntoShadow.id = extensionId + '-app';
rootIntoShadow.style.display = 'block';

const shadowRoot = root.attachShadow({ mode: 'open' });
shadowRoot.appendChild(rootIntoShadow);

// Inject CSS
const styleElement = document.createElement('style');
styleElement.innerHTML = injectedStyle;
shadowRoot.appendChild(styleElement);

// Render React App
createRoot(rootIntoShadow).render(<App />);
```

### Background Script Tab Yönetimi

```typescript
// src/pages/background/index.ts
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    await setupPopupForTab(tab.id!, tab.url);
  } catch (error) {
    console.error('Error setting up popup for activated tab:', error);
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' || changeInfo.url) {
    await setupPopupForTab(tabId, tab.url);
  }
});
```

## Özet

Bu extension mimarisi şu özellikler sağlar:

1. **Adaptive Rendering**: Sayfa türüne göre popup veya content injection
2. **State Persistence**: Visibility durumu chrome.storage ile saklanır
3. **Smooth Animations**: CSS transitions ile akıcı açılış/kapanış
4. **Click Outside Detection**: Content mode için otomatik kapanma
5. **Shadow DOM Isolation**: Stil çakışmalarını önler
6. **Cross-context Communication**: Background ↔ Content script iletişimi

Extension ikonu tıklandığında, background script aktif tab'ı kontrol eder ve uygun rendering modunu seçer. Tüm component'ler aynı kodu paylaşır ancak çalışma zamanı koşulları farklı davranış sergiler.
