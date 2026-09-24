import { useEffect, useRef } from 'preact/hooks';
import { useWidget, useWidgetState } from './context';
import { t } from './i18n';
import { IconChat, IconClose } from './icons';
import { Detail } from './views/Detail';
import { Home } from './views/Home';
import { List } from './views/List';
import { Report } from './views/Report';
import { Review } from './views/Review';
import { Sent } from './views/Sent';

/** Picks black or white text for the configured accent colour. */
export function contrastInk(color: string): string {
  const hex = color.replace('#', '');
  const full = hex.length === 3 ? hex.replace(/./g, (c) => c + c) : hex;
  if (!/^[0-9a-f]{6}$/i.test(full)) return '#ffffff';
  const [r, g, b] = [0, 2, 4].map((i) => {
    const channel = parseInt(full.slice(i, i + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.45 ? '#111111' : '#ffffff';
}

export function App({ hideLauncher, zIndex }: { hideLauncher: boolean; zIndex: number }) {
  const widget = useWidget();
  const state = useWidgetState();
  const panelRef = useRef<HTMLDivElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (state.open && !wasOpen.current) panelRef.current?.focus();
    if (!state.open && wasOpen.current) launcherRef.current?.focus();
    wasOpen.current = state.open;
  }, [state.open]);

  if (!state.ready || !state.config) return null;

  const { branding } = state.config;
  const unreadCount = Object.keys(state.unread).length;
  const style = {
    '--pl-accent': branding.primary_color,
    '--pl-accent-ink': contrastInk(branding.primary_color),
    zIndex: String(zIndex),
    position: 'relative',
  } as Record<string, string>;

  let view = null;
  switch (state.view) {
    case 'report':
      view = state.draft ? <Report /> : <Home />;
      break;
    case 'review':
      view = state.draft ? <Review /> : <Home />;
      break;
    case 'sent':
      view = <Sent />;
      break;
    case 'list':
      view = <List />;
      break;
    case 'detail':
      view = <Detail />;
      break;
    default:
      view = <Home />;
  }

  return (
    <div
      class={`pl-root ${branding.position === 'bottom-left' ? 'pl-left' : 'pl-right'}${state.open ? ' pl-is-open' : ''}`}
      style={style}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && state.open) {
          event.stopPropagation();
          widget.close();
        }
      }}
    >
      {state.open && <div class="pl-backdrop" aria-hidden="true" style={{ zIndex: String(zIndex) }} onClick={() => widget.close()} />}
      {state.open && (
        <div
          ref={panelRef}
          id="pl-panel"
          class="pl-panel"
          role="dialog"
          aria-modal="false"
          aria-labelledby="pl-panel-title"
          tabIndex={-1}
          style={{ zIndex: String(zIndex) }}
        >
          {view}
        </div>
      )}

      {!hideLauncher && (
        <button
          ref={launcherRef}
          type="button"
          class="pl-launcher"
          style={{ zIndex: String(zIndex) }}
          aria-expanded={state.open}
          aria-controls="pl-panel"
          aria-label={state.open ? t.closeWidget : `${branding.launcher_label}${unreadCount ? ` (${t.unreadUpdates(unreadCount)})` : ''}`}
          title={branding.launcher_label}
          onClick={() => widget.toggle()}
        >
          {state.open ? <IconClose /> : <IconChat />}
          {!state.open && unreadCount > 0 && (
            <span class="pl-badge" aria-hidden="true">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
      )}
    </div>
  );
}
