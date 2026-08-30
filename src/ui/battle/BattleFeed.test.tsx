// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { BattleFeedEntry } from '@/presentation/battle/contracts'
import { BattleFeed } from './BattleFeed'

const entries = Array.from({ length: 10 }, (_, index): BattleFeedEntry => ({
  id: `battle-a:feed:${index + 1}`,
  kind: 'event',
  text: `戰況 ${index + 1}`,
  announce: true,
}))

describe('BattleFeed', () => {
  afterEach(cleanup)

  it('keeps ten history entries while announcing only a genuinely new latest entry', async () => {
    const view = render(<BattleFeed entries={[]} />)
    view.rerender(<BattleFeed entries={entries.slice(0, 9)} />)
    await waitFor(() => expect(screen.getByTestId('battle-feed-live').textContent).toBe('戰況 9'))
    view.rerender(<BattleFeed entries={entries} />)
    await waitFor(() => expect(screen.getByTestId('battle-feed-live').textContent).toBe('戰況 10'))

    const live = screen.getByTestId('battle-feed-live')
    const mutations: MutationRecord[] = []
    const observer = new MutationObserver((records) => mutations.push(...records))
    observer.observe(live, { childList: true, characterData: true, subtree: true })

    fireEvent.click(screen.getByRole('button', { name: /展開完整戰報/ }))
    expect(screen.getAllByRole('listitem')).toHaveLength(10)
    fireEvent.click(screen.getByRole('button', { name: /收合完整戰報/ }))
    view.rerender(<BattleFeed entries={[...entries]} />)
    await Promise.resolve()

    expect(live.textContent).toBe('戰況 10')
    expect(mutations).toHaveLength(0)
    observer.disconnect()
  })

  it('shows a non-announcing latest entry without publishing it to the live region', async () => {
    render(<BattleFeed entries={[{ ...entries[0], announce: false }]} />)

    expect(screen.getByText('戰況 1')).toBeTruthy()
    await Promise.resolve()
    expect(screen.getByTestId('battle-feed-live').textContent).toBe('')
  })

  it('mutates the live projection for a distinct id even when the text repeats', async () => {
    const repeated = { ...entries[0], text: '相同戰況' }
    const view = render(<BattleFeed entries={[]} />)
    view.rerender(<BattleFeed entries={[repeated]} />)
    const live = screen.getByTestId('battle-feed-live')
    await waitFor(() => expect(live.querySelector('span')?.dataset.announcementId).toBe(repeated.id))

    const mutations: MutationRecord[] = []
    const observer = new MutationObserver((records) => mutations.push(...records))
    observer.observe(live, { childList: true, subtree: true })
    const next = { ...repeated, id: 'battle-a:feed:2' }
    view.rerender(<BattleFeed entries={[repeated, next]} />)

    await waitFor(() => expect(live.querySelector('span')?.dataset.announcementId).toBe(next.id))
    expect(live.textContent).toBe('相同戰況')
    expect(mutations.length).toBeGreaterThan(0)
    observer.disconnect()
  })
})
