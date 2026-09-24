import { createContext } from 'preact';
import { useContext, useEffect, useState } from 'preact/hooks';
import type { PlanoraWidget } from '../planora';
import type { WidgetState } from '../store/store';

export const WidgetContext = createContext<PlanoraWidget | null>(null);

export function useWidget(): PlanoraWidget {
  const widget = useContext(WidgetContext);
  if (!widget) throw new Error('WidgetContext missing');
  return widget;
}

export function useWidgetState(): WidgetState {
  const widget = useWidget();
  const [state, setState] = useState(widget.store.state);
  useEffect(() => {
    setState(widget.store.state);
    return widget.store.subscribe(setState);
  }, [widget]);
  return state;
}
