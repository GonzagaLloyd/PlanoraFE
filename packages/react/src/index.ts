/**
 * React bindings for the Planora widget.
 *
 *   <PlanoraWidget siteKey="pk_live_xxx" user={{ id, name, email, userHash }} />
 *
 * Renders nothing itself: the widget mounts its own bubble in a shadow root.
 * Safe in SSR frameworks (Next.js, Remix): everything runs in effects.
 */
import { useEffect, useMemo, useRef } from 'react';
import { Planora, type InitOptions, type Metadata, type PlanoraEvents, type PlanoraUser } from '@planora/widget';

export interface PlanoraWidgetProps extends Omit<InitOptions, 'user' | 'metadata'> {
  /** The logged-in user, or null when logged out. */
  user?: PlanoraUser | null;
  metadata?: Metadata;
  onTicketCreated?: (payload: PlanoraEvents['ticket:created']) => void;
  onStatusChanged?: (payload: PlanoraEvents['status:changed']) => void;
}

export function PlanoraWidget(props: PlanoraWidgetProps): null {
  const { siteKey, apiBase, user, metadata, onTicketCreated, onStatusChanged } = props;
  const latest = useRef(props);
  latest.current = props;

  // (Re)initialise only when the site or API changes. Branding props are read at init.
  useEffect(() => {
    const { user: initialUser, metadata: initialMetadata, onTicketCreated: _a, onStatusChanged: _b, ...options } = latest.current;
    Planora.init({ ...options, user: initialUser ?? null, metadata: initialMetadata });
    return () => Planora.shutdown();
  }, [siteKey, apiBase]);

  useEffect(() => {
    Planora.identify(user ?? null);
  }, [user?.id, user?.name, user?.email, user?.userHash]);

  const metadataKey = useMemo(() => JSON.stringify(metadata ?? {}), [metadata]);
  useEffect(() => {
    if (metadata) Planora.setMetadata(metadata);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metadataKey]);

  useEffect(() => {
    if (!onTicketCreated) return;
    return Planora.on('ticket:created', (payload) => latest.current.onTicketCreated?.(payload));
  }, [siteKey, apiBase, Boolean(onTicketCreated)]);

  useEffect(() => {
    if (!onStatusChanged) return;
    return Planora.on('status:changed', (payload) => latest.current.onStatusChanged?.(payload));
  }, [siteKey, apiBase, Boolean(onStatusChanged)]);

  return null;
}

/** Open the widget from your own buttons or menus. */
export function usePlanora() {
  return useMemo(
    () => ({
      open: (view?: 'home' | 'report' | 'list') => Planora.open(view),
      close: () => Planora.close(),
      toggle: () => Planora.toggle(),
    }),
    [],
  );
}

export { Planora };
export type { InitOptions, Metadata, PlanoraEvents, PlanoraUser };
