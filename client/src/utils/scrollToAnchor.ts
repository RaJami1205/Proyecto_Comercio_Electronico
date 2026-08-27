import type { MouseEvent } from 'react'

const SCROLL_DURATION_MS = 800

let activeAnimationFrame: number | null = null

function easeInOutCubic(progress: number) {
  return progress < 0.5
    ? 4 * progress * progress * progress
    : 1 - Math.pow(-2 * progress + 2, 3) / 2
}

function getTargetScrollPosition(target: HTMLElement) {
  const scrollMarginTop = Number.parseFloat(getComputedStyle(target).scrollMarginTop) || 0

  return Math.max(0, target.getBoundingClientRect().top + window.scrollY - scrollMarginTop)
}

export function scrollToElement(target: HTMLElement) {
  if (activeAnimationFrame !== null) {
    cancelAnimationFrame(activeAnimationFrame)
    activeAnimationFrame = null
  }

  const startPosition = window.scrollY
  const targetPosition = getTargetScrollPosition(target)
  const distance = targetPosition - startPosition

  if (
    window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
    Math.abs(distance) < 1
  ) {
    window.scrollTo({ top: targetPosition, behavior: 'auto' })
    return
  }

  const startTime = performance.now()

  function animateScroll(currentTime: number) {
    const progress = Math.min((currentTime - startTime) / SCROLL_DURATION_MS, 1)
    const easedProgress = easeInOutCubic(progress)

    window.scrollTo(0, startPosition + distance * easedProgress)

    if (progress < 1) {
      activeAnimationFrame = requestAnimationFrame(animateScroll)
    } else {
      activeAnimationFrame = null
    }
  }

  activeAnimationFrame = requestAnimationFrame(animateScroll)
}

export function handleAnchorNavigation(event: MouseEvent<HTMLAnchorElement>) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return
  }

  const hash = event.currentTarget.hash
  const target = hash ? document.getElementById(hash.slice(1)) : null

  if (!target) {
    return
  }

  event.preventDefault()

  window.history.pushState(null, '', hash)
  scrollToElement(target)
}
