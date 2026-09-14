// Markstream keeps its tooltip in a separate app under document.body. Keep the real link's
// mouseleave handler as the dismissal boundary: it also cancels the delayed hover timer.
let hoveredLink: HTMLElement | null = null

export const dismissMarkdownLinkTooltip = (owner?: HTMLElement | null): void => {
  const link = hoveredLink
  if (!link || (owner !== undefined && (!owner || !owner.contains(link)))) return
  hoveredLink = null
  const MouseEvent = link.ownerDocument.defaultView?.MouseEvent
  if (MouseEvent) link.dispatchEvent(new MouseEvent('mouseleave'))
}

export const installMarkdownLinkTooltipCleanup = (): (() => void) => {
  const onEnter = (event: Event): void => {
    const target = event.target
    if (target instanceof HTMLElement && target.matches('a.link-node')) hoveredLink = target
  }
  const onLeave = (event: Event): void => {
    if (event.target === hoveredLink) hoveredLink = null
  }
  const dismiss = (): void => dismissMarkdownLinkTooltip()
  document.addEventListener('mouseenter', onEnter, true)
  document.addEventListener('mouseleave', onLeave, true)
  for (const event of ['pointerdown', 'click', 'auxclick', 'scroll']) {
    document.addEventListener(event, dismiss, true)
  }
  window.addEventListener('blur', dismiss)
  return () => {
    dismiss()
    document.removeEventListener('mouseenter', onEnter, true)
    document.removeEventListener('mouseleave', onLeave, true)
    for (const event of ['pointerdown', 'click', 'auxclick', 'scroll']) {
      document.removeEventListener(event, dismiss, true)
    }
    window.removeEventListener('blur', dismiss)
  }
}
