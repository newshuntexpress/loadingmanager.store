const TEXT_INPUT_TYPES = new Set(['', 'text', 'search', 'tel', 'url', 'email']);

export function shouldEnforceUppercaseElement(el: EventTarget | null): el is HTMLInputElement | HTMLTextAreaElement {
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
    return false;
  }
  if (el.disabled || el.readOnly) {
    return false;
  }
  if (
    el.dataset.preserveCase === 'true' ||
    el.getAttribute('data-preserve-case') === 'true' ||
    Boolean(el.closest('[data-preserve-case="true"]'))
  ) {
    return false;
  }
  if (el instanceof HTMLInputElement) {
    const typeAttr = (el.getAttribute('type') || el.type || 'text').toLowerCase();
    if (typeAttr === 'password') return false;
    const autoComp = (el.getAttribute('autocomplete') || '').toLowerCase();
    if (autoComp.includes('password')) return false;
    if (!TEXT_INPUT_TYPES.has(typeAttr)) return false;
  }
  return true;
}

function forceElementValueUppercase(el: HTMLInputElement | HTMLTextAreaElement): void {
  const current = el.value;
  const upper = current.toUpperCase();
  if (current === upper) return;

  let start: number | null = null;
  let end: number | null = null;
  try {
    start = el.selectionStart;
    end = el.selectionEnd;
  } catch {
    start = null;
    end = null;
  }

  // Preserve React's internal _valueTracker so React still detects the change and fires onChange
  const tracker = (el as unknown as { _valueTracker?: { getValue?: () => string; setValue?: (v: string) => void } })._valueTracker;
  const prevTrackedValue = tracker?.getValue?.();

  el.value = upper;

  if (tracker && typeof tracker.setValue === 'function') {
    tracker.setValue(prevTrackedValue ?? '');
  }

  if (start !== null && end !== null) {
    try {
      el.setSelectionRange(start, end);
    } catch {
      // Input types such as email may disallow setSelectionRange
    }
  }
}

let installed = false;

export function installGlobalUppercaseEnforcement(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;

  const handleEvent = (event: Event) => {
    const target = event.target;
    if (!shouldEnforceUppercaseElement(target)) return;
    forceElementValueUppercase(target);
  };

  // Capture phase executes before React's delegated root listener so React's onChange reads uppercase e.target.value
  document.addEventListener('input', handleEvent, true);
  document.addEventListener('compositionend', handleEvent, true);
  document.addEventListener('change', handleEvent, true);
}

export function toUpperString(val: unknown): string {
  return String(val ?? '').toUpperCase();
}
