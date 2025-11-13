import { RefObject, useEffect } from 'react';

/**
 * Click outside hook - Closes the extension when clicking outside the root element
 * Only works for content UI, not for popup
 */
export function useClickOutside(
  isPopup: boolean,
  isRootVisible: boolean,
  toggleRootVisibility: () => void | Promise<void>,
  extensionId: string,
  containerRef?: RefObject<HTMLElement | null>,
  closeOnOutside = true,
) {
  useEffect(() => {
    if (isPopup || !isRootVisible || !closeOnOutside) return;

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      if ('button' in event && event.button !== 0) return;

      // Find the extension's root element
      const extensionRoot = document.getElementById(
        extensionId + '-content-view-root',
      );
      if (!extensionRoot) return;

      const shadowRoot = extensionRoot.shadowRoot;
      const composedPath =
        typeof event.composedPath === 'function'
          ? event.composedPath()
          : [event.target ?? null];

      const clickedInside = composedPath.some((target) =>
        isTargetInsideExtension(
          target,
          shadowRoot,
          extensionRoot,
          containerRef?.current ?? null,
        ),
      );

      if (!clickedInside) {
        void toggleRootVisibility();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
    };
  }, [
    isRootVisible,
    toggleRootVisibility,
    isPopup,
    extensionId,
    containerRef,
    closeOnOutside,
  ]);
}

function isTargetInsideExtension(
  target: EventTarget | null,
  shadowRoot: ShadowRoot | null,
  host: HTMLElement,
  panelElement: HTMLElement | null,
) {
  if (!target) return false;
  if (target === host) return true;
  if (!(target instanceof Node)) return false;

  if (panelElement?.contains(target)) return true;
  if (shadowRoot?.contains(target)) return true;

  return false;
}
