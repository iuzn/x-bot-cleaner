void (async () => {
  // console.log('[X Bot Cleaner - CS] 🚀 Content script starting...');
  // console.log('[X Bot Cleaner - CS] 📍 Current URL:', window.location.href);

  try {
    // console.log('[X Bot Cleaner - CS] 📦 Loading controller module...');
    const controllerModule = await import('@/pages/content/followers/controller');
    // console.log('[X Bot Cleaner - CS] ✅ Controller module loaded');

    // console.log('[X Bot Cleaner - CS] 📦 Loading root UI...');
    await import('@/pages/content/ui/root');
    // console.log('[X Bot Cleaner - CS] ✅ Root UI loaded');

    if (typeof controllerModule.initFollowerController === 'function') {
      // console.log('[X Bot Cleaner - CS] 🎬 Initializing follower controller...');
      controllerModule.initFollowerController();
      // console.log('[X Bot Cleaner - CS] ✅ Follower controller initialized');
    } else {
      console.error(
        '[X Bot Cleaner - CS] ❌ initFollowerController is not available on the controller module.',
      );
    }

    // Listen for Chrome Extension messages (for SPA route tracking)
    // console.log('[X Bot Cleaner - CS] 👂 Setting up Chrome message listener...');

    chrome.runtime.onMessage.addListener((message, sender, _sendResponse) => {
      // console.log('[X Bot Cleaner - CS] 📥 Message received:', {
      //   message,
      //   sender,
      //   currentUrl: window.location.href,
      // });

      try {
        // Catch route change messages
        if (message.message === 'route_changed' && message.url && message.method) {
          // console.log('[X Bot Cleaner - CS] 🔄 Route change message detected:', {
          //   url: message.url,
          //   method: message.method,
          //   timestamp: message.timestamp,
          // });

          if (typeof controllerModule.handleChromeRouteChange === 'function') {
            // console.log('[X Bot Cleaner - CS] 📞 Calling handleChromeRouteChange...');
            controllerModule.handleChromeRouteChange(message.url, message.method);
            // console.log('[X Bot Cleaner - CS] ✅ handleChromeRouteChange called');
          } else {
            console.error('[X Bot Cleaner - CS] ❌ handleChromeRouteChange not available');
          }
        } else {
          // console.log('[X Bot Cleaner - CS] ℹ️ Non-route-change message:', message.message);
        }
      } catch (error) {
        console.error('[X Bot Cleaner - CS] ❌ Error handling Chrome message:', error);
      }

      // Forward other messages (like browser_action_clicked) to existing system
      // Return false since sendResponse call is not needed
      return false;
    });

    // console.log('[X Bot Cleaner - CS] ✅ Chrome message listener registered');
    // console.log('[X Bot Cleaner - CS] 🎉 Content script initialized with Chrome route tracking');
  } catch (error) {
    console.error('[X Bot Cleaner - CS] ❌ Failed to bootstrap follower controller:', error);
  }
})();
