import { useEffect } from 'react';

/**
 * Click outside hook - Closes the extension when clicking outside the root element
 * Only works for content UI, not for popup
 */
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

      // Find the extension's root element
      const extensionRoot = document.getElementById(
        extensionId + '-content-view-root',
      );
      if (!extensionRoot || !isRootVisible) return;

      // Close if clicked outside the extension root
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
