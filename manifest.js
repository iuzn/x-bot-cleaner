import fs from 'node:fs';

const packageJson = JSON.parse(fs.readFileSync('./package.json', 'utf8'));

/**
 * @type {chrome.runtime.ManifestV3}
 */
const manifest = {
  manifest_version: 3,
  default_locale: 'en',

  name: '__MSG_extensionName__',
  version: packageJson.version,
  description: '__MSG_extensionDescription__',
  //Update permissions when needed
  permissions: ['storage', 'activeTab'],
  background: {
    service_worker: 'src/pages/background/index.js',
    type: 'module',
  },
  action: {
    default_title: 'X Bot Cleaner',
    default_icon: 'icon-48.png',
  },
  icons: {
    16: 'icon-16.png',
    32: 'icon-32.png',
    48: 'icon-48.png',
    128: 'icon-128.png',
  },
  content_scripts: [
    {
      matches: [
        'https://x.com/*',
        'https://*.x.com/*',
        'https://twitter.com/*',
        'https://*.twitter.com/*',
      ],
      js: ['src/pages/contentUI/index.js'],
      run_at: 'document_end',
    },
  ],
  host_permissions: [
    'https://x.com/*',
    'https://*.x.com/*',
    'https://twitter.com/*',
    'https://*.twitter.com/*',
  ],
  web_accessible_resources: [
    {
      resources: [
        'assets/js/*.js',
        'assets/css/*.css',
        'icon-16.png',
        'icon-32.png',
        'icon-48.png',
        'icon-128.png',
        'logo.png',
        'logo.svg',
      ],
      matches: ['*://*/*'],
    },
  ],
  content_security_policy: {
    extension_pages: "script-src 'self'; object-src 'self'",
  },
};

export default manifest;
