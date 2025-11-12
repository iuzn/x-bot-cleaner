import { extensionId } from '@/lib/config';

export const USER_CELL_SELECTOR = '[data-testid="UserCell"]';
export const USERNAME_LINK_SELECTOR = 'a[href^="/"][role="link"]';
export const ACTION_BUTTON_ATTRIBUTE = `data-${extensionId}-action`;
export const BUTTON_CONTAINER_ATTRIBUTE = `data-${extensionId}-controls`;
export const STATUS_ATTRIBUTE = `data-${extensionId}-status`;
export const USERNAME_ATTRIBUTE = `data-${extensionId}-username`;
export const PROCESSED_ATTRIBUTE = `data-${extensionId}-processed`;
export const HIDDEN_ATTRIBUTE = `data-${extensionId}-hidden`;

export const STYLE_TAG_ID = `${extensionId}-follower-style`;
export const BUTTON_BASE_CLASS = 'xbc-follower-button';
