import { render } from 'preact';
import type { PlanoraWidget } from '../planora';
import { App } from './App';
import { WidgetContext } from './context';
import css from './styles.css?inline';

export const HOST_ID = 'planora-widget';
const DEFAULT_Z_INDEX = 2147483000;

export interface MountOptions {
  hideLauncher?: boolean;
  zIndex?: number;
}

/**
 * Renders the widget into a shadow root on a host element appended to <body>.
 * Shadow DOM isolates styles in both directions, so the widget looks the same
 * on a Bootstrap site, a Tailwind app or a WordPress theme.
 */
export function mountUi(widget: PlanoraWidget, options: MountOptions = {}) {
  document.getElementById(HOST_ID)?.remove();

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.setAttribute('data-planora', 'widget');
  // Host box takes no space and ignores page styles; children are position: fixed.
  host.style.cssText = 'all: initial; position: fixed; width: 0; height: 0; top: 0; left: 0; z-index: 2147483000;';
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = css;
  shadow.appendChild(style);
  const container = document.createElement('div');
  shadow.appendChild(container);

  render(
    <WidgetContext.Provider value={widget}>
      <App hideLauncher={Boolean(options.hideLauncher)} zIndex={options.zIndex ?? DEFAULT_Z_INDEX} />
    </WidgetContext.Provider>,
    container,
  );

  return {
    host,
    unmount() {
      render(null, container);
      host.remove();
    },
  };
}
