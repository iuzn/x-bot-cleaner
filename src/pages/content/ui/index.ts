void (async () => {
  try {
    const controllerModule = await import('@/pages/content/followers/controller');
    await import('@/pages/content/ui/root');
    if (typeof controllerModule.initFollowerController === 'function') {
      controllerModule.initFollowerController();
    } else {
      console.error(
        '[X Bot Cleaner] initFollowerController is not available on the controller module.',
      );
    }
  } catch (error) {
    console.error('[X Bot Cleaner] Failed to bootstrap follower controller', error);
  }
})();
