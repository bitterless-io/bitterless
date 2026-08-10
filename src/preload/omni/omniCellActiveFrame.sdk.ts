type OmniCellActiveFrameRegion =
  | 'browser-menubar'
  | 'browser-content'
  | 'miniapp-content';

const CELL_ID_ARGUMENT_PREFIX = '--omni-cell-id=';
const FRAME_REGION_ARGUMENT_PREFIX = '--omni-cell-frame-region=';
const FRAME_ELEMENT_ID = 'bitterless-omni-active-cell-frame';
const ACTIVE_BORDER = '2px solid #C2410C';

const getArgumentValue = (prefix: string): string | null => {
  const argument = process.argv.find((value) => value.startsWith(prefix));
  return argument?.slice(prefix.length) ?? null;
};

const isFrameRegion = (value: string | null): value is OmniCellActiveFrameRegion =>
  value === 'browser-menubar' ||
  value === 'browser-content' ||
  value === 'miniapp-content';

const decodeCellId = (value: string | null): string | null => {
  if (!value) return null;
  try {
    const decoded = decodeURIComponent(value);
    return decoded.length > 0 ? decoded : null;
  } catch {
    return null;
  }
};

const setImportantStyle = (element: HTMLElement, property: string, value: string): void => {
  element.style.setProperty(property, value, 'important');
};

const mountActiveFrame = (
  cellId: string,
  region: OmniCellActiveFrameRegion,
): void => {
  if (!document.documentElement || document.getElementById(FRAME_ELEMENT_ID)) return;

  const frame = document.createElement('div');
  frame.id = FRAME_ELEMENT_ID;
  frame.setAttribute('aria-hidden', 'true');
  frame.dataset.omniActiveCellFrame = 'true';
  frame.dataset.omniCellId = cellId;
  frame.dataset.active = 'false';

  setImportantStyle(frame, 'position', 'fixed');
  setImportantStyle(frame, 'inset', '0');
  setImportantStyle(frame, 'z-index', '2147483647');
  setImportantStyle(frame, 'box-sizing', 'border-box');
  setImportantStyle(frame, 'pointer-events', 'none');
  setImportantStyle(frame, 'display', 'none');
  setImportantStyle(frame, 'background', 'transparent');

  if (region === 'browser-menubar') {
    setImportantStyle(frame, 'border-top', ACTIVE_BORDER);
    setImportantStyle(frame, 'border-left', ACTIVE_BORDER);
    setImportantStyle(frame, 'border-right', ACTIVE_BORDER);
    setImportantStyle(frame, 'border-bottom', '0');
  } else if (region === 'browser-content') {
    setImportantStyle(frame, 'border-top', '0');
    setImportantStyle(frame, 'border-left', ACTIVE_BORDER);
    setImportantStyle(frame, 'border-right', ACTIVE_BORDER);
    setImportantStyle(frame, 'border-bottom', ACTIVE_BORDER);
  } else {
    setImportantStyle(frame, 'border', ACTIVE_BORDER);
  }

  document.documentElement.appendChild(frame);
};

const initializeOmniCellActiveFrame = (): void => {
  if (typeof document === 'undefined') return;
  const cellId = decodeCellId(getArgumentValue(CELL_ID_ARGUMENT_PREFIX));
  const region = getArgumentValue(FRAME_REGION_ARGUMENT_PREFIX);
  if (!cellId || !isFrameRegion(region)) return;

  const mount = () => mountActiveFrame(cellId, region);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
    return;
  }
  mount();
};

initializeOmniCellActiveFrame();
