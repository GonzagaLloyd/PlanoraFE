/**
 * npm entry: `import { Planora } from '@planora/widget'`.
 * Importing has no side effects — nothing happens until Planora.init().
 */
import { PlanoraWidget } from './planora';
import { mountUi } from './ui/mount';

export const Planora = new PlanoraWidget(mountUi);

export { PlanoraWidget, DEFAULT_API_BASE } from './planora';
export type { InitOptions, PlanoraUser } from './planora';
export type { Metadata } from './capture';
export type { PlanoraEvents, PlanoraEventName } from './events';
export { SDK_VERSION } from './version';
export type { TicketStatus, TicketSummary, TicketType } from '@planora/widget-contract';
